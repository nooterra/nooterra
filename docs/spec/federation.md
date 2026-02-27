# Federation v1 (Coordinator-to-Coordinator)

This document defines the initial federation contract for cross-coordinator dispatch in Nooterra ACS.

Status:
- `v1` is a control-plane scaffolding contract.
- Execution routes may still be disabled; callers MUST treat unsupported federation routes as fail-closed denials (never implicit local fallback).

## Coordinator identity and trust

Runtime config:
- `COORDINATOR_DID` (or `PROXY_COORDINATOR_DID`): local coordinator DID-like identifier.
- `PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS`: comma-separated trusted peer coordinator DIDs.
- `PROXY_COORDINATOR_SIGNING_PRIVATE_KEY_PEM` + `PROXY_COORDINATOR_SIGNING_KEY_ID`: optional envelope signing key material.

Fail-closed rules:
- Federation is considered enabled when any federation identity/trust/signing input is configured.
- When federation is enabled, local coordinator identity MUST be configured (`COORDINATOR_DID` or `PROXY_COORDINATOR_DID`). Missing local identity is a hard startup error.
- When `PROXY_COORDINATOR_SIGNING_PRIVATE_KEY_PEM` is configured, `PROXY_COORDINATOR_SIGNING_KEY_ID` MUST also be configured. Missing key id is a hard startup error.
- Unknown or untrusted peer coordinator DIDs MUST be rejected at trust evaluation boundaries.
- Implementations MUST emit deterministic error codes for identity/trust/signing failures and MUST NOT continue with best-effort federation delivery.

Trust boundary:
- `originDid`/peer trust validation is a control-plane trust boundary.
- Signature verification (when signature is present or required by deployment policy) is a cryptographic trust boundary.
- Any boundary failure MUST terminate the affected federation request as denied/error; no silent downgrade to local dispatch.

## Envelope contracts

### CoordinatorInvokeEnvelope.v1
- `version`: `"1.0"`
- `type`: `"coordinatorInvoke"`
- `invocationId`: stable idempotency identifier
- `originDid`: source coordinator DID
- `targetDid`: destination coordinator DID
- `capabilityId`: requested capability
- `payload`: invocation request body
- `trace`: optional trace metadata (`traceId`, `spanId`, `parentSpanId`)
- `signature`: optional detached signature block

### CoordinatorResultEnvelope.v1
- `version`: `"1.0"`
- `type`: `"coordinatorResult"`
- `invocationId`: identifier from invoke envelope
- `originDid`: executing coordinator DID
- `targetDid`: requesting coordinator DID
- `status`: `success|error|timeout|denied`
- `result`: canonical result payload
- `evidenceRefs`: optional list of evidence refs
- `signature`: optional detached signature block

## Routing relation with AgentCard

`AgentCard` metadata may carry `executionCoordinatorDid`.

Routing semantics:
- Missing `executionCoordinatorDid`, or `executionCoordinatorDid` equal to local coordinator DID, selects local dispatch.
- A different `executionCoordinatorDid` selects federation dispatch to that coordinator namespace.
- Namespace routing MUST be exact-match DID-based (no prefix, substring, alias, or heuristic routing).
- If the selected remote DID is not trusted/known, dispatch MUST fail closed.
- If federation transport for the selected namespace is unavailable/unsupported, dispatch MUST fail closed.

## Signature and verification model

`v1` signature model:
- signatures are optional but recommended for production federation.
- when provided, signature verification uses trusted public keys configured out-of-band.
- invalid signatures MUST emit deterministic error codes and fail closed for protected flows.

## Observability minimums

Required structured logs:
- `federation_invoke_received`
- `federation_result_received`
- `federation_signature_invalid`

Recommended fields:
- `originDid`, `targetDid`, `capabilityId`, `invocationId`, `status`, `latencyMs`

## Threat model assumptions (v1)

- honest-but-buggy peers by default.
- explicit trust allowlists (no implicit open federation).
- fail-closed on identity mismatch, trust mismatch, signature mismatch, and protocol-version mismatch.
