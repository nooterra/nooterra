# Hello, auditor (5-minute proof)

This folder is a **copy/paste starter** for teams evaluating Settld verification in CI.

It contains:

- `bundle/` — a small, committed example `JobProofBundle.v1` directory (verifies in strict mode).
- `trust.json` — public trust anchors needed for strict verification of this example bundle.
- `github-actions-verify.yml` — a pasteable workflow that verifies and uploads JSON output.

## Run locally

From the repo root:

```sh
SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON="$(node -e 'const t=require(\"./examples/hello-auditor/trust.json\"); process.stdout.write(JSON.stringify(t.governanceRoots||{}))')"
node packages/artifact-verify/bin/settld-verify.js --format json --strict --explain --job-proof examples/hello-auditor/bundle
```

## Run in GitHub Actions (copy/paste)

1. Copy `examples/hello-auditor/github-actions-verify.yml` into your repo as `.github/workflows/settld-verify.yml`.
2. Commit your bundle directory (or point the workflow at where your CI produces it).
3. Commit a `trust.json` file in your repo (public keys only) and point the workflow at it.

This example uses the first-party composite action shipped by Settld.
