# MemoryBench

A unified benchmarking platform for memory providers. Evaluate and compare different memory systems (APIs, vector databases, local solutions) using standardized benchmarks.

## Features

- **Auto-Discovery**: Drop a provider or benchmark folder and it's automatically discovered
- **Unified CLI**: Single command to run any benchmark against any provider
- **Checkpointing**: Resume interrupted runs automatically
- **Visualization**: Interactive dashboard to view and compare results
- **CI Integration**: Regression detection for continuous integration
- **Extensible**: Easy to add new providers and benchmarks

## Quick Start

### Installation

MemoryBench requires [Bun](https://bun.sh) (v1.0+). Install dependencies:

```bash
bun install
```

### Environment Setup

Copy `env.example` to `.env` and configure your API keys:

```bash
cp env.example .env
# Edit .env with your API keys
```

See [Environment Setup](#environment-setup) for details on required variables.

### Your First Benchmark Run

Run a quick test with the mock provider (no API keys needed):

```bash
bun run memorybench run -b quicktest -p mock --verbose
```

This will:
1. Run the `quicktest` benchmark (10 test cases, ~30 seconds)
2. Use the `mock` provider (in-memory, no external dependencies)
3. Show detailed progress output
4. Save results to `results/run-<timestamp>.json`

### View Results

Start the interactive dashboard:

```bash
bun run memorybench view
```

Or view a specific results file:

```bash
bun run memorybench view results/run-2025-01-15.json
```

The dashboard will open at `http://localhost:3000` showing:
- Results matrix (benchmark × provider)
- Accuracy metrics
- Latency statistics
- Individual test case results

### List Available Providers & Benchmarks

See what's auto-discovered:

```bash
bun run memorybench list
```

Output shows:
- ✅ Available providers (with required environment variables)
- ❌ Unavailable providers (missing env vars)
- 📊 Benchmarks (with test case counts and estimated time)

## Architecture

MemoryBench consists of four main components:

### 1. Providers (`providers/`)

Providers implement the memory system interface:
- `ingest(content, meta)`: Store content in memory
- `search(query, limit)`: Retrieve relevant content
- `reset()`: Clear stored content (optional)

**Example providers:**
- `mock`: In-memory TF-IDF (for testing)
- `supermemory`: Supermemory API integration
- `memzero`: MemZero API integration
- `aqrag`: AQRAG with PostgreSQL + pgvector
- `contextualretrieval`: Contextual Retrieval with PostgreSQL + pgvector

### 2. Benchmarks (`benchmarks/`)

Benchmarks define test cases and evaluation logic:
- `load()`: Returns test cases (contexts + queries + expected answers)
- `evaluate(testCase, results)`: Checks if results match expected answers

**Example benchmarks:**
- `quicktest`: Fast 10-question benchmark (~30s)
- `LoCoMo`: Long-form conversation memory benchmark
- `rag-template-benchmark`: RAG question-answer pairs

### 3. Runner (`runner/`)

The runner orchestrates execution:
- Auto-discovers providers and benchmarks
- Executes benchmark × provider matrix
- Handles checkpointing and resume
- Collects metrics (accuracy, latency, scores)

### 4. Results (`results/`)

Results are stored in JSON format with:
- Per-test-case results (query, results, evaluation, latency)
- Aggregate metrics (accuracy, avg score, latency percentiles)
- Metadata (run ID, timestamps, version)

## Usage

### Basic Commands

```bash
# Run all available benchmarks with all available providers
bun run memorybench run

# Run specific benchmarks with specific providers
bun run memorybench run -b quicktest LoCoMo -p mock supermemory

# Verbose output (shows detailed progress)
bun run memorybench run --verbose

# Restart from scratch (ignore checkpoint)
bun run memorybench run --restart

# Custom output file
bun run memorybench run -o my-results.json
```

### Viewing Results

```bash
# View latest results
bun run memorybench view

# View specific file
bun run memorybench view results/run-2025-01-15.json

# Custom port
bun run memorybench view --port 8080
```

### CI Integration

Compare current run against baseline:

```bash
bun run memorybench ci --baseline results/baseline.json
```

Exits with code 1 if regression detected (default threshold: 5% accuracy drop).

### Checkpointing & Resume

MemoryBench automatically checkpoints progress. If a run is interrupted:

```bash
# Resume automatically (default behavior)
bun run memorybench run -b quicktest -p mock

# Start fresh (ignore checkpoint)
bun run memorybench run -b quicktest -p mock --restart
```

Checkpoints are stored in `results/.checkpoints/` and include:
- Completed benchmark × provider combinations
- Individual test case progress
- Resume point information

## Environment Setup

Required environment variables depend on which providers you use:

### Provider API Keys

```bash
# Supermemory
SUPERMEMORY_API_KEY=your-key

# MemZero
MEMZERO_API_KEY=your-key

# Mem0
MEM0_API_KEY=your-key
```

### Database Providers (AQRAG, ContextualRetrieval)

```bash
# PostgreSQL connection string (requires pgvector extension)
DATABASE_URL=postgres://user:password@localhost:5432/memorybench

# Google AI (for embeddings/chunking)
GOOGLE_GENERATIVE_AI_API_KEY=your-key
```

### LLM APIs (for evaluation)

```bash
# OpenAI (for LLM-based evaluation)
OPENAI_API_KEY=your-key

# Google Vertex AI (for evaluation)
GOOGLE_VERTEX_PROJECT_ID=your-project-id
GOOGLE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=your-private-key
```

See `env.example` for the complete list.

## Common Workflows

### Development Workflow

1. **Test with mock provider** (fast, no API keys):
   ```bash
   bun run memorybench run -b quicktest -p mock --verbose
   ```

2. **Test your provider**:
   ```bash
   bun run memorybench run -b quicktest -p your-provider --verbose
   ```

3. **Full benchmark suite**:
   ```bash
   bun run memorybench run --verbose
   ```

### Comparison Workflow

1. **Run baseline**:
   ```bash
   bun run memorybench run -o results/baseline.json
   ```

2. **Make changes, run again**:
   ```bash
   bun run memorybench run -o results/new-run.json
   ```

3. **Compare**:
   ```bash
   bun run memorybench view results/new-run.json
   # Or use CI mode:
   bun run memorybench ci --baseline results/baseline.json
   ```

### CI/CD Workflow

```yaml
# .github/workflows/benchmark.yml
- name: Run benchmarks
  run: bun run memorybench run -o results/ci-run.json

- name: Check for regressions
  run: bun run memorybench ci --baseline results/baseline.json
```

## Troubleshooting

### "No providers available"

**Problem**: `memorybench list` shows all providers as ❌

**Solutions**:
- Check that required environment variables are set
- Verify API keys are valid
- For database providers, ensure PostgreSQL is running and `DATABASE_URL` is correct
- Run `memorybench list` to see which env vars are needed

### "No benchmarks found"

**Problem**: No benchmarks discovered

**Solutions**:
- Ensure benchmark folders exist in `benchmarks/`
- Check that each benchmark exports `meta` and `create*Benchmark()` function
- See `docs/CONTRIBUTING.md` for benchmark structure

### Checkpoint Issues

**Problem**: Checkpoint not resuming correctly

**Solutions**:
- Delete `results/.checkpoints/` to clear all checkpoints
- Use `--restart` flag to ignore checkpoint
- Check checkpoint file permissions

### Provider Errors

**Problem**: Provider fails during execution

**Solutions**:
- Run with `--verbose` to see detailed error messages
- Check provider logs (some providers log to console)
- Verify provider configuration and API keys
- Test provider independently before running benchmarks

### Database Connection Errors

**Problem**: AQRAG/ContextualRetrieval providers fail to connect

**Solutions**:
- Verify `DATABASE_URL` format: `postgres://user:password@host:port/database`
- Ensure PostgreSQL is running
- Check that `pgvector` extension is installed: `CREATE EXTENSION vector;`
- Verify database user has necessary permissions

## Contributing

Want to add a provider or benchmark? See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for detailed instructions.

**Quick summary:**
- **Add Provider**: Create `providers/YOUR_NAME/index.ts` with `meta` export and `createYourNameProvider()` function
- **Add Benchmark**: Create `benchmarks/YOUR_NAME/index.ts` with `meta` export and `createYourNameBenchmark()` function

Both are auto-discovered - no manual registration needed!

## Performance Tuning

### Optimizing Benchmark Runs

- **Parallel Execution**: The runner processes benchmarks sequentially. For faster runs, consider running multiple instances with different benchmark/provider combinations.
- **Checkpointing**: Enable checkpointing (default) to resume interrupted runs. Disable with `--restart` for fresh runs.
- **Provider Reset**: Providers with `reset()` support can clear state between runs, improving isolation.

### Reducing Latency

- Use local providers (mock, file-based) for faster iteration
- Disable verbose output (`--verbose`) for faster execution
- Use smaller benchmarks (quicktest) for development

## License

[Add license information here]

## Links

- [Contributing Guide](docs/CONTRIBUTING.md)
- [Environment Variables](env.example)
- [Gap Analysis](GAPS_ANALYSIS.md)
