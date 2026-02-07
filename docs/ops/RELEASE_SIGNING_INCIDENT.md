# Release signing incident runbook

This runbook covers the “release signing key compromised” scenario for Settld distribution artifacts.

## Immediate goals

- Prevent future malicious releases from verifying.
- Preserve a clear audit trail of what happened and what was rotated.

## Assumptions

- Release authenticity is verified via `ReleaseIndex.v1` + `ReleaseTrust.v2` (see `docs/spec/SUPPLY_CHAIN.md`).
- Release trust roots are pinned in `trust/release-trust.json`.
- Release signing private keys are stored as CI secrets (e.g., `SETTLD_RELEASE_SIGNING_PRIVATE_KEY_PEM`).

## Procedure (high-level)

1) **Revoke compromised key**

- Edit `trust/release-trust.json`:
  - Keep the key entry (do not delete immediately).
  - Set `revokedAtEpochSeconds` to the intended cutoff time.
  - Add/update `comment` with incident reference.

2) **Add replacement key**

- Generate a new Ed25519 keypair (private key never committed).
- Add its public key + `keyId` into `trust/release-trust.json`.
- If you require quorum, ensure policy still holds (`policy.minSignatures`).

3) **Rotate CI secrets**

- Update the release workflow secret(s) to use the new private key(s).
- If quorum is required, ensure CI has all required signing keys/secrets.

4) **Cut a release candidate and verify**

- Produce release artifacts.
- Verify via:
  - `settld-release verify --dir <release-assets-dir> --trust-file trust/release-trust.json --format json --explain`

5) **Validate the block**

- A release signed with the revoked key at/after `revokedAtEpochSeconds` must fail verification with `RELEASE_SIGNER_REVOKED`.

## Automated drill

CI includes a compromise drill test:

- `test/release-signing-compromise-drill.test.js`

This test simulates:

- old key revoked
- new key added
- release signed with old key after revocation fails
- release signed with new key passes

