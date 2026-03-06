# Session Artifact Conformance Pack v1

This pack defines a deterministic interoperability contract for session replay/transcript artifacts.

Scope:

- `SessionReplayPack.v1` materialization from a fixed session timeline fixture.
- `SessionTranscript.v1` materialization from the same fixture.
- Optional deterministic Ed25519 signing for both artifacts.
- Fail-closed ACL denial behavior for replay/transcript materialization attempts.
- Fail-closed replay/provenance verification denial behavior when session verification input is invalid.
- Deterministic rerun behavior (identical request must produce identical canonical artifact JSON).

## Files

- `vectors.json` — case matrix, fixtures, and expected hashes/signatures.
- `run.mjs` — harness runner.
- `reference/nooterra-session-runtime-adapter.mjs` — reference adapter implementation.

## Adapter contract

The harness calls an adapter command and sends JSON on stdin:

- request schema: `SessionArtifactConformanceRequest.v1`
- response schema: `SessionArtifactConformanceResponse.v1`

Required response fields on success:

- `schemaVersion`
- `caseId`
- `ok=true`
- `replayPack`
- `transcript`

If signing config is provided in `request.fixture.signing`, adapters must return signed replay/transcript artifacts that verify against the provided public key.

## Run

Reference adapter (repo/dev):

```sh
node conformance/session-v1/run.mjs --adapter-node-bin conformance/session-v1/reference/nooterra-session-runtime-adapter.mjs
```

Single case:

```sh
node conformance/session-v1/run.mjs --adapter-node-bin conformance/session-v1/reference/nooterra-session-runtime-adapter.mjs --case session_artifacts_signed_deterministic
```

Emit hash-bound report and cert bundle:

```sh
node conformance/session-v1/run.mjs \
  --adapter-node-bin conformance/session-v1/reference/nooterra-session-runtime-adapter.mjs \
  --json-out /tmp/nooterra-session-conformance-report.json \
  --cert-bundle-out /tmp/nooterra-session-conformance-cert.json
```

Third-party adapter packaging options:

- `--adapter-arg <arg>` (repeatable): pass adapter argv values without wrapper scripts.
- `--adapter-cwd <dir>`: run the adapter from a specific working directory.
- `--generated-at <iso-8601>`: force deterministic `generatedAt` in report/cert outputs.
