# Nooterra Architecture: The Enterprise World Runtime

## Thesis

Nooterra is the first executable company. Not an agent framework. Not a governance wrapper. A system that maintains a live causal model of a business, simulates consequences of actions before taking them, and operates through governed agents that earn autonomy from traced performance — not calendar time.

Input: capital, objectives, policies, constraints, data access.
Output: a living company model that can sell, fulfill, collect, comply, negotiate, schedule, and redesign itself.

The defensible invention is not "better agents." It is **programmable delegation**: a business can provision a governed operator the way it provisions a database — identity, permissions, budget, memory, world model access, and liability envelope in one step.

---

## The Loop

Everything in the system serves one closed loop:

```
OBSERVE → MODEL → PREDICT → PLAN → ACT → EVALUATE → LEARN
    ↑                                                    |
    └────────────────────────────────────────────────────┘
```

Each pass through the loop makes the system more accurate and more autonomous. The loop runs continuously, not on human request.

---

## System Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │           HUMAN GOVERNANCE COCKPIT          │
                    │   policy editor · approvals · "what if?" ·  │
                    │   incident replay · autonomy controls       │
                    └──────────────────┬──────────────────────────┘
                                       │
┌──────────────┐              ┌────────┴────────┐           ┌──────────────────┐
│  OBSERVATION │              │    PLANNER &     │           │  INTER-COMPANY   │
│    PLANE     │              │   OPTIMIZER      │           │    NETWORK       │
│              │              │                  │           │                  │
│ connectors   │              │ objectives       │           │ identity         │
│ extraction   │              │ allocation       │           │ negotiation      │
│ CDC/webhooks │              │ MPC control      │           │ settlement       │
│ normalization│              │ priority scoring │           │ registry         │
└──────┬───────┘              └────────┬─────────┘           └────────┬─────────┘
       │                               │                              │
       ▼                               ▼                              │
┌──────────────┐   ┌──────────────┐   ┌──────────────┐               │
│  TEMPORAL    │   │ CANONICAL    │   │   AGENT      │               │
│  EVENT       │◄──│ OBJECT       │◄──│   RUNTIME    │◄──────────────┘
│  LEDGER      │──►│ GRAPH        │──►│              │
│              │   │              │   │ context      │
│ append-only  │   │ typed objects│   │ assembly     │
│ provenance   │   │ relationships│   │ tool use     │
│ snapshots    │   │ bi-temporal  │   │ sessions     │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                   │
       ▼                  ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│    STATE     │   │ WORLD MODEL  │   │   ACTION     │
│  ESTIMATOR   │──►│  ENSEMBLE    │   │   GATEWAY    │
│              │   │              │   │              │
│ beliefs      │   │ rules        │   │ policy check │
│ conflicts    │   │ probabilistic│   │ escrow       │
│ hidden state │   │ causal       │   │ simulation   │
│ truth maint. │   │ simulation   │   │ rollback     │
└──────────────┘   └──────────────┘   └──────┬───────┘
                                              │
┌──────────────┐   ┌──────────────┐           ▼
│   POLICY &   │   │ EVALUATION & │    ┌──────────────┐
│  AUTHORITY   │──►│   LEARNING   │    │  EXTERNAL    │
│   ENGINE     │   │              │    │  WORLD       │
│              │   │ traces       │    │              │
│ auth graph   │   │ grading      │    │ email, CRM   │
│ DSL compiler │   │ replay       │    │ payments     │
│ budget ctrl  │   │ shadow mode  │    │ calendar     │
│ disclosure   │   │ calibration  │    │ phone, docs  │
└──────────────┘   └──────────────┘    └──────────────┘
```

---

## Layer 0: Observation Plane

**Purpose:** Continuously ingest everything happening in and around the business. Transform raw source data into typed events over canonical objects.

### Connectors

Each connector maintains a sync cursor and produces normalized events:

| Source | Connector Type | Objects Produced |
|--------|---------------|------------------|
| Gmail / Outlook | Webhook + polling | Message, Conversation, Party |
| Google Cal / Outlook Cal | Webhook | ScheduleSlot, Party |
| Salesforce / HubSpot | CDC + REST | Party, Deal, Opportunity, Relationship |
| QuickBooks / Xero | Webhook + polling | Invoice, Payment, Account, Party |
| Zendesk / Intercom | Webhook | Ticket, Message, Conversation, Party |
| Stripe / bank feeds | Webhook | Payment, Charge, Refund, Dispute |
| Google Drive / Dropbox | Webhook | Document, Version |
| Slack / Teams | Event API | Message, Channel, Reaction |
| Twilio / phone | Webhook | Call, Transcript, Party |
| Web / browser | Instrumentation | PageView, FormSubmission, Click |

### Extraction Pipeline

```
Raw source event
    → Connector normalizes to SourceEvent
    → Extractor identifies entities (LLM + rules)
    → Resolver maps entities to canonical objects (or creates new)
    → Typed WorldEvents emitted to ledger
    → Object graph updated
```

### Key Types

```typescript
interface SourceEvent {
  id: string;
  connector: ConnectorType;
  sourceId: string;              // ID in source system
  raw: unknown;                  // Original payload
  receivedAt: Date;
  cursor: string;                // Sync cursor for resumption
}

interface Connector {
  type: ConnectorType;
  tenantId: string;
  credentials: EncryptedCredentials;
  syncCursor: string;
  status: 'active' | 'paused' | 'error';
  lastSyncAt: Date;
  
  poll(): AsyncIterable<SourceEvent>;
  handleWebhook(payload: unknown): SourceEvent[];
}
```

### Design Decisions

- **Connectors are stateless processors.** State lives in the sync cursor stored in the DB.
- **Extraction uses LLM for unstructured (email bodies, call transcripts) and rules for structured (API responses).** LLM extraction results are stored with `confidence` and `extractionMethod`.
- **Every observation is written to the ledger before any downstream processing.** If extraction fails, the raw event is still recorded.
- **Connectors run on a per-tenant schedule.** High-priority sources (email, payments) poll more frequently than low-priority (documents, browser).

---

## Layer 1: Temporal Event Ledger

**Purpose:** Append-only, immutable log of every observation and every action. The single source of temporal truth. All downstream state is a projection of this ledger.

### Event Schema

```typescript
interface WorldEvent {
  id: string;                    // ULID (time-ordered)
  tenantId: string;
  type: EventType;               // e.g. 'email.received', 'invoice.created', 'payment.completed'
  timestamp: Date;               // When it happened in the real world
  recordedAt: Date;              // When we recorded it
  source: EventSource;           // Which connector/agent/human produced this
  objectRefs: ObjectRef[];       // Objects touched by this event
  payload: Record<string, unknown>;
  confidence: number;            // 0-1, how certain we are this happened
  provenance: Provenance;
  causedBy?: string;             // ID of event/action that caused this
  hash: string;                  // Content hash for tamper detection
  previousHash: string;          // Chain integrity
}

interface EventSource {
  type: 'connector' | 'agent' | 'human' | 'system';
  id: string;                    // Connector ID, agent ID, user ID
  method: string;                // 'webhook', 'poll', 'tool_call', 'manual'
}

interface Provenance {
  sourceSystem: string;          // 'gmail', 'stripe', 'salesforce'
  sourceId: string;              // ID in source system
  extractionMethod: 'api' | 'llm' | 'rule' | 'human';
  extractionConfidence: number;
  rawRef?: string;               // Reference to raw SourceEvent
}

interface ObjectRef {
  objectId: string;
  objectType: ObjectType;
  role: string;                  // 'sender', 'recipient', 'subject', 'target'
}
```

### Event Types (taxonomy)

```
communication.*    email.received, email.sent, call.started, call.ended, 
                   message.received, message.sent, meeting.scheduled
financial.*        invoice.created, invoice.sent, payment.received, 
                   payment.sent, refund.issued, dispute.opened
commercial.*       deal.created, deal.advanced, deal.won, deal.lost,
                   order.placed, order.fulfilled, order.cancelled
document.*         document.created, document.signed, document.shared,
                   contract.executed, contract.expired
operational.*      task.created, task.completed, task.failed,
                   appointment.scheduled, appointment.completed
relationship.*     party.created, relationship.established, 
                   relationship.changed, party.merged
agent.*            agent.action.proposed, agent.action.executed,
                   agent.action.blocked, agent.action.rolled_back
system.*           policy.changed, authority.granted, authority.revoked,
                   model.prediction, state.conflict_detected
```

### Operations

```typescript
interface EventLedger {
  // Write
  append(event: WorldEvent): Promise<void>;
  appendBatch(events: WorldEvent[]): Promise<void>;
  
  // Read
  getEvent(id: string): Promise<WorldEvent>;
  query(filter: EventFilter): AsyncIterable<WorldEvent>;
  getObjectHistory(objectId: string, range?: TimeRange): Promise<WorldEvent[]>;
  getEventChain(fromId: string): Promise<WorldEvent[]>;  // causal chain
  
  // Snapshots
  snapshot(tenantId: string, at: Date): Promise<Snapshot>;
  restoreSnapshot(snapshot: Snapshot): Promise<void>;
  
  // Integrity
  verifyChain(tenantId: string, range: TimeRange): Promise<ChainVerification>;
}
```

### Design Decisions

- **Events are immutable.** Corrections are new events that reference the original via `causedBy`. Never update or delete events.
- **Hash chain per tenant.** Each tenant's events form a tamper-evident chain. Breaks in the chain are detectable.
- **Bi-temporal.** Every event has both `timestamp` (when it happened) and `recordedAt` (when we learned about it). This matters for late-arriving data.
- **Storage: Postgres with partitioning by tenant + time.** Events table is append-only. Indexes on `(tenantId, type, timestamp)` and `(tenantId, objectRefs)`.

---

## Layer 2: Canonical Object Graph

**Purpose:** Typed, versioned, relationship-rich representation of every entity the business interacts with. Objects exist independently of any process — they are the nouns of the business.

### Core Object Types

```typescript
// Every object in the system extends this
interface WorldObject {
  id: string;                    // Stable ULID
  tenantId: string;
  type: ObjectType;
  version: number;               // Monotonic version counter
  state: ObjectState;            // Type-specific state
  confidence: number;            // Overall belief confidence
  sources: SourceRef[];          // Which systems contribute to this object
  createdAt: Date;
  updatedAt: Date;
  validFrom: Date;               // Bi-temporal: when this version became true
  validTo?: Date;                // Bi-temporal: when this version was superseded
  tombstone: boolean;            // Soft delete
}

type ObjectType =
  // Core business entities
  | 'party'           // Customer, vendor, employee, partner, prospect
  | 'relationship'    // Party-to-party connection
  | 'conversation'    // Email thread, chat thread, call series
  | 'message'         // Single message within a conversation
  | 'document'        // Contract, proposal, report, file
  | 'contract'        // Agreement with terms and obligations
  // Financial
  | 'invoice'         // Financial claim
  | 'payment'         // Money movement
  | 'order'           // Purchase or sale order
  | 'obligation'      // Something owed (payment, delivery, action, response)
  | 'account'         // Financial account (bank, AR, AP)
  | 'budget'          // Financial allocation with limits
  // Operational
  | 'task'            // Internal work item
  | 'schedule_slot'   // Calendar event, appointment, deadline
  | 'asset'           // Owned resource (equipment, IP, subscription)
  | 'ticket'          // Support/service request
  // Strategic
  | 'goal'            // Business objective
  | 'metric'          // Measurable KPI
  | 'risk'            // Identified risk with probability and impact
  | 'deal'            // Sales opportunity
  // Governance
  | 'policy'          // Rule governing behavior
  | 'agent'           // Autonomous operator
  | 'grant'           // Delegated authority
  ;
```

### Object State Schemas (examples)

```typescript
interface PartyState {
  name: string;
  type: 'customer' | 'vendor' | 'employee' | 'partner' | 'prospect';
  identifiers: { system: string; id: string }[];  // Cross-system IDs
  contactInfo: { type: string; value: string }[];
  tags: string[];
  // Estimated (hidden state, from State Estimator)
  estimated: {
    engagementLevel: number;       // 0-1
    churnRisk: number;             // 0-1
    paymentReliability: number;    // 0-1
    lifetimeValue: number;         // USD
    sentiment: number;             // -1 to 1
  };
}

interface InvoiceState {
  number: string;
  amount: number;
  currency: string;
  issuedAt: Date;
  dueAt: Date;
  partyId: string;               // Who owes
  lineItems: LineItem[];
  status: 'draft' | 'sent' | 'viewed' | 'partial' | 'paid' | 'overdue' | 'disputed' | 'written_off';
  payments: string[];            // Payment object IDs
  amountPaid: number;
  amountRemaining: number;
  // Estimated
  estimated: {
    paymentProbability: number;    // P(paid within terms)
    expectedPaymentDate: Date;
    disputeRisk: number;
  };
}

interface ObligationState {
  type: 'payment' | 'delivery' | 'response' | 'action' | 'compliance';
  description: string;
  owedBy: string;                // Party ID
  owedTo: string;                // Party ID
  dueAt: Date;
  status: 'pending' | 'fulfilled' | 'overdue' | 'breached' | 'waived';
  linkedObjects: string[];       // Contract, invoice, order, etc.
  // Estimated
  estimated: {
    fulfillmentProbability: number;
    riskOfBreach: number;
  };
}

interface ConversationState {
  subject: string;
  channel: 'email' | 'chat' | 'phone' | 'meeting' | 'sms';
  participants: string[];        // Party IDs
  messageCount: number;
  lastActivityAt: Date;
  status: 'active' | 'waiting' | 'resolved' | 'stale';
  linkedObjects: string[];       // What this conversation is about
  // Estimated
  estimated: {
    urgency: number;              // 0-1
    sentiment: number;            // -1 to 1
    responseNeeded: boolean;
    expectedResponseBy: Date;
  };
}
```

### Relationships

```typescript
interface Relationship {
  id: string;
  tenantId: string;
  type: RelationType;
  fromId: string;
  fromType: ObjectType;
  toId: string;
  toType: ObjectType;
  properties: Record<string, unknown>;
  strength: number;              // 0-1, how strong/active
  validFrom: Date;
  validTo?: Date;
}

type RelationType =
  | 'customer_of'      // Party → Party
  | 'vendor_of'        // Party → Party  
  | 'employs'          // Party → Party
  | 'manages'          // Party → Party
  | 'about'            // Conversation → any object
  | 'governs'          // Contract → Obligation
  | 'pays'             // Payment → Invoice
  | 'assigned_to'      // Task → Party/Agent
  | 'owns'             // Party → Asset
  | 'delegated_to'     // Grant → Agent
  | 'part_of'          // any → any (composition)
  | 'follows'          // any → any (sequence)
  | 'blocks'           // any → any (dependency)
  | 'risks'            // Risk → any
  ;
```

### Object Graph Operations

```typescript
interface ObjectGraph {
  // CRUD
  create(obj: WorldObject): Promise<WorldObject>;
  update(id: string, patch: Partial<ObjectState>): Promise<WorldObject>;
  get(id: string, at?: Date): Promise<WorldObject>;       // bi-temporal: get state at time
  
  // Graph traversal
  getRelated(id: string, relType?: RelationType): Promise<{ rel: Relationship; obj: WorldObject }[]>;
  traverse(startId: string, depth: number, filter?: TraversalFilter): Promise<SubGraph>;
  shortestPath(fromId: string, toId: string): Promise<Relationship[]>;
  
  // Entity resolution
  merge(ids: string[], canonical: string): Promise<WorldObject>;  // Merge duplicates
  findDuplicates(obj: WorldObject): Promise<WorldObject[]>;
  
  // Querying
  query(filter: ObjectFilter): Promise<WorldObject[]>;
  aggregate(filter: ObjectFilter, agg: Aggregation): Promise<AggResult>;
  
  // History
  getHistory(id: string, range?: TimeRange): Promise<WorldObject[]>;  // All versions
  diff(id: string, v1: number, v2: number): Promise<ObjectDiff>;
  
  // Context assembly (for agents)
  assembleContext(objectIds: string[], depth: number): Promise<ContextBundle>;
}
```

### Design Decisions

- **Bi-temporal versioning.** Every object version has `validFrom`/`validTo`. You can query "what did we believe about Customer X on March 15?" This is essential for audit, replay, and counterfactual analysis.
- **Estimated fields live on objects.** Hidden state (churn risk, payment probability, sentiment) is stored directly on the object, updated by the State Estimator. This means agents always see the latest beliefs when they get context.
- **Entity resolution is continuous.** New observations may reveal that two objects are the same entity. The graph supports merging with full history preservation.
- **Storage: Postgres with JSONB state + separate relationships table.** Indexes on `(tenantId, type)`, `(tenantId, type, state->>'status')`. Relationship table indexed on `(fromId)`, `(toId)`, `(type, tenantId)`.

---

## Layer 3: State Estimator

**Purpose:** The business is not fully observable. CRM says one thing, email says another, the bank says a third, and half the truth is implicit. The State Estimator reconciles contradictions, infers hidden variables, and maintains beliefs with confidence and provenance.

### Core Operations

```typescript
interface StateEstimator {
  // Process new observations
  incorporate(events: WorldEvent[]): Promise<StateUpdate[]>;
  
  // Conflict management
  detectConflicts(objectId: string): Promise<Conflict[]>;
  resolveConflict(conflictId: string, resolution: Resolution): Promise<void>;
  
  // Hidden state inference
  estimateHiddenState(objectId: string): Promise<HiddenStateEstimate>;
  
  // Batch re-estimation (when models improve)
  reestimate(objectIds: string[]): Promise<StateUpdate[]>;
  
  // Truth queries
  getCurrentBelief(objectId: string, field: string): Promise<Belief>;
  getBeliefHistory(objectId: string, field: string): Promise<Belief[]>;
}

interface Belief {
  field: string;
  value: unknown;
  confidence: number;            // 0-1
  sources: SourceContribution[];
  estimatedAt: Date;
  method: 'direct_observation' | 'inference' | 'aggregation' | 'default';
}

interface Conflict {
  id: string;
  objectId: string;
  field: string;
  values: { source: string; value: unknown; observedAt: Date }[];
  suggestedResolution: Resolution;
  autoResolvable: boolean;
}

interface HiddenStateEstimate {
  objectId: string;
  estimates: {
    field: string;
    value: number;
    confidence: number;
    features: string[];          // What inputs drove this estimate
    calibration: number;         // Historical accuracy of this estimator
  }[];
}
```

### Estimation Methods

1. **Direct observation aggregation.** When multiple sources report the same field, use recency + source reliability weighting.
2. **Rule-based inference.** Invoice overdue > 30 days + no response to last 2 emails → payment probability drops. These are deterministic rules from domain knowledge.
3. **Learned inference.** Train small models on historical data to estimate hidden variables: payment propensity, churn risk, response likelihood, dispute probability.
4. **Default priors.** When no data exists, use industry/segment priors. New customer with no history → payment reliability = segment average.

### Design Decisions

- **Conflicts are first-class objects.** When sources disagree, the system creates a Conflict record. Some conflicts auto-resolve (newer observation wins for simple fields). Others require human resolution or domain-specific logic.
- **Hidden state estimates include calibration scores.** The system tracks how accurate each estimator has been historically. If the churn predictor has 0.3 calibration, agents know to weight that estimate accordingly.
- **Re-estimation is batched.** When a model improves or new data arrives that changes priors, the system can re-estimate hidden states for affected objects.

---

## Layer 4: World Model Ensemble

**Purpose:** Given current state, predict what will happen next and what would happen under different interventions. This is the core intellectual property of the system — the reason agents can make good decisions, not just follow scripts.

### Ensemble Components

```typescript
interface WorldModel {
  // Predict what happens next without intervention
  predict(
    objectId: string,
    horizon: Duration,
    conditions?: Condition[]
  ): Promise<Prediction[]>;
  
  // Predict what happens if we take an action
  intervene(
    action: ProposedAction,
    horizon: Duration
  ): Promise<InterventionOutcome>;
  
  // Compare scenarios
  compareScenarios(
    scenarios: Scenario[]
  ): Promise<ScenarioComparison>;
  
  // Full simulation rollout
  simulate(
    tenantId: string,
    actions: ProposedAction[],
    horizon: Duration,
    runs: number                   // Monte Carlo runs
  ): Promise<SimulationResult>;
  
  // Model management
  getCalibration(modelId: string): Promise<CalibrationReport>;
  retrain(modelId: string, data: TrainingData): Promise<void>;
}

interface Prediction {
  objectId: string;
  field: string;
  currentValue: unknown;
  predictedValue: unknown;
  probability: number;
  horizon: Duration;
  confidence: number;
  modelId: string;
  features: FeatureContribution[];  // Explainability
}

interface InterventionOutcome {
  action: ProposedAction;
  directEffects: Effect[];          // Immediate consequences
  cascadeEffects: Effect[];         // Second/third order
  riskAssessment: {
    bestCase: Effect[];
    expectedCase: Effect[];
    worstCase: Effect[];
    probability: { best: number; expected: number; worst: number };
  };
  recommendation: 'proceed' | 'proceed_with_caution' | 'defer' | 'abort';
  reasoning: string;
}

interface Effect {
  objectId: string;
  field: string;
  currentValue: unknown;
  predictedValue: unknown;
  delta: number;                    // Magnitude of change
  probability: number;
  timeToEffect: Duration;
}
```

### Model Types

**1. Deterministic Rules**
For things that follow invariant logic: accounting identities, contract terms, permission checks, deadline calculations, budget arithmetic.

```typescript
interface RuleModel {
  // "If invoice.dueAt < now AND invoice.status = 'sent', then invoice.status = 'overdue'"
  // "If payment.amount >= invoice.amountRemaining, then invoice.status = 'paid'"
  // "If obligation.dueAt < now AND obligation.status = 'pending', then obligation.status = 'breached'"
  evaluate(trigger: WorldEvent, currentState: ObjectState): StateTransition[];
}
```

**2. Probabilistic Sequence Models**
For predicting human/system behavior: will the customer reply? When will they pay? Will this deal close?

```typescript
interface ProbabilisticModel {
  // Trained on historical event sequences per object type
  // Input: object state + recent events + context features
  // Output: probability distribution over next events and timing
  predict(objectState: ObjectState, recentEvents: WorldEvent[]): Distribution;
}
```

**3. Causal / Intervention Models**
For answering "what if?" questions: what happens if we send a reminder? Offer a discount? Escalate? Wait?

```typescript
interface CausalModel {
  // Estimates causal effect of an intervention
  // Uses historical action-outcome pairs, controlling for confounders
  estimateEffect(
    intervention: ProposedAction,
    targetObject: WorldObject,
    context: ContextBundle
  ): CausalEstimate;
}
```

**4. Long-Horizon Simulator**
For scenario planning: what does Q3 look like if we change our collections cadence? What if we lose our top customer?

```typescript
interface Simulator {
  // Monte Carlo rollout of company state under a scenario
  rollout(
    initialState: TenantSnapshot,
    scenario: Scenario,
    horizon: Duration,
    runs: number
  ): SimulationResult;
}
```

### Model Lifecycle

```
Historical data (ledger + outcomes)
    → Feature engineering
    → Model training (small, domain-specific models)
    → Calibration testing
    → Shadow deployment (predict but don't act on predictions)
    → Live deployment with monitoring
    → Continuous calibration (compare predictions to outcomes)
    → Retraining when calibration degrades
```

### Design Decisions

- **Start with rules and heuristics.** V1 world model is mostly deterministic rules + simple statistical models (logistic regression, decision trees). Deep learning comes later with more data.
- **Every prediction includes confidence and calibration.** Agents and the planner can weight predictions by their historical accuracy.
- **Predictions are logged as events.** `system.model.prediction` events allow us to measure prediction accuracy over time.
- **No single monolithic model.** Each object type and each prediction target gets its own model. This makes them independently trainable, testable, and replaceable.

---

## Layer 5: Policy & Authority Engine

**Purpose:** Machine-checkable statements of who delegated what authority to which agent, over which objects, budgets, jurisdictions, counterparties, and time windows. This is the upgraded version of the current charter system.

### Authority Graph

```typescript
interface AuthorityGraph {
  // A DAG from humans → agents → sub-agents
  // Every edge is a Grant with explicit scope
  
  grant(grant: AuthorityGrant): Promise<void>;
  revoke(grantId: string, reason: string): Promise<void>;
  
  // Check if an action is authorized
  check(agentId: string, action: ProposedAction): Promise<AuthorizationDecision>;
  
  // Get effective authority for an agent (union of all active grants)
  getEffectiveAuthority(agentId: string): Promise<EffectiveAuthority>;
  
  // Trace authority chain back to human root
  traceAuthority(grantId: string): Promise<AuthorityChain>;
}

interface AuthorityGrant {
  id: string;
  tenantId: string;
  grantorId: string;              // Human or parent agent
  granteeId: string;              // Agent receiving authority
  parentGrantId?: string;         // For attenuation chains
  
  // Scope
  scope: {
    actionClasses: ActionClass[];     // What they can do
    objectTypes: ObjectType[];        // What they can act on
    objectFilter?: ObjectFilter;      // Specific objects (e.g., invoices < $5000)
    partyFilter?: PartyFilter;        // Which counterparties
    budgetLimit: Money;               // Max spend
    budgetPeriod: Duration;           // Per day/week/month
    jurisdictions?: string[];         // Geographic/legal scope
    timeWindow?: TimeWindow;          // When authority is active
    maxDelegationDepth: number;       // How deep the chain can go
  };
  
  // Constraints
  constraints: {
    requireApproval: ActionClass[];   // askFirst equivalent
    forbidden: ActionClass[];         // neverDo equivalent
    rateLimit?: RateLimit;
    disclosureRequired: boolean;
    auditLevel: 'full' | 'summary' | 'minimal';
  };
  
  // Lifecycle
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  issuedAt: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  revocationReason?: string;
  
  // Integrity
  hash: string;
  parentHash?: string;
  signature: string;               // Grantor's signature
}

type ActionClass =
  | 'communicate.email'
  | 'communicate.chat'
  | 'communicate.phone'
  | 'financial.invoice'
  | 'financial.payment'
  | 'financial.refund'
  | 'financial.quote'
  | 'document.create'
  | 'document.sign'
  | 'document.share'
  | 'schedule.create'
  | 'schedule.modify'
  | 'schedule.cancel'
  | 'task.create'
  | 'task.assign'
  | 'data.read'
  | 'data.write'
  | 'data.delete'
  | 'agent.create'
  | 'agent.modify'
  | 'agent.delegate'
  ;
```

### Policy Compiler

```typescript
interface PolicyCompiler {
  // Compile natural language policy into executable guards
  compile(naturalLanguage: string): Promise<CompiledPolicy>;
  
  // Validate a policy for consistency
  validate(policy: CompiledPolicy): Promise<ValidationResult>;
  
  // Diff two policies
  diff(before: CompiledPolicy, after: CompiledPolicy): Promise<PolicyDiff>;
  
  // Simulate policy against historical actions
  simulate(policy: CompiledPolicy, historicalActions: ProposedAction[]): Promise<SimulationResult>;
}

interface CompiledPolicy {
  id: string;
  version: number;
  source: string;                  // Natural language source
  
  // Deterministic guards (always enforced, no ambiguity)
  guards: PolicyGuard[];
  
  // Judgment modules (LLM evaluates with context)
  judgments: PolicyJudgment[];
  
  // Escalation rules
  escalations: EscalationRule[];
}

interface PolicyGuard {
  id: string;
  description: string;
  condition: PolicyPredicate;      // Deterministic condition
  effect: 'allow' | 'deny' | 'require_approval';
  priority: number;                // Higher priority guards win
}

interface PolicyJudgment {
  id: string;
  description: string;
  triggerCondition: PolicyPredicate;
  evaluationPrompt: string;        // LLM prompt for judgment call
  fallback: 'allow' | 'deny' | 'require_approval';  // If LLM fails
  timeoutMs: number;
}
```

### Authorization Decision Flow

```
ProposedAction arrives
    → Extract: action class, target objects, counterparties, value, timing
    → Load: agent's effective authority (all active grants merged)
    → Check forbidden list → DENY if match
    → Check scope: object type, object filter, party filter, budget, jurisdiction, time
        → DENY if out of scope
    → Check deterministic guards → ALLOW / DENY / REQUIRE_APPROVAL
    → If no guard matched → check judgment modules (LLM)
    → If no judgment matched → default to REQUIRE_APPROVAL
    → If ALLOW → check rate limits and budget → execute
    → If REQUIRE_APPROVAL → queue for human
    → Log decision with full reasoning
```

### Design Decisions

- **Attenuation only narrows.** A child agent's authority is always a subset of its parent's. You cannot delegate authority you do not have.
- **neverDo (forbidden) is immutable from autonomous paths.** Only humans can modify forbidden action lists. Agents can propose changes; humans approve.
- **Policy guards are deterministic.** They run without LLM calls, so they are fast, predictable, and auditable. LLM judgment is only used for ambiguous cases.
- **Every authorization decision is logged.** The full chain — action, authority, guards checked, result — is persisted for audit.
- **Budget tracking is real-time.** Budget utilization is checked and decremented atomically. No race conditions on spend.

---

## Layer 6: Planner & Optimizer

**Purpose:** Given the current world model state, predictions, objectives, and constraints, decide what to do and in what order. This is where the system goes from reactive to strategic.

### Core Abstractions

```typescript
interface Planner {
  // Generate a plan for achieving an objective
  plan(
    objective: Objective,
    worldState: TenantSnapshot,
    constraints: PlanConstraints,
    horizon: Duration
  ): Promise<Plan>;
  
  // Re-plan when conditions change
  replan(
    currentPlan: Plan,
    changedConditions: WorldEvent[]
  ): Promise<Plan>;
  
  // Allocate work across agents
  allocate(
    plan: Plan,
    availableAgents: AgentCapability[]
  ): Promise<WorkAllocation>;
  
  // Priority scoring
  prioritize(
    pendingWork: WorkItem[]
  ): Promise<PrioritizedWork[]>;
}

interface Objective {
  id: string;
  type: ObjectiveType;
  target: ObjectiveTarget;
  weight: number;                  // Relative importance
  horizon: Duration;
  constraints: ObjectiveConstraint[];
}

type ObjectiveType =
  | 'minimize_dso'                 // Days Sales Outstanding
  | 'maximize_collection_rate'
  | 'minimize_response_time'
  | 'maximize_customer_satisfaction'
  | 'minimize_cost'
  | 'maximize_throughput'
  | 'minimize_risk'
  | 'maintain_compliance'
  | 'custom'
  ;

interface Plan {
  id: string;
  objective: Objective;
  horizon: Duration;
  actions: PlannedAction[];
  expectedOutcome: PlanOutcome;
  contingencies: Contingency[];    // If X happens, do Y instead
  
  status: 'draft' | 'approved' | 'active' | 'completed' | 'abandoned';
  createdAt: Date;
  nextReviewAt: Date;
}

interface PlannedAction {
  id: string;
  actionClass: ActionClass;
  targetObjectId: string;
  parameters: Record<string, unknown>;
  scheduledAt: Date;
  deadline: Date;
  priority: number;
  dependencies: string[];          // IDs of actions that must complete first
  assignedAgentId?: string;
  
  // From world model
  expectedEffect: Effect[];
  riskAssessment: { probability: number; impact: number };
}

interface WorkAllocation {
  assignments: {
    agentId: string;
    actions: PlannedAction[];
    estimatedLoad: number;         // 0-1
    estimatedCost: Money;
  }[];
  unassigned: PlannedAction[];     // No capable agent available
  escalations: PlannedAction[];    // Requires human
}
```

### Planning Strategies

**1. Reactive Planning**
Respond to incoming events. Customer emails → plan response. Invoice overdue → plan follow-up. This is the simplest mode and where v1 starts.

**2. Proactive Planning**
Use world model predictions to act before problems occur. Invoice approaching due date + low payment probability → send reminder before it's overdue. Customer engagement declining → schedule check-in.

**3. Optimization**
Multi-objective optimization across the portfolio. Given 100 overdue invoices, which ones should agents prioritize? Weight by: amount, payment probability given intervention, customer value, age, relationship health.

**4. Strategic Planning**
Long-horizon scenario planning. "If we change our collections cadence from 30/60/90 to 15/30/45, what happens to DSO, customer satisfaction, and dispute rate?" Use the simulator.

### Design Decisions

- **Plans are persistent objects.** They are not ephemeral. They are versioned, reviewable, and auditable. Humans can approve, modify, or reject plans.
- **Contingencies are explicit.** A plan can specify "if the customer disputes, switch to escalation sequence" rather than requiring a full re-plan.
- **Work allocation respects authority.** The planner can only assign actions to agents that have the authority to perform them.
- **Priority scoring is a function.** `priority = f(urgency, value, probability_of_success, cost, risk, objective_weight)`. The weights are configurable per tenant.

---

## Layer 7: Agent Runtime

**Purpose:** Execute plans through LLM-powered agents that receive context from the world model, act through the action gateway, and produce traces for evaluation.

### Agent Architecture

```typescript
interface Agent {
  id: string;
  tenantId: string;
  type: AgentType;
  name: string;
  
  // Capabilities
  actionClasses: ActionClass[];
  objectTypes: ObjectType[];
  tools: ToolDefinition[];
  model: string;                   // LLM model ID
  
  // Authority
  grantIds: string[];              // Active authority grants
  
  // State
  status: 'idle' | 'executing' | 'waiting_approval' | 'suspended' | 'error';
  currentSessionId?: string;
  
  // Performance
  stats: {
    totalExecutions: number;
    successRate: number;
    avgCostPerExecution: Money;
    avgDurationMs: number;
    competenceByActionClass: Record<ActionClass, number>;
  };
}

type AgentType =
  | 'domain_worker'     // Handles specific action classes (collections, support, scheduling)
  | 'case_agent'        // Ephemeral agent for a specific case/task
  | 'meta_agent'        // Fleet manager (one per tenant)
  | 'observer'          // Read-only, monitors and reports
  ;
```

### Execution Loop

```typescript
interface AgentRuntime {
  // Execute a planned action
  execute(agent: Agent, action: PlannedAction): Promise<ExecutionResult>;
  
  // Execute a session (multi-turn)
  executeSession(agent: Agent, session: Session): Promise<SessionResult>;
  
  // Resume after approval
  resume(executionId: string, approval: ApprovalDecision): Promise<ExecutionResult>;
}

// The core execution loop:
async function executeAction(agent: Agent, action: PlannedAction): Promise<ExecutionResult> {
  // 1. Assemble context from world model
  const context = await objectGraph.assembleContext(
    [action.targetObjectId],
    depth: 2  // Include related objects
  );
  
  // 2. Load relevant predictions
  const predictions = await worldModel.predict(
    action.targetObjectId,
    Duration.hours(72)
  );
  
  // 3. Load applicable policies
  const authority = await authorityGraph.getEffectiveAuthority(agent.id);
  
  // 4. Construct system prompt
  const systemPrompt = buildSystemPrompt({
    agent,
    context,
    predictions,
    authority,
    action,
  });
  
  // 5. LLM call
  const response = await llm.chat({
    model: agent.model,
    system: systemPrompt,
    messages: session.messages,
    tools: agent.tools,
  });
  
  // 6. For each tool call: route through action gateway
  for (const toolCall of response.toolCalls) {
    const proposedAction = mapToolCallToAction(toolCall, agent, action);
    const result = await gateway.submit(proposedAction);
    
    if (result.status === 'approved' && result.executed) {
      // 7. Update world model with action outcome
      await ledger.append(actionToEvent(proposedAction, result));
    } else if (result.status === 'held') {
      // Waiting for approval or escrow
      return { status: 'waiting', heldActionId: result.id };
    } else if (result.status === 'denied') {
      // Policy blocked it
      // Continue with denial context in conversation
    }
  }
  
  // 8. Emit trace
  await traceEngine.record(executionTrace);
  
  return { status: 'completed', trace: executionTrace };
}
```

### Context Assembly

The critical difference from a standard agent framework: agents do not get raw data. They get a **curated context bundle** assembled from the world model.

```typescript
interface ContextBundle {
  // Target object and its current state (including estimated fields)
  target: WorldObject;
  
  // Related objects (customers, invoices, conversations, etc.)
  related: { relationship: Relationship; object: WorldObject }[];
  
  // Recent relevant events
  recentEvents: WorldEvent[];
  
  // Active predictions about target
  predictions: Prediction[];
  
  // Applicable policies and constraints
  policies: CompiledPolicy[];
  
  // Historical interactions (episodic memory)
  history: {
    previousActions: ActionSummary[];
    previousOutcomes: OutcomeSummary[];
    relevantConversations: ConversationSummary[];
  };
  
  // Planner guidance
  planContext: {
    currentPlan: Plan;
    thisAction: PlannedAction;
    successCriteria: string[];
  };
}
```

### Design Decisions

- **Agents are thin.** The intelligence is in the world model, planner, and context assembly. The agent is an LLM loop that executes within a well-prepared context. This means swapping models is easy.
- **Every tool call goes through the action gateway.** Agents never touch external systems directly.
- **Context assembly is the most important engineering.** The quality of the agent's output is determined by the quality of its context. Bad context = bad actions regardless of model quality.
- **Sessions are durable.** Tasks that span days or weeks maintain session state. The agent can be interrupted, resumed, and can pick up where it left off.

---

## Layer 8: Action Gateway & Escrow

**Purpose:** Single chokepoint between agents and the external world. Every side effect — email sent, payment initiated, document signed, calendar updated — passes through this gateway. This is where policy enforcement, simulation, escrow, rate limiting, and audit happen.

### Gateway Architecture

```typescript
interface ActionGateway {
  // Submit an action for evaluation and possible execution
  submit(action: ProposedAction): Promise<ActionResult>;
  
  // Release an escrowed action
  release(actionId: string, decision: 'execute' | 'cancel'): Promise<ActionResult>;
  
  // Attempt rollback of a completed action
  rollback(actionId: string, reason: string): Promise<RollbackResult>;
  
  // Query action history
  getActionHistory(filter: ActionFilter): Promise<ProposedAction[]>;
}

interface ProposedAction {
  id: string;
  tenantId: string;
  agentId: string;
  grantId: string;
  executionId: string;
  
  // What
  actionClass: ActionClass;
  tool: string;
  parameters: Record<string, unknown>;
  
  // Context
  targetObjectId: string;
  counterpartyId?: string;
  value?: Money;                   // Financial value at risk
  
  // Evidence bundle
  evidence: {
    policyClauses: string[];       // Which policies this satisfies
    factsReliedOn: string[];       // Object IDs used in decision
    toolsUsed: string[];
    uncertaintyDeclared: number;   // Agent's self-assessed uncertainty
    reversiblePath?: string;       // How to undo if needed
    authorityChain: string[];      // Grant IDs from root to this agent
  };
  
  // Gateway adds these
  preflightResult?: PreflightResult;
  simulationResult?: SimulationResult;
  status: 'pending' | 'approved' | 'denied' | 'escrowed' | 'executed' | 'rolled_back' | 'failed';
  executedAt?: Date;
  result?: unknown;
}
```

### Gateway Pipeline

```
ProposedAction arrives
    │
    ├── 1. AUTHENTICATE: Verify agent identity and grant chain
    │
    ├── 2. AUTHORIZE: Check against policy & authority engine
    │      → denied? → log + return denial
    │
    ├── 3. VALIDATE: Check parameters, counterparty, value limits
    │
    ├── 4. RATE LIMIT: Check action frequency limits
    │
    ├── 5. BUDGET CHECK: Verify budget availability, atomic decrement
    │
    ├── 6. DISCLOSURE CHECK: Ensure required disclosures are present
    │      (e.g., "This message was composed by an AI assistant")
    │
    ├── 7. SIMULATE (if enabled for this action class):
    │      Ask world model: "What happens if we do this?"
    │      → high negative impact predicted? → escalate
    │
    ├── 8. ESCROW DECISION:
    │      → Low risk + within authority → EXECUTE immediately
    │      → Medium risk or requires_approval → HOLD in escrow
    │      → High risk → HOLD + notify human
    │
    ├── 9. EXECUTE:
    │      → Call tool/integration
    │      → Capture result
    │      → Record compensating action (for rollback)
    │
    ├── 10. AUDIT:
    │       → Write action event to ledger
    │       → Write evidence bundle
    │       → Update object graph with effects
    │
    └── 11. NOTIFY:
            → Trigger downstream: state estimator, evaluator, planner
```

### Escrow

```typescript
interface EscrowedAction {
  action: ProposedAction;
  escrowReason: 'requires_approval' | 'high_value' | 'high_risk' | 'new_counterparty' | 'policy_judgment';
  heldAt: Date;
  expiresAt: Date;                 // Auto-cancel if not decided
  previewResult?: unknown;         // What the action WOULD produce
  simulationResult?: SimulationResult;
  
  // Resolution
  decidedBy?: string;              // Human or policy
  decision?: 'execute' | 'cancel' | 'modify';
  decidedAt?: Date;
}
```

### Rollback

Not all actions are reversible. The gateway tracks reversibility:

```typescript
interface RollbackCapability {
  actionClass: ActionClass;
  reversibility: 'full' | 'partial' | 'none';
  compensatingAction?: ActionClass;
  timeWindowMs?: number;           // How long after execution rollback is possible
  cost?: Money;                    // Cost of rollback
}

// Examples:
// email.send → reversibility: 'none' (can't unsend)
// calendar.create → reversibility: 'full' (can delete)
// payment.initiate → reversibility: 'partial' (can reverse within window)
// invoice.send → reversibility: 'none'
// task.create → reversibility: 'full'
// document.sign → reversibility: 'none'
```

### Design Decisions

- **One gateway for everything.** No bypasses. Even system-initiated actions go through the gateway (though with elevated authority).
- **Evidence bundles are mandatory for high-value actions.** The agent must declare which policies it satisfies, which facts it relied on, and what uncertainty it has. This is the artifact auditors care about.
- **Escrow is the default for unfamiliar action classes.** First time an agent does something? It's escrowed. After N successful executions of that action class, it can be auto-approved.
- **Disclosure is enforced by the gateway, not trusted to agents.** If policy says "AI-composed communications must include disclosure," the gateway appends the disclosure, not the agent.

---

## Layer 9: Evaluation & Learning Engine

**Purpose:** Grade every execution trace, track prediction accuracy, update models, and expand or contract agent autonomy based on evidence. This is how the system earns trust — not by fiat, but by demonstrated performance.

### Trace Grading

```typescript
interface EvaluationEngine {
  // Grade an execution trace
  grade(trace: ExecutionTrace): Promise<TraceGrade>;
  
  // Grade prediction accuracy
  gradePrediction(prediction: Prediction, actual: WorldEvent): Promise<PredictionGrade>;
  
  // Compute autonomy coverage
  computeCoverage(agentId: string): Promise<AutonomyCoverage>;
  
  // Propose authority changes based on evidence
  proposeAuthorityChange(agentId: string): Promise<AuthorityProposal[]>;
}

interface ExecutionTrace {
  id: string;
  agentId: string;
  executionId: string;
  
  // Full sequence
  steps: TraceStep[];
  
  // Inputs
  contextProvided: ContextBundle;
  planAction: PlannedAction;
  
  // Outputs
  actionsProposed: ProposedAction[];
  actionsExecuted: ProposedAction[];
  actionsBlocked: ProposedAction[];
  
  // Outcomes (filled in later as effects are observed)
  outcomes: ObservedOutcome[];
  
  // Timing
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  
  // Cost
  tokenUsage: { input: number; output: number };
  cost: Money;
}

interface TraceGrade {
  traceId: string;
  
  // Procedural grading (did it follow the right process?)
  procedural: {
    policyCompliance: number;      // 0-1: did it stay within policy?
    contextUtilization: number;    // 0-1: did it use the context well?
    toolUseCorrectness: number;    // 0-1: did it call the right tools with right args?
    disclosureCompliance: number;  // 0-1: did it follow disclosure rules?
    overallProcedural: number;
  };
  
  // Outcome grading (did it achieve the goal?)
  outcome: {
    objectiveAchieved: number;     // 0-1: did the planned objective happen?
    sideEffects: number;           // 0-1: were there unexpected effects?
    costEfficiency: number;        // 0-1: was the cost reasonable?
    overallOutcome: number;
  };
  
  // Combined
  overallGrade: number;            // Weighted combination
  
  // Issues
  issues: TraceIssue[];
  
  // Grading method
  gradedBy: 'automated' | 'human' | 'llm';
  gradedAt: Date;
}
```

### Autonomy Coverage Map

Trust is not a single number. It is a coverage map over action classes, object types, and conditions.

```typescript
interface AutonomyCoverage {
  agentId: string;
  computedAt: Date;
  
  coverage: {
    actionClass: ActionClass;
    objectType: ObjectType;
    conditions: string;            // e.g., "value < $5000, known counterparty"
    
    // Evidence
    totalExecutions: number;
    successRate: number;
    proceduralScore: number;       // Average procedural grade
    outcomeScore: number;          // Average outcome grade
    lastFailureAt?: Date;
    incidentCount: number;
    
    // Current autonomy level
    level: 'forbidden' | 'human_approval' | 'auto_with_review' | 'autonomous';
    
    // Recommendation
    recommendedLevel: 'forbidden' | 'human_approval' | 'auto_with_review' | 'autonomous';
    evidenceStrength: number;      // How confident is the recommendation?
    requiredForPromotion: string;  // What evidence is still needed?
  }[];
}
```

### Replay & Shadow Mode

```typescript
interface ReplayEngine {
  // Replay historical workflow with current agents
  replay(
    historicalEvents: WorldEvent[],
    agent: Agent,
    mode: 'shadow' | 'compare'
  ): Promise<ReplayResult>;
  
  // Shadow mode: agent proposes actions but they're not executed
  shadowRun(
    agent: Agent,
    liveEvents: WorldEvent[]
  ): Promise<ShadowResult>;
  
  // Compare: what would the agent have done vs what actually happened?
  compare(
    agentActions: ProposedAction[],
    actualActions: WorldEvent[]
  ): Promise<ComparisonResult>;
}
```

### Learning Loop

```
Execution trace arrives
    → Procedural grading (automated: policy compliance, tool use, disclosure)
    → Outcome grading (automated + LLM: did it achieve the objective?)
    → Update competence scores for agent × action class
    → Update world model calibration (were predictions accurate?)
    → Check for autonomy promotion/demotion thresholds
    → If promotion candidate: generate AuthorityProposal
    → Human reviews and approves/rejects
    → If approved: update authority grants
```

### Design Decisions

- **Procedural grading is separate from outcome grading.** An agent that gets lucky with a bad process should not be promoted. An agent that follows perfect procedure but hits an unlikely outcome should not be demoted. Both matter.
- **Autonomy promotion requires evidence, not time.** An agent is promoted from `human_approval` to `auto_with_review` when it has N executions with procedural score > 0.9 and outcome score > 0.8 for that specific action class × object type × condition set.
- **Demotion is faster than promotion.** One incident can trigger immediate suspension. Promotion requires sustained evidence.
- **Shadow mode is mandatory before live.** New agents or new action classes must run in shadow mode first, producing traces that are graded before any live execution is authorized.

---

## Layer 10: Human Governance Cockpit

**Purpose:** Humans stop being operators and become governors. The UI exposes live state, predictions, plans, approvals, incidents, and "what if?" simulation. The killer interface is not chat — it is a live view of the company with traceable AI-generated recommendations.

### Views

**1. Company State View**
Live dashboard of the canonical object graph. Key metrics, bottlenecks, risks, and opportunities surfaced by the world model.

**2. Prediction & Forecast View**
What the world model predicts will happen. Cash flow forecasts, pipeline projections, risk alerts, and churn predictions. Each prediction is clickable to see the evidence and confidence.

**3. Plan View**
Active plans, pending actions, and their expected outcomes. Humans can approve, modify, or reject plans.

**4. Approval Queue**
Escrowed actions waiting for human decision. Each action includes: what the agent wants to do, why (evidence bundle), what the world model predicts will happen, and what authority it's acting under.

**5. Autonomy Map**
Visual coverage map: which action classes are autonomous, supervised, or forbidden for each agent. Drill into evidence for each coverage level.

**6. Incident Replay**
When something goes wrong: full trace replay, counterfactual analysis ("what would have happened if the agent had done X instead?"), and root cause identification.

**7. "What If?" Simulator**
Interactive scenario planning. "What happens if we change our collections cadence?" "What if we lose this customer?" "What if we hire two more agents?" Run against the world model and see projected outcomes.

**8. Policy Editor**
Write policies in natural language. See the compiled guards. Test against historical actions. Simulate impact before deploying.

---

## Layer 11: Inter-Company Network

**Purpose:** When multiple companies run Nooterra, their agents can discover, negotiate, and transact with each other. This is the long-term network effect: agent-to-agent commerce.

### Components

**1. Agent Identity & Registry**
Every agent gets a verifiable identity: public key, capabilities, certification tier, SLO history, and authority chain. Third-party agents can be registered and governed.

**2. Capability Discovery**
Agents publish capabilities. Other agents can discover them. "I need someone who can handle invoice disputes for US-based customers under $10,000."

**3. Negotiation Protocol**
Machine-readable offers, counteroffers, and acceptances. Agents negotiate within their authority envelopes. Humans approve deals that exceed agent authority.

**4. Settlement**
When agents transact across companies, settlement happens through the gateway. Both sides log the transaction with evidence bundles.

**5. Shared Market Models**
Aggregated (anonymized) data from many companies can improve prediction models. Industry-specific priors, benchmark data, and risk models.

---

## Memory Architecture

Memory is not a single store. It is five distinct systems:

### 1. Canonical Fact Memory
**What the system currently believes is true.** Stored in the object graph.
- Has provenance, confidence, and temporal versioning
- Updated by the state estimator
- Queryable, diffable, auditable

### 2. Episodic Memory
**What happened.** Stored in the event ledger and execution traces.
- Immutable, append-only
- Full causal chains (event A caused event B)
- Replay-able

### 3. Procedural Memory
**How to do things.** Stored in compiled policies, agent tool configurations, and plan templates.
- Versioned and auditable
- Changes require approval
- Testable against historical data

### 4. Semantic Memory
**Learned patterns and preferences.** Extracted from traces and outcomes.
- "Customer X prefers email over phone"
- "Invoices sent on Tuesday get paid 2 days faster"
- "Discount offers > 10% trigger VP approval at Company Y"
- Each pattern has evidence count and confidence

### 5. Counterfactual Memory
**What simulations predicted and how those predictions compared with reality.**
- "We predicted 85% payment probability but actual was 40%"
- Used to calibrate the world model
- Essential for learning from mistakes

### Memory Governance

```typescript
interface MemoryGovernance {
  // What can be written
  writePolicy: {
    requiresProvenance: boolean;     // Every write must cite its source
    requiresConfidence: boolean;     // Every write must declare confidence
    expirationRequired: boolean;     // Every write must have a TTL or review date
    humanWriteOnly: string[];        // Fields only humans can modify
  };
  
  // What must be forgotten
  retentionPolicy: {
    maxAge: Record<MemoryType, Duration>;
    piiHandling: 'anonymize' | 'delete' | 'flag';
    regulatoryHolds: string[];       // Do not delete these
  };
  
  // Who can read what
  accessPolicy: {
    agentAccess: Record<AgentType, MemoryType[]>;
    crossTenantAccess: 'none' | 'anonymized_aggregate';
  };
}
```

---

## Data Model Summary

### Primary Tables (Postgres)

```
-- Core
world_events           Append-only event ledger
world_objects           Canonical object graph (current state)
world_object_versions   Bi-temporal version history
relationships           Object-to-object relationships
beliefs                 State estimator beliefs with confidence

-- Observation
connectors              Connector configurations and sync state
source_events           Raw source events (before extraction)

-- World Model
predictions             Model predictions (for calibration tracking)
model_registry          Registered prediction models
calibration_scores      Per-model accuracy tracking

-- Policy & Authority
authority_grants        Delegated authority (DAG)
compiled_policies       Compiled policy guards
authorization_log       Every auth decision

-- Agents
agents                  Agent definitions
agent_sessions          Durable multi-turn sessions
executions              Individual execution records

-- Gateway
proposed_actions        Every action submitted to gateway
escrowed_actions        Actions held for approval
action_evidence         Evidence bundles

-- Evaluation
execution_traces        Full execution traces
trace_grades            Grading results
autonomy_coverage       Per-agent coverage maps
authority_proposals     Proposed authority changes

-- Governance
approval_queue          Pending human decisions
incidents               Detected incidents
simulation_runs         "What if?" simulation results

-- Network (future)
agent_registry          Cross-company agent registry
negotiation_records     Inter-agent negotiations
settlement_records      Cross-company settlements
```

---

## Module Structure

```
nooterra/
├── core/
│   ├── types.ts                 # All shared type definitions
│   ├── events.ts                # Event type taxonomy and serialization
│   ├── objects.ts               # Object type schemas
│   ├── errors.ts                # Error taxonomy
│   ├── money.ts                 # Money type (amount + currency)
│   └── duration.ts              # Duration type
│
├── observation/
│   ├── connector.ts             # Base connector interface
│   ├── connectors/
│   │   ├── gmail.ts
│   │   ├── outlook.ts
│   │   ├── google-calendar.ts
│   │   ├── salesforce.ts
│   │   ├── hubspot.ts
│   │   ├── quickbooks.ts
│   │   ├── xero.ts
│   │   ├── stripe.ts
│   │   ├── zendesk.ts
│   │   ├── slack.ts
│   │   ├── twilio.ts
│   │   └── gdrive.ts
│   ├── extraction.ts            # Entity extraction (LLM + rules)
│   ├── normalization.ts         # Source → canonical mapping
│   └── sync-manager.ts          # Connector scheduling and cursor management
│
├── ledger/
│   ├── event-store.ts           # Append-only event storage
│   ├── snapshots.ts             # Point-in-time snapshots
│   ├── chain.ts                 # Hash chain integrity
│   └── queries.ts               # Event querying and filtering
│
├── objects/
│   ├── graph.ts                 # Object graph CRUD and traversal
│   ├── schemas/                 # Per-type schemas
│   │   ├── party.ts
│   │   ├── conversation.ts
│   │   ├── invoice.ts
│   │   ├── payment.ts
│   │   ├── obligation.ts
│   │   ├── contract.ts
│   │   ├── task.ts
│   │   ├── schedule-slot.ts
│   │   ├── document.ts
│   │   ├── deal.ts
│   │   ├── ticket.ts
│   │   ├── budget.ts
│   │   ├── goal.ts
│   │   ├── metric.ts
│   │   └── risk.ts
│   ├── resolution.ts            # Entity resolution / deduplication
│   ├── versioning.ts            # Bi-temporal version management
│   └── context.ts               # Context assembly for agents
│
├── state/
│   ├── estimator.ts             # Main state estimator
│   ├── beliefs.ts               # Belief storage and queries
│   ├── conflicts.ts             # Conflict detection and resolution
│   ├── inference/
│   │   ├── rules.ts             # Rule-based inference
│   │   ├── statistical.ts       # Statistical inference
│   │   └── priors.ts            # Industry/segment priors
│   └── truth-maintenance.ts     # Truth maintenance system
│
├── world-model/
│   ├── ensemble.ts              # World model ensemble coordinator
│   ├── rules/
│   │   ├── accounting.ts        # Financial identity rules
│   │   ├── contracts.ts         # Contract term rules
│   │   ├── deadlines.ts         # Deadline/SLA rules
│   │   └── permissions.ts       # Permission rules
│   ├── probabilistic/
│   │   ├── payment.ts           # Payment prediction
│   │   ├── response.ts          # Response prediction
│   │   ├── churn.ts             # Churn prediction
│   │   ├── dispute.ts           # Dispute prediction
│   │   └── conversion.ts        # Conversion prediction
│   ├── causal/
│   │   ├── intervention.ts      # Intervention effect estimation
│   │   └── counterfactual.ts    # Counterfactual reasoning
│   ├── simulation/
│   │   ├── rollout.ts           # Monte Carlo rollout
│   │   └── scenario.ts          # Scenario definition
│   └── calibration.ts           # Model accuracy tracking
│
├── policy/
│   ├── authority-graph.ts       # Authority DAG
│   ├── compiler.ts              # NL → guards compiler
│   ├── enforcement.ts           # Runtime policy checking
│   ├── predicates.ts            # Deterministic predicate evaluator
│   ├── budget.ts                # Budget tracking and enforcement
│   └── disclosure.ts            # Disclosure rules
│
├── planner/
│   ├── planner.ts               # Plan generation
│   ├── optimizer.ts             # Multi-objective optimization
│   ├── allocator.ts             # Work allocation to agents
│   ├── prioritizer.ts           # Priority scoring
│   ├── objectives.ts            # Objective definitions
│   └── contingency.ts           # Contingency planning
│
├── agents/
│   ├── runtime.ts               # Agent execution loop
│   ├── context-assembly.ts      # Build context from world model
│   ├── tools.ts                 # Tool definitions
│   ├── sessions.ts              # Durable sessions
│   ├── meta-agent.ts            # Fleet manager
│   └── providers/               # LLM provider adapters
│       ├── openai.ts
│       ├── anthropic.ts
│       └── openrouter.ts
│
├── gateway/
│   ├── gateway.ts               # Main action gateway
│   ├── pipeline.ts              # Processing pipeline
│   ├── escrow.ts                # Action escrow
│   ├── execution.ts             # Tool execution
│   ├── rollback.ts              # Compensating actions
│   ├── evidence.ts              # Evidence bundle generation
│   ├── rate-limit.ts            # Rate limiting
│   └── disclosure.ts            # Disclosure injection
│
├── eval/
│   ├── trace-capture.ts         # Execution trace recording
│   ├── grading.ts               # Trace grading
│   ├── coverage.ts              # Autonomy coverage computation
│   ├── proposals.ts             # Authority change proposals
│   ├── replay.ts                # Historical replay
│   ├── shadow.ts                # Shadow mode
│   └── calibration.ts           # Prediction vs outcome tracking
│
├── governance/
│   ├── cockpit/                 # Dashboard / UI (React)
│   │   ├── state-view.tsx
│   │   ├── prediction-view.tsx
│   │   ├── plan-view.tsx
│   │   ├── approval-queue.tsx
│   │   ├── autonomy-map.tsx
│   │   ├── incident-replay.tsx
│   │   ├── simulator.tsx
│   │   └── policy-editor.tsx
│   ├── approvals.ts             # Approval workflow
│   ├── incidents.ts             # Incident detection
│   └── reporting.ts             # Compliance reports
│
├── network/                     # Future: inter-company
│   ├── identity.ts
│   ├── discovery.ts
│   ├── negotiation.ts
│   ├── settlement.ts
│   └── registry.ts
│
├── db/
│   ├── pg.ts                    # Connection management
│   ├── migrate.ts               # Migration runner
│   └── migrations/              # SQL migrations
│
└── server.ts                    # Main server entry point
```

---

## Build Sequence

Not a timeline. A dependency-ordered sequence. Each phase produces a working system.

### Phase 1: Foundation (Event Ledger + Object Graph + Observation)

Build the ability to ingest, store, and query business state.

```
Deliverables:
- Event ledger with append, query, chain integrity
- Object graph with CRUD, versioning, relationships, context assembly
- 3 connectors: Gmail, Google Calendar, Stripe
- Extraction pipeline (LLM + rules)
- Entity resolution (basic: email address → party)
- API: query objects, query events, get object history
- Dashboard: live object graph view
```

**Why first:** Everything else depends on having accurate, queryable business state. Without the object graph, agents have no context. Without the ledger, there is no audit trail. Without connectors, there is no data.

### Phase 2: Policy & Gateway

Build the ability to govern and execute actions safely.

```
Deliverables:
- Authority graph with grants, attenuation, revocation
- Policy predicate evaluator (deterministic guards)
- Action gateway with full pipeline
- Escrow for high-risk actions
- Evidence bundles on every action
- Approval queue in dashboard
- Budget tracking
```

**Why second:** Before agents can act, the governance layer must exist. Building this before the agent runtime means agents are born governed, not retrofitted.

### Phase 3: Agent Runtime + Evaluation

Build agents that act through the gateway and produce gradeable traces.

```
Deliverables:
- Agent execution loop with context assembly from object graph
- Durable sessions for multi-turn tasks
- Trace capture on every execution
- Procedural + outcome grading
- Autonomy coverage map
- Shadow mode (agents propose, humans review)
- Meta-agent for fleet management
- Dashboard: trace viewer, coverage map, agent performance
```

**Why third:** With business state (Phase 1) and governance (Phase 2) in place, agents can be built properly — they get rich context and are governed from birth.

### Phase 4: State Estimator + World Model

Build the predictive layer that makes agents strategic.

```
Deliverables:
- State estimator: belief maintenance, conflict detection, hidden state inference
- Rule-based world model (accounting, deadlines, contracts)
- Probabilistic models (payment, response, churn, dispute)
- Prediction logging and calibration tracking
- Planner: reactive planning from predictions
- Dashboard: prediction view, forecast view
```

**Why fourth:** The world model needs data to learn from. Phases 1-3 produce the observations, traces, and outcomes that train the predictive models. Building prediction before data = garbage models.

### Phase 5: Planner & Optimization

Build strategic planning and multi-agent coordination.

```
Deliverables:
- Multi-objective optimizer
- Proactive planning (act before problems)
- Work allocation across agents
- Contingency planning
- Scenario simulator
- Dashboard: plan view, "what if?" simulator
```

### Phase 6: Network

Build inter-company agent commerce.

```
Deliverables:
- Agent identity and credentials
- Capability discovery
- Negotiation protocol
- Cross-company settlement
- Shared market models
```

---

## Principles

1. **Event-sourced truth.** The ledger is the source of truth. Everything else is a projection. If you can't reconstruct it from events, it doesn't count.

2. **Objects over processes.** Model business nouns, not business verbs. Objects exist independently. Processes emerge from event patterns over objects.

3. **Beliefs, not facts.** The system stores what it believes with confidence and provenance. Multiple sources can disagree. Hidden state is estimated, not asserted.

4. **Governed from birth.** Every agent is created with authority grants and policies. There is no "ungoverned" state. The default is denied.

5. **Earn autonomy from evidence.** Trust is not a vibe. It is a coverage map over action classes with statistical evidence from graded traces. Promotion requires evidence. Demotion requires one incident.

6. **Agents are thin, context is king.** Agent quality = context quality. The world model, object graph, and planner do the thinking. Agents execute.

7. **One gateway, no bypasses.** Every external effect goes through the action gateway. Policy enforcement, audit, escrow, and rollback happen in one place.

8. **Predictions are accountable.** Every prediction is logged. Every outcome is compared to its prediction. Models that lose calibration are flagged and retrained.

9. **Memory is typed and governed.** Five memory types, each with provenance, confidence, expiration, and access control. No free-form self-rewriting memory.

10. **The company is the model.** The ultimate product is not an agent framework. It is a live, executable, simulatable representation of a business that improves with every interaction.
