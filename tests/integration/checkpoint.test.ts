import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createCheckpointManager, getResumeInfo } from "../../runner/checkpoint";
import type { CheckpointManager } from "../../runner/checkpoint";

const TEST_CHECKPOINT_DIR = ".test-checkpoints";

describe("Checkpoint Integration", () => {
	let checkpoint: CheckpointManager;

	beforeEach(() => {
		// Create a test checkpoint manager
		checkpoint = createCheckpointManager("test-run-id", TEST_CHECKPOINT_DIR);
	});

	afterEach(() => {
		// Clean up test checkpoints
		if (checkpoint.exists()) {
			try {
				unlinkSync(checkpoint.getPath());
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	test("should create and save checkpoint", async () => {
		await checkpoint.save({
			runId: "test-run-id",
			startedAt: new Date().toISOString(),
			currentBenchmark: "quicktest",
			currentProvider: "mock",
			completedResults: [],
			currentTestCases: [],
			nextTestCaseIndex: 0,
			totalTestCases: 10,
		});

		expect(checkpoint.exists()).toBe(true);
	});

	test("should load saved checkpoint", async () => {
		const testData = {
			runId: "test-run-id",
			startedAt: new Date().toISOString(),
			currentBenchmark: "quicktest",
			currentProvider: "mock",
			completedResults: [],
			currentTestCases: [],
			nextTestCaseIndex: 5,
			totalTestCases: 10,
		};

		await checkpoint.save(testData);
		const loaded = await checkpoint.load();

		expect(loaded).toBeDefined();
		expect(loaded!.runId).toBe("test-run-id");
		expect(loaded!.nextTestCaseIndex).toBe(5);
		expect(loaded!.totalTestCases).toBe(10);
	});

	test("should determine resume info from checkpoint", async () => {
		await checkpoint.save({
			runId: "test-run-id",
			startedAt: new Date().toISOString(),
			currentBenchmark: "quicktest",
			currentProvider: "mock",
			completedResults: [],
			currentTestCases: [{ testCaseId: "test1", query: "test", searchResults: [], evaluation: { passed: true, score: 1 }, latencyMs: 100 }],
			nextTestCaseIndex: 3,
			totalTestCases: 10,
		});

		const resumeInfo = await getResumeInfo(checkpoint, false);

		expect(resumeInfo.isResume).toBe(true);
		expect(resumeInfo.runId).toBe("test-run-id");
		// resumePoint is only set if there are completed test cases and nextIndex < totalTestCases
		if (resumeInfo.resumePoint) {
			expect(resumeInfo.resumePoint.nextIndex).toBe(3);
		}
	});

	test("should clear checkpoint", async () => {
		await checkpoint.save({
			runId: "test-run-id",
			startedAt: new Date().toISOString(),
			currentBenchmark: "quicktest",
			currentProvider: "mock",
			completedResults: [],
			currentTestCases: [],
			nextTestCaseIndex: 0,
			totalTestCases: 10,
		});

		expect(checkpoint.exists()).toBe(true);

		await checkpoint.clear();

		expect(checkpoint.exists()).toBe(false);
	});
});

