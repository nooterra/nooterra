# Sprint 22 Plan: Reputation Deltas + Policy Pinning + Replay Tooling

## Summary

Sprint 22 makes Nooterra’s economic kernel *compound* and *portable* by:

- emitting **facts-first, append-only** `ReputationDelta.v1` artifacts on key settlement/dispute lifecycle events,
- introducing **`SettlementDecisionRecord.v2`** so every new decision pins replay-critical policy hashes,
- adding **replay tooling** that deterministically re-evaluates a decision from protocol artifacts,
- tightening dispute open constraints to be **kernel-pure** (auth + time window + single active case).

This sprint does **not** replace existing computed reputation surfaces (AgentReputation v1/v2). It adds the durable raw event stream they can later consume.

## Non-Goals (Explicit)

- No new “trustScore” or scoring algorithm changes.
- No changes to wallet atomicity fundamentals, escrow model, or settlement core accounting rules.
- No appeals/multiple concurrent cases per agreement (still one active case).
- No MCP gateway work (Sprint 23).

## Protocol Changes (Lockstep per `add-protocol-object` + `protocol-invariants`)

### 1) New: `ReputationDelta.v1`

**Intent:** raw facts that accumulate over time; no magic single score.

**Schema target:** `docs/spec/ReputationDelta.v1.md` + versioned JSON schema (`ReputationDelta.v1.schema.json`, added in this sprint).

**Required fields (minimum):**

- `schemaVersion` (const: `ReputationDelta.v1`)
- `deltaId` (deterministic, stable across retries)
- `tenantId`
- `subject`:
  - `agentId` (who this delta accrues to)
  - `role` (e.g. `payer|payee|arbiter|system`)
- `toolRef`:
  - `toolId` (nullable/optional when not applicable)
- `event`:
  - `code` (enum, see emission map below)
  - `version` (integer, start at `1` for forward compatibility)
- `sourceRef`:
  - `kind` (enum: `agreement|receipt|hold|case|verdict|adjustment|settlement`)
  - `refId` (e.g. `agreementHash`, `receiptHash`, `caseId`, `adjustmentId`)
  - `refHash` (sha256 hex where applicable; nullable if kind is only id-based)
- `occurredAt` (ISO string)
- `facts` (object; counts/timing/economics, always raw)

**Deterministic ID pattern (required for idempotency):**

- `deltaId = "repd_" + sha256Hex(JCS({tenantId, subject.agentId, subject.role, toolRef.toolId, event.code, sourceRef.kind, sourceRef.refId, sourceRef.refHash}))`

This avoids exceeding identifier length bounds and prevents duplicates across retries and races.

### 2) New: `SettlementDecisionRecord.v2` (do not mutate `SettlementDecisionRecord.v1`)

**Intent:** keep `v1` stable for historical artifacts, and make `v2` replay-complete.

**Spec + schema:**

- `docs/spec/SettlementDecisionRecord.v2.md`
- `docs/spec/schemas/SettlementDecisionRecord.v2.schema.json`

**Shape:** identical to `v1` *plus only replay-critical fields*:

- `policyHashUsed` (required, sha256 hex)
- `verificationMethodHashUsed` (optional, sha256 hex)

**Semantics:**

- `policyHashUsed` is the hash of the **normalized policy actually evaluated**, not just a pointer to some registry row.
- If policy is inline: treat it as `policyRef.source = "inline:v1"` and compute `policyHashUsed` from the normalized inline policy payload.
- If policy comes from tenant registry: `policyHashUsed` must match the registry’s policy payload hash.

**Backcompat contract:**

- Server emits `SettlementDecisionRecord.v2` by default for new decisions.
- Server continues to parse and verify `SettlementDecisionRecord.v1` for older settlements.

### 3) Protocol vectors + freeze

Update lockstep artifacts:

- Add at least one `SettlementDecisionRecord.v1` vector and one `SettlementDecisionRecord.v2` vector.
- Add at least one `ReputationDelta.v1` vector (schema validation + hashing determinism).
- Regenerate:
  - `node scripts/spec/generate-protocol-vectors.mjs > test/fixtures/protocol-vectors/v1.json`
  - update `test/fixtures/protocol-v1-freeze.json` as required

Acceptance gate: `npm test` passes (vectors + schema tests).

## Kernel / Server Implementation

### 1) Policy resolution helper (single source of truth)

Add a helper in core (preferred: `src/core/settlement-policy.js` or new `src/core/policy-resolution.js`):

`resolvePolicyForDecision({ agreement, tenantId, store, at }) -> { policyRef, policyHashUsed, policy, verificationMethodHashUsed, verificationMethod }`

Rules:

- Always returns a **normalized policy object** suitable for hashing (JCS).
- If `agreement` carries inline terms: normalize into a stable policy object and set `policyRef.source = "inline:v1"`.
- If `agreement.policyRef.source === "tenant_registry"`: fetch policy payload and verification method payload from store, validate hashes.
- Always compute and return `policyHashUsed`. Return `verificationMethodHashUsed` when a verification method is present/meaningful.

### 2) Decision record emission

Update decision building to emit v2 by default:

- Add builders + validators:
  - `buildSettlementDecisionRecordV2(...)`
  - `validateSettlementDecisionRecordV2(...)`
- Extend kernel verification:
  - `verifySettlementKernelArtifacts(...)` accepts both v1 and v2 decision records.
  - Hashing rules remain: decision hash computed after removing `decisionHash`.

**Where to wire:**

- The settlement decision trace emission site in `src/api/app.js` (currently calls `buildSettlementDecisionRecord(...)`).
- Any manual resolution paths that create decision records.

Acceptance criteria:

- New settlements return `decisionRecord.schemaVersion === "SettlementDecisionRecord.v2"`.
- Historical v1 artifacts still verify successfully.

### 3) Replay endpoint + CLI

Add an ops-only replay surface:

- `POST /ops/replay/settlement-decision` (requires `ops_read` or `ops_write`)
  - body: `{ agreementHash }`
  - loads: agreement, evidence, settlement, decision record, policy material
  - runs: `resolvePolicyForDecision(...)` + evaluation
  - returns: `{ ok: true, agreementHash, replay: { decision, reasonCodes, evaluationSummary, policyHashUsed, verificationMethodHashUsed }, stored: { ... }, match: { ok, diffs } }`

Add a small CLI wrapper:

- `node scripts/ops/replay-settlement-decision.mjs --agreement-hash ...`

Acceptance criteria:

- For a v2 decision, replay produces identical:
  - `decisionStatus`, `decisionMode`, `reasonCodes`, and `policyHashUsed` (and verifier selection where applicable).
- Endpoint reports mismatch with structured diffs (no silent pass).

## ReputationDelta Emission (Facts-First)

### Emission map (minimum set)

Emit deltas exactly-once (idempotent) on:

- `settlement.decision_approved`
- `settlement.decision_rejected`
- `holdback.auto_released` (challenge window elapsed -> release)
- `dispute.opened`
- `dispute.verdict_issued.payer_win`
- `dispute.verdict_issued.payee_win`
- `dispute.verdict_issued.partial` (if/when allowed for non-tool-call disputes)
- `adjustment.applied`

### Subjects per event

For each event, emit deltas for:

- payee agent (`role: payee`)
- payer agent (`role: payer`)

and for verdict issuance:

- optionally arbiter agent (`role: arbiter`) with facts about timeliness/volume only (no money attribution).

### Storage

Persist each delta as:

1) a protocol artifact (append-only), and
2) an indexed record for query (SQL table or store index).

Minimum indexed columns:

- `tenantId`, `deltaId` (unique)
- `agentId`, `role`
- `toolId` (nullable)
- `eventCode`
- `occurredAt` (timestamp)
- `sourceKind`, `sourceRefId`, `sourceRefHash`
- `facts` (JSONB)

### Query API (internal-first)

Add ops API:

- `GET /ops/reputation/facts`
  - query: `agentId` (required), `toolId` (optional), `window=7d|30d|allTime` (required)
  - response: aggregated facts:
    - counts: successes, failures, disputesOpened, verdicts, adjustments
    - timing: p50/p95 latencyMs (where known), decision-to-release durations (where known)
    - economics: amountSettled, amountRefunded, amountHeldReleased, amountHeldRefunded
    - rates: disputeRate, slaBreachRate (if SLA signal exists)

Acceptance criteria:

- Aggregations are deterministic for a fixed delta set.
- Window boundaries are explicit and based on `occurredAt`.

## Dispute Tightening (Kernel-Pure Constraints)

### 1) Authorization and signatures for opening

Update tool-call dispute open so the opener must prove they are a party:

- Require a signed open request (payer/payee agent key) unless `adminOverride.enabled === true`.
- Verify signature against `openedByAgentId` agent identity keys in store.
- Record the signer key id and signature material (either in case metadata or as a separate open-request artifact).

Acceptance criteria:

- Unsigned party open fails with a stable error code.
- Signed non-party open fails with a stable error code.
- Admin override remains possible with `ops_write` only and requires `reason`.

### 2) Challenge window enforcement

Already enforced for tool-call holds; keep as invariant:

- If `now > hold.createdAt + hold.challengeWindowMs`, open is rejected unless admin override.

### 3) One active case per agreementHash

For tool-call disputes this remains enforced by deterministic `caseId = arb_case_tc_${agreementHash}`.

For any future non-tool-call disputes, enforce uniqueness at the store/index layer:

- uniqueness on `(tenantId, disputeSubjectKey, status != closed)`

## Test Plan

### Protocol conformance

- Schema tests validate `SettlementDecisionRecord.v2` and `ReputationDelta.v1`.
- Protocol vectors include:
  - one v1 decision record
  - one v2 decision record with `policyHashUsed`
  - one reputation delta

### E2E

1) Create a settlement that emits `SettlementDecisionRecord.v2`, then replay:
- replay endpoint returns match `ok: true`

2) Dispute + verdict path emits deltas:
- open dispute -> `dispute.opened` delta exists for payer and payee
- verdict -> `dispute.verdict_issued.*` delta exists
- adjustment applied -> `adjustment.applied` delta exists

3) Dispute open constraints:
- late open after challenge window fails (no override)
- open with invalid signature fails

## Rollout / Ops

- Emit v2 by default; keep v1 verification for existing stored artifacts.
- Add logs/metrics:
  - replay mismatches (should be 0)
  - disputes open rate spikes
  - holds blocked by disputes beyond threshold
