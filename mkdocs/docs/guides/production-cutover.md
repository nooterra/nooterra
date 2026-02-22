# First Production Cutover

Use this checklist for first real tenant traffic.

## Preconditions

- Durable database configured (`STORE=pg`)
- Ops token management and key rotation process defined
- Webhook endpoints reachable with signature verification enabled
- Rollback owner and incident comms owner assigned

## Required gates before cutover

```bash
npm run test:ops:onboarding-policy-slo-gate
npm run test:ops:onboarding-host-success-gate
npm run test:ops:production-cutover-gate
npm run test:ops:go-live-gate
```

## Cutover sequence

1. Deploy API + worker paths.
2. Run onboarding runtime loop for at least one real host.
3. Execute first paid call and verify receipt.
4. Confirm conformance matrix reports `ready=true` for selected hosts.
5. Enable pilot tenant/flow with bounded limits.
6. Monitor escalation, reversal, and delivery queues during first live window.

## Go / No-Go

Go only if all are true:

- All gates green
- Receipt verification and closepack export pass
- No unbounded dead-letter growth
- Escalation resolution path is functional end-to-end

## Rollback triggers

Rollback immediately if any of the following appear:

- Verify path fails closed unexpectedly for healthy traffic
- Escalation queue cannot be drained
- Reversal/unwind processing stalls
- Receipt verification parity breaks
