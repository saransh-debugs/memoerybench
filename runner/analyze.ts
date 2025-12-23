/**
 * Benchmark Analysis
 *
 * Analyze benchmark composition: task types, difficulty, categories, etc.
 */

import { getBenchmark } from "./registry";
import { extractTaskType } from "./taxonomy";
import type { TestCase } from "../benchmarks/types";

export interface BenchmarkAnalysis {
	benchmark: string;
	taskTypeDistribution: Record<string, number>;
	difficultyDistribution: Record<string, number>;
	categoryDistribution: Record<string, number>;
	evidenceComplexity: {
		singleSource: number;
		multiSource: number;
		noEvidence: number;
	};
	totalTestCases: number;
	avgContextCount: number;
	avgQueryLength: number;
}

export async function analyzeBenchmark(benchmarkName: string): Promise<void> {
	console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                  BENCHMARK ANALYSIS                                ║
╚═══════════════════════════════════════════════════════════════════╝
`);

	try {
		const benchmark = await getBenchmark(benchmarkName);
		if (!benchmark) {
			console.error(`❌ Benchmark "${benchmarkName}" not found`);
			console.error("\n💡 Use 'memorybench list' to see available benchmarks");
			process.exit(1);
		}

		const testCases = await benchmark.load();
		const analysis = analyzeTestCases(benchmarkName, testCases);

		// Print analysis
		console.log(`\n📊 ${analysis.benchmark.toUpperCase()}`);
		console.log("─".repeat(60));
		console.log(`Total Test Cases: ${analysis.totalTestCases}`);
		console.log(`Avg Context Count: ${analysis.avgContextCount.toFixed(1)}`);
		console.log(`Avg Query Length: ${analysis.avgQueryLength.toFixed(1)} chars`);

		console.log(`\n📋 Task Type Distribution:`);
		const taskTypes = Object.entries(analysis.taskTypeDistribution)
			.sort((a, b) => b[1] - a[1]);
		for (const [taskType, count] of taskTypes) {
			const percentage = ((count / analysis.totalTestCases) * 100).toFixed(1);
			console.log(`  ${taskType.padEnd(20)} ${count.toString().padStart(4)} (${percentage}%)`);
		}

		if (Object.keys(analysis.difficultyDistribution).length > 0) {
			console.log(`\n🎯 Difficulty Distribution:`);
			const difficulties = Object.entries(analysis.difficultyDistribution)
				.sort((a, b) => b[1] - a[1]);
			for (const [difficulty, count] of difficulties) {
				const percentage = ((count / analysis.totalTestCases) * 100).toFixed(1);
				console.log(`  ${difficulty.padEnd(20)} ${count.toString().padStart(4)} (${percentage}%)`);
			}
		}

		if (Object.keys(analysis.categoryDistribution).length > 0) {
			console.log(`\n📁 Category Distribution:`);
			const categories = Object.entries(analysis.categoryDistribution)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10); // Top 10
			for (const [category, count] of categories) {
				const percentage = ((count / analysis.totalTestCases) * 100).toFixed(1);
				console.log(`  ${String(category).padEnd(20)} ${count.toString().padStart(4)} (${percentage}%)`);
			}
		}

		console.log(`\n🔍 Evidence Complexity:`);
		console.log(`  Single Source:    ${analysis.evidenceComplexity.singleSource.toString().padStart(4)}`);
		console.log(`  Multi Source:     ${analysis.evidenceComplexity.multiSource.toString().padStart(4)}`);
		console.log(`  No Evidence:      ${analysis.evidenceComplexity.noEvidence.toString().padStart(4)}`);

		console.log("\n" + "─".repeat(60) + "\n");
	} catch (error) {
		console.error(`❌ Error analyzing benchmark:`, error);
		process.exit(1);
	}
}

export function analyzeTestCases(benchmark: string, testCases: TestCase[]): BenchmarkAnalysis {
	const taskTypeDist: Record<string, number> = {};
	const difficultyDist: Record<string, number> = {};
	const categoryDist: Record<string, number> = {};
	let singleSource = 0;
	let multiSource = 0;
	let noEvidence = 0;
	let totalContextCount = 0;
	let totalQueryLength = 0;

	for (const testCase of testCases) {
		// Task type
		const taskType = extractTaskType(testCase);
		taskTypeDist[taskType] = (taskTypeDist[taskType] || 0) + 1;

		// Difficulty
		if (testCase.metadata?.difficulty) {
			const diff = String(testCase.metadata.difficulty);
			difficultyDist[diff] = (difficultyDist[diff] || 0) + 1;
		}

		// Category
		if (testCase.metadata?.category !== undefined) {
			const cat = String(testCase.metadata.category);
			categoryDist[cat] = (categoryDist[cat] || 0) + 1;
		}

		// Evidence complexity
		const evidence = testCase.metadata?.evidence;
		if (Array.isArray(evidence)) {
			if (evidence.length === 0) {
				noEvidence++;
			} else if (evidence.length === 1) {
				singleSource++;
			} else {
				multiSource++;
			}
		} else {
			noEvidence++;
		}

		// Context count and query length
		totalContextCount += testCase.contexts.length;
		totalQueryLength += testCase.query.length;
	}

	return {
		benchmark,
		taskTypeDistribution: taskTypeDist,
		difficultyDistribution: difficultyDist,
		categoryDistribution: categoryDist,
		evidenceComplexity: {
			singleSource,
			multiSource,
			noEvidence,
		},
		totalTestCases: testCases.length,
		avgContextCount: testCases.length > 0 ? totalContextCount / testCases.length : 0,
		avgQueryLength: testCases.length > 0 ? totalQueryLength / testCases.length : 0,
	};
}

