# Launch 1 - Action Wallet GitHub Issues Mirror

Repo: `nooterra/nooterra`
Source backlog: `planning/linear/action-wallet-v1-backlog.json`

## Summary

- Epics: 11
- Ticket issues: 110
- Milestones: 7
- Scope lock: V1 lets external agent hosts create action intents for buy and cancel/recover flows, send users to Nooterra-hosted approval pages, receive scoped execution grants, submit evidence, finalize runs, issue receipts, and open disputes.

## Label Model

- One `prio:*` label per issue
- One `stream:*` label per issue
- One `type:*` label per issue
- `program:launch` for program grouping
- `lane:tracker` + `status:tracker-umbrella` for epics
- `lane:active` + `status:missing-gap` for ticket issues

## AW-S0 - Scope and architecture freeze

Goal: Scope and architecture freeze. Ship: ACT-001; ACT-002; ACT-003; ACT-004; ACT-005; ACT-006; ACT-007; ACT-008; ACT-009; ACT-130; ACT-139. Exit gate: schemas locked; state machines locked; non-goals locked; design partner list committed.

Issue count: 11

- [ACT-001] Freeze v1 object model
- [ACT-002] Define intent state machine
- [ACT-003] Define approval state machine
- [ACT-004] Define execution grant semantics
- [ACT-005] Define receipt semantics
- [ACT-006] Define dispute lifecycle
- [ACT-007] Define idempotency model
- [ACT-008] Define deterministic hashing
- [ACT-009] Define event taxonomy
- [ACT-130] Narrative reset docs
## AW-S1 - Control plane skeleton

Goal: Control plane skeleton. Ship: ACT-010; ACT-011; ACT-012; ACT-013; ACT-014; ACT-015; ACT-016; ACT-020; ACT-021; ACT-022; ACT-023; ACT-024; ACT-032; ACT-040; ACT-041; ACT-042; ACT-043; ACT-044; ACT-045; ACT-046; ACT-070; ACT-071; ACT-072; ACT-073; ACT-120; ACT-121; ACT-122; ACT-123. Exit gate: host can create intent; user can approve; execution grant can be fetched; all transitions logged.

Issue count: 28

- [ACT-010] Passkey-first account setup
- [ACT-011] Session management
- [ACT-012] One-time approval links
- [ACT-013] Step-up auth
- [ACT-014] Trusted host registry
- [ACT-015] Host auth model
- [ACT-016] Revocation path
- [ACT-020] POST /v1/action-intents
- [ACT-021] GET /v1/action-intents/{id}
- [ACT-022] POST /v1/action-intents/{id}/approval-requests
## AW-S2 - Evidence, receipt, and dispute core

Goal: Evidence, receipt, and dispute core. Ship: ACT-025; ACT-026; ACT-027; ACT-028; ACT-029; ACT-030; ACT-033; ACT-060; ACT-061; ACT-062; ACT-063; ACT-064; ACT-065; ACT-066; ACT-067; ACT-068; ACT-069; ACT-074; ACT-075; ACT-076; ACT-077; ACT-080; ACT-081; ACT-082; ACT-083; ACT-084. Exit gate: evidence can be submitted; verifier can pass or fail; receipt is generated; dispute can be opened from receipt page.

Issue count: 26

- [ACT-025] GET /v1/execution-grants/{id}
- [ACT-026] POST /v1/execution-grants/{id}/evidence
- [ACT-027] POST /v1/execution-grants/{id}/finalize
- [ACT-028] GET /v1/receipts/{id}
- [ACT-029] POST /v1/disputes
- [ACT-030] GET /v1/disputes/{id}
- [ACT-033] Idempotency middleware
- [ACT-060] Evidence bundle schema registry
- [ACT-061] Evidence upload service
- [ACT-062] Artifact storage integration
## AW-S3 - Payments and settlement

Goal: Payments and settlement. Ship: ACT-034; ACT-050; ACT-051; ACT-052; ACT-053; ACT-054; ACT-055; ACT-056; ACT-057; ACT-058; ACT-059; ACT-078; ACT-079; ACT-085; ACT-086; ACT-087; ACT-124; ACT-126; ACT-128. Exit gate: buy action can authorize capture and refund; cancel or recover path can close with proper receipt state; no uncapped spend possible in staging.

Issue count: 19

- [ACT-034] Rate limiting
- [ACT-050] Payment method vault integration
- [ACT-051] Add payment method UI + API
- [ACT-052] Pre-authorization / hold flow
- [ACT-053] Capture flow
- [ACT-054] Refund flow
- [ACT-055] Settlement ledger tables
- [ACT-056] Payment webhook ingestion
- [ACT-057] Failed payment states
- [ACT-058] Cancel/recover settlement rules
## AW-S4 - Host pack

Goal: Host pack. Ship: ACT-031; ACT-035; ACT-090; ACT-091; ACT-092; ACT-093; ACT-094; ACT-095; ACT-096; ACT-097; ACT-098; ACT-099; ACT-100; ACT-101; ACT-125; ACT-137. Exit gate: install-to-first-approval under five minutes on the reference host; sample integrations work in staging; hosted approval deep links are stable.

Issue count: 16

- [ACT-031] POST /v1/integrations/install
- [ACT-035] API docs generation
- [ACT-090] MCP server skeleton
- [ACT-091] MCP tools
- [ACT-092] Hosted approval deep-link flow
- [ACT-093] Continuation polling/webhook model
- [ACT-094] TypeScript SDK
- [ACT-095] Python SDK
- [ACT-096] CLI
- [ACT-097] nooterra setup
## AW-S5 - Design-partner pilots and launch-risk cuts

Goal: Design-partner pilots and launch-risk cuts. Ship: ACT-131; ACT-132; ACT-133; ACT-134; ACT-135; ACT-136; ACT-138. Exit gate: first partner can complete approval to receipt with host-owned execution; operators can recover the top failure modes from runbooks; no launch document or board implies Nooterra owns last-mile execution.

Issue count: 7

- [ACT-131] API reference docs
- [ACT-132] Approval UX copy
- [ACT-133] Receipt UX copy
- [ACT-134] Dispute flow copy
- [ACT-135] Support macros
- [ACT-136] Incident runbook
- [ACT-138] Launch site copy
## AW-S6 - Burn-in and launch rehearsal

Goal: Burn-in and launch rehearsal. Ship: ACT-127; ACT-129; ACT-139; ACT-140. Exit gate: 100 percent receipt coverage for material actions; 0 uncapped or out-of-scope executions; dispute flow works end-to-end without DB repair; launch metrics board is live.

Issue count: 3

- [ACT-127] Abuse controls
- [ACT-129] Backup / restore drill
- [ACT-140] Post-launch review template
