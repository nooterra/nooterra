/**
 * Environment Configuration
 * 
 * Centralized configuration management for the coordinator service.
 * All environment variables are read and validated here.
 */

import dotenv from 'dotenv';

// Load .env file
dotenv.config();

/** 
 * Environment mode
 */
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const IS_DEVELOPMENT = NODE_ENV === 'development';

/**
 * Server configuration
 */
export const PORT = parseInt(process.env.PORT || '3002', 10);
export const HOST = process.env.HOST || '0.0.0.0';

/**
 * Database
 */
export const POSTGRES_URL = process.env.POSTGRES_URL || 'postgres://postgres:postgres@localhost:5432/nooterra';

/**
 * Redis (optional)
 */
export const REDIS_URL = process.env.REDIS_URL || '';

/**
 * JWT Authentication
 */
export const JWT_SECRET = process.env.JWT_SECRET || 'nooterra-dev-secret-DO-NOT-USE-IN-PROD';
export const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
export const JWT_REFRESH_EXPIRES_DAYS = parseInt(process.env.JWT_REFRESH_EXPIRES_DAYS || '30', 10);

if (IS_PRODUCTION && !process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET must be set in production');
    process.exit(1);
}

/**
 * API Keys
 */
export const COORDINATOR_API_KEY = process.env.COORDINATOR_API_KEY;
export const REGISTRY_URL = process.env.REGISTRY_URL || '';
export const REGISTRY_API_KEY = process.env.REGISTRY_API_KEY || '';

/**
 * Rate Limiting
 */
export const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '60', 10);
export const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);

/**
 * Workflow Limits
 */
export const MAX_SPEND_PER_WORKFLOW_CENTS = parseInt(process.env.MAX_SPEND_PER_WORKFLOW_CENTS || '10000', 10);
export const MAX_CONCURRENT_WORKFLOWS = parseInt(process.env.MAX_CONCURRENT_WORKFLOWS || '10', 10);
export const DEFAULT_WORKFLOW_TIMEOUT_MS = parseInt(process.env.DEFAULT_WORKFLOW_TIMEOUT_MS || '300000', 10);

/**
 * Agent Configuration
 */
export const AGENT_TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || '30000', 10);
export const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000', 10);
export const AGENT_HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.AGENT_HEALTH_CHECK_INTERVAL_MS || '60000', 10);

/**
 * OAuth Configuration
 */
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
export const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002';

/**
 * Coordinator Identity
 */
export const COORDINATOR_DID = process.env.COORDINATOR_DID || 'did:noot:coordinator:local';
export const COORDINATOR_PRIVATE_KEY_B58 = process.env.COORDINATOR_PRIVATE_KEY_B58;

/**
 * Observability
 */
export const SENTRY_DSN = process.env.SENTRY_DSN;
export const OTEL_EXPORTER_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

/**
 * CORS
 */
export const CORS_WHITELIST = (process.env.CORS_WHITELIST || '*').split(',').map(s => s.trim());

/**
 * Validation timeout for schema checks
 */
export const VALIDATION_TIMEOUT_MS = parseInt(process.env.VALIDATION_TIMEOUT_MS || '2000', 10);

/**
 * Feature flags
 */
export const ENABLE_REDUNDANCY = process.env.ENABLE_REDUNDANCY === 'true';
export const ENABLE_AUCTIONS = process.env.ENABLE_AUCTIONS !== 'false'; // Enabled by default

/**
 * Export all config as object for convenience
 */
export const config = {
    env: NODE_ENV,
    isProduction: IS_PRODUCTION,
    port: PORT,
    host: HOST,
    database: {
        url: POSTGRES_URL,
    },
    redis: {
        url: REDIS_URL,
    },
    jwt: {
        secret: JWT_SECRET,
        accessExpiresIn: JWT_ACCESS_EXPIRES_IN,
        refreshExpiresDays: JWT_REFRESH_EXPIRES_DAYS,
    },
    rateLimit: {
        max: RATE_LIMIT_MAX,
        windowMs: RATE_LIMIT_WINDOW_MS,
    },
    workflow: {
        maxSpendCents: MAX_SPEND_PER_WORKFLOW_CENTS,
        maxConcurrent: MAX_CONCURRENT_WORKFLOWS,
        defaultTimeoutMs: DEFAULT_WORKFLOW_TIMEOUT_MS,
    },
    agent: {
        timeoutMs: AGENT_TIMEOUT_MS,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        healthCheckIntervalMs: AGENT_HEALTH_CHECK_INTERVAL_MS,
    },
    oauth: {
        google: {
            clientId: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
        },
        frontendUrl: FRONTEND_URL,
        backendUrl: BACKEND_URL,
    },
    coordinator: {
        did: COORDINATOR_DID,
        privateKeyB58: COORDINATOR_PRIVATE_KEY_B58,
    },
    observability: {
        sentryDsn: SENTRY_DSN,
        otelEndpoint: OTEL_EXPORTER_ENDPOINT,
    },
    cors: {
        whitelist: CORS_WHITELIST,
    },
} as const;

export default config;
