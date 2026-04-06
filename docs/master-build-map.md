# Master Build Map

## Purpose

This is the canonical development standard for building Nooterra into a real enterprise world-runtime company.

It is not a pitch deck.
It is not a loose roadmap.
It is not a research note.

It is the operating specification for how to build:

- a real product
- a real control system
- a real software company
- a real operational platform

The standard applies to product, backend, runtime, data, ML, security, infrastructure, operations, and company-building work.

If a proposed feature, refactor, or milestone conflicts with this document, this document wins unless it is explicitly superseded.

---

## Core Position

Nooterra is not an agent wrapper.
Nooterra is not a prompt layer.
Nooterra is not a dashboard over disconnected APIs.

Nooterra is a **policy-constrained, uncertainty-aware, intervention-driven enterprise control system** built on top of a persistent business world model.

The system exists to answer six questions better than a human operator:

1. What is true right now?
2. What is likely to happen next?
3. What would happen if we act?
4. What is allowed?
5. What should be done now?
6. When should the system abstain and ask a human?

That means the system must be stronger than typical AI products in six dimensions:

- memory
- consistency
- calibration
- side-effect reasoning
- governance
- replayability

---

## What “Real” Means

The system is only considered real when all of the following are true:

- It acts from connected system state, not only natural-language setup.
- It is fail-closed on missing evidence, missing auth, missing provenance, or high uncertainty.
- It records expected effects before action and compares them to observed effects later.
- It produces deterministic machine-readable artifacts at every safety-critical step.
- It supports replay, audit, and incident review without depending on ephemeral process memory.
- It can be operated by a small but serious team serving design partners and paying customers.

The system is **not** considered real merely because:

- an LLM can draft an action
- a planner can rank tasks
- a dashboard looks convincing
- the codebase contains ambitious concepts

---

## Company Standard

The company itself must be built as seriously as the software.

Nooterra needs all of the following to become real:

- clear initial ICP
- consistent product positioning
- design-partner operating motion
- onboarding discipline
- billing discipline
- support workflow
- security posture
- observability
- incident handling
- product analytics
- release discipline
- deployment discipline
- reproducible environments
- real documentation

Every engineering milestone must answer:

- what customer problem is solved
- what system capability is added
- what risk is reduced
- how success is measured

---

## Product Definition

### Initial Product

The first real product is:

**Stripe-first governed AR and finance-ops control**

The first user flow is:

1. Connect Stripe
2. Materialize company state
3. Review overdue/risky invoices
4. Launch the AR runtime in shadow mode
5. Review proposed actions through the action gateway
6. Observe outcomes and allow autonomy to expand only from evidence

### Immediate Buyers

The initial buyer is not “every company.”

The initial buyer is:

- founder-led SMB
- finance ops lead
- controller
- head of revenue operations
- operator responsible for collections, billing follow-up, disputes, or payment coordination

### Initial Promise

The initial promise is:

**Connect Stripe, understand what is happening in your receivables, and safely govern what happens next.**

### Non-Goals for the Initial Product

- no fake Gmail world-model source
- no multi-domain “AI employee” promise
- no broad autonomous external sends by default
- no generic team generator as the main product
- no pretending simulation is universal before it is domain-specific and measured

---

## Product Principles

### 1. Simplicity at the surface, sophistication underneath

The user experience must stay simple enough for a non-technical operator.

Users should not need to understand:

- prompt design
- graph schemas
- agent routing
- autonomy math
- model calibration

Users should experience:

- connected systems
- company state
- what needs attention
- what Nooterra wants to do
- why it wants to do it
- whether it is safe to allow

### 2. No fake state

If data is not live, the UI must say so.
Never fabricate coverage, projections, actions, or health state to make the product feel complete.

### 3. No autonomy without evidence

No action class may become more autonomous without:

- persisted execution history
- persisted grade history
- persisted incident history
- persisted uncertainty handling
- promotion evidence

### 4. No LLM as source of truth

The LLM can:

- extract
- summarize
- explain
- draft
- propose

The LLM cannot be:

- the canonical memory
- the policy authority
- the trust assignment system
- the source of company state

### 5. Build from one domain outward

Depth before breadth.

The order is:

- AR collections
- finance control plane
- multi-source company state
- domain packs
- domain-agnostic enterprise control

---

## Canonical System Model

Nooterra is built from five coupled models:

1. **World Model**
   Persistent observed and estimated company state

2. **Causal Intervention Model**
   What changes if action A is taken instead of action B

3. **Policy Model**
   What is allowed, forbidden, escalated, reversible, or high-risk

4. **Operator Model**
   What the AI runtime is currently competent to do safely

5. **Objective Model**
   What the company is optimizing under constraints

The runtime loop is:

**Observe -> Model -> Predict -> Simulate -> Plan -> Act -> Evaluate -> Learn**

---

## Canonical Engineering Layers

Each layer below is required.
Each has explicit standards.

### Layer 1: Observation Plane

#### Purpose

Continuously ingest source-system events and normalize them into tenant-scoped, typed observations.

#### Required Capabilities

- webhooks
- polling
- sync cursors
- idempotent ingest
- provenance tracking
- raw payload retention
- extraction confidence
- failure retries
- dead-letter handling

#### Required Sources by Phase

Phase 1:

- Stripe only

Phase 2:

- Gmail or email/conversation source
- accounting source
- CRM source

Phase 3:

- support platform
- calendar/tasks
- documents/contracts

#### Standards

- Every inbound source event gets a stable dedupe key.
- Raw payloads are retained or referenced before transformation.
- Tenant identity must be explicit and fail closed if missing.
- Connector state must survive process restarts.
- Every connector must support resumption from last good cursor.

#### Definition of Done

- no duplicate world events for duplicate source deliveries
- replay-safe ingest
- connector-specific tests for malformed payload, duplicate payload, missing tenant, and retry behavior

---

### Layer 2: Temporal Event Ledger

#### Purpose

Maintain the immutable, append-only business history.

#### Required Capabilities

- append-only writes
- per-tenant hash chain
- bi-temporal semantics
- causal references
- object references
- event querying
- object history reconstruction
- replay support

#### Standards

- events are never mutated in place
- corrections are represented as new events
- hash chain integrity is verifiable
- write path must be deterministic where contractually required
- events must preserve provenance and confidence

#### Definition of Done

- replay over the ledger can reconstruct downstream state
- chain verification succeeds under repeated runs
- missing or invalid provenance fails closed where required

---

### Layer 3: Canonical Object Graph

#### Purpose

Represent the nouns of the business as typed, versioned objects and relationships.

#### Required Capabilities

- canonical object types
- object versioning
- relationship graph
- tenant isolation
- search
- history
- provenance linking back to ledger
- entity resolution

#### Initial Canonical Types

Phase 1:

- party
- invoice
- payment
- dispute
- obligation

Phase 2:

- credit
- refund
- task
- approval
- action proposal

Phase 3:

- conversation
- message
- contract
- opportunity
- account

#### Standards

- observed state and estimated state remain separate
- object updates must be explainable from events
- relationships carry type and strength
- object listing/search must be tenant-scoped

#### Definition of Done

- object state can be traced back to ledger events
- object history is reconstructable
- entity conflicts can be represented explicitly instead of silently overwritten

---

### Layer 4: Beliefs, Predictions, and Calibration

#### Purpose

Represent hidden state and future state with explicit uncertainty and calibration.

#### Required Capabilities

- durable beliefs
- durable prediction history
- durable prediction outcomes
- calibration reporting
- confidence intervals
- drift detection
- OOD detection
- fallback behavior when sidecar/model is unavailable

#### Standards

- beliefs are first-class records, not only denormalized JSON
- predictions are versioned and timestamped
- observed outcomes are linked back to specific predictions
- uncertainty metadata must be preserved, not discarded
- sidecar/model failure must lower autonomy, not silently continue as if confidence were unchanged

#### Definition of Done

- predictions can be inspected historically
- outcomes can be joined back to predictions
- calibration reports are reproducible
- drift and OOD alter runtime behavior, not only monitoring

---

### Layer 5: Action Ontology

#### Purpose

Represent actions as causal business interventions, not bare tool calls.

#### Required Capabilities

- typed action classes
- preconditions
- expected effects
- side-effect surface
- blast radius
- reversibility
- outcome delay
- outcome signals
- default intervention confidence

#### Standards

- every external-effect action must have a registered action type
- unsupported action types fail closed
- action types include observability expectations
- expected effects must be storable and comparable to actual outcomes later

#### Definition of Done

- the gateway uses action types, not string heuristics alone
- simulation and replay are action-type aware
- action class metadata is queryable and stable

---

### Layer 6: Policy Runtime and Authority System

#### Purpose

Control what the system may do, on whose authority, and under what constraints.

#### Required Capabilities

- tenant auth
- user auth
- authority grants
- delegated authority
- budget limits
- policy overrides
- structured constraints
- approval requirements
- deny rules
- disclosure rules

#### Standards

- no bypass paths for risky or paid actions
- child authority only attenuates parent authority
- tenant mismatch fails closed
- production write routes require authenticated context
- policy evaluation must be auditable

#### Definition of Done

- every action can explain why it was allowed, denied, or escrowed
- grant lineage is reconstructable
- policy decisions are reproducible under replay

---

### Layer 7: Action Gateway

#### Purpose

Serve as the single chokepoint for external or risky side effects.

#### Required Capabilities

- validation
- rate limits
- budget checks
- disclosure enforcement
- simulation
- escrow decisions
- execution logging
- release/rejection flow
- evidence bundles
- replay-ready persistence

#### Standards

- gateway is always on the control path for external-effect actions
- all safety-critical steps must be persisted, not only returned in memory
- every gateway result produces machine-readable artifacts
- missing simulation or insufficient uncertainty support must degrade to approval or denial

#### Definition of Done

- every governed action has a durable gateway row
- preflight and simulation are persisted
- approval release preserves audit continuity
- no external action can occur without passing the gateway

---

### Layer 8: Objective Model and Planner

#### Purpose

Move from “what is likely next?” to “what should be done under explicit objectives and constraints?”

#### Required Capabilities

- tenant-scoped weighted objectives
- hard constraints
- uncertainty penalty
- deterministic candidate ranking
- action scoring
- planner summary
- reactive planning in Phase 1
- short-horizon planning in later phases

#### Standards

- objectives are explicit and persisted
- planner output is deterministic for fixed inputs
- uncertainty reduces score
- hard constraints can remove candidates entirely
- planner must not invent action classes not supported by the ontology

#### Definition of Done

- plan output can be replayed from the same state snapshot
- planner scoring is explainable
- top-ranked actions align with real operator judgment in pilot review

---

### Layer 9: Operator Model and Earned Autonomy

#### Purpose

Track what the runtime is currently competent to do and enforce autonomy accordingly.

#### Required Capabilities

- persisted coverage cells
- persisted autonomy decisions
- promotion proposals
- demotion on incidents
- abstention on uncertainty or drift
- per-action-class autonomy
- per-object-type autonomy

#### Standards

- autonomy enforcement must use persisted state
- critical incidents demote immediately
- uncertainty can cap effective autonomy below nominal autonomy
- promotion is recommendation-first, not silent escalation

#### Definition of Done

- autonomy level affects runtime behavior
- autonomy history survives restarts
- promotion/demotion can be audited after the fact

---

### Layer 10: Feedback Loop, Effect Tracking, and Replay

#### Purpose

Measure whether actions caused the expected change and whether the system’s decision quality is improving.

#### Required Capabilities

- expected effect persistence
- delayed outcome observation
- effect comparison
- action outcome records
- replay endpoints
- watcher jobs
- objective achievement scoring
- side-effect recording

#### Standards

- expected effects are recorded before or at proposal time
- actual effects are computed from real object state and ledger events later
- replay exposes action, expected effects, observed effects, and verdict
- watcher logic must be deterministic for a fixed `asOf` time and dataset

#### Definition of Done

- the system can answer “what did we think would happen?”
- the system can answer “what actually happened?”
- the system can answer “did that intervention work?”

---

### Layer 11: Runtime Packs

#### Purpose

Package domain-specific operational behavior behind a stable, simple product surface.

#### Initial Runtime Packs

Phase 1:

- AR collections

Phase 2:

- disputes
- refunds
- credits/write-offs
- payment plans

Phase 3:

- finance ops suite
- support ops
- revops

#### Standards

- runtime packs expose simple business outcomes, not technical primitives
- each runtime pack declares:
  - supported action classes
  - objective defaults
  - policy defaults
  - approval defaults
  - allowed sources
- non-technical users do not need to hand-assemble workers

#### Definition of Done

- users can provision a runtime pack without writing prompts
- the runtime pack’s control path is fully governed

---

### Layer 12: Product UX and Dashboard

#### Purpose

Make the system usable by real operators without leaking internal complexity.

#### Required Surfaces

- onboarding
- company state
- runtime overview
- predictions
- approval queue
- policy runtime
- autonomy map
- action replay
- simulation / what-if
- incident review

#### Standards

- no fake data in production surfaces
- empty states are explicit
- language is runtime-first and world-model-first
- “agents/workers” are internal implementation details unless the user is technical
- approvals show evidence, not only buttons

#### Definition of Done

- a non-technical operator can connect Stripe and understand the first recommended action
- the UI reveals why an action is proposed and why it is blocked or escalated

---

### Layer 13: Support, Admin, and Internal Operations

#### Purpose

Allow a small company to actually operate the product.

#### Required Capabilities

- partner onboarding checklist
- incident queue
- customer activity timelines
- billing support tooling
- runtime support tooling
- internal overrides with audit trails
- replay and evidence export

#### Standards

- support actions must be auditable
- internal operators use the same state system wherever possible
- no “support by database guessing” as standard practice

#### Definition of Done

- incidents can be diagnosed with product-native evidence
- partner onboarding does not depend on ad hoc memory

---

## Security and Compliance Standard

This company will hold business state, financial state, action history, and approval data.
Security is core product functionality.

### Required Controls

- tenant isolation at every data path
- authenticated writes
- least-privilege service credentials
- secret rotation
- database backups and restore drills
- audit logging
- environment separation
- API abuse controls
- secure webhook verification
- encryption at rest and in transit

### Required Security Workstreams

Phase 1:

- tenant auth hardening
- write-route auth hardening
- secrets inventory
- backup policy
- restore drill
- incident-response runbook

Phase 2:

- SSO/SCIM for enterprise
- granular RBAC
- data retention/deletion workflows
- key rotation automation
- external security review

Phase 3:

- compliance program sized to customers
- formal change management
- vendor-risk review process

### Definition of Done

- the company can explain its trust boundaries in detail
- no critical path depends on shared human knowledge

---

## Infrastructure Standard

### Current Direction

- dashboard on Vercel
- runtime and auth on Railway
- Postgres as system of record
- object storage for evidence
- Sentry
- PostHog
- Resend
- Stripe

### Required Infrastructure Capabilities

- repeatable environments
- managed Postgres with PITR
- alerting
- structured logs
- environment-specific secrets
- deploy rollback path
- scheduler reliability
- job monitoring
- object storage
- metrics on gateway, runtime, watcher, and connector paths

### Standards

- do not rewrite frameworks for vanity reasons
- optimize for reliability and operational clarity before benchmark-driven micro-optimizations
- any background job must be restart-safe and idempotent

---

## ML and Evaluation Standard

The ML system is part of the product, not a side experiment.

### Required Evaluation Domains

- prediction quality
- calibration quality
- side-effect prediction quality
- intervention effect quality
- planner recommendation quality
- approval routing quality
- autonomy promotion quality
- replay accuracy

### Required Artifacts

- model version
- feature version
- training window
- evaluation set
- calibration report
- rollback path

### Standards

- no model upgrade without offline evaluation
- no autonomy upgrade based on model change alone
- rules remain available as fallbacks
- unknown distributions reduce autonomy

### Long-Term Research Standard

By the time Nooterra claims to be state of the art, it should have:

- its own benchmark suite
- reproducible evaluation harnesses
- intervention-effect experiments
- counterfactual replay experiments
- internal reports on domain transfer quality

---

## Development Workflow Standard

Every material feature must follow this flow:

1. write the product intent
2. define the failure mode
3. define the data contract
4. define the audit artifact
5. define the tests
6. implement the smallest real slice
7. run targeted tests
8. instrument it
9. document it
10. only then expand scope

### Required Per-Feature Deliverables

- code
- migration, if schema changes
- route contract, if API changes
- tests
- docs
- rollout note

### Required Review Questions

- how does this fail closed?
- what is the tenant boundary?
- what artifacts are persisted?
- how is uncertainty represented?
- what are the deterministic guarantees?
- how would this be replayed during an incident?

---

## Testing Standard

### Required Test Classes

- unit tests
- route tests
- integration tests
- fail-closed tests
- determinism tests
- replay tests
- tenancy-isolation tests
- migration/bootstrap parity tests where applicable

### Safety-Critical Paths Must Test

- missing tenant
- malformed body
- stale auth
- unsupported action class
- missing evidence
- sidecar unavailable
- drift/OOD
- denied policy
- approval required
- replay after restart

### Operational Paths Must Test

- scheduler restart
- duplicate webhook delivery
- watcher idempotency
- release/reject flow
- calibration persistence

---

## Data and Migration Standard

### Rules

- migrations are additive and backward-safe by default
- new durable behavior requires schema before feature
- process memory is never the source of truth for safety-critical runtime state
- denormalized fields may exist, but durable source records must exist first

### Required Tables by Maturity

Already required:

- world_events
- world_objects
- world_relationships
- gateway_actions
- world_beliefs
- world_predictions
- world_prediction_outcomes
- world_autonomy_coverage
- world_autonomy_decisions
- tenant_objectives
- world_action_outcomes
- world_action_effect_observations

Later required:

- action budgets
- intervention experiments
- counterfactual replay sets
- model release registry

---

## Release and Rollout Standard

### Every New Capability Must Have

- activation strategy
- rollback strategy
- monitoring strategy
- incident owner
- customer-facing truthfulness standard

### Staged Rollout

1. local and targeted tests
2. internal staging
3. design partner shadow mode
4. limited approval-first rollout
5. narrower autonomous rollout after evidence

Never skip straight from “it works locally” to “it runs autonomously for customers.”

---

## Company-Building Standard

Nooterra needs more than engineers and code.

### Required Functions

- product / founder
- backend / platform engineering
- frontend / product engineering
- ML / evaluation
- design
- support / customer success
- ops / reliability
- security / compliance ownership

At the start, one person may cover multiple functions.
That does not remove the need for those functions.

### Required Company Systems

- support tooling
- onboarding process
- incident process
- weekly product review
- analytics review
- design-partner review
- release checklist
- architecture review
- documentation ownership

---

## Priority Build Streams

These streams should run in order of dependency, with some parallelism where safe.

### Stream A: Wedge Excellence

- Stripe ingest
- company state
- AR runtime
- approval queue
- real action evidence
- realized outcomes

### Stream B: Control-System Completion

- full gateway
- budgets
- temporal policy constraints
- watcher automation
- effect-aware evaluation
- autonomy tied to measured intervention quality

### Stream C: Finance Control Plane

- disputes
- refunds
- credits
- write-offs
- payment plans
- finance-specific simulation

### Stream D: Operations Maturity

- support tooling
- admin tooling
- incident review
- observability
- billing self-service
- analytics discipline

### Stream E: Multi-Source State

- Gmail/conversations
- CRM
- accounting
- support
- entity resolution
- cross-system effects

### Stream F: Research and Frontier

- intervention-effect learning
- counterfactual replay
- short-horizon control planning
- benchmark suite
- domain transfer

---

## What Is Explicitly Deferred

The following should not distract the core build order:

- framework rewrites for prestige
- fake broad “AI employee” packaging
- six shallow domains at once
- aggressive enterprise surface area before the wedge is proven
- autonomy claims unsupported by replayable evidence

---

## Definition of Success

Nooterra succeeds when it can truthfully say:

- we maintain a live business world model
- we know what we observed vs what we inferred
- we know what we predicted vs what actually happened
- we know what actions were safe, unsafe, effective, or ineffective
- we know what autonomy has been earned and why
- we can replay and audit critical decisions
- non-technical operators can use the system to run real business workflows

That is the bar.

---

## Code Reality

Yes, this system requires a lot of code.

Not because complexity is fashionable, but because the real system includes:

- connectors
- ledger
- graph
- beliefs
- prediction history
- calibration
- action ontology
- gateway
- policy runtime
- autonomy persistence
- effect tracking
- replay
- watcher jobs
- planner
- runtime packs
- dashboard
- admin tooling
- billing
- auth
- observability
- support tooling

The right question is not “is this a lot of code?”

The right question is:

**Is every layer necessary to build a real, auditable, governed enterprise control system?**

For this company, the answer is yes.
