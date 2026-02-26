# Nooterra conformance pack v1

This pack defines **portable truth** for bundle verification: given these inputs and modes, an implementation must produce the expected pass/fail verdict and the expected error/warning codes.

## What’s included

- `bundles/` — curated bundle fixtures (JobProof/MonthProof/FinancePack/InvoiceBundle).
- `protocol-vectors/v1.json` — canonical protocol vectors.
- `trust.json` — trust anchors used by conformance cases.
- `cases.json` — the conformance matrix.
- `expected/` — per-case expected results.
- `run.mjs` — runner that executes cases against a `nooterra-verify` binary.
- `produce-cases.json` — producer conformance matrix (tooling surface).
- `producer/` — producer conformance fixtures (test keys + signer stubs).
- `run-produce.mjs` — runner that executes producer cases against `nooterra-produce` (and strict-verifies produced bundles).
- `release-cases.json` — release authenticity conformance matrix (ReleaseIndex + trust roots + artifact hashes).
- `releases/` — small offline release directories used by release conformance.
- `run-release.mjs` — runner that executes release cases against `nooterra-release`.

## Run

Assuming you have `nooterra-verify` installed (in PATH):

```sh
node conformance/v1/run.mjs
```

To run against a Node entrypoint instead (repo/dev usage):

```sh
node conformance/v1/run.mjs --node-bin packages/artifact-verify/bin/nooterra-verify.js
```

To emit machine-readable report artifacts:

```sh
node conformance/v1/run.mjs \
  --node-bin packages/artifact-verify/bin/nooterra-verify.js \
  --json-out /tmp/nooterra-conformance-report.json \
  --cert-bundle-out /tmp/nooterra-conformance-cert.json
```

### Output artifacts

- `ConformanceRunReport.v1`: run report envelope with `reportHash` and `reportCore`.
- `ConformanceRunReportCore.v1`: deterministic core payload used for hash binding.
- `ConformanceCertBundle.v1`: portable cert-bundle envelope with `certHash` and `certCore`.
- `ConformanceCertBundleCore.v1`: deterministic cert core binding the run report hash and core.

## Producer conformance

Producer conformance is a separate surface (tooling behavior + signer plumbing + strict verification of produced bundles):

```sh
node conformance/v1/run-produce.mjs
```

Repo/dev usage:

```sh
node conformance/v1/run-produce.mjs --produce-node-bin packages/artifact-produce/bin/nooterra-produce.js --verify-node-bin packages/artifact-verify/bin/nooterra-verify.js
```

## Release authenticity conformance

Release authenticity is a separate surface from bundle verification (distribution channel trust and artifact hash verification):

```sh
node conformance/v1/run-release.mjs
```

Repo/dev usage:

```sh
node conformance/v1/run-release.mjs --release-node-bin packages/artifact-verify/bin/nooterra-release.js
```

## Pass criteria

All cases must match:

- exit code
- `errors[].code` set
- `warnings[].code` set
- `ok` and `verificationOk` (when specified)

## Reference behavior

See `docs/spec/REFERENCE_VERIFIER_BEHAVIOR.md` for filesystem and evaluation rules that are enforced by these cases.

## Traceability

Each conformance case declares `invariantIds` that map to `docs/spec/INVARIANTS.md`.
