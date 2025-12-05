## Setup
- `pnpm install` – install dependencies for monorepo.
- `pnpm dev` – run all dev tasks via turbo; or per app: `pnpm --filter @nooterra/coordinator dev`, `pnpm --filter @nooterra/registry dev`, `pnpm --filter @nooterra/console dev`, `pnpm --filter @nooterra/sandbox-runner dev`.

## Build/Type/Lint/Test
- `pnpm build` – turbo build across packages/apps.
- `pnpm type-check` – turbo type-check.
- `pnpm lint` – turbo lint (prettier via lint-staged on commit).
- `pnpm test` – turbo test (vitest in coordinator; sandbox-runner tests minimal).

## Coordinator-specific
- From `apps/coordinator`: `pnpm db:generate | db:migrate | db:push` (Drizzle); `pnpm dev` or `pnpm dev:dispatcher`; `pnpm test` for vitest.
- Env examples: copy `.env.example`; Railway deploy via `railway up` using `railway.toml` / `railway.dispatcher.toml`.

## Registry-specific
- From `apps/registry`: `pnpm dev`; env from `.env.example`; requires Postgres + Qdrant (docker compose suggested in README).

## Sandbox Runner
- From `apps/sandbox-runner`: `pnpm dev` or `pnpm start` after `pnpm build`.

## Console (frontend)
- From `apps/console`: `pnpm dev` (Vite), `pnpm build`, `pnpm preview`; set `VITE_COORD_URL`, `VITE_REGISTRY_URL`, optional wallet/env keys.

## CLI/Scaffolding
- `pnpm --filter @nooterra/cli dev` to run CLI; `nooterra init` scaffold agent; `nooterra wallet connect/balance/withdraw`; `nooterra deploy`.
- `npx create-nooterra-agent` for quick scaffolds (python/node/docker/rust templates).

## Docs
- mkdocs project under `docs/`; build with mkdocs (deps in docs/.venv not tracked). Frontend landing uses Vercel config.

## Infra scripts
- `cd infra/scripts && npm install && npm run e2e` (requires REGISTRY_URL/COORD_URL/API keys). Other scripts register HF models/verifier agents.
