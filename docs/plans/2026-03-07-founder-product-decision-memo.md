# Nooterra Founder Product Decision Memo

Date: March 7, 2026  
Status: Decided  
Parent PRD: [docs/PRD.md](/Users/aidenlippert/nooterra/docs/PRD.md)  
Execution board: [docs/plans/2026-03-06-phase-1-execution-board.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-06-phase-1-execution-board.md)  
Launch-critical build list: [docs/plans/2026-03-07-phase-1-launch-critical-build-list.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-07-phase-1-launch-critical-build-list.md)

## Purpose

Lock what Nooterra is launching first, why that product matters, and what must be cut so the company does not drift into a larger but weaker story.

## March 9 Correction

The earlier product framing drifted toward a managed delegation network.
That is not the launch product.

Launch v1 is the host-first Action Wallet and run-contract layer:

- external hosts create intents and execute
- Nooterra owns approvals, scoped grants, evidence, receipts, disputes, and operator recovery
- Nooterra does not own last-mile execution at launch

Moved to `Phase 1.5+`:

- certified execution adapters
- strict-domain browser fallback
- managed specialists
- first-party assistant shell

## Decision

Nooterra should launch as the trust and control plane for external agent hosts.

It is:

- one hosted approval and wallet surface
- one grant and policy layer
- one evidence, receipt, and dispute layer
- one operator recovery surface
- one host pack for launch channels

It is not:

- a generic chatbot
- a managed specialist marketplace
- an execution network that takes over the last mile
- a broad enterprise connector platform

## Product in One Sentence

Nooterra gives external agent hosts a user-trusted approval, grant, evidence, receipt, and dispute layer for material actions.

## Why This Product Now

The capability layer is moving quickly:

- hosts can plan better
- tool use is improving
- browser use is improving
- payment rails are becoming programmable

But the trust layer is still fragmented:

- approvals are inconsistent
- spend limits are unclear
- proof is often weak
- recourse is usually missing

That creates a cleaner wedge than “build another assistant.”

The valuable thing is not more planning intelligence.
It is bounded delegation with receipts and recourse.

## Launch Wedge

Supported actions:

1. `buy`
2. `cancel/recover`

Supported channels:

1. `Claude MCP`
2. `OpenClaw`

Launch promise:

1. host creates intent
2. user sees hosted approval
3. Nooterra issues a scoped grant
4. host executes within that boundary
5. host submits evidence
6. Nooterra verifies, issues receipt, and handles dispute or recovery

## Why We Are Not Owning Execution Yet

Owning last-mile execution now would multiply scope in exactly the wrong places:

- provider-specific runtime logic
- brittle browser fallback behavior
- evidence capture variance
- more hidden manual work in rescue
- more ways to accidentally exceed scope

The host-first wallet product is already a real business and a real trust layer.
It does not need owned execution to be coherent.

If we ever decide to own an execution path later, that should be a separate product decision after the control plane is trusted.

## What Must Be True at Launch

- approvals are legible and bounded
- grants are scoped and revocable
- evidence requirements are explicit
- receipts are deterministic and complete
- disputes work end to end
- operator rescue is real, not theater
- payment capture never happens before verification passes

## What We Must Not Do

- widen beyond `buy` and `cancel/recover`
- add more launch channels
- imply generic browser automation is trustworthy launch coverage
- disguise manual fulfillment as autonomous execution
- ship vague receipts that amount to “the AI said it worked”

## Build Order

1. Freeze the object model, state machines, idempotency, hashing, and event taxonomy.
2. Prove host-created intent to hosted approval to grant in staging.
3. Finish evidence, receipt, dispute, and operator rescue as one loop.
4. Add one managed payment path and settlement binding.
5. Harden the host pack for Claude MCP and OpenClaw.
6. Burn in the top failure modes with design partners and runbooks.

## Founder-Owned Decisions

These still need concrete choices, but they do not change the product shape:

- the launch payment provider
- the first design-partner hosts
- the support and launch staffing window

## Launch Gates

Launch only if all of these are true:

- first host install to first approval is under 5 minutes
- approval-to-completion conversion is above 60% on supported actions
- receipt coverage is 100% for completed material actions
- no successful out-of-scope execution occurs in staging or partner pilot
- dispute resolution works end to end
- operator can quarantine a host in under 2 minutes
- payment capture never occurs before verification pass
- support can resolve the top five failure modes from runbooks

## Phase 1.5, Not Launch

- certified execution adapters
- strict-domain browser fallback
- Nooterra-owned last-mile execution
- first-party assistant shell
- booking or rebooking
- enterprise connectors
- ChatGPT app packaging
- open marketplace publication

## Bottom Line

The right launch is smaller than the old managed-network story, but stronger.

The company should launch the layer that makes host execution trustworthy:

- approval
- grant
- evidence
- receipt
- dispute
- operator recovery

Everything else is optional until this works.
