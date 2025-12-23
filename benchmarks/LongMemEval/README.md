# LongMemEval Benchmark

## Configuration

The benchmark requires the following environment variables to be set:

- `SUPERMEMORY_API_KEY`: Your Supermemory API key (required for ingest/search).
- `SUPERMEMORY_API_URL`: (Optional) API base URL, defaults to `https://api.supermemory.ai`.
- `GOOGLE_VERTEX_PROJECT_ID`: Project ID for Google Vertex AI (required for evaluation).
- `GOOGLE_CLIENT_EMAIL`: Google Service Account email (required for evaluation).
- `GOOGLE_PRIVATE_KEY`: Google Service Account private key (required for evaluation).
- `OPENAI_API_KEY`: OpenAI API key (required for evaluation judge).

### Setting Environment Variables

You can set these in one of two ways:

**Option 1: Export in your shell**
```bash
export SUPERMEMORY_API_KEY="your-api-key"
export GOOGLE_VERTEX_PROJECT_ID="your-project-id"
# ... etc
```

**Option 2: Create a `.env` file in the project root**
```bash
# Copy the example file
cp env.example .env

# Edit .env and add your values
# Bun will automatically load .env files
```

**Note**: If you're running scripts from `benchmarks/LongMemEval`, make sure the `.env` file is in the project root (`memorybench/.env`), not in the `LongMemEval` directory.

## Setup

1.  **Download the Dataset**:
    *   Download `longmemeval_s_cleaned.json` from [HuggingFace](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned).
    *   Place it in `memorybench/benchmarks/LongMemEval/datasets/`.

2.  **Generate Questions**:
    *   Run the split script to generate individual question files:
    ```bash
    bun run scripts/setup/split_questions.ts
    ```
    This will populate `datasets/questions/`.

3.  **Install Dependencies**:
    *   Ensure all project dependencies are installed via `bun install`.

## Running LongMemEval

LongMemEval can be run in two ways:

### Option 1: Via Unified Runner (Recommended)

When you invoke LongMemEval through the unified benchmark runner, it automatically runs the orchestrator:

```bash
# From project root
memorybench run --benchmarks longmemeval --providers supermemory
```

This will automatically:
- Run all phases sequentially (setup → ingest → search → evaluate)
- Use batch mode with sensible defaults
- Generate a runId automatically

You can customize the execution using environment variables:
- `LONGMEMEVAL_QUESTION_TYPE`: Filter by question type (e.g., `single-session-user`)
- `LONGMEMEVAL_START_POSITION`: Start position for batch processing (e.g., `1`)
- `LONGMEMEVAL_END_POSITION`: End position for batch processing (e.g., `50`)
- `LONGMEMEVAL_ANSWERING_MODEL`: Model for evaluation (default: `gpt-4o`)

Example:
```bash
LONGMEMEVAL_QUESTION_TYPE=single-session-user \
LONGMEMEVAL_START_POSITION=1 \
LONGMEMEVAL_END_POSITION=50 \
memorybench run --benchmarks longmemeval --providers supermemory
```

### Option 2: Direct Orchestrator Usage

You can also run the orchestrator directly for more control:

From `memorybench/benchmarks/LongMemEval`:
```bash
bun run scripts/orchestrator.ts [options]
```

### Options

- `--phase=<setup|ingest|search|evaluate|all>`: Which phase(s) to run
- `--mode=<single|batch>`: Execution mode (required for non-setup phases)
- `--runId=<runId>`: Run identifier (required for non-setup phases)
- `--questionId=<questionId>`: Question ID (required for single mode)
- `--questionType=<type>`: Filter by question type (for batch mode)
- `--startPosition=<n>`: Start position (for batch mode)
- `--endPosition=<n>`: End position (for batch mode)
- `--answeringModel=<model>`: Model for evaluation (gpt-4o, gpt-5, gemini-3-pro-preview)

### Examples

Run all phases interactively:
```bash
bun run scripts/orchestrator.ts
```

Run all phases with batch mode:
```bash
bun run scripts/orchestrator.ts --phase=all --mode=batch --runId=run1 --questionType=single-session-user --startPosition=1 --endPosition=50
```

Run only setup phase:
```bash
bun run scripts/orchestrator.ts --phase=setup
```

Run single question ingest and search:
```bash
bun run scripts/orchestrator.ts --phase=all --mode=single --runId=run1 --questionId=question_001
```

## Ingestion

To ingest questions, use the scripts in `scripts/ingest/`.

### Single Question

From `memorybench/benchmarks/LongMemEval`:
```bash
bun run scripts/ingest/ingest.ts <questionId> <runId>
```

### Batch Ingestion

From `memorybench/benchmarks/LongMemEval`:
```bash
./scripts/ingest/ingest-batch.sh --runId=<runId> --questionType=<questionType> --startPosition=<startPos> --endPosition=<endPos>
```

## Search

To search questions, use the scripts in `scripts/search/`.

### Single Question

From `memorybench/benchmarks/LongMemEval`:
```bash
bun run scripts/search/search.ts <questionId> <runId>
```

### Batch Search

From `memorybench/benchmarks/LongMemEval`:
```bash
./scripts/search/search-batch.sh --runId=<runId> [--questionType=<questionType>] [--startPosition=<startPos>] [--endPosition=<endPos>]
```

## Evaluation

To evaluate results, use the scripts in `scripts/evaluate/`.

### Single Run Evaluation

From `memorybench/benchmarks/LongMemEval`:

```bash
bun run scripts/evaluate/evaluate.ts <runId> [answeringModel]
```

Examples:
```bash
bun run scripts/evaluate/evaluate.ts run1 gpt-4o
bun run scripts/evaluate/evaluate.ts run1 gpt-5
bun run scripts/evaluate/evaluate.ts run1 gemini-3-pro-preview
```

All evaluations use `gpt-4o` as the fixed "gold standard" judge.

### Batch Evaluation

From `memorybench/benchmarks/LongMemEval`:

```bash
./scripts/evaluate/evaluate-batch.sh --runId=<runId> [--answeringModel=<model>] [--questionType=<questionType>] [--startPosition=<startPos>] [--endPosition=<endPos>]
```

If `answeringModel` is not specified, it defaults to `gpt-4o`.

## Available Question Types

- single-session-user
- single-session-assistant
- single-session-preference
- knowledge-update
- temporal-reasoning
- multi-session

## Directory Structure

- `datasets/longmemeval_s_cleaned.json`: The raw dataset (download from HF).
- `datasets/questions/`: Individual question JSON files (generated).
- `scripts/`: Scripts for ingestion, search, and evaluation.
- `scripts/utils/`: Shared utilities (config, checkpointing).
- `checkpoints/ingest/session/`: Session-level ingestion checkpoints.
- `checkpoints/ingest/batch/`: Batch ingestion checkpoints.
- `checkpoints/search/batch/`: Batch search checkpoints.
- `results/`: Search results.
- `evaluations/`: Evaluation results.
