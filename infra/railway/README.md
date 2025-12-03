# Nooterra Railway Infrastructure

This directory contains Infrastructure-as-Code (IaC) for deploying Nooterra to Railway.

## Quick Reference

| Service | ID | Domain |
|---------|-----|--------|
| Coordinator | `fd80cb66-9426-446c-be47-ab701ee55774` | coord.nooterra.ai |
| Dispatcher | `6bb2cae7-690e-47e9-bbe4-a51469181dfd` | (worker) |
| Registry | `39321649-d731-4899-acaa-357a6363e7df` | api.nooterra.ai |
| Postgres | `aac4558c-b0e6-454e-b002-ced596e29839` | - |
| Redis | `f5003310-3dc4-4ceb-8da0-51eb45aa2fcd` | - |
| Qdrant | `d84fb78c-c4a2-4155-9cdb-c7e125510f77` | - |

**Project ID:** `702535a1-2f78-458b-8a4f-18bbeb8459b5`  
**Environment ID:** `6198ea01-2f84-4cfd-a976-9ee4121fa1b9`

## Quick Start

```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login to Railway
railway login

# 3. Set environment variables (first time only)
./set-vars.sh all

# 4. Set JWT_SECRET manually (sensitive)
railway variables set JWT_SECRET=$(openssl rand -base64 32) \
  --project=702535a1-2f78-458b-8a4f-18bbeb8459b5 \
  --environment=6198ea01-2f84-4cfd-a976-9ee4121fa1b9 \
  --service=fd80cb66-9426-446c-be47-ab701ee55774

# 5. Deploy everything
./deploy-all.sh

# 6. Run migrations
./migrate.sh
```

## Scripts

| Script | Description |
|--------|-------------|
| `deploy-all.sh` | Deploy all services to Railway |
| `deploy-all.sh coordinator` | Deploy single service |
| `deploy-all.sh --migrate` | Run migrations before deploy |
| `deploy-all.sh --health` | Check service health endpoints |
| `set-vars.sh all` | Set all environment variables |
| `set-vars.sh coordinator` | Set coordinator variables only |
| `ssh.sh coordinator` | SSH into coordinator service |
| `ssh.sh postgres` | SSH into postgres service |
| `migrate.sh` | Push Drizzle schema to database |
| `migrate.sh generate` | Generate new migration file |
| `migrate.sh studio` | Open Drizzle Studio |

## Service Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Railway Project                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │   coordinator    │    │    dispatcher    │                   │
│  │  coord.nooterra  │    │    (worker)      │                   │
│  │     .ai          │    │                  │                   │
│  └────────┬─────────┘    └────────┬─────────┘                   │
│           │                       │                              │
│           └───────────┬───────────┘                              │
│                       │                                          │
│  ┌────────────────────┼────────────────────┐                    │
│  │                    ▼                    │                    │
│  │    ┌──────────┐  ┌──────────┐          │                    │
│  │    │ Postgres │  │  Redis   │          │                    │
│  │    └──────────┘  └──────────┘          │                    │
│  │           Databases                     │                    │
│  └─────────────────────────────────────────┘                    │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │    registry      │    │  sandbox-runner  │                   │
│  │  api.nooterra    │    │   (isolated)     │                   │
│  │     .ai          │    │                  │                   │
│  └────────┬─────────┘    └──────────────────┘                   │
│           │                                                      │
│           ▼                                                      │
│  ┌──────────────────┐                                           │
│  │     qdrant       │                                           │
│  │  (vector db)     │                                           │
│  └──────────────────┘                                           │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                     Agent Services                          ││
│  │  agent-echo  agent-weather  agent-customs  agent-rail  ...  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Environment Variables

See `env-template.txt` for all required environment variables.

**Key variables:**
- `DATABASE_URL` - PostgreSQL connection (auto-set by Railway)
- `REDIS_URL` - Redis for dispatch queue
- `JWT_SECRET` - Auth token signing key
- `CORS_WHITELIST` - Allowed frontend origins

## Railway Configuration Files

Each service has a `railway.toml` in its directory:

| Service | Config File | Health Check |
|---------|-------------|--------------|
| Coordinator | `apps/coordinator/railway.toml` | `/health` |
| Dispatcher | `apps/coordinator/railway.dispatcher.toml` | N/A (worker) |
| Registry | `apps/registry/railway.toml` | `/health` |
| Sandbox Runner | `apps/sandbox-runner/railway.toml` | `/health` |

## Deployment Order

For first-time setup, deploy in this order:

1. **Databases** (Postgres, Redis, Qdrant) - Create via Railway Dashboard
2. **Coordinator** - Core API, depends on Postgres
3. **Dispatcher** - Worker, depends on Postgres + Redis
4. **Registry** - Agent registry, depends on Postgres + Qdrant
5. **Agents** - Individual agent services

## Troubleshooting

### "Railway CLI not found"
```bash
npm install -g @railway/cli
```

### "Not logged in"
```bash
railway login
```

### "No project linked"
```bash
railway link
# Select your project from the list
```

### View logs
```bash
railway logs --service nooterra-coordinator
railway logs --service nooterra-dispatcher
```

### SSH into container
```bash
railway shell --service nooterra-coordinator
```

## GitHub Actions Integration

The `.github/workflows/railway-deploy.yml` workflow automatically deploys on push to `main`.

To set up:
1. Go to Railway Dashboard > Account Settings > Tokens
2. Create a new token
3. Add as GitHub secret: `RAILWAY_TOKEN`
4. Add project ID as secret: `RAILWAY_PROJECT_ID`
