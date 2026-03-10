# Quickstart: Launch Host Channels (Claude Desktop, OpenClaw)

This guide is the fastest install-to-first-approval path for the locked Action Wallet v1 launch.

Locked v1 scope:

V1 lets external agent hosts create action intents for buy and cancel/recover flows, send users to Nooterra-hosted approval pages, receive scoped execution grants, submit evidence, finalize runs, issue receipts, and open disputes.

Execution model:

The host executes the external buy or cancel/recover flow. Nooterra does not perform the action. Nooterra only handles approval, scoped grants, evidence submission, receipts, and disputes.

Supported channels only:

- `Claude MCP`
- `OpenClaw`

Engineering shell note:

- `Codex` can use the same Action Wallet runtime through the API or CLI path, but it is not treated as a separate certified launch host in v1.

Explicitly out of scope for launch:

- booking or rebooking
- ChatGPT app
- enterprise connectors
- BYO payment rails
- open marketplace publishing

For deeper channel-specific steps, see:

- `docs/integrations/claude-desktop/PUBLIC_QUICKSTART.md`
- `docs/integrations/openclaw/PUBLIC_QUICKSTART.md`

## 1) Run setup

Recommended interactive path:

```bash
nooterra setup
```

Choose:

1. setup mode: `quick`
2. host: `claude` or `openclaw`
3. sign in or create account
4. let setup write the host MCP configuration

Launch v1 assumes hosted approvals and host-executed actions under a Nooterra-issued scoped grant.
Do not use unsupported hosts or BYO payment-rail setup for the launch train.

If you are validating from Codex, keep the same runtime values and follow the API or CLI install path instead of trying to register Codex as a separate MCP host.

## 2) Activate the host

- `claude`: restart Claude Desktop after setup writes the MCP config.
- `openclaw`: run `openclaw doctor`, then open `openclaw tui --session main` if you want an interactive session.

## 3) First Action Wallet flow

First-approval path tools:

- `nooterra.create_action_intent`
- `nooterra.request_approval`
- `nooterra.get_approval_status`
- `nooterra.get_execution_grant`

Full v1 loop tools:

- `nooterra.submit_evidence`
- `nooterra.finalize_action`
- `nooterra.get_receipt`
- `nooterra.open_dispute`

Modern MCP host ergonomics:

- `resources/list` exposes locked Action Wallet launch context
- `resources/templates/list` exposes dynamic Action Wallet resource entrypoints
- `resources/read` can hydrate `nooterra://action-wallet/...` objects directly into the host context window
- task-augmented `tools/call` is available for the Action Wallet host tools, with `tasks/get`, `tasks/list`, `tasks/result`, and `tasks/cancel`

Suggested first prompt inside the host:

- `Use Nooterra to create a buy action intent for a small demo purchase, request approval, and return only JSON with approvalUrl, actionIntentId, and requestId.`

Stop here first. The launch proof is successful once the host returns a Nooterra-hosted approval URL and stable ids.

## 4) After the user decides

After opening the approval URL and making a decision, continue with:

- `Use Nooterra to check the approval status for requestId <requestId>. If approved, fetch the execution grant and return only JSON. The host will execute the external action after that.`

Expected result:

- approval status moves from `pending` to `approved`, `denied`, `expired`, or `revoked`
- approved requests return a scoped execution grant the host can use to execute the external action
- hosts that need to span model turns can start the same flow in task mode and later resolve it with `tasks/result`

## 5) Complete the loop

Only after the host has executed the external action and has evidence:

- `Use Nooterra to submit host-captured evidence if needed, finalize the host-completed run, and fetch the receipt. Return only JSON with receiptId, settlement status, and dispute state.`
- `If the receipt needs follow-up, use Nooterra to open or look up the dispute case and return only JSON.`

## 6) Expected success signals

- host can call the `nooterra.*` tools without manual key edits
- approval link opens a Nooterra-hosted page
- approval status changes from `pending` to a terminal decision
- approved runs return an execution grant that stays in scope for host-side execution
- finalization returns a receipt id and the receipt page can be opened

## 7) Local smoke from the repo workspace

If you are developing inside the repo, this checks tool wiring:

```bash
npm run mcp:probe
```

If your MCP client supports resources and task-augmented requests, also use:

- `resources/read` on `nooterra://action-wallet/launch-scope`
- `resources/read` on `nooterra://action-wallet/receipts/<receiptId>`
- `tools/call` with `task: { "ttl": 60000 }` for `nooterra.finalize_action`, then `tasks/result`

## 8) Troubleshooting

- `approval link expired`
  - create a fresh approval request from the host and retry
- `unsupported host`
  - use `claude` or `openclaw` only for launch v1
- `nooterra setup` did not write host config
  - rerun `nooterra setup` in `quick` mode and confirm the selected host
- host cannot run `npx`
  - install Node.js 20.x and ensure `npx` is in `PATH`
