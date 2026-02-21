# MCP Host Certification

Use these commands to verify Settld MCP host compatibility.

## One-command host runtime doctor

```bash
npx settld doctor
```

This runs runtime bootstrap + MCP probe checks and writes:

- `artifacts/ops/mcp-host-smoke.json`

## Host config write matrix (Codex/Claude/Cursor/OpenClaw)

```bash
npm run test:ci:mcp-host-cert-matrix
```

This validates config write/idempotency behavior for all supported host config shapes.
