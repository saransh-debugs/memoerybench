# Contributing to MemoryBench

This guide explains how to add new **memory providers** and **benchmarks** to MemoryBench.

## ✨ Auto-Discovery Magic

MemoryBench uses **auto-discovery** - just drop a folder and it works!

```bash
# See what's auto-discovered
bun run bin/memorybench.ts list
```

---

## Quick Reference

| Adding a... | Files to Create | Files to Modify |
|-------------|-----------------|-----------------|
| **Provider** | `providers/YOUR_PROVIDER/index.ts` | Nothing! Auto-discovered ✨ |
| **Benchmark** | `benchmarks/YOUR_BENCHMARK/index.ts` | Nothing! Auto-discovered ✨ |

---

## Adding a New Memory Provider

A provider integrates a memory system (API or local) with MemoryBench.

### Step 1: Create the Provider

Create `providers/YOUR_PROVIDER/index.ts`:

```typescript
import type { Provider, SearchResult, IngestResult } from "../types";

interface MyProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

export function createMyProvider(config?: Partial<MyProviderConfig>): Provider {
  const apiKey = config?.apiKey ?? process.env.MY_PROVIDER_API_KEY;
  
  if (!apiKey) {
    throw new Error("MY_PROVIDER_API_KEY environment variable required");
  }

  // Track IDs for cleanup (optional)
  const documentIds: string[] = [];

  return {
    name: "myprovider",

    /**
     * Store content in memory
     */
    async ingest(content: string, meta?: Record<string, unknown>): Promise<IngestResult> {
      const response = await fetch("https://api.myprovider.com/memories", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content, metadata: meta }),
      });
      
      const data = await response.json();
      documentIds.push(data.id);
      return { id: data.id };
    },

    /**
     * Search for relevant content
     */
    async search(query: string, limit: number = 10): Promise<SearchResult[]> {
      const response = await fetch("https://api.myprovider.com/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, limit }),
      });
      
      const data = await response.json();
      
      return data.results.map((r: any) => ({
        id: r.id,
        content: r.text,       // Map to standard field
        score: r.similarity,   // Map to standard field (0-1)
      }));
    },

    /**
     * Clear state between benchmark runs (optional)
     */
    async reset(): Promise<void> {
      // Delete tracked documents or generate new session ID
      documentIds.length = 0;
    },
  };
}

export default createMyProvider;
```

### Step 2: That's It! 

The provider is **auto-discovered** at runtime. No need to modify any registry files!

### Step 3: Add Environment Variable (Optional)

Add to `env.example`:

```bash
# My Provider
MY_PROVIDER_API_KEY=your-api-key-here
```

### Step 4: Test It

```bash
export MY_PROVIDER_API_KEY=xxx
bun run bin/memorybench.ts run -p myprovider -b quicktest --verbose
```

---

## Adding a New Benchmark

A benchmark defines test cases (context + query + expected answer) and evaluation logic.

### Step 1: Create the Benchmark

Create `benchmarks/YOUR_BENCHMARK/index.ts`:

```typescript
import type { Benchmark, TestCase, EvaluationResult } from "../types";
import type { SearchResult } from "../../providers/types";

/**
 * Test case data - can be hardcoded or loaded from file
 */
const TEST_CASES: TestCase[] = [
  {
    id: "test_001",
    contexts: [
      { content: "User's name is Alice and she lives in Tokyo." },
      { content: "Alice works as a data scientist at Google." },
    ],
    query: "Where does the user live?",
    expected: { answer: "Tokyo" },
    metadata: { category: "location", difficulty: "easy" },
  },
  {
    id: "test_002",
    contexts: [
      { content: "User moved to Paris in March 2024." },
    ],
    query: "When did the user move to Paris?",
    expected: { answer: ["March 2024", "2024"] },  // Multiple valid answers
    metadata: { category: "temporal", difficulty: "easy" },
  },
  // Add more test cases...
];

/**
 * Evaluation function - checks if results contain expected answer
 */
function evaluate(testCase: TestCase, results: SearchResult[]): EvaluationResult {
  const expected = testCase.expected.answer;
  
  // Normalize to array of lowercase strings
  const expectedAnswers = Array.isArray(expected)
    ? expected.map(a => String(a).toLowerCase())
    : [String(expected).toLowerCase()];

  // Check if any result contains any expected answer
  for (const result of results) {
    const content = result.content.toLowerCase();
    for (const answer of expectedAnswers) {
      if (content.includes(answer)) {
        return {
          passed: true,
          score: 1,
          details: { foundAnswer: answer },
        };
      }
    }
  }

  return {
    passed: false,
    score: 0,
    details: { reason: `Expected "${expectedAnswers.join(" or ")}" not found` },
  };
}

/**
 * Create the benchmark
 */
export function createMyBenchmark(): Benchmark {
  return {
    name: "mybenchmark",

    async load(): Promise<TestCase[]> {
      // Option 1: Return hardcoded data
      return TEST_CASES;
      
      // Option 2: Load from JSON file
      // const data = await Bun.file("./benchmarks/mybenchmark/data.json").json();
      // return data.map(item => ({
      //   id: item.id,
      //   contexts: [{ content: item.conversation }],
      //   query: item.question,
      //   expected: { answer: item.answer },
      // }));
    },

    evaluate,
  };
}

export default createMyBenchmark;
```

### Step 2: That's It!

The benchmark is **auto-discovered** at runtime. No need to modify any registry files!

### Step 3: Test It

```bash
bun run bin/memorybench.ts run -b mybenchmark -p mock --verbose
```

---

## Core Interfaces

### Provider Interface

```typescript
interface Provider {
  name: string;
  ingest(content: string, meta?: Record<string, unknown>): Promise<IngestResult>;
  search(query: string, limit?: number): Promise<SearchResult[]>;
  reset?(): Promise<void>;
}

interface IngestResult {
  id: string;
}

interface SearchResult {
  id: string;
  content: string;
  score: number;  // 0-1, higher = more relevant
}
```

### Benchmark Interface

```typescript
interface Benchmark {
  name: string;
  load(): Promise<TestCase[]>;
  evaluate(testCase: TestCase, results: SearchResult[]): EvaluationResult;
}

interface TestCase {
  id: string;
  contexts: Context[];           // Content to ingest before query
  query: string;                 // Search query
  expected: Expected;            // What to look for
  metadata?: Record<string, any>;
}

interface Context {
  content: string;
  meta?: Record<string, unknown>;
}

interface Expected {
  answer: string | number | string[];  // Single or multiple valid answers
  requiredContent?: string[];          // Content that must be retrieved
  minScore?: number;                   // Minimum similarity score
}

interface EvaluationResult {
  passed: boolean;
  score: number;  // 0-1
  details?: {
    foundAnswer?: string;
    reason?: string;
    matchedResults?: SearchResult[];
  };
}
```

---

## Tips

### Loading Data from External Sources

```typescript
async load(): Promise<TestCase[]> {
  // From JSON file
  const data = await Bun.file("./data.json").json();
  
  // From API
  const response = await fetch("https://api.example.com/dataset");
  const data = await response.json();
  
  // From Hugging Face dataset
  // Use @huggingface/hub or download locally
  
  return data.map(transformToTestCase);
}
```

### Using the Default Evaluator

Instead of writing custom evaluation, use `defaultEvaluate`:

```typescript
import { defaultEvaluate } from "../types";

export function createMyBenchmark(): Benchmark {
  return {
    name: "mybenchmark",
    load: async () => TEST_CASES,
    evaluate: defaultEvaluate,  // Uses built-in logic
  };
}
```

### Environment-Based Configuration

```typescript
// Support both config object and env vars
const apiKey = config?.apiKey ?? process.env.MY_PROVIDER_API_KEY;
const baseUrl = config?.baseUrl ?? process.env.MY_PROVIDER_BASE_URL ?? "https://api.default.com";
```

---

## File Structure

```
memorybench/
├── providers/
│   ├── types.ts              # Provider interfaces
│   ├── supermemory/          # Example: API-based provider
│   │   └── index.ts
│   ├── memzero/              # Example: API-based provider  
│   │   └── index.ts
│   └── YOUR_PROVIDER/        # Your new provider
│       └── index.ts
├── benchmarks/
│   ├── types.ts              # Benchmark interfaces
│   ├── quicktest/            # Example: Simple benchmark
│   │   └── index.ts
│   ├── LoCoMo/               # Example: Dataset-based benchmark
│   │   └── benchmark.ts
│   └── YOUR_BENCHMARK/       # Your new benchmark
│       └── index.ts
├── runner/
│   └── registry.ts           # Register providers & benchmarks here
└── bin/
    └── memorybench.ts        # CLI entry point
```

---

## Running Benchmarks

```bash
# List available providers and benchmarks
bun run bin/memorybench.ts list

# Run specific benchmark with specific providers
bun run bin/memorybench.ts run -b mybenchmark -p myprovider supermemory --verbose

# Run with mock provider (for testing)
bun run bin/memorybench.ts run -b mybenchmark -p mock --verbose

# Resume interrupted run
bun run bin/memorybench.ts run -b mybenchmark -p myprovider

# Start fresh (ignore checkpoint)
bun run bin/memorybench.ts run -b mybenchmark -p myprovider --restart
```

