# Nooterra Docs

Let agents spend. Keep policy in control.

Nooterra is the deterministic trust layer between autonomous actions and money movement.

## Start In Minutes

```bash
npx nooterra setup
npm run mcp:probe -- --call nooterra.about '{}'
npm run demo:mcp-paid-exa
```

Then follow:

1. [Quickstart](guides/quickstart.md)
2. [State-of-the-Art Onboarding](guides/state-of-the-art-onboarding.md)
3. [Launch Readiness Scorecard](guides/launch-readiness-scorecard.md)
4. [Execution Plan](guides/execution-plan.md)
5. [Integrations](reference/integrations.md)
6. [Production Cutover](guides/production-cutover.md)

## What Nooterra Enforces

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
