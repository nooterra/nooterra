# OpenClaw Public Quickstart (Action Wallet v1)

Use this when you want the shortest path from npm setup to a hosted approval page in OpenClaw.

Execution model: OpenClaw or its connected adapter executes the external action after approval. Nooterra only handles approval, scoped grants, evidence submission, receipts, and disputes.

Launch v1 on this channel supports only:

- `buy`
- `cancel/recover`

Prereqs:

- Node.js 20.x (install is fail-fast if you use a different major)

## The exact Action Wallet activation loop

OpenClaw uses the same launch loop as Claude MCP and Codex:

1. `Runtime bootstrap`
2. `Request first approval`
3. `Open receipt`
4. `Open dispute`

## 1) Runtime bootstrap

Follow OpenClaw docs:

- https://docs.openclaw.ai/install/index
- https://docs.openclaw.ai/start/wizard

Then run onboarding:

```bash
openclaw onboard --install-daemon
openclaw doctor
```

If `openclaw` is not on PATH yet, use the npx fallback:

```bash
npx -y openclaw@latest onboard --install-daemon
```

## 2) Run Nooterra setup from npm

Interactive path (recommended):

```bash
npx -y nooterra@latest setup
```

Choose:

1. `host`: `openclaw`
2. setup mode: `quick`
3. sign in or create account
4. let setup write the OpenClaw MCP config

## 2) Request first approval

Run:

```bash
openclaw doctor
openclaw agent --local --agent main --session-id nooterra-smoke --message "Use Nooterra to create a buy action intent, request approval, and return only JSON with approvalUrl, actionIntentId, and requestId." --json
```

Expected result:

- a Nooterra-hosted approval URL
- stable action and approval ids
- no unsupported marketplace or booking flow

If your TUI is in a channel-bound session (`whatsapp:*`, `telegram:*`), switch to `main` first:

```bash
openclaw tui --session main
```

Stop here first. This is the launch proof path.

## 3) Open receipt

After opening the approval URL and making a decision, continue with:

- `Use Nooterra to check the approval status for requestId <requestId>. If it is approved, fetch the execution grant and return only JSON.`

Expected result:

- approval state changes from `pending`
- approved run returns an execution grant OpenClaw can use for the host-side execution step

## 5) Complete the loop

After OpenClaw or the connected adapter completes the external action, run:

- `Use Nooterra to submit host-captured evidence if needed, finalize the host-completed run, and fetch the receipt. Return only JSON with receiptId, settlement status, and dispute state.`

Expected result:

- finalization returns a hosted receipt path and a dispute path

## 4) Open dispute

If the receipt needs follow-up, continue with:

- `Use Nooterra to open or look up the dispute case for receiptId <receiptId> and return only JSON with disputeId and dispute state.`

## Notes for operators

- Public users do not need to clone the Nooterra repo.
- Public users should not need bootstrap/admin keys in the default setup path.
- Public path is valid only after publishing a package version that includes the current setup flow.
- For OpenClaw skill packaging and publish flow, see:
  - `docs/integrations/openclaw/nooterra-mcp-skill/SKILL.md`
  - `docs/integrations/openclaw/nooterra-mcp-skill/skill.json`
  - `docs/integrations/openclaw/CLAWHUB_PUBLISH_CHECKLIST.md`
