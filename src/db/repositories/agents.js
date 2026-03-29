/**
 * Agents repository.
 * Extracted from store-pg.js for maintainability.
 *
 * Handles: agent_cards, agent_card_abuse_reports, agent_identities,
 *          agent_passports, agent_wallets, agent_runs, agent_run_events,
 *          agent_run_settlements.
 */

import { DEFAULT_TENANT_ID, makeScopedKey, normalizeTenantId } from "../../core/tenancy.js";
import { AGENT_RUN_EVENT_SCHEMA_VERSION } from "../../core/agent-runs.js";
import { normalizeCapabilityIdentifier } from "../../core/capability-attestation.js";

// ---------------------------------------------------------------------------
// Shared helpers (pure, no DB)
// ---------------------------------------------------------------------------

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function parseIsoOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function parseSafeIntegerOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Row-to-record mappers
// ---------------------------------------------------------------------------

function agentCardSnapshotRowToRecord(row) {
  const agentCard = row?.snapshot_json ?? null;
  if (!agentCard || typeof agentCard !== "object" || Array.isArray(agentCard)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? agentCard?.tenantId ?? DEFAULT_TENANT_ID);
  const agentId =
    row?.aggregate_id && String(row.aggregate_id).trim() !== ""
      ? String(row.aggregate_id).trim()
      : typeof agentCard?.agentId === "string" && agentCard.agentId.trim() !== ""
        ? agentCard.agentId.trim()
        : null;
  if (!agentId) return null;
  return {
    ...agentCard,
    tenantId,
    agentId
  };
}

function agentIdentityRowToRecord(row) {
  const identity = row?.identity_json ?? null;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return null;

  const tenantId = normalizeTenantId(row?.tenant_id ?? identity?.tenantId ?? DEFAULT_TENANT_ID);
  const agentId = row?.agent_id ? String(row.agent_id) : identity?.agentId ? String(identity.agentId) : null;
  if (!agentId) return null;

  const createdAt = parseIsoOrNull(identity?.createdAt ?? row?.created_at) ?? new Date(0).toISOString();
  const updatedAt = parseIsoOrNull(identity?.updatedAt ?? row?.updated_at) ?? createdAt;
  const status = identity?.status ? String(identity.status) : row?.status ? String(row.status) : "active";
  const displayName = identity?.displayName ?? row?.display_name ?? null;
  const owner =
    identity?.owner && typeof identity.owner === "object" && !Array.isArray(identity.owner)
      ? { ...identity.owner }
      : row?.owner_type || row?.owner_id
        ? {
            ownerType: row?.owner_type ? String(row.owner_type) : null,
            ownerId: row?.owner_id ? String(row.owner_id) : null
          }
        : null;
  const revision = parseSafeIntegerOrNull(identity?.revision ?? row?.revision) ?? 0;

  return {
    ...identity,
    tenantId,
    agentId,
    status,
    displayName: displayName === null || displayName === undefined ? null : String(displayName),
    owner,
    revision,
    createdAt,
    updatedAt
  };
}

function agentPassportSnapshotRowToRecord(row) {
  const passport = row?.snapshot_json ?? null;
  if (!passport || typeof passport !== "object" || Array.isArray(passport)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? passport?.tenantId ?? DEFAULT_TENANT_ID);
  const agentId = row?.aggregate_id ? String(row.aggregate_id) : passport?.agentId ? String(passport.agentId) : null;
  if (!agentId) return null;
  const status = passport?.status ? String(passport.status).trim().toLowerCase() : "active";
  if (status !== "active" && status !== "suspended" && status !== "revoked") return null;
  const createdAt = parseIsoOrNull(passport?.createdAt) ?? parseIsoOrNull(row?.updated_at) ?? new Date(0).toISOString();
  const updatedAt = parseIsoOrNull(passport?.updatedAt) ?? parseIsoOrNull(row?.updated_at) ?? createdAt;
  return {
    ...passport,
    tenantId,
    agentId,
    status,
    createdAt,
    updatedAt
  };
}

function agentWalletRowToRecord(row) {
  const wallet = row?.wallet_json ?? null;
  if (!wallet || typeof wallet !== "object" || Array.isArray(wallet)) return null;

  const tenantId = normalizeTenantId(row?.tenant_id ?? wallet?.tenantId ?? DEFAULT_TENANT_ID);
  const agentId = row?.agent_id ? String(row.agent_id) : wallet?.agentId ? String(wallet.agentId) : null;
  if (!agentId) return null;

  const createdAt = parseIsoOrNull(wallet?.createdAt ?? row?.created_at) ?? new Date(0).toISOString();
  const updatedAt = parseIsoOrNull(wallet?.updatedAt ?? row?.updated_at) ?? createdAt;
  const currency =
    wallet?.currency && String(wallet.currency).trim() !== ""
      ? String(wallet.currency).toUpperCase()
      : row?.currency
        ? String(row.currency).toUpperCase()
        : "USD";
  const availableCents = parseSafeIntegerOrNull(wallet?.availableCents ?? row?.available_cents) ?? 0;
  const escrowLockedCents = parseSafeIntegerOrNull(wallet?.escrowLockedCents ?? row?.escrow_locked_cents) ?? 0;
  const totalCreditedCents = parseSafeIntegerOrNull(wallet?.totalCreditedCents ?? row?.total_credited_cents) ?? 0;
  const totalDebitedCents = parseSafeIntegerOrNull(wallet?.totalDebitedCents ?? row?.total_debited_cents) ?? 0;
  const revision = parseSafeIntegerOrNull(wallet?.revision ?? row?.revision) ?? 0;
  const walletId =
    wallet?.walletId && String(wallet.walletId).trim() !== ""
      ? String(wallet.walletId)
      : row?.wallet_id && String(row.wallet_id).trim() !== ""
        ? String(row.wallet_id)
        : `wallet_${agentId}`;

  return {
    ...wallet,
    tenantId,
    agentId,
    walletId,
    currency,
    availableCents,
    escrowLockedCents,
    totalCreditedCents,
    totalDebitedCents,
    revision,
    createdAt,
    updatedAt
  };
}

function agentRunSnapshotRowToRecord(row) {
  const run = row?.snapshot_json ?? null;
  if (!run || typeof run !== "object" || Array.isArray(run)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? run?.tenantId ?? DEFAULT_TENANT_ID);
  const runId = row?.aggregate_id ? String(row.aggregate_id) : run?.runId ? String(run.runId) : null;
  if (!runId) return null;
  return {
    ...run,
    tenantId,
    runId
  };
}

function normalizeAgentRunEventRecord(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return event;
  if (event.schemaVersion === AGENT_RUN_EVENT_SCHEMA_VERSION) return event;
  return { ...event, schemaVersion: AGENT_RUN_EVENT_SCHEMA_VERSION };
}

function agentRunSettlementRowToRecord(row) {
  const settlement = row?.settlement_json ?? null;
  if (!settlement || typeof settlement !== "object" || Array.isArray(settlement)) return null;

  const tenantId = normalizeTenantId(row?.tenant_id ?? settlement?.tenantId ?? DEFAULT_TENANT_ID);
  const runId = row?.run_id ? String(row.run_id) : settlement?.runId ? String(settlement.runId) : null;
  if (!runId) return null;

  const createdAt = parseIsoOrNull(settlement?.createdAt ?? row?.created_at ?? row?.locked_at) ?? new Date(0).toISOString();
  const updatedAt = parseIsoOrNull(settlement?.updatedAt ?? row?.updated_at) ?? createdAt;
  const status = settlement?.status ? String(settlement.status) : row?.status ? String(row.status) : "locked";
  const agentId = settlement?.agentId ?? (row?.agent_id ? String(row.agent_id) : null);
  const payerAgentId = settlement?.payerAgentId ?? (row?.payer_agent_id ? String(row.payer_agent_id) : null);
  const amountCents = parseSafeIntegerOrNull(settlement?.amountCents ?? row?.amount_cents) ?? null;
  const revision = parseSafeIntegerOrNull(settlement?.revision ?? row?.revision) ?? 0;
  const currency =
    settlement?.currency && String(settlement.currency).trim() !== ""
      ? String(settlement.currency).toUpperCase()
      : row?.currency
        ? String(row.currency).toUpperCase()
        : "USD";
  const lockedAt = parseIsoOrNull(settlement?.lockedAt ?? row?.locked_at) ?? createdAt;
  const resolvedAt = parseIsoOrNull(settlement?.resolvedAt ?? row?.resolved_at);
  const resolutionEventId =
    settlement?.resolutionEventId && String(settlement.resolutionEventId).trim() !== ""
      ? String(settlement.resolutionEventId)
      : row?.resolution_event_id && String(row.resolution_event_id).trim() !== ""
        ? String(row.resolution_event_id)
        : null;
  const runStatus =
    settlement?.runStatus && String(settlement.runStatus).trim() !== ""
      ? String(settlement.runStatus)
      : row?.run_status && String(row.run_status).trim() !== ""
        ? String(row.run_status)
        : null;

  return {
    ...settlement,
    tenantId,
    runId,
    status,
    agentId,
    payerAgentId,
    amountCents,
    currency,
    resolutionEventId,
    runStatus,
    revision,
    lockedAt,
    resolvedAt,
    createdAt,
    updatedAt
  };
}

// ---------------------------------------------------------------------------
// Repository factory
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {import("pg").Pool} opts.pool
 * @param {Map} opts.agentCards          - in-memory fallback map
 * @param {Map} opts.agentCardAbuseReports - in-memory fallback map
 * @param {Map} opts.agentIdentities     - in-memory fallback map
 * @param {Map} opts.agentPassports      - in-memory fallback map
 * @param {Map} opts.agentWallets        - in-memory fallback map
 * @param {Map} opts.agentRuns           - in-memory fallback map
 * @param {Map} opts.agentRunEvents      - in-memory fallback map
 * @param {Map} opts.agentRunSettlements - in-memory fallback map
 */
export function createAgentsRepository({
  pool,
  agentCards,
  agentCardAbuseReports,
  agentIdentities,
  agentPassports,
  agentWallets,
  agentRuns,
  agentRunEvents,
  agentRunSettlements
}) {
  // -------------------------------------------------------------------------
  // Agent Cards
  // -------------------------------------------------------------------------

  async function getAgentCard({ tenantId = DEFAULT_TENANT_ID, agentId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(agentId, "agentId");
    const normalizedAgentId = String(agentId).trim();
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'agent_card' AND aggregate_id = $2
          LIMIT 1
        `,
        [tenantId, normalizedAgentId]
      );
      return res.rows.length ? agentCardSnapshotRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return agentCards.get(makeScopedKey({ tenantId, id: normalizedAgentId })) ?? null;
    }
  }

  // putAgentCardAbuseReport: TODO - depends on store.commitTx closure, left in store-pg.js

  async function getAgentCardAbuseReport({ tenantId = DEFAULT_TENANT_ID, reportId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(reportId, "reportId");
    const normalizedReportId = String(reportId).trim();
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'agent_card_abuse_report' AND aggregate_id = $2
          LIMIT 1
        `,
        [tenantId, normalizedReportId]
      );
      if (!res.rows.length) return null;
      const report = res.rows[0]?.snapshot_json ?? null;
      if (!report || typeof report !== "object" || Array.isArray(report)) return null;
      return { ...report, tenantId, reportId: normalizedReportId };
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return agentCardAbuseReports.get(makeScopedKey({ tenantId, id: normalizedReportId })) ?? null;
    }
  }

  async function listAgentCardAbuseReports({
    tenantId = DEFAULT_TENANT_ID,
    subjectAgentId = null,
    reasonCode = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const subjectFilter =
      subjectAgentId === null || subjectAgentId === undefined || String(subjectAgentId).trim() === "" ? null : String(subjectAgentId).trim();
    const reasonFilter =
      reasonCode === null || reasonCode === undefined || String(reasonCode).trim() === "" ? null : String(reasonCode).trim().toUpperCase();

    const applyFilters = (rows) => {
      const filtered = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (subjectFilter && String(row.subjectAgentId ?? "") !== subjectFilter) continue;
        if (reasonFilter && String(row.reasonCode ?? "").toUpperCase() !== reasonFilter) continue;
        filtered.push(row);
      }
      filtered.sort((left, right) => {
        const leftAt = Number.isFinite(Date.parse(String(left?.createdAt ?? ""))) ? Date.parse(String(left.createdAt)) : Number.NaN;
        const rightAt = Number.isFinite(Date.parse(String(right?.createdAt ?? ""))) ? Date.parse(String(right.createdAt)) : Number.NaN;
        if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && rightAt !== leftAt) return rightAt - leftAt;
        return String(left?.reportId ?? "").localeCompare(String(right?.reportId ?? ""));
      });
      return filtered.slice(safeOffset, safeOffset + safeLimit);
    };

    try {
      const params = [tenantId];
      const where = ["tenant_id = $1", "aggregate_type = 'agent_card_abuse_report'"];
      if (subjectFilter !== null) {
        params.push(subjectFilter);
        where.push(`snapshot_json->>'subjectAgentId' = $${params.length}`);
      }
      if (reasonFilter !== null) {
        params.push(reasonFilter);
        where.push(`upper(coalesce(snapshot_json->>'reasonCode', '')) = $${params.length}`);
      }
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE ${where.join(" AND ")}
          ORDER BY updated_at DESC, aggregate_id ASC
        `,
        params
      );
      return applyFilters(
        res.rows
          .map((row) => {
            const report = row?.snapshot_json ?? null;
            if (!report || typeof report !== "object" || Array.isArray(report)) return null;
            const reportId = row?.aggregate_id ? String(row.aggregate_id).trim() : null;
            if (!reportId) return null;
            return { ...report, tenantId: normalizeTenantId(row?.tenant_id ?? tenantId), reportId };
          })
          .filter(Boolean)
      );
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return applyFilters(Array.from(agentCardAbuseReports.values()));
    }
  }

  async function listAgentCards({
    tenantId = DEFAULT_TENANT_ID,
    agentId = null,
    status = null,
    visibility = null,
    capability = null,
    executionCoordinatorDid = null,
    toolId = null,
    toolMcpName = null,
    toolRiskClass = null,
    toolSideEffecting = null,
    toolMaxPriceCents = null,
    toolRequiresEvidenceKind = null,
    runtime = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (agentId !== null && (typeof agentId !== "string" || agentId.trim() === "")) {
      throw new TypeError("agentId must be null or a non-empty string");
    }
    if (status !== null && (typeof status !== "string" || status.trim() === "")) {
      throw new TypeError("status must be null or a non-empty string");
    }
    if (visibility !== null && (typeof visibility !== "string" || visibility.trim() === "")) {
      throw new TypeError("visibility must be null or a non-empty string");
    }
    if (capability !== null && (typeof capability !== "string" || capability.trim() === "")) {
      throw new TypeError("capability must be null or a non-empty string");
    }
    if (executionCoordinatorDid !== null && (typeof executionCoordinatorDid !== "string" || executionCoordinatorDid.trim() === "")) {
      throw new TypeError("executionCoordinatorDid must be null or a non-empty string");
    }
    if (runtime !== null && (typeof runtime !== "string" || runtime.trim() === "")) {
      throw new TypeError("runtime must be null or a non-empty string");
    }
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const agentIdFilter = agentId === null || agentId === undefined || String(agentId).trim() === "" ? null : String(agentId).trim();
    const statusFilter = status === null || status === undefined || String(status).trim() === "" ? null : String(status).trim().toLowerCase();
    const visibilityFilter =
      visibility === null || visibility === undefined || String(visibility).trim() === "" ? null : String(visibility).trim().toLowerCase();
    const capabilityFilter =
      capability === null || capability === undefined || String(capability).trim() === ""
        ? null
        : normalizeCapabilityIdentifier(capability, { name: "capability" });
    const executionCoordinatorDidFilter =
      executionCoordinatorDid === null || executionCoordinatorDid === undefined || String(executionCoordinatorDid).trim() === ""
        ? null
        : String(executionCoordinatorDid).trim();
    const toolIdFilter = toolId === null || toolId === undefined || String(toolId).trim() === "" ? null : String(toolId).trim();
    const toolMcpNameFilter =
      toolMcpName === null || toolMcpName === undefined || String(toolMcpName).trim() === "" ? null : String(toolMcpName).trim().toLowerCase();
    const toolRiskClassFilter =
      toolRiskClass === null || toolRiskClass === undefined || String(toolRiskClass).trim() === ""
        ? null
        : String(toolRiskClass).trim().toLowerCase();
    if (
      toolRiskClassFilter !== null &&
      toolRiskClassFilter !== "read" &&
      toolRiskClassFilter !== "compute" &&
      toolRiskClassFilter !== "action" &&
      toolRiskClassFilter !== "financial"
    ) {
      throw new TypeError("toolRiskClass must be read|compute|action|financial");
    }
    const toolSideEffectingFilter =
      toolSideEffecting === null || toolSideEffecting === undefined
        ? null
        : typeof toolSideEffecting === "boolean"
          ? toolSideEffecting
          : (() => {
              throw new TypeError("toolSideEffecting must be boolean");
            })();
    const toolMaxPriceCentsFilter =
      toolMaxPriceCents === null || toolMaxPriceCents === undefined || toolMaxPriceCents === ""
        ? null
        : (() => {
            const parsed = Number(toolMaxPriceCents);
            if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("toolMaxPriceCents must be a non-negative safe integer");
            return parsed;
          })();
    const toolRequiresEvidenceKindFilter =
      toolRequiresEvidenceKind === null || toolRequiresEvidenceKind === undefined || String(toolRequiresEvidenceKind).trim() === ""
        ? null
        : String(toolRequiresEvidenceKind).trim().toLowerCase();
    if (
      toolRequiresEvidenceKindFilter !== null &&
      toolRequiresEvidenceKindFilter !== "artifact" &&
      toolRequiresEvidenceKindFilter !== "hash" &&
      toolRequiresEvidenceKindFilter !== "verification_report" &&
      toolRequiresEvidenceKindFilter !== "execution_attestation"
    ) {
      throw new TypeError("toolRequiresEvidenceKind must be artifact|hash|verification_report|execution_attestation");
    }
    const runtimeFilter = runtime === null || runtime === undefined || String(runtime).trim() === "" ? null : String(runtime).trim().toLowerCase();
    const hasToolDescriptorFilter =
      toolIdFilter !== null ||
      toolMcpNameFilter !== null ||
      toolRiskClassFilter !== null ||
      toolSideEffectingFilter !== null ||
      toolMaxPriceCentsFilter !== null ||
      toolRequiresEvidenceKindFilter !== null;

    const matchesToolDescriptorFilters = (row) => {
      if (!hasToolDescriptorFilter) return true;
      const tools = Array.isArray(row?.tools) ? row.tools : [];
      if (tools.length === 0) return false;
      return tools.some((tool) => {
        if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
        const descriptorToolId = typeof tool.toolId === "string" ? tool.toolId.trim() : "";
        if (toolIdFilter !== null && descriptorToolId !== toolIdFilter) return false;
        const descriptorMcpName = typeof tool.mcpToolName === "string" ? tool.mcpToolName.trim().toLowerCase() : "";
        if (toolMcpNameFilter !== null && descriptorMcpName !== toolMcpNameFilter) return false;
        const descriptorRiskClass = typeof tool.riskClass === "string" ? tool.riskClass.trim().toLowerCase() : "";
        if (toolRiskClassFilter !== null && descriptorRiskClass !== toolRiskClassFilter) return false;
        const descriptorSideEffecting = tool.sideEffecting === true;
        if (toolSideEffectingFilter !== null && descriptorSideEffecting !== toolSideEffectingFilter) return false;
        const descriptorAmountCents = Number(tool?.pricing?.amountCents);
        if (
          toolMaxPriceCentsFilter !== null &&
          (!Number.isSafeInteger(descriptorAmountCents) || descriptorAmountCents > toolMaxPriceCentsFilter)
        ) {
          return false;
        }
        if (toolRequiresEvidenceKindFilter !== null) {
          const evidenceKinds = Array.isArray(tool.requiresEvidenceKinds)
            ? tool.requiresEvidenceKinds.map((entry) => String(entry ?? "").trim().toLowerCase())
            : [];
          if (!evidenceKinds.includes(toolRequiresEvidenceKindFilter)) return false;
        }
        return true;
      });
    };

    const applyFilters = (rows) => {
      const filtered = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (agentIdFilter && String(row.agentId ?? "") !== agentIdFilter) continue;
        if (statusFilter && String(row.status ?? "").toLowerCase() !== statusFilter) continue;
        if (visibilityFilter && String(row.visibility ?? "").toLowerCase() !== visibilityFilter) continue;
        if (executionCoordinatorDidFilter && String(row.executionCoordinatorDid ?? "") !== executionCoordinatorDidFilter) continue;
        if (capabilityFilter) {
          const capabilities = Array.isArray(row.capabilities) ? row.capabilities : [];
          if (!capabilities.includes(capabilityFilter)) continue;
        }
        if (runtimeFilter) {
          const rowRuntime =
            row?.host && typeof row.host === "object" && !Array.isArray(row.host) && typeof row.host.runtime === "string"
              ? row.host.runtime.trim().toLowerCase()
              : "";
          if (rowRuntime !== runtimeFilter) continue;
        }
        if (!matchesToolDescriptorFilters(row)) continue;
        filtered.push(row);
      }
      filtered.sort((left, right) => String(left?.agentId ?? "").localeCompare(String(right?.agentId ?? "")));
      return filtered.slice(safeOffset, safeOffset + safeLimit);
    };

    try {
      const params = [tenantId];
      const where = ["tenant_id = $1", "aggregate_type = 'agent_card'"];
      if (agentIdFilter !== null) {
        params.push(agentIdFilter);
        where.push(`aggregate_id = $${params.length}`);
      }
      if (statusFilter !== null) {
        params.push(statusFilter);
        where.push(`lower(coalesce(snapshot_json->>'status', '')) = $${params.length}`);
      }
      if (visibilityFilter !== null) {
        params.push(visibilityFilter);
        where.push(`lower(coalesce(snapshot_json->>'visibility', '')) = $${params.length}`);
      }
      if (capabilityFilter !== null) {
        params.push(capabilityFilter);
        where.push(
          `EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(snapshot_json->'capabilities') = 'array' THEN snapshot_json->'capabilities' ELSE '[]'::jsonb END
            ) AS capability(value)
            WHERE capability.value = $${params.length}
          )`
        );
      }
      if (executionCoordinatorDidFilter !== null) {
        params.push(executionCoordinatorDidFilter);
        where.push(`btrim(coalesce(snapshot_json->>'executionCoordinatorDid', '')) = $${params.length}`);
      }
      if (runtimeFilter !== null) {
        params.push(runtimeFilter);
        where.push(`lower(coalesce(snapshot_json->'host'->>'runtime', '')) = $${params.length}`);
      }
      if (hasToolDescriptorFilter) {
        const toolClauses = [];
        if (toolIdFilter !== null) {
          params.push(toolIdFilter);
          toolClauses.push(`btrim(tool->>'toolId') = $${params.length}`);
        }
        if (toolMcpNameFilter !== null) {
          params.push(toolMcpNameFilter);
          toolClauses.push(`lower(btrim(tool->>'mcpToolName')) = $${params.length}`);
        }
        if (toolRiskClassFilter !== null) {
          params.push(toolRiskClassFilter);
          toolClauses.push(`lower(btrim(tool->>'riskClass')) = $${params.length}`);
        }
        if (toolSideEffectingFilter !== null) {
          params.push(toolSideEffectingFilter);
          toolClauses.push(
            `(CASE WHEN jsonb_typeof(tool->'sideEffecting') = 'boolean' THEN (tool->>'sideEffecting')::boolean ELSE false END) = $${params.length}`
          );
        }
        if (toolMaxPriceCentsFilter !== null) {
          params.push(toolMaxPriceCentsFilter);
          toolClauses.push(
            `(CASE WHEN (tool->'pricing'->>'amountCents') ~ '^[0-9]+$' THEN (tool->'pricing'->>'amountCents')::bigint ELSE NULL END) <= $${params.length}`
          );
        }
        if (toolRequiresEvidenceKindFilter !== null) {
          params.push(toolRequiresEvidenceKindFilter);
          toolClauses.push(
            `EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(
                CASE
                  WHEN jsonb_typeof(tool->'requiresEvidenceKinds') = 'array' THEN tool->'requiresEvidenceKinds'
                  ELSE '[]'::jsonb
                END
              ) AS kind(value)
              WHERE lower(btrim(kind.value)) = $${params.length}
            )`
          );
        }
        where.push(
          `EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(snapshot_json->'tools') = 'array' THEN snapshot_json->'tools' ELSE '[]'::jsonb END
            ) AS tool
            WHERE ${toolClauses.join(" AND ")}
          )`
        );
      }
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE ${where.join(" AND ")}
          ORDER BY aggregate_id ASC
        `,
        params
      );
      return applyFilters(res.rows.map(agentCardSnapshotRowToRecord).filter(Boolean));
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return applyFilters(Array.from(agentCards.values()));
    }
  }

  async function listAgentCardsPublic({
    agentId = null,
    status = null,
    visibility = "public",
    capability = null,
    executionCoordinatorDid = null,
    toolId = null,
    toolMcpName = null,
    toolRiskClass = null,
    toolSideEffecting = null,
    toolMaxPriceCents = null,
    toolRequiresEvidenceKind = null,
    runtime = null,
    limit = 200,
    offset = 0
  } = {}) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    if (agentId !== null && (typeof agentId !== "string" || agentId.trim() === "")) {
      throw new TypeError("agentId must be null or a non-empty string");
    }
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const agentIdFilter = agentId === null || agentId === undefined || String(agentId).trim() === "" ? null : String(agentId).trim();
    const statusFilter = status === null || status === undefined || String(status).trim() === "" ? null : String(status).trim().toLowerCase();
    const visibilityFilter =
      visibility === null || visibility === undefined || String(visibility).trim() === "" ? "public" : String(visibility).trim().toLowerCase();
    if (visibilityFilter !== "public") throw new TypeError("visibility must be public");
    const capabilityFilter =
      capability === null || capability === undefined || String(capability).trim() === ""
        ? null
        : normalizeCapabilityIdentifier(capability, { name: "capability" });
    const executionCoordinatorDidFilter =
      executionCoordinatorDid === null || executionCoordinatorDid === undefined || String(executionCoordinatorDid).trim() === ""
        ? null
        : String(executionCoordinatorDid).trim();
    const toolIdFilter = toolId === null || toolId === undefined || String(toolId).trim() === "" ? null : String(toolId).trim();
    const toolMcpNameFilter =
      toolMcpName === null || toolMcpName === undefined || String(toolMcpName).trim() === "" ? null : String(toolMcpName).trim().toLowerCase();
    const toolRiskClassFilter =
      toolRiskClass === null || toolRiskClass === undefined || String(toolRiskClass).trim() === ""
        ? null
        : String(toolRiskClass).trim().toLowerCase();
    if (
      toolRiskClassFilter !== null &&
      toolRiskClassFilter !== "read" &&
      toolRiskClassFilter !== "compute" &&
      toolRiskClassFilter !== "action" &&
      toolRiskClassFilter !== "financial"
    ) {
      throw new TypeError("toolRiskClass must be read|compute|action|financial");
    }
    const toolSideEffectingFilter =
      toolSideEffecting === null || toolSideEffecting === undefined
        ? null
        : typeof toolSideEffecting === "boolean"
          ? toolSideEffecting
          : (() => {
              throw new TypeError("toolSideEffecting must be boolean");
            })();
    const toolMaxPriceCentsFilter =
      toolMaxPriceCents === null || toolMaxPriceCents === undefined || toolMaxPriceCents === ""
        ? null
        : (() => {
            const parsed = Number(toolMaxPriceCents);
            if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("toolMaxPriceCents must be a non-negative safe integer");
            return parsed;
          })();
    const toolRequiresEvidenceKindFilter =
      toolRequiresEvidenceKind === null || toolRequiresEvidenceKind === undefined || String(toolRequiresEvidenceKind).trim() === ""
        ? null
        : String(toolRequiresEvidenceKind).trim().toLowerCase();
    if (
      toolRequiresEvidenceKindFilter !== null &&
      toolRequiresEvidenceKindFilter !== "artifact" &&
      toolRequiresEvidenceKindFilter !== "hash" &&
      toolRequiresEvidenceKindFilter !== "verification_report" &&
      toolRequiresEvidenceKindFilter !== "execution_attestation"
    ) {
      throw new TypeError("toolRequiresEvidenceKind must be artifact|hash|verification_report|execution_attestation");
    }
    const runtimeFilter = runtime === null || runtime === undefined || String(runtime).trim() === "" ? null : String(runtime).trim().toLowerCase();
    const hasToolDescriptorFilter =
      toolIdFilter !== null ||
      toolMcpNameFilter !== null ||
      toolRiskClassFilter !== null ||
      toolSideEffectingFilter !== null ||
      toolMaxPriceCentsFilter !== null ||
      toolRequiresEvidenceKindFilter !== null;

    const matchesToolDescriptorFilters = (row) => {
      if (!hasToolDescriptorFilter) return true;
      const tools = Array.isArray(row?.tools) ? row.tools : [];
      if (tools.length === 0) return false;
      return tools.some((tool) => {
        if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
        const descriptorToolId = typeof tool.toolId === "string" ? tool.toolId.trim() : "";
        if (toolIdFilter !== null && descriptorToolId !== toolIdFilter) return false;
        const descriptorMcpName = typeof tool.mcpToolName === "string" ? tool.mcpToolName.trim().toLowerCase() : "";
        if (toolMcpNameFilter !== null && descriptorMcpName !== toolMcpNameFilter) return false;
        const descriptorRiskClass = typeof tool.riskClass === "string" ? tool.riskClass.trim().toLowerCase() : "";
        if (toolRiskClassFilter !== null && descriptorRiskClass !== toolRiskClassFilter) return false;
        const descriptorSideEffecting = tool.sideEffecting === true;
        if (toolSideEffectingFilter !== null && descriptorSideEffecting !== toolSideEffectingFilter) return false;
        const descriptorAmountCents = Number(tool?.pricing?.amountCents);
        if (
          toolMaxPriceCentsFilter !== null &&
          (!Number.isSafeInteger(descriptorAmountCents) || descriptorAmountCents > toolMaxPriceCentsFilter)
        ) {
          return false;
        }
        if (toolRequiresEvidenceKindFilter !== null) {
          const evidenceKinds = Array.isArray(tool.requiresEvidenceKinds)
            ? tool.requiresEvidenceKinds.map((entry) => String(entry ?? "").trim().toLowerCase())
            : [];
          if (!evidenceKinds.includes(toolRequiresEvidenceKindFilter)) return false;
        }
        return true;
      });
    };

    const applyFilters = (rows) => {
      const filtered = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (String(row.visibility ?? "").toLowerCase() !== "public") continue;
        if (agentIdFilter !== null && String(row.agentId ?? "") !== agentIdFilter) continue;
        if (statusFilter && String(row.status ?? "").toLowerCase() !== statusFilter) continue;
        if (executionCoordinatorDidFilter && String(row.executionCoordinatorDid ?? "") !== executionCoordinatorDidFilter) continue;
        if (capabilityFilter) {
          const capabilities = Array.isArray(row.capabilities) ? row.capabilities : [];
          if (!capabilities.includes(capabilityFilter)) continue;
        }
        if (runtimeFilter) {
          const rowRuntime =
            row?.host && typeof row.host === "object" && !Array.isArray(row.host) && typeof row.host.runtime === "string"
              ? row.host.runtime.trim().toLowerCase()
              : "";
          if (rowRuntime !== runtimeFilter) continue;
        }
        if (!matchesToolDescriptorFilters(row)) continue;
        filtered.push(row);
      }
      filtered.sort((left, right) => {
        const tenantOrder = String(left?.tenantId ?? "").localeCompare(String(right?.tenantId ?? ""));
        if (tenantOrder !== 0) return tenantOrder;
        return String(left?.agentId ?? "").localeCompare(String(right?.agentId ?? ""));
      });
      return filtered.slice(safeOffset, safeOffset + safeLimit);
    };

    try {
      const params = [];
      const where = ["aggregate_type = 'agent_card'"];
      if (agentIdFilter !== null) {
        params.push(agentIdFilter);
        where.push(`aggregate_id = $${params.length}`);
      }
      params.push("public");
      where.push(`lower(coalesce(snapshot_json->>'visibility', '')) = $${params.length}`);
      if (statusFilter !== null) {
        params.push(statusFilter);
        where.push(`lower(coalesce(snapshot_json->>'status', '')) = $${params.length}`);
      }
      if (capabilityFilter !== null) {
        params.push(capabilityFilter);
        where.push(
          `EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(snapshot_json->'capabilities') = 'array' THEN snapshot_json->'capabilities' ELSE '[]'::jsonb END
            ) AS capability(value)
            WHERE capability.value = $${params.length}
          )`
        );
      }
      if (executionCoordinatorDidFilter !== null) {
        params.push(executionCoordinatorDidFilter);
        where.push(`btrim(coalesce(snapshot_json->>'executionCoordinatorDid', '')) = $${params.length}`);
      }
      if (runtimeFilter !== null) {
        params.push(runtimeFilter);
        where.push(`lower(coalesce(snapshot_json->'host'->>'runtime', '')) = $${params.length}`);
      }
      if (hasToolDescriptorFilter) {
        const toolClauses = [];
        if (toolIdFilter !== null) {
          params.push(toolIdFilter);
          toolClauses.push(`btrim(tool->>'toolId') = $${params.length}`);
        }
        if (toolMcpNameFilter !== null) {
          params.push(toolMcpNameFilter);
          toolClauses.push(`lower(btrim(tool->>'mcpToolName')) = $${params.length}`);
        }
        if (toolRiskClassFilter !== null) {
          params.push(toolRiskClassFilter);
          toolClauses.push(`lower(btrim(tool->>'riskClass')) = $${params.length}`);
        }
        if (toolSideEffectingFilter !== null) {
          params.push(toolSideEffectingFilter);
          toolClauses.push(
            `(CASE WHEN jsonb_typeof(tool->'sideEffecting') = 'boolean' THEN (tool->>'sideEffecting')::boolean ELSE false END) = $${params.length}`
          );
        }
        if (toolMaxPriceCentsFilter !== null) {
          params.push(toolMaxPriceCentsFilter);
          toolClauses.push(
            `(CASE WHEN (tool->'pricing'->>'amountCents') ~ '^[0-9]+$' THEN (tool->'pricing'->>'amountCents')::bigint ELSE NULL END) <= $${params.length}`
          );
        }
        if (toolRequiresEvidenceKindFilter !== null) {
          params.push(toolRequiresEvidenceKindFilter);
          toolClauses.push(
            `EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(
                CASE
                  WHEN jsonb_typeof(tool->'requiresEvidenceKinds') = 'array' THEN tool->'requiresEvidenceKinds'
                  ELSE '[]'::jsonb
                END
              ) AS kind(value)
              WHERE lower(btrim(kind.value)) = $${params.length}
            )`
          );
        }
        where.push(
          `EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(snapshot_json->'tools') = 'array' THEN snapshot_json->'tools' ELSE '[]'::jsonb END
            ) AS tool
            WHERE ${toolClauses.join(" AND ")}
          )`
        );
      }
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE ${where.join(" AND ")}
          ORDER BY tenant_id ASC, aggregate_id ASC
        `,
        params
      );
      return applyFilters(res.rows.map(agentCardSnapshotRowToRecord).filter(Boolean));
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return applyFilters(Array.from(agentCards.values()));
    }
  }

  // -------------------------------------------------------------------------
  // Agent Identities
  // -------------------------------------------------------------------------

  async function getAgentIdentity({ tenantId = DEFAULT_TENANT_ID, agentId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(agentId, "agentId");
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, agent_id, status, display_name, owner_type, owner_id, revision, created_at, updated_at, identity_json
          FROM agent_identities
          WHERE tenant_id = $1 AND agent_id = $2
          LIMIT 1
        `,
        [tenantId, String(agentId)]
      );
      return res.rows.length ? agentIdentityRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return agentIdentities.get(makeScopedKey({ tenantId, id: String(agentId) })) ?? null;
    }
  }

  async function listAgentIdentities({ tenantId = DEFAULT_TENANT_ID, status = null, limit = 200, offset = 0 } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (status !== null) assertNonEmptyString(status, "status");
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const statusFilter = status === null ? null : String(status).trim().toLowerCase();

    try {
      const params = [tenantId];
      const where = ["tenant_id = $1"];
      if (statusFilter !== null) {
        params.push(statusFilter);
        where.push(`lower(status) = $${params.length}`);
      }
      params.push(safeLimit);
      params.push(safeOffset);

      const res = await pool.query(
        `
          SELECT tenant_id, agent_id, status, display_name, owner_type, owner_id, revision, created_at, updated_at, identity_json
          FROM agent_identities
          WHERE ${where.join(" AND ")}
          ORDER BY agent_id ASC
          LIMIT $${params.length - 1} OFFSET $${params.length}
        `,
        params
      );
      return res.rows.map(agentIdentityRowToRecord).filter(Boolean);
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      const out = [];
      for (const record of agentIdentities.values()) {
        if (!record || typeof record !== "object") continue;
        if (normalizeTenantId(record.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (statusFilter !== null && String(record.status ?? "").toLowerCase() !== statusFilter) continue;
        out.push(record);
      }
      out.sort((left, right) => String(left.agentId ?? "").localeCompare(String(right.agentId ?? "")));
      return out.slice(safeOffset, safeOffset + safeLimit);
    }
  }

  // -------------------------------------------------------------------------
  // Agent Passports
  // -------------------------------------------------------------------------

  async function getAgentPassport({ tenantId = DEFAULT_TENANT_ID, agentId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(agentId, "agentId");
    const normalizedAgentId = String(agentId).trim();
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json, updated_at
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'agent_passport' AND aggregate_id = $2
          LIMIT 1
        `,
        [tenantId, normalizedAgentId]
      );
      return res.rows.length ? agentPassportSnapshotRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return agentPassports.get(makeScopedKey({ tenantId, id: normalizedAgentId })) ?? null;
    }
  }

  // putAgentPassport: TODO - depends on store.commitTx closure, left in store-pg.js

  // -------------------------------------------------------------------------
  // Agent Wallets
  // -------------------------------------------------------------------------

  async function getAgentWallet({ tenantId = DEFAULT_TENANT_ID, agentId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(agentId, "agentId");
    try {
      const res = await pool.query(
        `
          SELECT
            tenant_id, agent_id, wallet_id, currency,
            available_cents, escrow_locked_cents, total_credited_cents, total_debited_cents,
            revision, created_at, updated_at, wallet_json
          FROM agent_wallets
          WHERE tenant_id = $1 AND agent_id = $2
          LIMIT 1
        `,
        [tenantId, String(agentId)]
      );
      return res.rows.length ? agentWalletRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return agentWallets.get(makeScopedKey({ tenantId, id: String(agentId) })) ?? null;
    }
  }

  // putAgentWallet: TODO - depends on store.commitTx closure, left in store-pg.js

  // -------------------------------------------------------------------------
  // Agent Runs
  // -------------------------------------------------------------------------

  async function getAgentRun({ tenantId = DEFAULT_TENANT_ID, runId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(runId, "runId");
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'agent_run' AND aggregate_id = $2
          LIMIT 1
        `,
        [tenantId, String(runId)]
      );
      return res.rows.length ? agentRunSnapshotRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return agentRuns.get(makeScopedKey({ tenantId, id: String(runId) })) ?? null;
    }
  }

  async function listAgentRuns({ tenantId = DEFAULT_TENANT_ID, agentId = null, status = null, limit = 200, offset = 0 } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (agentId !== null) assertNonEmptyString(agentId, "agentId");
    if (status !== null) assertNonEmptyString(status, "status");
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const statusFilter = status === null ? null : String(status).trim().toLowerCase();
    const agentIdFilter = agentId === null ? null : String(agentId);

    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1
            AND aggregate_type = 'agent_run'
            AND ($2::text IS NULL OR snapshot_json->>'agentId' = $2)
            AND ($3::text IS NULL OR lower(snapshot_json->>'status') = $3)
          ORDER BY aggregate_id ASC
          LIMIT $4 OFFSET $5
        `,
        [tenantId, agentIdFilter, statusFilter, safeLimit, safeOffset]
      );
      return res.rows.map(agentRunSnapshotRowToRecord).filter(Boolean);
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      const out = [];
      for (const run of agentRuns.values()) {
        if (!run || typeof run !== "object") continue;
        if (normalizeTenantId(run.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (agentIdFilter !== null && String(run.agentId ?? "") !== agentIdFilter) continue;
        if (statusFilter !== null && String(run.status ?? "").toLowerCase() !== statusFilter) continue;
        out.push(run);
      }
      out.sort((left, right) => String(left.runId ?? "").localeCompare(String(right.runId ?? "")));
      return out.slice(safeOffset, safeOffset + safeLimit);
    }
  }

  async function countAgentRuns({ tenantId = DEFAULT_TENANT_ID, agentId = null, status = null } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (agentId !== null) assertNonEmptyString(agentId, "agentId");
    if (status !== null) assertNonEmptyString(status, "status");
    const statusFilter = status === null ? null : String(status).trim().toLowerCase();
    const agentIdFilter = agentId === null ? null : String(agentId);

    try {
      const res = await pool.query(
        `
          SELECT COUNT(*)::bigint AS c
          FROM snapshots
          WHERE tenant_id = $1
            AND aggregate_type = 'agent_run'
            AND ($2::text IS NULL OR snapshot_json->>'agentId' = $2)
            AND ($3::text IS NULL OR lower(snapshot_json->>'status') = $3)
        `,
        [tenantId, agentIdFilter, statusFilter]
      );
      const c = Number(res.rows[0]?.c ?? 0);
      return Number.isSafeInteger(c) && c >= 0 ? c : 0;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      let count = 0;
      for (const run of agentRuns.values()) {
        if (!run || typeof run !== "object") continue;
        if (normalizeTenantId(run.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (agentIdFilter !== null && String(run.agentId ?? "") !== agentIdFilter) continue;
        if (statusFilter !== null && String(run.status ?? "").toLowerCase() !== statusFilter) continue;
        count += 1;
      }
      return count;
    }
  }

  async function getAgentRunEvents({ tenantId = DEFAULT_TENANT_ID, runId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(runId, "runId");
    try {
      const res = await pool.query(
        `
          SELECT event_json
          FROM events
          WHERE tenant_id = $1 AND aggregate_type = 'agent_run' AND aggregate_id = $2
          ORDER BY seq ASC
        `,
        [tenantId, String(runId)]
      );
      return res.rows.map((row) => normalizeAgentRunEventRecord(row?.event_json)).filter(Boolean);
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return (agentRunEvents.get(makeScopedKey({ tenantId, id: String(runId) })) ?? []).map(normalizeAgentRunEventRecord);
    }
  }

  // -------------------------------------------------------------------------
  // Agent Run Settlements
  // -------------------------------------------------------------------------

  async function getAgentRunSettlement({ tenantId = DEFAULT_TENANT_ID, runId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(runId, "runId");
    try {
      const res = await pool.query(
        `
          SELECT
            tenant_id, run_id, status, agent_id, payer_agent_id, amount_cents, currency,
            resolution_event_id, run_status, revision, locked_at, resolved_at, created_at, updated_at, settlement_json
          FROM agent_run_settlements
          WHERE tenant_id = $1 AND run_id = $2
          LIMIT 1
        `,
        [tenantId, String(runId)]
      );
      return res.rows.length ? agentRunSettlementRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return agentRunSettlements.get(makeScopedKey({ tenantId, id: String(runId) })) ?? null;
    }
  }

  async function listAgentRunSettlements({
    tenantId = DEFAULT_TENANT_ID,
    runId = null,
    agentId = null,
    payerAgentId = null,
    disputeId = null,
    disputeStatus = null,
    status = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (runId !== null) assertNonEmptyString(runId, "runId");
    if (agentId !== null) assertNonEmptyString(agentId, "agentId");
    if (payerAgentId !== null) assertNonEmptyString(payerAgentId, "payerAgentId");
    if (disputeId !== null) assertNonEmptyString(disputeId, "disputeId");
    if (disputeStatus !== null) assertNonEmptyString(disputeStatus, "disputeStatus");
    if (status !== null) assertNonEmptyString(status, "status");
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;

    try {
      const params = [tenantId];
      const where = ["tenant_id = $1"];
      if (runId !== null) {
        params.push(String(runId));
        where.push(`run_id = $${params.length}`);
      }
      if (agentId !== null) {
        params.push(String(agentId));
        where.push(`agent_id = $${params.length}`);
      }
      if (payerAgentId !== null) {
        params.push(String(payerAgentId));
        where.push(`payer_agent_id = $${params.length}`);
      }
      if (disputeId !== null) {
        params.push(String(disputeId));
        where.push(`settlement_json->>'disputeId' = $${params.length}`);
      }
      if (disputeStatus !== null) {
        params.push(String(disputeStatus).trim().toLowerCase());
        where.push(`lower(coalesce(settlement_json->>'disputeStatus', '')) = $${params.length}`);
      }
      if (status !== null) {
        params.push(String(status).trim().toLowerCase());
        where.push(`lower(status) = $${params.length}`);
      }
      params.push(safeLimit);
      params.push(safeOffset);
      const res = await pool.query(
        `
          SELECT
            tenant_id, run_id, status, agent_id, payer_agent_id, amount_cents, currency,
            resolution_event_id, run_status, revision, locked_at, resolved_at, created_at, updated_at, settlement_json
          FROM agent_run_settlements
          WHERE ${where.join(" AND ")}
          ORDER BY updated_at DESC, run_id ASC
          LIMIT $${params.length - 1} OFFSET $${params.length}
        `,
        params
      );
      return res.rows.map(agentRunSettlementRowToRecord).filter(Boolean);
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      const normalizedDisputeStatus = disputeStatus === null ? null : String(disputeStatus).trim().toLowerCase();
      const normalizedStatus = status === null ? null : String(status).trim().toLowerCase();
      const out = [];
      for (const row of agentRunSettlements.values()) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (runId !== null && String(row.runId ?? "") !== String(runId)) continue;
        if (agentId !== null && String(row.agentId ?? "") !== String(agentId)) continue;
        if (payerAgentId !== null && String(row.payerAgentId ?? "") !== String(payerAgentId)) continue;
        if (disputeId !== null && String(row.disputeId ?? "") !== String(disputeId)) continue;
        if (normalizedDisputeStatus !== null && String(row.disputeStatus ?? "").toLowerCase() !== normalizedDisputeStatus) continue;
        if (normalizedStatus !== null && String(row.status ?? "").toLowerCase() !== normalizedStatus) continue;
        out.push(row);
      }
      out.sort((left, right) => {
        const leftAt = Number.isFinite(Date.parse(String(left?.updatedAt ?? left?.disputeOpenedAt ?? left?.lockedAt ?? "")))
          ? Date.parse(String(left.updatedAt ?? left.disputeOpenedAt ?? left.lockedAt))
          : Number.NaN;
        const rightAt = Number.isFinite(Date.parse(String(right?.updatedAt ?? right?.disputeOpenedAt ?? right?.lockedAt ?? "")))
          ? Date.parse(String(right.updatedAt ?? right.disputeOpenedAt ?? right.lockedAt))
          : Number.NaN;
        if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && rightAt !== leftAt) return rightAt - leftAt;
        return String(left?.runId ?? "").localeCompare(String(right?.runId ?? ""));
      });
      return out.slice(safeOffset, safeOffset + safeLimit);
    }
  }

  return {
    getAgentCard,
    // putAgentCardAbuseReport: TODO - depends on store.commitTx closure
    getAgentCardAbuseReport,
    listAgentCardAbuseReports,
    listAgentCards,
    listAgentCardsPublic,
    getAgentIdentity,
    listAgentIdentities,
    getAgentPassport,
    // putAgentPassport: TODO - depends on store.commitTx closure
    getAgentWallet,
    // putAgentWallet: TODO - depends on store.commitTx closure
    getAgentRun,
    listAgentRuns,
    countAgentRuns,
    getAgentRunEvents,
    getAgentRunSettlement,
    listAgentRunSettlements
  };
}
