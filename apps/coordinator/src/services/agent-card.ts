import { pool } from "../db.js";
import type { NooterraAgentCard, PolicyId, CapabilityId } from "@nooterra/types";

/**
 * Fetch the canonical NooterraAgentCard for an agent, if present.
 * Returns null when the agent has no canonical card stored.
 */
export async function getAgentCard(agentDid: string): Promise<NooterraAgentCard | null> {
  const res = await pool.query<{ agent_card: any | null }>(
    `select agent_card from agents where did = $1 limit 1`,
    [agentDid]
  );
  if (!res.rowCount) return null;
  const raw = res.rows[0].agent_card;
  if (!raw) return null;
  return raw as NooterraAgentCard;
}

/**
 * Resolve a model hint for an agent, preferring canonical AgentCard metadata
 * and falling back to legacy acard_raw->>'model' when needed.
 */
export async function getAgentModelHint(agentDid: string): Promise<string | null> {
  const res = await pool.query<{ agent_card: any | null; model: string | null }>(
    `select agent_card, acard_raw->>'model' as model from agents where did = $1 limit 1`,
    [agentDid]
  );
  if (!res.rowCount) return null;
  const row = res.rows[0];
  const card = row.agent_card as NooterraAgentCard | null;
  const metaModel =
    card && card.metadata && typeof (card.metadata as any).model === "string"
      ? ((card.metadata as any).model as string)
      : null;
  if (metaModel && metaModel.length > 0) {
    return metaModel;
  }
  return row.model || null;
}

export interface AgentRoutingProfile {
  did: string;
  endpoint: string | null;
  capabilityIds: string[];
  acceptedPolicyIds: string[];
  modelHint: string | null;
}

/**
 * Build a routing profile for an agent from its canonical AgentCard plus model hint.
 * Returns null when no canonical card is available.
 */
export async function getAgentRoutingProfile(agentDid: string): Promise<AgentRoutingProfile | null> {
  const cardRes = await pool.query<{ agent_card: any | null }>(
    `select agent_card from agents where did = $1 limit 1`,
    [agentDid]
  );
  if (!cardRes.rowCount) return null;
  const raw = cardRes.rows[0].agent_card;
  if (!raw) return null;

  const card = raw as NooterraAgentCard;
  const endpoint = card.endpoints?.primaryUrl || null;
  const capabilityIds = Array.isArray(card.capabilities)
    ? card.capabilities.map((c) => c.id as unknown as string)
    : [];
  const acceptedPolicyIds: string[] =
    card.policyProfile && Array.isArray(card.policyProfile.acceptedPolicyIds)
      ? (card.policyProfile.acceptedPolicyIds as PolicyId[]).map((p) => p as unknown as string)
      : [];

  const modelHint = await getAgentModelHint(agentDid);

  return {
    did: agentDid,
    endpoint,
    capabilityIds,
    acceptedPolicyIds,
    modelHint,
  };
}

