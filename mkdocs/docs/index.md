# Settld Docs

Settld is a deterministic trust layer for autonomous agent actions.

It is built for teams that want agents to execute paid workflows without losing control.

## Start Here

1. Run [Quickstart](guides/quickstart.md) to complete setup and produce your first verified receipt.
2. Follow [Local Environment](guides/local-environment.md) if you need a full local control-plane run.
3. Use [Integrations](reference/integrations.md) to wire Settld into OpenClaw, Codex, Claude, or Cursor.

## What You Get

- Deterministic policy outcomes: `allow`, `challenge`, `deny`, `escalate`
- Execution binding to policy and authorization state
- Immutable receipts and proof packets for finance/compliance replay
- Operator escalation workflow with signed decisions and audit timeline
- Reversal and unwind controls for incident response

## Live Production Surface

- Delegated authorization with replay defense
- Signed one-time operator override path
- Webhook signature verification and secret rotation
- Insolvency freeze and reversal dispatch hooks
- Closepack export and offline verification workflow

## Navigate by Job

- Understand system design: [Control Plane](architecture/control-plane.md)
- Integrate APIs: [API Surface](reference/api-surface.md)
- Run safely in production: [Operations Runbook](runbooks/operations.md)
- Plan rollout and controls: [Roadmap](roadmap.md) and [FAQ](faq.md)
