/**
 * Identity Routes - Agent Inheritance, Names, Recovery
 */
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { appendAuditLog } from "./trust.js";
import nacl from "tweetnacl";

const InheritanceSchema = z.object({
  recoveryAddress: z.string().optional(),
  heirDid: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  deadManSwitchHours: z.number().min(1).max(8760).optional(), // Max 1 year
});

const RegisterNameSchema = z.object({
  name: z.string().min(3).max(64).regex(/^[a-z0-9-]+$/),
  agentDid: z.string(),
  durationMonths: z.number().min(1).max(120).optional(),
});

const RecoverySchema = z.object({
  agentDid: z.string(),
  recoveryAddress: z.string(),
  newPublicKey: z.string(),
  recoveryProof: z.string(),
});

export async function registerIdentityRoutes(app: FastifyInstance<any, any, any, any, any>) {
  // ============================================================
  // AGENT INHERITANCE
  // ============================================================

  // Get inheritance config for an agent
  app.get("/v1/agents/:agentDid/inheritance", async (req, reply) => {
    const { agentDid } = req.params as { agentDid: string };
    
    const result = await pool.query(
      `SELECT * FROM agent_inheritance WHERE agent_did = $1`,
      [agentDid]
    );
    
    if (result.rows.length === 0) {
      return { agentDid, configured: false };
    }
    
    const inheritance = result.rows[0];
    
    // Check if dead man switch should trigger
    let deadManSwitchStatus = "inactive";
    if (inheritance.dead_man_switch_hours && inheritance.last_activity_at) {
      const hoursSinceActivity = 
        (Date.now() - new Date(inheritance.last_activity_at).getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceActivity >= inheritance.dead_man_switch_hours) {
        deadManSwitchStatus = "triggered";
      } else if (hoursSinceActivity >= inheritance.dead_man_switch_hours * 0.8) {
        deadManSwitchStatus = "warning";
      }
    }
    
    return {
      ...inheritance,
      configured: true,
      deadManSwitchStatus,
    };
  });

  // Set inheritance config
  app.put("/v1/agents/:agentDid/inheritance", async (req, reply) => {
    const { agentDid } = req.params as { agentDid: string };
    const body = InheritanceSchema.parse(req.body);
    const actorDid = (req as any).user?.did || agentDid;
    
    // Verify caller owns this agent (in production, verify signature)
    
    const result = await pool.query(
      `INSERT INTO agent_inheritance 
       (agent_did, recovery_address, heir_did, expires_at, dead_man_switch_hours, last_activity_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (agent_did) DO UPDATE SET
         recovery_address = COALESCE($2, agent_inheritance.recovery_address),
         heir_did = COALESCE($3, agent_inheritance.heir_did),
         expires_at = COALESCE($4, agent_inheritance.expires_at),
         dead_man_switch_hours = COALESCE($5, agent_inheritance.dead_man_switch_hours),
         updated_at = now()
       RETURNING *`,
      [
        agentDid,
        body.recoveryAddress || null,
        body.heirDid || null,
        body.expiresAt || null,
        body.deadManSwitchHours || null,
      ]
    );
    
    await appendAuditLog(app, "agent.inheritance_updated", actorDid, "agent", agentDid, "set_inheritance", {
      hasRecovery: !!body.recoveryAddress,
      hasHeir: !!body.heirDid,
      hasExpiry: !!body.expiresAt,
      hasDeadManSwitch: !!body.deadManSwitchHours,
    });
    
    return result.rows[0];
  });

  // Update activity (reset dead man switch)
  app.post("/v1/agents/:agentDid/activity", async (req, reply) => {
    const { agentDid } = req.params as { agentDid: string };
    
    await pool.query(
      `UPDATE agent_inheritance SET last_activity_at = now(), updated_at = now() WHERE agent_did = $1`,
      [agentDid]
    );
    
    return { success: true, agentDid, activityAt: new Date() };
  });

  // Trigger dead man switch manually (for testing or emergency)
  app.post("/v1/agents/:agentDid/trigger-dead-man-switch", async (req, reply) => {
    const { agentDid } = req.params as { agentDid: string };
    const actorDid = (req as any).user?.did || "system";
    
    const result = await pool.query(
      `SELECT * FROM agent_inheritance WHERE agent_did = $1`,
      [agentDid]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "No inheritance config found" });
    }
    
    const inheritance = result.rows[0];
    
    if (!inheritance.heir_did) {
      return reply.status(400).send({ error: "No heir configured" });
    }
    
    // Transfer pending tasks to heir
    const transferResult = await pool.query(
      `UPDATE task_nodes 
       SET agent_did = $2, 
           result_payload = jsonb_build_object('transferred_from', $1, 'reason', 'dead_man_switch')
       WHERE agent_did = $1 AND status IN ('pending', 'dispatched')
       RETURNING id`,
      [agentDid, inheritance.heir_did]
    );
    
    await appendAuditLog(app, "agent.dead_man_switch", actorDid, "agent", agentDid, "trigger_dead_man_switch", {
      heirDid: inheritance.heir_did,
      tasksTransferred: transferResult.rows.length,
    });
    
    return {
      agentDid,
      heirDid: inheritance.heir_did,
      tasksTransferred: transferResult.rows.length,
      triggeredAt: new Date(),
    };
  });

  // ============================================================
  // AGENT NAMES (ENS-style)
  // ============================================================

  // Resolve name to DID
  app.get("/v1/names/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    
    const result = await pool.query(
      `SELECT * FROM agent_names 
       WHERE name = $1 
       AND (expires_at IS NULL OR expires_at > now())`,
      [name.toLowerCase()]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Name not found or expired" });
    }
    
    return result.rows[0];
  });

  // Reverse lookup: DID to names
  app.get("/v1/agents/:agentDid/names", async (req, reply) => {
    const { agentDid } = req.params as { agentDid: string };
    
    const result = await pool.query(
      `SELECT * FROM agent_names 
       WHERE agent_did = $1 
       AND (expires_at IS NULL OR expires_at > now())
       ORDER BY created_at ASC`,
      [agentDid]
    );
    
    return { agentDid, names: result.rows };
  });

  // Register a name
  app.post("/v1/names", async (req, reply) => {
    const body = RegisterNameSchema.parse(req.body);
    const actorDid = (req as any).user?.did || body.agentDid;
    
    // Normalize name
    const normalizedName = body.name.toLowerCase();
    
    // Check if name is taken
    const existing = await pool.query(
      `SELECT id FROM agent_names 
       WHERE name = $1 
       AND (expires_at IS NULL OR expires_at > now())`,
      [normalizedName]
    );
    
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: "Name already taken" });
    }
    
    // Calculate expiration
    const durationMonths = body.durationMonths || 12;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + durationMonths);
    
    const result = await pool.query(
      `INSERT INTO agent_names (name, agent_did, owner_did, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [normalizedName, body.agentDid, actorDid, expiresAt]
    );
    
    await appendAuditLog(app, "agent.name_registered", actorDid, "name", normalizedName, "register", {
      agentDid: body.agentDid,
      expiresAt,
    });
    
    return result.rows[0];
  });

  // Transfer name ownership
  app.post("/v1/names/:name/transfer", async (req, reply) => {
    const { name } = req.params as { name: string };
    const { newAgentDid, newOwnerDid } = req.body as { newAgentDid?: string; newOwnerDid?: string };
    const actorDid = (req as any).user?.did;
    
    // Verify ownership
    const existing = await pool.query(
      `SELECT * FROM agent_names WHERE name = $1 AND owner_did = $2`,
      [name.toLowerCase(), actorDid]
    );
    
    if (existing.rows.length === 0) {
      return reply.status(403).send({ error: "You don't own this name" });
    }
    
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    
    if (newAgentDid) {
      updates.push(`agent_did = $${paramIndex++}`);
      params.push(newAgentDid);
    }
    if (newOwnerDid) {
      updates.push(`owner_did = $${paramIndex++}`);
      params.push(newOwnerDid);
    }
    
    if (updates.length === 0) {
      return reply.status(400).send({ error: "Nothing to transfer" });
    }
    
    params.push(name.toLowerCase());
    
    const result = await pool.query(
      `UPDATE agent_names SET ${updates.join(", ")} WHERE name = $${paramIndex} RETURNING *`,
      params
    );
    
    return result.rows[0];
  });

  // ============================================================
  // KEY RECOVERY
  // ============================================================

  // Initiate recovery
  app.post("/v1/recovery", async (req, reply) => {
    const body = RecoverySchema.parse(req.body);
    
    // Get inheritance config
    const inheritanceResult = await pool.query(
      `SELECT * FROM agent_inheritance WHERE agent_did = $1`,
      [body.agentDid]
    );
    
    if (inheritanceResult.rows.length === 0) {
      return reply.status(404).send({ error: "No recovery config for this agent" });
    }
    
    const inheritance = inheritanceResult.rows[0];
    
    if (inheritance.recovery_address !== body.recoveryAddress) {
      return reply.status(403).send({ error: "Recovery address does not match" });
    }
    
    // Verify recovery proof (signature from recovery address)
    // In production, this would verify an EIP-712 or similar signature
    const proofMessage = `recover:${body.agentDid}:${body.newPublicKey}`;
    // For now, just check it's not empty
    if (!body.recoveryProof) {
      return reply.status(400).send({ error: "Invalid recovery proof" });
    }
    
    // Update agent's public key
    await pool.query(
      `UPDATE agents SET public_key = $1, updated_at = now() WHERE did = $2`,
      [body.newPublicKey, body.agentDid]
    );
    
    // Record key rotation
    await pool.query(
      `INSERT INTO key_rotations (agent_did, old_public_key, new_public_key, rotation_proof)
       SELECT $1, public_key, $2, $3 FROM agents WHERE did = $1`,
      [body.agentDid, body.newPublicKey, `recovery:${body.recoveryProof}`]
    );
    
    await appendAuditLog(app, "agent.recovered", body.recoveryAddress, "agent", body.agentDid, "recover", {
      newKeyPrefix: body.newPublicKey.substring(0, 16) + "...",
    });
    
    return {
      success: true,
      agentDid: body.agentDid,
      recoveredAt: new Date(),
    };
  });
}
