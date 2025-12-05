## Coding conventions
- TypeScript/Node: use zod/schemas at boundaries; avoid unchecked any; explicit types on exports; handle errors (no silent failures); include request IDs in logs; prefer await over bare promises.
- Backend safety: validate DAGs for cycles; enforce budgets/quotas server-side; verify signatures when public keys available; parameterized DB access; document env/config defaults; add logs/alerts around failures.
- Security: never trust client payloads; sandbox untrusted code; mask secrets; avoid logging sensitive payloads.
- Frontend: typed network calls; explicit loading/error states; graceful handling of missing keys/env; show skeletons/spinners where needed.
- Tests: run relevant package build/tests; add focused tests when feasible; note if skipping. CI runs pnpm type-check/lint/build/test.
- Performance: avoid N+1 in hot paths; use pagination/limits.
- Commit/PR hygiene: branch prefixes feat/fix/chore/refactor; squash merges; imperative commit messages; small scoped PRs; update docs for user-facing changes.
- Naming/IDs: pass workflowId/nodeId/agentDid through logs/errors for traceability; fail fast on invalid input; favor explicitness over magic.
- Default formatting via Prettier; lint-staged runs prettier on staged files.
