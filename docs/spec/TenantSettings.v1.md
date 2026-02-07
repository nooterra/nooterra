# TenantSettings.v1

`TenantSettings.v1` is the **tenant-scoped configuration contract** for Settld Verify Cloud / Magic Link.

This version is legacy and is superseded by `TenantSettings.v2` (which adds artifact storage controls and archival export sinks).

It controls:

- default verification posture (`auto|strict|compat`)
- tenant-specific governance trust roots (for strict verification without deploy-time env config)
- tenant-specific pricing signer keys (for strict verification of buyer-approved pricing terms)
- retention and quota limits
- buyer policy controls for vendor submissions
- buyer portal authentication + RBAC (service-level)
- buyer decision authentication controls (service-level)
- buyer decision signing configuration (service-level)
- webhook configuration

## Schema

See `schemas/TenantSettings.v1.schema.json`.

## Vendor / contract policy controls (service-level)

`vendorPolicies` and `contractPolicies` are **service-level** enforcement knobs for Verify Cloud. They do **not** change `InvoiceBundle.v1`.

Policy selection precedence:

1. `contractPolicies[contractId]` (if `contractId` is present on the run)
2. `vendorPolicies[vendorId]` (if `vendorId` is present on the run)
3. no policy

Policy fields:

- `requiredMode`: `auto|strict|compat` override for how the hosted verifier runs (independent of uploader requested mode).
- `failOnWarnings`: if true, hosted output is failed when any warnings are present (same as CLI `--fail-on-warnings` posture).
- `allowAmberApprovals`: if false, buyers cannot record **Approve** decisions when status is Amber.
- `requireProducerReceiptPresent`: if true, hosted output fails if `verify/verification_report.json` is missing (even in compat mode).
- `requiredPricingMatrixSignerKeyIds`: when set, hosted verification fails unless `pricing/pricing_matrix_signatures.json` includes at least one trusted signature whose `signerKeyId` is allowlisted by this policy.
- `retentionDays`: optional per-policy retention override for runs matching that vendor/contract.

## Decision authentication (service-level)

`decisionAuthEmailDomains` configures optional **email OTP gating** for buyer decision actions (`Approve`/`Hold`) on Magic Links.

- If empty (default): decision capture is unauthenticated and relies on typed actor name+email.
- If non-empty: decision capture requires an email OTP, and the email domain MUST match one of the configured domains.

This is a service control plane feature (not part of the frozen `InvoiceBundle.v1` protocol).

## Buyer portal authentication + RBAC (service-level)

Verify Cloud supports **buyer portal** access without sharing the tenant API key.

This is a service control plane feature (not part of the frozen `InvoiceBundle.v1` protocol).

### Authentication

`buyerAuthEmailDomains` configures **email OTP login** for buyer users.

- If empty (default): buyer portal OTP login is disabled.
- If non-empty: buyers can request an OTP and establish a session if their email domain matches one of the configured domains.

### Roles

`buyerUserRoles` is an optional mapping from **buyer email → role**:

- `admin`: manage settings, ingest keys, policies, exports, billing
- `approver`: view inbox, export audit packet/CSV, approve/hold (via signed `SettlementDecisionReport.v1`)
- `viewer`: view inbox only

If an email is not listed in `buyerUserRoles`, it is treated as `viewer`.

## Pricing signer trust (service-level)

`pricingSignerKeysJson` is an optional tenant-scoped trust set for **buyer pricing signer keys**.

It is used to populate `SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON` for hosted verification runs so that
`pricing/pricing_matrix_signatures.json` can be validated in strict mode.

`trustedPricingSignerKeyIds` is an optional allowlist of key IDs. When set and non-empty, Verify Cloud MUST treat only those key IDs as trusted pricing signers (even if additional keys exist in `pricingSignerKeysJson`).

## Settlement decision signing (service-level)

`settlementDecisionSigner` configures how Verify Cloud signs buyer approval/hold receipts (`SettlementDecisionReport.v1`).

Supported modes:

- local PEM private key (pilot posture)
- delegated remote signer (hardened key custody)
