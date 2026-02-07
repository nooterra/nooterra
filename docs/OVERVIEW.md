# Settld overview

Settld (as shipped in this repo) is **two products** that deliberately share the same “truth engine”:

1. **Settld Protocol (open)**: a cryptographically verifiable artifact protocol (bundles + manifests + attestations + receipts) that can be verified offline by someone who does not trust the producer.
2. **Settld Verify Cloud (commercial)**: a hosted workflow controller (“Magic Link”) that runs the same verifier server-side and turns verifiable artifacts into approvals, inbox views, exports, and automation hooks.

The core design principle is: the hosted product must never be “the only judge.” Everything it shows should be reproducible offline using the open verifier + explicit trust anchors.

## What Settld solves

Delegated autonomous work (agents, automation services, and human-assisted workflows) produces disputes because evidence is messy and non-portable:

- “Prove the workflow actually completed under agreed terms.”
- “We’re withholding payment until evidence and settlement terms are clear.”
- “SLA breach—show deterministic evidence and evaluation outputs.”

Settld makes the invoice and its evidence a self-contained, verifiable bundle:

- Evidence artifacts are committed by hashes (integrity).
- Pricing terms can be buyer-approved by signature (authorization over terms).
- Invoice math is recomputable and deterministic (no “trust me” totals).
- A verifier can later prove pass/fail under explicit policy (strict vs compat).
- Verify Cloud makes this usable by buyers without requiring installs.

## The end-to-end artifact story (protocol truth)

A producer emits a bundle directory tree (or a zip of that tree).

The bundle includes:

- `manifest.json`: commits to a list of file paths + hashes, excluding `verify/**` (no circular hashing).
- `attestation/bundle_head_attestation.json`: binds to the manifest hash.
- Optional `verify/verification_report.json`: a signed receipt that is not listed in the manifest but is cryptographically bound (by hashes) to the manifest and head attestation.

A verifier later:

- recomputes file hashes,
- recomputes manifest hash using canonical JSON rules,
- validates signatures,
- enforces governance and trust anchors,
- returns deterministic machine output with stable warning/error codes.

## Protocol truth sources (what “counts”)

When docs disagree, the contract is:

1. `docs/spec/` (human spec)
2. `docs/spec/schemas/` (JSON Schemas)
3. `test/fixtures/` (fixture corpus) + `conformance/v1/` (language-agnostic oracle)
4. the reference verifier implementations (Node + Python), as constrained by conformance

## Bundle kinds implemented

These are “directory-level protocols” with distinct manifest rules and verification logic:

- Proof bundles
  - JobProofBundle.v1
  - MonthProofBundle.v1
- Finance pack
  - FinancePackBundle.v1
- Invoice bundle (work → terms → metering → claim)
  - InvoiceBundle.v1 embeds JobProof under `payload/job_proof_bundle/**`
- ClosePack (pre-dispute “wedge pack”)
  - ClosePack.v1 embeds an InvoiceBundle and adds deterministic recomputable indexing/evaluation surfaces for self-serve dispute resolution (evidence index + optional SLA/acceptance evaluation surfaces).

## Toolchain CLIs

- `settld-produce`: deterministic bundle production (JobProof/MonthProof/FinancePack/InvoiceBundle/ClosePack).
- `settld-verify`: bundle verification (strict/compat), emits deterministic JSON output.
- `settld-release`: release authenticity verification for distribution artifacts.
- `settld-trust`: bootstrap trust materials for local testing/dev flows.

## Verify Cloud (Magic Link)

Verify Cloud is a hosted controller that accepts bundle zip uploads and produces:

- View-only buyer report page (Green/Red/Amber with stable codes)
- Downloads:
  - original bundle zip
  - hosted verify JSON output
  - producer receipt (if present in bundle)
  - PDF summary (compat surface)
  - audit packet zip (monthly)
- Workflow features:
  - inbox listing/filtering for buyers
  - vendor-scoped ingest keys (upload-only, vendor-stamped)
  - tenant settings (mode defaults, policies, retention, quotas, webhook config)
  - quotas + usage metering + billing invoice export
  - approvals/holds with OTP gating and audit trail
  - signed webhooks (or record-mode delivery in restricted environments)

Security posture for hosted ingestion is part of the product contract:

- safe zip extraction is centralized and shared by CLI + hosted ingestion
- budgets enforced during unzip and hashing
- hostile zip features are rejected (zip-slip, symlinks, duplicates, path attacks, bombs/ratios)

## Quick “show me” commands

Protocol and conformance:

- `npm test`
- `node scripts/fixtures/generate-bundle-fixtures.mjs`
- `node conformance/v1/run.mjs --node-bin packages/artifact-verify/bin/settld-verify.js`

Local verify examples:

- `node packages/artifact-verify/bin/settld-verify.js --about --format json`
- `node packages/artifact-verify/bin/settld-verify.js --strict --format json --invoice-bundle <dir>`
- `node packages/artifact-verify/bin/settld-verify.js --strict --format json --close-pack <dir>`

Run Verify Cloud locally:

- `MAGIC_LINK_API_KEY=dev_key MAGIC_LINK_DATA_DIR=/tmp/settld-magic-link MAGIC_LINK_PORT=8787 node services/magic-link/src/server.js`

Upload a bundle zip:

- `node packages/magic-link-cli/bin/settld-magic-link.js upload <path-to-zip> --url http://localhost:8787 --mode auto --tenant <tenant>`

## Gotchas that surprise new engineers

- Trust anchors are out-of-band by design (no trust loops).
- `verify/**` is excluded from manifests; receipts are validated by binding + signature, not by inclusion.
- Codes are the API, not logs (warnings and errors are stable identifiers).
- Canonical JSON is a hard contract; numeric semantics drift breaks cross-language parity.
- Safe zip ingestion is centralized so CLI + hosted don’t drift on security posture.
- When docs lag code, trust spec + conformance + fixtures.

## Reading paths (10 files each)

### A) New engineer (2–3 hours to become dangerous)

Goal: understand the “truth engine,” then the hosted controller.

1. `docs/spec/README.md`
2. `docs/spec/INVARIANTS.md`
3. `docs/spec/CANONICAL_JSON.md`
4. `docs/spec/STRICTNESS.md`
5. `docs/spec/VerifyCliOutput.v1.md`
6. `conformance/v1/README.md`
7. `packages/artifact-verify/bin/settld-verify.js`
8. `packages/artifact-verify/src/invoice-bundle.js`
9. `packages/artifact-verify/src/safe-unzip.js`
10. `services/magic-link/README.md`

### B) Auditor / partner security reviewer

Goal: can we independently verify, and is ingestion safe?

1. `docs/spec/README.md`
2. `docs/spec/CRYPTOGRAPHY.md`
3. `docs/spec/TRUST_ANCHORS.md`
4. `docs/spec/BundleHeadAttestation.v1.md`
5. `docs/spec/VerificationReport.v1.md`
6. `docs/spec/WARNINGS.md`
7. `docs/spec/ERRORS.md`
8. `conformance/v1/README.md`
9. `packages/artifact-verify/src/safe-unzip.js`
10. `test/zip-security.test.js`

### C) Buyer (AP / finance ops) viewpoint

Goal: what does this change in our invoice workflow?

1. `docs/pilot-kit/README.md`
2. `docs/pilot-kit/buyer-email.txt`
3. `docs/pilot-kit/buyer-one-pager.md`
4. `services/magic-link/README.md`
5. `docs/spec/InvoiceClaim.v1.md`
6. `docs/spec/PricingMatrix.v1.md`
7. `docs/spec/MeteringReport.v1.md`
8. `docs/spec/VerifyCliOutput.v1.md`
9. `docs/spec/WARNINGS.md` (top-level meanings)
10. `docs/spec/STRICTNESS.md` (strict vs compat posture)

### D) Vendor CTO / operator engineering

Goal: how do I generate bundles and integrate?

1. `docs/QUICKSTART_PRODUCE.md`
2. `docs/QUICKSTART_VERIFY.md`
3. `docs/spec/InvoiceBundleManifest.v1.md`
4. `docs/spec/InvoiceClaim.v1.md`
5. `docs/spec/PricingMatrix.v1.md`
6. `docs/spec/MeteringReport.v1.md`
7. `packages/artifact-produce/bin/settld-produce.js`
8. `src/core/invoice-bundle.js`
9. `packages/magic-link-cli/bin/settld-magic-link.js`
10. `docs/pilot-kit/README.md`
