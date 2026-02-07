---
name: release-discipline
description: >
  Keep protocol/toolchain releases reproducible and non-drifting: update tool version
  stamping, regenerate vectors/fixtures, and ensure CI gates pass. Use when preparing a
  release, bumping versions, changing SETTLD_VERSION/package versions, or when
  TOOL_VERSION_UNKNOWN warnings appear unexpectedly.
---

# Release discipline (avoid drift)

## Version sources (keep consistent)

- Bundlers read tool version from `SETTLD_VERSION` (best-effort).
- The verifier CLI reports its tool version from `packages/artifact-verify/package.json`.

When releasing, bump both intentionally:

- `SETTLD_VERSION`
- `packages/artifact-verify/package.json` (`version`)

## Regenerate contract artifacts (if needed)

If protocol-relevant behavior changed:

- Regenerate protocol vectors:
  - `node scripts/spec/generate-protocol-vectors.mjs > test/fixtures/protocol-vectors/v1.json`
- Regenerate bundle fixtures:
  - `node scripts/fixtures/generate-bundle-fixtures.mjs`

## Hard gates

- `npm test` must pass (includes schemas, vectors, fixture matrix, fixture determinism).
- Strict/non-strict changes must be reflected in:
  - `docs/spec/STRICTNESS.md`
  - `docs/spec/WARNINGS.md`

## TOOL_VERSION_UNKNOWN warning hygiene

- Treat `TOOL_VERSION_UNKNOWN` as a real signal:
  - It should only appear when version resolution is intentionally unavailable.
  - For releases/CI, keep versions readable and deterministic.
