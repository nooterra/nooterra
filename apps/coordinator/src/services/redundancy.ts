import crypto from "crypto";
import { pool } from "../db.js";

export interface RedundancyConfig {
  enabled: boolean;
  total: number;
  quorum: number;
}

export interface ShareResult {
  status: "pending" | "success" | "failure";
  consensusHash?: string;
  payload?: any;
  winnerAgentDid?: string | null;
  submittedCount: number;
  majorityCount?: number;
  reason?: string;
}

function isCriticalCapability(capabilityId: string, requiresVerification: boolean): boolean {
  if (requiresVerification) return true;
  const CRITICAL_PREFIXES = [
    "cap.code.generate.",
    "cap.code.review.",
    "cap.code.explain.",
    "cap.payment.",
    "cap.crypto.",
    "cap.fs.write",
    "cap.file.write",
    "cap.shell.exec",
    "cap.os.exec",
    "cap.admin.",
    "payment.",
    "crypto.",
    "fs.write",
    "file.write",
    "shell.exec",
    "os.exec",
    "admin.",
  ];
  return CRITICAL_PREFIXES.some((p) => capabilityId.startsWith(p));
}

export function getRedundancyConfig(capabilityId: string, requiresVerification: boolean): RedundancyConfig {
  const enabled = isCriticalCapability(capabilityId, requiresVerification);
  if (!enabled) {
    return { enabled: false, total: 1, quorum: 1 };
  }
  const total = Math.max(1, Number(process.env.REDUNDANCY_TOTAL || 3));
  const quorum = Math.max(1, Math.min(total, Number(process.env.REDUNDANCY_QUORUM || 2)));
  return { enabled: true, total, quorum };
}

export function hashResultDeterministic(payload: any): string {
  const stable = JSON.stringify(payload ?? {});
  return crypto.createHash("sha256").update(stable).digest("hex");
}

/**
 * Record a result share for a node and evaluate consensus.
 * - Inserts (workflow_id,node_name,agent_did,hash,payload)
 * - Returns pending until any hash reaches quorum
 * - If submissions >= total and no quorum, returns failure
 */
export async function recordResultShare(params: {
  workflowId: string;
  nodeId: string;
  agentDid: string | null;
  hash: string;
  payload: any;
  total: number;
  quorum: number;
}): Promise<ShareResult> {
  const { workflowId, nodeId, agentDid, hash, payload, total, quorum } = params;

  await pool.query(
    `insert into node_result_shares (workflow_id, node_name, agent_did, result_hash, result_payload)
     values ($1, $2, $3, $4, $5)
     on conflict do nothing`,
    [workflowId, nodeId, agentDid, hash, payload ?? null]
  );

  const agg = await pool.query(
    `select result_hash, count(*) as cnt, max(agent_did) as agent_did, max(id) as sample_id
       from node_result_shares
      where workflow_id = $1 and node_name = $2
      group by result_hash`,
    [workflowId, nodeId]
  );
  const totalSubmissionsRes = await pool.query(
    `select count(*) as cnt from node_result_shares where workflow_id = $1 and node_name = $2`,
    [workflowId, nodeId]
  );
  const submittedCount = Number(totalSubmissionsRes.rows[0]?.cnt || 0);

  let majorityHash: string | null = null;
  let majorityCount = 0;
  let majorityAgent: string | null = null;
  for (const row of agg.rows) {
    const c = Number(row.cnt || 0);
    if (c > majorityCount) {
      majorityCount = c;
      majorityHash = row.result_hash as string;
      majorityAgent = (row.agent_did as string) || null;
    }
  }

  if (majorityHash && majorityCount >= quorum) {
    // Fetch sample payload for consensus hash
    const sample = await pool.query(
      `select result_payload from node_result_shares
         where workflow_id = $1 and node_name = $2 and result_hash = $3
         order by id asc limit 1`,
      [workflowId, nodeId, majorityHash]
    );
    const payloadWinner = sample.rowCount ? sample.rows[0].result_payload : null;
    return {
      status: "success",
      consensusHash: majorityHash,
      payload: payloadWinner,
      winnerAgentDid: majorityAgent,
      submittedCount,
      majorityCount,
    };
  }

  if (submittedCount >= total) {
    return {
      status: "failure",
      submittedCount,
      majorityCount,
      reason: "consensus_failure",
    };
  }

  return {
    status: "pending",
    submittedCount,
    majorityCount,
  };
}
