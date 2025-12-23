/**
 * Task Type Taxonomy
 *
 * Standardized task type definitions for benchmarks.
 * Benchmarks can use these directly or map their own categories to these types.
 */

/**
 * Standard task types for memory benchmarks
 */
export type TaskType =
	| "multi-hop"      // Requires reasoning across multiple pieces of information
	| "temporal"       // Time-based queries (when, recent, chronological)
	| "preference"     // User preferences and opinions
	| "factual"        // Simple factual recall
	| "entity"          // Entity recognition and relationships
	| "location"        // Location-based queries
	| "comparison"      // Comparing multiple items
	| "causal"          // Cause-and-effect reasoning
	| "other";          // Catch-all for unclassified

/**
 * Task type metadata
 */
export interface TaskTypeInfo {
	/** Display name */
	name: string;
	/** Description */
	description: string;
	/** Common aliases/variations */
	aliases?: string[];
}

/**
 * Task type registry with metadata
 */
export const TASK_TYPES: Record<TaskType, TaskTypeInfo> = {
	"multi-hop": {
		name: "Multi-Hop Reasoning",
		description: "Requires reasoning across multiple pieces of information",
		aliases: ["multi-hop", "multi_hop", "multihop", "reasoning"],
	},
	"temporal": {
		name: "Temporal Queries",
		description: "Time-based queries (when, recent, chronological)",
		aliases: ["temporal", "time", "date", "chronological"],
	},
	"preference": {
		name: "Preferences",
		description: "User preferences and opinions",
		aliases: ["preference", "preferences", "opinion", "likes"],
	},
	"factual": {
		name: "Factual Recall",
		description: "Simple factual recall",
		aliases: ["factual", "fact", "recall", "simple"],
	},
	"entity": {
		name: "Entity Recognition",
		description: "Entity recognition and relationships",
		aliases: ["entity", "entities", "named-entity"],
	},
	"location": {
		name: "Location Queries",
		description: "Location-based queries",
		aliases: ["location", "geographic", "place", "where"],
	},
	"comparison": {
		name: "Comparison",
		description: "Comparing multiple items",
		aliases: ["comparison", "compare", "versus"],
	},
	"causal": {
		name: "Causal Reasoning",
		description: "Cause-and-effect reasoning",
		aliases: ["causal", "cause", "effect", "why"],
	},
	"other": {
		name: "Other",
		description: "Unclassified or other task types",
		aliases: ["other", "unknown", "misc"],
	},
};

/**
 * Extract task type from test case metadata
 * 
 * Priority:
 * 1. metadata.taskType (if explicitly set)
 * 2. metadata.category (if it matches a known task type)
 * 3. Infer from category number (for benchmarks like LoCoMo)
 * 4. Default to "other"
 */
export function extractTaskType(testCase: { metadata?: Record<string, unknown> }): TaskType {
	const metadata = testCase.metadata;
	if (!metadata) return "other";

	// Check for explicit taskType
	if (metadata.taskType && typeof metadata.taskType === "string") {
		const taskType = normalizeTaskType(metadata.taskType);
		if (taskType) return taskType;
	}

	// Check category as string
	if (metadata.category && typeof metadata.category === "string") {
		const taskType = normalizeTaskType(metadata.category);
		if (taskType) return taskType;
	}

	// Check category as number (e.g., LoCoMo uses 1-5)
	if (metadata.category && typeof metadata.category === "number") {
		const taskType = mapCategoryNumberToTaskType(metadata.category);
		if (taskType) return taskType;
	}

	return "other";
}

/**
 * Normalize a string to a standard task type
 */
export function normalizeTaskType(input: string): TaskType | null {
	const normalized = input.toLowerCase().trim().replace(/[_-]/g, "-");
	
	// Direct match
	if (normalized in TASK_TYPES) {
		return normalized as TaskType;
	}

	// Check aliases
	for (const [taskType, info] of Object.entries(TASK_TYPES)) {
		if (info.aliases?.some(alias => alias.toLowerCase() === normalized)) {
			return taskType as TaskType;
		}
	}

	return null;
}

/**
 * Map category number to task type
 * 
 * This is benchmark-specific. For LoCoMo:
 * 1 = factual/preference
 * 2 = temporal
 * 3 = multi-hop
 * 4 = preference/other
 * 5 = other
 */
export function mapCategoryNumberToTaskType(category: number): TaskType | null {
	// LoCoMo mapping (can be extended for other benchmarks)
	// These mappings are heuristic - benchmarks should ideally set taskType explicitly
	const locomoMapping: Record<number, TaskType> = {
		1: "factual",
		2: "temporal",
		3: "multi-hop",
		4: "preference",
		5: "other",
	};

	return locomoMapping[category] || null;
}

/**
 * Get all known task types
 */
export function getAllTaskTypes(): TaskType[] {
	return Object.keys(TASK_TYPES) as TaskType[];
}

/**
 * Validate task type
 */
export function isValidTaskType(input: string): boolean {
	return normalizeTaskType(input) !== null;
}

