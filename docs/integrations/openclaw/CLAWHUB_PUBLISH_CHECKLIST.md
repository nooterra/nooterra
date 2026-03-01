# ClawHub Publish Checklist (Nooterra MCP Skill)

Use this to publish and validate the Nooterra OpenClaw skill safely.

## 0) Nooterra Verified Acceptance Gate (Community Listing)

If the skill listing claims `Nooterra Verified`, run collaboration gate first:

```bash
npm run -s test:ops:nooterra-verified-gate -- --level collaboration --out artifacts/gates/nooterra-verified-collaboration-gate.json
```

Confirm pass (fail closed):

```bash
node -e 'const fs=require("node:fs");const r=JSON.parse(fs.readFileSync("artifacts/gates/nooterra-verified-collaboration-gate.json","utf8"));if(!(r.schemaVersion==="NooterraVerifiedGateReport.v1"&&r.level==="collaboration"&&r.ok===true&&Number(r?.summary?.failedChecks)===0&&Array.isArray(r?.blockingIssues)&&r.blockingIssues.length===0)){process.exit(1)}'
```

Do not publish a `Nooterra Verified` listing claim when this gate fails.

## 1) Pre-Publish Validation

Run local MCP sanity checks first:

```bash
npm run mcp:probe
node --test test/mcp-stdio-spike.test.js test/mcp-http-gateway.test.js test/mcp-paid-exa-tool.test.js test/mcp-paid-weather-tool.test.js
node --test test/openclaw-clawhub-install-smoke-script.test.js
```

Confirm required files exist:

- `docs/integrations/openclaw/nooterra-mcp-skill/SKILL.md`
- `docs/integrations/openclaw/nooterra-mcp-skill/mcp-server.example.json`
- `docs/integrations/openclaw/nooterra-mcp-skill/skill.json`

## 2) Prepare Skill Metadata

In `SKILL.md` frontmatter and `skill.json`, verify:

- `name` is unique in ClawHub
- `name` matches exactly across `SKILL.md` and `skill.json`
- `version` matches exactly across `SKILL.md` and `skill.json`
- `description` is short and explicit
- `version` bumped for every publish
- `user-invocable: true` is present for slash-invoked usage
- prompt library includes discovery + delegation + work-order + receipt flows

For `Nooterra Verified` listings, use exact description token in both files:

- `[Nooterra Verified: collaboration]`

Do not invent new schema keys for listing claims in either file.

## 3) Publish To ClawHub

Publish the folder `docs/integrations/openclaw/nooterra-mcp-skill/` as your skill package.

If ClawHub UI requests install instructions, use:

- command: `npx`
- args: `-y --package nooterra@latest nooterra-mcp`
- env: `NOOTERRA_BASE_URL`, `NOOTERRA_TENANT_ID`, `NOOTERRA_API_KEY`, optional `NOOTERRA_PAID_TOOLS_BASE_URL`

## 4) Post-Publish Smoke Test

Install the skill in a clean OpenClaw environment and verify:

1. Tools are discoverable (`nooterra.*` visible).
2. `nooterra.about` succeeds.
3. One paid call succeeds:
   - `nooterra.exa_search_paid`, or
   - `nooterra.weather_current_paid`
4. Result includes required policy/verification headers:
   - `x-nooterra-settlement-status`
   - `x-nooterra-verification-status`
   - `x-nooterra-policy-decision`
   - `x-nooterra-policy-hash`
   - `x-nooterra-decision-id`
5. Delegation + receipt minimums succeed:
   - delegation grant flow (`nooterra.delegation_grant_issue` -> `nooterra.delegation_grant_list` -> `nooterra.delegation_grant_revoke`)
   - receipt/settlement lookup flow (`nooterra.x402_gate_get` or work-order settle read path)

Automated smoke (requires network and public ClawHub access):

```bash
npm run -s test:ci:openclaw-clawhub-install-smoke -- --slug nooterra-mcp-payments --bootstrap-local
```

If ClawHub blocks non-interactive install due suspicious-skill gating, rerun with:

```bash
npm run -s test:ci:openclaw-clawhub-install-smoke -- --slug nooterra-mcp-payments --force --bootstrap-local
```

## 5) Rollback Plan

If smoke fails in production:

1. Unlist or disable latest skill version in ClawHub.
2. Revert to previous working skill version.
3. Fix and republish with incremented `version`.

## 6) Release Notes Template

Capture these fields each publish:

- Skill version
- Nooterra package version used
- Added/changed tools
- Known limitations
- Validation run timestamp
