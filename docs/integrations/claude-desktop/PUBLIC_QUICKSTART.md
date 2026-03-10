# Claude Desktop Public Quickstart (Action Wallet v1)

Use this when you want the shortest path from npm setup to a hosted approval page in Claude Desktop.

Execution model: Claude or its connected adapter executes the external action after approval. Nooterra only handles approval, scoped grants, evidence submission, receipts, and disputes.

Launch v1 on this channel supports only:

- `buy`
- `cancel/recover`

Prereqs:

- Claude Desktop installed and signed in
- Node.js 20.x

## 1) Run setup

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

## 3) First approval proof

In Claude Desktop, run:

- `Use Nooterra to create a buy action intent, request approval, and return only JSON with approvalUrl, actionIntentId, and requestId.`

Expected result:

- a Nooterra-hosted approval URL
- stable `actionIntentId` and `requestId`
- no unsupported host, booking, or marketplace prompt

Stop here first. This is the launch proof path.

## 4) After approval

After opening the approval URL and making a decision, run:

- `Use Nooterra to check the approval status for requestId <requestId>. If it is approved, fetch the execution grant and return only JSON.`

Expected result:

- approval state changes from `pending`
- approved run returns an execution grant Claude can use for the host-side execution step

## 5) Complete the loop

After Claude or the connected adapter completes the external action, run:

- `Use Nooterra to submit host-captured evidence if needed, finalize the host-completed run, and fetch the receipt. Return only JSON with receiptId, settlement status, and dispute state.`

Expected result:

- finalization returns a receipt id that can be opened on the hosted receipt page
