/**
 * Agent and agent-card routes: /agents/*, /agent-cards/*
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
export function createAgentRoutes(deps) {
  const {
    store,
    sendJson,
    sendError,
    readJsonBody,
    createId,
    nowIso,
    commitTx,
    normalizeForCanonicalJson,
    getAgentIdentityRecord,
    listAgentIdentityRecords,
    upsertAgentIdentityRecord,
    getAgentCardRecord,
    listAgentCardRecords,
    upsertAgentCardRecord,
    discoverAgentCards,
    resolvePublicAgentCardByAgentId,
    computeAgentReputationSnapshotVersioned,
    parseBooleanQueryValue,
    parseThresholdIntegerQueryValue,
    parseAsOfDateTime,
    parseReputationVersion,
    parseReputationWindow,
    normalizeCapabilityIdentifier,
    normalizeAgentCardStatusInput,
    normalizeAgentCardVisibilityInput,
    buildAgentCardAbuseReport,
    listAgentCardAbuseReports,
    normalizeAgentCardToolManifestInput,
    requireProtocolHeaderForWrite,
    decodePathPart,
    requireScope,
    OPS_SCOPES,
    AGENT_CARD_STATUS,
    AGENT_REPUTATION_WINDOW,
    logger
  } = deps;

  // Wrap response helpers to return true (signals "handled" to dispatcher).
  const _sendJson = (...args) => { deps.sendJson(...args); return true; };
  const _sendError = (...args) => { deps.sendError(...args); return true; };

  /**
   * @param {object} ctx - Per-request context
   * @returns {Promise<boolean>} true if handled
   */
  return async function handleAgentRoutes(ctx) {
    const { req, res, method, path, url, tenantId, principalId, auth, readIdempotency, makeOpsAudit } = ctx;
    // Use wrapped versions that return true for "return sendJson/sendError(...)" pattern.
    const sendJson = _sendJson;
    const sendError = _sendError;

    if (!path.startsWith("/agents") && !path.startsWith("/agent-cards")) return false;

    if (req.method === "POST" && path === "/agent-cards") {
    if (typeof store.getAgentCard !== "function" && !(store.agentCards instanceof Map)) {
      return sendError(res, 501, "agent cards not supported for this store");
    }
    if (!requireProtocolHeaderForWrite(req, res)) return;

    const body = await readJsonBody(req);
    let idemStoreKey = null;
    let idemRequestHash = null;
    try {
      ({ idemStoreKey, idemRequestHash } = readIdempotency({ method: "POST", requestPath: path, expectedPrevChainHash: null, body }));
    } catch (err) {
      return sendError(res, 400, "invalid idempotency key", { message: err?.message });
    }
    if (idemStoreKey) {
      const existing = store.idempotency.get(idemStoreKey);
      if (existing) {
        if (existing.requestHash !== idemRequestHash) {
          return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
        }
        return sendJson(res, existing.statusCode, existing.body);
      }
    }

    const agentId = typeof body?.agentId === "string" && body.agentId.trim() !== "" ? body.agentId.trim() : null;
    if (!agentId) return sendError(res, 400, "agentId is required", null, { code: "SCHEMA_INVALID" });

    let agentIdentity = null;
    try {
      agentIdentity = await getAgentIdentityRecord({ tenantId, agentId });
    } catch (err) {
      return sendError(res, 400, "invalid agentId", { message: err?.message }, { code: "SCHEMA_INVALID" });
    }
    if (!agentIdentity) return sendError(res, 404, "agent identity not found", null, { code: "NOT_FOUND" });

    let existingCard = null;
    try {
      existingCard = await getAgentCardRecord({ tenantId, agentId });
    } catch (err) {
      return sendError(res, 501, "agent cards not supported for this store", { message: err?.message });
    }
    let requestedVisibility = AGENT_CARD_VISIBILITY.PUBLIC;
    try {
      requestedVisibility = parseAgentCardVisibility(body?.visibility, {
        allowAll: false,
        defaultVisibility: existingCard?.visibility ?? AGENT_CARD_VISIBILITY.PUBLIC
      });
    } catch (err) {
      return sendError(res, 400, "invalid agent card visibility", { message: err?.message }, { code: "SCHEMA_INVALID" });
    }

    const shouldChargePublicListingFee =
      requestedVisibility === AGENT_CARD_VISIBILITY.PUBLIC &&
      String(existingCard?.visibility ?? "").toLowerCase() !== AGENT_CARD_VISIBILITY.PUBLIC &&
      agentCardPublicListingFeeCentsValue > 0;
    const shouldRateLimitPublicPublish =
      requestedVisibility === AGENT_CARD_VISIBILITY.PUBLIC &&
      String(existingCard?.visibility ?? "").toLowerCase() !== AGENT_CARD_VISIBILITY.PUBLIC;
    const requirePublishSignature =
      requestedVisibility === AGENT_CARD_VISIBILITY.PUBLIC &&
      agentCardPublicRequirePublishSignatureValue === true;

    if (shouldRateLimitPublicPublish) {
      const publishRateCheck = takePublicAgentCardPublishToken({ tenantId, agentId });
      if (!publishRateCheck.ok) {
        try {
          res.setHeader("retry-after", String(publishRateCheck.retryAfterSeconds ?? 1));
        } catch {
          // ignore
        }
        return sendError(
          res,
          429,
          "public agent card publish rate limit exceeded",
          {
            scope: publishRateCheck.scope ?? null,
            max: publishRateCheck.max ?? null,
            retryAfterSeconds: publishRateCheck.retryAfterSeconds ?? 1,
            windowSeconds: publishRateCheck.windowSeconds ?? null,
            agentId,
            tenantId
          },
          { code: "AGENT_CARD_PUBLIC_PUBLISH_RATE_LIMITED" }
        );
      }
    }

    const publishSignatureInput =
      body?.publish && typeof body.publish === "object" && !Array.isArray(body.publish)
        ? body.publish
        : body?.publish === null || body?.publish === undefined
          ? null
          : "__invalid__";
    if (publishSignatureInput === null && requirePublishSignature) {
      return sendError(
        res,
        409,
        "agent card publish signature is required for public visibility",
        buildAgentCardPublishSignatureDetails({
          reasonCode: "AGENT_CARD_PUBLISH_SIGNATURE_REQUIRED",
          reason: "agent card publish signature is required for public visibility"
        }),
        { code: "AGENT_CARD_PUBLISH_SIGNATURE_REQUIRED" }
      );
    }
    let publishSignature = null;
    if (publishSignatureInput !== null) {
      const verification = await verifyAgentCardPublishSignature({
        tenantId,
        agentIdentity,
        requestBody: body,
        publishSignatureInput:
          publishSignatureInput === "__invalid__" ? body?.publish ?? null : publishSignatureInput
      });
      if (!verification.ok) {
        return sendError(
          res,
          409,
          "agent card publish signature verification failed",
          verification.details ?? null,
          { code: "AGENT_CARD_PUBLISH_SIGNATURE_INVALID" }
        );
      }
      publishSignature = verification.publishSignature ?? null;
    }

    const upsertedAt = nowIso();
    let agentCard = null;
    try {
      agentCard = buildAgentCardV1({
        tenantId,
        agentIdentity,
        previousCard: existingCard,
        nowAt: upsertedAt,
        cardInput: {
          agentId,
          displayName: body?.displayName ?? undefined,
          description: body?.description ?? undefined,
          capabilities: body?.capabilities ?? undefined,
          visibility: body?.visibility ?? undefined,
          executionCoordinatorDid: body?.executionCoordinatorDid ?? undefined,
          host: body?.host ?? undefined,
          priceHint: body?.priceHint ?? undefined,
          attestations: body?.attestations ?? undefined,
          tools: body?.tools ?? undefined,
          tags: body?.tags ?? undefined,
          metadata: body?.metadata ?? undefined,
          policyCompatibility: body?.policyCompatibility ?? undefined,
          publish: publishSignature ?? null
        }
      });
      validateAgentCardV1(agentCard);
    } catch (err) {
      return sendError(res, 400, "invalid agent card", { message: err?.message }, { code: "SCHEMA_INVALID" });
    }

    if (agentCard.visibility === AGENT_CARD_VISIBILITY.PUBLIC && agentCardPublicRequireCapabilityAttestationValue) {
      const capabilities = Array.isArray(agentCard.capabilities) ? agentCard.capabilities : [];
      if (capabilities.length === 0) {
        return sendError(
          res,
          409,
          "public agent card capability attestations are required",
          {
            agentId,
            minLevel: agentCardPublicAttestationMinLevelValue,
            issuerAgentId: agentCardPublicAttestationIssuerAgentIdValue,
            blockingCapabilities: []
          },
          { code: "AGENT_CARD_PUBLIC_ATTESTATION_REQUIRED" }
        );
      }
      const blockingCapabilities = [];
      try {
        for (const capabilityName of capabilities) {
          const attestationCheck = await assessCapabilityAttestationForDiscovery({
            tenantId,
            agentId,
            capability: capabilityName,
            minLevel: agentCardPublicAttestationMinLevelValue,
            issuerAgentId: agentCardPublicAttestationIssuerAgentIdValue,
            at: upsertedAt
          });
          if (attestationCheck?.isValid !== true) {
            blockingCapabilities.push({
              capability: capabilityName,
              reasonCode: attestationCheck?.reasonCode ?? CAPABILITY_ATTESTATION_REASON_CODE.INVALID
            });
          }
        }
      } catch (err) {
        if (err?.message === "capability attestations not supported for this store") {
          return sendError(
            res,
            501,
            "capability attestations are required for public agent card publishing",
            null,
            { code: "AGENT_CARD_PUBLIC_ATTESTATION_UNSUPPORTED" }
          );
        }
        return sendError(res, 400, "invalid capability attestation query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (blockingCapabilities.length > 0) {
        return sendError(
          res,
          409,
          "public agent card capability attestations are required",
          {
            agentId,
            minLevel: agentCardPublicAttestationMinLevelValue,
            issuerAgentId: agentCardPublicAttestationIssuerAgentIdValue,
            blockingCapabilities
          },
          { code: "AGENT_CARD_PUBLIC_ATTESTATION_REQUIRED" }
        );
      }
    }

    let listingFeeMetadata = null;
    const listingWalletOps = [];
    if (shouldChargePublicListingFee) {
      const hasWalletStore = typeof store.getAgentWallet === "function" || store.agentWallets instanceof Map;
      if (!hasWalletStore) {
        return sendError(
          res,
          501,
          "agent wallets are required for public listing fee enforcement",
          null,
          { code: "AGENT_CARD_PUBLIC_LISTING_FEE_UNSUPPORTED" }
        );
      }
      if (String(agentCardPublicListingFeeCollectorAgentIdValue) === String(agentId)) {
        return sendError(
          res,
          409,
          "public listing fee collector cannot equal agentId",
          null,
          { code: "AGENT_CARD_PUBLIC_LISTING_FEE_MISCONFIGURED" }
        );
      }
      let collectorIdentity = null;
      try {
        collectorIdentity = await getAgentIdentityRecord({
          tenantId,
          agentId: agentCardPublicListingFeeCollectorAgentIdValue
        });
      } catch (err) {
        return sendError(res, 400, "invalid collector agent identity", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (!collectorIdentity) {
        return sendError(
          res,
          409,
          "public listing fee collector agent identity not found",
          null,
          { code: "AGENT_CARD_PUBLIC_LISTING_FEE_MISCONFIGURED" }
        );
      }
      let payerWalletExisting = null;
      let collectorWalletExisting = null;
      try {
        payerWalletExisting = await getAgentWalletRecord({ tenantId, agentId });
        collectorWalletExisting = await getAgentWalletRecord({ tenantId, agentId: agentCardPublicListingFeeCollectorAgentIdValue });
      } catch (err) {
        return sendError(res, 400, "invalid agent wallet query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let payerWallet = ensureAgentWallet({
        wallet: payerWalletExisting,
        tenantId,
        agentId,
        currency: agentCardPublicListingFeeCurrencyValue,
        at: upsertedAt
      });
      let collectorWallet = ensureAgentWallet({
        wallet: collectorWalletExisting,
        tenantId,
        agentId: agentCardPublicListingFeeCollectorAgentIdValue,
        currency: agentCardPublicListingFeeCurrencyValue,
        at: upsertedAt
      });
      try {
        const moved = transferAgentWalletAvailable({
          fromWallet: payerWallet,
          toWallet: collectorWallet,
          amountCents: agentCardPublicListingFeeCentsValue,
          at: upsertedAt
        });
        payerWallet = moved.fromWallet;
        collectorWallet = moved.toWallet;
      } catch (err) {
        if (err?.code === "INSUFFICIENT_WALLET_BALANCE") {
          return sendError(res, 402, "insufficient wallet balance for public listing fee", { message: err?.message }, { code: "INSUFFICIENT_FUNDS" });
        }
        return sendError(res, 400, "public listing fee transfer failed", { message: err?.message }, { code: err?.code ?? "WALLET_TRANSFER_FAILED" });
      }
      listingWalletOps.push({ kind: "AGENT_WALLET_UPSERT", tenantId, wallet: payerWallet });
      listingWalletOps.push({ kind: "AGENT_WALLET_UPSERT", tenantId, wallet: collectorWallet });
      listingFeeMetadata = normalizeForCanonicalJson(
        {
          schemaVersion: "AgentCardPublicListingFee.v1",
          amountCents: agentCardPublicListingFeeCentsValue,
          currency: agentCardPublicListingFeeCurrencyValue,
          collectorAgentId: agentCardPublicListingFeeCollectorAgentIdValue,
          chargedAt: upsertedAt
        },
        { path: "$.metadata.publicListingFee" }
      );
    }

    if (listingFeeMetadata) {
      const metadataBase =
        agentCard.metadata && typeof agentCard.metadata === "object" && !Array.isArray(agentCard.metadata) ? agentCard.metadata : {};
      let cardMetadataInput = null;
      try {
        cardMetadataInput = normalizeForCanonicalJson(
          {
            ...metadataBase,
            publicListingFee: listingFeeMetadata
          },
          { path: "$.metadata" }
        );
        agentCard = buildAgentCardV1({
          tenantId,
          agentIdentity,
          previousCard: existingCard,
          nowAt: upsertedAt,
          cardInput: {
            agentId,
            displayName: body?.displayName ?? undefined,
            description: body?.description ?? undefined,
            capabilities: body?.capabilities ?? undefined,
            visibility: body?.visibility ?? undefined,
            executionCoordinatorDid: body?.executionCoordinatorDid ?? undefined,
            host: body?.host ?? undefined,
            priceHint: body?.priceHint ?? undefined,
            attestations: body?.attestations ?? undefined,
            tools: body?.tools ?? undefined,
            tags: body?.tags ?? undefined,
            metadata: cardMetadataInput,
            policyCompatibility: body?.policyCompatibility ?? undefined,
            publish: publishSignature ?? null
          }
        });
        validateAgentCardV1(agentCard);
      } catch (err) {
        return sendError(res, 400, "invalid agent card", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
    }

    const created = !existingCard;
    const responseStatusCode = created ? 201 : 200;
    const responseBody = { ok: true, agentCard };
    const ops = [...listingWalletOps, { kind: "AGENT_CARD_UPSERT", tenantId, agentId, agentCard }];
    if (idemStoreKey) {
      ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: responseStatusCode, body: responseBody } });
    }
    await commitTx(ops);
    return sendJson(res, responseStatusCode, responseBody);
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
    }

    if (req.method === "GET" && path === "/relationships") {
    const agentId = typeof url.searchParams.get("agentId") === "string" ? String(url.searchParams.get("agentId")).trim() : "";
    if (!agentId) return sendError(res, 400, "agentId is required", null, { code: "SCHEMA_INVALID" });
    const counterpartyAgentId = url.searchParams.get("counterpartyAgentId");
    const visibility = url.searchParams.get("visibility");
    if (visibility !== null && visibility !== undefined) {
      const visibilityValue = String(visibility).trim().toLowerCase();
      if (visibilityValue !== "all" && visibilityValue !== RELATIONSHIP_EDGE_VISIBILITY.PRIVATE && visibilityValue !== RELATIONSHIP_EDGE_VISIBILITY.PUBLIC_SUMMARY) {
        return sendError(res, 400, "invalid relationship visibility query", null, { code: "SCHEMA_INVALID" });
      }
    }
    let reputationWindow = AGENT_REPUTATION_WINDOW.THIRTY_DAYS;
    let asOf = nowIso();
    let limit = 50;
    let offset = 0;
    try {
      reputationWindow = parseReputationWindow(url.searchParams.get("reputationWindow") ?? AGENT_REPUTATION_WINDOW.THIRTY_DAYS);
      if (url.searchParams.get("asOf")) {
        const candidate = String(url.searchParams.get("asOf") ?? "").trim();
        if (!Number.isFinite(Date.parse(candidate))) throw new TypeError("asOf must be an ISO date-time");
        asOf = candidate;
      }
      limit = parseRelationshipListLimit(url.searchParams.get("limit"), { defaultValue: 50 });
      offset = parseRelationshipListOffset(url.searchParams.get("offset"), { defaultValue: 0 });
    } catch (err) {
      return sendError(res, 400, "invalid relationships query", { message: err?.message }, { code: "SCHEMA_INVALID" });
    }

    let agentIdentity = null;
    try {
      agentIdentity = await getAgentIdentityRecord({ tenantId, agentId });
    } catch (err) {
      return sendError(res, 501, "relationships are not supported for this store", { message: err?.message }, { code: "NOT_IMPLEMENTED" });
    }
    if (!agentIdentity) return sendError(res, 404, "agent identity not found", null, { code: "NOT_FOUND" });

    let result = null;
    try {
      result = await listRelationshipEdgesForAgent({
        tenantId,
        agentId,
        counterpartyAgentId: counterpartyAgentId && counterpartyAgentId.trim() !== "" ? counterpartyAgentId.trim() : null,
        asOf,
        reputationWindow,
        limit,
        offset,
        publicOnly: false
      });
    } catch (err) {
      return sendError(res, 400, "invalid relationships query", { message: err?.message }, { code: "SCHEMA_INVALID" });
    }
    const visibilityFilter =
      visibility === null || visibility === undefined || String(visibility).trim() === ""
        ? "all"
        : String(visibility).trim().toLowerCase();
    let relationships = Array.isArray(result?.relationships) ? result.relationships : [];
    if (visibilityFilter !== "all") {
      relationships = relationships.filter((edge) => String(edge?.visibility ?? "").toLowerCase() === visibilityFilter);
    }
    return sendJson(res, 200, {
      ok: true,
      agentId,
      reputationWindow: result?.reputationWindow ?? reputationWindow,
      asOf: result?.asOf ?? asOf,
      total: visibilityFilter === "all" ? Number(result?.total ?? relationships.length) : relationships.length,
      limit: Number(result?.limit ?? limit),
      offset: Number(result?.offset ?? offset),
      relationships
    });
    }

    if (req.method === "GET" && path === "/agent-cards/discover") {
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
        tenantId,
        scope: "tenant",
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
      return sendError(res, 400, "invalid agent card discovery query", { message: err?.message }, { code: "SCHEMA_INVALID" });
    }
    }

    if (req.method === "GET" && path === "/agent-cards") {
    const status = url.searchParams.get("status");
    const visibility = url.searchParams.get("visibility");
    const capability = url.searchParams.get("capability");
    const executionCoordinatorDid = url.searchParams.get("executionCoordinatorDid");
    const runtime = url.searchParams.get("runtime");
    const agentId = url.searchParams.get("agentId");
    const limitRaw = url.searchParams.get("limit");
    const offsetRaw = url.searchParams.get("offset");
    const limit = limitRaw ? Number(limitRaw) : 200;
    const offset = offsetRaw ? Number(offsetRaw) : 0;
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(1000, limit) : 200;
    const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    let statusFilter = null;
    let visibilityFilter = null;
    let executionCoordinatorDidFilter = null;
    let capabilityFilter = null;
    try {
      statusFilter = status && status.trim() !== "" ? parseDiscoveryStatus(status) : null;
      visibilityFilter = visibility && visibility.trim() !== "" ? parseAgentCardVisibility(visibility, { allowAll: false }) : null;
      executionCoordinatorDidFilter =
        typeof executionCoordinatorDid === "string" && executionCoordinatorDid.trim() !== ""
          ? parseExecutionCoordinatorDid(executionCoordinatorDid, { allowNull: false, fieldName: "executionCoordinatorDid" })
          : null;
      capabilityFilter =
        typeof capability === "string" && capability.trim() !== ""
          ? normalizeCapabilityIdentifier(capability, { name: "capability" })
          : null;
    } catch (err) {
      return sendError(res, 400, "invalid agent card query", { message: err?.message }, { code: "SCHEMA_INVALID" });
    }
    let cards = [];
    try {
      if (typeof store.listAgentCards === "function") {
        cards = await store.listAgentCards({
          tenantId,
          agentId: typeof agentId === "string" && agentId.trim() !== "" ? agentId.trim() : null,
          status: statusFilter === "all" ? null : statusFilter,
          visibility: visibilityFilter,
          capability: capabilityFilter,
          executionCoordinatorDid: executionCoordinatorDidFilter,
          runtime: typeof runtime === "string" && runtime.trim() !== "" ? runtime.trim().toLowerCase() : null,
          limit: safeLimit,
          offset: safeOffset
        });
      } else if (store.agentCards instanceof Map) {
        cards = Array.from(store.agentCards.values())
          .filter((row) => row && typeof row === "object")
          .filter((row) => normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) === tenantId)
          .filter((row) => (statusFilter && statusFilter !== "all" ? String(row.status ?? "").toLowerCase() === statusFilter : true))
          .filter((row) => (visibilityFilter ? String(row.visibility ?? "").toLowerCase() === visibilityFilter : true))
          .filter((row) =>
            capabilityFilter ? Array.isArray(row.capabilities) && row.capabilities.includes(capabilityFilter) : true
          )
          .filter((row) =>
            executionCoordinatorDidFilter
              ? String(row.executionCoordinatorDid ?? "") === executionCoordinatorDidFilter
              : true
          )
          .filter((row) => {
            if (typeof runtime !== "string" || runtime.trim() === "") return true;
            const hostRuntime =
              row?.host && typeof row.host === "object" && !Array.isArray(row.host) && typeof row.host.runtime === "string"
                ? row.host.runtime.trim().toLowerCase()
                : "";
            return hostRuntime === runtime.trim().toLowerCase();
          })
          .filter((row) => (typeof agentId === "string" && agentId.trim() !== "" ? String(row.agentId ?? "") === agentId.trim() : true))
          .sort((left, right) => String(left.agentId ?? "").localeCompare(String(right.agentId ?? "")))
          .slice(safeOffset, safeOffset + safeLimit);
      } else {
        return sendError(res, 501, "agent cards not supported for this store");
      }
    } catch (err) {
      return sendError(res, 400, "invalid agent card query", { message: err?.message }, { code: "SCHEMA_INVALID" });
    }
    return sendJson(res, 200, { ok: true, agentCards: cards, limit: safeLimit, offset: safeOffset });
    }


    if (parts[0] === "agent-cards" && parts[1] && parts[2] === "abuse-reports" && parts.length === 3 && req.method === "POST") {
      if (typeof store.getAgentCardAbuseReport !== "function" && !(store.agentCardAbuseReports instanceof Map)) {
        return sendError(res, 501, "agent card abuse reports not supported for this store");
      }
      if (!requireProtocolHeaderForWrite(req, res)) return;

      const targetAgentId = decodePathPart(parts[1]);
      const body = await readJsonBody(req);
      let idemStoreKey = null;
      let idemRequestHash = null;
      try {
        ({ idemStoreKey, idemRequestHash } = readIdempotency({ method: "POST", requestPath: path, expectedPrevChainHash: null, body }));
      } catch (err) {
        return sendError(res, 400, "invalid idempotency key", { message: err?.message });
      }
      if (idemStoreKey) {
        const existing = store.idempotency.get(idemStoreKey);
        if (existing) {
          if (existing.requestHash !== idemRequestHash) {
            return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
          }
          return sendJson(res, existing.statusCode, existing.body);
        }
      }

      let subjectIdentity = null;
      try {
        subjectIdentity = await getAgentIdentityRecord({ tenantId, agentId: targetAgentId });
      } catch (err) {
        return sendError(res, 400, "invalid subject agent query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (!subjectIdentity) return sendError(res, 404, "subject agent identity not found", null, { code: "NOT_FOUND" });

      const reporterAgentId =
        typeof body?.reporterAgentId === "string" && body.reporterAgentId.trim() !== "" ? body.reporterAgentId.trim() : null;
      if (!reporterAgentId) {
        return sendError(res, 400, "reporterAgentId is required", null, { code: "SCHEMA_INVALID" });
      }
      let reporterIdentity = null;
      try {
        reporterIdentity = await getAgentIdentityRecord({ tenantId, agentId: reporterAgentId });
      } catch (err) {
        return sendError(res, 400, "invalid reporter agent query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (!reporterIdentity) return sendError(res, 404, "reporter agent identity not found", null, { code: "NOT_FOUND" });

      let reportId = null;
      let reasonCode = null;
      let severity = 1;
      let evidenceRefs = [];
      try {
        reportId = typeof body?.reportId === "string" && body.reportId.trim() !== "" ? body.reportId.trim() : createId("acabr");
        reasonCode = parseAgentCardAbuseReasonCode(body?.reasonCode, { fieldPath: "reasonCode", allowNull: false });
        severity = parseAgentCardAbuseSeverity(body?.severity, { fieldPath: "severity", defaultValue: 1 });
        evidenceRefs = normalizeAgentCardAbuseEvidenceRefs(body?.evidenceRefs, { fieldPath: "evidenceRefs" });
      } catch (err) {
        return sendError(res, 400, "invalid abuse report", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      let existingReport = null;
      try {
        existingReport = await getAgentCardAbuseReportRecord({ tenantId, reportId });
      } catch (err) {
        return sendError(res, 501, "agent card abuse reports not supported for this store", { message: err?.message });
      }
      if (existingReport) return sendError(res, 409, "abuse report already exists", null, { code: "CONFLICT" });

      const createdAt = nowIso();
      let report = null;
      try {
        report = buildAgentCardAbuseReportV1({
          tenantId,
          reportId,
          subjectAgentId: targetAgentId,
          reporterAgentId,
          reasonCode,
          severity,
          notes: body?.notes ?? null,
          evidenceRefs,
          createdAt
        });
      } catch (err) {
        return sendError(res, 400, "invalid abuse report", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const ops = [{ kind: "AGENT_CARD_ABUSE_REPORT_UPSERT", tenantId, reportId, report }];
      let subjectStatus = null;
      try {
        const currentSubjectStatus = await buildAgentCardAbuseSubjectStatus({ tenantId, subjectAgentId: targetAgentId, asOf: createdAt });
        const currentOpenReportCount = Number.isSafeInteger(currentSubjectStatus?.openReportCount)
          ? Number(currentSubjectStatus.openReportCount)
          : 0;
        const nextOpenReportCount = isActiveAgentCardAbuseReport(report) ? currentOpenReportCount + 1 : currentOpenReportCount;
        const suppressionThreshold =
          Number.isSafeInteger(agentCardPublicAbuseSuppressionThresholdValue) && agentCardPublicAbuseSuppressionThresholdValue > 0
            ? agentCardPublicAbuseSuppressionThresholdValue
            : 0;
        subjectStatus = buildAgentCardAbuseSubjectStatusV1({
          subjectAgentId: targetAgentId,
          openReportCount: nextOpenReportCount,
          suppressionThreshold,
          publicDiscoverySuppressed: suppressionThreshold > 0 && nextOpenReportCount >= suppressionThreshold,
          asOf: createdAt
        });
      } catch (err) {
        return sendError(res, 400, "abuse report subject status failed", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const responseBody = {
        ok: true,
        report,
        subjectStatus
      };
      if (idemStoreKey) {
        ops.push({
          kind: "IDEMPOTENCY_PUT",
          key: idemStoreKey,
          value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody }
        });
      }
      await commitTx(ops, {
        audit: makeOpsAudit({
          action: "AGENT_CARD_ABUSE_REPORT_UPSERT",
          targetType: "agent_card_abuse_report",
          targetId: reportId,
          details: {
            subjectAgentId: targetAgentId,
            reporterAgentId,
            reasonCode,
            severity
          }
        })
      });
      if (isSybilAbuseReasonCode(reasonCode)) {
        await emitSybilPenaltyBestEffort({
          tenantId,
          agentId: targetAgentId,
          counterpartyAgentId: reporterAgentId,
          toolId: "agent_card",
          role: "system",
          sourceRef: {
            kind: "agent_card_abuse_report",
            sourceId: reportId
          },
          reasonMessage: "agent card abuse report flagged as sybil/collusion signal",
          amountPenalizedCents: Number(severity ?? 0) * 100,
          occurredAt: createdAt,
          extraFacts: {
            reportId,
            reasonCode,
            severity,
            evidenceRefCount: Array.isArray(evidenceRefs) ? evidenceRefs.length : 0
          },
          context: "reputation.penalty.sybil.abuse_report"
        });
      }
      return sendJson(res, 201, responseBody);
    }

    if (parts[0] === "agent-cards" && parts[1] && parts[2] === "abuse-reports" && parts.length === 3 && req.method === "GET") {
      if (typeof store.listAgentCardAbuseReports !== "function" && !(store.agentCardAbuseReports instanceof Map)) {
        return sendError(res, 501, "agent card abuse reports not supported for this store");
      }
      const targetAgentId = decodePathPart(parts[1]);
      let subjectIdentity = null;
      try {
        subjectIdentity = await getAgentIdentityRecord({ tenantId, agentId: targetAgentId });
      } catch (err) {
        return sendError(res, 400, "invalid subject agent query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (!subjectIdentity) return sendError(res, 404, "subject agent identity not found", null, { code: "NOT_FOUND" });

      let reasonCode = null;
      let statusFilter = null;
      let limit = 50;
      let offset = 0;
      try {
        reasonCode = parseAgentCardAbuseReasonCode(url.searchParams.get("reasonCode"), { fieldPath: "reasonCode", allowNull: true });
        statusFilter = parseAgentCardAbuseReportStatus(url.searchParams.get("status"), { fieldPath: "status", allowNull: true });
        limit = parseThresholdIntegerQueryValue(url.searchParams.get("limit"), { defaultValue: 50, min: 1, max: 1000, name: "limit" });
        offset = parseThresholdIntegerQueryValue(url.searchParams.get("offset"), { defaultValue: 0, min: 0, name: "offset" });
      } catch (err) {
        return sendError(res, 400, "invalid abuse report query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      let reports = [];
      let subjectStatus = null;
      let total = 0;
      try {
        const allReports = await listAllAgentCardAbuseReportRecords({
          tenantId,
          subjectAgentId: targetAgentId,
          reasonCode
        });
        const filteredReports = statusFilter
          ? allReports.filter((row) => String(row?.status ?? AGENT_CARD_ABUSE_REPORT_STATUS.OPEN).toLowerCase() === statusFilter)
          : allReports;
        total = filteredReports.length;
        reports = filteredReports.slice(offset, offset + limit);
        subjectStatus = await buildAgentCardAbuseSubjectStatus({ tenantId, subjectAgentId: targetAgentId, asOf: nowIso() });
      } catch (err) {
        return sendError(
          res,
          /not supported/.test(String(err?.message ?? "")) ? 501 : 400,
          "invalid abuse report query",
          { message: err?.message },
          { code: /not supported/.test(String(err?.message ?? "")) ? "NOT_IMPLEMENTED" : "SCHEMA_INVALID" }
        );
      }

      return sendJson(res, 200, {
        ok: true,
        subjectAgentId: targetAgentId,
        reasonCode,
        status: statusFilter,
        total,
        reports,
        limit,
        offset,
        subjectStatus
      });
    }

    if (
      parts[0] === "agent-cards" &&
      parts[1] &&
      parts[2] === "abuse-reports" &&
      parts[3] &&
      parts[4] === "status" &&
      parts.length === 5 &&
      req.method === "POST"
    ) {
      if (typeof store.getAgentCardAbuseReport !== "function" && !(store.agentCardAbuseReports instanceof Map)) {
        return sendError(res, 501, "agent card abuse reports not supported for this store");
      }
      if (!requireProtocolHeaderForWrite(req, res)) return;
      const targetAgentId = decodePathPart(parts[1]);
      const reportId = decodePathPart(parts[3]);
      const body = await readJsonBody(req);
      let idemStoreKey = null;
      let idemRequestHash = null;
      try {
        ({ idemStoreKey, idemRequestHash } = readIdempotency({ method: "POST", requestPath: path, expectedPrevChainHash: null, body }));
      } catch (err) {
        return sendError(res, 400, "invalid idempotency key", { message: err?.message });
      }
      if (idemStoreKey) {
        const existing = store.idempotency.get(idemStoreKey);
        if (existing) {
          if (existing.requestHash !== idemRequestHash) {
            return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
          }
          return sendJson(res, existing.statusCode, existing.body);
        }
      }
      let subjectIdentity = null;
      try {
        subjectIdentity = await getAgentIdentityRecord({ tenantId, agentId: targetAgentId });
      } catch (err) {
        return sendError(res, 400, "invalid subject agent query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (!subjectIdentity) return sendError(res, 404, "subject agent identity not found", null, { code: "NOT_FOUND" });

      let existingReport = null;
      try {
        existingReport = await getAgentCardAbuseReportRecord({ tenantId, reportId });
      } catch (err) {
        return sendError(
          res,
          /not supported/.test(String(err?.message ?? "")) ? 501 : 400,
          "invalid abuse report query",
          { message: err?.message },
          { code: /not supported/.test(String(err?.message ?? "")) ? "NOT_IMPLEMENTED" : "SCHEMA_INVALID" }
        );
      }
      if (!existingReport || String(existingReport?.subjectAgentId ?? "") !== targetAgentId) {
        return sendError(res, 404, "abuse report not found", null, { code: "NOT_FOUND" });
      }

      let nextStatus = null;
      try {
        nextStatus = parseAgentCardAbuseReportStatus(body?.status, { fieldPath: "status", allowNull: false });
      } catch (err) {
        return sendError(res, 400, "invalid abuse report status", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const resolvedByAgentId =
        typeof body?.resolvedByAgentId === "string" && body.resolvedByAgentId.trim() !== "" ? body.resolvedByAgentId.trim() : null;
      if (resolvedByAgentId) {
        let resolverIdentity = null;
        try {
          resolverIdentity = await getAgentIdentityRecord({ tenantId, agentId: resolvedByAgentId });
        } catch (err) {
          return sendError(res, 400, "invalid resolver agent query", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }
        if (!resolverIdentity) return sendError(res, 404, "resolver agent identity not found", null, { code: "NOT_FOUND" });
      }

      const updatedAt = nowIso();
      let nextReport = null;
      try {
        nextReport = buildAgentCardAbuseReportStatusUpdateV1({
          report: existingReport,
          status: nextStatus,
          resolvedByAgentId,
          resolutionNotes: body?.resolutionNotes ?? body?.notes ?? null,
          updatedAt
        });
      } catch (err) {
        return sendError(res, 400, "invalid abuse report status", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const responseBody = { ok: true, report: nextReport, subjectStatus: null };
      const ops = [{ kind: "AGENT_CARD_ABUSE_REPORT_UPSERT", tenantId, reportId, report: nextReport }];
      if (idemStoreKey) {
        ops.push({
          kind: "IDEMPOTENCY_PUT",
          key: idemStoreKey,
          value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody }
        });
      }
      await commitTx(ops, {
        audit: makeOpsAudit({
          action: "AGENT_CARD_ABUSE_REPORT_UPSERT",
          targetType: "agent_card_abuse_report",
          targetId: reportId,
          details: {
            subjectAgentId: targetAgentId,
            status: nextStatus,
            resolvedByAgentId: resolvedByAgentId ?? null
          }
        })
      });
      try {
        responseBody.subjectStatus = await buildAgentCardAbuseSubjectStatus({
          tenantId,
          subjectAgentId: targetAgentId,
          asOf: updatedAt
        });
      } catch (err) {
        return sendError(res, 400, "abuse report subject status failed", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      return sendJson(res, 200, responseBody);
    }

    if (req.method === "GET" && path === "/agents") {
    const status = url.searchParams.get("status");
    const capabilityFilterRaw = url.searchParams.get("capability");
    let capabilityFilter = null;
    try {
      capabilityFilter =
        typeof capabilityFilterRaw === "string" && capabilityFilterRaw.trim() !== ""
          ? normalizeCapabilityIdentifier(capabilityFilterRaw, { name: "capability" })
          : null;
    } catch (err) {
      return sendError(res, 400, "invalid agent identity query", { message: err?.message });
    }
    const minTrustScoreRaw = url.searchParams.get("minTrustScore");
    const includeReputationRaw = url.searchParams.get("includeReputation");
    const includeReputation = includeReputationRaw !== null && ["1", "true", "yes", "on"].includes(String(includeReputationRaw).trim().toLowerCase());
    const reputationVersionRaw = url.searchParams.get("reputationVersion");
    const reputationWindowRaw = url.searchParams.get("reputationWindow");
    const asOfRaw = url.searchParams.get("asOf");
    let reputationVersion = "v1";
    let reputationWindow = AGENT_REPUTATION_WINDOW.THIRTY_DAYS;
    let asOf = nowIso();
    try {
      reputationVersion = parseReputationVersion(reputationVersionRaw);
      reputationWindow = parseReputationWindow(reputationWindowRaw);
      asOf = parseAsOfDateTime(asOfRaw, { defaultValue: asOf, fieldName: "asOf" });
    } catch (err) {
      return sendError(res, 400, "invalid reputation query", { message: err?.message });
    }
    let minTrustScore = null;
    if (minTrustScoreRaw !== null) {
      const parsedMinTrustScore = Number(minTrustScoreRaw);
      if (!Number.isSafeInteger(parsedMinTrustScore) || parsedMinTrustScore < 0 || parsedMinTrustScore > 100) {
        return sendError(res, 400, "minTrustScore must be an integer within 0..100");
      }
      minTrustScore = parsedMinTrustScore;
    }
    const limitRaw = url.searchParams.get("limit");
    const offsetRaw = url.searchParams.get("offset");
    const limit = limitRaw ? Number(limitRaw) : 200;
    const offset = offsetRaw ? Number(offsetRaw) : 0;
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(1000, limit) : 200;
    const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const requiresPostFilter = Boolean(capabilityFilter) || minTrustScore !== null || includeReputation;

    let agents;
    if (typeof store.listAgentIdentities === "function") {
      try {
        if (requiresPostFilter) agents = await store.listAgentIdentities({ tenantId, status: status ?? null, limit: 10_000, offset: 0 });
        else agents = await store.listAgentIdentities({ tenantId, status: status ?? null, limit: safeLimit, offset: safeOffset });
      } catch (err) {
        return sendError(res, 400, "invalid agent identity query", { message: err?.message });
      }
    } else if (store.agentIdentities instanceof Map) {
      const all = listAgentIdentities({ tenantId, status: status ?? null });
      agents = requiresPostFilter ? all : all.slice(safeOffset, safeOffset + safeLimit);
    } else {
      return sendError(res, 501, "agent identities not supported for this store");
    }

    const filteredAgents = capabilityFilter
      ? agents.filter((agentIdentity) => Array.isArray(agentIdentity?.capabilities) && agentIdentity.capabilities.includes(capabilityFilter))
      : agents;

    if (!includeReputation && minTrustScore === null) {
      if (requiresPostFilter) {
        const paged = filteredAgents.slice(safeOffset, safeOffset + safeLimit);
        return sendJson(res, 200, { agents: paged, limit: safeLimit, offset: safeOffset });
      }
      return sendJson(res, 200, { agents: filteredAgents, limit: safeLimit, offset: safeOffset });
    }

    const reputations = {};
    const scopedAgents = [];
    for (const agentIdentity of filteredAgents) {
      const agentId = String(agentIdentity?.agentId ?? "");
      if (!agentId) continue;
      const reputation = await computeAgentReputationSnapshotVersioned({
        tenantId,
        agentId,
        at: asOf,
        reputationVersion,
        reputationWindow
      });
      if (minTrustScore !== null && Number(reputation?.trustScore ?? 0) < minTrustScore) continue;
      scopedAgents.push(agentIdentity);
      if (includeReputation) reputations[agentId] = reputation;
    }

    const pagedAgents = scopedAgents.slice(safeOffset, safeOffset + safeLimit);
    const response = { agents: pagedAgents, limit: safeLimit, offset: safeOffset };
    if (includeReputation) {
      const pagedReputations = {};
      for (const agentIdentity of pagedAgents) {
        const id = String(agentIdentity?.agentId ?? "");
        if (!id) continue;
        if (reputations[id]) pagedReputations[id] = reputations[id];
      }
      response.reputations = pagedReputations;
    }
    return sendJson(res, 200, response);
    }

    if (req.method === "POST" && path === "/agents/register") {
    if (typeof store.putAgentIdentity !== "function") return sendError(res, 501, "agent identities not supported for this store");
    const body = await readJsonBody(req);
    let idemStoreKey = null;
    let idemRequestHash = null;
    try {
      ({ idemStoreKey, idemRequestHash } = readIdempotency({ method: "POST", requestPath: path, expectedPrevChainHash: null, body }));
    } catch (err) {
      return sendError(res, 400, "invalid idempotency key", { message: err?.message });
    }
    if (idemStoreKey) {
      const existing = store.idempotency.get(idemStoreKey);
      if (existing) {
        if (existing.requestHash !== idemRequestHash) {
          return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
        }
        return sendJson(res, existing.statusCode, existing.body);
      }
    }

    const publicKeyPem = body?.publicKeyPem ?? null;
    if (typeof publicKeyPem !== "string" || publicKeyPem.trim() === "") {
      return sendError(res, 400, "publicKeyPem is required");
    }

    const keyId = keyIdFromPublicKeyPem(publicKeyPem);
    const agentId = body?.agentId ? String(body.agentId) : createId("agt");
    const existingIdentity = typeof store.getAgentIdentity === "function" ? await store.getAgentIdentity({ tenantId, agentId }) : null;
    if (existingIdentity && !idemStoreKey) return sendError(res, 409, "agent identity already exists");

    const ownerBody = body?.owner && typeof body.owner === "object" && !Array.isArray(body.owner) ? body.owner : {};
    const ownerTypeRaw = ownerBody.ownerType ?? body?.ownerType ?? "service";
    const ownerIdRaw = ownerBody.ownerId ?? body?.ownerId ?? `tenant:${tenantId}`;
    const ownerType = String(ownerTypeRaw ?? "").trim().toLowerCase();
    const ownerId = String(ownerIdRaw ?? "").trim();
    if (ownerType !== "human" && ownerType !== "business" && ownerType !== "service") {
      return sendError(res, 400, "owner.ownerType must be human|business|service");
    }
    if (!ownerId) return sendError(res, 400, "owner.ownerId is required");

    const status = body?.status ? String(body.status).trim().toLowerCase() : "active";
    if (status !== "active" && status !== "suspended" && status !== "revoked") {
      return sendError(res, 400, "status must be active|suspended|revoked");
    }

    const capabilitiesRaw = Array.isArray(body?.capabilities) ? body.capabilities : [];
    const capabilitySet = new Set();
    try {
      for (let index = 0; index < capabilitiesRaw.length; index += 1) {
        const raw = capabilitiesRaw[index];
        const candidate = String(raw ?? "").trim();
        if (!candidate) continue;
        capabilitySet.add(normalizeCapabilityIdentifier(candidate, { name: `capabilities[${index}]` }));
      }
    } catch (err) {
      return sendError(res, 400, "invalid agent identity", { message: err?.message });
    }
    const capabilities = Array.from(capabilitySet.values()).sort((left, right) => left.localeCompare(right));

    const nowAt = nowIso();
    const candidate = {
      schemaVersion: "AgentIdentity.v1",
      agentId,
      tenantId,
      displayName:
        typeof body?.displayName === "string" && body.displayName.trim() !== "" ? String(body.displayName) : String(agentId),
      description: typeof body?.description === "string" && body.description.trim() !== "" ? String(body.description) : null,
      status,
      owner: { ownerType, ownerId },
      keys: {
        keyId,
        algorithm: "ed25519",
        publicKeyPem: String(publicKeyPem)
      },
      capabilities,
      walletPolicy: body?.walletPolicy ?? null,
      metadata: body?.metadata ?? null,
      createdAt: nowAt,
      updatedAt: nowAt
    };

    let persisted;
    try {
      persisted = await store.putAgentIdentity({ tenantId, agentIdentity: candidate });
    } catch (err) {
      if (err?.code === "AGENT_IDENTITY_EXISTS") return sendError(res, 409, "agent identity already exists");
      return sendError(res, 400, "invalid agent identity", { message: err?.message });
    }

    const responseBody = { agentIdentity: persisted, keyId };
    if (idemStoreKey) {
      await commitTx([{ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } }]);
    }
    return sendJson(res, 201, responseBody);
    }

    if (parts[0] === "agents" && parts[1] && parts[1] !== "register") {
    const agentId = parts[1];
    let agentIdentity = null;
    if (typeof store.getAgentIdentity === "function") {
      try {
        agentIdentity = await store.getAgentIdentity({ tenantId, agentId });
      } catch (err) {
        return sendError(res, 400, "invalid agent id", { message: err?.message });
      }
    } else if (store.agentIdentities instanceof Map) {
      agentIdentity = store.agentIdentities.get(makeScopedKey({ tenantId, id: agentId })) ?? null;
    } else {
      return sendError(res, 501, "agent identities not supported for this store");
    }
    if (!agentIdentity) return sendError(res, 404, "agent identity not found");

    if (req.method === "GET" && parts.length === 2) {
      return sendJson(res, 200, { agentIdentity });
    }

    if (parts[2] === "reputation" && req.method === "GET" && parts.length === 3) {
      const reputationVersionRaw = url.searchParams.get("reputationVersion");
      const reputationWindowRaw = url.searchParams.get("reputationWindow");
      const asOfRaw = url.searchParams.get("asOf");
      let reputationVersion = "v1";
      let reputationWindow = AGENT_REPUTATION_WINDOW.THIRTY_DAYS;
      let asOf = nowIso();
      try {
        reputationVersion = parseReputationVersion(reputationVersionRaw);
        reputationWindow = parseReputationWindow(reputationWindowRaw);
        asOf = parseAsOfDateTime(asOfRaw, { defaultValue: asOf, fieldName: "asOf" });
      } catch (err) {
        return sendError(res, 400, "invalid reputation query", { message: err?.message });
      }
      const reputation = await computeAgentReputationSnapshotVersioned({
        tenantId,
        agentId,
        at: asOf,
        reputationVersion,
        reputationWindow
      });
      return sendJson(res, 200, { reputation });
    }

    if (parts[2] === "interaction-graph-pack" && req.method === "GET" && parts.length === 3) {
      const reputationVersionRaw = url.searchParams.get("reputationVersion");
      const reputationWindowRaw = url.searchParams.get("reputationWindow");
      const asOfRaw = url.searchParams.get("asOf");
      const counterpartyAgentIdRaw = url.searchParams.get("counterpartyAgentId");
      const visibilityRaw = url.searchParams.get("visibility");
      const signRaw = url.searchParams.get("sign");
      const signerKeyIdRaw = url.searchParams.get("signerKeyId");
      const limitRaw = url.searchParams.get("limit");
      const offsetRaw = url.searchParams.get("offset");
      let reputationVersion = "v2";
      let reputationWindow = AGENT_REPUTATION_WINDOW.THIRTY_DAYS;
      let asOf = nowIso();
      let signPack = false;
      let signerKeyId = null;
      let limit = RELATIONSHIP_PUBLIC_SUMMARY_MAX_LIMIT;
      let offset = 0;
      try {
        reputationVersion = parseReputationVersion(reputationVersionRaw ?? "v2");
        reputationWindow = parseReputationWindow(reputationWindowRaw ?? AGENT_REPUTATION_WINDOW.THIRTY_DAYS);
        if (typeof asOfRaw === "string" && asOfRaw.trim() !== "") {
          const candidate = asOfRaw.trim();
          if (!Number.isFinite(Date.parse(candidate))) throw new TypeError("asOf must be an ISO date-time");
          asOf = candidate;
        }
        signPack = parseBooleanQueryValue(signRaw, { defaultValue: false, name: "sign" });
        signerKeyId = parseInteractionGraphPackSignerKeyId(signerKeyIdRaw, { allowNull: true });
        if (!signPack && signerKeyId !== null) {
          throw new TypeError("signerKeyId requires sign=true");
        }
        limit = parseRelationshipListLimit(limitRaw, { defaultValue: RELATIONSHIP_PUBLIC_SUMMARY_MAX_LIMIT });
        offset = parseRelationshipListOffset(offsetRaw, { defaultValue: 0 });
      } catch (err) {
        return sendError(res, 400, "invalid interaction graph pack query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (visibilityRaw !== null && visibilityRaw !== undefined && String(visibilityRaw).trim() !== "") {
        const visibilityValue = String(visibilityRaw).trim().toLowerCase();
        if (
          visibilityValue !== "all" &&
          visibilityValue !== RELATIONSHIP_EDGE_VISIBILITY.PRIVATE &&
          visibilityValue !== RELATIONSHIP_EDGE_VISIBILITY.PUBLIC_SUMMARY
        ) {
          return sendError(res, 400, "invalid interaction graph pack query", { message: "visibility must be all|private|public_summary" }, { code: "SCHEMA_INVALID" });
        }
      }
      const windowStartAt = reputationWindowStartAt({ window: reputationWindow, at: asOf });
      const events = await listRoutingReputationEvents({
        tenantId,
        agentId,
        occurredAtGte: windowStartAt,
        occurredAtLte: asOf
      });
      const aggregate = computeReputationFactsAggregate({ events });
      const relationshipStats = computeRoutingReputationEventStats({ events });
      const relationshipResult = await listRelationshipEdgesForAgent({
        tenantId,
        agentId,
        counterpartyAgentId:
          typeof counterpartyAgentIdRaw === "string" && counterpartyAgentIdRaw.trim() !== ""
            ? counterpartyAgentIdRaw.trim()
            : null,
        asOf,
        reputationWindow,
        limit,
        offset,
        publicOnly: false
      });
      const visibilityFilter =
        visibilityRaw === null || visibilityRaw === undefined || String(visibilityRaw).trim() === ""
          ? "all"
          : String(visibilityRaw).trim().toLowerCase();
      const filteredRelationships =
        visibilityFilter === "all"
          ? relationshipResult.relationships
          : relationshipResult.relationships.filter((edge) => String(edge?.visibility ?? "").toLowerCase() === visibilityFilter);
      const reputation = await computeAgentReputationSnapshotVersioned({
        tenantId,
        agentId,
        at: asOf,
        reputationVersion,
        reputationWindow
      });
      const summary = buildInteractionGraphSummary({
        agentId,
        reputationVersion,
        reputationWindow,
        asOf,
        reputation,
        aggregate,
        relationshipStats,
        relationships: filteredRelationships
      });
      let graphPack = null;
      try {
        graphPack = buildVerifiedInteractionGraphPackV1({
          tenantId,
          agentId,
          reputationVersion,
          reputationWindow,
          asOf,
          relationships: filteredRelationships,
          summary,
          verification: {
            deterministicOrdering: true,
            antiGamingSignalsPresent: true,
            generatedBy: "nooterra.api"
          },
          generatedAt: asOf
        });
        if (signPack) {
          const signingCandidate = await resolveInteractionGraphPackSigningCandidate({ tenantId, signerKeyId, at: asOf });
          graphPack = signVerifiedInteractionGraphPackV1({
            graphPack,
            signedAt: asOf,
            publicKeyPem: signingCandidate.publicKeyPem,
            privateKeyPem: signingCandidate.privateKeyPem,
            keyId: signingCandidate.keyId
          });
        }
      } catch (err) {
        const details =
          err?.details && typeof err.details === "object" && !Array.isArray(err.details)
            ? { agentId, reason: err?.message ?? "invalid interaction graph pack", ...err.details }
            : { agentId, reason: err?.message ?? "invalid interaction graph pack" };
        return sendError(
          res,
          409,
          "interaction graph pack blocked",
          details,
          {
            code:
              signPack && typeof err?.code === "string" && err.code.trim() !== ""
                ? err.code
                : signPack
                  ? "INTERACTION_GRAPH_PACK_SIGNING_BLOCKED"
                  : "INTERACTION_GRAPH_PACK_INVALID"
          }
        );
      }
      return sendJson(res, 200, { ok: true, graphPack });
    }

    if (parts[2] === "passport") {
      const hasPassportStore = typeof store.getAgentPassport === "function" || store.agentPassports instanceof Map;
      if (!hasPassportStore) return sendError(res, 501, "agent passports not supported for this store");

      if (req.method === "GET" && parts.length === 3) {
        let agentPassport = null;
        try {
          agentPassport = await getAgentPassportRecord({ tenantId, agentId });
        } catch (err) {
          return sendError(res, 400, "invalid agent passport query", { message: err?.message });
        }
        if (!agentPassport) return sendError(res, 404, "agent passport not found");
        return sendJson(res, 200, { agentPassport });
      }

      if (req.method === "POST" && parts.length === 3) {
        if (!requireProtocolHeaderForWrite(req, res)) return;
        const body = await readJsonBody(req);
        let idemStoreKey = null;
        let idemRequestHash = null;
        try {
          ({ idemStoreKey, idemRequestHash } = readIdempotency({ method: "POST", requestPath: path, expectedPrevChainHash: null, body }));
        } catch (err) {
          return sendError(res, 400, "invalid idempotency key", { message: err?.message });
        }
        if (idemStoreKey) {
          const existing = store.idempotency.get(idemStoreKey);
          if (existing) {
            if (existing.requestHash !== idemRequestHash) {
              return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
            }
            return sendJson(res, existing.statusCode, existing.body);
          }
        }

        let agentPassport = null;
        try {
          const agentPassportInput =
            body?.agentPassport && typeof body.agentPassport === "object" && !Array.isArray(body.agentPassport)
              ? body.agentPassport
              : body;
          agentPassport = normalizeX402AgentPassportInput(agentPassportInput, { fieldPath: "agentPassport", allowNull: false });
        } catch (err) {
          return sendError(res, 400, "invalid agent passport", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }
        if (!x402AgentPassportHasProtocolEnvelope(agentPassport)) {
          return sendError(
            res,
            400,
            "invalid agent passport",
            { message: "agent passport must include full protocol envelope fields" },
            { code: "X402_AGENT_PASSPORT_PROTOCOL_ENVELOPE_REQUIRED" }
          );
        }

        const passportAgentId = typeof agentPassport.agentId === "string" ? agentPassport.agentId.trim() : "";
        if (passportAgentId !== agentId) {
          return sendError(res, 409, "agent passport agentId mismatch", { agentId, passportAgentId }, { code: "AGENT_PASSPORT_AGENT_MISMATCH" });
        }
        const passportTenantId = typeof agentPassport.tenantId === "string" ? normalizeTenant(agentPassport.tenantId) : null;
        if (passportTenantId !== tenantId) {
          return sendError(
            res,
            409,
            "agent passport tenantId mismatch",
            { tenantId, passportTenantId },
            { code: "AGENT_PASSPORT_TENANT_MISMATCH" }
          );
        }
        try {
          const assignmentResolution = await applyResolvedX402WalletAssignmentToPassport({ tenantId, agentPassport });
          agentPassport = assignmentResolution.agentPassport;
        } catch (err) {
          return sendError(res, 400, "invalid x402 wallet assignment", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }

        let existingPassport = null;
        try {
          existingPassport = await getAgentPassportRecord({ tenantId, agentId });
        } catch (err) {
          return sendError(res, 400, "invalid agent passport query", { message: err?.message });
        }
        const nowAt = nowIso();
        const createdAt =
          existingPassport && typeof existingPassport.createdAt === "string" && existingPassport.createdAt.trim() !== ""
            ? existingPassport.createdAt.trim()
            : agentPassport.createdAt;
        const persistedPassport = normalizeForCanonicalJson(
          {
            ...agentPassport,
            tenantId,
            agentId,
            createdAt,
            updatedAt: nowAt
          },
          { path: "$" }
        );
        const statusCode = existingPassport ? 200 : 201;
        const responseBody = { agentPassport: persistedPassport };
        const ops = [{ kind: "AGENT_PASSPORT_UPSERT", tenantId, agentId, agentPassport: persistedPassport }];
        if (idemStoreKey) {
          ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode, body: responseBody } });
        }
        await commitTx(ops);
        return sendJson(res, statusCode, responseBody);
      }

      if (req.method === "POST" && parts[3] === "revoke" && parts.length === 4) {
        if (!requireProtocolHeaderForWrite(req, res)) return;
        const body = await readJsonBody(req);
        let idemStoreKey = null;
        let idemRequestHash = null;
        try {
          ({ idemStoreKey, idemRequestHash } = readIdempotency({ method: "POST", requestPath: path, expectedPrevChainHash: null, body }));
        } catch (err) {
          return sendError(res, 400, "invalid idempotency key", { message: err?.message });
        }
        if (idemStoreKey) {
          const existing = store.idempotency.get(idemStoreKey);
          if (existing) {
            if (existing.requestHash !== idemRequestHash) {
              return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
            }
            return sendJson(res, existing.statusCode, existing.body);
          }
        }

        let existingPassport = null;
        try {
          existingPassport = await getAgentPassportRecord({ tenantId, agentId });
        } catch (err) {
          return sendError(res, 400, "invalid agent passport query", { message: err?.message });
        }
        if (!existingPassport) return sendError(res, 404, "agent passport not found");
        if (!x402AgentPassportHasProtocolEnvelope(existingPassport)) {
          return sendError(
            res,
            409,
            "agent passport does not include protocol envelope",
            null,
            { code: "X402_AGENT_PASSPORT_PROTOCOL_ENVELOPE_REQUIRED" }
          );
        }

        const revokedAtInput =
          typeof body?.revokedAt === "string" && body.revokedAt.trim() !== ""
            ? body.revokedAt.trim()
            : body?.revokedAt === null || body?.revokedAt === undefined || body?.revokedAt === ""
              ? null
              : null;
        if (body?.revokedAt !== null && body?.revokedAt !== undefined && body?.revokedAt !== "" && revokedAtInput === null) {
          return sendError(res, 400, "revokedAt must be an ISO timestamp or null");
        }
        const nowAt = revokedAtInput ?? nowIso();
        if (!Number.isFinite(Date.parse(nowAt))) return sendError(res, 400, "revokedAt must be an ISO timestamp or null");

        let reasonCode = null;
        try {
          reasonCode = normalizeOptionalX402RefInput(body?.reasonCode ?? null, "reasonCode", { allowNull: true, max: 200 });
        } catch (err) {
          return sendError(res, 400, "invalid reasonCode", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }
        const reasonMessage =
          typeof body?.reason === "string" && body.reason.trim() !== "" ? body.reason.trim().slice(0, 500) : null;

        const existingMetadata =
          existingPassport.metadata && typeof existingPassport.metadata === "object" && !Array.isArray(existingPassport.metadata)
            ? existingPassport.metadata
            : null;
        const lifecycleMetadataBase =
          existingMetadata?.lifecycle && typeof existingMetadata.lifecycle === "object" && !Array.isArray(existingMetadata.lifecycle)
            ? existingMetadata.lifecycle
            : {};
        const nextMetadata = normalizeForCanonicalJson(
          {
            ...(existingMetadata ? existingMetadata : {}),
            lifecycle: {
              ...lifecycleMetadataBase,
              revokedAt: nowAt,
              ...(reasonCode ? { reasonCode } : {}),
              ...(reasonMessage ? { reasonMessage } : {})
            }
          },
          { path: "$.metadata" }
        );

        const nextPassportSeed = {
          ...existingPassport,
          status: "revoked",
          updatedAt: nowAt,
          delegationRoot: {
            ...existingPassport.delegationRoot,
            revokedAt: nowAt
          },
          metadata: nextMetadata
        };

        let revokedPassport = null;
        try {
          revokedPassport = normalizeX402AgentPassportInput(nextPassportSeed, { fieldPath: "agentPassport", allowNull: false });
        } catch (err) {
          return sendError(res, 400, "invalid agent passport revoke payload", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }
        const responseBody = { agentPassport: revokedPassport };
        const ops = [{ kind: "AGENT_PASSPORT_UPSERT", tenantId, agentId, agentPassport: revokedPassport }];
        if (idemStoreKey) {
          ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody } });
        }
        await commitTx(ops);
        return sendJson(res, 200, responseBody);
      }
    }

    if (parts[2] === "wallet") {
      const hasWalletStore = typeof store.getAgentWallet === "function" || store.agentWallets instanceof Map;
      if (!hasWalletStore) return sendError(res, 501, "agent wallets not supported for this store");

      if (req.method === "GET" && parts.length === 3) {
        let wallet = null;
        try {
          wallet = await getAgentWalletRecord({ tenantId, agentId });
        } catch (err) {
          return sendError(res, 400, "invalid agent wallet query", { message: err?.message });
        }
        if (!wallet) {
          wallet = createAgentWallet({ tenantId, agentId, at: nowIso() });
        }
        return sendJson(res, 200, { wallet });
      }

      if (req.method === "POST" && parts[3] === "credit" && parts.length === 4) {
        if (!requireProtocolHeaderForWrite(req, res)) return;
        const body = await readJsonBody(req);
        let idemStoreKey = null;
        let idemRequestHash = null;
        try {
          ({ idemStoreKey, idemRequestHash } = readIdempotency({ method: "POST", requestPath: path, expectedPrevChainHash: null, body }));
        } catch (err) {
          return sendError(res, 400, "invalid idempotency key", { message: err?.message });
        }
        if (idemStoreKey) {
          const existing = store.idempotency.get(idemStoreKey);
          if (existing) {
            if (existing.requestHash !== idemRequestHash) {
              return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
            }
            return sendJson(res, existing.statusCode, existing.body);
          }
        }

        const amountCents = Number(body?.amountCents);
        if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return sendError(res, 400, "amountCents must be a positive safe integer");
        const currency = body?.currency ?? "USD";
        const nowAt = nowIso();

        let currentWallet = null;
        try {
          currentWallet = await getAgentWalletRecord({ tenantId, agentId });
        } catch (err) {
          return sendError(res, 400, "invalid agent wallet query", { message: err?.message });
        }
        const baseWallet = ensureAgentWallet({ wallet: currentWallet, tenantId, agentId, currency, at: nowAt });
        let wallet;
        try {
          wallet = creditAgentWallet({ wallet: baseWallet, amountCents, at: nowAt });
        } catch (err) {
          return sendError(res, 400, "wallet credit rejected", { message: err?.message, code: err?.code ?? null });
        }

        const responseBody = { wallet };
        const ops = [{ kind: "AGENT_WALLET_UPSERT", tenantId, wallet }];
        if (idemStoreKey) {
          ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
        }
        await commitTx(ops);
        return sendJson(res, 201, responseBody);
      }
    }

    if (parts[2] === "runs") {
      const hasRunStore = typeof store.getAgentRun === "function" || store.agentRuns instanceof Map;
      const hasRunEventStore = typeof store.getAgentRunEvents === "function" || store.agentRunEvents instanceof Map;
      if (!hasRunStore || !hasRunEventStore) return sendError(res, 501, "agent runs not supported for this store");

      if (req.method === "GET" && parts.length === 3) {
        const status = url.searchParams.get("status");
        const limitRaw = url.searchParams.get("limit");
        const offsetRaw = url.searchParams.get("offset");
        const limit = limitRaw ? Number(limitRaw) : 200;
        const offset = offsetRaw ? Number(offsetRaw) : 0;
        const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(1000, limit) : 200;
        const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;

        let runs;
        if (typeof store.listAgentRuns === "function") {
          try {
            runs = await store.listAgentRuns({ tenantId, agentId, status: status ?? null, limit: safeLimit, offset: safeOffset });
          } catch (err) {
            return sendError(res, 400, "invalid agent run query", { message: err?.message });
          }
        } else {
          const all = listAgentRuns({ tenantId, agentId, status: status ?? null });
          runs = all.slice(safeOffset, safeOffset + safeLimit);
        }
        let total;
        if (typeof store.countAgentRuns === "function") {
          try {
            total = await store.countAgentRuns({ tenantId, agentId, status: status ?? null });
          } catch (err) {
            return sendError(res, 400, "invalid agent run query", { message: err?.message });
          }
        } else {
          total = listAgentRuns({ tenantId, agentId, status: status ?? null }).length;
        }
        return sendJson(res, 200, { runs, total, limit: safeLimit, offset: safeOffset });
      }

      if (req.method === "POST" && parts.length === 3) {
        if (!requireProtocolHeaderForWrite(req, res)) return;
        const body = await readJsonBody(req);
        let idemStoreKey = null;
        let idemRequestHash = null;
        try {
          ({ idemStoreKey, idemRequestHash } = readIdempotency({ method: "POST", requestPath: path, expectedPrevChainHash: null, body }));
        } catch (err) {
          return sendError(res, 400, "invalid idempotency key", { message: err?.message });
        }
        if (idemStoreKey) {
          const existing = store.idempotency.get(idemStoreKey);
          if (existing) {
            if (existing.requestHash !== idemRequestHash) {
              return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
            }
            return sendJson(res, existing.statusCode, existing.body);
          }
        }

        const runId = body?.runId ? String(body.runId) : createId("run");
        let existingRun = null;
        if (typeof store.getAgentRun === "function") {
          existingRun = await store.getAgentRun({ tenantId, runId });
        } else if (store.agentRuns instanceof Map) {
          existingRun = store.agentRuns.get(runStoreKey(tenantId, runId)) ?? null;
        }
        if (existingRun && !idemStoreKey) return sendError(res, 409, "run already exists");

        let settlementRequest = null;
        if (body?.settlement !== undefined && body?.settlement !== null) {
          try {
            settlementRequest = validateAgentRunSettlementRequest(body.settlement);
          } catch (err) {
            return sendError(res, 400, "invalid run settlement payload", { message: err?.message });
          }
          const hasWalletStore = typeof store.getAgentWallet === "function" || store.agentWallets instanceof Map;
          const hasSettlementStore = typeof store.getAgentRunSettlement === "function" || store.agentRunSettlements instanceof Map;
          if (!hasWalletStore || !hasSettlementStore) {
            return sendError(res, 501, "agent wallets/settlements not supported for this store");
          }
        }

        const createdPayload = {
          runId,
          agentId,
          tenantId,
          taskType: body?.taskType ?? null,
          inputRef: body?.inputRef ?? null
        };
        try {
          validateRunCreatedPayload(createdPayload);
        } catch (err) {
          return sendError(res, 400, "invalid run payload", { message: err?.message });
        }

        const createdEvent = createChainedEvent({
          streamId: runId,
          type: AGENT_RUN_EVENT_TYPE.RUN_CREATED,
          actor: { type: "agent", id: agentId },
          payload: createdPayload,
          at: nowIso()
        });
        const events = normalizeAgentRunEventRecords(appendChainedEvent({ events: [], event: createdEvent, signer: serverSigner }));
        let run;
        try {
          run = reduceAgentRun(events);
        } catch (err) {
          return sendError(res, 400, "run creation rejected", { message: err?.message });
        }

        const nowAt = events[events.length - 1]?.at ?? nowIso();
        const ops = [{ kind: "AGENT_RUN_EVENTS_APPENDED", tenantId, runId, events }];
        let settlement = null;
        if (settlementRequest) {
          let payerIdentity = null;
          if (typeof store.getAgentIdentity === "function") {
            payerIdentity = await store.getAgentIdentity({ tenantId, agentId: settlementRequest.payerAgentId });
          } else if (store.agentIdentities instanceof Map) {
            payerIdentity = store.agentIdentities.get(makeScopedKey({ tenantId, id: settlementRequest.payerAgentId })) ?? null;
          }
            if (!payerIdentity) return sendError(res, 404, "payer agent identity not found");

            try {
              await assertSettlementWithinWalletPolicy({
                tenantId,
                agentIdentity: payerIdentity,
                amountCents: settlementRequest.amountCents,
                at: nowAt
              });
            } catch (err) {
              return sendError(res, 409, "wallet policy blocked settlement", { message: err?.message, code: err?.code ?? null });
            }

          let payerWallet = null;
          try {
            const existingPayerWallet = await getAgentWalletRecord({ tenantId, agentId: settlementRequest.payerAgentId });
            const basePayerWallet = ensureAgentWallet({
              wallet: existingPayerWallet,
              tenantId,
              agentId: settlementRequest.payerAgentId,
              currency: settlementRequest.currency,
              at: nowAt
            });
            payerWallet = lockAgentWalletEscrow({ wallet: basePayerWallet, amountCents: settlementRequest.amountCents, at: nowAt });
            projectEscrowLedgerOperation({
              tenantId,
              settlement: {
                payerAgentId: settlementRequest.payerAgentId,
                agentId,
                currency: settlementRequest.currency
              },
              operationId: `escrow_hold_${runId}`,
              type: ESCROW_OPERATION_TYPE.HOLD,
              amountCents: settlementRequest.amountCents,
              at: nowAt,
              payerWalletBefore: basePayerWallet,
              payerWalletAfter: payerWallet,
              memo: `run:${runId}:hold`
            });
          } catch (err) {
            return sendError(res, 409, "unable to lock settlement escrow", { message: err?.message, code: err?.code ?? null });
          }

          settlement = createAgentRunSettlement({
            tenantId,
            runId,
            agentId,
            payerAgentId: settlementRequest.payerAgentId,
            amountCents: settlementRequest.amountCents,
            currency: settlementRequest.currency,
            disputeWindowDays: settlementRequest.disputeWindowDays ?? 0,
            at: nowAt
          });
          ops.push({ kind: "AGENT_WALLET_UPSERT", tenantId, wallet: payerWallet });
          ops.push({ kind: "AGENT_RUN_SETTLEMENT_UPSERT", tenantId, runId, settlement });
        }

        const responseBody = { run, event: events[events.length - 1], settlement };
        if (idemStoreKey) {
          ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
        }
        await commitTx(ops);
        return sendJson(res, 201, responseBody);
      }

      const runId = parts[3] ?? null;
      if (runId && req.method === "GET" && parts.length === 4) {
        let run = null;
        if (typeof store.getAgentRun === "function") {
          try {
            run = await store.getAgentRun({ tenantId, runId });
          } catch (err) {
            return sendError(res, 400, "invalid run id", { message: err?.message });
          }
        } else if (store.agentRuns instanceof Map) {
          run = store.agentRuns.get(runStoreKey(tenantId, runId)) ?? null;
        } else {
          return sendError(res, 501, "agent runs not supported for this store");
        }
        if (!run || String(run.agentId ?? "") !== String(agentId)) return sendError(res, 404, "run not found");

        const events = await getAgentRunEvents(tenantId, runId);
        const verification = computeAgentRunVerification({ run, events });
        let settlement = null;
        try {
          settlement = await getAgentRunSettlementRecord({ tenantId, runId });
        } catch {
          settlement = null;
        }
        return sendJson(res, 200, { run, verification, settlement });
      }

      if (runId && parts[4] === "events" && req.method === "GET" && parts.length === 5) {
        let run = null;
        if (typeof store.getAgentRun === "function") run = await store.getAgentRun({ tenantId, runId });
        else if (store.agentRuns instanceof Map) run = store.agentRuns.get(runStoreKey(tenantId, runId)) ?? null;
        if (!run || String(run.agentId ?? "") !== String(agentId)) return sendError(res, 404, "run not found");
        return sendJson(res, 200, { events: await getAgentRunEvents(tenantId, runId) });
      }

      if (runId && parts[4] === "events" && req.method === "POST" && parts.length === 5) {
        if (!requireProtocolHeaderForWrite(req, res)) return;
        const body = await readJsonBody(req);
        {
          const schemaCheck = parseEventSchemaVersionFromBody(body);
          if (!schemaCheck.ok) return sendError(res, schemaCheck.statusCode ?? 400, schemaCheck.message, schemaCheck.details ?? null, { code: schemaCheck.code });
        }
        const type = body?.type;
        if (!type) return sendError(res, 400, "type is required");
        res.__nooterraEventType = type;
        const supported = new Set([
          AGENT_RUN_EVENT_TYPE.RUN_STARTED,
          AGENT_RUN_EVENT_TYPE.RUN_ACTION_REQUIRED,
          AGENT_RUN_EVENT_TYPE.RUN_HEARTBEAT,
          AGENT_RUN_EVENT_TYPE.EVIDENCE_ADDED,
          AGENT_RUN_EVENT_TYPE.RUN_COMPLETED,
          AGENT_RUN_EVENT_TYPE.RUN_FAILED
        ]);
        if (!supported.has(type)) return sendError(res, 400, "unsupported run event type");

        const expectedHeader = parseExpectedPrevChainHashHeader(req);
        if (!expectedHeader.ok) return sendError(res, 428, "missing precondition", "x-proxy-expected-prev-chain-hash is required");

        let idemStoreKey = null;
        let idemRequestHash = null;
        try {
          ({ idemStoreKey, idemRequestHash } = readIdempotency({
            method: "POST",
            requestPath: path,
            expectedPrevChainHash: expectedHeader.expectedPrevChainHash,
            body
          }));
        } catch (err) {
          return sendError(res, 400, "invalid idempotency key", { message: err?.message });
        }
        if (idemStoreKey) {
          const existingIdem = store.idempotency.get(idemStoreKey);
          if (existingIdem) {
            if (existingIdem.requestHash !== idemRequestHash) {
              return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
            }
            return sendJson(res, existingIdem.statusCode, existingIdem.body);
          }
        }

        const existing = await getAgentRunEvents(tenantId, runId);
        if (!existing.length) return sendError(res, 404, "run not found");
        let previousRun = null;
        try {
          previousRun = reduceAgentRun(existing);
        } catch {
          previousRun = null;
        }
        const currentPrevChainHash = getCurrentPrevChainHash(existing);
        if (expectedHeader.expectedPrevChainHash !== currentPrevChainHash) {
          return sendError(res, 409, "event append conflict", {
            expectedPrevChainHash: currentPrevChainHash,
            gotExpectedPrevChainHash: expectedHeader.expectedPrevChainHash
          });
        }

        const payloadRaw = body?.payload ?? {};
        if (!payloadRaw || typeof payloadRaw !== "object" || Array.isArray(payloadRaw)) return sendError(res, 400, "payload must be an object");
        const payload = { ...payloadRaw, runId };
        try {
          if (type === AGENT_RUN_EVENT_TYPE.RUN_STARTED) validateRunStartedPayload(payload);
          else if (type === AGENT_RUN_EVENT_TYPE.RUN_ACTION_REQUIRED) validateRunActionRequiredPayload(payload);
          else if (type === AGENT_RUN_EVENT_TYPE.RUN_HEARTBEAT) validateRunHeartbeatPayload(payload);
          else if (type === AGENT_RUN_EVENT_TYPE.EVIDENCE_ADDED) validateEvidenceAddedPayload(payload);
          else if (type === AGENT_RUN_EVENT_TYPE.RUN_COMPLETED) validateRunCompletedPayload(payload);
          else if (type === AGENT_RUN_EVENT_TYPE.RUN_FAILED) validateRunFailedPayload(payload);
        } catch (err) {
          return sendError(res, 400, "invalid run event payload", { message: err?.message });
        }

        const draft = createChainedEvent({
          streamId: runId,
          type,
          actor: body?.actor ?? { type: "agent", id: agentId },
          payload,
          at: nowIso()
        });
        const nextEvents = normalizeAgentRunEventRecords(appendChainedEvent({ events: existing, event: draft, signer: serverSigner }));
        const event = nextEvents[nextEvents.length - 1];

        let run;
        try {
          run = reduceAgentRun(nextEvents);
        } catch (err) {
          return sendError(res, 400, "run update rejected", { message: err?.message });
        }
        if (String(run.agentId ?? "") !== String(agentId)) return sendError(res, 400, "run agent mismatch");

        const ops = [{ kind: "AGENT_RUN_EVENTS_APPENDED", tenantId, runId, events: [event] }];
        let settlement = null;
        try {
          settlement = await getAgentRunSettlementRecord({ tenantId, runId });
        } catch {
          settlement = null;
        }

        if (settlement && settlement.status === AGENT_RUN_SETTLEMENT_STATUS.LOCKED) {
          const terminal = run.status === "completed" || run.status === "failed";
          if (terminal) {
            const settledAt = event?.at ?? nowIso();
            const settlementResolutionKey = typeof event?.id === "string" && event.id.trim() !== "" ? event.id : `run_${runId}_${settledAt}`;
            try {
              assertSettlementKernelBindingsForResolution({
                settlement,
                runId,
                phase: "run_terminal_settlement.preflight",
                allowMissingArtifacts: true
              });
              const payerWalletExisting = await getAgentWalletRecord({ tenantId, agentId: settlement.payerAgentId });
              let payerWallet = ensureAgentWallet({
                wallet: payerWalletExisting,
                tenantId,
                agentId: settlement.payerAgentId,
                currency: settlement.currency,
                at: settledAt
              });

              const verification = computeAgentRunVerification({ run, events: nextEvents });
              const linkedTask = findMarketplaceRfqByRunId({ tenantId, runId });
              const linkedDisputeWindowDaysRaw = linkedTask?.agreement?.disputeWindowDays ?? settlement?.disputeWindowDays ?? 0;
              const linkedDisputeWindowDays =
                Number.isSafeInteger(Number(linkedDisputeWindowDaysRaw)) && Number(linkedDisputeWindowDaysRaw) >= 0
                  ? Number(linkedDisputeWindowDaysRaw)
                  : 0;
              const agreementPolicyMaterial = resolveAgreementPolicyMaterial({
                tenantId,
                agreement: linkedTask?.agreement ?? null
              });
              const agreementPolicy = agreementPolicyMaterial.policy ?? null;
              const agreementVerificationMethod = agreementPolicyMaterial.verificationMethod ?? null;
              const verifierExecution = evaluateRunSettlementVerifierExecution({
                verificationMethod: agreementVerificationMethod,
                run,
                verification
              });
              const effectiveVerificationStatus = verifierExecution.verificationStatus;
              const hasMarketplaceAgreement = Boolean(linkedTask?.agreement && typeof linkedTask.agreement === "object");
              let policyDecision = null;
              if (!hasMarketplaceAgreement) {
                const fallbackReleaseRatePct = run.status === "failed" ? 0 : resolveRunSettlementReleaseRatePct({ run, verification });
                const fallbackReleaseAmountCents =
                  fallbackReleaseRatePct <= 0
                    ? 0
                    : Math.min(settlement.amountCents, Math.floor((settlement.amountCents * fallbackReleaseRatePct) / 100));
                policyDecision = {
                  policy: null,
                  verificationMethod: null,
                  decisionMode: AGENT_RUN_SETTLEMENT_DECISION_MODE.AUTOMATIC,
                  shouldAutoResolve: true,
                  reasonCodes: [],
                  releaseRatePct: fallbackReleaseRatePct,
                  releaseAmountCents: fallbackReleaseAmountCents,
                  refundAmountCents: settlement.amountCents - fallbackReleaseAmountCents,
                  settlementStatus: fallbackReleaseAmountCents > 0 ? "released" : "refunded",
                  verificationStatus: effectiveVerificationStatus,
                  runStatus: run.status
                };
              } else {
                try {
                  policyDecision = evaluateSettlementPolicy({
                    policy: agreementPolicy,
                    verificationMethod: agreementVerificationMethod,
                    verificationStatus: effectiveVerificationStatus,
                    runStatus: run.status,
                    amountCents: settlement.amountCents
                  });
                } catch {
                  policyDecision = {
                    policy: agreementPolicy ?? null,
                    verificationMethod: agreementVerificationMethod ?? null,
                    decisionMode: AGENT_RUN_SETTLEMENT_DECISION_MODE.MANUAL_REVIEW,
                    shouldAutoResolve: false,
                    reasonCodes: ["policy_evaluation_failed"],
                    releaseRatePct: 0,
                    releaseAmountCents: 0,
                    refundAmountCents: settlement.amountCents,
                    settlementStatus: AGENT_RUN_SETTLEMENT_STATUS.LOCKED,
                    verificationStatus: effectiveVerificationStatus,
                    runStatus: run.status
                  };
                }
                policyDecision = applyAgreementMilestoneRelease({
                  policyDecision,
                  agreement: linkedTask?.agreement ?? null,
                  run,
                  verification,
                  amountCents: settlement.amountCents
                }).decision;
              }

              if (!policyDecision.shouldAutoResolve) {
                const manualReviewKernelRefs = buildSettlementKernelRefs({
                  settlement,
                  run,
                  agreementId: linkedTask?.agreement?.agreementId ?? null,
                  decisionStatus: AGENT_RUN_SETTLEMENT_DECISION_STATUS.MANUAL_REVIEW_REQUIRED,
                  decisionMode: AGENT_RUN_SETTLEMENT_DECISION_MODE.MANUAL_REVIEW,
                  decisionReason: policyDecision.reasonCodes?.[0] ?? "manual review required by settlement policy",
                  verificationStatus: policyDecision.verificationStatus ?? null,
                  policyHash: agreementPolicyMaterial.policyHash ?? null,
                  verificationMethodHash: agreementPolicyMaterial.verificationMethodHash ?? null,
                  verificationMethodMode: verifierExecution.verifierRef?.modality ?? agreementVerificationMethod?.mode ?? null,
                  verifierId: verifierExecution.verifierRef?.verifierId ?? "nooterra.policy-engine",
                  verifierVersion: verifierExecution.verifierRef?.verifierVersion ?? "v1",
                  verifierHash: verifierExecution.verifierRef?.verifierHash ?? null,
                  resolutionEventId: null,
                  finalityState: SETTLEMENT_FINALITY_STATE.PENDING,
                  settledAt: null,
                  createdAt: settledAt
                });
                settlement = updateAgentRunSettlementDecision({
                  settlement,
                  decisionStatus: AGENT_RUN_SETTLEMENT_DECISION_STATUS.MANUAL_REVIEW_REQUIRED,
                  decisionMode: AGENT_RUN_SETTLEMENT_DECISION_MODE.MANUAL_REVIEW,
                  decisionPolicyHash: agreementPolicyMaterial.policyHash ?? null,
                  decisionReason: policyDecision.reasonCodes?.[0] ?? "manual review required by settlement policy",
                  decisionTrace: {
                    phase: "run.terminal.awaiting_manual_resolution",
                    verifierExecution: verifierExecution.evaluation,
                    policyDecision,
                    decisionRecord: manualReviewKernelRefs.decisionRecord,
                    settlementReceipt: manualReviewKernelRefs.settlementReceipt
                  },
                  at: settledAt
                });
                settlement = {
                  ...settlement,
                  disputeWindowDays: linkedDisputeWindowDays,
                  revision: Number(settlement.revision ?? 0) + 1,
                  updatedAt: settledAt
                };
                ops.push({ kind: "AGENT_RUN_SETTLEMENT_UPSERT", tenantId, runId, settlement });
                if (linkedTask && String(linkedTask.status ?? "").toLowerCase() === "assigned") {
                  const awaitingTask = {
                    ...linkedTask,
                    settlementDecisionStatus: settlement.decisionStatus ?? null,
                    settlementDecisionReason: settlement.decisionReason ?? null,
                    updatedAt: settledAt
                  };
                  ops.push({ kind: "MARKETPLACE_RFQ_UPSERT", tenantId, rfq: awaitingTask });
                }
              } else {
                const releaseAmountCents = Number(policyDecision.releaseAmountCents ?? 0);
                const refundAmountCents = Number(policyDecision.refundAmountCents ?? settlement.amountCents);
                if (releaseAmountCents > 0) {
                  const payeeWalletExisting = await getAgentWalletRecord({ tenantId, agentId: settlement.agentId });
                  const payeeWallet = ensureAgentWallet({
                    wallet: payeeWalletExisting,
                    tenantId,
                    agentId: settlement.agentId,
                    currency: settlement.currency,
                    at: settledAt
                  });
                  const released = releaseAgentWalletEscrowToPayee({
                    payerWallet,
                    payeeWallet,
                    amountCents: releaseAmountCents,
                    at: settledAt
                  });
                  projectEscrowLedgerOperation({
                    tenantId,
                    settlement,
                    operationId: `escrow_release_${runId}_${settlementResolutionKey}`,
                    type: ESCROW_OPERATION_TYPE.RELEASE,
                    amountCents: releaseAmountCents,
                    at: settledAt,
                    payerWalletBefore: payerWallet,
                    payerWalletAfter: released.payerWallet,
                    payeeWalletBefore: payeeWallet,
                    payeeWalletAfter: released.payeeWallet,
                    memo: `run:${runId}:auto_release`
                  });
                  payerWallet = released.payerWallet;
                  ops.push({ kind: "AGENT_WALLET_UPSERT", tenantId, wallet: released.payeeWallet });
                }
                if (refundAmountCents > 0) {
                  const payerBeforeRefund = payerWallet;
                  payerWallet = refundAgentWalletEscrow({
                    wallet: payerWallet,
                    amountCents: refundAmountCents,
                    at: settledAt
                  });
                  projectEscrowLedgerOperation({
                    tenantId,
                    settlement,
                    operationId: `escrow_forfeit_${runId}_${settlementResolutionKey}`,
                    type: ESCROW_OPERATION_TYPE.FORFEIT,
                    amountCents: refundAmountCents,
                    at: settledAt,
                    payerWalletBefore: payerBeforeRefund,
                    payerWalletAfter: payerWallet,
                    memo: `run:${runId}:auto_refund`
                  });
                }

                const autoResolvedKernelRefs = buildSettlementKernelRefs({
                  settlement,
                  run,
                  agreementId: linkedTask?.agreement?.agreementId ?? null,
                  decisionStatus: AGENT_RUN_SETTLEMENT_DECISION_STATUS.AUTO_RESOLVED,
                  decisionMode: AGENT_RUN_SETTLEMENT_DECISION_MODE.AUTOMATIC,
                  decisionReason: policyDecision.reasonCodes?.[0] ?? null,
                  verificationStatus: policyDecision.verificationStatus ?? null,
                  policyHash: agreementPolicyMaterial.policyHash ?? null,
                  verificationMethodHash: agreementPolicyMaterial.verificationMethodHash ?? null,
                  verificationMethodMode: verifierExecution.verifierRef?.modality ?? agreementVerificationMethod?.mode ?? null,
                  verifierId: verifierExecution.verifierRef?.verifierId ?? "nooterra.policy-engine",
                  verifierVersion: verifierExecution.verifierRef?.verifierVersion ?? "v1",
                  verifierHash: verifierExecution.verifierRef?.verifierHash ?? null,
                  resolutionEventId: event.id,
                  status: releaseAmountCents > 0 ? AGENT_RUN_SETTLEMENT_STATUS.RELEASED : AGENT_RUN_SETTLEMENT_STATUS.REFUNDED,
                  releasedAmountCents: releaseAmountCents,
                  refundedAmountCents: refundAmountCents,
                  releaseRatePct: Number(policyDecision.releaseRatePct ?? 0),
                  finalityState: SETTLEMENT_FINALITY_STATE.FINAL,
                  settledAt,
                  createdAt: settledAt
                });
                settlement = resolveAgentRunSettlement({
                  settlement,
                  status: releaseAmountCents > 0 ? AGENT_RUN_SETTLEMENT_STATUS.RELEASED : AGENT_RUN_SETTLEMENT_STATUS.REFUNDED,
                  runStatus: run.status,
                  releasedAmountCents: releaseAmountCents,
                  refundedAmountCents: refundAmountCents,
                  releaseRatePct: Number(policyDecision.releaseRatePct ?? 0),
                  disputeWindowDays: linkedDisputeWindowDays,
                  decisionStatus: AGENT_RUN_SETTLEMENT_DECISION_STATUS.AUTO_RESOLVED,
                  decisionMode: AGENT_RUN_SETTLEMENT_DECISION_MODE.AUTOMATIC,
                  decisionPolicyHash: agreementPolicyMaterial.policyHash ?? null,
                  decisionReason: policyDecision.reasonCodes?.[0] ?? null,
                  decisionTrace: {
                    phase: "run.terminal.auto_resolved",
                    verifierExecution: verifierExecution.evaluation,
                    policyDecision,
                    decisionRecord: autoResolvedKernelRefs.decisionRecord,
                    settlementReceipt: autoResolvedKernelRefs.settlementReceipt
                  },
                  resolutionEventId: event.id,
                  at: settledAt
                });
                assertSettlementKernelBindingsForResolution({
                  settlement,
                  runId,
                  phase: "run_terminal_settlement.auto_resolved"
                });

                ops.push({ kind: "AGENT_WALLET_UPSERT", tenantId, wallet: payerWallet });
                ops.push({ kind: "AGENT_RUN_SETTLEMENT_UPSERT", tenantId, runId, settlement });

                if (linkedTask && String(linkedTask.status ?? "").toLowerCase() === "assigned") {
                  const closedTask = {
                    ...linkedTask,
                    status: "closed",
                    settlementStatus: settlement.status,
                    settlementResolvedAt: settlement.resolvedAt ?? settledAt,
                    settlementReleaseRatePct: settlement.releaseRatePct ?? null,
                    settlementDecisionStatus: settlement.decisionStatus ?? null,
                    settlementDecisionReason: settlement.decisionReason ?? null,
                    updatedAt: settledAt
                  };
                  ops.push({ kind: "MARKETPLACE_RFQ_UPSERT", tenantId, rfq: closedTask });
                }
              }
            } catch (err) {
              if (err?.code === "SETTLEMENT_KERNEL_BINDING_INVALID") {
                return sendError(res, 409, "invalid settlement kernel artifacts", {
                  message: err?.message,
                  code: err?.code ?? null,
                  errors: err?.detail?.errors ?? null
                }, { code: "SETTLEMENT_KERNEL_BINDING_INVALID" });
              }
              return sendError(res, 409, "run settlement failed", { message: err?.message, code: err?.code ?? null });
            }
          }
        }

        if (run.status === "completed" || run.status === "failed") {
          try {
            await assertTenantVerifiedRunAllowance({
              tenantId,
              occurredAt: event?.at ?? nowIso(),
              quantity: 1
            });
          } catch (err) {
            if (err?.code === "BILLING_PLAN_LIMIT_EXCEEDED") {
              return sendError(res, 402, "billing plan verified-run limit exceeded", err?.detail ?? null, { code: err.code });
            }
            throw err;
          }
        }

        const settlementArtifacts = extractSettlementKernelArtifacts(settlement);
        const kernelVerification = verifySettlementKernelArtifacts({ settlement, runId });
        const responseBody = { event, run, settlement, ...settlementArtifacts, kernelVerification };
        if (idemStoreKey) {
          ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
        }
        await commitTx(ops);
        if (run.status === "completed" || run.status === "failed") {
          await emitBillableUsageEventBestEffort(
            {
              tenantId,
              eventKey: `verified_run:${runId}:${String(event?.id ?? run?.lastEventId ?? run?.status ?? "terminal")}`,
              eventType: BILLABLE_USAGE_EVENT_TYPE.VERIFIED_RUN,
              occurredAt: event?.at ?? nowIso(),
              quantity: 1,
              runId,
              settlementId: settlement?.settlementId ?? null,
              disputeId: settlement?.disputeId ?? null,
              sourceType: "agent_run_event",
              sourceId: runId,
              sourceEventId: event?.id ?? null,
              audit: {
                route: path,
                method: "POST",
                actorAgentId: agentId,
                runStatus: run.status,
                verificationStatus: computeAgentRunVerification({ run, events: nextEvents }).verificationStatus
              }
            },
            { context: "agent_run_event.verified_run" }
          );
        }
        if (settlement && settlement.status !== AGENT_RUN_SETTLEMENT_STATUS.LOCKED) {
          const decisionHashRaw =
            settlement?.decisionTrace?.decisionRecord && typeof settlement.decisionTrace.decisionRecord === "object"
              ? settlement.decisionTrace.decisionRecord.decisionHash
              : null;
          const decisionHash =
            typeof decisionHashRaw === "string" && /^[0-9a-f]{64}$/i.test(decisionHashRaw.trim())
              ? decisionHashRaw.trim().toLowerCase()
              : sha256Hex(
                  `${String(settlement?.settlementId ?? runId)}:${String(settlement?.resolutionEventId ?? event?.id ?? "auto_resolution")}:${String(
                    settlement?.status ?? ""
                  )}`
                );
          await emitReputationEventBestEffort(
            {
              tenantId,
              eventId: `rep_dec_${decisionHash}`,
              occurredAt: settlement?.resolvedAt ?? event?.at ?? nowIso(),
              eventKind:
                Number(settlement?.releasedAmountCents ?? 0) > 0
                  ? REPUTATION_EVENT_KIND.DECISION_APPROVED
                  : REPUTATION_EVENT_KIND.DECISION_REJECTED,
              subject: {
                agentId: String(settlement.agentId),
                counterpartyAgentId: String(settlement.payerAgentId),
                role: "payee"
              },
              sourceRef: {
                kind: "settlement_decision",
                sourceId: String(settlement?.settlementId ?? runId),
                hash: decisionHash,
                decisionHash,
                runId,
                settlementId: settlement?.settlementId ?? null
              },
              facts: {
                decisionStatus: Number(settlement?.releasedAmountCents ?? 0) > 0 ? "approved" : "rejected",
                releaseRatePct: Number(settlement?.releaseRatePct ?? 0),
                amountSettledCents: Number(settlement?.releasedAmountCents ?? 0),
                amountRefundedCents: Number(settlement?.refundedAmountCents ?? 0),
                latencyMs: toSafeNonNegativeInt(run?.metrics?.latencyMs)
              }
            },
            { context: "agent_run_event.settlement_decision" }
          );
          const releasedAmountCentsRaw =
            settlement?.releasedAmountCents ??
            (String(settlement.status ?? "").toLowerCase() === AGENT_RUN_SETTLEMENT_STATUS.RELEASED ? settlement?.amountCents : 0);
          const releasedAmountCents = Number.isSafeInteger(Number(releasedAmountCentsRaw)) ? Number(releasedAmountCentsRaw) : 0;
          await emitBillableUsageEventBestEffort(
            {
              tenantId,
              eventKey: `settled_volume:${String(settlement?.settlementId ?? runId)}:${String(settlement?.resolutionEventId ?? event?.id ?? settlement?.status ?? "resolved")}`,
              eventType: BILLABLE_USAGE_EVENT_TYPE.SETTLED_VOLUME,
              occurredAt: settlement?.resolvedAt ?? event?.at ?? nowIso(),
              quantity: 1,
              amountCents: Math.max(0, releasedAmountCents),
              currency: settlement?.currency ?? "USD",
              runId,
              settlementId: settlement?.settlementId ?? null,
              disputeId: settlement?.disputeId ?? null,
              sourceType: "agent_run_settlement",
              sourceId: settlement?.settlementId ?? runId,
              sourceEventId: settlement?.resolutionEventId ?? event?.id ?? null,
              audit: {
                route: path,
                method: "POST",
                actorAgentId: agentId,
                settlementStatus: settlement?.status ?? null
              }
            },
            { context: "agent_run_event.settled_volume" }
          );
        }
        if (settlement && settlement.status !== AGENT_RUN_SETTLEMENT_STATUS.LOCKED) {
          try {
            await emitMarketplaceLifecycleArtifact({
              tenantId,
              eventType: "marketplace.settlement.resolved",
              rfqId: findMarketplaceRfqByRunId({ tenantId, runId })?.rfqId ?? null,
              runId,
              sourceEventId: event.id,
              actorAgentId: agentId,
              settlement,
              details: {
                runStatus: run.status,
                verificationStatus: computeAgentRunVerification({ run, events: nextEvents }).verificationStatus
              }
            });
          } catch {
            // Best-effort lifecycle delivery.
          }
        } else if (settlement && settlement.decisionStatus === AGENT_RUN_SETTLEMENT_DECISION_STATUS.MANUAL_REVIEW_REQUIRED) {
          try {
            await emitMarketplaceLifecycleArtifact({
              tenantId,
              eventType: "marketplace.settlement.manual_review_required",
              rfqId: findMarketplaceRfqByRunId({ tenantId, runId })?.rfqId ?? null,
              runId,
              sourceEventId: event.id,
              actorAgentId: agentId,
              settlement,
              details: {
                runStatus: run.status,
                verificationStatus: computeAgentRunVerification({ run, events: nextEvents }).verificationStatus,
                decisionReason: settlement.decisionReason ?? null
              }
            });
          } catch {
            // Best-effort lifecycle delivery.
          }
        }
        const linkedTaskForNotification = findMarketplaceRfqByRunId({ tenantId, runId });
        const baseVerification = computeAgentRunVerification({ run, events: nextEvents });
        const phase1ContractVerification = buildPhase1RunContractVerification({
          run,
          events: nextEvents,
          linkedTask: linkedTaskForNotification
        });
        const mergedVerification = mergeRunVerificationWithPhase1Contract(baseVerification, phase1ContractVerification);
        const runActionRequiredNotification = buildRunActionRequiredNotificationPayload({
          previousRun,
          run
        });
        const informationRequiredNotification = buildInformationRequiredNotificationPayload({
          run,
          linkedTask: linkedTaskForNotification,
          phase1ContractVerification
        });
        const buyerAttentionNotification = runActionRequiredNotification ?? informationRequiredNotification;
        if (buyerAttentionNotification) {
          await emitBuyerProductNotificationBestEffort({
            tenantId,
            token: buyerAttentionNotification.token,
            payload: buyerAttentionNotification.payload,
            context: "agent_run.information_required"
          });
        }
        const runUpdateNotification = buyerAttentionNotification
          ? null
          : buildRunUpdateNotificationPayload({
              previousRun,
              run,
              verification: mergedVerification
            });
        if (runUpdateNotification) {
          await emitBuyerProductNotificationBestEffort({
            tenantId,
            token: runUpdateNotification.token,
            payload: runUpdateNotification.payload,
            context: "agent_run.status_transition"
          });
        }
        return sendJson(res, 201, responseBody);
      }
    }
    }

    // Check if the response was sent by a route that uses bare "return;" (e.g. SSE streams).
    if (res.writableEnded || res.headersSent) return true;

    return false;
  };
}
