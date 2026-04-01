# Phase 1: Clean Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip the repo to website-only (dashboard + runtime + auth), rename scheduler to runtime, begin TypeScript migration.

**Architecture:** Delete ~850 files / ~230K lines of dead code (CLI worker-builder, agentverse, old API, dead services). Rename `services/scheduler/` → `services/runtime/`. Add TypeScript with `allowJs: true` for incremental adoption, starting with core interface types.

**Tech Stack:** Node.js 20, TypeScript (type-checking only via `tsc --noEmit`), Postgres, React/Vite dashboard

---

## File Map

**Deleted directories (PR 1):**
- `scripts/worker-builder/` (51 files)
- `src/agentverse/` (58 files)
- `src/api/` (33 files)
- `src/core/` (all except `tracing.js` and `s3-presign.js` which move)
- `src/federation/` (3 files)
- `src/agent/` (1 file)
- `services/x402-gateway/` (4 files)
- `services/finance-sink/` (7 files)
- `services/receiver/` (7 files)
- `services/managed-specialists/` (2 files)
- `conformance/` (732 files)
- `test/agentverse/` (24 files)
- `bin/agentverse-cli.js`
- `test/sdk-quickstart-contract.test.js`
- `test/cli-agentverse-routing.test.js`

**Moved files (PR 1):**
- `src/core/tracing.js` → `services/scheduler/lib/tracing.js`
- `src/core/s3-presign.js` → `services/scheduler/lib/s3-presign.js`

**Renamed directory (PR 2):**
- `services/scheduler/` → `services/runtime/`

**Renamed test files (PR 2):**
- `test/scheduler-*.test.js` → `test/runtime-*.test.js` (18 files)

**Renamed script (PR 2):**
- `scripts/ci/run-scheduler-runtime-hardening-gate.mjs` → `scripts/ci/run-runtime-hardening-gate.mjs`

**New files (PR 3):**
- `tsconfig.json`
- `services/runtime/types.ts`

**Converted JS → TS (PR 3):**
- `services/runtime/state-machine.js` → `services/runtime/state-machine.ts`
- `services/runtime/learning-signals.js` → `services/runtime/learning-signals.ts`
- `services/runtime/verification-engine.js` → `services/runtime/verification-engine.ts`

**Rewritten (PR 4):**
- `README.md`
- `bin/nooterra.js`

---

## Task 1: Tag archive point and delete dead code

**Files:**
- Modify: `package.json`
- Delete: all directories listed in "Deleted directories" above
- Move: `src/core/tracing.js` → `services/scheduler/lib/tracing.js`
- Move: `src/core/s3-presign.js` → `services/scheduler/lib/s3-presign.js`
- Modify: `services/scheduler/server.js:17` (update tracing import)
- Modify: `services/scheduler/workers-api.js:13` (update s3-presign import)
- Modify: `services/scheduler/builtin-tools.js` (update dynamic s3-presign import)

- [ ] **Step 1: Create archive tag**

```bash
git tag archive/pre-prune-2026-03-31 main
```

- [ ] **Step 2: Create feature branch**

```bash
git checkout -b phase1/prune-dead-code
```

- [ ] **Step 3: Move the two core files the runtime needs**

```bash
mkdir -p services/scheduler/lib
git mv src/core/tracing.js services/scheduler/lib/tracing.js
git mv src/core/s3-presign.js services/scheduler/lib/s3-presign.js
```

- [ ] **Step 4: Update imports in server.js**

In `services/scheduler/server.js` line 17, change:
```javascript
// OLD
import { initTracing, withSpan, addSpanAttributes } from '../../src/core/tracing.js';
// NEW
import { initTracing, withSpan, addSpanAttributes } from './lib/tracing.js';
```

- [ ] **Step 5: Update imports in workers-api.js**

In `services/scheduler/workers-api.js` line 13, change:
```javascript
// OLD
import { presignS3Url } from '../../src/core/s3-presign.js';
// NEW
import { presignS3Url } from './lib/s3-presign.js';
```

- [ ] **Step 6: Update dynamic import in builtin-tools.js**

Search `services/scheduler/builtin-tools.js` for the dynamic import of s3-presign and update:
```javascript
// OLD
const { presignS3Url } = await import('../../src/core/s3-presign.js');
// NEW
const { presignS3Url } = await import('./lib/s3-presign.js');
```

- [ ] **Step 7: Delete dead directories**

```bash
rm -rf scripts/worker-builder
rm -rf src/agentverse
rm -rf src/api
rm -rf src/core
rm -rf src/federation
rm -rf src/agent
rm -rf services/x402-gateway
rm -rf services/finance-sink
rm -rf services/receiver
rm -rf services/managed-specialists
rm -rf conformance
rm -rf test/agentverse
rm -f bin/agentverse-cli.js
rm -f test/sdk-quickstart-contract.test.js
rm -f test/cli-agentverse-routing.test.js
```

- [ ] **Step 8: Strip package.json scripts**

Remove these script entries from `package.json`:

```
dev:api, start:prod, dev:maintenance, start:maintenance,
dev:finance-sink, start:finance-sink,
dev:managed-specialists, start:managed-specialists,
dev:receiver, start:receiver,
dev:x402-gateway, start:x402-gateway,
quickstart:x402, setup:circle, setup:openclaw,
setup:publish-managed-specialists, setup:seed-public-workers,
setup:seed-launch-specialists,
agent:sim,
demo:mcp-paid-exa, demo:mcp-paid-weather, demo:mcp-paid-llm,
demo:compositional-settlement,
pilot:finance-pack, finance:bundle,
proof:job, proof:month,
settlement:x402:batch,
provider:conformance, provider:publish, provider:keys:generate,
conformance:session:v1, conformance:session:v1:publish,
conformance:session-stream:v1, conformance:session-stream:v1:publish,
conformance:intent-negotiation:v1,
test:ops:agentverse-gate, test:ops:agentverse-live-e2e,
test:ops:managed-specialists-readiness-gate,
test:ops:agent-substrate-fast-loop,
test:ops:agent-substrate-adversarial-harness,
test:ops:agent-substrate-adversarial-harness:prompt-contagion,
test:ops:openclaw-substrate-demo,
test:ops:nooterra-verified-gate,
test:ops:nooterra-verified-revalidation,
test:ops:simulation-scorecard-gate,
test:ops:simulation-fault-matrix-gate,
test:ops:simulation-high-scale-harness,
test:ops:acs-e10-readiness-gate,
test:ops:self-host-topology-bundle-gate,
test:ops:self-host-upgrade-migration-gate,
test:ci:mcp-host-smoke,
test:ci:mcp-runtime-binding-fail-closed,
test:ci:mcp-host-cert-matrix,
test:ci:ns3-evidence-binding-coverage-matrix,
test:ci:openclaw-clawhub-install-smoke,
test:ci:public-openclaw-npx-smoke,
test:x402:circle:sandbox:batch-e2e,
test:x402:circle:sandbox:smoke,
ops:money-rails:reconcile:evidence,
ops:money-rails:chargeback:evidence,
ops:dispute:finance:packet,
ops:x402:pilot:weekly-report,
ops:x402:hitl:smoke,
ops:x402:receipt:sample-check,
ops:audit:lineage:verify,
ops:hosted-baseline:evidence,
sdk:acs-smoke, sdk:acs-smoke:py,
sdk:first-rfq:py,
publish:agentverse
```

- [ ] **Step 9: Strip package.json bins and exports**

Remove from `"bin"`:
```json
"agentverse": "bin/agentverse-cli.js"
```

Remove from `"exports"`:
```json
"./agentverse": "./src/agentverse/index.js",
"./agentverse/bridge": "./src/agentverse/bridge/index.js",
"./agentverse/bridge/*": "./src/agentverse/bridge/*.js"
```

Remove from `"files"` array:
```json
"conformance",
"services/managed-specialists",
"services/finance-sink",
"services/x402-gateway",
"services/receiver"
```

- [ ] **Step 10: Update lint script**

In `package.json`, update the lint:eslint script. Change:
```json
"lint:eslint": "eslint bin scripts src services test packages dashboard/src --cache --cache-location .cache/eslint"
```
To:
```json
"lint:eslint": "eslint bin services/scheduler services/magic-link src/db src/product test/scheduler-*.test.js dashboard/src --cache --cache-location .cache/eslint"
```

- [ ] **Step 11: Verify tests pass**

```bash
node --test test/scheduler-*.test.js
```

Expected: 95 tests pass (or close — some may reference deleted files)

- [ ] **Step 12: Verify lint passes**

```bash
npm run lint:eslint
```

Expected: clean, no errors

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: prune dead code — remove CLI worker-builder, agentverse, old API, dead services

Strip ~850 files / ~230K lines of code that are not part of the website product.
Archive tag: archive/pre-prune-2026-03-31

Removed:
- scripts/worker-builder/ (CLI runtime)
- src/agentverse/ (protocol layer)
- src/api/ (old API, superseded by scheduler)
- src/core/ (old shared code, except tracing + s3-presign moved to scheduler/lib/)
- src/federation/, src/agent/
- services/x402-gateway, finance-sink, receiver, managed-specialists
- conformance/ test suites
- test/agentverse/
- Dead package.json scripts, bins, exports"
```

---

## Task 2: Rename scheduler → runtime

**Files:**
- Rename: `services/scheduler/` → `services/runtime/`
- Rename: 18 test files `test/scheduler-*.test.js` → `test/runtime-*.test.js`
- Rename: `scripts/ci/run-scheduler-runtime-hardening-gate.mjs` → `scripts/ci/run-runtime-hardening-gate.mjs`
- Modify: `package.json` (script names)
- Modify: `.github/workflows/tests.yml` (job name + script reference)
- Modify: all 18 test files (import paths)
- Modify: `scripts/ci/run-runtime-hardening-gate.mjs` (internal paths + log messages)
- Modify: lint script in `package.json`

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b phase1/rename-runtime
```

- [ ] **Step 2: Rename the service directory**

```bash
git mv services/scheduler services/runtime
```

- [ ] **Step 3: Rename all 18 test files**

```bash
for f in test/scheduler-*.test.js; do
  git mv "$f" "test/runtime-${f#test/scheduler-}"
done
```

- [ ] **Step 4: Update import paths in all test files**

Run this sed across all renamed test files:
```bash
sed -i '' 's|../services/scheduler/|../services/runtime/|g' test/runtime-*.test.js
```

Verify with:
```bash
grep -r "services/scheduler" test/runtime-*.test.js
```
Expected: no matches

- [ ] **Step 5: Rename CI gate script**

```bash
git mv scripts/ci/run-scheduler-runtime-hardening-gate.mjs scripts/ci/run-runtime-hardening-gate.mjs
```

- [ ] **Step 6: Update CI gate script internals**

In `scripts/ci/run-runtime-hardening-gate.mjs`, update:
```javascript
// OLD
console.log("[scheduler-runtime-hardening] running scheduler test pack");
runShell("node --test test/scheduler-*.test.js");

console.log("[scheduler-runtime-hardening] running scheduler lint pack");
runShell("npx eslint services/scheduler/*.js test/scheduler-*.test.js");

console.log("[scheduler-runtime-hardening] gate passed");

// NEW
console.log("[runtime-hardening] running runtime test pack");
runShell("node --test test/runtime-*.test.js");

console.log("[runtime-hardening] running runtime lint pack");
runShell("npx eslint services/runtime/*.js test/runtime-*.test.js");

console.log("[runtime-hardening] gate passed");
```

- [ ] **Step 7: Update package.json scripts**

```json
// RENAME
"start:scheduler" → "start:runtime": "NODE_ENV=production node services/runtime/server.js"
"test:ops:scheduler-runtime-hardening-gate" → "test:ops:runtime-hardening-gate": "node scripts/ci/run-runtime-hardening-gate.mjs"

// ADD
"dev:runtime": "node services/runtime/server.js"

// UPDATE lint path
"lint:eslint": "eslint bin services/runtime services/magic-link src/db src/product test/runtime-*.test.js dashboard/src --cache --cache-location .cache/eslint"
```

- [ ] **Step 8: Update .github/workflows/tests.yml**

Change job name and script reference:
```yaml
# OLD
scheduler_runtime_hardening_gate:
  ...
  - name: Run scheduler runtime hardening gate
    run: npm run -s test:ops:scheduler-runtime-hardening-gate

# NEW
runtime_hardening_gate:
  ...
  - name: Run runtime hardening gate
    run: npm run -s test:ops:runtime-hardening-gate
```

- [ ] **Step 9: Verify tests pass at new paths**

```bash
node --test test/runtime-*.test.js
```

Expected: all tests pass

- [ ] **Step 10: Verify lint passes**

```bash
npm run lint:eslint
```

Expected: clean

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: rename services/scheduler → services/runtime

The service is an agent runtime, not a cron scheduler. Rename reflects
the architectural direction: event-driven, session-aware, intelligent.

- Renamed service directory
- Renamed 18 test files (scheduler-* → runtime-*)
- Updated CI gate script and workflow
- Updated all import paths and package.json scripts"
```

---

## Task 3: TypeScript setup and core interface types

**Files:**
- Create: `tsconfig.json`
- Create: `services/runtime/types.ts`
- Rename+Convert: `services/runtime/state-machine.js` → `services/runtime/state-machine.ts`
- Rename+Convert: `services/runtime/learning-signals.js` → `services/runtime/learning-signals.ts`
- Rename+Convert: `services/runtime/verification-engine.js` → `services/runtime/verification-engine.ts`
- Modify: `package.json` (add devDeps + type-check script)
- Modify: `.github/workflows/tests.yml` (add type-check step)
- Modify: `scripts/ci/run-runtime-hardening-gate.mjs` (add type-check)
- Modify: test files that import from converted modules (update `.js` → `.ts` extension if needed, or rely on extensionless imports)

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b phase1/typescript-setup
```

- [ ] **Step 2: Install TypeScript dependencies**

```bash
npm install --save-dev typescript @types/node @types/pg
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowJs": true,
    "checkJs": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": false,
    "outDir": "./dist",
    "rootDir": "."
  },
  "include": [
    "services/runtime/**/*.ts"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "dashboard"
  ]
}
```

- [ ] **Step 4: Create services/runtime/types.ts**

```typescript
/** Core domain types for the Nooterra agent runtime. */

// ── Worker ──────────────────────────────────────────────

export interface Worker {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  model: string;
  charter: Charter;
  status: 'active' | 'paused' | 'archived' | 'shadow';
  schedule: string | null;
  knowledge: KnowledgeEntry[] | null;
  provider_mode: 'platform' | 'openai' | 'anthropic' | 'byok';
  byok_provider: string | null;
  byok_api_key?: string;
  shadow?: boolean;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeEntry {
  title: string;
  content: string;
}

// ── Charter ─────────────────────────────────────────────

export interface Charter {
  canDo?: string[];
  askFirst?: string[];
  neverDo?: string[];
  task?: string;
  prompt?: string;
  tools?: ToolDefinition[];
  maxDailyRuns?: number;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
}

// ── Execution ───────────────────────────────────────────

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'rate_limited'
  | 'budget_exceeded'
  | 'billing_error'
  | 'awaiting_approval'
  | 'auto_paused'
  | 'timed_out'
  | 'cancelled'
  | 'shadow_completed';

export type ApprovalStatus =
  | 'none'
  | 'pending'
  | 'approved'
  | 'denied'
  | 'timed_out'
  | 'edited';

export interface Execution {
  id: string;
  worker_id: string;
  tenant_id: string;
  status: ExecutionStatus;
  approval_status: ApprovalStatus;
  trigger_type: string;
  started_at: string;
  completed_at: string | null;
  result: string | null;
  error: string | null;
  activity: ActivityEntry[];
  cost_usd: number | null;
  token_usage: TokenUsage | null;
  metadata: Record<string, unknown> | null;
}

export interface ActivityEntry {
  ts: string;
  type: string;
  detail: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ── Approval ────────────────────────────────────────────

export interface ApprovalRecord {
  id: string;
  execution_id: string;
  worker_id: string;
  tenant_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  status: ApprovalStatus;
  charter_verdict: 'canDo' | 'askFirst' | 'neverDo' | 'unknown';
  matched_rule: string | null;
  decided_at: string | null;
  decided_by: string | null;
}

// ── Verification ────────────────────────────────────────

export type AssertionType =
  | 'execution_metric'
  | 'response_content'
  | 'tool_call_required'
  | 'tool_call_absent'
  | 'duration_limit'
  | 'no_blocked_actions'
  | 'no_errors_in_log'
  | 'no_pending_approvals'
  | 'memory_key_set';

export interface VerificationAssertion {
  type: AssertionType;
  config: Record<string, unknown>;
}

export interface VerificationPlan {
  assertions: VerificationAssertion[];
  passCriteria: 'all_must_pass' | 'majority_pass';
}

export interface VerificationResult {
  type: AssertionType;
  passed: boolean;
  detail: string;
}

export interface VerificationReport {
  businessOutcome: 'passed' | 'partial' | 'failed' | 'inconclusive';
  assertions: VerificationResult[];
  passedCount: number;
  failedCount: number;
}

// ── Learning Signals ────────────────────────────────────

export interface LearningSignal {
  id: string;
  worker_id: string;
  tenant_id: string;
  execution_id: string;
  tool_name: string | null;
  tool_args_hash: string | null;
  charter_verdict: 'canDo' | 'askFirst' | 'neverDo' | 'unknown' | null;
  approval_decision: ApprovalStatus | null;
  execution_outcome: 'success' | 'blocked' | 'paused' | 'error' | null;
  matched_rule: string | null;
  error_message: string | null;
  created_at: string;
}

// ── Runtime Policy ──────────────────────────────────────

export interface RuntimePolicy {
  verification?: {
    lookbackHours?: number;
    failureThreshold?: number;
    autoPauseThreshold?: number;
  };
  approval?: {
    lookbackHours?: number;
    thrashThreshold?: number;
    autoPauseThreshold?: number;
  };
  sideEffects?: {
    lookbackHours?: number;
    failureThreshold?: number;
    cooldownMinutes?: number;
  };
  webhooks?: {
    lookbackHours?: number;
    deadLetterThreshold?: number;
    signatureFailureThreshold?: number;
  };
}
```

- [ ] **Step 5: Convert state-machine.js → state-machine.ts**

```bash
git mv services/runtime/state-machine.js services/runtime/state-machine.ts
```

Add type annotations to the file. The key changes:

At the top of the file, add:
```typescript
import type { ExecutionStatus, ApprovalStatus } from './types.js';
```

Type the exported constants and functions. The status arrays become `as const` assertions, and the transition maps get typed keys/values. Keep the existing logic exactly the same — only add types.

- [ ] **Step 6: Convert learning-signals.js → learning-signals.ts**

```bash
git mv services/runtime/learning-signals.js services/runtime/learning-signals.ts
```

Add type annotations. Import `LearningSignal` from `./types.js`. Type function parameters and return values.

- [ ] **Step 7: Convert verification-engine.js → verification-engine.ts**

```bash
git mv services/runtime/verification-engine.js services/runtime/verification-engine.ts
```

Add type annotations. Import `VerificationPlan`, `VerificationReport`, `VerificationResult`, `AssertionType` from `./types.js`. Type function parameters and return values.

- [ ] **Step 8: Update test imports for converted files**

In `test/runtime-state-machine.test.js`, update:
```javascript
// OLD
} from "../services/runtime/state-machine.js";
// NEW
} from "../services/runtime/state-machine.ts";
```

Do the same for `test/runtime-learning-signals.test.js` and `test/runtime-verification-engine.test.js`.

Note: Node.js 22+ with `--experimental-strip-types` handles `.ts` imports. If on Node 20, use `.js` extension and let TypeScript's `moduleResolution: NodeNext` resolve it. Test which works:
```bash
node --test test/runtime-state-machine.test.js
```

If `.ts` imports fail on Node 20, keep the `.js` extension in import paths (TypeScript resolves `.js` → `.ts` automatically with NodeNext).

- [ ] **Step 9: Add type-check script to package.json**

```json
"type-check": "tsc --noEmit"
```

- [ ] **Step 10: Add type-check to CI gate**

In `scripts/ci/run-runtime-hardening-gate.mjs`, add after the lint step:
```javascript
console.log("[runtime-hardening] running type check");
runShell("npx tsc --noEmit");
```

- [ ] **Step 11: Verify type-check passes**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 12: Verify tests pass**

```bash
node --test test/runtime-*.test.js
```

Expected: all tests pass

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: add TypeScript with core runtime interface types

- tsconfig.json with allowJs + strict + noEmit (type-checking only)
- services/runtime/types.ts: Worker, Execution, Charter, Approval,
  Verification, LearningSignal, RuntimePolicy interfaces
- Converted state-machine, learning-signals, verification-engine to .ts
- Added type-check to CI gate"
```

---

## Task 4: Rewrite README and strip CLI entry point

**Files:**
- Rewrite: `README.md`
- Modify: `bin/nooterra.js`

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b phase1/readme-cleanup
```

- [ ] **Step 2: Rewrite README.md**

Replace entire contents with:

```markdown
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.svg">
    <img alt="Nooterra" src=".github/assets/banner-dark.svg" width="480">
  </picture>
</p>

<h3 align="center">AI employees for your business</h3>

<p align="center">
  Governed, auditable, self-improving.<br>
  Every action is classified, every decision is traced, every tool call is enforced.
</p>

<p align="center">
  <a href="https://nooterra.ai/signup"><strong>Start free</strong></a> ·
  <a href="https://docs.nooterra.ai">Docs</a> ·
  <a href="https://discord.gg/nooterra">Discord</a>
</p>

---

## What Nooterra does

You create AI workers with permission rules. Each worker has a charter that defines what it **can do** autonomously, what it must **ask first** about, and what it can **never do**. Workers take real actions — sending emails, making payments, scheduling meetings — and the charter is enforced at the action layer, after the model generates intent but before any tool executes.

Workers learn from their own execution history. Approval patterns feed back into trust levels. The system gets smarter the more you use it.

## The permission model

| | What happens | Enforcement |
|---|---|---|
| **canDo** | Worker acts autonomously | Real-time charter match |
| **askFirst** | Worker pauses, routes to you with full context | Multi-channel approval (web, Slack) |
| **neverDo** | Hard-blocked, regardless of what the model says | Fail-closed, no override |

## Get started

Go to **[nooterra.ai](https://nooterra.ai)** → create a worker → define its charter → activate.

## Architecture

```
Dashboard (Vercel)  →  Agent Runtime (Railway)  →  Postgres
                       Magic Link Auth (Railway)
```

- **Dashboard**: React + Vite frontend. Worker management, approval inbox, execution traces.
- **Agent Runtime**: Node.js service. LLM orchestration, charter enforcement, tool execution, learning signals.
- **Magic Link Auth**: Email OTP + passkey authentication.

## Self-hosting

```bash
git clone https://github.com/nooterra/nooterra
cd nooterra
cp .env.dev.example .env.dev
docker compose up -d
npm ci
npm run dev:runtime
```

Requires: Node.js 20, Postgres, Redis (optional).

## Development

```bash
npm run dev:runtime       # Agent runtime (port 8080)
npm run dev:magic-link    # Auth service
cd dashboard && npm run dev  # Dashboard (Vite)
```

### Testing

```bash
node --test test/runtime-*.test.js    # Runtime tests
npm run type-check                     # TypeScript
npm run lint                           # ESLint
```

## License

[Apache-2.0](./LICENSE)
```

- [ ] **Step 3: Strip bin/nooterra.js to MCP-only**

Replace the entire file with:

```javascript
#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const args = process.argv.slice(2);

if (args[0] === "mcp") {
  const result = spawnSync("node", [path.join(root, "scripts/mcp/nooterra-mcp-server.mjs"), ...args.slice(1)], {
    stdio: "inherit",
    cwd: root,
  });
  process.exit(result.status ?? 1);
} else {
  console.log(`nooterra — AI employees for your business

Usage:
  nooterra mcp     Start the MCP server (for Claude Desktop / Cursor)

Web dashboard:  https://nooterra.ai
Docs:           https://docs.nooterra.ai`);
}
```

- [ ] **Step 4: Verify nothing is broken**

```bash
node --test test/runtime-*.test.js
npm run lint
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: rewrite README for website-only product

- Strip CLI-as-product and MCP-as-product framing
- Focus on web dashboard + agent runtime architecture
- Simplify bin/nooterra.js to MCP-only entry point"
```

---

## Verification Checklist

After all 4 tasks are merged:

- [ ] `ls services/` shows only `runtime/` and `magic-link/`
- [ ] `ls src/` shows only `db/` and `product/`
- [ ] `node --test test/runtime-*.test.js` — all pass
- [ ] `npx tsc --noEmit` — passes
- [ ] `npm run lint` — clean
- [ ] `grep -r "worker-builder\|agentverse\|x402-gateway\|finance-sink" services/ src/ test/ bin/` — no matches
- [ ] README describes website product only
