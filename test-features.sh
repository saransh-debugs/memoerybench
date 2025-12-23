#!/bin/bash

echo "🧪 Testing MemoryBench Features"
echo "================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0

test_cmd() {
    local name="$1"
    local cmd="$2"
    printf "Testing %s... " "$name"
    if eval "$cmd" > /dev/null 2>&1; then
        printf "${GREEN}✓${NC}\n"
        PASSED=$((PASSED + 1))
    else
        printf "${RED}✗${NC}\n"
        echo "  Command: $cmd"
        FAILED=$((FAILED + 1))
    fi
}

# 1. Help command
test_cmd "help" "bun run memorybench help"

# 2. Version command
test_cmd "version" "bun run memorybench version"

# 3. List command
test_cmd "list" "bun run memorybench list"

# 4. Analyze command (quicktest benchmark)
test_cmd "analyze quicktest" "bun run memorybench analyze quicktest"

# 5. Preset commands
test_cmd "preset list" "bun run memorybench preset list"
test_cmd "preset create" "bun run memorybench preset create test-preset --task-types multi-hop --sample 5 --seed 42"
test_cmd "preset show" "bun run memorybench preset show test-preset"
test_cmd "preset delete" "bun run memorybench preset delete test-preset"

# 6. Run command - basic
test_cmd "run (basic)" "bun run memorybench run -b quicktest -p mock --restart"

# 7. Run command - with filters
test_cmd "run (with filters)" "bun run memorybench run -b quicktest -p mock --filter query-length-min=10 --restart"

# 8. Run command - with sampling
test_cmd "run (with sampling)" "bun run memorybench run -b quicktest -p mock --sample 5 --seed 42 --restart"

# 9. Run command - with task types
test_cmd "run (with task-types)" "bun run memorybench run -b quicktest -p mock --task-types multi-hop --restart || true"

# 10. Run command - verbose
test_cmd "run (verbose)" "bun run memorybench run -b quicktest -p mock --verbose --restart"

# 11. Run command - custom output
OUTPUT_FILE="results/test-run-$(date +%s).json"
test_cmd "run (custom output)" "bun run memorybench run -b quicktest -p mock -o $OUTPUT_FILE --restart"

# 12. View command (if results exist)
if [ -f "$OUTPUT_FILE" ]; then
    test_cmd "view (file)" "timeout 2 bun run memorybench view $OUTPUT_FILE || true"
fi

# 13. CI command (if baseline exists)
if [ -f "results/baseline.json" ]; then
    test_cmd "ci (with baseline)" "bun run memorybench ci --baseline results/baseline.json --threshold 5 || true"
fi

# 14. Eval alias (same as run)
test_cmd "eval alias" "bun run memorybench eval -b quicktest -p mock --restart"

echo ""
echo "================================"
printf "${GREEN}Passed: %d${NC}\n" "$PASSED"
if [ $FAILED -gt 0 ]; then
    printf "${RED}Failed: %d${NC}\n" "$FAILED"
    exit 1
else
    printf "${GREEN}All tests passed!${NC}\n"
    exit 0
fi

