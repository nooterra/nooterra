# Supply chain: releases

This doc describes what Nooterra release authenticity *does* and *does not* guarantee.

## Threat model (release channel)

### Assets

- Authenticity of published release artifacts (`*.tgz`, conformance pack, audit packet, etc.)
- Integrity of the mapping: “this tool install corresponds to this commit/release”

### Attacks prevented (assuming release signing key not compromised)

- Artifact swap: attacker replaces one or more release artifacts after build
- Checksum swap: attacker replaces artifacts *and* checksums together
- CI compromise without release key access: attacker can run arbitrary steps but cannot forge a valid `ReleaseIndex.v1` signature

### Attacks not prevented

- Release signing key compromise (attacker can sign malicious artifacts)
- Compromised dependency supply chain *before* release build (mitigated by lockfiles/SBOM, not eliminated)

## Operational response

If the release signing key is suspected compromised:

- Rotate the release signing key and publish an updated `ReleaseTrust.v2` (and revoke the compromised key).
- Publish a security advisory describing impacted releases and mitigation steps.

## How to verify a release (high-level)

1. Verify `release_index_v1.sig` against `release_index_v1.json` using a trusted `ReleaseTrust.v2`.
2. Verify each artifact’s `sha256` matches the index.
