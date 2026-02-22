# Integrations

Settld is designed to sit under existing agent runtimes, not replace them.

## Host integrations

Supported setup targets:

- `codex`
- `claude`
- `cursor`
- `openclaw`

Recommended path:

```bash
npx settld setup
```

For scripted install:

```bash
npx settld setup --non-interactive --host <codex|claude|cursor|openclaw> ...
```

## MCP integration

- Settld MCP server is exposed by package binary `settld-mcp`
- Smoke test command:

```bash
npm run mcp:probe -- --call settld.about '{}'
```

## SDK/backend integration

Use Settld APIs in backend flows for:

- policy-bounded authorization
- settlement verification
- receipt retrieval and reconciliation

## OpenClaw skill path

Public skill files live under:

- `docs/integrations/openclaw/settld-mcp-skill/`

Use this when packaging Settld setup as an installable skill for OpenClaw users.
