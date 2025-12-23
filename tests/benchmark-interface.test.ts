import { describe, test, expect } from "bun:test";
import type { Benchmark, TestCase } from "../benchmarks/types";
import type { SearchResult } from "../providers/types";

describe("Benchmark Interface Compliance", () => {
	test("should have required Benchmark interface methods", async () => {
		const benchmark: Benchmark = {
			name: "test-benchmark",
			async load() {
				return [
					{
						id: "test_001",
						contexts: [{ content: "test context" }],
						query: "test query",
						expected: { answer: "test answer" },
					},
				];
			},
			evaluate(testCase: TestCase, results: SearchResult[]) {
				return {
					passed: true,
					score: 1,
				};
			},
		};

		expect(benchmark.name).toBe("test-benchmark");
		expect(typeof benchmark.load).toBe("function");
		expect(typeof benchmark.evaluate).toBe("function");

		const testCases = await benchmark.load();
		expect(Array.isArray(testCases)).toBe(true);
		expect(testCases.length).toBe(1);

		const evaluation = benchmark.evaluate(testCases[0]!, []);
		expect(evaluation).toHaveProperty("passed");
		expect(evaluation).toHaveProperty("score");
	});

	test("should handle test cases with multiple contexts", async () => {
		const benchmark: Benchmark = {
			name: "test-benchmark",
			async load() {
				return [
					{
						id: "test_001",
						contexts: [
							{ content: "context 1" },
							{ content: "context 2", meta: { key: "value" } },
						],
						query: "test query",
						expected: { answer: "answer" },
					},
				];
			},
			evaluate() {
				return { passed: true, score: 1 };
			},
		};

		const testCases = await benchmark.load();
		expect(testCases[0]!.contexts.length).toBe(2);
		expect(testCases[0]!.contexts[1]!.meta).toEqual({ key: "value" });
	});

	test("should handle evaluation with search results", () => {
		const benchmark: Benchmark = {
			name: "test-benchmark",
			async load() {
				return [];
			},
			evaluate(testCase: TestCase, results: SearchResult[]) {
				const found = results.some((r) =>
					r.content.toLowerCase().includes(
						String(testCase.expected.answer).toLowerCase()
					)
				);
				return {
					passed: found,
					score: found ? 1 : 0,
					details: found
						? { foundAnswer: String(testCase.expected.answer) }
						: { reason: "Not found" },
				};
			},
		};

		const testCase: TestCase = {
			id: "test_001",
			contexts: [],
			query: "test",
			expected: { answer: "Paris" },
		};

		const results: SearchResult[] = [
			{ id: "1", content: "The capital is Paris", score: 0.9 },
		];

		const evaluation = benchmark.evaluate(testCase, results);
		expect(evaluation.passed).toBe(true);
		expect(evaluation.score).toBe(1);
		expect(evaluation.details?.foundAnswer).toBe("Paris");
	});
});

