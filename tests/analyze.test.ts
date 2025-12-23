import { describe, test, expect } from "bun:test";
import { analyzeTestCases } from "../runner/analyze";
import type { TestCase } from "../benchmarks/types";

describe("Benchmark Analysis", () => {
	describe("Task Type Distribution", () => {
		test("should correctly calculate task type distribution", () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "Test" }],
					query: "Query 1",
					expected: { answer: "test" },
					metadata: { taskType: "factual" },
				},
				{
					id: "tc2",
					contexts: [{ content: "Test" }],
					query: "Query 2",
					expected: { answer: "test" },
					metadata: { taskType: "factual" },
				},
				{
					id: "tc3",
					contexts: [{ content: "Test" }],
					query: "Query 3",
					expected: { answer: "test" },
					metadata: { taskType: "temporal" },
				},
				{
					id: "tc4",
					contexts: [{ content: "Test" }],
					query: "Query 4",
					expected: { answer: "test" },
					metadata: { category: 3 }, // multi-hop
				},
				{
					id: "tc5",
					contexts: [{ content: "Test" }],
					query: "Query 5",
					expected: { answer: "test" },
					// No metadata - should default to "other"
				},
			];

			const analysis = analyzeTestCases("test-benchmark", testCases);

			expect(analysis.taskTypeDistribution["factual"]).toBe(2);
			expect(analysis.taskTypeDistribution["temporal"]).toBe(1);
			expect(analysis.taskTypeDistribution["multi-hop"]).toBe(1);
			expect(analysis.taskTypeDistribution["other"]).toBe(1);
			expect(analysis.totalTestCases).toBe(5);
		});

		test("should handle all task types in distribution", () => {
			const testCases: TestCase[] = [
				{ id: "tc1", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { taskType: "multi-hop" } },
				{ id: "tc2", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { taskType: "temporal" } },
				{ id: "tc3", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { taskType: "preference" } },
				{ id: "tc4", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { taskType: "factual" } },
				{ id: "tc5", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { taskType: "entity" } },
				{ id: "tc6", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { taskType: "location" } },
				{ id: "tc7", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { taskType: "comparison" } },
				{ id: "tc8", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { taskType: "causal" } },
				{ id: "tc9", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { taskType: "other" } },
			];

			const analysis = analyzeTestCases("test-all-types", testCases);

			expect(analysis.taskTypeDistribution["multi-hop"]).toBe(1);
			expect(analysis.taskTypeDistribution["temporal"]).toBe(1);
			expect(analysis.taskTypeDistribution["preference"]).toBe(1);
			expect(analysis.taskTypeDistribution["factual"]).toBe(1);
			expect(analysis.taskTypeDistribution["entity"]).toBe(1);
			expect(analysis.taskTypeDistribution["location"]).toBe(1);
			expect(analysis.taskTypeDistribution["comparison"]).toBe(1);
			expect(analysis.taskTypeDistribution["causal"]).toBe(1);
			expect(analysis.taskTypeDistribution["other"]).toBe(1);
			expect(analysis.totalTestCases).toBe(9);
		});

		test("should handle empty test case list", () => {
			const analysis = analyzeTestCases("test-empty", []);

			expect(analysis.totalTestCases).toBe(0);
			expect(Object.keys(analysis.taskTypeDistribution)).toHaveLength(0);
			expect(analysis.avgContextCount).toBe(0);
			expect(analysis.avgQueryLength).toBe(0);
		});

		test("should correctly identify task types from category numbers", () => {
			const testCases: TestCase[] = [
				{ id: "tc1", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { category: 1 } },
				{ id: "tc2", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { category: 2 } },
				{ id: "tc3", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { category: 3 } },
				{ id: "tc4", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { category: 4 } },
				{ id: "tc5", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { category: 5 } },
			];

			const analysis = analyzeTestCases("test-category-numbers", testCases);

			expect(analysis.taskTypeDistribution["factual"]).toBe(1);
			expect(analysis.taskTypeDistribution["temporal"]).toBe(1);
			expect(analysis.taskTypeDistribution["multi-hop"]).toBe(1);
			expect(analysis.taskTypeDistribution["preference"]).toBe(1);
			expect(analysis.taskTypeDistribution["other"]).toBe(1);
		});
	});

	describe("Difficulty Distribution", () => {
		test("should correctly calculate difficulty distribution", () => {
			const testCases: TestCase[] = [
				{ id: "tc1", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { difficulty: "easy" } },
				{ id: "tc2", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { difficulty: "easy" } },
				{ id: "tc3", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { difficulty: "medium" } },
				{ id: "tc4", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { difficulty: "hard" } },
			];

			const analysis = analyzeTestCases("test-difficulty", testCases);

			expect(analysis.difficultyDistribution["easy"]).toBe(2);
			expect(analysis.difficultyDistribution["medium"]).toBe(1);
			expect(analysis.difficultyDistribution["hard"]).toBe(1);
		});

		test("should handle numeric difficulty values", () => {
			const testCases: TestCase[] = [
				{ id: "tc1", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { difficulty: 1 } },
				{ id: "tc2", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { difficulty: 2 } },
			];

			const analysis = analyzeTestCases("test-difficulty-numeric", testCases);

			expect(analysis.difficultyDistribution["1"]).toBe(1);
			expect(analysis.difficultyDistribution["2"]).toBe(1);
		});
	});

	describe("Category Distribution", () => {
		test("should correctly calculate category distribution", () => {
			const testCases: TestCase[] = [
				{ id: "tc1", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { category: "A" } },
				{ id: "tc2", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { category: "A" } },
				{ id: "tc3", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { category: "B" } },
			];

			const analysis = analyzeTestCases("test-category", testCases);

			expect(analysis.categoryDistribution["A"]).toBe(2);
			expect(analysis.categoryDistribution["B"]).toBe(1);
		});

		test("should handle numeric categories", () => {
			const testCases: TestCase[] = [
				{ id: "tc1", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { category: 1 } },
				{ id: "tc2", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { category: 2 } },
				{ id: "tc3", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { category: 1 } },
			];

			const analysis = analyzeTestCases("test-category-numeric", testCases);

			expect(analysis.categoryDistribution["1"]).toBe(2);
			expect(analysis.categoryDistribution["2"]).toBe(1);
		});
	});

	describe("Evidence Complexity", () => {
		test("should correctly calculate evidence complexity", () => {
			const testCases: TestCase[] = [
				{ id: "tc1", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { evidence: ["source1"] } },
				{ id: "tc2", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { evidence: ["source1", "source2"] } },
				{ id: "tc3", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" }, metadata: { evidence: [] } },
				{ id: "tc4", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" } },
			];

			const analysis = analyzeTestCases("test-evidence", testCases);

			expect(analysis.evidenceComplexity.singleSource).toBe(1);
			expect(analysis.evidenceComplexity.multiSource).toBe(1);
			expect(analysis.evidenceComplexity.noEvidence).toBe(2);
		});
	});

	describe("Average Calculations", () => {
		test("should correctly calculate average context count", () => {
			const testCases: TestCase[] = [
				{ id: "tc1", contexts: [{ content: "Test" }], query: "Q", expected: { answer: "test" } },
				{ id: "tc2", contexts: [{ content: "Test" }, { content: "Test2" }], query: "Q", expected: { answer: "test" } },
				{ id: "tc3", contexts: [{ content: "Test" }, { content: "Test2" }, { content: "Test3" }], query: "Q", expected: { answer: "test" } },
			];

			const analysis = analyzeTestCases("test-avg-context", testCases);

			expect(analysis.avgContextCount).toBeCloseTo((1 + 2 + 3) / 3, 1);
		});

		test("should correctly calculate average query length", () => {
			const testCases: TestCase[] = [
				{ id: "tc1", contexts: [{ content: "Test" }], query: "Short", expected: { answer: "test" } },
				{ id: "tc2", contexts: [{ content: "Test" }], query: "Medium length query", expected: { answer: "test" } },
				{ id: "tc3", contexts: [{ content: "Test" }], query: "This is a very long query with many words", expected: { answer: "test" } },
			];

			const analysis = analyzeTestCases("test-avg-query", testCases);

			const totalLength = 5 + 19 + 42;
			expect(analysis.avgQueryLength).toBeCloseTo(totalLength / 3, 0);
		});

		test("should handle zero-length queries", () => {
			const testCases: TestCase[] = [
				{ id: "tc1", contexts: [{ content: "Test" }], query: "", expected: { answer: "test" } },
			];

			const analysis = analyzeTestCases("test-zero-query", testCases);

			expect(analysis.avgQueryLength).toBe(0);
		});
	});

	describe("Integration", () => {
		test("should correctly analyze comprehensive benchmark", () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "User lives in Paris" }],
					query: "Where does the user live?",
					expected: { answer: "Paris" },
					metadata: { taskType: "factual", difficulty: "easy", category: "location", evidence: ["source1"] },
				},
				{
					id: "tc2",
					contexts: [{ content: "User moved in 2023" }],
					query: "When did the user move?",
					expected: { answer: "2023" },
					metadata: { taskType: "temporal", difficulty: "medium", category: 2, evidence: ["source1", "source2"] },
				},
				{
					id: "tc3",
					contexts: [{ content: "User likes pizza" }],
					query: "What does the user like?",
					expected: { answer: "pizza" },
					metadata: { taskType: "preference", difficulty: "easy" },
				},
			];

			const analysis = analyzeTestCases("test-comprehensive", testCases);

			// Task types
			expect(analysis.taskTypeDistribution["factual"]).toBe(1);
			expect(analysis.taskTypeDistribution["temporal"]).toBe(1);
			expect(analysis.taskTypeDistribution["preference"]).toBe(1);

			// Difficulty
			expect(analysis.difficultyDistribution["easy"]).toBe(2);
			expect(analysis.difficultyDistribution["medium"]).toBe(1);

			// Category
			expect(analysis.categoryDistribution["location"]).toBe(1);
			expect(analysis.categoryDistribution["2"]).toBe(1);

			// Evidence
			expect(analysis.evidenceComplexity.singleSource).toBe(1);
			expect(analysis.evidenceComplexity.multiSource).toBe(1);
			expect(analysis.evidenceComplexity.noEvidence).toBe(1);

			// Totals
			expect(analysis.totalTestCases).toBe(3);
			expect(analysis.avgContextCount).toBe(1);
			expect(analysis.avgQueryLength).toBeGreaterThan(0);
		});
	});
});

