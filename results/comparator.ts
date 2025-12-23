/**
 * Results Comparator
 *
 * Compare two benchmark runs to detect regressions and improvements.
 */

import type { RunResult, ComparisonResult, Metrics, StatisticalTest } from "./schema";
import { proportionZTest, twoSampleTTest } from "../runner/statistics";
export interface CompareOptions {
	/** Threshold for regression detection (default: 0.05 = 5%) */
	regressionThreshold?: number;
	/** Threshold for improvement detection (default: 0.05 = 5%) */
	improvementThreshold?: number;
	/** Compare only matching benchmark×provider pairs */
	matchOnly?: boolean;
}

export interface ComparisonDetail {
	benchmark: string;
	provider: string;
	baseline: Metrics | null;
	current: Metrics | null;
	delta: {
		accuracy: number;
		avgScore: number;
		avgLatencyMs: number;
	};
	regression: boolean;
	improvement: boolean;
	statisticalTests?: {
		accuracyTest?: StatisticalTest;
		scoreTest?: StatisticalTest;
		latencyTest?: StatisticalTest;
	};
}

// =============================================================================
// Compare Functions
// =============================================================================

/**
 * Compare two runs and generate a comparison report
 */
export function compareRuns(
	baseline: RunResult,
	current: RunResult,
	options: CompareOptions = {},
): ComparisonResult {
	const {
		regressionThreshold = 0.05,
		improvementThreshold = 0.05,
		matchOnly = false,
	} = options;

	// Build lookup maps (include both metrics and test cases for statistical tests)
	const baselineMap = new Map<string, { metrics: Metrics; testCases: any[] }>();
	const currentMap = new Map<string, { metrics: Metrics; testCases: any[] }>();

	for (const r of baseline.results) {
		baselineMap.set(key(r.benchmark, r.provider), {
			metrics: r.metrics,
			testCases: r.testCases,
		});
	}

	for (const r of current.results) {
		currentMap.set(key(r.benchmark, r.provider), {
			metrics: r.metrics,
			testCases: r.testCases,
		});
	}

	// Get all unique combinations
	const allKeys = new Set<string>();
	if (matchOnly) {
		// Only include pairs that exist in both
		for (const k of baselineMap.keys()) {
			if (currentMap.has(k)) {
				allKeys.add(k);
			}
		}
	} else {
		// Include all pairs from both
		for (const k of baselineMap.keys()) allKeys.add(k);
		for (const k of currentMap.keys()) allKeys.add(k);
	}

	// Compare each pair
	const comparisons: ComparisonDetail[] = [];
	let regressions = 0;
	let improvements = 0;
	let unchanged = 0;

	for (const k of allKeys) {
		const [benchmark, provider] = k.split("::");
		const baselineData = baselineMap.get(k) ?? null;
		const currentData = currentMap.get(k) ?? null;

		const detail = compareMetrics(
			benchmark!,
			provider!,
			baselineData?.metrics ?? null,
			currentData?.metrics ?? null,
			baselineData?.testCases ?? null,
			currentData?.testCases ?? null,
			regressionThreshold,
			improvementThreshold,
		);

		comparisons.push(detail);

		if (detail.regression) {
			regressions++;
		} else if (detail.improvement) {
			improvements++;
		} else {
			unchanged++;
		}
	}

	// Sort by benchmark, then provider
	comparisons.sort((a, b) => {
		const benchmarkCmp = a.benchmark.localeCompare(b.benchmark);
		if (benchmarkCmp !== 0) return benchmarkCmp;
		return a.provider.localeCompare(b.provider);
	});

	// Calculate overall accuracy delta
	const baselineAccuracy = baseline.summary.overallAccuracy;
	const currentAccuracy = current.summary.overallAccuracy;
	const overallAccuracyDelta = currentAccuracy - baselineAccuracy;

	return {
		baseline: {
			runId: baseline.metadata.runId,
			completedAt: baseline.metadata.completedAt,
		},
		current: {
			runId: current.metadata.runId,
			completedAt: current.metadata.completedAt,
		},
		comparisons,
		summary: {
			totalComparisons: comparisons.length,
			regressions,
			improvements,
			unchanged,
			overallAccuracyDelta,
		},
	};
}

/**
 * Compare metrics for a single benchmark×provider pair
 */
function compareMetrics(
	benchmark: string,
	provider: string,
	baseline: Metrics | null,
	current: Metrics | null,
	baselineTestCases: any[] | null,
	currentTestCases: any[] | null,
	regressionThreshold: number,
	improvementThreshold: number,
): ComparisonDetail {
	// Handle missing data
	if (!baseline && !current) {
		return {
			benchmark,
			provider,
			baseline: null,
			current: null,
			delta: { accuracy: 0, avgScore: 0, avgLatencyMs: 0 },
			regression: false,
			improvement: false,
		};
	}

	if (!baseline) {
		// New benchmark×provider (no baseline to compare)
		return {
			benchmark,
			provider,
			baseline: null,
			current,
			delta: {
				accuracy: current!.accuracy,
				avgScore: current!.avgScore,
				avgLatencyMs: current!.avgLatencyMs,
			},
			regression: false,
			improvement: true, // New is considered improvement
		};
	}

	if (!current) {
		// Removed benchmark×provider
		return {
			benchmark,
			provider,
			baseline,
			current: null,
			delta: {
				accuracy: -baseline.accuracy,
				avgScore: -baseline.avgScore,
				avgLatencyMs: -baseline.avgLatencyMs,
			},
			regression: true, // Missing is considered regression
			improvement: false,
		};
	}

	// Calculate deltas
	const accuracyDelta = current.accuracy - baseline.accuracy;
	const scoreDelta = current.avgScore - baseline.avgScore;
	const latencyDelta = current.avgLatencyMs - baseline.avgLatencyMs;

	// Perform statistical significance tests
	let statisticalTests: ComparisonDetail["statisticalTests"] = undefined;
	
	if (baselineTestCases && currentTestCases && baselineTestCases.length > 0 && currentTestCases.length > 0) {
		// Extract raw values from test cases
		const baselinePassed = baselineTestCases.filter((tc) => tc.evaluation?.passed).length;
		const currentPassed = currentTestCases.filter((tc) => tc.evaluation?.passed).length;
		
		const baselineScores = baselineTestCases.map((tc) => tc.evaluation?.score ?? 0);
		const currentScores = currentTestCases.map((tc) => tc.evaluation?.score ?? 0);
		
		const baselineLatencies = baselineTestCases.map((tc) => tc.latencyMs ?? 0);
		const currentLatencies = currentTestCases.map((tc) => tc.latencyMs ?? 0);

		// Accuracy test (proportion z-test)
		const accuracyTest = proportionZTest(
			baselinePassed,
			baselineTestCases.length,
			currentPassed,
			currentTestCases.length,
		);

		// Score test (two-sample t-test)
		const scoreTest = twoSampleTTest(baselineScores, currentScores);

		// Latency test (two-sample t-test)
		const latencyTest = twoSampleTTest(baselineLatencies, currentLatencies);

		statisticalTests = {
			accuracyTest: {
				pValue: accuracyTest.pValue,
				significant: accuracyTest.significant,
				effectSize: accuracyTest.effectSize,
				testStatistic: accuracyTest.statistic,
			},
			scoreTest: {
				pValue: scoreTest.pValue,
				significant: scoreTest.significant,
				effectSize: scoreTest.effectSize,
				testStatistic: scoreTest.statistic,
			},
			latencyTest: {
				pValue: latencyTest.pValue,
				significant: latencyTest.significant,
				effectSize: latencyTest.effectSize,
				testStatistic: latencyTest.statistic,
			},
		};
	}

	// Determine regression/improvement using statistical significance
	// Only flag as regression if statistically significant (p < 0.05) AND delta exceeds threshold
	let regression = false;
	let improvement = false;
	
	if (statisticalTests?.accuracyTest) {
		// Use statistical significance for regression detection
		regression = statisticalTests.accuracyTest.significant && accuracyDelta < -regressionThreshold;
		improvement = statisticalTests.accuracyTest.significant && accuracyDelta > improvementThreshold;
	} else {
		// Fallback to simple threshold-based detection
		regression = accuracyDelta < -regressionThreshold;
		improvement = accuracyDelta > improvementThreshold;
	}

	return {
		benchmark,
		provider,
		baseline,
		current,
		delta: {
			accuracy: accuracyDelta,
			avgScore: scoreDelta,
			avgLatencyMs: latencyDelta,
		},
		regression,
		improvement,
		statisticalTests,
	};
}

// =============================================================================
// Output Formatters
// =============================================================================

/**
 * Format comparison as CLI output
 */
export function formatComparisonCLI(comparison: ComparisonResult): string {
	const lines: string[] = [
		"",
		"═".repeat(70),
		"                    MEMORYBENCH COMPARISON",
		"═".repeat(70),
		"",
		`Baseline: ${comparison.baseline.runId}`,
		`Current:  ${comparison.current.runId}`,
		"",
	];

	// Summary
	const { summary } = comparison;
	const arrow = summary.overallAccuracyDelta >= 0 ? "↑" : "↓";
	const deltaStr = `${(summary.overallAccuracyDelta * 100).toFixed(1)}%`;
	const deltaColor = summary.overallAccuracyDelta >= 0 ? "✅" : "⚠️";

	lines.push(`Overall Accuracy Delta: ${deltaColor} ${arrow} ${deltaStr}`);
	lines.push("");
	lines.push(`Comparisons: ${summary.totalComparisons}`);
	lines.push(`  ✅ Improvements: ${summary.improvements}`);
	lines.push(`  ⚠️  Regressions: ${summary.regressions}`);
	lines.push(`  ➖ Unchanged: ${summary.unchanged}`);
	lines.push("");

	// Detailed table with p-values
	lines.push("┌─────────────────────┬─────────────────────┬──────────────┬──────────────┬────────┬──────────┐");
	lines.push("│ Benchmark           │ Provider            │ Baseline     │ Current      │ Delta  │ p-value  │");
	lines.push("├─────────────────────┼─────────────────────┼──────────────┼──────────────┼────────┼──────────┤");

	for (const c of comparison.comparisons) {
		const benchmark = c.benchmark.padEnd(19).substring(0, 19);
		const provider = c.provider.padEnd(19).substring(0, 19);

		const baselineStr = c.baseline
			? `${(c.baseline.accuracy * 100).toFixed(1)}%`.padStart(11)
			: "     N/A   ";

		const currentStr = c.current
			? `${(c.current.accuracy * 100).toFixed(1)}%`.padStart(11)
			: "     N/A   ";

		const deltaVal = c.delta.accuracy * 100;
		const deltaSign = deltaVal >= 0 ? "+" : "";
		let deltaStr = `${deltaSign}${deltaVal.toFixed(1)}%`.padStart(6);

		// Format p-value
		let pValueStr = "   N/A   ";
		if (c.statisticalTests?.accuracyTest) {
			const pValue = c.statisticalTests.accuracyTest.pValue;
			if (pValue < 0.001) {
				pValueStr = "< 0.001".padStart(8);
			} else {
				pValueStr = pValue.toFixed(3).padStart(8);
			}
			
			// Add significance indicator
			if (c.statisticalTests.accuracyTest.significant) {
				pValueStr = `${pValueStr} *`;
			} else {
				pValueStr = `${pValueStr}  `;
			}
		} else {
			pValueStr = "   N/A    ";
		}

		// Add indicator
		if (c.regression) {
			deltaStr = `⚠️${deltaStr}`;
		} else if (c.improvement) {
			deltaStr = `✅${deltaStr}`;
		} else {
			deltaStr = `  ${deltaStr}`;
		}

		lines.push(`│ ${benchmark} │ ${provider} │ ${baselineStr} │ ${currentStr} │${deltaStr}│${pValueStr}│`);
	}

	lines.push("└─────────────────────┴─────────────────────┴──────────────┴──────────────┴────────┴──────────┘");
	lines.push("");

	// Regressions detail with statistical significance
	const significantRegressions = comparison.comparisons.filter(
		(c) => c.regression && c.statisticalTests?.accuracyTest?.significant
	);
	const nonSignificantChanges = comparison.comparisons.filter(
		(c) => c.delta.accuracy < 0 && !c.regression && c.statisticalTests?.accuracyTest
	);
	
	if (significantRegressions.length > 0) {
		lines.push("⚠️  SIGNIFICANT REGRESSIONS (p < 0.05):");
		for (const r of significantRegressions) {
			const delta = (r.delta.accuracy * 100).toFixed(1);
			const pValue = r.statisticalTests?.accuracyTest?.pValue;
			const pValueStr = pValue !== undefined 
				? (pValue < 0.001 ? "p < 0.001" : `p = ${pValue.toFixed(3)}`)
				: "";
			const effectSize = r.statisticalTests?.accuracyTest?.effectSize;
			const effectLabel = effectSize !== undefined && Math.abs(effectSize) > 0.5 ? " (large effect)" : "";
			lines.push(`   • ${r.benchmark} × ${r.provider}: ${delta}% (${pValueStr}${effectLabel})`);
		}
		lines.push("");
	}
	
	if (nonSignificantChanges.length > 0) {
		lines.push("ℹ️  Non-significant changes (likely noise):");
		for (const r of nonSignificantChanges) {
			const delta = (r.delta.accuracy * 100).toFixed(1);
			const pValue = r.statisticalTests?.accuracyTest?.pValue;
			const pValueStr = pValue !== undefined ? `p = ${pValue.toFixed(3)}` : "";
			lines.push(`   • ${r.benchmark} × ${r.provider}: ${delta}% (${pValueStr})`);
		}
		lines.push("");
	}

	lines.push("═".repeat(70));

	return lines.join("\n");
}

/**
 * Format comparison as Markdown (for PR comments)
 */
export function formatComparisonMarkdown(comparison: ComparisonResult): string {
	const lines: string[] = [
		"## 📊 MemoryBench Results",
		"",
		`**Baseline:** \`${comparison.baseline.runId}\``,
		`**Current:** \`${comparison.current.runId}\``,
		"",
	];

	// Summary table
	const { summary } = comparison;
	const deltaVal = summary.overallAccuracyDelta * 100;
	const deltaSign = deltaVal >= 0 ? "+" : "";
	const deltaIcon = deltaVal >= 0 ? "✅" : "⚠️";

	lines.push("| Metric | Value |");
	lines.push("|--------|-------|");
	lines.push(`| Overall Accuracy Change | ${deltaIcon} ${deltaSign}${deltaVal.toFixed(1)}% |`);
	lines.push(`| Improvements | ${summary.improvements} |`);
	lines.push(`| Regressions | ${summary.regressions} |`);
	lines.push(`| Unchanged | ${summary.unchanged} |`);
	lines.push("");

	// Detailed table with p-values
	lines.push("### Detailed Results");
	lines.push("");
	lines.push("| Benchmark | Provider | Baseline | Current | Delta | p-value |");
	lines.push("|-----------|----------|----------|---------|-------|---------|");

	for (const c of comparison.comparisons) {
		const baselineStr = c.baseline ? `${(c.baseline.accuracy * 100).toFixed(1)}%` : "N/A";
		const currentStr = c.current ? `${(c.current.accuracy * 100).toFixed(1)}%` : "N/A";
		const delta = c.delta.accuracy * 100;
		const sign = delta >= 0 ? "+" : "";
		const icon = c.regression ? "⚠️" : c.improvement ? "✅" : "";
		
		let pValueStr = "N/A";
		if (c.statisticalTests?.accuracyTest) {
			const pValue = c.statisticalTests.accuracyTest.pValue;
			pValueStr = pValue < 0.001 ? "< 0.001" : pValue.toFixed(3);
			if (c.statisticalTests.accuracyTest.significant) {
				pValueStr += " *";
			}
		}
		
		lines.push(
			`| ${c.benchmark} | ${c.provider} | ${baselineStr} | ${currentStr} | ${icon} ${sign}${delta.toFixed(1)}% | ${pValueStr} |`,
		);
	}

	// Regressions detail with statistical significance
	lines.push("");
	lines.push("---");
	lines.push("");
	
	const significantRegressions = comparison.comparisons.filter(
		(c) => c.regression && c.statisticalTests?.accuracyTest?.significant
	);
	const nonSignificantChanges = comparison.comparisons.filter(
		(c) => c.delta.accuracy < 0 && !c.regression && c.statisticalTests?.accuracyTest
	);
	
	if (significantRegressions.length > 0) {
		lines.push("### ⚠️ Significant Regressions (p < 0.05)");
		lines.push("");
		for (const r of significantRegressions) {
			const delta = (r.delta.accuracy * 100).toFixed(1);
			const pValue = r.statisticalTests?.accuracyTest?.pValue;
			const pValueStr = pValue !== undefined 
				? (pValue < 0.001 ? "p < 0.001" : `p = ${pValue.toFixed(3)}`)
				: "";
			const effectSize = r.statisticalTests?.accuracyTest?.effectSize;
			const effectLabel = effectSize !== undefined && Math.abs(effectSize) > 0.5 ? " (large effect)" : "";
			lines.push(`- **${r.benchmark} × ${r.provider}**: ${delta}% drop (${pValueStr}${effectLabel})`);
		}
		lines.push("");
	}
	
	if (nonSignificantChanges.length > 0) {
		lines.push("<details>");
		lines.push("<summary>ℹ️ Non-significant changes (likely noise)</summary>");
		lines.push("");
		for (const r of nonSignificantChanges) {
			const delta = (r.delta.accuracy * 100).toFixed(1);
			const pValue = r.statisticalTests?.accuracyTest?.pValue;
			const pValueStr = pValue !== undefined ? `p = ${pValue.toFixed(3)}` : "";
			lines.push(`- **${r.benchmark} × ${r.provider}**: ${delta}% (${pValueStr})`);
		}
		lines.push("");
		lines.push("</details>");
	}

	return lines.join("\n");
}

// =============================================================================
// Helpers
// =============================================================================

function key(benchmark: string, provider: string): string {
	return `${benchmark}::${provider}`;
}

/**
 * Check if comparison has any regressions
 */
export function hasRegressions(comparison: ComparisonResult): boolean {
	return comparison.summary.regressions > 0;
}

/**
 * Get list of regressed benchmark×provider pairs
 */
export function getRegressedPairs(
	comparison: ComparisonResult,
): Array<{ benchmark: string; provider: string; delta: number }> {
	return comparison.comparisons
		.filter((c) => c.regression)
		.map((c) => ({
			benchmark: c.benchmark,
			provider: c.provider,
			delta: c.delta.accuracy,
		}));
}

