/**
 * Results Writer
 *
 * Utilities for saving and loading benchmark results.
 * Supports multiple formats and automatic directory creation.
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import {
	type RunResult,
	type ComparisonResult,
	validateRunResult,
	unwrapVersioned,
	wrapWithVersion,
	SCHEMA_VERSION,
} from "./schema";

// =============================================================================
// Types
// =============================================================================

export type OutputFormat = "json" | "json-pretty" | "ndjson";

export interface WriteOptions {
	/** Output format */
	format?: OutputFormat;
	/** Include schema version wrapper */
	versioned?: boolean;
	/** Create directory if it doesn't exist */
	createDir?: boolean;
	/** Append timestamp to filename */
	appendTimestamp?: boolean;
}

export interface ReadOptions {
	/** Validate against schema */
	validate?: boolean;
}

// =============================================================================
// Writer Functions
// =============================================================================

/**
 * Write run results to a file
 */
export async function writeResults(
	result: RunResult,
	outputPath: string,
	options: WriteOptions = {},
): Promise<string> {
	const {
		format = "json-pretty",
		versioned = true,
		createDir = true,
		appendTimestamp = false,
	} = options;

	// Resolve final path
	let finalPath = outputPath;
	if (appendTimestamp) {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const ext = outputPath.match(/\.[^.]+$/)?.[0] ?? ".json";
		finalPath = outputPath.replace(/\.[^.]+$/, "") + `-${timestamp}${ext}`;
	}

	// Ensure .json extension
	if (!finalPath.endsWith(".json") && !finalPath.endsWith(".ndjson")) {
		finalPath += ".json";
	}

	// Create directory if needed
	if (createDir) {
		const dir = finalPath.substring(0, finalPath.lastIndexOf("/"));
		if (dir && !existsSync(dir)) {
			await mkdir(dir, { recursive: true });
		}
	}

	// Prepare data
	const data = versioned ? wrapWithVersion(result) : result;

	// Format and write
	let content: string;
	switch (format) {
		case "json":
			content = JSON.stringify(data);
			break;
		case "json-pretty":
			content = JSON.stringify(data, null, 2);
			break;
		case "ndjson":
			// Write each test case result on its own line (for streaming processing)
			const lines: string[] = [
				JSON.stringify({ type: "metadata", data: result.metadata }),
				JSON.stringify({ type: "summary", data: result.summary }),
				...result.results.flatMap((r) => [
					JSON.stringify({
						type: "benchmark_start",
						benchmark: r.benchmark,
						provider: r.provider,
					}),
					...r.testCases.map((tc) =>
						JSON.stringify({
							type: "test_case",
							benchmark: r.benchmark,
							provider: r.provider,
							data: tc,
						}),
					),
					JSON.stringify({
						type: "benchmark_end",
						benchmark: r.benchmark,
						provider: r.provider,
						metrics: r.metrics,
					}),
				]),
			];
			content = lines.join("\n");
			break;
		default:
			throw new Error(`Unknown format: ${format}`);
	}

	await Bun.write(finalPath, content);

	return finalPath;
}

/**
 * Read run results from a file
 */
export async function readResults(
	inputPath: string,
	options: ReadOptions = {},
): Promise<RunResult> {
	const { validate = true } = options;

	if (!existsSync(inputPath)) {
		throw new Error(`Results file not found: ${inputPath}`);
	}

	const content = await Bun.file(inputPath).text();
	const data = JSON.parse(content);

	if (validate) {
		return unwrapVersioned(data);
	}

	// Return raw data (assumes it matches RunResult shape)
	if (data.result) {
		return data.result as RunResult;
	}
	return data as RunResult;
}

/**
 * Write comparison results to a file
 */
export async function writeComparison(
	comparison: ComparisonResult,
	outputPath: string,
	options: WriteOptions = {},
): Promise<string> {
	const { format = "json-pretty", createDir = true } = options;

	let finalPath = outputPath;
	if (!finalPath.endsWith(".json")) {
		finalPath += ".json";
	}

	if (createDir) {
		const dir = finalPath.substring(0, finalPath.lastIndexOf("/"));
		if (dir && !existsSync(dir)) {
			await mkdir(dir, { recursive: true });
		}
	}

	const content =
		format === "json"
			? JSON.stringify(comparison)
			: JSON.stringify(comparison, null, 2);

	await Bun.write(finalPath, content);

	return finalPath;
}

// =============================================================================
// Directory Management
// =============================================================================

const DEFAULT_RESULTS_DIR = "results";

/**
 * Get the default results directory
 */
export function getResultsDir(): string {
	return process.env.MEMORYBENCH_RESULTS_DIR ?? DEFAULT_RESULTS_DIR;
}

/**
 * Generate a default output path for a run
 */
export function generateOutputPath(runId?: string): string {
	const dir = getResultsDir();
	const id = runId ?? generateRunId();
	return `${dir}/${id}.json`;
}

/**
 * List all result files in the results directory
 */
export async function listResultFiles(dir?: string): Promise<string[]> {
	const resultsDir = dir ?? getResultsDir();
	
	// Resolve to absolute path to ensure it works regardless of cwd
	const { resolve } = await import("node:path");
	const absoluteResultsDir = resolve(resultsDir);

	console.log(`[listResultFiles] Looking for results in: ${absoluteResultsDir}`);
	console.log(`[listResultFiles] Directory exists: ${existsSync(absoluteResultsDir)}`);

	if (!existsSync(absoluteResultsDir)) {
		console.log(`[listResultFiles] Results directory does not exist: ${absoluteResultsDir}`);
		return [];
	}

	const files: string[] = [];
	const glob = new Bun.Glob("**/*.json");

	for await (const file of glob.scan({ cwd: absoluteResultsDir })) {
		files.push(`${absoluteResultsDir}/${file}`);
	}

	console.log(`[listResultFiles] Found ${files.length} JSON files`);

	// Sort by modification time (newest first)
	const withStats = await Promise.all(
		files.map(async (f) => {
			const stat = await Bun.file(f).stat();
			return {
				path: f,
				mtime: stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime),
			};
		}),
	);

	withStats.sort((a, b) => b.mtime - a.mtime);

	return withStats.map((f) => f.path);
}

/**
 * Get the most recent result file
 */
export async function getLatestResultFile(dir?: string): Promise<string | null> {
	const files = await listResultFiles(dir);
	return files[0] ?? null;
}

/**
 * Load the most recent results
 */
export async function loadLatestResults(dir?: string): Promise<RunResult | null> {
	const latest = await getLatestResultFile(dir);
	if (!latest) return null;
	return readResults(latest);
}

// =============================================================================
// Helpers
// =============================================================================

function generateRunId(): string {
	const now = new Date();
	const date = now.toISOString().split("T")[0];
	const time = now.toTimeString().split(" ")[0]?.replace(/:/g, "");
	const random = Math.random().toString(36).substring(2, 6);
	return `run-${date}-${time}-${random}`;
}

// =============================================================================
// Export Formats
// =============================================================================

/**
 * Export results as Markdown table
 */
export function toMarkdownTable(result: RunResult): string {
	const lines: string[] = [
		`# MemoryBench Results`,
		``,
		`**Run ID:** ${result.metadata.runId}`,
		`**Date:** ${result.metadata.completedAt}`,
		`**Duration:** ${(result.metadata.durationMs / 1000).toFixed(1)}s`,
		``,
		`## Summary`,
		``,
		`| Metric | Value |`,
		`|--------|-------|`,
		`| Total Benchmarks | ${result.summary.totalBenchmarks} |`,
		`| Total Providers | ${result.summary.totalProviders} |`,
		`| Total Test Cases | ${result.summary.totalTestCases} |`,
		`| Overall Accuracy | ${(result.summary.overallAccuracy * 100).toFixed(1)}% |`,
		``,
		`## Results`,
		``,
		`| Benchmark | Provider | Accuracy | Avg Score | P50 Latency |`,
		`|-----------|----------|----------|-----------|-------------|`,
	];

	for (const r of result.results) {
		const accuracy = `${(r.metrics.accuracy * 100).toFixed(1)}%`;
		const score = r.metrics.avgScore.toFixed(3);
		const latency = `${r.metrics.p50LatencyMs.toFixed(0)}ms`;
		lines.push(`| ${r.benchmark} | ${r.provider} | ${accuracy} | ${score} | ${latency} |`);
	}

	return lines.join("\n");
}

/**
 * Export results as CSV
 */
export function toCSV(result: RunResult): string {
	const lines: string[] = [
		"benchmark,provider,total,passed,failed,accuracy,avg_score,p50_latency_ms,p95_latency_ms",
	];

	for (const r of result.results) {
		lines.push(
			[
				r.benchmark,
				r.provider,
				r.metrics.total,
				r.metrics.passed,
				r.metrics.failed,
				r.metrics.accuracy.toFixed(4),
				r.metrics.avgScore.toFixed(4),
				r.metrics.p50LatencyMs.toFixed(0),
				r.metrics.p95LatencyMs.toFixed(0),
			].join(","),
		);
	}

	return lines.join("\n");
}

/**
 * Export detailed test case results as CSV
 */
export function toDetailedCSV(result: RunResult): string {
	const lines: string[] = [
		"benchmark,provider,test_case_id,query,passed,score,latency_ms,error",
	];

	for (const r of result.results) {
		for (const tc of r.testCases) {
			lines.push(
				[
					r.benchmark,
					r.provider,
					tc.testCaseId,
					`"${tc.query.replace(/"/g, '""')}"`,
					tc.evaluation.passed ? "1" : "0",
					tc.evaluation.score.toFixed(4),
					tc.latencyMs.toFixed(0),
					tc.error ? `"${tc.error.replace(/"/g, '""')}"` : "",
				].join(","),
			);
		}
	}

	return lines.join("\n");
}

