# NIP-004: Rate Limit Tiers

| Field | Value |
|-------|-------|
| NIP | 004 |
| Title | Rate Limit Tiers |
| Author | Nooterra Team |
| Status | Draft |
| Created | 2025-12-07 |

## Abstract

Rate limits should be configurable per subscription tier, allowing different service levels for free, pro, and enterprise users.

## Specification

### Tier Definitions

| Tier | Requests/min | Burst | Concurrent Workflows | Daily Limit |
|------|--------------|-------|---------------------|-------------|
| Free | 60 | 10 | 5 | 1,000 |
| Pro | 300 | 50 | 50 | 50,000 |
| Enterprise | Custom | Custom | Unlimited | Unlimited |

### Configuration

```typescript
interface RateLimitConfig {
  tier: 'free' | 'pro' | 'enterprise';
  requestsPerMinute: number;
  burstSize: number;
  maxConcurrentWorkflows: number;
  dailyRequestLimit: number;
  customLimits?: {
    [resource: string]: number;  // e.g., "workflows.create": 100
  };
}

const TIER_CONFIGS: Record<string, RateLimitConfig> = {
  free: {
    tier: 'free',
    requestsPerMinute: 60,
    burstSize: 10,
    maxConcurrentWorkflows: 5,
    dailyRequestLimit: 1000,
  },
  pro: {
    tier: 'pro',
    requestsPerMinute: 300,
    burstSize: 50,
    maxConcurrentWorkflows: 50,
    dailyRequestLimit: 50000,
  },
  enterprise: {
    tier: 'enterprise',
    requestsPerMinute: 1000,
    burstSize: 200,
    maxConcurrentWorkflows: Infinity,
    dailyRequestLimit: Infinity,
  },
};
```

### Implementation: Token Bucket

```typescript
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per ms

  constructor(capacity: number, refillPerMinute: number) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillPerMinute / 60000;
    this.lastRefill = Date.now();
  }

  tryConsume(count: number = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}
```

### Response Headers

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 275
X-RateLimit-Reset: 1702012800
X-RateLimit-Tier: pro
```

### Rate Limited Response

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 45
Content-Type: application/json

{
  "error": "rate_limited",
  "message": "Rate limit exceeded",
  "limit": 300,
  "remaining": 0,
  "reset": 1702012800,
  "tier": "pro",
  "upgrade_url": "https://nooterra.ai/pricing"
}
```

### Database Schema

```sql
ALTER TABLE projects ADD COLUMN tier TEXT DEFAULT 'free';
ALTER TABLE projects ADD COLUMN custom_rate_limits JSONB;

CREATE TABLE rate_limit_usage (
  project_id UUID REFERENCES projects(id),
  window_start TIMESTAMPTZ NOT NULL,
  request_count INT DEFAULT 0,
  PRIMARY KEY (project_id, window_start)
);
```

## Copyright

Public domain.
