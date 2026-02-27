#!/usr/bin/env bash
set -euo pipefail

# Vercel "ignoreCommand" contract:
# - exit 0 => skip deployment
# - exit 1 => continue with deployment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$REPO_ROOT"

if ! git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  # No parent commit context available; build to stay safe.
  exit 1
fi

if git diff --quiet HEAD^ HEAD -- \
  mkdocs/docs/ \
  mkdocs/ \
  docs/ \
  mkdocs.yml \
  scripts/vercel/ \
  .github/workflows/release.yml \
  .github/workflows/tests.yml \
  .github/pull_request_template.md; then
  # No docs/mkdocs pipeline changes; skip root docs deployment.
  exit 0
fi

# Relevant docs/deploy files changed; run deployment.
exit 1
