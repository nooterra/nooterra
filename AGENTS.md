# AGENTS.md

## Purpose
This file is the operating contract for AI coding agents in this repository.
Apply these rules for all changes under this directory.

## Project Context
- Product: Settld Trust OS (policy enforcement, deterministic evidence, dispute/reversal, production gates).
- Stack: Node.js 22 (LTS) + Node.js 20 (supported), ESM JavaScript, npm scripts, CI on GitHub Actions.
- Priority qualities: deterministic behavior, fail-closed safety, auditable artifacts, idempotency.

## Non-Negotiables
1. Never add bypass paths around policy/runtime enforcement for paid or high-risk actions.
2. Prefer fail-closed behavior when evidence/artifacts are missing, invalid, or mismatched.
3. Preserve deterministic outputs where contracts require it (stable hashes, canonical JSON, fixed schema versions).
4. Keep protocol changes backward-safe; avoid hidden contract drift.
5. Do not make unrelated refactors in ticket-scoped work.

## Engineering Style
- Keep changes small, local, and reversible.
- Prefer explicit helpers over deeply nested logic.
- Keep functions focused and short when practical.
- Use clear, stable IDs for checks/reason codes/schema versions.
- Add concise comments only when intent is non-obvious.

## Testing Discipline
- Always run targeted tests for touched behavior before finishing.
- For gate/report scripts, test both success and fail-closed paths.
- Include deterministic assertions where applicable (repeat runs produce same semantic output).
- If full suite is not run, state exactly what was run and what remains.

## Commands (Common)
- Install: `npm ci`
- Full tests: `npm test`
- Single test file: `node --test test/<file>.test.js`
- Production cutover gate: `npm run -s test:ops:production-cutover-gate`
- Hosted baseline evidence: `npm run -s ops:hosted-baseline:evidence -- ...`
- OpenAPI drift check: `npm run -s openapi:write && git diff --exit-code -- openapi/settld.openapi.json`

## Gate and Artifact Rules
- Gate/report scripts must emit machine-readable JSON with explicit `schemaVersion`.
- Reports should include enough detail for audit (`checks`, `blockingIssues`, verdict counts).
- Optional signing paths should be explicit and validated; invalid signing config must fail closed.
- Prefer canonical-hash binding (`sha256`) for promotion/release decisions.

## Multi-Agent Execution
When parallelizing work:
1. Assign explicit file ownership per agent.
2. Avoid overlapping edits across agents.
3. Merge only after each agent reports tests run.
4. Re-run impacted targeted tests after integration.

## Skills Usage
If available skills match the task, use them.
Typical mapping:
- Backend/API/worker contracts: `ai-backend-implementer`
- Architecture and sequencing: `ai-tech-lead-architect`
- QA, regression, gates: `ai-qa-verification-engineer`
- Multi-stream coordination: `ai-workforce-orchestrator`
- Protocol/schema object changes: `add-protocol-object`, `protocol-invariants`
- Deterministic fixtures/vectors: `fixture-determinism`
- Release hardening/versioning: `release-discipline`

## Definition of Done
A change is done only when all are true:
1. Acceptance criteria are met exactly.
2. Relevant tests pass locally.
3. Behavior is fail-closed where safety-critical.
4. Artifacts and schemas remain deterministic.
5. A short change summary and test command list is provided.

## Anti-Patterns
- Silent behavior changes without tests.
- “Best effort” success on missing evidence.
- Coupling unrelated cleanup to ticket work.
- Non-deterministic report fields without clear reason.

