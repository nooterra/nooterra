# Claude Desktop Quickstart

Use this path when you want the shortest route from setup to a hosted approval page in Claude Desktop.

## Prerequisites

- Claude Desktop installed and signed in
- Node.js 20.x

## 1. Bootstrap the runtime

```bash
npx -y nooterra@latest setup
```

Choose:

1. host: `claude`
2. setup mode: `quick`
3. sign in or create account
4. let setup write the Claude MCP configuration

Then restart Claude Desktop.

## 2. Request first approval

In Claude Desktop, ask Nooterra to:

- create a `buy` or `cancel/recover` action intent
- request approval
- return only `approvalUrl`, `actionIntentId`, and `requestId`

Success at this step means the hosted approval URL opens cleanly and the ids are stable.

## 3. Open receipt

After approval:

1. check approval status
2. fetch the execution grant
3. let Claude or the connected adapter perform the external action
4. submit evidence if needed
5. finalize and fetch the receipt

## 4. Open dispute

If follow-up is needed, open or look up the dispute from the same receipt.

## Scope note

Action Wallet v1 on this channel supports only:

- `buy`
- `cancel/recover`
