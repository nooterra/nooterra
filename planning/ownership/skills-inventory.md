# AI Skill Inventory (Nooterra)

## Purpose

Track the minimum skill set required to run Nooterra's multi-role AI workforce and coding pipeline.

## Nooterra local role skills (project)

- `ai-workforce-orchestrator`
- `ai-pm-sprint-planner`
- `ai-tech-lead-architect`
- `ai-backend-implementer`
- `ai-frontend-workflow-builder`
- `ai-qa-verification-engineer`
- `ai-devops-release-operator`
- `ai-gtm-pilot-operator`
- `protocol-invariants`
- `add-protocol-object`
- `fixture-determinism`
- `release-discipline`

## Global skills installed for pipeline hardening

- `research`
- `security-best-practices`
- `security-threat-model`
- `security-ownership-map`
- `playwright`
- `gh-fix-ci`
- `sentry`
- `openai-docs`

## Role to skill mapping

- Orchestrator: `ai-workforce-orchestrator`, `ai-pm-sprint-planner`, `ai-tech-lead-architect`
- PM: `ai-pm-sprint-planner`, `ai-workforce-orchestrator`
- Tech Lead: `ai-tech-lead-architect`, `protocol-invariants`
- Backend: `ai-backend-implementer`, `add-protocol-object`, `protocol-invariants`
- Frontend: `ai-frontend-workflow-builder`, `frontend-design`, `interaction-design`
- QA: `ai-qa-verification-engineer`, `fixture-determinism`, `protocol-invariants`
- DevOps: `ai-devops-release-operator`, `gh-fix-ci`, `sentry`
- Security: `security-best-practices`, `security-threat-model`, `security-ownership-map`
- SDK/DevEx: `openai-docs`, `ai-backend-implementer`, `ai-qa-verification-engineer`
- Data/Risk: `ai-tech-lead-architect`, `ai-backend-implementer`, `ai-qa-verification-engineer`
- GTM: `ai-gtm-pilot-operator`, `marketing-psychology`

## Activation policy

- Use the smallest skill set that can satisfy the task.
- For protocol shape/semantics changes, always include `protocol-invariants`.
- For fixture changes, always include `fixture-determinism`.
- For release tasks, always include `release-discipline` and DevOps ownership.
