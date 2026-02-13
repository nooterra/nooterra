-- v1.??: fix artifact uniqueness to apply only to job-scoped artifacts.
--
-- The original unique index enforced one artifact per (tenant_id, job_id, artifact_type, source_event_id) whenever
-- source_event_id <> ''. For non-job artifacts we persist with job_id = '' (for example PartyStatement.v1 and
-- PayoutInstruction.v1 during month-close), this incorrectly blocks multiple artifacts of the same type generated from
-- the same month-close event.
--
-- The invariant we actually want is: for job-scoped artifacts (job_id <> ''), prevent duplicates per source event.

DROP INDEX IF EXISTS artifacts_unique_by_job_type_source_event;

CREATE UNIQUE INDEX IF NOT EXISTS artifacts_unique_by_job_type_source_event
  ON artifacts (tenant_id, job_id, artifact_type, source_event_id)
  WHERE source_event_id <> '' AND job_id <> '';

