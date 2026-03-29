/**
 * Public routes: /v1/public/*, /public/agent-cards/*, /.well-known/agent-locator/*, /public/agents/*/reputation-summary
 *
 * Extracted from app.js following the route module pattern (see health.js).
 * The handler returns true if it handled the request, false otherwise.
 *
 * The original app.js code uses "return sendJson(...)" / "return sendError(...)"
 * and bare "return;" after writing to res. We wrap sendJson/sendError to return true
 * and fall back to checking res.writableEnded for SSE/stream routes.
 */

/**
 * @param {object} deps - Shared dependencies from createApi()
 * @returns {Function} Route handler
 */
export function createPublicRoutes(deps) {
  const {
    store,
    sendJson,
    sendError,
    nowIso,
    normalizeForCanonicalJson,
    normalizeTenantId,
    normalizeTenant,
    resolvePublicAgentLocatorRef,
    resolvePublicAgentCardByAgentId,
    discoverAgentCards,
    listPublicAgentCardsForStream,
    computeAgentReputationSnapshotVersioned,
    resolveAgentCardPublicSummaryVisibility,
    listRoutingReputationEvents,
    computeReputationFactsAggregate,
    computeRoutingReputationEventStats,
    listRelationshipEdgesForAgent,
    reputationWindowStartAt,
    parseBooleanQueryValue,
    parseThresholdIntegerQueryValue,
    parseAsOfDateTime,
    parseReputationVersion,
    parseReputationWindow,
    parseRelationshipListLimit,
    normalizeCapabilityIdentifier,
    parseExecutionCoordinatorDid,
    parseAgentCardStreamCursor,
    compareAgentCardStreamCursor,
    buildNextAgentCardStreamCursorAfter,
    makeScopedKey,
    toSafeRelationshipRate,
    AGENT_CARD_STATUS,
    AGENT_LOCATOR_REASON_CODE,
    AGENT_REPUTATION_WINDOW,
    AGENT_CARD_STREAM_EVENT_SCHEMA_VERSION,
    PUBLIC_AGENT_REPUTATION_SUMMARY_SCHEMA_VERSION,
    RELATIONSHIP_EDGE_SCHEMA_VERSION,
    DEFAULT_TENANT_ID,
    decodePathPart,
    logger
  } = deps;

  // Wrap response helpers to return true (signals "handled" to dispatcher).
  const _sendJson = (...args) => { deps.sendJson(...args); return true; };
  const _sendError = (...args) => { deps.sendError(...args); return true; };

  /**
   * @param {object} ctx - Per-request context
   * @returns {Promise<boolean>} true if handled
   */
  return async function handlePublicRoutes(ctx) {
    const { req, res, method, path, url, tenantId } = ctx;
    // Use wrapped versions that return true for "return sendJson/sendError(...)" pattern.
    const sendJson = _sendJson;
    const sendError = _sendError;

    const isPublicRoute = path.startsWith("/v1/public/") || path.startsWith("/public/") ||
      path.startsWith("/.well-known/agent-locator/");
    if (!isPublicRoute) return false;

    if (req.method === "GET" && path === "/v1/public/agents/resolve") {
      const agentRefRaw = url.searchParams.get("agent");
      const agentRef = typeof agentRefRaw === "string" ? agentRefRaw.trim() : "";
      if (!agentRef) {
        return sendError(res, 400, "invalid agent locator query", { message: "agent query parameter is required" }, {
          code: AGENT_LOCATOR_REASON_CODE.MALFORMED
        });
      }

      let resolution = null;
      try {
        resolution = await resolvePublicAgentLocatorRef({ agentRef, status: AGENT_CARD_STATUS.ACTIVE });
      } catch (err) {
        return sendError(res, 501, "agent locator is not supported for this store", { message: err?.message ?? null }, { code: "NOT_IMPLEMENTED" });
      }

      if (!resolution?.ok) {
        if (resolution?.reasonCode === AGENT_LOCATOR_REASON_CODE.MALFORMED) {
          return sendError(
            res,
            400,
            "invalid agent locator query",
            { locator: resolution?.locator ?? null },
            { code: AGENT_LOCATOR_REASON_CODE.MALFORMED }
          );
        }
        if (resolution?.reasonCode === AGENT_LOCATOR_REASON_CODE.AMBIGUOUS) {
          return sendError(
            res,
            409,
            "agent locator is ambiguous for this reference",
            { locator: resolution?.locator ?? null },
            { code: AGENT_LOCATOR_REASON_CODE.AMBIGUOUS }
          );
        }
        return sendError(
          res,
          404,
          "agent locator did not resolve a public agent",
          { locator: resolution?.locator ?? null },
          { code: AGENT_LOCATOR_REASON_CODE.NOT_FOUND }
        );
      }

      return sendJson(res, 200, { ok: true, locator: resolution.locator });
    }

    {
      const parts = path.split("/").filter(Boolean);
      if (req.method === "GET" && parts[0] === ".well-known" && parts[1] === "agent-locator" && parts[2] && parts.length === 3) {
        let agentRef = null;
        try {
          agentRef = decodeURIComponent(parts[2]);
        } catch {
          return sendError(res, 400, "invalid agent locator path", null, { code: AGENT_LOCATOR_REASON_CODE.MALFORMED });
        }

        let resolution = null;
        try {
          resolution = await resolvePublicAgentLocatorRef({ agentRef, status: AGENT_CARD_STATUS.ACTIVE });
        } catch (err) {
          return sendError(
            res,
            501,
            "agent locator is not supported for this store",
            { message: err?.message ?? null },
            { code: "NOT_IMPLEMENTED" }
          );
        }

        if (!resolution?.ok) {
          if (resolution?.reasonCode === AGENT_LOCATOR_REASON_CODE.MALFORMED) {
            return sendError(
              res,
              400,
              "invalid agent locator path",
              { locator: resolution?.locator ?? null },
              { code: AGENT_LOCATOR_REASON_CODE.MALFORMED }
            );
          }
          if (resolution?.reasonCode === AGENT_LOCATOR_REASON_CODE.AMBIGUOUS) {
            return sendError(
              res,
              409,
              "agent locator is ambiguous for this agentId",
              { locator: resolution?.locator ?? null },
              { code: AGENT_LOCATOR_REASON_CODE.AMBIGUOUS }
            );
          }
          return sendError(
            res,
            404,
            "agent locator did not resolve a public agent",
            { locator: resolution?.locator ?? null },
            { code: AGENT_LOCATOR_REASON_CODE.NOT_FOUND }
          );
        }
        try {
          res.setHeader("cache-control", "public, max-age=300");
        } catch {
          // ignore
        }
        return sendJson(res, 200, resolution.locator);
      }
    }

    if (req.method === "GET" && path === "/public/agent-cards/discover") {
    try {
      const includeReputation = parseBooleanQueryValue(url.searchParams.get("includeReputation"), {
        defaultValue: true,
        name: "includeReputation"
      });
      const requireCapabilityAttestation = parseBooleanQueryValue(url.searchParams.get("requireCapabilityAttestation"), {
        defaultValue: false,
        name: "requireCapabilityAttestation"
      });
      const includeAttestationMetadata = parseBooleanQueryValue(url.searchParams.get("includeAttestationMetadata"), {
        defaultValue: false,
        name: "includeAttestationMetadata"
      });
      const includeRoutingFactors = parseBooleanQueryValue(url.searchParams.get("includeRoutingFactors"), {
        defaultValue: false,
        name: "includeRoutingFactors"
      });
      const toolSideEffectingRaw = url.searchParams.get("toolSideEffecting");
      const toolSideEffecting =
        toolSideEffectingRaw === null
          ? null
          : parseBooleanQueryValue(toolSideEffectingRaw, { defaultValue: false, name: "toolSideEffecting" });
      const result = await discoverAgentCards({
        scope: "public",
        capability: url.searchParams.get("capability"),
        executionCoordinatorDid: url.searchParams.get("executionCoordinatorDid"),
        toolId: url.searchParams.get("toolId"),
        toolMcpName: url.searchParams.get("toolMcpName"),
        toolRiskClass: url.searchParams.get("toolRiskClass"),
        toolSideEffecting,
        toolMaxPriceCents: url.searchParams.get("toolMaxPriceCents"),
        toolRequiresEvidenceKind: url.searchParams.get("toolRequiresEvidenceKind"),
        supportsPolicyTemplate: url.searchParams.get("supportsPolicyTemplate"),
        supportsEvidencePack: url.searchParams.get("supportsEvidencePack"),
        status: url.searchParams.get("status"),
        visibility: url.searchParams.get("visibility"),
        runtime: url.searchParams.get("runtime"),
        requireCapabilityAttestation,
        attestationMinLevel: url.searchParams.get("attestationMinLevel"),
        attestationIssuerAgentId: url.searchParams.get("attestationIssuerAgentId"),
        includeAttestationMetadata,
        minTrustScore: url.searchParams.get("minTrustScore"),
        riskTier: url.searchParams.get("riskTier"),
        limit: parseThresholdIntegerQueryValue(url.searchParams.get("limit"), { defaultValue: 50, min: 1, max: 100, name: "limit" }),
        offset: parseThresholdIntegerQueryValue(url.searchParams.get("offset"), { defaultValue: 0, min: 0, name: "offset" }),
        includeReputation,
        reputationVersion: url.searchParams.get("reputationVersion") ?? "v2",
        reputationWindow: url.searchParams.get("reputationWindow") ?? AGENT_REPUTATION_WINDOW.THIRTY_DAYS,
        asOf: url.searchParams.get("asOf"),
        scoreStrategy: url.searchParams.get("scoreStrategy") ?? "balanced",
        requesterAgentId: url.searchParams.get("requesterAgentId"),
        includeRoutingFactors
      });
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      return sendError(res, 400, "invalid public agent card discovery query", { message: err?.message }, { code: "SCHEMA_INVALID" });
    }
    }

    if (req.method === "GET" && path === "/public/agent-cards/stream") {
    let toolSideEffecting = null;
    let sinceCursor = null;
    let executionCoordinatorDid = null;
    let capabilityFilter = null;
    try {
      const toolSideEffectingRaw = url.searchParams.get("toolSideEffecting");
      toolSideEffecting =
        toolSideEffectingRaw === null
          ? null
          : parseBooleanQueryValue(toolSideEffectingRaw, { defaultValue: false, name: "toolSideEffecting" });
      capabilityFilter =
        typeof url.searchParams.get("capability") === "string" && url.searchParams.get("capability").trim() !== ""
          ? normalizeCapabilityIdentifier(url.searchParams.get("capability"), { name: "capability" })
          : null;
      executionCoordinatorDid = parseExecutionCoordinatorDid(url.searchParams.get("executionCoordinatorDid"), {
        allowNull: true,
        fieldName: "executionCoordinatorDid"
      });
      sinceCursor = parseAgentCardStreamCursor(
        url.searchParams.get("sinceCursor") ??
          (typeof req.headers["last-event-id"] === "string" ? req.headers["last-event-id"] : null),
        { allowNull: true }
      );
    } catch (err) {
      return sendError(res, 400, "invalid public agent card stream query", { message: err?.message }, { code: "SCHEMA_INVALID" });
    }

    const query = {
      capability: capabilityFilter,
      executionCoordinatorDid,
      toolId: url.searchParams.get("toolId"),
      toolMcpName: url.searchParams.get("toolMcpName"),
      toolRiskClass: url.searchParams.get("toolRiskClass"),
      toolSideEffecting,
      toolMaxPriceCents: url.searchParams.get("toolMaxPriceCents"),
      toolRequiresEvidenceKind: url.searchParams.get("toolRequiresEvidenceKind"),
      status: url.searchParams.get("status"),
      runtime: url.searchParams.get("runtime")
    };

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    const writeSseEvent = ({ eventName, eventId = null, data = null } = {}) => {
      if (eventId !== null && eventId !== undefined && String(eventId).trim() !== "") {
        res.write(`id: ${String(eventId).trim()}\n`);
      }
      if (eventName) res.write(`event: ${eventName}\n`);
      if (data !== null && data !== undefined) {
        const dataString = typeof data === "string" ? data : JSON.stringify(data);
        const lines = String(dataString).split("\n");
        for (const line of lines) res.write(`data: ${line}\n`);
      } else {
        res.write("data: null\n");
      }
      res.write("\n");
    };

    writeSseEvent({
      eventName: "agent_cards.ready",
      data: {
        ok: true,
        scope: "public",
        sinceCursor: sinceCursor?.raw ?? null,
        query: normalizeForCanonicalJson(
          {
            capability: query.capability ?? null,
            executionCoordinatorDid: query.executionCoordinatorDid ?? null,
            toolId: query.toolId ?? null,
            toolMcpName: query.toolMcpName ?? null,
            toolRiskClass: query.toolRiskClass ?? null,
            toolSideEffecting: query.toolSideEffecting,
            toolMaxPriceCents: query.toolMaxPriceCents ?? null,
            toolRequiresEvidenceKind: query.toolRequiresEvidenceKind ?? null,
            status: query.status ?? null,
            runtime: query.runtime ?? null
          },
          { path: "$.query" }
        )
      }
    });

    let closed = false;
    let pollTimer = null;
    let heartbeatTimer = null;
    let lastCursor = sinceCursor;
    let visibleRowsByScopedKey = null;

    const closeStream = () => {
      if (closed) return;
      closed = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      try {
        res.end();
      } catch {
        // no-op
      }
    };
    req.on("close", closeStream);
    req.on("aborted", closeStream);

    const emitRows = (rows, { forceScopedKeys = null, at = null } = {}) => {
      if (!Array.isArray(rows) || rows.length === 0) return;
      for (const row of rows) {
        const tenantId =
          typeof row?.tenantId === "string" && row.tenantId.trim() !== ""
            ? row.tenantId.trim()
            : normalizeTenantId(DEFAULT_TENANT_ID);
        const agentId = typeof row?.agentId === "string" && row.agentId.trim() !== "" ? row.agentId.trim() : null;
        if (!agentId) continue;
        const scopedKey = makeScopedKey({ tenantId, id: agentId });
        const forceUpsert = forceScopedKeys instanceof Set && forceScopedKeys.has(scopedKey);
        let effectiveCursor = {
          updatedAt: row.updatedAt,
          tenantId,
          agentId,
          raw: row.cursor
        };
        if (lastCursor && compareAgentCardStreamCursor(effectiveCursor, lastCursor) <= 0) {
          if (!forceUpsert) continue;
          effectiveCursor = buildNextAgentCardStreamCursorAfter({
            lastCursor,
            tenantId,
            agentId,
            at
          });
        }
        writeSseEvent({
          eventName: "agent_card.upsert",
          eventId: effectiveCursor.raw,
          data: normalizeForCanonicalJson(
            {
              schemaVersion: AGENT_CARD_STREAM_EVENT_SCHEMA_VERSION,
              type: "AGENT_CARD_UPSERT",
              scope: "public",
              cursor: effectiveCursor.raw,
              updatedAt: row.updatedAt,
              tenantId,
              agentId,
              agentCard: row.agentCard
            },
            { path: "$.event" }
          )
        });
        lastCursor = effectiveCursor;
      }
    };

    const emitRemovedRows = ({ previousVisibleByScopedKey, currentVisibleByScopedKey, at } = {}) => {
      if (!(previousVisibleByScopedKey instanceof Map) || previousVisibleByScopedKey.size === 0) return;
      if (!(currentVisibleByScopedKey instanceof Map)) return;
      const removedRows = [];
      for (const [scopedKey, previousRow] of previousVisibleByScopedKey.entries()) {
        if (currentVisibleByScopedKey.has(scopedKey)) continue;
        const tenantId =
          typeof previousRow?.tenantId === "string" && previousRow.tenantId.trim() !== ""
            ? previousRow.tenantId.trim()
            : normalizeTenantId(DEFAULT_TENANT_ID);
        const agentId = typeof previousRow?.agentId === "string" && previousRow.agentId.trim() !== "" ? previousRow.agentId.trim() : null;
        if (!agentId) continue;
        removedRows.push({
          tenantId,
          agentId
        });
      }
      removedRows.sort((left, right) => {
        const tenantOrder = String(left.tenantId ?? "").localeCompare(String(right.tenantId ?? ""));
        if (tenantOrder !== 0) return tenantOrder;
        return String(left.agentId ?? "").localeCompare(String(right.agentId ?? ""));
      });
      for (const removedRow of removedRows) {
        const nextCursor = buildNextAgentCardStreamCursorAfter({
          lastCursor,
          tenantId: removedRow.tenantId,
          agentId: removedRow.agentId,
          at
        });
        writeSseEvent({
          eventName: "agent_card.removed",
          eventId: nextCursor.raw,
          data: normalizeForCanonicalJson(
            {
              schemaVersion: AGENT_CARD_STREAM_EVENT_SCHEMA_VERSION,
              type: "AGENT_CARD_REMOVED",
              scope: "public",
              cursor: nextCursor.raw,
              removedAt: nextCursor.updatedAt,
              tenantId: removedRow.tenantId,
              agentId: removedRow.agentId,
              reasonCode: "NO_LONGER_VISIBLE"
            },
            { path: "$.event" }
          )
        });
        lastCursor = nextCursor;
      }
    };

    const schedulePoll = (delayMs = 300) => {
      if (closed) return;
      pollTimer = setTimeout(() => {
        void pollAndFlush();
      }, delayMs);
    };

    const pollAndFlush = async () => {
      if (closed) return;
      let rows = [];
      const pollAt = nowIso();
      try {
        rows = await listPublicAgentCardsForStream(query);
      } catch (err) {
        writeSseEvent({
          eventName: "agent_cards.error",
          data: {
            ok: false,
            code: "PUBLIC_AGENT_CARD_STREAM_READ_FAILED",
            message: err?.message ?? "failed to read public agent cards"
          }
        });
        return closeStream();
      }
      const currentVisibleByScopedKey = new Map();
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const tenantId = normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID);
        const agentId = typeof row.agentId === "string" && row.agentId.trim() !== "" ? row.agentId.trim() : null;
        if (!agentId) continue;
        currentVisibleByScopedKey.set(makeScopedKey({ tenantId, id: agentId }), {
          tenantId,
          agentId
        });
      }
      const forceUpsertScopedKeys = (() => {
        if (!(visibleRowsByScopedKey instanceof Map)) return null;
        const out = new Set();
        for (const scopedKey of currentVisibleByScopedKey.keys()) {
          if (visibleRowsByScopedKey.has(scopedKey)) continue;
          out.add(scopedKey);
        }
        return out.size > 0 ? out : null;
      })();
      emitRows(rows, {
        forceScopedKeys: forceUpsertScopedKeys,
        at: pollAt
      });
      if (visibleRowsByScopedKey instanceof Map) {
        emitRemovedRows({
          previousVisibleByScopedKey: visibleRowsByScopedKey,
          currentVisibleByScopedKey,
          at: pollAt
        });
      }
      visibleRowsByScopedKey = currentVisibleByScopedKey;
      schedulePoll(300);
    };

    heartbeatTimer = setInterval(() => {
      if (closed) return;
      res.write(": keepalive\n\n");
    }, 10_000);

    void pollAndFlush();
    return;
    }

    {
    const parts = path.split("/").filter(Boolean);
    if (req.method === "GET" && parts[0] === "public" && parts[1] === "agent-cards" && parts[2] && parts.length === 3) {
      const targetAgentId = parts[2];
      const defaultAsOf = nowIso();
      let asOf = defaultAsOf;
      let includeReputation = true;
      let reputationVersion = "v2";
      let reputationWindow = AGENT_REPUTATION_WINDOW.THIRTY_DAYS;
      try {
        asOf = parseAsOfDateTime(url.searchParams.get("asOf"), { defaultValue: defaultAsOf, fieldName: "asOf" });
        includeReputation = parseBooleanQueryValue(url.searchParams.get("includeReputation"), {
          defaultValue: true,
          name: "includeReputation"
        });
        reputationVersion = parseReputationVersion(url.searchParams.get("reputationVersion") ?? "v2");
        reputationWindow = parseReputationWindow(url.searchParams.get("reputationWindow") ?? AGENT_REPUTATION_WINDOW.THIRTY_DAYS);
      } catch (err) {
        return sendError(res, 400, "invalid public agent card query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      let resolvedPublicAgent = null;
      try {
        resolvedPublicAgent = await resolvePublicAgentCardByAgentId({ agentId: targetAgentId, status: AGENT_CARD_STATUS.ACTIVE });
      } catch (err) {
        return sendError(res, 501, "public agent cards are not supported for this store", { message: err?.message }, { code: "NOT_IMPLEMENTED" });
      }
      if (!resolvedPublicAgent?.ok) {
        if (resolvedPublicAgent?.code === "PUBLIC_AGENT_AMBIGUOUS") {
          return sendError(
            res,
            409,
            "public agent card is ambiguous for this agent id",
            resolvedPublicAgent?.details ?? null,
            { code: "PUBLIC_AGENT_AMBIGUOUS" }
          );
        }
        return sendError(res, 404, "public agent not found", null, { code: "NOT_FOUND" });
      }

      const agentCard = resolvedPublicAgent.card;
      if (!includeReputation) {
        return sendJson(res, 200, { ok: true, agentCard });
      }

      const publicTenantId = normalizeTenant(agentCard.tenantId ?? DEFAULT_TENANT_ID);
      const reputation = await computeAgentReputationSnapshotVersioned({
        tenantId: publicTenantId,
        agentId: targetAgentId,
        at: asOf,
        reputationVersion,
        reputationWindow
      });
      return sendJson(res, 200, { ok: true, agentCard, reputation });
    }

    if (req.method === "GET" && parts[0] === "public" && parts[1] === "agents" && parts[2] && parts[3] === "reputation-summary" && parts.length === 4) {
      const targetAgentId = parts[2];
      const defaultAsOf = nowIso();
      let asOf = defaultAsOf;
      try {
        asOf = parseAsOfDateTime(url.searchParams.get("asOf"), { defaultValue: defaultAsOf, fieldName: "asOf" });
      } catch (err) {
        return sendError(res, 400, "invalid public reputation summary query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let reputationVersion = "v2";
      let reputationWindow = AGENT_REPUTATION_WINDOW.THIRTY_DAYS;
      let includeRelationships = true;
      let relationshipLimit = 5;
      try {
        reputationVersion = parseReputationVersion(url.searchParams.get("reputationVersion") ?? "v2");
        reputationWindow = parseReputationWindow(url.searchParams.get("reputationWindow") ?? AGENT_REPUTATION_WINDOW.THIRTY_DAYS);
        includeRelationships = parseBooleanQueryValue(url.searchParams.get("includeRelationships"), {
          defaultValue: true,
          name: "includeRelationships"
        });
        relationshipLimit = parseRelationshipListLimit(url.searchParams.get("relationshipLimit"), { defaultValue: 5 });
      } catch (err) {
        return sendError(res, 400, "invalid public reputation summary query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      let resolvedPublicAgent = null;
      try {
        resolvedPublicAgent = await resolvePublicAgentCardByAgentId({ agentId: targetAgentId, status: AGENT_CARD_STATUS.ACTIVE });
      } catch (err) {
        return sendError(res, 501, "public reputation summary is not supported for this store", { message: err?.message }, { code: "NOT_IMPLEMENTED" });
      }
      if (!resolvedPublicAgent?.ok) {
        if (resolvedPublicAgent?.code === "PUBLIC_AGENT_AMBIGUOUS") {
          return sendError(
            res,
            409,
            "public reputation summary is ambiguous for this agent id",
            resolvedPublicAgent?.details ?? null,
            { code: "PUBLIC_AGENT_AMBIGUOUS" }
          );
        }
        return sendError(res, 404, "public agent not found", null, { code: "NOT_FOUND" });
      }
      const publicCard = resolvedPublicAgent.card;
      const summaryVisibility = resolveAgentCardPublicSummaryVisibility(publicCard);
      if (!summaryVisibility.publicReputationSummary) {
        return sendError(res, 404, "public reputation summary is not enabled for this agent", null, {
          code: "PUBLIC_REPUTATION_SUMMARY_DISABLED"
        });
      }
      const publicTenantId = normalizeTenant(publicCard.tenantId ?? DEFAULT_TENANT_ID);
      const reputation = await computeAgentReputationSnapshotVersioned({
        tenantId: publicTenantId,
        agentId: targetAgentId,
        at: asOf,
        reputationVersion,
        reputationWindow
      });

      const windowStartAt = reputationWindowStartAt({ window: reputationWindow, at: asOf });
      const events = await listRoutingReputationEvents({
        tenantId: publicTenantId,
        agentId: targetAgentId,
        occurredAtGte: windowStartAt,
        occurredAtLte: asOf
      });
      const aggregate = computeReputationFactsAggregate({ events });
      const relationshipStats = computeRoutingReputationEventStats({ events });
      let relationships = [];
      if (includeRelationships) {
        const listed = await listRelationshipEdgesForAgent({
          tenantId: publicTenantId,
          agentId: targetAgentId,
          asOf,
          reputationWindow,
          limit: relationshipLimit,
          offset: 0,
          publicOnly: true
        });
        relationships = (listed.relationships ?? []).map((edge) =>
          normalizeForCanonicalJson(
            {
              schemaVersion: RELATIONSHIP_EDGE_SCHEMA_VERSION,
              counterpartyAgentId: edge.counterpartyAgentId,
              workedWithCount: Number(edge.workedWithCount ?? 0),
              successRate: edge.successRate ?? null,
              disputeRate: edge.disputeRate ?? null,
              lastInteractionAt: edge.lastInteractionAt ?? null
            },
            { path: "$.relationships[]" }
          )
        );
      }

      const summary = normalizeForCanonicalJson(
        {
          schemaVersion: PUBLIC_AGENT_REPUTATION_SUMMARY_SCHEMA_VERSION,
          agentId: targetAgentId,
          reputationVersion,
          reputationWindow,
          asOf,
          trustScore: Number(reputation?.trustScore ?? 0),
          riskTier: String(reputation?.riskTier ?? "high"),
          eventCount: Number(aggregate?.totals?.eventCount ?? 0),
          decisionsTotal: Number(relationshipStats?.decisionsTotal ?? 0),
          decisionsApproved: Number(relationshipStats?.decisionsApproved ?? 0),
          successRate: toSafeRelationshipRate(relationshipStats?.approvalRate),
          disputesOpened: Number(relationshipStats?.disputesOpened ?? 0),
          disputeRate: toSafeRelationshipRate(relationshipStats?.disputeRate),
          lastInteractionAt: relationshipStats?.lastInteractionAt ?? null,
          relationships
        },
        { path: "$.summary" }
      );
      return sendJson(res, 200, { ok: true, summary });
    }

    // Check if the response was sent by a route that uses bare "return;" (e.g. SSE streams).
    if (res.writableEnded || res.headersSent) return true;

    return false;
  };
}
