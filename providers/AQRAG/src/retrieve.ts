import { findSimilarWeighted } from "./db";
import { QUESTION_WEIGHTAGE, SEARCH_RESULTS } from "./utils/config";
import { generateEmbeddings } from "./utils/llm";

export const retrieve = async (query: string) => {
	const embeddings = await generateEmbeddings([query]);

	if (
		!embeddings ||
		embeddings.length === 0 ||
		!Array.isArray(embeddings[0]) ||
		embeddings[0].length === 0
	) {
		throw new Error("Failed to generate embeddings");
	}

	const similarChunks = await findSimilarWeighted(
		embeddings[0],
		QUESTION_WEIGHTAGE,
		SEARCH_RESULTS,
	);

	return similarChunks;
};
