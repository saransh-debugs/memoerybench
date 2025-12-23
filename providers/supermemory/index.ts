/**
 * Supermemory Provider
 *
 * Integrates with Supermemory's memory API for document storage and retrieval.
 * https://supermemory.ai/docs
 *
 * Required environment variable: SUPERMEMORY_API_KEY
 */

import Supermemory from "supermemory";
import type { Provider, SearchResult, IngestResult } from "../types";
import type { ProviderMeta } from "../../runner/types";

/**
 * Provider metadata for auto-discovery
 */
export const meta: ProviderMeta = {
	name: "supermemory",
	description: "Supermemory API provider",
	requiresEnv: ["SUPERMEMORY_API_KEY"],
};

// =============================================================================
// Types
// =============================================================================

interface SupermemoryConfig {
	apiKey: string;
	baseUrl?: string;
	/** Container tag for isolating benchmark data */
	containerTag?: string;
}

// =============================================================================
// Provider Factory
// =============================================================================

/**
 * Create a Supermemory provider instance using the official SDK
 */
export function createSupermemoryProvider(config?: Partial<SupermemoryConfig>): Provider {
	const apiKey = config?.apiKey ?? process.env.SUPERMEMORY_API_KEY;

	if (!apiKey) {
		throw new Error(
			"Supermemory API key not found. Set SUPERMEMORY_API_KEY environment variable.",
		);
	}

	const client = new Supermemory({
		apiKey,
		baseURL: config?.baseUrl,
	});

	// Use container tag for isolation between benchmark runs
	let containerTag = config?.containerTag ?? `memorybench-${Date.now()}`;
	const documentIds: string[] = [];

	return {
		name: "supermemory",

		async ingest(content: string, meta?: Record<string, unknown>): Promise<IngestResult> {
			const response = await client.add({
				content,
				containerTag,
				metadata: meta as Record<string, string | number | boolean | string[]> | undefined,
			});

			documentIds.push(response.id);
			return { id: response.id };
		},

		async search(query: string, limit: number = 10): Promise<SearchResult[]> {
			const response = await client.search.execute({
				q: query,
				containerTags: [containerTag],
				limit,
			});

			const results = response.results ?? [];
			return results.map((r: any) => ({
				id: r.id ?? `sm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				content: r.content ?? "",
				score: r.score ?? 0,
			}));
		},

		async reset(): Promise<void> {
			// Delete documents if possible, otherwise just change container tag
			try {
				if (documentIds.length > 0) {
					await client.documents.deleteBulk({
						ids: documentIds,
					});
				}
			} catch {
				// Ignore deletion errors
			}

			// Clear tracked IDs and generate new container tag for isolation
			documentIds.length = 0;
			containerTag = `memorybench-${Date.now()}`;
		},
	};
}

// Default export
export default createSupermemoryProvider;
