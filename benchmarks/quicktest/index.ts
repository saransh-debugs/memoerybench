/**
 * QuickTest Benchmark
 *
 * Fast benchmark for development and CI (10 questions, ~30s).
 * Tests basic memory retrieval capabilities.
 */

import type { Benchmark, TestCase, EvaluationResult, Context } from "../types";
import type { SearchResult } from "../../providers/types";
import type { BenchmarkMeta } from "../../runner/types";

/**
 * Benchmark metadata for auto-discovery
 */
export const meta: BenchmarkMeta = {
	name: "quicktest",
	description: "Quick test benchmark (10 questions, ~30s)",
	testCaseCount: 10,
	estimatedTimeMs: 30000,
};

/**
 * QuickTest test cases - designed to be fast but meaningful
 */
const QUICKTEST_DATA: TestCase[] = [
	{
		id: "qt_001",
		contexts: [
			{ content: "User's name is Alex and they live in San Francisco." },
			{ content: "Alex works as a software engineer at a startup." },
		],
		query: "Where does the user live?",
		expected: { answer: "San Francisco" },
		metadata: { category: "location", difficulty: "easy" },
	},
	{
		id: "qt_002",
		contexts: [
			{ content: "User moved to Berlin in January 2023 for a new job." },
			{ content: "Before Berlin, user lived in London for 5 years." },
		],
		query: "When did the user move to Berlin?",
		expected: { answer: ["January 2023", "2023"] },
		metadata: { category: "temporal", difficulty: "easy" },
	},
	{
		id: "qt_003",
		contexts: [
			{ content: "User's favorite food is sushi, especially salmon nigiri." },
			{ content: "User mentioned they don't like spicy food." },
		],
		query: "What is the user's favorite food?",
		expected: { answer: "sushi" },
		metadata: { category: "preference", difficulty: "easy" },
	},
	{
		id: "qt_004",
		contexts: [
			{ content: "User has a golden retriever named Max." },
			{ content: "Max was adopted from a shelter in 2020." },
		],
		query: "What is the name of the user's dog?",
		expected: { answer: "Max" },
		metadata: { category: "entity", difficulty: "easy" },
	},
	{
		id: "qt_005",
		contexts: [
			{ content: "User graduated from MIT with a degree in Computer Science in 2018." },
			{ content: "User's thesis was about machine learning optimization." },
		],
		query: "What university did the user attend?",
		expected: { answer: "MIT" },
		metadata: { category: "education", difficulty: "easy" },
	},
	{
		id: "qt_006",
		contexts: [
			{ content: "User's birthday is March 15, 1995." },
			{ content: "User mentioned they're a Pisces." },
		],
		query: "When is the user's birthday?",
		expected: { answer: ["March 15", "March 15, 1995", "15 March"] },
		metadata: { category: "temporal", difficulty: "easy" },
	},
	{
		id: "qt_007",
		contexts: [
			{ content: "User speaks English, Spanish, and basic Japanese." },
			{ content: "User learned Spanish during a year abroad in Spain." },
		],
		query: "What languages does the user speak?",
		expected: { answer: ["English", "Spanish", "Japanese"] },
		metadata: { category: "skill", difficulty: "medium" },
	},
	{
		id: "qt_008",
		contexts: [
			{ content: "User's current project is building a recommendation engine." },
			{ content: "The project uses collaborative filtering and is written in Python." },
		],
		query: "What is the user working on?",
		expected: { answer: "recommendation engine" },
		metadata: { category: "work", difficulty: "medium" },
	},
	{
		id: "qt_009",
		contexts: [
			{ content: "User prefers VS Code as their primary IDE." },
			{ content: "User also uses Vim for quick edits and loves the Dracula theme." },
		],
		query: "What IDE does the user prefer?",
		expected: { answer: ["VS Code", "VSCode", "Visual Studio Code"] },
		metadata: { category: "preference", difficulty: "easy" },
	},
	{
		id: "qt_010",
		contexts: [
			{ content: "User's team consists of 5 engineers and 2 designers." },
			{ content: "User is the tech lead and reports to the CTO." },
		],
		query: "What is the user's role?",
		expected: { answer: "tech lead" },
		metadata: { category: "work", difficulty: "medium" },
	},
];

/**
 * Evaluate if search results contain the expected answer
 */
function evaluateResult(testCase: TestCase, results: SearchResult[]): EvaluationResult {
	const expected = testCase.expected.answer;

	// Normalize expected answers to array of lowercase strings
	const expectedAnswers = Array.isArray(expected)
		? expected.map((a) => String(a).toLowerCase())
		: [String(expected).toLowerCase()];

	// Check if any result contains any expected answer
	for (const result of results) {
		const contentLower = result.content.toLowerCase();
		for (const answer of expectedAnswers) {
			if (contentLower.includes(answer)) {
				return {
					passed: true,
					score: 1,
					details: {
						foundAnswer: answer,
						matchedResults: [result],
					},
				};
			}
		}
	}

	// Partial credit: check if query terms appear in results
	const queryTerms = testCase.query
		.toLowerCase()
		.replace(/[^\w\s]/g, "")
		.split(/\s+/)
		.filter((t) => t.length > 3);

	let relevantResults = 0;
	for (const result of results) {
		const contentLower = result.content.toLowerCase();
		const matchedTerms = queryTerms.filter((term) => contentLower.includes(term));
		if (matchedTerms.length >= queryTerms.length * 0.5) {
			relevantResults++;
		}
	}

	if (relevantResults > 0) {
		return {
			passed: false,
			score: 0.3, // Partial credit for relevant retrieval
			details: {
				reason: `Found ${relevantResults} relevant results but not the expected answer`,
			},
		};
	}

	return {
		passed: false,
		score: 0,
		details: {
			reason: `Expected "${expectedAnswers.join(" or ")}" not found in ${results.length} results`,
		},
	};
}

/**
 * Create the QuickTest benchmark
 */
export function createQuickTestBenchmark(): Benchmark {
	return {
		name: "quicktest",

		async load(): Promise<TestCase[]> {
			return QUICKTEST_DATA;
		},

		evaluate: evaluateResult,
	};
}

// Default export
export default createQuickTestBenchmark;

