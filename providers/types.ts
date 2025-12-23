/**
 * Simplified Provider Interface for MemoryBench
 *
 * Providers implement three core methods:
 * - ingest: Store content in the memory system
 * - search: Retrieve relevant content for a query
 * - reset: Clear all stored content (optional)
 */

/**
 * Result returned from a search operation
 */
export interface SearchResult {
	/** Unique identifier for the result */
	id: string;
	/** The content/context that was retrieved */
	content: string;
	/** Relevance score (higher is better, typically 0-1) */
	score: number;
}

/**
 * Result returned from an ingest operation
 */
export interface IngestResult {
	/** Unique identifier for the ingested content */
	id: string;
}

/**
 * Minimal provider interface for memory systems
 *
 * @example
 * ```typescript
 * const myProvider: Provider = {
 *   name: "my-memory",
 *   async ingest(content, meta) {
 *     const id = await myMemorySystem.store(content, meta);
 *     return { id };
 *   },
 *   async search(query, limit = 10) {
 *     return myMemorySystem.query(query, limit);
 *   },
 *   async reset() {
 *     await myMemorySystem.clear();
 *   }
 * };
 * ```
 */
export interface Provider {
	/** Human-readable name for the provider */
	name: string;

	/**
	 * Store content in the memory system
	 * @param content - The text content to store
	 * @param meta - Optional metadata to associate with the content
	 * @returns The ID of the stored content
	 */
	ingest(content: string, meta?: Record<string, unknown>): Promise<IngestResult>;

	/**
	 * Search for relevant content
	 * @param query - The search query
	 * @param limit - Maximum number of results to return (default: 10)
	 * @returns Array of search results sorted by relevance
	 */
	search(query: string, limit?: number): Promise<SearchResult[]>;

	/**
	 * Clear all stored content (optional)
	 * Used to reset state between benchmark runs
	 */
	reset?(): Promise<void>;
}

// =============================================================================
// Legacy Types (for backwards compatibility with existing providers)
// =============================================================================

import type { BenchmarkRegistry, BenchmarkType } from "../benchmarks";

/**
 * @deprecated Use Provider interface instead
 * Legacy prepared data format from existing providers
 */
export interface PreparedData {
	context: string;
	metadata: Record<string, unknown>;
}

/**
 * @deprecated Use Provider interface instead
 * Legacy benchmark processor type
 */
export type BenchmarkProcessor<T extends BenchmarkType> = (
	data: BenchmarkRegistry[T][],
) => PreparedData[];

/**
 * @deprecated Use Provider interface instead
 * Legacy benchmark processors map
 */
export type BenchmarkProcessors = {
	[K in BenchmarkType]?: BenchmarkProcessor<K>;
};

/**
 * @deprecated Use Provider interface instead
 * Legacy provider type used by existing AQRAG and ContextualRetrieval providers
 */
export interface LegacyProvider {
	name: string;
	addContext(data: PreparedData): Promise<void>;
	searchQuery(query: string): Promise<{ id: string; context: string; score: number }[]>;
	prepareProvider<T extends BenchmarkType>(
		benchmarkType: T,
		data: BenchmarkRegistry[T][],
	): PreparedData[];
}

/**
 * Adapter to convert a LegacyProvider to the new Provider interface
 */
export function adaptLegacyProvider(legacy: LegacyProvider): Provider {
	return {
		name: legacy.name,
		async ingest(content: string, meta?: Record<string, unknown>) {
			await legacy.addContext({ context: content, metadata: meta ?? {} });
			// Legacy providers don't return IDs, generate a placeholder
			return { id: `${legacy.name}-${Date.now()}` };
		},
		async search(query: string, _limit?: number) {
			const results = await legacy.searchQuery(query);
			return results.map((r) => ({
				id: r.id,
				content: r.context,
				score: r.score,
			}));
		},
		// Legacy providers don't have reset, so this is a no-op
		async reset() {
			// No-op for legacy providers
		},
	};
}

