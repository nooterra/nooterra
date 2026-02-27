# Hello Producer (bootstrap: trust → produce → verify)

This example shows the “from zero” workflow a design partner can run without importing internal modules:

1. Initialize trust + keys (local dev bootstrap).
2. Produce a strict-verifiable bundle.
3. Verify it strictly and archive machine output.

## 1) Create a trust directory

```bash
mkdir -p out/hello-producer
npm exec --silent -- nooterra-trust init --out out/hello-producer/trust --format json --force
```

This writes:

- `out/hello-producer/trust/trust.json` (public trust anchors)
- `out/hello-producer/trust/keypairs.json` (private keys; do not commit)

## 2) Produce a JobProof bundle

```bash
npm exec --silent -- nooterra-produce jobproof \
  --out out/hello-producer/jobproof \
  --keys out/hello-producer/trust/keypairs.json \
  --format json \
  --deterministic \
  --force
```

## 3) Strict verify

Then:

```bash
export NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON="$(node -e "const fs=require('fs'); const t=JSON.parse(fs.readFileSync('out/hello-producer/trust/trust.json','utf8')); process.stdout.write(JSON.stringify(t.governanceRoots||{}))")"
export NOOTERRA_TRUSTED_TIME_AUTHORITY_KEYS_JSON="$(node -e "const fs=require('fs'); const t=JSON.parse(fs.readFileSync('out/hello-producer/trust/trust.json','utf8')); process.stdout.write(JSON.stringify(t.timeAuthorities||{}))")"

npm exec --silent -- nooterra-verify --format json --strict --job-proof out/hello-producer/jobproof > out/hello-producer/verify.json
```

`out/hello-producer/verify.json` is `VerifyCliOutput.v1` and is intended to be archived as audit evidence.
