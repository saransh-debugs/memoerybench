/**
 * Mock Provider
 *
 * In-memory provider for testing and development.
 * Uses simple TF-IDF-like scoring for search.
 */

import type { Provider, SearchResult, IngestResult } from "../types";
import type { ProviderMeta } from "../../runner/types";

/**
 * Provider metadata for auto-discovery
 */
export const meta: ProviderMeta = {
	name: "mock",
	description: "In-memory mock provider for testing",
	// No requiresEnv - always available
};

interface StoredDocument {
	id: string;
	content: string;
	meta: Record<string, unknown>;
	tokens: Set<string>;
	createdAt: number;
}

/**
 * Create a mock in-memory provider
 */
export function createMockProvider(): Provider {
	const documents = new Map<string, StoredDocument>();
	let idCounter = 0;

	/**
	 * Tokenize content into searchable terms
	 */
	function tokenize(text: string): Set<string> {
		return new Set(
			text
				.toLowerCase()
				.replace(/[^\w\s]/g, " ")
				.split(/\s+/)
				.filter((t) => t.length > 2)
		);
	}

	/**
	 * Calculate similarity score between query and document
	 */
	function calculateScore(queryTokens: Set<string>, doc: StoredDocument): number {
		if (queryTokens.size === 0 || doc.tokens.size === 0) return 0;

		let matches = 0;
		for (const token of queryTokens) {
			if (doc.tokens.has(token)) {
				matches++;
			}
		}

		// Jaccard-like similarity with boost for exact matches
		const union = new Set([...queryTokens, ...doc.tokens]).size;
		const jaccard = matches / union;

		// Boost for higher match ratio in query
		const queryMatchRatio = matches / queryTokens.size;

		return jaccard * 0.4 + queryMatchRatio * 0.6;
	}

	return {
		name: "mock",

		async ingest(content: string, meta?: Record<string, unknown>): Promise<IngestResult> {
			const id = `mock_${++idCounter}_${Date.now()}`;

			documents.set(id, {
				id,
				content,
				meta: meta ?? {},
				tokens: tokenize(content),
				createdAt: Date.now(),
			});

			return { id };
		},

		async search(query: string, limit = 10): Promise<SearchResult[]> {
			const queryTokens = tokenize(query);

			// Score all documents
			const scored: Array<{ doc: StoredDocument; score: number }> = [];
			for (const doc of documents.values()) {
				const score = calculateScore(queryTokens, doc);
				if (score > 0) {
					scored.push({ doc, score });
				}
			}

			// Sort by score descending
			scored.sort((a, b) => b.score - a.score);

			// Return top results
			return scored.slice(0, limit).map(({ doc, score }) => ({
				id: doc.id,
				content: doc.content,
				score,
			}));
		},

		async reset(): Promise<void> {
			documents.clear();
			idCounter = 0;
		},
	};
}

// Default export for convenience
export default createMockProvider;

