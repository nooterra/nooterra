# Nooterra Railway Infrastructure

This directory contains Infrastructure-as-Code (IaC) for deploying Nooterra to Railway.

## Quick Start

```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login to Railway
railway login

# 3. Link to your project (one-time)
railway link

# 4. Deploy everything
./deploy-all.sh

# 5. Run migrations
./migrate.sh
```

## Scripts

| Script | Description |
|--------|-------------|
| `deploy-all.sh` | Deploy all services to Railway |
| `deploy-all.sh coordinator` | Deploy single service |
| `deploy-all.sh --migrate` | Run migrations before deploy |
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
