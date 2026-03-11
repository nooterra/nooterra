# Launch Checklist

This is the operator-facing launch checklist for Action Wallet v1.

It is the short version of the full internal plan in:

- `docs/plans/2026-03-06-phase-1-launch-checklist.md`

Use this page for go/no-go review, partner readiness, and launch-hour operations.

## Scope lock

Launch is only ready if all of these remain true:

- supported actions are `buy` and `cancel/recover`
- supported launch hosts are `Claude MCP` and `OpenClaw`
- hosted approvals, grants, receipts, disputes, and operator rescue are the launch-critical surfaces
- Nooterra is not positioned as the last-mile executor

## Product loop

- [ ] A host can create an action intent through the public API
- [ ] A host can request a hosted approval and receive a stable `approvalUrl`
- [ ] A host can fetch a scoped execution grant only after approval or standing-rule auto-approval
- [ ] Finalize enforces required evidence and fails closed on mismatch
- [ ] A receipt is generated for every completed material action
- [ ] A user can open a dispute from the receipt or run context

## Wallet and approval

- [ ] Users can sign in and recover access through a launch-approved auth path
- [ ] Approval links are short-lived and non-reusable after decision
- [ ] Hosted approval pages show host, action, vendor/domain, spend bounds, time window, evidence requirements, and recourse path
- [ ] Users can revoke trusted hosts, standing rules, and not-yet-executed grants

## Settlement and trust

- [ ] Launch uses one managed payment provider
- [ ] `buy` can authorize, verify, capture after verification, and refund
- [ ] `cancel/recover` closes with the correct receipt state even when there is no capture
- [ ] Payment capture never occurs before verification passes
- [ ] Receipt coverage is 100% for completed material actions

## Operator rescue

- [ ] Operators can inspect intent, approval, grant, evidence, settlement, receipt, and dispute state from one run detail view
- [ ] Operators can retry finalize, request more evidence, pause, revoke, refund, resolve dispute, and quarantine a host
- [ ] Every operator action is auditable and tied to an actor and note
- [ ] Kill switches exist per host, per channel, and per action type

## Reliability and safety

- [ ] Invalid state transitions are blocked and logged
- [ ] Idempotency keys are enforced on create and finalize paths
- [ ] Stable hashes exist for intent, grant, evidence bundle, and receipt
- [ ] Approval, finalize, webhook, and queue failures are observable through logs and alerts
- [ ] Synthetic smoke tests cover staging and production launch loops
- [ ] Backup and restore drill evidence is current

## Launch metrics

- [ ] Install-to-first-approval time is under 5 minutes
- [ ] Approval-to-completion conversion is above 60% on supported actions
- [ ] Receipt coverage is 100%
- [ ] No successful out-of-scope execution appears in staging or partner pilot
- [ ] Dispute resolution works end to end without DB repair
- [ ] Operator can quarantine a host in under 2 minutes

## Staffing and comms

- [ ] Launch owner is assigned
- [ ] On-call operator is assigned
- [ ] Rollback owner is assigned
- [ ] Customer support contact and escalation path are documented
- [ ] Design partner comms window is staffed for launch hours

## Rollback triggers

Rollback immediately if any of these appear:

- out-of-scope execution succeeds
- payment capture occurs before verification pass
- receipt coverage drops below 100% for completed material actions
- dispute flow requires manual DB repair
- launch host install path breaks repeatedly for supported hosts

## Related guides

- [Launch Readiness Scorecard](../guides/launch-readiness-scorecard.md)
- [Production Cutover](../guides/production-cutover.md)
- [Operations](operations.md)
- [Incident Response](incidents.md)
