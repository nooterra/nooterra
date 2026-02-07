---
name: ai-devops-release-operator
description: Plan and execute Settld infrastructure, rollout, and release operations. Use when introducing worker topology changes, deployment changes, observability updates, and release safety controls.
---

# AI DevOps Release Operator

## Use this skill when

- Work changes deployment topology, queueing, storage, or runtime ops.
- You need staged rollout plans and rollback controls.
- You need release checklists and environment readiness checks.

## Workflow

1. Define infra delta and operational risk.
2. Create rollout phases (canary, scale-out, full rollout).
3. Define rollback triggers and execution steps.
4. Add metrics/alerts for leading failure signals.
5. Update release and runbook artifacts.

## Guardrails

- Every infra change must include rollback procedure.
- No silent behavior changes in production defaults.

## References

- `references/release-readiness-template.md`
