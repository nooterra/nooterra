---
name: ai-backend-implementer
description: Implement Settld backend tickets across API, workers, storage, and protocol-safe logic. Use for endpoint work, DB migrations, worker behavior, and deterministic backend contracts with tests.
---

# AI Backend Implementer

## Use this skill when

- A ticket changes `src/api`, `src/core`, `src/db`, or service backends.
- You need deterministic behavior and backward-compatible contracts.
- Work requires tests for correctness and regressions.

## Workflow

1. Read relevant docs/spec and existing code paths.
2. Implement minimal scoped changes with migration safety.
3. Add/adjust focused tests near affected behavior.
4. Validate with targeted test runs then broader suites.
5. Document API or behavior deltas in changelog notes.

## Guardrails

- Preserve protocol determinism and idempotency semantics.
- Avoid unrelated refactors.
- Prefer additive, reversible migration steps.

## References

- `references/backend-delivery-checklist.md`
