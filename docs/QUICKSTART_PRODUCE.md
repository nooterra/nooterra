# Quickstart: Produce + verify a bundle (bootstrap)

This quickstart is for design partners who want an end-to-end “from zero” flow:

1) initialize trust + keys
2) produce a bundle
3) verify it strictly and archive the JSON output

## 0) Install (from this repo)

From a checkout:

```sh
npm ci
```

## 1) Initialize trust

```sh
node packages/artifact-produce/bin/nooterra-trust.js init --out out/trust --format json --force
```

This writes:

- `out/trust/trust.json` (public trust anchors; safe to commit)
- `out/trust/keypairs.json` (private keys; **do not commit**)

For production deployments, use remote signing so no private keys touch disk:

- RemoteSigner contract: `docs/spec/REMOTE_SIGNER.md`
- Operator notes: `docs/OPERATIONS_SIGNING.md`

## 2) Produce a JobProof bundle

```sh
node packages/artifact-produce/bin/nooterra-produce.js jobproof \
  --out out/jobproof \
  --keys out/trust/keypairs.json \
  --format json \
  --deterministic \
  --force
```

The output JSON is `ProduceCliOutput.v1` (see `docs/spec/ProduceCliOutput.v1.md`).

## 3) Verify strictly

Export trust anchors from `trust.json`:

```sh
export NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON="$(node -e \"const fs=require('fs'); const t=JSON.parse(fs.readFileSync('out/trust/trust.json','utf8')); process.stdout.write(JSON.stringify(t.governanceRoots||{}))\")"
export NOOTERRA_TRUSTED_TIME_AUTHORITY_KEYS_JSON="$(node -e \"const fs=require('fs'); const t=JSON.parse(fs.readFileSync('out/trust/trust.json','utf8')); process.stdout.write(JSON.stringify(t.timeAuthorities||{}))\")"
```

Then verify and archive machine output:

```sh
node packages/artifact-verify/bin/nooterra-verify.js --format json --strict --job-proof out/jobproof > out/verify.json
```

`out/verify.json` is `VerifyCliOutput.v1` and is intended to be archived as audit evidence.
