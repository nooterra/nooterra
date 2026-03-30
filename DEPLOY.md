# Nooterra Production Deployment Guide

## Architecture

```
Vercel (app.nooterra.ai)          — React dashboard, static files
  └── rewrites /__nooterra/* →
Railway: nooterra-scheduler       — Worker execution, API, billing
Railway: nooterra-magic-link      — Magic link authentication
Railway: PostgreSQL add-on        — Database
Railway: Redis add-on             — Rate limiting (optional)
```

## Railway Services

### Service 1: `nooterra-scheduler` (main backend)

**Start command:** `npm run start:scheduler`

**Required env vars:**
```bash
# Database (use Railway's Postgres add-on — it sets DATABASE_URL automatically)
DATABASE_URL=              # Auto-set by Railway Postgres add-on

# LLM Provider — workers need this to call AI models
OPENROUTER_API_KEY=        # Get from https://openrouter.ai/keys

# Server
PORT=8080                  # Railway sets this automatically
NODE_ENV=production
```

**Recommended env vars:**
```bash
# Stripe billing (skip if not charging yet)
STRIPE_SECRET_KEY=         # https://dashboard.stripe.com/apikeys
STRIPE_WEBHOOK_SECRET=     # Stripe webhook signing secret

# Composio (SaaS tool integrations — Gmail, Slack, GitHub, etc.)
COMPOSIO_API_KEY=          # https://composio.dev
FRONTEND_URL=https://app.nooterra.ai

# Email (daily reports, notifications)
RESEND_API_KEY=            # https://resend.com
RESEND_FROM=workers@nooterra.ai

# Web search for workers
BRAVE_SEARCH_API_KEY=      # https://brave.com/search/api/

# Error tracking
SENTRY_DSN=                # https://sentry.io

# Dashboard URL for notification links
DASHBOARD_URL=https://app.nooterra.ai
```

**Optional env vars:**
```bash
# Twilio (only if workers need SMS/calls)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Performance tuning
MAX_CONCURRENT=5           # Max parallel worker executions
POLL_INTERVAL_MS=10000     # How often to check for due workers
EXECUTION_COST_CAP=0.50    # Max $ per single execution
PG_POOL_MAX=10             # Database connection pool size
```

### Service 2: `nooterra-magic-link` (auth)

**Start command:** `npm run start:magic-link`

**Required env vars:**
```bash
DATABASE_URL=              # Same Postgres as scheduler (share the add-on)
PORT=8080
NODE_ENV=production
```

### Vercel (dashboard)

**Build command:** `npm --prefix dashboard run build`
**Output directory:** `dashboard/dist`

**Environment variables:**
```bash
# If using Auth0 (recommended):
VITE_AUTH0_DOMAIN=         # yourcompany.auth0.com
VITE_AUTH0_CLIENT_ID=      # Auth0 SPA client ID

# If using magic link auth:
VITE_NOOTERRA_AUTH_BASE_URL=https://nooterra-magic-link-production.up.railway.app

# Analytics (optional)
VITE_POSTHOG_KEY=          # https://posthog.com
```

## Setup Steps (in order)

### 1. Railway setup (10 min)
1. Create new Railway project
2. Add **PostgreSQL** add-on (gives you DATABASE_URL)
3. Create service from GitHub repo → set start command to `npm run start:scheduler`
4. Set env vars listed above (minimum: OPENROUTER_API_KEY)
5. Deploy

### 2. Verify the backend works
```bash
curl https://nooterra-scheduler-production.up.railway.app/health
# Should return: {"ok":true}

curl https://nooterra-scheduler-production.up.railway.app/healthz
# Should return: {"status":"healthy","db":{"ok":true,...}}
```

### 3. Database migrations
Migrations run automatically on first boot (`PROXY_MIGRATE_ON_STARTUP` defaults to `true`).

### 4. Vercel setup (5 min)
1. Import GitHub repo to Vercel
2. Set root directory to `.` (not `dashboard`)
3. Framework preset: Vite
4. Set env vars (VITE_AUTH0_DOMAIN, etc.)
5. Deploy

### 5. Create first tenant
```bash
# Set an ops token in Railway env vars:
# PROXY_OPS_TOKENS=your_secret_token_here

# Then create a tenant:
curl -X POST https://nooterra-scheduler-production.up.railway.app/v1/ops/tenants \
  -H "X-Proxy-Ops-Token: your_secret_token_here" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Company"}'
```

### 6. Connect Stripe (when ready to charge)
1. Create Stripe account
2. Create 3 products (Starter, Growth, Enterprise) with monthly prices
3. Set `STRIPE_SECRET_KEY` and price IDs in Railway
4. Add webhook endpoint: `https://nooterra-scheduler-production.up.railway.app/v1/billing/webhook`
5. Set `STRIPE_WEBHOOK_SECRET` from the webhook config

## What breaks without each service

| Missing | Impact |
|---------|--------|
| OPENROUTER_API_KEY | Workers can't call AI models (unless using BYOK) |
| COMPOSIO_API_KEY | No SaaS tool integrations (Gmail, Slack, etc.) |
| STRIPE keys | No billing — users can use platform for free |
| RESEND_API_KEY | No email notifications or daily reports |
| BRAVE_SEARCH_API_KEY | Workers can't search the web (falls back to DuckDuckGo) |
| TWILIO keys | Workers can't SMS or call (other tools still work) |
| SENTRY_DSN | No error tracking (errors still logged to stdout) |
| Redis | Rate limiting is per-process only (fine for single instance) |

## Scaling

Railway auto-scales, but if you need to tune:

- **More workers running at once:** Increase `MAX_CONCURRENT` (default 5)
- **More API throughput:** Add Redis for distributed rate limiting
- **Database performance:** Railway Postgres scales vertically; add `PG_POOL_MAX` if needed
- **When to add Kubernetes:** When you need 10+ service replicas or custom autoscaling policies. Not before.
