import { describe, test, expect } from "bun:test";
import {
	extractTaskType,
	normalizeTaskType,
	mapCategoryNumberToTaskType,
	isValidTaskType,
	getAllTaskTypes,
	TASK_TYPES,
	type TaskType,
} from "../runner/taxonomy";
import type { TestCase } from "../benchmarks/types";

describe("Task Type Taxonomy", () => {
	describe("extractTaskType", () => {
		test("should extract task type from explicit taskType metadata", () => {
			const testCase: TestCase = {
				id: "test_001",
				contexts: [{ content: "Test" }],
				query: "Test query",
				expected: { answer: "test" },
				metadata: { taskType: "multi-hop" },
			};

			expect(extractTaskType(testCase)).toBe("multi-hop");
		});

		test("should extract task type from category string that matches task type", () => {
			const testCase: TestCase = {
				id: "test_002",
				contexts: [{ content: "Test" }],
				query: "Test query",
				expected: { answer: "test" },
				metadata: { category: "temporal" },
			};

			expect(extractTaskType(testCase)).toBe("temporal");
		});

		test("should extract task type from category number (LoCoMo mapping)", () => {
			const testCase: TestCase = {
				id: "test_003",
				contexts: [{ content: "Test" }],
				query: "Test query",
				expected: { answer: "test" },
				metadata: { category: 1 },
			};

			expect(extractTaskType(testCase)).toBe("factual");
		});

		test("should map all LoCoMo category numbers correctly", () => {
			const mappings = [
				{ category: 1, expected: "factual" },
				{ category: 2, expected: "temporal" },
				{ category: 3, expected: "multi-hop" },
				{ category: 4, expected: "preference" },
				{ category: 5, expected: "other" },
			];

			for (const { category, expected } of mappings) {
				const testCase: TestCase = {
					id: `test_${category}`,
					contexts: [{ content: "Test" }],
					query: "Test query",
					expected: { answer: "test" },
					metadata: { category },
				};

				expect(extractTaskType(testCase)).toBe(expected);
			}
		});

		test("should default to 'other' when no metadata", () => {
			const testCase: TestCase = {
				id: "test_004",
				contexts: [{ content: "Test" }],
				query: "Test query",
				expected: { answer: "test" },
			};

			expect(extractTaskType(testCase)).toBe("other");
		});

		test("should default to 'other' when metadata is empty", () => {
			const testCase: TestCase = {
				id: "test_005",
				contexts: [{ content: "Test" }],
				query: "Test query",
				expected: { answer: "test" },
				metadata: {},
			};

			expect(extractTaskType(testCase)).toBe("other");
		});

		test("should default to 'other' when category doesn't match", () => {
			const testCase: TestCase = {
				id: "test_006",
				contexts: [{ content: "Test" }],
				query: "Test query",
				expected: { answer: "test" },
				metadata: { category: "unknown-category" },
			};

			expect(extractTaskType(testCase)).toBe("other");
		});

		test("should default to 'other' when category number is out of range", () => {
			const testCase: TestCase = {
				id: "test_007",
				contexts: [{ content: "Test" }],
				query: "Test query",
				expected: { answer: "test" },
				metadata: { category: 99 },
			};

			expect(extractTaskType(testCase)).toBe("other");
		});

		test("should prioritize taskType over category", () => {
			const testCase: TestCase = {
				id: "test_008",
				contexts: [{ content: "Test" }],
				query: "Test query",
				expected: { answer: "test" },
				metadata: { taskType: "entity", category: "temporal" },
			};

			expect(extractTaskType(testCase)).toBe("entity");
		});

		test("should handle taskType with aliases", () => {
			const testCase: TestCase = {
				id: "test_009",
				contexts: [{ content: "Test" }],
				query: "Test query",
				expected: { answer: "test" },
				metadata: { taskType: "multi_hop" }, // underscore variant
			};

			expect(extractTaskType(testCase)).toBe("multi-hop");
		});

		test("should handle category string with aliases", () => {
			const testCase: TestCase = {
				id: "test_010",
				contexts: [{ content: "Test" }],
				query: "Test query",
				expected: { answer: "test" },
				metadata: { category: "time" }, // alias for temporal
			};

			expect(extractTaskType(testCase)).toBe("temporal");
		});

		test("should handle case-insensitive taskType", () => {
			const testCase: TestCase = {
				id: "test_011",
				contexts: [{ content: "Test" }],
				query: "Test query",
				expected: { answer: "test" },
				metadata: { taskType: "TEMPORAL" },
			};

			expect(extractTaskType(testCase)).toBe("temporal");
		});

		test("should handle whitespace in taskType", () => {
			const testCase: TestCase = {
				id: "test_012",
				contexts: [{ content: "Test" }],
				query: "Test query",
				expected: { answer: "test" },
				metadata: { taskType: "  multi-hop  " },
			};

			expect(extractTaskType(testCase)).toBe("multi-hop");
		});
	});

	describe("normalizeTaskType", () => {
		test("should normalize direct matches", () => {
			expect(normalizeTaskType("multi-hop")).toBe("multi-hop");
			expect(normalizeTaskType("temporal")).toBe("temporal");
			expect(normalizeTaskType("preference")).toBe("preference");
			expect(normalizeTaskType("factual")).toBe("factual");
			expect(normalizeTaskType("entity")).toBe("entity");
			expect(normalizeTaskType("location")).toBe("location");
			expect(normalizeTaskType("comparison")).toBe("comparison");
			expect(normalizeTaskType("causal")).toBe("causal");
			expect(normalizeTaskType("other")).toBe("other");
		});

		test("should normalize aliases", () => {
			expect(normalizeTaskType("multi_hop")).toBe("multi-hop");
			expect(normalizeTaskType("multihop")).toBe("multi-hop");
			expect(normalizeTaskType("reasoning")).toBe("multi-hop");
			expect(normalizeTaskType("time")).toBe("temporal");
			expect(normalizeTaskType("date")).toBe("temporal");
			expect(normalizeTaskType("chronological")).toBe("temporal");
			expect(normalizeTaskType("preferences")).toBe("preference");
			expect(normalizeTaskType("opinion")).toBe("preference");
			expect(normalizeTaskType("likes")).toBe("preference");
			expect(normalizeTaskType("fact")).toBe("factual");
			expect(normalizeTaskType("recall")).toBe("factual");
			expect(normalizeTaskType("simple")).toBe("factual");
			expect(normalizeTaskType("entities")).toBe("entity");
			expect(normalizeTaskType("named-entity")).toBe("entity");
			expect(normalizeTaskType("geographic")).toBe("location");
			expect(normalizeTaskType("place")).toBe("location");
			expect(normalizeTaskType("where")).toBe("location");
			expect(normalizeTaskType("compare")).toBe("comparison");
			expect(normalizeTaskType("versus")).toBe("comparison");
			expect(normalizeTaskType("cause")).toBe("causal");
			expect(normalizeTaskType("effect")).toBe("causal");
			expect(normalizeTaskType("why")).toBe("causal");
			expect(normalizeTaskType("unknown")).toBe("other");
			expect(normalizeTaskType("misc")).toBe("other");
		});

		test("should handle case-insensitive input", () => {
			expect(normalizeTaskType("MULTI-HOP")).toBe("multi-hop");
			expect(normalizeTaskType("TEMPORAL")).toBe("temporal");
			expect(normalizeTaskType("Multi_Hop")).toBe("multi-hop");
		});

		test("should handle whitespace", () => {
			expect(normalizeTaskType("  multi-hop  ")).toBe("multi-hop");
			expect(normalizeTaskType("\ttemporal\n")).toBe("temporal");
		});

		test("should return null for invalid task types", () => {
			expect(normalizeTaskType("invalid")).toBe(null);
			expect(normalizeTaskType("random")).toBe(null);
			expect(normalizeTaskType("")).toBe(null);
		});
	});

	describe("mapCategoryNumberToTaskType", () => {
		test("should map LoCoMo categories correctly", () => {
			expect(mapCategoryNumberToTaskType(1)).toBe("factual");
			expect(mapCategoryNumberToTaskType(2)).toBe("temporal");
			expect(mapCategoryNumberToTaskType(3)).toBe("multi-hop");
			expect(mapCategoryNumberToTaskType(4)).toBe("preference");
			expect(mapCategoryNumberToTaskType(5)).toBe("other");
		});

		test("should return null for out-of-range categories", () => {
			expect(mapCategoryNumberToTaskType(0)).toBe(null);
			expect(mapCategoryNumberToTaskType(6)).toBe(null);
			expect(mapCategoryNumberToTaskType(99)).toBe(null);
			expect(mapCategoryNumberToTaskType(-1)).toBe(null);
		});
	});

	describe("isValidTaskType", () => {
		test("should return true for valid task types", () => {
			expect(isValidTaskType("multi-hop")).toBe(true);
			expect(isValidTaskType("temporal")).toBe(true);
			expect(isValidTaskType("preference")).toBe(true);
			expect(isValidTaskType("factual")).toBe(true);
			expect(isValidTaskType("entity")).toBe(true);
			expect(isValidTaskType("location")).toBe(true);
			expect(isValidTaskType("comparison")).toBe(true);
			expect(isValidTaskType("causal")).toBe(true);
			expect(isValidTaskType("other")).toBe(true);
		});

		test("should return true for aliases", () => {
			expect(isValidTaskType("multi_hop")).toBe(true);
			expect(isValidTaskType("time")).toBe(true);
			expect(isValidTaskType("preferences")).toBe(true);
		});

		test("should return false for invalid task types", () => {
			expect(isValidTaskType("invalid")).toBe(false);
			expect(isValidTaskType("random")).toBe(false);
			expect(isValidTaskType("")).toBe(false);
		});
	});

	describe("getAllTaskTypes", () => {
		test("should return all task types", () => {
			const taskTypes = getAllTaskTypes();
			expect(taskTypes).toHaveLength(9);
			expect(taskTypes).toContain("multi-hop");
			expect(taskTypes).toContain("temporal");
			expect(taskTypes).toContain("preference");
			expect(taskTypes).toContain("factual");
			expect(taskTypes).toContain("entity");
			expect(taskTypes).toContain("location");
			expect(taskTypes).toContain("comparison");
			expect(taskTypes).toContain("causal");
			expect(taskTypes).toContain("other");
		});

		test("should return task types in consistent order", () => {
			const taskTypes1 = getAllTaskTypes();
			const taskTypes2 = getAllTaskTypes();
			expect(taskTypes1).toEqual(taskTypes2);
		});
	});

	describe("Task Type Distribution", () => {
		test("should correctly distribute task types across test cases", () => {
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

			const distribution: Record<string, number> = {};
			for (const testCase of testCases) {
				const taskType = extractTaskType(testCase);
				distribution[taskType] = (distribution[taskType] || 0) + 1;
			}

			expect(distribution["factual"]).toBe(2);
			expect(distribution["temporal"]).toBe(1);
			expect(distribution["multi-hop"]).toBe(1);
			expect(distribution["other"]).toBe(1);
			expect(Object.values(distribution).reduce((a, b) => a + b, 0)).toBe(5);
		});

		test("should handle mixed metadata formats", () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "Test" }],
					query: "Query 1",
					expected: { answer: "test" },
					metadata: { taskType: "preference" },
				},
				{
					id: "tc2",
					contexts: [{ content: "Test" }],
					query: "Query 2",
					expected: { answer: "test" },
					metadata: { category: "entity" },
				},
				{
					id: "tc3",
					contexts: [{ content: "Test" }],
					query: "Query 3",
					expected: { answer: "test" },
					metadata: { category: 2 }, // temporal
				},
				{
					id: "tc4",
					contexts: [{ content: "Test" }],
					query: "Query 4",
					expected: { answer: "test" },
					metadata: { category: "unknown" }, // should default to "other"
				},
			];

			const taskTypes = testCases.map((tc) => extractTaskType(tc));
			expect(taskTypes).toEqual(["preference", "entity", "temporal", "other"]);
		});
	});
});

