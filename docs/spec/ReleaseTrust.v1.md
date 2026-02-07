# ReleaseTrust.v1

`ReleaseTrust.v1` is a tooling/config document describing which public keys are trusted to sign `ReleaseIndex.v1`.

This trust domain is **separate** from bundle signer governance keys.

`ReleaseTrust.v1` is a legacy/simple format: a mapping of `keyId -> publicKeyPem` with no rotation, revocation, or quorum policy.

For rotation/revocation/quorum, use `ReleaseTrust.v2`.

## Schema

See `docs/spec/schemas/ReleaseTrust.v1.schema.json`.
