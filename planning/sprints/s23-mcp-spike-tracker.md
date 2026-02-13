# S23 MCP Spike Tracker

Status date: 2026-02-13

Tickets:

- `STLD-T2305` MCP server spike (stdio transport)
- `STLD-T2306` MCP quickstart draft

## Status

- [x] Implement `stdio` MCP spike server (JSON-RPC 2.0) with curated tools
- [x] Implement smoke test (no secrets) that exercises `initialize`, `tools/list`, and a real `tools/call`
- [x] Write spike design doc
- [x] Write quickstart draft

## Artifacts (In-Repo)

- Design: `docs/plans/2026-02-13-mcp-spike-design.md`
- Quickstart: `docs/QUICKSTART_MCP.md`
- Server: `scripts/mcp/settld-mcp-server.mjs`
- Smoke test: `test/mcp-stdio-spike.test.js`

## How To Run

Server:

```bash
export SETTLD_BASE_URL='https://api.settld.work'
export SETTLD_TENANT_ID='tenant_default'
export SETTLD_API_KEY='sk_live_xxx.yyy'
npm run mcp:server
```

Smoke test:

```bash
node --test test/mcp-stdio-spike.test.js
```

