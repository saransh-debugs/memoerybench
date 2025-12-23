/**
 * MemZero Provider
 *
 * Integrates with MemZero's memory API for document storage and retrieval.
 * 
 * Required environment variable: MEMZERO_API_KEY
 * 
 * NOTE: API endpoints may need adjustment based on actual MemZero API documentation.
 * Current implementation assumes REST API similar to other memory providers.
 */

import type { Provider, SearchResult, IngestResult } from "../types";
import type { ProviderMeta } from "../../runner/types";

/**
 * Provider metadata for auto-discovery
 */
export const meta: ProviderMeta = {
	name: "memzero",
	description: "MemZero API provider",
	requiresEnv: ["MEMZERO_API_KEY"],
};

// =============================================================================
// Types
// =============================================================================

interface MemZeroConfig {
	apiKey: string;
	baseUrl?: string;
	/** User ID for isolating data */
	userId?: string;
}

interface MemZeroAddResponse {
	id: string;
	status?: string;
	message?: string;
}

interface MemZeroMemory {
	id: string;
	memory: string;
	score?: number;
	metadata?: Record<string, unknown>;
	created_at?: string;
}

interface MemZeroSearchResponse {
	memories?: MemZeroMemory[];
	results?: MemZeroMemory[];
}

// =============================================================================
// Client
// =============================================================================

class MemZeroClient {
	private apiKey: string;
	private baseUrl: string;
	private userId: string;
	private memoryIds: string[] = [];

	constructor(config: MemZeroConfig) {
		this.apiKey = config.apiKey;
		this.baseUrl = config.baseUrl ?? "https://api.mem0.ai/v1";
		this.userId = config.userId ?? `memorybench-${Date.now()}`;
	}

	private async request<T>(
		endpoint: string,
		options: RequestInit = {},
	): Promise<T> {
		const url = `${this.baseUrl}${endpoint}`;

		const response = await fetch(url, {
			...options,
			headers: {
				"Content-Type": "application/json",
				Authorization: `Token ${this.apiKey}`,
				...options.headers,
			},
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`MemZero API error (${response.status}): ${error}`);
		}

		return response.json() as T;
	}

	async addMemory(
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<MemZeroAddResponse> {
		const response = await this.request<MemZeroAddResponse>("/memories/", {
			method: "POST",
			body: JSON.stringify({
				messages: [
					{
						role: "user",
						content: content,
					},
				],
				user_id: this.userId,
				metadata: {
					...metadata,
					source: "memorybench",
				},
			}),
		});

		const id = response.id ?? `mz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		this.memoryIds.push(id);
		// Ensure id is not duplicated - spread response first, then override with our id
		return { ...response, id };
	}

	async search(
		query: string,
		limit: number = 10,
	): Promise<MemZeroMemory[]> {
		const response = await this.request<MemZeroSearchResponse>(
			"/memories/search/",
			{
				method: "POST",
				body: JSON.stringify({
					query,
					user_id: this.userId,
					limit,
				}),
			},
		);

		// Handle both possible response formats
		return response.memories ?? response.results ?? [];
	}

	async deleteMemory(id: string): Promise<void> {
		try {
			await this.request(`/memories/${id}/`, {
				method: "DELETE",
			});
		} catch (error) {
			// Ignore deletion errors (memory may not exist)
			console.warn(`Failed to delete memory ${id}:`, error);
		}
	}

	async reset(): Promise<void> {
		// Delete all memories created in this session
		const deletePromises = this.memoryIds.map((id) =>
			this.deleteMemory(id),
		);
		await Promise.allSettled(deletePromises);
		this.memoryIds = [];

		// Generate new user ID for isolation
		this.userId = `memorybench-${Date.now()}`;
	}

	getMemoryCount(): number {
		return this.memoryIds.length;
	}
}

// =============================================================================
// Provider Factory
// =============================================================================

/**
 * Create a MemZero provider instance
 */
export function createMemZeroProvider(config?: Partial<MemZeroConfig>): Provider {
	const apiKey = config?.apiKey ?? process.env.MEMZERO_API_KEY;

	if (!apiKey) {
		throw new Error(
			"MemZero API key not found. Set MEMZERO_API_KEY environment variable.",
		);
	}

	const client = new MemZeroClient({
		apiKey,
		baseUrl: config?.baseUrl,
		userId: config?.userId,
	});

	return {
		name: "memzero",

		async ingest(content: string, meta?: Record<string, unknown>): Promise<IngestResult> {
			const response = await client.addMemory(content, meta);
			return { id: response.id };
		},

		async search(query: string, limit: number = 10): Promise<SearchResult[]> {
			const results = await client.search(query, limit);

			return results.map((r) => ({
				id: r.id,
				content: r.memory,
				score: r.score ?? 0,
			}));
		},

		async reset(): Promise<void> {
			await client.reset();
		},
	};
}

// Default export
export default createMemZeroProvider;

