# Operations: Signing in production

Settld supports producing strictly verifiable bundles without storing private keys on disk by using a remote signer.

## Recommended posture (hardened)

- Use `settld-produce --signer remote` and keep private keys inside an HSM/KMS-backed signing service.
- Keep `trust.json` (public trust anchors) in version control and rotate via PR.
- In CI, use strict verification and archive `VerifyCliOutput.v1` JSON.

## Remote signer

See `docs/spec/REMOTE_SIGNER.md` for the RemoteSigner API contract.

## Key rotation (high level)

1. Add new key to signer service.
2. Update trust anchors (governance root keys and/or time authorities) via PR.
3. Produce bundles signed by the new key while allowing overlap.
4. Deprecate old keys per your internal policy (and/or publish revocations as governance requires).
