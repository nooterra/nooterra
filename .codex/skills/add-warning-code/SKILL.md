---
name: add-warning-code
description: Add a new structured verification warning code (stable identifier) and wire it through docs/spec, verifier normalization/validation, CLI output, and fixtures/tests. Use when adding a warning or changing non-strict behavior that should emit a code-based warning.
---

# Add a warning code (stable contract)

## 1) Choose a stable code

- Use uppercase snake case, describing the condition and profile (e.g. `FOO_MISSING_LENIENT`).
- Warnings are protocol objects (not strings); keep `code` stable forever.

## 2) Update spec (closed set)

- Add the code to `docs/spec/WARNINGS.md` (and keep it a closed set).
- If behavior differs strict vs non-strict, update `docs/spec/STRICTNESS.md` too.

## 3) Update code sets (verifier + bundler)

- Add the code to:
  - `src/core/verification-warnings.js`
  - `packages/artifact-verify/src/verification-warnings.js`
- Ensure any warning validation/normalization accepts it.

## 4) Emit the warning deterministically

- Verifier emission points live under:
  - `packages/artifact-verify/src/job-proof-bundle.js`
  - `packages/artifact-verify/src/finance-pack-bundle.js`
- When the warning depends on environment (e.g. tool version / trust roots), make it deterministic in tests via env vars.

## 5) Update fixtures/tests

- Add or update a single-fault fixture that triggers the warning (prefer non-strict pass + warning).
  - Fixtures: `test/fixtures/bundles/v1/**`
  - Matrix: `test/fixtures/bundles/v1/fixtures.json`
- Ensure CLI matrix asserts the warning in `warningCodes[]`.

## 6) Validate

- Run: `npm test`
- Confirm the warning appears in:
  - CLI JSON output (`VerifyCliOutput.v1`)
  - VerificationReport warnings (if emitted into reports)

