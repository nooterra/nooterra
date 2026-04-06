# Sprint 2: From Prediction to Control System

## The Conceptual Shift

Nooterra is not a prediction system. It is a constrained causal decision process.

A company is a partially observed, stochastic, constrained control system.
The planner does not ask "what is likely next?"
It asks "what action sequence maximizes long-term objective value under uncertainty and constraints?"

This sprint transforms the system from a predictive state model into an intervention-aware decision system by fixing the four broken loops and introducing the missing models.

## The Five Coupled Models

```
World Model          → what exists and what changed
Causal Intervention  → what happens if we do X instead of Y
Policy Model         → what is allowed, forbidden, reversible, expensive
Operator Model       → what the AI is capable of doing safely right now
Objective Model      → what the company is actually trying to optimize
```

---

## Task 1: Action Ontology — Actions as First-Class Causal Objects

### The Problem
Actions are currently tool calls with string parameters. The system has no structured understanding of what an action does, what it costs, what it risks, or what it affects.

### What to Build

**New file: `src/core/action-types.ts`**

```typescript
interface ActionType {
  id: string;                        // e.g. 'communicate.collection_email'
  name: string;
  domain: string;                    // 'finance', 'support', 'sales'

  // Preconditions: what must be true for this action to be valid
  preconditions: ActionPredicate[];

  // Expected effects: what this action typically causes
  expectedEffects: ActionEffect[];

  // Side-effect surface: what systems/domains this action touches
  sideEffectSurface: SideEffectProfile;

  // Reversibility
  reversibility: 'full' | 'partial' | 'none';
  compensatingAction?: string;       // action type ID that reverses this
  reversibilityWindow?: number;      // milliseconds

  // Risk profile
  blastRadius: 'low' | 'medium' | 'high';
  incidentClasses: IncidentClass[];  // what can go wrong

  // Observability
  outcomeDelay: number;              // ms until we know if it worked
  outcomeSignals: string[];          // what events indicate success/failure

  // Cost
  estimatedCostCents: number;        // direct cost (LLM tokens, API calls)
  humanReviewCostMinutes: number;    // if it requires approval
}

interface ActionEffect {
  field: string;                     // e.g. 'paymentProbability7d'
  direction: 'increase' | 'decrease' | 'unknown';
  magnitude: 'small' | 'medium' | 'large';
  confidence: number;                // how sure are we about this effect
  conditions?: ActionPredicate[];    // when does this effect apply
}

interface SideEffectProfile {
  externalCommunication: boolean;    // sends message to customer
  financialMovement: boolean;        // moves money
  stateModification: boolean;        // changes a record
  complianceExposure: boolean;       // could trigger compliance review
  reputationRisk: boolean;           // could damage relationship
  crossSystemPropagation: string[];  // which other systems are affected
}

interface IncidentClass {
  type: 'customer_complaint' | 'policy_violation' | 'financial_loss'
      | 'relationship_damage' | 'compliance_breach' | 'data_error';
  probability: number;               // base rate from historical data
  severity: 'minor' | 'moderate' | 'critical';
}

interface ActionPredicate {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'not_in'
          | 'exists' | 'not_exists' | 'within_days';
  value: unknown;
  source: 'object_state' | 'estimated' | 'relationship' | 'event_history'
        | 'policy' | 'temporal';
}
```

**New file: `src/core/action-registry.ts`**

Register the initial AR action types:

```typescript
const ACTION_TYPES: ActionType[] = [
  {
    id: 'communicate.soft_reminder',
    name: 'Soft collection reminder',
    domain: 'finance',
    preconditions: [
      { field: 'status', operator: 'in', value: ['sent', 'overdue'], source: 'object_state' },
      { field: 'lastContactDaysAgo', operator: 'gt', value: 2, source: 'estimated' },
      { field: 'disputeRisk', operator: 'lt', value: 0.5, source: 'estimated' },
      // Temporal constraint: no outreach within 48h of support escalation
      { field: 'lastSupportEscalation', operator: 'within_days', value: -2, source: 'event_history' },
    ],
    expectedEffects: [
      { field: 'paymentProbability7d', direction: 'increase', magnitude: 'small', confidence: 0.6 },
      { field: 'urgency', direction: 'decrease', magnitude: 'small', confidence: 0.5 },
    ],
    sideEffectSurface: {
      externalCommunication: true,
      financialMovement: false,
      stateModification: true,
      complianceExposure: false,
      reputationRisk: true,  // could annoy customer
      crossSystemPropagation: ['email', 'crm'],
    },
    reversibility: 'none',  // can't unsend an email
    blastRadius: 'medium',
    incidentClasses: [
      { type: 'customer_complaint', probability: 0.05, severity: 'moderate' },
      { type: 'relationship_damage', probability: 0.03, severity: 'moderate' },
    ],
    outcomeDelay: 7 * 86400000,  // 7 days to know if payment arrived
    outcomeSignals: ['financial.payment.received', 'financial.invoice.paid'],
    estimatedCostCents: 5,
    humanReviewCostMinutes: 2,
  },
  // ... firm_reminder, payment_plan_offer, escalation_notice, issue_refund, issue_credit
];
```

**Modify: `src/gateway/gateway.ts`**

The gateway should validate actions against their ActionType:
- Check all preconditions against current object state
- Evaluate side-effect surface to determine escrow level
- Record the action's expected effects for later comparison with actual outcomes
- Wire blast radius into the escrow decision

### Files to Create/Modify
- `src/core/action-types.ts` (new)
- `src/core/action-registry.ts` (new, 6 AR action types)
- `src/gateway/gateway.ts` (modify: validate preconditions, use side-effect profile)

### Acceptance
- Action types are queryable from the registry
- Gateway rejects actions whose preconditions are not met
- Temporal constraints (e.g., "no outreach within 48h of support escalation") are enforced
- Expected effects are logged alongside action execution for later comparison

---

## Task 2: Fix the Action Gateway — All 11 Steps Real

### The Problem
The gateway claims 11 safety steps. Steps 1 (auth), 2 (authorize), and 9 (execute) are real. The rest are stubs.

### What to Build

For each step, what "real" means:

**Step 3: Validate** — Check action parameters against ActionType schema. Reject if counterparty is on neverDo list. Validate value limits.

**Step 4: Rate Limit** — Per-agent, per-action-class, per-tenant rate limiting. Use Redis or in-memory sliding window. Configurable per ActionType (default: 10/hour for communication, 100/hour for data reads).

**Step 5: Budget Check** — Atomic decrement from tenant budget. Track spend per action class. Reject if budget exceeded. (DB table: `world_action_budgets`)

**Step 6: Disclosure** — For any action where `sideEffectSurface.externalCommunication === true`, inject disclosure text. Configurable per tenant. Default: "This message was composed with AI assistance."

**Step 7: Simulate** — Call `estimateIntervention()` on the ML sidecar. If predicted negative effect (e.g., dispute risk increases), escalate escrow level. Log simulation result in evidence bundle.

**Step 8: Escrow Decision** — Use the action's `blastRadius`, `reversibility`, and current autonomy level to decide:
  - Low blast + reversible + autonomous trust → execute immediately
  - Medium blast OR irreversible → hold for review
  - High blast → hold + notify human immediately
  - Any action where `sideEffectSurface.complianceExposure === true` → always require approval

**Step 10: Audit** — Write a complete evidence bundle to the event ledger. Must include: action type, preconditions evaluated, simulation result, escrow decision, approval (if any), execution result, expected effects (for later comparison).

**Step 11: Notify** — After execution, trigger: state estimator re-run on affected objects, drift monitor update, coverage map update.

### New DB table: `world_action_budgets`
```sql
CREATE TABLE world_action_budgets (
  tenant_id TEXT NOT NULL,
  action_class TEXT NOT NULL,
  period TEXT NOT NULL,           -- 'hourly', 'daily', 'monthly'
  budget_cents INTEGER NOT NULL,
  spent_cents INTEGER NOT NULL DEFAULT 0,
  period_start TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, action_class, period, period_start)
);
```

### Files to Create/Modify
- `src/gateway/gateway.ts` (major rewrite)
- `src/gateway/rate-limiter.ts` (new)
- `src/gateway/budget.ts` (new)
- `src/gateway/disclosure.ts` (new)
- `src/gateway/escrow.ts` (new, uses ActionType side-effect profile)
- `src/gateway/simulate.ts` (new, calls ML sidecar)
- `src/db/migrations/065_action_budgets.sql` (new)

### Acceptance
- All 11 steps execute in order with real logic
- Rate limiting rejects the 11th action in a 10/hour window
- Budget check atomically decrements and rejects when exceeded
- Disclosure text is appended to any external communication
- Simulation calls sidecar and escalates escrow on negative prediction
- Evidence bundle contains every step's result
- Integration test: submit an action, verify all 11 steps fired

---

## Task 3: Autonomy Enforcement — Close the Trust Loop

### The Problem
Coverage map computes promotion/demotion scores. Nothing applies them. An agent can't actually earn trust or get demoted because the enforcement logic doesn't trigger.

### What to Build

**New file: `src/eval/autonomy-enforcer.ts`**

```typescript
interface AutonomyEnforcer {
  // Called after every action execution
  onActionComplete(
    agentId: string,
    actionClass: string,
    objectType: string,
    tenantId: string,
    grade: ExecutionGrade,
  ): Promise<AutonomyDecision>;

  // Called when an incident is detected
  onIncident(
    agentId: string,
    actionClass: string,
    objectType: string,
    tenantId: string,
    severity: 'minor' | 'moderate' | 'critical',
  ): Promise<AutonomyDecision>;

  // Check current autonomy level for a proposed action
  getAutonomyLevel(
    agentId: string,
    actionClass: string,
    objectType: string,
    tenantId: string,
  ): AutonomyLevel;
}

interface AutonomyDecision {
  action: 'no_change' | 'promote' | 'demote' | 'suspend';
  fromLevel: AutonomyLevel;
  toLevel: AutonomyLevel;
  reason: string;
  evidence: CoverageCell;
}
```

**Key behaviors:**

1. **Demotion is immediate.** A single moderate/critical incident → demote to `human_approval`. Suspend all autonomous actions for that action class for that tenant. Notify operator with evidence bundle.

2. **Promotion is proposed, not automatic.** When thresholds are met (20 executions, 85%+ procedural, 75%+ outcome, <=1 minor incident in 30 days), generate an `AuthorityProposal`. The operator must approve promotion. The system never self-promotes.

3. **Abstention.** If the operator model's uncertainty is too high (prediction confidence below threshold, drift detected, or OOD flagged), the system refuses to act autonomously even at the Autonomous trust level. It falls back to `human_approval` for that specific action. This is selective abstention.

**Persist coverage map to database:**

```sql
CREATE TABLE world_autonomy_coverage (
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  action_class TEXT NOT NULL,
  object_type TEXT NOT NULL,
  total_executions INTEGER NOT NULL DEFAULT 0,
  successful_executions INTEGER NOT NULL DEFAULT 0,
  avg_procedural_score REAL NOT NULL DEFAULT 0,
  avg_outcome_score REAL NOT NULL DEFAULT 0,
  incident_count INTEGER NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  current_level TEXT NOT NULL DEFAULT 'human_approval',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, agent_id, action_class, object_type)
);

CREATE TABLE world_autonomy_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  action_class TEXT NOT NULL,
  object_type TEXT NOT NULL,
  decision TEXT NOT NULL,  -- 'promote', 'demote', 'suspend', 'abstain'
  from_level TEXT NOT NULL,
  to_level TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence JSONB NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by TEXT,        -- NULL if auto-demotion, user ID if promotion
  approved_at TIMESTAMPTZ
);
```

### Files to Create/Modify
- `src/eval/autonomy-enforcer.ts` (new)
- `src/eval/coverage.ts` (modify: add DB persistence, load on startup)
- `src/gateway/gateway.ts` (modify: check autonomy level before escrow decision)
- `src/bridge.ts` (modify: call enforcer.onActionComplete after every execution)
- `src/db/migrations/066_autonomy_coverage.sql` (new)

### Acceptance
- Coverage map persists to DB and survives service restart
- A critical incident triggers immediate demotion with notification
- Promotion proposals are generated when thresholds are met
- The gateway checks autonomy level and falls back to human_approval when abstaining
- Abstention triggers when drift is detected or OOD is flagged
- Integration test: execute 20 actions, verify promotion proposal generated

---

## Task 4: Close the Feedback Loop — Wire Bridge to Execution Loop

### The Problem
`bridge.onExecutionComplete()` exists but isn't called from the main execution loop. Actions happen, outcomes arrive, but the system doesn't learn.

### What to Build

**Modify: `services/runtime/execution-loop.ts`**

After every worker execution:
1. Call `bridge.onExecutionComplete()` with the execution trace
2. Bridge writes events to ledger
3. Bridge calls `processEvents()` to re-estimate affected objects
4. Bridge calls `autonomyEnforcer.onActionComplete()` to update trust
5. If outcomes are available (payment received, dispute opened), call `recordObjectOutcome()` to update calibration

**New: Outcome watcher**

Not all outcomes are immediate. A collection email sent today may result in payment next week. We need a background process that:

1. Queries actions with `outcomeDelay` that have passed
2. Checks for outcome signals (e.g., `financial.payment.received` events) on the affected objects
3. Records outcomes for calibration
4. Compares actual effects to expected effects (from the action's ActionType)
5. Feeds the delta into the intervention model

**New file: `src/eval/outcome-watcher.ts`**

```typescript
interface OutcomeWatcher {
  // Check for outcomes on actions whose outcome delay has passed
  checkPendingOutcomes(pool: pg.Pool, tenantId: string): Promise<{
    resolved: number;
    pending: number;
    outcomes: OutcomeResult[];
  }>;
}

interface OutcomeResult {
  actionId: string;
  actionClass: string;
  objectId: string;
  expectedEffects: ActionEffect[];
  actualEffects: { field: string; beforeValue: number; afterValue: number }[];
  match: boolean;  // did expected match actual?
}
```

This is the key missing piece. The system currently records that an action happened and that an outcome happened, but it never asks "did the action CAUSE the outcome? Was our prediction of the action's effect correct?"

### Files to Create/Modify
- `services/runtime/execution-loop.ts` (modify: wire bridge call)
- `src/bridge.ts` (modify: call autonomy enforcer, propagate outcomes)
- `src/eval/outcome-watcher.ts` (new)
- `src/eval/effect-tracker.ts` (new: compare expected vs actual effects)

### Acceptance
- Every action execution triggers the full feedback chain
- Outcomes are recorded when they arrive (even days later)
- Expected effects are compared to actual effects
- The comparison feeds back into calibration
- Integration test: send action, simulate outcome event, verify calibration updated

---

## Task 5: Objective Model — What Are We Optimizing?

### The Problem
The system has no explicit optimization target. It proposes actions based on rules, not on what the company is trying to achieve.

### What to Build

**New file: `src/core/objectives.ts`**

```typescript
interface TenantObjectives {
  tenantId: string;

  // Primary objectives with weights (must sum to 1.0)
  objectives: WeightedObjective[];

  // Hard constraints (violations are incidents)
  constraints: ObjectiveConstraint[];
}

interface WeightedObjective {
  id: string;
  name: string;                // e.g. 'cash_acceleration', 'churn_minimization'
  metric: string;              // e.g. 'dso_reduction', 'churn_rate_30d'
  weight: number;              // 0-1, sum to 1.0
  direction: 'minimize' | 'maximize';
  currentValue?: number;
  targetValue?: number;
}

interface ObjectiveConstraint {
  id: string;
  name: string;
  type: 'budget' | 'compliance' | 'relationship' | 'timing' | 'custom';
  predicate: ActionPredicate;
  violationSeverity: 'minor' | 'moderate' | 'critical';
}
```

Default objectives for AR:
1. Cash acceleration (weight 0.4): minimize DSO
2. Dispute minimization (weight 0.2): minimize dispute rate
3. Churn minimization (weight 0.2): minimize churn rate
4. Review load minimization (weight 0.1): minimize human approval burden
5. Relationship preservation (weight 0.1): minimize customer complaints

The planner should score candidate actions against these objectives:

```typescript
function scoreAction(
  actionType: ActionType,
  objectState: Record<string, unknown>,
  objectives: TenantObjectives,
  interventionEstimate: InterventionResult,
): number {
  // Weighted sum of expected objective improvements
  // minus weighted penalties for constraint violations
  // minus uncertainty penalty (wider interval = lower score)
}
```

### Files to Create/Modify
- `src/core/objectives.ts` (new)
- `src/core/objectives-defaults.ts` (new: default AR objectives)
- `src/agents/planner.ts` (modify: score candidates against objectives)
- `src/db/migrations/067_tenant_objectives.sql` (new)

### Acceptance
- Default AR objectives are created for new tenants
- Planner scores candidate actions against objectives
- Actions that violate hard constraints are rejected
- Objective weights are configurable per tenant via API

---

## Task 6: Uncertainty Propagation

### The Problem
Uncertainty exists in isolation. The estimator has confidence. The sidecar has intervals. But uncertainty doesn't flow through the pipeline. A low-confidence prediction should affect the escrow decision, the autonomy check, and the planner score. Currently it doesn't.

### What to Build

**New file: `src/core/uncertainty.ts`**

```typescript
interface UncertaintyProfile {
  // Layer-by-layer uncertainty
  extraction: number;        // how confident was the data extraction (0-1)
  relationship: number;      // how confident is the entity resolution (0-1)
  stateEstimate: number;     // how confident is the belief (0-1)
  prediction: number;        // calibration score of the prediction model
  intervention: number;      // how confident is the intervention estimate
  simulation: number;        // if simulated, how confident
  policy: number;            // were any policy judgments ambiguous?

  // Composite
  composite: number;         // product of all layers (multiplicative uncertainty)
  humanReviewRequired: boolean;  // true if composite < threshold
  abstainRecommended: boolean;   // true if composite < stricter threshold
}

function computeUncertainty(
  belief: Belief,
  prediction: PredictionResult,
  interventionEstimate: InterventionResult | null,
  policyDecision: PolicyDecision,
): UncertaintyProfile;
```

**Wire into the pipeline:**

1. Gateway step 8 (escrow) uses composite uncertainty to adjust thresholds
2. Autonomy enforcer uses uncertainty for selective abstention
3. Planner applies uncertainty penalty to action scores
4. Dashboard shows uncertainty breakdown for every prediction and action

### Files to Create/Modify
- `src/core/uncertainty.ts` (new)
- `src/gateway/gateway.ts` (modify: use uncertainty in escrow)
- `src/eval/autonomy-enforcer.ts` (modify: abstain on high uncertainty)
- `src/agents/planner.ts` (modify: penalty for uncertain actions)

### Acceptance
- Every action in the pipeline has a computed UncertaintyProfile
- High uncertainty triggers abstention even at Autonomous trust level
- Dashboard API returns uncertainty breakdown
- Test: inject high-uncertainty prediction, verify system abstains

---

## Agent Assignment Plan

| Task | Agent | Isolation | Dependencies | Est. time |
|------|-------|-----------|-------------|-----------|
| Task 1: Action ontology | Subagent (worktree) | Yes | None | 2-3 hours |
| Task 2: Gateway rewrite | Subagent (worktree) | Yes | Task 1 types | 3-4 hours |
| Task 3: Autonomy enforcer | Subagent (worktree) | Yes | None | 2-3 hours |
| Task 4: Feedback loop | Subagent (worktree) | Yes | Task 3 | 2-3 hours |
| Task 5: Objective model | Subagent (worktree) | Yes | Task 1 types | 2 hours |
| Task 6: Uncertainty | Subagent (worktree) | Yes | None | 2 hours |

**Parallelization:** Tasks 1, 3, 5, 6 can run in parallel (no file conflicts). Task 2 needs Task 1's types. Task 4 needs Task 3's enforcer.

**Wave 1 (parallel):** Tasks 1, 3, 5, 6
**Wave 2 (parallel):** Tasks 2, 4

---

## What This Sprint Delivers

After Sprint 2, Nooterra becomes:

1. **Actions are causal objects** with preconditions, expected effects, blast radius, and side-effect profiles. Not just tool calls.

2. **The gateway is real.** All 11 steps execute with actual logic. Rate limiting, budget checks, disclosure, simulation, escrow, audit.

3. **Autonomy is enforced.** Demotion is immediate. Promotion is proposed. Abstention happens when uncertainty is high.

4. **The feedback loop closes.** Actions produce outcomes. Outcomes update calibration. Expected effects are compared to actual effects. The system learns from every action it takes.

5. **Optimization is explicit.** The system knows what the company is trying to achieve and scores actions against those objectives.

6. **Uncertainty flows through the pipeline.** Every layer contributes uncertainty. High composite uncertainty triggers abstention.

This is the transition from "predictive state model" to "intervention-aware decision system."

---

## What Comes After (Sprint 3+)

- **Causal intervention engine:** DoWhy/EconML replacing heuristics with learned treatment effects
- **Counterfactual replay:** "What if we had escalated 5 days earlier?"
- **Receding-horizon planner:** MPC-style planning over business objectives
- **Internal eval benchmark:** state reconstruction, intervention choice, abstention quality
- **Multi-source connectors:** Gmail, QuickBooks, CRM
- **Decision-focused learning:** optimize predictions for decision quality, not just accuracy
