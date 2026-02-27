# Integrations

Nooterra is designed to sit under existing agent runtimes, not replace them.

## Host integrations

Supported setup targets:

- `nooterra`
- `claude`
- `cursor`
- `openclaw`

Recommended path:

```bash
npx nooterra setup
```

For scripted install:

```bash
npx nooterra setup --non-interactive --host <nooterra|claude|cursor|openclaw> ...
```

## MCP integration

- Nooterra MCP server is exposed by package binary `nooterra-mcp`
- Smoke test command:

```bash
npm run mcp:probe -- --call nooterra.about '{}'
```

## SDK/backend integration

Use Nooterra APIs in backend flows for:

- policy-bounded authorization
- settlement verification
- receipt retrieval and reconciliation

## OpenClaw skill path

Public skill files live under:

- `docs/integrations/openclaw/nooterra-mcp-skill/`

Use this when packaging Nooterra setup as an installable skill for OpenClaw users.
