#!/bin/bash
# Comprehensive benchmark with advanced statistics
# Runs multiple providers against multiple benchmarks

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT_FILE="results/comprehensive-${TIMESTAMP}.json"

echo "🚀 Running Comprehensive Benchmark"
echo "=================================="
echo "Output: $OUTPUT_FILE"
echo ""

bun run memorybench run \
  -b quicktest LoCoMo RAG-template-benchmark \
  -p mock supermemory memzero \
  --verbose \
  --restart \
  -o "$OUTPUT_FILE"

echo ""
echo "✅ Benchmark complete!"
echo "📊 View results: bun run memorybench view $OUTPUT_FILE"
echo "📈 Results saved to: $OUTPUT_FILE"

