# Tool provenance (version + commit)

Nooterra surfaces tool identity in:

- `VerificationReport.v1.tool` (producer/receipt provenance)
- `VerifyCliOutput.v1.tool` (verifier CLI provenance)

## Commit derivation (best-effort)

When a commit/build identifier is not explicitly provided by the caller, tools try these environment variables in order:

1. `NOOTERRA_COMMIT_SHA`
2. `PROXY_BUILD` (Docker build arg often mapped from `GIT_SHA`)
3. `GIT_SHA`
4. `GITHUB_SHA`

Accepted values: lowercase hex `[0-9a-f]{7,64}` (normalized to lowercase).

If no valid value is available, tools omit `tool.commit` (or set it to `null` in CLI output) and producers emit `TOOL_COMMIT_UNKNOWN`.

## Version derivation (best-effort)

When a version is not explicitly provided by the caller, tools try:

1. `NOOTERRA_VERSION` (if set in the environment)
2. Repo/service version stamp from `NOOTERRA_VERSION` file (when present in the working directory)
3. Package `package.json` version (for published tools like `nooterra-verify`)

If no value is available, tools omit `tool.version` (or set it to `null` in CLI output) and producers emit `TOOL_VERSION_UNKNOWN`.

