# MemoryBench API Documentation

## Runner API

### `run(options: RunOptions, onProgress?: ProgressCallback): Promise<RunResult>`

Execute benchmarks against providers.

**Parameters:**
- `options`: Run configuration
  - `benchmarks: string[]` - Benchmark names (empty = auto-detect)
  - `providers: string[]` - Provider names (empty = auto-detect)
  - `output?: string` - Output file path
  - `verbose: boolean` - Show detailed output
  - `restart?: boolean` - Ignore checkpoint and start fresh
  - `checkpoint?: boolean` - Enable checkpointing (default: true)
- `onProgress?: ProgressCallback` - Optional progress callback

**Returns:** `Promise<RunResult>` - Complete run results

**Example:**
```typescript
import { run } from "./runner";

const result = await run({
  benchmarks: ["quicktest"],
  providers: ["mock"],
  verbose: true,
});

console.log(`Accuracy: ${result.summary.overallAccuracy}`);
```

### `listProviders(): Promise<ProviderMeta[]>`

List all discovered providers.

**Returns:** `Promise<ProviderMeta[]>` - Array of provider metadata

### `listBenchmarks(): Promise<BenchmarkMeta[]>`

List all discovered benchmarks.

**Returns:** `Promise<BenchmarkMeta[]>` - Array of benchmark metadata

### `getProvider(name: string): Promise<Provider | null>`

Get a provider instance by name.

**Parameters:**
- `name: string` - Provider name

**Returns:** `Promise<Provider | null>` - Provider instance or null if not found

### `getBenchmark(name: string): Promise<Benchmark | null>`

Get a benchmark instance by name.

**Parameters:**
- `name: string` - Benchmark name

**Returns:** `Promise<Benchmark | null>` - Benchmark instance or null if not found

## Provider Interface

### `Provider`

```typescript
interface Provider {
  name: string;
  ingest(content: string, meta?: Record<string, unknown>): Promise<IngestResult>;
  search(query: string, limit?: number): Promise<SearchResult[]>;
  reset?(): Promise<void>;
}
```

**Methods:**
- `ingest()` - Store content in memory
- `search()` - Retrieve relevant content
- `reset()` - Clear stored content (optional)

## Benchmark Interface

### `Benchmark`

```typescript
interface Benchmark {
  name: string;
  load(): Promise<TestCase[]>;
  evaluate(testCase: TestCase, results: SearchResult[]): EvaluationResult;
}
```

**Methods:**
- `load()` - Load test cases
- `evaluate()` - Evaluate search results against expected answers

## Results API

### `readResults(filePath: string, options?: ReadOptions): Promise<RunResult>`

Read results from a file.

**Parameters:**
- `filePath: string` - Path to results file
- `options?: ReadOptions` - Read options
  - `validate?: boolean` - Validate against schema (default: true)

**Returns:** `Promise<RunResult>` - Parsed results

### `writeResults(result: RunResult, outputPath: string, options?: WriteOptions): Promise<void>`

Write results to a file.

**Parameters:**
- `result: RunResult` - Results to write
- `outputPath: string` - Output file path
- `options?: WriteOptions` - Write options
  - `format?: OutputFormat` - Output format (json, json-pretty, ndjson)
  - `versioned?: boolean` - Include schema version wrapper
  - `createDir?: boolean` - Create directory if missing

## Checkpoint API

### `createCheckpointManager(runId: string, checkpointDir?: string): CheckpointManager`

Create a checkpoint manager for a run.

**Parameters:**
- `runId: string` - Unique run identifier
- `checkpointDir?: string` - Checkpoint directory (default: `.memorybench`)

**Returns:** `CheckpointManager` - Checkpoint manager instance

### `getResumeInfo(checkpoint: CheckpointManager, forceRestart?: boolean): Promise<ResumeInfo>`

Get resume information from checkpoint.

**Parameters:**
- `checkpoint: CheckpointManager` - Checkpoint manager
- `forceRestart?: boolean` - Ignore checkpoint and start fresh

**Returns:** `Promise<ResumeInfo>` - Resume information

