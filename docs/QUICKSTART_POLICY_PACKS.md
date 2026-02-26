# Quickstart: Policy Packs CLI

Goal: initialize, simulate, and publish deterministic local policy pack artifacts with `nooterra policy`.

## Starter policy packs

- `engineering-spend`
- `procurement-enterprise`
- `data-api-buyer`
- `support-automation`
- `finance-controls`

## 1) Initialize a starter pack

Installed CLI:

```bash
npx nooterra policy init engineering-spend --out ./policies/engineering.policy-pack.json
```

Repo checkout:

```bash
./bin/nooterra.js policy init engineering-spend --out ./policies/engineering.policy-pack.json
```

## 2) Simulate a decision

Default scenario (first allowlisted provider/tool, zero spend):

```bash
./bin/nooterra.js policy simulate ./policies/engineering.policy-pack.json --format json
```

Explicit scenario:

```bash
./bin/nooterra.js policy simulate ./policies/engineering.policy-pack.json \
  --scenario-json '{"providerId":"openai","toolId":"llm.inference","amountUsdCents":25000,"monthToDateSpendUsdCents":100000,"approvalsProvided":1,"receiptSigned":true,"toolManifestHashPresent":true,"toolVersionKnown":true}' \
  --format json
```

## 3) Publish locally (deterministic report artifact)

```bash
./bin/nooterra.js policy publish ./policies/engineering.policy-pack.json --format json
```

`publish` has no remote dependency. It writes a local `NooterraPolicyPublication.v1` artifact and returns a `NooterraPolicyPublishReport.v1` with:

- deterministic `policyFingerprint` (canonical JSON SHA-256)
- deterministic `publicationRef` (`<channel>:<packId>:<fingerprint-prefix>`)
- `artifactPath` + `artifactSha256`

## Output modes

All commands support:

- `--format text|json` (default `text`)
- `--json-out <path>` for machine output files

`init` and `publish` also support:

- `--out <path>`
- `--force` to overwrite an existing path
