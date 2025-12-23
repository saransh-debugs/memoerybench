/**
 * LoCoMo Benchmark
 *
 * Long Context Memory benchmark for evaluating memory systems
 * on long-form conversational data.
 */

import type { Benchmark, TestCase, EvaluationResult, Context } from "../types";
import type { SearchResult } from "../../providers/types";
import type { LoCoMoBenchmarkItem, qaItem, sessionItem } from "./types";
import type { BenchmarkMeta } from "../../runner/types";

/**
 * Benchmark metadata for auto-discovery
 */
export const meta: BenchmarkMeta = {
	name: "locomo",
	description: "Long Context Memory benchmark",
	testCaseCount: 50,
	estimatedTimeMs: 300000,
};

// Load the LoCoMo dataset
async function loadLoCoMoData(): Promise<LoCoMoBenchmarkItem[]> {
	const dataPath = new URL("./locomo10.json", import.meta.url).pathname;
	const file = Bun.file(dataPath);
	const data = await file.json();
	return data as LoCoMoBenchmarkItem[];
}

/**
 * Convert LoCoMo conversation data to contexts for ingestion
 */
function conversationToContexts(item: LoCoMoBenchmarkItem): Context[] {
	const contexts: Context[] = [];

	for (const [sessionDate, sessionData] of Object.entries(item.conversation)) {
		if (typeof sessionData === "string") {
			// Simple string session
			contexts.push({
				content: `[${sessionDate}] ${sessionData}`,
				meta: {
					sampleId: item.sample_id,
					sessionDate,
					type: "conversation",
				},
			});
		} else if (Array.isArray(sessionData)) {
			// Array of session items (dialogues)
			const dialogueContent = (sessionData as sessionItem[])
				.map((s) => {
					let line = `${s.speaker}: ${s.text}`;
					if (s.blip_caption) line += ` [Image: ${s.blip_caption}]`;
					return line;
				})
				.join("\n");

			contexts.push({
				content: `[${sessionDate}]\n${dialogueContent}`,
				meta: {
					sampleId: item.sample_id,
					sessionDate,
					type: "dialogue",
					messageCount: sessionData.length,
				},
			});
		}
	}

	// Add event summaries if available
	if (item.event_summary) {
		for (const [date, events] of Object.entries(item.event_summary)) {
			const eventContent = Object.entries(events)
				.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
				.join("\n");

			contexts.push({
				content: `[Event Summary - ${date}]\n${eventContent}`,
				meta: {
					sampleId: item.sample_id,
					date,
					type: "event_summary",
				},
			});
		}
	}

	// Add session summaries if available
	if (item.session_summary) {
		for (const [date, summary] of Object.entries(item.session_summary)) {
			contexts.push({
				content: `[Session Summary - ${date}] ${summary}`,
				meta: {
					sampleId: item.sample_id,
					date,
					type: "session_summary",
				},
			});
		}
	}

	return contexts;
}

/**
 * Convert LoCoMo QA items to test cases
 */
function qaToTestCases(item: LoCoMoBenchmarkItem): TestCase[] {
	const contexts = conversationToContexts(item);

	return item.qa.map((qa, idx) => ({
		id: `${item.sample_id}_q${idx + 1}`,
		contexts,
		query: qa.question,
		expected: {
			answer: qa.answer,
		},
		metadata: {
			sampleId: item.sample_id,
			category: qa.category,
			evidence: qa.evidence,
			questionIndex: idx,
		},
	}));
}

/**
 * Evaluate if search results contain the expected answer
 */
function evaluateResult(testCase: TestCase, results: SearchResult[]): EvaluationResult {
	const expected = testCase.expected.answer;

	// Normalize expected answer(s)
	const expectedAnswers = Array.isArray(expected)
		? expected.map((a) => String(a).toLowerCase().trim())
		: [String(expected).toLowerCase().trim()];

	// Check if any result contains any expected answer
	for (const result of results) {
		const contentLower = result.content.toLowerCase();
		for (const answer of expectedAnswers) {
			// Exact match or substring match
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

	// Check for partial matches (for dates, numbers, etc.)
	const evidence = testCase.metadata?.evidence as string[] | undefined;
	if (evidence && evidence.length > 0) {
		// Check if we retrieved content from the evidence sessions
		let evidenceMatches = 0;
		for (const result of results) {
			for (const ev of evidence) {
				// Evidence format is like "D1:3" meaning Day 1, message 3
				const dayMatch = ev.match(/D(\d+)/);
				if (dayMatch) {
					// Check if result contains content from that day
					const dayPattern = new RegExp(`\\[.*day.*${dayMatch[1]}|session.*${dayMatch[1]}`, "i");
					if (dayPattern.test(result.content)) {
						evidenceMatches++;
						break;
					}
				}
			}
		}

		if (evidenceMatches > 0) {
			return {
				passed: false,
				score: 0.5 * (evidenceMatches / evidence.length),
				details: {
					reason: `Found ${evidenceMatches}/${evidence.length} evidence sources but not exact answer`,
				},
			};
		}
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
 * Create the LoCoMo benchmark
 */
export function createLoCoMoBenchmark(): Benchmark {
	return {
		name: "locomo",

		async load(): Promise<TestCase[]> {
			const data = await loadLoCoMoData();
			const allTestCases: TestCase[] = [];

			for (const item of data) {
				const testCases = qaToTestCases(item);
				allTestCases.push(...testCases);
			}

			console.log(`  LoCoMo: Loaded ${data.length} samples, ${allTestCases.length} questions`);
			return allTestCases;
		},

		evaluate: evaluateResult,
	};
}

// Default export
export default createLoCoMoBenchmark;

