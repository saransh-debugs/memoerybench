/**
 * Claim-Level Deterministic Metrics
 * 
 * These metrics evaluate claim correctness and grounding WITHOUT any LLM.
 * They catch:
 * - Missing claims (recall)
 * - False claims (precision)
 * - Unsupported claims (hallucinations)
 * - Staleness violations (outdated memory)
 * 
 * Key insight: Retrieval correctness is necessary but not sufficient.
 * Hallucinations are caught deterministically at the claim level.
 */

import type {
	Claim,
	ClaimGraph,
	ClaimMetrics,
	GoldClaim,
	GoldClaimStore,
	GoldSupport,
} from "./types";

// ============================================================================
// CLAIM MATCHING
// ============================================================================

/**
 * Normalize a claim statement for comparison.
 */
function normalizeStatement(statement: string): string {
	return statement
		.toLowerCase()
		.replace(/[^\w\s]/g, "") // Remove punctuation
		.replace(/\s+/g, " ")    // Normalize whitespace
		.trim();
}

/**
 * Calculate similarity between two claim statements.
 * Uses token overlap (Jaccard similarity) for simplicity.
 * Could be replaced with embedding similarity for more sophistication.
 */
function claimSimilarity(a: string, b: string): number {
	const tokensA = new Set(normalizeStatement(a).split(" "));
	const tokensB = new Set(normalizeStatement(b).split(" "));
	
	if (tokensA.size === 0 && tokensB.size === 0) return 1;
	if (tokensA.size === 0 || tokensB.size === 0) return 0;
	
	let intersection = 0;
	for (const token of tokensA) {
		if (tokensB.has(token)) intersection++;
	}
	
	const union = tokensA.size + tokensB.size - intersection;
	return intersection / union;
}

/**
 * Check if a produced claim matches a gold claim.
 */
function claimsMatch(
	produced: Claim,
	gold: GoldClaim,
	threshold: number = 0.6,
): boolean {
	return claimSimilarity(produced.statement, gold.statement) >= threshold;
}

/**
 * Find the best matching gold claim for a produced claim.
 */
function findMatchingGoldClaim(
	produced: Claim,
	goldClaims: GoldClaim[],
	threshold: number = 0.6,
): GoldClaim | null {
	let bestMatch: GoldClaim | null = null;
	let bestScore = threshold;
	
	for (const gold of goldClaims) {
		const score = claimSimilarity(produced.statement, gold.statement);
		if (score >= bestScore) {
			bestScore = score;
			bestMatch = gold;
		}
	}
	
	return bestMatch;
}

// ============================================================================
// CLAIM RECALL & PRECISION
// ============================================================================

/**
 * Calculate Claim Recall: % of gold claims present in produced claims.
 * 
 * High recall = We remembered the right things.
 * Low recall = We missed important information.
 */
export function calculateClaimRecall(
	producedClaims: Claim[],
	goldClaims: GoldClaim[],
	threshold: number = 0.6,
): { recall: number; matched: string[]; missed: string[] } {
	if (goldClaims.length === 0) {
		return { recall: 1, matched: [], missed: [] };
	}
	
	const matched: string[] = [];
	const missed: string[] = [];
	
	for (const gold of goldClaims) {
		const hasMatch = producedClaims.some((p) => claimsMatch(p, gold, threshold));
		if (hasMatch) {
			matched.push(gold.statement);
		} else {
			missed.push(gold.statement);
		}
	}
	
	return {
		recall: matched.length / goldClaims.length,
		matched,
		missed,
	};
}

/**
 * Calculate Claim Precision: % of produced claims that match gold claims.
 * 
 * High precision = We didn't make false claims.
 * Low precision = We hallucinated or made incorrect assertions.
 */
export function calculateClaimPrecision(
	producedClaims: Claim[],
	goldClaims: GoldClaim[],
	threshold: number = 0.6,
): { precision: number; valid: string[]; invalid: string[] } {
	if (producedClaims.length === 0) {
		return { precision: 1, valid: [], invalid: [] };
	}
	
	const valid: string[] = [];
	const invalid: string[] = [];
	
	for (const produced of producedClaims) {
		const matchingGold = findMatchingGoldClaim(produced, goldClaims, threshold);
		if (matchingGold) {
			valid.push(produced.statement);
		} else {
			invalid.push(produced.statement);
		}
	}
	
	return {
		precision: valid.length / producedClaims.length,
		valid,
		invalid,
	};
}

// ============================================================================
// CLAIM GROUNDING (Support Validation)
// ============================================================================

/**
 * Check if a claim has valid support in the produced claim graph.
 * A claim is unsupported if it references no supports or non-existent supports.
 */
export function findUnsupportedClaims(
	claimGraph: ClaimGraph,
): { unsupported: Claim[]; statements: string[] } {
	const supportIds = new Set(claimGraph.supports.map((s) => s.eventId));
	const unsupported: Claim[] = [];
	
	for (const claim of claimGraph.claims) {
		// Claim has no supports listed
		if (claim.supportIds.length === 0) {
			unsupported.push(claim);
			continue;
		}
		
		// Check if all listed supports actually exist
		const hasValidSupport = claim.supportIds.some((id) => supportIds.has(id));
		if (!hasValidSupport) {
			unsupported.push(claim);
		}
	}
	
	return {
		unsupported,
		statements: unsupported.map((c) => c.statement),
	};
}

/**
 * Check for staleness violations: claims supported by outdated events.
 * 
 * A staleness violation occurs when:
 * 1. A claim is supported by an event that has been superseded
 * 2. The newer event would change the claim's validity
 */
export function findStalenessViolations(
	producedClaims: Claim[],
	goldSupports: GoldSupport[],
): { violations: Claim[]; statements: string[] } {
	// Build map of superseded events
	const supersededEvents = new Map<string, string>();
	const currentEvents = new Set<string>();
	
	for (const support of goldSupports) {
		if (support.isCurrent) {
			currentEvents.add(support.eventId);
		} else if (support.supersededBy) {
			supersededEvents.set(support.eventId, support.supersededBy);
		}
	}
	
	const violations: Claim[] = [];
	
	for (const claim of producedClaims) {
		for (const supportId of claim.supportIds) {
			// Check if this support has been superseded
			if (supersededEvents.has(supportId)) {
				violations.push(claim);
				break;
			}
		}
	}
	
	return {
		violations,
		statements: violations.map((c) => c.statement),
	};
}

// ============================================================================
// MAIN CLAIM METRICS FUNCTION
// ============================================================================

/**
 * Calculate all claim-level deterministic metrics.
 */
export function calculateClaimMetrics(
	produced: ClaimGraph,
	gold: GoldClaimStore,
	threshold: number = 0.6,
): ClaimMetrics {
	const producedClaims = produced.claims;
	const goldClaims = gold.goldClaims;
	const goldSupports = gold.goldSupports;
	
	// Calculate recall and precision
	const recallResult = calculateClaimRecall(producedClaims, goldClaims, threshold);
	const precisionResult = calculateClaimPrecision(producedClaims, goldClaims, threshold);
	
	// Calculate F1
	const claimF1 = recallResult.recall + precisionResult.precision > 0
		? (2 * recallResult.recall * precisionResult.precision) / 
		  (recallResult.recall + precisionResult.precision)
		: 0;
	
	// Find unsupported claims (potential hallucinations)
	const unsupportedResult = findUnsupportedClaims(produced);
	
	// Find staleness violations
	const stalenessResult = findStalenessViolations(producedClaims, goldSupports);
	
	return {
		claimRecall: recallResult.recall,
		claimPrecision: precisionResult.precision,
		claimF1,
		unsupportedClaims: unsupportedResult.unsupported.length,
		stalenessViolations: stalenessResult.violations.length,
		missingClaims: recallResult.missed.length,
		falseClaims: precisionResult.invalid.length,
		details: {
			matchedGoldClaims: recallResult.matched,
			missedGoldClaims: recallResult.missed,
			falseClaimStatements: precisionResult.invalid,
			unsupportedClaimStatements: unsupportedResult.statements,
			staleClaimStatements: stalenessResult.statements,
		},
	};
}

// ============================================================================
// UTILITY: Convert Evidence References to Gold Store
// ============================================================================

/**
 * Convert LoCoMo-style evidence references to GoldClaimStore.
 * This bridges the gap between existing benchmark formats and claim-centric evaluation.
 */
export function evidenceToGoldStore(
	questionId: string,
	question: string,
	goldAnswer: string | number,
	evidenceRefs: string[],
	sessionContentMap?: Map<string, string[]>,
): GoldClaimStore {
	// Create gold supports from evidence references
	const goldSupports: GoldSupport[] = [];
	
	for (const ref of evidenceRefs) {
		const match = ref.match(/^D(\d+):(\d+)$/);
		if (match) {
			const sessionNum = match[1];
			const lineNum = parseInt(match[2]!, 10);
			const sessionKey = `D${sessionNum}`;
			
			let content = `Evidence from ${ref}`;
			if (sessionContentMap) {
				const sessionLines = sessionContentMap.get(sessionKey);
				if (sessionLines && sessionLines[lineNum - 1]) {
					content = sessionLines[lineNum - 1]!;
				}
			}
			
			goldSupports.push({
				eventId: ref,
				content,
				isCurrent: true, // Assume current unless specified otherwise
			});
		}
	}
	
	// Create a single gold claim from the answer
	// In a more sophisticated setup, answers would be decomposed into atomic claims
	const goldClaims: GoldClaim[] = [{
		statement: String(goldAnswer),
		expectedSupportIds: evidenceRefs,
		required: true,
	}];
	
	return {
		questionId,
		question,
		goldClaims,
		goldSupports,
		referenceAnswer: goldAnswer,
	};
}
