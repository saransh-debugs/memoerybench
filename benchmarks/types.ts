/**
 * Simplified Benchmark Interface for MemoryBench
 *
 * Benchmarks implement two core methods:
 * - load: Return test cases with contexts to ingest and queries to evaluate
 * - evaluate: Check if search results match expected answers
 */

import type { SearchResult } from "../providers/types";

/**
 * Content to be ingested into the memory system
 */
export interface Context {
	/** The text content to store */
	content: string;
	/** Optional metadata to associate with this content */
	meta?: Record<string, unknown>;
}

/**
 * Expected result for evaluation
 */
export interface Expected {
	/** The expected answer (can be string, number, or array for multiple valid answers) */
	answer: string | number | string[];
	/** Optional: specific content that must be retrieved */
	requiredContent?: string[];
	/** Optional: minimum score threshold for a match */
	minScore?: number;
}

/**
 * A single test case in a benchmark
 */
export interface TestCase {
	/** Unique identifier for this test case */
	id: string;
	/** Content(s) to ingest before running the query */
	contexts: Context[];
	/** The query to search for */
	query: string;
	/** Expected results for evaluation */
	expected: Expected;
	/** Optional metadata about this test case */
	metadata?: {
		category?: string | number;
		difficulty?: string;
		evidence?: string[];
		[key: string]: unknown;
	};
}

/**
 * Result of evaluating a single test case
 */
export interface EvaluationResult {
	/** Whether the test passed */
	passed: boolean;
	/** Score between 0 and 1 */
	score: number;
	/** Optional details about why it passed/failed */
	details?: {
		/** The answer that was found (if any) */
		foundAnswer?: string;
		/** Why it failed (if applicable) */
		reason?: string;
		/** Which results matched (if any) */
		matchedResults?: SearchResult[];
	};
}

/**
 * Minimal benchmark interface
 *
 * @example
 * ```typescript
 * const myBenchmark: Benchmark = {
 *   name: "my-benchmark",
 *   async load() {
 *     return [
 *       {
 *         id: "q1",
 *         contexts: [{ content: "User moved to Berlin in 2020" }],
 *         query: "Where does the user live?",
 *         expected: { answer: "Berlin" }
 *       }
 *     ];
 *   },
 *   evaluate(testCase, results) {
 *     const found = results.some(r =>
 *       r.content.toLowerCase().includes(
 *         String(testCase.expected.answer).toLowerCase()
 *       )
 *     );
 *     return { passed: found, score: found ? 1 : 0 };
 *   }
 * };
 * ```
 */
export interface Benchmark {
	/** Human-readable name for the benchmark */
	name: string;

	/**
	 * Load all test cases from this benchmark
	 * @returns Array of test cases to run
	 */
	load(): Promise<TestCase[]>;

	/**
	 * Evaluate search results against expected answers
	 * @param testCase - The test case being evaluated
	 * @param results - Search results returned by the provider
	 * @returns Evaluation result with pass/fail and score
	 */
	evaluate(testCase: TestCase, results: SearchResult[]): EvaluationResult;
}

// =============================================================================
// Legacy Types (for backwards compatibility with existing benchmarks)
// =============================================================================

import type { LoCoMoBenchmarkItem } from "./LoCoMo/types";
import type { RAGBenchmarkItem } from "./RAG-template-benchmark/types";

/**
 * @deprecated Use Benchmark interface instead
 * Registry of legacy benchmark item types
 */
export interface BenchmarkRegistry {
	"RAG-template-benchmark": RAGBenchmarkItem;
	LoCoMo: LoCoMoBenchmarkItem;
}

/**
 * @deprecated Use Benchmark interface instead
 * Legacy benchmark type keys
 */
export type BenchmarkType = keyof BenchmarkRegistry;

/**
 * @deprecated Use Benchmark interface instead
 * Legacy benchmark data accessor
 */
export type BenchmarkData<T extends BenchmarkType> = BenchmarkRegistry[T];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Default evaluation function that checks if any result contains the expected answer
 * Works for string, number, or array of valid answers
 */
export function defaultEvaluate(
	testCase: TestCase,
	results: SearchResult[],
): EvaluationResult {
	const expected = testCase.expected.answer;
	const minScore = testCase.expected.minScore ?? 0;

	// Convert expected to array of strings for matching
	const expectedAnswers = Array.isArray(expected)
		? expected.map((a) => String(a).toLowerCase())
		: [String(expected).toLowerCase()];

	// Check if any result contains any expected answer
	for (const result of results) {
		if (result.score < minScore) continue;

		const contentLower = result.content.toLowerCase();
		for (const answer of expectedAnswers) {
			if (contentLower.includes(answer)) {
				return {
					passed: true,
					score: 1,
					details: {
						foundAnswer: answer,
						matchedResults: [result],
					},
				};
			}
		}
	}

	// Check required content if specified
	if (testCase.expected.requiredContent) {
		const foundRequired = testCase.expected.requiredContent.every((required) =>
			results.some((r) => r.content.toLowerCase().includes(required.toLowerCase())),
		);
		if (foundRequired) {
			return {
				passed: true,
				score: 0.8, // Partial credit for finding required content
				details: {
					reason: "Found required content but not exact answer",
				},
			};
		}
	}

	return {
		passed: false,
		score: 0,
		details: {
			reason: `Expected "${expectedAnswers.join(" or ")}" not found in results`,
		},
	};
}

