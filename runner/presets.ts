/**
 * Sampling Presets
 *
 * Management system for saved sampling and filtering configurations.
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FilterOptions, SamplingOptions } from "./sampling";

export interface PresetConfig {
	/** Preset name (unique identifier) */
	name: string;
	/** Description of what this preset does */
	description?: string;
	/** Task types to include */
	taskTypes?: string[];
	/** Filtering options */
	filters?: {
		queryLength?: { min?: number; max?: number };
		queryContains?: string[];
		queryPattern?: string; // Serialized as string
		contextCount?: { min?: number; max?: number };
		contextLength?: { min?: number; max?: number };
		difficulty?: string;
		category?: string | number;
	};
	/** Sampling options */
	sampling?: {
		count?: number;
		seed?: number;
		weighted?: {
			field: string;
			weights: { [value: string]: number };
		};
	};
	/** Created timestamp */
	createdAt?: string;
	/** Last modified timestamp */
	modifiedAt?: string;
}

export interface PresetStore {
	version: string;
	presets: { [name: string]: PresetConfig };
}

const PRESET_DIR = join(process.cwd(), ".memorybench");
const PRESET_FILE = join(PRESET_DIR, "presets.json");
const PRESET_VERSION = "1.0.0";

/**
 * Load all presets from disk
 */
export async function loadPresets(): Promise<PresetStore> {
	if (!existsSync(PRESET_FILE)) {
		return {
			version: PRESET_VERSION,
			presets: {},
		};
	}

	try {
		const content = await Bun.file(PRESET_FILE).text();
		const store = JSON.parse(content) as PresetStore;
		return store;
	} catch (error) {
		console.warn(`Warning: Failed to load presets from ${PRESET_FILE}:`, error);
		return {
			version: PRESET_VERSION,
			presets: {},
		};
	}
}

/**
 * Save presets to disk
 */
export async function savePresets(store: PresetStore): Promise<void> {
	// Ensure directory exists
	if (!existsSync(PRESET_DIR)) {
		await mkdir(PRESET_DIR, { recursive: true });
	}

	const content = JSON.stringify(store, null, 2);
	await Bun.write(PRESET_FILE, content);
}

/**
 * Get a preset by name
 */
export async function getPreset(name: string): Promise<PresetConfig | null> {
	const store = await loadPresets();
	return store.presets[name] || null;
}

/**
 * Create or update a preset
 */
export async function savePreset(config: PresetConfig): Promise<void> {
	const store = await loadPresets();
	const now = new Date().toISOString();

	const existing = store.presets[config.name];
	store.presets[config.name] = {
		...config,
		createdAt: existing?.createdAt || now,
		modifiedAt: now,
	};

	await savePresets(store);
}

/**
 * Delete a preset
 */
export async function deletePreset(name: string): Promise<boolean> {
	const store = await loadPresets();

	if (!store.presets[name]) {
		return false;
	}

	delete store.presets[name];
	await savePresets(store);
	return true;
}

/**
 * List all presets
 */
export async function listPresets(): Promise<PresetConfig[]> {
	const store = await loadPresets();
	return Object.values(store.presets);
}

/**
 * Convert preset to filter and sampling options
 */
export function presetToOptions(preset: PresetConfig): {
	taskTypes?: string[];
	filters?: FilterOptions;
	sampling?: SamplingOptions;
} {
	const filters: FilterOptions = {};

	if (preset.taskTypes) {
		// taskTypes is handled separately as it's top-level in RunOptions
	}

	if (preset.filters) {
		if (preset.filters.queryLength) {
			filters.queryLength = preset.filters.queryLength;
		}
		if (preset.filters.queryContains) {
			filters.queryContains = preset.filters.queryContains;
		}
		if (preset.filters.queryPattern) {
			try {
				filters.queryPattern = new RegExp(preset.filters.queryPattern);
			} catch (error) {
				console.warn(`Warning: Invalid regex pattern in preset: ${preset.filters.queryPattern}`);
			}
		}
		if (preset.filters.contextCount) {
			filters.contextCount = preset.filters.contextCount;
		}
		if (preset.filters.contextLength) {
			filters.contextLength = preset.filters.contextLength;
		}
		if (preset.filters.difficulty) {
			filters.difficulty = preset.filters.difficulty;
		}
		if (preset.filters.category !== undefined) {
			filters.category = preset.filters.category;
		}
	}

	return {
		taskTypes: preset.taskTypes,
		filters: Object.keys(filters).length > 0 ? filters : undefined,
		sampling: preset.sampling,
	};
}

/**
 * Get built-in presets
 */
export function getBuiltInPresets(): PresetConfig[] {
	return [
		{
			name: "quick",
			description: "Quick test with 10 samples",
			sampling: {
				count: 10,
				seed: 42,
			},
		},
		{
			name: "multihop-focus",
			description: "Focus on multi-hop reasoning tasks",
			taskTypes: ["multi-hop"],
			sampling: {
				count: 100,
				seed: 42,
			},
		},
		{
			name: "temporal-focus",
			description: "Focus on temporal reasoning tasks",
			taskTypes: ["temporal"],
			sampling: {
				count: 100,
				seed: 42,
			},
		},
		{
			name: "hard-only",
			description: "Only hard difficulty tasks",
			filters: {
				difficulty: "hard",
			},
		},
		{
			name: "long-queries",
			description: "Queries with at least 100 characters",
			filters: {
				queryLength: { min: 100 },
			},
		},
		{
			name: "weighted-hard",
			description: "Weighted sampling favoring hard tasks (2x)",
			sampling: {
				count: 100,
				seed: 42,
				weighted: {
					field: "difficulty",
					weights: {
						hard: 2.0,
						medium: 1.0,
						easy: 0.5,
					},
				},
			},
		},
	];
}

/**
 * Initialize built-in presets if they don't exist
 */
export async function initializeBuiltInPresets(): Promise<void> {
	const store = await loadPresets();
	const builtIn = getBuiltInPresets();

	let hasChanges = false;
	for (const preset of builtIn) {
		if (!store.presets[preset.name]) {
			store.presets[preset.name] = {
				...preset,
				createdAt: new Date().toISOString(),
			};
			hasChanges = true;
		}
	}

	if (hasChanges) {
		await savePresets(store);
	}
}

