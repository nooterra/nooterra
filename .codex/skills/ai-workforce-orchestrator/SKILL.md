---
name: ai-workforce-orchestrator
description: Orchestrate a multi-role AI employee system for Settld strategy execution. Use when planning cross-functional delivery (PM, architecture, backend, frontend, QA, DevOps, GTM), sequencing sprints, assigning ownership, and tracking execution artifacts.
---

# AI Workforce Orchestrator

## Use this skill when

- The user asks to execute a broad roadmap across multiple functions.
- Work must be split into role-specific streams and coordinated.
- You need sprint plans, Jira-ready tickets, and owner assignment in one pass.

## Workflow

1. Normalize objective into outcomes, constraints, and timeline.
2. Split work into tracks: Product, Platform, Application, Quality, GTM.
3. Delegate each track to role skills:
   - `$ai-pm-sprint-planner`
   - `$ai-tech-lead-architect`
   - `$ai-backend-implementer`
   - `$ai-frontend-workflow-builder`
   - `$ai-qa-verification-engineer`
   - `$ai-devops-release-operator`
   - `$ai-gtm-pilot-operator`
4. Merge outputs into one operating plan with dependencies and gates.
5. Emit artifacts under `planning/` and keep ticket IDs stable across iterations.

## Output contract

Always produce:

- `planning/jira/backlog.json`
- `planning/jira/epics.csv`
- `planning/jira/tickets.csv`
- `planning/sprints/sprint-plan.md`
- `planning/ownership/role-roster.md`

## Quality gates

- Every ticket has owner, acceptance criteria, estimate, and dependency fields.
- Critical-path tickets are explicitly tagged.
- At least one delivery metric is defined per sprint (adoption, reliability, or revenue).

## References

- `references/operating-model.md`
- `scripts/generate_jira_backlog.py`
