/**
 * LongMemEval Benchmark
 *
 * NOTE: LongMemEval uses a different execution model than the unified benchmark interface.
 * It requires session-based ingestion and LLM-based evaluation.
 *
 * For now, use the existing scripts in scripts/ directory:
 * - scripts/ingest/ingest.ts - Ingest sessions
 * - scripts/search/search.ts - Search for answers
 * - scripts/evaluate/evaluate.ts - Evaluate results
 *
 * See INTEGRATION_NOTES.md for details on why full integration requires refactoring.
 */

import type { BenchmarkMeta } from "../../runner/types";

/**
 * Benchmark metadata for auto-discovery
 * Note: This benchmark is not fully integrated with the unified runner
 */
export const meta: BenchmarkMeta = {
	name: "longmemeval",
	description: "LongMemEval benchmark - requires separate scripts (see README.md)",
	testCaseCount: undefined, // Variable, depends on dataset
	estimatedTimeMs: undefined, // Variable, depends on question count
	requiresSeparateExecution: true, // Mark as requiring separate execution
};

/**
 * Create LongMemEval benchmark
 *
 * NOTE: LongMemEval uses a session-based ingestion model that differs from the
 * unified benchmark interface. It requires:
 * 1. Multi-phase execution (ingest sessions → search → evaluate with LLM judge)
 * 2. Session-based checkpointing
 * 3. LLM-based evaluation (not simple string matching)
 *
 * For now, use the existing scripts in scripts/ directory:
 * 
 * ```bash
 * # From benchmarks/LongMemEval directory:
 * bun run scripts/ingest/ingest.ts <questionId> <runId>
 * bun run scripts/search/search.ts <questionId> <runId>
 * bun run scripts/evaluate/evaluate.ts <runId> [model]
 * ```
 *
 * See benchmarks/LongMemEval/README.md for full usage instructions.
 * See benchmarks/LongMemEval/INTEGRATION_NOTES.md for technical details.
 */
export function createLongMemEvalBenchmark() {
	throw new Error(
		"LongMemEval benchmark requires a different execution model than the unified runner.\n\n" +
		"LongMemEval uses session-based ingestion and LLM-based evaluation, which doesn't fit\n" +
		"the current unified benchmark interface that expects per-test-case ingestion.\n\n" +
		"Please use the scripts in benchmarks/LongMemEval/scripts/ directory:\n" +
		"  - scripts/ingest/ingest.ts - Ingest sessions for a question\n" +
		"  - scripts/search/search.ts - Search for answers\n" +
		"  - scripts/evaluate/evaluate.ts - Evaluate with LLM judge\n\n" +
		"See benchmarks/LongMemEval/README.md for usage instructions.\n" +
		"See benchmarks/LongMemEval/INTEGRATION_NOTES.md for integration details."
	);
}

// Default export
export default createLongMemEvalBenchmark;

