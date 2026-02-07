# Vendor integration (copy/paste quality) — toy telemetry → ClosePack → strict verify → hosted upload

This example is designed to be a template vendors can copy into their own repo/CI:

- Generate a `MeteringReport.v1` input from a toy telemetry format (adapter).
- Produce a deterministic `ClosePack.v1` (via `settld-produce closepack-from-json`).
- Run a strict “contract test” for CI (`scripts/vendor-contract-test.mjs`).
- Upload to Verify Cloud using an ingest key (`settld-magic-link ingest`).

## 0) Prereqs

- Node >= 20
- Run from repo root (so `npm exec -- settld-*` works)

## 1) Create trust + keys (local demo)

```bash
mkdir -p out/vendor-integration
npm exec --silent -- settld-trust init \
  --out out/vendor-integration/trust \
  --with-time-authority \
  --format json \
  --force
```

For this demo, we reuse the governance root key as the pricing signer trust set (don’t do this in production).

```bash
node examples/vendor-integration/scripts/compose-trust.mjs \
  --in out/vendor-integration/trust/trust.json \
  --out out/vendor-integration/trust/vendor_trust.json
```

## 2) Produce a JobProof bundle

```bash
npm exec --silent -- settld-produce jobproof \
  --out out/vendor-integration/jobproof \
  --keys out/vendor-integration/trust/keypairs.json \
  --format json \
  --deterministic \
  --force
```

## 3) Generate metering input from toy telemetry

```bash
node examples/vendor-integration/scripts/toy-adapter.mjs \
  --telemetry examples/vendor-integration/inputs/toy_telemetry.json \
  --jobproof out/vendor-integration/jobproof \
  --out out/vendor-integration/metering_report_input.json
```

## 4) Create buyer pricing signature surface (demo)

In real onboarding, the buyer provides `pricing_matrix_signatures.json`. For this demo we sign locally with the trust init key.

```bash
node examples/vendor-integration/scripts/sign-pricing-matrix.mjs \
  --pricing examples/vendor-integration/inputs/pricing_matrix.json \
  --keypairs out/vendor-integration/trust/keypairs.json \
  --signer govRoot \
  --out out/vendor-integration/pricing_matrix_signatures.json
```

## 5) Produce ClosePack (deterministic)

```bash
npm exec --silent -- settld-produce closepack-from-json \
  --out out/vendor-integration/closepack \
  --keys out/vendor-integration/trust/keypairs.json \
  --jobproof out/vendor-integration/jobproof \
  --pricing-matrix examples/vendor-integration/inputs/pricing_matrix.json \
  --pricing-signatures out/vendor-integration/pricing_matrix_signatures.json \
  --metering-report out/vendor-integration/metering_report_input.json \
  --tenant tenant_demo \
  --invoice-id invoice_demo \
  --deterministic \
  --format json \
  --force
```

## 6) Zip the ClosePack

```bash
node examples/vendor-integration/scripts/zip-bundle.mjs \
  --dir out/vendor-integration/closepack \
  --out out/vendor-integration/ClosePack.v1.zip
```

## 7) Strict “contract test” (CI gate)

```bash
node scripts/vendor-contract-test.mjs \
  --bundle out/vendor-integration/ClosePack.v1.zip \
  --trust out/vendor-integration/trust/vendor_trust.json \
  --expect strict-pass \
  > out/vendor-integration/contract_test.json
```

## 8) Upload to Verify Cloud (hosted)

Once the buyer gives you an ingest key (in `ingest_key.txt`):

```bash
npm exec --silent -- settld-magic-link ingest out/vendor-integration/ClosePack.v1.zip \
  --url http://localhost:8787 \
  --tenant <buyerTenant> \
  --ingest-key "$(cat ingest_key.txt)" \
  --mode auto \
  --format json
```

## Common failures → fixes (quick map)

- `LENGTH_REQUIRED` / `UPLOAD_TOO_LARGE`: the upload client must send `Content-Length` and stay under the tenant cap.
- `ZIP_*`: zip rejected for safety (traversal/symlink/zip-bomb). Recreate the zip with normal relative paths.
- `PRICING_MATRIX_SIGNATURE_MISSING`: buyer pricing signature surface missing/invalid for strict mode (use the buyer-provided `pricing_matrix_signatures.json`).
- `FAIL_ON_WARNINGS`: the bundle is strict-verifiable but emitted warnings; fix warnings to keep CI green.

