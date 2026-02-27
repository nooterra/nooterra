# Reference implementations

Nooterra’s protocol is intended to be language/toolchain independent.

This repo contains multiple verifier implementations that are expected to agree on `conformance/v1/`:

## JavaScript (Node)

- CLI: `packages/artifact-verify/bin/nooterra-verify.js`
- Conformance runner: `node conformance/v1/run.mjs --node-bin packages/artifact-verify/bin/nooterra-verify.js`
- Release authenticity CLI: `packages/artifact-verify/bin/nooterra-release.js`
- Release conformance runner: `node conformance/v1/run-release.mjs --release-node-bin packages/artifact-verify/bin/nooterra-release.js`

### Session replay/transcript adapter conformance (Node reference)

- Adapter contract runner: `node conformance/session-v1/run.mjs --adapter-node-bin conformance/session-v1/reference/nooterra-session-runtime-adapter.mjs`
- This validates deterministic `SessionReplayPack.v1` + `SessionTranscript.v1` materialization/signing against fixed vectors and emits hash-bound cert bundles.

## Python

- CLI: `reference/verifier-py/nooterra-verify-py`
- Conformance runner: `node conformance/v1/run.mjs --bin reference/verifier-py/nooterra-verify-py`

## Parity policy

- Verifier behavior is specified by:
  - `STRICTNESS.md`
  - `REFERENCE_VERIFIER_BEHAVIOR.md`
  - `WARNINGS.md`
  - `ERRORS.md` / `error-codes.v1.txt`
- Conformance is the executable oracle; implementations must match the expected outcomes for all cases.
- CLI output is a tooling contract (`VerifyCliOutput.v1`); output must be deterministic for the same inputs.

Release authenticity verification (`nooterra-release verify`) is currently implemented in Node and gated by release conformance.
