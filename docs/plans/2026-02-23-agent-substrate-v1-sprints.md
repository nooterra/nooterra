# Agent Substrate Sprints (2026-02-23)

This plan treats Nooterra as the trust substrate under any agent runtime.

## Substrate model

1. Transport layer: MCP, A2A, HTTP.
2. Trust layer (Nooterra): identity, delegation, policy, escrow, verification, receipts.
3. Runtime layer: OpenClaw, Nooterra, Claude, Cursor, custom hosts.

The substrate payload format should stay canonical JSON with deterministic hashes and signatures, not transport-specific envelopes.

## Delegation order

1. Principal issues authority (`AuthorityGrant`).
2. Agent receives bounded delegation (`DelegationGrant`).
3. Agent may sub-delegate only within parent scope.
4. Execution intent binds quote, scope, and evidence requirements.
5. Policy decision allows/challenges/denies/escalates.
6. Settlement holds funds, verifies evidence, then releases/refunds.
7. Receipt chain updates relationship/reputation signals.

Any invalid signature, expired grant, revoked grant, scope escalation, or evidence mismatch must fail closed.

## What is already built vs missing

Built:
- Agent identity and passport flows are in runtime.
- x402 hold/verify/release/refund plus signed receipts.
- policy decisioning and fail-closed checks across paid paths.

Partial:
- `DelegationGrant.v1` has spec/schema but runtime enforcement is not complete.

Missing:
- `AuthorityGrant` primitive.
- `SubAgentWorkOrder.v1` and `SubAgentCompletionReceipt.v1` primitives.

## Sprint plan (8 weeks)

Sprint 1:
- Runtime `DelegationGrant` validator and revocation lifecycle.
- Chain-depth and scope monotonicity enforcement.

Sprint 2:
- `AuthorityGrant.v1` spec+schema+runtime.
- `SubAgentWorkOrder.v1` and `SubAgentCompletionReceipt.v1`.

Sprint 3:
- Capability attestation registry.
- Trust-weighted collaboration routing.
- Prompt contagion + bad-actor quarantine controls.

Sprint 4:
- Setup/onboarding delegation templates.
- OpenClaw/ClawHub packaging gates.
- Fast iteration loop + release gate enforcement.

Detailed epics/tickets live in:
- `planning/jira/agent-substrate-v1-epics.csv`
- `planning/jira/agent-substrate-v1-tickets.csv`
- `planning/jira/agent-substrate-v1-backlog.json`

## Onboarding and distribution fit

1. `nooterra setup` must output delegation-ready runtime context (not just API keys).
2. Host config helpers should write transport config and delegation defaults.
3. First-run success path should be: delegated paid call with verification receipt.
4. Distribution remains host-first (OpenClaw/Nooterra/Claude/Cursor), with Nooterra as trust control plane.

## Test workflow

Fast inner loop for daily engineering:

```bash
npm run -s test:ops:agent-substrate-fast-loop
```

This emits machine-readable report:

- `artifacts/ops/agent-substrate-fast-loop.json`

Release-gate loop (slower, required for public rollout):

```bash
npm run -s test:ci:mcp-host-cert-matrix
npm run -s mcp:probe -- --call nooterra.about '{}'
npm run -s mcp:probe -- --x402-smoke
npm run -s test:ci:public-openclaw-npx-smoke
```
