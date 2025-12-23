/**
 * Claim Usage Judge (Constrained LLM Evaluation)
 * 
 * THE JUDGE NEVER DECIDES TRUTH.
 * 
 * It only scores how well claims were USED in the answer, given:
 * - The claims that were produced
 * - Their supporting memory events
 * - The final answer text
 * 
 * This removes "hail mary" behavior entirely.
 * The judge cannot save bad memory - it can only penalize misuse.
 */

import { generateText } from "ai";
import type { ClaimGraph, ClaimUsageMetrics } from "./types";

const DEFAULT_JUDGE_MODEL = "gpt-4o";

/**
 * Create an OpenAI-compatible model instance.
 */
async function getOpenAIModel(modelName: string, apiKey: string) {
	try {
		const { createOpenAI } = await import("@ai-sdk/openai");
		const openai = createOpenAI({ apiKey });
		return openai(modelName);
	} catch {
		throw new Error(
			"@ai-sdk/openai is required for LLM judge. Install with: bun add @ai-sdk/openai"
		);
	}
}

/**
 * Format a claim graph for the judge prompt.
 */
function formatClaimGraphForJudge(graph: ClaimGraph): string {
	const claimsSection = graph.claims
		.map((c, i) => {
			const supports = c.supportIds.length > 0 
				? c.supportIds.join(", ") 
				: "(no supports)";
			return `  ${i + 1}. "${c.statement}" [supports: ${supports}]`;
		})
		.join("\n");
	
	const supportsSection = graph.supports
		.map((s) => `  - ${s.eventId}: "${s.content.substring(0, 100)}..."`)
		.join("\n");
	
	return `CLAIMS MADE:
${claimsSection}

SUPPORTING MEMORY EVENTS:
${supportsSection}`;
}

/**
 * Evaluate claim usage quality using LLM judge.
 * 
 * IMPORTANT: The judge does NOT evaluate truth or correctness.
 * It only evaluates HOW WELL the claims were used in the answer.
 * 
 * Questions the judge answers:
 * - Are claims combined coherently?
 * - Are the claims relevant to the question?
 * - Are all necessary claims used?
 * - Are irrelevant claims over-emphasized?
 */
export async function evaluateClaimUsage(
	question: string,
	claimGraph: ClaimGraph,
	options?: {
		model?: string;
		apiKey?: string;
	},
): Promise<ClaimUsageMetrics> {
	const model = options?.model || DEFAULT_JUDGE_MODEL;
	const apiKey = options?.apiKey || process.env.OPENAI_API_KEY;

	if (!apiKey) {
		return createErrorMetrics("No OpenAI API key available for LLM judge");
	}

	// If no claims or no answer, return error metrics
	if (claimGraph.claims.length === 0) {
		return createErrorMetrics("No claims produced to evaluate");
	}
	
	if (!claimGraph.answerText) {
		return createErrorMetrics("No answer text to evaluate claim usage");
	}

	const claimGraphText = formatClaimGraphForJudge(claimGraph);

	const usagePrompt = `You are evaluating HOW WELL claims were used in an answer.

IMPORTANT: You are NOT judging whether claims are TRUE or CORRECT.
That has already been determined by deterministic metrics.
You are ONLY judging the QUALITY OF USAGE.

---

QUESTION: ${question}

${claimGraphText}

ANSWER TEXT:
"${claimGraph.answerText}"

---

Evaluate the answer on these dimensions (1-5 scale):

1. **Coherence**: Are the claims combined logically? Does the answer flow naturally?
   - 5: Claims are seamlessly integrated into a coherent narrative
   - 3: Claims are present but connection is awkward
   - 1: Claims are contradictory or incoherently combined

2. **Relevance**: Are the claims actually relevant to answering the question?
   - 5: All claims directly address the question
   - 3: Some claims are tangential
   - 1: Claims don't address the question

3. **Completeness**: Given the claims available, does the answer use them fully?
   - 5: All relevant claims are utilized appropriately
   - 3: Some claims are under-utilized
   - 1: Key claims are ignored

4. **Conciseness**: Are irrelevant claims avoided or minimized?
   - 5: No unnecessary information, perfectly focused
   - 3: Some irrelevant details included
   - 1: Answer is cluttered with irrelevant claims

Also identify specific issues:
- Which claims (if any) were over-emphasized?
- Which claims (if any) were under-used?
- Which claim combinations (if any) were incoherent?

Respond ONLY with valid JSON:
{
  "coherence": <1-5>,
  "relevance": <1-5>,
  "completeness": <1-5>,
  "conciseness": <1-5>,
  "explanation": "<brief explanation>",
  "overEmphasized": ["<claim statement>", ...],
  "underUsed": ["<claim statement>", ...],
  "incoherentCombinations": ["<description of issue>", ...]
}`;

	try {
		const modelInstance = await getOpenAIModel(model, apiKey);
		
		const result = await generateText({
			model: modelInstance,
			messages: [{ role: "user", content: usagePrompt }],
		});

		const jsonMatch = result.text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			return createErrorMetrics("Failed to parse JSON from judge response");
		}

		const parsed = JSON.parse(jsonMatch[0]) as {
			coherence: number;
			relevance: number;
			completeness: number;
			conciseness: number;
			explanation: string;
			overEmphasized?: string[];
			underUsed?: string[];
			incoherentCombinations?: string[];
		};

		const coherence = clampScore(parsed.coherence);
		const relevance = clampScore(parsed.relevance);
		const completeness = clampScore(parsed.completeness);
		const conciseness = clampScore(parsed.conciseness);

		return {
			coherence,
			relevance,
			completeness,
			conciseness,
			averageScore: (coherence + relevance + completeness + conciseness) / 4,
			explanation: parsed.explanation || "No explanation provided",
			issues: {
				overEmphasized: parsed.overEmphasized || [],
				underUsed: parsed.underUsed || [],
				incoherentCombinations: parsed.incoherentCombinations || [],
			},
		};
	} catch (error) {
		return createErrorMetrics(
			`Judge error: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Extract claims from retrieved memory and answer text.
 * This helps systems that don't natively produce claim graphs.
 * 
 * NOTE: This is a bridge for non-claim-native systems.
 * Proper memory agents should produce claims directly.
 */
export async function extractClaimsFromAnswer(
	question: string,
	answerText: string,
	retrievedContext: string[],
	options?: {
		model?: string;
		apiKey?: string;
	},
): Promise<ClaimGraph> {
	const model = options?.model || DEFAULT_JUDGE_MODEL;
	const apiKey = options?.apiKey || process.env.OPENAI_API_KEY;

	if (!apiKey) {
		// Return empty claim graph if no API key
		return {
			query: question,
			claims: [],
			supports: [],
			answerText,
			generatedAt: new Date().toISOString(),
		};
	}

	const extractPrompt = `Extract atomic claims from this answer.

QUESTION: ${question}

ANSWER: ${answerText}

AVAILABLE CONTEXT (memory):
${retrievedContext.map((c, i) => `[M${i + 1}] ${c}`).join("\n\n")}

---

Extract ALL atomic, falsifiable claims from the answer.
For each claim, identify which context item(s) support it.

An atomic claim is a single fact that can be verified.
Good: "User lives in Lisbon"
Bad: "User moved to Lisbon and likes the weather there" (two claims)

Respond with JSON:
{
  "claims": [
    {
      "statement": "<atomic claim>",
      "supportIds": ["M1", "M2", ...]
    }
  ]
}`;

	try {
		const modelInstance = await getOpenAIModel(model, apiKey);
		
		const result = await generateText({
			model: modelInstance,
			messages: [{ role: "user", content: extractPrompt }],
		});

		const jsonMatch = result.text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			return createEmptyClaimGraph(question, answerText);
		}

		const parsed = JSON.parse(jsonMatch[0]) as {
			claims: Array<{ statement: string; supportIds: string[] }>;
		};

		// Build supports from context
		const supports = retrievedContext.map((content, i) => ({
			eventId: `M${i + 1}`,
			content,
		}));

		// Build claims
		const claims = parsed.claims.map((c, i) => ({
			id: `claim_${i + 1}`,
			statement: c.statement,
			supportIds: c.supportIds || [],
		}));

		return {
			query: question,
			claims,
			supports,
			answerText,
			generatedAt: new Date().toISOString(),
		};
	} catch (error) {
		console.error("Failed to extract claims:", error);
		return createEmptyClaimGraph(question, answerText);
	}
}

/**
 * Generate an answer from a claim graph.
 * This synthesizes claims into natural language.
 */
export async function generateAnswerFromClaims(
	question: string,
	claimGraph: ClaimGraph,
	options?: {
		model?: string;
		apiKey?: string;
	},
): Promise<string> {
	const model = options?.model || DEFAULT_JUDGE_MODEL;
	const apiKey = options?.apiKey || process.env.OPENAI_API_KEY;

	if (!apiKey || claimGraph.claims.length === 0) {
		return "Unable to generate answer.";
	}

	const claimsText = claimGraph.claims
		.map((c) => `- ${c.statement}`)
		.join("\n");

	const prompt = `Generate a natural answer to this question using ONLY the provided claims.

QUESTION: ${question}

CLAIMS TO USE:
${claimsText}

Generate a coherent, natural-sounding answer that incorporates these claims.
Do not add any information not present in the claims.

ANSWER:`;

	try {
		const modelInstance = await getOpenAIModel(model, apiKey);
		
		const result = await generateText({
			model: modelInstance,
			messages: [{ role: "user", content: prompt }],
		});
		
		return result.text.trim();
	} catch (error) {
		return `Error: ${error instanceof Error ? error.message : String(error)}`;
	}
}

// ============================================================================
// Helper functions
// ============================================================================

function clampScore(score: number): number {
	if (typeof score !== "number" || isNaN(score)) return 1;
	return Math.max(1, Math.min(5, Math.round(score)));
}

function createErrorMetrics(explanation: string): ClaimUsageMetrics {
	return {
		coherence: 1,
		relevance: 1,
		completeness: 1,
		conciseness: 1,
		averageScore: 1,
		explanation,
		issues: {
			overEmphasized: [],
			underUsed: [],
			incoherentCombinations: [],
		},
	};
}

function createEmptyClaimGraph(question: string, answerText: string): ClaimGraph {
	return {
		query: question,
		claims: [],
		supports: [],
		answerText,
		generatedAt: new Date().toISOString(),
	};
}
