# Operations Runbook

This runbook is for daily production operation of Nooterra control loops.

## Daily checks

1. Confirm onboarding health:

```bash
npm run test:ci:mcp-host-smoke
```

2. Confirm host certification matrix health:

```bash
npm run test:ci:mcp-host-cert-matrix
```

3. Verify escalation/human override path:

```bash
npm run ops:x402:hitl:smoke
```

4. Sample receipt verification quality:

```bash
npm run ops:x402:receipt:sample-check
```

5. Generate reconciliation evidence:

```bash
npm run ops:money-rails:reconcile:evidence
npm run ops:dispute:finance:packet
```

## Release checks

Run before promotion:

```bash
npm run test:ops:onboarding-policy-slo-gate
npm run test:ops:onboarding-host-success-gate
npm run test:ops:go-live-gate
npm run test:ops:production-cutover-gate
npm run test:ops:release-promotion-guard
```

## Throughput / incident drills

```bash
npm run test:ops:throughput:10x
npm run test:ops:throughput:incident
```

## Related runbooks

- [Onboarding Runtime Loop](onboarding-runtime.md)
- [Incident Response](incidents.md)
- [Key Management](key-management.md)
