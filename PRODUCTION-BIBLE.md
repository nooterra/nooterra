# The Autonomy Economy: Production Bible

## How a World-Class Lab Would Build This

---

## Part 1: Engineering Culture & Practices

### The Non-Negotiables

Top labs (Anthropic, OpenAI, DeepMind) ship systems that handle real money, real data, real consequences. They don't do this with vibes. They do it with discipline. Here's what that actually looks like for your system:

**Monorepo, single source of truth.** Everything — backend services, dashboard, SDK, infrastructure configs, eval suites, documentation — lives in one repository. Use Turborepo or Nx for build orchestration. The reason: when your event ledger schema changes, the SDK types, the dashboard components, and the eval harnesses must all update atomically. Separate repos create drift, and drift in a financial system creates lawsuits.

**TypeScript strict mode everywhere, no exceptions.** `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. Your Zod schemas generate TypeScript types. Those types flow from database -> API -> SDK -> dashboard. A single type definition for `Invoice` is used by the event ledger writer, the object graph query layer, the agent runtime, the gateway validator, and the React component that renders it. If the types don't compile, nothing ships.

**Trunk-based development with short-lived feature branches.** No long-running branches. No "develop" branch. Merge to main multiple times per day. Feature flags control what's live. This matters because your system is 12 layers deep — integration problems surface at merge time, and you want that to happen hourly, not monthly.

**Every merge to main is deployable.** CI runs in under 10 minutes: type check -> unit tests -> integration tests -> contract tests -> build -> deploy to staging -> smoke tests -> ready for production. If CI is slow, engineers stop running it. Keep it fast.

**Code review culture, but not gatekeeping culture.** Every PR gets reviewed, but reviewers have 4 hours to respond. PRs over 400 lines get split. The goal is knowledge sharing and catching logic errors, not style policing (that's what linters do).

### Testing Strategy

This is where most startups fail and where labs succeed. Your testing pyramid for this system:

**Unit tests (thousands).** Every Zod schema validation, every predicate evaluation, every authority check, every priority calculation. These are pure functions — test them exhaustively. Property-based testing (fast-check) for the authority graph: generate random grant trees and verify that attenuation never widens scope. This catches edge cases humans miss.

**Integration tests (hundreds).** Spin up a real Postgres instance (testcontainers), seed it with fixture data, and test full paths: event arrives -> ledger write -> object graph update -> state estimator runs -> prediction generated. Test the gateway end-to-end: mock the external API, verify the full 11-step pipeline executes correctly, check that the evidence bundle contains everything.

**Contract tests (dozens).** Your connectors talk to Stripe, QuickBooks, Gmail. Record real API responses (sanitized), replay them in tests. When Stripe changes their webhook payload format, the contract test fails before your production system does.

**Eval suites for agents (critical).** This is the lab-grade practice most startups skip entirely. Build a corpus of 500+ scenarios: "Invoice #1234 is 15 days overdue, customer has 90% historical payment rate, last email was 3 days ago — what should the agent do?" Grade the agent's action selection, email quality, policy compliance, and evidence bundle completeness. Run evals on every model change, every prompt change, every context assembly change. Track scores over time. Regressions are blocking.

**Chaos tests (weekly).** Kill a connector mid-sync. Inject a 30-second database latency spike. Send a malformed webhook. Feed the state estimator contradictory data. The system should degrade gracefully, never corrupt data, and always fail toward human escalation.

**Load tests (before each phase ships).** Simulate 100 tenants, 10,000 objects each, 50 concurrent agent executions. Measure: event ledger write latency (must be <50ms p99), object graph query time (must be <200ms for 3-level traversal), gateway throughput (must handle 100 actions/second), and dashboard load time (must be <2 seconds).

### Code Architecture

```
packages/
├── core/                    # Shared types, Zod schemas, constants
│   ├── src/
│   │   ├── events/          # All 50+ event type schemas
│   │   ├── objects/         # All 20+ object type schemas
│   │   ├── authority/       # Grant types, attenuation logic
│   │   ├── predicates/      # 22+ predicate types
│   │   └── errors/          # Typed error hierarchy
│   └── package.json
│
├── ledger/                  # Event ledger service
│   ├── src/
│   │   ├── writer.ts        # Append events with hash chain
│   │   ├── reader.ts        # Temporal queries, projections
│   │   ├── compaction.ts    # Cold storage for old events
│   │   └── migrations/
│   └── package.json
│
├── object-graph/            # Canonical object graph
│   ├── src/
│   │   ├── store.ts         # CRUD with versioning
│   │   ├── traversal.ts     # Graph queries, context assembly
│   │   ├── resolution.ts    # Entity resolution, merging
│   │   ├── estimator.ts     # State estimation, hidden vars
│   │   └── migrations/
│   └── package.json
│
├── connectors/              # Observation plane
│   ├── src/
│   │   ├── base.ts          # Connector interface, sync cursor
│   │   ├── stripe/
│   │   ├── quickbooks/
│   │   ├── gmail/
│   │   ├── calendar/
│   │   ├── salesforce/
│   │   └── composio/        # Generic Composio wrapper
│   └── package.json
│
├── world-model/             # Prediction layer
│   ├── src/
│   │   ├── deterministic.ts # Accounting rules, contract terms
│   │   ├── probabilistic.ts # Logistic regression, decision trees
│   │   ├── causal.ts        # Intervention models
│   │   ├── simulator.ts     # Monte Carlo rollouts
│   │   ├── calibration.ts   # Prediction vs. reality tracking
│   │   └── ensemble.ts      # Model composition
│   └── package.json
│
├── authority/               # Policy & authority engine
│   ├── src/
│   │   ├── graph.ts         # DAG operations, grant chain
│   │   ├── compiler.ts      # Natural language -> guards
│   │   ├── evaluator.ts     # Runtime policy check
│   │   └── migrations/
│   └── package.json
│
├── planner/                 # Planning & optimization
│   ├── src/
│   │   ├── reactive.ts      # Event-triggered plans
│   │   ├── proactive.ts     # Prediction-triggered plans
│   │   ├── optimizer.ts     # Multi-objective priority
│   │   ├── allocator.ts     # Work -> agent assignment
│   │   └── templates/       # Plan templates by domain
│   └── package.json
│
├── agent-runtime/           # Agent execution
│   ├── src/
│   │   ├── context.ts       # Context assembly (the key module)
│   │   ├── executor.ts      # LLM execution loop
│   │   ├── router.ts        # Model selection per action
│   │   ├── session.ts       # Durable session management
│   │   └── memory.ts        # Five-store memory interface
│   └── package.json
│
├── gateway/                 # Action gateway & escrow
│   ├── src/
│   │   ├── pipeline.ts      # 11-step execution pipeline
│   │   ├── escrow.ts        # Hold/release/cancel
│   │   ├── evidence.ts      # Bundle assembly
│   │   ├── rollback.ts      # Compensating actions
│   │   ├── budget.ts        # Atomic spend tracking
│   │   └── disclosure.ts    # AI communication disclosure
│   └── package.json
│
├── evaluator/               # Grading & autonomy
│   ├── src/
│   │   ├── grader.ts        # Procedural + outcome grading
│   │   ├── autonomy.ts      # Coverage map, promotion/demotion
│   │   ├── shadow.ts        # Shadow mode runner
│   │   ├── replay.ts        # Historical replay engine
│   │   └── calibration.ts   # Model accuracy tracking
│   └── package.json
│
├── network/                 # Inter-company layer
│   ├── src/
│   │   ├── identity.ts      # Agent public keys, certs
│   │   ├── discovery.ts     # Capability registry
│   │   ├── negotiation.ts   # Machine-readable offers
│   │   ├── contracts.ts     # Ricardian contracts
│   │   └── settlement.ts    # Cross-company transactions
│   └── package.json
│
├── api/                     # HTTP + MCP API surface
│   ├── src/
│   │   ├── routes/
│   │   ├── middleware/
│   │   ├── mcp/             # MCP transport handlers
│   │   └── webhooks/        # Inbound webhook handlers
│   └── package.json
│
├── dashboard/               # React frontend
│   ├── src/
│   │   ├── views/
│   │   │   ├── command-center/
│   │   │   ├── company-state/
│   │   │   ├── predictions/
│   │   │   ├── autonomy-map/
│   │   │   ├── simulator/
│   │   │   ├── policy-editor/
│   │   │   ├── approval-queue/
│   │   │   ├── onboarding/
│   │   │   └── settings/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── lib/
│   └── package.json
│
├── sdk/                     # Client SDK (TypeScript)
│   └── package.json
│
└── eval/                    # Evaluation & benchmarking
    ├── scenarios/           # 500+ test scenarios
    ├── graders/             # Automated grading functions
    ├── benchmarks/          # Performance benchmarks
    └── package.json
```

### Database Design

```sql
-- Tenant isolation: every table has tenant_id, every query filters by it
-- Row-level security enforced at the Postgres level, not just application level

-- EVENT LEDGER
CREATE TABLE events (
    id           TEXT PRIMARY KEY,        -- ULID
    tenant_id    UUID NOT NULL REFERENCES tenants(id),
    event_type   TEXT NOT NULL,           -- 'financial.invoice.created'
    domain       TEXT NOT NULL,           -- 'financial' (derived, indexed)
    real_ts      TIMESTAMPTZ NOT NULL,    -- when it happened in reality
    system_ts    TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_type  TEXT NOT NULL,           -- 'connector', 'agent', 'human', 'system'
    source_id    TEXT NOT NULL,
    object_refs  JSONB NOT NULL,          -- [{type, id}] touched objects
    payload      JSONB NOT NULL,
    confidence   REAL NOT NULL DEFAULT 1.0,
    provenance   JSONB NOT NULL,
    causal_link  TEXT REFERENCES events(id),
    prev_hash    BYTEA,
    content_hash BYTEA NOT NULL
);

CREATE INDEX idx_events_tenant_type ON events(tenant_id, event_type, real_ts DESC);
CREATE INDEX idx_events_tenant_ts ON events(tenant_id, real_ts DESC);
CREATE INDEX idx_events_object_refs ON events USING GIN(object_refs);

-- OBJECT GRAPH
CREATE TABLE objects (
    id            UUID PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES tenants(id),
    object_type   TEXT NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1,
    state         JSONB NOT NULL,
    estimated     JSONB NOT NULL DEFAULT '{}',
    confidence    REAL NOT NULL DEFAULT 1.0,
    source_refs   JSONB NOT NULL DEFAULT '[]',
    valid_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to      TIMESTAMPTZ,
    is_tombstoned BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_objects_tenant_type ON objects(tenant_id, object_type)
    WHERE valid_to IS NULL AND NOT is_tombstoned;
CREATE INDEX idx_objects_state ON objects USING GIN(state);
CREATE INDEX idx_objects_estimated ON objects USING GIN(estimated);

-- OBJECT VERSIONS (append-only history)
CREATE TABLE object_versions (
    object_id   UUID NOT NULL REFERENCES objects(id),
    version     INTEGER NOT NULL,
    state       JSONB NOT NULL,
    estimated   JSONB NOT NULL,
    valid_from  TIMESTAMPTZ NOT NULL,
    valid_to    TIMESTAMPTZ,
    changed_by  TEXT NOT NULL REFERENCES events(id),
    PRIMARY KEY (object_id, version)
);

-- RELATIONSHIPS
CREATE TABLE relationships (
    id           UUID PRIMARY KEY,
    tenant_id    UUID NOT NULL REFERENCES tenants(id),
    rel_type     TEXT NOT NULL,
    source_id    UUID NOT NULL REFERENCES objects(id),
    target_id    UUID NOT NULL REFERENCES objects(id),
    properties   JSONB NOT NULL DEFAULT '{}',
    strength     REAL NOT NULL DEFAULT 1.0,
    valid_from   TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to     TIMESTAMPTZ
);

CREATE INDEX idx_rels_source ON relationships(source_id, rel_type)
    WHERE valid_to IS NULL;
CREATE INDEX idx_rels_target ON relationships(target_id, rel_type)
    WHERE valid_to IS NULL;

-- AUTHORITY GRANTS
CREATE TABLE authority_grants (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    grantor_type    TEXT NOT NULL,
    grantor_id      UUID NOT NULL,
    grantee_type    TEXT NOT NULL,
    grantee_id      UUID NOT NULL,
    scope           JSONB NOT NULL,
    budget_remaining JSONB NOT NULL,
    valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to        TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    parent_grant_id UUID REFERENCES authority_grants(id),
    grant_hash      BYTEA NOT NULL,
    chain_hash      BYTEA NOT NULL
);

-- PREDICTIONS (for calibration tracking)
CREATE TABLE predictions (
    id             UUID PRIMARY KEY,
    tenant_id      UUID NOT NULL REFERENCES tenants(id),
    object_id      UUID NOT NULL REFERENCES objects(id),
    prediction_type TEXT NOT NULL,
    predicted_value REAL NOT NULL,
    confidence      REAL NOT NULL,
    model_id        TEXT NOT NULL,
    predicted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    outcome_value   REAL,
    outcome_at      TIMESTAMPTZ,
    calibration_error REAL
);

-- EXECUTION TRACES (for grading)
CREATE TABLE execution_traces_v2 (
    id             UUID PRIMARY KEY,
    tenant_id      UUID NOT NULL REFERENCES tenants(id),
    agent_id       UUID NOT NULL,
    plan_id        UUID,
    action_class   TEXT NOT NULL,
    object_id      UUID NOT NULL,
    context_hash   BYTEA NOT NULL,
    action_taken   JSONB NOT NULL,
    evidence_bundle JSONB NOT NULL,
    gateway_result JSONB NOT NULL,
    procedural_score REAL,
    outcome_score    REAL,
    graded_at      TIMESTAMPTZ,
    graded_by      TEXT,
    started_at     TIMESTAMPTZ NOT NULL,
    completed_at   TIMESTAMPTZ
);

-- AUTONOMY COVERAGE MAP
CREATE TABLE autonomy_coverage (
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    agent_id        UUID NOT NULL,
    action_class    TEXT NOT NULL,
    object_type     TEXT NOT NULL,
    total_executions INTEGER NOT NULL DEFAULT 0,
    success_rate    REAL,
    avg_procedural  REAL,
    avg_outcome     REAL,
    last_failure_at TIMESTAMPTZ,
    incident_count  INTEGER NOT NULL DEFAULT 0,
    current_level   TEXT NOT NULL DEFAULT 'forbidden',
    recommended_level TEXT,
    evidence_strength REAL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, agent_id, action_class, object_type)
);

-- ESCROW (pending actions)
CREATE TABLE escrow_actions (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    agent_id        UUID NOT NULL,
    action_class    TEXT NOT NULL,
    target_object_id UUID NOT NULL,
    action_params   JSONB NOT NULL,
    evidence_bundle JSONB NOT NULL,
    predicted_outcome JSONB,
    authority_chain JSONB NOT NULL,
    risk_score      REAL NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at      TIMESTAMPTZ,
    decided_by      UUID,
    expires_at      TIMESTAMPTZ NOT NULL
);
```

Row-level security for multi-tenancy:

```sql
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_tenant_isolation ON events
    USING (tenant_id = current_setting('app.tenant_id')::UUID);
-- Repeat for every table
```

### Infrastructure

**Phase 1-3 (MVP through demo): Railway.**
- 1 API service (Node.js, 2 vCPU, 4GB RAM)
- 1 worker service (background jobs: sync, estimation, grading)
- 1 PostgreSQL instance (Railway managed, 4GB RAM, 50GB storage)
- 1 Redis instance (job queues, rate limiting, caching)
- Dashboard on Vercel
- Total: ~$150-300/month

**Phase 4-6 (scaling): AWS/GCP with Terraform.**
- ECS Fargate or Cloud Run (auto-scaling containers)
- RDS PostgreSQL Multi-AZ with read replicas
- Amazon EventBridge or NATS for event streaming
- AWS Secrets Manager for connector OAuth tokens
- S3 for evidence bundle archives
- CloudFront CDN for dashboard
- Datadog or Grafana Cloud for monitoring
- PagerDuty for alerts
- Estimated at 500 tenants: ~$3,000-5,000/month

### Security Model

- OAuth 2.0 + PKCE for dashboard, API keys for programmatic access
- AES-256 at rest, TLS 1.3 in transit, application-level encryption for PII
- Row-level security in Postgres (not just application-level filtering)
- Per-tenant encryption keys in KMS
- Quarterly penetration testing from Phase 3
- SOC 2 Type II process starting Phase 4

---

## Part 2: UX & UI Design

### Design Philosophy

This is a governance interface for autonomous systems. The closest analogs: air traffic control, financial trading terminals, nuclear plant control rooms. The design must communicate three things at all times:
1. What is the system doing right now? (Observability)
2. Is everything within acceptable parameters? (Confidence)
3. What needs my attention? (Escalation)

### The Six Views

**1. Command Center (Home)**
- Three health indicators: Financial Health, Operational Health, Risk
- Curated activity stream (meaningful events, not log dumps)
- Attention queue (3-5 items needing human input now)

**2. Company State (Object Graph Explorer)**
- Master-detail layout: filterable object list + object detail "baseball card"
- Current state, estimated state (with confidence bars), relationships, events, predictions
- Click any related object to navigate; click any event to see trace

**3. Prediction Dashboard**
- Aggregate: cash flow forecast (30/60/90), DSO projection, risk distributions
- Per-object: prediction timeline showing predicted vs actual over time
- Model health indicator showing average calibration

**4. Autonomy Map**
- Grid: agents (rows) x action classes (columns)
- Cells colored by autonomy level (forbidden -> human_approval -> auto_with_review -> autonomous)
- Brightness = evidence strength
- Click cell -> evidence modal with promote/demote buttons

**5. Policy Editor**
- Natural language input, compiled guards preview
- Live impact analysis against historical actions
- Conflict detector for contradictory policies

**6. Approval Queue**
- Card per escrowed action: what, why, evidence, predicted outcome, authority chain
- Approve / Reject (with reason) / Modify buttons
- Batch operations with policy suggestions

### Visual Language
- Dark mode default
- Semantic colors: blue=info, amber=attention, red=blocked, green=healthy, purple=predictions
- Monospace for IDs/amounts/timestamps, sans-serif for everything else
- Minimal motion (functional transitions only)
- Confidence bands on every prediction chart

### Onboarding Flow (under 30 minutes)
1. Create account, choose industry (2 min)
2. Connect data sources — Stripe, QuickBooks, Gmail (5 min)
3. Review company model — verify entity resolution (5 min)
4. Set first policies from industry templates (10 min)
5. Launch first agent in shadow mode (5 min)

---

## Part 3: Monetization & Pricing

### Pricing Tiers

**Starter — $149/month**
- 500 objects, 3 connectors, 1 domain agent
- Shadow + supervised modes only
- 1,000 agent actions/month
- Basic dashboard
- Target: freelancers, agencies, 1-10 employees

**Business — $499/month**
- 10,000 objects, unlimited connectors, 3 domain agents
- Full autonomy progression
- 10,000 agent actions/month
- Full dashboard (all 6 views)
- World model predictions, policy editor
- Target: SMBs, 10-100 employees, $1M-$20M revenue

**Enterprise — Custom (~$2,000+/month)**
- Unlimited everything
- Custom domain agents, multi-objective optimizer, simulator
- SSO/SAML, SLA, SOC 2 docs
- Target: mid-market, 100-1,000 employees

**Usage overage:** $0.01 per action beyond included. Deliberately cheap.

### Outcome-Based Pricing (V2)
- Collections: 2-5% of incremental cash collected
- Support: $5-15 per resolved case
- Offered as alternative to flat fee, customer's choice

### Network Pricing (V3)
- 0.5-1% transaction fee on agent-to-agent commerce
- $99/month marketplace listing fee
- $499 one-time certification fee

### Unit Economics
```
Revenue per Business customer:     $549/month (with overage)
LLM API cost:                      $50/month
Infrastructure (allocated):        $10/month
Connector API costs:               $5/month
Support (allocated):               $30/month
Total cost:                        $95/month
Gross margin:                      $454/month (83%)
```

### Free Trial
14-day free trial of Business tier. No credit card for signup. Shadow mode default (zero risk). Day 7 email: "Your agent proposed 89 actions with 94% approval rate. Upgrade to keep it running."

---

## Part 4: Go-to-Market

### Beachhead: Collections for B2B Service Businesses
- Pain is acute (cash flow is existential)
- Value is measurable ($X collected)
- Data is available (Stripe + QuickBooks + Gmail)
- Risk tolerance higher (imperfect email != catastrophic)
- Feedback loops are fast (payment within weeks)

### Launch Sequence
- Months 1-3: 5 design partners (free, weekly sit-downs)
- Month 4: Invite-only launch (50 companies, $149-499/mo)
- Months 5-6: Open access + case studies + content marketing
- Months 7-12: Expand to support, scheduling, vendor management

### Distribution
1. QuickBooks/Xero/FreshBooks app marketplaces
2. Bookkeeper/accountant referrals (15% rev share)
3. Content + SEO (unique insights from anonymized world model data)
4. Product-led growth (free "business health check" — connect Stripe, get AR risk report)

---

## Part 5: Advanced Technical Capabilities

### Transfer Learning Across Tenants
- Normalized feature extraction (no PII) to shared feature store
- Shared priors: new tenants get predictions from day one
- Differential privacy on all shared features
- Federated fine-tuning: local models start from shared priors
- Industry-specific models trained as data accumulates

### Reflexive World Models (Inter-Company)
- Opponent modeling: Agent A maintains a model of Agent B's behavior
- Strategy selection based on opponent model
- Equilibrium detection across network
- Strategy diversity to prevent convergent degeneracy

### Ontology Evolution
- Entity clustering for unrecognized entity types
- Schema inference from event payloads
- Human confirmation for new object types
- Cross-tenant concept sharing via industry templates

### Information Asymmetry Ethics
- Inference classification: public, private-but-fair, private-and-sensitive, potentially-manipulative
- Usage rules compiled into policy engine
- Regulatory mapping (GDPR, CCPA, ECOA, FTC Act)

---

## Part 6: Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Agent sends damaging email | High | Gateway escrow for communications. Shadow mode default. Approval queue. |
| Wrong payment initiated | Critical | Double-authorization for outbound payments. Budget caps. Human-only above threshold. |
| Calibration drift | Medium | Continuous tracking. Auto-demotion below threshold. Weekly eval reviews. |
| Data breach | Critical | Per-tenant encryption. RLS. Quarterly pen tests. SOC 2. |
| Connector breaks | Medium | Contract tests. Webhook signature verification. Health monitoring. |
| LLM provider outage | High | Multi-provider fallback. Context caching. Graceful degradation. |
| Regulatory action | High | Ethics layer. Disclosure on AI comms. Authority constraints. Legal review. |
| Tenant data leakage | Medium | Differential privacy. Formal privacy budgets. External audit. |
| Network emergent behavior | Medium | Network monitor. Circuit breakers. Rate limits per tenant pair. |

---

## Part 7: Success Metrics by Phase

| Phase | What Ships | Success Metric |
|---|---|---|
| 0 (W1-2) | Monolith decomposed | All tests pass. Zero regression. |
| 1 (W3-6) | Event ledger + object graph + connectors | 5 partners see business as live object graph |
| 2 (W7-9) | Authority graph + gateway | First action through full 11-step pipeline |
| 3 (W10-13) | Agent runtime + collections agent | Agent collects real overdue invoices. Evidence bundles complete. |
| 4 (W14-17) | State estimator + world model | Predictions with >0.7 calibration. Proactive actions. |
| 5 (W18-20) | Evaluation engine + autonomy | Agents earning autonomous status from evidence. |
| 6 (W21-23) | Governance cockpit v2 | All 6 views live. Onboarding <30 min. |
| 7 (W24-30) | Network + outcome pricing | First agent-to-agent transaction. |
