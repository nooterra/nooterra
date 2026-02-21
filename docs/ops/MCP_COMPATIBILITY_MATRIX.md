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
| Claude | local host-cert matrix harness | stdio | yellow | 2026-02-21 | `npm run test:ci:mcp-host-cert-matrix` | Validates host config write/idempotency for Claude MCP wiring; live interactive paid-tool validation in Claude desktop remains separate. |
| Cursor | local host-cert matrix harness | stdio | yellow | 2026-02-21 | `npm run test:ci:mcp-host-cert-matrix` | Validates host config write/idempotency for Cursor MCP wiring; live interactive paid-tool validation in Cursor app remains separate. |
| Codex | local host-cert matrix harness | stdio | yellow | 2026-02-21 | `npm run test:ci:mcp-host-cert-matrix` | Validates host config write/idempotency for Codex MCP wiring; live interactive paid-tool validation in Codex desktop remains separate. |
| OpenClaw | local host-cert matrix harness | stdio | yellow | 2026-02-21 | `npm run test:ci:mcp-host-cert-matrix` | Validates host config write/idempotency for OpenClaw MCP wiring; live interactive paid-tool validation in OpenClaw app remains separate. |
| Generic MCP host bootstrap path | local CI smoke | stdio | green | 2026-02-21 | `npm run test:ci:mcp-host-smoke` | Runs the MCP host smoke flow (API + magic-link + runtime bootstrap + MCP initialize/tools/list + `settld.about`) and writes `artifacts/ops/mcp-host-smoke.json`. |
| Host config write matrix (Codex/Claude/Cursor/OpenClaw) | local CI smoke | config bootstrap | green | 2026-02-21 | `npm run test:ci:mcp-host-cert-matrix` | Verifies `scripts/setup/host-config.mjs` writes valid Settld MCP entries and remains idempotent across all supported hosts. |
| Generic MCP HTTP client | local repo test harness | HTTP bridge | green | 2026-02-21 | `node --test test/mcp-stdio-spike.test.js test/mcp-paid-exa-tool.test.js test/mcp-paid-weather-tool.test.js test/mcp-paid-llm-tool.test.js test/x402-gateway-autopay.test.js` | 6/6 passing with paid-tool runtime metadata checks and x402 settlement header verification. |
| MCP paid runtime policy metadata gate | local repo test harness | stdio + x402 gateway | green | 2026-02-21 | `node --test test/mcp-paid-exa-tool.test.js test/mcp-paid-weather-tool.test.js test/mcp-paid-llm-tool.test.js test/x402-gateway-autopay.test.js` | Paid MCP tools now fail-closed if `x-settld-policy-decision`, `x-settld-policy-hash`, `x-settld-decision-id`, settlement, or verification headers are missing. |
