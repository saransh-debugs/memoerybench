/**
 * Pretty CLI Output
 *
 * Progress bars, spinners, and formatted tables for terminal output.
 */

// =============================================================================
// Colors (ANSI escape codes)
// =============================================================================

const colors = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	gray: "\x1b[90m",
	bgRed: "\x1b[41m",
	bgGreen: "\x1b[42m",
	bgYellow: "\x1b[43m",
	bgBlue: "\x1b[44m",
};

// Check if colors should be disabled
const NO_COLOR = process.env.NO_COLOR || process.env.TERM === "dumb";

function c(color: keyof typeof colors, text: string): string {
	if (NO_COLOR) return text;
	return `${colors[color]}${text}${colors.reset}`;
}

// =============================================================================
// Progress Bar
// =============================================================================

export interface ProgressBarOptions {
	total: number;
	width?: number;
	complete?: string;
	incomplete?: string;
	format?: string;
}

export class ProgressBar {
	private current = 0;
	private total: number;
	private width: number;
	private completeChar: string;
	private incomplete: string;
	private startTime: number;
	private lastRender = 0;

	constructor(options: ProgressBarOptions) {
		this.total = options.total;
		this.width = options.width ?? 30;
		this.completeChar = options.complete ?? "█";
		this.incomplete = options.incomplete ?? "░";
		this.startTime = Date.now();
	}

	update(current: number, tokens?: Record<string, string | number>): void {
		this.current = current;

		// Throttle renders to 10fps
		const now = Date.now();
		if (now - this.lastRender < 100 && current < this.total) return;
		this.lastRender = now;

		this.render(tokens);
	}

	increment(tokens?: Record<string, string | number>): void {
		this.update(this.current + 1, tokens);
	}

	private render(tokens?: Record<string, string | number>): void {
		const ratio = Math.min(1, this.current / this.total);
		const percent = Math.floor(ratio * 100);
		const filled = Math.floor(this.width * ratio);
		const empty = this.width - filled;

		const bar =
			c("green", this.completeChar.repeat(filled)) +
			c("gray", this.incomplete.repeat(empty));

		const elapsed = Date.now() - this.startTime;
		const eta = this.current > 0 ? (elapsed / this.current) * (this.total - this.current) : 0;

		let line = `  ${bar} ${c("bold", `${percent}%`)} `;
		line += c("dim", `[${this.current}/${this.total}]`);

		if (this.current < this.total && eta > 0) {
			line += c("dim", ` ETA: ${formatDuration(eta)}`);
		}

		if (tokens) {
			for (const [key, value] of Object.entries(tokens)) {
				line += c("dim", ` ${key}: ${value}`);
			}
		}

		// Clear line and write
		process.stdout.write(`\r\x1b[K${line}`);

		if (this.current >= this.total) {
			process.stdout.write("\n");
		}
	}

	complete(): void {
		this.update(this.total);
	}
}

// =============================================================================
// Spinner
// =============================================================================

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
	private frameIndex = 0;
	private interval: ReturnType<typeof setInterval> | null = null;
	private message: string;

	constructor(message: string) {
		this.message = message;
	}

	start(): void {
		if (NO_COLOR) {
			console.log(`  ${this.message}...`);
			return;
		}

		this.interval = setInterval(() => {
			const frame = SPINNER_FRAMES[this.frameIndex];
			process.stdout.write(`\r\x1b[K  ${c("cyan", frame!)} ${this.message}`);
			this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
		}, 80);
	}

	stop(success: boolean = true): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}

		const icon = success ? c("green", "✓") : c("red", "✗");
		process.stdout.write(`\r\x1b[K  ${icon} ${this.message}\n`);
	}

	update(message: string): void {
		this.message = message;
	}
}

// =============================================================================
// Tables
// =============================================================================

export interface TableColumn {
	header: string;
	width?: number;
	align?: "left" | "right" | "center";
}

export interface TableOptions {
	columns: TableColumn[];
	borders?: boolean;
}

export function createTable(options: TableOptions): {
	addRow: (values: (string | number)[]) => void;
	render: () => string;
} {
	const { columns, borders = true } = options;
	const rows: string[][] = [];

	// Calculate column widths
	const widths = columns.map((col, i) => {
		const headerWidth = col.header.length;
		const specifiedWidth = col.width ?? 0;
		return Math.max(headerWidth, specifiedWidth);
	});

	function padCell(value: string, width: number, align: "left" | "right" | "center" = "left"): string {
		const stripped = stripAnsi(value);
		const padding = width - stripped.length;
		if (padding <= 0) return value.substring(0, width);

		switch (align) {
			case "right":
				return " ".repeat(padding) + value;
			case "center":
				const left = Math.floor(padding / 2);
				const right = padding - left;
				return " ".repeat(left) + value + " ".repeat(right);
			default:
				return value + " ".repeat(padding);
		}
	}

	return {
		addRow(values: (string | number)[]) {
			const row = values.map((v, i) => {
				const str = String(v);
				const stripped = stripAnsi(str);
				widths[i] = Math.max(widths[i]!, stripped.length);
				return str;
			});
			rows.push(row);
		},

		render(): string {
			const lines: string[] = [];

			if (borders) {
				// Top border
				lines.push("┌" + widths.map((w) => "─".repeat(w + 2)).join("┬") + "┐");

				// Header
				const header = columns.map((col, i) =>
					padCell(c("bold", col.header), widths[i]!, col.align),
				);
				lines.push("│ " + header.join(" │ ") + " │");

				// Header separator
				lines.push("├" + widths.map((w) => "─".repeat(w + 2)).join("┼") + "┤");

				// Rows
				for (const row of rows) {
					const cells = row.map((cell, i) =>
						padCell(cell, widths[i]!, columns[i]?.align),
					);
					lines.push("│ " + cells.join(" │ ") + " │");
				}

				// Bottom border
				lines.push("└" + widths.map((w) => "─".repeat(w + 2)).join("┴") + "┘");
			} else {
				// Simple format without borders
				const header = columns.map((col, i) =>
					padCell(c("bold", col.header), widths[i]!, col.align),
				);
				lines.push(header.join("  "));
				lines.push(widths.map((w) => "─".repeat(w)).join("  "));

				for (const row of rows) {
					const cells = row.map((cell, i) =>
						padCell(cell, widths[i]!, columns[i]?.align),
					);
					lines.push(cells.join("  "));
				}
			}

			return lines.join("\n");
		},
	};
}

// =============================================================================
// Status Indicators
// =============================================================================

export function statusIcon(passed: boolean): string {
	return passed ? c("green", "✓") : c("red", "✗");
}

export function accuracyColor(accuracy: number): string {
	const percent = `${(accuracy * 100).toFixed(1)}%`;
	if (accuracy >= 0.8) return c("green", percent);
	if (accuracy >= 0.5) return c("yellow", percent);
	return c("red", percent);
}

export function deltaIndicator(delta: number): string {
	const sign = delta >= 0 ? "+" : "";
	const value = `${sign}${(delta * 100).toFixed(1)}%`;

	if (delta > 0.05) return c("green", `↑ ${value}`);
	if (delta < -0.05) return c("red", `↓ ${value}`);
	return c("gray", `→ ${value}`);
}

export function progressBar(ratio: number, width: number = 10): string {
	const filled = Math.floor(width * ratio);
	const empty = width - filled;
	return c("green", "█".repeat(filled)) + c("gray", "░".repeat(empty));
}

// =============================================================================
// Box Drawing
// =============================================================================

export function box(title: string, content: string[], width: number = 70): string {
	const lines: string[] = [];

	// Top
	lines.push("╔" + "═".repeat(width - 2) + "╗");

	// Title
	const titlePadding = Math.floor((width - 2 - title.length) / 2);
	lines.push("║" + " ".repeat(titlePadding) + c("bold", title) + " ".repeat(width - 2 - titlePadding - title.length) + "║");

	// Separator
	lines.push("╠" + "═".repeat(width - 2) + "╣");

	// Content
	for (const line of content) {
		const stripped = stripAnsi(line);
		const padding = width - 4 - stripped.length;
		lines.push("║ " + line + " ".repeat(Math.max(0, padding)) + " ║");
	}

	// Bottom
	lines.push("╚" + "═".repeat(width - 2) + "╝");

	return lines.join("\n");
}

// =============================================================================
// Helpers
// =============================================================================

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
	return `${(ms / 3600000).toFixed(1)}h`;
}

// =============================================================================
// Logging Helpers
// =============================================================================

export const log = {
	info: (msg: string) => console.log(c("blue", "ℹ"), msg),
	success: (msg: string) => console.log(c("green", "✓"), msg),
	warn: (msg: string) => console.log(c("yellow", "⚠"), msg),
	error: (msg: string) => console.log(c("red", "✗"), msg),
	dim: (msg: string) => console.log(c("dim", msg)),
};

// =============================================================================
// Results Display
// =============================================================================

export function printResultsTable(results: Array<{
	benchmark: string;
	provider: string;
	accuracy: number;
	avgScore: number;
	p50LatencyMs: number;
}>): void {
	const table = createTable({
		columns: [
			{ header: "Benchmark", width: 20 },
			{ header: "Provider", width: 20 },
			{ header: "Accuracy", width: 10, align: "right" },
			{ header: "Avg Score", width: 10, align: "right" },
			{ header: "P50 Latency", width: 12, align: "right" },
			{ header: "Status", width: 12 },
		],
	});

	for (const r of results) {
		table.addRow([
			r.benchmark,
			r.provider,
			accuracyColor(r.accuracy),
			r.avgScore.toFixed(3),
			`${r.p50LatencyMs.toFixed(0)}ms`,
			progressBar(r.accuracy),
		]);
	}

	console.log(table.render());
}

// =============================================================================
// Statistical Analysis Display
// =============================================================================

import type { ConfidenceInterval, SampleQuality } from "./types";

/**
 * Format a metric with its confidence interval
 */
export function formatMetricWithCI(
	value: number,
	ci: ConfidenceInterval | undefined,
	unit: "percent" | "decimal" | "ms" = "decimal",
	decimals: number = 3
): string {
	if (!ci) {
		if (unit === "percent") return `${(value * 100).toFixed(1)}%`;
		if (unit === "ms") return `${value.toFixed(0)}ms`;
		return value.toFixed(decimals);
	}

	const formatValue = (v: number) => {
		if (unit === "percent") return `${(v * 100).toFixed(1)}%`;
		if (unit === "ms") return `${v.toFixed(0)}ms`;
		return v.toFixed(decimals);
	};

	const valueStr = formatValue(value);
	const marginStr = formatValue(ci.margin);
	const lowerStr = formatValue(ci.lower);
	const upperStr = formatValue(ci.upper);

	return `${valueStr} ± ${marginStr} (95% CI: ${lowerStr} - ${upperStr})`;
}

/**
 * Format sample quality assessment
 */
export function formatSampleQuality(quality: SampleQuality, n: number): string {
	const qualityEmoji = {
		excellent: "✨",
		good: "✓",
		fair: "⚠️",
		poor: "❌",
	}[quality.qualityScore];
	
	const qualityName = quality.qualityScore.toUpperCase();
	let result = `${qualityEmoji} ${qualityName} (n=${n})`;
	
	if (quality.recommendedSampleSize) {
		const needed = quality.recommendedSampleSize - n;
		result += `\n   💡 Recommend ${needed} more samples for better confidence`;
	}
	
	return result;
}

/**
 * Get quality color for styling
 */
export function qualityColor(qualityScore: "excellent" | "good" | "fair" | "poor"): string {
	switch (qualityScore) {
		case "excellent":
			return "green";
		case "good":
			return "cyan";
		case "fair":
			return "yellow";
		case "poor":
			return "red";
	}
}

