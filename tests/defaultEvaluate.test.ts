import { describe, test, expect } from "bun:test";
import { defaultEvaluate } from "../benchmarks/types";
import type { TestCase } from "../benchmarks/types";
import type { SearchResult } from "../providers/types";

describe("defaultEvaluate", () => {
	test("should pass when result contains expected answer", () => {
		const testCase: TestCase = {
			id: "test_001",
			contexts: [{ content: "User lives in Paris" }],
			query: "Where does the user live?",
			expected: { answer: "Paris" },
		};

		const results: SearchResult[] = [
			{
				id: "1",
				content: "The user lives in Paris, France",
				score: 0.9,
			},
		];

		const evaluation = defaultEvaluate(testCase, results);

		expect(evaluation.passed).toBe(true);
		expect(evaluation.score).toBe(1);
		expect(evaluation.details?.foundAnswer).toBe("paris");
	});

	test("should pass with multiple valid answers", () => {
		const testCase: TestCase = {
			id: "test_002",
			contexts: [{ content: "User moved in January 2023" }],
			query: "When did the user move?",
			expected: { answer: ["January 2023", "2023"] },
		};

		const results: SearchResult[] = [
			{
				id: "1",
				content: "The user moved in 2023",
				score: 0.8,
			},
		];

		const evaluation = defaultEvaluate(testCase, results);

		expect(evaluation.passed).toBe(true);
		expect(evaluation.score).toBe(1);
	});

	test("should fail when expected answer not found", () => {
		const testCase: TestCase = {
			id: "test_003",
			contexts: [{ content: "User lives in Paris" }],
			query: "Where does the user live?",
			expected: { answer: "London" },
		};

		const results: SearchResult[] = [
			{
				id: "1",
				content: "The user lives in Paris",
				score: 0.9,
			},
		];

		const evaluation = defaultEvaluate(testCase, results);

		expect(evaluation.passed).toBe(false);
		expect(evaluation.score).toBe(0);
		expect(evaluation.details?.reason).toContain("london");
	});

	test("should respect minScore threshold", () => {
		const testCase: TestCase = {
			id: "test_004",
			contexts: [{ content: "User lives in Paris" }],
			query: "Where does the user live?",
			expected: { answer: "Paris", minScore: 0.5 },
		};

		const results: SearchResult[] = [
			{
				id: "1",
				content: "The user lives in Paris",
				score: 0.3, // Below threshold
			},
		];

		const evaluation = defaultEvaluate(testCase, results);

		expect(evaluation.passed).toBe(false);
		expect(evaluation.score).toBe(0);
	});

	test("should pass with requiredContent even if exact answer not found", () => {
		const testCase: TestCase = {
			id: "test_005",
			contexts: [{ content: "User information" }],
			query: "What is the user's name?",
			expected: {
				answer: "John",
				requiredContent: ["user", "name"],
			},
		};

		const results: SearchResult[] = [
			{
				id: "1",
				content: "The user's name is not mentioned",
				score: 0.8,
			},
		];

		const evaluation = defaultEvaluate(testCase, results);

		expect(evaluation.passed).toBe(true);
		expect(evaluation.score).toBe(0.8); // Partial credit
		expect(evaluation.details?.reason).toContain("required content");
	});

	test("should handle case-insensitive matching", () => {
		const testCase: TestCase = {
			id: "test_006",
			contexts: [{ content: "User information" }],
			query: "What is the capital?",
			expected: { answer: "PARIS" },
		};

		const results: SearchResult[] = [
			{
				id: "1",
				content: "The capital is paris",
				score: 0.9,
			},
		];

		const evaluation = defaultEvaluate(testCase, results);

		expect(evaluation.passed).toBe(true);
		expect(evaluation.score).toBe(1);
	});
});

