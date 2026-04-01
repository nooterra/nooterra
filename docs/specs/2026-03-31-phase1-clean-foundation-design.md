# Phase 1: Clean Foundation

**Date**: 2026-03-31
**Status**: Draft
**Goal**: One codebase, one truth, no confusion. Strip everything that isn't the website product, rename the runtime, begin TypeScript migration.

---

## Context

The repo has three parallel systems doing overlapping work:

1. **CLI worker-builder** (`scripts/worker-builder/`, 51 files, 25K lines) — local-only agent runtime with meta-agent, learning, TUI
2. **Agentverse** (`src/agentverse/`, 58 files, 7K lines) — protocol layer for federation, delegation, marketplace
3. **Cloud scheduler** (`services/scheduler/`, 31 files, 16K lines) — the actual deployed product

Plus dead services (`x402-gateway`, `finance-sink`, `receiver`, `managed-specialists`), an old superseded API (`src/api/`, 33 files, 139K lines), and `src/core/` (269 files) of which the scheduler uses exactly 2 files (`tracing.js`, `s3-presign.js`).

The result: anyone opening this repo doesn't know what the product is. That ends here.

---

## Decision: What Stays, What Goes

### Stays (the website product)

| Directory | Purpose |
|-----------|---------|
| `services/scheduler/` → renamed to `services/runtime/` | The API + agent runtime (deployed on Railway) |
| `services/magic-link/` | Auth service |
| `dashboard/` | React frontend (deployed on Vercel) |
| `src/db/` | Migrations + Postgres connection |
| `src/core/tracing.js` | OpenTelemetry tracing (used by runtime) |
| `src/core/s3-presign.js` | S3 presigned URLs (used by runtime) |
| `src/product/` | Starter worker/provider catalogs |
| `openapi/` | API spec |
| `test/scheduler-*.test.js` | Runtime test suite (95 tests) |

### Archived to git tag `archive/pre-prune-2026-03-31`

Everything below gets deleted from `main` after tagging:

| Directory | Files | Lines | Reason |
|-----------|-------|-------|--------|
| `scripts/worker-builder/` | 51 | 25,713 | CLI runtime — intelligence modules will be migrated to cloud in Phase 3, shell/TUI/daemon deleted permanently |
| `src/agentverse/` | 58 | 7,216 | Protocol layer — future infrastructure, not current product |
| `src/api/` | 33 | 138,906 | Old API superseded by scheduler |
| `src/core/` (except tracing.js, s3-presign.js) | ~267 | ~50K+ | Settlement, x402, marketplace, disputes — all tied to old API |
| `src/federation/` | 3 | 776 | Federation routing — not current product |
| `src/agent/` | 1 | 167 | Agent simulator — not used |
| `services/x402-gateway/` | 4 | 1,515 | Payment gateway — not current product |
| `services/finance-sink/` | 7 | 1,156 | Billing event sink — not current product |
| `services/receiver/` | 7 | 1,070 | Webhook receiver — not current product |
| `services/managed-specialists/` | 2 | 458 | Pre-built worker deployment — not current product |
| `conformance/` | 732 | many | Conformance test suites for agentverse protocols |
| `test/agentverse/` | 24 | 3,662 | Agentverse test suite |
| `bin/agentverse-cli.js` | 1 | 5 | Agentverse CLI entry |

**Total removed**: ~850+ files, ~230K+ lines

### Special handling

- `src/core/tracing.js` and `src/core/s3-presign.js` move to `services/runtime/lib/` so they live with their only consumer
- `bin/nooterra.js` stays but gets stripped to only handle the MCP server entry point (remove worker-builder CLI routing)

---

## Rename: scheduler → runtime

`services/scheduler/` → `services/runtime/`

This is not cosmetic. The service is an agent runtime, not a cron scheduler. The name change reflects what we're building toward (event-driven, session-aware, intelligent) not what it currently is (a poll loop).

### Files that reference "scheduler" and need updating

**Critical (will break if not updated):**

1. `package.json` — 2 script references:
   - `start:scheduler` → `start:runtime`
   - `test:ops:scheduler-runtime-hardening-gate` → `test:ops:runtime-hardening-gate`

2. `vercel.json` — 8 rewrite rules pointing to `nooterra-scheduler-production.up.railway.app`
   - **Note**: The Railway service URL stays as-is for now. Rename the Railway service separately. The vercel.json rewrites reference the Railway hostname, not the local directory. Update the Railway service name when deploying next.

3. `.github/workflows/tests.yml` — job name `scheduler_runtime_hardening_gate`

4. `scripts/ci/run-scheduler-runtime-hardening-gate.mjs` — rename to `run-runtime-hardening-gate.mjs`, update internal paths

5. All 18 test files (`test/scheduler-*.test.js`) — update import paths from `../services/scheduler/` to `../services/runtime/`

6. `Dockerfile` / deploy configs — update `CMD` path

**Safe to leave (semantic identifiers, not file paths):**
- Actor type strings like `{ type: "scheduler" }` in route handlers
- OpenAPI description strings
- Documentation references (update as part of README rewrite)

---

## TypeScript Migration (Phase 1 scope)

Not a full rewrite. Incremental, starting with the interfaces that matter most.

### Setup

- Add `tsconfig.json` with `allowJs: true`, `strict: true`, `noEmit: true` (type-checking only, no compilation step — Node 22+ has native TS strip support, or use `tsx` as runner)
- Add `typescript` as devDependency
- Add `@types/node`, `@types/pg` as devDependencies
- Add `type-check` script to package.json
- Wire type-check into CI gate

### Phase 1 conversions (core interfaces only)

These files define the shapes that flow through the entire system. Typing them catches the most bugs for the least effort:

| File | Why | Priority |
|------|-----|----------|
| `services/runtime/state-machine.ts` | Execution + approval status enums, transition validation — small file (127 lines), high leverage | 1 |
| `services/runtime/types.ts` (new) | Shared interfaces: `Worker`, `Execution`, `Charter`, `Capability`, `ApprovalRecord`, `VerificationReport` | 1 |
| `services/runtime/verification-engine.ts` | Assertion types, verification plans — already well-structured | 2 |
| `services/runtime/learning-signals.ts` | Signal shapes — small file (94 lines) | 2 |
| `services/runtime/runtime-policy-store.ts` | Policy validation — already has extensive runtime checks that should be types | 3 |

**Not in Phase 1**: `server.js` (3,500 lines) and `workers-api.js` (3,280 lines) — too large, too many implicit types. Convert these after the interfaces stabilize.

---

## package.json Cleanup

### Scripts to remove

**Dead service scripts:**
- `dev:api`, `start:prod` (old API)
- `dev:maintenance`, `start:maintenance`
- `dev:finance-sink`, `start:finance-sink`
- `dev:managed-specialists`, `start:managed-specialists`
- `dev:receiver`, `start:receiver`
- `dev:x402-gateway`, `start:x402-gateway`
- `setup:publish-managed-specialists`

**Dead test/CI scripts:**
- `test:ops:agentverse-gate`
- `test:ops:agentverse-live-e2e`
- `test:ops:managed-specialists-readiness-gate`
- `agent:sim`
- All `conformance:*` scripts
- All `test:x402:*` scripts
- All `settlement:*`, `proof:*` scripts
- `test:ops:agent-substrate-*` scripts
- `test:ops:openclaw-*` scripts
- `test:ops:nooterra-verified-*` scripts
- `test:ops:simulation-*` scripts
- `test:ci:ns3-*` scripts
- `test:ci:openclaw-*` scripts

**Dead operational scripts:**
- `ops:money-rails:*`
- `ops:dispute:*`
- `ops:x402:*`
- `ops:audit:lineage:verify` (references old API)
- `finance:bundle`

### Scripts to rename
- `start:scheduler` → `start:runtime`
- `test:ops:scheduler-runtime-hardening-gate` → `test:ops:runtime-hardening-gate`
- `dev:scheduler` → `dev:runtime` (add this — currently missing)

### Scripts to add
- `type-check` — `tsc --noEmit`
- `dev:runtime` — `node services/runtime/server.js`

### Bin/exports to update
- Remove `agentverse` bin entry
- Remove `./agentverse` and `./agentverse/bridge/*` exports
- Keep `nooterra` bin and `./mcp` export

---

## README Rewrite

Replace the current README (which pitches CLI + web + MCP as three equal surfaces) with one that reflects the actual product:

**Headline**: "AI employees for your business — governed, auditable, self-improving."

**Sections**:
1. What Nooterra does (1 paragraph)
2. How it works (the permission model: canDo/askFirst/neverDo)
3. Get started → link to nooterra.ai
4. Self-hosting (Docker + Postgres)
5. Architecture (runtime + dashboard + auth)
6. Development (how to run locally)
7. License

Remove CLI-as-product framing. Remove MCP-as-product framing. The product is the website.

---

## CI Gate Updates

1. Rename `scheduler_runtime_hardening_gate` job → `runtime_hardening_gate` in `.github/workflows/tests.yml`
2. Update the gate script to reference `services/runtime/` paths
3. Add `type-check` step to CI pipeline (can be a separate job, non-blocking initially, then blocking once clean)
4. Remove any CI jobs that only test archived code (agentverse gate, managed-specialists gate, etc.)

---

## PR Breakdown

### PR 1: Archive and delete dead code
- Create git tag `archive/pre-prune-2026-03-31`
- Delete: `scripts/worker-builder/`, `src/agentverse/`, `src/api/`, `src/core/` (except 2 files), `src/federation/`, `src/agent/`, `services/x402-gateway/`, `services/finance-sink/`, `services/receiver/`, `services/managed-specialists/`, `conformance/`, `test/agentverse/`, `bin/agentverse-cli.js`
- Move `src/core/tracing.js` and `src/core/s3-presign.js` to `services/scheduler/lib/`
- Update imports in `server.js` and `workers-api.js` for moved files
- Strip `package.json` scripts, bins, exports
- Strip dead test files
- Verify: existing 95 scheduler tests still pass, lint clean

### PR 2: Rename scheduler → runtime
- `git mv services/scheduler services/runtime`
- Update all import paths in test files
- Update `package.json` script references
- Update CI gate script name and paths
- Update Dockerfile CMD
- Update README reference paths
- Verify: 95 tests still pass at new paths, CI gate passes

### PR 3: TypeScript setup + core interface types
- Add `tsconfig.json`, `typescript`, `@types/node`, `@types/pg`
- Create `services/runtime/types.ts` with core interfaces
- Convert `state-machine.js` → `state-machine.ts`
- Convert `verification-engine.js` → `verification-engine.ts`
- Convert `learning-signals.js` → `learning-signals.ts`
- Add `type-check` script and CI step
- Verify: type-check passes, 95 tests still pass

### PR 4: README rewrite
- Rewrite README.md for website-only product
- Update any stale documentation
- Clean up landing page references if needed

---

## Success Criteria

After Phase 1:
- `ls services/` shows only `runtime/` and `magic-link/`
- `ls src/` shows only `db/` and `product/`
- `npm run test:ops:runtime-hardening-gate` passes
- `npm run type-check` passes (on converted files)
- `npm run lint` passes
- No file in the repo references `worker-builder`, `agentverse`, `x402-gateway`, `finance-sink`, `receiver`, or `managed-specialists`
- README describes the website product, not a multi-surface platform
- New developer opening the repo understands what it is in 30 seconds
