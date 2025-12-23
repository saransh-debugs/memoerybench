import { describe, test, expect } from "bun:test";
import { adaptLegacyProvider } from "../providers/types";
import type { LegacyProvider } from "../providers/types";

describe("adaptLegacyProvider", () => {
	test("should adapt legacy provider to new Provider interface", async () => {
		const legacyProvider: LegacyProvider = {
			name: "test-legacy",
			async addContext(data) {
				// Mock implementation
			},
			async searchQuery(query: string) {
				return [
					{
						id: "1",
						context: "test context",
						score: 0.9,
					},
				];
			},
			prepareProvider() {
				return [];
			},
		};

		const adapted = adaptLegacyProvider(legacyProvider);

		expect(adapted.name).toBe("test-legacy");

		// Test ingest
		const ingestResult = await adapted.ingest("test content", { key: "value" });
		expect(ingestResult).toHaveProperty("id");
		expect(typeof ingestResult.id).toBe("string");

		// Test search
		const searchResults = await adapted.search("test query", 10);
		expect(Array.isArray(searchResults)).toBe(true);
		expect(searchResults.length).toBe(1);
		expect(searchResults[0]).toHaveProperty("id");
		expect(searchResults[0]).toHaveProperty("content");
		expect(searchResults[0]).toHaveProperty("score");
		expect(searchResults[0]!.content).toBe("test context");
		expect(searchResults[0]!.score).toBe(0.9);

		// Test reset (should be no-op)
		if (adapted.reset) {
			await adapted.reset();
			// Reset should complete without throwing
			expect(true).toBe(true);
		}
	});

	test("should handle search with limit parameter", async () => {
		const legacyProvider: LegacyProvider = {
			name: "test-legacy",
			async addContext() {},
			async searchQuery(query: string) {
				return [
					{ id: "1", context: "result 1", score: 0.9 },
					{ id: "2", context: "result 2", score: 0.8 },
					{ id: "3", context: "result 3", score: 0.7 },
				];
			},
			prepareProvider() {
				return [];
			},
		};

		const adapted = adaptLegacyProvider(legacyProvider);
		const results = await adapted.search("query", 2);

		// Legacy providers don't respect limit, so we get all results
		expect(results.length).toBe(3);
	});
});

