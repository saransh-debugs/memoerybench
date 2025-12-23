/**
 * Checkpoint System
 *
 * Enables resuming benchmark runs from failure.
 * Saves progress after each test case so long runs can be continued.
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { BenchmarkProviderResult, TestCaseResult, RunResult } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface CheckpointData {
	/** Checkpoint version for compatibility */
	version: number;
	/** Run ID this checkpoint belongs to */
	runId: string;
	/** When the run started */
	startedAt: string;
	/** Current benchmark being run */
	currentBenchmark: string;
	/** Current provider being tested */
	currentProvider: string;
	/** Completed benchmark×provider results */
	completedResults: BenchmarkProviderResult[];
	/** Test cases completed for current benchmark×provider */
	currentTestCases: TestCaseResult[];
	/** Index of next test case to run */
	nextTestCaseIndex: number;
	/** Total test cases in current benchmark */
	totalTestCases: number;
	/** Last updated timestamp */
	updatedAt: string;
}

export interface CheckpointManager {
	/** Save checkpoint after each test case */
	save(data: Partial<CheckpointData>): Promise<void>;
	/** Load existing checkpoint */
	load(): Promise<CheckpointData | null>;
	/** Check if checkpoint exists */
	exists(): boolean;
	/** Delete checkpoint (after successful completion) */
	clear(): Promise<void>;
	/** Get checkpoint file path */
	getPath(): string;
}

// =============================================================================
// Checkpoint Manager
// =============================================================================

const CHECKPOINT_VERSION = 1;
const DEFAULT_CHECKPOINT_DIR = ".memorybench";
const CHECKPOINT_FILENAME = "checkpoint.json";

/**
 * Create a checkpoint manager for a run
 */
export function createCheckpointManager(
	runId: string,
	checkpointDir: string = DEFAULT_CHECKPOINT_DIR,
): CheckpointManager {
	const checkpointPath = `${checkpointDir}/${CHECKPOINT_FILENAME}`;

	let currentData: CheckpointData = {
		version: CHECKPOINT_VERSION,
		runId,
		startedAt: new Date().toISOString(),
		currentBenchmark: "",
		currentProvider: "",
		completedResults: [],
		currentTestCases: [],
		nextTestCaseIndex: 0,
		totalTestCases: 0,
		updatedAt: new Date().toISOString(),
	};

	return {
		async save(data: Partial<CheckpointData>): Promise<void> {
			// Merge new data
			currentData = {
				...currentData,
				...data,
				updatedAt: new Date().toISOString(),
			};

			// Ensure directory exists
			await mkdir(checkpointDir, { recursive: true });

			// Write atomically (write to temp, then rename)
			const tempPath = `${checkpointPath}.tmp`;
			await Bun.write(tempPath, JSON.stringify(currentData, null, 2));

			// Rename for atomic update
			const file = Bun.file(tempPath);
			await Bun.write(checkpointPath, await file.text());

			try {
				await Bun.file(tempPath).exists() && (await import("node:fs/promises")).unlink(tempPath);
			} catch {
				// Ignore cleanup errors
			}
		},

		async load(): Promise<CheckpointData | null> {
			if (!existsSync(checkpointPath)) {
				return null;
			}

			try {
				const content = await Bun.file(checkpointPath).text();
				const data = JSON.parse(content) as CheckpointData;

				// Version check
				if (data.version !== CHECKPOINT_VERSION) {
					console.warn(
						`Checkpoint version mismatch (got ${data.version}, expected ${CHECKPOINT_VERSION}). Starting fresh.`,
					);
					return null;
				}

				currentData = data;
				return data;
			} catch (error) {
				console.warn("Failed to load checkpoint:", error);
				return null;
			}
		},

		exists(): boolean {
			return existsSync(checkpointPath);
		},

		async clear(): Promise<void> {
			if (existsSync(checkpointPath)) {
				try {
					const { unlink } = await import("node:fs/promises");
					await unlink(checkpointPath);
				} catch {
					// Ignore errors
				}
			}
		},

		getPath(): string {
			return checkpointPath;
		},
	};
}

// =============================================================================
// Resume Logic
// =============================================================================

export interface ResumeInfo {
	/** Whether we're resuming from a checkpoint */
	isResume: boolean;
	/** Run ID (from checkpoint or new) */
	runId: string;
	/** When the run originally started */
	startedAt: string;
	/** Already completed results to include */
	completedResults: BenchmarkProviderResult[];
	/** Benchmark×provider combinations to skip (already done) */
	skipCombinations: Set<string>;
	/** For partially completed benchmark×provider: where to resume */
	resumePoint?: {
		benchmark: string;
		provider: string;
		completedTestCases: TestCaseResult[];
		nextIndex: number;
	};
}

/**
 * Determine resume state from checkpoint
 */
export async function getResumeInfo(
	checkpoint: CheckpointManager,
	forceRestart: boolean = false,
): Promise<ResumeInfo> {
	if (forceRestart) {
		await checkpoint.clear();
	}

	const data = await checkpoint.load();

	if (!data) {
		// Fresh run
		return {
			isResume: false,
			runId: generateRunId(),
			startedAt: new Date().toISOString(),
			completedResults: [],
			skipCombinations: new Set(),
		};
	}

	// Build skip set from completed results
	const skipCombinations = new Set<string>();
	for (const result of data.completedResults) {
		skipCombinations.add(combinationKey(result.benchmark, result.provider));
	}

	// Check if there's a partially completed benchmark×provider
	let resumePoint: ResumeInfo["resumePoint"];
	if (
		data.currentBenchmark &&
		data.currentProvider &&
		data.currentTestCases.length > 0 &&
		data.nextTestCaseIndex < data.totalTestCases
	) {
		resumePoint = {
			benchmark: data.currentBenchmark,
			provider: data.currentProvider,
			completedTestCases: data.currentTestCases,
			nextIndex: data.nextTestCaseIndex,
		};
	}

	console.log(`\n📂 Resuming from checkpoint`);
	console.log(`   Run ID: ${data.runId}`);
	console.log(`   Started: ${data.startedAt}`);
	console.log(`   Completed: ${data.completedResults.length} benchmark×provider combinations`);
	if (resumePoint) {
		console.log(
			`   Resuming: ${resumePoint.benchmark} × ${resumePoint.provider} at test ${resumePoint.nextIndex + 1}/${data.totalTestCases}`,
		);
	}
	console.log();

	return {
		isResume: true,
		runId: data.runId,
		startedAt: data.startedAt,
		completedResults: data.completedResults,
		skipCombinations,
		resumePoint,
	};
}

// =============================================================================
// Checkpoint-Enabled Runner Helpers
// =============================================================================

/**
 * Create combination key for tracking completed benchmark×provider pairs
 */
export function combinationKey(benchmark: string, provider: string): string {
	return `${benchmark.toLowerCase()}::${provider.toLowerCase()}`;
}

/**
 * Should we skip this combination? (already completed)
 */
export function shouldSkip(
	benchmark: string,
	provider: string,
	resumeInfo: ResumeInfo,
): boolean {
	return resumeInfo.skipCombinations.has(combinationKey(benchmark, provider));
}

/**
 * Get resume point for a specific combination (if any)
 */
export function getResumePoint(
	benchmark: string,
	provider: string,
	resumeInfo: ResumeInfo,
): ResumeInfo["resumePoint"] | undefined {
	if (!resumeInfo.resumePoint) return undefined;

	if (
		resumeInfo.resumePoint.benchmark.toLowerCase() === benchmark.toLowerCase() &&
		resumeInfo.resumePoint.provider.toLowerCase() === provider.toLowerCase()
	) {
		return resumeInfo.resumePoint;
	}

	return undefined;
}

/**
 * Save progress after completing a test case
 */
export async function saveTestCaseProgress(
	checkpoint: CheckpointManager,
	benchmark: string,
	provider: string,
	testCases: TestCaseResult[],
	nextIndex: number,
	totalTestCases: number,
): Promise<void> {
	await checkpoint.save({
		currentBenchmark: benchmark,
		currentProvider: provider,
		currentTestCases: testCases,
		nextTestCaseIndex: nextIndex,
		totalTestCases,
	});
}

/**
 * Save progress after completing a benchmark×provider combination
 */
export async function saveCombinationComplete(
	checkpoint: CheckpointManager,
	result: BenchmarkProviderResult,
	allCompletedResults: BenchmarkProviderResult[],
): Promise<void> {
	await checkpoint.save({
		completedResults: allCompletedResults,
		currentBenchmark: "",
		currentProvider: "",
		currentTestCases: [],
		nextTestCaseIndex: 0,
		totalTestCases: 0,
	});
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
// CLI Integration
// =============================================================================

/**
 * Print checkpoint status
 */
export function printCheckpointStatus(checkpoint: CheckpointManager): void {
	if (checkpoint.exists()) {
		console.log(`\n💾 Checkpoint found: ${checkpoint.getPath()}`);
		console.log(`   Use --restart to ignore and start fresh`);
	}
}

/**
 * Estimate remaining time based on completed test cases
 */
export function estimateRemainingTime(
	completedTestCases: number,
	totalTestCases: number,
	elapsedMs: number,
): string {
	if (completedTestCases === 0) return "calculating...";

	const avgTimePerTest = elapsedMs / completedTestCases;
	const remainingTests = totalTestCases - completedTestCases;
	const remainingMs = avgTimePerTest * remainingTests;

	if (remainingMs < 1000) return "< 1s";
	if (remainingMs < 60000) return `~${Math.round(remainingMs / 1000)}s`;
	if (remainingMs < 3600000) return `~${Math.round(remainingMs / 60000)}m`;
	return `~${(remainingMs / 3600000).toFixed(1)}h`;
}

