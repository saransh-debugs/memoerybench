import { describe, test, expect } from "bun:test";
import { run } from "../runner/index";
import { createMockProvider } from "../providers/mock";
import type { RunOptions, RunResult } from "../runner/types";
import type { Benchmark, TestCase } from "../benchmarks/types";
import { extractTaskType } from "../runner/taxonomy";
import { filterTestCases } from "../runner/sampling";
import { registerBenchmark, createInlineBenchmark } from "../runner/registry";

/**
 * Create a test benchmark with known task type distribution
 */
function createTestBenchmark(name: string, testCases: TestCase[]): Benchmark {
	return {
		name,
		async load(): Promise<TestCase[]> {
			return testCases;
		},
		evaluate(testCase, results) {
			const expected = testCase.expected.answer;
			const expectedAnswers = Array.isArray(expected)
				? expected.map((a) => String(a).toLowerCase())
				: [String(expected).toLowerCase()];

			for (const result of results) {
				const contentLower = result.content.toLowerCase();
				for (const answer of expectedAnswers) {
					if (contentLower.includes(answer)) {
						return { passed: true, score: 1 };
					}
				}
			}

			return { passed: false, score: 0 };
		},
	};
}

/**
 * Helper to register a test benchmark and ensure it's available.
 * This function registers the benchmark and ensures it's in the registry
 * before auto-discovery can interfere.
 */
function registerTestBenchmark(name: string, benchmark: Benchmark): void {
	// Register the benchmark factory with proper structure
	registerBenchmark(name, {
		create: async () => benchmark,
		meta: {
			name,
			description: `Test benchmark: ${name}`,
			testCaseCount: 0, // Will be set when benchmark loads
		},
	});
}

describe("Runner Precision Tests", () => {
	describe("Task Type Filtering", () => {
		test("should filter test cases by task type correctly", () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "User lives in Paris" }],
					query: "Where does the user live?",
					expected: { answer: "Paris" },
					metadata: { taskType: "factual" },
				},
				{
					id: "tc2",
					contexts: [{ content: "User moved in 2023" }],
					query: "When did the user move?",
					expected: { answer: "2023" },
					metadata: { taskType: "temporal" },
				},
				{
					id: "tc3",
					contexts: [{ content: "User likes pizza" }],
					query: "What does the user like?",
					expected: { answer: "pizza" },
					metadata: { taskType: "preference" },
				},
				{
					id: "tc4",
					contexts: [{ content: "User lives in Paris" }],
					query: "Where does the user live?",
					expected: { answer: "Paris" },
					metadata: { taskType: "factual" },
				},
			];

			// Filter by factual
			const factualOnly = filterTestCases(testCases, { taskTypes: ["factual"] });
			expect(factualOnly).toHaveLength(2);
			expect(factualOnly.every((tc) => extractTaskType(tc) === "factual")).toBe(true);

			// Filter by temporal
			const temporalOnly = filterTestCases(testCases, { taskTypes: ["temporal"] });
			expect(temporalOnly).toHaveLength(1);
			expect(temporalOnly[0]?.id).toBe("tc2");

			// Filter by multiple task types
			const multiType = filterTestCases(testCases, { taskTypes: ["factual", "temporal"] });
			expect(multiType).toHaveLength(3);
			expect(multiType.every((tc) => ["factual", "temporal"].includes(extractTaskType(tc)))).toBe(true);
		});

		test("should handle case-insensitive task type filtering", () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "Test" }],
					query: "Query",
					expected: { answer: "test" },
					metadata: { taskType: "FACTUAL" },
				},
				{
					id: "tc2",
					contexts: [{ content: "Test" }],
					query: "Query",
					expected: { answer: "test" },
					metadata: { taskType: "temporal" },
				},
			];

			const filtered = filterTestCases(testCases, { taskTypes: ["factual"] });
			expect(filtered).toHaveLength(1);
			expect(filtered[0]?.id).toBe("tc1");
		});

		test("should handle empty filter (no filtering)", () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "Test" }],
					query: "Query",
					expected: { answer: "test" },
					metadata: { taskType: "factual" },
				},
				{
					id: "tc2",
					contexts: [{ content: "Test" }],
					query: "Query",
					expected: { answer: "test" },
					metadata: { taskType: "temporal" },
				},
			];

			const filtered = filterTestCases(testCases, {});
			expect(filtered).toHaveLength(2);
		});
	});

	describe("Metrics Calculation", () => {
		test("should calculate accuracy correctly", async () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "The capital city of France is Paris" }],
					query: "What is the capital of France?",
					expected: { answer: "Paris" },
					metadata: { taskType: "factual" },
				},
				{
					id: "tc2",
					contexts: [{ content: "The capital city of England is London" }],
					query: "What is the capital of England?",
					expected: { answer: "Paris" }, // Wrong answer - should fail (expects Paris but answer is London)
					metadata: { taskType: "factual" },
				},
				{
					id: "tc3",
					contexts: [{ content: "The user prefers Italian cuisine, especially pizza" }],
					query: "What cuisine does the user prefer?",
					expected: { answer: "Italian" },
					metadata: { taskType: "preference" },
				},
			];

			const benchmark = createTestBenchmark("test-metrics", testCases);
			registerTestBenchmark("test-metrics", benchmark);

			const options: RunOptions = {
				benchmarks: ["test-metrics"],
				providers: ["mock"],
				verbose: false,
				restart: true,
				checkpoint: false,
			};

			const result = await run(options);
			const benchmarkResult = result.results.find((r) => r.benchmark === "test-metrics");

			expect(benchmarkResult).toBeDefined();
			expect(benchmarkResult!.metrics.total).toBe(3);
			expect(benchmarkResult!.metrics.passed).toBe(2); // tc1 and tc3 should pass
			expect(benchmarkResult!.metrics.failed).toBe(1); // tc2 should fail
			expect(benchmarkResult!.metrics.accuracy).toBeCloseTo(2 / 3, 3);
		});

		test("should calculate average score correctly", async () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "The correct answer for question one is Alpha" }],
					query: "What is the answer for question one?",
					expected: { answer: "Alpha" },
				},
				{
					id: "tc2",
					contexts: [{ content: "The correct answer for question two is Beta" }],
					query: "What is the answer for question two?",
					expected: { answer: "Alpha" }, // Wrong - expects Alpha but answer is Beta
				},
			];

			const benchmark = createTestBenchmark("test-score", testCases);
			registerTestBenchmark("test-score", benchmark);

			const options: RunOptions = {
				benchmarks: ["test-score"],
				providers: ["mock"],
				verbose: false,
				restart: true,
				checkpoint: false,
			};

			const result = await run(options);
			const benchmarkResult = result.results.find((r) => r.benchmark === "test-score");

			expect(benchmarkResult).toBeDefined();
			expect(benchmarkResult!.metrics.avgScore).toBeCloseTo(0.5, 3); // (1 + 0) / 2
		});

		test("should calculate latency metrics correctly", async () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "Test content" }],
					query: "Test query",
					expected: { answer: "test" },
				},
			];

			const benchmark = createTestBenchmark("test-latency", testCases);
			registerTestBenchmark("test-latency", benchmark);

			const options: RunOptions = {
				benchmarks: ["test-latency"],
				providers: ["mock"],
				verbose: false,
				restart: true,
				checkpoint: false,
			};

			const result = await run(options);
			const benchmarkResult = result.results.find((r) => r.benchmark === "test-latency");

			expect(benchmarkResult).toBeDefined();
			expect(benchmarkResult!.metrics.avgLatencyMs).toBeGreaterThan(0);
			expect(benchmarkResult!.metrics.p50LatencyMs).toBeGreaterThan(0);
			expect(benchmarkResult!.metrics.p95LatencyMs).toBeGreaterThanOrEqual(benchmarkResult!.metrics.p50LatencyMs);
		});
	});

	describe("Task Type Breakdown", () => {
		test("should calculate task type breakdown correctly", async () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "User lives in Paris" }],
					query: "Where does the user live?",
					expected: { answer: "Paris" },
					metadata: { taskType: "factual" },
				},
				{
					id: "tc2",
					contexts: [{ content: "User lives in London" }],
					query: "Where does the user live?",
					expected: { answer: "London" },
					metadata: { taskType: "factual" },
				},
				{
					id: "tc3",
					contexts: [{ content: "User moved in 2023" }],
					query: "When did the user move?",
					expected: { answer: "2023" },
					metadata: { taskType: "temporal" },
				},
				{
					id: "tc4",
					contexts: [{ content: "User likes pizza" }],
					query: "What does the user like?",
					expected: { answer: "pizza" },
					metadata: { taskType: "preference" },
				},
			];

			const benchmark = createTestBenchmark("test-breakdown", testCases);
			registerTestBenchmark("test-breakdown", benchmark);

			const options: RunOptions = {
				benchmarks: ["test-breakdown"],
				providers: ["mock"],
				verbose: false,
				restart: true,
				checkpoint: false,
			};

			const result = await run(options);
			const benchmarkResult = result.results.find((r) => r.benchmark === "test-breakdown");

			expect(benchmarkResult).toBeDefined();
			expect(benchmarkResult!.breakdownByTaskType).toBeDefined();
			expect(benchmarkResult!.breakdownByTaskType!.length).toBeGreaterThan(0);

			const factualBreakdown = benchmarkResult!.breakdownByTaskType!.find((b) => b.taskType === "factual");
			expect(factualBreakdown).toBeDefined();
			expect(factualBreakdown!.total).toBe(2);
			expect(factualBreakdown!.passed).toBe(2);
			expect(factualBreakdown!.accuracy).toBe(1.0);

			const temporalBreakdown = benchmarkResult!.breakdownByTaskType!.find((b) => b.taskType === "temporal");
			expect(temporalBreakdown).toBeDefined();
			expect(temporalBreakdown!.total).toBe(1);
			expect(temporalBreakdown!.passed).toBe(1);
			expect(temporalBreakdown!.accuracy).toBe(1.0);

			const preferenceBreakdown = benchmarkResult!.breakdownByTaskType!.find((b) => b.taskType === "preference");
			expect(preferenceBreakdown).toBeDefined();
			expect(preferenceBreakdown!.total).toBe(1);
			expect(preferenceBreakdown!.passed).toBe(1);
			expect(preferenceBreakdown!.accuracy).toBe(1.0);
		});

		test("should handle mixed pass/fail results in task type breakdown", async () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "The user's residence is in Paris, France" }],
					query: "Where is the user's residence?",
					expected: { answer: "Paris" },
					metadata: { taskType: "factual" },
				},
				{
					id: "tc2",
					contexts: [{ content: "The user's residence is in London, UK" }],
					query: "Where is the user's residence?",
					expected: { answer: "Paris" }, // Wrong - expects Paris but answer is London
					metadata: { taskType: "factual" },
				},
				{
					id: "tc3",
					contexts: [{ content: "The user relocated in the year 2023" }],
					query: "When did the user relocate?",
					expected: { answer: "2024" }, // Wrong - expects 2024 but answer is 2023
					metadata: { taskType: "temporal" },
				},
			];

			const benchmark = createTestBenchmark("test-breakdown-mixed", testCases);
			registerTestBenchmark("test-breakdown-mixed", benchmark);

			const options: RunOptions = {
				benchmarks: ["test-breakdown-mixed"],
				providers: ["mock"],
				verbose: false,
				restart: true,
				checkpoint: false,
			};

			const result = await run(options);
			const benchmarkResult = result.results.find((r) => r.benchmark === "test-breakdown-mixed");

			expect(benchmarkResult).toBeDefined();
			expect(benchmarkResult!.breakdownByTaskType).toBeDefined();

			const factualBreakdown = benchmarkResult!.breakdownByTaskType!.find((b) => b.taskType === "factual");
			expect(factualBreakdown).toBeDefined();
			expect(factualBreakdown!.total).toBe(2);
			expect(factualBreakdown!.passed).toBe(1);
			expect(factualBreakdown!.failed).toBe(1);
			expect(factualBreakdown!.accuracy).toBe(0.5);

			const temporalBreakdown = benchmarkResult!.breakdownByTaskType!.find((b) => b.taskType === "temporal");
			expect(temporalBreakdown).toBeDefined();
			expect(temporalBreakdown!.total).toBe(1);
			expect(temporalBreakdown!.passed).toBe(0);
			expect(temporalBreakdown!.failed).toBe(1);
			expect(temporalBreakdown!.accuracy).toBe(0.0);
		});

		test("should handle test cases without task type metadata", async () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "Test content" }],
					query: "Test query",
					expected: { answer: "test" },
					// No metadata - should default to "other"
				},
				{
					id: "tc2",
					contexts: [{ content: "Test content" }],
					query: "Test query",
					expected: { answer: "test" },
					metadata: { taskType: "factual" },
				},
			];

			const benchmark = createTestBenchmark("test-breakdown-default", testCases);
			registerTestBenchmark("test-breakdown-default", benchmark);

			const options: RunOptions = {
				benchmarks: ["test-breakdown-default"],
				providers: ["mock"],
				verbose: false,
				restart: true,
				checkpoint: false,
			};

			const result = await run(options);
			const benchmarkResult = result.results.find((r) => r.benchmark === "test-breakdown-default");

			expect(benchmarkResult).toBeDefined();
			expect(benchmarkResult!.breakdownByTaskType).toBeDefined();

			const otherBreakdown = benchmarkResult!.breakdownByTaskType!.find((b) => b.taskType === "other");
			expect(otherBreakdown).toBeDefined();
			expect(otherBreakdown!.total).toBe(1);

			const factualBreakdown = benchmarkResult!.breakdownByTaskType!.find((b) => b.taskType === "factual");
			expect(factualBreakdown).toBeDefined();
			expect(factualBreakdown!.total).toBe(1);
		});
	});

	describe("Runner with Task Type Filtering", () => {
		test("should run only filtered task types when taskTypes option is provided", async () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "User lives in Paris" }],
					query: "Where does the user live?",
					expected: { answer: "Paris" },
					metadata: { taskType: "factual" },
				},
				{
					id: "tc2",
					contexts: [{ content: "User moved in 2023" }],
					query: "When did the user move?",
					expected: { answer: "2023" },
					metadata: { taskType: "temporal" },
				},
				{
					id: "tc3",
					contexts: [{ content: "User likes pizza" }],
					query: "What does the user like?",
					expected: { answer: "pizza" },
					metadata: { taskType: "preference" },
				},
			];

			const benchmark = createTestBenchmark("test-filter", testCases);
			registerTestBenchmark("test-filter", benchmark);

			const options: RunOptions = {
				benchmarks: ["test-filter"],
				providers: ["mock"],
				verbose: false,
				restart: true,
				checkpoint: false,
				taskTypes: ["factual"],
			};

			const result = await run(options);
			const benchmarkResult = result.results.find((r) => r.benchmark === "test-filter");

			expect(benchmarkResult).toBeDefined();
			expect(benchmarkResult!.metrics.total).toBe(1); // Only factual should run
			expect(benchmarkResult!.testCases.length).toBe(1);
			expect(benchmarkResult!.testCases[0]?.testCaseId).toBe("tc1");
		});

		test("should handle multiple task types in filter", async () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "User lives in Paris" }],
					query: "Where does the user live?",
					expected: { answer: "Paris" },
					metadata: { taskType: "factual" },
				},
				{
					id: "tc2",
					contexts: [{ content: "User moved in 2023" }],
					query: "When did the user move?",
					expected: { answer: "2023" },
					metadata: { taskType: "temporal" },
				},
				{
					id: "tc3",
					contexts: [{ content: "User likes pizza" }],
					query: "What does the user like?",
					expected: { answer: "pizza" },
					metadata: { taskType: "preference" },
				},
			];

			const benchmark = createTestBenchmark("test-filter-multi", testCases);
			registerTestBenchmark("test-filter-multi", benchmark);

			const options: RunOptions = {
				benchmarks: ["test-filter-multi"],
				providers: ["mock"],
				verbose: false,
				restart: true,
				checkpoint: false,
				taskTypes: ["factual", "temporal"],
			};

			const result = await run(options);
			const benchmarkResult = result.results.find((r) => r.benchmark === "test-filter-multi");

			expect(benchmarkResult).toBeDefined();
			expect(benchmarkResult!.metrics.total).toBe(2); // factual and temporal
			expect(benchmarkResult!.testCases.length).toBe(2);
			expect(benchmarkResult!.testCases.map((tc) => tc.testCaseId).sort()).toEqual(["tc1", "tc2"]);
		});
	});

	describe("Edge Cases", () => {
		test("should handle empty test case list", async () => {
			const benchmark = createTestBenchmark("test-empty", []);
			registerTestBenchmark("test-empty", benchmark);

			const options: RunOptions = {
				benchmarks: ["test-empty"],
				providers: ["mock"],
				verbose: false,
				restart: true,
				checkpoint: false,
			};

			const result = await run(options);
			const benchmarkResult = result.results.find((r) => r.benchmark === "test-empty");

			expect(benchmarkResult).toBeDefined();
			expect(benchmarkResult!.metrics.total).toBe(0);
			expect(benchmarkResult!.metrics.accuracy).toBe(0);
			expect(benchmarkResult!.testCases.length).toBe(0);
		});

		test("should handle test cases with no search results", async () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "Unrelated content" }],
					query: "Completely different query",
					expected: { answer: "answer" },
				},
			];

			const benchmark = createTestBenchmark("test-no-results", testCases);
			registerTestBenchmark("test-no-results", benchmark);

			const options: RunOptions = {
				benchmarks: ["test-no-results"],
				providers: ["mock"],
				verbose: false,
				restart: true,
				checkpoint: false,
			};

			const result = await run(options);
			const benchmarkResult = result.results.find((r) => r.benchmark === "test-no-results");

			expect(benchmarkResult).toBeDefined();
			expect(benchmarkResult!.metrics.total).toBe(1);
			expect(benchmarkResult!.metrics.passed).toBe(0);
			expect(benchmarkResult!.metrics.failed).toBe(1);
			expect(benchmarkResult!.metrics.accuracy).toBe(0);
		});

		test("should maintain test case order", async () => {
			const testCases: TestCase[] = [
				{
					id: "tc1",
					contexts: [{ content: "First" }],
					query: "Query 1",
					expected: { answer: "first" },
				},
				{
					id: "tc2",
					contexts: [{ content: "Second" }],
					query: "Query 2",
					expected: { answer: "second" },
				},
				{
					id: "tc3",
					contexts: [{ content: "Third" }],
					query: "Query 3",
					expected: { answer: "third" },
				},
			];

			const benchmark = createTestBenchmark("test-order", testCases);
			registerTestBenchmark("test-order", benchmark);

			const options: RunOptions = {
				benchmarks: ["test-order"],
				providers: ["mock"],
				verbose: false,
				restart: true,
				checkpoint: false,
			};

			const result = await run(options);
			const benchmarkResult = result.results.find((r) => r.benchmark === "test-order");

			expect(benchmarkResult).toBeDefined();
			expect(benchmarkResult!.testCases.length).toBe(3);
			expect(benchmarkResult!.testCases[0]?.testCaseId).toBe("tc1");
			expect(benchmarkResult!.testCases[1]?.testCaseId).toBe("tc2");
			expect(benchmarkResult!.testCases[2]?.testCaseId).toBe("tc3");
		});
	});
});

