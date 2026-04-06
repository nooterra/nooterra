# Superhuman AR Judgment Engine — Design Spec

**Date:** 2026-04-03
**Status:** Approved design, pending implementation plan

---

## 1. Strategic Doctrine

**Wedge:** AR collections via Stripe data access.

**Moat:** Better decisions under constraints, powered by proprietary action-outcome history, governance runtime, and earned trust state.

**Core thesis:** Superhuman judgment, not superhuman automation. The system makes better operational decisions under constraints than humans do — who to contact, when to contact them, how to contact them, and whether to contact them at all. That is the thing no current AR tool has.

**Architecture rule:** No abstraction without a second real use case. But no AR code that blocks domain packs later. Clean interfaces, not generic everything.

**Milestone sequence:**

1. Better than junior AR ops (bounded automation with judgment)
2. Better than strong AR teams in bounded cases (portfolio-level, relationship-aware)
3. Finance control plane (AR + disputes + refunds + credits + payment plans)
4. Multi-domain operating intelligence

**External story:** Governed AR control system with improving judgment. Not "autonomous company platform." Not yet.

**Internal build priority:** Make AR outcomes so strong they force belief. Everything else follows from that.

**What "decision-useful intervention modeling" means:** Not academic causal inference. The system needs to answer: "if we take action X on this customer-invoice pair right now, what's the expected change in payment probability vs doing nothing, and how confident are we?" Good enough intervention estimates that improve with data. Not a causal DAG.

---

## 2. AR Judgment Engine

Five capabilities that no current AR tool has, each building on existing infrastructure.

### 2.1 Intervention Modeling

**Today:** Logistic regression predicting payment probability. Intervention estimates from observed-uplift heuristics with a 65% learned-weight cap.

**Target:** Decision-useful intervention models that answer: "what's the estimated lift in payment probability from action X vs no action, for this specific customer-invoice pair, and how confident are we?"

**How:**

- **Uplift over baseline** — two-model uplift baseline first (treatment model + control model, difference is estimated lift). Strong feature logging. Replay comparison against heuristic. Only move to more sophisticated uplift learners (causal forests, T-learner) after the baseline validates on real data.
- **Temporal strategy learning** — conditional probability of response given day-of-week, time-of-day, days-since-last-contact, customer segment. Simple feature engineering on existing action-outcome data. Only meaningful once enough per-segment observations accumulate.
- **Short-horizon sequence effects** — two-step sequence value is believable. "Friendly then formal" vs "formal immediately" with measured outcome differences. Anything longer than two steps is speculation and will not be modeled.

**Training signal:** Outcome-linked intervention evidence, not proven causal lift. The effect tracker gives observed outcomes, expected-vs-observed deltas, comparative replay evidence, and holdout-like signals. That is useful but is not causal ground truth.

**Control group construction:**

- Use naturally occurring no-action and delayed-action cases first
- Apply propensity adjustment where possible
- Later add constrained randomized exploration in approval-safe regimes
- Strategic holds create additional natural control observations over time

**Rollout discipline:** Intervention models get their own promotion path, separate from probability models. No new governance framework needed, but intervention models need their own evaluation artifacts and promotion criteria (treatment-quality metrics, not just accuracy).

**Codebase changes:**

- `services/ml-sidecar/src/training.py` — add uplift model training alongside existing probability models
- `src/world-model/ensemble.ts` — route intervention queries to uplift models when available, fall back to current observed-uplift heuristic
- Existing promotion gates and rollout gates apply. Intervention models earn trust through the same evaluation-report → rollout-gate → autonomy-enforcer path.

### 2.2 Portfolio-Level Optimization

**Today:** The planner evaluates invoices independently. Each invoice gets scored and prioritized on its own.

**Target:** Optimize across a customer's full relationship. Know that sending a collections email on a $2k invoice while they're evaluating a $200k renewal is wrong. Know that 6 overdue invoices from one customer is a different problem than 6 from 6 customers.

**How:**

- **Customer-level context in planner** — when generating a plan for invoice X, load all objects related to that customer (other invoices, deals, conversations, disputes). The object graph already supports this via `assembleContext` with depth-2 traversal.
- **Relationship-aware objective scoring** — add a "portfolio impact" signal to objective evaluation. "This action scores +0.8 on cash acceleration but -0.6 on relationship preservation given the active expansion deal." The objectives system already has both weights — wire them to richer context.
- **Cross-invoice coordination** — modeled as both a planner constraint (one customer gets one outreach per planning cycle) and an action synthesis rule (consolidate multiple overdue invoices into a single communication). Constraint prevents ranking 4 emails and deduplicating late; synthesis creates the right single action upfront.
- **Customer lifetime value signal** — estimated LTV as an input to the planner's priority scoring. High-LTV customers get softer treatment, longer patience, human escalation earlier.

**Codebase changes:**

- `src/planner/planner.ts` — expand context assembly to customer-level, add cross-invoice deduplication constraint and action synthesis, wire LTV into priority scoring
- `src/core/objectives.ts` — add portfolio-impact evaluation that considers related objects
- May need persisted customer-level derived features or relationship summaries as portfolio reasoning matures

### 2.3 Strategic Hold

**Today:** The system abstains when uncertainty is high or autonomy level requires human approval. That is defensive abstention — "I don't know, so I won't act."

**Target:** Offensive abstention — "I know enough to know that not acting is the best decision right now." The system's best AR person sometimes looks at an overdue invoice and says "leave it alone for two more weeks." That is a real decision, not passivity.

**How:**

- **`strategic.hold` as a first-class governed decision** — the planner generates hold as a scored variant alongside friendly/formal/escalation. Hold has explicit predicted effects (payment may come in anyway, relationship preserved, no intervention cost). Scored against the same objectives as real actions.
- **Patience modeling** — learn from history which invoices resolve without intervention. "Invoices from enterprise customers in this segment self-resolve 40% of the time within 21 days." Combined with uplift estimates: if predicted self-resolution probability exceeds predicted best-action uplift, recommend hold with evidence.
- **Hold with explanation** — when the system chooses to hold, record why in the evidence bundle. "Held because: active expansion deal, customer historically pays by day 25, intervention cost exceeds expected uplift." Holds are tracked, graded, and earn trust through the same shadow → recommendation → approval-bound → autonomous path as any other action.

**Codebase changes:**

- `src/core/action-registry.ts` — register `strategic.hold` action type with explicit predicted effects
- `src/planner/planner.ts` — add hold variant generation alongside friendly/formal/escalation variants
- `src/eval/effect-tracker.ts` — track outcomes of holds the same way actions are tracked

### 2.4 Compounding Learning

**Today:** Models train on accumulated data. No systematic loop that identifies which strategies are working and shifts allocation.

**Target:** The system has a weekly learning loop and improves where evidence accumulates. New tenants start better than old tenants started because of anonymized cross-tenant priors.

**How:**

- **Outcome-graded strategy replay** — weekly batch grades every action's intervention quality using effect tracker data. Identifies which strategies are working per customer segment. Updates sidecar training data with graded outcomes.
- **Cross-tenant anonymized priors** — when a new tenant connects, use anonymized aggregate models trained on bucketized, normalized features from consenting tenants. No tenant IDs, no customer identifiers, no raw amounts cross tenant boundaries. Feature schema itself must be privacy-reviewed. Per-tenant gating enforced: global model earns promotion independently within each tenant's data. No trust borrowing.
- **Drift-triggered retraining** — ADWIN drift detection (already exists) triggers early retraining cycle. Retrained model still goes through full release evaluation → promotion gates. Drift detection accelerates retraining, does not bypass evaluation. Retraining paired with replay evaluation, release gating, and rollback capability.

**Codebase changes:**

- `services/ml-sidecar/src/training.py` — add outcome-graded retraining pipeline, cross-tenant global model training with anonymized feature aggregation
- `services/runtime/scheduler.ts` — add weekly retraining job
- Existing drift detection wired to trigger retraining instead of just logging

### 2.5 Proof of Judgment

**Today:** Dashboard shows actions, outcomes, and autonomy state. No single view that answers: "is this system making better decisions than a human would?"

**Target:** A judgment scorecard that proves the system's value with honest metrics.

**How:**

- **Modeled incremental contribution** — "we collected $X. Without intervention, we estimate $Y would have self-resolved. Our modeled incremental contribution is $X - $Y." Presented as a model estimate, not ground truth. This is what the uplift models enable.
- **Decision quality tracking** — not just "did the invoice get paid" but "did the system's choice of action outperform the alternatives it considered?" The comparative replay system already stores this data.
- **Judgment improvement over time** — intervention quality scores trending over weeks. The evaluation reports system already computes this.
- **Human-vs-system comparison** — when humans override the system (approve a different action, reject a recommendation), track who was right. Over time this builds an honest head-to-head record. One of the most defensible long-term assets if tracked honestly.

**Codebase changes:**

- `src/api/world-runtime-routes.ts` — add judgment scorecard endpoint aggregating existing evaluation data
- `src/eval/evaluation-reports.ts` — add modeled-incremental-contribution report type
- Dashboard gets a "Judgment" view
- Minimal operator scorecard (holds, actions, overrides, outcomes) ships in Phase 1; full CFO-grade scorecard in Phase 3

---

## 3. ML Architecture

Layered upgrade from heuristics to decision-useful intervention models. Not a rewrite — additional model layers with clean fallbacks.

### 3.1 Model Stack

**Layer 1: Probability Models (exists, keep)**

- Logistic regression / decision tree predicting payment probability
- Calibrated with isotonic regression, conformal intervals
- Stays as the baseline. Answers: "how likely is this invoice to get paid?"

**Layer 2: Uplift Models (new, wave 1 — highest priority)**

- Two-model uplift baseline first: treatment model (outcome given action) + control model (outcome given no action/hold). Difference is estimated lift.
- Strong feature logging and replay comparison before trying more sophisticated learners.
- Trained on: (customer features, invoice features, action taken, outcome observed) with naturally occurring no-action/delayed-action cases as control, propensity-adjusted where possible.
- Outputs: point estimate of lift + conformal interval. The interval matters more than the point estimate early on.
- Rollout: own promotion path with treatment-quality evaluation artifacts and distinct promotion criteria.

**Layer 3: Patience Models (new, wave 2)**

- Survival model: probability this invoice self-resolves by day T without intervention
- Trained on historical no-action invoices (pre-Nooterra data + strategic hold outcomes)
- Combined with uplift: if self-resolution probability > best-action uplift, recommend strategic hold
- Only activates once sufficient hold outcome data exists (see Section 6.2)

**Layer 4: Timing Models (new, wave 3)**

- Conditional response probability by day-of-week, time-of-day, days-since-last-contact, customer segment
- Gradient-boosted regression on timing features
- Applied as scheduling preference in the planner, not a hard rule
- Only activates once per-segment sample sizes are meaningful (see Section 6.2)

### 3.2 Training Pipeline

- **Scheduled retraining** — weekly batch job retrains all model layers on accumulated outcome-graded data
- **Outcome-graded training signal** — effect tracker grades each action's outcome. Graded action-outcome pairs become training examples. Training signal is outcome-linked intervention evidence, not proven causal lift.
- **Release pipeline unchanged** — new models go through candidate → replay evaluation → approval → promotion. No new gates needed. Each model class reuses the same governance framework but has distinct evaluation artifacts and promotion criteria.
- **Drift-triggered acceleration** — ADWIN drift detection triggers early retraining. Retrained model still goes through full release gating. Paired with replay evaluation and rollback capability.

### 3.3 Cross-Tenant Global Models

- **Anonymized feature aggregation** — global models train on bucketized features: invoice value bucket, days overdue bucket, customer segment archetype, action class. No tenant IDs, no customer identifiers, no raw amounts.
- **Normalization** — monetary features normalized relative to tenant's own distribution (percentile rank, not raw dollars)
- **No trust borrowing** — global model's promotion status does not transfer to any tenant. Each tenant's autonomy coverage evaluates the global model independently.
- **Privacy boundary** — global training runs on feature vectors only. Feature schema must be privacy-reviewed because badly chosen derived features can still leak. Architectural invariant, not just policy.
- **Activation conditions** — 3+ consenting tenants, 500+ anonymized observations total, feature normalization validated on 2+ tenants (see Section 6.2)

### 3.4 Decision Feature Stack

The ensemble routes decisions through a stack of independent estimates. These are not all the same kind of prediction — they answer different questions:

1. **Deterministic rules** — hard policy constraints, always first
2. **Baseline probability estimate** — how likely is this outcome regardless of action?
3. **Intervention lift estimate** — what's the delta from acting vs not acting?
4. **Wait-vs-act estimate** — is patience more valuable than intervention right now?
5. **Timing preference estimate** — if acting, when is best?
6. **Uncertainty synthesis** — composite confidence across all estimates
7. **Policy and rollout gating** — is this model/action class allowed?
8. **Decision assembly** — combine estimates into ranked action recommendations

Each model type has its own promotion gate, confidence weight, and fallback behavior. Fallback for every new model type: the system behaves exactly as it does today. Uplift unavailable → current observed-uplift heuristic. Timing unavailable → business hours default. Patience unavailable → existing collection sequence timing.

### 3.5 What This Does NOT Include

- **No reinforcement learning.** Uplift + patience + timing covers the decision space without the instability. Too data-hungry and too risky for production decisions with real money.
- **No LLM-based prediction.** LLMs draft emails and read context. Statistical models predict outcomes. Different tools for different jobs.
- **No real-time online learning.** Models update weekly via batch retraining. Online learning introduces instability that conflicts with the governance runtime.
- **No multi-task models.** Each model answers one question. Composition happens in the ensemble.
- **No causal DAGs.** Decision-useful intervention evidence, propensity-adjusted where possible, release-gated always.

---

## 4. Domain Pack Seams

The rule: no abstraction without a second real use case, but no AR code that blocks domain packs later.

### 4.1 What's Already Domain-Agnostic (don't touch)

These systems operate on generic primitives and do not know about invoices, customers, or collections:

- **Gateway** — action preflight, policy, simulation, autonomy, execution
- **Autonomy enforcer** — (agent, action_class, object_type) coverage cells, promotion, demotion, abstention
- **Effect tracker** — expected vs observed effects on any object/field pair
- **Rollout gates** — quality-based blocking for any action class
- **Evaluation reports** — quality score storage and trending
- **Object graph** — typed objects with state, estimated fields, relationships, versioning (37 types)
- **Event ledger** — append-only typed events (50+ event types, 7 domains)
- **Ensemble routing infrastructure** — routes prediction requests to models by type. The routing is generic; prediction targets, intervention semantics, and feature extraction are domain-defined.

This is the strongest part of the current architecture. The control plane is already general.

### 4.2 What's AR-Specific (where the seams go)

Five places where AR logic is currently inline:

**1. Action Registry** (`src/core/action-registry.ts`)

- 4 hardcoded action types with AR-specific preconditions and effects
- Seam: move action definitions into `src/domains/ar/actions.ts`. Registry imports them. No interface change, no dynamic loader, no config format.

**2. Objectives** (`src/core/objectives.ts` + `objectives-defaults.ts`)

- 5 hardcoded objectives and 5 hardcoded constraints, all AR-specific
- Seam: move into `src/domains/ar/objectives.ts`. Objective engine loads and scores whatever objectives it's given.

**3. Planner** (`src/planner/planner.ts`)

- Invoice scanning, variant generation (friendly/formal/escalation) entangled with generic planning logic (beam search, scoring, rollout gate checking)
- Seam: split into planner core (generic scoring, search, gating) and AR scanner (candidate generation). Pull scanning into `src/domains/ar/scanner.ts`. Planner core calls scanner.
- This is the most important seam. After extraction, someone can read the planner core without knowing anything about invoices.

**4. Runtime Pack / Provisioning**

- AR-specific runtime creation, templates, and execution policy embedded in:
  - `src/api/world-runtime-routes.ts`
  - `services/runtime/execution-loop.ts`
  - Collections agent/template wiring
- Seam: isolate AR-specific provisioning so domain #2 does not require digging AR logic out of API/runtime code. Eventually `src/domains/ar/runtime.ts`.

**5. ML Training Targets** (`services/ml-sidecar/src/training.py`)

- Feature extraction and prediction targets are AR-specific (invoice payment features, payment probability)
- Seam: the training pipeline, calibration, drift detection, and release management are generic. When domain #2 arrives, add a second feature extractor and target definition. The sidecar handles multiple model types already (keyed by `prediction_type` and `model_id`).

### 4.3 The Domain Pack Shape (conceptual, not built yet)

When domain #2 arrives, a domain pack would be:

```
src/domains/ar/
  actions.ts      — action type definitions
  objectives.ts   — objective templates and constraints
  scanner.ts      — state scanner generating candidate actions
  features.ts     — ML feature extraction
  targets.ts      — prediction targets and intervention semantics
  runtime.ts      — provisioning and execution policy
```

Core runtime unchanged. New domain registers its actions, objectives, scanner, and ML targets. Gateway, autonomy enforcer, effect tracker, evaluation system, and ensemble all work without modification.

**This directory does not exist yet.** That is intentional. Create it when extracting AR-specific code. Do not create a generic `DomainPack` interface until a second domain validates it.

### 4.4 Four Code Moves (the actual work)

1. Extract AR actions into `src/domains/ar/actions.ts`
2. Extract AR objectives/constraints into `src/domains/ar/objectives.ts`
3. Extract AR scanner into `src/domains/ar/scanner.ts`
4. Extract AR runtime provisioning into `src/domains/ar/runtime.ts`

Each is a straightforward code move. No new abstractions. No generic interfaces. Static imports.

**Readability tests after extraction:**

- Someone can read `src/planner/planner.ts` without knowing about invoices
- Someone can read the AR scanner without needing to understand autonomy/gateway internals

**Deterministic behavior preserved during extraction:**

- Candidate ordering
- Stable IDs
- Score ordering
- Reason codes

### 4.5 What NOT to Do

- No domain pack loader or plugin system. One domain. Static imports.
- No abstract base classes for scanners, objectives, or actions. Interface will be wrong without a second domain to validate.
- No generic ML feature extraction. AR features are AR features. Shared infrastructure is the training pipeline and serving layer.
- No domain registry or configuration format. When there are 3 domains, patterns will emerge. Extract the abstraction then.

---

## 5. Build Sequence

Four phases. Months timeline. AR judgment that compounds. Seams that enable expansion. Nothing built that isn't needed.

### Phase 1: Judgment Foundation (weeks 1-4)

**Goal:** The system makes demonstrably better collection decisions than the current heuristic planner.

**Build:**

1. **Strategic hold action type** — register `strategic.hold`. Planner generates hold as a scored variant. Effect tracker tracks hold outcomes. Small code, massive product signal.

2. **Portfolio context in planner** — expand context assembly to customer-level state. Add cross-invoice deduplication constraint and action synthesis: one customer gets one consolidated outreach per planning cycle.

3. **Outcome-graded data pipeline** — wire effect tracker's observed-vs-expected deltas into sidecar's training data. Every completed observation window becomes a graded training example. Builds the dataset that makes everything else possible.

4. **Minimal operator scorecard** — internal view showing: holds chosen, actions chosen, overrides, observed outcomes, modeled contribution placeholder. Not the full CFO view — the feedback loop for operators and builders.

5. **Domain seam extraction (move 1 of 4)** — extract AR actions into `src/domains/ar/actions.ts`.

**Exit criteria:**

- Strategic hold live and producing hold decisions with evidence
- Customer-level deduplication prevents multi-invoice spam
- Outcome-graded examples flowing (minimum: 50 graded action-outcome pairs)
- Minimal operator scorecard live
- No regression in existing collection performance (DSO and payment rate vs pre-Phase-1 baseline)

**Demo:** "The system held on 3 invoices where the customer had active deals, and collected on the other 12. Here's the outcome comparison."

### Phase 2: Intervention Intelligence (weeks 5-10)

**Goal:** The system estimates action lift well enough to choose better actions than the heuristic ranking.

**Build:**

1. **Two-model uplift baseline** — treatment model + control model. Difference is estimated lift. Validates on outcome-graded data from Phase 1. Same feature set as probability model plus action-class features.

2. **Uplift model promotion path** — treatment-quality evaluation artifacts. Same governance framework, distinct promotion criteria: measured lift stability, confidence interval width, comparison against heuristic baseline. Starts in shadow mode.

3. **Patience model (if data sufficient)** — survival model on historical no-action invoices + strategic hold outcomes. Combined with uplift: self-resolution probability vs best-action uplift. If fewer than 100 strategic hold outcomes exist, defer to Phase 3.

4. **Domain seam extraction (moves 2-3)** — extract AR objectives and AR scanner. Planner core becomes readable without invoice knowledge.

**Exit criteria:**

- Uplift model beats heuristic baseline in replay evaluation
- Uplift model promoted through rollout gates, serving in at least recommendation mode for one tenant
- If hold data sufficient: patience model trained and in shadow mode
- If insufficient: patience model deferred, documented
- AR scanner, objectives, and actions extracted. Planner core readable without invoice knowledge.

**Demo:** "The uplift model identified 40 invoices where intervention would help and 15 where waiting was better. Here are the actual outcomes vs the old heuristic."

### Phase 3: Compounding & Proof (weeks 11-16)

**Goal:** The system measurably improves where evidence accumulates and you can prove it to a CFO.

**Build:**

1. **Scheduled retraining loop** — weekly batch retrains uplift and patience models on accumulated data. New models go through release evaluation → promotion gates. Drift detection triggers early retraining but not gate bypass.

2. **Cross-tenant global priors** — anonymized, normalized, bucketized features from consenting tenants. Only activated when: enough consenting tenants exist, feature normalization validated, per-tenant gating proven. Architecture in place regardless; activation conditional.

3. **Judgment scorecard** — full version:
   - Modeled incremental contribution
   - Decision quality trend
   - Human-vs-system override comparison
   - Portfolio optimization impact

4. **Domain seam extraction (move 4)** — extract runtime pack / provisioning.

**Exit criteria:**

- Weekly retraining loop running, producing release candidates, evaluated and gated automatically
- Judgment scorecard live with modeled incremental contribution, decision quality trend, override record
- At least one tenant showing measurable improvement over 4+ week window
- If tenant count supports it: global priors trained, per-tenant gating validated
- If not: global prior architecture in place, dormant
- All four domain seams clean

**Demo:** "Here's the judgment scorecard. Week 1 our modeled incremental contribution was $X. Week 12 it's $Y. Here's the head-to-head record against human overrides."

### Phase 4: Timing & Expansion Readiness (weeks 17+)

**Goal:** Squeeze remaining AR judgment gains. Validate that a second domain can plug in.

**Build:**

1. **Timing optimization (wave 3)** — conditional response probability by day/time/segment. Only activates with sufficient per-segment sample sizes. Scheduling preference, not hard rule.

2. **Domain #2 validation** — stand up a second domain using existing seams. Candidates in order of proximity to current data surface: disputes, refunds, credits, payment plans. Create `src/domains/{domain}/` with scanner, actions, objectives. The test: can you get it working without modifying gateway, autonomy enforcer, effect tracker, evaluation reports, or ensemble routing? If yes, seams worked. If not, fix them.

3. **Sequence optimization** — two-step sequence value estimation using multi-touch outcome data. Short-horizon only. Two steps max.

**Exit criteria:**

- Second domain validated without gateway/autonomy/eval rewrites
- If any core system required modification: documented and fixed before claiming expansion readiness
- Timing model live only if per-segment sample sizes exceed threshold

---

## 6. Success Metrics, Release Gates, and Activation Thresholds

### 6.1 Kill / Delay Criteria

Signals that mean stop and reassess:

- **Uplift model does not beat heuristic after 2 training cycles on sufficient data** — intervention evidence may not be strong enough. Delay, accumulate data, investigate feature quality. Do not ship a model worse than the heuristic.
- **Strategic holds consistently produce worse outcomes than acting** — patience thesis may be wrong for this customer base. Demote holds to recommendation-only, investigate.
- **Human overrides consistently outperform system (>60% of overrides produce better outcomes over 4+ weeks)** — judgment engine not good enough yet. Freeze autonomy promotions, study what humans see that the system doesn't.
- **Outcome-graded data shows no signal** — action-outcome deltas are noise. Features may be wrong, observation window may be wrong, or domain may not have learnable intervention effects at this data volume. Investigate before building more models on noise.
- **Cross-tenant global model degrades any individual tenant** — per-tenant gating should catch this. If it doesn't, shut off global priors and investigate normalization.

### 6.2 Data Sufficiency Thresholds

Minimum observations before each capability activates. Below threshold, capability stays dormant and system falls back to the previous layer. No partial activation.

| Capability | Minimum Observations | What Counts |
|---|---|---|
| Uplift model training | 200 graded action-outcome pairs, at least 30 no-action/hold cases | One invoice: action taken or held, observation window completed, outcome graded |
| Uplift model promotion (shadow → recommendation) | Replay evaluation on 100+ held-out examples showing lift over heuristic | Held-out historical cases not used in training |
| Patience model training | 100 strategic hold outcomes with resolved status | One invoice: hold chosen, observation window completed, paid or not-paid observed |
| Timing optimization | 300 action-outcome pairs per segment with timestamp features | One action with known send-time and observed response/outcome |
| Global priors | 3+ consenting tenants, 500+ anonymized observations, normalization validated on 2+ tenants | One bucketized, normalized feature vector from a graded action-outcome |
| Sequence optimization | 150 multi-touch sequences (same customer, 2+ actions) with final outcome | One customer receiving 2+ actions with graded outcome after sequence |

### 6.3 Shadow-to-Live Policy

Every new model or strategy follows this progression. No shortcuts.

**Stage 1: Shadow**

- Model runs on every eligible decision
- Results logged, do not influence any action
- Evaluation: compare shadow recommendations against actual decisions and outcomes
- Duration: minimum 2 weeks or 50 decisions, whichever is longer
- Exit: shadow recommendations at least as good as current system in replay evaluation

**Stage 2: Recommendation**

- Model's recommendation surfaced in approval queue and operator scorecard
- Human sees: "system recommends X, current heuristic would do Y"
- Human makes final decision
- Evaluation: recommendation acceptance rate and outcome quality of accepted vs rejected
- Duration: minimum 2 weeks or 30 acted-on recommendations
- Exit: acceptance rate >50% AND accepted recommendations produce equal or better outcomes

**Stage 3: Approval-Bound Autonomy**

- Model's recommendation is the default action
- Human approves or overrides
- Overrides tracked as judgment comparisons
- Evaluation: override rate trending down, override-vs-system outcome comparison
- Duration: minimum 4 weeks
- Exit: override rate <20% AND system outperforms overrides on tracked outcomes

**Stage 4: Autonomous (with monitoring)**

- Model acts without human approval for this (agent, action_class, object_type) cell
- Continuous monitoring via autonomy enforcer
- Demotion triggers: incident spike, outcome quality drop below gate threshold, drift detection
- No duration minimum — steady state, not a phase to pass through

**Strategic holds follow the same path.** A hold is a governed decision. It earns trust the same way an action does: shadow holds → recommended holds → approval-bound holds → autonomous holds.

---

## Appendix: What Is Explicitly Not in This Design

- **No reinforcement learning.** Uplift + patience + timing covers the decision space without the instability.
- **No LLM-based prediction.** LLMs draft emails and read context. Statistical models predict outcomes.
- **No real-time online learning.** Weekly batch retraining. Online learning conflicts with governance.
- **No multi-task models.** Each model answers one question. Composition in the ensemble.
- **No causal DAGs.** Decision-useful intervention evidence, propensity-adjusted, release-gated.
- **No domain pack plugin system.** Static imports. One domain. Abstraction when there are two.
- **No platform launch.** AR ships alone. Domain #2 is validation, not product.
- **No premature abstraction.** No abstract base classes, no config DSL, no domain registry.
