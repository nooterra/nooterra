/**
 * Federation Routes - Multi-Coordinator Peering, Private Subnets, Geographic Routing
 */
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { appendAuditLog } from "./trust.js";

const RegisterPeerSchema = z.object({
  peerId: z.string().uuid(),
  endpoint: z.string().url(),
  region: z.enum(["us-west", "us-east", "eu-west", "eu-central", "ap-south", "ap-northeast"]),
  publicKey: z.string(),
  capabilities: z.array(z.string()).optional(),
});

const PeerHeartbeatSchema = z.object({
  peerId: z.string().uuid(),
  agentCount: z.number().int().min(0),
  workflowCount: z.number().int().min(0),
  cpuUsage: z.number().min(0).max(100).optional(),
  memoryUsage: z.number().min(0).max(100).optional(),
});

const CreateSubnetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  memberDids: z.array(z.string()),
  policyType: z.enum(["private", "invite_only", "public"]).default("private"),
});

const AddSubnetMemberSchema = z.object({
  memberDid: z.string(),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
});

const CreateGeographicRouteSchema = z.object({
  capability: z.string(),
  preferredRegions: z.array(z.enum(["us-west", "us-east", "eu-west", "eu-central", "ap-south", "ap-northeast"])),
  fallbackRegions: z.array(z.enum(["us-west", "us-east", "eu-west", "eu-central", "ap-south", "ap-northeast"])).optional(),
  latencyThresholdMs: z.number().int().min(0).optional(),
});

const CreateSubnetPolicySchema = z.object({
  subnetId: z.string().uuid(),
  policyType: z.enum(["allow_capability", "deny_capability", "require_approval", "rate_limit"]),
  capability: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

export async function registerFederationRoutes(app: FastifyInstance<any, any, any, any, any>) {
  // ============================================================
  // PEER MANAGEMENT
  // ============================================================

  // Register a new peer coordinator
  app.post("/v1/federation/peers", async (req, reply) => {
    const body = RegisterPeerSchema.parse(req.body);
    
    const result = await pool.query(
      `INSERT INTO coordinator_peers 
       (id, endpoint, region, public_key, capabilities, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (id) DO UPDATE SET
         endpoint = EXCLUDED.endpoint,
         region = EXCLUDED.region,
         public_key = EXCLUDED.public_key,
         capabilities = EXCLUDED.capabilities,
         status = 'active',
         last_seen_at = now()
       RETURNING *`,
      [
        body.peerId,
        body.endpoint,
        body.region,
        body.publicKey,
        JSON.stringify(body.capabilities || []),
      ]
    );
    
    await appendAuditLog(app, "federation.peer_registered", body.peerId, "peer", body.peerId, "register", {
      region: body.region,
      endpoint: body.endpoint,
    });
    
    return result.rows[0];
  });

  // Peer heartbeat
  app.post("/v1/federation/peers/heartbeat", async (req, reply) => {
    const body = PeerHeartbeatSchema.parse(req.body);
    
    const result = await pool.query(
      `UPDATE coordinator_peers 
       SET last_seen_at = now(),
           agent_count = $2,
           workflow_count = $3,
           cpu_usage = $4,
           memory_usage = $5
       WHERE id = $1
       RETURNING *`,
      [
        body.peerId,
        body.agentCount,
        body.workflowCount,
        body.cpuUsage || null,
        body.memoryUsage || null,
      ]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Peer not found" });
    }
    
    return { status: "ok", timestamp: new Date() };
  });

  // List all peers
  app.get("/v1/federation/peers", async (req, reply) => {
    const { region, status } = req.query as { region?: string; status?: string };
    
    let sql = `SELECT * FROM coordinator_peers WHERE 1=1`;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (region) {
      sql += ` AND region = $${paramIndex++}`;
      params.push(region);
    }
    if (status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(status);
    }
    
    sql += ` ORDER BY region, last_seen_at DESC`;
    
    const result = await pool.query(sql, params);
    
    // Mark stale peers
    const staleThreshold = new Date(Date.now() - 60000); // 1 minute
    const peers = result.rows.map(peer => ({
      ...peer,
      isStale: new Date(peer.last_seen_at) < staleThreshold,
    }));
    
    return { peers };
  });

  // Get peer by ID
  app.get("/v1/federation/peers/:peerId", async (req, reply) => {
    const { peerId } = req.params as { peerId: string };
    
    const result = await pool.query(
      `SELECT * FROM coordinator_peers WHERE id = $1`,
      [peerId]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Peer not found" });
    }
    
    return result.rows[0];
  });

  // Deactivate peer
  app.delete("/v1/federation/peers/:peerId", async (req, reply) => {
    const { peerId } = req.params as { peerId: string };
    
    const result = await pool.query(
      `UPDATE coordinator_peers SET status = 'inactive' WHERE id = $1 RETURNING *`,
      [peerId]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Peer not found" });
    }
    
    return result.rows[0];
  });

  // ============================================================
  // PRIVATE SUBNETS
  // ============================================================

  // Create a private subnet
  app.post("/v1/federation/subnets", async (req, reply) => {
    const body = CreateSubnetSchema.parse(req.body);
    const ownerDid = (req as any).user?.did || "unknown";
    
    const subnetId = uuidv4();
    
    // Create subnet
    const result = await pool.query(
      `INSERT INTO private_subnets 
       (id, name, description, owner_did, policy_type, member_dids)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        subnetId,
        body.name,
        body.description || null,
        ownerDid,
        body.policyType,
        JSON.stringify(body.memberDids),
      ]
    );
    
    await appendAuditLog(app, "federation.subnet_created", ownerDid, "subnet", subnetId, "create", {
      name: body.name,
      memberCount: body.memberDids.length,
    });
    
    return result.rows[0];
  });

  // Get subnet
  app.get("/v1/federation/subnets/:subnetId", async (req, reply) => {
    const { subnetId } = req.params as { subnetId: string };
    
    const result = await pool.query(
      `SELECT * FROM private_subnets WHERE id = $1`,
      [subnetId]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Subnet not found" });
    }
    
    // Get policies
    const policies = await pool.query(
      `SELECT * FROM subnet_policies WHERE subnet_id = $1 AND is_active = true`,
      [subnetId]
    );
    
    return {
      ...result.rows[0],
      policies: policies.rows,
    };
  });

  // List subnets
  app.get("/v1/federation/subnets", async (req, reply) => {
    const { ownerDid, memberDid, limit = 50, offset = 0 } = req.query as any;
    
    let sql = `SELECT * FROM private_subnets WHERE is_active = true`;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (ownerDid) {
      sql += ` AND owner_did = $${paramIndex++}`;
      params.push(ownerDid);
    }
    if (memberDid) {
      sql += ` AND member_dids @> $${paramIndex++}::jsonb`;
      params.push(JSON.stringify([memberDid]));
    }
    
    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    
    const result = await pool.query(sql, params);
    
    return { subnets: result.rows, limit, offset };
  });

  // Add member to subnet
  app.post("/v1/federation/subnets/:subnetId/members", async (req, reply) => {
    const { subnetId } = req.params as { subnetId: string };
    const body = AddSubnetMemberSchema.parse(req.body);
    
    // Get current subnet
    const subnetResult = await pool.query(
      `SELECT * FROM private_subnets WHERE id = $1`,
      [subnetId]
    );
    
    if (subnetResult.rows.length === 0) {
      return reply.status(404).send({ error: "Subnet not found" });
    }
    
    const subnet = subnetResult.rows[0];
    const members = subnet.member_dids || [];
    
    if (members.includes(body.memberDid)) {
      return reply.status(400).send({ error: "Already a member" });
    }
    
    members.push(body.memberDid);
    
    const result = await pool.query(
      `UPDATE private_subnets SET member_dids = $2 WHERE id = $1 RETURNING *`,
      [subnetId, JSON.stringify(members)]
    );
    
    return result.rows[0];
  });

  // Remove member from subnet
  app.delete("/v1/federation/subnets/:subnetId/members/:memberDid", async (req, reply) => {
    const { subnetId, memberDid } = req.params as { subnetId: string; memberDid: string };
    
    // Get current subnet
    const subnetResult = await pool.query(
      `SELECT * FROM private_subnets WHERE id = $1`,
      [subnetId]
    );
    
    if (subnetResult.rows.length === 0) {
      return reply.status(404).send({ error: "Subnet not found" });
    }
    
    const subnet = subnetResult.rows[0];
    const members = (subnet.member_dids || []).filter((m: string) => m !== memberDid);
    
    const result = await pool.query(
      `UPDATE private_subnets SET member_dids = $2 WHERE id = $1 RETURNING *`,
      [subnetId, JSON.stringify(members)]
    );
    
    return result.rows[0];
  });

  // Deactivate subnet
  app.delete("/v1/federation/subnets/:subnetId", async (req, reply) => {
    const { subnetId } = req.params as { subnetId: string };
    
    const result = await pool.query(
      `UPDATE private_subnets SET is_active = false WHERE id = $1 RETURNING *`,
      [subnetId]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Subnet not found" });
    }
    
    return result.rows[0];
  });

  // ============================================================
  // GEOGRAPHIC ROUTING
  // ============================================================

  // Create geographic route
  app.post("/v1/federation/routes", async (req, reply) => {
    const body = CreateGeographicRouteSchema.parse(req.body);
    
    const result = await pool.query(
      `INSERT INTO geographic_routes 
       (capability, preferred_regions, fallback_regions, latency_threshold_ms)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (capability) DO UPDATE SET
         preferred_regions = EXCLUDED.preferred_regions,
         fallback_regions = EXCLUDED.fallback_regions,
         latency_threshold_ms = EXCLUDED.latency_threshold_ms
       RETURNING *`,
      [
        body.capability,
        JSON.stringify(body.preferredRegions),
        JSON.stringify(body.fallbackRegions || []),
        body.latencyThresholdMs || null,
      ]
    );
    
    return result.rows[0];
  });

  // Get route for capability
  app.get("/v1/federation/routes/:capability", async (req, reply) => {
    const { capability } = req.params as { capability: string };
    
    const result = await pool.query(
      `SELECT * FROM geographic_routes WHERE capability = $1 AND is_active = true`,
      [capability]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Route not found" });
    }
    
    return result.rows[0];
  });

  // List all routes
  app.get("/v1/federation/routes", async (req, reply) => {
    const { region } = req.query as { region?: string };
    
    let sql = `SELECT * FROM geographic_routes WHERE is_active = true`;
    const params: any[] = [];
    
    if (region) {
      sql += ` AND (preferred_regions @> $1::jsonb OR fallback_regions @> $1::jsonb)`;
      params.push(JSON.stringify([region]));
    }
    
    sql += ` ORDER BY capability`;
    
    const result = await pool.query(sql, params);
    
    return { routes: result.rows };
  });

  // Delete route
  app.delete("/v1/federation/routes/:capability", async (req, reply) => {
    const { capability } = req.params as { capability: string };
    
    const result = await pool.query(
      `UPDATE geographic_routes SET is_active = false WHERE capability = $1 RETURNING *`,
      [capability]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Route not found" });
    }
    
    return result.rows[0];
  });

  // ============================================================
  // SUBNET POLICIES
  // ============================================================

  // Create subnet policy
  app.post("/v1/federation/policies", async (req, reply) => {
    const body = CreateSubnetPolicySchema.parse(req.body);
    
    const result = await pool.query(
      `INSERT INTO subnet_policies 
       (subnet_id, policy_type, capability, config)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        body.subnetId,
        body.policyType,
        body.capability || null,
        body.config || null,
      ]
    );
    
    return result.rows[0];
  });

  // Get policies for subnet
  app.get("/v1/federation/policies/:subnetId", async (req, reply) => {
    const { subnetId } = req.params as { subnetId: string };
    
    const result = await pool.query(
      `SELECT * FROM subnet_policies WHERE subnet_id = $1 AND is_active = true ORDER BY created_at`,
      [subnetId]
    );
    
    return { policies: result.rows };
  });

  // Deactivate policy
  app.delete("/v1/federation/policies/:policyId", async (req, reply) => {
    const { policyId } = req.params as { policyId: string };
    
    const result = await pool.query(
      `UPDATE subnet_policies SET is_active = false WHERE id = $1 RETURNING *`,
      [policyId]
    );
    
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Policy not found" });
    }
    
    return result.rows[0];
  });

  // ============================================================
  // CROSS-COORDINATOR ROUTING
  // ============================================================

  // Find best peer for capability
  app.get("/v1/federation/route/:capability", async (req, reply) => {
    const { capability } = req.params as { capability: string };
    const { requestRegion } = req.query as { requestRegion?: string };
    
    // Get geographic route config
    const routeResult = await pool.query(
      `SELECT * FROM geographic_routes WHERE capability = $1 AND is_active = true`,
      [capability]
    );
    
    let preferredRegions: string[] = [];
    let fallbackRegions: string[] = [];
    
    if (routeResult.rows.length > 0) {
      preferredRegions = routeResult.rows[0].preferred_regions || [];
      fallbackRegions = routeResult.rows[0].fallback_regions || [];
    }
    
    // If request region specified, prioritize it
    if (requestRegion && !preferredRegions.includes(requestRegion)) {
      preferredRegions = [requestRegion, ...preferredRegions];
    }
    
    // Get active peers with capability
    const peersResult = await pool.query(
      `SELECT * FROM coordinator_peers 
       WHERE status = 'active' 
       AND capabilities @> $1::jsonb
       AND last_seen_at > now() - interval '5 minutes'
       ORDER BY 
         CASE WHEN region = ANY($2) THEN 0 
              WHEN region = ANY($3) THEN 1 
              ELSE 2 END,
         workflow_count ASC`,
      [
        JSON.stringify([capability]),
        preferredRegions,
        fallbackRegions,
      ]
    );
    
    if (peersResult.rows.length === 0) {
      return reply.status(404).send({ 
        error: "No available peers for capability",
        capability,
        checkedRegions: [...preferredRegions, ...fallbackRegions],
      });
    }
    
    const selectedPeer = peersResult.rows[0];
    
    return {
      peer: {
        id: selectedPeer.id,
        endpoint: selectedPeer.endpoint,
        region: selectedPeer.region,
        workflowCount: selectedPeer.workflow_count,
      },
      routingReason: preferredRegions.includes(selectedPeer.region) 
        ? "preferred_region" 
        : fallbackRegions.includes(selectedPeer.region) 
          ? "fallback_region" 
          : "least_loaded",
    };
  });

  // Forward workflow to peer (placeholder for actual federation)
  app.post("/v1/federation/forward/:peerId", async (req, reply) => {
    const { peerId } = req.params as { peerId: string };
    const workflow = req.body as any;
    
    // Get peer
    const peerResult = await pool.query(
      `SELECT * FROM coordinator_peers WHERE id = $1 AND status = 'active'`,
      [peerId]
    );
    
    if (peerResult.rows.length === 0) {
      return reply.status(404).send({ error: "Peer not found or inactive" });
    }
    
    const peer = peerResult.rows[0];
    
    // In production, this would sign the request and forward to peer.endpoint
    // For now, return what would be sent
    return {
      forwardedTo: peer.endpoint,
      peerId: peer.id,
      region: peer.region,
      workflow: {
        id: workflow.id,
        capability: workflow.capability,
      },
      status: "forwarded",
      message: "Workflow forwarded to federated coordinator (placeholder)",
    };
  });
}
