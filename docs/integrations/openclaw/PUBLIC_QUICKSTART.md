# OpenClaw Public Quickstart (No Repo Clone)

Use this when you want a public user to set up Settld from npm in a fresh machine.

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
