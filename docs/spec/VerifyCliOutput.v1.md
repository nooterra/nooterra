# VerifyCliOutput.v1

`VerifyCliOutput.v1` is the machine-readable JSON output emitted by `settld-verify --format json`.

This is a **tool contract** intended for CI gating and automated ingestion. It is versioned and treated as a stable surface.

## Schema

See `schemas/VerifyCliOutput.v1.schema.json`.

## Semantics

- `ok` is the CLI’s overall verdict, including policy flags like `--fail-on-warnings`.
- `verificationOk` reflects the underlying verifier result (`true` only when the bundle verification succeeded).
- When available, `errors[].code` is promoted from the verifier’s structured error (`result.detail.error`) to prefer stable, code-like identifiers; `errors[].message` may contain a human summary (`result.error`).
- `errors` and `warnings` are sorted deterministically by `(path, code)`.
- The CLI supports `--hash-concurrency <n>` to bound parallel hashing work; it does not change verification semantics.
- `tool.commit` is a best-effort build identifier for the verifier tool (typically a git commit SHA or build revision).

## `--explain` (deterministic stderr)

`settld-verify --explain` prints a deterministic diagnostic summary to **stderr** (while `--format json` continues to print machine output to stdout).

Contract:

- Output is deterministic for the same inputs/environment.
- Output MUST NOT include secrets.
- Output ends with **exactly one** trailing newline.
