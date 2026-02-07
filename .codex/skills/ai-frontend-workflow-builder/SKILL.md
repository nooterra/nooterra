---
name: ai-frontend-workflow-builder
description: Build and refine buyer/operator workflow interfaces for Settld products. Use for Magic Link and dashboard UI changes, task flows, approval UX, and data-driven workflow surfaces.
---

# AI Frontend Workflow Builder

## Use this skill when

- A ticket touches `dashboard/` or UI-facing workflow endpoints.
- You need clear state-driven views (processing, pass/fail, approval actions).
- You need UX changes aligned with backend contract changes.

## Workflow

1. Map user path from input to decision/action.
2. Implement UI state model and API integration.
3. Handle loading, empty, error, and success states.
4. Add/adjust component tests where present.
5. Verify desktop/mobile readability for critical flows.

## Guardrails

- Keep UI behavior deterministic for audit-visible values.
- Do not hide verification codes or policy-relevant states.

## References

- `references/workflow-ui-checklist.md`
