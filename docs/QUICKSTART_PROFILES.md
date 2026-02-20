# Quickstart: Profiles CLI

Goal: scaffold, validate, and simulate a policy profile with the Settld CLI.

## Prerequisites

- Node.js 20+
- Repo checkout with dependencies installed (`npm ci`)

## 1) List available starter profiles

Installed CLI:

```bash
npx settld profile list
```

Repo checkout:

```bash
./bin/settld.js profile list
```

Example output:

```text
engineering-spend	engineering	Engineering Spend
procurement	procurement	Procurement
data-api-buyer	data	Data API Buyer
```

## 2) Initialize a profile

Installed CLI:

```bash
npx settld profile init engineering-spend --out ./profiles/engineering-spend.profile.json
```

Repo checkout:

```bash
./bin/settld.js profile init engineering-spend --out ./profiles/engineering-spend.profile.json
```

Example output:

```text
ok	engineering-spend	/home/you/repo/profiles/engineering-spend
```

## 3) Validate profile schema + semantics

Installed CLI:

```bash
npx settld profile validate ./profiles/engineering-spend.profile.json --format json
```

Repo checkout:

```bash
./bin/settld.js profile validate ./profiles/engineering-spend.profile.json --format json
```

Example output:

```json
{
  "schemaVersion": "SettldProfileValidationReport.v1",
  "ok": true,
  "profileId": "engineering-spend",
  "errors": [],
  "warnings": []
}
```

## 4) Simulate policy decisions

Installed CLI:

```bash
npx settld profile simulate ./profiles/engineering-spend.profile.json --format json
```

Repo checkout:

```bash
./bin/settld.js profile simulate ./profiles/engineering-spend.profile.json --format json
```

Example output:

```json
{
  "schemaVersion": "SettldProfileSimulationReport.v1",
  "ok": true,
  "profileId": "engineering-spend",
  "decision": "allow",
  "requiredApprovers": 0,
  "approvalsProvided": 0,
  "selectedApprovalTier": "auto",
  "reasons": []
}
```

To simulate with explicit scenario data:

```bash
./bin/settld.js profile simulate ./profiles/engineering-spend.profile.json --scenario ./test/fixtures/profile/scenario-allow.json --format json
```

## Common troubleshooting

- `unknown profile`: run `settld profile list` and use one of the listed IDs.
- `validation failed`: fix reported schema/semantic errors, then rerun `profile validate`.
- `scenario file not found`: pass an existing JSON scenario path to `profile simulate`.
