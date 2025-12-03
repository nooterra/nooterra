/**
 * Authentication routes
 * Handles signup, login, and user info
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
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
      
      const token = jwt.sign(
        { userId: user.id, email: user.email }, 
        JWT_SECRET_VALUE, 
        { expiresIn: "7d" }
      );
      
      return reply.send({ token });
    } catch (err: any) {
      app.log.error({ err }, "login failed");
      return reply.status(500).send({ error: "login_failed" });
    }
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
}
