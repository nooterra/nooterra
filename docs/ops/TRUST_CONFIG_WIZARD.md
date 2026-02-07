# Trust Config Wizard

The Trust Config Wizard is a lightweight way to bootstrap SLA policy configuration for common autonomous workflows.

## What it provides

- Built-in SLA policy templates for `delivery` and `security` verticals.
- Template rendering with override support for SLA and metrics fields.
- A validation path for preflight checks before policy deployment.

## API endpoint

- `GET /ops/sla-templates`
  - Scope: `ops_read`
  - Optional query: `vertical=delivery|security`
  - Response: `SlaPolicyTemplateCatalog.v1` template catalog

Example:

```sh
curl -sS "http://localhost:3000/ops/sla-templates?vertical=security" \
  -H "x-proxy-ops-token: <ops_read_token>" | jq
```

## CLI usage

Run via npm script:

```sh
npm run trust:wizard -- list --format json
```

Supported commands:

- `list [--vertical delivery|security] [--format json|text]`
- `show --template <templateId> [--format json|text]`
- `render --template <templateId> [--overrides-json <json>] [--out <path>] [--format json|text]`
- `validate --template <templateId> [--overrides-json <json>] [--format json|text]`

Example render command:

```sh
npm run trust:wizard -- render \
  --template delivery_standard_v1 \
  --overrides-json '{"metrics":{"targetCompletionMinutes":60}}' \
  --format json
```
