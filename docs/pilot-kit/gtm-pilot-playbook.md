# GTM Pilot Playbook (Autonomous Workflows)

This playbook turns Nooterra pilot work into repeatable pipeline and expansion motion.

## 1) Pilot objective

Win a paid pilot that proves three things in 30-60 days:

- Adoption: teams can reach first verified invoice fast.
- Economic value: decisions and payout workflow move faster with fewer disputes.
- Reliability: verification and buyer decision workflows are stable under real usage.

## 2) ICP and sequencing

Start with workflows where SLA ambiguity already causes payment friction:

1. Agent-driven service workflows (fastest path, clear completion evidence)
2. Delivery/security/field operations (high compliance pressure, recurring SLA checks)
3. Maintenance/inspection workflows (higher contract value, longer cycle)

Buyer personas:

- Ops owner (workflow + dispute pain)
- Finance/procurement owner (payable controls + auditability)
- Security/compliance reviewer (trust and evidence integrity)

## 3) 6-week pilot motion

Week 0:

- Scope one vendor, one buyer, one contract workflow.
- Lock target KPIs and baseline current process.
- Configure tenant settings, SLA template, webhook endpoint.

Week 1-2:

- Run onboarding wizard and first production-like uploads.
- Validate buyer approve/hold flow and receipt downloads.
- Confirm webhook delivery into buyer/vendor systems.

Week 3-4:

- Increase run volume and edge-case coverage (amber/red paths).
- Tune template overrides and policy behavior.
- Track decision latency and dispute deltas weekly.

Week 5-6:

- Publish KPI delta vs baseline.
- Package evidence + case study draft.
- Convert pilot to annual expansion plan.

## 4) Outreach templates

### A) Cold outreach (ops leader)

Subject: Reduce automation-work invoice disputes in 30 days

Hi {{Name}},

Teams using external agents and automation vendors often lose time in invoice review because SLA evidence and approvals are fragmented.
Nooterra gives buyers a single verification link with signed artifact evidence and approve/hold decisions.

For a pilot, we scope one workflow and target:

- faster buyer decision cycle
- fewer disputed invoices
- audit-ready packet export per run

Open to a 20-minute fit check next week?

### B) Security/procurement intro

Subject: Pilot review packet for autonomous-work verification controls

Hi {{Name}},

Sharing our pilot security/procurement packet:

- architecture and data flow
- redaction and retention behavior
- deterministic verification and audit outputs

If useful, we can run a narrow pilot with your current workflow and keep controls aligned to your review process.

### C) Follow-up after demo

Subject: Proposed pilot scope and KPI gates

Thanks for the walkthrough.

Proposed pilot scope:

- Workflow: {{workflow}}
- Duration: {{6 weeks}}
- KPI gates:
  - first verified invoice < {{target}}
  - buyer decision within 24h > {{target}}
  - dispute rate reduction > {{target}}

If this looks right, we can start setup this week.

## 5) Pilot success criteria

Use these default gates unless the customer sets stricter values:

- Time-to-first-verified-invoice: < 30 minutes
- Buyer decision within 24h: > 50%
- Webhook delivery success: > 99%
- Verification latency p95: < 10 seconds
- Run listing latency (100+ runs): < 500ms
- Dispute rate delta vs baseline: at least 25% reduction

Must-have exit criteria:

- At least one full approve path and one hold path demonstrated.
- Buyer confirms artifact-derived evidence is sufficient for decisions.
- Finance/procurement accepts exported audit packet format.

## 6) Weekly pilot operating cadence

Weekly 45-minute review with customer:

1. KPI dashboard review (adoption/economic/reliability)
2. Incident and edge-case review (red/amber failures)
3. Template/policy updates needed
4. Next-week volume and success targets

Internal Nooterra cadence:

- Monday: KPI check + risk log update
- Wednesday: technical blockers + integration follow-up
- Friday: customer summary + expansion signal scoring

## 7) Case study format

Use this exact structure for repeatable proof:

1. Customer context
2. Baseline process and pain
3. Pilot scope (workflow, parties, duration)
4. Implementation (wizard, verify flow, buyer decisions, webhooks)
5. Measured results (before vs after)
6. Security/compliance posture summary
7. Customer quote + rollout plan

Required evidence bundle for every case study:

- KPI table with baseline and pilot values
- sample verification status outputs (green/amber/red)
- decision receipt examples
- audit packet index snapshot
- webhook delivery success stats

## 8) Expansion conversion checklist

Before conversion:

- Multi-team onboarding plan approved
- Contract templates mapped into SLA templates
- Buyer users and approval roles defined
- Reporting/export requirements confirmed

Expansion triggers:

- >2 workflows requesting integration
- finance team asks for monthly audit exports
- procurement asks to standardize verification language across vendors

## 9) Kill criteria

Stop or re-scope if, by week 3:

- no measurable KPI movement,
- buyer does not use decision workflow,
- integration owner cannot maintain webhook/ops path.

Every GTM and product action must improve at least one of:

- adoption speed,
- auto-approval rate,
- retention/expansion probability.
