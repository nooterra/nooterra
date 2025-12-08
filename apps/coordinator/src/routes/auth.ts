/**
 * Authentication routes
 * Handles signup, login, and user info
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../db.js";

// Validation schemas
const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// JWT secret (validated at startup)
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET environment variable is required in production");
}
const JWT_SECRET_VALUE = JWT_SECRET || "nooterra-dev-secret-DO-NOT-USE-IN-PROD";

// Type for authenticated user
export interface AuthenticatedUser {
  id: number;
  email: string;
}

/**
 * Extract and verify user from JWT token in Authorization header
 */
export async function getUserFromRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthenticatedUser | null> {
  const header = (request.headers["authorization"] as string | undefined) || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";

  if (!token) {
    await reply.status(401).send({ error: "Unauthorized" });
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET_VALUE) as { userId: number; email: string };
    if (!decoded?.userId) {
      await reply.status(401).send({ error: "Unauthorized" });
      return null;
    }

    const res = await pool.query<{ id: number; email: string }>(
      `select id, email from users where id = $1`,
      [decoded.userId]
    );

    if (!res.rowCount) {
      await reply.status(401).send({ error: "Unauthorized" });
      return null;
    }

    return res.rows[0];
  } catch (err) {
    await reply.status(401).send({ error: "Unauthorized" });
    return null;
  }
}

/**
 * Register auth routes
 */
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {

  // Signup
  app.post("/auth/signup", async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.flatten(),
        message: "Invalid signup payload"
      });
    }

    const { email, password } = parsed.data;

    try {
      const hash = await bcrypt.hash(password, 10);
      const client = await pool.connect();

      try {
        await client.query("begin");

        const userRes = await client.query<{ id: number }>(
          `insert into users (email, password_hash) values ($1, $2) returning id`,
          [email.toLowerCase(), hash]
        );
        const userId = userRes.rows[0].id;

        // Create default project
        const payerDid = `did:noot:project:${uuidv4()}`;
        await client.query(
          `insert into projects (owner_user_id, name, payer_did) values ($1,$2,$3)`,
          [userId, "Default", payerDid]
        );

        // Create ledger account
        await client.query(
          `insert into ledger_accounts (owner_did, balance)
           values ($1, 0)
           on conflict (owner_did) do update set owner_did = excluded.owner_did`,
          [payerDid]
        );

        await client.query("commit");
      } catch (err: any) {
        await client.query("rollback");
        if (err.code === "23505") {
          return reply.status(409).send({ error: "Email already registered" });
        }
        throw err;
      } finally {
        client.release();
      }

      return reply.send({ ok: true });
    } catch (err: any) {
      app.log.error({ err }, "signup failed");
      return reply.status(500).send({ error: "signup_failed" });
    }
  });

  // Login
  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.flatten(),
        message: "Invalid login payload"
      });
    }

    const { email, password } = parsed.data;

    try {
      const res = await pool.query<{ id: number; email: string; password_hash: string }>(
        `select id, email, password_hash from users where email = $1`,
        [email.toLowerCase()]
      );

      if (!res.rowCount) {
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      const user = res.rows[0];
      const ok = await bcrypt.compare(password, user.password_hash);

      if (!ok) {
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      // Short-lived access token (15 minutes)
      const accessToken = jwt.sign(
        { userId: user.id, email: user.email, type: "access" },
        JWT_SECRET_VALUE,
        { expiresIn: "15m" }
      );

      // Long-lived refresh token (30 days)
      const refreshTokenValue = crypto.randomBytes(32).toString('hex');
      const refreshTokenHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      // Store refresh token in database
      await pool.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, refreshTokenHash, expiresAt]
      );

      return reply.send({
        token: accessToken, // Keep backwards compatibility
        accessToken,
        refreshToken: refreshTokenValue,
        expiresIn: 900, // 15 minutes in seconds
      });
    } catch (err: any) {
      app.log.error({ err }, "login failed");
      return reply.status(500).send({ error: "login_failed" });
    }
  });

  // Refresh token endpoint
  app.post("/auth/refresh", async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken?: string };

    if (!refreshToken) {
      return reply.status(400).send({ error: "refresh_token_required" });
    }

    try {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

      // Find valid refresh token
      const res = await pool.query<{ id: number; user_id: number; expires_at: Date }>(
        `SELECT id, user_id, expires_at FROM refresh_tokens 
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
        [tokenHash]
      );

      if (!res.rowCount) {
        return reply.status(401).send({ error: "invalid_refresh_token" });
      }

      const refreshRow = res.rows[0];

      // Get user
      const userRes = await pool.query<{ id: number; email: string }>(
        `SELECT id, email FROM users WHERE id = $1`,
        [refreshRow.user_id]
      );

      if (!userRes.rowCount) {
        return reply.status(401).send({ error: "user_not_found" });
      }

      const user = userRes.rows[0];

      // Token rotation: revoke old token and issue new one
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
        [refreshRow.id]
      );

      // Issue new access token
      const accessToken = jwt.sign(
        { userId: user.id, email: user.email, type: "access" },
        JWT_SECRET_VALUE,
        { expiresIn: "15m" }
      );

      // Issue new refresh token
      const newRefreshTokenValue = crypto.randomBytes(32).toString('hex');
      const newRefreshTokenHash = crypto.createHash('sha256').update(newRefreshTokenValue).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, newRefreshTokenHash, expiresAt]
      );

      return reply.send({
        accessToken,
        refreshToken: newRefreshTokenValue,
        expiresIn: 900,
      });
    } catch (err: any) {
      app.log.error({ err }, "refresh failed");
      return reply.status(500).send({ error: "refresh_failed" });
    }
  });

  // Logout - revoke refresh token
  app.post("/auth/logout", async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken?: string };

    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
        [tokenHash]
      );
    }

    return reply.send({ ok: true });
  });

  // Get current user info
  app.get("/auth/me", async (request, reply) => {
    const user = await getUserFromRequest(request, reply);
    if (!user) return;

    try {
      const projRes = await pool.query<{
        id: number;
        name: string;
        payer_did: string;
        created_at: Date
      }>(
        `select id, name, payer_did, created_at from projects 
         where owner_user_id = $1 order by created_at asc`,
        [user.id]
      );

      return reply.send({
        id: user.id,
        email: user.email,
        projects: projRes.rows.map((p) => ({
          id: p.id,
          name: p.name,
          payerDid: p.payer_did,
          createdAt: p.created_at,
        })),
      });
    } catch (err: any) {
      app.log.error({ err }, "auth/me failed");
      return reply.status(500).send({ error: "me_failed" });
    }
  });

  // =========================================================================
  // Google OAuth
  // =========================================================================

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
  const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3002";

  // Initiate Google OAuth
  app.get("/auth/google", async (request, reply) => {
    if (!GOOGLE_CLIENT_ID) {
      return reply.status(503).send({ error: "Google OAuth not configured" });
    }

    // Store intended role in state (dev/user/org)
    const { role } = request.query as { role?: string };
    const state = Buffer.from(JSON.stringify({
      role: role || "user",
      nonce: crypto.randomBytes(16).toString("hex"),
    })).toString("base64url");

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    url.searchParams.set("redirect_uri", `${BACKEND_URL}/auth/google/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");

    return reply.redirect(url.toString());
  });

  // Google OAuth Callback
  app.get("/auth/google/callback", async (request, reply) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return reply.redirect(`${FRONTEND_URL}/login?error=oauth_not_configured`);
    }

    const { code, state, error } = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (error) {
      return reply.redirect(`${FRONTEND_URL}/login?error=${error}`);
    }

    if (!code) {
      return reply.redirect(`${FRONTEND_URL}/login?error=missing_code`);
    }

    // Parse state to get intended role
    let intendedRole = "user";
    try {
      if (state) {
        const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
        intendedRole = parsed.role || "user";
      }
    } catch {
      // Ignore state parsing errors
    }

    try {
      // Exchange code for tokens
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: `${BACKEND_URL}/auth/google/callback`,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenRes.ok) {
        app.log.error({ status: tokenRes.status }, "Google token exchange failed");
        return reply.redirect(`${FRONTEND_URL}/login?error=token_exchange_failed`);
      }

      const tokens = await tokenRes.json() as { access_token: string; id_token: string };

      // Get user info from Google
      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userInfoRes.ok) {
        return reply.redirect(`${FRONTEND_URL}/login?error=userinfo_failed`);
      }

      const googleUser = await userInfoRes.json() as {
        sub: string;
        email: string;
        email_verified: boolean;
        name: string;
        picture: string;
      };

      // Check if user exists
      let userId: number;
      let isNewUser = false;

      const existingUser = await pool.query<{ id: number; role: string }>(
        `SELECT id, role FROM users WHERE email = $1 OR google_id = $2`,
        [googleUser.email.toLowerCase(), googleUser.sub]
      );

      if (existingUser.rowCount && existingUser.rows[0]) {
        // Existing user - update google_id if not set
        userId = existingUser.rows[0].id;
        await pool.query(
          `UPDATE users SET google_id = $1, name = COALESCE(name, $2), avatar_url = COALESCE(avatar_url, $3) WHERE id = $4`,
          [googleUser.sub, googleUser.name, googleUser.picture, userId]
        );
      } else {
        // New user - create account
        isNewUser = true;
        const client = await pool.connect();

        try {
          await client.query("begin");

          const userRes = await client.query<{ id: number }>(
            `INSERT INTO users (email, google_id, name, avatar_url, role, password_hash) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [
              googleUser.email.toLowerCase(),
              googleUser.sub,
              googleUser.name,
              googleUser.picture,
              intendedRole,
              "oauth_no_password", // Placeholder - OAuth users don't have passwords
            ]
          );
          userId = userRes.rows[0].id;

          // Create default project
          const payerDid = `did:noot:project:${uuidv4()}`;
          await client.query(
            `INSERT INTO projects (owner_user_id, name, payer_did) VALUES ($1, $2, $3)`,
            [userId, "Default", payerDid]
          );

          // Create ledger account with welcome credits
          await client.query(
            `INSERT INTO ledger_accounts (owner_did, balance) VALUES ($1, $2)
             ON CONFLICT (owner_did) DO NOTHING`,
            [payerDid, 1000] // 1000 free credits for new users
          );

          await client.query("commit");
        } catch (err) {
          await client.query("rollback");
          throw err;
        } finally {
          client.release();
        }
      }

      // Generate JWT tokens
      const accessToken = jwt.sign(
        { userId, email: googleUser.email, type: "access" },
        JWT_SECRET_VALUE,
        { expiresIn: "15m" }
      );

      const refreshTokenValue = crypto.randomBytes(32).toString("hex");
      const refreshTokenHash = crypto.createHash("sha256").update(refreshTokenValue).digest("hex");
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [userId, refreshTokenHash, expiresAt]
      );

      // Determine redirect URL based on role
      let redirectPath = "/user/dashboard";

      // Check user's role
      const userRoleRes = await pool.query<{ role: string }>(
        `SELECT role FROM users WHERE id = $1`,
        [userId]
      );

      const userRole = userRoleRes.rows[0]?.role || "user";

      if (isNewUser) {
        // New users go to onboarding
        redirectPath = "/onboarding";
      } else {
        // Existing users go to their dashboard
        switch (userRole) {
          case "developer":
          case "dev":
            redirectPath = "/dev/dashboard";
            break;
          case "org":
          case "organization":
            redirectPath = "/org/dashboard";
            break;
          default:
            redirectPath = "/user/dashboard";
        }
      }

      // Redirect to frontend with tokens
      const redirectUrl = new URL(`${FRONTEND_URL}${redirectPath}`);
      redirectUrl.searchParams.set("token", accessToken);
      redirectUrl.searchParams.set("refresh", refreshTokenValue);
      if (isNewUser) {
        redirectUrl.searchParams.set("new", "true");
      }

      return reply.redirect(redirectUrl.toString());

    } catch (err: any) {
      app.log.error({ err }, "Google OAuth callback failed");
      return reply.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
    }
  });
}

