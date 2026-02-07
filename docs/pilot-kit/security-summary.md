# Security summary (Verify Cloud / Magic Link)

This is a short, operator-facing security posture summary for pilots.

## Hostile ZIP ingestion

Magic Link ingestion uses a single safe unzip implementation:

- rejects absolute paths and traversal (`..`) after normalization
- rejects backslashes and drive letters (`:`)
- rejects duplicate entries
- rejects encrypted entries
- rejects symlinks via external attributes
- enforces budgets:
  - max entry count
  - max per-file bytes
  - max total uncompressed bytes
  - max path length
  - max compression ratio (zip bombs)
- extracts into a fresh temp dir and never overwrites existing files

## Deterministic outputs (CI / audit friendly)

- Verification output is deterministic JSON (`VerifyCliOutput.v1`) and is intended to be archived.
- Audit packet ZIP is deterministic and bundles:
  - bundle ZIP
  - hosted verify JSON
  - embedded producer receipt (if present)
  - PDF summary (non-normative)
  - decision record (if present)

## Multi-implementation parity

The repo includes a Python reference verifier and a conformance pack; parity is tested in CI.

