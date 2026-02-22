# Policy Packs and Profiles

Settld supports two related policy surfaces:

- **Profiles**: runtime policy envelope used by setup/apply flows
- **Policy packs**: deterministic pack artifacts for simulation/publication workflows

## Profiles (most teams start here)

List available starter profiles:

```bash
settld profile list
```

Create a starter profile file:

```bash
settld profile init engineering-spend --out ./profiles/engineering-spend.profile.json
```

Create with wizard:

```bash
settld profile wizard --template engineering-spend --out ./profiles/custom.profile.json
```

Validate + simulate:

```bash
settld profile validate ./profiles/custom.profile.json --format json
settld profile simulate ./profiles/custom.profile.json --format json
```

Apply to tenant:

```bash
settld profile apply ./profiles/custom.profile.json \
  --base-url http://127.0.0.1:3000 \
  --tenant-id tenant_default \
  --api-key sk_live_xxx.yyy
```

## Policy packs

Known starter pack IDs:

- `engineering-spend`
- `procurement-enterprise`
- `data-api-buyer`
- `support-automation`
- `finance-controls`

Initialize, simulate, publish:

```bash
settld policy init engineering-spend --out ./policies/engineering.policy-pack.json
settld policy simulate ./policies/engineering.policy-pack.json --format json
settld policy publish ./policies/engineering.policy-pack.json --format json
```

`publish` writes deterministic publication output (including policy fingerprint metadata).
