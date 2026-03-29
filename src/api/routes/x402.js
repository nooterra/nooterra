/**
 * X402 payment routes: /x402/receipts, /x402/zk, /x402/wallets, /x402/gate, /x402/webhooks, etc.
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
export function createX402Routes(deps) {
  const {
    store,
    sendJson,
    sendError,
    readJsonBody,
    createId,
    nowIso,
    commitTx,
    normalizeForCanonicalJson,
    canonicalJsonStringify,
    sha256Hex,
    signHashHexEd25519,
    verifyHashHexEd25519,
    keyIdFromPublicKeyPem,
    serverSigner,
    parseX402ReceiptListQuery,
    getAgentWallet,
    listAgentWallets,
    upsertAgentWallet,
    resolveAgentWalletAssignment,
    resolveX402GateAuthorizePayment,
    resolveX402GateVerify,
    resolveX402GateReversal,
    resolveX402GateQuote,
    resolveX402GateCreate,
    buildX402GateReceiptV1,
    verifyX402ReceiptV1,
    normalizeX402WalletPolicyInput,
    normalizeX402WebhookEndpointInput,
    getX402Gate,
    listX402Gates,
    upsertX402Gate,
    listX402WebhookEndpoints,
    getX402WebhookEndpoint,
    upsertX402WebhookEndpoint,
    deleteX402WebhookEndpoint,
    listX402GateEscalations,
    getX402GateEscalation,
    resolveX402GateEscalationAction,
    getAgentLifecycleRecord,
    upsertAgentLifecycleRecord,
    resolveAgentWindDown,
    releaseAgentWalletEscrowToPayee,
    getAgentRunSettlementRecord,
    resolveAgentRunSettlement,
    AGENT_RUN_SETTLEMENT_STATUS,
    AGENT_RUN_SETTLEMENT_DECISION_STATUS,
    AGENT_RUN_SETTLEMENT_DECISION_MODE,
    enforceMarketplaceParticipantLifecycleGuards,
    listX402ReversalEvents,
    requireProtocolHeaderForWrite,
    requireScope,
    OPS_SCOPES,
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
  return async function handleX402Routes(ctx) {
    const { req, res, method, path, url, tenantId, principalId, auth, readIdempotency, makeOpsAudit, cloneJsonLike } = ctx;
    // Use wrapped versions that return true for "return sendJson/sendError(...)" pattern.
    const sendJson = _sendJson;
    const sendError = _sendError;

    const parts = path.split("/").filter(Boolean);
    if (parts[0] !== "x402") return false;

    if (parts[0] === "x402" && parts[1] === "receipts" && parts[2] === "export" && parts.length === 3 && req.method === "GET") {
      if (typeof store.listX402Receipts !== "function") return sendError(res, 501, "x402 receipts are not supported for this store");
      let query;
      try {
        query = parseX402ReceiptListQuery(url);
      } catch (err) {
        return sendError(res, 400, "invalid receipt export query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const baseRows = await store.listX402Receipts({
        tenantId,
        agentId: query.agentId,
        sponsorId: query.sponsorId,
        sponsorWalletRef: query.sponsorWalletRef,
        toolId: query.toolId,
        state: query.state,
        from: query.from,
        to: query.to,
        limit: 50_000,
        offset: 0
      });
      const rows = (Array.isArray(baseRows) ? baseRows : []).filter((row) => matchX402ReceiptQuery(row, query));
      const ndjson = rows.map((row) => JSON.stringify(row)).join("\n");
      res.statusCode = 200;
      res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(ndjson ? `${ndjson}\n` : "");
      return;
    }

    if (parts[0] === "x402" && parts[1] === "receipts" && parts[2] && parts.length === 3 && req.method === "GET") {
      if (typeof store.getX402Receipt !== "function") return sendError(res, 501, "x402 receipts are not supported for this store");
      const receiptId = parts[2];
      const receipt = await store.getX402Receipt({ tenantId, receiptId });
      if (!receipt) return sendError(res, 404, "receipt not found", null, { code: "NOT_FOUND" });
      return sendJson(res, 200, { ok: true, receipt });
    }

    if (parts[0] === "x402" && parts[1] === "receipts" && parts.length === 2 && req.method === "GET") {
      if (typeof store.listX402Receipts !== "function") return sendError(res, 501, "x402 receipts are not supported for this store");
      let query;
      try {
        query = parseX402ReceiptListQuery(url);
      } catch (err) {
        return sendError(res, 400, "invalid receipt query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const hasDirectLookupFilters = Boolean(query.receiptId || query.runId || query.agreementId);
      if (!hasDirectLookupFilters && typeof store.listX402ReceiptsPage === "function") {
        const page = await store.listX402ReceiptsPage({
          tenantId,
          agentId: query.agentId,
          sponsorId: query.sponsorId,
          sponsorWalletRef: query.sponsorWalletRef,
          toolId: query.toolId,
          state: query.state,
          from: query.from,
          to: query.to,
          cursor: query.cursor,
          limit: query.limit,
          offset: query.offset
        });
        const receipts = Array.isArray(page?.receipts) ? page.receipts : [];
        return sendJson(res, 200, { receipts, limit: query.limit, offset: query.offset, nextCursor: page?.nextCursor ?? null });
      }
      const allRows = await store.listX402Receipts({
        tenantId,
        agentId: query.agentId,
        sponsorId: query.sponsorId,
        sponsorWalletRef: query.sponsorWalletRef,
        toolId: query.toolId,
        state: query.state,
        from: query.from,
        to: query.to,
        limit: 50_000,
        offset: 0
      });
      const filteredRows = (Array.isArray(allRows) ? allRows : []).filter((row) => matchX402ReceiptQuery(row, query));
      const receipts = filteredRows.slice(query.offset, query.offset + query.limit);
      return sendJson(res, 200, { receipts, limit: query.limit, offset: query.offset, nextCursor: null, total: filteredRows.length });
    }

    if (parts[0] === "x402" && parts[1] === "zk" && parts[2] === "verification-keys" && parts.length === 3 && req.method === "POST") {
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
        const existingIdem = store.idempotency.get(idemStoreKey);
        if (existingIdem) {
          if (existingIdem.requestHash !== idemRequestHash) {
            return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
          }
          return sendJson(res, existingIdem.statusCode, existingIdem.body);
        }
      }

      const rawVerificationKey =
        body?.verificationKey && typeof body.verificationKey === "object" && !Array.isArray(body.verificationKey) ? body.verificationKey : body ?? {};
      let existingRecord = null;
      try {
        const requestedId =
          rawVerificationKey?.verificationKeyId === null ||
          rawVerificationKey?.verificationKeyId === undefined ||
          String(rawVerificationKey.verificationKeyId).trim() === ""
            ? null
            : normalizeOptionalX402RefInput(rawVerificationKey.verificationKeyId, "verificationKey.verificationKeyId", {
                allowNull: false,
                max: 500
              });
        if (requestedId) {
          existingRecord = await getX402ZkVerificationKeyRecord({ tenantId, verificationKeyId: requestedId });
        }
      } catch (err) {
        return sendError(res, 400, "invalid x402 zk verification key id", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      let verificationKeyRecord = null;
      try {
        verificationKeyRecord = normalizeX402ZkVerificationKeyInput(rawVerificationKey, {
          fieldPath: "verificationKey",
          existing: existingRecord
        });
      } catch (err) {
        return sendError(res, 400, "invalid x402 zk verification key payload", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      try {
        if (typeof store.putX402ZkVerificationKey === "function") {
          await store.putX402ZkVerificationKey({ tenantId, verificationKey: verificationKeyRecord });
        } else {
          await store.commitTx({
            at: verificationKeyRecord.createdAt ?? nowIso(),
            ops: [
              {
                kind: "X402_ZK_VERIFICATION_KEY_PUT",
                tenantId,
                verificationKeyId: verificationKeyRecord.verificationKeyId,
                verificationKey: verificationKeyRecord
              }
            ]
          });
        }
      } catch (err) {
        if (err?.code === "X402_ZK_VERIFICATION_KEY_IMMUTABLE") {
          return sendError(
            res,
            409,
            "x402 zk verification key is immutable",
            { verificationKeyId: verificationKeyRecord.verificationKeyId },
            { code: "X402_ZK_VERIFICATION_KEY_IMMUTABLE" }
          );
        }
        throw err;
      }

      const created = existingRecord ? false : true;
      const responseBody = {
        ok: true,
        created,
        verificationKey: verificationKeyRecord
      };
      const statusCode = created ? 201 : 200;
      if (idemStoreKey) {
        await store.commitTx({
          at: nowIso(),
          ops: [{ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode, body: responseBody } }]
        });
      }
      return sendJson(res, statusCode, responseBody);
    }

    if (parts[0] === "x402" && parts[1] === "zk" && parts[2] === "verification-keys" && parts[3] && parts.length === 4 && req.method === "GET") {
      let verificationKeyId = null;
      try {
        verificationKeyId = normalizeOptionalX402RefInput(decodePathPart(parts[3]), "verificationKeyId", { allowNull: false, max: 500 });
      } catch (err) {
        return sendError(res, 400, "invalid verificationKeyId", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const verificationKey = await getX402ZkVerificationKeyRecord({ tenantId, verificationKeyId });
      if (!verificationKey) return sendError(res, 404, "x402 zk verification key not found", null, { code: "NOT_FOUND" });
      return sendJson(res, 200, { ok: true, verificationKey });
    }

    if (parts[0] === "x402" && parts[1] === "zk" && parts[2] === "verification-keys" && parts.length === 3 && req.method === "GET") {
      const protocolRaw = url.searchParams.get("protocol");
      const providerRefRaw = url.searchParams.get("providerRef");
      const limitRaw = url.searchParams.get("limit");
      const offsetRaw = url.searchParams.get("offset");
      const limit = limitRaw === null || limitRaw === "" ? 200 : Number(limitRaw);
      const offset = offsetRaw === null || offsetRaw === "" ? 0 : Number(offsetRaw);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) {
        return sendError(res, 400, "invalid list query", { message: "limit must be an integer in range 1..2000" }, { code: "SCHEMA_INVALID" });
      }
      if (!Number.isSafeInteger(offset) || offset < 0) {
        return sendError(res, 400, "invalid list query", { message: "offset must be a non-negative integer" }, { code: "SCHEMA_INVALID" });
      }
      let verificationKeys = [];
      try {
        verificationKeys = await listX402ZkVerificationKeyRecords({
          tenantId,
          protocol: protocolRaw,
          providerRef: providerRefRaw,
          limit,
          offset
        });
      } catch (err) {
        return sendError(res, 400, "invalid x402 zk verification key query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      return sendJson(res, 200, { ok: true, limit, offset, verificationKeys });
    }

    if (parts[0] === "x402" && parts[1] === "wallets" && parts.length === 2 && req.method === "POST") {
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
        const existingIdem = store.idempotency.get(idemStoreKey);
        if (existingIdem) {
          if (existingIdem.requestHash !== idemRequestHash) {
            return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
          }
          return sendJson(res, existingIdem.statusCode, existingIdem.body);
        }
      }

      let sponsorRef = null;
      let sponsorWalletRef = null;
      let policyRefInput = null;
      let policyVersionInput = null;
      let existingPolicy = null;
      try {
        sponsorRef = normalizeOptionalX402RefInput(body?.sponsorRef, "sponsorRef", { allowNull: false, max: 200 });
        sponsorWalletRef = normalizeOptionalX402RefInput(body?.sponsorWalletRef ?? createId("x402wallet"), "sponsorWalletRef", {
          allowNull: false,
          max: 200
        });
        const rawPolicy =
          body?.policy && typeof body.policy === "object" && !Array.isArray(body.policy) ? body.policy : body ?? {};
        policyRefInput = rawPolicy.policyRef ?? body?.policyRef ?? "default";
        policyVersionInput = rawPolicy.policyVersion ?? body?.policyVersion ?? 1;
        const normalizedPolicyRef = normalizeOptionalX402RefInput(policyRefInput, "policyRef", { allowNull: false, max: 200 });
        const normalizedPolicyVersion = normalizeOptionalX402PositiveSafeInt(policyVersionInput, "policyVersion", { allowNull: false });
        existingPolicy = await getX402WalletPolicyRecord({
          tenantId,
          sponsorWalletRef,
          policyRef: normalizedPolicyRef,
          policyVersion: normalizedPolicyVersion
        });
      } catch (err) {
        return sendError(res, 400, "invalid x402 wallet create request", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const policyInput =
        body?.policy && typeof body.policy === "object" && !Array.isArray(body.policy) ? body.policy : body ?? {};
      let policy = null;
      try {
        policy = normalizeX402WalletPolicyInput(
          {
            ...policyInput,
            sponsorRef,
            sponsorWalletRef,
            policyRef: policyRefInput,
            policyVersion: policyVersionInput
          },
          { fieldPath: "policy", existing: existingPolicy }
        );
      } catch (err) {
        return sendError(res, 400, "invalid x402 wallet policy", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      try {
        await assertX402WalletPolicyVerificationKeyRefExists({ tenantId, policy, fieldPath: "policy" });
      } catch (err) {
        return sendError(
          res,
          400,
          "invalid x402 wallet policy verification key reference",
          { message: err?.message, details: err?.details ?? null },
          { code: err?.code ?? "X402_INVALID_VERIFICATION_KEY_REF" }
        );
      }

      const existingWalletPolicies = await listX402WalletPolicyRecords({
        tenantId,
        sponsorWalletRef,
        limit: 1,
        offset: 0
      });
      const walletCreated = !Array.isArray(existingWalletPolicies) || existingWalletPolicies.length === 0;
      const responseBody = {
        ok: true,
        created: walletCreated,
        wallet: normalizeForCanonicalJson(
          {
            schemaVersion: "X402SponsorWallet.v1",
            sponsorRef: policy.sponsorRef ?? sponsorRef,
            sponsorWalletRef: policy.sponsorWalletRef,
            activePolicyRef: policy.policyRef,
            activePolicyVersion: policy.policyVersion,
            policyFingerprint: policy.policyFingerprint,
            createdAt: policy.createdAt,
            updatedAt: policy.updatedAt
          },
          { path: "$" }
        ),
        policy
      };
      const statusCode = walletCreated ? 201 : 200;
      const ops = [{ kind: "X402_WALLET_POLICY_UPSERT", tenantId, policy }];
      if (idemStoreKey) {
        ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode, body: responseBody } });
      }
      await commitTx(ops, {
        audit: makeOpsAudit({
          action: "X402_WALLET_ISSUER_CREATE",
          targetType: "x402_wallet",
          targetId: policy.sponsorWalletRef,
          details: {
            sponsorRef: policy.sponsorRef ?? null,
            policyRef: policy.policyRef,
            policyVersion: policy.policyVersion
          }
        })
      });
      return sendJson(res, statusCode, responseBody);
    }

    if (parts[0] === "x402" && parts[1] === "wallets" && parts.length === 2 && req.method === "GET") {
      const sponsorRefRaw = url.searchParams.get("sponsorRef");
      const statusRaw = url.searchParams.get("status");
      const limitRaw = url.searchParams.get("limit");
      const offsetRaw = url.searchParams.get("offset");
      let sponsorRef = null;
      let status = null;
      let limit = 200;
      let offset = 0;
      try {
        sponsorRef = normalizeOptionalX402RefInput(sponsorRefRaw, "sponsorRef", { allowNull: true, max: 200 });
        if (statusRaw !== null && statusRaw !== undefined && String(statusRaw).trim() !== "") {
          status = normalizeX402WalletPolicyStatusInput(statusRaw, { fieldPath: "status", allowNull: false });
        }
        if (limitRaw !== null && limitRaw !== undefined && String(limitRaw).trim() !== "") {
          limit = Number(limitRaw);
        }
        if (offsetRaw !== null && offsetRaw !== undefined && String(offsetRaw).trim() !== "") {
          offset = Number(offsetRaw);
        }
        if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1000) throw new TypeError("limit must be an integer 1..1000");
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new TypeError("offset must be an integer 0..100000");
      } catch (err) {
        return sendError(res, 400, "invalid x402 wallet query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const wallets = await listX402WalletSummaryRecords({ tenantId, sponsorRef, status, limit, offset });
      return sendJson(res, 200, {
        ok: true,
        schemaVersion: "X402WalletListResult.v1",
        wallets,
        limit,
        offset
      });
    }

    if (parts[0] === "x402" && parts[1] === "wallets" && parts[2] && parts[3] === "policy" && parts.length === 4 && req.method === "PUT") {
      if (!requireProtocolHeaderForWrite(req, res)) return;
      let sponsorWalletRef = null;
      try {
        sponsorWalletRef = normalizeOptionalX402RefInput(decodePathPart(parts[2]), "sponsorWalletRef", { allowNull: false, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid sponsorWalletRef", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const body = await readJsonBody(req);
      let idemStoreKey = null;
      let idemRequestHash = null;
      try {
        ({ idemStoreKey, idemRequestHash } = readIdempotency({ method: "PUT", requestPath: path, expectedPrevChainHash: null, body }));
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

      const policyInput =
        body?.policy && typeof body.policy === "object" && !Array.isArray(body.policy) ? body.policy : body ?? {};
      const policyRefInput = policyInput.policyRef ?? body?.policyRef ?? "default";
      const policyVersionInput = policyInput.policyVersion ?? body?.policyVersion ?? 1;
      let normalizedPolicyRef = null;
      let normalizedPolicyVersion = null;
      try {
        normalizedPolicyRef = normalizeOptionalX402RefInput(policyRefInput, "policyRef", { allowNull: false, max: 200 });
        normalizedPolicyVersion = normalizeOptionalX402PositiveSafeInt(policyVersionInput, "policyVersion", { allowNull: false });
      } catch (err) {
        return sendError(res, 400, "invalid wallet policy key", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const existingPolicy = await getX402WalletPolicyRecord({
        tenantId,
        sponsorWalletRef,
        policyRef: normalizedPolicyRef,
        policyVersion: normalizedPolicyVersion
      });
      const sponsorRef =
        normalizeOptionalX402RefInput(
          policyInput.sponsorRef ?? body?.sponsorRef ?? existingPolicy?.sponsorRef ?? null,
          "sponsorRef",
          { allowNull: false, max: 200 }
        );

      let policy = null;
      try {
        policy = normalizeX402WalletPolicyInput(
          {
            ...policyInput,
            sponsorRef,
            sponsorWalletRef,
            policyRef: normalizedPolicyRef,
            policyVersion: normalizedPolicyVersion
          },
          { fieldPath: "policy", existing: existingPolicy }
        );
      } catch (err) {
        return sendError(res, 400, "invalid x402 wallet policy", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      try {
        await assertX402WalletPolicyVerificationKeyRefExists({ tenantId, policy, fieldPath: "policy" });
      } catch (err) {
        return sendError(
          res,
          400,
          "invalid x402 wallet policy verification key reference",
          { message: err?.message, details: err?.details ?? null },
          { code: err?.code ?? "X402_INVALID_VERIFICATION_KEY_REF" }
        );
      }

      const responseBody = {
        ok: true,
        created: existingPolicy ? false : true,
        wallet: normalizeForCanonicalJson(
          {
            schemaVersion: "X402SponsorWallet.v1",
            sponsorRef: policy.sponsorRef ?? sponsorRef,
            sponsorWalletRef: policy.sponsorWalletRef,
            activePolicyRef: policy.policyRef,
            activePolicyVersion: policy.policyVersion,
            policyFingerprint: policy.policyFingerprint,
            createdAt: policy.createdAt,
            updatedAt: policy.updatedAt
          },
          { path: "$" }
        ),
        policy
      };
      const statusCode = existingPolicy ? 200 : 201;
      const ops = [{ kind: "X402_WALLET_POLICY_UPSERT", tenantId, policy }];
      if (idemStoreKey) {
        ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode, body: responseBody } });
      }
      await commitTx(ops, {
        audit: makeOpsAudit({
          action: "X402_WALLET_ISSUER_POLICY_UPSERT",
          targetType: "x402_wallet_policy",
          targetId: `${policy.sponsorWalletRef}::${policy.policyRef}::${policy.policyVersion}`,
          details: {
            sponsorRef: policy.sponsorRef ?? null,
            status: policy.status
          }
        })
      });
      return sendJson(res, statusCode, responseBody);
    }

    if (parts[0] === "x402" && parts[1] === "wallet-assignment" && parts[2] === "resolve" && parts.length === 3 && req.method === "POST") {
      if (!requireProtocolHeaderForWrite(req, res)) return;
      const body = await readJsonBody(req);
      let profileRef = null;
      let riskClass = null;
      let delegationRef = null;
      let delegationDepth = null;
      try {
        profileRef = normalizeOptionalX402RefInput(body?.profileRef ?? body?.profile ?? body?.sponsorRef ?? null, "profileRef", {
          allowNull: true,
          max: 200
        });
        riskClass = normalizeX402WalletAssignmentRiskClassInput(body?.riskClass ?? body?.risk ?? null, {
          fieldPath: "riskClass",
          allowNull: true
        });
        delegationRef = normalizeOptionalX402RefInput(body?.delegationRef ?? null, "delegationRef", { allowNull: true, max: 200 });
        delegationDepth = normalizeX402WalletAssignmentDelegationDepthInput(body?.delegationDepth ?? null, {
          fieldPath: "delegationDepth",
          allowNull: true
        });
      } catch (err) {
        return sendError(res, 400, "invalid wallet assignment resolver input", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const assignment = await resolveX402WalletAssignment({
        tenantId,
        profileRef,
        riskClass,
        delegationRef,
        delegationDepth
      });
      return sendJson(res, 200, {
        ok: true,
        tenantId,
        profileRef,
        riskClass,
        delegationRef,
        delegationDepth,
        assignment
      });
    }

    if (parts[0] === "x402" && parts[1] === "wallets" && parts[2] && parts[3] === "policy" && parts.length === 4 && req.method === "GET") {
      let sponsorWalletRef = null;
      try {
        sponsorWalletRef = normalizeOptionalX402RefInput(decodePathPart(parts[2]), "sponsorWalletRef", { allowNull: false, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid sponsorWalletRef", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const policyRefRaw = url.searchParams.get("policyRef");
      const policyVersionRaw = url.searchParams.get("policyVersion");
      const statusRaw = url.searchParams.get("status");
      const limitRaw = url.searchParams.get("limit");
      const offsetRaw = url.searchParams.get("offset");
      if ((policyRefRaw && !policyVersionRaw) || (!policyRefRaw && policyVersionRaw)) {
        return sendError(res, 400, "policyRef and policyVersion must be provided together", null, { code: "SCHEMA_INVALID" });
      }
      if (policyRefRaw && policyVersionRaw) {
        let policyRef = null;
        let policyVersion = null;
        try {
          policyRef = normalizeOptionalX402RefInput(policyRefRaw, "policyRef", { allowNull: false, max: 200 });
          policyVersion = normalizeOptionalX402PositiveSafeInt(policyVersionRaw, "policyVersion", { allowNull: false });
        } catch (err) {
          return sendError(res, 400, "invalid x402 wallet policy key", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }
        const policy = await getX402WalletPolicyRecord({ tenantId, sponsorWalletRef, policyRef, policyVersion });
        if (!policy) return sendError(res, 404, "x402 wallet policy not found", null, { code: "NOT_FOUND" });
        return sendJson(res, 200, { ok: true, policy });
      }
      const limit = limitRaw === null || limitRaw === "" ? 200 : Number(limitRaw);
      const offset = offsetRaw === null || offsetRaw === "" ? 0 : Number(offsetRaw);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) {
        return sendError(res, 400, "invalid list query", { message: "limit must be an integer in range 1..2000" }, { code: "SCHEMA_INVALID" });
      }
      if (!Number.isSafeInteger(offset) || offset < 0) {
        return sendError(res, 400, "invalid list query", { message: "offset must be a non-negative integer" }, { code: "SCHEMA_INVALID" });
      }
      let policies = [];
      try {
        policies = await listX402WalletPolicyRecords({
          tenantId,
          sponsorWalletRef,
          status: statusRaw,
          limit,
          offset
        });
      } catch (err) {
        return sendError(res, 400, "invalid x402 wallet policy query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      return sendJson(res, 200, { ok: true, sponsorWalletRef, limit, offset, policies });
    }

    if (parts[0] === "x402" && parts[1] === "wallets" && parts[2] && parts[3] === "authorize" && parts.length === 4 && req.method === "POST") {
      if (!requireProtocolHeaderForWrite(req, res)) return;
      let sponsorWalletRef = null;
      try {
        sponsorWalletRef = normalizeOptionalX402RefInput(decodePathPart(parts[2]), "sponsorWalletRef", { allowNull: false, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid sponsorWalletRef", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

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

      const gateId = typeof body?.gateId === "string" && body.gateId.trim() !== "" ? body.gateId.trim() : null;
      if (!gateId) return sendError(res, 400, "gateId is required", null, { code: "SCHEMA_INVALID" });
      const requestBindingModeRaw =
        typeof body?.requestBindingMode === "string" && body.requestBindingMode.trim() !== ""
          ? body.requestBindingMode.trim().toLowerCase()
          : null;
      if (requestBindingModeRaw !== null && requestBindingModeRaw !== "strict") {
        return sendError(res, 400, "requestBindingMode must be strict when provided", null, { code: "SCHEMA_INVALID" });
      }
      let requestBindingSha256 = null;
      try {
        requestBindingSha256 = normalizeSha256HashInput(body?.requestBindingSha256 ?? null, "requestBindingSha256", { allowNull: true });
      } catch (err) {
        return sendError(res, 400, "invalid requestBindingSha256", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const requestBindingMode = requestBindingModeRaw ?? (requestBindingSha256 ? "strict" : null);
      if (requestBindingMode === "strict" && !requestBindingSha256) {
        return sendError(res, 400, "requestBindingSha256 is required when requestBindingMode=strict", null, {
          code: "SCHEMA_INVALID"
        });
      }
      let requestedQuoteId = null;
      try {
        requestedQuoteId = normalizeOptionalX402RefInput(body?.quoteId ?? null, "quoteId", { allowNull: true, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid quoteId", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let walletAuthorizationDecisionToken = null;
      try {
        walletAuthorizationDecisionToken = normalizeX402WalletIssuerDecisionTokenInput(
          body?.walletAuthorizationDecisionToken ?? body?.walletAuthorizationDecision ?? null,
          "walletAuthorizationDecisionToken",
          { allowNull: true }
        );
      } catch (err) {
        return sendError(res, 400, "invalid walletAuthorizationDecisionToken", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const gate = typeof store.getX402Gate === "function" ? await store.getX402Gate({ tenantId, gateId }) : null;
      if (!gate) return sendError(res, 404, "gate not found", null, { code: "NOT_FOUND" });
      if (String(gate.status ?? "").toLowerCase() === "resolved") {
        return sendError(res, 409, "gate is already resolved", null, { code: "X402_GATE_TERMINAL" });
      }
      const payerAgentId = typeof gate?.payerAgentId === "string" && gate.payerAgentId.trim() !== "" ? gate.payerAgentId.trim() : null;
      if (!payerAgentId) return sendError(res, 409, "gate payer missing", null, { code: "X402_GATE_INVALID" });
      const payerLifecycle = await blockIfX402AgentLifecycleInactive({ tenantId, agentId: payerAgentId, role: "payer" });
      if (payerLifecycle.blocked) {
        return sendError(res, payerLifecycle.httpStatus, payerLifecycle.message, payerLifecycle.details, { code: payerLifecycle.code });
      }
      const payeeProviderIdFromGate =
        typeof gate?.payeeAgentId === "string" && gate.payeeAgentId.trim() !== ""
          ? gate.payeeAgentId.trim()
          : typeof gate?.terms?.providerId === "string" && gate.terms.providerId.trim() !== ""
            ? gate.terms.providerId.trim()
            : null;
      if (payeeProviderIdFromGate) {
        const payeeLifecycle = await blockIfX402AgentLifecycleInactive({ tenantId, agentId: payeeProviderIdFromGate, role: "payee" });
        if (payeeLifecycle.blocked) {
          return sendError(res, payeeLifecycle.httpStatus, payeeLifecycle.message, payeeLifecycle.details, {
            code: payeeLifecycle.code
          });
        }
      }
      const runId = String(gate.runId ?? "");
      const settlement = typeof store.getAgentRunSettlement === "function" ? await store.getAgentRunSettlement({ tenantId, runId }) : null;
      if (!settlement) return sendError(res, 404, "settlement not found for gate", null, { code: "NOT_FOUND" });
      if (String(settlement.status ?? "").toLowerCase() !== "locked") {
        return sendError(res, 409, "settlement already resolved", null, { code: "X402_GATE_TERMINAL" });
      }
      const amountCents = Number(gate?.terms?.amountCents ?? settlement?.amountCents ?? 0);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return sendError(res, 409, "gate amount invalid", null, { code: "X402_GATE_INVALID" });
      const currency =
        typeof gate?.terms?.currency === "string" && gate.terms.currency.trim() !== ""
          ? gate.terms.currency.trim().toUpperCase()
          : settlement?.currency ?? "USD";
      const gateAgentPassport =
        gate?.agentPassport && typeof gate.agentPassport === "object" && !Array.isArray(gate.agentPassport) ? gate.agentPassport : null;
      if (!gateAgentPassport) {
        return sendError(res, 409, "gate does not use wallet-policy issuer", null, { code: "X402_WALLET_ISSUER_NOT_APPLICABLE" });
      }
      const gateWalletRef =
        typeof gateAgentPassport.sponsorWalletRef === "string" && gateAgentPassport.sponsorWalletRef.trim() !== ""
          ? gateAgentPassport.sponsorWalletRef.trim()
          : null;
      if (!gateWalletRef || gateWalletRef !== sponsorWalletRef) {
        return sendError(res, 409, "sponsor wallet does not match gate passport", null, { code: "X402_WALLET_ISSUER_WALLET_MISMATCH" });
      }
      const walletPolicyResolution = await resolveX402WalletPolicyForPassport({
        tenantId,
        gateAgentPassport
      });
      if (walletPolicyResolution?.error) {
        return sendError(
          res,
          409,
          "x402 wallet policy reference is invalid",
          {
            message: walletPolicyResolution.error.message ?? null,
            sponsorWalletRef: walletPolicyResolution.sponsorWalletRef ?? null
          },
          { code: walletPolicyResolution.error.code ?? "X402_WALLET_POLICY_REFERENCE_INVALID" }
        );
      }
      const resolvedWalletPolicy = walletPolicyResolution?.policy ?? null;
      if (!resolvedWalletPolicy) {
        return sendError(res, 404, "x402 wallet policy not found", null, { code: "X402_WALLET_POLICY_NOT_FOUND" });
      }
      if (x402AgentPassportRequiresDelegationLineage(gateAgentPassport)) {
        try {
          await resolveX402DelegationLineageForAuthorization({
            tenantId,
            gate,
            gateAgentPassport,
            nowAt: nowIso()
          });
        } catch (err) {
          return sendError(
            res,
            409,
            "x402 delegation lineage blocked authorization",
            { message: err?.message ?? null, code: err?.code ?? null, details: err?.details ?? null },
            { code: err?.code ?? "X402_DELEGATION_LINEAGE_INVALID" }
          );
        }
      }
      const payeeProviderId =
        typeof gate?.payeeAgentId === "string" && gate.payeeAgentId.trim() !== ""
          ? gate.payeeAgentId.trim()
          : typeof gate?.terms?.providerId === "string" && gate.terms.providerId.trim() !== ""
            ? gate.terms.providerId.trim()
            : null;
      const nowAt = nowIso();
      const nowMs = Date.parse(nowAt);
      const nowUnix = Math.floor(nowMs / 1000);
      const existingQuote =
        gate?.quote && typeof gate.quote === "object" && !Array.isArray(gate.quote) ? gate.quote : null;
      const existingQuoteExpiresAtMs = Number.isFinite(Date.parse(String(existingQuote?.expiresAt ?? "")))
        ? Date.parse(String(existingQuote.expiresAt))
        : Number.NaN;
      if (requestedQuoteId && !existingQuote) {
        return sendError(res, 409, "requested quoteId was not found on gate", null, { code: "X402_QUOTE_NOT_FOUND" });
      }
      if (requestedQuoteId && existingQuote && String(existingQuote.quoteId ?? "") !== String(requestedQuoteId)) {
        return sendError(res, 409, "requested quoteId does not match gate quote", null, { code: "X402_QUOTE_MISMATCH" });
      }
      const selectedQuote =
        existingQuote &&
        (!requestedQuoteId || String(existingQuote.quoteId ?? "") === String(requestedQuoteId)) &&
        Number.isFinite(existingQuoteExpiresAtMs) &&
        existingQuoteExpiresAtMs > nowMs
          ? existingQuote
          : null;
      if (requestedQuoteId && !selectedQuote) {
        return sendError(res, 409, "requested quote has expired", null, { code: "X402_QUOTE_EXPIRED" });
      }
      const quoteRequestBindingMode =
        selectedQuote && typeof selectedQuote.requestBindingMode === "string" && selectedQuote.requestBindingMode.trim() !== ""
          ? selectedQuote.requestBindingMode.trim().toLowerCase()
          : null;
      const quoteRequestBindingSha256 =
        selectedQuote && typeof selectedQuote.requestBindingSha256 === "string" && selectedQuote.requestBindingSha256.trim() !== ""
          ? selectedQuote.requestBindingSha256.trim().toLowerCase()
          : null;
      const effectiveRequestBindingMode = requestBindingMode ?? quoteRequestBindingMode ?? null;
      const effectiveRequestBindingSha256 = requestBindingSha256 ?? quoteRequestBindingSha256 ?? null;
      if (effectiveRequestBindingMode === "strict" && !effectiveRequestBindingSha256) {
        return sendError(res, 409, "strict request binding requires sha256 hash", null, { code: "X402_REQUEST_BINDING_REQUIRED" });
      }
      if (requestBindingMode === "strict" && quoteRequestBindingMode === "strict" && quoteRequestBindingSha256) {
        if (String(requestBindingSha256 ?? "") !== String(quoteRequestBindingSha256)) {
          return sendError(res, 409, "request binding does not match quote binding", null, { code: "X402_QUOTE_REQUEST_BINDING_MISMATCH" });
        }
      }
      const effectiveQuoteId =
        typeof selectedQuote?.quoteId === "string" && selectedQuote.quoteId.trim() !== "" ? selectedQuote.quoteId.trim() : null;
      const effectiveQuoteSha256 =
        typeof selectedQuote?.quoteSha256 === "string" && selectedQuote.quoteSha256.trim() !== ""
          ? selectedQuote.quoteSha256.trim().toLowerCase()
          : null;

      try {
        await assertX402WalletPolicyForAuthorization({
          tenantId,
          gate,
          policy: resolvedWalletPolicy,
          amountCents,
          currency,
          payeeProviderId,
          effectiveQuoteId,
          effectiveRequestBindingMode,
          effectiveRequestBindingSha256,
          nowAt
        });
      } catch (err) {
        return sendError(
          res,
          409,
          "x402 wallet policy blocked authorization",
          { message: err?.message ?? null, code: err?.code ?? null, details: err?.details ?? null },
          { code: err?.code ?? "X402_WALLET_POLICY_BLOCKED" }
        );
      }

      const sponsorRef =
        typeof resolvedWalletPolicy?.sponsorRef === "string" && resolvedWalletPolicy.sponsorRef.trim() !== ""
          ? resolvedWalletPolicy.sponsorRef.trim()
          : typeof gateAgentPassport?.sponsorRef === "string" && gateAgentPassport.sponsorRef.trim() !== ""
            ? gateAgentPassport.sponsorRef.trim()
            : payerAgentId;
      const policyRef = String(resolvedWalletPolicy.policyRef ?? "");
      const policyVersion = Number(resolvedWalletPolicy.policyVersion ?? 0);
      const policyFingerprint =
        typeof resolvedWalletPolicy.policyFingerprint === "string" && resolvedWalletPolicy.policyFingerprint.trim() !== ""
          ? resolvedWalletPolicy.policyFingerprint.trim().toLowerCase()
          : null;
      if (!policyFingerprint) {
        return sendError(res, 409, "x402 wallet policy fingerprint missing", null, { code: "X402_WALLET_POLICY_FINGERPRINT_MISSING" });
      }

      const idemHeaderRaw = req.headers["x-idempotency-key"] ?? null;
      const idemHeaderValue = typeof idemHeaderRaw === "string" && idemHeaderRaw.trim() !== "" ? idemHeaderRaw.trim() : null;
      const decisionPayload = buildX402WalletIssuerDecisionPayloadV1({
        decisionId: createId("x402dec"),
        gateId,
        sponsorRef,
        sponsorWalletRef,
        policyRef,
        policyVersion,
        policyFingerprint,
        amountCents,
        currency,
        payeeProviderId: String(payeeProviderId ?? ""),
        ...(effectiveQuoteId ? { quoteId: effectiveQuoteId } : {}),
        ...(effectiveQuoteSha256 ? { quoteSha256: effectiveQuoteSha256 } : {}),
        ...(effectiveRequestBindingMode ? { requestBindingMode: effectiveRequestBindingMode } : {}),
        ...(effectiveRequestBindingSha256 ? { requestBindingSha256: effectiveRequestBindingSha256 } : {}),
        idempotencyKey: idemHeaderValue ?? `x402wallet:${gateId}:${effectiveQuoteId ?? "noquote"}`,
        nonce: createId("x402nonce"),
        iat: nowUnix,
        exp: nowUnix + nooterraPayTokenTtlSecondsValue
      });
      const mintedDecision = mintX402WalletIssuerDecisionTokenV1({
        payload: decisionPayload,
        publicKeyPem: store.serverSigner.publicKeyPem,
        privateKeyPem: store.serverSigner.privateKeyPem
      });
      const responseBody = {
        ok: true,
        gateId,
        sponsorWalletRef,
        policyRef,
        policyVersion,
        walletAuthorizationDecisionToken: mintedDecision.token,
        tokenKid: mintedDecision.kid,
        tokenSha256: mintedDecision.tokenSha256,
        expiresAt: new Date(decisionPayload.exp * 1000).toISOString(),
        quoteId: effectiveQuoteId,
        quoteSha256: effectiveQuoteSha256,
        requestBindingMode: effectiveRequestBindingMode,
        requestBindingSha256: effectiveRequestBindingSha256
      };
      if (idemStoreKey) {
        await store.commitTx({
          at: nowAt,
          ops: [{ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody } }]
        });
      }
      return sendJson(res, 200, responseBody);
    }

    if (parts[0] === "x402" && parts[1] === "wallets" && parts[2] && parts[3] === "ledger" && parts.length === 4 && req.method === "GET") {
      if (typeof store.listX402Receipts !== "function") return sendError(res, 501, "x402 receipts are not supported for this store");
      let sponsorWalletRef = null;
      try {
        sponsorWalletRef = normalizeOptionalX402RefInput(decodePathPart(parts[2]), "sponsorWalletRef", { allowNull: false, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid sponsorWalletRef", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let query;
      try {
        query = parseX402ReceiptListQuery(url);
      } catch (err) {
        return sendError(res, 400, "invalid wallet ledger query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const resolvedWalletPolicy = await resolveX402WalletPolicyForIssuerQuery({ tenantId, sponsorWalletRef });
      const effectiveSponsorId = query.sponsorId ?? resolvedWalletPolicy?.sponsorRef ?? null;
      const fetchReceiptPage = async ({ sponsorId, sponsorWalletRefFilter }) => {
        if (typeof store.listX402ReceiptsPage === "function") {
          return await store.listX402ReceiptsPage({
            tenantId,
            agentId: query.agentId,
            sponsorId,
            sponsorWalletRef: sponsorWalletRefFilter,
            toolId: query.toolId,
            state: query.state,
            from: query.from,
            to: query.to,
            cursor: query.cursor,
            limit: query.limit,
            offset: query.offset
          });
        }
        return {
          receipts: await store.listX402Receipts({
            tenantId,
            agentId: query.agentId,
            sponsorId,
            sponsorWalletRef: sponsorWalletRefFilter,
            toolId: query.toolId,
            state: query.state,
            from: query.from,
            to: query.to,
            limit: query.limit,
            offset: query.offset
          }),
          nextCursor: null
        };
      };

      let page = await fetchReceiptPage({ sponsorId: effectiveSponsorId, sponsorWalletRefFilter: sponsorWalletRef });
      let receipts = Array.isArray(page?.receipts) ? page.receipts : [];
      if (receipts.length === 0 && effectiveSponsorId && !query.sponsorWalletRef) {
        const fallbackPage = await fetchReceiptPage({ sponsorId: effectiveSponsorId, sponsorWalletRefFilter: null });
        const fallbackRows = Array.isArray(fallbackPage?.receipts) ? fallbackPage.receipts : [];
        const narrowed = fallbackRows.filter((row) => {
          if (!row || typeof row !== "object" || Array.isArray(row)) return false;
          const rowWalletRef =
            typeof row.sponsorWalletRef === "string" && row.sponsorWalletRef.trim() !== "" ? row.sponsorWalletRef.trim() : null;
          if (rowWalletRef) return rowWalletRef === sponsorWalletRef;
          return String(row.sponsorRef ?? "") === String(effectiveSponsorId);
        });
        page = { ...fallbackPage, receipts: narrowed };
        receipts = narrowed;
      }
      const entries = receipts.map((receipt) => toX402WalletLedgerEntry(receipt)).filter((entry) => Boolean(entry));
      const summary = summarizeX402WalletLedgerEntries(entries);
      return sendJson(res, 200, {
        ok: true,
        sponsorWalletRef,
        entries,
        summary,
        limit: query.limit,
        offset: query.offset,
        nextCursor: page?.nextCursor ?? null
      });
    }

    if (parts[0] === "x402" && parts[1] === "wallets" && parts[2] && parts[3] === "budgets" && parts.length === 4 && req.method === "GET") {
      let sponsorWalletRef = null;
      try {
        sponsorWalletRef = normalizeOptionalX402RefInput(decodePathPart(parts[2]), "sponsorWalletRef", { allowNull: false, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid sponsorWalletRef", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const atRaw = url.searchParams.get("at");
      const atIso =
        atRaw === null || atRaw === undefined || String(atRaw).trim() === ""
          ? nowIso()
          : Number.isFinite(Date.parse(String(atRaw).trim()))
            ? new Date(String(atRaw).trim()).toISOString()
            : null;
      if (!atIso) {
        return sendError(res, 400, "invalid budgets query", { message: "at must be an ISO date-time when provided" }, { code: "SCHEMA_INVALID" });
      }
      let policy = null;
      try {
        policy = await resolveX402WalletPolicyForIssuerQuery({
          tenantId,
          sponsorWalletRef,
          policyRef: url.searchParams.get("policyRef"),
          policyVersion: url.searchParams.get("policyVersion")
        });
      } catch (err) {
        return sendError(res, 400, "invalid budgets policy selector", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (!policy) return sendError(res, 404, "x402 wallet policy not found", null, { code: "NOT_FOUND" });

      const dayKey = atIso.slice(0, 10);
      const dailyAuthorizedExposureCents = computeX402DailyAuthorizedExposureCents({
        tenantId,
        dayKey,
        sponsorWalletRef
      });
      const maxAmountCents = Number.isSafeInteger(policy.maxAmountCents) ? policy.maxAmountCents : null;
      const maxDailyAuthorizationCents = Number.isSafeInteger(policy.maxDailyAuthorizationCents)
        ? policy.maxDailyAuthorizationCents
        : null;
      const remainingDailyAuthorizationCents =
        maxDailyAuthorizationCents === null ? null : Math.max(0, maxDailyAuthorizationCents - dailyAuthorizedExposureCents);
      const authorizationSummary = summarizeX402WalletAuthorizationState({ tenantId, sponsorWalletRef });
      return sendJson(res, 200, {
        ok: true,
        sponsorWalletRef,
        at: atIso,
        policy,
        budgets: normalizeForCanonicalJson(
          {
            schemaVersion: "X402WalletBudgetSnapshot.v1",
            dayKey,
            maxAmountCents,
            maxDailyAuthorizationCents,
            dailyAuthorizedExposureCents,
            remainingDailyAuthorizationCents,
            authorizationSummary
          },
          { path: "$" }
        )
      });
    }

    if (parts[0] === "x402" && parts[1] === "gate" && parts[2] === "escalations" && parts.length === 3 && req.method === "GET") {
      if (typeof store.listX402Escalations !== "function") return sendError(res, 501, "x402 escalation listing is not supported");
      const gateIdRaw = url.searchParams.get("gateId");
      const agentIdRaw = url.searchParams.get("agentId") ?? url.searchParams.get("agent_id");
      const statusRaw = url.searchParams.get("status");
      const limitRaw = url.searchParams.get("limit");
      const offsetRaw = url.searchParams.get("offset");
      let gateId = null;
      let agentId = null;
      let status = null;
      let limit = 200;
      let offset = 0;
      try {
        gateId = normalizeOptionalX402RefInput(gateIdRaw, "gateId", { allowNull: true, max: 200 });
        agentId = normalizeOptionalX402RefInput(agentIdRaw, "agentId", { allowNull: true, max: 200 });
        if (statusRaw !== null && statusRaw !== undefined && String(statusRaw).trim() !== "") {
          status = String(statusRaw).trim().toLowerCase();
          if (!["pending", "approved", "denied"].includes(status)) {
            throw new TypeError("status must be pending|approved|denied");
          }
        }
        if (limitRaw !== null && limitRaw !== undefined && String(limitRaw).trim() !== "") {
          limit = Number(limitRaw);
        }
        if (offsetRaw !== null && offsetRaw !== undefined && String(offsetRaw).trim() !== "") {
          offset = Number(offsetRaw);
        }
        if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1000) throw new TypeError("limit must be an integer 1..1000");
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new TypeError("offset must be an integer 0..100000");
      } catch (err) {
        return sendError(res, 400, "invalid escalation query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const rows = await store.listX402Escalations({ tenantId, gateId, agentId, status, limit, offset });
      return sendJson(res, 200, {
        ok: true,
        escalations: rows.map((row) => toX402EscalationSummary(row)).filter(Boolean),
        limit,
        offset
      });
    }

    if (parts[0] === "x402" && parts[1] === "webhooks" && parts[2] === "endpoints" && parts.length === 3 && req.method === "POST") {
      if (!requireProtocolHeaderForWrite(req, res)) return;
      if (typeof store.putX402WebhookEndpoint !== "function") {
        return sendError(res, 501, "x402 webhook endpoint registration is not supported");
      }
      const body = await readJsonBody(req);
      const nowAt = nowIso();
      let urlValue = null;
      let events = null;
      let description = null;
      let status = X402_WEBHOOK_ENDPOINT_STATUS.ACTIVE;
      try {
        urlValue = normalizeX402WebhookEndpointUrl(body?.url);
        events = normalizeX402WebhookEvents(body?.events, "events");
        if (body?.description !== undefined && body?.description !== null) {
          description = String(body.description).trim();
          if (description === "") description = null;
          if (description && description.length > 300) {
            throw new TypeError("description must be at most 300 characters");
          }
        }
        status = normalizeX402WebhookEndpointStatus(body?.status, { allowRevoked: false, fallback: X402_WEBHOOK_ENDPOINT_STATUS.ACTIVE });
      } catch (err) {
        return sendError(res, 400, "invalid webhook endpoint payload", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const endpointId = createId("x402wh");
      const destinationId = `x402wh_${endpointId}`;
      const secret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
      const secretCiphertext = encryptX402WebhookSecret(secret);
      const endpoint = normalizeForCanonicalJson(
        {
          schemaVersion: "X402WebhookEndpoint.v1",
          endpointId,
          destinationId,
          url: urlValue,
          events,
          description,
          status,
          consecutiveFailures: 0,
          lastFailureReason: null,
          lastFailureStatusCode: null,
          lastFailureAt: null,
          lastDeliveryAt: null,
          disabledAt: null,
          revokedAt: null,
          previousSecretCiphertext: null,
          previousSecretHash: null,
          previousSecretExpiresAt: null,
          createdAt: nowAt,
          updatedAt: nowAt,
          secretCiphertext,
          secretHash: sha256Hex(secret)
        },
        { path: "$" }
      );
      const stored = await store.putX402WebhookEndpoint({ tenantId, endpoint });
      const summary = toX402WebhookEndpointSummary(stored);
      return sendJson(res, 201, {
        ok: true,
        endpoint: summary,
        secret
      });
    }

    if (parts[0] === "x402" && parts[1] === "webhooks" && parts[2] === "endpoints" && parts.length === 3 && req.method === "GET") {
      if (typeof store.listX402WebhookEndpoints !== "function") {
        return sendError(res, 501, "x402 webhook endpoint listing is not supported");
      }
      const statusRaw = url.searchParams.get("status");
      const eventRaw = url.searchParams.get("event");
      const limitRaw = url.searchParams.get("limit");
      const offsetRaw = url.searchParams.get("offset");
      let status = null;
      let event = null;
      let limit = 200;
      let offset = 0;
      try {
        if (statusRaw !== null && statusRaw !== undefined && String(statusRaw).trim() !== "") {
          status = normalizeX402WebhookEndpointStatus(statusRaw, { allowRevoked: true, fallback: null });
        }
        if (eventRaw !== null && eventRaw !== undefined && String(eventRaw).trim() !== "") {
          event = String(eventRaw).trim().toLowerCase();
          if (!X402_WEBHOOK_ALLOWED_EVENTS.has(event)) {
            throw new TypeError("event is not supported");
          }
        }
        if (limitRaw !== null && limitRaw !== undefined && String(limitRaw).trim() !== "") {
          limit = Number(limitRaw);
        }
        if (offsetRaw !== null && offsetRaw !== undefined && String(offsetRaw).trim() !== "") {
          offset = Number(offsetRaw);
        }
        if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1000) throw new TypeError("limit must be an integer 1..1000");
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new TypeError("offset must be an integer 0..100000");
      } catch (err) {
        return sendError(res, 400, "invalid webhook endpoint query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const rows = await store.listX402WebhookEndpoints({ tenantId, status, event, limit, offset });
      return sendJson(res, 200, {
        ok: true,
        endpoints: rows.map((row) => toX402WebhookEndpointSummary(row)).filter(Boolean),
        limit,
        offset
      });
    }

    if (parts[0] === "x402" && parts[1] === "webhooks" && parts[2] === "endpoints" && parts[3] && parts.length === 4 && req.method === "GET") {
      if (typeof store.getX402WebhookEndpoint !== "function") {
        return sendError(res, 501, "x402 webhook endpoint retrieval is not supported");
      }
      let endpointId = null;
      try {
        endpointId = normalizeOptionalX402RefInput(decodePathPart(parts[3]), "endpointId", { allowNull: false, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid endpointId", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const endpoint = await store.getX402WebhookEndpoint({ tenantId, endpointId });
      if (!endpoint) return sendError(res, 404, "webhook endpoint not found", null, { code: "NOT_FOUND" });
      return sendJson(res, 200, { ok: true, endpoint: toX402WebhookEndpointSummary(endpoint) });
    }

    if (
      parts[0] === "x402" &&
      parts[1] === "webhooks" &&
      parts[2] === "endpoints" &&
      parts[3] &&
      parts[4] === "rotate-secret" &&
      parts.length === 5 &&
      req.method === "POST"
    ) {
      if (!requireProtocolHeaderForWrite(req, res)) return;
      if (typeof store.getX402WebhookEndpoint !== "function" || typeof store.putX402WebhookEndpoint !== "function") {
        return sendError(res, 501, "x402 webhook endpoint secret rotation is not supported");
      }
      let endpointId = null;
      try {
        endpointId = normalizeOptionalX402RefInput(decodePathPart(parts[3]), "endpointId", { allowNull: false, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid endpointId", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const existing = await store.getX402WebhookEndpoint({ tenantId, endpointId });
      if (!existing) return sendError(res, 404, "webhook endpoint not found", null, { code: "NOT_FOUND" });
      if (String(existing.status ?? "").toLowerCase() === X402_WEBHOOK_ENDPOINT_STATUS.REVOKED) {
        return sendError(res, 409, "cannot rotate secret for revoked endpoint", null, { code: "X402_WEBHOOK_ENDPOINT_REVOKED" });
      }

      const body = await readJsonBody(req);
      let gracePeriodSeconds = x402WebhookSecretRotationWindowSecondsValue;
      try {
        if (body?.gracePeriodSeconds !== undefined && body?.gracePeriodSeconds !== null && String(body.gracePeriodSeconds).trim() !== "") {
          gracePeriodSeconds = parsePositiveSafeInt(body.gracePeriodSeconds, x402WebhookSecretRotationWindowSecondsValue);
        }
      } catch (err) {
        return sendError(res, 400, "invalid secret rotation payload", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (gracePeriodSeconds > 7 * 24 * 60 * 60) {
        return sendError(res, 400, "invalid secret rotation payload", { message: "gracePeriodSeconds must be <= 604800" }, { code: "SCHEMA_INVALID" });
      }

      const nowAt = nowIso();
      const newSecret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
      const previousSecretCiphertext =
        typeof existing.secretCiphertext === "string" && existing.secretCiphertext.trim() !== "" ? existing.secretCiphertext : null;
      const previousSecretHash = typeof existing.secretHash === "string" && existing.secretHash.trim() !== "" ? existing.secretHash : null;
      const previousSecretExpiresAt =
        previousSecretCiphertext !== null
          ? new Date(Date.parse(nowAt) + gracePeriodSeconds * 1000).toISOString()
          : null;
      const rotated = normalizeForCanonicalJson(
        {
          ...existing,
          secretCiphertext: encryptX402WebhookSecret(newSecret),
          secretHash: sha256Hex(newSecret),
          previousSecretCiphertext,
          previousSecretHash,
          previousSecretExpiresAt,
          updatedAt: nowAt
        },
        { path: "$" }
      );
      const stored = await store.putX402WebhookEndpoint({ tenantId, endpoint: rotated });
      return sendJson(res, 200, {
        ok: true,
        endpoint: toX402WebhookEndpointSummary(stored),
        secret: newSecret,
        gracePeriodSeconds
      });
    }

    if (parts[0] === "x402" && parts[1] === "webhooks" && parts[2] === "endpoints" && parts[3] && parts.length === 4 && req.method === "DELETE") {
      if (!requireProtocolHeaderForWrite(req, res)) return;
      if (typeof store.getX402WebhookEndpoint !== "function" || typeof store.putX402WebhookEndpoint !== "function") {
        return sendError(res, 501, "x402 webhook endpoint revocation is not supported");
      }
      let endpointId = null;
      try {
        endpointId = normalizeOptionalX402RefInput(decodePathPart(parts[3]), "endpointId", { allowNull: false, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid endpointId", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const existing = await store.getX402WebhookEndpoint({ tenantId, endpointId });
      if (!existing) return sendError(res, 404, "webhook endpoint not found", null, { code: "NOT_FOUND" });
      const nowAt = nowIso();
      const revoked = normalizeForCanonicalJson(
        {
          ...existing,
          status: X402_WEBHOOK_ENDPOINT_STATUS.REVOKED,
          revokedAt: existing.revokedAt ?? nowAt,
          updatedAt: nowAt
        },
        { path: "$" }
      );
      const stored = await store.putX402WebhookEndpoint({ tenantId, endpoint: revoked });
      return sendJson(res, 200, { ok: true, endpoint: toX402WebhookEndpointSummary(stored) });
    }

    if (parts[0] === "x402" && parts[1] === "gate" && parts[2] === "escalations" && parts[3] && parts.length === 4 && req.method === "GET") {
      if (typeof store.getX402Escalation !== "function") return sendError(res, 501, "x402 escalation retrieval is not supported");
      let escalationId = null;
      try {
        escalationId = normalizeOptionalX402RefInput(decodePathPart(parts[3]), "escalationId", { allowNull: false, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid escalationId", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const escalation = await store.getX402Escalation({ tenantId, escalationId });
      if (!escalation) return sendError(res, 404, "escalation not found", null, { code: "NOT_FOUND" });
      const events =
        typeof store.listX402EscalationEvents === "function"
          ? await store.listX402EscalationEvents({ tenantId, escalationId, limit: 1000, offset: 0 })
          : [];
      return sendJson(res, 200, {
        ok: true,
        escalation: toX402EscalationSummary(escalation, { events })
      });
    }

    if (
      parts[0] === "x402" &&
      parts[1] === "gate" &&
      parts[2] === "escalations" &&
      parts[3] &&
      parts[4] === "resolve" &&
      parts.length === 5 &&
      req.method === "POST"
    ) {
      if (!requireProtocolHeaderForWrite(req, res)) return;
      if (typeof store.getX402Escalation !== "function") return sendError(res, 501, "x402 escalation resolution is not supported");
      let escalationId = null;
      try {
        escalationId = normalizeOptionalX402RefInput(decodePathPart(parts[3]), "escalationId", { allowNull: false, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid escalationId", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const escalation = await store.getX402Escalation({ tenantId, escalationId });
      if (!escalation) return sendError(res, 404, "escalation not found", null, { code: "NOT_FOUND" });
      if (String(escalation.status ?? "").toLowerCase() !== "pending") {
        return sendError(
          res,
          409,
          "escalation is already resolved",
          { escalation: toX402EscalationSummary(escalation) },
          { code: "X402_ESCALATION_TERMINAL" }
        );
      }
      const body = await readJsonBody(req);
      const actionRaw = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
      if (actionRaw !== "approve" && actionRaw !== "deny") {
        return sendError(res, 400, "invalid escalation action", null, { code: "SCHEMA_INVALID" });
      }
      const gateId = typeof escalation.gateId === "string" && escalation.gateId.trim() !== "" ? escalation.gateId.trim() : null;
      if (!gateId) return sendError(res, 409, "escalation gate reference is invalid", null, { code: "X402_ESCALATION_INVALID" });
      const gate = typeof store.getX402Gate === "function" ? await store.getX402Gate({ tenantId, gateId }) : null;
      if (!gate) return sendError(res, 404, "gate not found for escalation", null, { code: "NOT_FOUND" });

      const nowAt = nowIso();
      const nowUnix = Math.floor(Date.parse(nowAt) / 1000);
      const reasonRaw = typeof body?.reason === "string" && body.reason.trim() !== "" ? body.reason.trim() : null;

      if (actionRaw === "deny") {
        const denial = await denyX402Escalation({
          tenantId,
          escalation,
          gate,
          reason: reasonRaw,
          nowAt
        });
        return sendJson(res, 200, { ok: true, escalation: toX402EscalationSummary(denial.escalation ?? escalation) });
      }

      const policyRef =
        typeof escalation.policyRef === "string" && escalation.policyRef.trim() !== "" ? escalation.policyRef.trim() : null;
      const policyVersion =
        Number.isSafeInteger(Number(escalation.policyVersion)) && Number(escalation.policyVersion) > 0
          ? Number(escalation.policyVersion)
          : null;
      const policyFingerprint =
        typeof escalation.policyFingerprint === "string" && escalation.policyFingerprint.trim() !== ""
          ? escalation.policyFingerprint.trim().toLowerCase()
          : null;
      const sponsorRef =
        typeof escalation.sponsorRef === "string" && escalation.sponsorRef.trim() !== ""
          ? escalation.sponsorRef.trim()
          : typeof gate?.agentPassport?.sponsorRef === "string" && gate.agentPassport.sponsorRef.trim() !== ""
            ? gate.agentPassport.sponsorRef.trim()
            : typeof gate?.payerAgentId === "string" && gate.payerAgentId.trim() !== ""
              ? gate.payerAgentId.trim()
              : null;
      const sponsorWalletRef =
        typeof escalation.sponsorWalletRef === "string" && escalation.sponsorWalletRef.trim() !== ""
          ? escalation.sponsorWalletRef.trim()
          : typeof gate?.agentPassport?.sponsorWalletRef === "string" && gate.agentPassport.sponsorWalletRef.trim() !== ""
            ? gate.agentPassport.sponsorWalletRef.trim()
            : null;
      const amountCents = Number(escalation.amountCents ?? gate?.terms?.amountCents ?? 0);
      const currency =
        typeof escalation.currency === "string" && escalation.currency.trim() !== ""
          ? escalation.currency.trim().toUpperCase()
          : typeof gate?.terms?.currency === "string" && gate.terms.currency.trim() !== ""
            ? gate.terms.currency.trim().toUpperCase()
            : "USD";
      const payeeProviderId =
        typeof escalation.payeeProviderId === "string" && escalation.payeeProviderId.trim() !== ""
          ? escalation.payeeProviderId.trim()
          : typeof gate?.payeeAgentId === "string" && gate.payeeAgentId.trim() !== ""
            ? gate.payeeAgentId.trim()
            : typeof gate?.terms?.providerId === "string" && gate.terms.providerId.trim() !== ""
              ? gate.terms.providerId.trim()
              : null;
      if (!policyRef || !policyVersion || !policyFingerprint || !sponsorRef || !sponsorWalletRef || !payeeProviderId) {
        return sendError(
          res,
          409,
          "escalation is missing wallet-policy bindings",
          null,
          { code: "X402_ESCALATION_BINDING_MISSING" }
        );
      }
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        return sendError(res, 409, "escalation amount is invalid", null, { code: "X402_ESCALATION_INVALID" });
      }

      const decisionPayload = buildX402WalletIssuerDecisionPayloadV1({
        decisionId: createId("x402dec"),
        gateId,
        sponsorRef,
        sponsorWalletRef,
        policyRef,
        policyVersion,
        policyFingerprint,
        amountCents,
        currency,
        payeeProviderId,
        ...(typeof escalation.quoteId === "string" && escalation.quoteId.trim() !== "" ? { quoteId: escalation.quoteId.trim() } : {}),
        ...(typeof escalation.quoteSha256 === "string" && escalation.quoteSha256.trim() !== ""
          ? { quoteSha256: escalation.quoteSha256.trim().toLowerCase() }
          : {}),
        ...(typeof escalation.requestBindingMode === "string" && escalation.requestBindingMode.trim() !== ""
          ? { requestBindingMode: escalation.requestBindingMode.trim().toLowerCase() }
          : {}),
        ...(typeof escalation.requestBindingSha256 === "string" && escalation.requestBindingSha256.trim() !== ""
          ? { requestBindingSha256: escalation.requestBindingSha256.trim().toLowerCase() }
          : {}),
        idempotencyKey: `x402escalation:${escalationId}`,
        nonce: createId("x402nonce"),
        iat: nowUnix,
        exp: nowUnix + nooterraPayTokenTtlSecondsValue
      });
      const mintedDecision = mintX402WalletIssuerDecisionTokenV1({
        payload: decisionPayload,
        publicKeyPem: store.serverSigner.publicKeyPem,
        privateKeyPem: store.serverSigner.privateKeyPem
      });
      const overridePayload = buildX402EscalationOverridePayloadV1({
        overrideId: createId("x402ovr"),
        escalationId,
        gateId,
        sponsorRef,
        sponsorWalletRef,
        policyRef,
        policyVersion,
        policyFingerprint,
        amountCents,
        currency,
        payeeProviderId,
        ...(typeof escalation.quoteId === "string" && escalation.quoteId.trim() !== "" ? { quoteId: escalation.quoteId.trim() } : {}),
        ...(typeof escalation.quoteSha256 === "string" && escalation.quoteSha256.trim() !== ""
          ? { quoteSha256: escalation.quoteSha256.trim().toLowerCase() }
          : {}),
        ...(typeof escalation.requestBindingMode === "string" && escalation.requestBindingMode.trim() !== ""
          ? { requestBindingMode: escalation.requestBindingMode.trim().toLowerCase() }
          : {}),
        ...(typeof escalation.requestBindingSha256 === "string" && escalation.requestBindingSha256.trim() !== ""
          ? { requestBindingSha256: escalation.requestBindingSha256.trim().toLowerCase() }
          : {}),
        idempotencyKey: `x402escalation:${escalationId}`,
        nonce: createId("x402nonce"),
        iat: nowUnix,
        exp: nowUnix + nooterraPayTokenTtlSecondsValue
      });
      const mintedOverride = mintX402EscalationOverrideTokenV1({
        payload: overridePayload,
        publicKeyPem: store.serverSigner.publicKeyPem,
        privateKeyPem: store.serverSigner.privateKeyPem
      });

      const approvedEscalation = normalizeForCanonicalJson(
        {
          ...escalation,
          status: "approved",
          updatedAt: nowAt,
          resolvedAt: nowAt,
          resolution: {
            action: "approve",
            reason: reasonRaw,
            overrideId: overridePayload.overrideId,
            walletDecisionId: decisionPayload.decisionId,
            overrideTokenSha256: mintedOverride.tokenSha256,
            walletDecisionTokenSha256: mintedDecision.tokenSha256
          }
        },
        { path: "$" }
      );
      const approvedEventId = createId("x402escev");
      const approvedEvent = normalizeForCanonicalJson(
        {
          schemaVersion: "X402AuthorizationEscalationEvent.v1",
          eventId: approvedEventId,
          escalationId,
          gateId,
          eventType: "approved",
          status: "approved",
          reasonCode: escalation.reasonCode ?? null,
          reasonMessage: escalation.reasonMessage ?? null,
          ...(reasonRaw ? { reason: reasonRaw } : {}),
          occurredAt: nowAt
        },
        { path: "$" }
      );
      await store.commitTx({
        at: nowAt,
        ops: [
          { kind: "X402_ESCALATION_UPSERT", tenantId, escalationId, escalation: approvedEscalation },
          { kind: "X402_ESCALATION_EVENT_APPEND", tenantId, eventId: approvedEventId, escalationId, event: approvedEvent }
        ]
      });
      try {
        await emitX402EscalationLifecycleArtifact({
          tenantId,
          escalation: approvedEscalation,
          gate,
          eventType: "approved",
          event: approvedEvent,
          occurredAt: nowAt
        });
      } catch (err) {
        logger.warn("x402.escalation.lifecycle_emit_failed", {
          tenantId,
          escalationId,
          eventType: "approved",
          err: err?.message ?? String(err ?? "")
        });
      }
      return sendJson(res, 200, {
        ok: true,
        escalation: toX402EscalationSummary(approvedEscalation),
        walletAuthorizationDecisionToken: mintedDecision.token,
        escalationOverrideToken: mintedOverride.token,
        tokenKid: mintedOverride.kid,
        expiresAt: new Date(overridePayload.exp * 1000).toISOString(),
        quoteId: escalation.quoteId ?? null,
        quoteSha256: escalation.quoteSha256 ?? null,
        requestBindingMode: escalation.requestBindingMode ?? null,
        requestBindingSha256: escalation.requestBindingSha256 ?? null
      });
    }

    if (parts[0] === "x402" && parts[1] === "gate" && parts[2] === "agents" && parts[3] && parts[4] === "lifecycle" && parts.length === 5) {
      let targetAgentId = null;
      try {
        targetAgentId = normalizeOptionalX402RefInput(decodePathPart(parts[3]), "agentId", { allowNull: false, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid agentId", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      if (req.method === "GET") {
        const lifecycleResolution = await getX402AgentLifecycleStatus({ tenantId, agentId: targetAgentId });
        const lifecycle =
          lifecycleResolution.record ??
          normalizeForCanonicalJson(
            {
              schemaVersion: X402_AGENT_LIFECYCLE_SCHEMA_VERSION,
              tenantId,
              agentId: targetAgentId,
              status: lifecycleResolution.status
            },
            { path: "$" }
          );
        return sendJson(res, 200, { ok: true, agentId: targetAgentId, lifecycle });
      }

      if (req.method === "POST") {
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

        const identity = await getAgentIdentityRecord({ tenantId, agentId: targetAgentId });
        if (!identity) return sendError(res, 404, "agent identity not found", null, { code: "NOT_FOUND" });

        let requestedStatus = null;
        try {
          requestedStatus = normalizeX402AgentLifecycleStatusInput(body?.status ?? null, {
            fieldPath: "status",
            allowNull: false
          });
        } catch (err) {
          return sendError(res, 400, "invalid lifecycle status", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }

        const reasonCode =
          body?.reasonCode === null || body?.reasonCode === undefined || String(body.reasonCode).trim() === ""
            ? null
            : String(body.reasonCode);
        const reasonMessage =
          body?.reasonMessage === null || body?.reasonMessage === undefined || String(body.reasonMessage).trim() === ""
            ? null
            : String(body.reasonMessage);
        const nowAt = nowIso();

        let lifecycleResult = null;
        try {
          if (requestedStatus === X402_AGENT_LIFECYCLE_STATUS.FROZEN) {
            lifecycleResult = await freezeX402AgentLifecycle({
              tenantId,
              agentId: targetAgentId,
              reasonCode,
              reasonMessage,
              requestedByPrincipalId: auth?.principalId ?? null,
              requestedByActorKeyId: auth?.actorKeyId ?? null,
              source: "manual",
              nowAt
            });
          } else {
            lifecycleResult = await upsertX402AgentLifecycleStatus({
              tenantId,
              agentId: targetAgentId,
              status: requestedStatus,
              reasonCode,
              reasonMessage,
              requestedByPrincipalId: auth?.principalId ?? null,
              requestedByActorKeyId: auth?.actorKeyId ?? null,
              source: "manual",
              nowAt
            });
          }
        } catch (err) {
          if (String(err?.message ?? "").includes("x402 lifecycle transition blocked:")) {
            return sendError(
              res,
              409,
              "lifecycle transition blocked",
              { message: err?.message, agentId: targetAgentId, status: requestedStatus },
              { code: "X402_AGENT_LIFECYCLE_TRANSITION_BLOCKED" }
            );
          }
          return sendError(
            res,
            400,
            "invalid lifecycle transition",
            { message: err?.message, agentId: targetAgentId, status: requestedStatus },
            { code: "SCHEMA_INVALID" }
          );
        }

        const responseBody = {
          ok: true,
          agentId: targetAgentId,
          lifecycle: lifecycleResult?.lifecycle ?? null,
          previousStatus: lifecycleResult?.previousStatus ?? null,
          changed: lifecycleResult?.changed === true,
          ...(lifecycleResult?.unwind && typeof lifecycleResult.unwind === "object" ? { unwind: lifecycleResult.unwind } : {})
        };
        const ops = [];
        if (idemStoreKey) {
          ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody } });
        }
        if (ops.length > 0) await store.commitTx({ at: nowAt, ops });
        return sendJson(res, 200, responseBody);
      }
    }

    if (parts[0] === "x402" && parts[1] === "gate" && parts[2] === "agents" && parts[3] && parts[4] === "wind-down" && parts.length === 5 && req.method === "POST") {
      if (!requireProtocolHeaderForWrite(req, res)) return;

      let targetAgentId = null;
      try {
        targetAgentId = normalizeOptionalX402RefInput(decodePathPart(parts[3]), "agentId", { allowNull: false, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid agentId", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
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

      const identity = await getAgentIdentityRecord({ tenantId, agentId: targetAgentId });
      if (!identity) return sendError(res, 404, "agent identity not found", null, { code: "NOT_FOUND" });
      const reasonCode =
        body?.reasonCode === null || body?.reasonCode === undefined || String(body.reasonCode).trim() === ""
          ? "X402_AGENT_WIND_DOWN_MANUAL"
          : normalizeOptionalX402RefInput(body.reasonCode, "reasonCode", { allowNull: false, max: 200 });
      const reasonMessage =
        body?.reasonMessage === null || body?.reasonMessage === undefined || String(body.reasonMessage).trim() === ""
          ? null
          : String(body.reasonMessage).trim().slice(0, 500);
      const nowAt = nowIso();
      const freezeResult = await freezeX402AgentLifecycle({
        tenantId,
        agentId: targetAgentId,
        reasonCode,
        reasonMessage,
        requestedByPrincipalId: auth?.principalId ?? null,
        requestedByActorKeyId: auth?.actorKeyId ?? null,
        source: "manual",
        nowAt
      });
      const nextLifecycle = freezeResult.lifecycle;
      const responseBody = {
        ok: true,
        agentId: targetAgentId,
        lifecycle: nextLifecycle,
        ...(freezeResult?.unwind && typeof freezeResult.unwind === "object" ? { unwind: freezeResult.unwind } : {})
      };
      const ops = [];
      if (idemStoreKey) {
        ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody } });
      }
      if (ops.length > 0) await store.commitTx({ at: nowAt, ops });
      return sendJson(res, 200, responseBody);
    }

    if (parts[0] === "x402" && parts[1] === "gate" && parts[2] === "create" && parts.length === 3 && req.method === "POST") {
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

      const payerAgentId = typeof body?.payerAgentId === "string" && body.payerAgentId.trim() !== "" ? body.payerAgentId.trim() : null;
      const payeeAgentId = typeof body?.payeeAgentId === "string" && body.payeeAgentId.trim() !== "" ? body.payeeAgentId.trim() : null;
      if (!payerAgentId || !payeeAgentId || payerAgentId === payeeAgentId) {
        return sendError(res, 400, "payerAgentId and payeeAgentId are required and must differ", null, { code: "SCHEMA_INVALID" });
      }
      const payerLifecycle = await blockIfX402AgentLifecycleInactive({ tenantId, agentId: payerAgentId, role: "payer" });
      if (payerLifecycle.blocked) {
        return sendError(res, payerLifecycle.httpStatus, payerLifecycle.message, payerLifecycle.details, { code: payerLifecycle.code });
      }
      const payeeLifecycle = await blockIfX402AgentLifecycleInactive({ tenantId, agentId: payeeAgentId, role: "payee" });
      if (payeeLifecycle.blocked) {
        return sendError(res, payeeLifecycle.httpStatus, payeeLifecycle.message, payeeLifecycle.details, { code: payeeLifecycle.code });
      }

      const nowAt = nowIso();
      const gateId = typeof body?.gateId === "string" && body.gateId.trim() !== "" ? body.gateId.trim() : createId("x402gate");
      const runId = `x402_${gateId}`;

      const amountCents = Number(body?.amountCents);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        return sendError(res, 400, "amountCents must be a positive safe integer", null, { code: "SCHEMA_INVALID" });
      }
      const currency = typeof body?.currency === "string" && body.currency.trim() !== "" ? body.currency.trim().toUpperCase() : "USD";
      const disputeWindowDays = body?.disputeWindowDays ?? 0;
      const disputeWindowMs = body?.disputeWindowMs ?? null;
      const holdbackBps = body?.holdbackBps ?? 0;
      let terms;
      try {
        terms = buildX402SettlementTerms({
          amountCents,
          currency,
          disputeWindowDays,
          disputeWindowMs,
          holdbackBps,
          evidenceRequirements: body?.evidenceRequirements ?? null,
          slaPolicy: body?.slaPolicy ?? null
        });
      } catch (err) {
        return sendError(res, 400, "invalid settlement terms", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const upstream = (() => {
        const parsed = parseX402PaymentRequired(body?.paymentRequiredHeader ?? body?.paymentRequired ?? null);
        return parsed.ok ? parsed : null;
      })();

        let agreementHash = null;
        try {
          agreementHash = normalizeSha256HashInput(body?.agreementHash, "agreementHash", { allowNull: true });
        } catch (err) {
          return sendError(res, 400, "invalid agreementHash", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }

        let providerKey = null;
        const providerPublicKeyPem =
          typeof body?.providerPublicKeyPem === "string" && body.providerPublicKeyPem.trim() !== "" ? body.providerPublicKeyPem.trim() : null;
        if (providerPublicKeyPem) {
          try {
            const keyId = keyIdFromPublicKeyPem(providerPublicKeyPem);
            providerKey = { algorithm: "ed25519", keyId, publicKeyPem: providerPublicKeyPem };
          } catch (err) {
            return sendError(res, 400, "invalid providerPublicKeyPem", { message: err?.message }, { code: "SCHEMA_INVALID" });
          }
        }
      let agentPassport = null;
      try {
        agentPassport = normalizeX402AgentPassportInput(body?.agentPassport ?? null, {
          fieldPath: "agentPassport",
          allowNull: true
        });
      } catch (err) {
        return sendError(res, 400, "invalid agentPassport", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (x402RequireAgentPassportValue) {
        try {
          assertX402AgentPassportForPrivilegedAction({
            tenantId,
            payerAgentId,
            gateAgentPassport: agentPassport,
            nowAt,
            requireProtocolEnvelope: true
          });
        } catch (err) {
          const code = typeof err?.code === "string" && err.code.trim() !== "" ? err.code.trim() : "X402_AGENT_PASSPORT_INVALID";
          return sendError(res, 400, "agent passport is invalid for privileged x402 gate create", {
            message: err?.message ?? null,
            details: err?.details ?? null
          }, { code });
        }
      }
      let toolId = null;
      try {
        toolId = normalizeOptionalX402RefInput(body?.toolId ?? null, "toolId", { allowNull: true, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid toolId", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let delegationGrantRef = null;
      try {
        delegationGrantRef = normalizeOptionalX402RefInput(body?.delegationGrantRef ?? null, "delegationGrantRef", {
          allowNull: true,
          max: 200
        });
      } catch (err) {
        return sendError(res, 400, "invalid delegationGrantRef", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let authorityGrantRef = null;
      try {
        authorityGrantRef = normalizeOptionalX402RefInput(body?.authorityGrantRef ?? null, "authorityGrantRef", {
          allowNull: true,
          max: 200
        });
      } catch (err) {
        return sendError(res, 400, "invalid authorityGrantRef", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const authorityGrantRefForValidation = x402RequireAuthorityGrantValue
        ? authorityGrantRef ??
          deriveX402AuthorityGrantRef({
            gateId,
            gateAgentPassport: agentPassport,
            gateAuthorization: null
          })
        : authorityGrantRef;
      if (x402RequireAuthorityGrantValue && !authorityGrantRefForValidation) {
        return sendError(
          res,
          409,
          "authority grant is required for x402 gate create",
          { gateId, payerAgentId, payeeAgentId },
          { code: "X402_AUTHORITY_GRANT_REQUIRED" }
        );
      }
      let resolvedDelegationGrantForCreate = null;
      if (delegationGrantRef) {
        if (typeof store.getDelegationGrant !== "function") {
          return sendError(res, 501, "delegation grants are not supported for this store", null, { code: "NOT_IMPLEMENTED" });
        }
        const delegationGrant = await store.getDelegationGrant({ tenantId, grantId: delegationGrantRef });
        if (!delegationGrant) return sendError(res, 404, "delegation grant not found", null, { code: "NOT_FOUND" });
        try {
          validateDelegationGrantV1(delegationGrant);
        } catch (err) {
          return sendError(res, 409, "x402 delegation grant blocked gate create", { message: err?.message ?? null }, {
            code: "X402_DELEGATION_GRANT_INVALID"
          });
        }
        resolvedDelegationGrantForCreate = delegationGrant;
      }

      const existingGate = typeof store.getX402Gate === "function" ? await store.getX402Gate({ tenantId, gateId }) : null;
      if (existingGate && !idemStoreKey) return sendError(res, 409, "gate already exists", null, { code: "ALREADY_EXISTS" });

      const existingSettlement = typeof store.getAgentRunSettlement === "function" ? await store.getAgentRunSettlement({ tenantId, runId }) : null;
      if (existingSettlement && !idemStoreKey) return sendError(res, 409, "gate run already exists", null, { code: "ALREADY_EXISTS" });

      const payerWalletExisting = typeof store.getAgentWallet === "function" ? await store.getAgentWallet({ tenantId, agentId: payerAgentId }) : null;
      const payeeWalletExisting = typeof store.getAgentWallet === "function" ? await store.getAgentWallet({ tenantId, agentId: payeeAgentId }) : null;

        const autoFundPayerCents = Number(body?.autoFundPayerCents ?? 0);
        if (!Number.isSafeInteger(autoFundPayerCents) || autoFundPayerCents < 0) {
          return sendError(res, 400, "autoFundPayerCents must be a non-negative safe integer", null, { code: "SCHEMA_INVALID" });
        }
      let resolvedAuthorityGrantForCreate = null;
      if (authorityGrantRefForValidation) {
        try {
          const authorityResolution = await resolveX402AuthorityGrantForAuthorization({
            tenantId,
            gate: { payerAgentId, toolId },
            authorityGrantRef: authorityGrantRefForValidation,
            nowAt,
            amountCents,
            currency,
            payeeProviderId: payeeAgentId
          });
          resolvedAuthorityGrantForCreate = authorityResolution?.authorityGrant ?? null;
        } catch (err) {
          return sendError(
            res,
            409,
            "x402 authority grant blocked gate create",
            { message: err?.message ?? null, code: err?.code ?? null, details: err?.details ?? null },
            { code: err?.code ?? "X402_AUTHORITY_GRANT_INVALID" }
          );
        }
      }
      if (resolvedDelegationGrantForCreate && resolvedAuthorityGrantForCreate) {
        try {
          await assertDelegationGrantWithinAuthorityGrant({
            tenantId,
            nowAt,
            delegationGrant: resolvedDelegationGrantForCreate,
            delegationGrantRef,
            authorityGrant: resolvedAuthorityGrantForCreate,
            authorityGrantRef: authorityGrantRefForValidation
          });
        } catch (err) {
          return sendError(
            res,
            409,
            "x402 authority-delegation consistency check failed",
            { message: err?.message ?? null, code: err?.code ?? null, details: err?.details ?? null },
            { code: err?.code ?? "X402_AUTHORITY_DELEGATION_SCOPE_ESCALATION" }
          );
        }
      }

        let payerWallet = ensureAgentWallet({ wallet: payerWalletExisting, tenantId, agentId: payerAgentId, currency, at: nowAt });
        let payeeWallet = ensureAgentWallet({ wallet: payeeWalletExisting, tenantId, agentId: payeeAgentId, currency, at: nowAt });
        if (!payerWalletExisting && autoFundPayerCents > 0) payerWallet = creditAgentWallet({ wallet: payerWallet, amountCents: autoFundPayerCents, at: nowAt });
        try {
          const payerIdentity = await getAgentIdentityRecord({ tenantId, agentId: payerAgentId });
          if (payerIdentity) {
            await assertSettlementWithinWalletPolicy({ tenantId, agentIdentity: payerIdentity, amountCents, at: nowAt });
          }
        } catch (err) {
          if (err?.code?.startsWith?.("WALLET_POLICY_")) {
            return sendError(res, 409, "wallet policy blocked settlement", { message: err?.message, code: err?.code ?? null });
          }
          return sendError(res, 400, "invalid payer agent identity", { message: err?.message });
        }
        try {
          payerWallet = lockAgentWalletEscrow({ wallet: payerWallet, amountCents, at: nowAt });
        } catch (err) {
          if (err?.code === "INSUFFICIENT_WALLET_BALANCE") {
            return sendError(res, 409, "insufficient wallet balance", { message: err?.message }, { code: "INSUFFICIENT_FUNDS" });
        }
        throw err;
      }

      const settlement = createAgentRunSettlement({
        tenantId,
        runId,
        agentId: payeeAgentId,
        payerAgentId,
        amountCents,
        currency,
        disputeWindowDays: terms.disputeWindowDays,
        at: nowAt
      });

      const gate = normalizeForCanonicalJson(
        {
          schemaVersion: "X402GateRecord.v1",
          gateId,
          tenantId,
          runId,
            payerAgentId,
            payeeAgentId,
            ...(agreementHash ? { agreementHash } : {}),
            ...(providerKey ? { providerKey } : {}),
            ...(toolId ? { toolId } : {}),
            ...(delegationGrantRef ? { delegationGrantRef } : {}),
            ...(authorityGrantRefForValidation ? { authorityGrantRef: authorityGrantRefForValidation } : {}),
            ...(agentPassport ? { agentPassport } : {}),
            terms,
            upstream,
          authorization: {
            schemaVersion: "X402GateAuthorization.v1",
            authorizationRef: `auth_${gateId}`,
            status: "pending",
            walletEscrow: {
              status: "locked",
              amountCents,
              currency,
              lockedAt: nowAt
            },
            reserve: null,
            token: null,
            updatedAt: nowAt
          },
            status: "held",
            createdAt: nowAt,
            updatedAt: nowAt
        },
        { path: "$" }
      );

      const ops = [];
      if (!payerWalletExisting || payerWalletExisting.revision !== payerWallet.revision) {
        ops.push({ kind: "AGENT_WALLET_UPSERT", tenantId, wallet: payerWallet });
      }
      if (!payeeWalletExisting) {
        ops.push({ kind: "AGENT_WALLET_UPSERT", tenantId, wallet: payeeWallet });
      }
      ops.push({ kind: "AGENT_RUN_SETTLEMENT_UPSERT", tenantId, runId, settlement });
      ops.push({ kind: "X402_GATE_UPSERT", tenantId, gateId, gate });

      const responseBody = { ok: true, gate, settlement };
      if (idemStoreKey) {
        ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
      }
      await store.commitTx({ at: nowAt, ops });
      return sendJson(res, 201, responseBody);
    }

    if (parts[0] === "x402" && parts[1] === "gate" && parts[2] === "quote" && parts.length === 3 && req.method === "POST") {
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

      const gateId = typeof body?.gateId === "string" && body.gateId.trim() !== "" ? body.gateId.trim() : null;
      if (!gateId) return sendError(res, 400, "gateId is required", null, { code: "SCHEMA_INVALID" });
      const requestBindingModeRaw =
        typeof body?.requestBindingMode === "string" && body.requestBindingMode.trim() !== ""
          ? body.requestBindingMode.trim().toLowerCase()
          : null;
      if (requestBindingModeRaw !== null && requestBindingModeRaw !== "strict") {
        return sendError(res, 400, "requestBindingMode must be strict when provided", null, { code: "SCHEMA_INVALID" });
      }
      let requestBindingSha256 = null;
      try {
        requestBindingSha256 = normalizeSha256HashInput(body?.requestBindingSha256 ?? null, "requestBindingSha256", { allowNull: true });
      } catch (err) {
        return sendError(res, 400, "invalid requestBindingSha256", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const requestBindingMode = requestBindingModeRaw ?? (requestBindingSha256 ? "strict" : null);
      if (requestBindingMode === "strict" && !requestBindingSha256) {
        return sendError(res, 400, "requestBindingSha256 is required when requestBindingMode=strict", null, {
          code: "SCHEMA_INVALID"
        });
      }
      let requestedProviderId = null;
      let requestedToolId = null;
      let requestedQuoteId = null;
      try {
        requestedProviderId = normalizeOptionalX402RefInput(body?.providerId ?? null, "providerId", { allowNull: true, max: 200 });
        requestedToolId = normalizeOptionalX402RefInput(body?.toolId ?? null, "toolId", { allowNull: true, max: 200 });
        requestedQuoteId = normalizeOptionalX402RefInput(body?.quoteId ?? null, "quoteId", { allowNull: true, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid quote request fields", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const quoteTtlSecondsRaw = body?.quoteTtlSeconds;
      let quoteTtlSeconds = x402QuoteTtlSecondsValue;
      if (!(quoteTtlSecondsRaw === null || quoteTtlSecondsRaw === undefined || String(quoteTtlSecondsRaw).trim() === "")) {
        const n = Number(quoteTtlSecondsRaw);
        if (!Number.isSafeInteger(n) || n <= 0 || n > 3600) {
          return sendError(res, 400, "quoteTtlSeconds must be an integer within 1..3600", null, { code: "SCHEMA_INVALID" });
        }
        quoteTtlSeconds = n;
      }

      const gate = typeof store.getX402Gate === "function" ? await store.getX402Gate({ tenantId, gateId }) : null;
      if (!gate) return sendError(res, 404, "gate not found", null, { code: "NOT_FOUND" });
      if (String(gate.status ?? "").toLowerCase() === "resolved") {
        return sendError(res, 409, "gate is already resolved", null, { code: "X402_GATE_TERMINAL" });
      }
      const quotePayerAgentId =
        typeof gate?.payerAgentId === "string" && gate.payerAgentId.trim() !== "" ? gate.payerAgentId.trim() : null;
      if (!quotePayerAgentId) return sendError(res, 409, "gate payer missing", null, { code: "X402_GATE_INVALID" });
      const quotePayerLifecycle = await blockIfX402AgentLifecycleInactive({
        tenantId,
        agentId: quotePayerAgentId,
        role: "payer"
      });
      if (quotePayerLifecycle.blocked) {
        return sendError(
          res,
          quotePayerLifecycle.httpStatus,
          quotePayerLifecycle.message,
          quotePayerLifecycle.details,
          { code: quotePayerLifecycle.code }
        );
      }
      const quotePayeeAgentId =
        typeof gate?.payeeAgentId === "string" && gate.payeeAgentId.trim() !== ""
          ? gate.payeeAgentId.trim()
          : typeof gate?.terms?.providerId === "string" && gate.terms.providerId.trim() !== ""
            ? gate.terms.providerId.trim()
            : null;
      if (quotePayeeAgentId) {
        const quotePayeeLifecycle = await blockIfX402AgentLifecycleInactive({
          tenantId,
          agentId: quotePayeeAgentId,
          role: "payee"
        });
        if (quotePayeeLifecycle.blocked) {
          return sendError(
            res,
            quotePayeeLifecycle.httpStatus,
            quotePayeeLifecycle.message,
            quotePayeeLifecycle.details,
            { code: quotePayeeLifecycle.code }
          );
        }
      }
      const runId = String(gate.runId ?? "");
      const settlement = typeof store.getAgentRunSettlement === "function" ? await store.getAgentRunSettlement({ tenantId, runId }) : null;
      if (!settlement) return sendError(res, 404, "settlement not found for gate", null, { code: "NOT_FOUND" });
      const amountCents = Number(gate?.terms?.amountCents ?? settlement?.amountCents ?? 0);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return sendError(res, 409, "gate amount invalid", null, { code: "X402_GATE_INVALID" });
      const currency =
        typeof gate?.terms?.currency === "string" && gate.terms.currency.trim() !== ""
          ? gate.terms.currency.trim().toUpperCase()
          : settlement?.currency ?? "USD";
      const providerId =
        requestedProviderId ??
        (typeof gate?.payeeAgentId === "string" && gate.payeeAgentId.trim() !== ""
          ? gate.payeeAgentId.trim()
          : typeof gate?.terms?.providerId === "string" && gate.terms.providerId.trim() !== ""
            ? gate.terms.providerId.trim()
            : null);
      if (!providerId) return sendError(res, 409, "gate provider missing", null, { code: "X402_GATE_INVALID" });
      const toolId =
        requestedToolId ??
        (typeof gate?.toolId === "string" && gate.toolId.trim() !== "" ? gate.toolId.trim() : null) ??
        (typeof gate?.quote?.toolId === "string" && gate.quote.toolId.trim() !== "" ? gate.quote.toolId.trim() : null);

      const nowAt = nowIso();
      const nowMs = Date.parse(nowAt);
      const existingQuote =
        gate?.quote && typeof gate.quote === "object" && !Array.isArray(gate.quote) ? gate.quote : null;
      const existingQuoteExpiresAtMs = Number.isFinite(Date.parse(String(existingQuote?.expiresAt ?? "")))
        ? Date.parse(String(existingQuote.expiresAt))
        : Number.NaN;
      const existingQuoteMatches =
        !!existingQuote &&
        Number.isFinite(existingQuoteExpiresAtMs) &&
        existingQuoteExpiresAtMs > nowMs &&
        (!requestedQuoteId || String(existingQuote.quoteId ?? "") === String(requestedQuoteId)) &&
        String(existingQuote.providerId ?? "") === String(providerId) &&
        String(existingQuote.toolId ?? "") === String(toolId ?? "") &&
        (requestBindingMode
          ? String(existingQuote.requestBindingMode ?? "") === String(requestBindingMode) &&
            String(existingQuote.requestBindingSha256 ?? "") === String(requestBindingSha256 ?? "")
          : !existingQuote.requestBindingMode && !existingQuote.requestBindingSha256);
      if (existingQuoteMatches) {
        const responseBody = {
          gateId,
          quote: existingQuote
        };
        if (idemStoreKey) {
          await store.commitTx({
            at: nowAt,
            ops: [{ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody } }]
          });
        }
        return sendJson(res, 200, responseBody);
      }

      const expiresAt = new Date(nowMs + quoteTtlSeconds * 1000).toISOString();
      const quote = buildX402QuoteRecord({
        gateId,
        quoteId: requestedQuoteId ?? createId("x402quote"),
        providerId,
        toolId,
        amountCents,
        currency,
        requestBindingMode,
        requestBindingSha256,
        quotedAt: nowAt,
        expiresAt
      });
      const nextGate = normalizeForCanonicalJson(
        {
          ...gate,
          ...(toolId ? { toolId } : {}),
          quote,
          updatedAt: nowAt
        },
        { path: "$" }
      );
      const responseBody = { gateId, quote };
      const ops = [{ kind: "X402_GATE_UPSERT", tenantId, gateId, gate: nextGate }];
      if (idemStoreKey) {
        ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody } });
      }
      await store.commitTx({ at: nowAt, ops });
      return sendJson(res, 200, responseBody);
    }

    if (parts[0] === "x402" && parts[1] === "gate" && parts[2] === "authorize-payment" && parts.length === 3 && req.method === "POST") {
      if (!requireProtocolHeaderForWrite(req, res)) return;

      const body = await readJsonBody(req);
      const requestIdempotencyKey =
        typeof req?.headers?.["x-idempotency-key"] === "string" && req.headers["x-idempotency-key"].trim() !== ""
          ? req.headers["x-idempotency-key"].trim()
          : null;
      const executionIntentInput =
        body?.executionIntent && typeof body.executionIntent === "object" && !Array.isArray(body.executionIntent)
          ? body.executionIntent
          : null;
      let parsedExecutionIntent = null;
      if (executionIntentInput) {
        try {
          parsedExecutionIntent = normalizeX402ExecutionIntentInput(executionIntentInput, "executionIntent");
        } catch (err) {
          const code = typeof err?.code === "string" && err.code.trim() !== "" ? err.code.trim() : "SCHEMA_INVALID";
          return sendError(res, 400, "invalid executionIntent", { message: err?.message ?? null, details: err?.details ?? null }, { code });
        }
      }
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

      const gateId = typeof body?.gateId === "string" && body.gateId.trim() !== "" ? body.gateId.trim() : null;
      if (!gateId) return sendError(res, 400, "gateId is required", null, { code: "SCHEMA_INVALID" });
      const requestBindingModeRaw =
        typeof body?.requestBindingMode === "string" && body.requestBindingMode.trim() !== ""
          ? body.requestBindingMode.trim().toLowerCase()
          : null;
      if (requestBindingModeRaw !== null && requestBindingModeRaw !== "strict") {
        return sendError(res, 400, "requestBindingMode must be strict when provided", null, { code: "SCHEMA_INVALID" });
      }
      let requestBindingSha256 = null;
      try {
        requestBindingSha256 = normalizeSha256HashInput(body?.requestBindingSha256 ?? null, "requestBindingSha256", { allowNull: true });
      } catch (err) {
        return sendError(res, 400, "invalid requestBindingSha256", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const requestBindingMode = requestBindingModeRaw ?? (requestBindingSha256 ? "strict" : null);
      if (requestBindingMode === "strict" && !requestBindingSha256) {
        return sendError(res, 400, "requestBindingSha256 is required when requestBindingMode=strict", null, {
          code: "SCHEMA_INVALID"
        });
      }
      let requestedQuoteId = null;
      try {
        requestedQuoteId = normalizeOptionalX402RefInput(body?.quoteId ?? null, "quoteId", { allowNull: true, max: 200 });
      } catch (err) {
        return sendError(res, 400, "invalid quoteId", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let requestedDelegationGrantRef = null;
      try {
        requestedDelegationGrantRef = normalizeOptionalX402RefInput(body?.delegationGrantRef ?? null, "delegationGrantRef", {
          allowNull: true,
          max: 200
        });
      } catch (err) {
        return sendError(res, 400, "invalid delegationGrantRef", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let requestedAuthorityGrantRef = null;
      try {
        requestedAuthorityGrantRef = normalizeOptionalX402RefInput(body?.authorityGrantRef ?? null, "authorityGrantRef", {
          allowNull: true,
          max: 200
        });
      } catch (err) {
        return sendError(res, 400, "invalid authorityGrantRef", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let walletAuthorizationDecisionToken = null;
      try {
        walletAuthorizationDecisionToken = normalizeX402WalletIssuerDecisionTokenInput(
          body?.walletAuthorizationDecisionToken ?? body?.walletAuthorizationDecision ?? null,
          "walletAuthorizationDecisionToken",
          { allowNull: true }
        );
      } catch (err) {
        return sendError(res, 400, "invalid walletAuthorizationDecisionToken", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let escalationOverrideToken = null;
      try {
        escalationOverrideToken = normalizeX402EscalationOverrideTokenInput(
          body?.escalationOverrideToken ?? null,
          "escalationOverrideToken",
          { allowNull: true }
        );
      } catch (err) {
        return sendError(res, 400, "invalid escalationOverrideToken", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let promptRiskSignals = null;
      try {
        promptRiskSignals = normalizeX402PromptRiskSignalsInput(
          body?.promptRiskSignals ?? body?.riskSignals ?? null,
          { fieldName: "promptRiskSignals", allowNull: true }
        );
      } catch (err) {
        return sendError(res, 400, "invalid promptRiskSignals", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let promptRiskOverride = null;
      try {
        promptRiskOverride = normalizeX402PromptRiskOverrideInput(
          body?.promptRiskOverride ?? body?.riskOverride ?? null,
          { fieldName: "promptRiskOverride", allowNull: true }
        );
      } catch (err) {
        return sendError(res, 400, "invalid promptRiskOverride", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let sessionRef = null;
      try {
        sessionRef = parseX402SessionRefInput(
          body?.sessionRef ?? body?.sessionId ?? body?.collaborationSessionId ?? null,
          { fieldName: "sessionRef", allowNull: true }
        );
      } catch (err) {
        return sendError(res, 400, "invalid sessionRef", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const gate = typeof store.getX402Gate === "function" ? await store.getX402Gate({ tenantId, gateId }) : null;
      if (!gate) return sendError(res, 404, "gate not found", null, { code: "NOT_FOUND" });
      if (String(gate.status ?? "").toLowerCase() === "resolved") {
        return sendError(res, 409, "gate is already resolved", null, { code: "X402_GATE_TERMINAL" });
      }

      const runId = String(gate.runId ?? "");
      const settlement = typeof store.getAgentRunSettlement === "function" ? await store.getAgentRunSettlement({ tenantId, runId }) : null;
      if (!settlement) return sendError(res, 404, "settlement not found for gate", null, { code: "NOT_FOUND" });
      if (String(settlement.status ?? "").toLowerCase() !== "locked") {
        return sendError(res, 409, "settlement already resolved", null, { code: "X402_GATE_TERMINAL" });
      }

      const payerAgentId = typeof gate?.payerAgentId === "string" && gate.payerAgentId.trim() !== "" ? gate.payerAgentId.trim() : null;
      if (!payerAgentId) return sendError(res, 409, "gate payer missing", null, { code: "X402_GATE_INVALID" });
      const payerLifecycle = await blockIfX402AgentLifecycleInactive({ tenantId, agentId: payerAgentId, role: "payer" });
      if (payerLifecycle.blocked) {
        return sendError(res, payerLifecycle.httpStatus, payerLifecycle.message, payerLifecycle.details, { code: payerLifecycle.code });
      }

      const amountCents = Number(gate?.terms?.amountCents ?? settlement?.amountCents ?? 0);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return sendError(res, 409, "gate amount invalid", null, { code: "X402_GATE_INVALID" });
      const currency =
        typeof gate?.terms?.currency === "string" && gate.terms.currency.trim() !== ""
          ? gate.terms.currency.trim().toUpperCase()
          : settlement?.currency ?? "USD";
      const gateAgentPassport =
        gate?.agentPassport && typeof gate.agentPassport === "object" && !Array.isArray(gate.agentPassport) ? gate.agentPassport : null;
      const payeeProviderId =
        typeof gate?.payeeAgentId === "string" && gate.payeeAgentId.trim() !== ""
          ? gate.payeeAgentId.trim()
          : typeof gate?.terms?.providerId === "string" && gate.terms.providerId.trim() !== ""
            ? gate.terms.providerId.trim()
            : null;
      if (payeeProviderId) {
        const payeeLifecycle = await blockIfX402AgentLifecycleInactive({ tenantId, agentId: payeeProviderId, role: "payee" });
        if (payeeLifecycle.blocked) {
          return sendError(res, payeeLifecycle.httpStatus, payeeLifecycle.message, payeeLifecycle.details, {
            code: payeeLifecycle.code
          });
        }
      }
      const nowAt = nowIso();
      const authorizationApprovalDecisions = [];
      let authorizationBudgetEnvelope = null;
      let delegatedApprovalAction = null;
      let delegatedApprovalPolicy = null;
      let delegatedApprovalDecision = null;
      let delegatedApprovalAuditIndex = null;
      let s8ApprovalAction = null;
      let s8ApprovalPolicy = null;
      let s8ApprovalDecision = null;
      let s8ApprovalAuditIndex = null;
      const delegatedBudgetEnvelopeInput = body?.delegatedBudgetEnvelope ?? body?.budgetEnvelope ?? null;
      let delegatedBudgetEnvelope = null;
      try {
        delegatedBudgetEnvelope = normalizeX402DelegatedBudgetEnvelopeInput(delegatedBudgetEnvelopeInput, {
          fieldPath: "delegatedBudgetEnvelope",
          allowNull: true
        });
      } catch (err) {
        return sendError(res, 400, "invalid delegatedBudgetEnvelope", { message: err?.message ?? null }, { code: "SCHEMA_INVALID" });
      }
      if (delegatedBudgetEnvelope) {
        if (delegatedBudgetEnvelope.emergencyStop === true) {
          return sendError(
            res,
            409,
            "delegated budget envelope emergency stop is active",
            {
              gateId,
              envelopeId: delegatedBudgetEnvelope.envelopeId,
              teamId: delegatedBudgetEnvelope.teamId ?? null
            },
            { code: "X402_DELEGATED_EXECUTION_STOPPED" }
          );
        }
        if (String(delegatedBudgetEnvelope.currency ?? "").toUpperCase() !== String(currency ?? "").toUpperCase()) {
          return sendError(
            res,
            409,
            "delegated budget envelope currency does not match gate currency",
            {
              gateId,
              envelopeId: delegatedBudgetEnvelope.envelopeId,
              envelopeCurrency: delegatedBudgetEnvelope.currency,
              gateCurrency: currency
            },
            { code: "X402_DELEGATED_BUDGET_CURRENCY_MISMATCH" }
          );
        }
        let usedCents = 0;
        try {
          usedCents = await computeX402DelegatedBudgetEnvelopeUsageCents({
            tenantId,
            payerAgentId,
            envelopeId: delegatedBudgetEnvelope.envelopeId
          });
        } catch (err) {
          return sendError(
            res,
            409,
            "delegated budget envelope cumulative spend check unavailable",
            {
              gateId,
              envelopeId: delegatedBudgetEnvelope.envelopeId,
              message: err?.message ?? null
            },
            { code: err?.code ?? "X402_DELEGATED_BUDGET_RESOLVER_UNAVAILABLE" }
          );
        }
        const projectedCents = usedCents + amountCents;
        if (projectedCents > delegatedBudgetEnvelope.maxTotalCents) {
          return sendError(
            res,
            409,
            "delegated budget envelope exceeded",
            {
              gateId,
              envelopeId: delegatedBudgetEnvelope.envelopeId,
              teamId: delegatedBudgetEnvelope.teamId ?? null,
              currentUsedCents: usedCents,
              amountCents,
              projectedCents,
              maxTotalCents: delegatedBudgetEnvelope.maxTotalCents
            },
            { code: "X402_DELEGATED_BUDGET_ENVELOPE_EXCEEDED" }
          );
        }
        authorizationBudgetEnvelope = normalizeForCanonicalJson(
          {
            ...delegatedBudgetEnvelope,
            currentUsedCents: usedCents,
            requestedAmountCents: amountCents,
            projectedCents,
            remainingCents: Math.max(0, delegatedBudgetEnvelope.maxTotalCents - projectedCents),
            evaluatedAt: nowAt
          },
          { path: "$" }
        );
        const approvalThresholdCents = Number(delegatedBudgetEnvelope.approvalThresholdCents ?? Number.NaN);
        if (
          !s8ApprovalEnforceX402AuthorizePaymentValue &&
          Number.isSafeInteger(approvalThresholdCents) &&
          approvalThresholdCents >= 0
        ) {
          delegatedApprovalAction = {
            actionId: `x402_budget_envelope_authorize:${gateId}:${delegatedBudgetEnvelope.envelopeId}`,
            actionType: "delegated_budget_authorize",
            actorId: payerAgentId,
            riskTier: "medium",
            amountCents,
            metadata: {
              tenantId,
              gateId,
              runId,
              currency,
              payeeProviderId,
              envelopeId: delegatedBudgetEnvelope.envelopeId,
              teamId: delegatedBudgetEnvelope.teamId ?? null
            }
          };
          delegatedApprovalDecision =
            body?.delegatedApprovalDecision ??
            body?.s8ApprovalDecision ??
            body?.humanApprovalDecision ??
            body?.approvalDecision ??
            null;
          delegatedApprovalPolicy = {
            requireApprovalAboveCents: approvalThresholdCents,
            strictEvidenceRefs: delegatedBudgetEnvelope.requireEvidenceRefs === true,
            ...(delegatedBudgetEnvelope.approvalTimeoutAt ? { decisionTimeoutAt: delegatedBudgetEnvelope.approvalTimeoutAt } : {})
          };
          const delegatedApprovalCheck = enforceHighRiskApproval({
            action: delegatedApprovalAction,
            approvalPolicy: delegatedApprovalPolicy,
            approvalDecision: delegatedApprovalDecision,
            nowIso: () => nowAt
          });
          delegatedApprovalAuditIndex =
            authorizationApprovalDecisions.push(
              createX402AuthorizationApprovalAuditEntry({
                profile: "delegated_budget_threshold",
                action: delegatedApprovalAction,
                approvalCheck: delegatedApprovalCheck,
                approvalDecision: delegatedApprovalDecision,
                checkedAt: nowAt
              })
            ) - 1;
          if (!delegatedApprovalCheck.approved) {
            return sendError(
              res,
              409,
              "delegated budget envelope approval threshold requires explicit approval",
              {
                gateId,
                envelopeId: delegatedBudgetEnvelope.envelopeId,
                approvalCheck: delegatedApprovalCheck,
                approvalRequest: delegatedApprovalCheck.requiresExplicitApproval
                  ? createApprovalRequest({
                      action: delegatedApprovalAction,
                      requestedBy: principalId ?? payerAgentId,
                      requestedAt: nowAt
                    })
                  : null
              },
              { code: delegatedApprovalCheck.blockingIssues?.[0]?.code ?? "HUMAN_APPROVAL_REQUIRED" }
            );
          }
        }
      }
      if (s8ApprovalEnforceX402AuthorizePaymentValue) {
        const requestApprovalPolicyRaw =
          body?.s8ApprovalPolicy && typeof body.s8ApprovalPolicy === "object" && !Array.isArray(body.s8ApprovalPolicy)
            ? body.s8ApprovalPolicy
            : null;
        if (body?.s8ApprovalPolicy !== undefined && requestApprovalPolicyRaw === null) {
          return sendError(res, 400, "invalid s8ApprovalPolicy", { message: "s8ApprovalPolicy must be a plain object" }, { code: "SCHEMA_INVALID" });
        }
        s8ApprovalAction = {
          actionId: `x402_authorize_payment:${gateId}`,
          actionType: "funds_transfer",
          actorId: payerAgentId,
          riskTier: "high",
          amountCents,
          metadata: {
            tenantId,
            gateId,
            runId,
            currency,
            payeeProviderId
          }
        };
        s8ApprovalDecision =
          body?.s8ApprovalDecision ??
          body?.humanApprovalDecision ??
          body?.approvalDecision ??
          null;
        s8ApprovalPolicy = requestApprovalPolicyRaw ?? s8ApprovalPolicyValue;
        const approvalCheck = enforceHighRiskApproval({
          action: s8ApprovalAction,
          approvalPolicy: s8ApprovalPolicy,
          approvalDecision: s8ApprovalDecision,
          nowIso: () => nowAt
        });
        s8ApprovalAuditIndex =
          authorizationApprovalDecisions.push(
            createX402AuthorizationApprovalAuditEntry({
              profile: "s8_high_risk",
              action: s8ApprovalAction,
              approvalCheck,
              approvalDecision: s8ApprovalDecision,
              checkedAt: nowAt
            })
          ) - 1;
        if (!approvalCheck.approved) {
          return sendError(
            res,
            409,
            "human approval required for high-risk x402 authorization",
            {
              approvalCheck,
              approvalRequest: approvalCheck.requiresExplicitApproval
                ? createApprovalRequest({
                    action: s8ApprovalAction,
                    requestedBy: principalId ?? payerAgentId,
                    requestedAt: nowAt
                  })
                : null
            },
            { code: approvalCheck.blockingIssues?.[0]?.code ?? "HUMAN_APPROVAL_REQUIRED" }
          );
        }
      }
      const gateAuthorizationForSignerGuard =
        gate?.authorization && typeof gate.authorization === "object" && !Array.isArray(gate.authorization) ? gate.authorization : null;
      const hasGrantBoundAuthorization =
        requestedDelegationGrantRef !== null ||
        requestedAuthorityGrantRef !== null ||
        (typeof gate?.delegationGrantRef === "string" && gate.delegationGrantRef.trim() !== "") ||
        (typeof gate?.authorityGrantRef === "string" && gate.authorityGrantRef.trim() !== "") ||
        (typeof gateAuthorizationForSignerGuard?.delegationGrantRef === "string" &&
          gateAuthorizationForSignerGuard.delegationGrantRef.trim() !== "") ||
        (typeof gateAuthorizationForSignerGuard?.authorityGrantRef === "string" &&
          gateAuthorizationForSignerGuard.authorityGrantRef.trim() !== "") ||
        (typeof gateAgentPassport?.delegationGrantRef === "string" && gateAgentPassport.delegationGrantRef.trim() !== "") ||
        (typeof gateAgentPassport?.authorityGrantRef === "string" && gateAgentPassport.authorityGrantRef.trim() !== "");
      if (!hasGrantBoundAuthorization) {
        const payerSignerLifecycle = await evaluateGrantParticipantSignerLifecycleAt({
          tenantId,
          agentId: payerAgentId,
          at: nowAt
        });
        if (!payerSignerLifecycle.ok) {
          return sendError(
            res,
            409,
            "payer signer key lifecycle blocked authorization",
            buildGrantParticipantSignerLifecycleDetails({
              operation: "x402_gate.authorize_payment",
              role: "payer",
              agentId: payerAgentId,
              signerKeyId: payerSignerLifecycle.signerKeyId ?? null,
              at: nowAt,
              lifecycle: payerSignerLifecycle.lifecycle ?? null
            }),
            { code: "X402_AGENT_SIGNER_KEY_INVALID" }
          );
        }
        if (payeeProviderId) {
          const payeeSignerLifecycle = await evaluateGrantParticipantSignerLifecycleAt({
            tenantId,
            agentId: payeeProviderId,
            at: nowAt
          });
          if (!payeeSignerLifecycle.ok) {
            return sendError(
              res,
              409,
              "payee signer key lifecycle blocked authorization",
              buildGrantParticipantSignerLifecycleDetails({
                operation: "x402_gate.authorize_payment",
                role: "payee",
                agentId: payeeProviderId,
                signerKeyId: payeeSignerLifecycle.signerKeyId ?? null,
                at: nowAt,
                lifecycle: payeeSignerLifecycle.lifecycle ?? null
              }),
              { code: "X402_AGENT_SIGNER_KEY_INVALID" }
            );
          }
        }
      }
      const nowMs = Date.parse(nowAt);
      const nowUnix = Math.floor(nowMs / 1000);
      const sessionPromptRisk = await resolveSessionPromptRiskSignalsForX402({
        tenantId,
        sessionRef,
        amountCents
      });
      if (!sessionPromptRisk.ok) {
        return sendError(
          res,
          sessionPromptRisk.httpStatus ?? 409,
          sessionPromptRisk.message ?? "session provenance invalid",
          sessionPromptRisk.details ?? null,
          { code: sessionPromptRisk.code ?? "X402_SESSION_PROVENANCE_INVALID" }
        );
      }
      const effectivePromptRiskSignals = mergeX402PromptRiskSignals(promptRiskSignals, sessionPromptRisk.promptRiskSignals);
      const promptRiskEvaluation = evaluateX402PromptRiskGuardrail({
        gate,
        principalId,
        promptRiskSignals: effectivePromptRiskSignals,
        promptRiskOverride,
        forcedModeOverride: sessionPromptRisk.forcedMode,
        at: nowAt
      });
      if (promptRiskEvaluation.blocked) {
        if (promptRiskEvaluation.changed && promptRiskEvaluation.nextState) {
          const blockedGate = normalizeForCanonicalJson(
            {
              ...gate,
              ...(sessionPromptRisk.sessionId ? { sessionRef: sessionPromptRisk.sessionId } : {}),
              promptRisk: promptRiskEvaluation.nextState,
              updatedAt: nowAt
            },
            { path: "$" }
          );
          await store.commitTx({ at: nowAt, ops: [{ kind: "X402_GATE_UPSERT", tenantId, gateId, gate: blockedGate }] });
        }
        return sendError(
          res,
          409,
          promptRiskEvaluation.message,
          {
            gateId,
            forcedMode: promptRiskEvaluation.forcedMode ?? null,
            suspicious: promptRiskEvaluation.suspicious,
            overrideRequired: true
          },
          { code: promptRiskEvaluation.code }
        );
      }
      const defaultAuthorizationRef = `auth_${gateId}`;
      const existingAuthorization =
        gate?.authorization && typeof gate.authorization === "object" && !Array.isArray(gate.authorization) ? gate.authorization : null;
      const authorizationRef =
        typeof existingAuthorization?.authorizationRef === "string" && existingAuthorization.authorizationRef.trim() !== ""
          ? existingAuthorization.authorizationRef.trim()
          : defaultAuthorizationRef;
      const existingToken =
        existingAuthorization?.token && typeof existingAuthorization.token === "object" && !Array.isArray(existingAuthorization.token)
          ? existingAuthorization.token
          : null;
      const existingReserve =
        existingAuthorization?.reserve && typeof existingAuthorization.reserve === "object" && !Array.isArray(existingAuthorization.reserve)
          ? existingAuthorization.reserve
          : null;
      const existingWalletEscrow =
        existingAuthorization?.walletEscrow && typeof existingAuthorization.walletEscrow === "object" && !Array.isArray(existingAuthorization.walletEscrow)
          ? existingAuthorization.walletEscrow
          : null;
      const tokenExpiresAtMs = Number.isFinite(Date.parse(String(existingToken?.expiresAt ?? "")))
        ? Date.parse(String(existingToken.expiresAt))
        : Number.NaN;
      const hasReservedAuthorization =
        String(existingAuthorization?.status ?? "").toLowerCase() === "reserved" &&
        String(existingReserve?.status ?? "").toLowerCase() === "reserved" &&
        typeof existingReserve?.reserveId === "string" &&
        existingReserve.reserveId.trim() !== "";
      const hasLiveToken =
        hasReservedAuthorization &&
        typeof existingToken?.value === "string" &&
        existingToken.value.trim() !== "" &&
        Number.isFinite(tokenExpiresAtMs) &&
        tokenExpiresAtMs > nowMs;
      const existingQuote =
        gate?.quote && typeof gate.quote === "object" && !Array.isArray(gate.quote) ? gate.quote : null;
      const existingQuoteExpiresAtMs = Number.isFinite(Date.parse(String(existingQuote?.expiresAt ?? "")))
        ? Date.parse(String(existingQuote.expiresAt))
        : Number.NaN;
      if (requestedQuoteId && !existingQuote) {
        return sendError(res, 409, "requested quoteId was not found on gate", null, { code: "X402_QUOTE_NOT_FOUND" });
      }
      if (requestedQuoteId && existingQuote && String(existingQuote.quoteId ?? "") !== String(requestedQuoteId)) {
        return sendError(res, 409, "requested quoteId does not match gate quote", null, { code: "X402_QUOTE_MISMATCH" });
      }
      const selectedQuote =
        existingQuote &&
        (!requestedQuoteId || String(existingQuote.quoteId ?? "") === String(requestedQuoteId)) &&
        Number.isFinite(existingQuoteExpiresAtMs) &&
        existingQuoteExpiresAtMs > nowMs
          ? existingQuote
          : null;
      if (requestedQuoteId && !selectedQuote) {
        return sendError(res, 409, "requested quote has expired", null, { code: "X402_QUOTE_EXPIRED" });
      }
      const quoteRequestBindingMode =
        selectedQuote && typeof selectedQuote.requestBindingMode === "string" && selectedQuote.requestBindingMode.trim() !== ""
          ? selectedQuote.requestBindingMode.trim().toLowerCase()
          : null;
      const quoteRequestBindingSha256 =
        selectedQuote && typeof selectedQuote.requestBindingSha256 === "string" && selectedQuote.requestBindingSha256.trim() !== ""
          ? selectedQuote.requestBindingSha256.trim().toLowerCase()
          : null;
      let effectiveRequestBindingMode = requestBindingMode ?? quoteRequestBindingMode ?? null;
      let effectiveRequestBindingSha256 = requestBindingSha256 ?? quoteRequestBindingSha256 ?? null;
      if (effectiveRequestBindingMode === "strict" && !effectiveRequestBindingSha256) {
        return sendError(res, 409, "strict request binding requires sha256 hash", null, { code: "X402_REQUEST_BINDING_REQUIRED" });
      }
      if (requestBindingMode === "strict" && quoteRequestBindingMode === "strict" && quoteRequestBindingSha256) {
        if (String(requestBindingSha256 ?? "") !== String(quoteRequestBindingSha256)) {
          return sendError(res, 409, "request binding does not match quote binding", null, { code: "X402_QUOTE_REQUEST_BINDING_MISMATCH" });
        }
      }
      const effectiveQuoteId =
        typeof selectedQuote?.quoteId === "string" && selectedQuote.quoteId.trim() !== "" ? selectedQuote.quoteId.trim() : null;
      const effectiveQuoteSha256 =
        typeof selectedQuote?.quoteSha256 === "string" && selectedQuote.quoteSha256.trim() !== ""
          ? selectedQuote.quoteSha256.trim().toLowerCase()
          : null;
      let existingTokenRequestBindingMode = null;
      let existingTokenRequestBindingSha256 = null;
      let existingTokenQuoteId = null;
      let existingTokenQuoteSha256 = null;
      if (hasLiveToken) {
        try {
          const parsedToken = parseNooterraPayTokenV1(existingToken.value);
          const payload = parsedToken?.payload && typeof parsedToken.payload === "object" ? parsedToken.payload : {};
          existingTokenRequestBindingMode =
            typeof payload.requestBindingMode === "string" && payload.requestBindingMode.trim() !== ""
              ? payload.requestBindingMode.trim().toLowerCase()
              : null;
          existingTokenRequestBindingSha256 =
            typeof payload.requestBindingSha256 === "string" && payload.requestBindingSha256.trim() !== ""
              ? payload.requestBindingSha256.trim().toLowerCase()
              : null;
          existingTokenQuoteId =
            typeof payload.quoteId === "string" && payload.quoteId.trim() !== "" ? payload.quoteId.trim() : null;
          existingTokenQuoteSha256 =
            typeof payload.quoteSha256 === "string" && payload.quoteSha256.trim() !== ""
              ? payload.quoteSha256.trim().toLowerCase()
              : null;
        } catch {}
      }
      const requestBindingMatchesLiveToken =
        !effectiveRequestBindingMode
          ? !existingTokenRequestBindingMode && !existingTokenRequestBindingSha256
          : effectiveRequestBindingMode === existingTokenRequestBindingMode &&
            effectiveRequestBindingSha256 === existingTokenRequestBindingSha256;
      const quoteMatchesLiveToken =
        !effectiveQuoteId
          ? !existingTokenQuoteId && !existingTokenQuoteSha256
          : existingTokenQuoteId === effectiveQuoteId && (!effectiveQuoteSha256 || existingTokenQuoteSha256 === effectiveQuoteSha256);
      if (x402RequireAgentPassportValue) {
        try {
          assertX402AgentPassportForPrivilegedAction({
            tenantId,
            payerAgentId,
            gateAgentPassport,
            nowAt,
            requireProtocolEnvelope: true
          });
        } catch (err) {
          const code = typeof err?.code === "string" && err.code.trim() !== "" ? err.code.trim() : "X402_AGENT_PASSPORT_INVALID";
          return sendError(
            res,
            409,
            "agent passport is required and must be active for x402 authorization",
            {
              message: err?.message ?? null,
              details: err?.details ?? null
            },
            { code }
          );
        }
      }
      let resolvedWalletPolicy = null;
      let resolvedDelegationLineage = null;
      let resolvedDelegationGrant = null;
      let resolvedAuthorityGrant = null;
      if (gateAgentPassport) {
        const walletPolicyResolution = await resolveX402WalletPolicyForPassport({
          tenantId,
          gateAgentPassport
        });
        if (walletPolicyResolution?.error && !hasReservedAuthorization) {
          return sendError(
            res,
            409,
            "x402 wallet policy reference is invalid",
            {
              message: walletPolicyResolution.error.message ?? null,
              sponsorWalletRef: walletPolicyResolution.sponsorWalletRef ?? null
            },
            { code: walletPolicyResolution.error.code ?? "X402_WALLET_POLICY_REFERENCE_INVALID" }
          );
        }
        resolvedWalletPolicy = walletPolicyResolution?.policy ?? null;
        if (!hasReservedAuthorization && x402AgentPassportRequiresDelegationLineage(gateAgentPassport)) {
          try {
            const lineageResolution = await resolveX402DelegationLineageForAuthorization({
              tenantId,
              gate,
              gateAgentPassport,
              nowAt
            });
            resolvedDelegationLineage = lineageResolution?.lineage ?? null;
          } catch (err) {
            return sendError(
              res,
              409,
              "x402 delegation lineage blocked authorization",
              { message: err?.message ?? null, code: err?.code ?? null, details: err?.details ?? null },
              { code: err?.code ?? "X402_DELEGATION_LINEAGE_INVALID" }
            );
          }
        }
      }
      const delegationGrantRefFromGate =
        typeof gate?.delegationGrantRef === "string" && gate.delegationGrantRef.trim() !== "" ? gate.delegationGrantRef.trim() : null;
      const delegationGrantRefFromAuthorization =
        typeof existingAuthorization?.delegationGrantRef === "string" && existingAuthorization.delegationGrantRef.trim() !== ""
          ? existingAuthorization.delegationGrantRef.trim()
          : null;
      if (requestedDelegationGrantRef && delegationGrantRefFromGate && requestedDelegationGrantRef !== delegationGrantRefFromGate) {
        return sendError(
          res,
          409,
          "delegationGrantRef does not match gate binding",
          {
            gateDelegationGrantRef: delegationGrantRefFromGate,
            requestedDelegationGrantRef
          },
          { code: "X402_DELEGATION_GRANT_MISMATCH" }
        );
      }
      const effectiveDelegationGrantRef = requestedDelegationGrantRef ?? delegationGrantRefFromGate ?? delegationGrantRefFromAuthorization ?? null;
      if (effectiveDelegationGrantRef) {
        try {
          const grantResolution = await resolveX402DelegationGrantForAuthorization({
            tenantId,
            gate,
            gateAgentPassport,
            gateAuthorization: existingAuthorization,
            delegationGrantRef: effectiveDelegationGrantRef,
            nowAt,
            amountCents,
            currency,
            payeeProviderId
          });
          resolvedDelegationGrant = grantResolution?.delegationGrant ?? null;
        } catch (err) {
          return sendError(
            res,
            409,
            "x402 delegation grant blocked authorization",
            { message: err?.message ?? null, code: err?.code ?? null, details: err?.details ?? null },
            { code: err?.code ?? "X402_DELEGATION_GRANT_INVALID" }
          );
        }
      }
      const authorityGrantRefFromGate =
        typeof gate?.authorityGrantRef === "string" && gate.authorityGrantRef.trim() !== "" ? gate.authorityGrantRef.trim() : null;
      const authorityGrantRefFromAuthorization =
        typeof existingAuthorization?.authorityGrantRef === "string" && existingAuthorization.authorityGrantRef.trim() !== ""
          ? existingAuthorization.authorityGrantRef.trim()
          : null;
      if (requestedAuthorityGrantRef && authorityGrantRefFromGate && requestedAuthorityGrantRef !== authorityGrantRefFromGate) {
        return sendError(
          res,
          409,
          "authorityGrantRef does not match gate binding",
          {
            gateAuthorityGrantRef: authorityGrantRefFromGate,
            requestedAuthorityGrantRef
          },
          { code: "X402_AUTHORITY_GRANT_MISMATCH" }
        );
      }
      const effectiveAuthorityGrantRefInput =
        requestedAuthorityGrantRef ??
        authorityGrantRefFromGate ??
        authorityGrantRefFromAuthorization ??
        (x402RequireAuthorityGrantValue
          ? deriveX402AuthorityGrantRef({
              gateId,
              gateAgentPassport,
              gateAuthorization: existingAuthorization
            })
          : null) ??
        null;
      if (x402RequireAuthorityGrantValue && !effectiveAuthorityGrantRefInput) {
        return sendError(
          res,
          409,
          "authority grant is required for x402 authorization",
          { gateId, payerAgentId, payeeProviderId: payeeProviderId ?? null },
          { code: "X402_AUTHORITY_GRANT_REQUIRED" }
        );
      }
      if (effectiveAuthorityGrantRefInput) {
        try {
          const grantResolution = await resolveX402AuthorityGrantForAuthorization({
            tenantId,
            gate,
            authorityGrantRef: effectiveAuthorityGrantRefInput,
            nowAt,
            amountCents,
            currency,
            payeeProviderId
          });
          resolvedAuthorityGrant = grantResolution?.authorityGrant ?? null;
        } catch (err) {
          return sendError(
            res,
            409,
            "x402 authority grant blocked authorization",
            { message: err?.message ?? null, code: err?.code ?? null, details: err?.details ?? null },
            { code: err?.code ?? "X402_AUTHORITY_GRANT_INVALID" }
          );
        }
      }
      if (resolvedDelegationGrant && resolvedAuthorityGrant) {
        try {
          await assertDelegationGrantWithinAuthorityGrant({
            tenantId,
            nowAt,
            delegationGrant: resolvedDelegationGrant,
            delegationGrantRef: effectiveDelegationGrantRef,
            authorityGrant: resolvedAuthorityGrant,
            authorityGrantRef: effectiveAuthorityGrantRefInput
          });
        } catch (err) {
          return sendError(
            res,
            409,
            "x402 authority-delegation consistency check failed",
            { message: err?.message ?? null, code: err?.code ?? null, details: err?.details ?? null },
            { code: err?.code ?? "X402_AUTHORITY_DELEGATION_SCOPE_ESCALATION" }
          );
        }
      }
      const existingAuthorizationExecutionIntent =
        existingAuthorization?.executionIntent &&
        typeof existingAuthorization.executionIntent === "object" &&
        !Array.isArray(existingAuthorization.executionIntent)
          ? existingAuthorization.executionIntent
          : null;
      if (existingAuthorizationExecutionIntent && parsedExecutionIntent) {
        if (String(existingAuthorizationExecutionIntent.intentHash ?? "").toLowerCase() !== String(parsedExecutionIntent.intentHash ?? "").toLowerCase()) {
          return sendError(
            res,
            409,
            "execution intent conflicts with already-authorized gate intent",
            {
              existingIntentHash: existingAuthorizationExecutionIntent.intentHash ?? null,
              providedIntentHash: parsedExecutionIntent.intentHash ?? null
            },
            { code: "X402_EXECUTION_INTENT_CONFLICT" }
          );
        }
      }
      const expectedPolicyVersion =
        Number.isSafeInteger(Number(resolvedWalletPolicy?.policyVersion)) && Number(resolvedWalletPolicy.policyVersion) > 0
          ? Number(resolvedWalletPolicy.policyVersion)
          : null;
      const expectedPolicyHash =
        typeof resolvedWalletPolicy?.policyFingerprint === "string" && resolvedWalletPolicy.policyFingerprint.trim() !== ""
          ? resolvedWalletPolicy.policyFingerprint.trim().toLowerCase()
          : null;
      const approvalContextBinding = normalizeForCanonicalJson(
        {
          gateId,
          runId,
          settlementId: null,
          delegationGrantRef: effectiveDelegationGrantRef,
          authorityGrantRef: effectiveAuthorityGrantRefInput,
          policyHashSha256: expectedPolicyHash,
          policyVersion: expectedPolicyVersion
        },
        { path: "$.approvalContextBinding" }
      );
      if (delegatedApprovalAction && delegatedApprovalPolicy) {
        const delegatedContextualCheck = enforceHighRiskApproval({
          action: delegatedApprovalAction,
          approvalPolicy: {
            ...delegatedApprovalPolicy,
            requireContextBinding: true
          },
          approvalDecision: delegatedApprovalDecision,
          contextBinding: approvalContextBinding,
          nowIso: () => nowAt
        });
        if (Number.isSafeInteger(delegatedApprovalAuditIndex) && delegatedApprovalAuditIndex >= 0) {
          authorizationApprovalDecisions[delegatedApprovalAuditIndex] = createX402AuthorizationApprovalAuditEntry({
            profile: "delegated_budget_threshold",
            action: delegatedApprovalAction,
            approvalCheck: delegatedContextualCheck,
            approvalDecision: delegatedApprovalDecision,
            checkedAt: nowAt
          });
        }
        if (!delegatedContextualCheck.approved) {
          return sendError(
            res,
            409,
            "delegated budget envelope approval context binding failed",
            {
              gateId,
              envelopeId: delegatedBudgetEnvelope?.envelopeId ?? null,
              approvalCheck: delegatedContextualCheck,
              approvalRequest: delegatedContextualCheck.requiresExplicitApproval
                ? createApprovalRequest({
                    action: delegatedApprovalAction,
                    requestedBy: principalId ?? payerAgentId,
                    requestedAt: nowAt
                  })
                : null
            },
            { code: delegatedContextualCheck.blockingIssues?.[0]?.code ?? "HUMAN_APPROVAL_CONTEXT_BINDING_MISMATCH" }
          );
        }
      }
      if (s8ApprovalAction && s8ApprovalPolicy) {
        const s8ContextualCheck = enforceHighRiskApproval({
          action: s8ApprovalAction,
          approvalPolicy: {
            ...(s8ApprovalPolicy && typeof s8ApprovalPolicy === "object" && !Array.isArray(s8ApprovalPolicy) ? s8ApprovalPolicy : {}),
            requireContextBinding: true
          },
          approvalDecision: s8ApprovalDecision,
          contextBinding: approvalContextBinding,
          nowIso: () => nowAt
        });
        if (Number.isSafeInteger(s8ApprovalAuditIndex) && s8ApprovalAuditIndex >= 0) {
          authorizationApprovalDecisions[s8ApprovalAuditIndex] = createX402AuthorizationApprovalAuditEntry({
            profile: "s8_high_risk",
            action: s8ApprovalAction,
            approvalCheck: s8ContextualCheck,
            approvalDecision: s8ApprovalDecision,
            checkedAt: nowAt
          });
        }
        if (!s8ContextualCheck.approved) {
          return sendError(
            res,
            409,
            "human approval context binding failed for high-risk x402 authorization",
            {
              approvalCheck: s8ContextualCheck,
              approvalRequest: s8ContextualCheck.requiresExplicitApproval
                ? createApprovalRequest({
                    action: s8ApprovalAction,
                    requestedBy: principalId ?? payerAgentId,
                    requestedAt: nowAt
                  })
                : null
            },
            { code: s8ContextualCheck.blockingIssues?.[0]?.code ?? "HUMAN_APPROVAL_CONTEXT_BINDING_MISMATCH" }
          );
        }
      }
      const effectiveExecutionIntentInput = parsedExecutionIntent ?? existingAuthorizationExecutionIntent ?? null;
      if (x402RequireExecutionIntentValue && !effectiveExecutionIntentInput) {
        return sendError(
          res,
          409,
          "execution intent is required for side-effecting authorization",
          null,
          { code: "X402_EXECUTION_INTENT_REQUIRED" }
        );
      }
      let effectiveExecutionIntent = null;
      if (effectiveExecutionIntentInput) {
        try {
          effectiveExecutionIntent = assertX402ExecutionIntentForAuthorization({
            executionIntent: effectiveExecutionIntentInput,
            tenantId,
            payerAgentId,
            runId,
            agreementHash: typeof gate?.agreementHash === "string" ? gate.agreementHash : null,
            quoteId: effectiveQuoteId,
            requestBindingMode: effectiveRequestBindingMode,
            requestBindingSha256: effectiveRequestBindingSha256,
            amountCents,
            currency,
            idempotencyKey: requestIdempotencyKey,
            nowAt,
            expectedPolicyVersion,
            expectedPolicyHash
          });
        } catch (err) {
          const code = typeof err?.code === "string" && err.code.trim() !== "" ? err.code.trim() : "X402_EXECUTION_INTENT_INVALID";
          return sendError(
            res,
            409,
            "execution intent blocked authorization",
            { message: err?.message ?? null, details: err?.details ?? null },
            { code }
          );
        }
      }
      let walletIssuerDecisionPayload = null;
      if (!hasReservedAuthorization && resolvedWalletPolicy) {
        if (!walletAuthorizationDecisionToken) {
          return sendError(
            res,
            409,
            "wallet issuer decision is required for wallet-bound authorization",
            {
              gateId,
              sponsorWalletRef:
                typeof resolvedWalletPolicy?.sponsorWalletRef === "string" && resolvedWalletPolicy.sponsorWalletRef.trim() !== ""
                  ? resolvedWalletPolicy.sponsorWalletRef.trim()
                  : null
            },
            { code: "X402_WALLET_ISSUER_DECISION_REQUIRED" }
          );
        }
        const expectedSponsorRef =
          typeof resolvedWalletPolicy?.sponsorRef === "string" && resolvedWalletPolicy.sponsorRef.trim() !== ""
            ? resolvedWalletPolicy.sponsorRef.trim()
            : typeof gateAgentPassport?.sponsorRef === "string" && gateAgentPassport.sponsorRef.trim() !== ""
              ? gateAgentPassport.sponsorRef.trim()
              : payerAgentId;
        const expectedSponsorWalletRef =
          typeof resolvedWalletPolicy?.sponsorWalletRef === "string" && resolvedWalletPolicy.sponsorWalletRef.trim() !== ""
            ? resolvedWalletPolicy.sponsorWalletRef.trim()
            : null;
        const expectedPolicyRef =
          typeof resolvedWalletPolicy?.policyRef === "string" && resolvedWalletPolicy.policyRef.trim() !== ""
            ? resolvedWalletPolicy.policyRef.trim()
            : null;
        const expectedPolicyVersion =
          Number.isSafeInteger(Number(resolvedWalletPolicy?.policyVersion)) && Number(resolvedWalletPolicy.policyVersion) > 0
            ? Number(resolvedWalletPolicy.policyVersion)
            : null;
        const expectedPolicyFingerprint =
          typeof resolvedWalletPolicy?.policyFingerprint === "string" && resolvedWalletPolicy.policyFingerprint.trim() !== ""
            ? resolvedWalletPolicy.policyFingerprint.trim().toLowerCase()
            : null;
        const issuerDecisionVerify = verifyX402WalletIssuerDecisionTokenV1({
          token: walletAuthorizationDecisionToken,
          publicKeyPem: store.serverSigner.publicKeyPem,
          nowUnixSeconds: nowUnix,
          expected: {
            gateId,
            sponsorRef: expectedSponsorRef,
            sponsorWalletRef: expectedSponsorWalletRef,
            policyRef: expectedPolicyRef,
            policyVersion: expectedPolicyVersion,
            policyFingerprint: expectedPolicyFingerprint,
            amountCents,
            currency,
            payeeProviderId: String(payeeProviderId ?? ""),
            quoteId: effectiveQuoteId,
            quoteSha256: effectiveQuoteSha256,
            requestBindingMode: effectiveRequestBindingMode,
            requestBindingSha256: effectiveRequestBindingSha256
          }
        });
        if (!issuerDecisionVerify?.ok) {
          return sendError(
            res,
            409,
            "wallet issuer decision is invalid",
            {
              message: issuerDecisionVerify?.error ?? null,
              field: issuerDecisionVerify?.field ?? null,
              verifyCode: issuerDecisionVerify?.code ?? null
            },
            { code: issuerDecisionVerify?.code ?? "X402_WALLET_ISSUER_DECISION_INVALID" }
          );
        }
        walletIssuerDecisionPayload = issuerDecisionVerify.payload ?? null;
      }
      let escalationOverridePayload = null;
      if (!hasReservedAuthorization && escalationOverrideToken) {
        if (!resolvedWalletPolicy) {
          return sendError(
            res,
            409,
            "escalation override is not applicable for non-wallet authorization",
            null,
            { code: "X402_ESCALATION_OVERRIDE_NOT_APPLICABLE" }
          );
        }
        const expectedSponsorRef =
          typeof resolvedWalletPolicy?.sponsorRef === "string" && resolvedWalletPolicy.sponsorRef.trim() !== ""
            ? resolvedWalletPolicy.sponsorRef.trim()
            : typeof gateAgentPassport?.sponsorRef === "string" && gateAgentPassport.sponsorRef.trim() !== ""
              ? gateAgentPassport.sponsorRef.trim()
              : payerAgentId;
        const expectedSponsorWalletRef =
          typeof resolvedWalletPolicy?.sponsorWalletRef === "string" && resolvedWalletPolicy.sponsorWalletRef.trim() !== ""
            ? resolvedWalletPolicy.sponsorWalletRef.trim()
            : null;
        const expectedPolicyRef =
          typeof resolvedWalletPolicy?.policyRef === "string" && resolvedWalletPolicy.policyRef.trim() !== ""
            ? resolvedWalletPolicy.policyRef.trim()
            : null;
        const expectedPolicyVersion =
          Number.isSafeInteger(Number(resolvedWalletPolicy?.policyVersion)) && Number(resolvedWalletPolicy.policyVersion) > 0
            ? Number(resolvedWalletPolicy.policyVersion)
            : null;
        const expectedPolicyFingerprint =
          typeof resolvedWalletPolicy?.policyFingerprint === "string" && resolvedWalletPolicy.policyFingerprint.trim() !== ""
            ? resolvedWalletPolicy.policyFingerprint.trim().toLowerCase()
            : null;
        const escalationOverrideVerify = verifyX402EscalationOverrideTokenV1({
          token: escalationOverrideToken,
          publicKeyPem: store.serverSigner.publicKeyPem,
          nowUnixSeconds: nowUnix,
          expected: {
            gateId,
            sponsorRef: expectedSponsorRef,
            sponsorWalletRef: expectedSponsorWalletRef,
            policyRef: expectedPolicyRef,
            policyVersion: expectedPolicyVersion,
            policyFingerprint: expectedPolicyFingerprint,
            amountCents,
            currency,
            payeeProviderId: String(payeeProviderId ?? ""),
            quoteId: effectiveQuoteId,
            quoteSha256: effectiveQuoteSha256,
            requestBindingMode: effectiveRequestBindingMode,
            requestBindingSha256: effectiveRequestBindingSha256
          }
        });
        if (!escalationOverrideVerify?.ok) {
          return sendError(
            res,
            409,
            "escalation override token is invalid",
            {
              message: escalationOverrideVerify?.error ?? null,
              field: escalationOverrideVerify?.field ?? null,
              verifyCode: escalationOverrideVerify?.code ?? null
            },
            { code: escalationOverrideVerify?.code ?? "X402_ESCALATION_OVERRIDE_INVALID" }
          );
        }
        const escalationIdFromToken =
          typeof escalationOverrideVerify?.payload?.escalationId === "string" && escalationOverrideVerify.payload.escalationId.trim() !== ""
            ? escalationOverrideVerify.payload.escalationId.trim()
            : null;
        if (!escalationIdFromToken) {
          return sendError(res, 409, "escalation override missing escalationId", null, { code: "X402_ESCALATION_OVERRIDE_INVALID" });
        }
        const escalationRecord =
          typeof store.getX402Escalation === "function" ? await store.getX402Escalation({ tenantId, escalationId: escalationIdFromToken }) : null;
        if (!escalationRecord) {
          return sendError(res, 409, "escalation override target was not found", null, { code: "X402_ESCALATION_NOT_FOUND" });
        }
        if (String(escalationRecord.status ?? "").toLowerCase() !== "approved") {
          return sendError(res, 409, "escalation is not approved", null, { code: "X402_ESCALATION_NOT_APPROVED" });
        }
        const overrideId =
          typeof escalationOverrideVerify?.payload?.overrideId === "string" && escalationOverrideVerify.payload.overrideId.trim() !== ""
            ? escalationOverrideVerify.payload.overrideId.trim()
            : null;
        if (overrideId && typeof store.getX402EscalationOverrideUsage === "function") {
          const usage = await store.getX402EscalationOverrideUsage({ tenantId, overrideId });
          if (usage) {
            return sendError(
              res,
              409,
              "escalation override token has already been used",
              { overrideId, usedAt: usage.usedAt ?? null, gateId: usage.gateId ?? null },
              { code: "X402_ESCALATION_OVERRIDE_REPLAYED" }
            );
          }
        }
        escalationOverridePayload = escalationOverrideVerify.payload ?? null;
      }
      if (x402PilotKillSwitchValue === true) {
        return sendError(res, 409, "x402 pilot kill switch is active", null, { code: "X402_PILOT_KILL_SWITCH_ACTIVE" });
      }
      if (!hasReservedAuthorization) {
        if (resolvedWalletPolicy && !escalationOverridePayload) {
          try {
            await assertX402WalletPolicyForAuthorization({
              tenantId,
              gate,
              policy: resolvedWalletPolicy,
              amountCents,
              currency,
              payeeProviderId,
              effectiveQuoteId,
              effectiveRequestBindingMode,
              effectiveRequestBindingSha256,
              nowAt
            });
          } catch (err) {
            const escalation = await createX402AuthorizationEscalation({
              tenantId,
              gate,
              policy: resolvedWalletPolicy,
              policyError: err,
              amountCents,
              currency,
              payeeProviderId,
              effectiveQuoteId,
              effectiveQuoteSha256,
              effectiveRequestBindingMode,
              effectiveRequestBindingSha256,
              nowAt
            });
            return sendError(
              res,
              409,
              "x402 wallet policy blocked authorization and requires escalation",
              {
                message: err?.message ?? null,
                code: err?.code ?? null,
                details: err?.details ?? null,
                escalation: escalation ? toX402EscalationSummary(escalation) : null
              },
              { code: "X402_AUTHORIZATION_ESCALATION_REQUIRED" }
            );
          }
        }
        if (
          Array.isArray(x402PilotAllowedProviderIdsValue) &&
          x402PilotAllowedProviderIdsValue.length > 0 &&
          !x402PilotAllowedProviderIdsValue.includes(String(payeeProviderId ?? ""))
        ) {
          return sendError(
            res,
            409,
            "x402 pilot provider is not allowed",
            {
              gateId,
              payeeProviderId,
              allowedProviderIds: x402PilotAllowedProviderIdsValue
            },
            { code: "X402_PILOT_PROVIDER_NOT_ALLOWED" }
          );
        }
        if (
          Number.isSafeInteger(x402PilotMaxAmountCentsValue) &&
          x402PilotMaxAmountCentsValue > 0 &&
          amountCents > x402PilotMaxAmountCentsValue
        ) {
          return sendError(
            res,
            409,
            "x402 pilot single-call amount exceeds limit",
            {
              gateId,
              amountCents,
              maxAmountCents: x402PilotMaxAmountCentsValue
            },
            { code: "X402_PILOT_AMOUNT_LIMIT_EXCEEDED" }
          );
        }
        if (Number.isSafeInteger(x402PilotDailyLimitCentsValue) && x402PilotDailyLimitCentsValue > 0) {
          const dayKey = nowAt.slice(0, 10);
          const currentExposureCents = computeX402DailyAuthorizedExposureCents({ tenantId, dayKey, excludeGateId: gateId });
          const projectedExposureCents = currentExposureCents + amountCents;
          if (projectedExposureCents > x402PilotDailyLimitCentsValue) {
            return sendError(
              res,
              409,
              "x402 pilot daily authorization limit exceeded",
              {
                gateId,
                dayKey,
                amountCents,
                currentExposureCents,
                projectedExposureCents,
                dailyLimitCents: x402PilotDailyLimitCentsValue
              },
              { code: "X402_PILOT_DAILY_LIMIT_EXCEEDED" }
            );
          }
        }
      }
      const authorizationGovernance =
        authorizationBudgetEnvelope ||
        authorizationApprovalDecisions.some((row) => row && typeof row === "object" && !Array.isArray(row))
          ? normalizeForCanonicalJson(
              {
                schemaVersion: X402_AUTHORIZATION_GOVERNANCE_SCHEMA_VERSION,
                ...(authorizationBudgetEnvelope ? { budgetEnvelope: authorizationBudgetEnvelope } : {}),
                approvals: authorizationApprovalDecisions
                  .filter((row) => row && typeof row === "object" && !Array.isArray(row))
                  .map((row) => normalizeForCanonicalJson(row, { path: "$" })),
                evaluatedAt: nowAt
              },
              { path: "$" }
            )
          : existingAuthorization?.governance && typeof existingAuthorization.governance === "object" && !Array.isArray(existingAuthorization.governance)
            ? existingAuthorization.governance
            : null;
      if (hasLiveToken && requestBindingMatchesLiveToken && quoteMatchesLiveToken) {
        const responseBody = {
          gateId,
          authorizationRef,
          expiresAt: new Date(tokenExpiresAtMs).toISOString(),
          token: existingToken.value,
          tokenKid: existingToken.kid ?? null,
          quoteId: effectiveQuoteId,
          quoteSha256: effectiveQuoteSha256,
          sessionRef:
            typeof gate?.sessionRef === "string" && gate.sessionRef.trim() !== ""
              ? gate.sessionRef.trim()
              : sessionPromptRisk.sessionId ?? null,
          delegationGrantRef:
            typeof existingAuthorization?.delegationGrantRef === "string" && existingAuthorization.delegationGrantRef.trim() !== ""
              ? existingAuthorization.delegationGrantRef.trim()
              : typeof gate?.delegationGrantRef === "string" && gate.delegationGrantRef.trim() !== ""
                ? gate.delegationGrantRef.trim()
                : null,
          reserve: {
            amountCents,
            currency,
            mode: existingReserve.mode ?? "transfer",
            circleTransferId: existingReserve.reserveId,
            reserveId: existingReserve.reserveId,
            status: "reserved"
          },
          ...(authorizationGovernance ? { governance: authorizationGovernance } : {})
        };
        if (idemStoreKey) {
          await store.commitTx({
            at: nowAt,
            ops: [{ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody } }]
          });
        }
        return sendJson(res, 200, responseBody);
      }

      if (x402RequireExternalReserveValue && String(circleReserveAdapter?.mode ?? "").toLowerCase() === "stub") {
        return sendError(res, 503, "external reserve unavailable", null, { code: "X402_RESERVE_UNAVAILABLE" });
      }

      let payerWallet = typeof store.getAgentWallet === "function" ? await store.getAgentWallet({ tenantId, agentId: payerAgentId }) : null;
      if (!payerWallet) return sendError(res, 409, "payer wallet missing", null, { code: "WALLET_MISSING" });
      let payerWalletChanged = false;
      let walletEscrowLocked = String(existingWalletEscrow?.status ?? "").toLowerCase() === "locked";

      if (!walletEscrowLocked) {
        try {
          payerWallet = lockAgentWalletEscrow({ wallet: payerWallet, amountCents, at: nowAt });
          payerWalletChanged = true;
          walletEscrowLocked = true;
        } catch (err) {
          if (err?.code === "INSUFFICIENT_WALLET_BALANCE") {
            return sendError(res, 402, "insufficient wallet balance", { message: err?.message }, { code: "INSUFFICIENT_FUNDS" });
          }
          throw err;
        }
      }

      let reserve = existingReserve;
      if (!(reserve && String(reserve.status ?? "").toLowerCase() === "reserved" && typeof reserve.reserveId === "string" && reserve.reserveId.trim() !== "")) {
        try {
          const reserved = await circleReserveAdapter.reserve({
            tenantId,
            gateId,
            amountCents,
            currency,
            idempotencyKey: gateId,
            payerAgentId: gate?.payerAgentId ?? null,
            payeeAgentId: gate?.payeeAgentId ?? null
          });
          reserve = {
            adapter: reserved?.adapter ?? "circle",
            mode: reserved?.mode ?? "transfer",
            reserveId: String(reserved?.reserveId ?? ""),
            status: String(reserved?.status ?? "reserved"),
            reservedAt: reserved?.createdAt ?? nowAt,
            circleTransferId: String(reserved?.reserveId ?? "")
          };
          if (!reserve.reserveId) throw new TypeError("reserveId missing from reserve adapter");
        } catch (err) {
          // Hard guarantee: no reserve means no token. Roll back internal lock to avoid stranded funds.
          try {
            if (walletEscrowLocked) {
              payerWallet = refundAgentWalletEscrow({ wallet: payerWallet, amountCents, at: nowAt });
              payerWalletChanged = true;
              walletEscrowLocked = false;
            }
          } catch {
            // keep original error below
          }
          const failedGate = normalizeForCanonicalJson(
            {
              ...gate,
              authorization: {
                schemaVersion: "X402GateAuthorization.v1",
                authorizationRef,
                status: "failed",
                walletEscrow: {
                  status: walletEscrowLocked ? "locked" : "unlocked",
                  amountCents,
                  currency,
                  lockedAt: existingWalletEscrow?.lockedAt ?? nowAt
                },
                reserve: null,
                token: null,
                lastError: {
                  code: err?.code ?? "X402_RESERVE_FAILED",
                  message: err?.message ?? String(err ?? "")
                },
                updatedAt: nowAt
              },
              updatedAt: nowAt
            },
            { path: "$" }
          );
          const ops = [];
          if (payerWalletChanged) ops.push({ kind: "AGENT_WALLET_UPSERT", tenantId, wallet: payerWallet });
          ops.push({ kind: "X402_GATE_UPSERT", tenantId, gateId, gate: failedGate });
          if (idemStoreKey) {
            ops.push({
              kind: "IDEMPOTENCY_PUT",
              key: idemStoreKey,
              value: {
                requestHash: idemRequestHash,
                statusCode: 503,
                body: { error: "reserve failed", code: "X402_RESERVE_FAILED", details: { message: err?.message ?? String(err ?? "") } }
              }
            });
          }
          await store.commitTx({ at: nowAt, ops });
          return sendError(res, 503, "reserve failed", { message: err?.message ?? String(err ?? "") }, { code: "X402_RESERVE_FAILED" });
        }
      }

      const includeSpendAuthorizationClaims = Boolean(effectiveQuoteId || resolvedWalletPolicy || gateAgentPassport);
      const authorityGrantRef =
        typeof resolvedDelegationLineage?.leafDelegationId === "string" && resolvedDelegationLineage.leafDelegationId.trim() !== ""
          ? resolvedDelegationLineage.leafDelegationId.trim()
          : typeof resolvedDelegationGrant?.grantId === "string" && resolvedDelegationGrant.grantId.trim() !== ""
            ? resolvedDelegationGrant.grantId.trim()
          : typeof resolvedAuthorityGrant?.grantId === "string" && resolvedAuthorityGrant.grantId.trim() !== ""
            ? resolvedAuthorityGrant.grantId.trim()
          : typeof gate?.authorityGrantRef === "string" && gate.authorityGrantRef.trim() !== ""
            ? gate.authorityGrantRef.trim()
          : deriveX402AuthorityGrantRef({
              gateId,
              gateAgentPassport,
              gateAuthorization: existingAuthorization
            });
      const delegationBindingRefs = resolveX402DelegationBindingRefs({
        authorityGrantRef,
        gateAgentPassport,
        gateAuthorization: existingAuthorization,
        resolvedDelegationLineage
      });
      const effectiveAuthorityGrantRef = delegationBindingRefs.effectiveDelegationRef ?? authorityGrantRef;
      const spendAuthorizationDelegationRef =
        effectiveAuthorityGrantRef ??
        `dlg_${sha256Hex(
          canonicalJsonStringify(
            normalizeForCanonicalJson(
              {
                schemaVersion: "X402SpendAuthorizationDelegationSeed.v1",
                gateId,
                authorizationRef
              },
              { path: "$" }
            )
          )
        )}`;
      const hasDelegationBindingRefs = Object.values(delegationBindingRefs).some((value) => value !== null && value !== undefined);
      const authorizationDelegationLineage =
        hasDelegationBindingRefs || resolvedDelegationLineage
          ? normalizeForCanonicalJson(
              {
                ...delegationBindingRefs,
                ...(resolvedDelegationLineage ? { resolution: resolvedDelegationLineage } : {})
              },
              { path: "$" }
            )
          : null;
      const walletPolicyFingerprint =
        resolvedWalletPolicy &&
        typeof resolvedWalletPolicy.policyFingerprint === "string" &&
        resolvedWalletPolicy.policyFingerprint.trim() !== ""
          ? resolvedWalletPolicy.policyFingerprint.trim().toLowerCase()
          : null;
      const walletPolicyVersion =
        resolvedWalletPolicy && Number.isSafeInteger(Number(resolvedWalletPolicy.policyVersion)) && Number(resolvedWalletPolicy.policyVersion) > 0
          ? Number(resolvedWalletPolicy.policyVersion)
          : Number.isSafeInteger(Number(gateAgentPassport?.policyVersion)) && Number(gateAgentPassport.policyVersion) > 0
            ? Number(gateAgentPassport.policyVersion)
            : 1;
      const agentPassportPolicyFingerprint = buildX402AgentPassportPolicyFingerprint(gateAgentPassport);
      const fallbackPolicyFingerprint = includeSpendAuthorizationClaims
        ? sha256Hex(
            canonicalJsonStringify(
              normalizeForCanonicalJson(
                {
                  schemaVersion: "X402SpendPolicyFingerprintSeed.v1",
                  gateId,
                  authorizationRef,
                  payerAgentId,
                  payeeProviderId: String(payeeProviderId ?? ""),
                  quoteId: effectiveQuoteId ?? null,
                  sponsorRef:
                    (typeof resolvedWalletPolicy?.sponsorRef === "string" && resolvedWalletPolicy.sponsorRef.trim() !== ""
                      ? resolvedWalletPolicy.sponsorRef.trim()
                      : typeof gateAgentPassport?.sponsorRef === "string" && gateAgentPassport.sponsorRef.trim() !== ""
                        ? gateAgentPassport.sponsorRef.trim()
                        : payerAgentId) || null,
                  sponsorWalletRef:
                    typeof resolvedWalletPolicy?.sponsorWalletRef === "string" && resolvedWalletPolicy.sponsorWalletRef.trim() !== ""
                      ? resolvedWalletPolicy.sponsorWalletRef.trim()
                      : typeof gateAgentPassport?.sponsorWalletRef === "string" && gateAgentPassport.sponsorWalletRef.trim() !== ""
                        ? gateAgentPassport.sponsorWalletRef.trim()
                        : null
                },
                { path: "$" }
              )
            )
          )
        : null;
      const payload = buildNooterraPayPayloadV1({
        iss: nooterraPayIssuerValue,
        aud: String(gate?.payeeAgentId ?? ""),
        gateId,
        authorizationRef,
        amountCents,
        currency,
        payeeProviderId: String(payeeProviderId ?? ""),
        delegationRef: spendAuthorizationDelegationRef,
        rootDelegationRef: delegationBindingRefs.rootDelegationRef,
        rootDelegationHash: delegationBindingRefs.rootDelegationHash,
        effectiveDelegationRef: delegationBindingRefs.effectiveDelegationRef,
        effectiveDelegationHash: delegationBindingRefs.effectiveDelegationHash,
        ...(effectiveRequestBindingMode
          ? { requestBindingMode: effectiveRequestBindingMode, requestBindingSha256: effectiveRequestBindingSha256 }
          : {}),
        ...(includeSpendAuthorizationClaims
          ? {
              ...(effectiveQuoteId ? { quoteId: effectiveQuoteId, quoteSha256: effectiveQuoteSha256 } : {}),
              idempotencyKey:
                typeof walletIssuerDecisionPayload?.idempotencyKey === "string" && walletIssuerDecisionPayload.idempotencyKey.trim() !== ""
                  ? walletIssuerDecisionPayload.idempotencyKey.trim()
                  : effectiveQuoteId
                    ? `x402:${gateId}:${effectiveQuoteId}`
                    : `x402:${gateId}:${authorizationRef}`,
              nonce:
                typeof walletIssuerDecisionPayload?.nonce === "string" && walletIssuerDecisionPayload.nonce.trim() !== ""
                  ? walletIssuerDecisionPayload.nonce.trim()
                  : createId("x402nonce"),
              sponsorRef:
                (typeof walletIssuerDecisionPayload?.sponsorRef === "string" && walletIssuerDecisionPayload.sponsorRef.trim() !== ""
                  ? walletIssuerDecisionPayload.sponsorRef.trim()
                  : typeof resolvedWalletPolicy?.sponsorRef === "string" && resolvedWalletPolicy.sponsorRef.trim() !== ""
                  ? resolvedWalletPolicy.sponsorRef.trim()
                  : typeof gateAgentPassport?.sponsorRef === "string" && gateAgentPassport.sponsorRef.trim() !== ""
                    ? gateAgentPassport.sponsorRef.trim()
              : payerAgentId) || null,
              sponsorWalletRef:
                typeof walletIssuerDecisionPayload?.sponsorWalletRef === "string" && walletIssuerDecisionPayload.sponsorWalletRef.trim() !== ""
                  ? walletIssuerDecisionPayload.sponsorWalletRef.trim()
                  : typeof resolvedWalletPolicy?.sponsorWalletRef === "string" && resolvedWalletPolicy.sponsorWalletRef.trim() !== ""
                  ? resolvedWalletPolicy.sponsorWalletRef.trim()
                  : typeof gateAgentPassport?.sponsorWalletRef === "string" && gateAgentPassport.sponsorWalletRef.trim() !== ""
                    ? gateAgentPassport.sponsorWalletRef.trim()
                  : null,
              agentKeyId:
                (typeof gateAgentPassport?.agentKeyId === "string" && gateAgentPassport.agentKeyId.trim() !== ""
                  ? gateAgentPassport.agentKeyId.trim()
                  : payerAgentId) || null,
              policyVersion:
                Number.isSafeInteger(Number(walletIssuerDecisionPayload?.policyVersion)) && Number(walletIssuerDecisionPayload.policyVersion) > 0
                  ? Number(walletIssuerDecisionPayload.policyVersion)
                  : walletPolicyVersion,
              policyFingerprint:
                typeof walletIssuerDecisionPayload?.policyFingerprint === "string" && walletIssuerDecisionPayload.policyFingerprint.trim() !== ""
                  ? walletIssuerDecisionPayload.policyFingerprint.trim().toLowerCase()
                  : walletPolicyFingerprint ?? agentPassportPolicyFingerprint ?? fallbackPolicyFingerprint
            }
          : {}),
        iat: nowUnix,
        exp: nowUnix + nooterraPayTokenTtlSecondsValue
      });
      const minted = mintNooterraPayTokenV1({
        payload,
        keyId: store.serverSigner.keyId,
        publicKeyPem: store.serverSigner.publicKeyPem,
        privateKeyPem: store.serverSigner.privateKeyPem
      });
      const expiresAt = new Date(payload.exp * 1000).toISOString();

      const nextGate = normalizeForCanonicalJson(
        {
          ...gate,
          ...(sessionPromptRisk.sessionId ? { sessionRef: sessionPromptRisk.sessionId } : {}),
          ...(promptRiskEvaluation.nextState ? { promptRisk: promptRiskEvaluation.nextState } : {}),
          authorization: {
            schemaVersion: "X402GateAuthorization.v1",
            authorizationRef,
            status: "reserved",
            authorityGrantRef: effectiveAuthorityGrantRef,
            delegationGrantRef:
              typeof resolvedDelegationGrant?.grantId === "string" && resolvedDelegationGrant.grantId.trim() !== ""
                ? resolvedDelegationGrant.grantId.trim()
                : typeof gate?.delegationGrantRef === "string" && gate.delegationGrantRef.trim() !== ""
                  ? gate.delegationGrantRef.trim()
                  : typeof existingAuthorization?.delegationGrantRef === "string" && existingAuthorization.delegationGrantRef.trim() !== ""
                    ? existingAuthorization.delegationGrantRef.trim()
                    : null,
            ...(authorizationDelegationLineage ? { delegationLineage: authorizationDelegationLineage } : {}),
            ...(effectiveExecutionIntent ? { executionIntent: effectiveExecutionIntent } : {}),
            ...(authorizationGovernance ? { governance: authorizationGovernance } : {}),
            walletEscrow: {
              status: walletEscrowLocked ? "locked" : "unlocked",
              amountCents,
              currency,
              lockedAt: existingWalletEscrow?.lockedAt ?? nowAt
            },
            reserve: {
              adapter: reserve.adapter ?? "circle",
              mode: reserve.mode ?? "transfer",
              reserveId: reserve.reserveId,
              status: "reserved",
              reservedAt: reserve.reservedAt ?? nowAt,
              circleTransferId: reserve.circleTransferId ?? reserve.reserveId
            },
            quote:
              selectedQuote && typeof selectedQuote === "object" && !Array.isArray(selectedQuote)
                ? {
                    quoteId: effectiveQuoteId,
                    quoteSha256: effectiveQuoteSha256,
                    expiresAt: selectedQuote.expiresAt ?? null,
                    requestBindingMode: selectedQuote.requestBindingMode ?? null,
                    requestBindingSha256: selectedQuote.requestBindingSha256 ?? null
                  }
                : null,
            token: {
              value: minted.token,
              kid: minted.kid,
              sha256: minted.tokenSha256,
              issuedAt: nowAt,
              expiresAt
            },
            updatedAt: nowAt
          },
          updatedAt: nowAt
        },
        { path: "$" }
      );

      const responseBody = {
        gateId,
        authorizationRef,
        expiresAt,
        token: minted.token,
        tokenKid: minted.kid,
        quoteId: effectiveQuoteId,
        quoteSha256: effectiveQuoteSha256,
        sessionRef: sessionPromptRisk.sessionId ?? null,
        authorityGrantRef: effectiveAuthorityGrantRef,
        delegationGrantRef:
          typeof resolvedDelegationGrant?.grantId === "string" && resolvedDelegationGrant.grantId.trim() !== ""
            ? resolvedDelegationGrant.grantId.trim()
            : null,
        reserve: {
          amountCents,
          currency,
          mode: reserve.mode ?? "transfer",
          circleTransferId: reserve.circleTransferId ?? reserve.reserveId,
          reserveId: reserve.reserveId,
          status: "reserved"
        },
        ...(authorizationGovernance ? { governance: authorizationGovernance } : {})
      };

      const ops = [];
      if (payerWalletChanged) ops.push({ kind: "AGENT_WALLET_UPSERT", tenantId, wallet: payerWallet });
      ops.push({ kind: "X402_GATE_UPSERT", tenantId, gateId, gate: nextGate });
      const overrideIdForUsage =
        typeof escalationOverridePayload?.overrideId === "string" && escalationOverridePayload.overrideId.trim() !== ""
          ? escalationOverridePayload.overrideId.trim()
          : null;
      if (overrideIdForUsage) {
        ops.push({
          kind: "X402_ESCALATION_OVERRIDE_USAGE_PUT",
          tenantId,
          overrideId: overrideIdForUsage,
          usage: normalizeForCanonicalJson(
            {
              schemaVersion: "X402EscalationOverrideUsage.v1",
              overrideId: overrideIdForUsage,
              escalationId:
                typeof escalationOverridePayload?.escalationId === "string" && escalationOverridePayload.escalationId.trim() !== ""
                  ? escalationOverridePayload.escalationId.trim()
                  : null,
              gateId,
              authorizationRef,
              usedAt: nowAt
            },
            { path: "$" }
          )
        });
      }
      if (idemStoreKey) {
        ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody } });
      }
      await store.commitTx({ at: nowAt, ops });
      return sendJson(res, 200, responseBody);
    }

    if (parts[0] === "x402" && parts[1] === "gate" && parts[2] === "verify" && parts.length === 3 && req.method === "POST") {
      if (!requireProtocolHeaderForWrite(req, res)) return;

      const body = await readJsonBody(req);
      let promptRiskSignals = null;
      try {
        promptRiskSignals = normalizeX402PromptRiskSignalsInput(
          body?.promptRiskSignals ?? body?.riskSignals ?? null,
          { fieldName: "promptRiskSignals", allowNull: true }
        );
      } catch (err) {
        return sendError(res, 400, "invalid promptRiskSignals", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let promptRiskOverride = null;
      try {
        promptRiskOverride = normalizeX402PromptRiskOverrideInput(
          body?.promptRiskOverride ?? body?.riskOverride ?? null,
          { fieldName: "promptRiskOverride", allowNull: true }
        );
      } catch (err) {
        return sendError(res, 400, "invalid promptRiskOverride", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let sessionRef = null;
      try {
        sessionRef = parseX402SessionRefInput(
          body?.sessionRef ?? body?.sessionId ?? body?.collaborationSessionId ?? null,
          { fieldName: "sessionRef", allowNull: true }
        );
      } catch (err) {
        return sendError(res, 400, "invalid sessionRef", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
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

      const gateId = typeof body?.gateId === "string" && body.gateId.trim() !== "" ? body.gateId.trim() : null;
      if (!gateId) return sendError(res, 400, "gateId is required", null, { code: "SCHEMA_INVALID" });
      const gate = typeof store.getX402Gate === "function" ? await store.getX402Gate({ tenantId, gateId }) : null;
      if (!gate) return sendError(res, 404, "gate not found", null, { code: "NOT_FOUND" });

      const runId = String(gate.runId ?? "");
      const settlement = typeof store.getAgentRunSettlement === "function" ? await store.getAgentRunSettlement({ tenantId, runId }) : null;
      if (!settlement) return sendError(res, 404, "settlement not found for gate", null, { code: "NOT_FOUND" });

      if (String(settlement.status ?? "").toLowerCase() !== "locked") {
        return sendJson(res, 200, { ok: true, gate, settlement, alreadyResolved: true });
      }
      const lifecycleCheckAt = nowIso();
      const payerAgentIdForLifecycle =
        typeof gate?.payerAgentId === "string" && gate.payerAgentId.trim() !== "" ? gate.payerAgentId.trim() : null;
      if (!payerAgentIdForLifecycle) return sendError(res, 409, "gate payer missing", null, { code: "X402_GATE_INVALID" });
      const payerLifecycle = await blockIfX402AgentLifecycleInactive({
        tenantId,
        agentId: payerAgentIdForLifecycle,
        role: "payer"
      });
      if (payerLifecycle.blocked) {
        return sendError(res, payerLifecycle.httpStatus, payerLifecycle.message, payerLifecycle.details, {
          code: payerLifecycle.code
        });
      }
      const payerSignerLifecycle = await evaluateGrantParticipantSignerLifecycleAt({
        tenantId,
        agentId: payerAgentIdForLifecycle,
        at: lifecycleCheckAt
      });
      if (!payerSignerLifecycle.ok) {
        return sendError(
          res,
          409,
          "payer signer key lifecycle blocked verification",
          buildGrantParticipantSignerLifecycleDetails({
            operation: "x402_gate.verify",
            role: "payer",
            agentId: payerAgentIdForLifecycle,
            signerKeyId: payerSignerLifecycle.signerKeyId ?? null,
            at: lifecycleCheckAt,
            lifecycle: payerSignerLifecycle.lifecycle ?? null
          }),
          { code: "X402_AGENT_SIGNER_KEY_INVALID" }
        );
      }
      const payeeProviderIdForLifecycle =
        typeof gate?.payeeAgentId === "string" && gate.payeeAgentId.trim() !== ""
          ? gate.payeeAgentId.trim()
          : typeof gate?.terms?.providerId === "string" && gate.terms.providerId.trim() !== ""
            ? gate.terms.providerId.trim()
            : null;
      if (payeeProviderIdForLifecycle) {
        const payeeLifecycle = await blockIfX402AgentLifecycleInactive({
          tenantId,
          agentId: payeeProviderIdForLifecycle,
          role: "payee"
        });
        if (payeeLifecycle.blocked) {
          return sendError(res, payeeLifecycle.httpStatus, payeeLifecycle.message, payeeLifecycle.details, {
            code: payeeLifecycle.code
          });
        }
        const payeeSignerLifecycle = await evaluateGrantParticipantSignerLifecycleAt({
          tenantId,
          agentId: payeeProviderIdForLifecycle,
          at: lifecycleCheckAt
        });
        if (!payeeSignerLifecycle.ok) {
          return sendError(
            res,
            409,
            "payee signer key lifecycle blocked verification",
            buildGrantParticipantSignerLifecycleDetails({
              operation: "x402_gate.verify",
              role: "payee",
              agentId: payeeProviderIdForLifecycle,
              signerKeyId: payeeSignerLifecycle.signerKeyId ?? null,
              at: lifecycleCheckAt,
              lifecycle: payeeSignerLifecycle.lifecycle ?? null
            }),
            { code: "X402_AGENT_SIGNER_KEY_INVALID" }
          );
        }
      }
      const settlementAmountCents = Number(settlement?.amountCents ?? gate?.terms?.amountCents ?? 0);
      const sessionPromptRisk = await resolveSessionPromptRiskSignalsForX402({
        tenantId,
        sessionRef:
          sessionRef ??
          (typeof gate?.sessionRef === "string" && gate.sessionRef.trim() !== "" ? gate.sessionRef.trim() : null),
        amountCents: settlementAmountCents
      });
      if (!sessionPromptRisk.ok) {
        return sendError(
          res,
          sessionPromptRisk.httpStatus ?? 409,
          sessionPromptRisk.message ?? "session provenance invalid",
          sessionPromptRisk.details ?? null,
          { code: sessionPromptRisk.code ?? "X402_SESSION_PROVENANCE_INVALID" }
        );
      }
      const effectivePromptRiskSignals = mergeX402PromptRiskSignals(promptRiskSignals, sessionPromptRisk.promptRiskSignals);
      const promptRiskEvaluationAt = nowIso();
      const promptRiskEvaluation = evaluateX402PromptRiskGuardrail({
        gate,
        principalId,
        promptRiskSignals: effectivePromptRiskSignals,
        promptRiskOverride,
        forcedModeOverride: sessionPromptRisk.forcedMode,
        at: promptRiskEvaluationAt
      });

      const gateAgentPassport =
        gate?.agentPassport && typeof gate.agentPassport === "object" && !Array.isArray(gate.agentPassport) ? gate.agentPassport : null;
      if (x402RequireAgentPassportValue) {
        try {
          assertX402AgentPassportForPrivilegedAction({
            tenantId,
            payerAgentId: typeof gate?.payerAgentId === "string" ? gate.payerAgentId : null,
            gateAgentPassport,
            nowAt: nowIso(),
            requireProtocolEnvelope: true
          });
        } catch (err) {
          const code = typeof err?.code === "string" && err.code.trim() !== "" ? err.code.trim() : "X402_AGENT_PASSPORT_INVALID";
          return sendError(
            res,
            409,
            "agent passport is required and must be active for x402 verification",
            {
              message: err?.message ?? null,
              details: err?.details ?? null
            },
            { code }
          );
        }
      }

      const gateAuthorization =
        gate?.authorization && typeof gate.authorization === "object" && !Array.isArray(gate.authorization) ? gate.authorization : null;
      const authorizedForSettlement =
        String(gateAuthorization?.status ?? "").toLowerCase() === "reserved" &&
        String(gateAuthorization?.reserve?.status ?? "").toLowerCase() === "reserved" &&
        typeof gateAuthorization?.reserve?.reserveId === "string" &&
        gateAuthorization.reserve.reserveId.trim() !== "" &&
        typeof gateAuthorization?.token?.value === "string" &&
        gateAuthorization.token.value.trim() !== "";
      if (!authorizedForSettlement) {
        return sendError(res, 409, "payment not authorized", null, { code: "X402_PAYMENT_NOT_AUTHORIZED" });
      }

      // Optional: if this gate is bound to an agreementHash, enforce that the delegation graph
      // is acyclic before allowing funds to be released/refunded.
      const gateAgreementHashRaw = gate?.agreementHash ?? null;
      if (gateAgreementHashRaw) {
        let gateAgreementHash = null;
        try {
          gateAgreementHash = normalizeSha256HashInput(gateAgreementHashRaw, "gate.agreementHash", { allowNull: false });
        } catch (err) {
          return sendError(res, 409, "invalid gate agreementHash", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }

        let delegations = [];
        try {
          const collected = [];
          const seen = new Set();
          let cursor = gateAgreementHash;
          for (let i = 0; i < 256; i += 1) {
            if (seen.has(cursor)) break;
            seen.add(cursor);

            const rows = typeof store.listAgreementDelegations === "function"
              ? await store.listAgreementDelegations({ tenantId, childAgreementHash: cursor, status: null, limit: 1000, offset: 0 })
              : [];
            const list = Array.isArray(rows) ? rows : [];
            for (const row of list) collected.push(row);
            if (list.length !== 1) break;

            const parent = list[0]?.parentAgreementHash;
            if (typeof parent !== "string" || parent.trim() === "") break;
            cursor = parent.trim().toLowerCase();
          }
          delegations = collected;
        } catch (err) {
          return sendError(res, 500, "failed to load agreement delegations", { message: err?.message }, { code: "STORE_READ_FAILED" });
        }

        try {
          cascadeSettlementCheck({ delegations, fromChildHash: gateAgreementHash });
        } catch (err) {
          const stableCode =
            typeof err?.code === "string" && err.code.trim() !== "" ? err.code : "CASCADE_SETTLEMENT_CHECK_FAILED";
          return sendError(
            res,
            409,
            "cascade settlement check failed",
            {
              message: err?.message ?? String(err ?? ""),
              code: err?.code ?? null,
              agreementHash: gateAgreementHash,
              childAgreementHash: err?.childAgreementHash ?? null,
              cycleAgreementHash: err?.agreementHash ?? null
            },
            { code: stableCode }
          );
        }
      }

      const evidenceRefs = Array.isArray(body?.evidenceRefs) ? body.evidenceRefs.map((v) => String(v ?? "").trim()).filter(Boolean) : [];
      const requestEvidenceSha256 = parseEvidenceRefSha256(evidenceRefs, "http:request_sha256:");
      const responseEvidenceSha256 = parseEvidenceRefSha256(evidenceRefs, "http:response_sha256:");
      let resolvedWalletPolicy = null;
      if (gateAgentPassport) {
        const walletPolicyResolution = await resolveX402WalletPolicyForPassport({
          tenantId,
          gateAgentPassport
        });
        if (walletPolicyResolution?.error) {
          return sendError(
            res,
            409,
            "x402 wallet policy reference is invalid",
            {
              message: walletPolicyResolution.error.message ?? null,
              sponsorWalletRef: walletPolicyResolution.sponsorWalletRef ?? null
            },
            { code: walletPolicyResolution.error.code ?? "X402_WALLET_POLICY_REFERENCE_INVALID" }
          );
        }
        resolvedWalletPolicy = walletPolicyResolution?.policy ?? null;
        if (resolvedWalletPolicy) {
          const policyStatus = String(resolvedWalletPolicy.status ?? "active").toLowerCase();
          if (policyStatus !== "active") {
            return sendError(res, 409, "x402 wallet policy is disabled", null, { code: "X402_WALLET_POLICY_DISABLED" });
          }
        }
      }
      const policyRequiresZkProof = resolvedWalletPolicy?.requiresZkProof === true;
      const policyZkProofProtocol =
        typeof resolvedWalletPolicy?.zkProofProtocol === "string" && resolvedWalletPolicy.zkProofProtocol.trim() !== ""
          ? resolvedWalletPolicy.zkProofProtocol.trim().toLowerCase()
          : null;
      const policyZkVerificationKeyRef =
        typeof resolvedWalletPolicy?.zkVerificationKeyRef === "string" && resolvedWalletPolicy.zkVerificationKeyRef.trim() !== ""
          ? resolvedWalletPolicy.zkVerificationKeyRef.trim()
          : null;
      let policyVerificationKey =
        resolvedWalletPolicy?.verificationKey && typeof resolvedWalletPolicy.verificationKey === "object" && !Array.isArray(resolvedWalletPolicy.verificationKey)
          ? resolvedWalletPolicy.verificationKey
          : null;
      const enqueueZkProofAutoVoid = async (reasonCode) => {
        const payerAgentIdForVoid =
          typeof settlement?.payerAgentId === "string" && settlement.payerAgentId.trim() !== ""
            ? settlement.payerAgentId.trim()
            : typeof gate?.payerAgentId === "string" && gate.payerAgentId.trim() !== ""
              ? gate.payerAgentId.trim()
              : null;
        if (!payerAgentIdForVoid) return;
        if (gateHasTerminalX402Reversal(gate)) return;
        const dispatchState = readX402ReversalDispatchState(gate);
        if (dispatchState?.status === "queued" || dispatchState?.status === "completed") return;
        const nowAt = nowIso();
        const outboxMessage = buildX402WinddownReversalOutboxMessage({
          tenantId,
          agentId: payerAgentIdForVoid,
          gateId,
          runId,
          reasonCode,
          source: "x402_zk_proof_verification_v1",
          at: nowAt
        });
        const gateWithDispatch = markX402ReversalDispatchQueued({ gate, message: outboxMessage, at: nowAt });
        await store.commitTx({
          at: nowAt,
          ops: [
            { kind: "X402_GATE_UPSERT", tenantId, gateId, gate: gateWithDispatch },
            { kind: "OUTBOX_ENQUEUE", messages: [outboxMessage] }
          ]
        });
      };
      if (policyZkVerificationKeyRef) {
        const referencedVerificationKey = await getX402ZkVerificationKeyRecord({
          tenantId,
          verificationKeyId: policyZkVerificationKeyRef
        });
        if (!referencedVerificationKey) {
          try {
            await enqueueZkProofAutoVoid("X402_INVALID_VERIFICATION_KEY_REF");
          } catch (err) {
            logger.warn("x402.zk_proof.auto_void_enqueue_failed", {
              tenantId,
              gateId,
              runId,
              reasonCode: "X402_INVALID_VERIFICATION_KEY_REF",
              err: err?.message ?? String(err ?? "")
            });
          }
          return sendError(res, 400, "referenced zk verification key was not found", null, { code: "X402_INVALID_VERIFICATION_KEY_REF" });
        }
        const referencedProtocol =
          typeof referencedVerificationKey.protocol === "string" && referencedVerificationKey.protocol.trim() !== ""
            ? referencedVerificationKey.protocol.trim().toLowerCase()
            : null;
        if (policyZkProofProtocol && referencedProtocol && policyZkProofProtocol !== referencedProtocol) {
          try {
            await enqueueZkProofAutoVoid("X402_INVALID_VERIFICATION_KEY_REF");
          } catch (err) {
            logger.warn("x402.zk_proof.auto_void_enqueue_failed", {
              tenantId,
              gateId,
              runId,
              reasonCode: "X402_INVALID_VERIFICATION_KEY_REF",
              err: err?.message ?? String(err ?? "")
            });
          }
          return sendError(
            res,
            400,
            "zk verification key protocol mismatch",
            { policyProtocol: policyZkProofProtocol, verificationKeyProtocol: referencedProtocol },
            { code: "X402_INVALID_VERIFICATION_KEY_REF" }
          );
        }
        policyVerificationKey =
          referencedVerificationKey.verificationKey &&
          typeof referencedVerificationKey.verificationKey === "object" &&
          !Array.isArray(referencedVerificationKey.verificationKey)
            ? referencedVerificationKey.verificationKey
            : null;
      }
      let executionProof = null;
      try {
        executionProof = normalizeOptionalX402ExecutionProofV1(body?.proof ?? null, "proof");
      } catch (err) {
        return sendError(res, 400, "invalid proof payload", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (policyRequiresZkProof && !executionProof) {
        try {
          await enqueueZkProofAutoVoid("X402_MISSING_REQUIRED_PROOF");
        } catch (err) {
          logger.warn("x402.zk_proof.auto_void_enqueue_failed", {
            tenantId,
            gateId,
            runId,
            reasonCode: "X402_MISSING_REQUIRED_PROOF",
            err: err?.message ?? String(err ?? "")
          });
        }
        return sendError(res, 400, "required zk proof is missing", null, { code: "X402_MISSING_REQUIRED_PROOF" });
      }
      const expectedStatementHashSha256 =
        typeof gateAuthorization?.quote?.quoteSha256 === "string" && gateAuthorization.quote.quoteSha256.trim() !== ""
          ? gateAuthorization.quote.quoteSha256.trim().toLowerCase()
          : typeof gate?.quote?.quoteSha256 === "string" && gate.quote.quoteSha256.trim() !== ""
            ? gate.quote.quoteSha256.trim().toLowerCase()
            : null;
      const executionProofVerification = await verifyX402ExecutionProofV1({
        proof: executionProof,
        verificationKey: policyVerificationKey,
        expectedVerificationKeyRef: policyZkVerificationKeyRef,
        requiredProtocol: policyZkProofProtocol,
        expectedBindings: {
          statementHashSha256: expectedStatementHashSha256,
          inputDigestSha256: requestEvidenceSha256,
          outputDigestSha256: responseEvidenceSha256
        },
        requireBindings: policyRequiresZkProof
      });
      if (policyRequiresZkProof && executionProofVerification?.verified !== true) {
        try {
          await enqueueZkProofAutoVoid("X402_INVALID_CRYPTOGRAPHIC_PROOF");
        } catch (err) {
          logger.warn("x402.zk_proof.auto_void_enqueue_failed", {
            tenantId,
            gateId,
            runId,
            reasonCode: "X402_INVALID_CRYPTOGRAPHIC_PROOF",
            err: err?.message ?? String(err ?? "")
          });
        }
        return sendError(
          res,
          403,
          "invalid cryptographic proof",
          {
            verifyStatus: executionProofVerification?.status ?? null,
            verifyCode: executionProofVerification?.code ?? null,
            verifyMessage: executionProofVerification?.message ?? null
          },
          { code: "X402_INVALID_CRYPTOGRAPHIC_PROOF" }
        );
      }
      const executionProofVerificationKey =
        policyVerificationKey ??
        (executionProof?.verificationKey && typeof executionProof.verificationKey === "object" && !Array.isArray(executionProof.verificationKey)
          ? executionProof.verificationKey
          : null);
      const executionProofVerificationKeyRef =
        policyZkVerificationKeyRef ??
        (typeof executionProof?.verificationKeyRef === "string" && executionProof.verificationKeyRef.trim() !== ""
          ? executionProof.verificationKeyRef.trim()
          : null);
      const executionProofEvidence =
        executionProof ||
        policyRequiresZkProof ||
        (typeof policyZkProofProtocol === "string" && policyZkProofProtocol.trim() !== "") ||
        (typeof executionProofVerificationKeyRef === "string" && executionProofVerificationKeyRef.trim() !== "")
          ? normalizeForCanonicalJson(
              {
                schemaVersion: "X402ReceiptZkProofEvidence.v1",
                required: policyRequiresZkProof === true,
                present: Boolean(executionProof),
                protocol:
                  typeof executionProof?.protocol === "string" && executionProof.protocol.trim() !== ""
                    ? executionProof.protocol.trim().toLowerCase()
                    : typeof policyZkProofProtocol === "string" && policyZkProofProtocol.trim() !== ""
                      ? policyZkProofProtocol.trim().toLowerCase()
                      : null,
                verificationKeyRef: executionProofVerificationKeyRef ?? null,
                verificationKey:
                  executionProofVerificationKey && typeof executionProofVerificationKey === "object" && !Array.isArray(executionProofVerificationKey)
                    ? executionProofVerificationKey
                    : null,
                statementHashSha256:
                  typeof executionProof?.statementHashSha256 === "string" && executionProof.statementHashSha256.trim() !== ""
                    ? executionProof.statementHashSha256.trim().toLowerCase()
                    : expectedStatementHashSha256 ?? null,
                inputDigestSha256:
                  typeof executionProof?.inputDigestSha256 === "string" && executionProof.inputDigestSha256.trim() !== ""
                    ? executionProof.inputDigestSha256.trim().toLowerCase()
                    : requestEvidenceSha256 ?? null,
                outputDigestSha256:
                  typeof executionProof?.outputDigestSha256 === "string" && executionProof.outputDigestSha256.trim() !== ""
                    ? executionProof.outputDigestSha256.trim().toLowerCase()
                    : responseEvidenceSha256 ?? null,
                publicSignals: Array.isArray(executionProof?.publicSignals) ? executionProof.publicSignals : [],
                proofData:
                  executionProof?.proofData && typeof executionProof.proofData === "object" && !Array.isArray(executionProof.proofData)
                    ? executionProof.proofData
                    : null,
                verification:
                  executionProofVerification && typeof executionProofVerification === "object" && !Array.isArray(executionProofVerification)
                    ? normalizeForCanonicalJson(
                        {
                          status:
                            typeof executionProofVerification.status === "string" && executionProofVerification.status.trim() !== ""
                              ? executionProofVerification.status.trim()
                              : null,
                          verified: executionProofVerification.verified === true,
                          code:
                            typeof executionProofVerification.code === "string" && executionProofVerification.code.trim() !== ""
                              ? executionProofVerification.code.trim()
                              : null,
                          message:
                            typeof executionProofVerification.message === "string" && executionProofVerification.message.trim() !== ""
                              ? executionProofVerification.message.trim()
                              : null,
                          details:
                            executionProofVerification.details &&
                            typeof executionProofVerification.details === "object" &&
                            !Array.isArray(executionProofVerification.details)
                              ? executionProofVerification.details
                              : null
                        },
                        { path: "$" }
                      )
                    : null
              },
              { path: "$" }
            )
          : null;

      let verificationStatus = body?.verificationStatus ?? "amber";
      let runStatus = body?.runStatus ?? "completed";
      const extraReasonCodes = new Set();
      if (executionProof && executionProofVerification?.code) {
        extraReasonCodes.add(String(executionProofVerification.code));
      }
      if (Array.isArray(body?.verificationCodes)) {
        for (const c of body.verificationCodes) {
          const code = typeof c === "string" ? c.trim() : "";
          if (code) extraReasonCodes.add(code);
        }
      }

      // Optional: enforce provider signature correctness when the caller declares this verification source.
      const verificationSourceRaw =
        body?.verificationMethod && typeof body.verificationMethod === "object" && !Array.isArray(body.verificationMethod)
          ? body.verificationMethod.source
          : null;
      const verificationSource = typeof verificationSourceRaw === "string" ? verificationSourceRaw.trim() : null;
        if (verificationSource === "provider_signature_v1") {
          const ps = body?.providerSignature ?? null;
          const pinnedPublicKeyPem =
            typeof gate?.providerKey?.publicKeyPem === "string" && gate.providerKey.publicKeyPem.trim() !== ""
              ? gate.providerKey.publicKeyPem
              : null;
          const publicKeyPem = pinnedPublicKeyPem
            ? pinnedPublicKeyPem
            : typeof ps?.publicKeyPem === "string" && ps.publicKeyPem.trim() !== ""
                ? ps.publicKeyPem
                : null;
          if (!ps || typeof ps !== "object" || Array.isArray(ps) || !publicKeyPem) {
            extraReasonCodes.add("X402_PROVIDER_SIGNATURE_MISSING");
            verificationStatus = "red";
            runStatus = "failed";
        } else {
          // Ensure the signature binds to the response hash we claim.
          const responseHash = typeof ps.responseHash === "string" ? ps.responseHash.trim().toLowerCase() : null;
          const hasResponseRef = responseHash ? evidenceRefs.includes(`http:response_sha256:${responseHash}`) : false;
          if (responseHash && !hasResponseRef) {
            extraReasonCodes.add("X402_PROVIDER_RESPONSE_HASH_MISMATCH");
            verificationStatus = "red";
            runStatus = "failed";
          } else {
            const sig = { ...ps };
            delete sig.publicKeyPem;
            // Fill payloadHash if absent so verification doesn't depend on caller precomputing it.
            if (typeof sig.payloadHash !== "string" || sig.payloadHash.trim() === "") {
              try {
                sig.payloadHash = computeToolProviderSignaturePayloadHashV1({
                  responseHash: sig.responseHash,
                  nonce: sig.nonce,
                  signedAt: sig.signedAt
                });
              } catch {}
            }
            let ok = false;
            try {
              ok = verifyToolProviderSignatureV1({ signature: sig, publicKeyPem });
            } catch {
              ok = false;
            }
            if (!ok) {
              extraReasonCodes.add("X402_PROVIDER_SIGNATURE_INVALID");
              verificationStatus = "red";
              runStatus = "failed";
            }
          }
        }
      }

      let policyDecision;
      try {
        policyDecision = evaluateSettlementPolicy({
          policy: body?.policy ?? {},
          verificationMethod: body?.verificationMethod ?? {},
          verificationStatus,
          runStatus,
          amountCents: Number(settlement.amountCents)
        });
      } catch (err) {
        return sendError(res, 400, "invalid verification/policy inputs", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const policyDecisionVerificationStatus = String(policyDecision?.verificationStatus ?? "").trim().toLowerCase();
      const policyDecisionReleaseAmountCents = Number(policyDecision?.releaseAmountCents ?? 0);
      const policyDecisionRefundAmountCents = Number(policyDecision?.refundAmountCents ?? 0);
      const settlementAmountCentsForDecision = Number(settlement.amountCents ?? Number.NaN);
      if (
        !Number.isSafeInteger(policyDecisionReleaseAmountCents) ||
        policyDecisionReleaseAmountCents < 0 ||
        !Number.isSafeInteger(policyDecisionRefundAmountCents) ||
        policyDecisionRefundAmountCents < 0 ||
        !Number.isSafeInteger(settlementAmountCentsForDecision) ||
        settlementAmountCentsForDecision <= 0 ||
        policyDecisionReleaseAmountCents + policyDecisionRefundAmountCents !== settlementAmountCentsForDecision
      ) {
        return sendError(
          res,
          409,
          "settlement policy produced inconsistent economics",
          {
            gateId,
            releaseAmountCents: Number.isFinite(policyDecisionReleaseAmountCents) ? policyDecisionReleaseAmountCents : null,
            refundAmountCents: Number.isFinite(policyDecisionRefundAmountCents) ? policyDecisionRefundAmountCents : null,
            settlementAmountCents: Number.isFinite(settlementAmountCentsForDecision) ? settlementAmountCentsForDecision : null
          },
          { code: "X402_SETTLEMENT_POLICY_INVALID" }
        );
      }
      if (policyDecision?.shouldAutoResolve !== true) {
        return sendError(
          res,
          409,
          "x402 settlement requires manual review",
          {
            gateId,
            verificationStatus: policyDecisionVerificationStatus || null,
            runStatus: String(policyDecision?.runStatus ?? "").trim().toLowerCase() || null,
            settlementStatus: String(policyDecision?.settlementStatus ?? "").trim().toLowerCase() || null,
            releaseAmountCents: policyDecisionReleaseAmountCents,
            refundAmountCents: policyDecisionRefundAmountCents,
            reasonCodes: Array.isArray(policyDecision?.reasonCodes) ? policyDecision.reasonCodes : []
          },
          { code: "X402_SETTLEMENT_MANUAL_REVIEW_REQUIRED" }
        );
      }
      if (policyDecisionReleaseAmountCents > 0 && policyDecisionVerificationStatus !== "green") {
        return sendError(
          res,
          409,
          "x402 capture requires green verification",
          {
            gateId,
            verificationStatus: policyDecisionVerificationStatus || null,
            settlementStatus: String(policyDecision?.settlementStatus ?? "").trim().toLowerCase() || null,
            releaseAmountCents: policyDecisionReleaseAmountCents,
            refundAmountCents: policyDecisionRefundAmountCents
          },
          { code: "X402_CAPTURE_REQUIRES_GREEN_VERIFICATION" }
        );
      }
      if (
        policyDecision?.settlementStatus === AGENT_RUN_SETTLEMENT_STATUS.RELEASED &&
        promptRiskEvaluation.blocked
      ) {
        if (promptRiskEvaluation.changed && promptRiskEvaluation.nextState) {
          const blockedGate = normalizeForCanonicalJson(
            {
              ...gate,
              ...(sessionPromptRisk.sessionId ? { sessionRef: sessionPromptRisk.sessionId } : {}),
              promptRisk: promptRiskEvaluation.nextState,
              updatedAt: promptRiskEvaluationAt
            },
            { path: "$" }
          );
          await store.commitTx({
            at: promptRiskEvaluationAt,
            ops: [{ kind: "X402_GATE_UPSERT", tenantId, gateId, gate: blockedGate }]
          });
        }
        return sendError(
          res,
          409,
          promptRiskEvaluation.message,
          {
            gateId,
            forcedMode: promptRiskEvaluation.forcedMode ?? null,
            suspicious: promptRiskEvaluation.suspicious,
            overrideRequired: true
          },
          { code: promptRiskEvaluation.code }
        );
      }
      if (policyDecision?.settlementStatus === AGENT_RUN_SETTLEMENT_STATUS.RELEASED && sessionPromptRisk.promptRiskSignals) {
        const taintEvidenceRefs = normalizeEvidenceRefList(sessionPromptRisk.promptRiskSignals.evidenceRefs);
        const taintEvidenceDiff = diffRequiredEvidenceRefs({
          requiredRefs: taintEvidenceRefs,
          providedRefs: evidenceRefs
        });
        if (taintEvidenceRefs.length === 0 || taintEvidenceDiff.missingRefs.length > 0) {
          return sendError(
            res,
            409,
            "tainted-derived settlement requires provenance evidence",
            {
              gateId,
              sessionRef: sessionPromptRisk.sessionId ?? null,
              requiredEvidenceRefs: taintEvidenceDiff.requiredRefs,
              missingEvidenceRefs: taintEvidenceDiff.missingRefs
            },
            { code: "X402_PROMPT_RISK_EVIDENCE_REQUIRED" }
          );
        }
      }
      const policyHashUsed = computeSettlementPolicyHash(policyDecision.policy);
      let tokenPayloadForBindings = null;
      try {
        if (typeof gateAuthorization?.token?.value === "string" && gateAuthorization.token.value.trim() !== "") {
          const parsed = parseNooterraPayTokenV1(gateAuthorization.token.value);
          tokenPayloadForBindings = parsed?.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload) ? parsed.payload : null;
        }
      } catch {}
      const spendAuthorizationPolicyFingerprint =
        typeof tokenPayloadForBindings?.policyFingerprint === "string" && tokenPayloadForBindings.policyFingerprint.trim() !== ""
          ? tokenPayloadForBindings.policyFingerprint.trim().toLowerCase()
          : null;
      const expectedWalletPolicyFingerprint =
        typeof resolvedWalletPolicy?.policyFingerprint === "string" && resolvedWalletPolicy.policyFingerprint.trim() !== ""
          ? resolvedWalletPolicy.policyFingerprint.trim().toLowerCase()
          : null;
      if (
        spendAuthorizationPolicyFingerprint &&
        expectedWalletPolicyFingerprint &&
        spendAuthorizationPolicyFingerprint !== expectedWalletPolicyFingerprint
      ) {
        return sendError(
          res,
          409,
          "spend authorization policy fingerprint does not match resolved wallet policy",
          {
            gateId,
            spendAuthorizationPolicyFingerprint,
            expectedWalletPolicyFingerprint
          },
          { code: "X402_SPEND_AUTH_POLICY_FINGERPRINT_MISMATCH" }
        );
      }

      const payerAgentId = String(settlement.payerAgentId ?? "");
      const payeeAgentId = String(settlement.agentId ?? "");
      const payerWalletExisting = typeof store.getAgentWallet === "function" ? await store.getAgentWallet({ tenantId, agentId: payerAgentId }) : null;
      const payeeWalletExisting = typeof store.getAgentWallet === "function" ? await store.getAgentWallet({ tenantId, agentId: payeeAgentId }) : null;
      if (!payerWalletExisting || !payeeWalletExisting) return sendError(res, 409, "missing wallets for gate settlement", null, { code: "WALLET_MISSING" });

        let payerWallet = payerWalletExisting;
        let payeeWallet = payeeWalletExisting;
        const releaseAmountCents = Number(policyDecision.releaseAmountCents ?? 0);
        const refundAmountCents = Number(policyDecision.refundAmountCents ?? 0);
        const at = nowIso();

        // Optional x402 holdback: implemented as a follow-on "holdback settlement" funded from the payer's wallet.
        // The primary settlement is always fully resolved (release+refund==amount) to preserve AgentRunSettlement invariants.
        const holdbackBpsRaw = gate?.terms?.holdbackBps ?? 0;
        const holdbackBps = Number(holdbackBpsRaw);
        const normalizedHoldbackBps =
          Number.isSafeInteger(holdbackBps) && holdbackBps >= 0 ? Math.min(10_000, holdbackBps) : 0;
        const holdbackAmountCents =
          normalizedHoldbackBps > 0 && releaseAmountCents > 0
            ? Math.floor((releaseAmountCents * normalizedHoldbackBps) / 10_000)
            : 0;
        const immediateReleaseAmountCents = releaseAmountCents - holdbackAmountCents;
        const immediateRefundAmountCents = refundAmountCents + holdbackAmountCents;
        const disputeWindowMsEffective = (() => {
          const ms = gate?.terms?.disputeWindowMs;
          if (Number.isSafeInteger(ms) && ms >= 0) return ms;
          const days = gate?.terms?.disputeWindowDays;
          if (Number.isSafeInteger(days) && days >= 0) return days * 86_400_000;
          return 0;
        })();
        const holdbackReleaseEligibleAt =
          holdbackAmountCents > 0 ? new Date(Date.parse(at) + disputeWindowMsEffective).toISOString() : null;

        try {
          if (immediateReleaseAmountCents > 0) {
            const moved = releaseAgentWalletEscrowToPayee({
              payerWallet,
              payeeWallet,
              amountCents: immediateReleaseAmountCents,
              at
            });
            payerWallet = moved.payerWallet;
            payeeWallet = moved.payeeWallet;
          }
          if (immediateRefundAmountCents > 0) {
            payerWallet = refundAgentWalletEscrow({ wallet: payerWallet, amountCents: immediateRefundAmountCents, at });
          }
        } catch (err) {
          if (err?.code === "INSUFFICIENT_ESCROW_BALANCE") {
            return sendError(res, 409, "insufficient escrow balance", { message: err?.message }, { code: "INSUFFICIENT_FUNDS" });
          }
          throw err;
        }

      const immediateReleaseRatePct =
        Number(settlement.amountCents) > 0 ? Math.round((immediateReleaseAmountCents * 100) / Number(settlement.amountCents)) : 0;
      const reasonCodes = (() => {
        const out = [];
        const push = (v) => {
          const s = typeof v === "string" ? v.trim() : "";
          if (s) out.push(s);
        };
        if (Array.isArray(policyDecision.reasonCodes)) for (const c of policyDecision.reasonCodes) push(c);
        for (const c of extraReasonCodes) push(c);
        // Deterministic ordering for receipts/logs.
        return Array.from(new Set(out)).sort((a, b) => a.localeCompare(b));
      })();
      const providerSigReasonCodes = reasonCodes.filter(
        (code) =>
          code === "X402_PROVIDER_SIGNATURE_MISSING" ||
          code === "X402_PROVIDER_SIGNATURE_INVALID" ||
          code === "X402_PROVIDER_RESPONSE_HASH_MISMATCH" ||
          code === "X402_PROVIDER_KEY_ID_MISMATCH" ||
          code === "X402_PROVIDER_KEY_ID_UNKNOWN"
      );
      const providerQuoteReasonCodes = reasonCodes.filter((code) => code.startsWith("X402_PROVIDER_QUOTE_"));
      const providerSigKeyEvidence = buildVerificationKeyEvidence(body?.providerSignature ?? null);
      const providerQuoteSigKeyEvidence = buildVerificationKeyEvidence(body?.providerQuoteSignature ?? null);
      const providerSigStatus = normalizeProviderSignatureStatus({
        providerSignatureRequired: verificationSource === "provider_signature_v1",
        providerSignature: body?.providerSignature ?? null,
        providerReasonCodes: providerSigReasonCodes
      });
      const providerQuoteSigStatus = normalizeProviderQuoteSignatureStatus({
        providerQuoteSignatureRequired: verificationSource === "provider_signature_v1",
        providerQuoteSignature: body?.providerQuoteSignature ?? null,
        providerReasonCodes: providerQuoteReasonCodes
      });
      if (providerSigKeyEvidence?.jwkThumbprintSha256) {
        providerSigStatus.keyJwkThumbprintSha256 = providerSigKeyEvidence.jwkThumbprintSha256;
      }
      if (providerQuoteSigKeyEvidence?.jwkThumbprintSha256) {
        providerQuoteSigStatus.keyJwkThumbprintSha256 = providerQuoteSigKeyEvidence.jwkThumbprintSha256;
      }
      const enrichedEvidenceRefs = Array.from(
        new Set([
          ...evidenceRefs,
          ...(providerSigKeyEvidence?.jwkThumbprintSha256
            ? [`provider:key_jwk_thumbprint_sha256:${providerSigKeyEvidence.jwkThumbprintSha256}`]
            : []),
          ...(providerQuoteSigKeyEvidence?.jwkThumbprintSha256
            ? [`provider_quote:key_jwk_thumbprint_sha256:${providerQuoteSigKeyEvidence.jwkThumbprintSha256}`]
            : [])
        ])
      ).sort((left, right) => String(left).localeCompare(String(right)));
      const requestEvidence = parseEvidenceRefSha256Selection(enrichedEvidenceRefs, "http:request_sha256:");
      const requestSha256 = requestEvidence.requestSha256;
      const responseSha256 = parseEvidenceRefSha256(enrichedEvidenceRefs, "http:response_sha256:");
      const gateExecutionIntent =
        gateAuthorization?.executionIntent && typeof gateAuthorization.executionIntent === "object" && !Array.isArray(gateAuthorization.executionIntent)
          ? gateAuthorization.executionIntent
          : null;
      const tokenRequestBindingMode =
        typeof tokenPayloadForBindings?.requestBindingMode === "string" && tokenPayloadForBindings.requestBindingMode.trim() !== ""
          ? tokenPayloadForBindings.requestBindingMode.trim().toLowerCase()
          : null;
      const tokenRequestBindingSha256 =
        typeof tokenPayloadForBindings?.requestBindingSha256 === "string" && tokenPayloadForBindings.requestBindingSha256.trim() !== ""
          ? tokenPayloadForBindings.requestBindingSha256.trim().toLowerCase()
          : null;
      const quoteRequestBindingMode =
        typeof gateAuthorization?.quote?.requestBindingMode === "string" && gateAuthorization.quote.requestBindingMode.trim() !== ""
          ? gateAuthorization.quote.requestBindingMode.trim().toLowerCase()
          : typeof gate?.quote?.requestBindingMode === "string" && gate.quote.requestBindingMode.trim() !== ""
            ? gate.quote.requestBindingMode.trim().toLowerCase()
            : null;
      const quoteRequestBindingSha256 =
        typeof gateAuthorization?.quote?.requestBindingSha256 === "string" && gateAuthorization.quote.requestBindingSha256.trim() !== ""
          ? gateAuthorization.quote.requestBindingSha256.trim().toLowerCase()
          : typeof gate?.quote?.requestBindingSha256 === "string" && gate.quote.requestBindingSha256.trim() !== ""
            ? gate.quote.requestBindingSha256.trim().toLowerCase()
            : null;
      const effectiveRequestBindingMode = tokenRequestBindingMode ?? quoteRequestBindingMode ?? null;
      const effectiveRequestBindingSha256 = tokenRequestBindingSha256 ?? quoteRequestBindingSha256 ?? null;
      const executionIntentBindingCheck = guardExecutionIntentRequestBindingConsistency({
        executionIntent: gateExecutionIntent,
        requestBindingMode: effectiveRequestBindingMode,
        requestBindingSha256: effectiveRequestBindingSha256
      });
      if (!executionIntentBindingCheck.ok) {
        return sendError(
          res,
          executionIntentBindingCheck.statusCode ?? 409,
          executionIntentBindingCheck.message ?? "execution intent request binding mismatch",
          executionIntentBindingCheck.details ?? { gateId },
          { code: executionIntentBindingCheck.code ?? "X402_EXECUTION_INTENT_REQUEST_MISMATCH" }
        );
      }
      const executionIntentRequestSha256 = executionIntentBindingCheck.expectedRequestSha256 ?? null;
      if (requestEvidence.hasConflict && (effectiveRequestBindingSha256 || executionIntentRequestSha256)) {
        return sendError(
          res,
          409,
          "request hash evidence conflict for spend authorization binding",
          {
            gateId,
            requestSha256,
            requestSha256Values: requestEvidence.requestSha256Values,
            expectedRequestBindingSha256: effectiveRequestBindingSha256 ?? null,
            expectedRequestSha256: executionIntentRequestSha256 ?? null
          },
          { code: "X402_REQUEST_BINDING_EVIDENCE_MISMATCH" }
        );
      }
      if (effectiveRequestBindingMode === "strict") {
        if (!effectiveRequestBindingSha256) {
          return sendError(
            res,
            409,
            "strict request binding is missing from spend authorization",
            { gateId },
            { code: "X402_REQUEST_BINDING_REQUIRED" }
          );
        }
        if (!requestSha256) {
          return sendError(
            res,
            409,
            "strict request binding requires request hash evidence",
            { gateId, expectedRequestBindingSha256: effectiveRequestBindingSha256 },
            { code: "X402_REQUEST_BINDING_EVIDENCE_REQUIRED" }
          );
        }
        if (requestSha256 !== effectiveRequestBindingSha256) {
          return sendError(
            res,
            409,
            "request hash evidence does not match strict request binding",
            { gateId, requestSha256, expectedRequestBindingSha256: effectiveRequestBindingSha256 },
            { code: "X402_REQUEST_BINDING_EVIDENCE_MISMATCH" }
          );
        }
      } else if (effectiveRequestBindingSha256 && requestSha256 && requestSha256 !== effectiveRequestBindingSha256) {
        return sendError(
          res,
          409,
          "request hash evidence does not match spend authorization binding",
          { gateId, requestSha256, expectedRequestBindingSha256: effectiveRequestBindingSha256 },
          { code: "X402_REQUEST_BINDING_EVIDENCE_MISMATCH" }
        );
      }
      if (executionIntentRequestSha256 && requestSha256 && requestSha256 !== executionIntentRequestSha256) {
        return sendError(
          res,
          409,
          "execution intent request fingerprint does not match request evidence",
          { gateId, requestSha256, expectedRequestSha256: executionIntentRequestSha256 },
          { code: "X402_EXECUTION_INTENT_REQUEST_MISMATCH" }
        );
      }
      const decisionRequestSha256 = requestSha256 ?? executionIntentRequestSha256 ?? effectiveRequestBindingSha256 ?? null;
      const verificationMethodHashUsed = computeVerificationMethodHash(policyDecision.verificationMethod ?? {});
      const policyDecisionFingerprint = buildPolicyDecisionFingerprint({
        policyInput: body?.policy ?? null,
        policyHashUsed,
        verificationMethodHashUsed,
        policyDecision
      });
      const policyDecisionSignerKeyId =
        typeof store?.serverSigner?.keyId === "string" && store.serverSigner.keyId.trim() !== ""
          ? store.serverSigner.keyId.trim()
          : null;
      const policyDecisionSignerPrivateKeyPem =
        typeof store?.serverSigner?.privateKeyPem === "string" && store.serverSigner.privateKeyPem.trim() !== ""
          ? store.serverSigner.privateKeyPem
          : null;
      if (!policyDecisionSignerKeyId || !policyDecisionSignerPrivateKeyPem) {
        return sendError(
          res,
          409,
          "policy decision signer is not configured",
          {
            gateId,
            signerKeyIdConfigured: Boolean(policyDecisionSignerKeyId),
            signerPrivateKeyConfigured: Boolean(policyDecisionSignerPrivateKeyPem)
          },
          { code: "X402_POLICY_DECISION_SIGNER_REQUIRED" }
        );
      }
      let policyDecisionArtifact = null;
      try {
        policyDecisionArtifact = buildPolicyDecisionV1({
          decisionId: `pdec_${gateId}`,
          tenantId,
          runId,
          settlementId:
            typeof settlement.settlementId === "string" && settlement.settlementId.trim() !== ""
              ? settlement.settlementId.trim()
              : `setl_${runId}`,
          gateId,
          policyInput: body?.policy ?? null,
          policyHashUsed,
          verificationMethodHashUsed,
          policyDecision,
          createdAt: at,
          requireSignature: true,
          signerKeyId: policyDecisionSignerKeyId,
          signerPrivateKeyPem: policyDecisionSignerPrivateKeyPem
        });
      } catch (err) {
        return sendError(
          res,
          409,
          "unable to build signed policy decision artifact",
          { gateId, message: err?.message ?? null },
          { code: "X402_POLICY_DECISION_BUILD_FAILED" }
        );
      }
      const tokenQuoteId =
        typeof tokenPayloadForBindings?.quoteId === "string" && tokenPayloadForBindings.quoteId.trim() !== ""
          ? tokenPayloadForBindings.quoteId.trim()
          : typeof gate?.quote?.quoteId === "string" && gate.quote.quoteId.trim() !== ""
            ? gate.quote.quoteId.trim()
            : null;
      const tokenQuoteSha256 =
        typeof tokenPayloadForBindings?.quoteSha256 === "string" && tokenPayloadForBindings.quoteSha256.trim() !== ""
          ? tokenPayloadForBindings.quoteSha256.trim().toLowerCase()
          : typeof gate?.quote?.quoteSha256 === "string" && gate.quote.quoteSha256.trim() !== ""
            ? gate.quote.quoteSha256.trim().toLowerCase()
            : null;
      const authorityGrantRef = deriveX402AuthorityGrantRef({
        gateId,
        gateAgentPassport: gate?.agentPassport ?? null,
        gateAuthorization,
        tokenPayload: tokenPayloadForBindings
      });
      const delegationBindingRefs = resolveX402DelegationBindingRefs({
        authorityGrantRef,
        gateAgentPassport: gate?.agentPassport ?? null,
        gateAuthorization,
        tokenPayload: tokenPayloadForBindings
      });
      const spendAuthorizationSource =
        tokenPayloadForBindings && typeof tokenPayloadForBindings === "object" && !Array.isArray(tokenPayloadForBindings)
          ? tokenPayloadForBindings
          : {};
      const settlementAssignmentSponsorWalletRef =
        typeof spendAuthorizationSource.sponsorWalletRef === "string" && spendAuthorizationSource.sponsorWalletRef.trim() !== ""
          ? spendAuthorizationSource.sponsorWalletRef.trim()
          : typeof resolvedWalletPolicy?.sponsorWalletRef === "string" && resolvedWalletPolicy.sponsorWalletRef.trim() !== ""
            ? resolvedWalletPolicy.sponsorWalletRef.trim()
            : typeof gateAgentPassport?.sponsorWalletRef === "string" && gateAgentPassport.sponsorWalletRef.trim() !== ""
              ? gateAgentPassport.sponsorWalletRef.trim()
              : null;
      const settlementAssignmentPolicyRef =
        typeof resolvedWalletPolicy?.policyRef === "string" && resolvedWalletPolicy.policyRef.trim() !== ""
          ? resolvedWalletPolicy.policyRef.trim()
          : typeof gateAgentPassport?.policyRef === "string" && gateAgentPassport.policyRef.trim() !== ""
            ? gateAgentPassport.policyRef.trim()
            : null;
      const settlementAssignmentPolicyVersion =
        Number.isSafeInteger(Number(spendAuthorizationSource.policyVersion)) && Number(spendAuthorizationSource.policyVersion) > 0
          ? Number(spendAuthorizationSource.policyVersion)
          : Number.isSafeInteger(Number(resolvedWalletPolicy?.policyVersion)) && Number(resolvedWalletPolicy.policyVersion) > 0
            ? Number(resolvedWalletPolicy.policyVersion)
            : Number.isSafeInteger(Number(gateAgentPassport?.policyVersion)) && Number(gateAgentPassport.policyVersion) > 0
              ? Number(gateAgentPassport.policyVersion)
              : null;
      const authorizationGovernanceForBindings =
        gateAuthorization?.governance && typeof gateAuthorization.governance === "object" && !Array.isArray(gateAuthorization.governance)
          ? gateAuthorization.governance
          : null;
      const settlementBindingsMetadata = (() => {
        const x402 = {};
        if (settlementAssignmentSponsorWalletRef && settlementAssignmentPolicyRef && settlementAssignmentPolicyVersion) {
          x402.walletAssignment = {
            sponsorWalletRef: settlementAssignmentSponsorWalletRef,
            policyRef: settlementAssignmentPolicyRef,
            policyVersion: settlementAssignmentPolicyVersion
          };
        }
        x402.policyDecision = {
          schemaVersion: policyDecisionArtifact.schemaVersion,
          decisionId: policyDecisionArtifact.decisionId,
          policyDecisionHash: policyDecisionArtifact.policyDecisionHash,
          evaluationHash: policyDecisionArtifact.evaluationHash
        };
        return normalizeForCanonicalJson({ x402 }, { path: "$.metadata" });
      })();
      const settlementBindings = {
        authorizationRef:
          typeof gateAuthorization?.authorizationRef === "string" && gateAuthorization.authorizationRef.trim() !== ""
            ? gateAuthorization.authorizationRef
            : `auth_${gateId}`,
        token: {
          kid: gateAuthorization?.token?.kid ?? null,
          sha256:
            gateAuthorization?.token?.sha256 ??
            (typeof gateAuthorization?.token?.value === "string" && gateAuthorization.token.value.trim() !== ""
              ? computeNooterraPayTokenSha256(gateAuthorization.token.value)
              : null),
          expiresAt: gateAuthorization?.token?.expiresAt ?? null
        },
        request: {
          sha256: decisionRequestSha256
        },
        response: {
          status:
            body?.responseStatus === null || body?.responseStatus === undefined || body?.responseStatus === ""
              ? null
              : Number.isSafeInteger(Number(body.responseStatus))
                ? Number(body.responseStatus)
                : null,
          sha256: responseSha256 ?? null
        },
        providerSig: providerSigStatus,
        providerQuoteSig: providerQuoteSigStatus,
        reserve: {
          adapter: gateAuthorization?.reserve?.adapter ?? "circle",
          mode: gateAuthorization?.reserve?.mode ?? "transfer",
          reserveId: gateAuthorization?.reserve?.reserveId ?? null,
          status: gateAuthorization?.reserve?.status ?? null
        },
        quote:
          tokenQuoteId || tokenQuoteSha256 || gateAuthorization?.quote
            ? {
                quoteId: tokenQuoteId,
                quoteSha256: tokenQuoteSha256,
                expiresAt: gateAuthorization?.quote?.expiresAt ?? gate?.quote?.expiresAt ?? null,
                requestBindingMode: gateAuthorization?.quote?.requestBindingMode ?? gate?.quote?.requestBindingMode ?? null,
                requestBindingSha256:
                  gateAuthorization?.quote?.requestBindingSha256 ??
                  (typeof gate?.quote?.requestBindingSha256 === "string" ? gate.quote.requestBindingSha256 : null)
              }
            : null,
        spendAuthorization:
          (tokenPayloadForBindings && typeof tokenPayloadForBindings === "object") || authorityGrantRef
            ? {
                spendAuthorizationVersion:
                  typeof spendAuthorizationSource.spendAuthorizationVersion === "string"
                    ? spendAuthorizationSource.spendAuthorizationVersion
                    : null,
                idempotencyKey:
                  typeof spendAuthorizationSource.idempotencyKey === "string" ? spendAuthorizationSource.idempotencyKey : null,
                nonce: typeof spendAuthorizationSource.nonce === "string" ? spendAuthorizationSource.nonce : null,
                sponsorRef: typeof spendAuthorizationSource.sponsorRef === "string" ? spendAuthorizationSource.sponsorRef : null,
                sponsorWalletRef: settlementAssignmentSponsorWalletRef,
                ...(settlementAssignmentPolicyRef ? { policyRef: settlementAssignmentPolicyRef } : {}),
                agentKeyId: typeof spendAuthorizationSource.agentKeyId === "string" ? spendAuthorizationSource.agentKeyId : null,
                delegationGrantRef:
                  typeof gateAuthorization?.delegationGrantRef === "string" && gateAuthorization.delegationGrantRef.trim() !== ""
                    ? gateAuthorization.delegationGrantRef.trim()
                    : typeof gate?.delegationGrantRef === "string" && gate.delegationGrantRef.trim() !== ""
                      ? gate.delegationGrantRef.trim()
                      : null,
                delegationRef: delegationBindingRefs.effectiveDelegationRef ?? authorityGrantRef,
                rootDelegationRef: delegationBindingRefs.rootDelegationRef,
                rootDelegationHash: delegationBindingRefs.rootDelegationHash,
                effectiveDelegationRef: delegationBindingRefs.effectiveDelegationRef,
                effectiveDelegationHash: delegationBindingRefs.effectiveDelegationHash,
                delegationDepth: delegationBindingRefs.delegationDepth,
                maxDelegationDepth: delegationBindingRefs.maxDelegationDepth,
                delegationChainLength: delegationBindingRefs.delegationChainLength,
                policyVersion: settlementAssignmentPolicyVersion,
                policyFingerprint:
                  typeof spendAuthorizationSource.policyFingerprint === "string"
                    ? spendAuthorizationSource.policyFingerprint.toLowerCase()
                    : null
              }
            : null,
        ...(authorizationGovernanceForBindings ? { governance: authorizationGovernanceForBindings } : {}),
        executionIntent: gateExecutionIntent
          ? {
              schemaVersion:
                typeof gateExecutionIntent.schemaVersion === "string" && gateExecutionIntent.schemaVersion.trim() !== ""
                  ? gateExecutionIntent.schemaVersion.trim()
                  : null,
              intentId:
                typeof gateExecutionIntent.intentId === "string" && gateExecutionIntent.intentId.trim() !== ""
                  ? gateExecutionIntent.intentId.trim()
                  : null,
              intentHash:
                typeof gateExecutionIntent.intentHash === "string" && gateExecutionIntent.intentHash.trim() !== ""
                  ? gateExecutionIntent.intentHash.trim().toLowerCase()
                  : null,
              idempotencyKey:
                typeof gateExecutionIntent.idempotencyKey === "string" && gateExecutionIntent.idempotencyKey.trim() !== ""
                  ? gateExecutionIntent.idempotencyKey.trim()
                  : null,
              nonce:
                typeof gateExecutionIntent.nonce === "string" && gateExecutionIntent.nonce.trim() !== ""
                  ? gateExecutionIntent.nonce.trim()
                  : null,
              expiresAt:
                typeof gateExecutionIntent.expiresAt === "string" && gateExecutionIntent.expiresAt.trim() !== ""
                  ? gateExecutionIntent.expiresAt.trim()
                  : null,
              requestSha256:
                typeof gateExecutionIntent?.requestFingerprint?.requestSha256 === "string" &&
                gateExecutionIntent.requestFingerprint.requestSha256.trim() !== ""
                  ? gateExecutionIntent.requestFingerprint.requestSha256.trim().toLowerCase()
                  : null,
              policyHash:
                typeof gateExecutionIntent?.policyBinding?.policyHash === "string" &&
                gateExecutionIntent.policyBinding.policyHash.trim() !== ""
                  ? gateExecutionIntent.policyBinding.policyHash.trim().toLowerCase()
                  : null,
              verificationMethodHash:
                typeof gateExecutionIntent?.policyBinding?.verificationMethodHash === "string" &&
                gateExecutionIntent.policyBinding.verificationMethodHash.trim() !== ""
                  ? gateExecutionIntent.policyBinding.verificationMethodHash.trim().toLowerCase()
                  : null
            }
          : null,
        zkProof: executionProofEvidence
          ? {
              required: executionProofEvidence.required === true,
              present: executionProofEvidence.present === true,
              protocol:
                typeof executionProofEvidence.protocol === "string" && executionProofEvidence.protocol.trim() !== ""
                  ? executionProofEvidence.protocol.trim().toLowerCase()
                  : null,
              verificationKeyRef:
                typeof executionProofEvidence.verificationKeyRef === "string" && executionProofEvidence.verificationKeyRef.trim() !== ""
                  ? executionProofEvidence.verificationKeyRef.trim()
                  : null,
              statementHashSha256:
                typeof executionProofEvidence.statementHashSha256 === "string" && executionProofEvidence.statementHashSha256.trim() !== ""
                  ? executionProofEvidence.statementHashSha256.trim().toLowerCase()
                  : null,
              inputDigestSha256:
                typeof executionProofEvidence.inputDigestSha256 === "string" && executionProofEvidence.inputDigestSha256.trim() !== ""
                  ? executionProofEvidence.inputDigestSha256.trim().toLowerCase()
                  : null,
              outputDigestSha256:
                typeof executionProofEvidence.outputDigestSha256 === "string" && executionProofEvidence.outputDigestSha256.trim() !== ""
                  ? executionProofEvidence.outputDigestSha256.trim().toLowerCase()
                  : null,
              verified: executionProofEvidence?.verification?.verified === true,
              status:
                typeof executionProofEvidence?.verification?.status === "string" && executionProofEvidence.verification.status.trim() !== ""
                  ? executionProofEvidence.verification.status.trim()
                  : null,
              code:
                typeof executionProofEvidence?.verification?.code === "string" && executionProofEvidence.verification.code.trim() !== ""
                  ? executionProofEvidence.verification.code.trim()
                  : null
            }
          : null,
        policyDecisionFingerprint,
        metadata: settlementBindingsMetadata
      };

      const settlementDecisionStatus = policyDecision.shouldAutoResolve
        ? AGENT_RUN_SETTLEMENT_DECISION_STATUS.AUTO_RESOLVED
        : AGENT_RUN_SETTLEMENT_DECISION_STATUS.MANUAL_REVIEW_REQUIRED;
      const settlementDecisionMode = policyDecision.shouldAutoResolve
        ? AGENT_RUN_SETTLEMENT_DECISION_MODE.AUTOMATIC
        : AGENT_RUN_SETTLEMENT_DECISION_MODE.MANUAL_REVIEW;
      const resolutionEventId = createId("x402res");
      const resolvedKernelRefs = buildSettlementKernelRefs({
        settlement,
        run: null,
        agreementId: gate?.agreementHash ?? null,
        decisionStatus: settlementDecisionStatus,
        decisionMode: settlementDecisionMode,
        decisionReason: reasonCodes[0] ?? null,
        verificationStatus: policyDecision.verificationStatus,
        policyHash: policyHashUsed,
        verificationMethodHash: verificationMethodHashUsed,
        verificationMethodMode: policyDecision?.verificationMethod?.mode ?? null,
        verifierId: "nooterra.x402",
        verifierVersion: "v1",
        verifierHash: null,
        resolutionEventId,
        status: policyDecision.settlementStatus,
        releasedAmountCents: immediateReleaseAmountCents,
        refundedAmountCents: immediateRefundAmountCents,
        releaseRatePct: immediateReleaseRatePct,
        finalityState: SETTLEMENT_FINALITY_STATE.FINAL,
        settledAt: at,
        createdAt: at,
        bindings: settlementBindings
      });
      const decisionTrace = {
        schemaVersion: "X402GateDecisionTrace.v1",
        verificationStatus: String(policyDecision.verificationStatus ?? ""),
        runStatus: String(policyDecision.runStatus ?? ""),
        shouldAutoResolve: policyDecision.shouldAutoResolve === true,
        reasonCodes,
        policyReleaseRatePct: policyDecision.releaseRatePct,
        policyReleasedAmountCents: releaseAmountCents,
        policyRefundedAmountCents: refundAmountCents,
        holdbackBps: normalizedHoldbackBps,
        holdbackAmountCents,
        holdbackReleaseEligibleAt,
        immediateReleasedAmountCents: immediateReleaseAmountCents,
        immediateRefundedAmountCents: immediateRefundAmountCents,
        releaseRatePct: immediateReleaseRatePct,
        verificationMethod: policyDecision.verificationMethod,
        policyDecision: policyDecisionArtifact,
        bindings: settlementBindings,
        verificationContext: {
          schemaVersion: "X402GateVerificationContext.v1",
          providerSigningKey: providerSigKeyEvidence,
          providerQuoteSigningKey: providerQuoteSigKeyEvidence
        },
        decisionRecord: resolvedKernelRefs.decisionRecord,
        settlementReceipt: resolvedKernelRefs.settlementReceipt
      };

      let resolvedSettlement;
      try {
        resolvedSettlement = resolveAgentRunSettlement({
          settlement,
          status: policyDecision.settlementStatus,
          runStatus: policyDecision.runStatus,
          releasedAmountCents: immediateReleaseAmountCents,
          refundedAmountCents: immediateRefundAmountCents,
          releaseRatePct: immediateReleaseRatePct,
          decisionStatus: settlementDecisionStatus,
          decisionMode: settlementDecisionMode,
          decisionPolicyHash: policyHashUsed,
          decisionReason: reasonCodes[0] ?? null,
          decisionTrace,
          resolutionEventId,
          at
        });
        assertSettlementKernelBindingsForResolution({
          settlement: resolvedSettlement,
          runId,
          phase: "x402_gate_verify.resolved"
        });
      } catch (err) {
        if (err?.code === "SETTLEMENT_KERNEL_BINDING_INVALID") {
          return sendError(
            res,
            409,
            "invalid settlement kernel artifacts",
            {
              message: err?.message,
              code: err?.code ?? null,
              errors: err?.detail?.errors ?? null
            },
            { code: "SETTLEMENT_KERNEL_BINDING_INVALID" }
          );
        }
        throw err;
      }

      let holdbackSettlement = null;
      let holdbackSettlementResolved = null;
      let holdbackRunId = null;
      if (holdbackAmountCents > 0) {
        holdbackRunId = `${runId}_holdback`;
        const existingHoldback =
          typeof store.getAgentRunSettlement === "function" ? await store.getAgentRunSettlement({ tenantId, runId: holdbackRunId }) : null;
        if (existingHoldback && String(existingHoldback.status ?? "").toLowerCase() !== "locked") {
          holdbackSettlementResolved = existingHoldback;
        } else if (existingHoldback) {
          holdbackSettlement = existingHoldback;
        } else {
          // Re-lock the holdback funds into escrow for the follow-on settlement.
          try {
            payerWallet = lockAgentWalletEscrow({ wallet: payerWallet, amountCents: holdbackAmountCents, at });
          } catch (err) {
            if (err?.code === "INSUFFICIENT_WALLET_BALANCE") {
              return sendError(res, 409, "insufficient wallet balance for holdback lock", { message: err?.message }, { code: "INSUFFICIENT_FUNDS" });
            }
            throw err;
          }
          holdbackSettlement = createAgentRunSettlement({
            tenantId,
            runId: holdbackRunId,
            agentId: payeeAgentId,
            payerAgentId,
            amountCents: holdbackAmountCents,
            currency: settlement.currency ?? "USD",
            disputeWindowDays: 0,
            at
          });
        }

        // If there's no dispute window, resolve the holdback immediately.
        if (holdbackSettlement && disputeWindowMsEffective <= 0) {
          try {
            const moved = releaseAgentWalletEscrowToPayee({
              payerWallet,
              payeeWallet,
              amountCents: holdbackAmountCents,
              at
            });
            payerWallet = moved.payerWallet;
            payeeWallet = moved.payeeWallet;
          } catch (err) {
            if (err?.code === "INSUFFICIENT_ESCROW_BALANCE") {
              return sendError(res, 409, "insufficient escrow balance for holdback release", { message: err?.message }, { code: "INSUFFICIENT_FUNDS" });
            }
            throw err;
          }

          try {
            const holdbackResolutionEventId = createId("x402hb");
            const holdbackKernelRefs = buildSettlementKernelRefs({
              settlement: holdbackSettlement,
              run: null,
              agreementId: gate?.agreementHash ?? null,
              decisionStatus: AGENT_RUN_SETTLEMENT_DECISION_STATUS.AUTO_RESOLVED,
              decisionMode: AGENT_RUN_SETTLEMENT_DECISION_MODE.AUTOMATIC,
              decisionReason: "x402_holdback_auto_release",
              verificationStatus: policyDecision.verificationStatus,
              policyHash: policyHashUsed,
              verificationMethodHash: verificationMethodHashUsed,
              verificationMethodMode: policyDecision?.verificationMethod?.mode ?? null,
              verifierId: "nooterra.x402",
              verifierVersion: "v1",
              verifierHash: null,
              resolutionEventId: holdbackResolutionEventId,
              status: AGENT_RUN_SETTLEMENT_STATUS.RELEASED,
              releasedAmountCents: holdbackAmountCents,
              refundedAmountCents: 0,
              releaseRatePct: 100,
              finalityState: SETTLEMENT_FINALITY_STATE.FINAL,
              settledAt: at,
              createdAt: at,
              bindings: settlementBindings
            });
            holdbackSettlementResolved = resolveAgentRunSettlement({
              settlement: holdbackSettlement,
              status: AGENT_RUN_SETTLEMENT_STATUS.RELEASED,
              runStatus: "completed",
              releasedAmountCents: holdbackAmountCents,
              refundedAmountCents: 0,
              releaseRatePct: 100,
              decisionStatus: AGENT_RUN_SETTLEMENT_DECISION_STATUS.AUTO_RESOLVED,
              decisionMode: AGENT_RUN_SETTLEMENT_DECISION_MODE.AUTOMATIC,
              decisionPolicyHash: policyHashUsed,
              decisionReason: "x402_holdback_auto_release",
              decisionTrace: {
                schemaVersion: "X402HoldbackDecisionTrace.v1",
                gateId,
                policyHashUsed,
                releasedAmountCents: holdbackAmountCents,
                refundedAmountCents: 0,
                decisionRecord: holdbackKernelRefs.decisionRecord,
                settlementReceipt: holdbackKernelRefs.settlementReceipt
              },
              resolutionEventId: holdbackResolutionEventId,
              at
            });
            assertSettlementKernelBindingsForResolution({
              settlement: holdbackSettlementResolved,
              runId: holdbackRunId,
              phase: "x402_gate_verify.holdback_resolved"
            });
          } catch (err) {
            if (err?.code === "SETTLEMENT_KERNEL_BINDING_INVALID") {
              return sendError(
                res,
                409,
                "invalid settlement kernel artifacts",
                {
                  message: err?.message,
                  code: err?.code ?? null,
                  errors: err?.detail?.errors ?? null
                },
                { code: "SETTLEMENT_KERNEL_BINDING_INVALID" }
              );
            }
            throw err;
          }
            holdbackSettlement = null;
          }
        }

        const nextGate = normalizeForCanonicalJson(
          {
            ...gate,
            ...(sessionPromptRisk.sessionId ? { sessionRef: sessionPromptRisk.sessionId } : {}),
            ...(promptRiskEvaluation.nextState ? { promptRisk: promptRiskEvaluation.nextState } : {}),
            status: "resolved",
            resolvedAt: at,
          authorization:
            gateAuthorization && typeof gateAuthorization === "object" && !Array.isArray(gateAuthorization)
              ? {
                  ...gateAuthorization,
                  status: "settled",
                  reserve:
                    gateAuthorization.reserve && typeof gateAuthorization.reserve === "object" && !Array.isArray(gateAuthorization.reserve)
                      ? {
                          ...gateAuthorization.reserve,
                          status: policyDecision.settlementStatus === AGENT_RUN_SETTLEMENT_STATUS.REFUNDED ? "voided" : "settled",
                          settledAt: at
                        }
                      : gateAuthorization.reserve ?? null,
                  updatedAt: at
                }
              : null,
              decision: {
                policyHashUsed,
                verificationStatus: policyDecision.verificationStatus,
                runStatus: policyDecision.runStatus,
                policyReleaseRatePct: policyDecision.releaseRatePct,
              policyReleasedAmountCents: releaseAmountCents,
              policyRefundedAmountCents: refundAmountCents,
              holdbackBps: normalizedHoldbackBps,
              holdbackAmountCents,
              holdbackRunId,
              holdbackReleaseEligibleAt,
                releaseRatePct: immediateReleaseRatePct,
                releasedAmountCents: immediateReleaseAmountCents,
                refundedAmountCents: immediateRefundAmountCents,
                reasonCodes,
                authorizationRef: settlementBindings.authorizationRef,
                requestSha256: settlementBindings.request?.sha256 ?? null,
                responseSha256: settlementBindings.response?.sha256 ?? null,
                providerSig: settlementBindings.providerSig ?? null,
                providerQuoteSig: settlementBindings.providerQuoteSig ?? null,
                policyDecisionFingerprint: settlementBindings.policyDecisionFingerprint ?? null,
                policyDecisionSchemaVersion: policyDecisionArtifact.schemaVersion,
                policyDecisionHash: policyDecisionArtifact.policyDecisionHash,
                policyDecisionEvaluationHash: policyDecisionArtifact.evaluationHash
              },
              verificationContext: {
                schemaVersion: "X402GateVerificationContext.v1",
                providerSigningKey: providerSigKeyEvidence,
                providerQuoteSigningKey: providerQuoteSigKeyEvidence
              },
            holdback:
              holdbackAmountCents > 0
                ? {
                    schemaVersion: "X402GateHoldback.v1",
                    runId: holdbackRunId,
                    amountCents: holdbackAmountCents,
                    bps: normalizedHoldbackBps,
                    releaseEligibleAt: holdbackReleaseEligibleAt,
                    status: holdbackSettlementResolved ? "released" : "held",
                    releasedAt: holdbackSettlementResolved ? at : null
                  }
                : null,
            evidenceRefs: enrichedEvidenceRefs,
              providerSignature: body?.providerSignature ?? null,
              providerQuoteSignature: body?.providerQuoteSignature ?? null,
              providerQuotePayload: body?.providerQuotePayload ?? null,
              zkProof: executionProofEvidence,
              updatedAt: at
            },
          { path: "$" }
        );

        const ops = [
          { kind: "AGENT_WALLET_UPSERT", tenantId, wallet: payerWallet },
          { kind: "AGENT_WALLET_UPSERT", tenantId, wallet: payeeWallet },
          { kind: "AGENT_RUN_SETTLEMENT_UPSERT", tenantId, runId, settlement: resolvedSettlement },
          ...(holdbackSettlement
            ? [{ kind: "AGENT_RUN_SETTLEMENT_UPSERT", tenantId, runId: holdbackRunId, settlement: holdbackSettlement }]
            : []),
          ...(holdbackSettlementResolved
            ? [{ kind: "AGENT_RUN_SETTLEMENT_UPSERT", tenantId, runId: holdbackRunId, settlement: holdbackSettlementResolved }]
            : []),
          { kind: "X402_GATE_UPSERT", tenantId, gateId, gate: nextGate }
        ];
      await appendX402ReceiptPutIfMissing({
        ops,
        tenantId,
        gate: nextGate,
        settlement: resolvedSettlement,
        includeReversalContext: false
      });
        const responseBody = {
          ok: true,
          gate: nextGate,
          settlement: resolvedSettlement,
          holdbackSettlement: holdbackSettlementResolved ?? holdbackSettlement ?? null,
          decision: policyDecision,
        policyDecisionArtifact,
        decisionRecord: resolvedKernelRefs.decisionRecord,
        settlementReceipt: resolvedKernelRefs.settlementReceipt,
        zkProofVerification: executionProofVerification
        };
      if (idemStoreKey) {
        ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody } });
      }
      await commitTx(ops);
      return sendJson(res, 200, responseBody);
    }

    if (parts[0] === "x402" && parts[1] === "gate" && parts[2] === "reversal" && parts.length === 3 && req.method === "POST") {
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

      const gateId = typeof body?.gateId === "string" && body.gateId.trim() !== "" ? body.gateId.trim() : null;
      if (!gateId) return sendError(res, 400, "gateId is required", null, { code: "SCHEMA_INVALID" });
      let action = null;
      let providerDecision = null;
      let reason = null;
      let reversalEvidenceRefs = [];
      let commandEnvelope = null;
      let providerDecisionArtifact = null;
      let replayVerificationInput = null;
      let requireReplayVerification = false;
      try {
        action = normalizeX402ReversalActionInput(body?.action);
        providerDecision = normalizeX402ReversalDecisionInput(body?.providerDecision ?? null);
        reason = normalizeX402ReversalReasonInput(body?.reason ?? null);
        reversalEvidenceRefs = normalizeX402ReversalEvidenceRefsInput(body?.evidenceRefs ?? null);
        commandEnvelope = normalizeX402ReversalCommandInput(body?.command);
        providerDecisionArtifact = normalizeX402ProviderRefundDecisionEnvelopeInput(body?.providerDecisionArtifact ?? null);
        replayVerificationInput = normalizeOptionalReplayVerificationInput(body?.replayVerification, {
          fieldName: "replayVerification"
        });
        requireReplayVerification = body?.requireReplayVerification === true;
      } catch (err) {
        return sendError(res, 400, "invalid reversal request", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const gate = typeof store.getX402Gate === "function" ? await store.getX402Gate({ tenantId, gateId }) : null;
      if (!gate) return sendError(res, 404, "gate not found", null, { code: "NOT_FOUND" });
      const runId = String(gate.runId ?? "");
      const settlement = typeof store.getAgentRunSettlement === "function" ? await store.getAgentRunSettlement({ tenantId, runId }) : null;
      if (!settlement) return sendError(res, 404, "settlement not found for gate", null, { code: "NOT_FOUND" });
      const settlementDisputeStatus = String(settlement?.disputeStatus ?? "").toLowerCase();
      if (action === "resolve_refund" && settlementDisputeStatus === AGENT_RUN_SETTLEMENT_DISPUTE_STATUS.OPEN) {
        requireReplayVerification = true;
      }
      if (action === "resolve_refund" && requireReplayVerification && !replayVerificationInput) {
        return sendError(
          res,
          409,
          "reversal adjudication requires replay verification",
          {
            operation: "x402.gate.reversal.resolve_refund",
            gateId,
            runId,
            disputeStatus: settlementDisputeStatus || null
          },
          { code: "X402_REVERSAL_REPLAY_VERIFICATION_REQUIRED" }
        );
      }

      const amountCents = Number(settlement.amountCents ?? gate?.terms?.amountCents ?? 0);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        return sendError(res, 409, "gate amount invalid", null, { code: "X402_GATE_INVALID" });
      }
      const currency =
        typeof settlement.currency === "string" && settlement.currency.trim() !== ""
          ? settlement.currency.trim().toUpperCase()
          : typeof gate?.terms?.currency === "string" && gate.terms.currency.trim() !== ""
            ? gate.terms.currency.trim().toUpperCase()
            : "USD";
      const payerAgentId = typeof gate?.payerAgentId === "string" && gate.payerAgentId.trim() !== "" ? gate.payerAgentId.trim() : null;
      const payeeAgentId = typeof gate?.payeeAgentId === "string" && gate.payeeAgentId.trim() !== "" ? gate.payeeAgentId.trim() : null;
      if (!payerAgentId || !payeeAgentId) return sendError(res, 409, "gate actors missing", null, { code: "X402_GATE_INVALID" });

      const settlementReceiptId = x402SettlementReceiptIdFromSettlement(settlement);
      const authorizationRef =
        gate?.authorization &&
        typeof gate.authorization === "object" &&
        !Array.isArray(gate.authorization) &&
        typeof gate.authorization.authorizationRef === "string" &&
        gate.authorization.authorizationRef.trim() !== ""
          ? gate.authorization.authorizationRef.trim()
          : null;
      const reversalReceiptId =
        settlementReceiptId ??
        (action === "void_authorization" ? authorizationRef ?? `auth_${gateId}` : null);
      if (!reversalReceiptId) {
        return sendError(res, 409, "receipt is not available for gate reversal", null, { code: "X402_REVERSAL_RECEIPT_MISSING" });
      }

      const payerIdentity = await getAgentIdentityRecord({ tenantId, agentId: payerAgentId });
      const payeeIdentity = await getAgentIdentityRecord({ tenantId, agentId: payeeAgentId });
      if (!payerIdentity || !payeeIdentity) return sendError(res, 409, "agent identities missing for reversal", null, { code: "X402_GATE_INVALID" });
      const payerKeyId =
        payerIdentity?.keys && typeof payerIdentity.keys === "object" && !Array.isArray(payerIdentity.keys)
          ? String(payerIdentity.keys.keyId ?? "").trim()
          : "";
      const payerPublicKeyPem =
        payerIdentity?.keys && typeof payerIdentity.keys === "object" && !Array.isArray(payerIdentity.keys)
          ? String(payerIdentity.keys.publicKeyPem ?? "")
          : "";
      if (!payerKeyId || !payerPublicKeyPem.trim()) {
        return sendError(res, 409, "payer signature key is not configured", null, { code: "X402_REVERSAL_COMMAND_KEY_MISSING" });
      }

      const payeeKeyId =
        payeeIdentity?.keys && typeof payeeIdentity.keys === "object" && !Array.isArray(payeeIdentity.keys)
          ? String(payeeIdentity.keys.keyId ?? "").trim()
          : "";
      const payeePublicKeyPem =
        payeeIdentity?.keys && typeof payeeIdentity.keys === "object" && !Array.isArray(payeeIdentity.keys)
          ? String(payeeIdentity.keys.publicKeyPem ?? "")
          : "";
      if (!payeeKeyId || !payeePublicKeyPem.trim()) {
        return sendError(res, 409, "provider signature key is not configured", null, { code: "X402_PROVIDER_DECISION_KEY_MISSING" });
      }

      const quoteBinding = resolveX402GateQuoteBinding({ gate, settlement });
      const existingReversal =
        gate?.reversal && typeof gate.reversal === "object" && !Array.isArray(gate.reversal) ? gate.reversal : null;
      const priorReversalRequestEvidence = parseEvidenceRefSha256Selection(existingReversal?.evidenceRefs ?? [], "http:request_sha256:");
      const priorReversalRequestSha256 = priorReversalRequestEvidence.requestSha256;
      const expectedReversalRequestSha256 = quoteBinding.requestSha256 ?? (action === "resolve_refund" ? priorReversalRequestSha256 : null);
      if (action === "resolve_refund" && quoteBinding.requestSha256 && priorReversalRequestSha256 && priorReversalRequestSha256 !== quoteBinding.requestSha256) {
        return sendError(
          res,
          409,
          "reversal request hash evidence does not match gate binding",
          {
            gateId,
            action,
            requestSha256: priorReversalRequestSha256,
            requestSha256Values: [priorReversalRequestSha256, quoteBinding.requestSha256].sort(),
            expectedRequestSha256: quoteBinding.requestSha256
          },
          { code: "X402_REVERSAL_BINDING_EVIDENCE_MISMATCH" }
        );
      }
      const reversalRequestEvidence = parseEvidenceRefSha256Selection(reversalEvidenceRefs, "http:request_sha256:");
      const reversalRequestSha256 = reversalRequestEvidence.requestSha256;
      if (expectedReversalRequestSha256) {
        if (!reversalRequestSha256) {
          return sendError(
            res,
            409,
            "reversal requires request hash evidence",
            { gateId, action, expectedRequestSha256: expectedReversalRequestSha256 },
            { code: "X402_REVERSAL_BINDING_EVIDENCE_REQUIRED" }
          );
        }
        if (reversalRequestEvidence.hasConflict) {
          return sendError(
            res,
            409,
            "reversal request-hash evidence conflict for gate binding",
            {
              gateId,
              action,
              requestSha256: reversalRequestSha256,
              requestSha256Values: reversalRequestEvidence.requestSha256Values,
              expectedRequestSha256: expectedReversalRequestSha256
            },
            { code: "X402_REVERSAL_BINDING_EVIDENCE_MISMATCH" }
          );
        }
        if (reversalRequestSha256 !== expectedReversalRequestSha256) {
          return sendError(
            res,
            409,
            "reversal request hash evidence does not match gate binding",
            {
              gateId,
              action,
              requestSha256: reversalRequestSha256,
              expectedRequestSha256: expectedReversalRequestSha256
            },
            { code: "X402_REVERSAL_BINDING_EVIDENCE_MISMATCH" }
          );
        }
      }
      const gateAgentPassport =
        gate?.agentPassport && typeof gate.agentPassport === "object" && !Array.isArray(gate.agentPassport) ? gate.agentPassport : null;
      let resolvedWalletPolicy = null;
      if (gateAgentPassport) {
        const walletPolicyResolution = await resolveX402WalletPolicyForPassport({
          tenantId,
          gateAgentPassport
        });
        if (walletPolicyResolution?.error) {
          return sendError(
            res,
            409,
            "x402 wallet policy reference is invalid",
            {
              message: walletPolicyResolution.error.message ?? null,
              sponsorWalletRef: walletPolicyResolution.sponsorWalletRef ?? null
            },
            { code: walletPolicyResolution.error.code ?? "X402_WALLET_POLICY_REFERENCE_INVALID" }
          );
        }
        resolvedWalletPolicy = walletPolicyResolution?.policy ?? null;
      }
      if (resolvedWalletPolicy) {
        const policyStatus = String(resolvedWalletPolicy.status ?? "active").toLowerCase();
        if (policyStatus !== "active") {
          return sendError(
            res,
            409,
            "x402 wallet policy blocked reversal",
            { code: "X402_WALLET_POLICY_DISABLED" },
            { code: "X402_WALLET_POLICY_DISABLED" }
          );
        }
        if (
          Array.isArray(resolvedWalletPolicy.allowedReversalActions) &&
          resolvedWalletPolicy.allowedReversalActions.length > 0 &&
          !resolvedWalletPolicy.allowedReversalActions.includes(action)
        ) {
          return sendError(
            res,
            409,
            "x402 wallet policy blocked reversal action",
            {
              action,
              allowedReversalActions: resolvedWalletPolicy.allowedReversalActions
            },
            { code: "X402_WALLET_POLICY_REVERSAL_ACTION_NOT_ALLOWED" }
          );
        }
      }
      const expectedSponsorRef = quoteBinding.sponsorRef ?? payerAgentId;
      const commandSignatureKeyId =
        commandEnvelope?.signature && typeof commandEnvelope.signature === "object" && !Array.isArray(commandEnvelope.signature)
          ? String(commandEnvelope.signature.keyId ?? "").trim()
          : "";
      if (!commandSignatureKeyId) {
        return sendError(res, 400, "command.signature.keyId is required", null, { code: "SCHEMA_INVALID" });
      }
      if (commandSignatureKeyId !== payerKeyId) {
        return sendError(res, 409, "command signer key does not match payer key", null, { code: "X402_REVERSAL_COMMAND_SIGNER_MISMATCH" });
      }

      const nowAt = nowIso();
      const commandVerification = verifyX402ReversalCommandV1({
        command: commandEnvelope,
        publicKeyPem: payerPublicKeyPem,
        nowAt,
        expectedAction: action,
        expectedSponsorRef: expectedSponsorRef,
        expectedGateId: gateId,
        expectedReceiptId: reversalReceiptId,
        expectedQuoteId: quoteBinding.quoteId,
        expectedRequestSha256: expectedReversalRequestSha256
      });
      if (commandVerification.ok !== true) {
        const statusCode = String(commandVerification.code ?? "").endsWith("_SCHEMA_INVALID") ? 400 : 409;
        return sendError(
          res,
          statusCode,
          "reversal command verification failed",
          { message: commandVerification.error ?? null, code: commandVerification.code ?? null },
          { code: commandVerification.code ?? "X402_REVERSAL_COMMAND_INVALID" }
        );
      }
      const commandPayload = commandVerification.payload;

      const existingCommandUsage =
        typeof store.getX402ReversalCommandUsage === "function"
          ? await store.getX402ReversalCommandUsage({ tenantId, commandId: commandPayload.commandId })
          : store.x402ReversalCommandUsage instanceof Map
            ? store.x402ReversalCommandUsage.get(makeScopedKey({ tenantId, id: commandPayload.commandId })) ?? null
            : null;
      if (existingCommandUsage) {
        return sendError(res, 409, "reversal command already used", null, { code: "X402_REVERSAL_COMMAND_REPLAY" });
      }
      const existingNonceUsage =
        typeof store.getX402ReversalNonceUsage === "function"
          ? await store.getX402ReversalNonceUsage({ tenantId, sponsorRef: commandPayload.sponsorRef, nonce: commandPayload.nonce })
          : store.x402ReversalNonceUsage instanceof Map
            ? store.x402ReversalNonceUsage.get(`${normalizeTenantId(tenantId)}\n${commandPayload.sponsorRef}\n${commandPayload.nonce}`) ?? null
            : null;
      if (existingNonceUsage) {
        return sendError(res, 409, "reversal command nonce already used", null, { code: "X402_REVERSAL_NONCE_REPLAY" });
      }

      let priorReversalEvents = [];
      if (typeof store.listX402ReversalEvents === "function") {
        priorReversalEvents = await store.listX402ReversalEvents({ tenantId, gateId, limit: 1000, offset: 0 });
      } else if (store.x402ReversalEvents instanceof Map) {
        for (const row of store.x402ReversalEvents.values()) {
          if (!row || typeof row !== "object" || Array.isArray(row)) continue;
          if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== normalizeTenantId(tenantId)) continue;
          if (String(row.gateId ?? "") !== gateId) continue;
          priorReversalEvents.push(row);
        }
      }
      priorReversalEvents.sort((left, right) => {
        const leftMs = Number.isFinite(Date.parse(String(left?.occurredAt ?? ""))) ? Date.parse(String(left.occurredAt)) : Number.NaN;
        const rightMs = Number.isFinite(Date.parse(String(right?.occurredAt ?? ""))) ? Date.parse(String(right.occurredAt)) : Number.NaN;
        if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) return leftMs - rightMs;
        return String(left?.eventId ?? "").localeCompare(String(right?.eventId ?? ""));
      });
      const previousReversalEvent = priorReversalEvents.length > 0 ? priorReversalEvents[priorReversalEvents.length - 1] : null;
      const previousEventHash =
        typeof previousReversalEvent?.eventHash === "string" && previousReversalEvent.eventHash.trim() !== ""
          ? previousReversalEvent.eventHash.trim()
          : null;

      const commandArtifact = normalizeForCanonicalJson(
        {
          schemaVersion: "X402ReversalCommand.v1",
          commandId: commandPayload.commandId,
          sponsorRef: commandPayload.sponsorRef,
          ...(commandPayload.agentKeyId ? { agentKeyId: commandPayload.agentKeyId } : {}),
          target: commandPayload.target,
          action: commandPayload.action,
          nonce: commandPayload.nonce,
          idempotencyKey: commandPayload.idempotencyKey,
          exp: commandPayload.exp,
          signature:
            commandEnvelope?.signature && typeof commandEnvelope.signature === "object" && !Array.isArray(commandEnvelope.signature)
              ? commandEnvelope.signature
              : null
        },
        { path: "$" }
      );
      const commandVerificationRecord = normalizeForCanonicalJson(
        {
          schemaVersion: "X402ReversalCommandVerification.v1",
          verified: true,
          keyId: commandSignatureKeyId,
          publicKeyPem: payerPublicKeyPem,
          payloadHash: commandVerification.payloadHash,
          checkedAt: nowAt,
          code: null,
          error: null
        },
        { path: "$" }
      );

      const baseBindings =
        settlement?.decisionTrace?.bindings && typeof settlement.decisionTrace.bindings === "object" && !Array.isArray(settlement.decisionTrace.bindings)
          ? settlement.decisionTrace.bindings
          : null;

      let decisionArtifactVerification = null;
      if (action === "resolve_refund") {
        if (!providerDecisionArtifact) {
          return sendError(res, 400, "providerDecisionArtifact is required for resolve_refund", null, { code: "SCHEMA_INVALID" });
        }
        decisionArtifactVerification = verifyX402ProviderRefundDecisionV1({
          decision: providerDecisionArtifact,
          publicKeyPem: payeePublicKeyPem,
          expectedReceiptId: reversalReceiptId,
          expectedGateId: gateId,
          expectedQuoteId: quoteBinding.quoteId,
          expectedRequestSha256: expectedReversalRequestSha256,
          expectedDecision: providerDecision
        });
        if (decisionArtifactVerification.ok !== true) {
          const statusCode = String(decisionArtifactVerification.code ?? "").endsWith("_SCHEMA_INVALID") ? 400 : 409;
          return sendError(
            res,
            statusCode,
            "provider refund decision verification failed",
            { message: decisionArtifactVerification.error ?? null, code: decisionArtifactVerification.code ?? null },
            { code: decisionArtifactVerification.code ?? "X402_PROVIDER_DECISION_INVALID" }
          );
        }
        providerDecision = decisionArtifactVerification.payload?.decision ?? providerDecision;
      }

      let nextGate = gate;
      let nextSettlement = settlement;
      let payerWallet = null;
      let payeeWallet = null;
      let reversalEventRecord = null;
      const ops = [];
      let responseStatusCode = 200;
      let kernelRefs = null;
      let replayVerification = null;
      const reversalEventId = createId("x402rev");
      const settlementStatusBefore = String(settlement.status ?? "").toLowerCase();

      if (action === "void_authorization") {
        if (settlementStatusBefore !== AGENT_RUN_SETTLEMENT_STATUS.LOCKED) {
          return sendError(res, 409, "void is only allowed while settlement is locked", null, { code: "X402_REVERSAL_INVALID_STATE" });
        }
        const existingAuthorization =
          gate?.authorization && typeof gate.authorization === "object" && !Array.isArray(gate.authorization) ? gate.authorization : null;
        if (!existingAuthorization) return sendError(res, 409, "gate authorization missing", null, { code: "X402_GATE_INVALID" });

        const payerWalletExisting = typeof store.getAgentWallet === "function" ? await store.getAgentWallet({ tenantId, agentId: payerAgentId }) : null;
        if (!payerWalletExisting) return sendError(res, 409, "payer wallet missing", null, { code: "WALLET_MISSING" });
        try {
          payerWallet = refundAgentWalletEscrow({ wallet: payerWalletExisting, amountCents, at: nowAt });
        } catch (err) {
          if (err?.code === "INSUFFICIENT_ESCROW_BALANCE") {
            return sendError(res, 409, "insufficient escrow balance", { message: err?.message }, { code: "INSUFFICIENT_FUNDS" });
          }
          throw err;
        }

        let reserveOutcome = null;
        const reserveStatus = String(existingAuthorization?.reserve?.status ?? "").toLowerCase();
        const reserveId = typeof existingAuthorization?.reserve?.reserveId === "string" ? existingAuthorization.reserve.reserveId.trim() : "";
        if (reserveId && (reserveStatus === "reserved" || reserveStatus === "settled")) {
          try {
            reserveOutcome = await circleReserveAdapter.void({
              reserveId,
              amountCents,
              currency,
              idempotencyKey: `${gateId}:void_authorization`
            });
          } catch (err) {
            return sendError(
              res,
              503,
              "failed to void external reserve",
              { message: err?.message ?? String(err ?? ""), code: err?.code ?? null },
              { code: "X402_RESERVE_VOID_FAILED" }
            );
          }
        }

        const reasonCodes = ["X402_AUTHORIZATION_VOIDED"];
        kernelRefs = buildSettlementKernelRefs({
          settlement,
          agreementId: gate?.agreementHash ?? null,
          decisionStatus: AGENT_RUN_SETTLEMENT_DECISION_STATUS.MANUAL_RESOLVED,
          decisionMode: AGENT_RUN_SETTLEMENT_DECISION_MODE.MANUAL_REVIEW,
          decisionReason: "x402_authorization_voided",
          verificationStatus: "red",
          policyHash: null,
          verificationMethodHash: null,
          verificationMethodMode: "manual",
          verifierId: "nooterra.x402.reversal",
          verifierVersion: "v1",
          verifierHash: null,
          resolutionEventId: reversalEventId,
          status: AGENT_RUN_SETTLEMENT_STATUS.REFUNDED,
          releasedAmountCents: 0,
          refundedAmountCents: amountCents,
          releaseRatePct: 0,
          finalityState: SETTLEMENT_FINALITY_STATE.FINAL,
          settledAt: nowAt,
          createdAt: nowAt,
          bindings: baseBindings
        });
        reversalEventRecord = buildX402ReversalEventRecord({
          tenantId,
          gateId,
          receiptId: reversalReceiptId,
          action,
          eventType: "authorization_voided",
          occurredAt: nowAt,
          reason,
          providerDecision: "accepted",
          evidenceRefs: reversalEvidenceRefs,
          command: commandArtifact,
          commandVerification: commandVerificationRecord,
          settlementStatusBefore,
          settlementStatusAfter: AGENT_RUN_SETTLEMENT_STATUS.REFUNDED,
          previousEventHash,
          eventId: reversalEventId
        });
        const reversalWithEvent = appendX402GateReversalTimeline({
          gate,
          eventType: "authorization_voided",
          at: nowAt,
          reason,
          providerDecision: "accepted",
          evidenceRefs: reversalEvidenceRefs,
          action,
          eventId: reversalEventRecord.eventId,
          eventHash: reversalEventRecord.eventHash,
          prevEventHash: reversalEventRecord.prevEventHash ?? null,
          commandId: commandPayload.commandId
        });
        const reversal = normalizeForCanonicalJson(
          {
            ...reversalWithEvent,
            status: "voided",
            requestedAt: existingReversal?.requestedAt ?? nowAt,
            resolvedAt: nowAt,
            providerDecision: "accepted",
            reason: reason ?? existingReversal?.reason ?? null,
            evidenceRefs: reversalEvidenceRefs.length > 0 ? reversalEvidenceRefs : existingReversal?.evidenceRefs ?? []
          },
          { path: "$" }
        );
        const decisionTrace = normalizeForCanonicalJson(
          {
            schemaVersion: "X402GateDecisionTrace.v1",
            verificationStatus: "red",
            runStatus: "cancelled",
            shouldAutoResolve: true,
            reasonCodes,
            policyReleaseRatePct: 0,
            policyReleasedAmountCents: 0,
            policyRefundedAmountCents: amountCents,
            holdbackBps: 0,
            holdbackAmountCents: 0,
            holdbackReleaseEligibleAt: null,
            immediateReleasedAmountCents: 0,
            immediateRefundedAmountCents: amountCents,
            releaseRatePct: 0,
            verificationMethod: { mode: "manual", source: "x402_reversal_v1" },
            bindings: baseBindings,
            reversal,
            decisionRecord: kernelRefs?.decisionRecord ?? null,
            settlementReceipt: kernelRefs?.settlementReceipt ?? null
          },
          { path: "$" }
        );

        nextSettlement = resolveAgentRunSettlement({
          settlement,
          status: AGENT_RUN_SETTLEMENT_STATUS.REFUNDED,
          runStatus: "cancelled",
          releasedAmountCents: 0,
          refundedAmountCents: amountCents,
          releaseRatePct: 0,
          decisionStatus: AGENT_RUN_SETTLEMENT_DECISION_STATUS.MANUAL_RESOLVED,
          decisionMode: AGENT_RUN_SETTLEMENT_DECISION_MODE.MANUAL_REVIEW,
          decisionReason: "x402_authorization_voided",
          decisionTrace,
          resolutionEventId: reversalEventId,
          at: nowAt
        });

        const updatedAuthorization = normalizeForCanonicalJson(
          {
            ...existingAuthorization,
            status: "voided",
            walletEscrow:
              existingAuthorization.walletEscrow &&
              typeof existingAuthorization.walletEscrow === "object" &&
              !Array.isArray(existingAuthorization.walletEscrow)
                ? {
                    ...existingAuthorization.walletEscrow,
                    status: "unlocked",
                    unlockedAt: nowAt
                  }
                : existingAuthorization.walletEscrow ?? null,
            reserve:
              existingAuthorization.reserve &&
              typeof existingAuthorization.reserve === "object" &&
              !Array.isArray(existingAuthorization.reserve)
                ? {
                    ...existingAuthorization.reserve,
                    status: reserveOutcome?.status ?? "voided",
                    voidedAt: nowAt,
                    ...(reserveOutcome?.compensationReserveId ? { compensationReserveId: reserveOutcome.compensationReserveId } : {})
                  }
                : existingAuthorization.reserve ?? null,
            updatedAt: nowAt
          },
          { path: "$" }
        );
        nextGate = normalizeForCanonicalJson(
          {
            ...gate,
            status: "resolved",
            resolvedAt: nowAt,
            authorization: updatedAuthorization,
            reversal,
            updatedAt: nowAt
          },
          { path: "$" }
        );
        ops.push({ kind: "AGENT_WALLET_UPSERT", tenantId, wallet: payerWallet });
        ops.push({ kind: "AGENT_RUN_SETTLEMENT_UPSERT", tenantId, runId, settlement: nextSettlement });
        ops.push({ kind: "X402_GATE_UPSERT", tenantId, gateId, gate: nextGate });
      } else if (action === "request_refund") {
        if (settlementStatusBefore !== AGENT_RUN_SETTLEMENT_STATUS.RELEASED) {
          return sendError(res, 409, "refund request is only allowed after settlement release", null, {
            code: "X402_REVERSAL_INVALID_STATE"
          });
        }
        const existingReversalStatus = String(existingReversal?.status ?? "").toLowerCase();
        if (existingReversalStatus === "refund_pending") {
          return sendError(res, 409, "refund request is already pending for gate", null, {
            code: "X402_REVERSAL_INVALID_STATE"
          });
        }
        if (existingReversalStatus === "refunded") {
          return sendError(res, 409, "gate is already refunded", null, { code: "X402_REVERSAL_INVALID_STATE" });
        }
        const refundAmountCents = Number(settlement.releasedAmountCents ?? 0);
        if (!Number.isSafeInteger(refundAmountCents) || refundAmountCents <= 0) {
          return sendError(res, 409, "no releasable amount remains to reserve for refund", null, {
            code: "X402_REVERSAL_INVALID_STATE"
          });
        }
        const payeeWalletExisting = typeof store.getAgentWallet === "function" ? await store.getAgentWallet({ tenantId, agentId: payeeAgentId }) : null;
        if (!payeeWalletExisting) {
          return sendError(res, 409, "provider wallet missing for refund reserve", null, { code: "WALLET_MISSING" });
        }
        let refundReserve = null;
        try {
          payeeWallet = lockAgentWalletEscrow({ wallet: payeeWalletExisting, amountCents: refundAmountCents, at: nowAt });
          refundReserve = buildX402RefundReserveRecord({
            previousReserve: existingReversal?.reserve ?? null,
            status: "held",
            amountCents: refundAmountCents,
            currency,
            holderAgentId: payeeAgentId,
            heldAt: nowAt
          });
        } catch (err) {
          if (err?.code === "INSUFFICIENT_WALLET_BALANCE") {
            return sendError(
              res,
              409,
              "provider wallet balance insufficient for refund reserve",
              { message: err?.message, amountCents: refundAmountCents },
              { code: "X402_REFUND_RESERVE_LOCK_FAILED" }
            );
          }
          throw err;
        }
        reversalEventRecord = buildX402ReversalEventRecord({
          tenantId,
          gateId,
          receiptId: reversalReceiptId,
          action,
          eventType: "refund_requested",
          occurredAt: nowAt,
          reason,
          providerDecision: null,
          evidenceRefs: reversalEvidenceRefs,
          command: commandArtifact,
          commandVerification: commandVerificationRecord,
          reserve: refundReserve,
          settlementStatusBefore,
          settlementStatusAfter: AGENT_RUN_SETTLEMENT_STATUS.RELEASED,
          previousEventHash,
          eventId: reversalEventId
        });
        const reversalWithEvent = appendX402GateReversalTimeline({
          gate,
          eventType: "refund_requested",
          at: nowAt,
          reason,
          providerDecision: null,
          evidenceRefs: reversalEvidenceRefs,
          action,
          eventId: reversalEventRecord.eventId,
          eventHash: reversalEventRecord.eventHash,
          prevEventHash: reversalEventRecord.prevEventHash ?? null,
          commandId: commandPayload.commandId
        });
        const reversal = normalizeForCanonicalJson(
          {
            ...reversalWithEvent,
            status: "refund_pending",
            requestedAt: nowAt,
            resolvedAt: null,
            providerDecision: null,
            reason: reason ?? existingReversal?.reason ?? null,
            evidenceRefs: reversalEvidenceRefs.length > 0 ? reversalEvidenceRefs : existingReversal?.evidenceRefs ?? [],
            reserve: refundReserve
          },
          { path: "$" }
        );
        nextGate = normalizeForCanonicalJson(
          {
            ...gate,
            reversal,
            updatedAt: nowAt
          },
          { path: "$" }
        );
        responseStatusCode = 202;
        ops.push({ kind: "AGENT_WALLET_UPSERT", tenantId, wallet: payeeWallet });
        ops.push({ kind: "X402_GATE_UPSERT", tenantId, gateId, gate: nextGate });
      } else if (action === "resolve_refund") {
        if (String(existingReversal?.status ?? "").toLowerCase() !== "refund_pending") {
          return sendError(res, 409, "no pending refund request exists for gate", null, { code: "X402_REVERSAL_INVALID_STATE" });
        }
        if (!providerDecision) {
          return sendError(res, 400, "providerDecision is required for resolve_refund", null, { code: "SCHEMA_INVALID" });
        }
        const providerDecisionVerificationRecord = decisionArtifactVerification
          ? normalizeForCanonicalJson(
              {
                schemaVersion: "X402ProviderRefundDecisionVerification.v1",
                verified: true,
                keyId: payeeKeyId,
                publicKeyPem: payeePublicKeyPem,
                payloadHash: decisionArtifactVerification.payloadHash,
                checkedAt: nowAt,
                code: null,
                error: null
              },
              { path: "$" }
            )
          : null;
        const refundAmountCents = Number(settlement.releasedAmountCents ?? 0);
        if (!Number.isSafeInteger(refundAmountCents) || refundAmountCents <= 0) {
          return sendError(res, 409, "no releasable amount remains to refund", null, { code: "X402_REVERSAL_INVALID_STATE" });
        }
        const existingRefundReserve =
          existingReversal?.reserve && typeof existingReversal.reserve === "object" && !Array.isArray(existingReversal.reserve)
            ? existingReversal.reserve
            : null;
        if (!existingRefundReserve) {
          return sendError(res, 409, "refund reserve is required before resolution", null, { code: "X402_REFUND_RESERVE_MISSING" });
        }
        const existingRefundReserveStatus = String(existingRefundReserve.status ?? "").trim().toLowerCase();
        if (existingRefundReserveStatus !== "held") {
          return sendError(
            res,
            409,
            "refund reserve is not in held state",
            { reserveStatus: existingRefundReserveStatus || null },
            { code: "X402_REFUND_RESERVE_INVALID_STATE" }
          );
        }
        const existingRefundReserveAmountCents = Number(existingRefundReserve.amountCents ?? 0);
        if (!Number.isSafeInteger(existingRefundReserveAmountCents) || existingRefundReserveAmountCents <= 0) {
          return sendError(res, 409, "refund reserve amount is invalid", null, { code: "X402_REFUND_RESERVE_MISSING" });
        }
        if (existingRefundReserveAmountCents !== refundAmountCents) {
          return sendError(
            res,
            409,
            "refund reserve amount does not match settlement release amount",
            { reserveAmountCents: existingRefundReserveAmountCents, releasedAmountCents: refundAmountCents },
            { code: "X402_REFUND_RESERVE_AMOUNT_MISMATCH" }
          );
        }
        const existingRefundReserveHolderAgentId =
          typeof existingRefundReserve.holderAgentId === "string" ? existingRefundReserve.holderAgentId.trim() : "";
        if (existingRefundReserveHolderAgentId && existingRefundReserveHolderAgentId !== payeeAgentId) {
          return sendError(
            res,
            409,
            "refund reserve holder does not match provider",
            {
              reserveHolderAgentId: existingRefundReserveHolderAgentId,
              expectedHolderAgentId: payeeAgentId
            },
            { code: "X402_REFUND_RESERVE_HOLDER_MISMATCH" }
          );
        }
        const existingRefundReserveCurrency =
          typeof existingRefundReserve.currency === "string" ? existingRefundReserve.currency.trim().toUpperCase() : "";
        if (existingRefundReserveCurrency && existingRefundReserveCurrency !== currency) {
          return sendError(
            res,
            409,
            "refund reserve currency does not match settlement currency",
            {
              reserveCurrency: existingRefundReserveCurrency,
              settlementCurrency: currency
            },
            { code: "X402_REFUND_RESERVE_CURRENCY_MISMATCH" }
          );
        }
        if (providerDecision === "denied") {
          const payeeWalletExisting = typeof store.getAgentWallet === "function" ? await store.getAgentWallet({ tenantId, agentId: payeeAgentId }) : null;
          if (!payeeWalletExisting) {
            return sendError(res, 409, "provider wallet missing for refund reserve release", null, { code: "WALLET_MISSING" });
          }
          let refundReserve = null;
          try {
            payeeWallet = refundAgentWalletEscrow({
              wallet: payeeWalletExisting,
              amountCents: existingRefundReserveAmountCents,
              at: nowAt
            });
            refundReserve = buildX402RefundReserveRecord({
              previousReserve: existingRefundReserve,
              status: "released",
              amountCents: existingRefundReserveAmountCents,
              currency,
              holderAgentId: payeeAgentId,
              heldAt: existingRefundReserve.heldAt ?? existingReversal?.requestedAt ?? nowAt,
              releasedAt: nowAt
            });
          } catch (err) {
            if (err?.code === "INSUFFICIENT_ESCROW_BALANCE") {
              return sendError(
                res,
                409,
                "provider refund reserve is unavailable",
                { message: err?.message ?? null, amountCents: existingRefundReserveAmountCents },
                { code: "X402_REFUND_RESERVE_INVALID_STATE" }
              );
            }
            throw err;
          }
          reversalEventRecord = buildX402ReversalEventRecord({
            tenantId,
            gateId,
            receiptId: reversalReceiptId,
            action,
            eventType: "refund_resolved",
            occurredAt: nowAt,
            reason,
            providerDecision: "denied",
            evidenceRefs: reversalEvidenceRefs,
            command: commandArtifact,
            commandVerification: commandVerificationRecord,
            providerDecisionArtifact,
            providerDecisionVerification: providerDecisionVerificationRecord,
            reserve: refundReserve,
            settlementStatusBefore,
            settlementStatusAfter: AGENT_RUN_SETTLEMENT_STATUS.RELEASED,
            previousEventHash,
            eventId: reversalEventId
          });
          const reversalWithEvent = appendX402GateReversalTimeline({
            gate,
            eventType: "refund_resolved",
            at: nowAt,
            reason,
            providerDecision: "denied",
            evidenceRefs: reversalEvidenceRefs,
            action,
            eventId: reversalEventRecord.eventId,
            eventHash: reversalEventRecord.eventHash,
            prevEventHash: reversalEventRecord.prevEventHash ?? null,
            commandId: commandPayload.commandId
          });
          const reversal = normalizeForCanonicalJson(
            {
              ...reversalWithEvent,
              status: "refund_denied",
              requestedAt: existingReversal?.requestedAt ?? nowAt,
              resolvedAt: nowAt,
              providerDecision: "denied",
              reason: reason ?? existingReversal?.reason ?? null,
              evidenceRefs: reversalEvidenceRefs.length > 0 ? reversalEvidenceRefs : existingReversal?.evidenceRefs ?? [],
              reserve: refundReserve
            },
            { path: "$" }
          );
          nextGate = normalizeForCanonicalJson(
            {
              ...gate,
              reversal,
              updatedAt: nowAt
            },
            { path: "$" }
          );
          ops.push({ kind: "AGENT_WALLET_UPSERT", tenantId, wallet: payeeWallet });
          ops.push({ kind: "X402_GATE_UPSERT", tenantId, gateId, gate: nextGate });
        } else {
          if (settlementStatusBefore !== AGENT_RUN_SETTLEMENT_STATUS.RELEASED) {
            return sendError(res, 409, "refund resolution requires released settlement", null, {
              code: "X402_REVERSAL_INVALID_STATE"
            });
          }
          const payerWalletExisting = typeof store.getAgentWallet === "function" ? await store.getAgentWallet({ tenantId, agentId: payerAgentId }) : null;
          const payeeWalletExisting = typeof store.getAgentWallet === "function" ? await store.getAgentWallet({ tenantId, agentId: payeeAgentId }) : null;
          if (!payerWalletExisting || !payeeWalletExisting) return sendError(res, 409, "missing wallets for refund resolution", null, { code: "WALLET_MISSING" });
          let refundReserve = null;
          try {
            const transferred = releaseAgentWalletEscrowToPayee({
              payerWallet: payeeWalletExisting,
              payeeWallet: payerWalletExisting,
              amountCents: existingRefundReserveAmountCents,
              at: nowAt
            });
            payeeWallet = transferred.payerWallet;
            payerWallet = transferred.payeeWallet;
            refundReserve = buildX402RefundReserveRecord({
              previousReserve: existingRefundReserve,
              status: "consumed",
              amountCents: existingRefundReserveAmountCents,
              currency,
              holderAgentId: payeeAgentId,
              heldAt: existingRefundReserve.heldAt ?? existingReversal?.requestedAt ?? nowAt,
              consumedAt: nowAt
            });
          } catch (err) {
            if (err?.code === "INSUFFICIENT_ESCROW_BALANCE") {
              return sendError(
                res,
                409,
                "provider refund reserve is unavailable",
                { message: err?.message ?? null, amountCents: existingRefundReserveAmountCents },
                { code: "X402_REFUND_RESERVE_INVALID_STATE" }
              );
            }
            throw err;
          }
          reversalEventRecord = buildX402ReversalEventRecord({
            tenantId,
            gateId,
            receiptId: reversalReceiptId,
            action,
            eventType: "refund_resolved",
            occurredAt: nowAt,
            reason,
            providerDecision: "accepted",
            evidenceRefs: reversalEvidenceRefs,
            command: commandArtifact,
            commandVerification: commandVerificationRecord,
            providerDecisionArtifact,
            providerDecisionVerification: providerDecisionVerificationRecord,
            reserve: refundReserve,
            settlementStatusBefore,
            settlementStatusAfter: AGENT_RUN_SETTLEMENT_STATUS.REFUNDED,
            previousEventHash,
            eventId: reversalEventId
          });
          const reversalWithEvent = appendX402GateReversalTimeline({
            gate,
            eventType: "refund_resolved",
            at: nowAt,
            reason,
            providerDecision: "accepted",
            evidenceRefs: reversalEvidenceRefs,
            action,
            eventId: reversalEventRecord.eventId,
            eventHash: reversalEventRecord.eventHash,
            prevEventHash: reversalEventRecord.prevEventHash ?? null,
            commandId: commandPayload.commandId
          });
          const reversal = normalizeForCanonicalJson(
            {
              ...reversalWithEvent,
              status: "refunded",
              requestedAt: existingReversal?.requestedAt ?? nowAt,
              resolvedAt: nowAt,
              providerDecision: "accepted",
              reason: reason ?? existingReversal?.reason ?? null,
              evidenceRefs: reversalEvidenceRefs.length > 0 ? reversalEvidenceRefs : existingReversal?.evidenceRefs ?? [],
              reserve: refundReserve
            },
            { path: "$" }
          );
          kernelRefs = buildSettlementKernelRefs({
            settlement,
            agreementId: gate?.agreementHash ?? null,
            decisionStatus: AGENT_RUN_SETTLEMENT_DECISION_STATUS.MANUAL_RESOLVED,
            decisionMode: AGENT_RUN_SETTLEMENT_DECISION_MODE.MANUAL_REVIEW,
            decisionReason: "x402_refund_accepted",
            verificationStatus: "amber",
            policyHash: null,
            verificationMethodHash: null,
            verificationMethodMode: "manual",
            verifierId: "nooterra.x402.reversal",
            verifierVersion: "v1",
            verifierHash: null,
            resolutionEventId: reversalEventId,
            status: AGENT_RUN_SETTLEMENT_STATUS.REFUNDED,
            releasedAmountCents: 0,
            refundedAmountCents: refundAmountCents,
            releaseRatePct: 0,
            finalityState: SETTLEMENT_FINALITY_STATE.FINAL,
            settledAt: nowAt,
            createdAt: nowAt,
            bindings: baseBindings
          });
          const decisionTrace = normalizeForCanonicalJson(
            {
              ...(settlement?.decisionTrace && typeof settlement.decisionTrace === "object" && !Array.isArray(settlement.decisionTrace)
                ? settlement.decisionTrace
                : {}),
              schemaVersion: "X402GateDecisionTrace.v1",
              reversal,
              reasonCodes: Array.from(
                new Set([
                  ...(Array.isArray(settlement?.decisionTrace?.reasonCodes) ? settlement.decisionTrace.reasonCodes : []),
                  "X402_REFUND_ACCEPTED"
                ])
              ),
              decisionRecord: kernelRefs?.decisionRecord ?? null,
              settlementReceipt: kernelRefs?.settlementReceipt ?? null
            },
            { path: "$" }
          );
          nextSettlement = refundReleasedAgentRunSettlement({
            settlement,
            runStatus: "refunded",
            decisionStatus: AGENT_RUN_SETTLEMENT_DECISION_STATUS.MANUAL_RESOLVED,
            decisionMode: AGENT_RUN_SETTLEMENT_DECISION_MODE.MANUAL_REVIEW,
            decisionReason: "x402_refund_accepted",
            decisionTrace,
            resolutionEventId: reversalEventId,
            at: nowAt
          });
          nextGate = normalizeForCanonicalJson(
            {
              ...gate,
              reversal,
              decision: {
                ...(gate?.decision && typeof gate.decision === "object" && !Array.isArray(gate.decision) ? gate.decision : {}),
                releaseRatePct: 0,
                releasedAmountCents: 0,
                refundedAmountCents: refundAmountCents,
                reasonCodes: Array.from(
                  new Set([
                    ...(Array.isArray(gate?.decision?.reasonCodes) ? gate.decision.reasonCodes : []),
                    "X402_REFUND_ACCEPTED"
                  ])
                ),
                policyDecisionFingerprint:
                  settlement?.decisionTrace?.bindings?.policyDecisionFingerprint ??
                  gate?.decision?.policyDecisionFingerprint ??
                  null
              },
              updatedAt: nowAt
            },
            { path: "$" }
          );
          ops.push({ kind: "AGENT_WALLET_UPSERT", tenantId, wallet: payerWallet });
          ops.push({ kind: "AGENT_WALLET_UPSERT", tenantId, wallet: payeeWallet });
          ops.push({ kind: "AGENT_RUN_SETTLEMENT_UPSERT", tenantId, runId, settlement: nextSettlement });
          ops.push({ kind: "X402_GATE_UPSERT", tenantId, gateId, gate: nextGate });
        }
      }
      if (action === "resolve_refund" && replayVerificationInput) {
        replayVerification = runReplayVerificationForSettlement({
          replayVerificationInput,
          settlement: nextSettlement,
          tenantId,
          defaultExpectedSessionId: replayVerificationInput?.memoryExport?.sessionId ?? null
        });
        if (replayVerification.ok !== true) {
          return sendError(
            res,
            409,
            "reversal adjudication replay verification failed",
            {
              operation: "x402.gate.reversal.resolve_refund",
              gateId,
              runId,
              verdict: replayVerification.verdict ?? null
            },
            { code: "X402_REVERSAL_REPLAY_VERDICT_INVALID" }
          );
        }
      }

      const commandUsageRecord = normalizeForCanonicalJson(
        {
          schemaVersion: "X402ReversalCommandUsage.v1",
          tenantId,
          commandId: commandPayload.commandId,
          sponsorRef: commandPayload.sponsorRef,
          nonce: commandPayload.nonce,
          action,
          gateId,
          receiptId: reversalReceiptId,
          eventId: reversalEventRecord?.eventId ?? reversalEventId,
          usedAt: nowAt
        },
        { path: "$" }
      );
      const nonceUsageRecord = normalizeForCanonicalJson(
        {
          schemaVersion: "X402ReversalNonceUsage.v1",
          tenantId,
          sponsorRef: commandPayload.sponsorRef,
          nonce: commandPayload.nonce,
          commandId: commandPayload.commandId,
          action,
          gateId,
          receiptId: reversalReceiptId,
          eventId: reversalEventRecord?.eventId ?? reversalEventId,
          usedAt: nowAt
        },
        { path: "$" }
      );
      if (reversalEventRecord) {
        ops.push({
          kind: "X402_REVERSAL_EVENT_APPEND",
          tenantId,
          gateId,
          eventId: reversalEventRecord.eventId,
          event: reversalEventRecord
        });
      }
      ops.push({
        kind: "X402_REVERSAL_COMMAND_PUT",
        tenantId,
        commandId: commandUsageRecord.commandId,
        usage: commandUsageRecord
      });
      ops.push({
        kind: "X402_REVERSAL_NONCE_PUT",
        tenantId,
        sponsorRef: nonceUsageRecord.sponsorRef,
        nonce: nonceUsageRecord.nonce,
        usage: nonceUsageRecord
      });
      await appendX402ReceiptPutIfMissing({
        ops,
        tenantId,
        gate: nextGate,
        settlement: nextSettlement,
        includeReversalContext: false
      });

      const responseBody = {
        ok: true,
        action,
        gate: nextGate,
        settlement: nextSettlement,
        reversal: nextGate?.reversal ?? null,
        reversalEvent: reversalEventRecord,
        ...(replayVerification ? { replayVerification } : {}),
        ...(kernelRefs?.decisionRecord ? { decisionRecord: kernelRefs.decisionRecord } : {}),
        ...(kernelRefs?.settlementReceipt ? { settlementReceipt: kernelRefs.settlementReceipt } : {})
      };
      if (idemStoreKey) {
        ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: responseStatusCode, body: responseBody } });
      }
      if (ops.length > 0) await commitTx(ops);
      return sendJson(res, responseStatusCode, responseBody);
    }

    if (parts[0] === "x402" && parts[1] === "reversal-events" && parts.length === 2 && req.method === "GET") {
      if (typeof store.listX402ReversalEvents !== "function") {
        return sendError(res, 501, "x402 reversal events not supported for this store", null, { code: "X402_REVERSAL_EVENTS_LIST_UNSUPPORTED" });
      }
      const gateId = typeof url.searchParams.get("gateId") === "string" && url.searchParams.get("gateId").trim() !== "" ? url.searchParams.get("gateId").trim() : null;
      const receiptId =
        typeof url.searchParams.get("receiptId") === "string" && url.searchParams.get("receiptId").trim() !== ""
          ? url.searchParams.get("receiptId").trim()
          : null;
      const action = typeof url.searchParams.get("action") === "string" && url.searchParams.get("action").trim() !== "" ? url.searchParams.get("action").trim() : null;
      const from = typeof url.searchParams.get("from") === "string" && url.searchParams.get("from").trim() !== "" ? url.searchParams.get("from").trim() : null;
      const to = typeof url.searchParams.get("to") === "string" && url.searchParams.get("to").trim() !== "" ? url.searchParams.get("to").trim() : null;
      const limitRaw = url.searchParams.get("limit");
      const offsetRaw = url.searchParams.get("offset");
      const limit = limitRaw ? Number(limitRaw) : 200;
      const offset = offsetRaw ? Number(offsetRaw) : 0;
      let events = [];
      try {
        events = await store.listX402ReversalEvents({ tenantId, gateId, receiptId, action, from, to, limit, offset });
      } catch (err) {
        return sendError(res, 400, "invalid reversal event query", { message: err?.message }, { code: "X402_REVERSAL_EVENTS_LIST_INVALID" });
      }
      return sendJson(res, 200, { events, limit, offset });
    }

    if (parts[0] === "x402" && parts[1] === "reversal-events" && parts[2] && parts.length === 3 && req.method === "GET") {
      if (typeof store.getX402ReversalEvent !== "function") {
        return sendError(res, 501, "x402 reversal events not supported for this store", null, { code: "X402_REVERSAL_EVENT_GET_UNSUPPORTED" });
      }
      const eventId = parts[2];
      let event = null;
      try {
        event = await store.getX402ReversalEvent({ tenantId, eventId });
      } catch (err) {
        return sendError(res, 400, "invalid reversal event id", { message: err?.message }, { code: "X402_REVERSAL_EVENT_ID_INVALID" });
      }
      if (!event) return sendError(res, 404, "reversal event not found", null, { code: "X402_REVERSAL_EVENT_NOT_FOUND" });
      return sendJson(res, 200, { event });
    }

      if (parts[0] === "x402" && parts[1] === "gate" && parts[2] && parts.length === 3 && req.method === "GET") {
        const gateId = parts[2];
        const gate = typeof store.getX402Gate === "function" ? await store.getX402Gate({ tenantId, gateId }) : null;
        if (!gate) return sendError(res, 404, "gate not found", null, { code: "NOT_FOUND" });
        const runId = String(gate.runId ?? "");
        const settlement = runId && typeof store.getAgentRunSettlement === "function" ? await store.getAgentRunSettlement({ tenantId, runId }) : null;
        const holdbackRunId = String(gate?.holdback?.runId ?? gate?.decision?.holdbackRunId ?? "");
        const holdbackSettlement =
          holdbackRunId && typeof store.getAgentRunSettlement === "function"
            ? await store.getAgentRunSettlement({ tenantId, runId: holdbackRunId })
            : null;
        return sendJson(res, 200, { ok: true, gate, settlement, holdbackSettlement });
      }
    }

    // Check if the response was sent by a route that uses bare "return;" (e.g. SSE streams).
    if (res.writableEnded || res.headersSent) return true;

    return false;
  };
}
