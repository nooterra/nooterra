# Claude Desktop Public Quickstart (Action Wallet v1)

Use this when you want the shortest path from npm setup to a hosted approval page in Claude Desktop.

Execution model: Claude or its connected adapter executes the external action after approval. Nooterra only handles approval, scoped grants, evidence submission, receipts, and disputes.

Launch v1 on this channel supports only:

- `buy`
- `cancel/recover`

Prereqs:

- Claude Desktop installed and signed in
- Node.js 20.x

## The exact Action Wallet activation loop

Claude MCP uses the same launch loop as every other supported path:

1. `Runtime bootstrap`
2. `Request first approval`
3. `Open receipt`
4. `Open dispute`

## 1) Runtime bootstrap

Interactive path:

```bash
npx -y nooterra@latest setup
```

Choose:

1. `host`: `claude`
2. setup mode: `quick`
3. sign in or create account
4. let setup write Claude Desktop MCP config

## 2) Activate Claude Desktop

Restart Claude Desktop after setup writes MCP config.

## 2) Request first approval

In Claude Desktop, run:

- `Use Nooterra to create a buy action intent, request approval, and return only JSON with approvalUrl, actionIntentId, and requestId.`

Expected result:

- a Nooterra-hosted approval URL
- stable `actionIntentId` and `requestId`
- no unsupported host, booking, or marketplace prompt

Stop here first. This is the launch proof path.

## 3) Fetch the approved grant

After opening the approval URL and making a decision, run:

- `Use Nooterra to check the approval status for requestId <requestId>. If it is approved, fetch the execution grant and return only JSON.`

Expected result:

- approval state changes from `pending`
- approved run returns an execution grant Claude can use for the host-side execution step

## 4) Finalize and fetch the receipt

After Claude or the connected adapter completes the external action, run:

- `Use Nooterra to submit host-captured evidence if needed, finalize the host-completed run, and fetch the receipt. Return only JSON with receiptId, settlement status, and dispute state.`

Expected result:

- finalization returns a receipt id that can be opened on the hosted receipt page

## 5) Open dispute

If the receipt needs follow-up, run:

- `Use Nooterra to open or look up the dispute case for receiptId <receiptId> and return only JSON with disputeId and dispute state.`
