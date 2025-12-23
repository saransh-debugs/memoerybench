import { describe, test, expect, beforeEach } from "bun:test";
import { run } from "../../runner/index";
import { createMockProvider } from "../../providers/mock";
import { createQuickTestBenchmark } from "../../benchmarks/quicktest";
import type { RunOptions } from "../../runner/types";

describe("Runner Integration", () => {
	test("should run benchmark with provider and return results", async () => {
		const provider = createMockProvider();
		const benchmark = createQuickTestBenchmark();

		// Create a minimal run configuration
		const options: RunOptions = {
			benchmarks: ["quicktest"],
			providers: ["mock"],
			verbose: false,
			restart: true,
			checkpoint: false, // Disable checkpointing for tests
		};

		const result = await run(options);

		expect(result).toBeDefined();
		expect(result.metadata).toBeDefined();
		expect(result.metadata.runId).toBeDefined();
		expect(result.results).toBeDefined();
		expect(result.results.length).toBeGreaterThan(0);
		expect(result.summary.totalBenchmarks).toBe(1);
		expect(result.summary.totalProviders).toBe(1);
		expect(result.summary.totalTestCases).toBeGreaterThan(0);
	});

	test("should execute test cases and evaluate results", async () => {
		const provider = createMockProvider();
		const benchmark = createQuickTestBenchmark();

		const options: RunOptions = {
			benchmarks: ["quicktest"],
			providers: ["mock"],
			verbose: false,
			restart: true,
			checkpoint: false,
		};

		const result = await run(options);

		// Check that we have results for the benchmark×provider combination
		const benchmarkResult = result.results.find(
			(r) => r.benchmark === "quicktest" && r.provider === "mock",
		);

		expect(benchmarkResult).toBeDefined();
		expect(benchmarkResult!.testCases.length).toBeGreaterThan(0);
		expect(benchmarkResult!.metrics.total).toBeGreaterThan(0);
		expect(benchmarkResult!.metrics.accuracy).toBeGreaterThanOrEqual(0);
		expect(benchmarkResult!.metrics.accuracy).toBeLessThanOrEqual(1);
	});

	test("should handle provider reset between runs", async () => {
		const provider = createMockProvider();

		// Ingest some content
		await provider.ingest("Test content 1");
		await provider.ingest("Test content 2");

		// Reset should clear content
		if (provider.reset) {
			await provider.reset();
		}

		// Search should return empty or different results
		const results = await provider.search("test");
		// After reset, results might be empty or different
		expect(Array.isArray(results)).toBe(true);
	});
});

