import type { BenchmarkRegistry, BenchmarkType } from "../../benchmarks";
import type { PreparedData, BenchmarkProcessor, BenchmarkProcessors } from "../types";

// Re-export types for backwards compatibility with existing providers
export type { PreparedData, BenchmarkProcessor, BenchmarkProcessors } from "../types";

const mockSearchFunction = async (_query: string) => {
	return [
		{
			id: "",
			context: "",
			score: 0,
		},
	];
};

const templateType = {
	name: "Template repository",
	addContext: async (data: PreparedData) => {
		// process context with full type safety
		console.log(data.context); // string
		console.log(data.metadata); // Record<string, unknown>
	},

	searchQuery: async (query: string) => {
		return mockSearchFunction(query);
	},

	prepareProvider: <T extends BenchmarkType>(
		benchmarkType: T,
		data: BenchmarkRegistry[T][],
	): PreparedData[] => {
		const processors: BenchmarkProcessors = {
			"RAG-template-benchmark": (ragData: BenchmarkRegistry["RAG-template-benchmark"][]) => {
				return ragData.map((item) => ({
					context: `Question: ${item.question}\n\nDocuments:\n${item.documents.map((d: { title?: string; content: string }) => `- ${d.title}: ${d.content}`).join("\n")}`,
					metadata: {
						id: item.id,
						expectedAnswer: item.expected_answer,
						difficulty: item.metadata.difficulty,
						category: item.metadata.category,
					},
				}));
			},
		};

		const processor = processors[benchmarkType] as
			| BenchmarkProcessor<T>
			| undefined;
		if (!processor) {
			throw new Error(
				`Benchmark type "${benchmarkType}" not supported by this provider`,
			);
		}

		return processor(data);
	},
};

export type TemplateType = typeof templateType;
