/**
 * Runner Types
 *
 * Types for the benchmark runner orchestration.
 */

import type { Provider, SearchResult } from "../providers/types";
import type { Benchmark, TestCase, EvaluationResult } from "../benchmarks/types";

// =============================================================================
// Run Configuration
// =============================================================================

export interface RunOptions {
	/** Benchmark names to run (empty = auto-detect) */
	benchmarks: string[];
	/** Provider names to test (empty = auto-detect) */
	providers: string[];
	/** Output file path */
	output?: string;
	/** Show detailed output */
	verbose: boolean;
	/** Force restart (ignore checkpoint) */
	restart?: boolean;
	/** Enable checkpointing for resume */
	checkpoint?: boolean;
	/** Filter by task types (comma-separated) */
	taskTypes?: string[];
	/** Filtering options */
	filters?: {
		queryLength?: { min?: number; max?: number };
		queryContains?: string[];
		queryPattern?: RegExp;
		contextCount?: { min?: number; max?: number };
		contextLength?: { min?: number; max?: number };
	};
	/** Sampling options */
	sampling?: {
		count?: number;
		seed?: number;
		weighted?: {
			field: string;
			weights: { [value: string]: number };
		};
	};
	/** Preset name to use (overrides other options if specified) */
	preset?: string;
}

export interface RunConfig {
	/** Resolved benchmarks to run */
	benchmarks: Benchmark[];
	/** Resolved providers to test */
	providers: Provider[];
	/** Output configuration */
	output: {
		dir: string;
		filename: string;
	};
	/** Runtime options */
	options: {
		verbose: boolean;
		parallel: boolean;
		continueOnError: boolean;
	};
}

// =============================================================================
// Results
// =============================================================================

export interface TestCaseResult {
	/** Test case ID */
	testCaseId: string;
	/** Query that was searched */
	query: string;
	/** Search results from provider */
	searchResults: SearchResult[];
	/** Evaluation result */
	evaluation: EvaluationResult;
	/** Time taken in ms */
	latencyMs: number;
	/** Any error that occurred */
	error?: string;
}

export interface ConfidenceInterval {
	lower: number;
	upper: number;
	margin: number;
	width: number;
	confidenceLevel: number;
}

export interface SampleQuality {
	sufficient: boolean;
	recommendedSampleSize?: number;
	qualityScore: "excellent" | "good" | "fair" | "poor";
}

export interface TaskTypeBreakdown {
	/** Task type name */
	taskType: string;
	/** Total test cases of this type */
	total: number;
	/** Passed test cases */
	passed: number;
	/** Accuracy (passed / total) */
	accuracy: number;
	/** Average score */
	avgScore: number;
	/** Average latency in ms */
	avgLatencyMs: number;
	/** Confidence interval for accuracy */
	accuracyCI?: ConfidenceInterval;
	/** Confidence interval for average score */
	avgScoreCI?: ConfidenceInterval;
	/** Confidence interval for average latency */
	avgLatencyCI?: ConfidenceInterval;
}

export interface FailureAnalysis {
	/** Task type name */
	taskType: string;
	/** Failure rate (0-1) */
	failureRate: number;
	/** Total failures */
	totalFailures: number;
	/** Common failure reasons (extracted from evaluation details) */
	commonFailureReasons: string[];
	/** Sample failed test cases (up to 3) */
	sampleFailures: TestCaseResult[];
}

export interface BenchmarkProviderResult {
	/** Benchmark name */
	benchmark: string;
	/** Provider name */
	provider: string;
	/** Individual test results */
	testCases: TestCaseResult[];
	/** Aggregate metrics */
	metrics: {
		/** Total test cases */
		total: number;
		/** Passed test cases */
		passed: number;
		/** Failed test cases */
		failed: number;
		/** Accuracy (passed / total) */
		accuracy: number;
		/** Average score */
		avgScore: number;
		/** Average latency in ms */
		avgLatencyMs: number;
		/** P50 latency in ms */
		p50LatencyMs: number;
		/** P95 latency in ms */
		p95LatencyMs: number;
		/** Confidence interval for accuracy */
		accuracyCI?: ConfidenceInterval;
		/** Confidence interval for average score */
		avgScoreCI?: ConfidenceInterval;
		/** Confidence interval for average latency */
		avgLatencyCI?: ConfidenceInterval;
		/** Sample quality assessment */
		sampleQuality?: SampleQuality;
	};
	/** Breakdown by task type */
	breakdownByTaskType?: TaskTypeBreakdown[];
	/** Failure analysis by task type */
	failureAnalysis?: FailureAnalysis[];
	/** Start timestamp */
	startedAt: string;
	/** End timestamp */
	completedAt: string;
	/** Error information if the run failed */
	error?: {
		code: number;
		message: string;
		actionable?: string[];
	};
}

export interface RunResult {
	/** Run metadata */
	metadata: {
		/** Unique run ID */
		runId: string;
		/** Start timestamp */
		startedAt: string;
		/** End timestamp */
		completedAt: string;
		/** Total duration in ms */
		durationMs: number;
		/** MemoryBench version */
		version: string;
	};
	/** Results per benchmark × provider */
	results: BenchmarkProviderResult[];
	/** Summary across all runs */
	summary: {
		/** Total benchmarks run */
		totalBenchmarks: number;
		/** Total providers tested */
		totalProviders: number;
		/** Total test cases */
		totalTestCases: number;
		/** Overall accuracy */
		overallAccuracy: number;
	};
	/** Aggregated failure analysis across all results */
	failureAnalysis?: FailureAnalysis[];
}

// =============================================================================
// Progress Callbacks
// =============================================================================

export type ProgressPhase =
	| "init"
	| "loading"
	| "ingesting"
	| "searching"
	| "evaluating"
	| "complete";

export interface ProgressUpdate {
	phase: ProgressPhase;
	benchmark: string;
	provider: string;
	current: number;
	total: number;
	message?: string;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

// =============================================================================
// Registry Types
// =============================================================================

/**
 * Metadata for provider auto-discovery
 * Export this from your provider's index.ts
 */
export interface ProviderMeta {
	name: string;
	description?: string;
	requiresEnv?: string[];
}

/**
 * Metadata for benchmark auto-discovery
 * Export this from your benchmark's index.ts
 */
export interface BenchmarkMeta {
	name: string;
	description?: string;
	testCaseCount?: number;
	estimatedTimeMs?: number;
	/** If true, this benchmark requires separate execution and cannot be run through the unified runner */
	requiresSeparateExecution?: boolean;
}

export interface ProviderFactory {
	/** Create a provider instance */
	create: () => Provider | Promise<Provider>;
	/** Provider metadata */
	meta: ProviderMeta;
}

export interface BenchmarkFactory {
	/** Create a benchmark instance */
	create: () => Benchmark | Promise<Benchmark>;
	/** Benchmark metadata */
	meta: BenchmarkMeta;
}

