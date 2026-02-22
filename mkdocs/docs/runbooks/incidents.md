# Incident Response

Use this playbook for policy, payment, verification, or escalation incidents.

## Severity triggers

- Verification failures spike unexpectedly
- Escalation queue cannot be drained
- Reversal/unwind jobs stall
- Webhook failures create sustained dead-letter growth

## Standard response flow

1. **Contain**
   - Freeze affected tenant/agent surface.
   - Stop unsafe automation paths.
2. **Preserve evidence**
   - Export receipts/closepacks and relevant logs.
3. **Stabilize**
   - Recover queue processing and operator decision loop.
4. **Recover**
   - Replay/reconcile deterministic artifacts.
5. **Review**
   - Publish root cause + preventative controls.

## Useful commands during response

```bash
npm run ops:x402:hitl:smoke
npm run ops:money-rails:reconcile:evidence
npm run ops:dispute:finance:packet
npm run test:ops:throughput:incident
```

## Exit criteria

- Verification path green for normal traffic
- Escalation backlog and dead letters reduced to normal range
- Finance reconciliation packet produced and reviewed
- Follow-up controls queued with ownership
