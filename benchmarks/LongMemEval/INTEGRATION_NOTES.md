# LongMemEval Integration Notes

## Current Execution Model

LongMemEval uses a **session-based ingestion model** that differs significantly from the unified benchmark interface:

### Key Differences

1. **Session-based ingestion**: Each question has multiple "haystack sessions" that must be ingested before querying
2. **Separate workflow**: Uses a 3-phase pipeline:
   - **Ingest**: Load sessions from `datasets/questions/{questionId}.json` and ingest into memory system
   - **Search**: Query the memory system with the question
   - **Evaluate**: Use LLM judge (GPT-4o) to evaluate answer quality
3. **Custom checkpointing**: Has its own checkpoint system for resuming ingestion/search
4. **Batch processing**: Designed for batch operations with `runId` tags
5. **LLM-based evaluation**: Uses GPT-4o as a judge, not simple string matching

### Data Structure

Each question file (`datasets/questions/{questionId}.json`) contains:
- `question`: The query string
- `question_date`: When the question was asked
- `answer`: Expected answer
- `question_type`: Type of question (single-session-user, multi-session, etc.)
- `haystack_dates`: Array of session dates
- `haystack_sessions`: Array of session data to ingest

### Integration Challenges

1. **Ingestion model mismatch**: Unified benchmark expects per-test-case ingestion, but LongMemEval requires session-based ingestion across multiple sessions per question
2. **Evaluation model mismatch**: Unified benchmark uses simple string matching, but LongMemEval uses LLM-based evaluation
3. **Checkpointing**: LongMemEval has its own checkpoint system that doesn't align with unified runner checkpoints
4. **Provider coupling**: Currently tightly coupled to Supermemory API (uses containerTag)

## Integration Options

### Option A: Wrapper Approach (Current)

Create a minimal wrapper that:
- Exports `meta` for auto-discovery
- Provides `createLongMemEvalBenchmark()` function
- Documents that full integration requires using existing scripts
- **Pros**: Quick, preserves existing functionality
- **Cons**: Doesn't integrate with unified runner

### Option B: Full Refactor (Future)

Refactor LongMemEval to fit unified model:
1. Convert session ingestion to per-test-case contexts
2. Adapt evaluation to use unified evaluation interface
3. Integrate with unified checkpoint system
4. Make provider-agnostic
- **Pros**: Full integration with unified runner
- **Cons**: Significant refactoring, may lose some LongMemEval-specific features

### Option C: Hybrid Approach (Recommended for Future)

Create a special benchmark type that supports:
- Multi-phase execution (ingest → search → evaluate)
- Session-based ingestion
- LLM-based evaluation
- Custom checkpointing
- **Pros**: Preserves LongMemEval features while integrating
- **Cons**: Requires extending unified benchmark interface

## Current Status

LongMemEval remains as a separate workflow using its own scripts. See `README.md` for usage instructions.

For now, LongMemEval should be run using its existing scripts rather than through the unified runner.

