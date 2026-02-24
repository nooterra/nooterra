# ClawHub Publish Checklist (Settld MCP Skill)

Use this to publish and validate the Settld OpenClaw skill safely.

## 1) Pre-Publish Validation

Run local MCP sanity checks first:

```bash
npm run mcp:probe
node --test test/mcp-stdio-spike.test.js test/mcp-http-gateway.test.js test/mcp-paid-exa-tool.test.js test/mcp-paid-weather-tool.test.js
node --test test/openclaw-clawhub-install-smoke-script.test.js
```

Confirm required files exist:

- `docs/integrations/openclaw/settld-mcp-skill/SKILL.md`
- `docs/integrations/openclaw/settld-mcp-skill/mcp-server.example.json`
- `docs/integrations/openclaw/settld-mcp-skill/skill.json`

## 2) Prepare Skill Metadata

In `SKILL.md`, verify:

- `name` is unique in ClawHub
- `description` is short and explicit
- `version` bumped for every publish
- `user-invocable: true` is present for slash-invoked usage
- prompt library includes discovery + delegation + work-order + receipt flows

## 3) Publish To ClawHub

Publish the folder `docs/integrations/openclaw/settld-mcp-skill/` as your skill package.

If ClawHub UI requests install instructions, use:

- command: `npx`
- args: `-y --package settld@latest settld-mcp`
- env: `SETTLD_BASE_URL`, `SETTLD_TENANT_ID`, `SETTLD_API_KEY`, optional `SETTLD_PAID_TOOLS_BASE_URL`

## 4) Post-Publish Smoke Test

Install the skill in a clean OpenClaw environment and verify:

1. Tools are discoverable (`settld.*` visible).
2. `settld.about` succeeds.
3. One paid call succeeds:
   - `settld.exa_search_paid`, or
   - `settld.weather_current_paid`
4. Result includes `x-settld-*` verification headers.

Automated smoke (requires network and public ClawHub access):

```bash
npm run -s test:ci:openclaw-clawhub-install-smoke -- --slug settld-mcp-payments --bootstrap-local
```

If ClawHub blocks non-interactive install due suspicious-skill gating, rerun with:

```bash
npm run -s test:ci:openclaw-clawhub-install-smoke -- --slug settld-mcp-payments --force --bootstrap-local
```

## 5) Rollback Plan

If smoke fails in production:

1. Unlist or disable latest skill version in ClawHub.
2. Revert to previous working skill version.
3. Fix and republish with incremented `version`.

## 6) Release Notes Template

Capture these fields each publish:

- Skill version
- Settld package version used
- Added/changed tools
- Known limitations
- Validation run timestamp
