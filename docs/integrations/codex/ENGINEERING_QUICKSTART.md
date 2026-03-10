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

## 1) Issue runtime values

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

## 3) Use the first governed action path

From Codex, the shortest install-to-value loop is:

1. create an action intent
2. request approval
3. open the hosted approval URL
4. fetch the execution grant after approval
5. submit evidence if needed
6. finalize and fetch the receipt

Keep the execution step host-side. Nooterra governs approval, grants, receipts, and disputes.

## 4) Recommended developer surfaces

While using Codex, keep these hosted pages open:

- `/approvals`
- `/receipts`
- `/disputes`
- `/wallet`

That gives you the same trust surfaces a launch-host integration would rely on.

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
