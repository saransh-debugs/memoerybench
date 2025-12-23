/**
 * Failure Analysis
 *
 * Utilities for analyzing test failures by task type.
 */

import type { TestCase } from "../benchmarks/types";
import type { TestCaseResult, FailureAnalysis } from "./types";
import { extractTaskType } from "./taxonomy";

/**
 * Generate failure analysis from test results
 */
export function generateFailureAnalysis(
	testCaseResults: TestCaseResult[],
	testCases: TestCase[],
): FailureAnalysis[] {
	if (testCases.length !== testCaseResults.length) {
		// Cannot generate analysis if counts don't match
		return [];
	}

	// Group failures by task type
	const failuresByTaskType = new Map<
		string,
		{ failures: TestCaseResult[]; total: number }
	>();

	for (let i = 0; i < testCaseResults.length; i++) {
		const result = testCaseResults[i]!;
		const testCase = testCases[i];
		if (!testCase) continue;

		const taskType = extractTaskType(testCase);
		const group = failuresByTaskType.get(taskType) || {
			failures: [],
			total: 0,
		};
		group.total++;

		if (!result.evaluation.passed) {
			group.failures.push(result);
		}

		failuresByTaskType.set(taskType, group);
	}

	// Generate analysis for each task type with failures
	const analyses: FailureAnalysis[] = [];

	for (const [taskType, { failures, total }] of failuresByTaskType.entries()) {
		if (failures.length === 0) continue;

		const failureRate = failures.length / total;

		// Extract common failure reasons
		const reasons = failures
			.map((f) => f.evaluation.details?.reason || f.error || "Unknown failure")
			.filter((r) => r !== "Unknown failure");

		// Count reason occurrences
		const reasonCounts = new Map<string, number>();
		for (const reason of reasons) {
			reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
		}

		// Get top 3 most common reasons
		const commonReasons = Array.from(reasonCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([reason]) => reason);

		// Get up to 3 sample failures
		const sampleFailures = failures.slice(0, 3);

		analyses.push({
			taskType,
			failureRate,
			totalFailures: failures.length,
			commonFailureReasons: commonReasons,
			sampleFailures,
		});
	}

	// Sort by failure rate (highest first)
	analyses.sort((a, b) => b.failureRate - a.failureRate);

	return analyses;
}

/**
 * Aggregate failure analysis across multiple results
 */
export function aggregateFailureAnalysis(
	analyses: FailureAnalysis[][],
): FailureAnalysis[] {
	const aggregated = new Map<
		string,
		{
			totalFailures: number;
			totalTests: number;
			reasons: Map<string, number>;
			samples: TestCaseResult[];
		}
	>();

	// Aggregate all analyses
	for (const analysisSet of analyses) {
		for (const analysis of analysisSet) {
			const existing = aggregated.get(analysis.taskType) || {
				totalFailures: 0,
				totalTests: 0,
				reasons: new Map(),
				samples: [],
			};

			existing.totalFailures += analysis.totalFailures;
			existing.totalTests += Math.round(
				analysis.totalFailures / analysis.failureRate,
			);

			// Aggregate reasons
			for (const reason of analysis.commonFailureReasons) {
				existing.reasons.set(reason, (existing.reasons.get(reason) || 0) + 1);
			}

			// Add sample failures (keep up to 5 total)
			if (existing.samples.length < 5) {
				const remaining = 5 - existing.samples.length;
				existing.samples.push(...analysis.sampleFailures.slice(0, remaining));
			}

			aggregated.set(analysis.taskType, existing);
		}
	}

	// Convert to FailureAnalysis array
	const result: FailureAnalysis[] = [];
	for (const [taskType, data] of aggregated.entries()) {
		const failureRate = data.totalTests > 0 ? data.totalFailures / data.totalTests : 0;

		// Get top 3 most common reasons
		const commonReasons = Array.from(data.reasons.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([reason]) => reason);

		result.push({
			taskType,
			failureRate,
			totalFailures: data.totalFailures,
			commonFailureReasons: commonReasons,
			sampleFailures: data.samples.slice(0, 3),
		});
	}

	// Sort by failure rate (highest first)
	result.sort((a, b) => b.failureRate - a.failureRate);

	return result;
}

/**
 * Print failure analysis to console
 */
export function printFailureAnalysis(analyses: FailureAnalysis[]): void {
	if (analyses.length === 0) {
		console.log("  No failures to analyze ✨");
		return;
	}

	console.log(`  ─────────────────────────────────`);
	console.log(`  Failure Analysis by Task Type:`);

	for (const analysis of analyses) {
		console.log(
			`    ${analysis.taskType.padEnd(20)} ${(analysis.failureRate * 100).toFixed(1)}% (${analysis.totalFailures} failures)`,
		);

		if (analysis.commonFailureReasons.length > 0) {
			console.log(`      Common reasons:`);
			for (const reason of analysis.commonFailureReasons) {
				// Truncate long reasons
				const shortReason =
					reason.length > 60 ? reason.substring(0, 57) + "..." : reason;
				console.log(`        • ${shortReason}`);
			}
		}
	}
}

