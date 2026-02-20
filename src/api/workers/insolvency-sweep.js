import { DEFAULT_TENANT_ID, normalizeTenantId } from "../../core/tenancy.js";

function assertPositiveSafeInt(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
}

function normalizeTenantIds(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    const tenantId = normalizeTenantId(raw ?? DEFAULT_TENANT_ID);
    if (seen.has(tenantId)) continue;
    seen.add(tenantId);
    out.push(tenantId);
  }
  out.sort((left, right) => String(left).localeCompare(String(right)));
  return out;
}

async function collectActiveAgentsForTenant({
  tenantId,
  listActiveAgents,
  batchSize,
  maxAgents
}) {
  const agents = [];
  let offset = 0;
  while (agents.length < maxAgents) {
    const remaining = maxAgents - agents.length;
    const pageLimit = Math.max(1, Math.min(batchSize, remaining));
    const page = await listActiveAgents({
      tenantId,
      status: "active",
      limit: pageLimit,
      offset
    });
    const rows = Array.isArray(page) ? page : [];
    if (rows.length === 0) break;
    agents.push(...rows);
    if (rows.length < pageLimit) break;
    offset += rows.length;
  }
  return agents;
}

export function createInsolvencySweepWorker({
  nowIso,
  listTenantIds,
  listActiveAgents,
  evaluateAgent,
  freezeAgent
} = {}) {
  if (typeof nowIso !== "function") throw new TypeError("nowIso is required");
  if (typeof listTenantIds !== "function") throw new TypeError("listTenantIds is required");
  if (typeof listActiveAgents !== "function") throw new TypeError("listActiveAgents is required");
  if (typeof evaluateAgent !== "function") throw new TypeError("evaluateAgent is required");
  if (typeof freezeAgent !== "function") throw new TypeError("freezeAgent is required");

  async function tickInsolvencySweep({
    tenantId = null,
    maxTenants = 50,
    maxMessages = 100,
    batchSize = 100
  } = {}) {
    assertPositiveSafeInt(maxTenants, "maxTenants");
    assertPositiveSafeInt(maxMessages, "maxMessages");
    assertPositiveSafeInt(batchSize, "batchSize");

    const tenantIds = normalizeTenantIds(await listTenantIds({ tenantId, maxTenants }));
    const startedAt = nowIso();
    let scanned = 0;
    let processed = 0;
    let frozen = 0;
    let skipped = 0;
    let failures = 0;
    const outcomes = [];

    for (const currentTenantId of tenantIds) {
      if (processed >= maxMessages) break;
      const remaining = maxMessages - processed;
      const activeAgents = await collectActiveAgentsForTenant({
        tenantId: currentTenantId,
        listActiveAgents,
        batchSize,
        maxAgents: remaining
      });

      for (const identity of activeAgents) {
        if (processed >= maxMessages) break;
        const agentId = typeof identity?.agentId === "string" ? identity.agentId.trim() : "";
        if (!agentId) continue;
        scanned += 1;
        processed += 1;

        try {
          const evaluation = await evaluateAgent({
            tenantId: currentTenantId,
            identity,
            nowAt: startedAt
          });
          if (!(evaluation?.insolvent === true)) {
            skipped += 1;
            outcomes.push({
              tenantId: currentTenantId,
              agentId,
              action: "skipped",
              reasonCode: evaluation?.reasonCode ?? null
            });
            continue;
          }

          const freezeResult = await freezeAgent({
            tenantId: currentTenantId,
            identity,
            evaluation,
            nowAt: startedAt
          });
          if (freezeResult?.changed === true) frozen += 1;
          else skipped += 1;
          outcomes.push({
            tenantId: currentTenantId,
            agentId,
            action: freezeResult?.changed === true ? "frozen" : "noop",
            reasonCode: evaluation?.reasonCode ?? null,
            lifecycleStatus: freezeResult?.lifecycle?.status ?? null
          });
        } catch (err) {
          failures += 1;
          outcomes.push({
            tenantId: currentTenantId,
            agentId,
            action: "error",
            code: err?.code ?? null,
            message: err?.message ?? String(err ?? "")
          });
        }
      }
    }

    return {
      ok: true,
      startedAt,
      tenantCount: tenantIds.length,
      scanned,
      processed,
      frozen,
      skipped,
      failures,
      outcomes
    };
  }

  return {
    tickInsolvencySweep
  };
}
