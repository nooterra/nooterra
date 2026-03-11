# Codex Engineering Quickstart

Use this path when you are driving Action Wallet from Codex, CLI, or direct API calls.

Important boundary:

- certified launch hosts remain `Claude MCP` and `OpenClaw`
- Codex, CLI, and API reuse the same runtime contract
- hosted approval, receipt, and dispute pages remain the same

## 1. Bootstrap the runtime

The fastest path is still:

```bash
npx -y nooterra@latest setup
```

Or export tenant-scoped runtime values directly:

```bash
export NOOTERRA_BASE_URL="https://api.nooterra.work"
export NOOTERRA_TENANT_ID="tenant_example"
export NOOTERRA_API_KEY="sk_example.secret"
```

## 2. Verify access

```bash
npm run mcp:probe
```

## 3. Request first approval

From Codex or your shell:

1. create an action intent
2. request approval
3. print only `approvalUrl`, `actionIntentId`, and `requestId`

Stop there first. If those values are valid, the Action Wallet runtime is alive.

## 4. Open receipt

After approval:

1. fetch approval status
2. fetch execution grant
3. let the external action happen outside Nooterra
4. submit evidence if needed
5. finalize and fetch the receipt

## 5. Open dispute

Open or look up the dispute from the same receipt or run context when follow-up is needed.
