## Coding Standards

### General
- Keep code readable and modular; avoid long functions.
- Fail fast on invalid input; return structured errors.
- Prefer explicitness over “magic”; pass IDs (workflowId, nodeId, agentDid) through logs/errors.

### TypeScript / Node (coordinator, registry, SDK, website)
- Use `zod` (or schemas) at API boundaries; avoid unchecked `any`.
- Add types to exported functions; keep `any` local and narrow quickly.
- Handle error paths; do not swallow exceptions silently.
- Logging: include request IDs / identifiers; avoid noisy logs in hot paths.
- Async: handle promise rejections; prefer `await` over bare promises.
- Security: never trust client payloads; enforce auth/policy/quota checks server-side.

### Backend specifics (coordinator/registry)
- Validate DAGs for cycles; enforce budgets and quotas server-side.
- Verify signatures for agent results when public keys are present.
- Keep DB access parameterized; avoid string interpolation for SQL.
- When adding env/config, provide sensible defaults and document them.
- Observability: add logs around failures and critical transitions; consider alerts for repeated failures.

### Frontend (console/website)
- Keep network calls typed; handle loading/error states explicitly.
- Avoid blocking UI on optional data; show skeletons/spinners where appropriate.
- Guard against missing keys/envs; fail gracefully.

### Tests / CI
- Run `npm run build` (or package build) for touched packages.
- Add focused tests where feasible; at minimum, avoid regressing type/build.
- If skipping tests, note why in the PR.

### Performance
- Avoid N+1 DB queries in hot paths; batch where possible.
- Use pagination/limits on list endpoints.

### Security & Safety
- Never execute untrusted code without sandboxing and limits.
- Respect policies and quotas; return clear error types (`quota_exceeded`, `unauthorized`, `budget_exceeded`).
- Mask secrets in logs; avoid logging payloads that may contain credentials.
