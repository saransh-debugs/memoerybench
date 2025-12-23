import type { Benchmark, TestCase } from "../types";
import type { BenchmarkMeta } from "../../runner/types";
import { defaultEvaluate } from "../types";
import { ragBenchmarkData } from "./data";

// Re-export types and data for backwards compatibility
export * from "./types";
export * from "./data";

/**
 * Benchmark metadata for auto-discovery
 */
export const meta: BenchmarkMeta = {
	name: "rag-template-benchmark",
	description: "RAG template benchmark with question-answer pairs",
	testCaseCount: ragBenchmarkData.length,
};

/**
 * Create the RAG-template-benchmark
 */
export function createRAGTemplateBenchmark(): Benchmark {
	return {
		name: "rag-template-benchmark",

		async load(): Promise<TestCase[]> {
			return ragBenchmarkData.map((item) => ({
				id: item.id,
				contexts: item.documents.map((doc) => ({
					content: doc.content,
					meta: {
						title: doc.title,
						source: doc.source,
						documentId: doc.id,
					},
				})),
				query: item.question,
				expected: { answer: item.expected_answer },
				metadata: item.metadata,
			}));
		},

		evaluate: defaultEvaluate,
	};
}

// Default export
export default createRAGTemplateBenchmark;
