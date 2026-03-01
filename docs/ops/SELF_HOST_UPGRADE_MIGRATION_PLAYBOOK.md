# Self-Host Upgrade and Migration Playbook

This playbook defines the deterministic, auditable upgrade/migration sequence for self-host ACS control plane deployments.

## Scope

Applies to the self-host runtime launched from `deploy/compose/nooterra-self-host.topology.yml` with `.env.selfhost`.

## Required controls

1. Use immutable source and target release identifiers (git commit SHA and/or image digest).
2. Record command transcripts and artifacts under one run directory.
3. Fail closed: stop immediately on non-zero exits, missing artifacts, or hash mismatches.
4. Keep customer traffic closed until validation gates are green.

## Run artifacts

Create one run directory per upgrade (example: `artifacts/ops/self-host-upgrade/<source-sha>_to_<target-sha>/`) and persist:

1. `preflight.txt`
2. `backup-manifest.json`
3. `rollout.txt`
4. `validation.txt`
5. `rollback.txt` (only if rollback executed)
6. `artifacts/gates/self-host-upgrade-migration-gate.json`

## Preconditions

1. Record source and target release IDs in the change ticket.
2. Confirm current self-host health by running:

```bash
npm run -s test:ops:self-host-topology-bundle-gate
```

Expected report path:

`artifacts/gates/self-host-topology-bundle-gate.json`

3. Confirm maintenance window, rollback owner, and approver are assigned.
4. Snapshot current environment contract (`.env.selfhost` + secret version IDs) into `preflight.txt`.
5. Abort if any required evidence is missing.

## Step 1: Capture backup and evidence snapshot

1. Quiesce write paths (disable ingress traffic, then stop write-capable services).
2. Capture durable state snapshots:
   - Postgres snapshot/dump.
   - Magic-link durable volume snapshot.
   - Evidence store snapshot (MinIO/S3 export or provider snapshot).
3. Compute `sha256` for each snapshot artifact.
4. Write `backup-manifest.json` as canonical JSON with:
   - `schemaVersion`: `SelfHostUpgradeBackupManifest.v1`
   - `sourceRelease`
   - `targetRelease`
   - `artifacts[]` entries with `path` and `sha256`
5. Abort if any snapshot, hash, or manifest step fails.

## Step 2: Apply upgrade

1. Deploy the exact target release (commit/image pinned from preflight).
2. Pull/build target runtime artifacts without changing the environment contract.
3. Apply rollout in deterministic order:
   - dependencies (`postgres`, evidence store)
   - `api`
   - `maintenance`
   - `magic-link`
   - `x402-upstream-mock` + `x402-gateway` (or production upstream equivalent)
4. Append command output and service state to `rollout.txt`.
5. Stop and rollback if any service fails health checks.

## Step 3: Run migration validation gate

1. Verify `healthz` on API, magic-link, and gateway.
2. Re-run topology gate:

```bash
npm run -s test:ops:self-host-topology-bundle-gate
```

3. Run self-host upgrade/migration gate:

```bash
npm run -s test:ops:self-host-upgrade-migration-gate
```

Expected report path:

`artifacts/gates/self-host-upgrade-migration-gate.json`

4. Proceed only if the report verdict is pass and blocking issues are empty.

## Step 4: Post-upgrade smoke and readiness

1. Run a paid-path smoke covering publish/discover/delegate/settle.
2. Run ACS-E10 readiness aggregation:

```bash
npm run -s test:ops:acs-e10-readiness-gate
```

Expected report path (if full upstream artifacts are present):

`artifacts/gates/acs-e10-readiness-gate.json`

3. Proceed only when smoke paths and readiness summary are green.

## Rollback

Trigger rollback immediately on rollout or validation failure.

1. Re-deploy the exact source release.
2. Restore Postgres, magic-link durable state, and evidence store from `backup-manifest.json`.
3. Re-run validation gates:

```bash
npm run -s test:ops:self-host-topology-bundle-gate
npm run -s test:ops:self-host-upgrade-migration-gate
```

4. Record rollback transcript and restored hashes in `rollback.txt`.
5. Keep traffic closed until rollback validation is green.

## Audit completion criteria

Upgrade/migration is complete only when all are present:

1. Preflight, backup, rollout, and validation transcripts.
2. Canonical `backup-manifest.json` with `sha256` bindings for snapshots.
3. Final gate report at `artifacts/gates/self-host-upgrade-migration-gate.json`.
4. If rollback executed, rollback transcript and post-rollback gate outputs.
