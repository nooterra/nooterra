# Settld Docs

Settld is the trust and control plane for autonomous agent actions.

It is built for teams that want agents to spend money with enforceable policy, deterministic receipts, and operational recourse.

## Start Here

1. [Quickstart](guides/quickstart.md): from install to first verified receipt.
2. [Local Environment](guides/local-environment.md): run API and onboarding loop locally.
3. [Integrations](reference/integrations.md): wire OpenClaw, Codex, Claude, and Cursor.

## What Is In Scope Right Now

- Deterministic decision outcomes: `allow`, `challenge`, `deny`, `escalate`
- Execution binding to policy/authorization state
- Receipt verification and closepack export
- Human-in-the-loop escalation and unwind controls
- One hardened payment lane first (`x402`, Circle-backed paths)

## Operator Outcomes

- Prove what happened for each paid action
- Reconcile finance events with deterministic artifacts
- Resolve disputes and reversals with idempotent processing
- Run onboarding and release gates fail-closed
