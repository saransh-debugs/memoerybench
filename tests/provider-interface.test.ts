import { describe, test, expect } from "bun:test";
import type { Provider } from "../providers/types";

describe("Provider Interface Compliance", () => {
	test("should have required Provider interface methods", () => {
		const provider: Provider = {
			name: "test-provider",
			async ingest(content: string) {
				return { id: `id-${content}` };
			},
			async search(query: string, limit = 10) {
				return [
					{
						id: "1",
						content: "test content",
						score: 0.9,
					},
				];
			},
		};

		expect(provider.name).toBe("test-provider");
		expect(typeof provider.ingest).toBe("function");
		expect(typeof provider.search).toBe("function");
	});

	test("should support optional reset method", async () => {
		let resetCalled = false;

		const provider: Provider = {
			name: "test-provider",
			async ingest() {
				return { id: "1" };
			},
			async search() {
				return [];
			},
			async reset() {
				resetCalled = true;
			},
		};

		await provider.reset?.();
		expect(resetCalled).toBe(true);
	});

	test("should handle ingest with metadata", async () => {
		const provider: Provider = {
			name: "test-provider",
			async ingest(content: string, meta?: Record<string, unknown>) {
				return { id: `id-${content}-${JSON.stringify(meta)}` };
			},
			async search() {
				return [];
			},
		};

		const result = await provider.ingest("content", { key: "value" });
		expect(result.id).toContain("content");
		expect(result.id).toContain("value");
	});

	test("should handle search with limit", async () => {
		const provider: Provider = {
			name: "test-provider",
			async ingest() {
				return { id: "1" };
			},
			async search(query: string, limit = 10) {
				return Array.from({ length: limit }, (_, i) => ({
					id: `${i}`,
					content: `result ${i}`,
					score: 0.9 - i * 0.1,
				}));
			},
		};

		const results = await provider.search("query", 5);
		expect(results.length).toBe(5);
		expect(results[0]!.score).toBeGreaterThan(results[4]!.score);
	});
});

