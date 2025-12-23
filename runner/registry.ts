/**
 * Provider and Benchmark Registry
 *
 * Extensible registry with AUTO-DISCOVERY! 🪄
 * 
 * How it works:
 * 1. Drop a folder in providers/ or benchmarks/
 * 2. Export `meta` object and a `create*` function from index.ts
 * 3. It just works™
 * 
 * Manual registration is still supported for edge cases.
 */

import type { Provider } from "../providers/types";
import type { Benchmark, TestCase, EvaluationResult } from "../benchmarks/types";
import type { SearchResult } from "../providers/types";
import type { ProviderFactory, BenchmarkFactory, ProviderMeta, BenchmarkMeta } from "./types";
import { runAutoDiscovery } from "./discovery";

// =============================================================================
// Provider Registry
// =============================================================================

const providerRegistry = new Map<string, ProviderFactory>();

/**
 * Register a provider factory (manual registration)
 */
export function registerProvider(name: string, factory: ProviderFactory): void {
	providerRegistry.set(name.toLowerCase(), factory);
}

/**
 * Get a provider by name
 */
export async function getProvider(name: string): Promise<Provider | null> {
	// Ensure auto-discovery has run
	await ensureDiscovery();

	const factory = providerRegistry.get(name.toLowerCase());
	if (!factory) return null;

	// Check required env vars
	if (factory.meta.requiresEnv) {
		const missing = factory.meta.requiresEnv.filter((env) => !process.env[env]);
		if (missing.length > 0) {
			console.warn(`Provider "${name}" missing env vars: ${missing.join(", ")}`);
			return null;
		}
	}

	return factory.create();
}

/**
 * List all registered providers
 */
export async function listProviders(): Promise<ProviderMeta[]> {
	await ensureDiscovery();
	return Array.from(providerRegistry.values()).map((f) => f.meta);
}

/**
 * Check which providers are available (have required env vars)
 */
export async function getAvailableProviders(): Promise<string[]> {
	await ensureDiscovery();
	
	const available: string[] = [];
	for (const [name, factory] of providerRegistry) {
		if (!factory.meta.requiresEnv || factory.meta.requiresEnv.every((env) => process.env[env])) {
			available.push(name);
		}
	}
	return available;
}

// =============================================================================
// Benchmark Registry
// =============================================================================

const benchmarkRegistry = new Map<string, BenchmarkFactory>();

/**
 * Register a benchmark factory (manual registration)
 */
export function registerBenchmark(name: string, factory: BenchmarkFactory): void {
	benchmarkRegistry.set(name.toLowerCase(), factory);
}

/**
 * Get a benchmark by name
 */
export async function getBenchmark(name: string): Promise<Benchmark | null> {
	await ensureDiscovery();
	
	const factory = benchmarkRegistry.get(name.toLowerCase());
	if (!factory) return null;
	
	try {
		return factory.create();
	} catch (error) {
		// Some benchmarks (like LongMemEval) intentionally throw errors
		// because they use a different execution model
		// Return null to indicate the benchmark couldn't be loaded
		return null;
	}
}

/**
 * List all registered benchmarks
 */
export async function listBenchmarks(): Promise<BenchmarkMeta[]> {
	await ensureDiscovery();
	return Array.from(benchmarkRegistry.values()).map((f) => f.meta);
}

// =============================================================================
// Auto-Discovery Integration
// =============================================================================

let discoveryRun = false;

/**
 * Ensure auto-discovery has been run
 * This is called automatically by get/list functions
 */
async function ensureDiscovery(): Promise<void> {
	if (discoveryRun) return;
	
	const { providers, benchmarks } = await runAutoDiscovery();
	
	// Merge discovered items into registries
	// Manual registrations take precedence (existing entries not overwritten)
	for (const [name, factory] of providers) {
		if (!providerRegistry.has(name)) {
			providerRegistry.set(name, factory);
		}
	}
	
	for (const [name, factory] of benchmarks) {
		if (!benchmarkRegistry.has(name)) {
			benchmarkRegistry.set(name, factory);
		}
	}
	
	discoveryRun = true;
}

/**
 * Force re-run discovery (useful for hot-reload scenarios)
 */
export async function refreshDiscovery(): Promise<void> {
	discoveryRun = false;
	await ensureDiscovery();
}

// =============================================================================
// Legacy Provider Registrations (for backwards compatibility)
// =============================================================================

// These will be overridden by auto-discovered versions if they export meta

// Legacy AQRAG provider (adapts existing implementation)
// Note: Requires PostgreSQL with pgvector extension
registerProvider("aqrag", {
	create: async () => {
		const { default: AQRAGProvider } = await import("../providers/AQRAG/index.js");
		const { adaptLegacyProvider } = await import("../providers/types.js");
		return adaptLegacyProvider(AQRAGProvider);
	},
	meta: {
		name: "aqrag",
		description: "AQRAG (Question-Enhanced RAG) provider - requires PostgreSQL + pgvector",
		requiresEnv: ["DATABASE_URL"],
	},
});

// Legacy ContextualRetrieval provider (adapts existing implementation)
registerProvider("contextualretrieval", {
	create: async () => {
		const { default: ContextualRetrievalProvider } = await import("../providers/ContextualRetrieval/index.js");
		const { adaptLegacyProvider } = await import("../providers/types.js");
		return adaptLegacyProvider(ContextualRetrievalProvider);
	},
	meta: {
		name: "contextualretrieval",
		description: "Contextual Retrieval provider - requires PostgreSQL + pgvector",
		requiresEnv: ["DATABASE_URL"],
	},
});

// RAG template benchmark (legacy, uses index.ts not benchmark.ts)
// Will be auto-discovered if meta is added to index.ts

// LongMemEval benchmark - uses a different execution model (scripts)
// Not compatible with the unified runner interface yet

// =============================================================================
// Dynamic Registration Helpers
// =============================================================================

/**
 * Register a custom provider from a module path
 */
export async function registerProviderFromPath(
	name: string,
	modulePath: string,
	meta?: Partial<ProviderMeta>,
): Promise<void> {
	registerProvider(name, {
		create: async () => {
			const module = await import(modulePath);
			if (module.default && typeof module.default.ingest === "function") {
				return module.default as Provider;
			}
			if (typeof module.createProvider === "function") {
				return module.createProvider() as Provider;
			}
			throw new Error(`Module ${modulePath} does not export a valid provider`);
		},
		meta: {
			name,
			description: meta?.description ?? `Custom provider: ${name}`,
			requiresEnv: meta?.requiresEnv,
		},
	});
}

/**
 * Register a custom benchmark from a module path
 */
export async function registerBenchmarkFromPath(
	name: string,
	modulePath: string,
	meta?: Partial<BenchmarkMeta>,
): Promise<void> {
	registerBenchmark(name, {
		create: async () => {
			const module = await import(modulePath);
			if (module.default && typeof module.default.load === "function") {
				return module.default as Benchmark;
			}
			if (typeof module.createBenchmark === "function") {
				return module.createBenchmark() as Benchmark;
			}
			throw new Error(`Module ${modulePath} does not export a valid benchmark`);
		},
		meta: {
			name,
			description: meta?.description ?? `Custom benchmark: ${name}`,
			testCaseCount: meta?.testCaseCount,
			estimatedTimeMs: meta?.estimatedTimeMs,
		},
	});
}

/**
 * Create a simple provider inline (for quick testing)
 */
export function createInlineProvider(config: {
	name: string;
	ingest: Provider["ingest"];
	search: Provider["search"];
	reset?: Provider["reset"];
}): Provider {
	return {
		name: config.name,
		ingest: config.ingest,
		search: config.search,
		reset: config.reset,
	};
}

/**
 * Create a simple benchmark inline (for quick testing)
 */
export function createInlineBenchmark(config: {
	name: string;
	testCases: TestCase[];
	evaluate?: Benchmark["evaluate"];
}): Benchmark {
	return {
		name: config.name,
		load: async () => config.testCases,
		evaluate: config.evaluate ?? ((testCase: TestCase, results: SearchResult[]): EvaluationResult => {
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
		}),
	};
}
