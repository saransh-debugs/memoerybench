/**
 * Auto-Discovery System
 *
 * Automatically discovers and registers providers and benchmarks
 * by scanning directories for modules that export `meta` and `create*` functions.
 *
 * This is the "magic" that lets you just drop a folder and have it work!
 */

import { readdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Provider } from "../providers/types";
import type { Benchmark } from "../benchmarks/types";
import type { ProviderMeta, BenchmarkMeta, ProviderFactory, BenchmarkFactory } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Types for discovered modules
// =============================================================================

interface DiscoveredProvider {
	meta: ProviderMeta;
	create: () => Provider | Promise<Provider>;
	path: string;
}

interface DiscoveredBenchmark {
	meta: BenchmarkMeta;
	create: () => Benchmark | Promise<Benchmark>;
	path: string;
}

// =============================================================================
// Provider Discovery
// =============================================================================

/**
 * Scan the providers directory and discover all valid providers
 */
export async function discoverProviders(): Promise<DiscoveredProvider[]> {
	const providersDir = join(__dirname, "../providers");
	const discovered: DiscoveredProvider[] = [];

	try {
		const entries = await readdir(providersDir, { withFileTypes: true });

		for (const entry of entries) {
			// Skip non-directories and special files
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith("_")) continue; // Skip _template, etc.
			if (entry.name === "node_modules") continue;

			const modulePath = join(providersDir, entry.name, "index.js");

			try {
				const module = await import(modulePath);

				// Check if module exports meta and a create function
				if (module.meta && typeof module.meta === "object" && module.meta.name) {
					// Find the create function (createXxxProvider or default)
					const createFn = findCreateProviderFunction(module);

					if (createFn) {
						discovered.push({
							meta: module.meta as ProviderMeta,
							create: createFn,
							path: modulePath,
						});

						console.log(`  ✨ Discovered provider: ${module.meta.name}`);
					}
				}
			} catch (err) {
				// Module doesn't exist or failed to load - skip silently
				// This is expected for directories without index.js
			}
		}
	} catch (err) {
		console.warn("Failed to scan providers directory:", err);
	}

	return discovered;
}

/**
 * Scan the benchmarks directory and discover all valid benchmarks
 */
export async function discoverBenchmarks(): Promise<DiscoveredBenchmark[]> {
	const benchmarksDir = join(__dirname, "../benchmarks");
	const discovered: DiscoveredBenchmark[] = [];

	try {
		const entries = await readdir(benchmarksDir, { withFileTypes: true });

		for (const entry of entries) {
			// Skip non-directories and special files
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith("_")) continue;
			if (entry.name === "node_modules") continue;

			// Try both index.js and benchmark.js (LoCoMo uses benchmark.ts)
			const possiblePaths = [
				join(benchmarksDir, entry.name, "index.js"),
				join(benchmarksDir, entry.name, "benchmark.js"),
			];

			for (const modulePath of possiblePaths) {
				try {
					const module = await import(modulePath);

					// Check if module exports meta and a create function
					if (module.meta && typeof module.meta === "object" && module.meta.name) {
						const meta = module.meta as BenchmarkMeta;
						
						// Skip benchmarks that require separate execution
						if (meta.requiresSeparateExecution) {
							console.log(`  ⏭️  Skipping benchmark: ${meta.name} (requires separate execution)`);
							break; // Found it, don't check other paths
						}
						
						// Find the create function (createXxxBenchmark or default)
						const createFn = findCreateBenchmarkFunction(module);

						if (createFn) {
							discovered.push({
								meta,
								create: createFn,
								path: modulePath,
							});

							console.log(`  ✨ Discovered benchmark: ${meta.name}`);
							break; // Found it, don't check other paths
						}
					}
				} catch (err) {
					// Module doesn't exist or failed to load - try next path
				}
			}
		}
	} catch (err) {
		console.warn("Failed to scan benchmarks directory:", err);
	}

	return discovered;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Find a create function for a provider in a module
 * Looks for: createXxxProvider or default export
 */
function findCreateProviderFunction(
	module: Record<string, unknown>,
): (() => Provider | Promise<Provider>) | null {
	// Look for named create function (createXxxProvider)
	for (const [key, value] of Object.entries(module)) {
		if (
			typeof value === "function" &&
			key.startsWith("create") &&
			key.endsWith("Provider")
		) {
			return value as () => Provider | Promise<Provider>;
		}
	}

	// Fall back to default export if it's a function
	if (typeof module.default === "function") {
		return module.default as () => Provider | Promise<Provider>;
	}

	return null;
}

/**
 * Find a create function for a benchmark in a module
 * Looks for: createXxxBenchmark or default export
 */
function findCreateBenchmarkFunction(
	module: Record<string, unknown>,
): (() => Benchmark | Promise<Benchmark>) | null {
	// Look for named create function (createXxxBenchmark)
	for (const [key, value] of Object.entries(module)) {
		if (
			typeof value === "function" &&
			key.startsWith("create") &&
			key.endsWith("Benchmark")
		) {
			return value as () => Benchmark | Promise<Benchmark>;
		}
	}

	// Fall back to default export if it's a function
	if (typeof module.default === "function") {
		return module.default as () => Benchmark | Promise<Benchmark>;
	}

	return null;
}

/**
 * Convert discovered providers to factory format for registration
 */
export function toProviderFactories(discovered: DiscoveredProvider[]): Map<string, ProviderFactory> {
	const factories = new Map<string, ProviderFactory>();

	for (const provider of discovered) {
		factories.set(provider.meta.name.toLowerCase(), {
			create: provider.create,
			meta: provider.meta,
		});
	}

	return factories;
}

/**
 * Convert discovered benchmarks to factory format for registration
 */
export function toBenchmarkFactories(discovered: DiscoveredBenchmark[]): Map<string, BenchmarkFactory> {
	const factories = new Map<string, BenchmarkFactory>();

	for (const benchmark of discovered) {
		factories.set(benchmark.meta.name.toLowerCase(), {
			create: benchmark.create,
			meta: benchmark.meta,
		});
	}

	return factories;
}

// =============================================================================
// Main Auto-Discovery Entry Point
// =============================================================================

let discoveryComplete = false;
let discoveredProviderFactories: Map<string, ProviderFactory> = new Map();
let discoveredBenchmarkFactories: Map<string, BenchmarkFactory> = new Map();

let discoveryPromise: Promise<{
	providers: Map<string, ProviderFactory>;
	benchmarks: Map<string, BenchmarkFactory>;
}> | null = null;

/**
 * Run auto-discovery (idempotent - only runs once, handles concurrent calls)
 */
export async function runAutoDiscovery(): Promise<{
	providers: Map<string, ProviderFactory>;
	benchmarks: Map<string, BenchmarkFactory>;
}> {
	if (discoveryComplete) {
		return {
			providers: discoveredProviderFactories,
			benchmarks: discoveredBenchmarkFactories,
		};
	}

	// Handle concurrent calls - return existing promise if one is in flight
	if (discoveryPromise) {
		return discoveryPromise;
	}

	discoveryPromise = (async () => {
		console.log("\n Auto-discovering providers and benchmarks...\n");

		const [providers, benchmarks] = await Promise.all([
			discoverProviders(),
			discoverBenchmarks(),
		]);

		discoveredProviderFactories = toProviderFactories(providers);
		discoveredBenchmarkFactories = toBenchmarkFactories(benchmarks);
		discoveryComplete = true;

		console.log(`\nDiscovered ${providers.length} providers, ${benchmarks.length} benchmarks\n`);

		return {
			providers: discoveredProviderFactories,
			benchmarks: discoveredBenchmarkFactories,
		};
	})();

	return discoveryPromise;
}

/**
 * Check if a directory contains a valid provider/benchmark
 * Useful for the CLI to give feedback
 */
export async function validateModule(
	path: string,
	type: "provider" | "benchmark",
): Promise<{ valid: boolean; error?: string }> {
	try {
		const module = await import(path);

		if (!module.meta || typeof module.meta !== "object") {
			return { valid: false, error: "Missing `meta` export" };
		}

		if (!module.meta.name) {
			return { valid: false, error: "meta.name is required" };
		}

		if (type === "provider") {
			const createFn = findCreateProviderFunction(module);
			if (!createFn) {
				return {
					valid: false,
					error: "Missing create function (expected create*Provider or default export)",
				};
			}
		} else {
			const createFn = findCreateBenchmarkFunction(module);
			if (!createFn) {
				return {
					valid: false,
					error: "Missing create function (expected create*Benchmark or default export)",
				};
			}
		}

		return { valid: true };
	} catch (err) {
		return { valid: false, error: `Failed to import: ${err}` };
	}
}

