# Session Stream Conformance Pack v1

This pack defines deterministic interoperability behavior for session inbox streaming semantics.

Scope:

- cursor-source conflict handling (`sinceEventId` query vs `Last-Event-ID` header),
- fail-closed missing cursor behavior,
- resume-first delivery ordering,
- watermark progression under filtered tails,
- reconnect dedupe (no duplicate delivered event IDs for the resumed cursor).

## Files

- `vectors.json` — fixtures, cases, and expected outcomes.
- `run.mjs` — harness runner.
- `reference/nooterra-session-stream-runtime-adapter.mjs` — reference adapter.

## Adapter contract

The harness sends JSON to stdin:

- request schema: `SessionStreamConformanceRequest.v1`
- response schema: `SessionStreamConformanceResponse.v1`

Success response (`ok=true`) must include `result` with:

- `headers` (session inbox header surface),
- `readyFrame` (`session.ready` payload),
- `emittedFrames` (`session.event` / `session.watermark` order),
- `cursor` (resolved cursor + next cursor state).

Fail-closed response (`ok=false`) must include deterministic error code/message/details.

## Run

Reference adapter (repo/dev):

```sh
node conformance/session-stream-v1/run.mjs --adapter-node-bin conformance/session-stream-v1/reference/nooterra-session-stream-runtime-adapter.mjs
```

Single case:

```sh
node conformance/session-stream-v1/run.mjs --adapter-node-bin conformance/session-stream-v1/reference/nooterra-session-stream-runtime-adapter.mjs --case stream_reconnect_delivery_deduped
```

Emit hash-bound report and cert bundle:

```sh
node conformance/session-stream-v1/run.mjs \
  --adapter-node-bin conformance/session-stream-v1/reference/nooterra-session-stream-runtime-adapter.mjs \
  --json-out /tmp/nooterra-session-stream-conformance-report.json \
  --cert-bundle-out /tmp/nooterra-session-stream-conformance-cert.json
```

## Third-Party Onboarding + Cert Publication

Use this when integrating a non-Nooterra runtime adapter.

1. Implement adapter stdin/stdout contract:
   - input: `SessionStreamConformanceRequest.v1`
   - output: `SessionStreamConformanceResponse.v1`
2. Run the pack until all vectors pass.
3. Publish normalized conformance artifacts bound by hashes:

```sh
node scripts/conformance/publish-session-stream-conformance-cert.mjs \
  --runtime-id <runtime-id> \
  --adapter-node-bin <path/to/adapter.mjs> \
  --out-dir artifacts/conformance/session-stream-v1/<runtime-id>
```

Repo-hosted publication lane (manual):

- GitHub Actions workflow: `.github/workflows/session-stream-conformance-cert.yml`
- Input: `runtime_id`
- Output artifact: `session-stream-conformance-cert-<runtime_id>-<run_id>`

Generated files:

- `session-stream-conformance-report.json`
- `session-stream-conformance-cert.json`
- `session-stream-conformance-publication.json`

Fail-closed guarantees:

- report/cert schema versions must match expected versions,
- `reportHash`/`certHash` must match canonical cores,
- cert bundle must bind the same `reportCore`/`reportHash`,
- run summary must be `ok=true`.
