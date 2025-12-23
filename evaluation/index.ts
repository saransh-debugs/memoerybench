/**
 * Claim-Centric Evaluation Module
 * 
 * Canonical Object: Query → Claims → Supports
 * 
 * All evaluation layers operate on the same claim graph:
 * 
 * Layer              | What it Measures           | Who Decides
 * -------------------|----------------------------|-------------
 * Claim Correctness  | Was the right info claimed?| Deterministic
 * Claim Grounding    | Were claims supported?     | Deterministic
 * Claim Usage        | Was memory used well?      | LLM Judge
 * 
 * Key Design Rule:
 * If a system cannot emit explicit claims with support links,
 * it is not a memory agent, only a context regurgitator.
 */

import { calculateClaimMetrics, evidenceToGoldStore } from "./deterministic";
import { evaluateClaimUsage, extractClaimsFromAnswer, generateAnswerFromClaims } from "./llm-judge";
import type {
	ClaimGraph,
	ClaimMetrics,
	ClaimUsageMetrics,
	EvaluationInput,
	EvaluationOptions,
	EvaluationResult,
	EvaluationSummary,
	GoldClaimStore,
} from "./types";

// Re-export everything
export * from "./types";
export { calculateClaimMetrics, evidenceToGoldStore } from "./deterministic";
export { evaluateClaimUsage, extractClaimsFromAnswer, generateAnswerFromClaims } from "./llm-judge";

const DEFAULT_OPTIONS: Required<EvaluationOptions> = {
	judgeModel: "gpt-4o",
	minClaimRecall: 0.7,
	minClaimPrecision: 0.7,
	maxUnsupportedClaims: 0,
	maxStalenessViolations: 0,
	minUsageQuality: 3.0,
	deterministicOnly: false,
	claimMatchThreshold: 0.6,
};

// ============================================================================
// SINGLE EVALUATION
// ============================================================================

/**
 * Evaluate a single question using claim-centric metrics.
 */
export async function evaluateOne(
	input: EvaluationInput,
	options?: EvaluationOptions,
): Promise<EvaluationResult> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const startTime = performance.now();

	// =========================================================================
	// DETERMINISTIC LAYER: Claim Correctness & Grounding
	// =========================================================================
	const claimMetrics = calculateClaimMetrics(
		input.produced,
		input.gold,
		opts.claimMatchThreshold,
	);

	// =========================================================================
	// LLM JUDGE LAYER: Claim Usage Quality (optional)
	// =========================================================================
	let usageMetrics: ClaimUsageMetrics | undefined;

	if (!opts.deterministicOnly && input.produced.claims.length > 0) {
		usageMetrics = await evaluateClaimUsage(
			input.gold.question,
			input.produced,
			{ model: opts.judgeModel },
		);
	}

	// =========================================================================
	// DETERMINE PASS/FAIL
	// =========================================================================
	const { pass, failureReasons, explanation } = determinePassFail(
		claimMetrics,
		usageMetrics,
		opts,
	);

	return {
		questionId: input.questionId,
		claimMetrics,
		usageMetrics,
		pass,
		failureReasons,
		explanation,
		latencyMs: performance.now() - startTime,
	};
}

/**
 * Determine pass/fail based on all evaluation layers.
 */
function determinePassFail(
	claimMetrics: ClaimMetrics,
	usageMetrics: ClaimUsageMetrics | undefined,
	opts: Required<EvaluationOptions>,
): { pass: boolean; failureReasons: EvaluationResult["failureReasons"]; explanation: string } {
	const failureReasons = {
		claimCorrectness: false,
		claimGrounding: false,
		claimUsage: false,
	};
	const issues: string[] = [];

	// Check claim correctness (recall & precision)
	if (claimMetrics.claimRecall < opts.minClaimRecall) {
		failureReasons.claimCorrectness = true;
		issues.push(`Low claim recall: ${(claimMetrics.claimRecall * 100).toFixed(0)}% (need ${opts.minClaimRecall * 100}%)`);
	}
	if (claimMetrics.claimPrecision < opts.minClaimPrecision) {
		failureReasons.claimCorrectness = true;
		issues.push(`Low claim precision: ${(claimMetrics.claimPrecision * 100).toFixed(0)}% (need ${opts.minClaimPrecision * 100}%)`);
	}

	// Check claim grounding (unsupported & stale)
	if (claimMetrics.unsupportedClaims > opts.maxUnsupportedClaims) {
		failureReasons.claimGrounding = true;
		issues.push(`${claimMetrics.unsupportedClaims} unsupported claims (hallucinations)`);
	}
	if (claimMetrics.stalenessViolations > opts.maxStalenessViolations) {
		failureReasons.claimGrounding = true;
		issues.push(`${claimMetrics.stalenessViolations} staleness violations`);
	}

	// Check claim usage (if LLM judge ran)
	if (usageMetrics && usageMetrics.averageScore < opts.minUsageQuality) {
		failureReasons.claimUsage = true;
		issues.push(`Low usage quality: ${usageMetrics.averageScore.toFixed(1)}/5 (need ${opts.minUsageQuality})`);
	}

	const pass = !failureReasons.claimCorrectness && 
	             !failureReasons.claimGrounding && 
	             !failureReasons.claimUsage;

	const explanation = pass
		? `✓ Recall: ${(claimMetrics.claimRecall * 100).toFixed(0)}%, Precision: ${(claimMetrics.claimPrecision * 100).toFixed(0)}%` +
		  (usageMetrics ? `, Usage: ${usageMetrics.averageScore.toFixed(1)}/5` : "")
		: `✗ ${issues.join("; ")}`;

	return { pass, failureReasons, explanation };
}

// ============================================================================
// BATCH EVALUATION
// ============================================================================

/**
 * Evaluate a batch of questions.
 */
export async function evaluate(
	inputs: EvaluationInput[],
	options?: EvaluationOptions,
): Promise<EvaluationResult[]> {
	const results: EvaluationResult[] = [];

	for (let i = 0; i < inputs.length; i++) {
		const input = inputs[i]!;
		console.log(`  [${i + 1}/${inputs.length}] ${input.questionId}`);
		
		const result = await evaluateOne(input, options);
		results.push(result);

		console.log(`    ${result.explanation}`);
	}

	return results;
}

// ============================================================================
// BRIDGE: Convert Legacy Format to Claim-Centric
// ============================================================================

/**
 * Create evaluation input from legacy format (retrieved chunks + answer).
 * 
 * This is a BRIDGE for systems that don't natively produce claim graphs.
 * It extracts claims from the answer using LLM.
 * 
 * Proper memory agents should produce ClaimGraph directly.
 */
export async function createEvaluationInput(
	questionId: string,
	question: string,
	goldAnswer: string | number,
	goldEvidence: string[],
	retrievedChunks: Array<{ id: string; content: string }>,
	generatedAnswer: string | undefined,
	sessionContentMap?: Map<string, string[]>,
	options?: { model?: string; apiKey?: string },
): Promise<EvaluationInput> {
	// Create gold store from evidence
	const gold = evidenceToGoldStore(
		questionId,
		question,
		goldAnswer,
		goldEvidence,
		sessionContentMap,
	);

	// Extract claims from answer (bridge for non-claim-native systems)
	let produced: ClaimGraph;
	
	if (generatedAnswer) {
		produced = await extractClaimsFromAnswer(
			question,
			generatedAnswer,
			retrievedChunks.map((c) => c.content),
			options,
		);
	} else {
		// No answer - create empty claim graph
		produced = {
			query: question,
			claims: [],
			supports: retrievedChunks.map((c, i) => ({
				eventId: c.id || `chunk_${i}`,
				content: c.content,
			})),
			generatedAt: new Date().toISOString(),
		};
	}

	return {
		questionId,
		gold,
		produced,
	};
}

// ============================================================================
// SUMMARY
// ============================================================================

/**
 * Generate summary statistics from evaluation results.
 */
export function summarize(results: EvaluationResult[]): EvaluationSummary {
	const total = results.length;
	if (total === 0) {
		return createEmptySummary();
	}

	const passed = results.filter((r) => r.pass).length;
	const failed = total - passed;

	// Claim metrics averages
	const avgRecall = avg(results.map((r) => r.claimMetrics.claimRecall));
	const avgPrecision = avg(results.map((r) => r.claimMetrics.claimPrecision));
	const avgF1 = avg(results.map((r) => r.claimMetrics.claimF1));
	const totalUnsupported = sum(results.map((r) => r.claimMetrics.unsupportedClaims));
	const totalStale = sum(results.map((r) => r.claimMetrics.stalenessViolations));
	const totalMissing = sum(results.map((r) => r.claimMetrics.missingClaims));
	const totalFalse = sum(results.map((r) => r.claimMetrics.falseClaims));

	// Usage metrics averages (if available)
	const resultsWithUsage = results.filter((r) => r.usageMetrics);
	let usageMetrics: EvaluationSummary["usageMetrics"];
	
	if (resultsWithUsage.length > 0) {
		usageMetrics = {
			averageCoherence: avg(resultsWithUsage.map((r) => r.usageMetrics!.coherence)),
			averageRelevance: avg(resultsWithUsage.map((r) => r.usageMetrics!.relevance)),
			averageCompleteness: avg(resultsWithUsage.map((r) => r.usageMetrics!.completeness)),
			averageConciseness: avg(resultsWithUsage.map((r) => r.usageMetrics!.conciseness)),
			averageOverall: avg(resultsWithUsage.map((r) => r.usageMetrics!.averageScore)),
		};
	}

	// Failure breakdown
	const correctnessFailures = results.filter((r) => r.failureReasons.claimCorrectness).length;
	const groundingFailures = results.filter((r) => r.failureReasons.claimGrounding).length;
	const usageFailures = results.filter((r) => r.failureReasons.claimUsage).length;

	return {
		total,
		passed,
		failed,
		accuracy: passed / total,
		claimMetrics: {
			averageRecall: avgRecall,
			averagePrecision: avgPrecision,
			averageF1: avgF1,
			totalUnsupportedClaims: totalUnsupported,
			totalStalenessViolations: totalStale,
			totalMissingClaims: totalMissing,
			totalFalseClaims: totalFalse,
		},
		usageMetrics,
		failureBreakdown: {
			claimCorrectnessFailures: correctnessFailures,
			claimGroundingFailures: groundingFailures,
			claimUsageFailures: usageFailures,
		},
	};
}

/**
 * Print evaluation summary to console.
 */
export function printSummary(summary: EvaluationSummary): void {
	console.log("\n" + "═".repeat(70));
	console.log("                    CLAIM-CENTRIC EVALUATION SUMMARY");
	console.log("═".repeat(70));

	// Overall
	console.log(`\n📊 OVERALL`);
	console.log(`   Total:     ${summary.total}`);
	console.log(`   Passed:    ${summary.passed} (${(summary.accuracy * 100).toFixed(1)}%)`);
	console.log(`   Failed:    ${summary.failed}`);

	// Claim Correctness
	console.log(`\n📋 CLAIM CORRECTNESS (Deterministic)`);
	console.log(`   Claim Recall:     ${(summary.claimMetrics.averageRecall * 100).toFixed(1)}%`);
	console.log(`   Claim Precision:  ${(summary.claimMetrics.averagePrecision * 100).toFixed(1)}%`);
	console.log(`   Claim F1:         ${(summary.claimMetrics.averageF1 * 100).toFixed(1)}%`);
	console.log(`   Missing Claims:   ${summary.claimMetrics.totalMissingClaims}`);
	console.log(`   False Claims:     ${summary.claimMetrics.totalFalseClaims}`);

	// Claim Grounding
	console.log(`\n🔗 CLAIM GROUNDING (Deterministic)`);
	console.log(`   Unsupported Claims:    ${summary.claimMetrics.totalUnsupportedClaims}`);
	console.log(`   Staleness Violations:  ${summary.claimMetrics.totalStalenessViolations}`);

	// Claim Usage
	if (summary.usageMetrics) {
		console.log(`\n💬 CLAIM USAGE (LLM Judge)`);
		console.log(`   Coherence:     ${summary.usageMetrics.averageCoherence.toFixed(2)}/5`);
		console.log(`   Relevance:     ${summary.usageMetrics.averageRelevance.toFixed(2)}/5`);
		console.log(`   Completeness:  ${summary.usageMetrics.averageCompleteness.toFixed(2)}/5`);
		console.log(`   Conciseness:   ${summary.usageMetrics.averageConciseness.toFixed(2)}/5`);
		console.log(`   ─────────────────────────────`);
		console.log(`   Average:       ${summary.usageMetrics.averageOverall.toFixed(2)}/5`);
	} else {
		console.log(`\n💬 CLAIM USAGE`);
		console.log(`   (Skipped - deterministic only mode)`);
	}

	// Failure Breakdown
	if (summary.failed > 0) {
		console.log(`\n❌ FAILURE BREAKDOWN`);
		console.log(`   Claim Correctness:  ${summary.failureBreakdown.claimCorrectnessFailures}`);
		console.log(`   Claim Grounding:    ${summary.failureBreakdown.claimGroundingFailures}`);
		console.log(`   Claim Usage:        ${summary.failureBreakdown.claimUsageFailures}`);
	}

	console.log("\n" + "═".repeat(70));
	console.log("Key: Correctness = right claims | Grounding = supported claims | Usage = well-used claims");
	console.log("═".repeat(70));
}

// ============================================================================
// Helpers
// ============================================================================

function avg(numbers: number[]): number {
	if (numbers.length === 0) return 0;
	return numbers.reduce((s, n) => s + n, 0) / numbers.length;
}

function sum(numbers: number[]): number {
	return numbers.reduce((s, n) => s + n, 0);
}

function createEmptySummary(): EvaluationSummary {
	return {
		total: 0,
		passed: 0,
		failed: 0,
		accuracy: 0,
		claimMetrics: {
			averageRecall: 0,
			averagePrecision: 0,
			averageF1: 0,
			totalUnsupportedClaims: 0,
			totalStalenessViolations: 0,
			totalMissingClaims: 0,
			totalFalseClaims: 0,
		},
		failureBreakdown: {
			claimCorrectnessFailures: 0,
			claimGroundingFailures: 0,
			claimUsageFailures: 0,
		},
	};
}
