# Incident Response

Use this runbook when the launch loop is degraded for real users.

Launch-critical incident classes:

- payments host outage
- hosted approval outage
- auth outage

The operating goal is always the same:

1. contain unsafe behavior
2. preserve the artifact chain
3. restore the supported path
4. document what was blocked, unwound, or retried

## Global response rules

Apply these rules to every launch incident:

1. Fail closed. Do not create side channels that bypass approvals, grants, receipts, or disputes.
2. Preserve evidence first. Export the affected receipt, run, settlement, and dispute artifacts before attempting recovery.
3. Use bounded controls. Prefer host, channel, or action-type emergency controls before broad shutdown.
4. Keep support synchronized. Every operator action should map to a clear customer-facing status update or support macro.

## Alerts and controls index

Use these references during every incident:

- Launch readiness / synthetic smoke:
  - [Launch Checklist](launch-checklist.md)
  - [Operations Runbook](operations.md)
- Public launch health:
  - `/status`
- Operator emergency controls:
  - `/operator`
  - `GET /ops/emergency/state`
  - `GET /ops/emergency/events`
- Alert pack source:
  - `docs/ALERTS.md`

## Severity guide

### `SEV-1`

- out-of-scope execution succeeds
- payment capture occurs before verification passes
- public approval path is down for all supported hosts
- auth outage blocks workspace issuance or hosted approval handoff for all supported users

Contain immediately and notify launch owner plus on-call operator.

### `SEV-2`

- one supported host is degraded
- approval latency is elevated but actions are still failing closed
- dispute or refund path is delayed but not broken

Contain by host or action type and recover inside launch hours.

### `SEV-3`

- docs, support, or telemetry drift
- isolated partner onboarding failure
- non-blocking public route regressions with working fallback

Recover quickly, but do not widen controls unless the issue spreads.

## Incident class: payments host outage

### How to detect it

Check:

- `NooterraLedgerApplyFailures`
- `NooterraReplayMismatchDetected`
- mismatch or dead-letter growth in reconciliation evidence
- partner reports that `buy` stalls after approval or fails before receipt

Useful commands:

```bash
npm run ops:money-rails:reconcile:evidence
npm run ops:dispute:finance:packet
npm run ops:x402:hitl:smoke
```

### Containment

1. Pause `action_type=buy` through emergency controls if the failure is broad.
2. If the problem is isolated, quarantine only the affected host or channel.
3. Do not disable receipts or verifier checks to keep purchases flowing.
4. If payout or capture drift is suspected, activate the relevant payout kill switch before retrying settlement.

### Recovery

1. Confirm the provider path is healthy again.
2. Re-run reconciliation evidence and compare against the incident snapshot.
3. Retry only the runs whose artifacts still bind cleanly.
4. Confirm new `buy` runs close with receipts before removing the pause/quarantine.

### Exit criteria

- reconciliation evidence is green
- no new settlement mismatches appear
- one fresh `buy` completes with verification and receipt
- support has a clear customer-facing update

## Incident class: hosted approval outage

### How to detect it

Check:

- public website route smoke failures on `/approvals`
- onboarding host-success gate regressions
- steep drop in approval completion rate
- user reports of approval links serving generic shell or blank content

Useful commands:

```bash
node scripts/ci/run-public-onboarding-gate.mjs --website-base-url https://www.nooterra.ai
node scripts/ci/run-public-website-route-smoke.mjs --website-base-url https://www.nooterra.ai
npm run test:ops:onboarding-host-success-gate
```

### Containment

1. Pause the affected host or channel if approvals can no longer be rendered or trusted.
2. Keep receipt and dispute surfaces available; do not collapse the trust layer into host-only messaging.
3. Update `/status` and support responses immediately if the outage is user-visible.

### Recovery

1. Confirm same-origin control-plane routes return JSON where required and branded HTML where required.
2. Re-test hosted approval creation from onboarding.
3. Re-test approval open, decision, and resume on at least one supported host.
4. Remove the pause only after one full approval-to-receipt loop succeeds.

### Exit criteria

- `/approvals` is rendering correctly
- hosted approval creation works from onboarding
- one supported host completes approval -> receipt without operator intervention
- public route smoke is green again

## Incident class: auth outage

### How to detect it

Check:

- `public/auth-mode` failures or CORS drift
- onboarding identity or recovery step failures
- repeated inability to issue workspaces or bootstrap the runtime

Useful commands:

```bash
node scripts/ci/run-public-onboarding-gate.mjs --website-base-url https://www.nooterra.ai
npm run test:ops:onboarding-policy-slo-gate
```

### Containment

1. Pause new workspace issuance if the auth plane is returning stale or incorrect state.
2. Keep existing receipts and disputes readable.
3. If hosted approval seeding depends on the broken auth path, communicate that the system is temporarily limited to already-issued runtimes.

### Recovery

1. Restore the auth mode and passkey flow first.
2. Confirm onboarding no longer falls back into browser or route drift failure.
3. Re-run workspace issuance and hosted approval seeding on production.
4. Confirm first-governed-action links are stable again before reopening issuance broadly.

### Exit criteria

- workspace creation works
- sign-in or recovery works
- hosted approval seeding works from the branded onboarding path
- onboarding gate is green

## Artifact preservation checklist

Before retrying anything, preserve:

- request id
- run id
- execution grant id
- receipt id
- dispute id if present
- verifier outcome
- reconciliation evidence artifact
- emergency control event ids

## Customer communication

Always send a clear state update:

- what is affected
- whether existing receipts/disputes are still available
- whether new actions are paused
- what the next expected update time is

Use the matching entries in [Support Macros](support-macros.md) so the language stays consistent.

## Post-incident review

Record:

- start and end time
- severity
- incident class
- kill switches or quarantines used
- affected hosts/channels/action types
- artifact ids preserved
- the exact gate or smoke that would have caught the failure earlier

## Related guides

- [Operations](operations.md)
- [Launch Checklist](launch-checklist.md)
- [Support Macros](support-macros.md)
