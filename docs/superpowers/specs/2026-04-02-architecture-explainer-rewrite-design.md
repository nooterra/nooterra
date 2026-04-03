# Design Spec: ARCHITECTURE.md and EXPLAINER.md Rewrite

## Overview

Rewrite two core technical documents for Nooterra:

1. **ARCHITECTURE.md** -- External due diligence package for technical evaluators (CTO advisors, technical partners, investor engineering friends). Shared under NDA. 40-50 pages.
2. **EXPLAINER.md** -- Accessible product/technical explainer for non-engineer founders and product-minded investors. 15-20 pages.

Both documents describe the same system but at different depths and for different audiences.

## Decisions

- **Audience:** Technical evaluator under NDA (ARCHITECTURE), product-minded investor (EXPLAINER)
- **Maturity honesty:** Each subsystem described with current implementation AND target state side by side. Uses Live / Building / Target tiering.
- **Cutting-edge techniques:** Woven into architecture as design intent. Names specific algorithms, libraries, and papers. Shows you know what state of the art looks like and have a concrete plan to get there.
- **Writing rules:** No em dashes. No "not X, but Y" constructions. No semicolons joining independent clauses. No blockquote callouts. Short sentences. Active voice. Numbers over adjectives.

## Document 1: ARCHITECTURE.md

### Audience
Technical evaluator under NDA. Expects precision, honesty, and concrete evidence. Will verify claims against the codebase if given access.

### Tone
Precise, measured, concrete. Names algorithms, libraries, papers. No marketing. Shows current state AND target state for every subsystem. When something is aspirational, says so.

### Structure

#### Section 1: System Overview (2 pages)
- One-paragraph positioning (not a sales pitch)
- Architecture diagram: 6 core subsystems + LLM boundary
- Maturity table: each subsystem rated Live / Building / Target with one-line status
  - Event Ledger: Live
  - Object Graph: Live
  - State Estimator: Live (rule-based + logistic regression)
  - Policy Runtime: Live
  - Action Gateway: Live
  - Autonomy Engine: Live
  - Simulation Layer: Building (rule-based heuristics)
  - Multi-Source Connectors: Building (Stripe live, others in framework)
  - Causal Inference: Target
  - Conformal Prediction: Target
  - Inter-Company Network: Target
- Tech stack: TypeScript, PostgreSQL, Redis, Railway, OpenRouter, Composio
- Test coverage: 253 tests (unit, integration, contract, chaos, load), 0 failures

#### Section 2: Event Ledger (3 pages)
- **Current implementation:**
  - Append-only PostgreSQL table partitioned by tenant + time
  - Hash chain: each event stores content hash + previous event hash per tenant
  - Bi-temporal: `timestamp` (when it happened) and `recordedAt` (when we learned about it)
  - Provenance: sourceSystem, sourceId, extractionMethod, extractionConfidence, rawRef
  - Corrections create new events with `causedBy` reference (never mutate)
- **Target state:**
  - Full bi-temporal queries: "what did we believe about X on date Y?"
  - Content-addressed event references for cross-tenant audit without data sharing
- **Concrete example:** Stripe `invoice.payment_failed` webhook flowing through the ledger with actual field values
- **Schema excerpt:** TypeScript interface for WorldEvent

#### Section 3: Canonical Object Graph (3 pages)
- **Current implementation:**
  - 5 canonical types: Party, Invoice, Payment, Dispute, Conversation
  - Typed relationships with version history
  - Provenance tracking per field
  - Entity resolution across sources (Stripe customer = QuickBooks customer)
  - `valid_from`/`valid_to` for temporal queries
- **Target state:**
  - 20+ object types (Deal, Contract, Obligation, Task, etc.)
  - Temporal knowledge graph embeddings (TTransE / TNTComplEx) for link prediction
  - "Based on temporal patterns, Customer X is likely to churn in 30 days"
  - Full bi-temporality: assertion time + transaction time
- **Schema excerpts:** TypeScript interfaces for core object types
- **Relationship model:** How entities link to each other

#### Section 4: State Estimator and Belief System (4 pages)
- **Current implementation:**
  - Belief interface: field, value, confidence (0-1), sources, estimatedAt, method
  - Methods: direct observation, rule-based inference, learned inference (logistic regression), default priors
  - Conflict detection with auto-resolve for simple field conflicts
  - CalibrationTracker computes MAE per model
- **Target state:**
  - Conformal prediction via MAPIE: statistically guaranteed prediction intervals
    - Instead of "payment prob: 0.72, confidence: 0.6" -> "payment prob: 0.72, 90% interval: [0.58, 0.86]"
    - Finite-sample coverage guarantees regardless of model quality
    - EnbPI variant for time series (drops exchangeability requirement)
  - Post-hoc calibration: temperature scaling (single parameter, Guo et al. 2017) + isotonic regression
    - Use whichever has lower Expected Calibration Error on holdout
  - Drift detection: ADWIN via River library
    - Monitors prediction residuals per model per tenant
    - Detects statistically significant distribution changes
    - Triggers recalibration or retraining when drift detected
  - OOD detection: feature distribution monitoring via KL divergence
    - Track input feature distributions at training time
    - Alert when inference-time distribution diverges beyond threshold
    - Conformal p-values for OOD scoring (free from MAPIE infrastructure)
- **Precise definitions:**
  - Confidence: the model's estimate of its own certainty (0-1)
  - Calibration: how well historical confidence estimates matched actual outcomes
  - Belief: an estimated fact with value, confidence, provenance, and method
  - Conflict: when multiple sources report different values for the same field

#### Section 5: World Model Ensemble (5 pages)
- **Design principle:** Not a single monolithic model. Each prediction target gets its own model. Independent, testable, replaceable.
- **Current implementation:**
  - Deterministic rules: accounting identities, contract terms, deadline calculations
  - Probabilistic models: logistic regression, XGBoost for payment probability, churn risk, dispute probability
  - Intervention estimates: hardcoded heuristics (e.g., "sending email improves payment probability by 0.15")
  - Model lifecycle: historical data, feature engineering, training, calibration, shadow, live, monitoring
- **Target state:**
  - Causal inference via DoWhy + EconML:
    - Replace hardcoded heuristics with Conditional Average Treatment Effects (CATE)
    - Causal forests (Athey & Wager) for heterogeneous treatment effects
    - "Sending a collection email to THIS customer increases payment probability by 0.22 +/- 0.08"
    - 4-step API: model/identify/estimate/refute
  - Causal discovery via NOTEARS + PC algorithm:
    - Learn DAG from observational data automatically
    - Discover that "invoice amount > $50K" causally affects "days to payment"
    - Validate with domain experts before deployment
  - Simulation via CausalNex (McKinsey):
    - Bayesian network from data + expert knowledge
    - do() interventions: `bn.do(intervention={'sent_email': 1}).query('payment_7d')`
    - Returns actual posterior distributions, not magic numbers
  - Monte Carlo rollout with causal constraints:
    - Sample from joint distribution implied by DAG
    - Propagate interventions forward through time
    - "If we raise prices 10%, here are 1000 simulated futures with confidence bands"
- **Four model types explained** with concrete AR domain examples
- **Model lifecycle** in detail: training data sources, feature engineering approach, calibration testing methodology, shadow deployment protocol, promotion criteria, continuous monitoring, retraining triggers

#### Section 6: Policy and Authority Engine (4 pages)
- **Current implementation:**
  - Zanzibar-style DAG: humans -> agents -> sub-agents
  - AuthorityGrant with explicit scope (action classes, object types, party filters, budget limits, time windows)
  - PolicyGuard: deterministic, fast, auditable (condition -> allow/deny/require_approval)
  - PolicyJudgment: LLM-based for ambiguous cases, with fallback and timeout
  - Attenuation-only: child's authority is always subset of parent's
  - neverDo lists: immutable from autonomous paths, only humans can modify
- **Target state:**
  - LLM-to-formal-policy compilation:
    - Natural language rules -> executable symbolic constraints
    - Soundness verification (recent work achieves 99%+ accuracy)
    - Closes the loop between PolicyEditor UI and runtime enforcement
  - Neurosymbolic guard evaluation:
    - LLM outputs checked against symbolic constraint system before execution
    - Catches "agent wants to send refund larger than original invoice" structurally
- **Authorization decision flow:** Full pipeline with each step explained
- **Example:** A real policy guard with predicate, scope, and evaluation trace

#### Section 7: Action Gateway (3 pages)
- **Current implementation:** Full 11-step pipeline
  1. Authenticate (verify agent identity and grant chain)
  2. Authorize (check against policy and authority engine)
  3. Validate (parameters, counterparty, value limits)
  4. Rate limit (action frequency limits)
  5. Budget check (atomic decrement)
  6. Disclosure check (e.g., "AI composed" disclosure)
  7. Simulate (optional, if enabled for action class)
  8. Escrow decision (low risk -> execute, medium -> hold, high -> hold + notify)
  9. Execute (call tool/integration, capture result, record compensating action)
  10. Audit (write to ledger, evidence bundle, update object graph)
  11. Notify (trigger downstream: state estimator, evaluator, planner)
- Evidence bundles: policies satisfied, facts relied on, tools used, agent uncertainty, reversible path, authority chain
- Reversibility tracking: full / partial / none per action class
- **Target state:**
  - Pre-execution simulation via causal digital twin
  - Intent-based multi-agent coordination (resource locking, conflict detection)
  - Agent intent declarations with TTLs to prevent contradictory actions
- **Example:** A collection email action flowing through all 11 steps with actual field values

#### Section 8: Autonomy Engine (4 pages)
- **Current implementation:**
  - Per-action-class trust levels: Locked, Shadow, Supervised, Auto+Review, Autonomous
  - Procedural scoring: percentage of policy predicates evaluated to true
  - Outcome scoring: whether actual outcome fell within predicted confidence interval
  - Incident classification: minor, moderate, critical (with precise definitions)
  - Promotion thresholds:
    - Supervised -> Auto+Review: 20+ executions, 85%+ procedural, 75%+ outcome, <=1 minor incident, 30-day window
    - Auto+Review -> Autonomous: 50+ executions, 90%+ procedural, 80%+ outcome, 0 incidents, 60-day window
  - Asymmetric demotion: immediate on moderate/critical incident
  - Sparse-data safeguards: no promotion without sufficient data, no interpolation
  - Shadow mode: mandatory for new agents/action classes
- **Target state:**
  - Active learning via Bayesian acquisition functions:
    - Expected Information Gain as acquisition function
    - Propose actions that maximally reduce uncertainty in world model
    - Accelerates calibration dramatically for new tenants
  - BALD (Bayesian Active Learning by Disagreement):
    - Select queries where ensemble members disagree most
    - Human input focused where it's most valuable
- **Example:** Autonomy coverage map for a real tenant

#### Section 9: Simulation Layer (3 pages)
- **Current implementation:** Rule-based scenario analysis. Hardcoded intervention estimates in `estimateIntervention()`.
- **Target state:**
  - CausalNex Bayesian network: do-calculus interventions returning posterior distributions
  - Twin networks (Pearl): true counterfactuals ("Would this invoice have been paid if we HAD sent the email?")
  - Monte Carlo simulation with causal constraints for fan-out predictions
  - Scenario cards: predicted impact with confidence intervals, tradeoffs, key assumptions, known unknowns
- **Honest framing:** This is the most aspirational subsystem. Current state is heuristic. Target state is causal. The path from here to there requires sufficient action-outcome data density per tenant.

#### Section 10: Connector Framework (2 pages)
- Connector interface: poll(), handleWebhook(), syncCursor, status
- Extraction pipeline: raw event -> normalization -> entity extraction (LLM + rules) -> resolution -> typed WorldEvent
- Stripe connector in detail (the one that's live): which webhooks, which object types, extraction confidence
- Other connectors: what the framework supports, what's in progress
- LLM extraction vs rule-based: when each is used, confidence scoring

#### Section 11: Governance, Security, and Data Handling (3 pages)
- Tenant isolation: database-level partitioning, connection-level scoping
- Authentication: magic link (email OTP) + passkeys, no password storage
- Authorization: Zanzibar-style DAG, explicit approval authority
- Audit: hash-chained evidence bundles, immutable retention
- Incident response: automatic demotion, operator notification, critical pause
- Data handling: PII storage, retention configuration, tenant deletion
- What's NOT stored: raw credentials beyond OAuth tokens

#### Section 12: Operational Metrics and Testing (2 pages)
- Test coverage: 253 tests across 5 categories
  - Unit tests: core logic, object graph operations, policy evaluation
  - Integration tests: connector ingestion, gateway pipeline, autonomy promotion
  - Contract tests: API surface stability
  - Chaos tests: connector failure, latency injection, malformed webhooks
  - Load tests: 100 concurrent tenants, 10K objects each
- Latency targets and throughput characteristics
- Failure modes: what happens when each subsystem degrades
- Monitoring: what's instrumented, what triggers alerts

#### Section 13: Technical Roadmap (2 pages)
Priority stack for cutting-edge techniques:
1. Conformal prediction (MAPIE) -- rigorous prediction intervals
2. ADWIN drift detection (River) -- calibration monitoring
3. Temperature scaling + isotonic regression -- post-hoc calibration
4. Feature distribution monitoring -- OOD detection
5. LLM-to-policy translation -- governance loop closure
6. Intent-based agent coordination -- multi-agent safety
7. DoWhy + EconML causal estimation -- replace hardcoded heuristics
8. CausalNex for what-if simulation -- world model simulation layer
9. Bi-temporal object graph upgrade -- full auditability
10. Active learning acquisition functions -- accelerate tenant calibration

Timeline: Items 1-4 are Python services deployable in weeks. Items 5-6 are TypeScript extensions. Items 7-10 require more data infrastructure.

#### Section 14: References
All academic papers, libraries, and algorithms cited throughout. Specific versions and URLs.

---

## Document 2: EXPLAINER.md

### Audience
Non-engineer founder, product-minded investor, business development partner. Someone who needs to understand what Nooterra does and why it matters without reading TypeScript interfaces.

### Tone
Clear, confident, concrete. Uses the 6-stage loop as the narrative backbone. Specific examples from AR domain. No jargon without explanation.

### Structure

#### Opening: What Nooterra Is (1 page)
- One-paragraph definition
- The 6-stage loop: Observe, Model, Predict, Act, Evaluate, Learn
- What the user sees: connect Stripe, see company state, get proposals, approve/reject, watch autonomy expand

#### The Problem (2 pages)
- Why current AI agents fail in enterprise (dynamics blindness)
- The collection email example (concrete, visceral)
- Cost of the problem (QuickBooks/Bluevine stats)
- WoW-bench research validation (brief, not a chapter)

#### How It Works (4 pages)
- The 6-stage loop in detail with concrete examples
- Each stage: what happens, what the user sees, what the system does internally
- The LLM boundary: what it does, what it doesn't do
- Earned autonomy: shadow -> supervised -> autonomous (the trust progression)

#### What's Built (2 pages)
- Live / Building / Target table (same as whitepaper)
- Test coverage and infrastructure facts
- Dashboard views (what the operator actually sees)

#### The World Model (3 pages)
- What it is mechanistically (not just conceptually)
- Observation: how events become objects
- Estimation: how beliefs work, what confidence means
- Prediction: concrete targets with types and horizons
- Calibration: how trust in predictions is verified
- No circular definitions. If you claim "the world model makes agents intelligent," explain the mechanism.

#### Why This Wins (2 pages)
- Competitive landscape table
- Moat analysis: data flywheel, trust lock-in, engineering depth, cross-domain compounding
- Platform threat rebuttal (honest, nuanced)

#### Commercial Model (1 page)
- Pricing table with actual prices
- Unit economics
- GTM sequence

#### The Vision (2 pages)
- Where this goes: from Stripe-first AR to multi-domain enterprise autonomy platform
- Phased roadmap (3 phases, earned expansion)
- Explicitly labeled as vision, not current capability

### Writing Rules (both docs)
- No em dashes
- No "not X, but Y" constructions
- No semicolons joining independent clauses
- No blockquote callouts (the current ones scream AI)
- No "leveraging," "cutting-edge," "revolutionary," "paradigm," "synergy"
- No "we believe" or "we think" -- state claims, back with evidence
- Short sentences. Active voice. Numbers over adjectives.
- One idea per paragraph. 3-5 sentences max.

## Implementation Order

1. Write ARCHITECTURE.md first (it's the source of truth)
2. Extract EXPLAINER.md from it (simplified, reframed for broader audience)

## Success Criteria

- A technical evaluator reads ARCHITECTURE.md and says "they know what they're doing and they're honest about where they are"
- A product-minded investor reads EXPLAINER.md and understands the system without needing engineering background
- Both documents are internally consistent with each other and with the whitepaper
- No claim in either document contradicts the actual codebase
- Every cutting-edge technique is named with specific library/paper, not buzzwords
