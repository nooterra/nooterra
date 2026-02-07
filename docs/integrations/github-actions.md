# GitHub Actions integration: `settld-verify`

This repo ships a **first-party composite action** that runs `settld-verify` with stable machine output (`VerifyCliOutput.v1`) and supports strict/non-strict + warning gating.

## Minimal workflow (strict, archive JSON)

See `docs/integrations/github-actions-verify.yml` for a pasteable workflow.

For usage from another repo, reference the action by tag:

```yaml
uses: settld/settld/.github/actions/settld-verify@vX.Y.Z
```

## Trust anchors

Pass a `trust.json` file (same shape as `test/fixtures/bundles/v1/trust.json`):

- `governanceRoots`: map of `keyId -> publicKeyPem`
- `timeAuthorities`: optional map of `keyId -> publicKeyPem`

The action exports these to the verifier via:

- `SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON`
- `SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON` (when present)

## What to archive for audit

Recommended posture:

- Archive the **bundle** itself (immutable artifact store).
- Archive the CI `VerifyCliOutput.v1` JSON (what you verified, when, with what tool identity).

If you store the bundle, you already retain `verify/verification_report.json` inside it (the signed receipt).
