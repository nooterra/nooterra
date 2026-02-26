# Quickstart: Verify a Nooterra Release (Authenticity)

This verifies Nooterra **distribution artifacts** (npm tarballs, conformance pack, audit packet) using a signed `ReleaseIndex.v1` rooted in a release trust file.

## Offline verification (recommended)

1) Download a release’s assets into a directory (example: `./release/`), including:

- `release_index_v1.json`
- `release_index_v1.sig`
- every artifact listed in `release_index_v1.json.artifacts[]`

2) Verify using the pinned release trust roots:

```sh
nooterra-release verify --dir ./release --trust-file trust/release-trust.json --format json --explain
```

- Exit code `0` means verified.
- `--format json` prints `VerifyReleaseOutput.v1` to stdout (pipe-safe, deterministic).
- `--explain` prints deterministic diagnostics to stderr.

## Mirror/HTTP verification (base URL)

If your org mirrors release assets under a single base URL:

```sh
nooterra-release verify --base-url https://example.com/nooterra/releases/v1.0.0-rc.1/ --trust-file trust/release-trust.json --format json --explain
```

This downloads `release_index_v1.json`, `release_index_v1.sig`, then downloads every artifact referenced by the index (relative to the base URL) into a temp directory before verifying.

## Trust domains (important)

Release authenticity trust roots are **separate** from bundle verification trust roots.

- Release trust: `trust/release-trust.json`
- Bundle verification trust: `NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON` / `trust.json` (see `docs/spec/TRUST_ANCHORS.md`)

