# Settld Verified v1

`Settld Verified v1` defines baseline conformance requirements for runtimes/providers claiming reliable Settld interoperability.

Status: draft program spec.

## Scope

This program evaluates operational conformance for:

- MCP tool integration,
- settlement control behavior,
- artifact and evidence integrity.

It does not certify legal/compliance posture.

## Badge levels

## Level 1: Core

Required:

1. MCP connectivity and tool discovery works (`settld.about`, tools/list).
2. x402 gate create/verify/get lifecycle succeeds.
3. Deterministic machine-readable report with explicit schema version is emitted.

Suggested checks:

- `npm run -s test:ci:mcp-host-cert-matrix`
- `npm run -s mcp:probe -- --x402-smoke`

## Level 2: Collaboration

Required:

1. Agent card upsert + discover works.
2. Delegation grant issue + list + revoke works.
3. Work order lifecycle works (`create -> accept -> progress -> complete -> settle`).
4. Settlement binding to x402 evidence is present.

Suggested checks:

- `node --test test/api-e2e-subagent-work-orders.test.js`
- `node --test test/api-e2e-x402-delegation-grant.test.js`

## Level 3: Guardrails

Required:

1. Prompt-risk forced modes (`challenge|escalate`) enforce on paid paths.
2. Suspicious runs cannot release without recorded human override.
3. Fail-closed behavior on missing/invalid high-risk metadata.

Suggested checks:

- `npm run -s test:ops:agent-substrate-adversarial-harness`

## Required report contract

Any checker used for badge issuance MUST emit:

- `schemaVersion`
- `generatedAt`
- `ok`
- `checks[]`
- `blockingIssues[]`

with deterministic check identifiers.

## Revocation conditions

Badge status may be revoked if:

1. Required checks fail on re-validation.
2. Runtime bypasses enforced policy/guardrail paths.
3. Report artifacts are missing or tampered.

## Reference implementation

- `scripts/ci/run-settld-verified-gate.mjs`
