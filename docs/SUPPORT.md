# Support / filing a good bug

Settld verification is designed to be diagnosable from **structured, stable outputs**.

## Attach these artifacts

1. `settld-verify --about --format json`
2. `settld-verify --format json ...` output (`VerifyCliOutput.v1`)
3. Trust anchor method (env vars or trust file path) and intended root `keyId`s (public keys OK; **no private keys**)
4. Installation mode (npm version pinned, npm tarball, or from source)
5. OS + Node version

## Helpful flags

- `--explain` — prints deterministic diagnostics to stderr without changing JSON stdout.
- `--fail-on-warnings` — converts warnings into a failure (CI gating posture).

## Where to look first

- Error codes and remediation: `docs/spec/ERRORS.md`
- Warning codes and remediation: `docs/spec/WARNINGS.md`
- Trust anchor posture: `docs/spec/TRUST_ANCHORS.md`
- Strict/non-strict semantics: `docs/spec/STRICTNESS.md`
