# ClosePackManifest.v1

This manifest is stored at `manifest.json` within ClosePack bundles.

## Hashing contract

- `hashing.schemaVersion = "ClosePackManifestHash.v1"`
- file order: `path_asc`
- excludes: `["verify/**"]`

Rationale: `verify/verification_report.json` is a derived output that binds to `manifestHash`, so including `verify/**` in the manifest would create circular hashing.

## manifestHash

`manifestHash = sha256_hex( canonical_json_stringify(manifest_without_hash) )`

## File entries

`files[]` entries include:

- `name` (path relative to ClosePack root)
- `sha256` (hex sha256 of raw file bytes)
- `bytes` (byte length)

