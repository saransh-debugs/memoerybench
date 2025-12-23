/**
 * Results Schema
 *
 * Defines the canonical structure for benchmark results.
 * Uses Zod for runtime validation and type inference.
 */

import { z } from "zod";

// =============================================================================
// Core Schemas
// =============================================================================

/**
 * Search result from a provider
 */
export const SearchResultSchema = z.object({
	id: z.string(),
	content: z.string(),
	score: z.number(),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * Confidence interval for a metric
 */
export const ConfidenceIntervalSchema = z.object({
	lower: z.number(),
	upper: z.number(),
	margin: z.number(),
	width: z.number(),
	confidenceLevel: z.number().default(0.95),
});

export type ConfidenceInterval = z.infer<typeof ConfidenceIntervalSchema>;

/**
 * Sample quality assessment
 */
export const SampleQualitySchema = z.object({
	sufficient: z.boolean(),
	recommendedSampleSize: z.number().optional(),
	qualityScore: z.enum(["excellent", "good", "fair", "poor"]),
});

export type SampleQuality = z.infer<typeof SampleQualitySchema>;

/**
 * Evaluation result for a single test case
 */
export const EvaluationResultSchema = z.object({
	passed: z.boolean(),
	score: z.number().min(0).max(1),
	details: z
		.object({
			foundAnswer: z.string().optional(),
			reason: z.string().optional(),
			matchedResults: z.array(SearchResultSchema).optional(),
		})
		.optional(),
});

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

/**
 * Result for a single test case
 */
export const TestCaseResultSchema = z.object({
	testCaseId: z.string(),
	query: z.string(),
	searchResults: z.array(SearchResultSchema),
	evaluation: EvaluationResultSchema,
	latencyMs: z.number(),
	error: z.string().optional(),
});

export type TestCaseResult = z.infer<typeof TestCaseResultSchema>;

/**
 * Aggregate metrics for a benchmark×provider combination
 */
export const MetricsSchema = z.object({
	total: z.number().int().nonnegative(),
	passed: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
	accuracy: z.number().min(0).max(1),
	avgScore: z.number().min(0).max(1),
	avgLatencyMs: z.number().nonnegative(),
	p50LatencyMs: z.number().nonnegative(),
	p95LatencyMs: z.number().nonnegative(),
	// Statistical analysis fields
	accuracyCI: ConfidenceIntervalSchema.optional(),
	avgScoreCI: ConfidenceIntervalSchema.optional(),
	avgLatencyCI: ConfidenceIntervalSchema.optional(),
	sampleQuality: SampleQualitySchema.optional(),
});

export type Metrics = z.infer<typeof MetricsSchema>;

/**
 * Task type breakdown
 */
export const TaskTypeBreakdownSchema = z.object({
	taskType: z.string(),
	total: z.number().int().nonnegative(),
	passed: z.number().int().nonnegative(),
	accuracy: z.number().min(0).max(1),
	avgScore: z.number().min(0).max(1),
	avgLatencyMs: z.number().nonnegative(),
	// Statistical analysis fields
	accuracyCI: ConfidenceIntervalSchema.optional(),
	avgScoreCI: ConfidenceIntervalSchema.optional(),
	avgLatencyCI: ConfidenceIntervalSchema.optional(),
});

export type TaskTypeBreakdown = z.infer<typeof TaskTypeBreakdownSchema>;

/**
 * Failure analysis
 */
export const FailureAnalysisSchema = z.object({
	taskType: z.string(),
	failureRate: z.number().min(0).max(1),
	totalFailures: z.number().int().nonnegative(),
	commonFailureReasons: z.array(z.string()),
	sampleFailures: z.array(TestCaseResultSchema),
});

export type FailureAnalysis = z.infer<typeof FailureAnalysisSchema>;

/**
 * Result for a single benchmark×provider combination
 */
export const BenchmarkProviderResultSchema = z.object({
	benchmark: z.string(),
	provider: z.string(),
	testCases: z.array(TestCaseResultSchema),
	metrics: MetricsSchema,
	breakdownByTaskType: z.array(TaskTypeBreakdownSchema).optional(),
	failureAnalysis: z.array(FailureAnalysisSchema).optional(),
	startedAt: z.string().datetime(),
	completedAt: z.string().datetime(),
	error: z.object({
		code: z.number(),
		message: z.string(),
		actionable: z.array(z.string()).optional(),
	}).optional(),
});

export type BenchmarkProviderResult = z.infer<typeof BenchmarkProviderResultSchema>;

/**
 * Run metadata
 */
export const RunMetadataSchema = z.object({
	runId: z.string(),
	startedAt: z.string().datetime(),
	completedAt: z.string().datetime(),
	durationMs: z.number().nonnegative(),
	version: z.string(),
	/** Optional: git commit hash */
	gitCommit: z.string().optional(),
	/** Optional: git branch */
	gitBranch: z.string().optional(),
	/** Optional: CI build info */
	ciBuild: z.string().optional(),
	/** Optional: custom tags */
	tags: z.record(z.string(), z.string()).optional(),
});

export type RunMetadata = z.infer<typeof RunMetadataSchema>;

/**
 * Summary across all benchmark×provider combinations
 */
export const RunSummarySchema = z.object({
	totalBenchmarks: z.number().int().nonnegative(),
	totalProviders: z.number().int().nonnegative(),
	totalTestCases: z.number().int().nonnegative(),
	overallAccuracy: z.number().min(0).max(1),
});

export type RunSummary = z.infer<typeof RunSummarySchema>;

/**
 * Complete run result
 */
export const RunResultSchema = z.object({
	metadata: RunMetadataSchema,
	results: z.array(BenchmarkProviderResultSchema),
	summary: RunSummarySchema,
	failureAnalysis: z.array(FailureAnalysisSchema).optional(),
});

export type RunResult = z.infer<typeof RunResultSchema>;

// =============================================================================
// Comparison Schemas
// =============================================================================

/**
 * Statistical test result for comparisons
 */
export const StatisticalTestSchema = z.object({
	pValue: z.number(),
	significant: z.boolean(),
	effectSize: z.number(),
	testStatistic: z.number().optional(),
});

export type StatisticalTest = z.infer<typeof StatisticalTestSchema>;

/**
 * Comparison between two runs (for regression detection)
 */
export const ComparisonResultSchema = z.object({
	baseline: z.object({
		runId: z.string(),
		completedAt: z.string().datetime(),
	}),
	current: z.object({
		runId: z.string(),
		completedAt: z.string().datetime(),
	}),
	comparisons: z.array(
		z.object({
			benchmark: z.string(),
			provider: z.string(),
			baseline: MetricsSchema.nullable(),
			current: MetricsSchema.nullable(),
			delta: z.object({
				accuracy: z.number(),
				avgScore: z.number(),
				avgLatencyMs: z.number(),
			}),
			regression: z.boolean(),
			improvement: z.boolean(),
			// Statistical significance tests
			statisticalTests: z.object({
				accuracyTest: StatisticalTestSchema.optional(),
				scoreTest: StatisticalTestSchema.optional(),
				latencyTest: StatisticalTestSchema.optional(),
			}).optional(),
		}),
	),
	summary: z.object({
		totalComparisons: z.number().int(),
		regressions: z.number().int(),
		improvements: z.number().int(),
		unchanged: z.number().int(),
		overallAccuracyDelta: z.number(),
	}),
});

export type ComparisonResult = z.infer<typeof ComparisonResultSchema>;

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate a run result object
 */
export function validateRunResult(data: unknown): RunResult {
	return RunResultSchema.parse(data);
}

/**
 * Safe validation that returns null on failure
 */
export function safeValidateRunResult(data: unknown): RunResult | null {
	const result = RunResultSchema.safeParse(data);
	return result.success ? result.data : null;
}

/**
 * Validate a comparison result
 */
export function validateComparisonResult(data: unknown): ComparisonResult {
	return ComparisonResultSchema.parse(data);
}

// =============================================================================
// Schema Versions
// =============================================================================

/**
 * Current schema version for backwards compatibility
 */
export const SCHEMA_VERSION = "1.0.0";

/**
 * Versioned result wrapper (for future migrations)
 */
export const VersionedRunResultSchema = z.object({
	schemaVersion: z.string(),
	result: RunResultSchema,
});

export type VersionedRunResult = z.infer<typeof VersionedRunResultSchema>;

/**
 * Wrap a result with version info
 */
export function wrapWithVersion(result: RunResult): VersionedRunResult {
	return {
		schemaVersion: SCHEMA_VERSION,
		result,
	};
}

/**
 * Unwrap a versioned result (with potential migration)
 */
export function unwrapVersioned(data: unknown): RunResult {
	const versioned = VersionedRunResultSchema.safeParse(data);
	if (versioned.success) {
		// Future: handle migrations here based on schemaVersion
		return versioned.data.result;
	}

	// Try parsing as raw RunResult (for backwards compatibility)
	return validateRunResult(data);
}

