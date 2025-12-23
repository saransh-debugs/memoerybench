/**
 * Tests for new features: weighted sampling, query filtering, failure analysis, and presets
 */

import { describe, test, expect } from "bun:test";
import type { TestCase } from "../benchmarks/types";
import {
	filterTestCases,
	sampleTestCases,
	type FilterOptions,
	type SamplingOptions,
} from "../runner/sampling";
import { generateFailureAnalysis } from "../runner/failure-analysis";
import type { TestCaseResult } from "../runner/types";
import {
	savePreset,
	getPreset,
	deletePreset,
	presetToOptions,
	type PresetConfig,
} from "../runner/presets";

// Helper to create test cases
function createTestCase(overrides: Partial<TestCase>): TestCase {
	return {
		id: "test-1",
		query: "What is the answer?",
		contexts: [{ content: "The answer is 42", meta: {} }],
		expectedAnswer: "42",
		metadata: {},
		...overrides,
	};
}

// Helper to create test case results
function createTestCaseResult(
	testCaseId: string,
	passed: boolean,
	reason?: string,
): TestCaseResult {
	return {
		testCaseId,
		query: "test query",
		searchResults: [],
		evaluation: {
			passed,
			score: passed ? 1 : 0,
			details: { reason },
		},
		latencyMs: 100,
	};
}

describe("Query-based filtering", () => {
	test("filters by query length min", () => {
		const testCases = [
			createTestCase({ id: "1", query: "short" }), // 5 chars
			createTestCase({ id: "2", query: "a much longer query here" }), // 24 chars
			createTestCase({ id: "3", query: "medium length" }), // 13 chars
		];

		const filtered = filterTestCases(testCases, {
			queryLength: { min: 10 },
		});

		expect(filtered).toHaveLength(2);
		expect(filtered.map((tc) => tc.id)).toEqual(["2", "3"]);
	});

	test("filters by query length max", () => {
		const testCases = [
			createTestCase({ id: "1", query: "short" }), // 5 chars
			createTestCase({ id: "2", query: "a much longer query here" }), // 24 chars
			createTestCase({ id: "3", query: "medium length" }), // 13 chars
		];

		const filtered = filterTestCases(testCases, {
			queryLength: { max: 15 },
		});

		expect(filtered).toHaveLength(2);
		expect(filtered.map((tc) => tc.id)).toEqual(["1", "3"]);
	});

	test("filters by query contains", () => {
		const testCases = [
			createTestCase({ id: "1", query: "What is the answer?" }),
			createTestCase({ id: "2", query: "Tell me about the weather" }),
			createTestCase({ id: "3", query: "What is the weather like?" }),
		];

		const filtered = filterTestCases(testCases, {
			queryContains: ["weather"],
		});

		expect(filtered).toHaveLength(2);
		expect(filtered.map((tc) => tc.id)).toEqual(["2", "3"]);
	});

	test("filters by query pattern (regex)", () => {
		const testCases = [
			createTestCase({ id: "1", query: "What is the answer?" }),
			createTestCase({ id: "2", query: "When did this happen?" }),
			createTestCase({ id: "3", query: "Tell me more" }),
		];

		const filtered = filterTestCases(testCases, {
			queryPattern: /^(What|When)/,
		});

		expect(filtered).toHaveLength(2);
		expect(filtered.map((tc) => tc.id)).toEqual(["1", "2"]);
	});

	test("filters by context count", () => {
		const testCases = [
			createTestCase({
				id: "1",
				contexts: [{ content: "a", meta: {} }],
			}),
			createTestCase({
				id: "2",
				contexts: [
					{ content: "a", meta: {} },
					{ content: "b", meta: {} },
					{ content: "c", meta: {} },
				],
			}),
			createTestCase({
				id: "3",
				contexts: [
					{ content: "a", meta: {} },
					{ content: "b", meta: {} },
				],
			}),
		];

		const filtered = filterTestCases(testCases, {
			contextCount: { min: 2 },
		});

		expect(filtered).toHaveLength(2);
		expect(filtered.map((tc) => tc.id)).toEqual(["2", "3"]);
	});

	test("filters by context length (total)", () => {
		const testCases = [
			createTestCase({
				id: "1",
				contexts: [{ content: "short", meta: {} }], // 5 chars
			}),
			createTestCase({
				id: "2",
				contexts: [
					{ content: "a longer piece of context", meta: {} },
					{ content: "and another one", meta: {} },
				], // 25 + 15 = 40 chars
			}),
			createTestCase({
				id: "3",
				contexts: [{ content: "medium length text", meta: {} }], // 18 chars
			}),
		];

		const filtered = filterTestCases(testCases, {
			contextLength: { min: 15 },
		});

		expect(filtered).toHaveLength(2);
		expect(filtered.map((tc) => tc.id)).toEqual(["2", "3"]);
	});
});

describe("Weighted sampling", () => {
	test("samples with uniform weights", () => {
		const testCases = Array.from({ length: 100 }, (_, i) =>
			createTestCase({
				id: `test-${i}`,
				metadata: { difficulty: "medium" },
			}),
		);

		const sampled = sampleTestCases(testCases, {
			count: 10,
			seed: 42,
		});

		expect(sampled).toHaveLength(10);
		// With seed, should be deterministic
		const sampled2 = sampleTestCases(testCases, {
			count: 10,
			seed: 42,
		});
		expect(sampled.map((tc) => tc.id)).toEqual(sampled2.map((tc) => tc.id));
	});

	test("weighted sampling favors higher weights", () => {
		const testCases = [
			// 10 hard tasks
			...Array.from({ length: 10 }, (_, i) =>
				createTestCase({
					id: `hard-${i}`,
					metadata: { difficulty: "hard" },
				}),
			),
			// 90 easy tasks
			...Array.from({ length: 90 }, (_, i) =>
				createTestCase({
					id: `easy-${i}`,
					metadata: { difficulty: "easy" },
				}),
			),
		];

		// Sample 20 with hard weighted 5x
		const sampled = sampleTestCases(testCases, {
			count: 20,
			seed: 42,
			weighted: {
				field: "difficulty",
				weights: {
					hard: 5.0,
					easy: 1.0,
				},
			},
		});

		expect(sampled).toHaveLength(20);

		// Count how many hard vs easy
		const hardCount = sampled.filter((tc) =>
			tc.id.startsWith("hard-"),
		).length;
		const easyCount = sampled.filter((tc) =>
			tc.id.startsWith("easy-"),
		).length;

		// With 5x weight, hard should be overrepresented
		// Expected ratio: hard / (hard + easy) = (10 * 5) / (10 * 5 + 90 * 1) = 50/140 ≈ 0.36
		// So out of 20 samples, expect ~7 hard (35%)
		// Allow some variance due to randomness
		expect(hardCount).toBeGreaterThanOrEqual(4);
		expect(hardCount).toBeLessThanOrEqual(12);
		expect(hardCount + easyCount).toBe(20);
	});

	test("weighted sampling with taskType field", () => {
		const testCases = [
			...Array.from({ length: 20 }, (_, i) =>
				createTestCase({
					id: `multihop-${i}`,
					metadata: { taskType: "multi-hop" },
				}),
			),
			...Array.from({ length: 80 }, (_, i) =>
				createTestCase({
					id: `simple-${i}`,
					metadata: { taskType: "simple" },
				}),
			),
		];

		const sampled = sampleTestCases(testCases, {
			count: 30,
			seed: 123,
			weighted: {
				field: "taskType",
				weights: {
					"multi-hop": 3.0,
					simple: 1.0,
				},
			},
		});

		expect(sampled).toHaveLength(30);

		const multihopCount = sampled.filter((tc) =>
			tc.id.startsWith("multihop-"),
		).length;

		// With 3x weight: (20 * 3) / (20 * 3 + 80 * 1) = 60/140 ≈ 0.43
		// Out of 30 samples, expect ~13 multihop
		expect(multihopCount).toBeGreaterThanOrEqual(8);
		expect(multihopCount).toBeLessThanOrEqual(20);
	});
});

describe("Failure analysis", () => {
	test("generates failure analysis by task type", () => {
		const testCases = [
			createTestCase({ id: "1", metadata: { taskType: "multi-hop" } }),
			createTestCase({ id: "2", metadata: { taskType: "multi-hop" } }),
			createTestCase({ id: "3", metadata: { taskType: "factual" } }),
			createTestCase({ id: "4", metadata: { taskType: "factual" } }),
			createTestCase({ id: "5", metadata: { taskType: "factual" } }),
		];

		const results = [
			createTestCaseResult("1", false, "Missing context"),
			createTestCaseResult("2", false, "Wrong answer"),
			createTestCaseResult("3", true),
			createTestCaseResult("4", false, "Missing context"),
			createTestCaseResult("5", true),
		];

		const analysis = generateFailureAnalysis(results, testCases);

		expect(analysis).toHaveLength(2); // Two task types with failures

		// Check multi-hop (2 failures out of 2)
		const multihop = analysis.find((a) => a.taskType === "multi-hop");
		expect(multihop).toBeDefined();
		expect(multihop!.failureRate).toBe(1.0);
		expect(multihop!.totalFailures).toBe(2);
		expect(multihop!.commonFailureReasons).toContain("Missing context");
		expect(multihop!.commonFailureReasons).toContain("Wrong answer");

		// Check factual (1 failure out of 3)
		const factual = analysis.find((a) => a.taskType === "factual");
		expect(factual).toBeDefined();
		expect(factual!.failureRate).toBeCloseTo(0.33, 1);
		expect(factual!.totalFailures).toBe(1);
		expect(factual!.commonFailureReasons).toContain("Missing context");
	});

	test("handles no failures", () => {
		const testCases = [
			createTestCase({ id: "1", metadata: { taskType: "factual" } }),
			createTestCase({ id: "2", metadata: { taskType: "factual" } }),
		];

		const results = [
			createTestCaseResult("1", true),
			createTestCaseResult("2", true),
		];

		const analysis = generateFailureAnalysis(results, testCases);
		expect(analysis).toHaveLength(0); // No failures
	});

	test("limits sample failures to 3", () => {
		const testCases = Array.from({ length: 10 }, (_, i) =>
			createTestCase({ id: `${i}`, metadata: { taskType: "hard" } }),
		);

		const results = testCases.map((tc) =>
			createTestCaseResult(tc.id, false, "Too hard"),
		);

		const analysis = generateFailureAnalysis(results, testCases);

		expect(analysis).toHaveLength(1);
		expect(analysis[0]!.sampleFailures).toHaveLength(3);
	});
});

describe("Presets", () => {
	test("saves and loads preset", async () => {
		const preset: PresetConfig = {
			name: "test-preset-1",
			description: "Test preset for unit tests",
			taskTypes: ["multi-hop"],
			sampling: {
				count: 50,
				seed: 42,
			},
		};

		await savePreset(preset);
		const loaded = await getPreset("test-preset-1");

		expect(loaded).toBeDefined();
		expect(loaded!.name).toBe("test-preset-1");
		expect(loaded!.description).toBe("Test preset for unit tests");
		expect(loaded!.taskTypes).toEqual(["multi-hop"]);
		expect(loaded!.sampling?.count).toBe(50);
		expect(loaded!.sampling?.seed).toBe(42);

		// Cleanup
		await deletePreset("test-preset-1");
	});

	test("converts preset to options", () => {
		const preset: PresetConfig = {
			name: "test-preset-2",
			taskTypes: ["multi-hop", "temporal"],
			filters: {
				queryLength: { min: 20 },
				contextCount: { min: 3 },
			},
			sampling: {
				count: 100,
				seed: 42,
			},
		};

		const options = presetToOptions(preset);

		expect(options.taskTypes).toEqual(["multi-hop", "temporal"]);
		expect(options.filters?.queryLength).toEqual({ min: 20 });
		expect(options.filters?.contextCount).toEqual({ min: 3 });
		expect(options.sampling?.count).toBe(100);
		expect(options.sampling?.seed).toBe(42);
	});

	test("deletes preset", async () => {
		const preset: PresetConfig = {
			name: "test-preset-delete",
			description: "Will be deleted",
		};

		await savePreset(preset);
		let loaded = await getPreset("test-preset-delete");
		expect(loaded).toBeDefined();

		const deleted = await deletePreset("test-preset-delete");
		expect(deleted).toBe(true);

		loaded = await getPreset("test-preset-delete");
		expect(loaded).toBeNull();
	});

	test("returns false when deleting non-existent preset", async () => {
		const deleted = await deletePreset("non-existent-preset-xyz");
		expect(deleted).toBe(false);
	});
});

describe("Combined features", () => {
	test("filters, then samples with weights", () => {
		const testCases = [
			...Array.from({ length: 10 }, (_, i) =>
				createTestCase({
					id: `hard-long-${i}`,
					query: "This is a long query with more than 20 characters",
					metadata: { difficulty: "hard" },
				}),
			),
			...Array.from({ length: 10 }, (_, i) =>
				createTestCase({
					id: `hard-short-${i}`,
					query: "short",
					metadata: { difficulty: "hard" },
				}),
			),
			...Array.from({ length: 80 }, (_, i) =>
				createTestCase({
					id: `easy-long-${i}`,
					query: "This is a long query with more than 20 characters",
					metadata: { difficulty: "easy" },
				}),
			),
		];

		// First filter by query length
		const filtered = filterTestCases(testCases, {
			queryLength: { min: 20 },
		});

		expect(filtered).toHaveLength(90); // 10 hard-long + 80 easy-long

		// Then sample with weights
		const sampled = sampleTestCases(filtered, {
			count: 20,
			seed: 42,
			weighted: {
				field: "difficulty",
				weights: {
					hard: 4.0,
					easy: 1.0,
				},
			},
		});

		expect(sampled).toHaveLength(20);

		// All should have long queries
		for (const tc of sampled) {
			expect(tc.query.length).toBeGreaterThanOrEqual(20);
		}

		// Should have more hard than easy due to 4x weight
		const hardCount = sampled.filter((tc) => tc.id.startsWith("hard-")).length;
		expect(hardCount).toBeGreaterThan(3);
	});
});

