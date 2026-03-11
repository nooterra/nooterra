# Design Partner Onboarding Kit

This page is the compact handoff package for launch partners running Action Wallet v1.

Use it for:

- agentic startups integrating Nooterra into an existing host
- technically inclined SMB teams piloting governed agent actions
- internal launch support and onboarding calls

The goal is simple:

**get from account creation to first approval to first receipt with no dead ends.**

## What partners should understand first

Action Wallet v1 is host-first.

For launch:

- the external host executes
- Nooterra governs approval, grant, evidence, receipt, dispute, and operator recovery
- supported actions are `buy` and `cancel/recover`
- launch hosts are `Claude MCP` and `OpenClaw`
- `Codex`, `CLI`, and direct `API` usage reuse the same runtime contract

## The launch loop

Every partner should be able to complete this loop on day one:

1. Create a workspace and sign in
2. Bootstrap the runtime
3. Seed a hosted approval
4. Open the hosted approval page
5. Run the first governed action
6. Open the receipt
7. Open a dispute if needed

Success is not “the UI loaded.”

Success is:

- a stable `approvalUrl`
- a stable `actionIntentId`
- a stable `requestId`
- a receipt the partner can reopen later

## Channel-specific starting points

### Claude MCP

Use:

- [Claude Desktop Quickstart](claude-desktop-quickstart.md)

Target outcome:

- install to first approval in under 5 minutes

### OpenClaw

Use:

- [OpenClaw Quickstart](openclaw-quickstart.md)

Target outcome:

- install to first approval in under 5 minutes

### Codex, CLI, and direct API

Use:

- [Codex Engineering Quickstart](codex-engineering-quickstart.md)
- [API Surface](../reference/api-surface.md)

These are not separate certified launch hosts, but they should complete the same runtime loop.

## Partner handoff checklist

Before a partner session, confirm all of these:

- partner has a valid workspace
- hosted auth flow works from `www.nooterra.ai`
- runtime bootstrap returns `NOOTERRA_BASE_URL`, `NOOTERRA_TENANT_ID`, and `NOOTERRA_API_KEY`
- channel quickstart link is known and tested
- one sample `buy` or `cancel/recover` flow is prepared
- receipt and dispute pages are reachable from the resulting run

## Metrics to capture

Track these for every partner:

- install-to-first-approval time
- approval completion rate
- approval-to-completion conversion
- receipt coverage
- repeat host usage

If the partner cannot reach first approval quickly, treat that as a launch blocker, not a sales objection.

## Support expectations

Partners should know exactly where to go next:

- first problem in setup: return to [Quickstart](quickstart.md)
- host/runtime mismatch: use [Launch Host Channels](launch-host-channels.md)
- receipt or dispute confusion: use the hosted receipt/dispute pages, not raw backend inspection
- incident or production failure: hand off to [Incident Response](../runbooks/incidents.md)

## What is intentionally out of scope

Do not position launch as:

- a Nooterra-owned execution network
- a general workflow builder
- an enterprise connector platform
- ChatGPT app packaging
- browser fallback or owned last-mile execution

Those are not part of launch readiness.

## Related guides

- [Quickstart](quickstart.md)
- [Launch Host Channels](launch-host-channels.md)
- [State-of-the-Art Onboarding](state-of-the-art-onboarding.md)
- [Launch Checklist](../runbooks/launch-checklist.md)
