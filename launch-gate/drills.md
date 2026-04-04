# Launch Gate: Operational Drills

## Gate Item 23: Global execution kill switch
**Drill procedure:**
1. Queue 3 actions in the approval queue
2. Approve one (verify it executes)
3. Activate the kill switch: `POST /v1/world/kill-switch { "enabled": true }`
4. Approve the second action -> verify it is blocked with a clear message
5. Try to trigger a planning cycle -> verify no new actions are queued for execution
6. Deactivate: `POST /v1/world/kill-switch { "enabled": false }`
7. Approve the third action -> verify it executes

**Pass criteria:** Steps 4-5 block execution. Step 7 resumes. No data corruption.

## Gate Item 36: Database backup and restore
**Drill procedure:**
1. Record current state: count of world_events, world_objects, gateway_actions for test tenant
2. Take a database backup (pg_dump or PITR snapshot)
3. Insert 10 new events (trigger a planning cycle)
4. Restore from backup
5. Verify: counts match step 1. New events from step 3 are gone.
6. Verify: the system starts and serves requests without errors.

**Pass criteria:** State matches pre-backup. System healthy post-restore.

## Gate Item 37: Deployment rollback
**Drill procedure:**
1. Note current deployment version (git SHA, Railway deployment ID)
2. Deploy a new version with a deliberate break (e.g., bad env var)
3. Verify: the break is observable (health check fails, error in logs)
4. Roll back to the previous deployment
5. Verify: health check passes, system serves requests normally

**Pass criteria:** Rollback completes in under 5 minutes. System healthy after.
