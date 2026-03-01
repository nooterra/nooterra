# Intent Negotiation Conformance Pack v1

This pack defines deterministic interoperability behavior for intent negotiation handshake verification.

Scope:

- propose/counter/accept transcript acceptance,
- fail-closed required hash checks (`intentHash`, `eventHash`),
- fail-closed event hash tamper detection,
- fail-closed bound intent contract hash tamper detection.

## Files

- `vectors.json` - fixtures, cases, and expected outcomes.
- `run.mjs` - harness runner.
- `reference/nooterra-intent-negotiation-runtime-adapter.mjs` - reference adapter.

## Adapter contract

The harness sends JSON to stdin:

- request schema: `IntentNegotiationConformanceRequest.v1`
- response schema: `IntentNegotiationConformanceResponse.v1`

Success response (`ok=true`) must include `result` with:

- `verification` for selected event verification,
- `transcript` summary from full transcript evaluation,
- deterministic event hash list and transcript metadata.

Fail-closed response (`ok=false`) must include deterministic `code`/`message`/`details`.

## Run

Reference adapter (repo/dev):

```sh
node conformance/intent-negotiation-v1/run.mjs --adapter-node-bin conformance/intent-negotiation-v1/reference/nooterra-intent-negotiation-runtime-adapter.mjs
```

Single case:

```sh
node conformance/intent-negotiation-v1/run.mjs --adapter-node-bin conformance/intent-negotiation-v1/reference/nooterra-intent-negotiation-runtime-adapter.mjs --case intent_negotiation_event_hash_tampered_fail_closed
```

Emit hash-bound report and cert bundle:

```sh
node conformance/intent-negotiation-v1/run.mjs \
  --adapter-node-bin conformance/intent-negotiation-v1/reference/nooterra-intent-negotiation-runtime-adapter.mjs \
  --json-out /tmp/nooterra-intent-negotiation-conformance-report.json \
  --cert-bundle-out /tmp/nooterra-intent-negotiation-conformance-cert.json
```
