# New Features Guide

This guide covers the new advanced features added to MemoryBench: weighted sampling, query-based filtering, failure analysis, and sampling presets.

## Table of Contents

1. [Weighted Sampling](#weighted-sampling)
2. [Query-Based Filtering](#query-based-filtering)
3. [Failure Analysis](#failure-analysis)
4. [Sampling Presets](#sampling-presets)

---

## Weighted Sampling

Weighted sampling allows you to oversample or undersample specific types of test cases based on their metadata fields (e.g., difficulty, task type).

### Use Cases

- **Focus on challenging tasks**: Sample hard questions more frequently to stress-test your system
- **Balanced evaluation**: Ensure equal representation of different task types
- **Domain-specific testing**: Emphasize specific categories of questions

### Usage

#### Programmatic API

```typescript
import { sampleTestCases } from "./runner/sampling";

// Sample with difficulty weighting (2x hard, 0.5x easy)
const sampled = sampleTestCases(testCases, {
  count: 100,
  seed: 42,
  weighted: {
    field: "difficulty",
    weights: {
      hard: 2.0,
      medium: 1.0,
      easy: 0.5,
    },
  },
});
```

#### CLI Usage

Currently, weighted sampling is available through presets (see [Sampling Presets](#sampling-presets)).

### How It Works

1. Each test case is assigned a weight based on the value of the specified field
2. Test cases are sampled probabilistically according to their weights
3. Higher weights mean higher probability of selection
4. Supports seeded random sampling for reproducibility

### Supported Fields

- **difficulty**: `easy`, `medium`, `hard`
- **taskType**: `multi-hop`, `temporal`, `factual`, etc.
- **metadata.X**: Any custom metadata field (e.g., `metadata.category`)

---

## Query-Based Filtering

Filter test cases based on query characteristics and context properties before running benchmarks.

### Use Cases

- **Test specific scenarios**: Focus on long queries or multi-context scenarios
- **Incremental testing**: Start with simple cases before testing complex ones
- **Targeted debugging**: Filter to problematic query patterns

### Filter Options

| Filter | Description | Example |
|--------|-------------|---------|
| `queryLength.min` | Minimum query length (characters) | `20` |
| `queryLength.max` | Maximum query length (characters) | `200` |
| `queryContains` | Query must contain these strings | `["weather", "temperature"]` |
| `queryPattern` | Query must match regex pattern | `/^(What\|When)/` |
| `contextCount.min` | Minimum number of contexts | `3` |
| `contextCount.max` | Maximum number of contexts | `10` |
| `contextLength.min` | Minimum total context length | `500` |
| `contextLength.max` | Maximum total context length | `5000` |

### Usage

#### CLI Usage

```bash
# Filter by query length
memorybench run -b locomo -p mock \
  --filter query-length-min=20 \
  --filter query-length-max=200

# Filter by context count
memorybench run -b locomo -p mock \
  --filter context-count-min=3 \
  --filter context-count-max=10

# Filter by multiple criteria
memorybench run -b locomo -p mock \
  --filter query-length-min=50 \
  --filter context-count-min=3 \
  --filter context-length-min=1000
```

#### Programmatic API

```typescript
import { filterTestCases } from "./runner/sampling";

const filtered = filterTestCases(testCases, {
  queryLength: { min: 20, max: 200 },
  contextCount: { min: 3 },
  queryContains: ["weather"],
  queryPattern: /^(What|When|Where)/,
});
```

### Combining Filters

Multiple filters are applied using **AND** logic - test cases must satisfy all specified criteria.

```typescript
// This filters to:
// - Queries between 50-200 characters
// - At least 3 contexts
// - Total context length at least 1000 characters
const filtered = filterTestCases(testCases, {
  queryLength: { min: 50, max: 200 },
  contextCount: { min: 3 },
  contextLength: { min: 1000 },
});
```

---

## Failure Analysis

Automatically analyze test failures grouped by task type, showing failure rates and common failure reasons.

### Features

- **Failure rate by task type**: Identify which types of tasks are most challenging
- **Common failure reasons**: See the most frequent error messages
- **Sample failures**: Get specific examples of failed test cases
- **Automatic aggregation**: Combines analysis across multiple benchmark runs

### Output Example

```
Failure Analysis by Task Type:
  multi-hop           85.0% (17 failures)
    Common reasons:
      • Missing required context for reasoning
      • Unable to connect information across sources
  temporal            45.0% (9 failures)
    Common reasons:
      • Incorrect date parsing
      • Missing temporal context
  factual             12.5% (5 failures)
    Common reasons:
      • Exact match required but not found
```

### Accessing Results

Failure analysis is included in:

1. **Console output**: Printed after each benchmark run
2. **JSON results**: Available in the `failureAnalysis` field

```json
{
  "results": [{
    "benchmark": "locomo",
    "provider": "mock",
    "failureAnalysis": [
      {
        "taskType": "multi-hop",
        "failureRate": 0.85,
        "totalFailures": 17,
        "commonFailureReasons": [
          "Missing required context for reasoning",
          "Unable to connect information across sources"
        ],
        "sampleFailures": [...]
      }
    ]
  }],
  "failureAnalysis": [...]  // Aggregated across all runs
}
```

### Programmatic API

```typescript
import { generateFailureAnalysis } from "./runner/failure-analysis";

const analysis = generateFailureAnalysis(testCaseResults, testCases);

for (const taskAnalysis of analysis) {
  console.log(`${taskAnalysis.taskType}: ${taskAnalysis.failureRate * 100}% failure rate`);
  console.log(`Common reasons:`, taskAnalysis.commonFailureReasons);
}
```

---

## Sampling Presets

Save and reuse filtering and sampling configurations for consistent testing.

### Use Cases

- **Reproducible benchmarks**: Ensure the same test cases are used across runs
- **Standard test suites**: Define organization-wide benchmark configurations
- **Quick testing modes**: Switch between comprehensive and fast testing

### Built-in Presets

MemoryBench includes several built-in presets:

| Preset | Description |
|--------|-------------|
| `quick` | Quick test with 10 randomly sampled cases |
| `multihop-focus` | 100 multi-hop reasoning tasks |
| `temporal-focus` | 100 temporal reasoning tasks |
| `hard-only` | Only hard difficulty tasks |
| `long-queries` | Queries with at least 100 characters |
| `weighted-hard` | 100 samples with 2x weighting for hard tasks |

### Managing Presets

#### List Presets

```bash
memorybench preset list
```

Output:
```
SAMPLING PRESETS

  quick                     [built-in]
    Quick test with 10 samples
  multihop-focus            [built-in]
    Focus on multi-hop reasoning tasks
  my-custom-preset          [custom]
    My custom configuration
```

#### Show Preset Details

```bash
memorybench preset show multihop-focus
```

Output:
```
Preset: multihop-focus
Description: Focus on multi-hop reasoning tasks

Configuration:
{
  "name": "multihop-focus",
  "description": "Focus on multi-hop reasoning tasks",
  "taskTypes": ["multi-hop"],
  "sampling": {
    "count": 100,
    "seed": 42
  }
}
```

#### Create Custom Preset

```bash
# Create a preset with task type filter and sampling
memorybench preset create "my-multihop" \
  --task-types multi-hop,temporal \
  --sample 50 \
  --seed 123
```

The preset configuration is stored in `.memorybench/presets.json`.

#### Delete Preset

```bash
memorybench preset delete "my-multihop"
```

### Using Presets

```bash
# Use a preset
memorybench run -b locomo -p mock --preset multihop-focus

# Combine preset with additional options (CLI options take precedence)
memorybench run -b locomo -p mock --preset multihop-focus --verbose
```

### Programmatic API

```typescript
import { savePreset, getPreset, presetToOptions } from "./runner/presets";

// Create a preset
await savePreset({
  name: "my-preset",
  description: "Custom test configuration",
  taskTypes: ["multi-hop"],
  filters: {
    queryLength: { min: 50 },
    contextCount: { min: 3 },
  },
  sampling: {
    count: 100,
    seed: 42,
    weighted: {
      field: "difficulty",
      weights: { hard: 2.0, easy: 0.5 },
    },
  },
});

// Load and use a preset
const preset = await getPreset("my-preset");
const options = presetToOptions(preset);

// Apply to run
await run({
  benchmarks: ["locomo"],
  providers: ["mock"],
  ...options,
});
```

### Preset File Format

Presets are stored in `.memorybench/presets.json`:

```json
{
  "version": "1.0.0",
  "presets": {
    "my-preset": {
      "name": "my-preset",
      "description": "Custom test configuration",
      "taskTypes": ["multi-hop"],
      "filters": {
        "queryLength": { "min": 50 },
        "contextCount": { "min": 3 }
      },
      "sampling": {
        "count": 100,
        "seed": 42,
        "weighted": {
          "field": "difficulty",
          "weights": { "hard": 2.0, "easy": 0.5 }
        }
      },
      "createdAt": "2025-12-22T10:30:00.000Z",
      "modifiedAt": "2025-12-22T10:30:00.000Z"
    }
  }
}
```

---

## Complete Example

Here's a complete workflow using all the new features:

```bash
# 1. Analyze benchmark to understand composition
memorybench analyze locomo

# 2. Create a custom preset for multi-hop tasks with long queries
memorybench preset create "multihop-long" \
  --task-types multi-hop \
  --sample 50 \
  --seed 42

# 3. Run with the preset and additional filters
memorybench run -b locomo -p supermemory \
  --preset multihop-long \
  --filter query-length-min=100 \
  --filter context-count-min=5 \
  --verbose

# 4. Review failure analysis in the output
# The console will show:
# - Overall metrics
# - Task type breakdown
# - Failure analysis with common reasons

# 5. Save results and compare
memorybench run -b locomo -p supermemory \
  --preset multihop-long \
  -o results/multihop-test.json

# 6. Run with weighted sampling focusing on hard tasks
# (Create preset with weighted sampling)
```

---

## TypeScript Type Definitions

### FilterOptions

```typescript
interface FilterOptions {
  taskTypes?: string[];
  category?: string | number;
  difficulty?: string;
  queryLength?: { min?: number; max?: number };
  contextCount?: { min?: number; max?: number };
  contextLength?: { min?: number; max?: number };
  queryContains?: string[];
  queryPattern?: RegExp;
  customFilter?: (testCase: TestCase) => boolean;
}
```

### SamplingOptions

```typescript
interface SamplingOptions {
  count?: number;
  seed?: number;
  weighted?: {
    field: string;
    weights: { [value: string]: number };
  };
}
```

### FailureAnalysis

```typescript
interface FailureAnalysis {
  taskType: string;
  failureRate: number;
  totalFailures: number;
  commonFailureReasons: string[];
  sampleFailures: TestCaseResult[];
}
```

### PresetConfig

```typescript
interface PresetConfig {
  name: string;
  description?: string;
  taskTypes?: string[];
  filters?: {
    queryLength?: { min?: number; max?: number };
    queryContains?: string[];
    queryPattern?: string;
    contextCount?: { min?: number; max?: number };
    contextLength?: { min?: number; max?: number };
    difficulty?: string;
    category?: string | number;
  };
  sampling?: {
    count?: number;
    seed?: number;
    weighted?: {
      field: string;
      weights: { [value: string]: number };
    };
  };
}
```

---

## Migration Guide

If you have existing code using the old sampling API:

### Before (Legacy)

```typescript
// Old API
const sampled = sampleTestCases(testCases, 100, 42);
```

### After (New)

```typescript
// New API (backward compatible)
const sampled = sampleTestCases(testCases, {
  count: 100,
  seed: 42,
});

// Or with weighted sampling
const sampled = sampleTestCases(testCases, {
  count: 100,
  seed: 42,
  weighted: {
    field: "difficulty",
    weights: { hard: 2.0, easy: 0.5 },
  },
});
```

**Note**: The legacy signature is still supported for backward compatibility, but the new object-based API is recommended.

---

## Best Practices

1. **Use seeded sampling** for reproducible results across runs
2. **Start with filtering** to narrow down test cases before sampling
3. **Review failure analysis** to identify systematic issues with your provider
4. **Create presets** for frequently used configurations
5. **Combine features** - filter, then sample with weights for precise control
6. **Version your presets** in git for team collaboration

---

## Troubleshooting

### Weighted sampling not working as expected

- Check that your test cases have the specified metadata field
- Verify weight values are positive numbers
- Use a fixed seed to ensure reproducible results

### No failure analysis shown

- Failure analysis only appears when there are failures
- Check that test cases have valid task type metadata

### Preset not found

- Run `memorybench preset list` to see available presets
- Check `.memorybench/presets.json` for custom presets
- Built-in presets are always available

### Filters removing all test cases

- Check filter criteria aren't too restrictive
- Use `memorybench analyze <benchmark>` to understand test case characteristics
- Test filters individually before combining

---

## API Reference

For complete API documentation, see:
- [API.md](./API.md) - Complete API reference
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contributing guidelines

