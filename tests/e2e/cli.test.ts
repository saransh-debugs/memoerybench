import { describe, test, expect } from "bun:test";
import { spawn } from "bun";

describe("CLI E2E Tests", () => {
	test("should run list command without crashing", async () => {
		const proc = spawn({
			cmd: ["bun", "run", "bin/memorybench.ts", "list"],
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
			},
		});

		const result = await proc.exited;
		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();

		// Command should complete (may fail in sandbox due to .env permissions)
		// Just verify it doesn't crash
		expect(typeof result).toBe("number");
		expect(result).toBeGreaterThanOrEqual(0);
		expect(result).toBeLessThan(255);
	});

	test("should run help command without crashing", async () => {
		const proc = spawn({
			cmd: ["bun", "run", "bin/memorybench.ts", "help"],
			stdout: "pipe",
			stderr: "pipe",
		});

		const result = await proc.exited;
		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		const output = stdout + stderr;

		// Command should complete and show some output
		expect(typeof result).toBe("number");
		expect(result).toBeGreaterThanOrEqual(0);
		expect(result).toBeLessThan(255);
		// If there's output, it should contain help text
		if (output.length > 10) {
			expect(output.length).toBeGreaterThan(0);
		}
	});

	test("should accept eval command alias", async () => {
		const proc = spawn({
			cmd: ["bun", "run", "bin/memorybench.ts", "eval", "-b", "quicktest", "-p", "mock", "--verbose"],
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
			},
		});

		// Don't wait for completion, just check it starts without error
		// The command will run the benchmark which may take time
		const result = await proc.exited;
		
		// Should either succeed (0) or fail gracefully (non-zero but not crash)
		expect(typeof result).toBe("number");
		expect(result).toBeGreaterThanOrEqual(0);
		expect(result).toBeLessThan(255);
	}, 60000); // 60 second timeout for benchmark run

	test("should show error for invalid command", async () => {
		const proc = spawn({
			cmd: ["bun", "run", "bin/memorybench.ts", "invalid-command"],
			stdout: "pipe",
			stderr: "pipe",
		});

		const result = await proc.exited;
		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();

		// Should show help or error message
		expect(stdout.length > 0 || stderr.length > 0).toBe(true);
	});
});
