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
export NOOTERRA_BASE_URL="https://api.nooterra.ai"
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

```bash
NOOTERRA_TENANT_ID=tenant_example npm run quickstart:action-wallet:first-approval
```

If you want the same wrapper-style entrypoint the launch hosts use, run:

```bash
node examples/codex-action-wallet/run.mjs
```

Or, if you want the script to create the workspace for you:

```bash
NOOTERRA_SIGNUP_EMAIL=founder@example.com \
NOOTERRA_SIGNUP_COMPANY="Nooterra" \
NOOTERRA_SIGNUP_NAME="Founding User" \
NOOTERRA_SIGNUP_OTP=123456 \
npm run quickstart:action-wallet:first-approval
```

Important:

- public signup only creates the tenant and issues the first recovery code
- `NOOTERRA_SIGNUP_OTP` is the emailed OTP that completes the first secure account handoff
- if you are reusing an existing tenant instead, provide:

```bash
NOOTERRA_TENANT_ID=tenant_example \
NOOTERRA_LOGIN_EMAIL=founder@example.com \
NOOTERRA_LOGIN_OTP=123456 \
npm run quickstart:action-wallet:first-approval
```

The script prints only the launch artifacts you need next:

- `tenantId`
- `approval.requestId`
- `approval.approvalUrl`
- `smoke.toolsCount`
- `firstPaid.runId`
- `firstPaid.receiptId`
- `firstPaid.receiptUrl`
- `firstPaid.verificationStatus`
- `firstPaid.settlementStatus`

Set `NOOTERRA_SKIP_FIRST_PAID_CALL=1` if you only want to stop after seeding the first hosted approval.

1. create an action intent
2. request approval
3. print or return only `approvalUrl`, `actionIntentId`, and `requestId`

Stop there first. If you have those three values, the launch-scoped activation loop is alive.

Concrete API example:

```bash
curl -X POST "$NOOTERRA_BASE_URL/v1/action-intents" \
  -H "Authorization: Bearer $NOOTERRA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "actionType": "buy",
    "summary": "Replacement charger under approval",
    "risk": "medium",
    "approvalMode": "required"
  }'
```

What good looks like:

- the runtime accepts the tenant-scoped credentials
- the response includes an approval URL or request reference
- the action does not skip straight to a silent local success path

## 3) Fetch the approved grant

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

## 3.5) Continuation polling and webhook handoff

The clean Codex continuation path is now explicit:

```bash
NOOTERRA_TENANT_ID=tenant_example \
NOOTERRA_API_KEY=sk_live_example.secret \
NOOTERRA_REQUEST_ID=apr_example \
NOOTERRA_EXECUTION_GRANT_ID=agrant_example \
NOOTERRA_RECEIPT_ID=rcpt_example \
npm run quickstart:action-wallet:continuation
```

That helper polls the approval alias, optional execution grant, and optional receipt until the continuation reaches a terminal state or times out fail-closed.

If you want webhook-based continuation updates for the hosted trust surfaces, use the managed auth-plane helper:

```bash
NOOTERRA_AUTH_BASE_URL=https://api.nooterra.ai \
NOOTERRA_MAGIC_LINK_API_KEY=ml_live_example \
NOOTERRA_TENANT_ID=tenant_example \
NOOTERRA_WEBHOOK_URL=https://ops.example.com/nooterra/continuations \
npm run quickstart:action-wallet:subscribe-webhook
```

Launch webhook events:

- `approval.required`
- `information.required`
- `receipt.ready`
- `run.update`
- `dispute.update`

## 4) Finalize and open receipt

After the host-side action finishes:

1. submit evidence if needed
2. finalize the governed run
3. fetch the linked receipt

What good looks like:

- the receipt is issued for the same governed run
- receipt state shows settlement and recourse metadata
- the receipt can be opened on the hosted `/receipts` surface

## 5) Open dispute

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
