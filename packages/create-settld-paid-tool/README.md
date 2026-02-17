# create-settld-paid-tool

Scaffold a paid HTTP/MCP-compatible tool server powered by `@settld/provider-kit`.

## Usage

```bash
npx create-settld-paid-tool my-paid-tool
```

Or with explicit provider id:

```bash
npx create-settld-paid-tool my-paid-tool --provider-id prov_example_1
```

Bridge scaffold for an existing upstream API:

```bash
npx create-settld-paid-tool my-paid-tool --from-http https://api.example.com
```

Bridge scaffold from a local OpenAPI JSON spec:

```bash
npx create-settld-paid-tool my-paid-tool --from-openapi ./openapi.json
```

## What it creates

- `server.mjs` paid tool server (`402` challenge + offline SettldPay verify + provider signatures)
- `.env.example` runtime config template
- `package.json` starter with `npm start`
- `README.md` usage notes
- When using bridge modes (`--from-http` / `--from-openapi`):
  - `paid-tool-manifest.json` declarative tool/pricing config
  - `mcp-bridge.mjs` MCP stdio bridge that calls paid endpoints with autopay

## Local (repo) usage

```bash
node scripts/scaffold/create-settld-paid-tool.mjs my-paid-tool
```
