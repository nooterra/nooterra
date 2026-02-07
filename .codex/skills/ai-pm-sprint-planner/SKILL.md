---
name: ai-pm-sprint-planner
description: Convert strategy into deliverable sprint backlogs with Jira-ready epics and tickets. Use when translating business goals into scope, priorities, acceptance criteria, sequencing, and release milestones.
---

# AI PM Sprint Planner

## Use this skill when

- The request is strategy-heavy and needs concrete sprint execution.
- You need Jira tickets with clear acceptance criteria and estimates.
- You must align short-term deliverables with long-term product goals.

## Workflow

1. Convert goals into epics with business outcomes.
2. Split epics into implementable tickets (2-5 day scope each).
3. Add acceptance criteria and dependencies for each ticket.
4. Assign tickets into sprint windows with risk-balanced load.
5. Export backlog to `planning/jira/backlog.json`.

## Backlog standards

- Ticket titles start with verb + object.
- Acceptance criteria are testable and binary.
- Every ticket has owner, estimate, priority, and dependency fields.

## References

- `references/ticket-template.md`
