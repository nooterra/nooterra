# Artifact Verification Status API

This endpoint provides a normalized verification signal for an artifact:

- `green`: verification passed
- `amber`: insufficient evidence or unknown proof state
- `red`: verification failed

## Endpoint

- `GET /artifacts/{artifactId}/status`
  - Scopes: `ops_read` or `audit_read` or `finance_read`

## Bulk status in ops job list

- `GET /ops/jobs` includes inline verification fields per job:
  - `verificationStatus` (`green` | `amber` | `red`)
  - `evidenceCount`, `activeEvidenceCount`
  - `slaCompliancePct`
  - `verification` (full normalized verification object)
- Scopes: `ops_read` or `audit_read`

## Response shape

The API returns:

- Artifact identity fields (`artifactId`, `artifactType`, `artifactHash`, `jobId`, `sourceEventId`)
- `verification` object with:
  - `verificationStatus` (`green` | `amber` | `red`)
  - `proofStatus` (`PASS` | `INSUFFICIENT_EVIDENCE` | `FAIL` | `null`)
  - `reasonCodes`, `missingEvidence`
  - `evidenceCount`, `activeEvidenceCount`
  - `slaCompliancePct`
  - Coverage metrics (`requiredZones`, `reportedZones`, `belowThresholdZones`, `missingZoneCount`, `excusedZones`)

## Example

```sh
curl -sS "http://localhost:3000/artifacts/art_123/status" \
  -H "x-proxy-tenant-id: tenant_default" \
  -H "x-settld-protocol: 1.0" \
  -H "x-proxy-ops-token: <ops_read_token>" | jq
```
