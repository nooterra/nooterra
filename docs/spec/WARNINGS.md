# Verification warnings

Warnings are protocol objects, not strings.

## Shape

Each warning is a canonical JSON object:

- `code` (required, closed set)
- `message` (optional, string or null)
- `detail` (optional, any JSON)

Warnings are normalized (deduped + sorted) before being emitted in verification reports.

## Codes (closed set)

- `LEGACY_KEYS_FORMAT_USED`
- `NONSERVER_REVOCATION_NOT_ENFORCED`
- `GOVERNANCE_POLICY_MISSING_LENIENT`
- `GOVERNANCE_POLICY_V1_ACCEPTED_LENIENT`
- `BUNDLE_HEAD_ATTESTATION_MISSING_LENIENT`
- `MISSING_GOVERNANCE_SNAPSHOT_LENIENT`
- `UNSIGNED_REPORT_LENIENT`
- `VERIFICATION_REPORT_MISSING_LENIENT`
- `TOOL_VERSION_UNKNOWN`
