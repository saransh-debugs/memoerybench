import { describe, test, expect } from "bun:test";
import { listProviders, listBenchmarks, getProvider, getBenchmark } from "../../runner/registry";

describe("Auto-Discovery Integration", () => {
	test("should discover mock provider", async () => {
		const providers = await listProviders();
		const mockProvider = providers.find((p) => p.name === "mock");

		expect(mockProvider).toBeDefined();
		expect(mockProvider!.name).toBe("mock");
		expect(mockProvider!.description).toBeDefined();
	});

	test("should discover quicktest benchmark", async () => {
		const benchmarks = await listBenchmarks();
		const quicktest = benchmarks.find((b) => b.name === "quicktest");

		expect(quicktest).toBeDefined();
		expect(quicktest!.name).toBe("quicktest");
		expect(quicktest!.description).toBeDefined();
	});

	test("should get provider instance by name", async () => {
		const provider = await getProvider("mock");

		expect(provider).toBeDefined();
		expect(provider!.name).toBe("mock");
		expect(typeof provider!.ingest).toBe("function");
		expect(typeof provider!.search).toBe("function");
	});

	test("should get benchmark instance by name", async () => {
		const benchmark = await getBenchmark("quicktest");

		expect(benchmark).toBeDefined();
		expect(benchmark!.name).toBe("quicktest");
		expect(typeof benchmark!.load).toBe("function");
		expect(typeof benchmark!.evaluate).toBe("function");
	});

	test("should return null for non-existent provider", async () => {
		const provider = await getProvider("nonexistent-provider");

		expect(provider).toBeNull();
	});

	test("should return null for non-existent benchmark", async () => {
		const benchmark = await getBenchmark("nonexistent-benchmark");

		expect(benchmark).toBeNull();
	});
});

