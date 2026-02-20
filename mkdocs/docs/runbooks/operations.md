# Operations Runbook

## Daily

- Check escalation queue health
- Check delivery retry/dead-letter queue state
- Sample verify receipts and closepacks
- Check onboarding runtime loop health (`runtime bootstrap -> MCP smoke -> first paid call`)
- Confirm conformance matrix runs are green and not rate-limited

## Release

- Run conformance suite
- Run replay comparison gates
- Validate export and reconciliation contracts
- Re-run onboarding conformance matrix with an idempotency key and verify `reused=true` behavior

## Weekly

- Secret rotation drills
- Policy drift checks
- Incident postmortem reviews

## Related Runbook

- [Onboarding Runtime Loop](onboarding-runtime.md)
