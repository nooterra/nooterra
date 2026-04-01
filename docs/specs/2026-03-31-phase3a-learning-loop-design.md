# Phase 3A: Learning Loop — Charter Evolution

**Date**: 2026-03-31
**Status**: Approved
**Goal**: Close the learning loop — approval patterns automatically propose charter changes, humans review and approve, charters evolve.

---

## What exists

- `learning-signals.ts` — persists signals from every execution (tool name, charter verdict, approval decision, outcome)
- `trust-learning.js` — `analyzePromotionCandidates()` identifies askFirst rules ready for promotion based on approval history + success rate
- `workers-api.js` — learning overview routes already exist

## What's missing

1. **Charter diff proposals** — analysis identifies candidates but nothing creates a reviewable proposal
2. **Proposal persistence** — nowhere to store "promote send_email from askFirst to canDo with 0.93 confidence"
3. **Approval/rejection flow** — no API for humans to review and act on proposals
4. **Charter mutation** — no code to actually modify the charter when a proposal is approved
5. **Demotion** — no analysis for demoting canDo back to askFirst when errors occur

## Design

### New migration: `056_charter_proposals.sql`

```sql
CREATE TABLE charter_proposals (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, rejected, expired
  proposal_type TEXT NOT NULL,              -- promote, demote
  tool_name TEXT,
  from_level TEXT NOT NULL,                 -- askFirst, canDo
  to_level TEXT NOT NULL,                   -- canDo, askFirst
  rule_text TEXT NOT NULL,                  -- the charter rule being changed
  confidence NUMERIC(4,2) NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}',
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### New file: `services/runtime/charter-evolution.ts`

Three responsibilities:

**1. Generate proposals** — `generateProposals(pool, workerId, tenantId)`
- Load worker charter, recent executions, approvals, and learning signals
- Call `analyzePromotionCandidates()` for promotion candidates
- Analyze signals for demotion candidates (tools with >3 errors in 30 days that are currently canDo)
- For each candidate, check if a pending proposal already exists (no duplicates)
- Insert new proposals into charter_proposals

**2. Apply proposal** — `applyProposal(pool, proposalId, decidedBy)`
- Load the proposal
- Load the worker's charter
- For promotions: move the rule from askFirst to canDo
- For demotions: move the rule from canDo to askFirst
- Update the charter in the workers table
- Mark proposal as approved
- NeverDo rules are IMMUTABLE — never promote to or from neverDo

**3. Reject proposal** — `rejectProposal(pool, proposalId, decidedBy)`
- Mark proposal as rejected

### API routes in workers-api.js

- `GET /v1/workers/:id/proposals` — list pending proposals for a worker
- `POST /v1/workers/:id/proposals/generate` — trigger proposal generation
- `POST /v1/workers/:id/proposals/:proposalId/approve` — approve and apply
- `POST /v1/workers/:id/proposals/:proposalId/reject` — reject

### Periodic generation

In the poll cycle or on a separate interval, run `generateProposals` for active workers (e.g., once per hour). This is optional for v1 — the dashboard can trigger generation via the API.

---

## PR Breakdown

### PR 1: Migration + charter-evolution module + tests
### PR 2: Wire into API routes + periodic trigger
