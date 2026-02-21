# Policy Packs

Settld ships a policy-pack CLI for fast guardrail rollout.

## Starter packs

- `engineering-spend`
- `procurement-enterprise`
- `data-api-buyer`
- `support-automation`
- `finance-controls`

## Initialize

```bash
npx settld policy init engineering-spend --out ./policies/engineering.policy-pack.json
```

## Simulate

```bash
npx settld policy simulate ./policies/engineering.policy-pack.json --format json
```

## Publish local artifact

```bash
npx settld policy publish ./policies/engineering.policy-pack.json --format json
```

`publish` writes deterministic local artifacts with a policy fingerprint and publication reference.
