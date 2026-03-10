# Codex Engineering Quickstart (Action Wallet v1)

Use this when you are driving Nooterra from Codex as an engineering shell instead of installing a certified launch host.

Important boundary:

- Launch-host certification for Action Wallet v1 is still locked to `Claude MCP` and `OpenClaw`.
- Codex uses the same Action Wallet runtime through the `API` or `CLI` path.
- Approval, receipt, and dispute surfaces stay hosted by Nooterra either way.

## What this path is for

Use Codex when you want to:

- create and inspect Action Wallet intents from the terminal
- validate approval, receipt, and dispute flows without switching hosts
- build or debug the host pack against the public runtime contract

Do not treat Codex as a separate MCP launch host. Treat it as the same runtime exercised through code and shell commands.

## The exact Action Wallet activation loop

Codex uses the same launch loop as Claude MCP and OpenClaw:

1. `Runtime bootstrap`
2. `Request first approval`
3. `Open receipt`
4. `Open dispute`

Codex only changes the shell. It does not change the Action Wallet contract.

## 1) Runtime bootstrap

The fastest path is still:

```bash
nooterra setup
```

Then use the runtime bootstrap values from onboarding, or export them directly:

```bash
export NOOTERRA_BASE_URL="https://api.nooterra.work"
export NOOTERRA_TENANT_ID="tenant_example"
export NOOTERRA_API_KEY="sk_example.secret"
```

## 2) Verify local access

Check the runtime from the repo workspace:

```bash
npm run mcp:probe
```

If you only need the public runtime path, the important part is that the same tenant-scoped values work for:

- Action Wallet API calls
- CLI examples
- hosted approval pages
- receipt lookup
- dispute / recourse lookup

## 2) Request first approval

From Codex, the shortest install-to-first-approval loop is:

1. create an action intent
2. request approval
3. print or return only `approvalUrl`, `actionIntentId`, and `requestId`

Stop there first. If you have those three values, the launch-scoped activation loop is alive.

## 3) Open receipt

After opening the hosted approval URL and making a decision:

1. fetch the approval status
2. if approved, fetch the execution grant
3. let the host-side execution happen outside Nooterra
4. submit evidence if needed
5. finalize and fetch the receipt

Keep the execution step host-side. Nooterra governs approval, grants, receipts, and disputes.

Recommended hosted surfaces to keep open while using Codex:

- `/approvals`
- `/receipts`
- `/disputes`
- `/wallet`

## 4) Open dispute

If the receipt needs follow-up:

1. open the dispute from the same receipt or run context
2. return or print only `disputeId` and dispute state

This keeps Codex on the same recourse path as the certified launch hosts.

## 5) What success looks like

You know the Codex path is working when:

- the runtime accepts your tenant-scoped credentials
- you can create an action intent without manual key edits
- the approval link opens a hosted Nooterra page
- approved requests return a bounded execution grant
- finalization returns a receipt id and linked recourse state

## 6) When to switch back to a launch host

Use Claude MCP or OpenClaw when you are validating:

- install-to-first-approval time
- real host-pack ergonomics
- partner onboarding quality
- launch-channel certification

Use Codex when you are:

- building
- debugging
- validating runtime behavior quickly
