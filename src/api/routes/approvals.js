/**
 * Approval routes: /approval-requests/*, /approval-decisions/*, /approval-policies/*, /approval-inbox/*
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
export function createApprovalRoutes(deps) {
  const {
    store,
    sendJson,
    sendError,
    readJsonBody,
    createId,
    nowIso,
    commitTx,
    normalizeForCanonicalJson,
    validateAuthorityEnvelopeV1,
    buildApprovalRequestV1,
    normalizeApprovalDecisionInput,
    normalizeWorkOrderApprovalPolicyInput,
    getAuthorityEnvelopeRecord,
    listAuthorityEnvelopeRecords,
    getApprovalRequestRecord,
    listApprovalRequestRecords,
    getApprovalDecisionRecord,
    listApprovalDecisionRecords,
    getApprovalPolicyRecord,
    listApprovalPolicyRecords,
    upsertApprovalPolicyRecord,
    revokeApprovalPolicyRecord,
    listApprovalInboxItems,
    resolveApprovalInboxDecision,
    assertApprovalRecordsPersistable,
    buildApprovalPersistenceOps,
    resumeApprovalContinuation,
    requireProtocolHeaderForWrite,
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
  return async function handleApprovalRoutes(ctx) {
    const { req, res, method, path, url, tenantId, principalId, auth, readIdempotency, makeOpsAudit } = ctx;
    // Use wrapped versions that return true for "return sendJson/sendError(...)" pattern.
    const sendJson = _sendJson;
    const sendError = _sendError;

    const parts = path.split("/").filter(Boolean);
    const isApprovalRoute = parts[0] === "approval-requests" || parts[0] === "approval-decisions" ||
      parts[0] === "approval-policies" || parts[0] === "approval-inbox";
    if (!isApprovalRoute) return false;

      if (parts[0] === "approval-requests" && parts.length === 1 && req.method === "POST") {
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

        const rawAuthorityEnvelope =
          body?.authorityEnvelope && typeof body.authorityEnvelope === "object" && !Array.isArray(body.authorityEnvelope)
            ? body.authorityEnvelope
            : null;
        const envelopeId =
          typeof body?.envelopeId === "string" && body.envelopeId.trim() !== ""
            ? body.envelopeId.trim()
            : typeof body?.envelopeRef?.envelopeId === "string" && body.envelopeRef.envelopeId.trim() !== ""
              ? body.envelopeRef.envelopeId.trim()
              : null;

        let authorityEnvelope = null;
        if (rawAuthorityEnvelope) {
          try {
            validateAuthorityEnvelopeV1(rawAuthorityEnvelope);
            authorityEnvelope = normalizeForCanonicalJson(rawAuthorityEnvelope, { path: "$.authorityEnvelope" });
          } catch (err) {
            return sendError(res, 400, "invalid authority envelope", { message: err?.message }, { code: "SCHEMA_INVALID" });
          }
          if (envelopeId && envelopeId !== authorityEnvelope.envelopeId) {
            return sendError(
              res,
              409,
              "approval request envelopeId does not match authority envelope",
              { envelopeId, authorityEnvelopeId: authorityEnvelope.envelopeId },
              { code: "APPROVAL_REQUEST_ENVELOPE_ID_MISMATCH" }
            );
          }
        } else if (envelopeId) {
          authorityEnvelope = await getAuthorityEnvelopeRecord({ tenantId, envelopeId });
          if (!authorityEnvelope) return sendError(res, 404, "authority envelope not found", null, { code: "NOT_FOUND" });
        } else {
          return sendError(res, 400, "authorityEnvelope or envelopeId is required", null, { code: "SCHEMA_INVALID" });
        }
        const existingEnvelope = await getAuthorityEnvelopeRecord({ tenantId, envelopeId: authorityEnvelope.envelopeId });
        if (existingEnvelope && String(existingEnvelope.envelopeHash ?? "") !== String(authorityEnvelope.envelopeHash ?? "")) {
          return sendError(
            res,
            409,
            "authority envelope already exists with different hash",
            {
              envelopeId: authorityEnvelope.envelopeId,
              existingEnvelopeHash: existingEnvelope.envelopeHash ?? null,
              providedEnvelopeHash: authorityEnvelope.envelopeHash ?? null
            },
            { code: "AUTHORITY_ENVELOPE_HASH_MISMATCH" }
          );
        }

        let approvalRequest = null;
        try {
          approvalRequest = buildApprovalRequestV1({
            authorityEnvelope,
            requestedBy:
              typeof body?.requestedBy === "string" && body.requestedBy.trim() !== ""
                ? body.requestedBy.trim()
                : authorityEnvelope?.principalRef?.principalId ?? authorityEnvelope?.actor?.agentId,
            requestedAt:
              typeof body?.requestedAt === "string" && body.requestedAt.trim() !== "" ? body.requestedAt.trim() : nowIso(),
            actionId:
              typeof body?.actionId === "string" && body.actionId.trim() !== ""
                ? body.actionId.trim()
                : undefined,
            actionSha256:
              typeof body?.actionSha256 === "string" && body.actionSha256.trim() !== ""
                ? body.actionSha256.trim().toLowerCase()
                : undefined,
            approvalPolicy:
              body?.approvalPolicy && typeof body.approvalPolicy === "object" && !Array.isArray(body.approvalPolicy)
                ? normalizeWorkOrderApprovalPolicyInput(body.approvalPolicy)
                : null
          });
          validateApprovalRequestV1(approvalRequest);
        } catch (err) {
          return sendError(res, 400, "invalid approval request", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }

        const existingRequest = await getApprovalRequestRecord({ tenantId, requestId: approvalRequest.requestId });
        if (existingRequest && String(existingRequest.requestHash ?? "") !== String(approvalRequest.requestHash ?? "")) {
          return sendError(
            res,
            409,
            "approval request already exists with different hash",
            {
              requestId: approvalRequest.requestId,
              existingRequestHash: existingRequest.requestHash ?? null,
              providedRequestHash: approvalRequest.requestHash ?? null
            },
            { code: "APPROVAL_REQUEST_HASH_MISMATCH" }
          );
        }

        const responseBody = { ok: true, authorityEnvelope, approvalRequest };
        const statusCode = existingRequest ? 200 : 201;
        const ops = buildApprovalPersistenceOps({ tenantId, authorityEnvelope, approvalRequest });
        if (idemStoreKey) {
          ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode, body: responseBody } });
        }
        await commitTx(ops);
        return sendJson(res, statusCode, responseBody);
      }

      if (parts[0] === "approval-requests" && parts.length === 1 && req.method === "GET") {
        const requestId = url.searchParams.get("requestId");
        const envelopeId = url.searchParams.get("envelopeId");
        const envelopeHash = url.searchParams.get("envelopeHash");
        const requestedBy = url.searchParams.get("requestedBy");
        const limitRaw = url.searchParams.get("limit");
        const offsetRaw = url.searchParams.get("offset");
        const limit = limitRaw === null || limitRaw === "" ? 200 : Number(limitRaw);
        const offset = offsetRaw === null || offsetRaw === "" ? 0 : Number(offsetRaw);
        if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 2000) {
          return sendError(res, 400, "invalid list query", { message: "limit must be an integer in range 1..2000" }, { code: "SCHEMA_INVALID" });
        }
        if (!Number.isSafeInteger(offset) || offset < 0) {
          return sendError(res, 400, "invalid list query", { message: "offset must be a non-negative integer" }, { code: "SCHEMA_INVALID" });
        }
        let requests = [];
        try {
          requests = await listApprovalRequestRecords({
            tenantId,
            requestId: requestId && requestId.trim() !== "" ? requestId.trim() : null,
            envelopeId: envelopeId && envelopeId.trim() !== "" ? envelopeId.trim() : null,
            envelopeHash: envelopeHash && envelopeHash.trim() !== "" ? envelopeHash.trim() : null,
            requestedBy: requestedBy && requestedBy.trim() !== "" ? requestedBy.trim() : null,
            limit,
            offset
          });
        } catch (err) {
          return sendError(res, 400, "invalid approval request query", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }
        return sendJson(res, 200, { ok: true, approvalRequests: requests, limit, offset });
      }

      if (parts[0] === "approval-requests" && parts[1] && parts.length === 2 && req.method === "GET") {
        const requestId = parts[1];
        const approvalRequest = await getApprovalRequestRecord({ tenantId, requestId });
        if (!approvalRequest) return sendError(res, 404, "approval request not found", null, { code: "NOT_FOUND" });
        return sendJson(res, 200, { ok: true, approvalRequest });
      }

      if (parts[0] === "approval-decisions" && parts.length === 1 && req.method === "POST") {
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

        const requestId =
          typeof body?.requestId === "string" && body.requestId.trim() !== ""
            ? body.requestId.trim()
            : typeof body?.approvalDecision?.requestId === "string" && body.approvalDecision.requestId.trim() !== ""
              ? body.approvalDecision.requestId.trim()
              : null;
        if (!requestId) return sendError(res, 400, "requestId is required", null, { code: "SCHEMA_INVALID" });

        const approvalRequest = await getApprovalRequestRecord({ tenantId, requestId });
        if (!approvalRequest) return sendError(res, 404, "approval request not found", null, { code: "NOT_FOUND" });
        const authorityEnvelope = await getAuthorityEnvelopeRecord({
          tenantId,
          envelopeId: approvalRequest?.envelopeRef?.envelopeId ?? null
        });
        if (!authorityEnvelope) {
          return sendError(
            res,
            409,
            "approval request is missing authority envelope",
            { requestId, envelopeId: approvalRequest?.envelopeRef?.envelopeId ?? null },
            { code: "APPROVAL_REQUEST_ENVELOPE_NOT_FOUND" }
          );
        }

        const rawApprovalDecision =
          body?.approvalDecision ??
          body?.humanApprovalDecision ??
          (body && typeof body === "object" && !Array.isArray(body) ? body : null);
        let approvalDecision = null;
        try {
          approvalDecision = normalizeApprovalDecisionInput({
            rawApprovalDecision,
            approvalRequest,
            authorityEnvelope,
            errorCodePrefix: "APPROVAL"
          });
        } catch (err) {
          return sendError(
            res,
            err?.statusCode ?? 409,
            err?.statusCode === 400 ? "invalid approval decision" : "approval decision blocked",
            err?.details ?? { message: err?.message ?? null },
            { code: err?.code ?? (err?.statusCode === 400 ? "SCHEMA_INVALID" : "APPROVAL_DECISION_INVALID") }
          );
        }

        const existingDecision = await getApprovalDecisionRecord({ tenantId, decisionId: approvalDecision.decisionId });
        if (existingDecision && String(existingDecision.decisionHash ?? "") !== String(approvalDecision.decisionHash ?? "")) {
          return sendError(
            res,
            409,
            "approval decision already exists with different hash",
            {
              decisionId: approvalDecision.decisionId,
              existingDecisionHash: existingDecision.decisionHash ?? null,
              providedDecisionHash: approvalDecision.decisionHash ?? null
            },
            { code: "APPROVAL_DECISION_HASH_MISMATCH" }
          );
        }

        const responseBody = { ok: true, authorityEnvelope, approvalRequest, approvalDecision };
        const statusCode = existingDecision ? 200 : 201;
        const ops = buildApprovalPersistenceOps({ tenantId, approvalDecision });
        if (idemStoreKey) {
          ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode, body: responseBody } });
        }
        await commitTx(ops);
        return sendJson(res, statusCode, responseBody);
      }

      if (parts[0] === "approval-decisions" && parts.length === 1 && req.method === "GET") {
        const decisionId = url.searchParams.get("decisionId");
        const requestId = url.searchParams.get("requestId");
        const decidedBy = url.searchParams.get("decidedBy");
        const approvedRaw = url.searchParams.get("approved");
        const limitRaw = url.searchParams.get("limit");
        const offsetRaw = url.searchParams.get("offset");
        const limit = limitRaw === null || limitRaw === "" ? 200 : Number(limitRaw);
        const offset = offsetRaw === null || offsetRaw === "" ? 0 : Number(offsetRaw);
        if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 2000) {
          return sendError(res, 400, "invalid list query", { message: "limit must be an integer in range 1..2000" }, { code: "SCHEMA_INVALID" });
        }
        if (!Number.isSafeInteger(offset) || offset < 0) {
          return sendError(res, 400, "invalid list query", { message: "offset must be a non-negative integer" }, { code: "SCHEMA_INVALID" });
        }
        let approved = null;
        if (approvedRaw !== null && approvedRaw !== undefined && String(approvedRaw).trim() !== "") {
          const normalizedApproved = String(approvedRaw).trim().toLowerCase();
          if (["true", "1", "yes", "on"].includes(normalizedApproved)) approved = true;
          else if (["false", "0", "no", "off"].includes(normalizedApproved)) approved = false;
          else return sendError(res, 400, "invalid approval decision query", { message: "approved must be boolean-like" }, { code: "SCHEMA_INVALID" });
        }
        let decisions = [];
        try {
          decisions = await listApprovalDecisionRecords({
            tenantId,
            decisionId: decisionId && decisionId.trim() !== "" ? decisionId.trim() : null,
            requestId: requestId && requestId.trim() !== "" ? requestId.trim() : null,
            decidedBy: decidedBy && decidedBy.trim() !== "" ? decidedBy.trim() : null,
            approved,
            limit,
            offset
          });
        } catch (err) {
          return sendError(res, 400, "invalid approval decision query", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }
        return sendJson(res, 200, { ok: true, approvalDecisions: decisions, limit, offset });
      }

      if (parts[0] === "approval-decisions" && parts[1] && parts.length === 2 && req.method === "GET") {
        const decisionId = parts[1];
        const approvalDecision = await getApprovalDecisionRecord({ tenantId, decisionId });
        if (!approvalDecision) return sendError(res, 404, "approval decision not found", null, { code: "NOT_FOUND" });
        return sendJson(res, 200, { ok: true, approvalDecision });
      }

      if (parts[0] === "approval-policies" && parts.length === 1 && req.method === "POST") {
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

        const rawPolicy =
          body?.approvalStandingPolicy && typeof body.approvalStandingPolicy === "object" && !Array.isArray(body.approvalStandingPolicy)
            ? body.approvalStandingPolicy
            : body && typeof body === "object" && !Array.isArray(body)
              ? body
              : null;
        if (!rawPolicy) {
          return sendError(res, 400, "approvalStandingPolicy is required", null, { code: "SCHEMA_INVALID" });
        }

        const nowAt = nowIso();
        let approvalStandingPolicy = null;
        try {
          if (rawPolicy.schemaVersion === APPROVAL_STANDING_POLICY_SCHEMA_VERSION) {
            validateApprovalStandingPolicyV1(rawPolicy);
            approvalStandingPolicy = normalizeForCanonicalJson(rawPolicy, { path: "$.approvalStandingPolicy" });
          } else {
            const requestedPolicyId =
              typeof rawPolicy.policyId === "string" && rawPolicy.policyId.trim() !== ""
                ? rawPolicy.policyId.trim()
                : createId("apol");
            const existingPolicy = await getApprovalStandingPolicyRecord({ tenantId, policyId: requestedPolicyId });
            approvalStandingPolicy = buildApprovalStandingPolicyV1({
              policyId: requestedPolicyId,
              principalRef: rawPolicy.principalRef,
              displayName: rawPolicy.displayName,
              description: rawPolicy.description ?? null,
              status: rawPolicy.status ?? APPROVAL_STANDING_POLICY_STATUS.ACTIVE,
              constraints: rawPolicy.constraints ?? null,
              decision: rawPolicy.decision,
              createdAt: existingPolicy?.createdAt ?? nowAt,
              updatedAt: existingPolicy ? nowAt : null
            });
          }
        } catch (err) {
          return sendError(res, 400, "invalid approval standing policy", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }

        const existingPolicy = await getApprovalStandingPolicyRecord({ tenantId, policyId: approvalStandingPolicy.policyId });
        const responseBody = { ok: true, approvalStandingPolicy };
        const statusCode = existingPolicy ? 200 : 201;
        const ops = [
          {
            kind: "APPROVAL_STANDING_POLICY_UPSERT",
            tenantId,
            policyId: approvalStandingPolicy.policyId,
            approvalStandingPolicy
          }
        ];
        if (idemStoreKey) {
          ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode, body: responseBody } });
        }
        await commitTx(ops);
        return sendJson(res, statusCode, responseBody);
      }

      if (parts[0] === "approval-policies" && parts.length === 1 && req.method === "GET") {
        const policyId = url.searchParams.get("policyId");
        const principalId = url.searchParams.get("principalId");
        const principalType = url.searchParams.get("principalType");
        const status = url.searchParams.get("status");
        const limitRaw = url.searchParams.get("limit");
        const offsetRaw = url.searchParams.get("offset");
        const limit = limitRaw === null || limitRaw === "" ? 200 : Number(limitRaw);
        const offset = offsetRaw === null || offsetRaw === "" ? 0 : Number(offsetRaw);
        if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 2000) {
          return sendError(res, 400, "invalid list query", { message: "limit must be an integer in range 1..2000" }, { code: "SCHEMA_INVALID" });
        }
        if (!Number.isSafeInteger(offset) || offset < 0) {
          return sendError(res, 400, "invalid list query", { message: "offset must be a non-negative integer" }, { code: "SCHEMA_INVALID" });
        }
        let approvalStandingPolicies = [];
        try {
          approvalStandingPolicies = await listApprovalStandingPolicyRecords({
            tenantId,
            policyId: policyId && policyId.trim() !== "" ? policyId.trim() : null,
            principalId: principalId && principalId.trim() !== "" ? principalId.trim() : null,
            principalType: principalType && principalType.trim() !== "" ? principalType.trim() : null,
            status: status && status.trim() !== "" ? status.trim() : null,
            limit,
            offset
          });
        } catch (err) {
          return sendError(res, 400, "invalid approval standing policy query", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }
        return sendJson(res, 200, { ok: true, approvalStandingPolicies, limit, offset });
      }

      if (parts[0] === "approval-policies" && parts[1] && parts.length === 2 && req.method === "GET") {
        const policyId = parts[1];
        const approvalStandingPolicy = await getApprovalStandingPolicyRecord({ tenantId, policyId });
        if (!approvalStandingPolicy) return sendError(res, 404, "approval standing policy not found", null, { code: "NOT_FOUND" });
        return sendJson(res, 200, { ok: true, approvalStandingPolicy });
      }

      if (parts[0] === "approval-policies" && parts[1] && parts[2] === "revoke" && parts.length === 3 && req.method === "POST") {
        if (!requireProtocolHeaderForWrite(req, res)) return;

        const policyId = decodePathPart(parts[1]);
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

        const currentPolicy = await getApprovalStandingPolicyRecord({ tenantId, policyId });
        if (!currentPolicy) {
          return sendError(res, 404, "approval standing policy not found", null, { code: "NOT_FOUND" });
        }
        const currentStatus = typeof currentPolicy.status === "string" ? currentPolicy.status.trim().toLowerCase() : APPROVAL_STANDING_POLICY_STATUS.ACTIVE;
        if (currentStatus === APPROVAL_STANDING_POLICY_STATUS.DISABLED) {
          const responseBody = { ok: true, approvalStandingPolicy: currentPolicy };
          const ops = [];
          if (idemStoreKey) {
            ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody } });
          }
          if (ops.length > 0) await commitTx(ops);
          return sendJson(res, 200, responseBody);
        }

        const nowAt = nowIso();
        const approvalStandingPolicy = buildApprovalStandingPolicyV1({
          policyId: currentPolicy.policyId,
          principalRef: currentPolicy.principalRef,
          displayName: currentPolicy.displayName,
          description: currentPolicy.description ?? null,
          status: APPROVAL_STANDING_POLICY_STATUS.DISABLED,
          constraints: currentPolicy.constraints ?? null,
          decision: currentPolicy.decision,
          createdAt: currentPolicy.createdAt,
          updatedAt: nowAt
        });
        const responseBody = { ok: true, approvalStandingPolicy };
        const ops = [
          {
            kind: "APPROVAL_STANDING_POLICY_UPSERT",
            tenantId,
            policyId,
            approvalStandingPolicy
          }
        ];
        if (idemStoreKey) {
          ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody } });
        }
        await commitTx(ops, {
          audit: makeOpsAudit({
            action: "APPROVAL_STANDING_POLICY_REVOKE",
            targetType: "approval_policy",
            targetId: policyId,
            details: {
              policyId,
              reasonCode:
                typeof body?.reasonCode === "string" && body.reasonCode.trim() !== ""
                  ? body.reasonCode.trim()
                  : "user_revoked"
            }
          })
        });
        return sendJson(res, 200, responseBody);
      }

      if (parts[0] === "approval-inbox" && parts.length === 1 && req.method === "GET") {
        const statusRaw = url.searchParams.get("status");
        const principalId = url.searchParams.get("principalId");
        const requestedBy = url.searchParams.get("requestedBy");
        const limitRaw = url.searchParams.get("limit");
        const offsetRaw = url.searchParams.get("offset");
        const normalizedStatus =
          statusRaw === null || statusRaw === undefined || String(statusRaw).trim() === ""
            ? "pending"
            : String(statusRaw).trim().toLowerCase();
        if (!["pending", "decided", "all"].includes(normalizedStatus)) {
          return sendError(res, 400, "invalid approval inbox query", { message: "status must be pending|decided|all" }, { code: "SCHEMA_INVALID" });
        }
        const limit = limitRaw === null || limitRaw === "" ? 200 : Number(limitRaw);
        const offset = offsetRaw === null || offsetRaw === "" ? 0 : Number(offsetRaw);
        if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 2000) {
          return sendError(res, 400, "invalid approval inbox query", { message: "limit must be an integer in range 1..2000" }, { code: "SCHEMA_INVALID" });
        }
        if (!Number.isSafeInteger(offset) || offset < 0) {
          return sendError(res, 400, "invalid approval inbox query", { message: "offset must be a non-negative integer" }, { code: "SCHEMA_INVALID" });
        }
      const items = await buildApprovalInboxItems({
          tenantId,
          status: normalizedStatus,
          principalId: principalId && principalId.trim() !== "" ? principalId.trim() : null,
          requestedBy: requestedBy && requestedBy.trim() !== "" ? requestedBy.trim() : null,
          limit,
          offset
        });
        return sendJson(res, 200, { ok: true, items, limit, offset });
      }

      if (parts[0] === "disputes" && parts.length === 1 && req.method === "GET") {
        let filters = null;
        try {
          filters = parseDisputeInboxQuery(url);
        } catch (err) {
          return sendError(res, 400, "invalid dispute inbox query", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }

        let items = [];
        try {
          items = await listDisputeInboxItems({ tenantId, ...filters });
        } catch (err) {
          return sendError(res, 501, "dispute inbox not supported for this store", { message: err?.message });
        }

        return sendJson(res, 200, {
          ok: true,
          tenantId,
          filters: {
            runId: filters.runId,
            disputeId: filters.disputeId,
            disputeStatus: filters.disputeStatus,
            settlementStatus: filters.settlementStatus
          },
          count: items.length,
          limit: filters.limit,
          offset: filters.offset,
          items
        });
      }

      if (parts[0] === "disputes" && parts[1] && parts.length === 2 && req.method === "GET") {
        const disputeId = String(parts[1] ?? "").trim();
        const caseId = String(url.searchParams.get("caseId") ?? "").trim() || null;
        let detail = null;
        try {
          detail = await buildDisputeDetailRecord({ tenantId, disputeId, caseId });
        } catch (err) {
          return sendError(res, 501, "dispute detail not supported for this store", { message: err?.message });
        }
        if (!detail) return sendError(res, 404, "dispute not found", null, { code: "NOT_FOUND" });
        if (caseId && !detail.arbitrationCase) {
          return sendError(res, 404, "dispute case not found", { disputeId, caseId }, { code: "NOT_FOUND" });
        }
        return sendJson(res, 200, { ok: true, tenantId, detail });
      }

      if (parts[0] === "approval-inbox" && parts[1] && parts[2] === "decide" && parts.length === 3 && req.method === "POST") {
        if (!requireProtocolHeaderForWrite(req, res)) return;

        const requestId = parts[1];
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

        const approvalRequest = await getApprovalRequestRecord({ tenantId, requestId });
        if (!approvalRequest) return sendError(res, 404, "approval request not found", null, { code: "NOT_FOUND" });
        const authorityEnvelope = await getAuthorityEnvelopeRecord({
          tenantId,
          envelopeId: approvalRequest?.envelopeRef?.envelopeId ?? null
        });
        const currentContinuation = await getApprovalContinuationRecord({ tenantId, requestId });
        if (!authorityEnvelope) {
          return sendError(
            res,
            409,
            "approval request is missing authority envelope",
            { requestId, envelopeId: approvalRequest?.envelopeRef?.envelopeId ?? null },
            { code: "APPROVAL_REQUEST_ENVELOPE_NOT_FOUND" }
          );
        }

        const existingDecisions = await listApprovalDecisionRecords({ tenantId, requestId, limit: 200, offset: 0 });
        const currentDecision = selectLatestApprovalDecision(existingDecisions);
        const nowAt = nowIso();
        const currentApprovalState = buildActionWalletApprovalStatus({
          approvalRequest,
          approvalDecision: currentDecision,
          nowAt
        });
        let approvalDecision = null;
        try {
          approvalDecision = buildApprovalDecisionFromInboxInput({
            requestId,
            authorityEnvelope,
            approvalRequest,
            approvalContinuation: currentContinuation,
            body,
            nowAt,
            principalId
          });
        } catch (err) {
          return sendError(
            res,
            err?.statusCode ?? 400,
            "invalid approval inbox decision",
            err?.details ?? { message: err?.message ?? null },
            { code: err?.code ?? "SCHEMA_INVALID" }
          );
        }
        const nextApprovalState =
          approvalDecision.approved === true
            ? ACTION_WALLET_APPROVAL_STATE.APPROVED
            : ACTION_WALLET_APPROVAL_STATE.DENIED;

        let approvalContinuation = currentContinuation;
        if (currentContinuation) {
          const nextStatus =
            currentContinuation.status === APPROVAL_CONTINUATION_STATUS.RESUMED
              ? APPROVAL_CONTINUATION_STATUS.RESUMED
              : approvalDecision.approved === true
                ? APPROVAL_CONTINUATION_STATUS.APPROVED
                : APPROVAL_CONTINUATION_STATUS.DENIED;
          const decisionRef = buildApprovalContinuationDecisionRef(approvalDecision);
          if (
            String(currentContinuation.status ?? "") !== nextStatus ||
            String(currentContinuation?.decisionRef?.decisionHash ?? "") !== String(decisionRef?.decisionHash ?? "")
          ) {
            approvalContinuation = patchApprovalContinuationV1(currentContinuation, {
              status: nextStatus,
              decisionRef,
              updatedAt: approvalDecision.decidedAt
            });
          }
        }

        if (currentDecision && String(currentDecision.decisionHash ?? "") !== String(approvalDecision.decisionHash ?? "")) {
          return sendError(
            res,
            409,
            "approval request already has a different decision",
            {
              requestId,
              existingDecisionId: currentDecision.decisionId ?? null,
              existingDecisionHash: currentDecision.decisionHash ?? null,
              providedDecisionId: approvalDecision.decisionId,
              providedDecisionHash: approvalDecision.decisionHash
            },
            { code: "APPROVAL_REQUEST_ALREADY_DECIDED" }
          );
        }
        if (!currentDecision) {
          try {
            transitionActionWalletApprovalState({
              state: currentApprovalState,
              nextState: nextApprovalState,
              requestId
            });
          } catch (err) {
            return sendActionWalletApprovalTransitionError(res, err, {
              requestId,
              nextState: nextApprovalState
            });
          }
        }
        try {
          await assertApprovalRecordsPersistable({ tenantId, approvalDecision, approvalContinuation });
        } catch (err) {
          return sendError(
            res,
            err?.statusCode ?? 409,
            "approval inbox persistence blocked",
            err?.details ?? { message: err?.message ?? null },
            { code: err?.code ?? "APPROVAL_RECORD_PERSISTENCE_BLOCKED" }
          );
        }

        const responseBody = { ok: true, authorityEnvelope, approvalRequest, approvalDecision, approvalContinuation };
        const statusCode = currentDecision ? 200 : 201;
        const ops = buildApprovalPersistenceOps({ tenantId, approvalDecision, approvalContinuation });
        if (idemStoreKey) {
          ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode, body: responseBody } });
        }
        await commitTx(ops);
        return sendJson(res, statusCode, responseBody);
      }

    // Check if the response was sent by a route that uses bare "return;" (e.g. SSE streams).
    if (res.writableEnded || res.headersSent) return true;

    return false;
  };
}
