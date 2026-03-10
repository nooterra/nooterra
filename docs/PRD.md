# Nooterra Action Wallet V1 PRD

Status: Launch scope locked<br />
Date: March 9, 2026<br />
Companion freeze: [docs/spec/ACTION_WALLET_V1_FREEZE.md](/Users/aidenlippert/nooterra/docs/spec/ACTION_WALLET_V1_FREEZE.md)<br />
Implementation program: [docs/plans/2026-03-06-launch-implementation-program.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-06-launch-implementation-program.md)<br />
Launch checklist: [docs/plans/2026-03-06-phase-1-launch-checklist.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-06-phase-1-launch-checklist.md)<br />
Homepage copy: [docs/marketing/action-wallet-homepage-copy-2026-03-09.md](/Users/aidenlippert/nooterra/docs/marketing/action-wallet-homepage-copy-2026-03-09.md)<br />
Product surfaces and user stories: [docs/plans/2026-03-09-action-wallet-v1-surfaces-and-user-stories.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-09-action-wallet-v1-surfaces-and-user-stories.md)<br />
Kickoff tickets: [docs/plans/2026-03-09-action-wallet-v1-first-10-ticket-packet.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-09-action-wallet-v1-first-10-ticket-packet.md)

## Product Definition

The first product we build and release is the **Nooterra Action Wallet**.

It is a host-first control layer that lets an AI host ask for approval, receive a scoped action grant, perform one real action, and return a verified receipt.

It is not:

- a first-party assistant shell
- a marketplace
- a new chatbot
- robotics
- a broad autonomous-life platform

## In Plain English

Right now AI agents can attempt actions.

Nooterra is the layer that makes an action:

- authorized
- bounded
- provable
- disputable

The simplest user promise is:

**Before an AI agent buys something or cancels something for you, it has to go through Nooterra.**

## What We Release First

The first release is:

- one public API for hosts and builders
- one hosted web app for approvals, receipts, disputes, and wallet visibility

### API for hosts and builders

Claude MCP hosts, OpenClaw agents, browser-agent products, and internal AI tools call Nooterra to:

- create an action intent
- request approval
- fetch a scoped execution grant
- submit evidence
- finalize the action
- fetch the receipt
- open a dispute

### Hosted web app for end users

Users come to Nooterra to:

- approve the action
- see what was allowed
- see what happened
- view the receipt
- dispute if something went wrong

The first release is therefore:

**API for builders plus approval and receipt UI for users.**

## Supported Actions

Launch supports exactly two actions:

1. `buy`
Example: “Buy this charger if it is under $40.”

2. `cancel/recover`
Example: “Cancel this subscription and get any refund I’m owed.”

Nothing else is in scope for launch.

## Users

There are two user groups.

### 1. The first customer

The first customer is the builder or host:

- agent builders
- AI startups
- internal AI teams
- OpenClaw builders
- Claude MCP builders

They integrate Nooterra into their host.

### 2. The end user

The end user is the person whose money, account, or authority is on the line.

They do not live inside Nooterra all day.
They touch Nooterra when:

- approval is needed
- receipt is needed
- a dispute is needed

That is the product split.

## End-to-End Flow

### 1. The user starts in some host

Examples:

- Claude with MCP
- OpenClaw
- a browser-agent product

The user says something like:
“Buy this under $40.”

### 2. The host calls Nooterra

The host sends an `Action Intent`.

That includes:

- host identity
- user identity
- requested action
- expected vendor or domain
- max spend
- required evidence
- expiration

### 3. Nooterra creates a hosted approval

The approval page shows:

- host
- action
- vendor or domain
- max spend
- expiry
- proof required
- dispute path

The user can:

- approve once
- deny
- later create standing rules where supported

### 4. Nooterra issues an execution grant

If approved, Nooterra returns a short-lived scoped grant.

That grant says:

- this host
- may do this exact action
- at this vendor or domain
- up to this cap
- until this expiry
- and must return this evidence

### 5. The host executes

In v1, the host executes.
Nooterra does not.

### 6. The host submits evidence

The host sends back:

- confirmation
- amount
- merchant
- artifact or screenshot
- timestamp

### 7. Nooterra verifies

Nooterra checks:

- grant validity
- spend cap
- allowed vendor or domain
- evidence completeness
- success-rule conformance

### 8. Nooterra issues the receipt

If verification passes, Nooterra creates the receipt.

That receipt binds:

- the original request
- the user approval
- the execution grant
- the evidence bundle
- the verification result
- settlement state
- dispute path

### 9. The user can dispute if needed

If something is wrong, the user opens a dispute from the receipt page.

That is the whole first product.

## Why This Is the First Thing

This is the smallest real primitive in the larger autonomous stack.

The world does not need a vague “agent economy” first.
It needs one consequential action that can be:

- explicitly authorized
- narrowly bounded
- proven afterward
- challenged if wrong

That is what the Action Wallet is.

## Non-Goals for Launch

We are not building first:

- a first-party assistant shell
- an agent marketplace
- open public agent publishing
- broad browser automation owned by Nooterra
- booking or rebooking
- enterprise connectors
- robots
- “life OS”
- full agent-to-agent economy

## Release Package

The first release contains:

1. Public API
2. Hosted approval pages
3. Hosted receipt pages
4. Dispute flow
5. Dashboard for wallet, approvals, receipts, disputes, and integrations
6. MCP plus OpenClaw integration pack

That is enough for launch.

## Core Objects

The first release is built around:

- `Action Intent`
- `Approval Request`
- `Approval Decision`
- `Execution Grant`
- `Evidence Bundle`
- `Receipt`
- `Dispute Case`

These objects, their state machines, and their deterministic bindings are frozen in the companion spec.

## Build Order

The literal build order is:

1. Core objects
2. State machines
3. Approval UI
4. Grant issuance
5. Evidence and receipt loop
6. Host integration pack
7. Payment and settlement handling
8. Dispute and operator tooling

That is the shortest path to a real product.

## Product Promise

Internal:

**Nooterra lets any AI host turn a risky action into an approved, scoped, verified transaction.**

External:

**AI agents can finally act on your behalf with approval, proof, and recourse.**

## Mental Model

If Stripe is:

**payments for the internet**

then Nooterra v1 is:

**approved action for AI agents**

## Scope Lock

V1 lets external agent hosts create action intents for `buy` and `cancel/recover`, send users to Nooterra-hosted approval pages, receive scoped execution grants, submit evidence, finalize runs, issue receipts, and open disputes.

Everything else is `Phase 1.5+`.
