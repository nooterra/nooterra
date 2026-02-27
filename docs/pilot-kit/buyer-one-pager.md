# Nooterra Verified Invoice (Buyer one-pager)

This invoice link is backed by a **cryptographically verifiable bundle** (an `InvoiceBundle.v1`) that can be archived and re-verified later, offline.

## What you see on the page

- **Green**: Verified with no warnings.
- **Amber**: Verified, but warnings are present (common early: governance trust anchors not configured for strict verification).
- **Red**: Verification failed.

## What you can download

- **Bundle ZIP**: the exact artifact that was verified (archive this for audit).
- **Verification JSON** (`VerifyCliOutput.v1`): deterministic, machine-readable result (codes + hashes).
- **Producer receipt** (if present): `verify/verification_report.json` from inside the bundle (producer-signed).
- **Audit packet ZIP**: bundle ZIP + hosted verification JSON + any embedded receipt + PDF summary + decision record.
- **PDF summary**: non-normative human summary for compatibility (not the source of truth).

## Approve / Hold

The page can record a simple **Approve / Hold** decision with a name + email + optional reason.

This decision record is a **service record** (non-normative) and can be exported as `decision_record_v0.json`.

## Offline re-verification (recommended for audit)

1. Download the **Bundle ZIP**.
2. Verify locally using `nooterra-verify` (or another conforming verifier) under your trust policy.

See `offline-verify.md`.

