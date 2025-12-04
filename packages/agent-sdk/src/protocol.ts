/**
 * Protocol SDK helpers for interacting with coordinator protocol features
 */

export interface ProtocolClient {
  coordinatorUrl: string;
  apiKey?: string;
  agentDid?: string;
}

// ============================================================
// TRUST LAYER
// ============================================================

export async function checkRevoked(
  client: ProtocolClient,
  did: string
): Promise<{ revoked: boolean; reason?: string; expiresAt?: string }> {
  const res = await fetch(`${client.coordinatorUrl}/v1/revoked/${encodeURIComponent(did)}`, {
    headers: client.apiKey ? { "x-api-key": client.apiKey } : {},
  });
  return res.json() as any;
}

export async function rotateKey(
  client: ProtocolClient,
  agentDid: string,
  newPublicKey: string,
  rotationProof: string
): Promise<{ success: boolean; keyId: string }> {
  const res = await fetch(`${client.coordinatorUrl}/v1/trust/rotate-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(client.apiKey ? { "x-api-key": client.apiKey } : {}),
    },
    body: JSON.stringify({ agentDid, newPublicKey, rotationProof }),
  });
  return res.json() as any;
}

export async function getKeyHistory(
  client: ProtocolClient,
  did: string
): Promise<Array<{ publicKey: string; validFrom: string; validUntil?: string }>> {
  const res = await fetch(`${client.coordinatorUrl}/v1/trust/key-history/${encodeURIComponent(did)}`, {
    headers: client.apiKey ? { "x-api-key": client.apiKey } : {},
  });
  const data = await res.json() as any;
  return data.keyHistory || [];
}

// ============================================================
// ACCOUNTABILITY
// ============================================================

export async function submitReceipt(
  client: ProtocolClient,
  receipt: {
    workflowId: string;
    nodeId: string;
    inputHash: string;
    outputHash: string;
    startedAt: string;
    completedAt: string;
    computeMs: number;
    signature: string;
  }
): Promise<{ receiptId: string }> {
  const res = await fetch(`${client.coordinatorUrl}/v1/receipts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(client.apiKey ? { "x-api-key": client.apiKey } : {}),
    },
    body: JSON.stringify(receipt),
  });
  return res.json() as any;
}

export async function getReceipts(
  client: ProtocolClient,
  agentDid: string
): Promise<Array<any>> {
  const res = await fetch(`${client.coordinatorUrl}/v1/receipts/${encodeURIComponent(agentDid)}`, {
    headers: client.apiKey ? { "x-api-key": client.apiKey } : {},
  });
  const data = await res.json() as any;
  return data.receipts || [];
}

export async function getTrace(
  client: ProtocolClient,
  traceId: string
): Promise<{ trace: any; spans: any[] }> {
  const res = await fetch(`${client.coordinatorUrl}/v1/traces/${traceId}`, {
    headers: client.apiKey ? { "x-api-key": client.apiKey } : {},
  });
  return res.json() as any;
}

// ============================================================
// PROTOCOL OPERATIONS
// ============================================================

export async function cancelWorkflow(
  client: ProtocolClient,
  workflowId: string,
  reason: "user_request" | "budget_exceeded" | "timeout" | "error" | "policy_violation",
  details?: string
): Promise<{ success: boolean }> {
  const res = await fetch(`${client.coordinatorUrl}/v1/workflows/${workflowId}/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(client.apiKey ? { "x-api-key": client.apiKey } : {}),
    },
    body: JSON.stringify({ reason, details }),
  });
  return res.json() as any;
}

export async function registerCapabilityVersion(
  client: ProtocolClient,
  capability: {
    capabilityId: string;
    version: string;
    inputSchema?: object;
    outputSchema?: object;
    changelog?: string;
    deprecatesVersion?: string;
  }
): Promise<{ versionId: string }> {
  const res = await fetch(`${client.coordinatorUrl}/v1/capabilities/versions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(client.apiKey ? { "x-api-key": client.apiKey } : {}),
    },
    body: JSON.stringify(capability),
  });
  return res.json() as any;
}

export async function scheduleWorkflow(
  client: ProtocolClient,
  schedule: {
    name: string;
    cronExpression: string;
    workflowTemplate: object;
    timezone?: string;
    maxRuns?: number;
  }
): Promise<{ scheduleId: string }> {
  const res = await fetch(`${client.coordinatorUrl}/v1/schedules`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(client.apiKey ? { "x-api-key": client.apiKey } : {}),
    },
    body: JSON.stringify(schedule),
  });
  return res.json() as any;
}

export async function listSchedules(
  client: ProtocolClient
): Promise<Array<any>> {
  const res = await fetch(`${client.coordinatorUrl}/v1/schedules`, {
    headers: client.apiKey ? { "x-api-key": client.apiKey } : {},
  });
  const data = await res.json() as any;
  return data.schedules || [];
}

export async function deleteSchedule(
  client: ProtocolClient,
  scheduleId: string
): Promise<{ success: boolean }> {
  const res = await fetch(`${client.coordinatorUrl}/v1/schedules/${scheduleId}`, {
    method: "DELETE",
    headers: client.apiKey ? { "x-api-key": client.apiKey } : {},
  });
  return res.json() as any;
}

// ============================================================
// IDENTITY
// ============================================================

export async function setInheritance(
  client: ProtocolClient,
  inheritance: {
    agentDid: string;
    inheritsToDid: string;
    deadManSwitchDays?: number;
    conditions?: object;
  }
): Promise<{ success: boolean }> {
  const res = await fetch(`${client.coordinatorUrl}/v1/identity/inheritance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(client.apiKey ? { "x-api-key": client.apiKey } : {}),
    },
    body: JSON.stringify(inheritance),
  });
  return res.json() as any;
}

export async function registerName(
  client: ProtocolClient,
  name: string,
  agentDid: string
): Promise<{ success: boolean; name: string }> {
  const res = await fetch(`${client.coordinatorUrl}/v1/identity/names`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(client.apiKey ? { "x-api-key": client.apiKey } : {}),
    },
    body: JSON.stringify({ name, agentDid }),
  });
  return res.json() as any;
}

export async function resolveName(
  client: ProtocolClient,
  name: string
): Promise<{ agentDid: string; expiresAt?: string } | null> {
  const res = await fetch(`${client.coordinatorUrl}/v1/identity/names/${encodeURIComponent(name)}`, {
    headers: client.apiKey ? { "x-api-key": client.apiKey } : {},
  });
  if (res.status === 404) return null;
  return res.json() as any;
}

// ============================================================
// ECONOMICS
// ============================================================

export async function checkQuota(
  client: ProtocolClient,
  ownerDid: string,
  estimatedSpendCents?: number
): Promise<{
  allowed: boolean;
  reason?: string;
  currentUsage?: object;
  limits?: object;
  resetsAt?: string;
}> {
  const res = await fetch(`${client.coordinatorUrl}/v1/quotas/${encodeURIComponent(ownerDid)}/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(client.apiKey ? { "x-api-key": client.apiKey } : {}),
    },
    body: JSON.stringify({ estimatedSpendCents }),
  });
  return res.json() as any;
}

export async function getQuota(
  client: ProtocolClient,
  ownerDid: string
): Promise<any> {
  const res = await fetch(`${client.coordinatorUrl}/v1/quotas/${encodeURIComponent(ownerDid)}`, {
    headers: client.apiKey ? { "x-api-key": client.apiKey } : {},
  });
  return res.json() as any;
}

export async function openDispute(
  client: ProtocolClient,
  dispute: {
    workflowId?: string;
    nodeId?: string;
    respondentDid?: string;
    disputeType: "quality" | "timeout" | "incorrect_output" | "overcharge" | "fraud" | "other";
    description: string;
    evidence?: object;
  }
): Promise<{ disputeId: string }> {
  const res = await fetch(`${client.coordinatorUrl}/v1/disputes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(client.apiKey ? { "x-api-key": client.apiKey } : {}),
    },
    body: JSON.stringify(dispute),
  });
  const data = await res.json() as any;
  return { disputeId: data.id };
}

export async function getDispute(
  client: ProtocolClient,
  disputeId: string
): Promise<any> {
  const res = await fetch(`${client.coordinatorUrl}/v1/disputes/${disputeId}`, {
    headers: client.apiKey ? { "x-api-key": client.apiKey } : {},
  });
  return res.json() as any;
}

// ============================================================
// FEDERATION
// ============================================================

export async function listPeers(
  client: ProtocolClient,
  region?: string
): Promise<Array<any>> {
  const url = new URL(`${client.coordinatorUrl}/v1/federation/peers`);
  if (region) url.searchParams.set("region", region);
  
  const res = await fetch(url.toString(), {
    headers: client.apiKey ? { "x-api-key": client.apiKey } : {},
  });
  const data = await res.json() as any;
  return data.peers || [];
}

export async function findBestPeer(
  client: ProtocolClient,
  capability: string,
  requestRegion?: string
): Promise<{ peer: any; routingReason: string } | null> {
  const url = new URL(`${client.coordinatorUrl}/v1/federation/route/${encodeURIComponent(capability)}`);
  if (requestRegion) url.searchParams.set("requestRegion", requestRegion);
  
  const res = await fetch(url.toString(), {
    headers: client.apiKey ? { "x-api-key": client.apiKey } : {},
  });
  if (res.status === 404) return null;
  return res.json() as any;
}

export async function joinSubnet(
  client: ProtocolClient,
  subnetId: string,
  memberDid: string
): Promise<{ success: boolean }> {
  const res = await fetch(`${client.coordinatorUrl}/v1/federation/subnets/${subnetId}/members`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(client.apiKey ? { "x-api-key": client.apiKey } : {}),
    },
    body: JSON.stringify({ memberDid }),
  });
  return { success: res.ok };
}

export async function listSubnets(
  client: ProtocolClient,
  memberDid?: string
): Promise<Array<any>> {
  const url = new URL(`${client.coordinatorUrl}/v1/federation/subnets`);
  if (memberDid) url.searchParams.set("memberDid", memberDid);
  
  const res = await fetch(url.toString(), {
    headers: client.apiKey ? { "x-api-key": client.apiKey } : {},
  });
  const data = await res.json() as any;
  return data.subnets || [];
}

// ============================================================
// UTILITY: Create client from environment
// ============================================================

export function createProtocolClient(options?: Partial<ProtocolClient>): ProtocolClient {
  return {
    coordinatorUrl: options?.coordinatorUrl || process.env.COORDINATOR_URL || "https://coordinator.nooterra.ai",
    apiKey: options?.apiKey || process.env.COORDINATOR_API_KEY,
    agentDid: options?.agentDid || process.env.AGENT_DID,
  };
}
