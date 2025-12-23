/**
 * Zero-Config Defaults
 *
 * Auto-detection logic for providers and benchmarks.
 * Makes `memorybench run` work without any configuration.
 */

import { existsSync } from "node:fs";
import { getAvailableProviders, listBenchmarks } from "./registry";

// =============================================================================
// Types
// =============================================================================

export interface DetectedConfig {
	providers: string[];
	benchmarks: string[];
	output: {
		dir: string;
		format: "json" | "json-pretty";
	};
	/** Reason for each detection */
	reasons: {
		providers: string;
		benchmarks: string;
	};
}

export interface ConfigFile {
	providers?: string[];
	benchmarks?: string[];
	output?: {
		dir?: string;
		format?: "json" | "json-pretty" | "ndjson";
	};
}

// =============================================================================
// Environment Detection
// =============================================================================

/**
 * Detect available providers based on environment variables
 */
export async function detectProviders(): Promise<{ providers: string[]; reason: string }> {
	const available = await getAvailableProviders();

	// Priority order for auto-selection
	const priorityOrder = ["supermemory", "mem0", "memzero", "mock"];

	// Filter to available providers in priority order
	const detected = priorityOrder.filter((p) => available.includes(p));

	// If we have real providers (not just mock), use those
	const realProviders = detected.filter((p) => p !== "mock");

	if (realProviders.length > 0) {
		return {
			providers: realProviders,
			reason: `Auto-detected from environment: ${realProviders.join(", ")}`,
		};
	}

	// Fall back to mock
	if (detected.includes("mock")) {
		return {
			providers: ["mock"],
			reason: "Using mock provider (no API keys found)",
		};
	}

	// Last resort: just mock
	return {
		providers: ["mock"],
		reason: "Default: mock provider",
	};
}

/**
 * Detect available benchmarks
 */
export async function detectBenchmarks(): Promise<{ benchmarks: string[]; reason: string }> {
	// Check for local benchmarks directory
	const localBenchmarksDir = "./benchmarks";
	const hasLocalBenchmarks = existsSync(localBenchmarksDir);

	// Get registered benchmarks
	const registered = await listBenchmarks();
	const registeredNames = registered.map((b) => b.name);

	// If quicktest is available, use it as default
	if (registeredNames.includes("quicktest")) {
		return {
			benchmarks: ["quicktest"],
			reason: "Default: quicktest (fast, 10 questions)",
		};
	}

	// Otherwise use first available
	if (registeredNames.length > 0) {
		return {
			benchmarks: [registeredNames[0]!],
			reason: `Using first available: ${registeredNames[0]}`,
		};
	}

	return {
		benchmarks: [],
		reason: "No benchmarks found",
	};
}

/**
 * Detect output directory
 */
export function detectOutputDir(): string {
	// Check environment variable
	if (process.env.MEMORYBENCH_RESULTS_DIR) {
		return process.env.MEMORYBENCH_RESULTS_DIR;
	}

	// Default
	return "results";
}

// =============================================================================
// Config File Loading
// =============================================================================

const CONFIG_FILENAMES = [
	"memorybench.config.yml",
	"memorybench.config.yaml",
	"memorybench.config.json",
	".memorybenchrc",
	".memorybenchrc.json",
	".memorybenchrc.yml",
];

/**
 * Find and load config file if it exists
 */
export async function loadConfigFile(): Promise<ConfigFile | null> {
	for (const filename of CONFIG_FILENAMES) {
		if (existsSync(filename)) {
			try {
				const content = await Bun.file(filename).text();

				// Parse based on extension
				if (filename.endsWith(".json") || filename.endsWith("rc")) {
					return JSON.parse(content) as ConfigFile;
				}

				if (filename.endsWith(".yml") || filename.endsWith(".yaml")) {
					// Simple YAML parser for basic config
					return parseSimpleYaml(content);
				}
			} catch (error) {
				console.warn(`Failed to load config file ${filename}:`, error);
			}
		}
	}

	return null;
}

/**
 * Simple YAML parser for basic config files
 * Handles: providers: [a, b], benchmarks: [c, d], output: { dir: x }
 */
function parseSimpleYaml(content: string): ConfigFile {
	const config: ConfigFile = {};
	const lines = content.split("\n");

	let currentSection: string | null = null;
	let currentList: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();

		// Skip empty lines and comments
		if (!trimmed || trimmed.startsWith("#")) continue;

		// Check for section start
		if (trimmed.endsWith(":") && !trimmed.includes(" ")) {
			// Save previous section
			if (currentSection && currentList.length > 0) {
				if (currentSection === "providers") config.providers = currentList;
				if (currentSection === "benchmarks") config.benchmarks = currentList;
			}

			currentSection = trimmed.slice(0, -1);
			currentList = [];
			continue;
		}

		// Check for list item
		if (trimmed.startsWith("- ")) {
			const value = trimmed.slice(2).trim();
			currentList.push(value);
			continue;
		}

		// Check for inline list: providers: [a, b, c]
		const inlineMatch = trimmed.match(/^(\w+):\s*\[(.*)\]$/);
		if (inlineMatch) {
			const [, key, values] = inlineMatch;
			const list = values!.split(",").map((v) => v.trim().replace(/['"]/g, ""));
			if (key === "providers") config.providers = list;
			if (key === "benchmarks") config.benchmarks = list;
			continue;
		}

		// Check for key: value
		const kvMatch = trimmed.match(/^(\w+):\s*(.+)$/);
		if (kvMatch) {
			const [, key, value] = kvMatch;
			if (currentSection === "output") {
				// Ensure output object exists
				const output: { dir?: string; format?: "json" | "json-pretty" | "ndjson" } = config.output ?? {};
				if (key === "dir") {
					output.dir = value!.replace(/['"]/g, "");
				}
				if (key === "format") {
					output.format = value as "json" | "json-pretty" | "ndjson";
				}
				config.output = output;
			}
		}
	}

	// Save last section
	if (currentSection && currentList.length > 0) {
		if (currentSection === "providers") config.providers = currentList;
		if (currentSection === "benchmarks") config.benchmarks = currentList;
	}

	return config;
}

// =============================================================================
// Main Detection
// =============================================================================

/**
 * Detect full configuration with zero-config defaults
 */
export async function detectConfig(
	overrides?: Partial<{ providers: string[]; benchmarks: string[] }>,
): Promise<DetectedConfig> {
	// Try to load config file
	const configFile = await loadConfigFile();

	// Detect providers
	let providers: string[];
	let providersReason: string;

	if (overrides?.providers && overrides.providers.length > 0) {
		providers = overrides.providers;
		providersReason = "Specified via CLI";
	} else if (configFile?.providers && configFile.providers.length > 0) {
		providers = configFile.providers;
		providersReason = "From config file";
	} else {
		const detected = await detectProviders();
		providers = detected.providers;
		providersReason = detected.reason;
	}

	// Detect benchmarks
	let benchmarks: string[];
	let benchmarksReason: string;

	if (overrides?.benchmarks && overrides.benchmarks.length > 0) {
		benchmarks = overrides.benchmarks;
		benchmarksReason = "Specified via CLI";
	} else if (configFile?.benchmarks && configFile.benchmarks.length > 0) {
		benchmarks = configFile.benchmarks;
		benchmarksReason = "From config file";
	} else {
		const detected = await detectBenchmarks();
		benchmarks = detected.benchmarks;
		benchmarksReason = detected.reason;
	}

	// Detect output
	const outputDir = configFile?.output?.dir ?? detectOutputDir();
	const outputFormat = configFile?.output?.format ?? "json-pretty";

	return {
		providers,
		benchmarks,
		output: {
			dir: outputDir,
			format: outputFormat === "ndjson" ? "json-pretty" : outputFormat,
		},
		reasons: {
			providers: providersReason,
			benchmarks: benchmarksReason,
		},
	};
}

// =============================================================================
// Display Helpers
// =============================================================================

/**
 * Print detected configuration
 */
export function printDetectedConfig(config: DetectedConfig): void {
	console.log("\n📋 Configuration:");
	console.log(`   Providers:  ${config.providers.join(", ")} (${config.reasons.providers})`);
	console.log(`   Benchmarks: ${config.benchmarks.join(", ")} (${config.reasons.benchmarks})`);
	console.log(`   Output:     ${config.output.dir}/`);
	console.log();
}

/**
 * Check if running in CI environment
 */
export function isCI(): boolean {
	return !!(
		process.env.CI ||
		process.env.GITHUB_ACTIONS ||
		process.env.GITLAB_CI ||
		process.env.CIRCLECI ||
		process.env.JENKINS_URL ||
		process.env.TRAVIS
	);
}

/**
 * Get git info if available
 */
export async function getGitInfo(): Promise<{
	commit?: string;
	branch?: string;
} | null> {
	try {
		const proc = Bun.spawn(["git", "rev-parse", "--short", "HEAD"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const commit = await new Response(proc.stdout).text();

		const branchProc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const branch = await new Response(branchProc.stdout).text();

		return {
			commit: commit.trim() || undefined,
			branch: branch.trim() || undefined,
		};
	} catch {
		return null;
	}
}

