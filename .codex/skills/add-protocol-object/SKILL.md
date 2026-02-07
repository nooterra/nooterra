---
name: add-protocol-object
description: Add or change a protocol object in Settld with docs+schema+vectors+fixtures lockstep. Use when introducing a new protocol JSON shape/version, changing existing protocol semantics, updating docs/spec, docs/spec/schemas, test/fixtures/protocol-vectors, or bundle fixture corpus.
---

# Add / change a protocol object (lockstep workflow)

## 1) Decide versioning (no accidental drift)

- If meaning or required/optional fields change: add a new version (e.g. `Foo.v2`), do not mutate `v1` silently.
- If only clarifying docs or tightening validation without changing meaning: keep version, but ensure tests/vectors still match.

## 2) Update the spec (human contract)

- Add/update `docs/spec/<Object>.vN.md`:
  - required vs optional fields
  - strict vs non-strict behavior (if verification-related)
  - canonicalization / hashing / signing rules (if applicable)
  - error/warning codes emitted (if applicable)

## 3) Update schema (machine contract)

- Add/update `docs/spec/schemas/<Object>.vN.schema.json`.
- Enforce “optional means omitted” unless `null` is explicitly allowed.
- Keep schema IDs stable and consistent with the existing `https://settld.local/schemas/...` pattern.

## 4) Update implementation (bundler + verifier)

- Bundlers: `src/core/**`
- Verifier: `packages/artifact-verify/**`
- Keep deterministic ordering/canonicalization.
- Preserve manifest exclusion rules (`verify/**`) where required.

## 5) Update golden vectors

- Regenerate vectors:
  - `node scripts/spec/generate-protocol-vectors.mjs > test/fixtures/protocol-vectors/v1.json`
- Run: `npm test` (the protocol vectors test should pass).

## 6) Update bundle fixtures (end-to-end conformance)

- If the change affects on-disk bundle layout, required surfaces, or verifier outputs:
  - update generator: `scripts/fixtures/generate-bundle-fixtures.mjs`
  - regenerate committed fixtures: `node scripts/fixtures/generate-bundle-fixtures.mjs`
  - update matrix expectations: `test/fixtures/bundles/v1/fixtures.json`
  - run: `npm test`

## 7) Acceptance gates

- `npm test` passes (includes schema validation, vectors, fixture matrix, determinism gate).
- New strict rule has:
  - one strict-pass fixture exercising it
  - one strict-fail fixture breaking exactly one invariant

