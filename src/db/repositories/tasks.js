/**
 * Tasks repository.
 * Extracted from store-pg.js for maintainability.
 *
 * Handles: task quotes, task offers, task acceptances, capability attestations.
 */

import { DEFAULT_TENANT_ID, makeScopedKey, normalizeTenantId } from "../../core/tenancy.js";
import { normalizeCapabilityIdentifier } from "../../core/capability-attestation.js";

// ---------------------------------------------------------------------------
// Shared helpers (pure, no DB)
// ---------------------------------------------------------------------------

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

// ---------------------------------------------------------------------------
// Row-to-record mappers
// ---------------------------------------------------------------------------

function taskQuoteSnapshotRowToRecord(row) {
  const taskQuote = row?.snapshot_json ?? null;
  if (!taskQuote || typeof taskQuote !== "object" || Array.isArray(taskQuote)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? taskQuote?.tenantId ?? DEFAULT_TENANT_ID);
  const quoteId =
    row?.aggregate_id && String(row.aggregate_id).trim() !== ""
      ? String(row.aggregate_id).trim()
      : typeof taskQuote?.quoteId === "string" && taskQuote.quoteId.trim() !== ""
        ? taskQuote.quoteId.trim()
        : null;
  if (!quoteId) return null;
  return {
    ...taskQuote,
    tenantId,
    quoteId
  };
}

function taskOfferSnapshotRowToRecord(row) {
  const taskOffer = row?.snapshot_json ?? null;
  if (!taskOffer || typeof taskOffer !== "object" || Array.isArray(taskOffer)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? taskOffer?.tenantId ?? DEFAULT_TENANT_ID);
  const offerId =
    row?.aggregate_id && String(row.aggregate_id).trim() !== ""
      ? String(row.aggregate_id).trim()
      : typeof taskOffer?.offerId === "string" && taskOffer.offerId.trim() !== ""
        ? taskOffer.offerId.trim()
        : null;
  if (!offerId) return null;
  return {
    ...taskOffer,
    tenantId,
    offerId
  };
}

function taskAcceptanceSnapshotRowToRecord(row) {
  const taskAcceptance = row?.snapshot_json ?? null;
  if (!taskAcceptance || typeof taskAcceptance !== "object" || Array.isArray(taskAcceptance)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? taskAcceptance?.tenantId ?? DEFAULT_TENANT_ID);
  const acceptanceId =
    row?.aggregate_id && String(row.aggregate_id).trim() !== ""
      ? String(row.aggregate_id).trim()
      : typeof taskAcceptance?.acceptanceId === "string" && taskAcceptance.acceptanceId.trim() !== ""
        ? taskAcceptance.acceptanceId.trim()
        : null;
  if (!acceptanceId) return null;
  return {
    ...taskAcceptance,
    tenantId,
    acceptanceId
  };
}

function capabilityAttestationSnapshotRowToRecord(row) {
  const capabilityAttestation = row?.snapshot_json ?? null;
  if (!capabilityAttestation || typeof capabilityAttestation !== "object" || Array.isArray(capabilityAttestation)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? capabilityAttestation?.tenantId ?? DEFAULT_TENANT_ID);
  const attestationId =
    row?.aggregate_id && String(row.aggregate_id).trim() !== ""
      ? String(row.aggregate_id).trim()
      : typeof capabilityAttestation?.attestationId === "string" && capabilityAttestation.attestationId.trim() !== ""
        ? capabilityAttestation.attestationId.trim()
        : null;
  if (!attestationId) return null;
  return {
    ...capabilityAttestation,
    tenantId,
    attestationId
  };
}

// ---------------------------------------------------------------------------
// Repository factory
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {import("pg").Pool} opts.pool
 * @param {Map} opts.taskQuotes            - in-memory fallback map
 * @param {Map} opts.taskOffers            - in-memory fallback map
 * @param {Map} opts.taskAcceptances       - in-memory fallback map
 * @param {Map} opts.capabilityAttestations - in-memory fallback map
 */
export function createTasksRepository({ pool, taskQuotes, taskOffers, taskAcceptances, capabilityAttestations }) {

  async function getTaskQuote({ tenantId = DEFAULT_TENANT_ID, quoteId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(quoteId, "quoteId");
    const normalizedQuoteId = String(quoteId).trim();
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'task_quote' AND aggregate_id = $2
          LIMIT 1
        `,
        [tenantId, normalizedQuoteId]
      );
      return res.rows.length ? taskQuoteSnapshotRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return taskQuotes.get(makeScopedKey({ tenantId, id: normalizedQuoteId })) ?? null;
    }
  }

  async function listTaskQuotes({
    tenantId = DEFAULT_TENANT_ID,
    quoteId = null,
    buyerAgentId = null,
    sellerAgentId = null,
    requiredCapability = null,
    status = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const quoteIdFilter = quoteId === null || quoteId === undefined || String(quoteId).trim() === "" ? null : String(quoteId).trim();
    const buyerFilter =
      buyerAgentId === null || buyerAgentId === undefined || String(buyerAgentId).trim() === ""
        ? null
        : String(buyerAgentId).trim();
    const sellerFilter =
      sellerAgentId === null || sellerAgentId === undefined || String(sellerAgentId).trim() === ""
        ? null
        : String(sellerAgentId).trim();
    const capabilityFilter =
      requiredCapability === null || requiredCapability === undefined || String(requiredCapability).trim() === ""
        ? null
        : String(requiredCapability).trim();
    const statusFilter = status === null || status === undefined || String(status).trim() === "" ? null : String(status).trim().toLowerCase();

    const applyFilters = (rows) => {
      const out = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (quoteIdFilter && String(row.quoteId ?? "") !== quoteIdFilter) continue;
        if (buyerFilter && String(row.buyerAgentId ?? "") !== buyerFilter) continue;
        if (sellerFilter && String(row.sellerAgentId ?? "") !== sellerFilter) continue;
        if (capabilityFilter && String(row.requiredCapability ?? "") !== capabilityFilter) continue;
        if (statusFilter && String(row.status ?? "").toLowerCase() !== statusFilter) continue;
        out.push(row);
      }
      out.sort((left, right) => String(left.quoteId ?? "").localeCompare(String(right.quoteId ?? "")));
      return out.slice(safeOffset, safeOffset + safeLimit);
    };

    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'task_quote'
          ORDER BY aggregate_id ASC
        `,
        [tenantId]
      );
      return applyFilters(res.rows.map(taskQuoteSnapshotRowToRecord).filter(Boolean));
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return applyFilters(Array.from(taskQuotes.values()));
    }
  }

  async function getTaskOffer({ tenantId = DEFAULT_TENANT_ID, offerId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(offerId, "offerId");
    const normalizedOfferId = String(offerId).trim();
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'task_offer' AND aggregate_id = $2
          LIMIT 1
        `,
        [tenantId, normalizedOfferId]
      );
      return res.rows.length ? taskOfferSnapshotRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return taskOffers.get(makeScopedKey({ tenantId, id: normalizedOfferId })) ?? null;
    }
  }

  async function listTaskOffers({
    tenantId = DEFAULT_TENANT_ID,
    offerId = null,
    buyerAgentId = null,
    sellerAgentId = null,
    quoteId = null,
    status = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const offerIdFilter = offerId === null || offerId === undefined || String(offerId).trim() === "" ? null : String(offerId).trim();
    const buyerFilter =
      buyerAgentId === null || buyerAgentId === undefined || String(buyerAgentId).trim() === ""
        ? null
        : String(buyerAgentId).trim();
    const sellerFilter =
      sellerAgentId === null || sellerAgentId === undefined || String(sellerAgentId).trim() === ""
        ? null
        : String(sellerAgentId).trim();
    const quoteFilter = quoteId === null || quoteId === undefined || String(quoteId).trim() === "" ? null : String(quoteId).trim();
    const statusFilter = status === null || status === undefined || String(status).trim() === "" ? null : String(status).trim().toLowerCase();

    const applyFilters = (rows) => {
      const out = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (offerIdFilter && String(row.offerId ?? "") !== offerIdFilter) continue;
        if (buyerFilter && String(row.buyerAgentId ?? "") !== buyerFilter) continue;
        if (sellerFilter && String(row.sellerAgentId ?? "") !== sellerFilter) continue;
        if (quoteFilter && String(row?.quoteRef?.quoteId ?? "") !== quoteFilter) continue;
        if (statusFilter && String(row.status ?? "").toLowerCase() !== statusFilter) continue;
        out.push(row);
      }
      out.sort((left, right) => String(left.offerId ?? "").localeCompare(String(right.offerId ?? "")));
      return out.slice(safeOffset, safeOffset + safeLimit);
    };

    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'task_offer'
          ORDER BY aggregate_id ASC
        `,
        [tenantId]
      );
      return applyFilters(res.rows.map(taskOfferSnapshotRowToRecord).filter(Boolean));
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return applyFilters(Array.from(taskOffers.values()));
    }
  }

  async function getTaskAcceptance({ tenantId = DEFAULT_TENANT_ID, acceptanceId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(acceptanceId, "acceptanceId");
    const normalizedAcceptanceId = String(acceptanceId).trim();
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'task_acceptance' AND aggregate_id = $2
          LIMIT 1
        `,
        [tenantId, normalizedAcceptanceId]
      );
      return res.rows.length ? taskAcceptanceSnapshotRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return taskAcceptances.get(makeScopedKey({ tenantId, id: normalizedAcceptanceId })) ?? null;
    }
  }

  async function listTaskAcceptances({
    tenantId = DEFAULT_TENANT_ID,
    acceptanceId = null,
    buyerAgentId = null,
    sellerAgentId = null,
    quoteId = null,
    offerId = null,
    status = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const acceptanceIdFilter =
      acceptanceId === null || acceptanceId === undefined || String(acceptanceId).trim() === "" ? null : String(acceptanceId).trim();
    const buyerFilter =
      buyerAgentId === null || buyerAgentId === undefined || String(buyerAgentId).trim() === ""
        ? null
        : String(buyerAgentId).trim();
    const sellerFilter =
      sellerAgentId === null || sellerAgentId === undefined || String(sellerAgentId).trim() === ""
        ? null
        : String(sellerAgentId).trim();
    const quoteFilter = quoteId === null || quoteId === undefined || String(quoteId).trim() === "" ? null : String(quoteId).trim();
    const offerFilter = offerId === null || offerId === undefined || String(offerId).trim() === "" ? null : String(offerId).trim();
    const statusFilter = status === null || status === undefined || String(status).trim() === "" ? null : String(status).trim().toLowerCase();

    const applyFilters = (rows) => {
      const out = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (acceptanceIdFilter && String(row.acceptanceId ?? "") !== acceptanceIdFilter) continue;
        if (buyerFilter && String(row.buyerAgentId ?? "") !== buyerFilter) continue;
        if (sellerFilter && String(row.sellerAgentId ?? "") !== sellerFilter) continue;
        if (quoteFilter && String(row?.quoteRef?.quoteId ?? "") !== quoteFilter) continue;
        if (offerFilter && String(row?.offerRef?.offerId ?? "") !== offerFilter) continue;
        if (statusFilter && String(row.status ?? "").toLowerCase() !== statusFilter) continue;
        out.push(row);
      }
      out.sort((left, right) => String(left.acceptanceId ?? "").localeCompare(String(right.acceptanceId ?? "")));
      return out.slice(safeOffset, safeOffset + safeLimit);
    };

    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'task_acceptance'
          ORDER BY aggregate_id ASC
        `,
        [tenantId]
      );
      return applyFilters(res.rows.map(taskAcceptanceSnapshotRowToRecord).filter(Boolean));
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return applyFilters(Array.from(taskAcceptances.values()));
    }
  }

  async function getCapabilityAttestation({ tenantId = DEFAULT_TENANT_ID, attestationId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(attestationId, "attestationId");
    const normalizedAttestationId = String(attestationId).trim();
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'capability_attestation' AND aggregate_id = $2
          LIMIT 1
        `,
        [tenantId, normalizedAttestationId]
      );
      return res.rows.length ? capabilityAttestationSnapshotRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return capabilityAttestations.get(makeScopedKey({ tenantId, id: normalizedAttestationId })) ?? null;
    }
  }

  async function listCapabilityAttestations({
    tenantId = DEFAULT_TENANT_ID,
    attestationId = null,
    subjectAgentId = null,
    issuerAgentId = null,
    capability = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (attestationId !== null && (typeof attestationId !== "string" || attestationId.trim() === "")) {
      throw new TypeError("attestationId must be null or a non-empty string");
    }
    if (subjectAgentId !== null && (typeof subjectAgentId !== "string" || subjectAgentId.trim() === "")) {
      throw new TypeError("subjectAgentId must be null or a non-empty string");
    }
    if (issuerAgentId !== null && (typeof issuerAgentId !== "string" || issuerAgentId.trim() === "")) {
      throw new TypeError("issuerAgentId must be null or a non-empty string");
    }
    if (capability !== null && (typeof capability !== "string" || capability.trim() === "")) {
      throw new TypeError("capability must be null or a non-empty string");
    }
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const attestationIdFilter = attestationId ? String(attestationId).trim() : null;
    const subjectFilter = subjectAgentId ? String(subjectAgentId).trim() : null;
    const issuerFilter = issuerAgentId ? String(issuerAgentId).trim() : null;
    const capabilityFilter = capability ? normalizeCapabilityIdentifier(capability, { name: "capability" }) : null;

    const applyFilters = (rows) => {
      const out = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (attestationIdFilter && String(row.attestationId ?? "") !== attestationIdFilter) continue;
        if (subjectFilter && String(row.subjectAgentId ?? "") !== subjectFilter) continue;
        if (issuerFilter && String(row.issuerAgentId ?? "") !== issuerFilter) continue;
        if (capabilityFilter && String(row.capability ?? "") !== capabilityFilter) continue;
        out.push(row);
      }
      out.sort((left, right) => String(left.attestationId ?? "").localeCompare(String(right.attestationId ?? "")));
      return out.slice(safeOffset, safeOffset + safeLimit);
    };

    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'capability_attestation'
          ORDER BY aggregate_id ASC
        `,
        [tenantId]
      );
      return applyFilters(res.rows.map(capabilityAttestationSnapshotRowToRecord).filter(Boolean));
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return applyFilters(Array.from(capabilityAttestations.values()));
    }
  }

  return {
    getTaskQuote,
    listTaskQuotes,
    getTaskOffer,
    listTaskOffers,
    getTaskAcceptance,
    listTaskAcceptances,
    getCapabilityAttestation,
    listCapabilityAttestations
  };
}
