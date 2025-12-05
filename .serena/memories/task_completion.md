## When finishing a task
- Run relevant checks: `pnpm type-check`, `pnpm lint`, `pnpm test`, and package-specific builds (`pnpm build --filter <pkg>`). For backend changes, ensure db migrations accounted for and env docs updated.
- Verify formatting (Prettier) and address any lint/type errors; note if tests not run and why.
- Update docs/README/DEPLOY if APIs/env vars/commands change; include example payloads for new endpoints.
- Follow PR template: summarize change, testing run/results, policy/auth/quota impacts, screenshots for UI, and follow-ups.
- Avoid reverting user changes; keep commits scoped and descriptive (squash preferred).
