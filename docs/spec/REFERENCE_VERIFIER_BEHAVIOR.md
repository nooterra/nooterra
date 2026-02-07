# Reference Verifier Behavior (v1)

This document specifies **portable verifier behavior** for areas where independent implementations tend to drift (filesystem semantics, path handling, and manifest evaluation order).

It complements:

- `CANONICAL_JSON.md` (RFC 8785 / JCS)
- `STRICTNESS.md` (strict vs non-strict contract)
- `TRUST_ANCHORS.md` (trust root injection)
- `WARNINGS.md` (warning code contract)
- `conformance/v1/` (executable oracle)

## Bundle-relative paths (manifest `files[].name`)

The manifest `files[].name` values describe **bundle-relative** file paths.

An implementation:

1. MUST treat `files[].name` as a **portable** path using `/` as the separator (regardless of host OS).
2. MUST reject any `files[].name` that is empty or not a string.
3. MUST reject any `files[].name` that starts with `/` (absolute path).
4. MUST reject any `files[].name` that contains `\` (backslash), `:` (Windows drive / URI ambiguity), or `\u0000` (NUL).
5. MUST reject any `files[].name` that ends with `/` (directory marker).
6. MUST reject any `files[].name` containing a `.` or `..` segment (path traversal).
7. MUST resolve each `files[].name` against the bundle root and MUST reject any entry that escapes the bundle root (even if it “looks relative”).
8. MUST treat a manifest containing a rejected path as a hard failure in **both** strict and non-strict modes.

Conformance expects such failures to surface as `MANIFEST_PATH_INVALID`.

## Duplicate manifest entries

1. MUST treat duplicate `files[].name` values as invalid.
2. MUST treat duplicate-path manifests as a hard failure in **both** strict and non-strict modes.

Conformance expects such failures to surface as `MANIFEST_DUPLICATE_PATH`.

## Symlinks

1. MUST NOT follow filesystem symlinks when verifying a manifest-listed file.
2. MUST treat any manifest-listed path that resolves to a symlink (at the filesystem level) as invalid in **both** strict and non-strict modes (this is a security invariant, not a compatibility affordance).

Conformance expects such failures to surface as `MANIFEST_SYMLINK_FORBIDDEN`.

## File hashing semantics

1. MUST hash file contents as **raw bytes** (no newline normalization, no UTF-8 re-encoding).
2. MUST treat missing files referenced by the manifest as verification failures.
3. MUST ignore filesystem metadata (mtime, permissions) for hashing and matching purposes.

## Manifest evaluation order (error precedence)

To keep behavior stable and portable, implementations:

1. MUST validate manifest structure (path validity and duplicate-path checks) **before** reporting hash-binding mismatches (for example, before `manifestHash mismatch` / attestation binding checks).
2. MUST then compute and compare `manifestHash` using canonical JSON (RFC 8785) exactly as specified in `ProofBundleManifest.v1.md` / `FinancePackBundleManifest.v1.md`.

This ordering prevents ambiguous “first failure wins” behavior across implementations and is relied upon by `conformance/v1/`.

## Trust anchors (portable minimum)

1. MUST support out-of-band injection of trusted governance roots via `SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON` (see `TRUST_ANCHORS.md`).
2. MUST treat missing trusted governance roots as a hard failure in strict mode when governance-root signatures are required.

## Strict vs non-strict (portable minimum)

1. MUST apply strict/non-strict downgrades only where explicitly documented in `STRICTNESS.md`.
2. MUST NOT downgrade the security invariants in this document (path traversal, duplicate paths, symlink refusal).

