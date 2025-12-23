/**
 * NoLiMa Benchmark
 *
 * NoLiMa (No Literal Match) evaluates memory systems' ability to retrieve
 * relevant information from long contexts without relying on literal matches.
 *
 * The benchmark uses questions and answers with minimal lexical overlap,
 * requiring systems to infer latent associations to locate information.
 *
 * Dataset: https://huggingface.co/datasets/amodaresi/NoLiMa
 * Paper: https://arxiv.org/abs/2502.05167
 */

import type { Benchmark, TestCase, EvaluationResult } from "../types";
import type { SearchResult } from "../../providers/types";
import type { BenchmarkMeta } from "../../runner/types";
import type { NoLiMaItem } from "./types";
import { defaultEvaluate } from "../types";

/**
 * Benchmark metadata for auto-discovery
 */
export const meta: BenchmarkMeta = {
	name: "nolima",
	description: "NoLiMa benchmark - retrieval from long contexts without literal matches",
	testCaseCount: 58, // 58 needle-question pairs
	estimatedTimeMs: 600000, // ~10 minutes estimated
};

/**
 * Load NoLiMa dataset from local JSON file
 *
 * To download the dataset:
 * 1. Install datasets: `pip install datasets`
 * 2. Run: `python -c "from datasets import load_dataset; ds = load_dataset('amodaresi/NoLiMa'); ds['test'].to_json('nolima.json')"`
 * 3. Place nolima.json in this directory
 */
async function loadNoLiMaData(): Promise<NoLiMaItem[]> {
	const dataPath = new URL("./nolima.json", import.meta.url).pathname;
	
	try {
		const file = Bun.file(dataPath);
		if (!(await file.exists())) {
			throw new Error(
				`NoLiMa dataset not found at ${dataPath}. ` +
				`Please download it from Hugging Face. See README.md for instructions.`
			);
		}
		
		const data = await file.json();
		
		// Handle different possible formats
		if (Array.isArray(data)) {
			return data as NoLiMaItem[];
		} else if (data.items && Array.isArray(data.items)) {
			return data.items as NoLiMaItem[];
		} else if (data.test && Array.isArray(data.test)) {
			// Hugging Face datasets format
			return data.test as NoLiMaItem[];
		} else {
			throw new Error("Invalid NoLiMa dataset format");
		}
	} catch (error) {
		if (error instanceof Error && error.message.includes("not found")) {
			throw error;
		}
		throw new Error(`Failed to load NoLiMa dataset: ${error}`);
	}
}

/**
 * Convert NoLiMa item to test case
 */
function itemToTestCase(item: NoLiMaItem): TestCase {
	return {
		id: item.id,
		contexts: [
			{
				content: item.haystack,
				meta: {
					needlePosition: item.needlePosition,
					contextLength: item.contextLength,
					complexity: item.complexity,
				},
			},
		],
		query: item.question,
		expected: {
			answer: item.answer,
		},
		metadata: {
			complexity: item.complexity,
			needlePosition: item.needlePosition,
			contextLength: item.contextLength,
			...item.metadata,
		},
	};
}

/**
 * Custom evaluation for NoLiMa
 *
 * Since NoLiMa tests non-literal matching, we use a more sophisticated
 * evaluation that checks for semantic similarity rather than exact substring matches.
 */
function evaluateNoLiMa(
	testCase: TestCase,
	results: SearchResult[],
): EvaluationResult {
	const expected = testCase.expected.answer;
	const expectedAnswer = String(expected).toLowerCase().trim();

	// First, try exact match (some systems might still retrieve exact text)
	const exactMatch = defaultEvaluate(testCase, results);
	if (exactMatch.passed) {
		return exactMatch;
	}

	// For NoLiMa, we also check for semantic similarity
	// Check if any result contains words from the expected answer
	const expectedWords = expectedAnswer
		.split(/\s+/)
		.filter((w) => w.length > 2)
		.map((w) => w.toLowerCase());

	let bestScore = 0;
	let bestMatch: SearchResult | null = null;
	let matchedWords = 0;

	for (const result of results) {
		const contentLower = result.content.toLowerCase();
		const matched = expectedWords.filter((word) => contentLower.includes(word));
		const wordScore = matched.length / expectedWords.length;

		// Also check for partial matches (e.g., "San Francisco" vs "San Francisco, CA")
		const partialMatch = expectedWords.some((word) => {
			// Check if word appears as part of a longer phrase
			return contentLower.includes(word) || 
				contentLower.split(/\s+/).some((cw) => cw.includes(word) || word.includes(cw));
		});

		if (partialMatch && wordScore > bestScore) {
			bestScore = wordScore;
			bestMatch = result;
			matchedWords = matched.length;
		}
	}

	// Require at least 50% word overlap for partial credit
	if (bestScore >= 0.5 && bestMatch) {
		return {
			passed: true,
			score: Math.min(bestScore, 0.9), // Cap at 0.9 for non-exact matches
			details: {
				foundAnswer: expectedAnswer,
				matchedResults: [bestMatch],
				reason: `Found ${matchedWords}/${expectedWords.length} matching words`,
			},
		};
	}

	// Check if we retrieved content from the correct position
	const needlePosition = testCase.metadata?.needlePosition as number | undefined;
	if (needlePosition !== undefined && results.length > 0) {
		// Check if any result might contain content from the needle position
		// This is a heuristic - in practice, providers should retrieve the relevant content
		const hasRelevantContent = results.some((r) => {
			// Check if result contains any meaningful content (not just noise)
			return r.content.length > 50 && r.score > 0.3;
		});

		if (hasRelevantContent) {
			return {
				passed: false,
				score: 0.3,
				details: {
					reason: "Retrieved relevant content but answer not found",
				},
			};
		}
	}

	return {
		passed: false,
		score: 0,
		details: {
			reason: `Expected answer "${expectedAnswer}" not found in ${results.length} results`,
		},
	};
}

/**
 * NoLiMa benchmark configuration
 */
interface NoLiMaConfig {
	/** Maximum number of test cases to load (default: all) */
	maxTestCases?: number;
	/** Filter by complexity (default: all) */
	complexity?: "one-hop" | "two-hop";
	/** Minimum context length in tokens (default: 0) */
	minContextLength?: number;
	/** Maximum context length in tokens (default: unlimited) */
	maxContextLength?: number;
}

/**
 * Create the NoLiMa benchmark
 */
export function createNoLiMaBenchmark(config?: NoLiMaConfig): Benchmark {
	const {
		maxTestCases,
		complexity,
		minContextLength = 0,
		maxContextLength = Infinity,
	} = config || {};

	return {
		name: "nolima",

		async load(): Promise<TestCase[]> {
			const data = await loadNoLiMaData();
			let testCases = data.map(itemToTestCase);

			// Apply filters
			if (complexity) {
				testCases = testCases.filter(
					(tc) => tc.metadata?.complexity === complexity,
				);
			}

			if (minContextLength > 0 || maxContextLength < Infinity) {
				testCases = testCases.filter((tc) => {
					const ctxLength = tc.metadata?.contextLength as number | undefined;
					if (ctxLength === undefined) return true;
					return ctxLength >= minContextLength && ctxLength <= maxContextLength;
				});
			}

			// Limit number of test cases
			if (maxTestCases) {
				testCases = testCases.slice(0, maxTestCases);
			}

			console.log(
				`  NoLiMa: Loaded ${testCases.length}/${data.length} test cases`,
			);
			if (complexity) {
				console.log(`    Filtered by complexity: ${complexity}`);
			}
			if (maxTestCases) {
				console.log(`    Limited to ${maxTestCases} test cases`);
			}

			return testCases;
		},

		evaluate: evaluateNoLiMa,
	};
}

// Default export
export default createNoLiMaBenchmark;

