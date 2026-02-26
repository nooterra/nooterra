# Offline verification (buyer/audit)

This is the “no SaaS required” verification path.

## 1) Download artifacts

From the Magic Link page, download:

- `bundle.zip` (the canonical input)
- `verify.json` (hosted `VerifyCliOutput.v1`, for reference)

## 2) Verify locally with `nooterra-verify`

Extract the bundle ZIP to a directory, then run:

```sh
node packages/artifact-verify/bin/nooterra-verify.js --format json --strict --invoice-bundle /path/to/extracted/bundle > out.verify.json
```

### Trust anchors (strict mode)

Strict verification requires governance trust roots to be provided out-of-band. If you have a trust file:

```sh
export NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON='{"key_...":"-----BEGIN PUBLIC KEY-----..."}'
export NOOTERRA_TRUSTED_TIME_AUTHORITY_KEYS_JSON='{"key_...":"-----BEGIN PUBLIC KEY-----..."}'
```

Then rerun the strict command above.

## 3) Compare results deterministically

`VerifyCliOutput.v1` is deterministic (stable ordering of errors/warnings and normalized paths). You can archive it and replay verification later.
