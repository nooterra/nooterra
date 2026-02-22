#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

PROBLEM_TESTS=(
  "test/api-e2e-x402-authorize-payment.test.js"
  "test/api-python-sdk-first-paid-task-smoke.test.js"
  "test/api-python-sdk-first-verified-run-smoke.test.js"
  "test/magic-link-onboarding-live-contract.test.js"
  "test/magic-link-service.test.js"
  "test/mcp-http-gateway.test.js"
  "test/mcp-stdio-spike.test.js"
  "test/payment-triggers.test.js"
  "test/sdk-tenant-analytics-examples-smoke.test.js"
  "test/trust-config-wizard-cli.test.js"
)

NOO_REGRESSION_TEST_FILE="test/api-e2e-x402-authorize-payment.test.js"
REQUIRED_NOO_REGRESSION_TESTS=(
  "API e2e: x402 authorize-payment and verify fail closed on missing or revoked passport when required"
  "API e2e: x402 authorize-payment requires valid execution intent when enabled"
  "API e2e: verify enforces strict request binding evidence for quote-bound authorization"
)

for test_name in "${REQUIRED_NOO_REGRESSION_TESTS[@]}"; do
  if ! grep -F "test(\"${test_name}\"" "$NOO_REGRESSION_TEST_FILE" >/dev/null; then
    echo "missing required NOO regression test: ${test_name}" >&2
    exit 1
  fi
done

SAFE_TESTS=()
for fp in $(ls test/*.test.js | sort); do
  is_problem_test=0
  for problem in "${PROBLEM_TESTS[@]}"; do
    if [[ "$fp" == "$problem" ]]; then
      is_problem_test=1
      break
    fi
  done
  if [[ "$is_problem_test" -eq 0 ]]; then
    SAFE_TESTS+=("$fp")
  fi
done

# Phase 1: bulk suite (fast).
# NOTE: These files sporadically fail when executed *after* a large multi-file
# `node --test` run (Node 18 test runner multi-file mode), while they pass when
# run first in a fresh process. Running them first keeps `npm test` stable.
for fp in "${PROBLEM_TESTS[@]}"; do
  node --test "$fp"
done

# Phase 2: bulk suite (fast).
node --test "${SAFE_TESTS[@]}"

# Post-check: ensure we never accidentally track generated artifacts.
bash scripts/test/check-no-generated-artifacts.sh
