# Nooterra Deployment Guide

This guide covers deploying the Nooterra platform to Railway (backend) and Vercel (frontend).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Vercel (Frontend)                         │
│               console.nooterra.ai                            │
│                                                              │
│   React + Vite + TailwindCSS                                │
│   - Agent Discovery                                          │
│   - Workflow Builder                                         │
│   - Metrics Dashboard                                        │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Railway (Backend)                          │
│                                                              │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  │
│  │     Coordinator         │  │      Registry           │  │
│  │   coord.nooterra.ai     │  │  registry.nooterra.ai   │  │
│  │                         │  │                         │  │
│  │ - Workflow Execution    │  │ - Agent Registration    │  │
│  │ - Fault Detection       │  │ - Capability Discovery  │  │
│  │ - Budget Management     │  │ - Health Tracking       │  │
│  │ - Auction System        │  │                         │  │
│  └─────────────────────────┘  └─────────────────────────┘  │
│               │                          │                   │
│               ▼                          ▼                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              PostgreSQL (Railway)                      │  │
│  │         Ledger, Workflows, Agents, Stakes             │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Railway Deployment

### Prerequisites

1. Install Railway CLI:
   ```bash
   npm install -g @railway/cli
   railway login
   ```

2. Create a new project in Railway dashboard

### Deploy Coordinator

```bash
cd apps/coordinator

# Link to Railway project
railway link

# Set environment variables
railway variables set \
  DATABASE_URL="postgresql://..." \
  JWT_SECRET="your-secret-key" \
  REGISTRY_URL="https://registry.nooterra.ai" \
  REGISTRY_API_KEY="your-api-key" \
  CORS_ORIGIN="https://console.nooterra.ai,https://www.nooterra.ai" \
  NODE_ENV="production" \
  RUN_DISPATCHER="true"

# Deploy
railway up
```

### Deploy Registry

```bash
cd apps/registry

# Link to Railway project (different service)
railway link

# Set environment variables
railway variables set \
  DATABASE_URL="postgresql://..." \
  JWT_SECRET="your-secret-key" \
  NODE_ENV="production"

# Deploy
railway up
```

### Environment Variables (Coordinator)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/nooterra` |
| `JWT_SECRET` | Secret for signing JWTs | `your-super-secret-key-min-32-chars` |
| `REGISTRY_URL` | Registry service URL | `https://registry.nooterra.ai` |
| `REGISTRY_API_KEY` | API key for registry | `rk_xxx` |
| `CORS_ORIGIN` | Allowed CORS origins | `https://console.nooterra.ai` |
| `RUN_DISPATCHER` | Enable dispatcher in-process | `true` |
| `ENABLE_AUCTIONS` | Enable auction system | `true` |
| `PROTOCOL_FEE_BPS` | Protocol fee in basis points | `30` (0.3%) |

## Vercel Deployment

### Prerequisites

1. Install Vercel CLI:
   ```bash
   npm install -g vercel
   vercel login
   ```

### Deploy Console

```bash
cd apps/console

# Link to Vercel project
vercel link

# Set environment variables
vercel env add VITE_COORD_URL production
# Enter: https://coord.nooterra.ai

vercel env add VITE_REGISTRY_URL production
# Enter: https://registry.nooterra.ai

# Deploy
vercel --prod
```

### Environment Variables (Console)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_COORD_URL` | Coordinator API URL | `https://coord.nooterra.ai` |
| `VITE_REGISTRY_URL` | Registry API URL | `https://registry.nooterra.ai` |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect project ID | `your-wc-project-id` |
| `VITE_TREASURY_ADDRESS` | Treasury wallet address | `0xb35b...` |

## Custom Domains

### Railway

1. Go to your service settings in Railway
2. Add custom domain: `coord.nooterra.ai`
3. Add CNAME record in your DNS

### Vercel

1. Go to your project settings in Vercel
2. Add custom domain: `console.nooterra.ai`
3. Add CNAME or A record in your DNS

## Monitoring

### Health Checks

```bash
# Coordinator health
curl https://coord.nooterra.ai/health

# Registry health
curl https://registry.nooterra.ai/health
```

### Metrics

```bash
# Prometheus format
curl https://coord.nooterra.ai/v1/metrics/prometheus

# JSON format
curl https://coord.nooterra.ai/v1/metrics
```

## Troubleshooting

### Build Failures

1. Ensure all dependencies are installed:
   ```bash
   pnpm install --frozen-lockfile
   ```

2. Check TypeScript compilation:
   ```bash
   pnpm build --filter=@nooterra/coordinator
   ```

### Database Issues

1. Run migrations:
   ```bash
   cd apps/coordinator
   pnpm db:migrate
   ```

2. Check connection:
   ```bash
   railway run psql $DATABASE_URL
   ```

### CORS Issues

Ensure `CORS_ORIGIN` includes all frontend domains:
```
CORS_ORIGIN=https://console.nooterra.ai,https://www.nooterra.ai
```
