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
4. Task negotiation lifecycle works (`quote -> offer -> acceptance`) and settlement enforces acceptance binding.
5. Session replay packs fail closed on tampered event chains.
6. Prompt-contagion guardrails enforce challenge/escalate + override semantics on paid paths.
7. Tainted-session provenance evidence refs are required for release on x402 verify and work-order settle paths.
8. Settlement binding to x402 evidence is present.
9. Deterministic work-order settlement split binding is enforced when split policy requires it.
10. Relationship edges remain private by default and public reputation summary is opt-in.
11. Relationship anti-gaming dampening detects low-value reciprocal loops and flags collusion-shaped symmetry.
12. Interaction graph exports are deterministic and hash-bound (`VerifiedInteractionGraphPack.v1`).
13. Optional interaction-graph signatures verify against `packHash` and fail closed on invalid signer override config.

Suggested checks:

- `node --test test/api-e2e-subagent-work-orders.test.js`
- `node --test test/api-e2e-task-negotiation.test.js`
- `node --test --test-name-pattern "SessionReplayPack.v1 fails closed on tampered event chain" test/api-e2e-sessions.test.js`
- `node --test --test-name-pattern "prompt risk" test/api-e2e-x402-delegation-grant.test.js`
- `node --test --test-name-pattern "tainted session verify fails closed until provenance evidence refs are submitted" test/api-e2e-x402-delegation-grant.test.js`
- `node --test --test-name-pattern "work-order settle fails closed until tainted-session provenance evidence refs are included" test/api-e2e-subagent-work-orders.test.js`
- `node --test --test-name-pattern "work-order settle enforces deterministic split contract fail-closed and binds split hash" test/api-e2e-subagent-work-orders.test.js`
- `node --test --test-name-pattern "relationships are tenant-scoped private-by-default and public summary is opt-in" test/api-e2e-agent-reputation.test.js`
- `node --test --test-name-pattern "relationships apply anti-gaming dampening on reciprocal micro-loops" test/api-e2e-agent-reputation.test.js`
- `node --test --test-name-pattern "interaction graph pack export is deterministic and hash-bound" test/api-e2e-agent-reputation.test.js`
- `node --test --test-name-pattern "interaction graph pack export supports optional signature and fails closed on invalid signer override" test/api-e2e-agent-reputation.test.js`
- `node --test test/api-e2e-x402-delegation-grant.test.js`
- `SETTLD_VERIFIED_INCLUDE_PG=1 DATABASE_URL=postgres://... npm run -s test:ops:settld-verified-gate -- --level collaboration` (optional PG durability inclusion)

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
- `.github/workflows/settld-verified-collaboration.yml` (automated collaboration-level issuance gate)
- `.github/workflows/settld-verified-guardrails.yml` (automated guardrails-level issuance gate)

## CI report artifacts

The collaboration workflow publishes machine-readable report artifacts:

- `artifacts/gates/settld-verified-collaboration-gate.json`
- `artifacts/gates/settld-verified-guardrails-gate.json`
- `artifacts/ops/mcp-host-cert-matrix.json`

When PG durability is required, run the collaboration gate with:

- `--include-pg` and a non-empty `DATABASE_URL`.
