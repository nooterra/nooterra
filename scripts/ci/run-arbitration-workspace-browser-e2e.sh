#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_FILE="test/api-e2e-ops-arbitration-workspace-browser.test.js"

export NOOTERRA_RUN_BROWSER_E2E="${NOOTERRA_RUN_BROWSER_E2E:-1}"

# Optional host library shim for environments where Playwright browser deps are staged manually.
if [[ -z "${NOOTERRA_PW_DEPS_LIB_DIR:-}" && -d "/tmp/pw-deps/root/usr/lib/x86_64-linux-gnu" ]]; then
  export NOOTERRA_PW_DEPS_LIB_DIR="/tmp/pw-deps/root/usr/lib/x86_64-linux-gnu"
fi
if [[ -n "${NOOTERRA_PW_DEPS_LIB_DIR:-}" && -d "${NOOTERRA_PW_DEPS_LIB_DIR}" ]]; then
  if [[ -n "${LD_LIBRARY_PATH:-}" ]]; then
    export LD_LIBRARY_PATH="${NOOTERRA_PW_DEPS_LIB_DIR}:${LD_LIBRARY_PATH}"
  else
    export LD_LIBRARY_PATH="${NOOTERRA_PW_DEPS_LIB_DIR}"
  fi
fi

cd "${ROOT_DIR}"
node --test "${TEST_FILE}"
