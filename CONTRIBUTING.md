## Contributing to Nooterra

### Branch & PR flow
- Branch prefixes: `feat/`, `fix/`, `chore/`, `refactor/`.
- One PR per logical change; keep PRs small and scoped.
- Target branch: `main` (use feature branches; no direct pushes).
- Reviews: at least one reviewer; for protocol changes aim for two.
- Rebase/merge: prefer squash merge to keep history clean.

### Commit hygiene
- Clear, imperative commit messages (e.g., `add code verifier sandbox`).
- Avoid mixing unrelated changes in one commit/PR.

### Testing & linting
- Run relevant tests for the area you touch. If you cannot run, explain why in the PR.
- For website/coordinator/SDK TypeScript: ensure `npm run build` (or package-specific build) passes.
- If adding a new command or script, document how to run it.

### Code style
- TypeScript/JavaScript: favor explicit types on public functions; narrow `any`; handle error paths.
- Avoid silent failures; log with context (workflowId, nodeId, agentDid).
- Keep functions small; extract helpers when logic is reused.
- Prefer descriptive names over comments; add brief comments only for non-obvious logic.

### Security & safety
- Verify inputs with zod/schemas at API boundaries.
- Never execute untrusted code without sandboxing; tie back to capabilities/ACARDs.
- Be explicit about policy and quota checks; return structured errors.

### Docs
- Update docs/README when you add or change user-facing behavior (APIs, env vars, scripts).
- Include example payloads for new endpoints or capabilities.

### Review checklist (for reviewers)
- Correctness: does it do what it claims? Any missing edge cases?
- Safety: input validation, auth, policy/quota checks in place.
- Observability: logs/metrics/alerts where appropriate.
- Tests/build: evidence provided or run locally.
- Docs: updated if behavior changes.

### Issue/PR templates
- Use the PR template in `.github/pull_request_template.md`.
