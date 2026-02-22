# Settld Docs

Let agents spend. Keep policy in control.

Settld is the deterministic trust layer between autonomous actions and money movement.

## Start In Minutes

```bash
npx settld setup
npm run mcp:probe -- --call settld.about '{}'
npm run demo:mcp-paid-exa
```

Then follow:

1. [Quickstart](guides/quickstart.md)
2. [Integrations](reference/integrations.md)
3. [Production Cutover](guides/production-cutover.md)

## What Settld Enforces

- Deterministic decision outcomes: `allow`, `challenge`, `deny`, `escalate`
- Execution binding to policy and authorization fingerprints
- Receipt verification and closepack export
- Signed human escalation and unwind controls
- One hardened payment lane first: `x402` (Circle-backed)

## What Teams Get

- First verified receipt in one setup flow
- Deterministic finance and compliance evidence
- Dispute and reversal flows with idempotent retries
- Fail-closed onboarding and production gates
