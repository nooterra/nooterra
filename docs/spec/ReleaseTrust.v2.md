# ReleaseTrust.v2

`ReleaseTrust.v2` is a tooling/config document describing which public keys are trusted to sign `ReleaseIndex.v1`, including **rotation** and **revocation** semantics.

This trust domain is **separate** from bundle signer governance keys.

## Key evaluation

When verifying a release:

- `signatureTime` is `ReleaseIndex.v1.toolchain.buildEpochSeconds` (an integer Unix epoch time).
- A trusted key is considered usable only if:
  - `notBeforeEpochSeconds` is absent or `signatureTime >= notBeforeEpochSeconds`
  - `notAfterEpochSeconds` is absent or `signatureTime <= notAfterEpochSeconds`
  - `revokedAtEpochSeconds` is absent or `signatureTime < revokedAtEpochSeconds`

## Quorum policy

`policy.minSignatures` specifies how many **valid** signatures from trusted, usable keys are required to accept the release index.

If `policy.requiredKeyIds` is present, each listed `keyId` must appear among the valid signatures as well.

## Schema

See `docs/spec/schemas/ReleaseTrust.v2.schema.json`.

