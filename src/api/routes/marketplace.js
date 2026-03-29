/**
 * Marketplace routes: /marketplace/rfqs/*, /marketplace/agents/search
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
export function createMarketplaceRoutes(deps) {
  const {
    store,
    sendJson,
    sendError,
    readJsonBody,
    createId,
    nowIso,
    commitTx,
    normalizeForCanonicalJson,
    getMarketplaceRfq,
    listMarketplaceRfqs,
    upsertMarketplaceRfq,
    listMarketplaceRfqBids,
    submitMarketplaceBid,
    acceptMarketplaceRfqBid,
    cancelMarketplaceRfq,
    toMarketplaceRfqResponse,
    toMarketplaceBidResponse,
    normalizeMarketplaceCounterOfferPolicyInput,
    normalizeMarketplaceCounterOfferInput,
    searchMarketplaceAgents,
    enforceMarketplaceParticipantLifecycleGuards,
    parseInteractionDirection,
    getAgentIdentityRecord,
    normalizeWorkOrderApprovalModeInput,
    normalizeWorkOrderApprovalPolicyInput,
    normalizeApprovalContinuationOptionsInput,
    deriveMarketplaceRfqApprovalContext,
    assertApprovalRecordsPersistable,
    buildApprovalPersistenceOps,
    requireProtocolHeaderForWrite,
    decodePathPart,
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
  return async function handleMarketplaceRoutes(ctx) {
    const { req, res, method, path, url, tenantId, principalId, auth, readIdempotency, makeOpsAudit, cloneJsonLike } = ctx;
    // Use wrapped versions that return true for "return sendJson/sendError(...)" pattern.
    const sendJson = _sendJson;
    const sendError = _sendError;

    const marketplaceParts = path.split("/").filter(Boolean);
    if (marketplaceParts[0] !== "marketplace") return false;

    if (marketplaceParts[0] === "marketplace" && marketplaceParts[1] === "rfqs") {
    if (!(store.marketplaceRfqs instanceof Map)) store.marketplaceRfqs = new Map();
    if (!(store.marketplaceRfqBids instanceof Map)) store.marketplaceRfqBids = new Map();

    if (req.method === "POST" && marketplaceParts.length === 2) {
      const body = await readJsonBody(req);
      let idemStoreKey = null;
      let idemRequestHash = null;
      try {
        ({ idemStoreKey, idemRequestHash } = readIdempotency({ method: "POST", requestPath: path, expectedPrevChainHash: null, body }));
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

      if (body?.taskId !== undefined && body?.taskId !== null) {
        return sendError(res, 400, "unsupported identifier field; use rfqId");
      }
      const rfqId = body?.rfqId && String(body.rfqId).trim() !== "" ? String(body.rfqId).trim() : createId("rfq");
      const title = body?.title && String(body.title).trim() !== "" ? String(body.title).trim() : null;
      const capability = body?.capability && String(body.capability).trim() !== "" ? String(body.capability).trim() : null;
      if (!title && !capability) return sendError(res, 400, "rfq title or capability is required");

      const posterAgentId = body?.posterAgentId && String(body.posterAgentId).trim() !== "" ? String(body.posterAgentId).trim() : null;
      if (posterAgentId) {
        let posterIdentity = null;
        try {
          posterIdentity = await getAgentIdentityRecord({ tenantId, agentId: posterAgentId });
        } catch (err) {
          return sendError(res, 400, "invalid posterAgentId", { message: err?.message });
        }
        if (!posterIdentity) return sendError(res, 404, "poster agent identity not found");
        const rfqLifecycleGuard = await enforceMarketplaceParticipantLifecycleGuards({
          tenantId,
          participants: [{ role: "poster", agentId: posterAgentId }],
          operation: "marketplace_rfq.issue"
        });
        if (rfqLifecycleGuard?.blocked) {
          return sendError(
            res,
            rfqLifecycleGuard.httpStatus ?? 409,
            rfqLifecycleGuard.message,
            rfqLifecycleGuard.details ?? null,
            { code: rfqLifecycleGuard.code ?? "X402_AGENT_LIFECYCLE_INVALID" }
          );
        }
      }

      let taskDirection = null;
      try {
        taskDirection = parseInteractionDirection({ fromTypeRaw: body?.fromType, toTypeRaw: body?.toType });
      } catch (err) {
        return sendError(res, 400, "invalid interaction direction", { message: err?.message });
      }

      const existingTask = getMarketplaceRfq({ tenantId, rfqId });
      if (existingTask && !idemStoreKey) return sendError(res, 409, "marketplace rfq already exists");

      let budgetCents = null;
      if (body?.budgetCents !== undefined && body?.budgetCents !== null) {
        const parsedBudget = Number(body.budgetCents);
        if (!Number.isSafeInteger(parsedBudget) || parsedBudget <= 0) {
          return sendError(res, 400, "budgetCents must be a positive safe integer");
        }
        budgetCents = parsedBudget;
      }

      const currency = body?.currency ? String(body.currency).trim().toUpperCase() : "USD";
      if (currency === "") return sendError(res, 400, "currency must be a non-empty string");

      let deadlineAt = null;
      if (body?.deadlineAt !== undefined && body?.deadlineAt !== null) {
        if (typeof body.deadlineAt !== "string" || body.deadlineAt.trim() === "") return sendError(res, 400, "deadlineAt must be an ISO date-time");
        const deadlineMs = Date.parse(body.deadlineAt);
        if (!Number.isFinite(deadlineMs)) return sendError(res, 400, "deadlineAt must be an ISO date-time");
        deadlineAt = new Date(deadlineMs).toISOString();
      }

      const metadata = body?.metadata ?? null;
      if (metadata !== null && (typeof metadata !== "object" || Array.isArray(metadata))) {
        return sendError(res, 400, "metadata must be an object or null");
      }
      let counterOfferPolicy = null;
      try {
        counterOfferPolicy = normalizeMarketplaceCounterOfferPolicyInput(body?.counterOfferPolicy ?? null, {
          fieldPath: "counterOfferPolicy"
        });
      } catch (err) {
        return sendError(res, 400, "invalid counterOfferPolicy", { message: err?.message });
      }

      let approvalMode = null;
      let approvalPolicy = null;
      let authorityEnvelope = null;
      let approvalRequest = null;
      let approvalDecision = null;
      let approvalContinuation = null;
      let approvalContinuationOptions = null;
      try {
        approvalMode = normalizeWorkOrderApprovalModeInput(body?.approvalMode ?? body?.approval?.mode ?? null, { allowNull: true });
        approvalPolicy = normalizeWorkOrderApprovalPolicyInput(body?.approvalPolicy ?? body?.approval?.policy ?? null);
        approvalContinuationOptions = normalizeApprovalContinuationOptionsInput(body?.approvalContinuation ?? null);
      } catch (err) {
        return sendError(res, 400, "invalid marketplace approval policy", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (
        body?.authorityEnvelope !== undefined &&
        body?.authorityEnvelope !== null &&
        (!body.authorityEnvelope || typeof body.authorityEnvelope !== "object" || Array.isArray(body.authorityEnvelope))
      ) {
        return sendError(res, 400, "invalid authorityEnvelope", { message: "authorityEnvelope must be an object" }, { code: "SCHEMA_INVALID" });
      }
      if (
        body?.approvalRequest !== undefined &&
        body?.approvalRequest !== null &&
        (!body.approvalRequest || typeof body.approvalRequest !== "object" || Array.isArray(body.approvalRequest))
      ) {
        return sendError(res, 400, "invalid approvalRequest", { message: "approvalRequest must be an object" }, { code: "SCHEMA_INVALID" });
      }
      const rawAuthorityEnvelope =
        body?.authorityEnvelope && typeof body.authorityEnvelope === "object" && !Array.isArray(body.authorityEnvelope) ? body.authorityEnvelope : null;
      const rawApprovalRequest =
        body?.approvalRequest && typeof body.approvalRequest === "object" && !Array.isArray(body.approvalRequest) ? body.approvalRequest : null;
      const rawApprovalDecision =
        body?.approvalDecision ??
        body?.humanApprovalDecision ??
        body?.approval?.decision ??
        null;
      const approvalManaged =
        approvalMode !== null || approvalPolicy !== null || rawAuthorityEnvelope !== null || rawApprovalRequest !== null || rawApprovalDecision !== null;

      const nowAt = nowIso();
      let approvalRef = null;
      if (approvalManaged) {
        let approvalContext = null;
        try {
          approvalContext = deriveMarketplaceRfqApprovalContext({
            rfqId,
            posterAgentId,
            capability,
            title: title ?? capability,
            budgetCents,
            currency,
            deadlineAt,
            authorityEnvelopeInput: rawAuthorityEnvelope,
            approvalRequestInput: rawApprovalRequest,
            approvalPolicy,
            candidateAgentIds: [],
            nowAt
          });
        } catch (err) {
          const statusCode =
            Number.isSafeInteger(Number(err?.statusCode)) && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600
              ? Number(err.statusCode)
              : err instanceof TypeError
                ? 400
                : 409;
          const details =
            err?.details && typeof err.details === "object" && !Array.isArray(err.details)
              ? err.details
              : { message: err?.message ?? null };
          return sendError(
            res,
            statusCode,
            statusCode === 400 ? "invalid marketplace authority envelope" : "marketplace authority envelope blocked",
            details,
            { code: err?.code ?? (statusCode === 400 ? "SCHEMA_INVALID" : "MARKETPLACE_RFQ_AUTHORITY_ENVELOPE_MISMATCH") }
          );
        }
        authorityEnvelope = approvalContext.authorityEnvelope;
        approvalRequest = approvalContext.approvalRequest;
        const autoPolicyDecision =
          rawApprovalDecision === null
            ? await resolveApprovalStandingPolicyDecision({
                tenantId,
                authorityEnvelope,
                approvalRequest,
                nowAt
              })
            : null;
        try {
          approvalDecision = normalizeApprovalDecisionInput({
            rawApprovalDecision: rawApprovalDecision ?? autoPolicyDecision?.approvalDecision ?? null,
            approvalRequest,
            authorityEnvelope,
            errorCodePrefix: "MARKETPLACE_RFQ_APPROVAL"
          });
        } catch (err) {
          return sendError(
            res,
            err?.statusCode ?? 409,
            err?.statusCode === 400 ? "invalid marketplace approval decision" : "marketplace approval decision blocked",
            err?.details ?? { message: err?.message ?? null },
            { code: err?.code ?? (err?.statusCode === 400 ? "SCHEMA_INVALID" : "MARKETPLACE_RFQ_APPROVAL_DECISION_INVALID") }
          );
        }
        const approvalPolicyForCheck =
          approvalMode === "require"
            ? normalizeForCanonicalJson(
                {
                  ...(approvalPolicy ?? {}),
                  highRiskActionTypes: [approvalContext.approvalAction.actionType],
                  requireApprovalAboveCents: 0,
                  strictEvidenceRefs: approvalPolicy?.strictEvidenceRefs !== false,
                  requireContextBinding: false,
                  decisionTimeoutAt: approvalPolicy?.decisionTimeoutAt ?? null
                },
                { path: "$.approvalPolicyForCheck" }
              )
            : approvalPolicy ?? {};
        const approvalCheck = enforceHighRiskApproval({
          action: approvalContext.approvalAction,
          approvalPolicy: approvalPolicyForCheck,
          approvalDecision: approvalDecision ? approvalDecisionV1ToHumanApprovalDecision(approvalDecision) : null,
          contextBinding: null,
          nowIso: () => nowAt
        });
        if (!approvalCheck.approved) {
          const blockingIssue =
            Array.isArray(approvalCheck.blockingIssues) && approvalCheck.blockingIssues.length > 0
              ? approvalCheck.blockingIssues[0]
              : null;
          if (blockingIssue?.code === "HUMAN_APPROVAL_REQUIRED") {
            try {
              approvalContinuation = buildApprovalContinuationV1({
                requestId: approvalRequest.requestId,
                kind: APPROVAL_CONTINUATION_KIND.MARKETPLACE_RFQ,
                route: { method: "POST", path: "/marketplace/rfqs" },
                authorityEnvelope,
                approvalRequest,
                requestBody: body,
                requestedBy: approvalRequest.requestedBy,
                status: APPROVAL_CONTINUATION_STATUS.PENDING,
                resume: {
                  rfqId,
                  dispatchNow: approvalContinuationOptions?.dispatchNow === true,
                  approvalPath: `/approvals?requestId=${encodeURIComponent(approvalRequest.requestId)}`
                },
                createdAt: nowAt,
                updatedAt: nowAt
              });
              await assertApprovalRecordsPersistable({ tenantId, authorityEnvelope, approvalRequest, approvalContinuation });
              await commitTx(buildApprovalPersistenceOps({ tenantId, authorityEnvelope, approvalRequest, approvalContinuation }));
              const notification = buildApprovalRequiredNotificationPayload({ authorityEnvelope, approvalRequest });
              if (notification) {
                await emitBuyerProductNotificationBestEffort({
                  tenantId,
                  token: notification.token,
                  payload: notification.payload,
                  context: "marketplace_rfq.approval_required"
                });
              }
            } catch (err) {
              return sendError(
                res,
                err?.statusCode ?? 409,
                "marketplace approval persistence blocked",
                err?.details ?? { message: err?.message ?? null },
                { code: err?.code ?? "APPROVAL_RECORD_PERSISTENCE_BLOCKED" }
              );
            }
          }
          return sendError(
            res,
            409,
            blockingIssue?.code === "HUMAN_APPROVAL_REQUIRED" ? "marketplace approval required" : "marketplace approval blocked",
            {
              reasonCode: blockingIssue?.code ?? "MARKETPLACE_RFQ_APPROVAL_REQUIRED",
              message: blockingIssue?.detail ?? "marketplace approval gate blocked issuance",
              authorityEnvelope,
              approvalRequest,
              approvalContinuation,
              approvalCheck
            },
            { code: blockingIssue?.code ?? "MARKETPLACE_RFQ_APPROVAL_REQUIRED" }
          );
        }
        approvalRef = buildApprovalRecordRef({ authorityEnvelope, approvalRequest, approvalDecision });
      }
      if (!approvalContinuation && approvalRequest) {
        const currentContinuation = await getApprovalContinuationRecord({ tenantId, requestId: approvalRequest.requestId });
        if (currentContinuation) {
          const nextDecisionRef =
            approvalDecision && typeof approvalDecision === "object" && !Array.isArray(approvalDecision)
              ? buildApprovalContinuationDecisionRef(approvalDecision)
              : currentContinuation.decisionRef ?? null;
          const nextResultRef = {
            ...(currentContinuation.resultRef ?? {}),
            rfqId
          };
          if (
            String(currentContinuation.status ?? "") !== APPROVAL_CONTINUATION_STATUS.RESUMED ||
            String(currentContinuation?.decisionRef?.decisionHash ?? "") !== String(nextDecisionRef?.decisionHash ?? "") ||
            String(currentContinuation?.resultRef?.rfqId ?? "") !== String(nextResultRef.rfqId ?? "")
          ) {
            approvalContinuation = patchApprovalContinuationV1(currentContinuation, {
              status: APPROVAL_CONTINUATION_STATUS.RESUMED,
              decisionRef: nextDecisionRef,
              resultRef: nextResultRef,
              resumedAt: nowAt,
              updatedAt: nowAt
            });
          } else {
            approvalContinuation = currentContinuation;
          }
        }
      }
      try {
        await assertApprovalRecordsPersistable({ tenantId, authorityEnvelope, approvalRequest, approvalDecision, approvalContinuation });
      } catch (err) {
        return sendError(
          res,
          err?.statusCode ?? 409,
          "marketplace approval persistence blocked",
          err?.details ?? { message: err?.message ?? null },
          { code: err?.code ?? "APPROVAL_RECORD_PERSISTENCE_BLOCKED" }
        );
      }

      const rfq = {
        schemaVersion: "MarketplaceRfq.v1",
        rfqId,
        tenantId,
        title: title ?? capability,
        description: body?.description && String(body.description).trim() !== "" ? String(body.description).trim() : null,
        capability,
        fromType: taskDirection.fromType,
        toType: taskDirection.toType,
        posterAgentId,
        status: "open",
        budgetCents,
        currency,
        deadlineAt,
        acceptedBidId: null,
        acceptedBidderAgentId: null,
        acceptedAt: null,
        counterOfferPolicy,
        approval: approvalRef,
        metadata: metadata ? { ...metadata } : null,
        createdAt: nowAt,
        updatedAt: nowAt
      };

      const existingBids = listMarketplaceRfqBids({ tenantId, rfqId, status: "all" });
      const ops = [
        ...buildApprovalPersistenceOps({
          tenantId,
          authorityEnvelope,
          approvalRequest,
          approvalDecision,
          approvalContinuation
        }),
        { kind: "MARKETPLACE_RFQ_UPSERT", tenantId, rfq },
        { kind: "MARKETPLACE_RFQ_BIDS_SET", tenantId, rfqId, bids: existingBids }
      ];
      const responseBody = { rfq: toMarketplaceRfqResponse(rfq) };
      if (idemStoreKey) {
        ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
      }
      await commitTx(ops);
      return sendJson(res, 201, responseBody);
    }

    if (req.method === "GET" && marketplaceParts.length === 2) {
      let status = "all";
      try {
        status = parseMarketplaceRfqStatus(url.searchParams.get("status"), { allowAll: true, defaultStatus: "all" });
      } catch (err) {
        return sendError(res, 400, "invalid marketplace rfq query", { message: err?.message });
      }

      const capability = url.searchParams.get("capability");
      const posterAgentId = url.searchParams.get("posterAgentId");
      const { limit, offset } = parsePagination({
        limitRaw: url.searchParams.get("limit"),
        offsetRaw: url.searchParams.get("offset"),
        defaultLimit: 50,
        maxLimit: 200
      });

      const allRfqs = listMarketplaceRfqs({ tenantId, status, capability, posterAgentId });
      const rfqs = allRfqs.slice(offset, offset + limit);
      return sendJson(res, 200, { rfqs: rfqs.map((rfq) => toMarketplaceRfqResponse(rfq)), total: allRfqs.length, limit, offset });
    }

    const rfqId = marketplaceParts[2] ? String(marketplaceParts[2]) : null;
    if (!rfqId) return sendError(res, 404, "not found");

    const rfq = getMarketplaceRfq({ tenantId, rfqId });
    if (!rfq) return sendError(res, 404, "marketplace rfq not found");

    async function acceptMarketplaceRfqBid({
      body,
      idemStoreKey = null,
      idemRequestHash = null,
      responseBodyTransform = (value) => value
    } = {}) {
      return acceptMarketplaceRfqBidForRfq({
        rfq,
        rfqId,
        body,
        idemStoreKey,
        idemRequestHash,
        responseBodyTransform
      });
    }

    async function autoAcceptMarketplaceRfqBid({
      body,
      idemStoreKey = null,
      idemRequestHash = null
    } = {}) {
      return autoAcceptMarketplaceRfqBidForRfq({
        rfq,
        rfqId,
        body,
        idemStoreKey,
        idemRequestHash
      });
    }

    if (req.method === "GET" && marketplaceParts.length === 4 && marketplaceParts[3] === "bids") {
      let status = "all";
      try {
        status = parseMarketplaceBidStatus(url.searchParams.get("status"), { allowAll: true, defaultStatus: "all" });
      } catch (err) {
        return sendError(res, 400, "invalid marketplace bid query", { message: err?.message });
      }

      const bidderAgentId = url.searchParams.get("bidderAgentId");
      const { limit, offset } = parsePagination({
        limitRaw: url.searchParams.get("limit"),
        offsetRaw: url.searchParams.get("offset"),
        defaultLimit: 50,
        maxLimit: 200
      });

      const allBids = listMarketplaceRfqBids({ tenantId, rfqId, status, bidderAgentId });
      const bids = allBids.slice(offset, offset + limit);
      return sendJson(res, 200, { rfqId, bids: bids.map((bid) => toMarketplaceBidResponse(bid)), total: allBids.length, limit, offset });
    }

    if (req.method === "POST" && marketplaceParts.length === 4 && marketplaceParts[3] === "bids") {
      const body = await readJsonBody(req);
      let idemStoreKey = null;
      let idemRequestHash = null;
      try {
        ({ idemStoreKey, idemRequestHash } = readIdempotency({ method: "POST", requestPath: path, expectedPrevChainHash: null, body }));
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

      if (String(rfq.status ?? "open").toLowerCase() !== "open") return sendError(res, 409, "marketplace rfq is not open for bidding");

      const bidderAgentId = body?.bidderAgentId && String(body.bidderAgentId).trim() !== "" ? String(body.bidderAgentId).trim() : null;
      if (!bidderAgentId) return sendError(res, 400, "bidderAgentId is required");

      let bidderIdentity = null;
      try {
        bidderIdentity = await getAgentIdentityRecord({ tenantId, agentId: bidderAgentId });
      } catch (err) {
        return sendError(res, 400, "invalid bidderAgentId", { message: err?.message });
      }
      if (!bidderIdentity) return sendError(res, 404, "bidder agent identity not found");

      const bidIssueLifecycleGuard = await enforceMarketplaceParticipantLifecycleGuards({
        tenantId,
        participants: [
          { role: "poster", agentId: rfq?.posterAgentId ?? null },
          { role: "bidder", agentId: bidderAgentId }
        ],
        operation: "marketplace_bid.issue"
      });
      if (bidIssueLifecycleGuard?.blocked) {
        return sendError(
          res,
          bidIssueLifecycleGuard.httpStatus ?? 409,
          bidIssueLifecycleGuard.message,
          bidIssueLifecycleGuard.details ?? null,
          { code: bidIssueLifecycleGuard.code ?? "X402_AGENT_LIFECYCLE_INVALID" }
        );
      }

      let rfqDirection = null;
      let bidDirection = null;
      try {
        rfqDirection = parseInteractionDirection({ fromTypeRaw: rfq?.fromType, toTypeRaw: rfq?.toType });
        bidDirection = parseInteractionDirection({
          fromTypeRaw: body?.fromType,
          toTypeRaw: body?.toType,
          defaultFromType: rfqDirection.fromType,
          defaultToType: rfqDirection.toType
        });
      } catch (err) {
        return sendError(res, 400, "invalid interaction direction", { message: err?.message });
      }
      if (bidDirection.fromType !== rfqDirection.fromType || bidDirection.toType !== rfqDirection.toType) {
        return sendError(res, 409, "bid interaction direction must match rfq direction");
      }

      const amountCents = Number(body?.amountCents);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return sendError(res, 400, "amountCents must be a positive safe integer");

      const currency = body?.currency ? String(body.currency).trim().toUpperCase() : String(rfq.currency ?? "USD").toUpperCase();
      if (!currency) return sendError(res, 400, "currency must be a non-empty string");
      if (String(rfq.currency ?? "USD").toUpperCase() !== currency) {
        return sendError(res, 409, "bid currency must match rfq currency");
      }

      let etaSeconds = null;
      if (body?.etaSeconds !== undefined && body?.etaSeconds !== null) {
        const parsedEta = Number(body.etaSeconds);
        if (!Number.isSafeInteger(parsedEta) || parsedEta <= 0) return sendError(res, 400, "etaSeconds must be a positive safe integer");
        etaSeconds = parsedEta;
      }

      const metadata = body?.metadata ?? null;
      if (metadata !== null && (typeof metadata !== "object" || Array.isArray(metadata))) {
        return sendError(res, 400, "metadata must be an object or null");
      }

      let policySelection = null;
      try {
        policySelection = resolveMarketplaceSettlementPolicySelection({
          tenantId,
          policyRefInput: body?.policyRef ?? null,
          verificationMethodInput: body?.verificationMethod ?? undefined,
          settlementPolicyInput: body?.policy ?? undefined
        });
      } catch (err) {
        if (err?.code === "TENANT_SETTLEMENT_POLICY_NOT_FOUND") {
          return sendError(res, 404, "policyRef not found");
        }
        if (err?.code === "TENANT_SETTLEMENT_POLICY_REF_MISMATCH") {
          return sendError(res, 409, "policyRef does not match verificationMethod/policy", { message: err?.message });
        }
        if (err?.code === "INVALID_VERIFICATION_METHOD") {
          return sendError(res, 400, "invalid verificationMethod", { message: err?.message });
        }
        if (err?.code === "INVALID_SETTLEMENT_POLICY") {
          return sendError(res, 400, "invalid policy", { message: err?.message });
        }
        return sendError(res, 400, "invalid policy selection", { message: err?.message });
      }
      const verificationMethod = policySelection.verificationMethod;
      const policy = policySelection.policy;
      const policyRef = policySelection.policyRef;

      const bidId = body?.bidId && String(body.bidId).trim() !== "" ? String(body.bidId).trim() : createId("bid");
      const allExistingBids = listMarketplaceRfqBids({ tenantId, rfqId, status: "all" });
      const duplicate = allExistingBids.find((row) => String(row?.bidId ?? "") === bidId);
      if (duplicate && !idemStoreKey) return sendError(res, 409, "marketplace bid already exists");

      const nowAt = nowIso();
      const counterOfferPolicy = resolveMarketplaceCounterOfferPolicy({ rfq: rfq, bid: null });
      const initialProposal = buildMarketplaceBidNegotiationProposal({
        rfq: rfq,
        bidId,
        revision: 1,
        proposerAgentId: bidderAgentId,
        amountCents,
        currency,
        etaSeconds,
        note: body?.note && String(body.note).trim() !== "" ? String(body.note).trim() : null,
        verificationMethodInput: verificationMethod,
        settlementPolicyInput: policy,
        policyRefInput: policyRef,
        metadataInput: metadata,
        proposalIdInput: body?.proposalId ?? null,
        proposedAt: nowAt
      });
      const negotiation = buildMarketplaceBidNegotiation({
        bidId,
        initialProposal,
        counterOfferPolicy,
        at: nowAt
      });
      const bid = {
        schemaVersion: "MarketplaceBid.v1",
        bidId,
        rfqId,
        tenantId,
        fromType: bidDirection.fromType,
        toType: bidDirection.toType,
        bidderAgentId,
        amountCents,
        currency,
        etaSeconds,
        note: body?.note && String(body.note).trim() !== "" ? String(body.note).trim() : null,
        status: "pending",
        acceptedAt: null,
        rejectedAt: null,
        negotiation,
        counterOfferPolicy,
        verificationMethod,
        policy,
        policyRef,
        metadata: metadata ? { ...metadata } : null,
        createdAt: nowAt,
        updatedAt: nowAt
      };
      const nextBids = [...allExistingBids, bid];
      const nextRfq = { ...rfq, updatedAt: nowAt };
      const responseBody = { rfq: toMarketplaceRfqResponse(nextRfq), bid: toMarketplaceBidResponse(bid) };
      const ops = [
        { kind: "MARKETPLACE_RFQ_UPSERT", tenantId, rfq: nextRfq },
        { kind: "MARKETPLACE_RFQ_BIDS_SET", tenantId, rfqId, bids: nextBids }
      ];
      if (idemStoreKey) {
        ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
      }
      await commitTx(ops);
      try {
        await emitMarketplaceLifecycleArtifact({
          tenantId,
          eventType: "proposal.submitted",
          rfqId: rfqId,
          sourceEventId: initialProposal?.proposalId ?? null,
          actorAgentId: bidderAgentId,
          details: {
            bidId,
            revision: initialProposal?.revision ?? 1,
            proposal: initialProposal,
            negotiation
          }
        });
      } catch {
        // Best-effort lifecycle delivery.
      }
      return sendJson(res, 201, responseBody);
    }

    if (req.method === "POST" && marketplaceParts.length === 6 && marketplaceParts[3] === "bids" && marketplaceParts[5] === "counter-offer") {
      const bidId = marketplaceParts[4] ? String(marketplaceParts[4]).trim() : "";
      if (!bidId) return sendError(res, 404, "marketplace bid not found");

      const body = await readJsonBody(req);
      let idemStoreKey = null;
      let idemRequestHash = null;
      try {
        ({ idemStoreKey, idemRequestHash } = readIdempotency({ method: "POST", requestPath: path, expectedPrevChainHash: null, body }));
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

      if (String(rfq.status ?? "open").toLowerCase() !== "open") return sendError(res, 409, "marketplace rfq is not open for negotiation");

      const proposerAgentId = body?.proposerAgentId && String(body.proposerAgentId).trim() !== "" ? String(body.proposerAgentId).trim() : null;
      if (!proposerAgentId) return sendError(res, 400, "proposerAgentId is required");

      let proposerIdentity = null;
      try {
        proposerIdentity = await getAgentIdentityRecord({ tenantId, agentId: proposerAgentId });
      } catch (err) {
        return sendError(res, 400, "invalid proposerAgentId", { message: err?.message });
      }
      if (!proposerIdentity) return sendError(res, 404, "proposer agent identity not found");

      const allExistingBids = listMarketplaceRfqBids({ tenantId, rfqId, status: "all" });
      const selectedBid = allExistingBids.find((row) => String(row?.bidId ?? "") === bidId) ?? null;
      if (!selectedBid) return sendError(res, 404, "marketplace bid not found");
      if (String(selectedBid.status ?? "pending").toLowerCase() !== "pending") {
        return sendError(res, 409, "marketplace bid is not pending");
      }

      const counterOfferLifecycleGuard = await enforceMarketplaceParticipantLifecycleGuards({
        tenantId,
        participants: [
          { role: "poster", agentId: rfq?.posterAgentId ?? null },
          { role: "bidder", agentId: selectedBid?.bidderAgentId ?? null },
          { role: "proposer", agentId: proposerAgentId }
        ],
        operation: "marketplace_bid.counter_offer",
        enforceSignerLifecycle: true
      });
      if (counterOfferLifecycleGuard?.blocked) {
        return sendError(
          res,
          counterOfferLifecycleGuard.httpStatus ?? 409,
          counterOfferLifecycleGuard.message,
          counterOfferLifecycleGuard.details ?? null,
          { code: counterOfferLifecycleGuard.code ?? "X402_AGENT_LIFECYCLE_INVALID" }
        );
      }

      const proposerRole = resolveMarketplaceBidCounterOfferRole({
        rfq: rfq,
        bid: selectedBid,
        proposerAgentId
      });
      if (!proposerRole) {
        return sendError(res, 409, "counter-offer proposer must be rfq poster or bid bidder");
      }
      let counterOfferPolicy = resolveMarketplaceCounterOfferPolicy({ rfq: rfq, bid: selectedBid });
      if (proposerRole === "poster" && counterOfferPolicy.allowPosterCounterOffers !== true) {
        return sendError(res, 409, "counter-offer proposer role blocked by counterOfferPolicy");
      }
      if (proposerRole === "bidder" && counterOfferPolicy.allowBidderCounterOffers !== true) {
        return sendError(res, 409, "counter-offer proposer role blocked by counterOfferPolicy");
      }

      let negotiation =
        selectedBid?.negotiation && typeof selectedBid.negotiation === "object" && !Array.isArray(selectedBid.negotiation)
          ? selectedBid.negotiation
          : null;
      const nowAt = nowIso();
      if (!negotiation) {
        try {
          negotiation = bootstrapMarketplaceBidNegotiation({
            rfq: rfq,
            bid: selectedBid,
            counterOfferPolicy,
            at: nowAt
          });
        } catch (err) {
          return sendError(res, 409, "unable to bootstrap bid negotiation", { message: err?.message });
        }
      }
      const policyApplied = applyMarketplaceBidNegotiationPolicy({
        negotiation,
        counterOfferPolicy,
        at: nowAt,
        expireIfTimedOut: true
      });
      negotiation = policyApplied.negotiation;
      counterOfferPolicy = policyApplied.counterOfferPolicy;
      if (policyApplied.justExpired) {
        const latestExpiredProposal = getLatestMarketplaceBidProposal(negotiation);
        const expiredBid = {
          ...selectedBid,
          negotiation,
          counterOfferPolicy,
          updatedAt: nowAt
        };
        const expiredBids = allExistingBids.map((candidate) => {
          if (!candidate || typeof candidate !== "object") return candidate;
          if (String(candidate.bidId ?? "") !== bidId) return candidate;
          return expiredBid;
        });
        const expiredRfq = {
          ...rfq,
          updatedAt: nowAt
        };
        await commitTx([
          { kind: "MARKETPLACE_RFQ_UPSERT", tenantId, rfq: expiredRfq },
          { kind: "MARKETPLACE_RFQ_BIDS_SET", tenantId, rfqId, bids: expiredBids }
        ]);
        try {
          await emitMarketplaceLifecycleArtifact({
            tenantId,
            eventType: "proposal.expired",
            rfqId: rfqId,
            sourceEventId: latestExpiredProposal?.proposalId ?? null,
            actorAgentId: proposerAgentId,
            details: {
              bidId,
              expiresAt: policyApplied.expiresAt ?? null,
              negotiation
            }
          });
        } catch {
          // Best-effort lifecycle delivery.
        }
        return sendError(res, 409, "marketplace bid negotiation expired", {
          expiresAt: policyApplied.expiresAt ?? null
        });
      }
      const negotiationState = String(negotiation?.state ?? "open").toLowerCase();
      if (negotiationState === "expired") {
        return sendError(res, 409, "marketplace bid negotiation expired", {
          expiresAt: policyApplied.expiresAt ?? negotiation?.expiresAt ?? null
        });
      }
      if (negotiationState !== "open") {
        return sendError(res, 409, "marketplace bid negotiation is not open");
      }
      const latestProposal = getLatestMarketplaceBidProposal(negotiation);
      if (!latestProposal) return sendError(res, 409, "marketplace bid negotiation has no baseline proposal");

      const hasAmountCents = Object.prototype.hasOwnProperty.call(body, "amountCents");
      const hasCurrency = Object.prototype.hasOwnProperty.call(body, "currency");
      const hasEtaSeconds = Object.prototype.hasOwnProperty.call(body, "etaSeconds");
      const hasNote = Object.prototype.hasOwnProperty.call(body, "note");
      const hasVerificationMethod = Object.prototype.hasOwnProperty.call(body, "verificationMethod");
      const hasPolicy = Object.prototype.hasOwnProperty.call(body, "policy");
      const hasPolicyRef = Object.prototype.hasOwnProperty.call(body, "policyRef");
      const hasMetadata = Object.prototype.hasOwnProperty.call(body, "metadata");
      if (!hasAmountCents && !hasCurrency && !hasEtaSeconds && !hasNote && !hasVerificationMethod && !hasPolicy && !hasPolicyRef && !hasMetadata) {
        return sendError(res, 400, "counter-offer must include at least one mutable field");
      }

      const latestRevision = Number(negotiation?.latestRevision);
      const nextRevision = Number.isSafeInteger(latestRevision) && latestRevision > 0 ? latestRevision + 1 : 2;
      if (nextRevision > Number(counterOfferPolicy?.maxRevisions ?? 0)) {
        return sendError(res, 409, "counter-offer max revisions reached", {
          maxRevisions: counterOfferPolicy?.maxRevisions ?? null,
          latestRevision
        });
      }

      let policySelection = null;
      try {
        policySelection = resolveMarketplaceSettlementPolicySelection({
          tenantId,
          policyRefInput: hasPolicyRef ? body?.policyRef ?? null : latestProposal?.policyRef ?? null,
          verificationMethodInput: hasVerificationMethod ? body?.verificationMethod : latestProposal?.verificationMethod,
          settlementPolicyInput: hasPolicy ? body?.policy : latestProposal?.policy
        });
      } catch (err) {
        if (err?.code === "TENANT_SETTLEMENT_POLICY_NOT_FOUND") {
          return sendError(res, 404, "policyRef not found");
        }
        if (err?.code === "TENANT_SETTLEMENT_POLICY_REF_MISMATCH") {
          return sendError(res, 409, "policyRef does not match verificationMethod/policy", { message: err?.message });
        }
        if (err?.code === "INVALID_VERIFICATION_METHOD") {
          return sendError(res, 400, "invalid verificationMethod", { message: err?.message });
        }
        if (err?.code === "INVALID_SETTLEMENT_POLICY") {
          return sendError(res, 400, "invalid policy", { message: err?.message });
        }
        return sendError(res, 400, "invalid counter-offer policy selection", { message: err?.message });
      }

      let proposal = null;
      try {
        proposal = buildMarketplaceBidNegotiationProposal({
          rfq: rfq,
          bidId,
          revision: nextRevision,
          proposerAgentId,
          amountCents: hasAmountCents ? body?.amountCents : latestProposal?.amountCents,
          currency: hasCurrency ? body?.currency : latestProposal?.currency,
          etaSeconds: hasEtaSeconds ? body?.etaSeconds : latestProposal?.etaSeconds,
          note: hasNote ? body?.note : latestProposal?.note,
          verificationMethodInput: policySelection.verificationMethod,
          settlementPolicyInput: policySelection.policy,
          policyRefInput: policySelection.policyRef,
          prevProposalHashInput: deriveMarketplaceProposalHash(latestProposal),
          metadataInput: hasMetadata ? body?.metadata : latestProposal?.metadata,
          proposalIdInput: body?.proposalId ?? null,
          proposedAt: nowAt
        });
      } catch (err) {
        return sendError(res, 400, "invalid counter-offer", { message: err?.message });
      }

      const nextNegotiation = appendMarketplaceBidNegotiationProposal({ negotiation, proposal, at: nowAt });
      const nextBid = {
        ...selectedBid,
        amountCents: proposal.amountCents,
        currency: proposal.currency,
        etaSeconds: proposal.etaSeconds ?? null,
        note: proposal.note ?? null,
        verificationMethod: proposal.verificationMethod,
        policy: proposal.policy,
        policyRef: proposal.policyRef ?? null,
        metadata: proposal.metadata ?? null,
        negotiation: nextNegotiation,
        counterOfferPolicy,
        updatedAt: nowAt
      };
      const nextBids = allExistingBids.map((candidate) => {
        if (!candidate || typeof candidate !== "object") return candidate;
        if (String(candidate.bidId ?? "") !== bidId) return candidate;
        return nextBid;
      });
      const nextRfq = {
        ...rfq,
        updatedAt: nowAt
      };

      const responseBody = {
        rfq: toMarketplaceRfqResponse(nextRfq),
        bid: toMarketplaceBidResponse(nextBid),
        negotiation: nextNegotiation,
        proposal
      };
      const ops = [
        { kind: "MARKETPLACE_RFQ_UPSERT", tenantId, rfq: nextRfq },
        { kind: "MARKETPLACE_RFQ_BIDS_SET", tenantId, rfqId, bids: nextBids }
      ];
      if (idemStoreKey) {
        ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody } });
      }
      await commitTx(ops);
      try {
        await emitMarketplaceLifecycleArtifact({
          tenantId,
          eventType: "proposal.submitted",
          rfqId: rfqId,
          sourceEventId: proposal?.proposalId ?? null,
          actorAgentId: proposerAgentId,
          details: {
            bidId,
            revision: proposal?.revision ?? null,
            proposal,
            negotiation: nextNegotiation
          }
        });
      } catch {
        // Best-effort lifecycle delivery.
      }
      try {
        await emitMarketplaceLifecycleArtifact({
          tenantId,
          eventType: "marketplace.bid.counter_offer_applied",
          rfqId: rfqId,
          sourceEventId: proposal?.proposalId ?? null,
          actorAgentId: proposerAgentId,
          details: {
            bidId,
            negotiation: nextNegotiation,
            proposal
          }
        });
      } catch {
        // Best-effort lifecycle delivery.
      }
      return sendJson(res, 200, responseBody);
    }

    if (req.method === "POST" && marketplaceParts.length === 4 && marketplaceParts[3] === "auto-accept") {
      const body = await readJsonBody(req);
      let idemStoreKey = null;
      let idemRequestHash = null;
      try {
        ({ idemStoreKey, idemRequestHash } = readIdempotency({ method: "POST", requestPath: path, expectedPrevChainHash: null, body }));
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

      try {
        const responseBody = await autoAcceptMarketplaceRfqBid({ body, idemStoreKey, idemRequestHash });
        return sendJson(res, 200, responseBody);
      } catch (err) {
        const statusCode = Number.isSafeInteger(Number(err?.statusCode)) ? Number(err.statusCode) : 400;
        return sendError(res, statusCode, err?.message ?? "marketplace auto-award failed", err?.details ?? null, {
          code: err?.code ?? null
        });
      }
    }

    if (req.method === "POST" && marketplaceParts.length === 4 && marketplaceParts[3] === "accept") {
      const body = await readJsonBody(req);
      let idemStoreKey = null;
      let idemRequestHash = null;
      try {
        ({ idemStoreKey, idemRequestHash } = readIdempotency({ method: "POST", requestPath: path, expectedPrevChainHash: null, body }));
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

      try {
        const responseBody = await acceptMarketplaceRfqBid({ body, idemStoreKey, idemRequestHash });
        return sendJson(res, 200, responseBody);
      } catch (err) {
        const statusCode = Number.isSafeInteger(Number(err?.statusCode)) ? Number(err.statusCode) : 400;
        return sendError(res, statusCode, err?.message ?? "marketplace bid accept failed", err?.details ?? null, {
          code: err?.code ?? null
        });
      }
    }

    return sendError(res, 404, "not found");
    }

    if (req.method === "GET" && path === "/marketplace/agents/search") {
    try {
      const result = await searchMarketplaceAgents({
        tenantId,
        capability: url.searchParams.get("capability"),
        status: url.searchParams.get("status"),
        minTrustScore: url.searchParams.get("minTrustScore"),
        riskTier: url.searchParams.get("riskTier"),
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 50,
        offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : 0,
        includeReputation:
          url.searchParams.get("includeReputation") === null
            ? true
            : ["1", "true", "yes", "on"].includes(String(url.searchParams.get("includeReputation")).trim().toLowerCase()),
        reputationVersion: url.searchParams.get("reputationVersion") ?? "v2",
        reputationWindow: url.searchParams.get("reputationWindow") ?? AGENT_REPUTATION_WINDOW.THIRTY_DAYS,
        asOf: url.searchParams.get("asOf"),
        scoreStrategy: url.searchParams.get("scoreStrategy") ?? "balanced"
      });
      return sendJson(res, 200, result);
    } catch (err) {
      return sendError(res, 400, "invalid marketplace search query", { message: err?.message });
    }
    }

    // Check if the response was sent by a route that uses bare "return;" (e.g. SSE streams).
    if (res.writableEnded || res.headersSent) return true;

    return false;
  };
}
