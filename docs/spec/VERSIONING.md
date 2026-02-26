# Versioning (tools vs protocol)

Nooterra has **two coupled version surfaces**:

1. **Tool versions** (SemVer): the software you install/run (`nooterra-verify`, bundlers, services).
2. **Protocol versions** (object `*.v1`, `*.v2`, …): on-disk/wire-format contracts (schemas + semantics).

This document defines when to bump **tool SemVer**, when to introduce **new protocol object versions**, and how to avoid accidental drift.

## Tool SemVer policy

Tools follow Semantic Versioning:

- **MAJOR**: any breaking change to a public surface (CLI flags/output, verification semantics in strict mode, required protocol surfaces, bundle layout requirements, removal of documented warnings, etc.).
- **MINOR**: backwards-compatible additions (new CLI flags, new optional output fields, new warning codes, new non-strict compatibility paths).
- **PATCH**: bug fixes and perf improvements that do not change documented behavior (same pass/fail, same codes, same hashes/signatures).

### Concrete examples (tool SemVer)

- Add a new CLI flag (e.g. `--hash-concurrency`) that does not change verification semantics → **MINOR**.
- Fix a bug where strict mode accepted an invalid signature and now fails it → **MAJOR** (strict semantics changed).
- Stream file hashing (perf) while keeping hashes, codes, and strict/non-strict semantics identical → **PATCH**.
- Add a new warning code and surface it in `VerifyCliOutput.v1` → **MINOR**.
- Change sorting of `errors[]` / `warnings[]` in CLI JSON output → **MAJOR** (downstream parsers/snapshots can break).

## Protocol surface policy

The protocol is treated like an API:

- Specs: `docs/spec/*`
- Schemas: `docs/spec/schemas/*`
- Vectors: `test/fixtures/protocol-vectors/v1.json`
- End-to-end fixtures: `test/fixtures/bundles/v1/*`

## v1 freeze (protocol becomes a stable contract)

Protocol `v1` is a **frozen contract**: customers, auditors, and independent implementers must be able to pin a tool version and rely on the v1 meaning indefinitely.

### Allowed changes (v1)

- Documentation clarifications and additional examples that do **not** change acceptance criteria.
- Performance improvements that do **not** change:
  - pass/fail outcomes,
  - error/warning codes,
  - hashes/signatures (canonicalization inputs and bytes),
  - strict/non-strict downgrade behavior.
- New tests, fixtures, and conformance cases that increase coverage without changing behavior.

### Not allowed changes (v1)

- Any change to `docs/spec/schemas/*v1*.json` that would alter the schema contract.
- Any change to `test/fixtures/protocol-vectors/v1.json` that changes canonical meaning.
- Any change to canonicalization rules (RFC 8785 / JCS) or hashing inputs.
- Any change to strictness semantics in `STRICTNESS.md`.
- Any change to warning code meanings in `WARNINGS.md`.

### Enforcement (CI + local)

Changes to v1 schemas/vectors must be **deliberate**:

- CI fails if v1 schemas or `test/fixtures/protocol-vectors/v1.json` change unless:
  - `CHANGELOG.md` is updated, **and**
  - the PR includes an explicit marker `protocol-change` (PR body or commit message).
- A local freeze test (`test/protocol-v1-freeze.test.js`) asserts v1 schema/vector file hashes are unchanged unless `ALLOW_PROTOCOL_V1_MUTATION=1` is set (intended only for deliberate rotations).

### What is a breaking protocol change?

Any change that alters what an independent verifier would accept/reject, or what it would compute as hashes/signatures, including:

- JSON Schema breaking changes for existing `*.v1` objects.
- Canonicalization changes (RFC 8785 / JCS rules).
- Hashing changes (algorithm, input bytes, file inclusion/exclusion rules).
- Strictness contract changes (required surfaces, required validations, downgrade behavior).
- Bundle layout changes that affect required files or meaning.

### When to introduce `v2` objects vs mutate `v1`

Do **not** mutate the meaning of `*.v1` objects in a way that would cause previously valid instances to become invalid (or vice versa) in strict mode.

Introduce a `v2` when:

- A required field changes shape/type/meaning.
- A new required field is introduced.
- The canonicalization/hashing/signing inputs change.
- You need to remove/rename fields or change invariants.

You may evolve `v1` only via **compatible additions**:

- Add new **optional** fields that are omitted when absent (not `null`).
- Clarify docs without changing semantics.
- Add new warning codes (closed set remains documented).

### How vectors and fixtures relate to compatibility

- **Protocol vectors** lock canonical examples and edge cases. Any intentional protocol change requires a deliberate vector update (and review).
- **Bundle fixtures** are a conformance corpus. Changes to strict/non-strict behavior should be expressed as:
  - a new fixture directory (single fault), and
  - an expectation row in `test/fixtures/bundles/v1/fixtures.json`.

## Compatibility matrix (within a major tool version)

Within a given tool **MAJOR**:

- Verifier `X.Y.Z` must verify bundles produced by bundler `X.*.*` (same major), subject to documented strict/non-strict behavior and governance trust anchors.
- Bundlers may emit new **optional** protocol fields in `v1` objects; verifiers in the same major should ignore unknown optional fields unless strict rules say otherwise.

If a change requires a new protocol object version (`*.v2`), that is a **MAJOR** tool bump unless explicitly documented as “dual read” compatibility.
