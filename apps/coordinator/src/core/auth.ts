/**
 * Authentication Module
 * 
 * JWT verification and token generation for the coordinator.
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../db.js';
import { JWT_SECRET, JWT_ACCESS_EXPIRES_IN, JWT_REFRESH_EXPIRES_DAYS } from './config.js';
import { parseLegacyScopes, AuthContext, ApiKeyScope } from './scope-enforcement.js';

/**
 * JWT Payload structure
 */
export interface JWTPayload {
    sub: string;           // User ID
    email: string;
    projectId?: string;
    role?: string;
    iat?: number;
    exp?: number;
}

/**
 * Generate access token (short-lived)
 */
export function generateAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRES_IN });
}

/**
 * Generate refresh token (long-lived, stored hashed in DB)
 */
export async function generateRefreshToken(userId: number): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + JWT_REFRESH_EXPIRES_DAYS);

    await pool.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) 
     VALUES ($1, $2, $3)`,
        [userId, tokenHash, expiresAt]
    );

    return token;
}

/**
 * Verify and decode access token
 */
export function verifyAccessToken(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, JWT_SECRET) as JWTPayload;
    } catch {
        return null;
    }
}

/**
 * Verify refresh token and get user
 */
export async function verifyRefreshToken(token: string): Promise<{ userId: number; email: string } | null> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const result = await pool.query(
        `SELECT rt.user_id, u.email 
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1 
       AND rt.expires_at > NOW()
       AND rt.revoked_at IS NULL`,
        [tokenHash]
    );

    if (result.rows.length === 0) return null;

    return {
        userId: result.rows[0].user_id,
        email: result.rows[0].email,
    };
}

/**
 * Revoke refresh token
 */
export async function revokeRefreshToken(token: string): Promise<boolean> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const result = await pool.query(
        `UPDATE refresh_tokens 
     SET revoked_at = NOW() 
     WHERE token_hash = $1 AND revoked_at IS NULL`,
        [tokenHash]
    );

    return (result.rowCount ?? 0) > 0;
}

/**
 * Revoke all refresh tokens for a user
 */
export async function revokeAllUserTokens(userId: number): Promise<number> {
    const result = await pool.query(
        `UPDATE refresh_tokens 
     SET revoked_at = NOW() 
     WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId]
    );

    return result.rowCount ?? 0;
}

/**
 * Rotate refresh token (revoke old, issue new)
 */
export async function rotateRefreshToken(oldToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
    const user = await verifyRefreshToken(oldToken);
    if (!user) return null;

    // Revoke old token
    await revokeRefreshToken(oldToken);

    // Generate new tokens
    const accessToken = generateAccessToken({
        sub: String(user.userId),
        email: user.email,
    });

    const refreshToken = await generateRefreshToken(user.userId);

    return { accessToken, refreshToken };
}

/**
 * Validate API key and return auth context
 */
export async function validateApiKey(apiKey: string): Promise<AuthContext | null> {
    // Check for super key
    const superKey = process.env.COORDINATOR_API_KEY;
    if (superKey && superKey !== 'none' && apiKey === superKey) {
        return { isSuper: true, projectId: null };
    }

    // Check for playground key
    if (apiKey === 'playground') {
        return { isSuper: false, projectId: null, isPlayground: true };
    }

    // Query database for API key
    try {
        const result = await pool.query(
            `SELECT ak.id, ak.project_id, ak.scopes, ak.expires_at, p.owner_user_id, p.payer_did
       FROM api_keys ak
       JOIN projects p ON p.id = ak.project_id
       WHERE ak.key = $1 AND ak.deleted_at IS NULL`,
            [apiKey]
        );

        if (result.rows.length === 0) return null;

        const key = result.rows[0];

        // Check expiration
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
            return null;
        }

        // Update last_used_at
        await pool.query(
            'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
            [key.id]
        ).catch(() => { }); // Non-blocking

        // Parse scopes
        const scopes = parseLegacyScopes(key.scopes);

        return {
            isSuper: false,
            projectId: key.project_id,
            scopes,
            payerDid: key.payer_did,
        };
    } catch {
        return null;
    }
}

/**
 * Extract token from Authorization header
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
    if (!authHeader) return null;

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
        return null;
    }

    return parts[1];
}

/**
 * Create API key guard middleware
 * 
 * Validates API key from x-api-key header or Bearer token
 * Attaches auth context to request
 */
export function createApiGuard() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        // Try x-api-key header first
        let apiKey = request.headers['x-api-key'] as string | undefined;

        // Fall back to Bearer token
        if (!apiKey) {
            apiKey = extractBearerToken(request.headers.authorization) ?? undefined;
        }

        if (!apiKey) {
            return reply.status(401).send({
                error: 'unauthorized',
                message: 'Missing API key'
            });
        }

        const auth = await validateApiKey(apiKey);

        if (!auth) {
            return reply.status(401).send({
                error: 'unauthorized',
                message: 'Invalid API key'
            });
        }

        // Attach auth context
        (request as any).auth = auth;
    };
}

/**
 * Create JWT auth guard for browser sessions
 */
export function createJwtGuard() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const token = extractBearerToken(request.headers.authorization);

        if (!token) {
            return reply.status(401).send({
                error: 'unauthorized',
                message: 'Missing token'
            });
        }

        const payload = verifyAccessToken(token);

        if (!payload) {
            return reply.status(401).send({
                error: 'unauthorized',
                message: 'Invalid or expired token'
            });
        }

        // Attach user info
        (request as any).user = payload;
    };
}

export default {
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    revokeRefreshToken,
    rotateRefreshToken,
    validateApiKey,
    createApiGuard,
    createJwtGuard,
};
