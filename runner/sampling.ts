/**
 * Sampling and Filtering Utilities
 *
 * Utilities for filtering test cases based on various criteria.
 */

import type { TestCase } from "../benchmarks/types";
import { extractTaskType } from "./taxonomy";

/**
 * Filter options for test cases
 */
export interface FilterOptions {
	/** Filter by task types (include only these) */
	taskTypes?: string[];
	/** Filter by category */
	category?: string | number;
	/** Filter by difficulty */
	difficulty?: string;
	/** Filter by query length */
	queryLength?: { min?: number; max?: number };
	/** Filter by context count */
	contextCount?: { min?: number; max?: number };
	/** Filter by context length (sum of all context lengths) */
	contextLength?: { min?: number; max?: number };
	/** Filter by query contains text */
	queryContains?: string[];
	/** Filter by query pattern (regex) */
	queryPattern?: RegExp;
	/** Custom filter function */
	customFilter?: (testCase: TestCase) => boolean;
}

/**
 * Sampling options for test cases
 */
export interface SamplingOptions {
	/** Number of test cases to sample */
	count?: number;
	/** Random seed for reproducibility */
	seed?: number;
	/** Weighted sampling configuration */
	weighted?: {
		/** Field to use for weighting (e.g., "difficulty", "taskType") */
		field: string;
		/** Weight multipliers per value (e.g., { "hard": 2.0, "easy": 0.5 }) */
		weights: { [value: string]: number };
	};
}

/**
 * Filter test cases based on options
 */
export function filterTestCases(
	testCases: TestCase[],
	options: FilterOptions,
): TestCase[] {
	let filtered = [...testCases];

	// Filter by task types
	if (options.taskTypes && options.taskTypes.length > 0) {
		const normalizedTaskTypes = options.taskTypes.map(t => t.toLowerCase().trim());
		filtered = filtered.filter(tc => {
			const taskType = extractTaskType(tc).toLowerCase();
			return normalizedTaskTypes.includes(taskType);
		});
	}

	// Filter by category
	if (options.category !== undefined) {
		filtered = filtered.filter(tc => {
			const cat = tc.metadata?.category;
			if (cat === undefined) return false;
			return cat === options.category || String(cat) === String(options.category);
		});
	}

	// Filter by difficulty
	if (options.difficulty) {
		filtered = filtered.filter(tc => {
			const diff = tc.metadata?.difficulty;
			return diff && String(diff).toLowerCase() === options.difficulty!.toLowerCase();
		});
	}

	// Filter by query length
	if (options.queryLength) {
		filtered = filtered.filter(tc => {
			const length = tc.query.length;
			if (options.queryLength!.min !== undefined && length < options.queryLength!.min) {
				return false;
			}
			if (options.queryLength!.max !== undefined && length > options.queryLength!.max) {
				return false;
			}
			return true;
		});
	}

	// Filter by context count
	if (options.contextCount) {
		filtered = filtered.filter(tc => {
			const count = tc.contexts.length;
			if (options.contextCount!.min !== undefined && count < options.contextCount!.min) {
				return false;
			}
			if (options.contextCount!.max !== undefined && count > options.contextCount!.max) {
				return false;
			}
			return true;
		});
	}

	// Filter by context length
	if (options.contextLength) {
		filtered = filtered.filter(tc => {
			const totalLength = tc.contexts.reduce((sum, ctx) => sum + ctx.content.length, 0);
			if (options.contextLength!.min !== undefined && totalLength < options.contextLength!.min) {
				return false;
			}
			if (options.contextLength!.max !== undefined && totalLength > options.contextLength!.max) {
				return false;
			}
			return true;
		});
	}

	// Filter by query contains
	if (options.queryContains && options.queryContains.length > 0) {
		filtered = filtered.filter(tc => {
			const queryLower = tc.query.toLowerCase();
			return options.queryContains!.some(term => queryLower.includes(term.toLowerCase()));
		});
	}

	// Filter by query pattern
	if (options.queryPattern) {
		filtered = filtered.filter(tc => options.queryPattern!.test(tc.query));
	}

	// Custom filter
	if (options.customFilter) {
		filtered = filtered.filter(options.customFilter);
	}

	return filtered;
}

/**
 * Sample test cases with optional weighted sampling
 */
export function sampleTestCases(
	testCases: TestCase[],
	options?: SamplingOptions,
): TestCase[] {
	// Handle legacy signature (count, seed)
	let count: number | undefined;
	let seed: number | undefined;
	let weighted: SamplingOptions["weighted"];
	
	if (typeof options === "number") {
		// Legacy: sampleTestCases(testCases, count, seed)
		count = options;
		seed = arguments[2] as number | undefined;
	} else if (options) {
		// New: sampleTestCases(testCases, { count, seed, weighted })
		count = options.count;
		seed = options.seed;
		weighted = options.weighted;
	}

	if (!count || count >= testCases.length) {
		return testCases;
	}

	// Weighted sampling
	if (weighted) {
		return weightedSample(testCases, count, weighted, seed);
	}

	// Simple random sampling with seed
	if (seed !== undefined) {
		return seededSample(testCases, count, seed);
	}

	// Random sampling without seed
	const shuffled = [...testCases].sort(() => Math.random() - 0.5);
	return shuffled.slice(0, count);
}

/**
 * Seeded random number generator
 */
function createSeededRandom(seed: number): () => number {
	let rng = seed;
	return () => {
		rng = (rng * 9301 + 49297) % 233280;
		return rng / 233280;
	};
}

/**
 * Seeded sampling (for reproducibility)
 */
function seededSample(testCases: TestCase[], count: number, seed: number): TestCase[] {
	const random = createSeededRandom(seed);
	const sampled: TestCase[] = [];
	const indices = new Set<number>();

	while (sampled.length < count && indices.size < testCases.length) {
		const idx = Math.floor(random() * testCases.length);
		if (!indices.has(idx)) {
			indices.add(idx);
			sampled.push(testCases[idx]!);
		}
	}

	return sampled;
}

/**
 * Weighted sampling based on field values
 */
function weightedSample(
	testCases: TestCase[],
	count: number,
	weighted: NonNullable<SamplingOptions["weighted"]>,
	seed?: number,
): TestCase[] {
	const { field, weights } = weighted;

	// Calculate weights for each test case
	const testCaseWeights = testCases.map(tc => {
		const value = getFieldValue(tc, field);
		const weight = weights[value] ?? 1.0;
		return Math.max(0, weight); // Ensure non-negative
	});

	// Calculate cumulative weights
	const totalWeight = testCaseWeights.reduce((sum, w) => sum + w, 0);
	if (totalWeight === 0) {
		// Fallback to uniform sampling if all weights are 0
		return seed !== undefined
			? seededSample(testCases, count, seed)
			: testCases.slice(0, count);
	}

	const cumulativeWeights = testCaseWeights.map((weight, i) =>
		testCaseWeights.slice(0, i + 1).reduce((sum, w) => sum + w, 0),
	);

	// Sample based on weights
	const random = seed !== undefined ? createSeededRandom(seed) : Math.random;
	const sampled: TestCase[] = [];
	const sampledIndices = new Set<number>();

	while (sampled.length < count && sampledIndices.size < testCases.length) {
		const r = random() * totalWeight;
		const idx = cumulativeWeights.findIndex(cw => r <= cw);
		
		if (idx !== -1 && !sampledIndices.has(idx)) {
			sampledIndices.add(idx);
			sampled.push(testCases[idx]!);
		}
	}

	return sampled;
}

/**
 * Get field value from test case (supports nested paths)
 */
function getFieldValue(testCase: TestCase, field: string): string {
	// Handle special fields
	if (field === "taskType") {
		return extractTaskType(testCase);
	}

	// Handle metadata fields
	if (field.startsWith("metadata.")) {
		const metadataField = field.substring(9);
		const value = testCase.metadata?.[metadataField];
		return value !== undefined ? String(value) : "unknown";
	}

	// Handle direct metadata access
	const value = testCase.metadata?.[field];
	return value !== undefined ? String(value) : "unknown";
}

