# NoLiMa Benchmark

NoLiMa (No Literal Match) evaluates memory systems' ability to retrieve relevant information from long contexts without relying on literal matches.

## Overview

The NoLiMa benchmark tests retrieval from long contexts (haystacks) where:
- Questions and answers have **minimal lexical overlap**
- Systems must infer **latent associations** to locate information
- Contexts can exceed **60K tokens**
- Needles are placed at **26 fixed positions** throughout haystacks

This benchmark is particularly useful for evaluating systems that need to go beyond simple keyword matching.

## Dataset

- **Source**: [Hugging Face - amodaresi/NoLiMa](https://huggingface.co/datasets/amodaresi/NoLiMa)
- **Paper**: [NoLiMa: No Literal Match for Long-Context Retrieval](https://arxiv.org/abs/2502.05167)
- **Size**: 58 needle-question pairs
- **Complexity**: One-hop and two-hop reasoning paths

## Setup

### Download the Dataset

The benchmark expects a `nolima.json` file in this directory. To download it:

#### Option 1: Using Python (Recommended)

```bash
pip install datasets
python -c "from datasets import load_dataset; ds = load_dataset('amodaresi/NoLiMa'); ds['test'].to_json('nolima.json')"
mv nolima.json benchmarks/NoLiMa/
```

#### Option 2: Using Hugging Face CLI

```bash
pip install huggingface_hub
python << EOF
from huggingface_hub import hf_hub_download
import json
from datasets import load_dataset

ds = load_dataset('amodaresi/NoLiMa')
data = ds['test']
data.to_json('nolima.json')
EOF
mv nolima.json benchmarks/NoLiMa/
```

#### Option 3: Manual Download

1. Visit https://huggingface.co/datasets/amodaresi/NoLiMa
2. Download the test split
3. Convert to JSON format matching the expected structure
4. Place as `benchmarks/NoLiMa/nolima.json`

### Expected Data Format

The `nolima.json` file should be an array of objects with this structure:

```json
[
  {
    "id": "unique_id",
    "question": "Question text with minimal lexical overlap",
    "answer": "Expected answer",
    "haystack": "Long context containing the answer...",
    "needlePosition": 12345,
    "contextLength": 60000,
    "complexity": "one-hop"
  }
]
```

Or it can be wrapped in an object:

```json
{
  "items": [...],
  "version": "1.0"
}
```

## Usage

The benchmark is automatically discovered by MemoryBench. To use it:

```bash
# Run with all providers
bun run memorybench run --benchmark nolima

# Run with specific provider
bun run memorybench run --benchmark nolima --provider mock

# Run with configuration (limit test cases, filter by complexity)
```

### Configuration Options

You can configure the benchmark when creating it programmatically:

```typescript
import { createNoLiMaBenchmark } from "./benchmarks/NoLiMa";

const benchmark = createNoLiMaBenchmark({
  maxTestCases: 10,        // Limit to 10 test cases
  complexity: "one-hop",   // Only one-hop questions
  minContextLength: 1000,  // Minimum context length
  maxContextLength: 32000, // Maximum context length
});
```

## Evaluation

The benchmark uses a custom evaluation function that:
1. First checks for exact matches (substring search)
2. Falls back to semantic similarity (word overlap)
3. Provides partial credit for retrieving relevant content

This evaluation is designed to handle the non-literal nature of NoLiMa questions while still being practical for automated testing.

## Notes

- The benchmark loads the entire dataset into memory
- Long contexts (60K+ tokens) may require providers with large context windows
- Evaluation focuses on answer retrieval, not generation quality
- The benchmark is designed to test retrieval systems, not LLM reasoning

## References

- [NoLiMa Paper](https://arxiv.org/abs/2502.05167)
- [Hugging Face Dataset](https://huggingface.co/datasets/amodaresi/NoLiMa)
- [Official Repository](https://github.com/adobe-research/NoLiMa)

