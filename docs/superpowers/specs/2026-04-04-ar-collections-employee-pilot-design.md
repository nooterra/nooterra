# AR Collections Employee — Pilot Product Design

**Date:** 2026-04-04
**Target:** Pilot-ready. Recordable YC demo that is also credible enough to onboard 1-3 design partners with white-glove support.
**Scope:** One AI employee (Collections Specialist), one data source (Stripe), one manager view.
**Timeline:** 4-6 weeks.

---

## Product Thesis

An AI employee that actually understands the company it works for. Not a chatbot, not a copilot, not a dashboard. A worker you hire into a role, give access to your business data, set boundaries for, and manage like you would a human employee.

The wedge is AR collections because:
- One connector (Stripe) delivers full value
- ROI is measured in dollars within 2 weeks
- The world model advantage is visible (same employee, different judgment per account)
- Policy governance is a selling point (collections is legally sensitive)
- The learning loop is tight (email → payment or not → signal)

## Product Loop

```
Hire employee → Connect Stripe → Watch it build context →
See proposed work → Approve actions → Watch outcomes accumulate →
Employee earns autonomy over time
```

## Freshness Promise

Riley checks for new Stripe activity every few hours via scheduled re-backfill. The pilot does not have real-time webhook ingest for connected Stripe accounts. This is stated honestly in onboarding copy and dashboard status.

---

## 1. Backend Additions

No new database tables. No new migrations. No new core subsystems. A handful of small extensions to existing code.

### 1.1 Role Registry

**New file: `src/core/role-definitions.ts`**

A hardcoded registry of role templates. For the pilot, one entry: `ar-collections`.

```typescript
interface RoleDefinition {
  id: string;                    // 'ar-collections'
  name: string;                  // 'Collections Specialist'
  defaultEmployeeName: string;   // 'Riley'
  description: string;           // one-liner for hire screen
  requiredConnectors: string[];  // ['stripe']
  metrics: { key: string; label: string; direction: 'up' | 'down' }[];
  buildAgent(tenantId: string, agentId: string): AgentConfig;
  buildGrant(tenantId: string, grantorId: string, granteeId: string): CreateGrantInput;
  buildObjectives(tenantId: string): TenantObjectives;  // includes both objectives AND constraints
}
```

Factory hooks delegate to existing domain code:
- `buildAgent()` → calls `createCollectionsAgent()` from `src/agents/templates/ar-collections.ts`
- `buildGrant()` → calls `createCollectionsGrant()` from `src/agents/templates/ar-collections.ts`
- `buildObjectives()` → delegates to `createDefaultArObjectives()` in `src/domains/ar/objectives.ts`, which returns `TenantObjectives` including both weighted objectives AND constraint IDs (no_active_dispute_outreach, require_primary_billing_contact, high_value_escalates_to_approval, collections_outreach_cooldown, outside_business_hours_requires_approval)

This wraps existing source-of-truth factories in metadata. No config blob duplication.

### 1.2 Role Identity on Worker Charter

`roleId` added to the persisted worker charter in `src/api/world-runtime-routes.ts`. This is canonical in product-facing code. Existing `worldRuntimeTemplateId` kept for runtime compatibility only.

### 1.3 API Endpoints

**`POST /v1/employees`**

Reskin of existing `ensureCollectionsRuntime()` in `src/api/world-runtime-routes.ts`. Accepts:
```json
{ "roleId": "ar-collections", "employeeName": "Riley" }
```
Assumes Stripe already connected. Provisions worker with charter (`roleId` set), authority grant via `buildGrant()`, cron schedule for recurring execution. Returns employee-friendly payload: `{ id, name, role, status }`.

Boundary overrides from onboarding sliders are applied to the grant constraints at provision time. This is new behavior on the existing provision route.

**`GET /v1/employees/:id/summary`**

Composes existing overview/scorecard builders in `src/api/world-runtime-routes.ts`. Validates worker belongs to tenant. Threads employee/worker ID through queries. Returns:
- `realizedRecoveryCents` — dollars recovered through employee actions
- `overdueCount` — current overdue invoices
- `projectedCollectionCents` — estimated recoverable amount
- `approvalQueueDepth` — pending approvals for this employee
- `autonomyCoverage` — % of action types at autonomous level
- `recentActions` — last N actions taken or proposed
- `pendingApprovals` — escrowed actions awaiting manager review

### 1.4 Small Backend Extensions

Each is hours of work, not days:

| Extension | File | What |
|---|---|---|
| Object count endpoint | `src/api/world-runtime-routes.ts` | Count of world objects by type, for onboarding progress display |
| Event query by agent ID | `src/ledger/event-store.ts` | Add optional `sourceId` filter to `queryEvents()` for employee-scoped activity |
| Rejection ledger event | `src/gateway/gateway.ts` | Append `manager.action.rejected` event to `world_events` on escrow rejection |
| Cron schedule on worker | `src/api/world-runtime-routes.ts` | Set schedule at provisioning time so `scheduler.ts` picks up recurring execution |
| Backfill: disputes | `services/runtime/router.ts` | Extend existing backfill to ingest disputes through `connector.ts` path |
| Backfill in execution path | `services/runtime/execution-loop.ts` | Invoke backfill at start of collections worker run so cron refreshes Stripe data before planning |
| Grant constraint overrides | `src/agents/templates/ar-collections.ts` | Accept boundary params (max amount, contact frequency) when building grant |
| Parameterize high-value threshold | `src/core/objectives.ts` | Make `isHighValueCommunication()` threshold configurable from tenant objectives instead of hardcoded $5K |

### 1.5 Stripe Ingest Strategy

**Onboarding:** Backfill triggered during onboarding. Pulls customers, invoices, payment intents, and disputes from Stripe API. Routes through existing `connector.ts` → `applyConnectorResult()` → world model.

**Steady state:** The collections worker runs on a cron schedule (every few hours), set at provisioning time and picked up by `scheduler.ts`. The scheduler invokes `executeWorker()`, which runs the AR execution path. To refresh Stripe data, the execution path in `execution-loop.ts` must invoke backfill at the start of each collections run — refresh data first, then plan. This is a small addition to the collections worker execution path, not a scheduler change. Without this, the cron would re-plan on stale data.

**Deferred:** Connected-account Stripe webhook pipeline for real-time ingest. Phase 2 when sub-hour latency matters.

**Backfill coverage (pilot):** Customers, invoices, payment intents as objects + relationships. Disputes as events only (the Stripe connector emits dispute events but does not create dispute objects or relationships — dispute awareness comes from event queries, not object graph traversal). Refunds and subscriptions deferred.

### 1.6 Execution Path

The pilot uses the existing AR shadow path in `services/runtime/execution-loop.ts`: backfill refresh (new) → `generateReactivePlan()` → `assembleContext()` → `chatCompletionForWorker()`. This is the actual code path, not the `executeAgentTask()` in `src/agents/runtime.ts`.

Planner assignment is a non-issue with one employee. `allocateWork()` exists but is unused in the AR flow.

---

## 2. Frontend Architecture

React 18, Vite, Tailwind. Same stack as existing dashboard. New screens are new components alongside existing views. Old views stay in codebase, unreachable from pilot nav but accessible by direct URL for debugging.

### 2.1 Routing

**Pilot routes:**

| Route | Screen |
|---|---|
| `/` | Landing Page |
| `/setup` | Onboarding (4-step) |
| `/employees/:id` | Employee Dashboard |
| `/employees/:id/approvals` | Approval Inbox |
| `/employees/:id/accounts/:objectId` | Account Brief |
| `/employees/:id/settings` | Settings |
| `/login` | Login (existing) |
| `/signup` | Signup (existing) |
| `/oauth/callback` | OAuth callback (existing) |

**Post-auth redirect:** Check for active employee on tenant → `/employees/:id` if exists, `/setup` if not.

**Old routes:** All kept in codebase, unreachable from pilot nav. Serve as operator backdoor via direct URL.

### 2.2 Screen 1: Landing Page (`/`)

Rewrite of existing `LandingPage.jsx`. Copy changes, not structural changes.

Framing: "Hire your first AI collections specialist."
CTA: "Get Started" → `/setup`

Design target: Stripe/Ramp tier. Clean, minimal, product-led.

### 2.3 Screen 2: Onboarding (`/setup`)

4-step flow replacing current `Onboarding.jsx`:

**Step 1 — Connect Stripe.** API-key based (current reality in `router.ts`). Secure input field, not fake OAuth. Calls existing Stripe credential storage route. On success: "Connected — found 234 customers, 1,847 invoices." Numbers from a lightweight count query or backfill summary if available; otherwise show phase confirmation only.

**Step 2 — Meet Your Employee.** Role card: "Riley — Collections Specialist. Monitors overdue invoices, sends evidence-backed follow-ups, escalates when uncertain." User can rename. 3-4 boundary sliders pre-filled from role template defaults:
- Maximum autonomous action value ($)
- Contact frequency limit (per account per week)
- Require approval for accounts over $X ARR
- Business hours only (toggle + timezone)

The first two map to existing `GrantScope` and `GrantConstraints` fields. "Invoices over $X" maps to the `high_value_escalates_to_approval` constraint, which currently uses a hardcoded $5,000 threshold in `isHighValueCommunication()` in `src/core/objectives.ts`. To make this configurable, the threshold must be parameterized (read from tenant objectives config instead of hardcoded). This requires a small change to `src/core/objectives.ts`. "Business hours only" maps to the `outside_business_hours_requires_approval` constraint. All are set at grant/objectives creation time. Changes after onboarding use revoke-and-recreate (no in-place grant update exists).

**Step 3 — Build Context.** Triggers backfill. Shows progress — real object/event counts if the count endpoint supports it, otherwise phase labels: "Connecting → Scanning → Building → Ready." No fake counters. Lands on: "Riley has identified N accounts requiring attention. Ready to start?"

**Step 4 — Activate.** Calls `POST /v1/employees`. Redirects to `/employees/:id`.

### 2.4 Screen 3: Employee Dashboard (`/employees/:id`)

Home screen after onboarding. "Riley's desk."

Components:
- **Status bar** — Name, role, status (active / paused), last Stripe sync time with freshness note ("Checks for new activity every few hours")
- **Attention needed** — Pending approval count with badge. Primary CTA.
- **Active work** — List of accounts/invoices being handled. Labels derived conservatively from existing events/actions: `Needs follow-up`, `Awaiting approval`, `Escalation recommended`. No stage indicators that imply a state machine that isn't persisted.
- **Performance summary** — Cards: recovered amount, overdue invoices handled, approval queue depth, autonomy coverage. Numbers with trend arrows vs. prior period. No charts. Honest zeros if just started.
- **Recent activity** — Timeline of employee's actions, filtered by agent ID from `world_events`. Each entry links to account brief.

### 2.5 Screen 4: Approval Inbox (`/employees/:id/approvals`)

Employee-scoped. Loads escrowed actions from `gateway_actions` where agent ID matches.

Each approval card:
- **What:** Action description, target account, invoice details, amount
- **Why:** Evidence bundle — reasoning, payment history pattern, policy clauses, confidence. All evidence claims Stripe-only: invoice history, payment timing, disputes, amounts, last payment date. No references to support tickets, CRM data, or product usage.
- **Context:** Inline account brief summary
- **Actions:** Approve / Reject. No "Edit & Approve" in v1. Approve calls existing escrow release. Reject records decision + appends rejection ledger event.
- **State change on action:** Badge count decrements, card visually transitions to Sent/Escalated/Rejected.

### 2.6 Screen 5: Account Brief (`/employees/:id/accounts/:objectId`)

Deep dive on a single account. Backed by `party` objects in the world model.

Sections:
- **Account identity** — Name, Stripe customer ID
- **Payment behavior** — Timeline of invoices and payments. Visual indicator of payment patterns. Data from `world_objects` (invoices, payments) + `world_events`.
- **Riley's activity** — What the employee has done: emails sent, escalations created, notes logged. From `world_events` filtered by agent ID + object refs.
- **Open items** — Current overdue invoices, pending actions, scheduled follow-ups
- **Relationships** — Connected entities: invoices, payments

No subscription or refund data unless backfill is extended. No support ticket data. Stripe-only. Disputes are visible as events (e.g., "dispute opened on charge X") but not as first-class objects in the graph.

### 2.7 Screen 6: Settings (`/employees/:id/settings`)

Policy boundaries as human-readable controls.

- **Employee profile** — Name, role (read-only), status toggle (active/paused)
- **Boundaries** — 4 controls matching onboarding sliders:
  - Maximum autonomous action value ($)
  - Contact frequency limit (per account per week)
  - Require approval for invoices over $X
  - Business hours only (toggle + timezone)
- **Stripe connection** — Status, last sync, resync trigger
- **Danger zone** — Pause employee

There is no grant update path in the current codebase — only create and revoke. Changing a boundary revokes the current grant and creates a new one with updated constraints. This is simple and correct for the pilot. A proper in-place grant update is deferred.

Note: "Require approval for invoices over $X" maps to the `high_value_escalates_to_approval` constraint, not a grant scope filter. The current threshold is hardcoded at $5,000 in `isHighValueCommunication()` in `src/core/objectives.ts`. Making this configurable requires parameterizing the threshold (read from tenant objectives config). The Settings UI presents it as a slider; the backend stores the value in tenant objectives and reads it during constraint evaluation.

### 2.8 Shell / Navigation

Minimal shell wrapping all post-onboarding screens:
- **Left sidebar:** Employee avatar + name, nav links (Dashboard, Approvals with badge count, Settings)
- **Top bar:** Company name, tenant context, user menu

No system-centric navigation. No "World Model," "Autonomy Map," "Predictions" as standalone views. Those concepts surface where relevant (autonomy as a stat on dashboard, predictions as confidence in approval cards) but are never exposed as separate screens.

### 2.9 File Inventory

**New files (11 frontend, 1 backend):**

```
src/core/role-definitions.ts

dashboard/src/views/EmployeeShell.jsx
dashboard/src/views/EmployeeDashboard.jsx
dashboard/src/views/ApprovalInbox.jsx
dashboard/src/views/AccountBrief.jsx
dashboard/src/views/EmployeeSettings.jsx
dashboard/src/views/onboarding/SetupFlow.jsx
dashboard/src/views/onboarding/ConnectStripe.jsx
dashboard/src/views/onboarding/MeetEmployee.jsx
dashboard/src/views/onboarding/BuildContext.jsx
dashboard/src/views/onboarding/Activate.jsx
dashboard/src/lib/employee-api.js
```

**Modified files (6 backend, 3 frontend):**

| File | Change |
|---|---|
| `src/api/world-runtime-routes.ts` | Add employee endpoints, object count, cron schedule on provisioning, grant overrides |
| `src/ledger/event-store.ts` | Add `sourceId` filter to `queryEvents()` |
| `src/gateway/gateway.ts` | Add rejection ledger event |
| `src/agents/templates/ar-collections.ts` | Accept boundary params for grant |
| `src/core/objectives.ts` | Parameterize high-value threshold from tenant config |
| `services/runtime/router.ts` | Extend backfill to disputes (event-only) |
| `services/runtime/execution-loop.ts` | Invoke backfill at start of collections worker execution |
| `dashboard/src/App.jsx` | Add employee routes, post-auth redirect |
| `dashboard/src/site/LandingPage.jsx` | Copy rewrite |
| `dashboard/src/lib/world-api.js` | Additional query helpers |

**Untouched:** All 81 migrations, the magic-link and ml-sidecar services, the gateway pipeline (except rejection event addition), planner, scanner, authority graph, autonomy enforcer, effect tracker, world model ensemble, state estimator, connector interface, object graph. The runtime service has two modified files (`router.ts`, `execution-loop.ts`) as listed above.

---

## 3. End-to-End Data Flow

### Onboarding

```
Connect Stripe (API key → encrypted credential storage in router.ts)
  → Trigger backfill (router.ts → Stripe API → connector.ts → applyConnectorResult())
  → World model populates:
    → world_objects: parties (customers), invoices, payments
    → world_relationships: customer_of, pays
    → world_events: observation events, hash-chained per tenant
    → Disputes: event-only awareness (no dispute objects or relationships).
      The current Stripe connector (`src/observation/connectors/stripe.ts`)
      emits dispute events but does not create dispute objects.
      The planner and gateway can detect disputes via event queries
      (e.g., no_active_dispute_outreach constraint checks for dispute events).
      Full dispute object materialization is deferred.
  → Frontend shows progress (object counts or phase labels)
  → POST /v1/employees → provision worker + charter + grant + cron schedule
  → Employee is active
```

### Steady State

```
1. OBSERVE
   Periodic re-backfill (cron) → router.ts → Stripe API
     → connector.ts → updates world_objects, world_events

2. REFRESH + PLAN
   Scheduler (scheduler.ts) triggers worker on cron
     → execution-loop.ts takes AR shadow path
     → First: invoke backfill to refresh Stripe data into world model
     → Then: generateReactivePlan() in planner.ts
       → queries overdue invoices
       → checks payment history, dispute status per account
       → generates variants via scanner.ts (friendly/formal/escalation/hold)
       → scores by urgency x value x successProb x objectiveWeight

3. EXECUTE
   execution-loop.ts → assembleContext() → chatCompletionForWorker()
     → LLM produces tool calls
     → Each tool call → gateway.ts 11-step pipeline
       → Auth, scope, budget, objectives, disclosure, escrow, audit
       → Result: executed (autonomous) or escrowed (needs approval)

4. APPROVE
   Manager reviews escrowed actions in Approval Inbox
     → Approve → escrow release → action executes → event recorded
     → Reject → rejection event recorded as learning signal

5. LEARN
   effect-tracker.ts monitors outcomes (payment received? when? how much?)
     → autonomy-enforcer.ts updates coverage cells
     → Employee earns autonomy over time → fewer approvals needed
```

---

## 4. YC Demo Script (2:20)

### 0:00-0:08 — Hook

Landing page. Clean design.

> "Every company has overdue invoices nobody's following up on. We built an AI employee that does it for you."

Click "Get Started."

### 0:08-0:40 — Hire Riley

Onboarding flow against pre-seeded Stripe test account.

**Connect Stripe:** Show API key entry (honest, not fake OAuth). "Connected — found 234 customers, 1,847 invoices."

**Meet Riley:** Role card, default name, boundary sliders. 5 seconds.

**Build context:** Progress phases. "Riley has identified 14 accounts requiring attention." 10-15 seconds. If backfill is slow, jump cut.

**Activate.** Redirect to dashboard.

### 0:40-1:00 — Riley's Dashboard

> "Riley has already prioritized 14 overdue accounts and started working."

Show status, attention badge (3 approvals), active work list, performance cards (honest zeros if just started).

> "Let's see what Riley is recommending."

Click into approvals.

### 1:00-1:50 — The Approval Moment

**Card 1: Formal follow-up.** $4,200 invoice, 23 days overdue.

> "Look at the evidence."

Evidence bundle (all Stripe-sourced):
- "Acme Corp has paid 8 of 10 invoices on time. The two late payments were both in Q4."
- "No open disputes. Last payment received 45 days ago."
- "Assessment: likely an oversight. Recommending professional follow-up."
- "This action is in a human-review lane under Riley's current guardrails."

Click Approve. Badge decrements 3 → 2. Card shows "Sent."

**Card 2: Escalation.** $12,000 invoice, 45 days overdue.

> "This one Riley won't email. There's an active dispute on a different invoice. Riley's policy: don't contact accounts with active disputes. Instead, Riley escalated with a full brief."

Show escalation evidence.

> "Same employee, same system, completely different judgment. That's what the world model gives you."

### 1:50-2:10 — Account Brief

Click into Acme Corp.

> "You can drill into any account."

Payment timeline, Riley's actions, open items. All Stripe-sourced data.

> "This context is why Riley's follow-ups aren't generic. They reference specific invoices, specific amounts, specific patterns."

### 2:10-2:20 — Close

Back to dashboard.

> "One AI employee. Connected to Stripe in 5 minutes. Evidence-backed collection decisions. Policy guardrails. Learns from outcomes over time. We're onboarding our first design partners now."

> "We're Nooterra. We're building AI employees for every core business function, starting with the one that pays for itself."

### Demo Requirements

**Must be real:** Stripe connection, backfill, graph build, provisioning, dashboard data, approval evidence bundles, account brief data, LLM reasoning.

**Can be staged:** Test Stripe account pre-seeded with ~200 customers and contrasting scenarios (clean late payer + disputed account). Planner pre-triggered so dashboard shows work on load.

**Critical path (in priority order):**
1. Evidence bundle quality — approval cards must show specific, contextual reasoning from actual context assembly pipeline
2. Onboarding end-to-end — connect → build → activate in one take
3. Dashboard with real data — fake numbers are instantly detectable
4. Two contrasting scenarios — "same employee, different judgment" is the thesis
5. Account brief with temporal history — proves this isn't just current state

---

## 5. What's Explicitly Deferred

- Real-time Stripe webhook ingest for connected accounts
- Subscription and refund backfill through connector path
- Multi-employee support / "My Team" view
- Role marketplace or custom role creation
- Self-serve onboarding without white-glove support
- Additional connectors (Salesforce, Zendesk, product usage)
- Edit & Approve on escrowed actions
- Charts or detailed analytics
- Full policy DSL / policy editor
- Autonomous outbound across multiple channels
- Performance claims without pilot data
- In-place grant update (pilot uses revoke-and-recreate)

---

## 6. Blast Radius Summary

| Category | New | Modified | Untouched |
|---|---|---|---|
| src/ files | 1 | 5 | ~40+ |
| services/ files | 0 | 2 | ~30+ |
| dashboard/ files | 11 | 3 | ~20+ |
| DB migrations | 0 | 0 | 81 |

Totals: 12 new files, 10 modified files. Everything else untouched.
