# Contributing

Thanks for helping improve Settld.

This repo is a trust-and-settlement control plane. Please keep changes **small, deterministic, and fail-closed** where safety-critical.

## Development Setup

Prereqs:

- Node.js 20.x (`.nvmrc`)

```sh
nvm use
npm ci
```

## Quality Gates

```sh
npm run -s lint
npm test
```

If you touch gate/report scripts, include:

- a success path test
- a fail-closed path test
- deterministic assertions where applicable (stable hashes / canonical JSON)

## OpenAPI Drift

If you change the API surface:

```sh
npm run -s openapi:write
git diff --exit-code -- openapi/settld.openapi.json
```

## PR Guidelines

- No bypass paths around policy/runtime enforcement for paid or high-risk actions.
- Prefer explicit helpers over deeply nested logic.
- Avoid hidden contract drift (schemas/specs must stay versioned and backward-safe).
- Don’t commit secrets. CI enforces secret hygiene.

## Reporting Security Issues

See [SECURITY.md](./SECURITY.md).

