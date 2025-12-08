/**
 * Rate Limiter Module
 * 
 * NIP-004 Implementation: Rate Limit Tiers
 * 
 * Token bucket algorithm with tier-based configuration.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from './config.js';

/**
 * Rate limit configuration per tier
 */
export interface RateLimitTier {
    tier: 'free' | 'pro' | 'enterprise';
    requestsPerMinute: number;
    burstSize: number;
    maxConcurrentWorkflows: number;
    dailyLimit: number;
}

/**
 * Predefined tier configurations
 */
export const TIER_CONFIGS: Record<string, RateLimitTier> = {
    free: {
        tier: 'free',
        requestsPerMinute: 60,
        burstSize: 10,
        maxConcurrentWorkflows: 5,
        dailyLimit: 1000,
    },
    pro: {
        tier: 'pro',
        requestsPerMinute: 300,
        burstSize: 50,
        maxConcurrentWorkflows: 50,
        dailyLimit: 50000,
    },
    enterprise: {
        tier: 'enterprise',
        requestsPerMinute: 1000,
        burstSize: 200,
        maxConcurrentWorkflows: Infinity,
        dailyLimit: Infinity,
    },
};

/**
 * Token bucket for rate limiting
 */
export class TokenBucket {
    private tokens: number;
    private lastRefill: number;
    private readonly capacity: number;
    private readonly refillRate: number; // tokens per millisecond

    constructor(capacity: number, refillPerMinute: number) {
        this.capacity = capacity;
        this.tokens = capacity;
        this.refillRate = refillPerMinute / 60000;
        this.lastRefill = Date.now();
    }

    /**
     * Try to consume tokens from the bucket
     */
    tryConsume(count: number = 1): boolean {
        this.refill();
        if (this.tokens >= count) {
            this.tokens -= count;
            return true;
        }
        return false;
    }

    /**
     * Get current token count
     */
    getTokenCount(): number {
        this.refill();
        return Math.floor(this.tokens);
    }

    /**
     * Get time until bucket has at least one token
     */
    getRetryAfterMs(): number {
        this.refill();
        if (this.tokens >= 1) return 0;
        return Math.ceil((1 - this.tokens) / this.refillRate);
    }

    private refill(): void {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
        this.lastRefill = now;
    }
}

/**
 * In-memory rate limit store
 * Key: IP address or project ID
 */
const rateLimitBuckets = new Map<string, TokenBucket>();

/**
 * Get or create a token bucket for a key
 */
function getBucket(key: string, tier: RateLimitTier = TIER_CONFIGS.free): TokenBucket {
    let bucket = rateLimitBuckets.get(key);
    if (!bucket) {
        bucket = new TokenBucket(tier.burstSize, tier.requestsPerMinute);
        rateLimitBuckets.set(key, bucket);
    }
    return bucket;
}

/**
 * Clean up old buckets periodically (every 5 minutes)
 */
setInterval(() => {
    const now = Date.now();
    const cutoff = now - 5 * 60 * 1000; // 5 minutes

    for (const [key, bucket] of rateLimitBuckets.entries()) {
        // Remove buckets that are full and haven't been used recently
        if (bucket.getTokenCount() >= RATE_LIMIT_MAX) {
            rateLimitBuckets.delete(key);
        }
    }
}, 5 * 60 * 1000);

/**
 * Get client identifier (IP or project ID)
 */
function getClientKey(request: FastifyRequest): string {
    // Prefer project ID if authenticated
    const auth = (request as any).auth;
    if (auth?.projectId) {
        return `project:${auth.projectId}`;
    }

    // Fall back to IP
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
        const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
        return `ip:${ip.trim()}`;
    }

    return `ip:${request.ip}`;
}

/**
 * Get tier for a request
 */
function getTier(request: FastifyRequest): RateLimitTier {
    const auth = (request as any).auth;

    // Super users get enterprise tier
    if (auth?.isSuper) {
        return TIER_CONFIGS.enterprise;
    }

    // Check project tier (would need to query DB in production)
    // For now, default to free
    return TIER_CONFIGS.free;
}

/**
 * Create rate limit middleware
 */
export function createRateLimitGuard() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const key = getClientKey(request);
        const tier = getTier(request);
        const bucket = getBucket(key, tier);

        // Add rate limit headers
        const limit = tier.requestsPerMinute;
        const remaining = bucket.getTokenCount();
        const reset = Math.floor(Date.now() / 1000) + 60;

        reply.header('X-RateLimit-Limit', limit);
        reply.header('X-RateLimit-Remaining', Math.max(0, remaining - 1));
        reply.header('X-RateLimit-Reset', reset);
        reply.header('X-RateLimit-Tier', tier.tier);

        // Try to consume a token
        if (!bucket.tryConsume()) {
            const retryAfter = Math.ceil(bucket.getRetryAfterMs() / 1000);

            reply.header('Retry-After', retryAfter);

            return reply.status(429).send({
                error: 'rate_limited',
                message: 'Too many requests',
                limit,
                remaining: 0,
                reset,
                tier: tier.tier,
                retryAfterSeconds: retryAfter,
            });
        }
    };
}

/**
 * Simple legacy rate limit guard (for backwards compatibility)
 */
export function createSimpleRateLimitGuard(maxRequests = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS) {
    const requests = new Map<string, number[]>();

    return async (request: FastifyRequest, reply: FastifyReply) => {
        const key = getClientKey(request);
        const now = Date.now();
        const windowStart = now - windowMs;

        // Get timestamps, filter to window
        let timestamps = requests.get(key) || [];
        timestamps = timestamps.filter(t => t > windowStart);

        if (timestamps.length >= maxRequests) {
            const oldestInWindow = timestamps[0];
            const retryAfter = Math.ceil((oldestInWindow + windowMs - now) / 1000);

            reply.header('Retry-After', retryAfter);
            reply.header('X-RateLimit-Limit', maxRequests);
            reply.header('X-RateLimit-Remaining', 0);

            return reply.status(429).send({
                error: 'rate_limited',
                message: 'Too many requests',
                retryAfterSeconds: retryAfter,
            });
        }

        // Add current request
        timestamps.push(now);
        requests.set(key, timestamps);

        // Set headers
        reply.header('X-RateLimit-Limit', maxRequests);
        reply.header('X-RateLimit-Remaining', maxRequests - timestamps.length);
    };
}

export default createRateLimitGuard;
