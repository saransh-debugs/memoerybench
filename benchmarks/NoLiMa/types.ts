/**
 * NoLiMa Benchmark Types
 *
 * NoLiMa (No Literal Match) evaluates retrieval from long contexts
 * where questions and answers have minimal lexical overlap.
 */

/**
 * A single NoLiMa test case
 */
export interface NoLiMaItem {
	/** Unique identifier for this test case */
	id: string;
	/** The question to answer (has minimal lexical overlap with answer) */
	question: string;
	/** The expected answer (needle) */
	answer: string;
	/** The long context (haystack) containing the answer */
	haystack: string;
	/** Position where the needle appears in the haystack */
	needlePosition: number;
	/** Context length in tokens */
	contextLength: number;
	/** Reasoning complexity: "one-hop" or "two-hop" */
	complexity: "one-hop" | "two-hop";
	/** Optional metadata */
	metadata?: {
		[key: string]: unknown;
	};
}

/**
 * NoLiMa dataset structure
 */
export interface NoLiMaDataset {
	/** Dataset version */
	version: string;
	/** List of test cases */
	items: NoLiMaItem[];
}

