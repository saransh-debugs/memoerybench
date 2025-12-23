#!/usr/bin/env bun
/**
 * Download NoLiMa Dataset
 *
 * Downloads the NoLiMa dataset from Hugging Face and saves it as nolima.json
 *
 * Usage:
 *   bun run benchmarks/NoLiMa/download-dataset.ts
 *
 * Requirements:
 *   pip install datasets
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFile } from "fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = join(__dirname, "nolima.json");

console.log("Downloading NoLiMa dataset from Hugging Face...");
console.log(`Output: ${OUTPUT_FILE}\n`);

// Python script content
const pythonScriptContent = `from datasets import load_dataset
import json
import sys
import os

try:
    print("Loading dataset from Hugging Face...")
    ds = load_dataset("amodaresi/NoLiMa")
    
    # Get the test split (or train if test doesn't exist)
    if "test" in ds:
        data = ds["test"]
    elif "train" in ds:
        data = ds["train"]
    else:
        # Use the first available split
        data = ds[list(ds.keys())[0]]
    
    print(f"Loaded {len(data)} items")
    
    # Convert to list of dicts
    items = []
    for i, item in enumerate(data):
        # Map Hugging Face format to our format
        haystack = item.get("haystack", item.get("context", ""))
        nolima_item = {
            "id": item.get("id", f"nolima_{i}"),
            "question": item.get("question", ""),
            "answer": item.get("answer", ""),
            "haystack": haystack,
            "needlePosition": item.get("needle_position", item.get("position", 0)),
            "contextLength": item.get("context_length", len(haystack.split()) if haystack else 0),
            "complexity": item.get("complexity", "one-hop"),
        }
        items.append(nolima_item)
    
    # Save as JSON
    output_file = "${OUTPUT_FILE}"
    with open(output_file, "w") as f:
        json.dump(items, f, indent=2)
    
    print(f"Saved {len(items)} items to {output_file}")
    print("✓ Dataset downloaded successfully!")
    
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc()
    sys.exit(1)
`;

// Write Python script to temp file
const tempScript = join(__dirname, ".download_temp.py");
await writeFile(tempScript, pythonScriptContent);

try {
	// Check if Python is available
	const pythonCheck = Bun.spawn(["python", "--version"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	await pythonCheck.exited;
	
	if (pythonCheck.exitCode !== 0) {
		throw new Error("Python not found");
	}
} catch {
	console.error("Error: Python is required but not found in PATH");
	console.error("Please install Python and try again");
	process.exit(1);
}

try {
	// Check if datasets library is installed
	const importCheck = Bun.spawn(["python", "-c", "import datasets"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	await importCheck.exited;
	
	if (importCheck.exitCode !== 0) {
		console.error("Error: 'datasets' library not found");
		console.error("Installing datasets library...");
		const install = Bun.spawn(["pip", "install", "datasets"], {
			stdout: "inherit",
			stderr: "inherit",
		});
		await install.exited;
		
		if (install.exitCode !== 0) {
			console.error("Failed to install datasets library");
			console.error("Please run: pip install datasets");
			process.exit(1);
		}
	}
} catch (error) {
	console.error("Error checking datasets library:", error);
	process.exit(1);
}

// Download the dataset
console.log("Downloading dataset...");
try {
	const proc = Bun.spawn(["python", tempScript], {
		stdout: "inherit",
		stderr: "inherit",
	});
	
	const exitCode = await proc.exited;
	
	// Clean up temp script
	try {
		await Bun.file(tempScript).unlink();
	} catch {
		// Ignore cleanup errors
	}
	
	if (exitCode === 0) {
		console.log("\n✓ Dataset downloaded successfully!");
		console.log(`  File: ${OUTPUT_FILE}`);
		console.log(`  You can now run the NoLiMa benchmark`);
	} else {
		throw new Error(`Python script exited with code ${exitCode}`);
	}
} catch (error) {
	console.error("\n✗ Failed to download dataset");
	console.error("Error:", error);
	console.error("\nAlternative: Download manually from https://huggingface.co/datasets/amodaresi/NoLiMa");
	console.error("See README.md for manual download instructions");
	process.exit(1);
}
