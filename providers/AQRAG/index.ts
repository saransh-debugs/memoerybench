import type { BenchmarkRegistry, BenchmarkType } from "../../benchmarks";
import type { PreparedData, TemplateType } from "../_template";
import type { ProviderMeta } from "../../runner/types";
import { adaptLegacyProvider } from "../types";
import { addDocument } from "./src/add";
import { initDatabase } from "./src/db";
import { retrieve } from "./src/retrieve";

// Lazy initialization - only init when first used
let initialized = false;
async function ensureInitialized() {
	if (!initialized) {
		await initDatabase();
		initialized = true;
	}
}

// Legacy provider implementation (default export for backwards compatibility)
const aqragLegacyProvider = {
	name: "AQRAG",
	addContext: async (data: PreparedData) => {
		await ensureInitialized();
		console.log(`Processing AQRAG context: ${data.context}`);
		console.log(`Metadata:`, data.metadata);

		// Process the context as a document using AQRAG (with question generation)
		await addDocument(data.context);
	},

	searchQuery: async (query: string) => {
		await ensureInitialized();
		console.log(`Searching with AQRAG (question-enhanced): ${query}`);
		const results = await retrieve(query);

		// Transform WeightedSearchResult[] to expected format with actual similarity scores
		return results.map((result) => ({
			id: result.id.toString(),
			context: result.content,
			score: result.similarity_score,
		}));
	},

	prepareProvider: <T extends BenchmarkType>(
		benchmarkType: T,
		data: BenchmarkRegistry[T][],
	): PreparedData[] => {
		switch (benchmarkType) {
			case "RAG-template-benchmark": {
				const ragData = data as BenchmarkRegistry["RAG-template-benchmark"][];
				return ragData.map((item) => ({
					context: `AQRAG Format:\nQuery: ${item.question}\n\nContext Sources:\n${item.documents.map((d, idx) => `[${idx + 1}] ${d.title || `Source ${idx + 1}`}:\n${d.content}`).join("\n\n")}`,
					metadata: {
						benchmarkId: item.id,
						query: item.question,
						expectedResponse: item.expected_answer,
						difficulty: item.metadata.difficulty,
						category: item.metadata.category,
						sources: item.documents.map((d) => ({
							id: d.id,
							title: d.title,
							source: d.source,
						})),
						aqragProcessed: true,
					},
				}));
			}

			case "LoCoMo": {
				const locomoData = data as BenchmarkRegistry["LoCoMo"][];
				const preparedData: PreparedData[] = [];
				
				for (const item of locomoData) {
					// Process conversation entries
					for (const [sessionDate, sessionData] of Object.entries(item.conversation)) {
						let sessionContext: string;
						
						if (typeof sessionData === "string") {
							// Simple string session
							sessionContext = `AQRAG Format:\nSession Date: ${sessionDate}\n\nConversation:\n${sessionData}`;
						} else if (Array.isArray(sessionData)) {
							// Array of session items (dialogues)
							const dialogueContent = sessionData
								.map((s: { speaker: string; text: string; blip_caption?: string }) => {
									let line = `${s.speaker}: ${s.text}`;
									if (s.blip_caption) line += ` [Image: ${s.blip_caption}]`;
									return line;
								})
								.join("\n");
							sessionContext = `AQRAG Format:\nSession Date: ${sessionDate}\n\nConversation:\n${dialogueContent}`;
						} else {
							continue; // Skip unknown formats
						}
						
						preparedData.push({
							context: sessionContext,
							metadata: {
								benchmarkId: item.sample_id,
								sessionDate: sessionDate,
								type: typeof sessionData === "string" ? "conversation" : "dialogue",
								aqragProcessed: true,
							},
						});
					}
					
					// Add event summaries if available
					if (item.event_summary) {
						for (const [date, events] of Object.entries(item.event_summary)) {
							const eventContent = Object.entries(events)
								.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
								.join("\n");
							
							preparedData.push({
								context: `AQRAG Format:\nEvent Summary Date: ${date}\n\nEvents:\n${eventContent}`,
								metadata: {
									benchmarkId: item.sample_id,
									date: date,
									type: "event_summary",
									aqragProcessed: true,
								},
							});
						}
					}
					
					// Add session summaries if available
					if (item.session_summary) {
						for (const [date, summary] of Object.entries(item.session_summary)) {
							preparedData.push({
								context: `AQRAG Format:\nSession Summary Date: ${date}\n\nSummary:\n${summary}`,
								metadata: {
									benchmarkId: item.sample_id,
									date: date,
									type: "session_summary",
									aqragProcessed: true,
								},
							});
						}
					}
				}
				
				return preparedData;
			}

			default:
				throw new Error(
					`AQRAG provider does not support benchmark type: ${benchmarkType}`,
				);
		}
	},
} satisfies TemplateType;

// Default export for backwards compatibility
export default aqragLegacyProvider;

/**
 * Provider metadata for auto-discovery
 */
export const meta: ProviderMeta = {
	name: "aqrag",
	description: "AQRAG provider - requires PostgreSQL + pgvector",
	requiresEnv: ["DATABASE_URL", "GOOGLE_GENERATIVE_AI_API_KEY"],
};

/**
 * Create an AQRAG provider instance
 * Wraps the legacy provider with the adapter to work with the unified interface
 */
export function createAQRAGProvider() {
	return adaptLegacyProvider(aqragLegacyProvider);
}
