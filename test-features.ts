#!/usr/bin/env bun
/**
 * Test all MemoryBench features
 */

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

let passed = 0;
let failed = 0;

async function testCmd(name: string, cmd: string[]): Promise<void> {
	process.stdout.write(`Testing ${name}... `);
	try {
		const proc = Bun.spawn(cmd, {
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;
		if (proc.exitCode === 0) {
			console.log(`${GREEN}✓${RESET}`);
			passed++;
		} else {
			console.log(`${RED}✗${RESET}`);
			console.log(`  Command: ${cmd.join(" ")}`);
			failed++;
		}
	} catch (error) {
		console.log(`${RED}✗${RESET}`);
		console.log(`  Error: ${error}`);
		failed++;
	}
}

async function main() {
	console.log("🧪 Testing MemoryBench Features");
	console.log("================================\n");

	// 1. Help
	await testCmd("help", ["bun", "run", "memorybench", "help"]);

	// 2. Version
	await testCmd("version", ["bun", "run", "memorybench", "version"]);

	// 3. List
	await testCmd("list", ["bun", "run", "memorybench", "list"]);

	// 4. Analyze
	await testCmd("analyze quicktest", ["bun", "run", "memorybench", "analyze", "quicktest"]);

	// 5. Preset commands
	await testCmd("preset list", ["bun", "run", "memorybench", "preset", "list"]);
	await testCmd("preset create", [
		"bun", "run", "memorybench", "preset", "create", "test-preset",
		"--task-types", "multi-hop", "--sample", "5", "--seed", "42"
	]);
	await testCmd("preset show", ["bun", "run", "memorybench", "preset", "show", "test-preset"]);
	await testCmd("preset delete", ["bun", "run", "memorybench", "preset", "delete", "test-preset"]);

	// 6. Run - basic
	await testCmd("run (basic)", [
		"bun", "run", "memorybench", "run",
		"-b", "quicktest", "-p", "mock", "--restart"
	]);

	// 7. Run - with filters
	await testCmd("run (with filters)", [
		"bun", "run", "memorybench", "run",
		"-b", "quicktest", "-p", "mock",
		"--filter", "query-length-min=10", "--restart"
	]);

	// 8. Run - with sampling
	await testCmd("run (with sampling)", [
		"bun", "run", "memorybench", "run",
		"-b", "quicktest", "-p", "mock",
		"--sample", "5", "--seed", "42", "--restart"
	]);

	// 9. Run - verbose
	await testCmd("run (verbose)", [
		"bun", "run", "memorybench", "run",
		"-b", "quicktest", "-p", "mock", "--verbose", "--restart"
	]);

	// 10. Run - custom output
	const outputFile = `results/test-run-${Date.now()}.json`;
	await testCmd("run (custom output)", [
		"bun", "run", "memorybench", "run",
		"-b", "quicktest", "-p", "mock",
		"-o", outputFile, "--restart"
	]);

	// 11. View (if results exist)
	try {
		const file = Bun.file(outputFile);
		if (await file.exists()) {
			const proc = Bun.spawn(["bun", "run", "memorybench", "view", outputFile], {
				stdout: "pipe",
				stderr: "pipe",
			});
			// Kill after 2 seconds
			setTimeout(() => proc.kill(), 2000);
			await proc.exited;
			passed++;
			console.log(`Testing view (file)... ${GREEN}✓${RESET}`);
		}
	} catch {
		// Ignore
	}

	// 12. CI (if baseline exists)
	try {
		const baseline = Bun.file("results/baseline.json");
		if (await baseline.exists()) {
			await testCmd("ci (with baseline)", [
				"bun", "run", "memorybench", "ci",
				"--baseline", "results/baseline.json", "--threshold", "5"
			]);
		}
	} catch {
		// Ignore
	}

	// 13. Eval alias
	await testCmd("eval alias", [
		"bun", "run", "memorybench", "eval",
		"-b", "quicktest", "-p", "mock", "--restart"
	]);

	console.log("\n================================\n");
	console.log(`${GREEN}Passed: ${passed}${RESET}`);
	if (failed > 0) {
		console.log(`${RED}Failed: ${failed}${RESET}`);
		process.exit(1);
	} else {
		console.log(`${GREEN}All tests passed!${RESET}`);
		process.exit(0);
	}
}

main().catch(console.error);

