/**
 * MemoryBench Runner
 *
 * Core orchestration for running benchmarks against providers.
 * Executes the benchmark × provider matrix and collects results.
 */

import type { Provider } from "../providers/types";
import type { Benchmark, TestCase } from "../benchmarks/types";
import type {
	RunOptions,
	RunConfig,
	RunResult,
	BenchmarkProviderResult,
	TestCaseResult,
	TaskTypeBreakdown,
	ProgressCallback,
	ProgressUpdate,
} from "./types";
import {
	getProvider,
	getBenchmark,
	getAvailableProviders,
	listBenchmarks,
} from "./registry";

// Re-export registry functions for convenience
export * from "./registry";
export * from "./types";
export * from "./checkpoint";
export * from "./defaults";
export * from "./output";
export * from "./errors";
export * from "./sampling";
export * from "./presets";
export * from "./failure-analysis";

import {
	createCheckpointManager,
	getResumeInfo,
	shouldSkip,
	getResumePoint,
	saveTestCaseProgress,
	saveCombinationComplete,
	printCheckpointStatus,
	estimateRemainingTime,
	type CheckpointManager,
	type ResumeInfo,
} from "./checkpoint";

import { extractTaskType } from "./taxonomy";
import { filterTestCases, type FilterOptions, type SamplingOptions, sampleTestCases } from "./sampling";
import { generateFailureAnalysis, aggregateFailureAnalysis, printFailureAnalysis } from "./failure-analysis";
import {
	calculateProportionCI,
	calculateConfidenceInterval,
	validateSampleQuality,
} from "./statistics";

import {
	ErrorCode,
	MemoryBenchError,
	createProviderError,
	createBenchmarkError,
	classifyError,
	withRetry,
	isTransientError,
	isNetworkError,
	isTimeoutError,
	isServiceUnavailableError,
} from "./errors";

// =============================================================================
// Main Run Function
// =============================================================================

/**
 * Run benchmarks against providers
 */
export async function run(
	options: RunOptions,
	onProgress?: ProgressCallback,
): Promise<RunResult> {
	const enableCheckpoint = options.checkpoint !== false; // Default to enabled

	// Progress helper
	const progress = (update: Partial<ProgressUpdate>) => {
		onProgress?.({
			phase: "init",
			benchmark: "",
			provider: "",
			current: 0,
			total: 0,
			...update,
		});
	};

	progress({ phase: "init", message: "Resolving providers and benchmarks..." });

	// Resolve providers
	const providers = await resolveProviders(options.providers, options.verbose);
	if (providers.length === 0) {
		throw createProviderError(
			ErrorCode.PROVIDER_NOT_AVAILABLE,
			"No providers available. Check your configuration or environment variables.",
			undefined,
			undefined,
			{
				actionable: [
					"Run 'memorybench list' to see available providers and their requirements",
					"Check that required environment variables are set (e.g., API keys)",
					"Verify provider services are running if applicable",
				],
			},
		);
	}

	// Check if LongMemEval is requested - handle it specially
	const requestedBenchmarks = options.benchmarks || [];
	const longMemEvalIndex = requestedBenchmarks.findIndex(
		(name) => name.toLowerCase() === "longmemeval"
	);
	const hasLongMemEval = longMemEvalIndex >= 0;
	const otherBenchmarks = hasLongMemEval
		? requestedBenchmarks.filter((name) => name.toLowerCase() !== "longmemeval")
		: requestedBenchmarks;
	
	// Run LongMemEval orchestrator if requested
	if (hasLongMemEval) {
		if (options.verbose) {
			console.log("\n📋 LongMemEval detected - running orchestrator automatically...");
			if (otherBenchmarks.length > 0) {
				console.log(`   Other benchmarks will be run after LongMemEval completes.\n`);
			}
		}
		await runLongMemEvalOrchestrator(options, progress);
		
		// If LongMemEval was the only benchmark, return early
		if (otherBenchmarks.length === 0) {
			const runId = generateRunId();
			const startTime = Date.now();
			return {
				metadata: {
					runId,
					startedAt: new Date(startTime).toISOString(),
					completedAt: new Date().toISOString(),
					durationMs: Date.now() - startTime,
					version: "0.1.0",
				},
				results: [],
				summary: {
					totalBenchmarks: 1,
					totalProviders: 0,
					totalTestCases: 0,
					overallAccuracy: 0,
				},
			};
		}
	}

	// Resolve other benchmarks (excluding LongMemEval)
	const benchmarks = await resolveBenchmarks(otherBenchmarks, options.verbose);
	if (benchmarks.length === 0) {
		let errorMessage = "No benchmarks found. Check your configuration.";
		const actionable: string[] = [
			"Run 'memorybench list' to see available benchmarks",
			"Verify benchmark names are spelled correctly",
			"Check that benchmark data files are present",
		];
		
		throw createBenchmarkError(
			ErrorCode.BENCHMARK_NOT_FOUND,
			errorMessage,
			undefined,
			undefined,
			{ actionable },
		);
	}

	// Initialize checkpoint
	const tempRunId = generateRunId();
	const checkpoint = enableCheckpoint ? createCheckpointManager(tempRunId) : null;

	// Check for existing checkpoint
	let resumeInfo: ResumeInfo;
	if (checkpoint) {
		printCheckpointStatus(checkpoint);
		resumeInfo = await getResumeInfo(checkpoint, options.restart);
	} else {
		resumeInfo = {
			isResume: false,
			runId: tempRunId,
			startedAt: new Date().toISOString(),
			completedResults: [],
			skipCombinations: new Set(),
		};
	}

	const runId = resumeInfo.runId;
	const startTime = resumeInfo.isResume
		? new Date(resumeInfo.startedAt).getTime()
		: Date.now();

	if (options.verbose) {
		console.log(`\nRunning ${benchmarks.length} benchmark(s) × ${providers.length} provider(s)`);
		console.log(`Benchmarks: ${benchmarks.map((b) => b.name).join(", ")}`);
		console.log(`Providers: ${providers.map((p) => p.name).join(", ")}\n`);
	}

	// Run matrix (with checkpoint support)
	const results: BenchmarkProviderResult[] = [...resumeInfo.completedResults];
	const totalCombinations = benchmarks.length * providers.length;
	let completedCombinations = resumeInfo.completedResults.length;

	for (const benchmark of benchmarks) {
		for (const provider of providers) {
			// Skip already completed combinations
			if (shouldSkip(benchmark.name, provider.name, resumeInfo)) {
				if (options.verbose) {
					console.log(`⏭️  Skipping ${benchmark.name} × ${provider.name} (already completed)`);
				}
				continue;
			}

			progress({
				phase: "loading",
				benchmark: benchmark.name,
				provider: provider.name,
				current: completedCombinations,
				total: totalCombinations,
				message: `Loading ${benchmark.name}...`,
			});

			try {
				// Check for partial resume point
				const resumePoint = getResumePoint(benchmark.name, provider.name, resumeInfo);

				// Build filter options
				const filterOptions: FilterOptions | undefined = options.taskTypes || options.filters
					? { 
						taskTypes: options.taskTypes,
						...options.filters,
					}
					: undefined;

				// Build sampling options
				const samplingOptions: SamplingOptions | undefined = options.sampling;

				const result = await runBenchmarkWithProvider(
					benchmark,
					provider,
					options.verbose,
					(phase, current, total, message) => {
						progress({
							phase,
							benchmark: benchmark.name,
							provider: provider.name,
							current,
							total,
							message,
						});
					},
					checkpoint,
					resumePoint,
					filterOptions,
					samplingOptions,
				);
				results.push(result);

				// Save checkpoint after completing combination
				if (checkpoint) {
					await saveCombinationComplete(checkpoint, result, results);
				}
			} catch (error) {
				const classifiedError = classifyError(error);
				const errorMessage = formatErrorMessage(classifiedError, benchmark.name, provider.name);

				console.error(`\n❌ Error running ${benchmark.name} × ${provider.name}:`);
				console.error(`   ${errorMessage}`);

				// Log error location context
				if (classifiedError.context) {
					console.error(`\n   📍 Context:`, JSON.stringify(classifiedError.context, null, 2));
				}

				if (classifiedError.actionable && classifiedError.actionable.length > 0) {
					console.error(`\n   💡 Suggestions:`);
					for (const action of classifiedError.actionable) {
						console.error(`      • ${action}`);
					}
				}

				if (options.verbose) {
					if (classifiedError.cause) {
						console.error(`\n   📋 Error Details:`);
						if (classifiedError.cause instanceof Error) {
							console.error(`      Message: ${classifiedError.cause.message}`);
							if (classifiedError.cause.stack) {
								console.error(`      Stack Trace:`);
								console.error(`      ${classifiedError.cause.stack.split('\n').slice(0, 10).join('\n      ')}`);
							}
						} else {
							console.error(`      ${String(classifiedError.cause)}`);
						}
					}
					console.error(`   Error Code: ${classifiedError.code}`);
				}

				// Add failed result
				const failedResult: BenchmarkProviderResult = {
					benchmark: benchmark.name,
					provider: provider.name,
					testCases: [],
					metrics: {
						total: 0,
						passed: 0,
						failed: 0,
						accuracy: 0,
						avgScore: 0,
						avgLatencyMs: 0,
						p50LatencyMs: 0,
						p95LatencyMs: 0,
					},
					startedAt: new Date().toISOString(),
					completedAt: new Date().toISOString(),
					error: {
						code: classifiedError.code,
						message: classifiedError.message,
						actionable: classifiedError.actionable,
					},
				};
				results.push(failedResult);

				if (checkpoint) {
					await saveCombinationComplete(checkpoint, failedResult, results);
				}
			}

			completedCombinations++;
		}
	}

	// Calculate summary
	const totalTestCases = results.reduce((sum, r) => sum + r.metrics.total, 0);
	const totalPassed = results.reduce((sum, r) => sum + r.metrics.passed, 0);

	// Aggregate failure analysis
	const allFailureAnalyses = results
		.map(r => r.failureAnalysis)
		.filter((fa): fa is NonNullable<typeof fa> => !!fa);
	const aggregatedFailureAnalysis = allFailureAnalyses.length > 0
		? aggregateFailureAnalysis(allFailureAnalyses)
		: undefined;

	const runResult: RunResult = {
		metadata: {
			runId,
			startedAt: new Date(startTime).toISOString(),
			completedAt: new Date().toISOString(),
			durationMs: Date.now() - startTime,
			version: "0.1.0",
		},
		results,
		summary: {
			totalBenchmarks: benchmarks.length,
			totalProviders: providers.length,
			totalTestCases,
			overallAccuracy: totalTestCases > 0 ? totalPassed / totalTestCases : 0,
		},
		failureAnalysis: aggregatedFailureAnalysis,
	};

	progress({ phase: "complete", message: "Run complete!" });

	// Clear checkpoint on successful completion
	if (checkpoint) {
		await checkpoint.clear();
		if (options.verbose) {
			console.log("✓ Checkpoint cleared (run completed successfully)");
		}
	}

	// Print results
	printResults(runResult);

	// Save results
	if (options.output) {
		await saveResults(runResult, options.output);
	}

	return runResult;
}

// =============================================================================
// Core Execution
// =============================================================================

async function runBenchmarkWithProvider(
	benchmark: Benchmark,
	provider: Provider,
	verbose: boolean,
	onProgress: (phase: ProgressUpdate["phase"], current: number, total: number, message?: string) => void,
	checkpoint?: CheckpointManager | null,
	resumePoint?: ResumeInfo["resumePoint"],
	filterOptions?: FilterOptions,
	samplingOptions?: SamplingOptions,
): Promise<BenchmarkProviderResult> {
	const startTime = new Date();

	console.log(`\n${"─".repeat(60)}`);
	console.log(`📊 ${benchmark.name} × ${provider.name}`);
	if (resumePoint) {
		console.log(`   ⏯️  Resuming from test case ${resumePoint.nextIndex + 1}`);
	}
	console.log(`${"─".repeat(60)}`);

	// Reset provider state (unless resuming)
	if (!resumePoint && provider.reset) {
		try {
			if (verbose) {
				console.log(`  🔄 Resetting provider...`);
			}
			await withRetry(() => provider.reset!(), {
				maxRetries: 2,
				initialDelayMs: 500,
			});
		} catch (error) {
			const classifiedError = classifyError(error);
			const cause = classifiedError.cause instanceof Error ? classifiedError.cause : undefined;
			const errorMsg = `[${benchmark.name} × ${provider.name}] Phase: RESET - Failed to reset provider: ${classifiedError.message}`;
			if (verbose) {
				console.error(`  ❌ ${errorMsg}`);
				if (cause) {
					console.error(`     Cause: ${cause.message}`);
					if (cause.stack && verbose) {
						console.error(`     Stack: ${cause.stack.split('\n').slice(0, 3).join('\n')}`);
					}
				}
			}
			throw createProviderError(
				ErrorCode.PROVIDER_RESET_FAILED,
				errorMsg,
				provider.name,
				cause,
			);
		}
	}

	// Load test cases
	onProgress("loading", 0, 1, "Loading test cases...");
	let testCases: TestCase[];
	try {
		testCases = await benchmark.load();
		console.log(`  Loaded ${testCases.length} test cases`);
		
		// Apply filters
		if (filterOptions) {
			const beforeCount = testCases.length;
			testCases = filterTestCases(testCases, filterOptions);
			const afterCount = testCases.length;
			if (beforeCount !== afterCount) {
				console.log(`  Filtered to ${afterCount} test cases (from ${beforeCount})`);
			}
		}

		// Apply sampling
		if (samplingOptions && samplingOptions.count) {
			const beforeCount = testCases.length;
			testCases = sampleTestCases(testCases, samplingOptions);
			const afterCount = testCases.length;
			if (beforeCount !== afterCount) {
				const samplingType = samplingOptions.weighted ? "weighted sampling" : "random sampling";
				console.log(`  Sampled ${afterCount} test cases (from ${beforeCount}) using ${samplingType}`);
			}
		}
	} catch (error) {
		const classifiedError = classifyError(error);
		const cause = classifiedError.cause instanceof Error ? classifiedError.cause : undefined;
		throw createBenchmarkError(
			ErrorCode.BENCHMARK_LOAD_FAILED,
			`Failed to load test cases: ${classifiedError.message}`,
			benchmark.name,
			cause,
		);
	}

	// Start with resumed test cases or empty
	const testCaseResults: TestCaseResult[] = resumePoint?.completedTestCases ?? [];
	const startIndex = resumePoint?.nextIndex ?? 0;

	// Track ingested contexts to avoid duplicates (useful for benchmarks like LoCoMo where
	// multiple test cases share the same contexts)
	const ingestedContexts = new Set<string>();
	const getContextKey = (content: string, meta?: Record<string, unknown>): string => {
		// Create a unique key from content + metadata for deduplication
		const metaStr = meta ? JSON.stringify(meta) : "";
		return `${content}|${metaStr}`;
	};

	if (resumePoint && resumePoint.completedTestCases.length > 0) {
		console.log(`  Resuming with ${resumePoint.completedTestCases.length} completed test cases`);

		// Re-ingest completed test case contexts for provider state
		if (!provider.reset) {
			// If no reset, we need to rebuild state
			for (let i = 0; i < startIndex; i++) {
				const tc = testCases[i];
				if (tc) {
					for (const ctx of tc.contexts) {
						const contextKey = getContextKey(ctx.content, ctx.meta);
						if (!ingestedContexts.has(contextKey)) {
							await provider.ingest(ctx.content, ctx.meta);
							ingestedContexts.add(contextKey);
						}
					}
				}
			}
		} else {
			// If reset was called, track contexts from completed test cases to avoid re-ingesting
			for (let i = 0; i < startIndex; i++) {
				const tc = testCases[i];
				if (tc) {
					for (const ctx of tc.contexts) {
						const contextKey = getContextKey(ctx.content, ctx.meta);
						ingestedContexts.add(contextKey);
					}
				}
			}
		}
	}

	const runStartTime = Date.now();

	for (let i = startIndex; i < testCases.length; i++) {
		const testCase = testCases[i]!;
		const testStartTime = Date.now();

		try {
			// Phase 1: Ingest contexts (with retry and deduplication)
			const contextsToIngest = testCase.contexts.filter((ctx) => {
				const key = getContextKey(ctx.content, ctx.meta);
				return !ingestedContexts.has(key);
			});

			if (contextsToIngest.length < testCase.contexts.length) {
				const skipped = testCase.contexts.length - contextsToIngest.length;
				if (verbose) {
					console.log(`  ⏭️  Skipping ${skipped} duplicate context(s) for test case ${testCase.id}`);
				}
			}

			onProgress("ingesting", i, testCases.length, `Ingesting ${contextsToIngest.length} context(s)...`);
			for (let ctxIdx = 0; ctxIdx < testCase.contexts.length; ctxIdx++) {
				const ctx = testCase.contexts[ctxIdx]!;
				const contextKey = getContextKey(ctx.content, ctx.meta);

				// Skip if already ingested
				if (ingestedContexts.has(contextKey)) {
					if (verbose) {
						console.log(`    ⏭️  Skipping duplicate context (already ingested)`);
					}
					continue;
				}

				if (verbose) {
					if (ctx.meta && Object.keys(ctx.meta).length > 0) {
						console.log(`    📝 Context metadata:`, JSON.stringify(ctx.meta, null, 2));
					}
					if (ctx.content.length > 100) {
						console.log(`    📄 Context preview: ${ctx.content.substring(0, 100)}...`);
					} else {
						console.log(`    📄 Context: ${ctx.content}`);
					}
				}

				await withRetry(
					() => provider.ingest(ctx.content, ctx.meta),
					{
						maxRetries: 3,
						initialDelayMs: 1000,
						retryable: (error) => {
							if (isTransientError(error)) return error.retryable;
							// Don't retry on validation errors
							if (error instanceof Error && error.message.includes("validation")) return false;
							// Only retry network/timeout/service unavailable errors
							return isNetworkError(error) || isTimeoutError(error) || isServiceUnavailableError(error);
						},
					},
				).catch((error) => {
					const classifiedError = classifyError(error);
					const cause = classifiedError.cause instanceof Error ? classifiedError.cause : undefined;
					const errorMsg = `[${benchmark.name} × ${provider.name}] Phase: INGEST - Test Case: ${testCase.id} (context ${ctxIdx + 1}/${testCase.contexts.length}) - ${classifiedError.message}`;
					if (verbose) {
						console.error(`  ❌ ${errorMsg}`);
						if (cause) {
							console.error(`     Cause: ${cause.message}`);
							if (cause.stack) {
								console.error(`     Stack: ${cause.stack.split('\n').slice(0, 5).join('\n     ')}`);
							}
						}
					}
					throw createProviderError(
						ErrorCode.PROVIDER_INGEST_FAILED,
						errorMsg,
						provider.name,
						cause,
					);
				});

				// Mark as ingested after successful ingestion
				ingestedContexts.add(contextKey);
			}

			// Phase 2: Search (with retry)
			onProgress("searching", i, testCases.length, `Searching: "${testCase.query.substring(0, 50)}..."`);
			const searchResults = await withRetry(
				() => provider.search(testCase.query, 10),
				{
					maxRetries: 3,
					initialDelayMs: 1000,
					retryable: (error) => {
						if (isTransientError(error)) return error.retryable;
						// Only retry network/timeout/service unavailable errors
						return isNetworkError(error) || isTimeoutError(error) || isServiceUnavailableError(error);
					},
				},
			).catch((error) => {
				const classifiedError = classifyError(error);
				const cause = classifiedError.cause instanceof Error ? classifiedError.cause : undefined;
				const errorMsg = `[${benchmark.name} × ${provider.name}] Phase: SEARCH - Test Case: ${testCase.id} - Query: "${testCase.query.substring(0, 100)}${testCase.query.length > 100 ? '...' : ''}" - ${classifiedError.message}`;
				if (verbose) {
					console.error(`  ❌ ${errorMsg}`);
					if (cause) {
						console.error(`     Cause: ${cause.message}`);
						if (cause.stack) {
							console.error(`     Stack: ${cause.stack.split('\n').slice(0, 5).join('\n     ')}`);
						}
					}
				}
				throw createProviderError(
					ErrorCode.PROVIDER_SEARCH_FAILED,
					errorMsg,
					provider.name,
					cause,
				);
			});

			// Phase 3: Evaluate
			onProgress("evaluating", i, testCases.length, "Evaluating results...");
			let evaluation;
			try {
				evaluation = benchmark.evaluate(testCase, searchResults);
			} catch (error) {
				const classifiedError = classifyError(error);
				const cause = classifiedError.cause instanceof Error ? classifiedError.cause : undefined;
				const errorMsg = `[${benchmark.name} × ${provider.name}] Phase: EVALUATE - Test Case: ${testCase.id} - ${classifiedError.message}`;
				if (verbose) {
					console.error(`  ❌ ${errorMsg}`);
					if (cause) {
						console.error(`     Cause: ${cause.message}`);
						if (cause.stack) {
							console.error(`     Stack: ${cause.stack.split('\n').slice(0, 5).join('\n     ')}`);
						}
					}
				}
				throw createBenchmarkError(
					ErrorCode.BENCHMARK_EVALUATION_FAILED,
					errorMsg,
					benchmark.name,
					cause,
				);
			}

			const latencyMs = Date.now() - testStartTime;

			testCaseResults.push({
				testCaseId: testCase.id,
				query: testCase.query,
				searchResults,
				evaluation,
				latencyMs,
			});

			// Save checkpoint after each test case
			if (checkpoint) {
				await saveTestCaseProgress(
					checkpoint,
					benchmark.name,
					provider.name,
					testCaseResults,
					i + 1,
					testCases.length,
				);
			}

			// Print progress
			const status = evaluation.passed ? "✓" : "✗";
			const scoreStr = evaluation.score.toFixed(2);
			const elapsed = Date.now() - runStartTime;
			const eta = estimateRemainingTime(i - startIndex + 1, testCases.length - startIndex, elapsed);

			if (verbose) {
				console.log(`  [${i + 1}/${testCases.length}] ${status} ${testCase.id} (score: ${scoreStr}, ${latencyMs}ms) ETA: ${eta}`);
				if (testCase.metadata) {
					console.log(`    📋 Test case metadata:`, JSON.stringify(testCase.metadata, null, 2));
				}
			} else {
				// Compact progress
				process.stdout.write(evaluation.passed ? "." : "x");
				if ((i + 1) % 50 === 0) console.log(` ${i + 1}/${testCases.length} (ETA: ${eta})`);
			}
		} catch (error) {
			const classifiedError = classifyError(error);
			const errorMsg = classifiedError.message;
			const fullErrorMsg = `[${benchmark.name} × ${provider.name}] Test Case ${i + 1}/${testCases.length}: ${testCase.id} - ${errorMsg}`;

			testCaseResults.push({
				testCaseId: testCase.id,
				query: testCase.query,
				searchResults: [],
				evaluation: { passed: false, score: 0, details: { reason: errorMsg } },
				latencyMs: Date.now() - testStartTime,
				error: errorMsg,
			});

			// Save checkpoint even on error
			if (checkpoint) {
				await saveTestCaseProgress(
					checkpoint,
					benchmark.name,
					provider.name,
					testCaseResults,
					i + 1,
					testCases.length,
				);
			}

			if (verbose) {
				console.error(`  [${i + 1}/${testCases.length}] ✗ ${testCase.id} ERROR: ${errorMsg}`);
				if (classifiedError.cause instanceof Error && classifiedError.cause.stack) {
					console.error(`     Stack: ${classifiedError.cause.stack.split('\n').slice(0, 5).join('\n     ')}`);
				}
				if (classifiedError.actionable && classifiedError.actionable.length > 0) {
					console.error(`     💡 Suggestions:`);
					for (const action of classifiedError.actionable.slice(0, 3)) {
						console.error(`        • ${action}`);
					}
				}
			} else {
				console.error(`\n  ❌ ${fullErrorMsg}`);
				process.stdout.write("E");
			}
		}
	}

	// Ensure newline after progress dots
	if (!verbose && testCases.length > 0) {
		console.log();
	}

	// Calculate metrics (with breakdown by task type)
	const metrics = calculateMetrics(testCaseResults, testCases);

	console.log(`  ─────────────────────────────────`);
	
	// Display metrics with confidence intervals
	if (metrics.accuracyCI) {
		const ciLower = (metrics.accuracyCI.lower * 100).toFixed(1);
		const ciUpper = (metrics.accuracyCI.upper * 100).toFixed(1);
		console.log(`  Accuracy: ${(metrics.accuracy * 100).toFixed(1)}% ± ${(metrics.accuracyCI.margin * 100).toFixed(1)}% (95% CI: ${ciLower}% - ${ciUpper}%)`);
	} else {
		console.log(`  Accuracy: ${(metrics.accuracy * 100).toFixed(1)}% (${metrics.passed}/${metrics.total})`);
	}
	
	if (metrics.avgScoreCI) {
		console.log(`  Avg Score: ${metrics.avgScore.toFixed(3)} ± ${metrics.avgScoreCI.margin.toFixed(3)} (95% CI: ${metrics.avgScoreCI.lower.toFixed(3)} - ${metrics.avgScoreCI.upper.toFixed(3)})`);
	} else {
		console.log(`  Avg Score: ${metrics.avgScore.toFixed(3)}`);
	}
	
	console.log(`  P50 Latency: ${metrics.p50LatencyMs.toFixed(0)}ms`);
	
	if (metrics.avgLatencyCI) {
		console.log(`  Avg Latency: ${metrics.avgLatencyMs.toFixed(0)}ms ± ${metrics.avgLatencyCI.margin.toFixed(0)}ms`);
	}
	
	// Display sample quality
	if (metrics.sampleQuality) {
		const qualityEmoji = {
			excellent: "✨",
			good: "✓",
			fair: "⚠️",
			poor: "❌",
		}[metrics.sampleQuality.qualityScore];
		
		console.log(`  Sample Quality: ${qualityEmoji} ${metrics.sampleQuality.qualityScore.toUpperCase()} (n=${metrics.total})`);
		
		if (metrics.sampleQuality.recommendedSampleSize) {
			const needed = metrics.sampleQuality.recommendedSampleSize - metrics.total;
			console.log(`     💡 Recommend ${needed} more samples for better confidence`);
		}
	}
	
	// Print task type breakdown if available
	if (metrics.breakdownByTaskType && metrics.breakdownByTaskType.length > 0) {
		console.log(`  ─────────────────────────────────`);
		console.log(`  Task Type Breakdown:`);
		for (const breakdown of metrics.breakdownByTaskType) {
			const taskTypeStr = breakdown.taskType.padEnd(20);
			const accuracyStr = `${(breakdown.accuracy * 100).toFixed(1)}%`;
			
			if (breakdown.accuracyCI) {
				const ciMargin = (breakdown.accuracyCI.margin * 100).toFixed(1);
				console.log(`    ${taskTypeStr} ${accuracyStr} ± ${ciMargin}% (${breakdown.passed}/${breakdown.total})`);
			} else {
				console.log(`    ${taskTypeStr} ${accuracyStr} (${breakdown.passed}/${breakdown.total})`);
			}
			
			// Warn about small sample sizes
			if (breakdown.total < 30) {
				console.log(`       ⚠️  Small sample size (n=${breakdown.total}), results may be unreliable`);
			}
		}
	}

	// Generate and print failure analysis
	const failureAnalysis = generateFailureAnalysis(testCaseResults, testCases);
	if (failureAnalysis.length > 0) {
		printFailureAnalysis(failureAnalysis);
	}

	const result: BenchmarkProviderResult = {
		benchmark: benchmark.name,
		provider: provider.name,
		testCases: testCaseResults,
		metrics: {
			total: metrics.total,
			passed: metrics.passed,
			failed: metrics.failed,
			accuracy: metrics.accuracy,
			avgScore: metrics.avgScore,
			avgLatencyMs: metrics.avgLatencyMs,
			p50LatencyMs: metrics.p50LatencyMs,
			p95LatencyMs: metrics.p95LatencyMs,
			accuracyCI: metrics.accuracyCI,
			avgScoreCI: metrics.avgScoreCI,
			avgLatencyCI: metrics.avgLatencyCI,
			sampleQuality: metrics.sampleQuality,
		},
		breakdownByTaskType: metrics.breakdownByTaskType,
		failureAnalysis: failureAnalysis.length > 0 ? failureAnalysis : undefined,
		startedAt: startTime.toISOString(),
		completedAt: new Date().toISOString(),
	};
	
	return result;
}

// =============================================================================
// Resolution
// =============================================================================

async function resolveProviders(names: string[], verbose: boolean): Promise<Provider[]> {
	const providers: Provider[] = [];

	if (names.length === 0) {
		// Auto-detect available providers
		const available = await getAvailableProviders();
		if (verbose) {
			console.log(`Auto-detected providers: ${available.join(", ") || "(none)"}`);
		}
		// Default to mock if nothing else is available
		if (available.length === 0) {
			names = ["mock"];
		} else {
			names = available;
		}
	}

	for (const name of names) {
		try {
			const provider = await getProvider(name);
			if (provider) {
				providers.push(provider);
			} else {
				const error = createProviderError(
					ErrorCode.PROVIDER_NOT_AVAILABLE,
					`Provider "${name}" is not available`,
					name,
				);
				if (verbose) {
					console.warn(`⚠️  ${error.message}`);
					if (error.actionable) {
						for (const action of error.actionable) {
							console.warn(`   • ${action}`);
						}
					}
				}
			}
		} catch (error) {
			const classifiedError = classifyError(error);
			const cause = classifiedError.cause instanceof Error ? classifiedError.cause : undefined;
			const providerError = createProviderError(
				ErrorCode.PROVIDER_INIT_FAILED,
				`Failed to load provider "${name}": ${classifiedError.message}`,
				name,
				cause,
			);
			if (verbose) {
				console.warn(`⚠️  ${providerError.message}`);
				if (providerError.actionable) {
					for (const action of providerError.actionable) {
						console.warn(`   • ${action}`);
					}
				}
			}
		}
	}

	return providers;
}

async function resolveBenchmarks(names: string[], verbose: boolean): Promise<Benchmark[]> {
	const benchmarks: Benchmark[] = [];

	if (names.length === 0) {
		// Default to quicktest
		names = ["quicktest"];
		if (verbose) {
			console.log("No benchmarks specified, using quicktest");
		}
	}

	for (const name of names) {
		try {
			const benchmark = await getBenchmark(name);
			if (benchmark) {
				benchmarks.push(benchmark);
			} else {
				// Check if this is LongMemEval which has special handling
				if (name.toLowerCase() === "longmemeval") {
					// LongMemEval is handled automatically in the run() function
					// This warning only appears if resolveBenchmarks is called directly
					if (verbose) {
						console.log(`\nℹ️  LongMemEval benchmark will be run automatically via orchestrator.`);
						console.log(`   See benchmarks/LongMemEval/README.md for usage instructions.\n`);
					}
				} else {
					const error = createBenchmarkError(
						ErrorCode.BENCHMARK_NOT_FOUND,
						`Benchmark "${name}" not found or could not be loaded`,
						name,
					);
					if (verbose) {
						console.warn(`⚠️  ${error.message}`);
						if (error.actionable) {
							for (const action of error.actionable) {
								console.warn(`   • ${action}`);
							}
						}
					}
				}
			}
		} catch (error) {
			const classifiedError = classifyError(error);
			const cause = classifiedError.cause instanceof Error ? classifiedError.cause : undefined;
			const benchmarkError = createBenchmarkError(
				ErrorCode.BENCHMARK_LOAD_FAILED,
				`Failed to load benchmark "${name}": ${classifiedError.message}`,
				name,
				cause,
			);
			if (verbose) {
				console.warn(`⚠️  ${benchmarkError.message}`);
				if (benchmarkError.actionable) {
					for (const action of benchmarkError.actionable) {
						console.warn(`   • ${action}`);
					}
				}
			}
		}
	}

	return benchmarks;
}

// =============================================================================
// Metrics
// =============================================================================

function calculateMetrics(
	results: TestCaseResult[],
	testCases?: TestCase[],
): BenchmarkProviderResult["metrics"] & { breakdownByTaskType?: TaskTypeBreakdown[] } {
	const total = results.length;
	if (total === 0) {
		return {
			total: 0,
			passed: 0,
			failed: 0,
			accuracy: 0,
			avgScore: 0,
			avgLatencyMs: 0,
			p50LatencyMs: 0,
			p95LatencyMs: 0,
			breakdownByTaskType: [],
		};
	}

	const passed = results.filter((r) => r.evaluation.passed).length;
	const failed = total - passed;
	const accuracy = passed / total;

	const scores = results.map((r) => r.evaluation.score);
	const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

	const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
	const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
	const p50LatencyMs = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
	const p95LatencyMs = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

	// Calculate confidence intervals
	const accuracyCI = calculateProportionCI(passed, total);
	const avgScoreCI = calculateConfidenceInterval(scores);
	const avgLatencyCI = calculateConfidenceInterval(latencies);

	// Assess sample quality based on accuracy CI width
	const sampleQuality = validateSampleQuality(
		total,
		accuracyCI.width,
		0.1 // Target 10% CI width for accuracy
	);

	// Calculate breakdown by task type
	let breakdownByTaskType: TaskTypeBreakdown[] | undefined;
	if (testCases && testCases.length === results.length) {
		const breakdownMap = new Map<string, { results: TestCaseResult[]; testCases: TestCase[] }>();

		// Group by task type
		for (let i = 0; i < results.length; i++) {
			const result = results[i]!;
			const testCase = testCases[i];
			if (!testCase) continue;

			const taskType = extractTaskType(testCase);
			const group = breakdownMap.get(taskType) || { results: [], testCases: [] };
			group.results.push(result);
			group.testCases.push(testCase);
			breakdownMap.set(taskType, group);
		}

		// Calculate metrics per task type
		breakdownByTaskType = Array.from(breakdownMap.entries()).map(([taskType, group]) => {
			const typeResults = group.results;
			const typeTotal = typeResults.length;
			const typePassed = typeResults.filter((r) => r.evaluation.passed).length;
			const typeAccuracy = typeTotal > 0 ? typePassed / typeTotal : 0;
			const typeScores = typeResults.map((r) => r.evaluation.score);
			const typeAvgScore = typeScores.reduce((a, b) => a + b, 0) / typeScores.length;
			const typeLatencies = typeResults.map((r) => r.latencyMs);
			const typeAvgLatencyMs = typeLatencies.reduce((a, b) => a + b, 0) / typeLatencies.length;

			// Calculate confidence intervals for task type
			const typeAccuracyCI = calculateProportionCI(typePassed, typeTotal);
			const typeAvgScoreCI = calculateConfidenceInterval(typeScores);
			const typeAvgLatencyCI = calculateConfidenceInterval(typeLatencies);

			return {
				taskType,
				total: typeTotal,
				passed: typePassed,
				accuracy: typeAccuracy,
				avgScore: typeAvgScore,
				avgLatencyMs: typeAvgLatencyMs,
				accuracyCI: typeAccuracyCI,
				avgScoreCI: typeAvgScoreCI,
				avgLatencyCI: typeAvgLatencyCI,
			};
		});
	}

	return {
		total,
		passed,
		failed,
		accuracy,
		avgScore,
		avgLatencyMs,
		p50LatencyMs,
		p95LatencyMs,
		accuracyCI,
		avgScoreCI,
		avgLatencyCI,
		sampleQuality,
		breakdownByTaskType,
	};
}

// =============================================================================
// Output
// =============================================================================

function printResults(result: RunResult): void {
	console.log(`\n${"═".repeat(70)}`);
	console.log("                         MEMORYBENCH RESULTS");
	console.log(`${"═".repeat(70)}`);

	// Header
	console.log(`\nRun ID: ${result.metadata.runId}`);
	console.log(`Duration: ${(result.metadata.durationMs / 1000).toFixed(1)}s`);
	console.log(`Total: ${result.summary.totalTestCases} test cases\n`);

	// Results table
	console.log("┌─────────────────────┬─────────────────────┬──────────┬───────────┬─────────────┐");
	console.log("│ Benchmark           │ Provider            │ Accuracy │ Avg Score │ P50 Latency │");
	console.log("├─────────────────────┼─────────────────────┼──────────┼───────────┼─────────────┤");

	for (const r of result.results) {
		const benchmark = r.benchmark.padEnd(19).substring(0, 19);
		const provider = r.provider.padEnd(19).substring(0, 19);
		const accuracy = `${(r.metrics.accuracy * 100).toFixed(1)}%`.padStart(7);
		const score = r.metrics.avgScore.toFixed(3).padStart(9);
		const latency = `${r.metrics.p50LatencyMs.toFixed(0)}ms`.padStart(10);
		console.log(`│ ${benchmark} │ ${provider} │ ${accuracy} │ ${score} │ ${latency} │`);
	}

	console.log("└─────────────────────┴─────────────────────┴──────────┴───────────┴─────────────┘");

	// Summary
	console.log(`\nOverall Accuracy: ${(result.summary.overallAccuracy * 100).toFixed(1)}%`);
	console.log(`${"═".repeat(70)}\n`);
}

async function saveResults(result: RunResult, outputPath: string): Promise<void> {
	try {
		const { writeResults, generateOutputPath } = await import("../results/writer.js");
		const path = outputPath || generateOutputPath(result.metadata.runId);
		const finalPath = await writeResults(result, path);
		console.log(`Results saved to: ${finalPath}`);
	} catch (error) {
		// Fallback to simple write if results module not available
		const path = outputPath.endsWith(".json") ? outputPath : `${outputPath}.json`;
		try {
			await Bun.write(path, JSON.stringify(result, null, 2));
			console.log(`Results saved to: ${path}`);
		} catch (writeError) {
			console.error(`Failed to save results:`, writeError);
		}
	}
}

// =============================================================================
// Helpers
// =============================================================================

function formatErrorMessage(error: MemoryBenchError, benchmark?: string, provider?: string): string {
	let message = error.message;

	// Add context if available
	if (benchmark || provider) {
		const context = [benchmark, provider].filter(Boolean).join(" × ");
		message = `[${context}] ${message}`;
	}

	// Add error code for programmatic handling
	message = `${message} (Error Code: ${error.code})`;

	return message;
}

/**
 * Run LongMemEval orchestrator automatically when LongMemEval is requested
 */
async function runLongMemEvalOrchestrator(
	options: RunOptions,
	progress: (update: Partial<ProgressUpdate>) => void,
): Promise<RunResult> {
	const { join, dirname } = await import("path");
	const { fileURLToPath } = await import("url");
	const { existsSync } = await import("fs");
	
	// Get the orchestrator script path
	const runnerDir = dirname(fileURLToPath(import.meta.url));
	const orchestratorPath = join(
		runnerDir,
		"..",
		"benchmarks",
		"LongMemEval",
		"scripts",
		"orchestrator.ts"
	);
	
	if (!existsSync(orchestratorPath)) {
		throw createBenchmarkError(
			ErrorCode.BENCHMARK_NOT_FOUND,
			`LongMemEval orchestrator not found at ${orchestratorPath}`,
			"longmemeval",
		);
	}
	
	// Generate a runId for this execution
	const runId = generateRunId();
	
	// Build orchestrator arguments
	// Use sensible defaults: all phases, batch mode, all question types
	const orchestratorArgs = [
		"bun",
		"run",
		orchestratorPath,
		"--phase=all",
		"--mode=batch",
		`--runId=${runId}`,
	];
	
	// Add question type filter (default to "all" to skip interactive prompt)
	const questionType = process.env.LONGMEMEVAL_QUESTION_TYPE || "all";
	orchestratorArgs.push(`--questionType=${questionType}`);
	
	// Add position range if specified via environment variables
	const startPos = process.env.LONGMEMEVAL_START_POSITION;
	const endPos = process.env.LONGMEMEVAL_END_POSITION;
	if (startPos && endPos) {
		orchestratorArgs.push(`--startPosition=${startPos}`);
		orchestratorArgs.push(`--endPosition=${endPos}`);
	}
	
	// Add answering model if specified
	const answeringModel = process.env.LONGMEMEVAL_ANSWERING_MODEL || "gpt-4o";
	orchestratorArgs.push(`--answeringModel=${answeringModel}`);
	
	progress({
		phase: "init",
		message: `Running LongMemEval orchestrator (runId: ${runId})...`,
		benchmark: "longmemeval",
	});
	
	if (options.verbose) {
		console.log(`\n🚀 Running LongMemEval orchestrator automatically...`);
		console.log(`   Run ID: ${runId}`);
		console.log(`   Command: ${orchestratorArgs.join(" ")}\n`);
	}
	
	// Change to LongMemEval directory for orchestrator execution
	const longMemEvalDir = join(
		runnerDir,
		"..",
		"benchmarks",
		"LongMemEval"
	);
	
	try {
		const proc = Bun.spawn(orchestratorArgs, {
			cwd: longMemEvalDir,
			stdout: "inherit",
			stderr: "inherit",
		});
		
		const exitCode = await proc.exited;
		
		if (exitCode !== 0) {
			throw createBenchmarkError(
				ErrorCode.BENCHMARK_EVALUATION_FAILED,
				`LongMemEval orchestrator exited with code ${exitCode}`,
				"longmemeval",
			);
		}
		
		const startTime = Date.now();
		const completedAt = new Date().toISOString();
		
		// Return a minimal success result
		return {
			metadata: {
				runId,
				startedAt: new Date(startTime).toISOString(),
				completedAt,
				durationMs: Date.now() - startTime,
				version: "0.1.0",
			},
			results: [],
			summary: {
				totalBenchmarks: 1,
				totalProviders: 0,
				totalTestCases: 0,
				overallAccuracy: 0,
			},
		};
	} catch (error) {
		if (error instanceof MemoryBenchError) {
			throw error;
		}
		throw createBenchmarkError(
			ErrorCode.BENCHMARK_EVALUATION_FAILED,
			`Failed to run LongMemEval orchestrator: ${error instanceof Error ? error.message : String(error)}`,
			"longmemeval",
			error instanceof Error ? error : undefined,
		);
	}
}

function generateRunId(): string {
	const now = new Date();
	const date = now.toISOString().split("T")[0];
	const time = now.toTimeString().split(" ")[0]?.replace(/:/g, "");
	const random = Math.random().toString(36).substring(2, 6);
	return `run-${date}-${time}-${random}`;
}

