# CapabilityTrialRunReport.v1

`CapabilityTrialRunReport.v1` is the machine-readable output of running a `CapabilityTrial.v1`.

Status: implemented.

## Required fields

- `schemaVersion` (const: `CapabilityTrialRunReport.v1`)
- `trial` (`CapabilityTrial.v1` object)
- `ok` (boolean)
- `startedAt` (ISO date-time)
- `completedAt` (ISO date-time)
- `tenantId`
- `subject.agentId`
- `principal.agentId`
- `attestor.agentId`
- `reportHash` (sha256 hex; deterministic hash over stable report fields)
- `checks[]`
- `blockingIssues[]`

Optional:

- `issuedAttestation` (summary of `CapabilityAttestation.v1` created after a passing trial)
- `bootstrap` (metadata when `--bootstrap-local` is used)

## Check row schema (v1)

Each `checks[]` entry has:

- `id` (stable identifier)
- `ok` (boolean)
- `code` (optional stable failure code)
- `message` (optional human-readable detail)

## Deterministic report hash

`reportHash` is computed over a stable subset of fields (no timestamps / URLs):

- `schemaVersion`
- `trialId`
- `subjectAgentId`
- `ok`
- `checks[].{id,ok,code}`
- `issuedAttestationId` (if present)

This allows evidence referencing (e.g. `evidenceRefs: ["report://capability_trial/<reportHash>"]`) without coupling to volatile fields.

## Reference implementation

- `scripts/trials/run-capability-trial.mjs`

