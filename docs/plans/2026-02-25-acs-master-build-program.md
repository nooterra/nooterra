# Nooterra ACS Master Build Program (Long-Horizon, Chunked)

## 1) Mission and Product Boundary
Nooterra ACS is a host-agnostic trust and collaboration substrate for autonomous agents.

What ACS must provide, end to end:
1. Discoverable agents and capabilities.
2. Bounded authority and delegation chains.
3. Durable collaboration sessions and event timelines.
4. Negotiated task contracts and verifiable completion receipts.
5. Deterministic settlement tied to evidence.
6. Reputation and relationship graphs that are hard to game.
7. Safety/governance controls that fail closed.
8. Operator-grade observability, audit export, and replay.
9. Distribution surfaces (MCP + SDKs + host guides).

Non-goals for this phase:
1. Building vertical user applications (travel app, legal app, etc.).
2. Locking to one host runtime (OpenClaw-only).

## 2) Current Repo State (Verified)
Already implemented and tested:
1. Authority chain primitive:
- `AuthorityGrant.v1` object, schema, core logic, API routes, MCP tools.
- x402 authorization enforcement is fail-closed against authority constraints.

2. Session collaboration backbone v1:
- `Session.v1` + `SessionEvent.v1` append/list.
- SSE event stream endpoint with cursor resume support.
- Replay pack endpoint with chain integrity checks and fail-closed tamper rejection.

3. Negotiation v1:
- `TaskQuote.v1`, `TaskOffer.v1`, `TaskAcceptance.v1` API + models.
- Work-order settlement acceptance hash binding enforced.

4. Verified gates:
- Collaboration gate workflow and report.
- Guardrails gate workflow and report.
- Branch protection on `main` requires `collaboration_gate` and `guardrails_gate`.

## 2.1) Execution Status Snapshot (2026-02-25)
Machine status anchors:
1. `artifacts/gates/nooterra-verified-gate.json`: collaboration gate passing (`totalChecks=22`).
2. `artifacts/gates/nooterra-verified-gate.json` with `--include-pg`: collaboration + PG durability gate passing (`totalChecks=23`).
3. `artifacts/gates/nooterra-verified-guardrails-gate.json`: guardrails gate passing (`totalChecks=11`).

Chunk status:
1. Chunk A (Public Discovery Plane + Durable Registry): **substantially complete**.
- Public cross-tenant discovery endpoint is implemented.
- Quarantine exclusion + public publish rate-limit + bond/attestation checks are implemented.
- Gate now includes explicit public discovery e2e coverage.
2. Chunk B (Delegation Graph Integrity): **implemented core path**.
- Authority/delegation/work-order chain enforcement is in gate-covered flows.
- Work-order settle now enforces `constraints.maxCostCents` fail-closed with explicit reason code (`WORK_ORDER_SETTLEMENT_MAX_COST_EXCEEDED`).
3. Chunk C (Session Provenance + Prompt Contagion Controls): **implemented core path**.
- Taint/prompt-risk challenge-escalate behavior and tainted-session evidence requirements are gate-covered.
4. Chunk E (Streaming Metering + Progressive Settlement): **core complete**.
- Billable usage event model and PG durability exist.
- Gate now includes memory+PG billable usage e2e checks.
- Added `POST /ops/finance/billable-events` ingest path with idempotency, immutable conflict fail-closed behavior, and memory/PG e2e coverage.
- Added work-order top-up hold/reconcile contracts and fail-closed release checks (`WORK_ORDER_SETTLEMENT_TOPUP_REQUIRED`, meter evidence/reconcile enforcement).
- Added deterministic work-order split binding at settlement with fail-closed policy enforcement and split hash recording.
5. Chunk F (relationship/reputation flywheel): **in progress**.
- Added tenant-scoped `GET /relationships` with deterministic `RelationshipEdge.v1` derivation and private-by-default visibility.
- Added public opt-in `GET /public/agents/:agentId/reputation-summary` with coarse, non-sensitive summary payload.
- Added collaboration gate check `e2e_public_relationship_summary_opt_in`.
- Added anti-gaming dampening for low-value reciprocal loops with deterministic reason codes.
- Added reciprocal-collusion symmetry heuristic and edge-level impact multiplier fields.
- Added collaboration gate check `e2e_relationship_anti_gaming_dampening`.
- Added deterministic `VerifiedInteractionGraphPack.v1` export (`GET /agents/:agentId/interaction-graph-pack`) with hash-bound summary/edge payloads.
6. Chunk G (governance lifecycle hardening): **in progress**.
- Added expanded x402 runtime lifecycle states (`provisioned|active|throttled|suspended|quarantined|decommissioned|frozen|archived`).
- Added fail-closed transition matrix enforcement (`X402_AGENT_LIFECYCLE_TRANSITION_BLOCKED`).
- Added lifecycle API surface:
  - `GET /x402/gate/agents/:agentId/lifecycle`
  - `POST /x402/gate/agents/:agentId/lifecycle`
- Extended x402 gate/create blocking semantics by lifecycle status (`not_active`, `throttled`, `suspended`, `quarantined`, `decommissioned`, `frozen`, `archived`).
- Added public stream lifecycle regression coverage:
  - `/public/agent-cards/stream` emits `agent_card.removed` when lifecycle becomes non-active.
  - Re-activation + card update emits deterministic `agent_card.upsert` reappearance event.
- Added x402 quote-path lifecycle fail-closed enforcement:
  - `POST /x402/gate/quote` blocks when payer/payee lifecycle is non-active.
- Added lifecycle fail-closed enforcement on work-order mutation routes:
  - `POST /work-orders`
  - `POST /work-orders/:workOrderId/accept`
  - `POST /work-orders/:workOrderId/progress`
  - `POST /work-orders/:workOrderId/topup`
  - `POST /work-orders/:workOrderId/complete`
  - `POST /work-orders/:workOrderId/settle`
- Added lifecycle fail-closed enforcement on grant issuance routes:
  - `POST /delegation-grants` (delegator + delegatee lifecycle checks)
  - `POST /authority-grants` (grantee lifecycle check)
- Added lifecycle fail-closed enforcement on task negotiation mutation routes:
  - `POST /task-quotes` (buyer + seller lifecycle checks)
  - `POST /task-offers` (buyer + seller lifecycle checks)
  - `POST /task-acceptances` (buyer + seller + accepted-by lifecycle checks)
- Added lifecycle fail-closed enforcement on agreement delegation mutation routes:
  - `POST /agreements/:agreementHash/delegations` (delegator + delegatee lifecycle checks)
- Added lifecycle fail-closed enforcement on marketplace negotiation/accept mutation routes:
  - `POST /marketplace/rfqs` (poster lifecycle checks)
  - `POST /marketplace/rfqs/:rfqId/bids` (poster + bidder lifecycle checks)
  - `POST /marketplace/rfqs/:rfqId/bids/:bidId/counter-offer` (poster + bidder + proposer lifecycle checks)
  - `POST /marketplace/rfqs/:rfqId/accept` (payer + payee + accepted-by lifecycle checks)
- Added lifecycle fail-closed enforcement on marketplace agreement mutation routes:
  - `POST /runs/:runId/agreement/change-order` (payer + payee + requested-by + accepted-by lifecycle checks)
  - `POST /runs/:runId/agreement/cancel` (payer + payee + cancelled-by + accepted-by lifecycle checks)
- Added lifecycle fail-closed enforcement on run settlement/dispute/arbitration mutation routes:
  - `POST /runs/:runId/settlement/resolve` (payer + payee + resolved-by lifecycle checks)
  - `POST /runs/:runId/dispute/open|close|evidence|escalate` (payer + payee + actor lifecycle checks)
  - `POST /runs/:runId/arbitration/open|assign|evidence|verdict|close|appeal` (payer + payee + arbiter lifecycle checks)
- Added lifecycle fail-closed enforcement on tool-call arbitration mutation routes:
  - `POST /tool-calls/arbitration/open` (payer + payee + opened-by + arbiter lifecycle checks)
  - `POST /tool-calls/arbitration/verdict` (payer + payee + arbiter lifecycle checks)
- Added e2e coverage for principal/sub-agent lifecycle blocking on create/accept/settle.
- Added e2e coverage for delegation/authority grant issue blocking when participant lifecycle is non-active.
- Added e2e coverage for task negotiation lifecycle blocking on quote/offer/accept issuance.
- Added e2e coverage for agreement delegation lifecycle blocking on create.
- Added e2e coverage for marketplace lifecycle blocking on RFQ issue, bid issue, counter-offer, and accept.
- Added e2e coverage for marketplace agreement lifecycle blocking on change-order and cancel.
- Added e2e coverage for run settlement/dispute/arbitration lifecycle blocking.
- Added e2e coverage for tool-call arbitration lifecycle blocking on open/verdict.
- Added collaboration gate enforcement checks:
  - `e2e_agent_card_stream_lifecycle`
  - `e2e_task_negotiation_lifecycle_enforcement`
  - `e2e_x402_agent_lifecycle_enforcement`
  - `e2e_x402_quote_lifecycle_enforcement`
  - `e2e_agreement_delegation_lifecycle_enforcement`
  - `e2e_marketplace_lifecycle_enforcement`
  - `e2e_marketplace_agreement_lifecycle_enforcement`
  - `e2e_settlement_dispute_arbitration_lifecycle_enforcement`
  - `e2e_tool_call_arbitration_lifecycle_enforcement`
  - `e2e_grant_issue_lifecycle_enforcement`
7. Chunk H (observability productization): **in progress**.
- Added unified read-only lineage endpoint:
  - `GET /ops/audit/lineage`
  - Deterministic `AuditLineage.v1` payload with stable pagination and `lineageHash`.
  - Cross-family coverage in one query surface: sessions/events, task negotiation objects, work orders/receipts, runs/settlements, arbitration cases, agreement delegations.
- Added MCP audit-lineage primitive and demo-path proof:
  - `nooterra.audit_lineage_list` in MCP server.
  - OpenClaw substrate demo now binds a shared `traceId` across session/negotiation/work-order/settlement and exports lineage in-report.
  - Demo now runs `scripts/ops/verify-audit-lineage.mjs` against exported lineage and fails closed on verification error.
- Added offline verification tooling:
  - Core verifier: `verifyAuditLineageV1` (`src/core/audit-lineage.js`)
  - CLI verifier: `scripts/ops/verify-audit-lineage.mjs`
  - npm wrapper: `npm run -s ops:audit:lineage:verify -- --in <lineage.json>`
- Added fail-closed verification coverage:
  - `test/audit-lineage.test.js`
  - `test/audit-lineage-verify-script.test.js`
- Added trace-filtered deterministic e2e coverage:
  - `test/api-e2e-ops-audit-lineage.test.js`
- Added collaboration gate enforcement check:
  - `e2e_ops_audit_lineage`
  - `e2e_ops_audit_lineage_verify_fail_closed`

5. Distribution surfaces:
- MCP server has substrate tools for authority/session/negotiation/work-orders.
- OpenAPI and SDK touched for new primitives.

## 3) Program Structure (Large Chunks, Not Small Steps)
Execution model for every chunk:
1. Schema/spec first.
2. Store interface + PG implementation parity.
3. API + OpenAPI + SDK + MCP.
4. Determinism/fail-closed tests.
5. Gate integration and artifact output.

Definition of chunk done:
1. Public docs/spec updated.
2. In-memory and PG paths both passing.
3. OpenAPI drift check clean.
4. New checks included in relevant gate level.

---

## Chunk A: Public Discovery Plane + Durable Registry
### Outcome
A true public discovery surface (cross-tenant where allowed), with abuse controls and deterministic ranking.

### Build items
1. Data model hardening
- Add/verify PG tables and indexes for:
  - agent cards
  - capability attestations
  - listing bonds
  - quarantine records
- Confirm store API parity between `src/api/store.js` and `src/db/store-pg.js`.

2. Public discovery API
- Add/finish `GET /public/agent-cards/discover`:
  - only public visibility cards
  - deterministic ordering contract
  - filter support (capability, attestation level, price ceiling, runtime)
- Keep tenant-scoped `GET /agent-cards/discover` behavior unchanged.

3. Abuse resistance
- Enforce listing bond requirement toggle for public listing.
- Add per-agent and per-tenant publish limits.
- Add quarantine gates that remove agents from public discoverability.

4. Deterministic ranking contract
- Stabilize tie-breakers (score, attestation, price, latency hint, agentId).
- Expose routing factors behind explicit opt-in debug flag.

5. Validation and tests
- PG restart durability test for listing/discovery.
- Adversarial tests:
  - spam publish
  - bond bypass attempts
  - quarantined agent visibility checks

### Files likely touched
- `src/api/app.js`
- `src/api/store.js`
- `src/db/store-pg.js`
- `src/core/agent-card.js`
- `src/core/listing-bond.js`
- `test/*discovery*`, `test/*durability*`

---

## Chunk B: Delegation Graph Integrity (Authority + Delegation + WorkOrder)
### Outcome
No task settlement can occur without a valid, non-escalating authority chain.

### Build items
1. Chain monotonicity enforcement
- Verify authority scope >= delegation scope >= work-order scope.
- Enforce max depth across chain refs.
- Enforce validity windows across all linked objects.

2. Scope classes and enforcement
- Risk class controls (`read`, `write`, `side_effecting`, `financial`).
- Provider and tool allowlists on authority grants.
- Currency and spend envelope invariants.

3. Revocation propagation
- If authority is revoked, dependent delegation/work orders fail closed.
- Add clear machine reason codes for each failure mode.

4. Settlement bindings
- Require authority/delegation refs in settlement metadata for high-risk classes.
- Reject mismatched or missing refs at verify/release paths.

5. Validation and tests
- Multi-hop chain tests with valid/invalid permutations.
- Revocation race tests.
- Deterministic reason code assertions.

### Files likely touched
- `src/core/authority-grant.js`
- `src/core/delegation-grant.js`
- `src/core/subagent-work-order.js`
- `src/api/app.js`
- `test/api-e2e-x402-authority-grant.test.js`
- `test/api-e2e-subagent-work-orders.test.js`

---

## Chunk C: Session Provenance + Prompt Contagion Controls
### Outcome
Every high-risk action can be traced to provenance labels and taint state; risky tainted flows are challenged/escalated automatically.

### Build items
1. Taint model
- Add provenance labels to session events:
  - `trusted`
  - `external`
  - `tainted`
- Define deterministic propagation rules on derived events.

2. Policy integration
- If tainted-derived event leads to side-effecting/financial action:
  - force `challenge` minimum
  - force `escalate` above configured thresholds

3. Evidence requirements
- Require extra evidence on tainted-derived settlements.
- Fail closed on missing provenance chain or missing overrides.

4. Replay integrity extensions
- Include provenance transitions in replay pack verification.
- Add replay assertion checks for policy decision consistency.

5. Validation and tests
- Prompt contagion e2e with forced mode assertions.
- Replay pack tamper + taint mismatch tests.

### Files likely touched
- `src/core/session-collab.js`
- `src/core/session-replay-pack.js`
- `src/core/policy-decision.js`
- `src/api/app.js`
- `test/api-e2e-session-events-stream.test.js`
- `test/api-e2e-x402-delegation-grant.test.js`

---

## Chunk D: Tool Descriptor Plane + Capability Ontology
### Outcome
Capability claims become typed, versioned, and attestable against actual tool surfaces.

### Build items
1. Public spec
- Add `ToolDescriptor.v1` spec + JSON schema.
- Add `capability://` namespace/versioning guidance.

2. Registry integration
- Allow agent cards to reference tool descriptors.
- Validate descriptor compatibility with declared capabilities.

3. Discovery filters
- Filter by:
  - tool IDs
  - side-effecting flag
  - attestation minimum
  - pricing units

4. Attestation compatibility
- Require attestation compatibility for high-trust discovery mode.
- Add issuer allowlist filters.

5. Validation and tests
- Schema validation tests.
- Discovery correctness tests with mixed tool descriptors.

### Files likely touched
- `docs/spec/public/*`
- `docs/spec/schemas/*`
- `src/core/capability-attestation.js`
- `src/core/agent-card.js`
- `src/api/app.js`
- `test/*capability*`

---

## Chunk E: Streaming Metering + Progressive Settlement
### Outcome
Long-running tasks and streaming outputs are billed deterministically with bounded exposure.

### Build items
1. `Meter.v1` model
- Usage event envelope with canonical hash and idempotency key.
- Supported units: tokens, seconds, bytes, custom units.

2. Progressive holds
- Initial escrow lock.
- Controlled top-up requests with policy checks.
- Final reconciliation at completion.

3. Split settlement
- Deterministic split contracts:
  - provider payout
  - router fee
  - delegator share

4. Insolvency controls
- Hard stop when envelope exceeded.
- Fail-closed if top-up denied.

5. Validation and tests
- Duplicate usage events do not double-charge.
- Envelope exceed -> challenge/escalate.
- Missing meter evidence -> no release.

### Files likely touched
- `src/core/settlement-kernel.js`
- `src/core/escrow-ledger.js`
- `src/core/settlement-splits.js`
- `src/api/app.js`
- `test/*settlement*`, `test/*meter*`

---

## Chunk F: Relationship + Reputation Flywheel
### Outcome
A portable, signed interaction graph improves routing quality and creates durable platform advantage.

### Build items
1. Publish and stabilize `ReputationEvent.v1`
- Source refs required for economic events.
- Event typing and weighting policy documented.

2. `RelationshipEdge.v1` derived layer
- Pairwise summary metrics:
  - success rate
  - dispute rate
  - total settled volume
  - last interaction

3. Privacy and visibility
- Default private edge visibility.
- Opt-in public summary endpoint.

4. Anti-gaming logic
- Reciprocal micro-transaction dampening.
- Collusion ring detection heuristics.
- Minimum economic-weight thresholds.

5. Export pack
- `VerifiedInteractionGraphPack.v1` signed export.

6. Validation and tests
- Deterministic score computation vectors.
- Collusion simulation tests.

### Files likely touched
- `src/core/agent-reputation.js`
- `src/core/reputation-event.js`
- `src/api/app.js`
- `test/*reputation*`

---

## Chunk G: Governance and Runtime Lifecycle
### Outcome
Open network operation with controlled blast radius and explicit agent lifecycle controls.

### Build items
1. Lifecycle states
- `provisioned`, `active`, `throttled`, `suspended`, `quarantined`, `decommissioned`.
- Enforce lifecycle checks in discovery, delegation, and settlement.

2. Emergency controls
- Deterministic emergency action objects with reason codes.
- Quarantine and kill-switch semantics.

3. Operational policies
- Global and tenant-level policy overlays.
- Priority precedence rules documented and tested.

4. Validation and tests
- Lifecycle transition validity matrix tests.
- Fail-closed tests across all affected endpoints.

### Files likely touched
- `src/core/emergency-controls.js`
- `src/api/app.js`
- `docs/spec/public/*governance*`
- `test/*emergency*`, `test/*lifecycle*`

---

## Chunk H: Observability and Audit Productization
### Outcome
Operators can inspect, trace, and export complete transaction/collaboration evidence with deterministic replay.

### Build items
1. Unified trace IDs
- Ensure trace propagation across sessions, tasks, tools, and settlement.

2. Audit query surface
- Add API endpoints to query full event lineages.

3. Deterministic export bundles
- Standardize replay + evidence export object.
- Include signature and hash index.

4. Dashboard artifacts
- Machine-readable scorecards:
  - reliability
  - dispute rates
  - policy challenges

5. Validation and tests
- Replay consistency tests.
- Export importability tests.

### Files likely touched
- `src/core/event-chain.js`
- `src/api/app.js`
- `scripts/ops/*`
- `docs/ops/*`
- `test/*audit*`, `test/*replay*`

---

## Chunk I: Distribution and Serving (Host-Agnostic First)
### Outcome
ACS is easy to adopt across OpenClaw, Nooterra, Claude Desktop, Cursor, and custom runtimes.

### Build items
1. MCP surface completeness
- Ensure every core ACS object has MCP create/get/list action.
- Add deterministic tool error mapping and docs.

2. SDK completion
- JS/TS SDK parity with all ACS endpoints.
- Python SDK MVP for registry/session/task/settlement paths.

3. Host onboarding packs
- OpenClaw skill quickstart (already strong; keep as first-class).
- Nooterra/Claude/Cursor examples and config templates.

4. Product docs
- "Publish agent"
- "Delegate safely"
- "Settle with proofs"
- "Replay and audit"

5. Validation and tests
- Host certification matrix expansion.
- Multi-host same-flow determinism checks.

### Files likely touched
- `scripts/mcp/nooterra-mcp-server.mjs`
- `packages/api-sdk/src/*`
- `docs/integrations/*`
- `test/mcp-stdio-spike.test.js`

---

## Chunk J: Federation Readiness (Only After Strong Single-Plane Usage)
### Outcome
Multiple registries/control planes interoperate without trust ambiguity.

### Build items
1. Namespace model
- Trust domain prefixes for agent IDs.
- Explicit trust anchors and key sets.

2. Federation object exchange
- Card/attestation/relationship summary exchange contracts.

3. Settlement bridge policy
- Cross-plane settlement acceptance rules.

4. Validation and tests
- Cross-plane trust resolution tests.
- Unknown trust anchor fail-closed tests.

---

## 4) Quality Gates Required Across All Chunks
Every chunk must add or update all of the following:
1. Unit tests for schema and deterministic hashing.
2. API e2e tests for success and fail-closed behavior.
3. PG durability tests where object persistence is involved.
4. OpenAPI generation and drift check.
5. Nooterra Verified gate wiring for new critical checks.

## 5) Immediate Next Execution Queue (Large-Batch)
Run this next, as one sustained implementation program:
1. Chunk E completion: add progressive settlement contracts (top-up envelope + final reconcile fail-closed rules + deterministic split binding).
2. Chunk C closure: complete replay/provenance consistency assertions for taint transitions across session->work-order->settlement.
3. Chunk F completion: publish/export `VerifiedInteractionGraphPack.v1` with anti-gaming heuristics and deterministic scoring vectors.
4. Chunk G kickoff: lifecycle-state enforcement matrix across discover/delegate/settle endpoints.

These four chunks together move ACS from "strong substrate v1" to "long-running open network collaboration fabric".

## 6) Delivery Discipline for Ongoing Work
1. Keep changes chunk-scoped and commit in vertical slices.
2. Never ship a new object without:
- public spec
- schema
- core validator/builder
- API + OpenAPI
- tests
3. Keep fail-closed semantics for missing evidence and chain mismatch.
4. Preserve deterministic outputs for hashes, rankings, and reports.

## 7) Zero-Gap Execution Checklist (Cross-Cutting, Required for Perfection)
These checks apply to every ACS object and endpoint. A chunk is not complete if any item here is missing.

1. Object contract hygiene
- Every object has explicit `schemaVersion`.
- Every object has stable identity fields (`id`/`...Id`) and immutable creation timestamp.
- Hash inputs are canonicalized and documented.
- Non-hashed operational fields are explicitly excluded and listed.
- Object docs include 1 happy-path and 1 fail-closed example payload.

2. Canonicalization determinism
- Canonical JSON serializer is shared and reused.
- Property ordering is deterministic.
- Numeric normalization is deterministic (no locale/string variance).
- Timestamp normalization is strict RFC3339 UTC.
- Hash equality tests include key-order permutations.

3. Idempotency and replay safety
- Mutating endpoints accept idempotency keys where needed.
- Duplicate submissions return deterministic same result shape.
- Event append endpoints reject duplicate and out-of-order chain appends.
- Replay/tamper tests assert explicit machine reason codes.

4. Fail-closed invariants
- Missing evidence returns hard failure, never soft warning.
- Schema mismatch returns hard failure.
- Revoked/expired authority returns hard failure.
- Mismatched hash/ref returns hard failure.
- Unknown policy/risk class returns hard failure.

5. API contract quality
- Input validation errors include stable `code`, `message`, and `details`.
- Pagination has deterministic default sort and stable cursor semantics.
- OpenAPI includes all new endpoints and fields.
- OpenAPI drift check passes before merge.

6. Persistence parity
- In-memory and PG code paths expose identical behavior.
- PG store methods exist for all new objects.
- PG list queries have deterministic order + indexed filters.
- Restart durability tests pass for each new object family.

7. Security and abuse controls
- Public endpoints have explicit rate limits.
- Public publish/list paths enforce anti-spam controls.
- Quarantine state is enforced in discovery and execution paths.
- Secret-bearing fields are excluded from logs and artifacts.

8. Observability and audit
- Trace IDs propagate from API to core actions.
- Audit events emitted for create/update/revoke/settle actions.
- Export bundles include object hashes and verification status.
- Gate scripts emit machine-readable report with explicit `schemaVersion`.

9. Release hardening
- Backward compatibility checks documented for changed contracts.
- Migration rollback path documented for each PG migration.
- Feature flags default to safest behavior.
- New behavior is covered by gate-level checks (collaboration or guardrails).

## 8) Detailed Work Breakdown by Chunk (Granular Implementation Steps)

### Chunk A detailed steps
1. Add or verify PG schema tables for public discovery primitives.
2. Add unique constraints and index strategy for frequent queries.
3. Add store interface methods in `src/api/store.js` for all CRUD/list paths.
4. Add matching PG implementations in `src/db/store-pg.js`.
5. Implement `/public/agent-cards/discover` filters with deterministic ordering.
6. Keep tenant-scoped `/agent-cards/discover` unchanged and covered by regression tests.
7. Add listing bond check to public listing path with explicit reason codes.
8. Add quarantine visibility gate to public discovery path.
9. Add publish rate limiting by tenant and agent identity.
10. Add deterministic ranking tie-break chain and document it in spec.
11. Add PG restart durability test for public listing and discoverability.
12. Add adversarial tests for spam, bond bypass, and quarantined visibility.
13. Wire new discovery checks into collaboration gate report.

### Chunk B detailed steps
1. Normalize authority/delegation/work-order scope comparison logic in one core helper.
2. Enforce chain depth monotonicity with deterministic error codes.
3. Enforce validity-window intersection checks across all chain refs.
4. Enforce risk class constraints (`read`, `write`, `side_effecting`, `financial`).
5. Enforce provider/tool allowlist constraints at authorization and settlement.
6. Enforce spend envelope (`maxPerCall`, `maxTotal`, currency) invariants.
7. Propagate authority revocation to dependent delegation/work orders.
8. Require authority/delegation refs for high-risk settlement classes.
9. Add unit tests for scope monotonicity and envelope violations.
10. Add e2e tests for revoked authority and mismatched reference rejection.
11. Add race tests where revocation happens between authorize and settle.
12. Ensure reason codes are stable and documented in public spec.
13. Wire authority-chain checks into guardrails gate.

### Chunk C detailed steps
1. Extend `SessionEvent.v1` payload with provenance label field.
2. Define deterministic taint propagation rules in core helper.
3. Ensure event append path computes taint state deterministically.
4. Persist provenance/taint in in-memory and PG paths.
5. Update replay-pack verification to include provenance consistency.
6. Integrate taint signals into policy decision engine.
7. Force `challenge` for tainted-derived side-effecting actions.
8. Force `escalate` for tainted-derived financial actions above threshold.
9. Require additional evidence for tainted-derived settlement release.
10. Add explicit override recording model for human-approved tainted flows.
11. Add tests for taint propagation correctness and policy outcomes.
12. Add tamper tests for provenance chain mismatch.
13. Add guardrails gate checks for prompt contagion fail-closed behavior.

### Chunk D detailed steps
1. Publish `ToolDescriptor.v1` spec and JSON schema.
2. Add `ToolDescriptor` validator/builder core utilities.
3. Extend `AgentCard` schema to reference tool descriptor IDs or embedded descriptors.
4. Add capability namespace validation (`capability://` rules).
5. Add registry checks for descriptor-capability compatibility.
6. Add discover filters for tool ID, side-effecting, attestation floor, unit pricing.
7. Add issuer allowlist filter for trusted attestation mode.
8. Add schema test vectors for valid and invalid descriptor shapes.
9. Add API e2e tests for mixed capability/tool-discovery scenarios.
10. Add docs with compatibility examples and fail-closed examples.
11. Update MCP docs for descriptor-aware discovery calls.
12. Wire descriptor integrity checks into collaboration gate.

### Chunk E detailed steps
1. Define `Meter.v1` object and schema for usage units.
2. Add metering ingestion endpoint with idempotency enforcement.
3. Add hash-binding between usage events and task/work-order context.
4. Add progressive hold top-up flow with policy checks.
5. Enforce max envelope and insolvency behavior.
6. Add deterministic split contract representation for payouts and fees.
7. Add settlement reconciliation rules for over/under usage outcomes.
8. Reject duplicate usage events from changing billed totals.
9. Require meter evidence for final release in metered mode.
10. Add unit tests for charge accumulation determinism.
11. Add e2e tests for top-up deny, envelope exceed, and retry idempotency.
12. Add guardrails check ensuring missing meter evidence fails closed.
13. Add collaboration check for successful metered settlement happy path.

### Chunk F detailed steps
1. Publish `ReputationEvent.v1` public spec and schema.
2. Define allowed event kinds and required source references.
3. Implement deterministic weighting model in core reputation engine.
4. Define `RelationshipEdge.v1` derived object contract.
5. Build pairwise aggregation pipeline with deterministic ordering.
6. Add private-by-default relationship visibility policy.
7. Add opt-in public summary endpoint with non-sensitive fields only.
8. Add anti-gaming dampening for low-value reciprocal loops.
9. Add collusion-ring heuristic checks with bounded false positives.
10. Add minimum economic weight thresholds for reputation impact.
11. Implement `VerifiedInteractionGraphPack.v1` export with signatures.
12. Add deterministic vector tests for reputation score stability.
13. Add adversarial simulation tests for gaming/collusion attempts.

### Chunk G detailed steps
1. Define lifecycle state machine contract and valid transitions.
2. Persist lifecycle state for each agent identity.
3. Enforce lifecycle gates in discovery visibility.
4. Enforce lifecycle gates in delegation/work-order creation.
5. Enforce lifecycle gates in authorize/settle flows.
6. Add emergency action object with deterministic reason codes.
7. Add quarantine and kill-switch execution paths.
8. Add global/tenant policy overlay precedence rules.
9. Add tests for transition matrix validity.
10. Add fail-closed tests for disallowed transitions and gated actions.
11. Add operator runbook for emergency procedures.
12. Wire lifecycle checks into guardrails gate.

### Chunk H detailed steps
1. Standardize trace ID propagation contract across all major flows.
2. Add unified audit query endpoint across sessions/tasks/settlements/disputes.
3. Add deterministic export bundle format with hash index.
4. Add signature verification metadata in export output.
5. Add replay import verification script for audit packs.
6. Add reliability/dispute/policy challenge scorecard generator.
7. Add tests for export reproducibility across repeat runs.
8. Add tests for replay verification fail-closed behavior.
9. Add docs for audit operations and incident investigation flow.
10. Wire audit export verification into collaboration gate.

### Chunk I detailed steps
1. Audit MCP surface for full ACS object coverage.
2. Add missing MCP tools for create/get/list/revoke operations.
3. Normalize MCP error mapping to API reason codes.
4. Complete JS/TS SDK method parity for all ACS routes.
5. Add SDK contract tests for request/response shape stability.
6. Add Python SDK MVP for registry/session/task/settlement.
7. Add host integration docs for OpenClaw/Nooterra/Claude/Cursor.
8. Add quickstart flows that include policy-safe defaults.
9. Expand host cert matrix with cross-host same-flow tests.
10. Add collaboration gate checks for host-agnostic path success.

### Chunk J detailed steps
1. Define trust-domain namespace format and parsing rules.
2. Define trust anchor and keyset distribution format.
3. Define federation exchange contracts for cards/attestations/summaries.
4. Define cross-plane settlement eligibility policy.
5. Add verification for unknown or revoked trust anchors.
6. Add cross-plane replay and signature verification tests.
7. Add fail-closed tests for incompatible federation protocol versions.
8. Add federation conformance checks (separate gate profile if needed).

## 9) “Small Things” Perfection Checklist (Do Not Skip)
1. Ensure all new enums are documented in both public spec and OpenAPI.
2. Ensure every new reason code appears in tests and docs.
3. Ensure all list endpoints include deterministic default sort and explicit tie-breaker.
4. Ensure all timestamps in reports and artifacts use UTC ISO format.
5. Ensure all new IDs have normalization and validation rules.
6. Ensure no sensitive fields leak in logs, gate artifacts, or replay packs.
7. Ensure gate scripts return non-zero on any blocking issue.
8. Ensure CI artifact paths are stable and documented.
9. Ensure in-memory and PG behavior snapshots match for same fixtures.
10. Ensure API examples in docs are copy-paste valid.
11. Ensure MCP tool docs match actual input schema exactly.
12. Ensure SDK typings match runtime payloads exactly.
13. Ensure every migration has up/down and rollback notes.
14. Ensure every chunk has at least one adversarial test.
15. Ensure every chunk has at least one determinism repeat-run test.

## 10) Program-Level Exit Criteria (Full Scope Complete)
1. All chunks A-J are implemented with specs, schema, API, SDK/MCP, and tests.
2. Collaboration and guardrails gates cover all critical ACS paths.
3. Public discovery, delegation integrity, taint controls, metering, and relationship graph are in production-ready state.
4. Replay/audit exports verify deterministically and fail closed on tampering.
5. Host-agnostic integrations are documented and passing matrix checks.
6. No unresolved blocking issues in gate reports across two consecutive full runs.
