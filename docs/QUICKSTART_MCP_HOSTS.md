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

## The exact Action Wallet activation loop

Every supported entrypoint uses the same launch-scoped loop:

1. `Runtime bootstrap`
2. `Request first approval`
3. `Open receipt`
4. `Open dispute`

The host or engineering shell changes. The trust surfaces do not.

## 1) Runtime bootstrap

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
The fastest Codex/API/CLI proof is:

```bash
NOOTERRA_TENANT_ID=tenant_example npm run quickstart:action-wallet:first-approval
```

That script bootstraps the runtime, runs the smoke test, seeds the first hosted approval, runs the managed first paid call, and prints the exact approval URL, request id, run id, and receipt URL you need next.

Channel-specific bootstrap:

- `Claude MCP`
  - restart Claude Desktop after setup writes the MCP config
- `OpenClaw`
  - run `openclaw doctor`, then open `openclaw tui --session main` if you want an interactive session
- `Codex / API / CLI`
  - export the same runtime values from setup or onboarding and use them through the engineering quickstart in `docs/integrations/codex/ENGINEERING_QUICKSTART.md`

## 2) Request first approval

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

Suggested first prompt in Claude MCP or OpenClaw:

- `Use Nooterra to create a buy action intent for a small demo purchase, request approval, and return only JSON with approvalUrl, actionIntentId, and requestId.`

Suggested first request from Codex/API/CLI:

- create the action intent
- request the approval
- print only `approvalUrl`, `actionIntentId`, and `requestId`

Stop here first. The activation loop is working once you have:

- a Nooterra-hosted approval URL
- a stable `actionIntentId`
- a stable `requestId`

## 3) Open receipt

After opening the approval URL and making a decision, continue with:

- `Use Nooterra to check the approval status for requestId <requestId>. If approved, fetch the execution grant and return only JSON. The host will execute the external action after that.`

Expected result:

- approval status moves from `pending` to `approved`, `denied`, `expired`, or `revoked`
- approved requests return a scoped execution grant the host can use to execute the external action
- hosts that need to span model turns can start the same flow in task mode and later resolve it with `tasks/result`

Then complete the launch loop:

Only after the host has executed the external action and has evidence:

- `Use Nooterra to submit host-captured evidence if needed, finalize the host-completed run, and fetch the receipt. Return only JSON with receiptId, settlement status, and dispute state.`

Success for this step means:

- the host or shell can fetch the execution grant after approval
- the external action still happens host-side, not in Nooterra
- finalization returns a stable `receiptId`
- the hosted receipt page opens cleanly

## 4) Open dispute

Only if the receipt needs follow-up:

- `Use Nooterra to open or look up the dispute case for receiptId <receiptId> and return only JSON with disputeId and dispute state.`

Success for this step means:

- the dispute is opened from the same run or receipt context
- the dispute path is hosted by Nooterra
- the run stays legible to support and operators without manual reconstruction

## 5) Expected success signals

- host can call the `nooterra.*` tools without manual key edits
- approval link opens a Nooterra-hosted page
- approval status changes from `pending` to a terminal decision
- approved runs return an execution grant that stays in scope for host-side execution
- finalization returns a receipt id and the receipt page can be opened

## 6) Local smoke from the repo workspace

If you are developing inside the repo, this checks tool wiring:

```bash
npm run mcp:probe
```

If your MCP client supports resources and task-augmented requests, also use:

- `resources/read` on `nooterra://action-wallet/launch-scope`
- `resources/read` on `nooterra://action-wallet/receipts/<receiptId>`
- `tools/call` with `task: { "ttl": 60000 }` for `nooterra.finalize_action`, then `tasks/result`

## 7) Troubleshooting

- `approval link expired`
  - create a fresh approval request from the host and retry
- `unsupported host`
  - use `claude` or `openclaw` only for launch v1
- `nooterra setup` did not write host config
  - rerun `nooterra setup` in `quick` mode and confirm the selected host
- host cannot run `npx`
  - install Node.js 20.x and ensure `npx` is in `PATH`
