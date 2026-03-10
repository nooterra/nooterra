# Nooterra Action Wallet Homepage Copy

Date: March 9, 2026  
Source PRD: [docs/PRD.md](/Users/aidenlippert/nooterra/docs/PRD.md)

## Page Goal

Explain the first product in one pass:

- builders understand they get an API
- end users understand they get approval, proof, and recourse
- nobody mistakes launch for a marketplace, chatbot, or owned-execution runtime

## Audience

Primary:

- Claude MCP builders
- OpenClaw builders
- browser-agent teams
- internal AI teams

Secondary:

- end users evaluating trust
- design partners
- press and investors reading the launch page

## Hero

Eyebrow:

`Nooterra Action Wallet`

Headline:

**AI agents can finally act with approval, proof, and recourse.**

Subhead:

Nooterra is the host-first API and hosted approval layer that turns risky agent actions into approved, scoped, verified transactions.

Primary CTA:

`Integrate the API`

Secondary CTA:

`See the approval flow`

Trust strip:

- Approval before action
- Scoped execution grants
- Verified receipts
- Disputes when something goes wrong

## Section 1: The Problem

Headline:

**AI agents can attempt actions. They still need a trust layer.**

Body:

Today an AI host can try to buy something, cancel something, or recover money on your behalf. What is still missing is the layer that makes that action authorized, bounded, provable, and disputable.

Nooterra is that layer.

## Section 2: What Nooterra Does

Headline:

**Before an AI agent buys something or cancels something for you, it goes through Nooterra.**

Body:

Hosts call Nooterra to create an action intent, request approval, receive a scoped grant, submit evidence, and fetch a receipt. Users come to Nooterra to approve what is allowed, inspect what happened, and dispute when something goes wrong.

## Section 3: How It Works

Headline:

**One real action. Under explicit authority. With proof and recourse.**

Step 1:

**Host creates an action intent**

The host sends who it is, what action it wants to take, where it expects to act, the spend cap, and what evidence it must return.

Step 2:

**User approves the boundary**

Nooterra shows a clean approval page with the host, action, vendor or domain, max spend, expiry, proof required, and dispute path.

Step 3:

**Nooterra issues a scoped grant**

If approved, the host gets a short-lived execution grant bound to that exact action, host, scope, cap, and expiry.

Step 4:

**Host executes and returns evidence**

In v1, the host executes. Nooterra does not. The host sends back the confirmation, amount, merchant, artifacts, and timestamp.

Step 5:

**Nooterra verifies and issues the receipt**

Nooterra checks scope, spend, vendor or domain, and evidence completeness before issuing the final receipt and dispute path.

## Section 4: Supported Actions

Headline:

**Only two actions at launch.**

Card 1:

**Buy**

Example:

“Buy this charger if it is under $40.”

Card 2:

**Cancel / Recover**

Example:

“Cancel this subscription and get any refund I’m owed.”

Caption:

No booking. No rebooking. No broad “do anything” claim.

## Section 5: Who It Is For

Headline:

**Built for hosts. Trusted by the people behind the action.**

Left column:

**For builders and hosts**

- create action intents
- request approvals
- fetch scoped grants
- submit evidence
- finalize actions
- fetch receipts

Right column:

**For end users**

- approve the action
- see what was allowed
- see what happened
- inspect the receipt
- dispute if needed

## Section 6: What Ships First

Headline:

**The first release is one API plus one hosted trust app.**

Launch package:

- public API for hosts
- hosted approval pages
- hosted receipt pages
- dispute flow
- dashboard for wallet, approvals, receipts, disputes, and integrations
- Claude MCP and OpenClaw integration pack

## Section 7: What We Are Not Shipping

Headline:

**Not the whole agent economy.**

Body:

The first release is not:

- a first-party assistant shell
- an agent marketplace
- open public agent publishing
- Nooterra-owned browser automation
- booking or rebooking
- enterprise connectors
- robots
- “run the world”

## Section 8: Closing CTA

Headline:

**Turn risky agent actions into approved, scoped, verified transactions.**

Body:

If you are building with Claude MCP, OpenClaw, or another agent host, Nooterra gives you the approval, proof, and recourse layer you should not rebuild yourself.

Primary CTA:

`Integrate Nooterra`

Secondary CTA:

`View the Action Wallet spec`

## Short Version

Internal:

**Nooterra lets any AI host turn a risky action into an approved, scoped, verified transaction.**

External:

**AI agents can finally act on your behalf with approval, proof, and recourse.**
