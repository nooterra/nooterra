# Nooterra Vision Architecture: Self-Improving Agent Platform

## The Thesis

Nooterra's defensible moat is trust infrastructure — approval engine, audit trails, delegation with attenuation, fail-closed defaults. The vision: build intelligence ON TOP of the trust layer. The charter stops being something a human writes — it becomes a living document that agents evolve within trust boundaries.

---

## Build Order

The 5 pillars have clear dependencies. Build in this sequence:

```
Phase A: Closed-Loop Learning (foundation — signals + feedback)
     ↓
Phase B: Deep World Models + Verification (semantic upgrade)
     ↓
Phase C: Agent-to-Agent Negotiation (multi-agent coordination)
     ↓
Phase D: The Meta-Agent (autonomous orchestration)
```

**Why this order:**
- Learning requires only run receipts + approvals (already exist)
- World models require learning signals to evolve (Phase A output)
- Verification requires world models to define "business outcome" (Phase B output)
- Negotiation requires competence scores from verified runs (Phase B+C output)
- Meta-agent requires all 4 pillars to be useful (orchestrates everything)

---

## Phase A: Closed-Loop Learning (~3 weeks)

### What Exists
- Run receipts at `~/.nooterra/runs/{taskId}.json` (write-only, nobody reads them)
- Worker memory at `~/.nooterra/memory/{workerId}.json` (flat key-value, no learning)
- Approval records at `~/.nooterra/approvals/{id}.json` with primitive auto-approve (3 identical approvals in 24h)
- Charter with flat `canDo/askFirst/neverDo` string arrays

### What to Build

**4 new modules in `scripts/worker-builder/`:**

1. **`learning-signal-collector.mjs`** — Post-run signal extraction
   - Emits `LearningSignal.v1` per tool call: toolName, charterVerdict, executionOutcome, approvalDecision
   - JSONL append to `~/.nooterra/learning/{workerId}/signals.jsonl`
   - Hooks into `worker-daemon.mjs` after `recordWorkerRun()` and `approval-engine.mjs` after `persistApproval()`

2. **`learning-analyzer.mjs`** — Read-only analysis engine
   - Reads signal ledger, groups by toolName+argsHash
   - Produces `LearningReport.v1` with promotion candidates (askFirst→canDo), demotion candidates (canDo→askFirst), failure insights
   - Confidence scoring: `approvalRate × volume × argDiversity` must exceed 0.75
   - Analysis window: 7 days, configurable per worker

3. **`charter-learning.mjs`** — Charter mutation with full audit trail
   - `proposeCharterDiff()` → writes pending diff to `~/.nooterra/learning/{workerId}/charter-diffs.jsonl`
   - `commitDiff()` → applies changes, writes before/after snapshots
   - **Safety invariants:** neverDo is immutable from learning path; auto-commit requires explicit opt-in + cooldown (24h between auto-commits)
   - Charter mutations are between runs, never mid-execution

4. **`learning-engine.mjs`** — Orchestration facade
   - `runLearningCycle(workerId)` → collect → analyze → propose/commit
   - Runs every 6 hours in daemon tick

**Modifications to existing modules:**
- `worker-daemon.mjs`: call `collectFromReceipt` post-run, inject learning hints into system prompt
- `approval-engine.mjs`: emit signals on approval resolution
- `worker-memory.mjs`: add `__learning__` namespace with `setLearningHint()` method
- `worker-persistence.mjs`: add `learningConfig` to worker schema

### Key Design Decision
The system NEVER auto-promotes during a live execution. Learning happens post-run on a separate cadence. The existing `shouldAutoApprove` (session-level) stays independent from charter promotion (permanent). This preserves fail-closed.

---

## Phase B: Deep World Models + Verification (~4 weeks)

### World Models

**Problem:** `classifyToolCall()` uses string matching. `"Send emails"` in canDo matches `send_email({to: "all-company@"})`. Rules have no semantics.

**Solution:** Extend charters with a linked semantic layer — entity registry, invariant set, causal index. Don't replace charter strings; add a world model that enables predicate-based classification.

**6 new modules:**

1. **`world-model-predicates.mjs`** — Pure predicate evaluator (no LLM calls, deterministic)
   - Predicates: `IN_SET`, `NOT_IN_SET`, `LESS_THAN`, `NOT_MATCHES_PATTERN`, `MATCHES_PATTERN`, `COMPOSITE_AND/OR`
   - `evaluatePredicate(predicate, toolArgs)` → `{ passed, reason }`

2. **`world-model-store.mjs`** — Storage at `~/.nooterra/workers/{workerId}/world-model.json`
   - Schema: `WorldModel.v1` with `entities[]`, `invariants[]`, `causalIndex`, `domainKnowledge`
   - Each invariant: `{ appliesTo: [toolNames], argPath, predicate, predicateArgs, violationCategory }`

3. **`world-model-builder.mjs`** — Construction from 3 sources
   - Charter bootstrap: `capability: "email"` → auto-generates `inv_no_bulk_email`
   - Execution history: learns arg patterns from successful runs
   - Manual: CLI command `nooterra world-model add-invariant`

4. **`world-model-classifier.mjs`** — Drop-in upgrade for `classifyToolCall()`
   - Evaluate invariants first → charter string matching as fallback
   - `send_email({to: "all-company@"})` now triggers `inv_no_bulk_email` → neverDo
   - Workers without world models: zero behavioral change (full backward compatibility)

5. **`world-model-composer.mjs`** — Cross-worker composition for delegation
   - Child inherits all parent invariants, can only add stricter ones
   - Mirrors existing `attenuateConstraints()` pattern

### Verification

**Problem:** `receipt.success = blockedActions.length === 0 && approvalsPending.length === 0`. A worker that sends 500 wrong emails is "success: true". No concept of business outcome.

**Solution:** Charter gains a `verificationPlan` with typed assertions checked post-execution.

6. **`verification-engine.mjs`** — Post-run verification
   - Assertion types:
     - `execution_metric`: toolCallCount > 0, duration < threshold
     - `response_content`: final response NOT matches "I was unable to"
     - `tool_call_required`: `github_create_issue` called at least once
     - `external_probe`: hit Stripe API to confirm charge actually settled
   - Produces `VerificationReport.v1` with `businessOutcome: passed|failed|partial`
   - Overrides `receipt.success` with actual business outcome
   - Feeds back into world model: 3 consecutive failures → escalate to askFirst

**Integration with existing systems:**
- Verification reports map to `EvidenceManifestV1` in agentverse (tamper-evident audit)
- Auto-approve in approval-engine gains Policy 3: invariant veto (prevents "email to sarah approved → email to everyone auto-approved")

---

## Phase C: Agent-to-Agent Negotiation (~4 weeks)

### What Exists
- Worker delegation with trust attenuation (`worker-delegation.mjs`)
- Execution lanes with DAG dependencies (`execution-lanes.mjs`)
- Marketplace kernel with RFQ/bid/accept protocol (`src/core/marketplace-kernel.js`)
- Intent negotiation state machine (`src/core/intent-negotiation.js`)
- Agent reputation with trustScore 0-100 (`src/core/agent-reputation.js`)
- Delegation grants with hash chains (`src/core/delegation-grant.js`)

### What to Build

**3 new core schemas:**

1. **`src/core/task-rfq.js`** — `TaskRFQ.v1`: taskPayload, requiredCapabilities, constraints (maxCost, neverDo propagated), biddingDeadlineMs, selectionStrategy
2. **`src/core/task-bid.js`** — `TaskBid.v1`: estimatedCost, estimatedDuration, competenceScore, taskTypeSuccessRate, optional coalitionProposal
3. **`src/core/coalition-record.js`** — `CoalitionRecord.v1`: leadWorker, members, subtaskAssignments, delegationGrantIds, status lifecycle

**3 new worker-builder modules:**

4. **`competence-index.mjs`** — Maps `workerId → taskType → CompetenceEntry`
   - Updated after every run with success/failure, duration, cost
   - Persisted to `~/.nooterra/competence-index.json`
   - `rankWorkersForTask()` sorts by 30-day success rate

5. **`task-marketplace.mjs`** — Central broker
   - `postRFQ()` → broadcast to eligible workers → collect bids → score → award
   - Scoring: `competence*0.5 + (1-normalizedCost)*0.3 + (1-normalizedEta)*0.2`
   - `awardBid()` issues `DelegationGrant.v1` from originator to winner
   - Coalition: subtask RFQs posted in parallel, assembled into `CoalitionRecord`

6. **`negotiation-protocol.mjs`** — Thin adapter over `intent-negotiation.js`
   - Maps TaskBid to IntentNegotiationEvent (propose/counter/accept)

**Modifications:**
- `worker-delegation.mjs`: add `marketplace` option; upgrade `createGrant()` to produce `DelegationGrant.v1`; `MAX_DELEGATION_DEPTH` read from grant chain
- `worker-daemon.mjs`: call `competenceIndex.updateCompetence()` after each run

### Trust in Negotiated Relationships
The marketplace attenuates on behalf of the delegating worker. Worker A (budget: $50) posts RFQ with maxCost: $30. Winner gets a `DelegationGrant.v1` child of A's grant, budget: $30. Coalition members each get a budget slice. All grants are hash-chained to the root.

### Coalition Lifecycle
Formation → active (LaneManager runs subtasks) → dissolution (all complete or failure). Dissolution revokes all member grants.

---

## Phase D: The Meta-Agent (~3 weeks)

### Architecture
The meta-agent is a privileged worker running in the existing daemon with an enhanced tool set. Not a new runtime.

### The Recursive Trust Solution
The human issues ONE root `DelegationGrant.v1` to the meta-agent with: budget, max workers, allowed capabilities, risk class ceiling. The meta-agent can only issue child grants that attenuate this root. Revoking the root kills all authority the meta-agent ever issued.

### Bootstrap Charter
```
role: "meta"
canDo: create workers, deploy, pause, modify canDo rules, read observations, emit alerts
askFirst: modify neverDo rules, delete workers, increase budgets, add capabilities
neverDo: modify own neverDo, modify own budget, exceed own risk class
```

The meta-agent's neverDo is enforced in code (`META_AGENT_SELF_MODIFICATION_DENIED`), not just charter rules.

### 3 New Modules

1. **`meta-agent-core.mjs`** — Tool implementations
   - `__create_worker(description, taskType, constraints)` → calls `buildCharterFromDescription()` bypassing conversation UI
   - `__deploy_worker`, `__pause_worker`, `__modify_worker_charter` (with mutation enforcement)
   - `__read_worker_observations`, `__read_worker_stats`, `__emit_alert`, `__read_competence_index`
   - Every mutation writes to `charterMutationLog[]` on the worker record

2. **`meta-agent-monitor.mjs`** — Polling loop (60s)
   - Collects per-worker: successRate7d, errorRate7d, budgetUtilization, anomalyFlags
   - Anomaly detection (deterministic, no LLM): degraded performance, budget warning, stalled, charter violations
   - Emits `meta_agent:monitor_tick` trigger with MonitorDigest payload

3. **`meta-agent-bootstrap.mjs`** — One-time human entry point
   - Input: business description, total budget, allowed capabilities, max workers
   - Creates root DelegationGrant, compiles bootstrap charter, saves meta-agent worker
   - Returns workerId + rootGrantId for human to store

### How the Meta-Agent Works
```
[Monitor tick fires every 60s]
  → MonitorDigest: { workers: [{ id, successRate, anomalyFlags }] }
  → Meta-agent LLM wakes with digest as input
  → LLM decides: modify charter? pause worker? create replacement? alert human?
  → Calls __modify_worker_charter → tool validates against grant constraints
  → If askFirst action → approval-engine fires to human
  → charterMutationLog entry written for audit
```

---

## Timeline Summary

| Phase | Duration | Prereqs | Ships What |
|-------|----------|---------|------------|
| A: Closed-Loop Learning | 3 weeks | None | Workers auto-refine charters from approval patterns |
| B: World Models + Verification | 4 weeks | Phase A | Semantic action classification + business outcome checking |
| C: Agent Negotiation | 4 weeks | Phase B | Workers bid on tasks, form coalitions by competence |
| D: Meta-Agent | 3 weeks | Phase A-C | Autonomous worker fleet management |
| **Total** | **~14 weeks** | | **Self-improving, self-organizing agent platform** |

---

## What Ships First to Be Useful Immediately

**Phase A alone is a product differentiator.** After 3 weeks:
- Workers automatically learn which actions are safe (approval patterns → charter promotion)
- Failed tool calls generate execution hints for the next run
- Charter diffs with full audit trail (before/after snapshots)
- Human can review and approve/reject proposed charter changes
- Or opt into auto-commit for trusted workers

This is useful from day 1 of deployment. Every worker gets smarter with every run. No other agent platform does this with action-layer enforcement.

---

## Trust Invariants Preserved Throughout

Every phase maintains these invariants:

1. **neverDo is immutable from autonomous paths** — only humans can modify neverDo rules
2. **Fail-closed default** — unknown actions default to askFirst, unknown tools default to askFirst
3. **Audit trail** — every charter mutation, delegation grant, verification report, and learning signal is persisted with content hashes
4. **Grant chain integrity** — all authority traces back to a human-issued root grant via hash chains
5. **No mid-execution mutation** — learning and charter changes happen between runs, never during
6. **Attenuation only narrows** — child workers can only have stricter constraints than parents
