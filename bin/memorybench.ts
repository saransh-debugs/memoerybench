#!/usr/bin/env bun
/**
 * MemoryBench CLI
 *
 * Usage:
 *   memorybench run [-b benchmarks...] [-p providers...]
 *   memorybench view [results.json]
 *   memorybench ci --baseline <file>
 */

// Load .env file if it exists
import { existsSync } from "node:fs";

const ENV_FILES = [".env", ".env.local", ".env.development"];
for (const envFile of ENV_FILES) {
	if (existsSync(envFile)) {
		const content = await Bun.file(envFile).text();
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eqIndex = trimmed.indexOf("=");
			if (eqIndex > 0) {
				const key = trimmed.slice(0, eqIndex).trim();
				let value = trimmed.slice(eqIndex + 1).trim();
				// Remove quotes if present
				if ((value.startsWith('"') && value.endsWith('"')) ||
				    (value.startsWith("'") && value.endsWith("'"))) {
					value = value.slice(1, -1);
				}
				// Only set if not already defined
				if (!process.env[key]) {
					process.env[key] = value;
				}
			}
		}
	}
}

// =============================================================================
// Types
// =============================================================================

interface RunOptions {
	benchmarks: string[];
	providers: string[];
	output?: string;
	verbose: boolean;
	restart: boolean;
	taskTypes?: string[];
	filters?: {
		queryLengthMin?: number;
		queryLengthMax?: number;
		queryContains?: string[];
		contextCountMin?: number;
		contextCountMax?: number;
		contextLengthMin?: number;
		contextLengthMax?: number;
	};
	sampling?: {
		count?: number;
		seed?: number;
	};
	preset?: string;
}

interface ViewOptions {
	file?: string;
	port: number;
}

interface CIOptions {
	baseline: string;
	threshold: number;
}

interface AnalyzeOptions {
	benchmark: string;
}

interface PresetOptions {
	action: "create" | "list" | "delete" | "show";
	name?: string;
	description?: string;
	taskTypes?: string[];
	sample?: number;
	seed?: number;
	filters?: string[];
}

type Command = "run" | "list" | "view" | "ci" | "analyze" | "preset" | "help" | "version";

interface ParsedArgs {
	command: Command;
	runOptions: RunOptions;
	viewOptions: ViewOptions;
	ciOptions: CIOptions;
	analyzeOptions: AnalyzeOptions;
	presetOptions: PresetOptions;
}

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs(argv: string[]): ParsedArgs {
	const args = argv.slice(2); // Skip bun and script path

	const result: ParsedArgs = {
		command: "help",
		runOptions: {
			benchmarks: [],
			providers: [],
			verbose: false,
			restart: false,
			filters: {},
			sampling: {},
		},
		viewOptions: {
			port: 3000,
		},
		ciOptions: {
			baseline: "",
			threshold: 5, // 5% regression threshold
		},
		analyzeOptions: {
			benchmark: "",
		},
		presetOptions: {
			action: "list",
			filters: [],
		},
	};

	if (args.length === 0) {
		result.command = "help";
		return result;
	}

	// First arg is the command
	const cmd = args[0]?.toLowerCase();
	// Support both "run" and "eval" commands (eval matches spec)
	if (cmd === "eval") {
		result.command = "run"; // Map eval to run internally
	} else if (cmd === "run" || cmd === "list" || cmd === "view" || cmd === "ci" || cmd === "analyze" || cmd === "preset" || cmd === "help" || cmd === "version") {
		result.command = cmd;
	} else if (cmd === "-h" || cmd === "--help") {
		result.command = "help";
		return result;
	} else if (cmd === "-v" || cmd === "--version") {
		result.command = "version";
		return result;
	} else {
		// Unknown command, show help
		console.error(`Unknown command: ${cmd}`);
		result.command = "help";
		return result;
	}

	// Parse remaining args
	let i = 1;
	while (i < args.length) {
		const arg = args[i]!;

		switch (arg) {
			case "-b":
			case "--benchmarks": {
				i++;
				// Collect all values until next option
				while (i < args.length && !args[i]!.startsWith("-")) {
					result.runOptions.benchmarks.push(args[i]!);
					i++;
				}
				break;
			}

			case "-p":
			case "--providers": {
				i++;
				// Collect all values until next option
				while (i < args.length && !args[i]!.startsWith("-")) {
					result.runOptions.providers.push(args[i]!);
					i++;
				}
				break;
			}

			case "-o":
			case "--output": {
				i++;
				result.runOptions.output = args[i];
				i++;
				break;
			}

			case "--verbose": {
				result.runOptions.verbose = true;
				i++;
				break;
			}

			case "--restart": {
				result.runOptions.restart = true;
				i++;
				break;
			}

			case "--baseline": {
				i++;
				result.ciOptions.baseline = args[i] ?? "";
				i++;
				break;
			}

			case "--threshold": {
				i++;
				result.ciOptions.threshold = Number.parseFloat(args[i] ?? "5");
				i++;
				break;
			}

			case "--port": {
				i++;
				result.viewOptions.port = Number.parseInt(args[i] ?? "3000", 10);
				i++;
				break;
			}

			case "--task-types": {
				i++;
				const taskTypesStr = args[i];
				if (taskTypesStr) {
					result.runOptions.taskTypes = taskTypesStr.split(",").map(t => t.trim());
				}
				i++;
				break;
			}

			case "--filter": {
				i++;
				const filterStr = args[i];
				if (filterStr) {
					// Parse filter key=value
					const eqIdx = filterStr.indexOf("=");
					if (eqIdx > 0) {
						const key = filterStr.substring(0, eqIdx);
						const value = filterStr.substring(eqIdx + 1);
						
						switch (key) {
							case "query-length-min":
								result.runOptions.filters!.queryLengthMin = parseInt(value, 10);
								break;
							case "query-length-max":
								result.runOptions.filters!.queryLengthMax = parseInt(value, 10);
								break;
							case "context-count-min":
								result.runOptions.filters!.contextCountMin = parseInt(value, 10);
								break;
							case "context-count-max":
								result.runOptions.filters!.contextCountMax = parseInt(value, 10);
								break;
							case "context-length-min":
								result.runOptions.filters!.contextLengthMin = parseInt(value, 10);
								break;
							case "context-length-max":
								result.runOptions.filters!.contextLengthMax = parseInt(value, 10);
								break;
							case "query-contains":
								if (!result.runOptions.filters!.queryContains) {
									result.runOptions.filters!.queryContains = [];
								}
								result.runOptions.filters!.queryContains.push(value);
								break;
						}
					}
				}
				i++;
				break;
			}

			case "--sample": {
				i++;
				result.runOptions.sampling!.count = parseInt(args[i] ?? "0", 10);
				i++;
				break;
			}

			case "--seed": {
				i++;
				result.runOptions.sampling!.seed = parseInt(args[i] ?? "0", 10);
				i++;
				break;
			}

			case "--preset": {
				i++;
				result.runOptions.preset = args[i];
				i++;
				break;
			}

			default: {
				// Positional argument (e.g., file path for view)
				if (!arg.startsWith("-")) {
					if (result.command === "view") {
						result.viewOptions.file = arg;
					} else if (result.command === "analyze") {
						result.analyzeOptions.benchmark = arg;
					} else if (result.command === "preset") {
						// First positional arg is action
						if (!result.presetOptions.action || result.presetOptions.action === "list") {
							result.presetOptions.action = arg as any;
						} else if (!result.presetOptions.name) {
							result.presetOptions.name = arg;
						}
					}
				}
				i++;
				break;
			}
		}
	}

	return result;
}

// =============================================================================
// Commands
// =============================================================================

function showHelp(): void {
	console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                        MEMORYBENCH                                 ║
║           Memory Agent Benchmarking Platform                       ║
╚═══════════════════════════════════════════════════════════════════╝

Usage:
  memorybench <command> [options]

Commands:
  run     Run benchmarks against memory providers (alias: eval)
  eval    Run benchmarks against memory providers (alias for run)
  list    List available providers and benchmarks (auto-discovered!)
  view    Start dashboard to view results
  ci      CI mode with regression detection
  analyze Analyze benchmark composition
  preset  Manage sampling presets (create, list, show, delete)
  help    Show this help message
  version Show version

Run Options:
  -b, --benchmarks <names...>  Benchmarks to run (default: auto-detect)
  -p, --providers <names...>   Providers to test (default: auto-detect)
  -o, --output <path>          Output file path (default: results/run-<date>.json)
  --task-types <types>         Filter by task types (comma-separated, e.g., "multi-hop,temporal")
  --filter <key=value>         Add filter (can be repeated)
                               Keys: query-length-min, query-length-max, 
                                     context-count-min, context-count-max,
                                     context-length-min, context-length-max,
                                     query-contains
  --sample <count>             Sample N test cases
  --seed <number>              Random seed for reproducible sampling
  --preset <name>              Use saved preset configuration
  --verbose                    Show detailed output
  --restart                    Ignore checkpoint and start fresh

View Options:
  [file]                       Results file to view (default: latest)
  --port <number>              Port for dashboard server (default: 3000)

CI Options:
  --baseline <file>            Baseline results file for comparison
  --threshold <percent>        Regression threshold (default: 5%)

Preset Options:
  preset create <name>         Create a new preset (use with other options)
  preset list                  List all presets
  preset show <name>           Show preset details
  preset delete <name>         Delete a preset

Examples:
  # Zero config - just run
  memorybench run
  # Or use eval (matches spec)
  memorybench eval

  # Run specific benchmarks with specific providers
  memorybench run -b LoCoMo quicktest -p supermemory mock
  memorybench eval -b LoCoMo quicktest -p supermemory mock

  # Run with task type filtering
  memorybench run -b locomo -p mock --task-types multi-hop,temporal

  # Run with filters
  memorybench run -b locomo -p mock \\
    --filter query-length-min=20 \\
    --filter context-count-min=3

  # Run with sampling
  memorybench run -b locomo -p mock --sample 100 --seed 42

  # Run with preset
  memorybench run -b locomo -p mock --preset multihop-focus

  # Create preset
  memorybench preset create "multihop-focus" \\
    --task-types multi-hop \\
    --sample 100 \\
    --seed 42

  # List presets
  memorybench preset list

  # Analyze benchmark composition
  memorybench analyze locomo

  # View results
  memorybench view results/run-2025-01-15.json

  # CI mode
  memorybench ci --baseline results/main.json
`);
}

function showVersion(): void {
	// Read version from package.json
	console.log("memorybench v0.1.0");
}

async function listCommand(): Promise<void> {
	const { listProviders, listBenchmarks, getAvailableProviders } = await import("../runner/index.js");

	const [providers, benchmarks, available] = await Promise.all([
		listProviders(),
		listBenchmarks(),
		getAvailableProviders(),
	]);

	const availableSet = new Set(available);

	console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    MEMORYBENCH LIST                                ║
║             ✨ Auto-discovered providers & benchmarks              ║
╚═══════════════════════════════════════════════════════════════════╝
`);

	console.log("📦 PROVIDERS");
	console.log("─".repeat(60));
	for (const p of providers) {
		const status = availableSet.has(p.name) ? "✅" : "❌";
		const envInfo = p.requiresEnv?.length ? ` (needs: ${p.requiresEnv.join(", ")})` : "";
		console.log(`  ${status} ${p.name.padEnd(20)} ${p.description ?? ""}${envInfo}`);
	}

	console.log("\n📊 BENCHMARKS");
	console.log("─".repeat(60));
	for (const b of benchmarks) {
		const tests = b.testCaseCount ? `${b.testCaseCount} tests` : "";
		const time = b.estimatedTimeMs ? `, ~${Math.round(b.estimatedTimeMs / 1000)}s` : "";
		console.log(`  ✅ ${b.name.padEnd(20)} ${b.description ?? ""} (${tests}${time})`);
	}

	console.log(`
─────────────────────────────────────────────────────────────────────
✨ To add a provider: create providers/YOUR_NAME/index.ts with meta + createYourNameProvider()
✨ To add a benchmark: create benchmarks/YOUR_NAME/index.ts with meta + createYourNameBenchmark()
`);
}

async function runCommand(options: RunOptions): Promise<void> {
	console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                     MEMORYBENCH RUN                                ║
╚═══════════════════════════════════════════════════════════════════╝
`);

	// Import runner dynamically to avoid circular dependencies
	try {
		const { run } = await import("../runner/index.js");

		// Apply preset if specified
		let finalOptions = { ...options };
		if (options.preset) {
			const presets = await import("../runner/presets.js");
			const preset = await presets.getPreset(options.preset);

			if (!preset) {
				console.error(`❌ Preset "${options.preset}" not found`);
				console.error("\n💡 Use 'memorybench preset list' to see available presets");
				process.exit(1);
			}

			console.log(`📋 Using preset: ${preset.name}`);
			if (preset.description) {
				console.log(`   ${preset.description}`);
			}
			console.log();

			// Merge preset with options (CLI options take precedence)
			const presetOpts = presets.presetToOptions(preset);
			finalOptions = {
				...finalOptions,
				taskTypes: finalOptions.taskTypes || presetOpts.taskTypes,
				filters: {
					...presetOpts.filters,
					...finalOptions.filters,
				},
				sampling: {
					...presetOpts.sampling,
					...finalOptions.sampling,
				},
			};
		}

		// Convert CLI filter format to runner format
		const runnerOptions: any = {
			benchmarks: finalOptions.benchmarks,
			providers: finalOptions.providers,
			output: finalOptions.output,
			verbose: finalOptions.verbose,
			restart: finalOptions.restart,
			taskTypes: finalOptions.taskTypes,
		};

		// Build filters
		if (finalOptions.filters && Object.keys(finalOptions.filters).length > 0) {
			runnerOptions.filters = {};
			const f = finalOptions.filters;

			if (f.queryLengthMin !== undefined || f.queryLengthMax !== undefined) {
				runnerOptions.filters.queryLength = {
					min: f.queryLengthMin,
					max: f.queryLengthMax,
				};
			}
			if (f.contextCountMin !== undefined || f.contextCountMax !== undefined) {
				runnerOptions.filters.contextCount = {
					min: f.contextCountMin,
					max: f.contextCountMax,
				};
			}
			if (f.contextLengthMin !== undefined || f.contextLengthMax !== undefined) {
				runnerOptions.filters.contextLength = {
					min: f.contextLengthMin,
					max: f.contextLengthMax,
				};
			}
			if (f.queryContains) {
				runnerOptions.filters.queryContains = f.queryContains;
			}
		}

		// Build sampling
		if (finalOptions.sampling && (finalOptions.sampling.count || finalOptions.sampling.seed)) {
			runnerOptions.sampling = finalOptions.sampling;
		}

		await run(runnerOptions);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
			console.log("Runner not yet implemented. Options received:");
			console.log(`  Benchmarks: ${options.benchmarks.length > 0 ? options.benchmarks.join(", ") : "(auto-detect)"}`);
			console.log(`  Providers:  ${options.providers.length > 0 ? options.providers.join(", ") : "(auto-detect)"}`);
			console.log(`  Output:     ${options.output ?? "(default)"}`);
			console.log(`  Verbose:    ${options.verbose}`);
			console.log("\n→ Next step: Implement runner/index.ts");
			process.exit(1);
		} else {
			await handleError(error, "run");
			process.exit(await getExitCode(error));
		}
	}
}

async function viewCommand(options: ViewOptions): Promise<void> {
	console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    MEMORYBENCH VIEW                                ║
╚═══════════════════════════════════════════════════════════════════╝
`);

	try {
		const { startViewer } = await import("../viewer/server.js");
		await startViewer(options);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
			console.log("Viewer not yet implemented. Options received:");
			console.log(`  File: ${options.file ?? "(latest)"}`);
			console.log(`  Port: ${options.port}`);
			console.log("\n→ Next step: Implement viewer/server.ts");
			process.exit(1);
		} else {
			await handleError(error, "view");
			process.exit(await getExitCode(error));
		}
	}
}

async function ciCommand(options: CIOptions): Promise<void> {
	if (!options.baseline) {
		console.error("❌ Error: --baseline is required for CI mode");
		console.error("\n💡 Usage: memorybench ci --baseline results/baseline.json");
		console.error("\n   Example:");
		console.error("     memorybench ci --baseline results/main.json --threshold 5");
		process.exit(1);
	}

	try {
		const { runCI } = await import("../ci/regression.js");
		const passed = await runCI({
			baseline: options.baseline,
			threshold: options.threshold,
		});
		process.exit(passed ? 0 : 1);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
			console.log("CI module not found. Options received:");
			console.log(`  Baseline:  ${options.baseline}`);
			console.log(`  Threshold: ${options.threshold}%`);
			process.exit(1);
		} else {
			await handleError(error, "ci");
			process.exit(await getExitCode(error));
		}
	}
}

async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
	if (!options.benchmark) {
		console.error("❌ Error: Benchmark name is required");
		console.error("\n💡 Usage: memorybench analyze <benchmark-name>");
		console.error("\n   Example:");
		console.error("     memorybench analyze locomo");
		process.exit(1);
	}

	try {
		const { analyzeBenchmark } = await import("../runner/analyze.js");
		await analyzeBenchmark(options.benchmark);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
			console.log("Analyze module not found. Benchmark:", options.benchmark);
			process.exit(1);
		} else {
			await handleError(error, "analyze");
			process.exit(await getExitCode(error));
		}
	}
}

async function presetCommand(options: PresetOptions): Promise<void> {
	try {
		const presets = await import("../runner/presets.js");

		switch (options.action) {
			case "list": {
				const allPresets = await presets.listPresets();
				const builtIn = presets.getBuiltInPresets().map(p => p.name);

				console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    SAMPLING PRESETS                                ║
╚═══════════════════════════════════════════════════════════════════╝
`);

				if (allPresets.length === 0) {
					console.log("No presets found. Use 'memorybench preset create' to create one.\n");
				} else {
					for (const preset of allPresets) {
						const type = builtIn.includes(preset.name) ? "[built-in]" : "[custom]";
						console.log(`  ${preset.name.padEnd(25)} ${type}`);
						if (preset.description) {
							console.log(`    ${preset.description}`);
						}
					}
					console.log();
				}
				break;
			}

			case "show": {
				if (!options.name) {
					console.error("❌ Error: Preset name is required");
					console.error("\n💡 Usage: memorybench preset show <name>");
					process.exit(1);
				}

				const preset = await presets.getPreset(options.name);
				if (!preset) {
					console.error(`❌ Preset "${options.name}" not found`);
					console.error("\n💡 Use 'memorybench preset list' to see available presets");
					process.exit(1);
				}

				console.log(`\nPreset: ${preset.name}`);
				if (preset.description) {
					console.log(`Description: ${preset.description}`);
				}
				console.log("\nConfiguration:");
				console.log(JSON.stringify(preset, null, 2));
				console.log();
				break;
			}

			case "create": {
				if (!options.name) {
					console.error("❌ Error: Preset name is required");
					console.error("\n💡 Usage: memorybench preset create <name> [options]");
					process.exit(1);
				}

				// Build preset config from options
				const config: any = {
					name: options.name,
					description: options.description,
				};

				if (options.taskTypes && options.taskTypes.length > 0) {
					config.taskTypes = options.taskTypes;
				}

				if (options.sample || options.seed) {
					config.sampling = {};
					if (options.sample) config.sampling.count = options.sample;
					if (options.seed) config.sampling.seed = options.seed;
				}

				await presets.savePreset(config);
				console.log(`\n✅ Preset "${options.name}" created successfully`);
				console.log(`\n   Use with: memorybench run --preset ${options.name}\n`);
				break;
			}

			case "delete": {
				if (!options.name) {
					console.error("❌ Error: Preset name is required");
					console.error("\n💡 Usage: memorybench preset delete <name>");
					process.exit(1);
				}

				const deleted = await presets.deletePreset(options.name);
				if (deleted) {
					console.log(`\n✅ Preset "${options.name}" deleted successfully\n`);
				} else {
					console.error(`❌ Preset "${options.name}" not found`);
					process.exit(1);
				}
				break;
			}

			default:
				console.error(`❌ Unknown preset action: ${options.action}`);
				console.error("\n💡 Valid actions: create, list, show, delete");
				process.exit(1);
		}
	} catch (error) {
		await handleError(error, "preset");
		process.exit(await getExitCode(error));
	}
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
	const parsed = parseArgs(Bun.argv);

	switch (parsed.command) {
		case "run":
			await runCommand(parsed.runOptions);
			break;
		case "list":
			await listCommand();
			break;
		case "view":
			await viewCommand(parsed.viewOptions);
			break;
		case "ci":
			await ciCommand(parsed.ciOptions);
			break;
		case "analyze":
			await analyzeCommand(parsed.analyzeOptions);
			break;
		case "preset":
			await presetCommand(parsed.presetOptions);
			break;
		case "version":
			showVersion();
			break;
		case "help":
		default:
			showHelp();
			break;
	}
}

// =============================================================================
// Error Handling
// =============================================================================

async function handleError(error: unknown, command: string): Promise<void> {
	// Try to import error handling utilities
	let MemoryBenchError: any;
	let ErrorCode: any;
	try {
		const errorsModule = await import("../runner/errors.js");
		MemoryBenchError = errorsModule.MemoryBenchError;
		ErrorCode = errorsModule.ErrorCode;
	} catch {
		// Fallback if error module not available
	}

	// Check if it's a MemoryBenchError
	if (MemoryBenchError && error instanceof MemoryBenchError) {
		const memError = error as InstanceType<typeof MemoryBenchError>;
		console.error(`\n❌ Error (Code ${memError.code}): ${memError.message}`);

		if (memError.actionable && memError.actionable.length > 0) {
			console.error("\n💡 Suggestions:");
			for (const action of memError.actionable) {
				console.error(`   • ${action}`);
			}
		}

		if (memError.context && Object.keys(memError.context).length > 0) {
			console.error("\n📋 Context:");
			for (const [key, value] of Object.entries(memError.context)) {
				console.error(`   ${key}: ${value}`);
			}
		}

		// Provide command-specific help
		console.error(`\n🔧 Command: memorybench ${command}`);
		if (command === "run") {
			console.error("   Try: memorybench list  # to see available providers/benchmarks");
			console.error("   Try: memorybench run --verbose  # for more details");
		}

		return;
	}

	// Handle Node.js errors
	if (error instanceof Error) {
		const nodeError = error as NodeJS.ErrnoException;

		// File system errors
		if (nodeError.code === "ENOENT") {
			console.error(`\n❌ File not found: ${nodeError.message}`);
			console.error("\n💡 Suggestions:");
			console.error("   • Check that the file path is correct");
			console.error("   • Verify file permissions");
			return;
		}

		if (nodeError.code === "EACCES") {
			console.error(`\n❌ Permission denied: ${nodeError.message}`);
			console.error("\n💡 Suggestions:");
			console.error("   • Check file/directory permissions");
			console.error("   • Run with appropriate user permissions");
			return;
		}

		// Network errors
		if (nodeError.code === "ECONNREFUSED" || nodeError.code === "ENOTFOUND") {
			console.error(`\n❌ Connection error: ${nodeError.message}`);
			console.error("\n💡 Suggestions:");
			console.error("   • Check your network connection");
			console.error("   • Verify that required services are running");
			console.error("   • Check firewall/proxy settings");
			return;
		}

		// Generic error
		console.error(`\n❌ Error: ${nodeError.message}`);
		if ("stack" in nodeError && nodeError.stack && process.env.DEBUG) {
			console.error("\n📋 Stack trace:");
			console.error(nodeError.stack);
		}
		return;
	}

	// Unknown error type
	console.error("\n❌ An unexpected error occurred:");
	console.error(String(error));
	console.error("\n💡 Try running with --verbose for more details");
}

async function getExitCode(error: unknown): Promise<number> {
	// Try to import error handling utilities
	let MemoryBenchError: any;
	let ErrorCode: any;
	try {
		const errorsModule = await import("../runner/errors.js");
		MemoryBenchError = errorsModule.MemoryBenchError;
		ErrorCode = errorsModule.ErrorCode;
	} catch {
		return 1;
	}

	if (MemoryBenchError && error instanceof MemoryBenchError) {
		// Map error codes to exit codes
		const memError = error as InstanceType<typeof MemoryBenchError>;
		const code = memError.code;
		if (code >= 1000 && code < 2000) return 2; // Provider errors
		if (code >= 2000 && code < 3000) return 3; // Benchmark errors
		if (code >= 3000 && code < 4000) return 4; // Network/transient errors
		if (code >= 4000 && code < 5000) return 5; // Configuration errors
		if (code >= 5000 && code < 6000) return 6; // Checkpoint errors
		if (code >= 6000 && code < 7000) return 7; // File/IO errors
		return 1; // Unknown errors
	}

	return 1;
}

main().catch(async (error) => {
	await handleError(error, "unknown");
	process.exit(await getExitCode(error));
});

