/**
 * Marketplace repository.
 * Extracted from store-pg.js for maintainability.
 *
 * Handles: ContractV2 CRUD, RFQs, bids, capability listings, provider publications.
 */

import { DEFAULT_TENANT_ID, makeScopedKey, normalizeTenantId } from "../../core/tenancy.js";

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

function marketplaceProviderPublicationMapKey({ tenantId, providerRef }) {
  return makeScopedKey({ tenantId: normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID), id: String(providerRef) });
}

function marketplaceCapabilityListingMapKey({ tenantId, listingId }) {
  return makeScopedKey({ tenantId: normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID), id: String(listingId) });
}

// ---------------------------------------------------------------------------
// Row-to-record mappers
// ---------------------------------------------------------------------------

function marketplaceProviderPublicationSnapshotRowToRecord(row) {
  const publication = row?.snapshot_json ?? null;
  if (!publication || typeof publication !== "object" || Array.isArray(publication)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? publication?.tenantId ?? DEFAULT_TENANT_ID);
  const providerRefFromAggregateId =
    row?.aggregate_id && String(row.aggregate_id).trim() !== "" ? String(row.aggregate_id).trim() : null;
  const providerRefFromRecord =
    typeof publication?.providerRef === "string" && publication.providerRef.trim() !== "" ? publication.providerRef.trim() : null;
  const providerId =
    typeof publication?.providerId === "string" && publication.providerId.trim() !== "" ? publication.providerId.trim() : null;
  const providerRef = providerRefFromRecord ?? providerRefFromAggregateId ?? providerId;
  if (!providerRef) return null;
  return {
    ...publication,
    tenantId,
    providerId: providerId ?? null,
    providerRef
  };
}

function marketplaceCapabilityListingSnapshotRowToRecord(row) {
  const listing = row?.snapshot_json ?? null;
  if (!listing || typeof listing !== "object" || Array.isArray(listing)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? listing?.tenantId ?? DEFAULT_TENANT_ID);
  const listingId =
    row?.aggregate_id && String(row.aggregate_id).trim() !== ""
      ? String(row.aggregate_id).trim()
      : typeof listing?.listingId === "string" && listing.listingId.trim() !== ""
        ? listing.listingId.trim()
        : null;
  if (!listingId) return null;
  return {
    ...listing,
    tenantId,
    listingId
  };
}

function contractV2RowToRecord(row) {
  if (!row) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? DEFAULT_TENANT_ID);
  const contractId = row?.contract_id ? String(row.contract_id) : null;
  const contractVersion = row?.contract_version === null || row?.contract_version === undefined ? null : Number(row.contract_version);
  if (!contractId || !Number.isSafeInteger(contractVersion) || contractVersion <= 0) return null;
  return {
    tenantId,
    contractId,
    contractVersion,
    status: row?.status ? String(row.status) : "DRAFT",
    effectiveFrom: row?.effective_from ? new Date(row.effective_from).toISOString() : null,
    effectiveTo: row?.effective_to ? new Date(row.effective_to).toISOString() : null,
    contractHash: row?.contract_hash ? String(row.contract_hash) : null,
    policyHash: row?.policy_hash ? String(row.policy_hash) : null,
    compilerId: row?.compiler_id ? String(row.compiler_id) : null,
    scope: {
      customerId: row?.scope_customer_id === undefined ? null : row.scope_customer_id === null ? null : String(row.scope_customer_id),
      siteId: row?.scope_site_id === undefined ? null : row.scope_site_id === null ? null : String(row.scope_site_id),
      zoneId: row?.scope_zone_id === undefined ? null : row.scope_zone_id === null ? null : String(row.scope_zone_id),
      templateId: row?.scope_template_id === undefined ? null : row.scope_template_id === null ? null : String(row.scope_template_id),
      skillId: row?.scope_skill_id === undefined ? null : row.scope_skill_id === null ? null : String(row.scope_skill_id)
    },
    doc: row?.doc_json ?? null,
    createdAt: row?.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

// ---------------------------------------------------------------------------
// Repository factory
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {import("pg").Pool} opts.pool
 * @param {Function} opts.withTx                    - transactional wrapper from store-pg
 * @param {Function} opts.persistSnapshotAggregate  - snapshot upsert helper from store-pg
 * @param {Function} opts.insertOpsAuditRow         - audit insert helper from store-pg
 * @param {Map} opts.marketplaceProviderPublications - in-memory fallback map
 * @param {Map} opts.marketplaceCapabilityListings   - in-memory fallback map
 */
export function createMarketplaceRepository({
  pool,
  withTx,
  persistSnapshotAggregate,
  insertOpsAuditRow,
  marketplaceProviderPublications,
  marketplaceCapabilityListings
}) {

  // -------------------------------------------------------------------------
  // Provider publications
  // -------------------------------------------------------------------------

  async function getMarketplaceProviderPublication({
    tenantId = DEFAULT_TENANT_ID,
    providerId = null,
    providerRef = null
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    const normalizedProviderRef =
      providerRef === null || providerRef === undefined || String(providerRef).trim() === "" ? null : String(providerRef).trim();
    const normalizedProviderId =
      providerId === null || providerId === undefined || String(providerId).trim() === "" ? null : String(providerId).trim();
    if (normalizedProviderRef) {
      const byRef = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'marketplace_provider_publication' AND aggregate_id = $2
          LIMIT 1
        `,
        [tenantId, normalizedProviderRef]
      );
      if (byRef.rows.length) return marketplaceProviderPublicationSnapshotRowToRecord(byRef.rows[0]);
    }
    if (!normalizedProviderId) return null;
    const byProviderId = await pool.query(
      `
        SELECT tenant_id, aggregate_id, snapshot_json
        FROM snapshots
        WHERE tenant_id = $1 AND aggregate_type = 'marketplace_provider_publication'
        ORDER BY updated_at DESC, aggregate_id ASC
      `,
      [tenantId]
    );
    const rows = byProviderId.rows.map(marketplaceProviderPublicationSnapshotRowToRecord).filter(Boolean);
    for (const row of rows) {
      if (String(row.providerId ?? "") === normalizedProviderId || String(row.providerRef ?? "") === normalizedProviderId) return row;
    }
    return null;
  }

  async function listMarketplaceProviderPublications({
    tenantId = DEFAULT_TENANT_ID,
    status = "certified",
    providerId = null,
    providerRef = null,
    search = null,
    toolId = null
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    const statusFilter = status === null || status === undefined ? "certified" : String(status).trim().toLowerCase() || "certified";
    const providerFilter =
      providerId === null || providerId === undefined || String(providerId).trim() === "" ? null : String(providerId).trim();
    const providerRefFilter =
      providerRef === null || providerRef === undefined || String(providerRef).trim() === "" ? null : String(providerRef).trim();
    const searchFilter = search === null || search === undefined || String(search).trim() === "" ? null : String(search).trim().toLowerCase();
    const toolFilter = toolId === null || toolId === undefined || String(toolId).trim() === "" ? null : String(toolId).trim();

    const applyFilters = (rows) => {
      const out = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        const rowStatus = String(row.status ?? "draft").toLowerCase();
        if (statusFilter !== "all" && rowStatus !== statusFilter) continue;
        if (providerFilter && String(row.providerId ?? "") !== providerFilter && String(row.providerRef ?? "") !== providerFilter) continue;
        if (providerRefFilter && String(row.providerRef ?? "") !== providerRefFilter) continue;
        if (toolFilter) {
          const tools = Array.isArray(row?.manifest?.tools) ? row.manifest.tools : [];
          const hasTool = tools.some((tool) => String(tool?.toolId ?? "") === toolFilter);
          if (!hasTool) continue;
        }
        if (searchFilter) {
          const tools = Array.isArray(row?.manifest?.tools) ? row.manifest.tools : [];
          const haystack = [
            row.providerId,
            row.providerRef,
            row.description,
            row.baseUrl,
            row.status,
            ...(Array.isArray(row.tags) ? row.tags : []),
            ...tools.map((tool) => `${tool?.toolId ?? ""} ${tool?.mcpToolName ?? ""} ${tool?.description ?? ""}`)
          ]
            .map((value) => String(value ?? "").toLowerCase())
            .join(" ");
          if (!haystack.includes(searchFilter)) continue;
        }
        out.push(row);
      }

      out.sort((left, right) => {
        const leftAt = Date.parse(String(left.updatedAt ?? left.publishedAt ?? ""));
        const rightAt = Date.parse(String(right.updatedAt ?? right.publishedAt ?? ""));
        if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && rightAt !== leftAt) return rightAt - leftAt;
        const providerIdOrder = String(left.providerId ?? "").localeCompare(String(right.providerId ?? ""));
        if (providerIdOrder !== 0) return providerIdOrder;
        return String(left.providerRef ?? "").localeCompare(String(right.providerRef ?? ""));
      });
      return out;
    };

    const res = await pool.query(
      `
        SELECT tenant_id, aggregate_id, snapshot_json
        FROM snapshots
        WHERE tenant_id = $1 AND aggregate_type = 'marketplace_provider_publication'
        ORDER BY updated_at DESC, aggregate_id ASC
      `,
      [tenantId]
    );
    return applyFilters(res.rows.map(marketplaceProviderPublicationSnapshotRowToRecord).filter(Boolean));
  }

  async function putMarketplaceProviderPublication({
    tenantId = DEFAULT_TENANT_ID,
    publication,
    audit = null
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!publication || typeof publication !== "object" || Array.isArray(publication)) {
      throw new TypeError("publication is required");
    }
    const providerRefCandidate =
      typeof publication.providerRef === "string" && publication.providerRef.trim() !== ""
        ? publication.providerRef.trim()
        : typeof publication.providerId === "string" && publication.providerId.trim() !== ""
          ? publication.providerId.trim()
          : null;
    if (!providerRefCandidate) throw new TypeError("publication.providerRef is required");
    const providerId =
      typeof publication.providerId === "string" && publication.providerId.trim() !== "" ? publication.providerId.trim() : null;
    const updatedAt =
      parseIsoOrNull(publication.updatedAt) ??
      parseIsoOrNull(publication.publishedAt) ??
      parseIsoOrNull(publication.createdAt) ??
      new Date().toISOString();
    const normalizedPublication = {
      ...publication,
      tenantId,
      providerRef: providerRefCandidate,
      providerId,
      updatedAt
    };

    await withTx(async (client) => {
      await persistSnapshotAggregate(client, {
        tenantId,
        aggregateType: "marketplace_provider_publication",
        aggregateId: providerRefCandidate,
        snapshot: normalizedPublication,
        updatedAt
      });
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
    });

    if (!(marketplaceProviderPublications instanceof Map)) return normalizedPublication;
    marketplaceProviderPublications.set(
      marketplaceProviderPublicationMapKey({ tenantId, providerRef: providerRefCandidate }),
      normalizedPublication
    );
    return normalizedPublication;
  }

  // -------------------------------------------------------------------------
  // Capability listings
  // -------------------------------------------------------------------------

  async function getMarketplaceCapabilityListing({
    tenantId = DEFAULT_TENANT_ID,
    listingId
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    const normalizedListingId =
      listingId === null || listingId === undefined || String(listingId).trim() === "" ? null : String(listingId).trim();
    if (!normalizedListingId) return null;
    const res = await pool.query(
      `
        SELECT tenant_id, aggregate_id, snapshot_json
        FROM snapshots
        WHERE tenant_id = $1 AND aggregate_type = 'marketplace_capability_listing' AND aggregate_id = $2
        LIMIT 1
      `,
      [tenantId, normalizedListingId]
    );
    return res.rows.length ? marketplaceCapabilityListingSnapshotRowToRecord(res.rows[0]) : null;
  }

  async function listMarketplaceCapabilityListings({
    tenantId = DEFAULT_TENANT_ID,
    status = "all",
    capability = null,
    sellerAgentId = null,
    search = null
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    const statusFilter = status === null || status === undefined ? "all" : String(status).trim().toLowerCase() || "all";
    const capabilityFilter =
      capability === null || capability === undefined || String(capability).trim() === "" ? null : String(capability).trim();
    const sellerFilter =
      sellerAgentId === null || sellerAgentId === undefined || String(sellerAgentId).trim() === "" ? null : String(sellerAgentId).trim();
    const searchFilter = search === null || search === undefined || String(search).trim() === "" ? null : String(search).trim().toLowerCase();

    const applyFilters = (rows) => {
      const out = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        const rowStatus = String(row.status ?? "active").toLowerCase();
        if (statusFilter !== "all" && rowStatus !== statusFilter) continue;
        if (capabilityFilter && String(row.capability ?? "") !== capabilityFilter) continue;
        if (sellerFilter && String(row.sellerAgentId ?? "") !== sellerFilter) continue;
        if (searchFilter) {
          const haystack = [
            row.listingId,
            row.capability,
            row.title,
            row.description,
            row.category,
            ...(Array.isArray(row.tags) ? row.tags : [])
          ]
            .map((value) => String(value ?? "").toLowerCase())
            .join(" ");
          if (!haystack.includes(searchFilter)) continue;
        }
        out.push(row);
      }
      out.sort((left, right) => {
        const leftAt = Date.parse(String(left.updatedAt ?? left.createdAt ?? ""));
        const rightAt = Date.parse(String(right.updatedAt ?? right.createdAt ?? ""));
        if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && rightAt !== leftAt) return rightAt - leftAt;
        return String(left.listingId ?? "").localeCompare(String(right.listingId ?? ""));
      });
      return out;
    };

    const res = await pool.query(
      `
        SELECT tenant_id, aggregate_id, snapshot_json
        FROM snapshots
        WHERE tenant_id = $1 AND aggregate_type = 'marketplace_capability_listing'
        ORDER BY updated_at DESC, aggregate_id ASC
      `,
      [tenantId]
    );
    return applyFilters(res.rows.map(marketplaceCapabilityListingSnapshotRowToRecord).filter(Boolean));
  }

  async function putMarketplaceCapabilityListing({
    tenantId = DEFAULT_TENANT_ID,
    listing,
    audit = null
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!listing || typeof listing !== "object" || Array.isArray(listing)) {
      throw new TypeError("listing is required");
    }
    const listingId =
      typeof listing.listingId === "string" && listing.listingId.trim() !== "" ? listing.listingId.trim() : null;
    if (!listingId) throw new TypeError("listing.listingId is required");
    const updatedAt = parseIsoOrNull(listing.updatedAt) ?? parseIsoOrNull(listing.createdAt) ?? new Date().toISOString();
    const createdAt = parseIsoOrNull(listing.createdAt) ?? updatedAt;
    const normalizedListing = {
      ...listing,
      tenantId,
      listingId,
      createdAt,
      updatedAt
    };

    await withTx(async (client) => {
      await persistSnapshotAggregate(client, {
        tenantId,
        aggregateType: "marketplace_capability_listing",
        aggregateId: listingId,
        snapshot: normalizedListing,
        updatedAt
      });
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
    });

    if (!(marketplaceCapabilityListings instanceof Map)) return normalizedListing;
    marketplaceCapabilityListings.set(marketplaceCapabilityListingMapKey({ tenantId, listingId }), normalizedListing);
    return normalizedListing;
  }

  async function deleteMarketplaceCapabilityListing({
    tenantId = DEFAULT_TENANT_ID,
    listingId,
    audit = null
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(listingId, "listingId");
    const normalizedListingId = String(listingId).trim();
    const key = marketplaceCapabilityListingMapKey({ tenantId, listingId: normalizedListingId });
    const existingInMap = marketplaceCapabilityListings instanceof Map ? (marketplaceCapabilityListings.get(key) ?? null) : null;

    let existing = existingInMap;
    const res = await pool.query(
      `
        SELECT tenant_id, aggregate_id, snapshot_json
        FROM snapshots
        WHERE tenant_id = $1 AND aggregate_type = 'marketplace_capability_listing' AND aggregate_id = $2
        LIMIT 1
      `,
      [tenantId, normalizedListingId]
    );
    if (res.rows.length) {
      existing = marketplaceCapabilityListingSnapshotRowToRecord(res.rows[0]) ?? existing;
    }
    await withTx(async (client) => {
      await client.query(
        `
          DELETE FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'marketplace_capability_listing' AND aggregate_id = $2
        `,
        [tenantId, normalizedListingId]
      );
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
    });

    if (marketplaceCapabilityListings instanceof Map) {
      marketplaceCapabilityListings.delete(key);
    }
    return existing;
  }

  // -------------------------------------------------------------------------
  // Contracts V2
  // -------------------------------------------------------------------------

  async function getContractV2({ tenantId = DEFAULT_TENANT_ID, contractId, contractVersion } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(contractId, "contractId");
    const v = Number(contractVersion);
    if (!Number.isSafeInteger(v) || v <= 0) throw new TypeError("contractVersion must be a positive safe integer");
    const res = await pool.query(
      `
        SELECT tenant_id, contract_id, contract_version, status, effective_from, effective_to, contract_hash, policy_hash, compiler_id,
               scope_customer_id, scope_site_id, scope_zone_id, scope_template_id, scope_skill_id, doc_json, created_at, updated_at
        FROM contracts_v2
        WHERE tenant_id = $1 AND contract_id = $2 AND contract_version = $3
        LIMIT 1
      `,
      [tenantId, String(contractId), v]
    );
    return res.rows.length ? contractV2RowToRecord(res.rows[0]) : null;
  }

  async function getContractV2ByHash({ tenantId = DEFAULT_TENANT_ID, contractHash } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(contractHash, "contractHash");
    const res = await pool.query(
      `
        SELECT tenant_id, contract_id, contract_version, status, effective_from, effective_to, contract_hash, policy_hash, compiler_id,
               scope_customer_id, scope_site_id, scope_zone_id, scope_template_id, scope_skill_id, doc_json, created_at, updated_at
        FROM contracts_v2
        WHERE tenant_id = $1 AND contract_hash = $2
        LIMIT 1
      `,
      [tenantId, String(contractHash)]
    );
    return res.rows.length ? contractV2RowToRecord(res.rows[0]) : null;
  }

  async function listContractsV2({ tenantId = DEFAULT_TENANT_ID, status = null, limit = 200, offset = 0 } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (status !== null) assertNonEmptyString(status, "status");
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const params = [tenantId];
    const where = ["tenant_id = $1"];
    if (status !== null) {
      params.push(String(status));
      where.push(`status = $${params.length}`);
    }
    params.push(safeLimit);
    params.push(safeOffset);
    const res = await pool.query(
      `
        SELECT tenant_id, contract_id, contract_version, status, effective_from, effective_to, contract_hash, policy_hash, compiler_id,
               scope_customer_id, scope_site_id, scope_zone_id, scope_template_id, scope_skill_id, doc_json, created_at, updated_at
        FROM contracts_v2
        WHERE ${where.join(" AND ")}
        ORDER BY contract_id ASC, contract_version DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );
    return res.rows.map(contractV2RowToRecord).filter(Boolean);
  }

  async function getLatestContractV2({ tenantId = DEFAULT_TENANT_ID, contractId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(contractId, "contractId");
    const res = await pool.query(
      `
        SELECT tenant_id, contract_id, contract_version, status, effective_from, effective_to, contract_hash, policy_hash, compiler_id,
               scope_customer_id, scope_site_id, scope_zone_id, scope_template_id, scope_skill_id, doc_json, created_at, updated_at
        FROM contracts_v2
        WHERE tenant_id = $1 AND contract_id = $2
        ORDER BY contract_version DESC
        LIMIT 1
      `,
      [tenantId, String(contractId)]
    );
    return res.rows.length ? contractV2RowToRecord(res.rows[0]) : null;
  }

  async function createContractDraftV2({ tenantId = DEFAULT_TENANT_ID, contractId, contractVersion, doc, audit = null } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(contractId, "contractId");
    const v = Number(contractVersion);
    if (!Number.isSafeInteger(v) || v <= 0) throw new TypeError("contractVersion must be a positive safe integer");
    if (!doc || typeof doc !== "object") throw new TypeError("doc is required");

    await withTx(async (client) => {
      await client.query(
        `
          INSERT INTO contracts_v2 (
            tenant_id, contract_id, contract_version, status,
            scope_customer_id, scope_site_id, scope_zone_id, scope_template_id, scope_skill_id,
            doc_json
          ) VALUES ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8,$9)
          ON CONFLICT (tenant_id, contract_id, contract_version) DO UPDATE SET
            doc_json = EXCLUDED.doc_json,
            scope_customer_id = EXCLUDED.scope_customer_id,
            scope_site_id = EXCLUDED.scope_site_id,
            scope_zone_id = EXCLUDED.scope_zone_id,
            scope_template_id = EXCLUDED.scope_template_id,
            scope_skill_id = EXCLUDED.scope_skill_id,
            updated_at = now()
          WHERE contracts_v2.status = 'DRAFT'
        `,
        [
          tenantId,
          String(contractId),
          v,
          doc?.scope?.customerId ?? null,
          doc?.scope?.siteId ?? null,
          doc?.scope?.zoneId ?? null,
          doc?.scope?.templateId ?? null,
          doc?.scope?.skillId ?? null,
          doc
        ]
      );
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
    });
    return getContractV2({ tenantId, contractId, contractVersion: v });
  }

  async function publishContractV2({ tenantId = DEFAULT_TENANT_ID, contractId, contractVersion, contractHash, audit = null } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(contractId, "contractId");
    const v = Number(contractVersion);
    if (!Number.isSafeInteger(v) || v <= 0) throw new TypeError("contractVersion must be a positive safe integer");
    assertNonEmptyString(contractHash, "contractHash");

    await withTx(async (client) => {
      const current = await client.query(
        "SELECT status, contract_hash FROM contracts_v2 WHERE tenant_id = $1 AND contract_id = $2 AND contract_version = $3 LIMIT 1",
        [tenantId, String(contractId), v]
      );
      if (!current.rows.length) {
        const err = new Error("contract not found");
        err.code = "NOT_FOUND";
        throw err;
      }
      const status = String(current.rows[0].status ?? "");
      const existingHash = current.rows[0].contract_hash ? String(current.rows[0].contract_hash) : null;
      if (status !== "DRAFT" && status !== "PUBLISHED") {
        const err = new Error("contract not publishable");
        err.code = "CONTRACT_NOT_PUBLISHABLE";
        throw err;
      }
      if (existingHash && existingHash !== contractHash) {
        const err = new Error("contract hash mismatch");
        err.code = "CONTRACT_HASH_MISMATCH";
        throw err;
      }

      await client.query(
        `
          UPDATE contracts_v2
          SET status = 'PUBLISHED', contract_hash = $4, updated_at = now()
          WHERE tenant_id = $1 AND contract_id = $2 AND contract_version = $3
        `,
        [tenantId, String(contractId), v, String(contractHash)]
      );
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
    });
    return getContractV2({ tenantId, contractId, contractVersion: v });
  }

  async function putContractSignatureV2({
    tenantId = DEFAULT_TENANT_ID,
    contractHash,
    partyRole,
    signerKeyId,
    signature,
    audit = null
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(contractHash, "contractHash");
    assertNonEmptyString(partyRole, "partyRole");
    assertNonEmptyString(signerKeyId, "signerKeyId");
    assertNonEmptyString(signature, "signature");

    await withTx(async (client) => {
      await client.query(
        `
          INSERT INTO contract_signatures_v2 (tenant_id, contract_hash, party_role, signer_key_id, signature)
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (tenant_id, contract_hash, party_role) DO UPDATE SET
            signer_key_id = EXCLUDED.signer_key_id,
            signature = EXCLUDED.signature,
            signed_at = now()
        `,
        [tenantId, String(contractHash), String(partyRole), String(signerKeyId), String(signature)]
      );
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
    });
    return { ok: true };
  }

  async function listContractSignaturesV2({ tenantId = DEFAULT_TENANT_ID, contractHash } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(contractHash, "contractHash");
    const res = await pool.query(
      `
        SELECT tenant_id, contract_hash, party_role, signer_key_id, signature, signed_at
        FROM contract_signatures_v2
        WHERE tenant_id = $1 AND contract_hash = $2
        ORDER BY party_role ASC
      `,
      [tenantId, String(contractHash)]
    );
    return res.rows.map((row) => ({
      tenantId: normalizeTenantId(row.tenant_id ?? tenantId),
      contractHash: String(row.contract_hash),
      partyRole: String(row.party_role),
      signerKeyId: String(row.signer_key_id),
      signature: String(row.signature),
      signedAt: row.signed_at ? new Date(row.signed_at).toISOString() : null
    }));
  }

  async function activateContractV2({ tenantId = DEFAULT_TENANT_ID, contractId, contractVersion, policyHash, compilerId, audit = null } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(contractId, "contractId");
    const v = Number(contractVersion);
    if (!Number.isSafeInteger(v) || v <= 0) throw new TypeError("contractVersion must be a positive safe integer");
    assertNonEmptyString(policyHash, "policyHash");
    assertNonEmptyString(compilerId, "compilerId");

    await withTx(async (client) => {
      const current = await client.query(
        "SELECT status FROM contracts_v2 WHERE tenant_id = $1 AND contract_id = $2 AND contract_version = $3 LIMIT 1",
        [tenantId, String(contractId), v]
      );
      if (!current.rows.length) {
        const err = new Error("contract not found");
        err.code = "NOT_FOUND";
        throw err;
      }
      const status = String(current.rows[0].status ?? "");
      if (status !== "PUBLISHED" && status !== "ACTIVE") {
        const err = new Error("contract not activatable");
        err.code = "CONTRACT_NOT_ACTIVATABLE";
        throw err;
      }

      await client.query(
        `
          UPDATE contracts_v2
          SET status = 'ACTIVE', policy_hash = $4, compiler_id = $5, updated_at = now()
          WHERE tenant_id = $1 AND contract_id = $2 AND contract_version = $3
        `,
        [tenantId, String(contractId), v, String(policyHash), String(compilerId)]
      );

      await client.query(
        `
          INSERT INTO contract_compilations_v2 (tenant_id, contract_hash, policy_hash, compiler_id, diagnostics_json)
          SELECT tenant_id, contract_hash, $4, $5, NULL
          FROM contracts_v2
          WHERE tenant_id = $1 AND contract_id = $2 AND contract_version = $3 AND contract_hash IS NOT NULL
          ON CONFLICT DO NOTHING
        `,
        [tenantId, String(contractId), v, String(policyHash), String(compilerId)]
      );

      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
    });
    return getContractV2({ tenantId, contractId, contractVersion: v });
  }

  return {
    getMarketplaceProviderPublication,
    listMarketplaceProviderPublications,
    putMarketplaceProviderPublication,
    getMarketplaceCapabilityListing,
    listMarketplaceCapabilityListings,
    putMarketplaceCapabilityListing,
    deleteMarketplaceCapabilityListing,
    getContractV2,
    getContractV2ByHash,
    listContractsV2,
    getLatestContractV2,
    createContractDraftV2,
    publishContractV2,
    putContractSignatureV2,
    listContractSignaturesV2,
    activateContractV2
  };
}
