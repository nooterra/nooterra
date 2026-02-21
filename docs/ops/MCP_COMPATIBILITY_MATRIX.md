# MCP Compatibility Matrix

Track real host compatibility evidence here. Update on every major host release or Settld MCP change.

## Status legend

- `green`: passes required flow end-to-end
- `yellow`: partially working; known gaps
- `red`: blocked

## Required flow (all hosts)

1. Host discovers `settld.*` tools.
2. `settld.about` succeeds.
3. One paid tool call succeeds (`settld.exa_search_paid` or `settld.weather_current_paid`).
4. `x-settld-*` settlement/verification headers are present.
5. Artifact output exists and verifies.

## Matrix

| Host | Host Version | Transport | Status | Last Verified (UTC) | Evidence Link | Notes |
|---|---|---|---|---|---|---|
| Claude | TBD | stdio | TBD | TBD | TBD | |
| Cursor | TBD | stdio | TBD | TBD | TBD | |
| Codex | TBD | stdio | TBD | TBD | TBD | |
| OpenClaw | TBD | stdio | TBD | TBD | TBD | |
| Generic MCP host bootstrap path | local CI smoke | stdio | green | 2026-02-20 | `settld doctor` | Runs the MCP host smoke flow (API + magic-link + runtime bootstrap + `mcp:probe` + `settld.about`) and writes `artifacts/ops/mcp-host-smoke.json`. |
| Host config write matrix (Codex/Claude/Cursor/OpenClaw) | local CI smoke | config bootstrap | green | 2026-02-21 | `npm run test:ci:mcp-host-cert-matrix` | Verifies `scripts/setup/host-config.mjs` writes valid Settld MCP entries and remains idempotent across all supported hosts. |
| Generic MCP HTTP client | local repo test harness | HTTP bridge | green | 2026-02-20 | `node --test test/mcp-stdio-spike.test.js test/mcp-http-gateway.test.js test/mcp-paid-exa-tool.test.js test/mcp-paid-weather-tool.test.js test/mcp-paid-llm-tool.test.js test/demo-mcp-paid-exa.test.js` | 9/9 passing in local CI-style run |
