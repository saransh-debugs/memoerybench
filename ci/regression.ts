/**
 * CI Regression Detection
 *
 * Compare current benchmark results against a baseline.
 * Exit with code 1 if regression detected.
 */

import { existsSync } from "node:fs";
import { run } from "../runner/index";
import { readResults, writeResults, writeComparison } from "../results/writer";
import {
	compareRuns,
	formatComparisonCLI,
	formatComparisonMarkdown,
	hasRegressions,
	getRegressedPairs,
} from "../results/comparator";
import type { RunResult, ComparisonResult } from "../results/schema";
import { detectConfig, isCI, getGitInfo } from "../runner/defaults";

// =============================================================================
// Types
// =============================================================================

export interface CIOptions {
	/** Path to baseline results file */
	baseline: string;
	/** Regression threshold (percentage, default: 5) */
	threshold: number;
	/** Benchmarks to run */
	benchmarks?: string[];
	/** Providers to test */
	providers?: string[];
	/** Output directory */
	outputDir?: string;
	/** Generate markdown report */
	markdown?: boolean;
	/** Fail on any regression */
	strict?: boolean;
}

export interface CIResult {
	/** Did the CI check pass? */
	passed: boolean;
	/** Comparison result */
	comparison: ComparisonResult;
	/** Current run result */
	current: RunResult;
	/** Baseline run result */
	baseline: RunResult;
	/** Path to saved current results */
	resultsPath?: string;
	/** Path to saved comparison */
	comparisonPath?: string;
}

// =============================================================================
// Main CI Function
// =============================================================================

/**
 * Run CI mode with regression detection
 */
export async function runCI(options: CIOptions): Promise<boolean> {
	const startTime = Date.now();

	console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                      MEMORYBENCH CI                                ║
╚═══════════════════════════════════════════════════════════════════╝
`);

	// Validate baseline
	if (!options.baseline) {
		console.error("❌ Error: --baseline is required for CI mode");
		return false;
	}

	if (!existsSync(options.baseline)) {
		console.error(`❌ Error: Baseline file not found: ${options.baseline}`);
		return false;
	}

	// Load baseline
	console.log(`📂 Loading baseline: ${options.baseline}`);
	let baseline: RunResult;
	try {
		baseline = await readResults(options.baseline);
		console.log(`   Run ID: ${baseline.metadata.runId}`);
		console.log(`   Date: ${baseline.metadata.completedAt}`);
		console.log(`   Accuracy: ${(baseline.summary.overallAccuracy * 100).toFixed(1)}%`);
	} catch (error) {
		console.error(`❌ Error loading baseline:`, error);
		return false;
	}

	// Detect configuration
	const config = await detectConfig({
		providers: options.providers,
		benchmarks: options.benchmarks,
	});

	console.log(`\n📋 Running benchmarks:`);
	console.log(`   Providers: ${config.providers.join(", ")}`);
	console.log(`   Benchmarks: ${config.benchmarks.join(", ")}`);

	// Get git info for metadata
	const gitInfo = await getGitInfo();

	// Run current benchmarks
	console.log(`\n🚀 Running current benchmarks...\n`);

	const current = await run({
		providers: config.providers,
		benchmarks: config.benchmarks,
		verbose: false,
		checkpoint: true,
	});

	// Add git info to metadata if available
	if (gitInfo) {
		(current.metadata as Record<string, unknown>).gitCommit = gitInfo.commit;
		(current.metadata as Record<string, unknown>).gitBranch = gitInfo.branch;
	}

	// Compare results
	console.log(`\n📊 Comparing against baseline...`);

	const comparison = compareRuns(baseline, current, {
		regressionThreshold: options.threshold / 100,
		improvementThreshold: options.threshold / 100,
		matchOnly: true,
	});

	// Print comparison
	console.log(formatComparisonCLI(comparison));

	// Save results
	const outputDir = options.outputDir ?? "results";
	const resultsPath = `${outputDir}/${current.metadata.runId}.json`;
	const comparisonPath = `${outputDir}/${current.metadata.runId}-comparison.json`;

	await writeResults(current, resultsPath);
	await writeComparison(comparison, comparisonPath);

	console.log(`\n💾 Results saved:`);
	console.log(`   Current: ${resultsPath}`);
	console.log(`   Comparison: ${comparisonPath}`);

	// Generate markdown if requested or in CI
	if (options.markdown || isCI()) {
		const markdownPath = `${outputDir}/${current.metadata.runId}-report.md`;
		const markdown = formatComparisonMarkdown(comparison);
		await Bun.write(markdownPath, markdown);
		console.log(`   Markdown: ${markdownPath}`);

		// Output for GitHub Actions
		if (process.env.GITHUB_STEP_SUMMARY) {
			await Bun.write(process.env.GITHUB_STEP_SUMMARY, markdown);
			console.log(`   GitHub Summary: Updated`);
		}
	}

	// Determine pass/fail
	const hasRegression = hasRegressions(comparison);
	const duration = ((Date.now() - startTime) / 1000).toFixed(1);

	console.log(`\n${"═".repeat(70)}`);

	if (hasRegression) {
		const regressed = getRegressedPairs(comparison);
		console.log(`\n⚠️  REGRESSIONS DETECTED (${regressed.length})`);
		console.log(`\n   The following benchmark×provider pairs regressed:`);
		for (const r of regressed) {
			const delta = (r.delta * 100).toFixed(1);
			console.log(`   • ${r.benchmark} × ${r.provider}: ${delta}% accuracy drop`);
		}
		console.log(`\n   Duration: ${duration}s`);
		console.log(`   Exit code: 1\n`);
		return false;
	}

	console.log(`\n✅ NO REGRESSIONS`);
	console.log(`   Overall accuracy change: ${comparison.summary.overallAccuracyDelta >= 0 ? "+" : ""}${(comparison.summary.overallAccuracyDelta * 100).toFixed(1)}%`);
	console.log(`   Duration: ${duration}s`);
	console.log(`   Exit code: 0\n`);
	return true;
}

// =============================================================================
// Baseline Management
// =============================================================================

/**
 * Create a new baseline from current results
 */
export async function createBaseline(
	options: {
		providers?: string[];
		benchmarks?: string[];
		outputPath?: string;
	} = {},
): Promise<string> {
	console.log(`\n📊 Creating new baseline...\n`);

	const config = await detectConfig({
		providers: options.providers,
		benchmarks: options.benchmarks,
	});

	const result = await run({
		providers: config.providers,
		benchmarks: config.benchmarks,
		verbose: false,
		checkpoint: true,
	});

	const outputPath = options.outputPath ?? `results/baseline.json`;
	await writeResults(result, outputPath);

	console.log(`\n✅ Baseline created: ${outputPath}`);
	console.log(`   Accuracy: ${(result.summary.overallAccuracy * 100).toFixed(1)}%`);
	console.log(`   Test cases: ${result.summary.totalTestCases}`);

	return outputPath;
}

/**
 * Update baseline from an existing results file
 */
export async function updateBaseline(
	sourcePath: string,
	baselinePath: string = "results/baseline.json",
): Promise<void> {
	if (!existsSync(sourcePath)) {
		throw new Error(`Source file not found: ${sourcePath}`);
	}

	const result = await readResults(sourcePath);
	await writeResults(result, baselinePath, { versioned: true });

	console.log(`✅ Baseline updated: ${baselinePath}`);
	console.log(`   From: ${sourcePath}`);
	console.log(`   Run ID: ${result.metadata.runId}`);
}

// =============================================================================
// GitHub Actions Helpers
// =============================================================================

/**
 * Set GitHub Actions output
 */
export function setGitHubOutput(name: string, value: string): void {
	if (process.env.GITHUB_OUTPUT) {
		const output = `${name}=${value}\n`;
		Bun.write(process.env.GITHUB_OUTPUT, output);
	}
}

/**
 * Format comparison for GitHub PR comment
 */
export function formatGitHubComment(comparison: ComparisonResult): string {
	return formatComparisonMarkdown(comparison);
}

// =============================================================================
// Export
// =============================================================================

export default runCI;

