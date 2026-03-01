# Nooterra Verified

`Nooterra Verified` defines baseline conformance requirements for runtimes/providers claiming reliable Nooterra interoperability.

Status: draft program spec.

## Scope

This program evaluates operational conformance for:

- MCP tool integration,
- settlement control behavior,
- artifact and evidence integrity.

It does not certify legal/compliance posture.

## Community-facing acceptance (explicit)

For community-facing claims of `Nooterra Verified`, the minimum accepted level is `collaboration`.

Run the gate:

- `npm run -s test:ops:nooterra-verified-gate -- --level collaboration --out artifacts/gates/nooterra-verified-collaboration-gate.json`
- optional PG durability (explicit DB): `NOOTERRA_VERIFIED_INCLUDE_PG=1 DATABASE_URL=postgres://... npm run -s test:ops:nooterra-verified-gate -- --level collaboration --out artifacts/gates/nooterra-verified-collaboration-gate.json`
- optional PG durability (local Docker bootstrap): `npm run -s test:ops:nooterra-verified-gate -- --level collaboration --include-pg --bootstrap-local --out artifacts/gates/nooterra-verified-collaboration-gate.json`

Passing is explicit only when all are true:

1. Gate command exits with status `0`.
2. Report `artifacts/gates/nooterra-verified-collaboration-gate.json` contains:
   - `schemaVersion: "NooterraVerifiedGateReport.v1"`
   - `level: "collaboration"`
   - `ok: true`
   - `summary.failedChecks: 0`
   - `blockingIssues: []`
3. `checks[]` contains `ok: true` rows for:
   - `mcp_probe_x402_smoke`
   - `e2e_x402_delegation_grants`
   - `e2e_authority_grant_required`
   - `e2e_subagent_work_orders`
   - `e2e_trace_id_propagation`

Deterministic verifier (fails closed):

```bash
node -e 'const fs=require("node:fs");const p="artifacts/gates/nooterra-verified-collaboration-gate.json";const r=JSON.parse(fs.readFileSync(p,"utf8"));const req=["mcp_probe_x402_smoke","e2e_x402_delegation_grants","e2e_authority_grant_required","e2e_subagent_work_orders","e2e_trace_id_propagation"];const checkOk=id=>Array.isArray(r.checks)&&r.checks.some(c=>c&&c.id===id&&c.ok===true);const ok=r.schemaVersion==="NooterraVerifiedGateReport.v1"&&r.level==="collaboration"&&r.ok===true&&Number(r?.summary?.failedChecks)===0&&Array.isArray(r?.blockingIssues)&&r.blockingIssues.length===0&&req.every(checkOk);if(!ok){console.error("Nooterra Verified collaboration acceptance FAILED");process.exit(1)}console.log("Nooterra Verified collaboration acceptance PASSED");'
```

## Minimum paid delegation + receipt requirements (community listing)

Community listing claims MUST satisfy all minimums below:

1. Paid delegation path:
   - Delegation grant lifecycle succeeds (`issue + list + revoke`), covered by `e2e_x402_delegation_grants`.
   - Authority-grant-required mode fails closed on missing/mismatched authority refs, covered by `e2e_authority_grant_required`.
2. Paid receipt path:
   - Work-order flow reaches settle with receipt linkage (`create -> accept -> progress -> complete -> settle`), covered by `e2e_subagent_work_orders`.
   - `traceId` binds negotiation, completion receipt, and settlement deterministically, covered by `e2e_trace_id_propagation`.
3. Paid call verification metadata:
   - Paid call responses include: `x-nooterra-settlement-status`, `x-nooterra-verification-status`, `x-nooterra-policy-decision`, `x-nooterra-policy-hash`, `x-nooterra-decision-id`.
   - Missing/invalid policy runtime metadata fails closed, covered by `mcp_probe_x402_smoke`.

## Badge levels

## Level 1: Core

Required:

1. MCP connectivity and tool discovery works (`nooterra.about`, tools/list).
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
5. `traceId` propagation is deterministic across `quote -> offer -> acceptance -> work-order -> completion receipt -> settlement`, and mismatches fail closed.
6. Session replay packs fail closed on tampered event chains.
7. Prompt-contagion guardrails enforce challenge/escalate + override semantics on paid paths.
8. Tainted-session provenance evidence refs are required for release on x402 verify and work-order settle paths.
9. Settlement binding to x402 evidence is present.
10. Deterministic work-order settlement split binding is enforced when split policy requires it.
11. Relationship edges remain private by default and public reputation summary is opt-in.
12. Relationship anti-gaming dampening detects low-value reciprocal loops and flags collusion-shaped symmetry.
13. Interaction graph exports are deterministic and hash-bound (`VerifiedInteractionGraphPack.v1`).
14. Optional interaction-graph signatures verify against `packHash` and fail closed on invalid signer override config.
15. Authority-grant-required mode fails closed on x402 gate create/authorize and work-order create/settle when authority refs are missing.
16. Lifecycle controls fail closed across x402 authorization paths, marketplace negotiation/agreement mutation paths, and public discovery stream visibility.
17. Unified substrate audit lineage query returns deterministic, trace-filtered records and stable hash output.
18. Audit lineage verification tooling fails closed on tampered lineage artifacts.
19. SDK ACS fast-loop contract verifies grant-bound checkpoint refs (`checkpointDelegationGrantRef`, `checkpointAuthorityGrantRef`) and fails closed on missing/mismatched bindings.

Suggested checks:

- `node --test test/api-e2e-subagent-work-orders.test.js`
- `node --test test/api-e2e-task-negotiation.test.js`
- `node --test --test-name-pattern "traceId propagates quote->offer->acceptance->work-order->receipt->settlement|traceId mismatches fail closed across negotiation and work-order creation" test/api-e2e-task-negotiation.test.js`
- `node --test --test-name-pattern "SessionReplayPack.v1 fails closed on tampered event chain" test/api-e2e-sessions.test.js`
- `node conformance/session-v1/run.mjs --adapter-node-bin conformance/session-v1/reference/nooterra-session-runtime-adapter.mjs`
- `node --test test/api-e2e-ops-audit-lineage.test.js`
- `node --test test/audit-lineage-verify-script.test.js`
- `node --test --test-name-pattern "prompt risk" test/api-e2e-x402-delegation-grant.test.js`
- `node --test --test-name-pattern "tainted session verify fails closed until provenance evidence refs are submitted" test/api-e2e-x402-delegation-grant.test.js`
- `node --test --test-name-pattern "work-order settle fails closed until tainted-session provenance evidence refs are included" test/api-e2e-subagent-work-orders.test.js`
- `node --test --test-name-pattern "work-order settle enforces deterministic split contract fail-closed and binds split hash" test/api-e2e-subagent-work-orders.test.js`
- `node --test --test-name-pattern "relationships are tenant-scoped private-by-default and public summary is opt-in" test/api-e2e-agent-reputation.test.js`
- `node --test --test-name-pattern "relationships apply anti-gaming dampening on reciprocal micro-loops" test/api-e2e-agent-reputation.test.js`
- `node --test --test-name-pattern "interaction graph pack export is deterministic and hash-bound" test/api-e2e-agent-reputation.test.js`
- `node --test --test-name-pattern "interaction graph pack export supports optional signature and fails closed on invalid signer override" test/api-e2e-agent-reputation.test.js`
- `node --test test/api-e2e-x402-delegation-grant.test.js`
- `node --test --test-name-pattern "x402 gate create is blocked when payer agent lifecycle is provisioned|x402 gate create is blocked with 429 when payer agent lifecycle is throttled|x402 agent lifecycle transition from decommissioned to active fails closed|x402 agent lifecycle get returns implicit active when unset" test/api-e2e-x402-authorize-payment.test.js`
- `node --test --test-name-pattern "x402 gate quote is blocked when payer or payee lifecycle is non-active" test/api-e2e-x402-authorize-payment.test.js`
- `node --test --test-name-pattern "agreement delegation create fails closed when delegator or delegatee lifecycle is non-active" test/api-e2e-x402-authorize-payment.test.js`
- `node --test test/api-e2e-marketplace-lifecycle-enforcement.test.js`
- `node --test test/api-e2e-marketplace-agreement-lifecycle-enforcement.test.js`
- `node --test test/api-e2e-settlement-dispute-arbitration-lifecycle-enforcement.test.js`
- `node --test --test-name-pattern "tool-call arbitration routes fail closed when payer/arbiter lifecycle is non-active" test/api-e2e-tool-call-holdback-arbitration.test.js`
- `node --test --test-name-pattern "delegation grant issue fails closed when delegator or delegatee lifecycle is non-active|authority grant issue fails closed when grantee lifecycle is non-active" test/api-e2e-x402-delegation-grant.test.js test/api-e2e-authority-grant-required.test.js`
- `npm run -s test:ops:agent-substrate-fast-loop`
- `node --test --test-name-pattern "lifecycle becomes non-active" test/api-e2e-agent-card-stream.test.js`
- `node --test --test-name-pattern "task negotiation routes fail closed when participant lifecycle is non-active" test/api-e2e-task-negotiation.test.js`
- `node --test test/api-e2e-authority-grant-required.test.js`
- `NOOTERRA_VERIFIED_INCLUDE_PG=1 DATABASE_URL=postgres://... npm run -s test:ops:nooterra-verified-gate -- --level collaboration` (optional PG durability inclusion with explicit DB URL)
- `npm run -s test:ops:nooterra-verified-gate -- --level collaboration --include-pg --bootstrap-local` (optional local Docker-backed PG bootstrap)

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
- `level`
- `generatedAt`
- `ok`
- `summary`
- `checks[]`
- `blockingIssues[]`

with deterministic check identifiers.

## Revocation conditions

Badge status may be revoked if:

1. Required checks fail on re-validation.
2. Runtime bypasses enforced policy/guardrail paths.
3. Report artifacts are missing or tampered.

## Reference implementation

- `scripts/ci/run-nooterra-verified-gate.mjs`
- `.github/workflows/nooterra-verified-collaboration.yml` (automated collaboration-level issuance gate)
- `.github/workflows/nooterra-verified-guardrails.yml` (automated guardrails-level issuance gate)

## CI report artifacts

The collaboration workflow publishes machine-readable report artifacts:

- `artifacts/gates/nooterra-verified-collaboration-gate.json`
- `artifacts/gates/nooterra-verified-guardrails-gate.json`
- `artifacts/ops/mcp-host-cert-matrix.json`

When PG durability is required, run the collaboration gate with one of:

- `--include-pg` and a non-empty `DATABASE_URL`
- `--include-pg --bootstrap-local` (local runs only; requires Docker)
