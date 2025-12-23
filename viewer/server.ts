/**
 * MemoryBench Viewer Server
 *
 * Web-based dashboard for viewing benchmark results.
 * Inspired by https://evals.honcho.dev/
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "url";
import indexHtml from "./index.html";
import { readResults, listResultFiles, getLatestResultFile } from "../results/writer";
import { unwrapVersioned } from "../results/schema";
import type { RunResult, ComparisonResult } from "../results/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ViewerOptions {
	file?: string;
	port: number;
}

interface ResultFile {
	path: string;
	name: string;
	runId: string;
	completedAt: string;
	accuracy: number;
	testCases: number;
}

/**
 * Start the viewer server
 */
export async function startViewer(options: ViewerOptions): Promise<void> {
	const { port = 3000, file } = options;

	console.log(`\n🚀 Starting MemoryBench Viewer...`);
	console.log(`   Port: ${port}`);
	if (file) {
		console.log(`   File: ${file}`);
	}

	const server = Bun.serve({
		port,
		routes: {
			// Serve the main HTML page - Bun will automatically bundle CSS and TSX
			"/": indexHtml,
			
			// Explicit static file routes (fallback if auto-bundling doesn't work)
			"/styles.css": Bun.file(join(__dirname, "styles.css")),
			"/frontend.tsx": Bun.file(join(__dirname, "frontend.tsx")),

			"/api/results": {
				async GET() {
					try {
						const files = await listResultFiles();
						console.log(`[API] Found ${files.length} result files`);
						const results: ResultFile[] = [];

						for (const filePath of files.slice(0, 50)) {
							try {
								const result = await readResults(filePath);
								results.push({
									path: filePath,
									name: filePath.split("/").pop() ?? filePath,
									runId: result.metadata.runId,
									completedAt: result.metadata.completedAt,
									accuracy: result.summary.overallAccuracy,
									testCases: result.summary.totalTestCases,
								});
							} catch (err) {
								console.error(`[API] Error reading file ${filePath}:`, err);
								// Skip invalid files
							}
						}

						console.log(`[API] Returning ${results.length} valid results`);
						return Response.json(results);
					} catch (error) {
						console.error("[API] Error in /api/results:", error);
						return Response.json({ error: String(error) }, { status: 500 });
					}
				},
			},

			// API: Get specific result file
			"/api/results/:runId": {
				async GET(req) {
					try {
						const runId = req.params.runId;
						const files = await listResultFiles();

						// Find file matching runId
						const matchingFile = files.find((f) => f.includes(runId));
						if (!matchingFile) {
							return Response.json({ error: "Result not found" }, { status: 404 });
						}

						const result = await readResults(matchingFile);
						return Response.json(result);
					} catch (error) {
						return Response.json({ error: String(error) }, { status: 500 });
					}
				},
			},

			// API: Get latest result
			"/api/results/latest": {
				async GET() {
					try {
						const latestFile = await getLatestResultFile();
						if (!latestFile) {
							return Response.json({ error: "No results found" }, { status: 404 });
						}

						const result = await readResults(latestFile);
						return Response.json(result);
					} catch (error) {
						return Response.json({ error: String(error) }, { status: 500 });
					}
				},
			},

			// API: Compare two runs
			"/api/compare": {
				async GET(req) {
					try {
						const url = new URL(req.url);
						const baselineId = url.searchParams.get("baseline");
						const currentId = url.searchParams.get("current");

						if (!baselineId || !currentId) {
							return Response.json(
								{ error: "baseline and current query params required" },
								{ status: 400 },
							);
						}

						const files = await listResultFiles();
						const baselineFile = files.find((f) => f.includes(baselineId));
						const currentFile = files.find((f) => f.includes(currentId));

						if (!baselineFile || !currentFile) {
							return Response.json({ error: "One or both results not found" }, { status: 404 });
						}

						const { compareRuns } = await import("../results/comparator");
						const baseline = await readResults(baselineFile);
						const current = await readResults(currentFile);
						const comparison = compareRuns(baseline, current);

						return Response.json(comparison);
					} catch (error) {
						return Response.json({ error: String(error) }, { status: 500 });
					}
				},
			},
		},

		// Disable HMR to avoid URL construction issues
		// Bun will still bundle CSS and TSX from HTML imports, just without hot reloading
		// Users can manually refresh the browser to see changes
		development: false,
	});

	console.log(`\n✅ Viewer running at http://localhost:${port}`);
	console.log(`   Press Ctrl+C to stop\n`);
}

export default startViewer;

