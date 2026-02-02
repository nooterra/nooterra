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
