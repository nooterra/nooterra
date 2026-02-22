# MCP Host Certification

This verifies that a host can run Settld MCP paths reliably.

## 1) Doctor check

```bash
npx settld doctor
```

Optional report output:

```bash
npx settld doctor --report ./artifacts/ops/doctor-report.json
```

## 2) Onboarding smoke (runtime bootstrap + MCP call)

```bash
npm run test:ci:mcp-host-smoke
```

Writes report:

- `artifacts/ops/mcp-host-smoke.json`

## 3) Host config matrix check

```bash
npm run test:ci:mcp-host-cert-matrix
```

Writes report:

- `artifacts/ops/mcp-host-cert-matrix.json`

## 4) Certification criteria

A host is considered ready when all are true:

- Setup writes host config deterministically
- MCP initialize + tools/list succeeds
- `settld.about` tool call succeeds
- First paid path completes with verifiable receipt
