# ProduceCliOutput.v1

`ProduceCliOutput.v1` is the machine-readable output emitted by `nooterra-produce --format json`.

This is a public contract intended for CI/pipelines:

- It is JSON Schema defined (see `docs/spec/schemas/ProduceCliOutput.v1.schema.json`).
- Arrays of `errors[]` and `warnings[]` MUST be deterministically ordered (recommended sort: `(code, path)`).
- Optional fields MUST be omitted when absent (not `null`) unless the schema explicitly allows `null`.

## High-level shape

- `schemaVersion`: `"ProduceCliOutput.v1"`
- `tool`: tool identity (best-effort)
- `mode`: deterministic controls that influenced generation
- `target`: what was produced and where it was written
- `ok`: overall success
- `produceOk`: whether production succeeded (even if `verifyAfter` failed)
- `verifyAfter` (optional): result of a post-produce verification step when requested
- `warnings[]`: structured warning codes
- `errors[]`: structured error codes
- `result`: summary of produced bundle hashes and identifiers

## Error/warning items (safe diagnostics)

Each item in `errors[]` / `warnings[]` may include:

- `code`: stable, machine-readable code (see `docs/spec/PRODUCER_ERRORS.md`).
- `causeKind`: coarse category for operators (`signer` | `plugin` | `verify` | `input` | `io` | `internal`).
- `causeCode`: stable, non-secret subcode identifying the internal failure class (never raw exception text).

Producer tooling MUST NOT embed arbitrary exception strings in stdout JSON output; use `--explain` (stderr) for operator diagnostics.

## `--explain` (deterministic stderr)

`nooterra-produce --explain` prints a deterministic, non-secret diagnostic summary to **stderr**.

Contract:

- Output is deterministic for the same inputs/environment.
- Output MUST NOT include secrets (tokens, secret header values, private keys).
- Output ends with **exactly one** trailing newline.

## Relationship to protocol objects

`ProduceCliOutput.v1` describes tooling behavior; it does not change bundle protocol semantics.
