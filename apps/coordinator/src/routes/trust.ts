/**
 * Trust Layer Routes - Revocation, Key Rotation, Signed Results
 */
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import crypto from "crypto";
import nacl from "tweetnacl";

const RevocationSchema = z.object({
  did: z.string(),
  reason: z.string(),
  evidence: z.record(z.unknown()).optional(),
  expiresAt: z.string().datetime().optional(),
});

const KeyRotationSchema = z.object({
  agentDid: z.string(),
  newPublicKey: z.string(),
  rotationProof: z.string(),
});

export async function registerTrustRoutes(app: FastifyInstance<any, any, any, any, any>) {
  // ============================================================
  // REVOCATION REGISTRY
  // ============================================================

  // Check if a DID is revoked
  app.get("/v1/revoked/:did", async (req, reply) => {
    const { did } = req.params as { did: string };
    
    const result = await pool.query(
      `SELECT * FROM revoked_dids 
       WHERE did = $1 
       AND (expires_at IS NULL OR expires_at > now())`,
      [did]
    );
    
    if (result.rows.length === 0) {
      return { revoked: false };
    }
    
    return {
      revoked: true,
      reason: result.rows[0].reason,
      revokedAt: result.rows[0].created_at,
      expiresAt: result.rows[0].expires_at,
    };
  });

  // List all revoked DIDs
  app.get("/v1/revoked", async (req, reply) => {
    const { limit = 100, offset = 0 } = req.query as { limit?: number; offset?: number };
    
    const result = await pool.query(
      `SELECT * FROM revoked_dids 
       WHERE expires_at IS NULL OR expires_at > now()
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM revoked_dids WHERE expires_at IS NULL OR expires_at > now()`
    );
    
    return {
      revocations: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    };
  });

  // Revoke a DID (admin only)
  app.post("/v1/revoked", async (req, reply) => {
    const body = RevocationSchema.parse(req.body);
    const actorDid = (req as any).user?.did || "system";
    
    // Check if already revoked
    const existing = await pool.query(
      `SELECT id FROM revoked_dids WHERE did = $1 AND (expires_at IS NULL OR expires_at > now())`,
      [body.did]
    );
    
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: "DID already revoked" });
    }
    
    const result = await pool.query(
      `INSERT INTO revoked_dids (did, reason, revoked_by, evidence, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [body.did, body.reason, actorDid, body.evidence || null, body.expiresAt || null]
    );
    
    // Log to audit chain
    await appendAuditLog(app, "agent.revoked", actorDid, "agent", body.did, "revoke", {
      reason: body.reason,
    });
    
    // Cancel any in-flight tasks for this agent
    await pool.query(
      `UPDATE task_nodes SET status = 'failed', 
       result_payload = jsonb_build_object('error', 'Agent revoked', 'reason', $2)
       WHERE agent_did = $1 AND status IN ('pending', 'dispatched', 'running')`,
      [body.did, body.reason]
    );
    
    return result.rows[0];
  });

  // Unrevoke a DID (admin only)
  app.delete("/v1/revoked/:did", async (req, reply) => {
    const { did } = req.params as { did: string };
    const actorDid = (req as any).user?.did || "system";
    
    const result = await pool.query(
      `DELETE FROM revoked_dids WHERE did = $1 RETURNING *`,
      [did]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Revocation not found" });
    }
    
    await appendAuditLog(app, "agent.unrevoked", actorDid, "agent", did, "unrevoke", {});
    
    return { success: true, did };
  });

  // ============================================================
  // KEY ROTATION
  // ============================================================

  // Get key rotation history for an agent
  app.get("/v1/keys/:agentDid/history", async (req, reply) => {
    const { agentDid } = req.params as { agentDid: string };
    
    const result = await pool.query(
      `SELECT * FROM key_rotations WHERE agent_did = $1 ORDER BY created_at DESC`,
      [agentDid]
    );
    
    return { rotations: result.rows };
  });

  // Rotate an agent's key
  app.post("/v1/keys/rotate", async (req, reply) => {
    const body = KeyRotationSchema.parse(req.body);
    
    // Get current public key from registry
    const agentResult = await pool.query(
      `SELECT public_key FROM agents WHERE did = $1`,
      [body.agentDid]
    );
    
    if (agentResult.rows.length === 0) {
      return reply.status(404).send({ error: "Agent not found" });
    }
    
    const oldPublicKey = agentResult.rows[0].public_key;
    
    // Verify rotation proof (signed message proving ownership of old key)
    const proofMessage = `rotate:${body.agentDid}:${body.newPublicKey}`;
    const isValid = verifySignature(oldPublicKey, proofMessage, body.rotationProof);
    
    if (!isValid) {
      return reply.status(401).send({ error: "Invalid rotation proof" });
    }
    
    // Update agent's public key
    await pool.query(
      `UPDATE agents SET public_key = $1, updated_at = now() WHERE did = $2`,
      [body.newPublicKey, body.agentDid]
    );
    
    // Record rotation
    await pool.query(
      `INSERT INTO key_rotations (agent_did, old_public_key, new_public_key, rotation_proof)
       VALUES ($1, $2, $3, $4)`,
      [body.agentDid, oldPublicKey, body.newPublicKey, body.rotationProof]
    );
    
    await appendAuditLog(app, "agent.key_rotated", body.agentDid, "agent", body.agentDid, "key_rotate", {
      oldKeyPrefix: oldPublicKey.substring(0, 16) + "...",
      newKeyPrefix: body.newPublicKey.substring(0, 16) + "...",
    });
    
    return { success: true, agentDid: body.agentDid };
  });

  // ============================================================
  // SIGNED RESULTS
  // ============================================================

  // Get signed result for a node
  app.get("/v1/signed-results/:nodeId", async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    
    const result = await pool.query(
      `SELECT * FROM signed_results WHERE node_id = $1`,
      [nodeId]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Signed result not found" });
    }
    
    return result.rows[0];
  });

  // Verify a signed result
  app.post("/v1/signed-results/:nodeId/verify", async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    
    const result = await pool.query(
      `SELECT sr.*, tn.result_payload 
       FROM signed_results sr
       JOIN task_nodes tn ON sr.node_id = tn.id
       WHERE sr.node_id = $1`,
      [nodeId]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Signed result not found" });
    }
    
    const signedResult = result.rows[0];
    
    // Verify the result hash matches
    const computedHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(signedResult.result_payload || {}))
      .digest("hex");
    
    const hashMatches = computedHash === signedResult.result_hash;
    
    // Verify the signature
    const signatureValid = verifySignature(
      signedResult.public_key,
      `${signedResult.node_id}:${signedResult.workflow_id}:${signedResult.result_hash}`,
      signedResult.signature
    );
    
    return {
      valid: hashMatches && signatureValid,
      hashMatches,
      signatureValid,
      agentDid: signedResult.agent_did,
      resultHash: signedResult.result_hash,
      computedHash,
    };
  });
}

// Helper: Verify Ed25519 signature
function verifySignature(pubKeyBase64: string, message: string, signatureB64: string): boolean {
  try {
    const msgBytes = new TextEncoder().encode(message);
    const pubBytes = Uint8Array.from(Buffer.from(pubKeyBase64, "base64"));
    const sigBytes = Uint8Array.from(Buffer.from(signatureB64, "base64"));
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes);
  } catch {
    return false;
  }
}

// Helper: Append to immutable audit chain
export async function appendAuditLog(
  app: FastifyInstance<any, any, any, any, any>,
  eventType: string,
  actorDid: string,
  targetType: string,
  targetId: string,
  action: string,
  payload: Record<string, unknown>
) {
  // Get previous hash
  const prevResult = await pool.query(
    `SELECT hash FROM audit_chain ORDER BY id DESC LIMIT 1`
  );
  const prevHash = prevResult.rows[0]?.hash || null;
  
  // Compute hash of this entry
  const hashInput = JSON.stringify({
    prevHash,
    eventType,
    actorDid,
    targetType,
    targetId,
    action,
    payload,
    timestamp: Date.now(),
  });
  const hash = crypto.createHash("sha256").update(hashInput).digest("hex");
  
  await pool.query(
    `INSERT INTO audit_chain (prev_hash, event_type, actor_did, target_type, target_id, action, payload, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [prevHash, eventType, actorDid, targetType, targetId, action, payload, hash]
  );
}
