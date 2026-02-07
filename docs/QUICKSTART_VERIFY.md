# Quickstart: Verify a bundle

Goal: verify a Settld bundle directory and produce a stable machine-readable receipt (`VerifyCliOutput.v1`) suitable for CI gating and audit retention.

## From source (this repo)

Install dependencies:

```sh
npm ci
```

Verify a bundle fixture (strict):

```sh
export SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON="$(node -e "import fs from 'node:fs'; const t=JSON.parse(fs.readFileSync('test/fixtures/bundles/v1/trust.json','utf8')); process.stdout.write(JSON.stringify(t.governanceRoots||{}))")"
node packages/artifact-verify/bin/settld-verify.js --format json --strict --job-proof test/fixtures/bundles/v1/jobproof/strict-pass > settld-verify-output.json
```

Optional: emit SARIF for GitHub annotations:

```sh
node packages/artifact-verify/bin/settld-verify.js --format sarif --strict --job-proof test/fixtures/bundles/v1/jobproof/strict-pass > settld-verify.sarif
```

## Strict vs non-strict

- **Strict** (`--strict`): audit posture; missing required protocol surfaces are hard failures.
- **Non-strict** (omit `--strict`): compatibility posture; missing legacy surfaces become warnings.

## Warnings and CI gating

- Warnings are structured codes (see `docs/spec/WARNINGS.md`).
- To fail CI when warnings exist, add `--fail-on-warnings`.

## Trust anchors

Strict verification needs trusted governance root keys. Provide them via:

- `SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON`
- `SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON` (only if you want to verify timestamp proofs)

See `docs/spec/TRUST_ANCHORS.md`.

## Output + provenance

`settld-verify --format json` emits `VerifyCliOutput.v1`:

- `ok`: overall CLI verdict (includes `--fail-on-warnings`)
- `verificationOk`: underlying verification verdict
- `errors[]` / `warnings[]`: stable codes, deterministically sorted
- `tool.version` / `tool.commit`: provenance identifiers

If `tool.version` or `tool.commit` cannot be determined, you may see warnings like `TOOL_VERSION_UNKNOWN` / `TOOL_COMMIT_UNKNOWN` (see `docs/spec/TOOL_PROVENANCE.md`).
