# Federation v1 (Coordinator-to-Coordinator)

This document defines the initial federation contract for cross-coordinator dispatch in Nooterra ACS.

Status:
- `v1` is a control-plane scaffolding contract.
- Execution routes may still be disabled; callers must treat unsupported routes as fail-closed.

## Coordinator identity and trust

Runtime config:
- `COORDINATOR_DID` (or `PROXY_COORDINATOR_DID`): local coordinator DID-like identifier.
- `PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS`: comma-separated trusted peer coordinator DIDs.
- `PROXY_COORDINATOR_SIGNING_PRIVATE_KEY_PEM` + `PROXY_COORDINATOR_SIGNING_KEY_ID`: optional envelope signing key material.

Fail-closed rules:
- if federation config is enabled (trusted peers/signing configured), `COORDINATOR_DID` is required.
- if signing private key is configured, `PROXY_COORDINATOR_SIGNING_KEY_ID` is required.
- unknown origin coordinator DIDs are rejected.

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
- missing `executionCoordinatorDid` or equal to local `COORDINATOR_DID`: local dispatch path.
- different `executionCoordinatorDid`: federation dispatch path.
- if remote DID is not trusted/known, dispatch fails closed.

## Signature and verification model

`v1` signature model:
- signatures are optional but recommended for production federation.
- when provided, signature verification uses trusted public keys configured out-of-band.
- invalid signatures must emit deterministic error codes and fail closed for protected flows.

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

