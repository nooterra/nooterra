---
name: fixture-determinism
description: Generate, mutate, and validate deterministic end-to-end bundle fixtures and the CLI expectation matrix. Use when adding/updating fixtures under test/fixtures/bundles/v1, updating the matrix file, changing scripts/fixtures/generate-bundle-fixtures.mjs, or debugging fixture drift / determinism failures.
---

# Bundle fixtures: generation + determinism

## Source of truth

- Fixtures live at `test/fixtures/bundles/v1/**`.
- Expectations live at `test/fixtures/bundles/v1/fixtures.json`.
- The CLI conformance harness is `test/verify-fixture-bundles.test.js`.
- Determinism gate is `test/verify-fixtures-generator-determinism.test.js`.

## Regenerate fixtures (deterministically)

- Regenerate committed corpus in-place:
  - `node scripts/fixtures/generate-bundle-fixtures.mjs`
- Verify everything:
  - `npm test`

## Add a new fixture (single-fault rule)

1) Pick a base fixture:
   - Prefer generating from a strict-pass bundle in `scripts/fixtures/generate-bundle-fixtures.mjs`.
2) Apply exactly one mutation:
   - Missing surface: delete a single file (e.g. `verify/verification_report.json`).
   - Manifest tamper: edit exactly one manifest-covered file without updating `manifest.json`.
   - Binding mismatch: change report binding field and re-sign report (so only binding fails).
   - Governance denial: change policy allowlist to exclude signer (so signature is valid but policy denies).
3) Write the new fixture directory under `test/fixtures/bundles/v1/<kind>/...`.
4) Add one row to `test/fixtures/bundles/v1/fixtures.json`:
   - Set `id`, `kind`, `path`, `strict`
   - Expected `exitCode`, `ok`, `verificationOk`
   - Expected `errorCodes[]` and `warningCodes[]` (order-independent sets)
5) Regenerate fixtures if they are generator-owned and committed:
   - `node scripts/fixtures/generate-bundle-fixtures.mjs`
6) Run tests:
   - `npm test`

## Determinism pitfalls (avoid)

- Do not depend on filesystem ordering; always sort paths when enumerating.
- Do not depend on Map insertion order when writing files to disk.
- Use fixed timestamps/IDs in generators; avoid `Date.now()` and unseeded randomness.
- Keep `verify/**` excluded from manifests to avoid circular hashing.

