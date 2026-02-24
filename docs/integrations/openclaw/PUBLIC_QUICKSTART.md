# OpenClaw Public Quickstart (No Repo Clone)

Use this when you want a public user to set up Settld from npm in a fresh machine.

Prereqs:

- Node.js 20.x (install is fail-fast if you use a different major)

## 1) Install and onboard OpenClaw

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

## 2) Run Settld setup from npm

Interactive path (recommended):

```bash
npx -y settld@latest setup
```

Choose:

1. `host`: `openclaw`
2. setup mode: `quick`
3. wallet mode (`managed` recommended first)
4. login with OTP (new tenant is created if needed)
5. let setup run guided fund + first paid check

Non-interactive path (automation/support):

```bash
npx -y settld@latest setup \
  --non-interactive \
  --host openclaw \
  --base-url https://api.settld.work \
  --tenant-id tenant_default \
  --settld-api-key 'sk_live_xxx.yyy' \
  --wallet-mode managed \
  --wallet-bootstrap remote \
  --profile-id engineering-spend \
  --smoke
```

Advanced non-interactive key/bootstrap paths are still supported:

```bash
npx -y settld@latest setup \
  --non-interactive \
  --host openclaw \
  --base-url https://api.settld.work \
  --tenant-id tenant_default \
  --bootstrap-api-key 'ml_admin_xxx' \
  --wallet-mode managed \
  --wallet-bootstrap remote
```

## 3) Verify OpenClaw + Settld are wired

Run:

```bash
openclaw doctor
openclaw plugins install settld@latest
openclaw agent --local --agent main --session-id settld-smoke --message "Use the tool named settld_about with empty arguments. Return only JSON." --json
```

Then from OpenClaw chat/test prompt:

- `Use tool settld_about and return JSON only.`

Expected result: success payload with Settld tool metadata.

Optional packaging smoke (public ClawHub install + MCP initialize/tools/list/tools/call):

```bash
npm run -s test:ci:openclaw-clawhub-install-smoke -- --slug settld-mcp-payments --bootstrap-local
```

If install is blocked by suspicious-skill gating, add `--force`.

If your TUI is in a channel-bound session (`whatsapp:*`, `telegram:*`), switch to `main` first:

```bash
openclaw tui --session main
```

## 4) Run first paid tool call

From OpenClaw prompt:

- `Use tool settld_call with tool=settld.weather_current_paid and arguments={"city":"Chicago","unit":"f"}.`

Expected result:

- tool call succeeds
- response includes policy/decision/settlement headers (`x-settld-*`)

## 4.1) First collaboration flow (copy/paste prompts)

Run these in order inside OpenClaw:

1. `Use Settld to discover the top 3 agents for code.generation.frontend.react with min reputation 92 and max price $3. Return JSON only.`
2. `Use Settld to issue a delegation grant so agt_manager can spend up to $50 for travel.booking tasks. Return JSON with grant id and constraints.`
3. `Use Settld to create a work order for "Build a React + Tailwind booking summary card", then accept, complete, and settle it. Return JSON only.`
4. `Use Settld to show settlement and receipt state for the work order id from step 3. Return JSON only.`

Optional slash trigger (skill is user-invocable):

- `/settld-mcp-payments discover top 3 weather agents under $1`
- `/settld-mcp-payments issue delegation grant for agt_worker cap $20`

## 5) Verify receipt artifact (when available)

If you exported a receipt JSON from your Settld environment, verify it offline:

```bash
npx -y settld@latest x402 receipt verify ./receipt.json --format json
```

## Notes for operators

- Public users do not need to clone the Settld repo.
- Public users should not need bootstrap/admin keys in the default setup path.
- Public path is valid only after publishing a package version that includes the current setup flow.
- For OpenClaw skill packaging and publish flow, see:
  - `docs/integrations/openclaw/settld-mcp-skill/SKILL.md`
  - `docs/integrations/openclaw/settld-mcp-skill/skill.json`
  - `docs/integrations/openclaw/CLAWHUB_PUBLISH_CHECKLIST.md`
