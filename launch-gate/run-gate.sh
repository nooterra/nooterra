#!/usr/bin/env bash
set -euo pipefail

# Gate runner: executes all automated gate tests and reports pass/fail per item.
# Usage: bash launch-gate/run-gate.sh [--p0-only]

MANIFEST="launch-gate/manifest.json"
P0_ONLY="${1:-}"

echo "=== Launch Gate Runner ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

PASS=0
FAIL=0
SKIP=0
TOTAL=0

run_tier() {
  local tier="$1"
  local items
  items=$(node -e "
    const m = require('./$MANIFEST');
    const items = m['$tier'] || [];
    items.forEach(i => console.log(JSON.stringify(i)));
  ")

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    TOTAL=$((TOTAL + 1))

    local id=$(echo "$line" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).id" 2>/dev/null <<< "$line")
    local item=$(echo "$line" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).item" 2>/dev/null <<< "$line")
    local evidence=$(echo "$line" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evidence" 2>/dev/null <<< "$line")
    local test_file=$(echo "$line" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).test" 2>/dev/null <<< "$line")

    if [ "$evidence" != "automated" ] || [ "$test_file" = "null" ] || [ ! -f "$test_file" ]; then
      printf "  [SKIP] #%-2s %s (%s)\n" "$id" "$item" "$evidence"
      SKIP=$((SKIP + 1))
      continue
    fi

    if node --test --import tsx "$test_file" > /dev/null 2>&1; then
      printf "  [PASS] #%-2s %s\n" "$id" "$item"
      PASS=$((PASS + 1))
    else
      printf "  [FAIL] #%-2s %s\n" "$id" "$item"
      FAIL=$((FAIL + 1))
    fi
  done <<< "$items"
}

echo "--- P0: Ship Blockers ---"
run_tier "p0"

if [ "$P0_ONLY" != "--p0-only" ]; then
  echo ""
  echo "--- P1: Launch Confidence ---"
  run_tier "p1"
fi

echo ""
echo "=== Summary ==="
echo "Total: $TOTAL | Pass: $PASS | Fail: $FAIL | Skip: $SKIP"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "GATE: FAIL"
  exit 1
else
  echo "GATE: PASS (automated items)"
  echo "Note: $SKIP items require manual/drill verification"
  exit 0
fi
