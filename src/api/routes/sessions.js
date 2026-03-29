/**
 * Session routes: /sessions, /sessions/:sessionId, /sessions/:sessionId/events, etc.
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
export function createSessionRoutes(deps) {
  const {
    store,
    sendJson,
    sendError,
    readJsonBody,
    readRawBody,
    createId,
    nowIso,
    commitTx,
    normalizeForCanonicalJson,
    getSessionRecord,
    createSessionRecord,
    listSessionRecords,
    appendSessionEvents,
    listSessionEvents,
    countSessionEvents,
    getSessionCheckpoint,
    upsertSessionCheckpoint,
    buildSessionMemoryExportV1,
    buildSessionReplayPackV1,
    buildSessionTranscriptV1,
    verifySessionReplayRequestV1,
    requireSessionParticipantAccess,
    normalizeSessionCreate,
    decodePathPart,
    requireProtocolHeaderForWrite,
    parseBooleanQueryValue,
    parseThresholdIntegerQueryValue,
    Readable,
    logger
  } = deps;

  // Wrap response helpers to return true (signals "handled" to dispatcher).
  const _sendJson = (...args) => { deps.sendJson(...args); return true; };
  const _sendError = (...args) => { deps.sendError(...args); return true; };

  /**
   * @param {object} ctx - Per-request context
   * @returns {Promise<boolean>} true if handled
   */
  return async function handleSessionRoutes(ctx) {
    const { req, res, method, path, url, tenantId, principalId, auth } = ctx;
    // Use wrapped versions that return true for "return sendJson/sendError(...)" pattern.
    const sendJson = _sendJson;
    const sendError = _sendError;

    if (!path.startsWith("/sessions")) return false;

    if (req.method === "POST" && path === "/sessions") {
    const hasSessionStore = typeof store.getSession === "function" || typeof store.listSessions === "function" || store.sessions instanceof Map;
    if (!hasSessionStore) return sendError(res, 501, "sessions not supported for this store");
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

    const sessionId = typeof body?.sessionId === "string" && body.sessionId.trim() !== "" ? body.sessionId.trim() : createId("sess");
    const existingSession = await getSessionRecord({ tenantId, sessionId });
    if (existingSession) return sendError(res, 409, "session already exists", null, { code: "CONFLICT" });

    let visibility = SESSION_VISIBILITY.TENANT;
    try {
      visibility = parseSessionVisibility(body?.visibility, { allowAll: false, defaultVisibility: SESSION_VISIBILITY.TENANT });
    } catch (err) {
      return sendError(res, 400, "invalid session visibility", { message: err?.message }, { code: "SCHEMA_INVALID" });
    }

    let session = null;
    try {
      session = buildSessionV1({
        sessionId,
        tenantId,
        visibility,
        participants: Array.isArray(body?.participants) ? body.participants : [],
        policyRef: body?.policyRef ?? null,
        metadata: body?.metadata ?? null,
        createdAt: typeof body?.createdAt === "string" && body.createdAt.trim() !== "" ? body.createdAt.trim() : nowIso()
      });
      validateSessionV1(session);
    } catch (err) {
      return sendError(res, 400, "invalid session", { message: err?.message }, { code: "SCHEMA_INVALID" });
    }

    const responseBody = { ok: true, session };
    const ops = [{ kind: "SESSION_UPSERT", tenantId, sessionId, session }];
    if (idemStoreKey) {
      ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
    }
    await commitTx(ops);
    return sendJson(res, 201, responseBody);
    }

    if (req.method === "GET" && path === "/sessions") {
    const hasSessionStore = typeof store.listSessions === "function" || store.sessions instanceof Map;
    if (!hasSessionStore) return sendError(res, 501, "sessions not supported for this store");
    const sessionIdRaw = url.searchParams.get("sessionId");
    const visibilityRaw = url.searchParams.get("visibility");
    const participantAgentIdRaw = url.searchParams.get("participantAgentId");
    const limitRaw = url.searchParams.get("limit");
    const offsetRaw = url.searchParams.get("offset");

    const sessionId = typeof sessionIdRaw === "string" && sessionIdRaw.trim() !== "" ? sessionIdRaw.trim() : null;
    const participantAgentId =
      typeof participantAgentIdRaw === "string" && participantAgentIdRaw.trim() !== "" ? participantAgentIdRaw.trim() : null;
    const limit = limitRaw === null || limitRaw === "" ? 200 : Number(limitRaw);
    const offset = offsetRaw === null || offsetRaw === "" ? 0 : Number(offsetRaw);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) {
      return sendError(res, 400, "invalid session query", { message: "limit must be an integer in range 1..2000" }, { code: "SCHEMA_INVALID" });
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      return sendError(res, 400, "invalid session query", { message: "offset must be a non-negative integer" }, { code: "SCHEMA_INVALID" });
    }

    let visibility = null;
    try {
      visibility =
        typeof visibilityRaw === "string" && visibilityRaw.trim() !== ""
          ? parseSessionVisibility(visibilityRaw, { allowAll: false, defaultVisibility: SESSION_VISIBILITY.TENANT })
          : null;
    } catch (err) {
      return sendError(res, 400, "invalid session query", { message: err?.message }, { code: "SCHEMA_INVALID" });
    }

    let sessions = [];
    try {
      sessions = await listSessionRecords({ tenantId, sessionId, visibility, participantAgentId, limit, offset });
    } catch (err) {
      return sendError(res, 400, "invalid session query", { message: err?.message }, { code: "SCHEMA_INVALID" });
    }
    return sendJson(res, 200, { ok: true, sessions, limit, offset });
    }

    {
    const parts = path.split("/").filter(Boolean);

    if (parts[0] === "sessions" && parts[1] && parts.length === 2 && req.method === "GET") {
      const sessionId = decodePathPart(parts[1]);
      let session = null;
      try {
        session = await getSessionRecord({ tenantId, sessionId });
      } catch (err) {
        return sendError(res, 501, "sessions not supported for this store", { message: err?.message });
      }
      if (!session) return sendError(res, 404, "session not found", null, { code: "NOT_FOUND" });
      if (!requireSessionParticipantAccess({ req, res, session, sessionId, principalId })) return;
      return sendJson(res, 200, { ok: true, session });
    }

    if (parts[0] === "sessions" && parts[1] === "replay-verify" && parts.length === 2 && req.method === "POST") {
      if (!requireProtocolHeaderForWrite(req, res)) return;
      const body = await readJsonBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return sendError(res, 400, "invalid replay verification request", null, { code: "SCHEMA_INVALID" });
      }
      const verification = verifySessionReplayRequestV1({
        memoryExport: body?.memoryExport,
        replayPack: body?.replayPack,
        transcript: body?.transcript ?? null,
        memoryExportRef: body?.memoryExportRef ?? null,
        expectedTenantId: body?.expectedTenantId ?? null,
        expectedSessionId: body?.expectedSessionId ?? null,
        expectedPreviousHeadChainHash: body?.expectedPreviousHeadChainHash ?? null,
        expectedPreviousPackHash: body?.expectedPreviousPackHash ?? null,
        replayPackPublicKeyPem: body?.replayPackPublicKeyPem ?? null,
        transcriptPublicKeyPem: body?.transcriptPublicKeyPem ?? null,
        requireReplayPackSignature: body?.requireReplayPackSignature === true,
        requireTranscriptSignature: body?.requireTranscriptSignature === true,
        expectedPolicyDecisionHash: body?.expectedPolicyDecisionHash ?? null,
        settlement: body?.settlement ?? null,
        expectedSettlement: body?.expectedSettlement ?? null
      });
      return sendJson(res, 200, verification);
    }

    if (parts[0] === "sessions" && parts[1] && parts[2] === "replay-export" && parts.length === 3 && req.method === "GET") {
      const sessionId = decodePathPart(parts[1]);
      const signRaw = url.searchParams.get("sign");
      const signerKeyIdRaw = url.searchParams.get("signerKeyId");
      const includeTranscriptRaw = url.searchParams.get("includeTranscript");
      const memoryScopeRaw = url.searchParams.get("memoryScope");
      let signReplayExport = false;
      let signerKeyId = null;
      let includeTranscript = true;
      let memoryScope = null;
      try {
        signReplayExport = parseBooleanQueryValue(signRaw, { defaultValue: false, name: "sign" });
        signerKeyId = parseSessionArtifactSignerKeyId(signerKeyIdRaw, { allowNull: true });
        includeTranscript = parseBooleanQueryValue(includeTranscriptRaw, { defaultValue: true, name: "includeTranscript" });
        memoryScope = parseSessionMemoryAccessScope(memoryScopeRaw, { allowNull: true, name: "memoryScope" });
        if (!signReplayExport && signerKeyId !== null) {
          throw new TypeError("signerKeyId requires sign=true");
        }
      } catch (err) {
        return sendError(res, 400, "invalid session replay export query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const session = await getSessionRecord({ tenantId, sessionId });
      if (!session) return sendError(res, 404, "session not found", null, { code: "NOT_FOUND" });
      if (!requireSessionParticipantAccess({ req, res, session, sessionId, principalId })) return;
      if (typeof store.appendOpsAudit !== "function") {
        return sendError(res, 501, "session memory access audit not supported for this store", { sessionId }, { code: "AUDIT_LOG_UNSUPPORTED" });
      }

      let callerPrincipalId = null;
      try {
        callerPrincipalId = normalizePrincipalId(req?.headers ?? {});
      } catch {
        callerPrincipalId = typeof principalId === "string" && principalId.trim() !== "" ? principalId.trim() : null;
      }

      const memoryAccess = evaluateSessionMemoryReadAccessV1({
        principalId: callerPrincipalId,
        participants: Array.isArray(session?.participants) ? session.participants : [],
        policy: session?.metadata?.memoryAccessPolicy ?? null,
        scope: memoryScope
      });
      if (!memoryAccess.ok) {
        try {
          await store.appendOpsAudit({
            tenantId,
            audit: makeOpsAudit({
              action: "SESSION_MEMORY_READ_DENIED",
              targetType: "session",
              targetId: sessionId,
              details: {
                path: `/sessions/${sessionId}/replay-export`,
                sessionId,
                principalId: callerPrincipalId ?? null,
                requestedScope: memoryScope ?? null,
                resolvedScope: memoryAccess.scope ?? null,
                reasonCode: memoryAccess.code ?? null,
                policyHash: memoryAccess.policyHash ?? null
              }
            })
          });
        } catch (err) {
          return sendError(res, 500, "failed to write audit record", { message: err?.message }, { code: "AUDIT_LOG_FAILED" });
        }
        return sendError(
          res,
          403,
          "session memory access denied",
          {
            sessionId,
            principalId: callerPrincipalId ?? null,
            requestedScope: memoryScope ?? null,
            resolvedScope: memoryAccess.scope ?? null
          },
          { code: memoryAccess.code ?? "SESSION_MEMORY_ACCESS_DENIED" }
        );
      }

      const verified = await resolveVerifiedSessionMaterial({ tenantId, sessionId, artifactLabel: "session replay export" });
      if (!verified.ok) {
        return sendError(
          res,
          verified.httpStatus ?? 409,
          verified.message ?? "session replay export blocked",
          verified.details ?? null,
          { code: verified.code ?? "SESSION_REPLAY_EXPORT_INVALID" }
        );
      }

      let replayPack = null;
      let transcript = null;
      let signingCandidate = null;
      try {
        replayPack = buildSessionReplayPackV1({
          tenantId,
          session: verified.session,
          events: verified.events,
          verification: verified.verification
        });
        if (includeTranscript) {
          transcript = buildSessionTranscriptV1({
            tenantId,
            session: verified.session,
            events: verified.events,
            verification: verified.verification
          });
        }
        if (signReplayExport) {
          const signingAt = transcript?.generatedAt ?? replayPack.generatedAt;
          signingCandidate = await resolveSessionArtifactSigningCandidate({ tenantId, signerKeyId, at: signingAt });
          replayPack = signSessionReplayPackV1({
            replayPack,
            signedAt: replayPack.generatedAt,
            publicKeyPem: signingCandidate.publicKeyPem,
            privateKeyPem: signingCandidate.privateKeyPem,
            keyId: signingCandidate.keyId
          });
          if (transcript) {
            transcript = signSessionTranscriptV1({
              transcript,
              signedAt: transcript.generatedAt,
              publicKeyPem: signingCandidate.publicKeyPem,
              privateKeyPem: signingCandidate.privateKeyPem,
              keyId: signingCandidate.keyId
            });
          }
        }
      } catch (err) {
        return sendError(
          res,
          409,
          "session replay export blocked",
          { sessionId, reason: err?.message ?? "invalid replay export" },
          { code: signReplayExport ? "SESSION_REPLAY_EXPORT_SIGNING_BLOCKED" : "SESSION_REPLAY_EXPORT_INVALID" }
        );
      }

      const { memoryExport, memoryExportRef } = buildSessionMemoryExportResponseV1({
        replayPack,
        transcript,
        exportedAt: replayPack.generatedAt,
        exportId: `session_export_${replayPack.packHash}`,
        tenantId
      });
      const importVerification = verifySessionMemoryImportRequestV1({
        memoryExport,
        replayPack,
        transcript,
        expectedMemoryExportRef: memoryExportRef,
        expectedTenantId: tenantId,
        expectedSessionId: sessionId,
        expectedPreviousHeadChainHash: memoryExport?.continuity?.previousHeadChainHash ?? null,
        expectedPreviousPackHash: memoryExport?.continuity?.previousPackHash ?? null,
        replayPackPublicKeyPem: signReplayExport ? signingCandidate?.publicKeyPem ?? null : null,
        transcriptPublicKeyPem: signReplayExport ? signingCandidate?.publicKeyPem ?? null : null,
        requireReplayPackSignature: signReplayExport,
        requireTranscriptSignature: signReplayExport && Boolean(transcript)
      });
      if (!importVerification.ok) {
        return sendError(
          res,
          409,
          "session replay export blocked",
          {
            sessionId,
            reasonCode: importVerification.code ?? null,
            reason: importVerification.error ?? "session replay export dependency validation failed"
          },
          { code: "SESSION_REPLAY_EXPORT_INCOMPLETE" }
        );
      }
      const exportMetadata = buildSessionReplayExportMetadataV1({
        replayPack,
        transcript,
        memoryExport,
        memoryExportRef,
        importVerification
      });
      try {
        await store.appendOpsAudit({
          tenantId,
          audit: makeOpsAudit({
            action: "SESSION_MEMORY_READ_ALLOWED",
            targetType: "session",
            targetId: sessionId,
            details: {
              path: `/sessions/${sessionId}/replay-export`,
              sessionId,
              principalId: callerPrincipalId ?? null,
              requestedScope: memoryScope ?? null,
              resolvedScope: memoryAccess.scope ?? null,
              policyHash: memoryAccess.policyHash ?? null,
              replayPackHash: replayPack?.packHash ?? null,
              memoryExportHash: exportMetadata?.memoryExportHash ?? null,
              exportHash: exportMetadata?.exportHash ?? null
            }
          })
        });
      } catch (err) {
        return sendError(res, 500, "failed to write audit record", { message: err?.message }, { code: "AUDIT_LOG_FAILED" });
      }
      return sendJson(res, 200, { ok: true, replayPack, transcript, memoryExport, memoryExportRef, exportMetadata });
    }

    if (parts[0] === "sessions" && parts[1] && parts[2] === "replay-pack" && parts.length === 3 && req.method === "GET") {
      const sessionId = decodePathPart(parts[1]);
      const signRaw = url.searchParams.get("sign");
      const signerKeyIdRaw = url.searchParams.get("signerKeyId");
      let signReplayPack = false;
      let signerKeyId = null;
      try {
        signReplayPack = parseBooleanQueryValue(signRaw, { defaultValue: false, name: "sign" });
        signerKeyId = parseSessionArtifactSignerKeyId(signerKeyIdRaw, { allowNull: true });
        if (!signReplayPack && signerKeyId !== null) {
          throw new TypeError("signerKeyId requires sign=true");
        }
      } catch (err) {
        return sendError(res, 400, "invalid session replay pack query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const session = await getSessionRecord({ tenantId, sessionId });
      if (!session) return sendError(res, 404, "session not found", null, { code: "NOT_FOUND" });
      if (!requireSessionParticipantAccess({ req, res, session, sessionId, principalId })) return;
      const verified = await resolveVerifiedSessionMaterial({ tenantId, sessionId, artifactLabel: "session replay pack" });
      if (!verified.ok) {
        return sendError(
          res,
          verified.httpStatus ?? 409,
          verified.message ?? "session replay pack blocked",
          verified.details ?? null,
          { code: verified.code ?? "SESSION_REPLAY_PACK_INVALID" }
        );
      }
      let replayPack = null;
      try {
        replayPack = buildSessionReplayPackV1({
          tenantId,
          session: verified.session,
          events: verified.events,
          verification: verified.verification
        });
        if (signReplayPack) {
          const signingCandidate = await resolveSessionArtifactSigningCandidate({ tenantId, signerKeyId, at: replayPack.generatedAt });
          replayPack = signSessionReplayPackV1({
            replayPack,
            signedAt: replayPack.generatedAt,
            publicKeyPem: signingCandidate.publicKeyPem,
            privateKeyPem: signingCandidate.privateKeyPem,
            keyId: signingCandidate.keyId
          });
        }
      } catch (err) {
        return sendError(
          res,
          409,
          "session replay pack blocked",
          { sessionId, reason: err?.message ?? "invalid replay pack" },
          { code: signReplayPack ? "SESSION_REPLAY_PACK_SIGNING_BLOCKED" : "SESSION_REPLAY_PACK_INVALID" }
        );
      }
      return sendJson(res, 200, { ok: true, replayPack });
    }

    if (parts[0] === "sessions" && parts[1] && parts[2] === "transcript" && parts.length === 3 && req.method === "GET") {
      const sessionId = decodePathPart(parts[1]);
      const signRaw = url.searchParams.get("sign");
      const signerKeyIdRaw = url.searchParams.get("signerKeyId");
      let signTranscript = false;
      let signerKeyId = null;
      try {
        signTranscript = parseBooleanQueryValue(signRaw, { defaultValue: false, name: "sign" });
        signerKeyId = parseSessionArtifactSignerKeyId(signerKeyIdRaw, { allowNull: true });
        if (!signTranscript && signerKeyId !== null) {
          throw new TypeError("signerKeyId requires sign=true");
        }
      } catch (err) {
        return sendError(res, 400, "invalid session transcript query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const session = await getSessionRecord({ tenantId, sessionId });
      if (!session) return sendError(res, 404, "session not found", null, { code: "NOT_FOUND" });
      if (!requireSessionParticipantAccess({ req, res, session, sessionId, principalId })) return;
      const verified = await resolveVerifiedSessionMaterial({ tenantId, sessionId, artifactLabel: "session transcript" });
      if (!verified.ok) {
        return sendError(
          res,
          verified.httpStatus ?? 409,
          verified.message ?? "session transcript blocked",
          verified.details ?? null,
          { code: verified.code ?? "SESSION_TRANSCRIPT_INVALID" }
        );
      }
      let transcript = null;
      try {
        transcript = buildSessionTranscriptV1({
          tenantId,
          session: verified.session,
          events: verified.events,
          verification: verified.verification
        });
        if (signTranscript) {
          const signingCandidate = await resolveSessionArtifactSigningCandidate({ tenantId, signerKeyId, at: transcript.generatedAt });
          transcript = signSessionTranscriptV1({
            transcript,
            signedAt: transcript.generatedAt,
            publicKeyPem: signingCandidate.publicKeyPem,
            privateKeyPem: signingCandidate.privateKeyPem,
            keyId: signingCandidate.keyId
          });
        }
      } catch (err) {
        return sendError(
          res,
          409,
          "session transcript blocked",
          { sessionId, reason: err?.message ?? "invalid session transcript" },
          { code: signTranscript ? "SESSION_TRANSCRIPT_SIGNING_BLOCKED" : "SESSION_TRANSCRIPT_INVALID" }
        );
      }
      return sendJson(res, 200, { ok: true, transcript });
    }

    if (parts[0] === "sessions" && parts[1] && parts[2] === "events" && parts[3] === "checkpoint" && parts.length === 4 && req.method === "GET") {
      const sessionId = decodePathPart(parts[1]);
      let checkpointConsumerId = null;
      try {
        checkpointConsumerId = parseSessionRelayConsumerId(url.searchParams.get("checkpointConsumerId"), { allowNull: false });
      } catch (err) {
        return sendError(res, 400, "invalid session event checkpoint query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const session = await getSessionRecord({ tenantId, sessionId });
      if (!session) return sendError(res, 404, "session not found", null, { code: "NOT_FOUND" });
      if (!requireSessionParticipantAccess({ req, res, session, sessionId, principalId })) return;

      const checkpointId = buildSessionRelayCheckpointId({ sessionId, consumerId: checkpointConsumerId });
      const relayState = await getSessionRelayStateRecord({ tenantId, checkpointId });
      if (!relayState) {
        return sendError(
          res,
          409,
          "invalid session event cursor",
          normalizeForCanonicalJson(
            {
              sessionId,
              checkpointConsumerId,
              checkpointId,
              phase: "checkpoint_read",
              reasonCode: "SESSION_EVENT_CHECKPOINT_NOT_FOUND",
              reason: "checkpoint was not found for this session consumer"
            },
            { path: "$.details" }
          ),
          { code: "SESSION_EVENT_CURSOR_INVALID" }
        );
      }
      if (String(relayState.sessionId ?? "") !== sessionId) {
        return sendError(
          res,
          409,
          "invalid session event cursor",
          normalizeForCanonicalJson(
            {
              sessionId,
              checkpointConsumerId,
              checkpointId,
              phase: "checkpoint_read",
              reasonCode: "SESSION_EVENT_CHECKPOINT_SESSION_MISMATCH",
              reason: "checkpoint is not bound to this session"
            },
            { path: "$.details" }
          ),
          { code: "SESSION_EVENT_CURSOR_INVALID" }
        );
      }
      let sinceEventId = null;
      try {
        sinceEventId = parseSessionEventCursor(relayState?.sinceEventId ?? null, { allowNull: true });
      } catch {
        return sendError(
          res,
          409,
          "invalid session event cursor",
          normalizeForCanonicalJson(
            {
              sessionId,
              checkpointConsumerId,
              checkpointId,
              phase: "checkpoint_read",
              reasonCode: "SESSION_EVENT_CHECKPOINT_CURSOR_INVALID",
              reason: "checkpoint cursor encoding is invalid"
            },
            { path: "$.details" }
          ),
          { code: "SESSION_EVENT_CURSOR_INVALID" }
        );
      }
      let events = await getSessionEventRecords({ tenantId, sessionId });
      if (!Array.isArray(events)) events = [];
      if (sinceEventId) {
        const cursorIndex = events.findIndex((row) => String(row?.id ?? "") === sinceEventId);
        if (cursorIndex < 0) {
          return sendError(
            res,
            409,
            "invalid session event cursor",
            buildSessionEventCursorNotFoundDetails({
              sessionId,
              sinceEventId,
              events,
              phase: "checkpoint_read",
              cursorSource: "checkpoint",
              checkpointId,
              checkpointConsumerId
            }),
            { code: "SESSION_EVENT_CURSOR_INVALID" }
          );
        }
      }
      const nextSinceEventId = normalizeSessionInboxEventId(events[events.length - 1]?.id ?? sinceEventId);
      const inbox = buildSessionEventInboxWatermark({
        events,
        sinceEventId,
        nextSinceEventId
      });
      writeSessionEventInboxHeaders(res, inbox);
      return sendJson(res, 200, {
        ok: true,
        checkpoint: relayState,
        inbox
      });
    }

    if (parts[0] === "sessions" && parts[1] && parts[2] === "events" && parts[3] === "checkpoint" && parts.length === 4 && req.method === "POST") {
      if (!requireProtocolHeaderForWrite(req, res)) return;
      const sessionId = decodePathPart(parts[1]);
      const body = await readJsonBody(req);
      let checkpointConsumerId = null;
      let sinceEventId = null;
      try {
        checkpointConsumerId = parseSessionRelayConsumerId(body?.checkpointConsumerId ?? null, { allowNull: false });
        sinceEventId = parseSessionEventCursor(body?.sinceEventId ?? null, { allowNull: true });
      } catch (err) {
        return sendError(res, 400, "invalid session event checkpoint", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const session = await getSessionRecord({ tenantId, sessionId });
      if (!session) return sendError(res, 404, "session not found", null, { code: "NOT_FOUND" });
      if (!requireSessionParticipantAccess({ req, res, session, sessionId, principalId })) return;
      let events = await getSessionEventRecords({ tenantId, sessionId });
      if (!Array.isArray(events)) events = [];
      const checkpointId = buildSessionRelayCheckpointId({ sessionId, consumerId: checkpointConsumerId });
      let requestedCursorIndex = -1;
      if (sinceEventId) {
        requestedCursorIndex = events.findIndex((row) => String(row?.id ?? "") === sinceEventId);
        if (requestedCursorIndex < 0) {
          return sendError(
            res,
            409,
            "invalid session event cursor",
            buildSessionEventCursorNotFoundDetails({
              sessionId,
              sinceEventId,
              events,
              phase: "checkpoint_write",
              cursorSource: "checkpoint_write",
              checkpointId,
              checkpointConsumerId
            }),
            { code: "SESSION_EVENT_CURSOR_INVALID" }
          );
        }
      }
      const existingRelayState = await getSessionRelayStateRecord({ tenantId, checkpointId });
      const existingSinceEventId = normalizeSessionInboxEventId(existingRelayState?.sinceEventId ?? null);
      let existingCursorIndex = -1;
      if (existingSinceEventId) {
        existingCursorIndex = events.findIndex((row) => String(row?.id ?? "") === existingSinceEventId);
        if (existingCursorIndex < 0) {
          return sendError(
            res,
            409,
            "invalid session event cursor",
            buildSessionEventCursorNotFoundDetails({
              sessionId,
              sinceEventId: existingSinceEventId,
              events,
              phase: "checkpoint_write",
              cursorSource: "checkpoint",
              checkpointId,
              checkpointConsumerId
            }),
            { code: "SESSION_EVENT_CURSOR_INVALID" }
          );
        }
      }
      if (existingCursorIndex > requestedCursorIndex) {
        return sendError(
          res,
          409,
          "session event checkpoint regression blocked",
          buildSessionEventCursorRegressionDetails({
            sessionId,
            checkpointId,
            checkpointConsumerId,
            existingSinceEventId,
            requestedSinceEventId: sinceEventId,
            existingCursorIndex,
            requestedCursorIndex,
            events,
            phase: "checkpoint_write"
          }),
          { code: "SESSION_EVENT_CURSOR_CONFLICT" }
        );
      }
      const relayState = buildSessionRelayCheckpointRecord({
        tenantId,
        sessionId,
        consumerId: checkpointConsumerId,
        sinceEventId,
        createdAt: existingRelayState?.createdAt ?? null,
        updatedAt: nowIso()
      });
      await commitTx([{ kind: "SESSION_RELAY_STATE_UPSERT", tenantId, checkpointId, relayState }]);
      const nextSinceEventId = normalizeSessionInboxEventId(events[events.length - 1]?.id ?? sinceEventId);
      const inbox = buildSessionEventInboxWatermark({
        events,
        sinceEventId,
        nextSinceEventId
      });
      writeSessionEventInboxHeaders(res, inbox);
      return sendJson(res, 200, {
        ok: true,
        checkpoint: relayState,
        inbox
      });
    }

    if (
      parts[0] === "sessions" &&
      parts[1] &&
      parts[2] === "events" &&
      parts[3] === "checkpoint" &&
      parts[4] === "requeue" &&
      parts.length === 5 &&
      req.method === "POST"
    ) {
      if (!requireProtocolHeaderForWrite(req, res)) return;
      const sessionId = decodePathPart(parts[1]);
      const body = await readJsonBody(req);
      let checkpointConsumerId = null;
      let sinceEventId = null;
      try {
        checkpointConsumerId = parseSessionRelayConsumerId(body?.checkpointConsumerId ?? null, { allowNull: false });
        sinceEventId = parseSessionEventCursor(body?.sinceEventId ?? null, { allowNull: true });
      } catch (err) {
        return sendError(res, 400, "invalid session event checkpoint requeue", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const session = await getSessionRecord({ tenantId, sessionId });
      if (!session) return sendError(res, 404, "session not found", null, { code: "NOT_FOUND" });
      if (!requireSessionParticipantAccess({ req, res, session, sessionId, principalId })) return;

      const checkpointId = buildSessionRelayCheckpointId({ sessionId, consumerId: checkpointConsumerId });
      const existingRelayState = await getSessionRelayStateRecord({ tenantId, checkpointId });
      if (!existingRelayState) {
        return sendError(
          res,
          409,
          "invalid session event cursor",
          normalizeForCanonicalJson(
            {
              sessionId,
              checkpointConsumerId,
              checkpointId,
              phase: "checkpoint_requeue",
              reasonCode: "SESSION_EVENT_CHECKPOINT_NOT_FOUND",
              reason: "checkpoint was not found for this session consumer"
            },
            { path: "$.details" }
          ),
          { code: "SESSION_EVENT_CURSOR_INVALID" }
        );
      }
      if (String(existingRelayState.sessionId ?? "") !== sessionId) {
        return sendError(
          res,
          409,
          "invalid session event cursor",
          normalizeForCanonicalJson(
            {
              sessionId,
              checkpointConsumerId,
              checkpointId,
              phase: "checkpoint_requeue",
              reasonCode: "SESSION_EVENT_CHECKPOINT_SESSION_MISMATCH",
              reason: "checkpoint is not bound to this session"
            },
            { path: "$.details" }
          ),
          { code: "SESSION_EVENT_CURSOR_INVALID" }
        );
      }

      let events = await getSessionEventRecords({ tenantId, sessionId });
      if (!Array.isArray(events)) events = [];
      const existingSinceEventId = normalizeSessionInboxEventId(existingRelayState?.sinceEventId ?? null);
      let existingCursorIndex = -1;
      if (existingSinceEventId) {
        existingCursorIndex = events.findIndex((row) => String(row?.id ?? "") === existingSinceEventId);
        if (existingCursorIndex < 0) {
          return sendError(
            res,
            409,
            "invalid session event cursor",
            buildSessionEventCursorNotFoundDetails({
              sessionId,
              sinceEventId: existingSinceEventId,
              events,
              phase: "checkpoint_requeue",
              cursorSource: "checkpoint",
              checkpointId,
              checkpointConsumerId
            }),
            { code: "SESSION_EVENT_CURSOR_INVALID" }
          );
        }
      }

      let requestedCursorIndex = -1;
      if (sinceEventId) {
        requestedCursorIndex = events.findIndex((row) => String(row?.id ?? "") === sinceEventId);
        if (requestedCursorIndex < 0) {
          return sendError(
            res,
            409,
            "invalid session event cursor",
            buildSessionEventCursorNotFoundDetails({
              sessionId,
              sinceEventId,
              events,
              phase: "checkpoint_requeue",
              cursorSource: "checkpoint_requeue",
              checkpointId,
              checkpointConsumerId
            }),
            { code: "SESSION_EVENT_CURSOR_INVALID" }
          );
        }
      }

      if (requestedCursorIndex > existingCursorIndex) {
        return sendError(
          res,
          409,
          "session event checkpoint requeue blocked",
          buildSessionEventCursorAdvanceBlockedDetails({
            sessionId,
            checkpointId,
            checkpointConsumerId,
            existingSinceEventId,
            requestedSinceEventId: sinceEventId,
            existingCursorIndex,
            requestedCursorIndex,
            events,
            phase: "checkpoint_requeue"
          }),
          { code: "SESSION_EVENT_CURSOR_CONFLICT" }
        );
      }

      const relayState = buildSessionRelayCheckpointRecord({
        tenantId,
        sessionId,
        consumerId: checkpointConsumerId,
        sinceEventId,
        createdAt: existingRelayState?.createdAt ?? null,
        updatedAt: nowIso()
      });
      await commitTx([{ kind: "SESSION_RELAY_STATE_UPSERT", tenantId, checkpointId, relayState }]);
      const nextSinceEventId = normalizeSessionInboxEventId(events[events.length - 1]?.id ?? sinceEventId);
      const inbox = buildSessionEventInboxWatermark({
        events,
        sinceEventId,
        nextSinceEventId
      });
      writeSessionEventInboxHeaders(res, inbox);
      return sendJson(res, 200, {
        ok: true,
        checkpoint: relayState,
        inbox
      });
    }

    if (parts[0] === "sessions" && parts[1] && parts[2] === "events" && parts[3] === "stream" && parts.length === 4 && req.method === "GET") {
      const sessionId = decodePathPart(parts[1]);
      const eventTypeRaw = url.searchParams.get("eventType");
      const checkpointConsumerRaw = url.searchParams.get("checkpointConsumerId");
      let eventType = null;
      let checkpointConsumerId = null;
      try {
        eventType = typeof eventTypeRaw === "string" && eventTypeRaw.trim() !== "" ? parseSessionEventType(eventTypeRaw) : null;
        checkpointConsumerId = parseSessionRelayConsumerId(checkpointConsumerRaw, { allowNull: true });
      } catch (err) {
        return sendError(res, 400, "invalid session event query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let sinceEventIdFromQuery = null;
      let sinceEventIdFromHeader = null;
      try {
        sinceEventIdFromQuery = parseSessionEventCursor(url.searchParams.get("sinceEventId"), { allowNull: true });
        sinceEventIdFromHeader = parseSessionEventCursor(typeof req.headers["last-event-id"] === "string" ? req.headers["last-event-id"] : null, {
          allowNull: true
        });
      } catch (err) {
        return sendError(res, 400, "invalid session event query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (sinceEventIdFromQuery && sinceEventIdFromHeader && sinceEventIdFromQuery !== sinceEventIdFromHeader) {
        return sendError(
          res,
          409,
          "ambiguous session event cursor",
          { sessionId, sinceEventId: sinceEventIdFromQuery, lastEventId: sinceEventIdFromHeader },
          { code: "SESSION_EVENT_CURSOR_CONFLICT" }
        );
      }
      let checkpointId = null;
      let checkpointSinceEventId = null;
      if (checkpointConsumerId) {
        checkpointId = buildSessionRelayCheckpointId({ sessionId, consumerId: checkpointConsumerId });
        const relayState = await getSessionRelayStateRecord({ tenantId, checkpointId });
        if (!relayState) {
          return sendError(
            res,
            409,
            "invalid session event cursor",
            normalizeForCanonicalJson(
              {
                sessionId,
                checkpointConsumerId,
                checkpointId,
                phase: "stream_init",
                reasonCode: "SESSION_EVENT_CHECKPOINT_NOT_FOUND",
                reason: "checkpoint was not found for this session consumer"
              },
              { path: "$.details" }
            ),
            { code: "SESSION_EVENT_CURSOR_INVALID" }
          );
        }
        if (String(relayState.sessionId ?? "") !== sessionId) {
          return sendError(
            res,
            409,
            "invalid session event cursor",
            normalizeForCanonicalJson(
              {
                sessionId,
                checkpointConsumerId,
                checkpointId,
                phase: "stream_init",
                reasonCode: "SESSION_EVENT_CHECKPOINT_SESSION_MISMATCH",
                reason: "checkpoint is not bound to this session"
              },
              { path: "$.details" }
            ),
            { code: "SESSION_EVENT_CURSOR_INVALID" }
          );
        }
        try {
          checkpointSinceEventId = parseSessionEventCursor(relayState?.sinceEventId ?? null, { allowNull: true });
        } catch {
          return sendError(
            res,
            409,
            "invalid session event cursor",
            normalizeForCanonicalJson(
              {
                sessionId,
                checkpointConsumerId,
                checkpointId,
                phase: "stream_init",
                reasonCode: "SESSION_EVENT_CHECKPOINT_CURSOR_INVALID",
                reason: "checkpoint cursor encoding is invalid"
              },
              { path: "$.details" }
            ),
            { code: "SESSION_EVENT_CURSOR_INVALID" }
          );
        }
      }
      if (checkpointSinceEventId && (sinceEventIdFromQuery || sinceEventIdFromHeader)) {
        const requestedCursor = sinceEventIdFromQuery ?? sinceEventIdFromHeader;
        if (requestedCursor !== checkpointSinceEventId) {
          return sendError(
            res,
            409,
            "ambiguous session event cursor",
            { sessionId, sinceEventId: requestedCursor, checkpointSinceEventId, checkpointConsumerId, checkpointId },
            { code: "SESSION_EVENT_CURSOR_CONFLICT" }
          );
        }
      }
      const sinceEventId = sinceEventIdFromQuery ?? sinceEventIdFromHeader ?? checkpointSinceEventId;
      const cursorSource =
        sinceEventIdFromQuery || sinceEventIdFromHeader
          ? "sinceEventId"
          : checkpointSinceEventId
            ? "checkpoint"
            : "sinceEventId";
      const session = await getSessionRecord({ tenantId, sessionId });
      if (!session) return sendError(res, 404, "session not found", null, { code: "NOT_FOUND" });
      if (!requireSessionParticipantAccess({ req, res, session, sessionId, principalId })) return;
      let currentEvents = await getSessionEventRecords({ tenantId, sessionId });
      if (!Array.isArray(currentEvents)) currentEvents = [];
      const readyNextSinceEventId = normalizeSessionInboxEventId(currentEvents[currentEvents.length - 1]?.id ?? sinceEventId);
      const readyInbox = buildSessionEventInboxWatermark({
        events: currentEvents,
        sinceEventId,
        nextSinceEventId: readyNextSinceEventId
      });
      let cursorIndex = -1;
      if (sinceEventId) {
        cursorIndex = currentEvents.findIndex((row) => String(row?.id ?? "") === sinceEventId);
        if (cursorIndex < 0) {
          return sendError(
            res,
            409,
            "invalid session event cursor",
            buildSessionEventCursorNotFoundDetails({
              sessionId,
              sinceEventId,
              events: currentEvents,
              phase: "stream_init",
              cursorSource,
              checkpointId,
              checkpointConsumerId
            }),
            { code: "SESSION_EVENT_CURSOR_INVALID" }
          );
        }
      }

      writeSessionEventInboxHeaders(res, readyInbox);
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
        eventName: "session.ready",
        data: {
          ok: true,
          sessionId,
          eventType: eventType ?? null,
          sinceEventId,
          eventCount: currentEvents.length,
          inbox: readyInbox
        }
      });

      let closed = false;
      let lastResolvedCursor = cursorIndex;
      let pollTimer = null;
      let heartbeatTimer = null;
      let lastDeliveredEventId = normalizeSessionInboxEventId(sinceEventId);
      let lastWatermarkHeadEventId = normalizeSessionInboxEventId(readyInbox.nextSinceEventId);

      const closeStream = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try {
          res.end();
        } catch {
          // no-op on close race
        }
      };
      req.on("close", closeStream);
      req.on("aborted", closeStream);

      const schedulePoll = (delayMs = 300) => {
        if (closed) return;
        pollTimer = setTimeout(() => {
          void pollAndFlush();
        }, delayMs);
      };

      const maybeEmitWatermark = ({ events, phase = "stream_poll" } = {}) => {
        const safeEvents = Array.isArray(events) ? events : [];
        const headEventId = normalizeSessionInboxEventId(safeEvents[safeEvents.length - 1]?.id ?? null);
        if (headEventId === lastWatermarkHeadEventId) return;
        const inbox = buildSessionEventInboxWatermark({
          events: safeEvents,
          sinceEventId,
          nextSinceEventId: headEventId ?? sinceEventId
        });
        const normalizedLastDeliveredEventId = normalizeSessionInboxEventId(lastDeliveredEventId);
        const watermarkEventId = normalizeSessionInboxEventId(inbox.nextSinceEventId);
        writeSseEvent({
          eventName: "session.watermark",
          eventId: watermarkEventId && watermarkEventId !== normalizedLastDeliveredEventId ? watermarkEventId : null,
          data: buildSessionEventStreamWatermarkPayload({
            sessionId,
            eventType,
            phase,
            inbox,
            lastDeliveredEventId: normalizedLastDeliveredEventId
          })
        });
        lastWatermarkHeadEventId = headEventId;
      };

      const pollAndFlush = async () => {
        if (closed) return;
        let events = [];
        try {
          events = await getSessionEventRecords({ tenantId, sessionId });
        } catch (err) {
          writeSseEvent({
            eventName: "session.error",
            data: {
              ok: false,
              code: "SESSION_EVENT_STREAM_READ_FAILED",
              message: err?.message ?? "failed to read session events"
            }
          });
          return closeStream();
        }
        if (!Array.isArray(events)) events = [];
        if (sinceEventId && lastResolvedCursor < 0) {
          lastResolvedCursor = events.findIndex((row) => String(row?.id ?? "") === sinceEventId);
          if (lastResolvedCursor < 0) {
            const details = buildSessionEventCursorNotFoundDetails({
              sessionId,
              sinceEventId,
              events,
              phase: "stream_poll",
              cursorSource,
              checkpointId,
              checkpointConsumerId
            });
            writeSseEvent({
              eventName: "session.error",
              data: {
                ok: false,
                code: "SESSION_EVENT_CURSOR_INVALID",
                message: "session event cursor not found",
                reasonCode: details.reasonCode,
                details
              }
            });
            return closeStream();
          }
        }
        const startIndex = Math.max(0, lastResolvedCursor + 1);
        if (startIndex < events.length) {
          const nextRows = events.slice(startIndex);
          for (const row of nextRows) {
            if (eventType && String(row?.type ?? "").toUpperCase() !== eventType) continue;
            const rowId = normalizeSessionInboxEventId(row?.id ?? null);
            writeSseEvent({
              eventName: "session.event",
              eventId: rowId,
              data: row
            });
            if (rowId) lastDeliveredEventId = rowId;
          }
          lastResolvedCursor = events.length - 1;
        }
        maybeEmitWatermark({ events, phase: "stream_poll" });
        schedulePoll(300);
      };

      heartbeatTimer = setInterval(() => {
        if (closed) return;
        res.write(": keepalive\n\n");
      }, 10_000);
      void pollAndFlush();
      return;
    }

    if (parts[0] === "sessions" && parts[1] && parts[2] === "events" && parts.length === 3 && req.method === "GET") {
      const sessionId = decodePathPart(parts[1]);
      const eventTypeRaw = url.searchParams.get("eventType");
      const checkpointConsumerRaw = url.searchParams.get("checkpointConsumerId");
      const limitRaw = url.searchParams.get("limit");
      const offsetRaw = url.searchParams.get("offset");
      const limit = limitRaw === null || limitRaw === "" ? 200 : Number(limitRaw);
      const offset = offsetRaw === null || offsetRaw === "" ? 0 : Number(offsetRaw);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) {
        return sendError(res, 400, "invalid session event query", { message: "limit must be an integer in range 1..2000" }, { code: "SCHEMA_INVALID" });
      }
      if (!Number.isSafeInteger(offset) || offset < 0) {
        return sendError(res, 400, "invalid session event query", { message: "offset must be a non-negative integer" }, { code: "SCHEMA_INVALID" });
      }

      let eventType = null;
      let checkpointConsumerId = null;
      let sinceEventIdFromQuery = null;
      let sinceEventIdFromHeader = null;
      let sinceEventId = null;
      try {
        eventType = typeof eventTypeRaw === "string" && eventTypeRaw.trim() !== "" ? parseSessionEventType(eventTypeRaw) : null;
        checkpointConsumerId = parseSessionRelayConsumerId(checkpointConsumerRaw, { allowNull: true });
        sinceEventIdFromQuery = parseSessionEventCursor(url.searchParams.get("sinceEventId"), { allowNull: true });
        sinceEventIdFromHeader = parseSessionEventCursor(typeof req.headers["last-event-id"] === "string" ? req.headers["last-event-id"] : null, {
          allowNull: true
        });
      } catch (err) {
        return sendError(res, 400, "invalid session event query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (sinceEventIdFromQuery && sinceEventIdFromHeader && sinceEventIdFromQuery !== sinceEventIdFromHeader) {
        return sendError(
          res,
          409,
          "ambiguous session event cursor",
          { sessionId, sinceEventId: sinceEventIdFromQuery, lastEventId: sinceEventIdFromHeader },
          { code: "SESSION_EVENT_CURSOR_CONFLICT" }
        );
      }
      let checkpointId = null;
      let checkpointSinceEventId = null;
      if (checkpointConsumerId) {
        checkpointId = buildSessionRelayCheckpointId({ sessionId, consumerId: checkpointConsumerId });
        const relayState = await getSessionRelayStateRecord({ tenantId, checkpointId });
        if (!relayState) {
          return sendError(
            res,
            409,
            "invalid session event cursor",
            normalizeForCanonicalJson(
              {
                sessionId,
                checkpointConsumerId,
                checkpointId,
                phase: "list",
                reasonCode: "SESSION_EVENT_CHECKPOINT_NOT_FOUND",
                reason: "checkpoint was not found for this session consumer"
              },
              { path: "$.details" }
            ),
            { code: "SESSION_EVENT_CURSOR_INVALID" }
          );
        }
        if (String(relayState.sessionId ?? "") !== sessionId) {
          return sendError(
            res,
            409,
            "invalid session event cursor",
            normalizeForCanonicalJson(
              {
                sessionId,
                checkpointConsumerId,
                checkpointId,
                phase: "list",
                reasonCode: "SESSION_EVENT_CHECKPOINT_SESSION_MISMATCH",
                reason: "checkpoint is not bound to this session"
              },
              { path: "$.details" }
            ),
            { code: "SESSION_EVENT_CURSOR_INVALID" }
          );
        }
        try {
          checkpointSinceEventId = parseSessionEventCursor(relayState?.sinceEventId ?? null, { allowNull: true });
        } catch {
          return sendError(
            res,
            409,
            "invalid session event cursor",
            normalizeForCanonicalJson(
              {
                sessionId,
                checkpointConsumerId,
                checkpointId,
                phase: "list",
                reasonCode: "SESSION_EVENT_CHECKPOINT_CURSOR_INVALID",
                reason: "checkpoint cursor encoding is invalid"
              },
              { path: "$.details" }
            ),
            { code: "SESSION_EVENT_CURSOR_INVALID" }
          );
        }
      }
      if (checkpointSinceEventId && (sinceEventIdFromQuery || sinceEventIdFromHeader)) {
        const requestedCursor = sinceEventIdFromQuery ?? sinceEventIdFromHeader;
        if (requestedCursor !== checkpointSinceEventId) {
          return sendError(
            res,
            409,
            "ambiguous session event cursor",
            { sessionId, sinceEventId: requestedCursor, checkpointSinceEventId, checkpointConsumerId, checkpointId },
            { code: "SESSION_EVENT_CURSOR_CONFLICT" }
          );
        }
      }
      sinceEventId = sinceEventIdFromQuery ?? sinceEventIdFromHeader ?? checkpointSinceEventId;
      const cursorSource =
        sinceEventIdFromQuery || sinceEventIdFromHeader
          ? "sinceEventId"
          : checkpointSinceEventId
            ? "checkpoint"
            : "sinceEventId";
      const session = await getSessionRecord({ tenantId, sessionId });
      if (!session) return sendError(res, 404, "session not found", null, { code: "NOT_FOUND" });
      if (!requireSessionParticipantAccess({ req, res, session, sessionId, principalId })) return;
      let events = await getSessionEventRecords({ tenantId, sessionId });
      if (!Array.isArray(events)) events = [];
      const allEvents = events;
      const currentPrevChainHash = getCurrentPrevChainHash(allEvents);
      let cursorIndex = -1;
      if (sinceEventId) {
        cursorIndex = allEvents.findIndex((row) => String(row?.id ?? "") === sinceEventId);
        if (cursorIndex < 0) {
          return sendError(
            res,
            409,
            "invalid session event cursor",
            buildSessionEventCursorNotFoundDetails({
              sessionId,
              sinceEventId,
              events,
              phase: "list",
              cursorSource,
              checkpointId,
              checkpointConsumerId
            }),
            { code: "SESSION_EVENT_CURSOR_INVALID" }
          );
        }
        events = allEvents.slice(cursorIndex + 1);
      }
      const postCursorEvents = events;
      let filteredEvents = postCursorEvents;
      if (eventType) {
        filteredEvents = postCursorEvents.filter((row) => String(row?.type ?? "").toUpperCase() === eventType);
      }
      const paged = filteredEvents.slice(offset, offset + limit);
      const postCursorHeadEventId = normalizeSessionInboxEventId(
        postCursorEvents.length > 0 ? postCursorEvents[postCursorEvents.length - 1]?.id ?? null : null
      );
      const nextSinceEventId =
        paged.length > 0
          ? normalizeSessionInboxEventId(paged[paged.length - 1]?.id ?? null)
          : eventType && filteredEvents.length === 0
            ? postCursorHeadEventId ?? normalizeSessionInboxEventId(sinceEventId)
          : normalizeSessionInboxEventId(sinceEventId);
      const listInbox = buildSessionEventInboxWatermark({
        events: allEvents,
        sinceEventId,
        nextSinceEventId
      });
      writeSessionEventInboxHeaders(res, listInbox);
      return sendJson(res, 200, {
        ok: true,
        sessionId,
        events: paged,
        limit,
        offset,
        currentPrevChainHash,
        inbox: listInbox
      });
    }

    if (parts[0] === "sessions" && parts[1] && parts[2] === "events" && parts.length === 3 && req.method === "POST") {
      if (!requireProtocolHeaderForWrite(req, res)) return;
      const sessionId = decodePathPart(parts[1]);
      const body = await readJsonBody(req);
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
      if (!idemStoreKey) {
        return sendError(res, 400, "x-idempotency-key is required", null, { code: "SESSION_EVENT_IDEMPOTENCY_REQUIRED" });
      }
      const trySessionEventIdempotencyReplay = async () => {
        if (!idemStoreKey) return false;
        let existing = null;
        if (typeof store.getIdempotencyRecord === "function") {
          try {
            existing = await store.getIdempotencyRecord({ key: idemStoreKey });
          } catch {
            existing = null;
          }
        }
        if (!existing && store.idempotency instanceof Map) {
          existing = store.idempotency.get(idemStoreKey) ?? null;
        }
        if (!existing) return false;
        if (existing.requestHash !== idemRequestHash) {
          sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
          return true;
        }
        sendJson(res, existing.statusCode, existing.body);
        return true;
      };
      if (await trySessionEventIdempotencyReplay()) return;

      const session = await getSessionRecord({ tenantId, sessionId });
      if (!session) return sendError(res, 404, "session not found", null, { code: "NOT_FOUND" });
      if (!requireSessionParticipantAccess({ req, res, session, sessionId, principalId })) return;
      const existingEvents = await getSessionEventRecords({ tenantId, sessionId });
      const currentPrevChainHash = getCurrentPrevChainHash(Array.isArray(existingEvents) ? existingEvents : []);
      if (expectedHeader.expectedPrevChainHash !== currentPrevChainHash) {
        if (await trySessionEventIdempotencyReplay()) return;
        return sendError(
          res,
          409,
          "event append conflict",
          buildSessionEventAppendConflictDetails({
            sessionId,
            expectedPrevChainHash: currentPrevChainHash,
            gotExpectedPrevChainHash: expectedHeader.expectedPrevChainHash,
            events: existingEvents,
            phase: "stale_precondition"
          }),
          { code: "SESSION_EVENT_APPEND_CONFLICT" }
        );
      }

      let eventType = null;
      try {
        eventType = parseSessionEventType(body?.eventType ?? body?.type ?? null);
      } catch (err) {
        return sendError(res, 400, "invalid session event", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      let payload = null;
      let eventProvenance = null;
      try {
        eventProvenance = computeSessionEventProvenance({
          events: Array.isArray(existingEvents) ? existingEvents : [],
          eventType,
          provenance:
            body?.provenance && typeof body.provenance === "object" && !Array.isArray(body.provenance)
              ? body.provenance
              : body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
                ? body.payload.provenance ?? null
                : null
        });
        payload = buildSessionEventPayloadV1({
          sessionId,
          eventType,
          payload: body?.payload ?? null,
          provenance: eventProvenance,
          traceId: body?.traceId ?? null,
          at: typeof body?.at === "string" && body.at.trim() !== "" ? body.at.trim() : nowIso()
        });
        validateSessionEventPayloadV1(payload);
      } catch (err) {
        return sendError(res, 400, "invalid session event payload", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const signerLifecycle = await evaluateSessionSignerKeyLifecycle({
        tenantId,
        signerKeyId: serverSigner?.keyId ?? null,
        at: payload.at,
        requireRegistered: false
      });
      if (!signerLifecycle.ok) {
        return sendError(
          res,
          409,
          "session event append blocked",
          {
            reasonCode: signerLifecycle.reasonCode ?? "SIGNER_KEY_INVALID",
            reason: signerLifecycle.message ?? "session signer key lifecycle validation failed",
            signerKeyId: serverSigner?.keyId ?? null,
            signerStatus: signerLifecycle.signerStatus ?? null,
            validFrom: signerLifecycle.validFrom ?? null,
            validTo: signerLifecycle.validTo ?? null,
            revokedAt: signerLifecycle.revokedAt ?? null
          },
          { code: "SESSION_EVENT_SIGNER_KEY_INVALID" }
        );
      }

      const draft = createChainedEvent({
        streamId: sessionId,
        type: payload.eventType,
        actor:
          body?.actor && typeof body.actor === "object" && !Array.isArray(body.actor)
            ? body.actor
            : { type: "agent", id: principalId },
        payload,
        at: payload.at
      });
      const nextEvents = appendChainedEvent({ events: Array.isArray(existingEvents) ? existingEvents : [], event: draft, signer: serverSigner });
      const event = nextEvents[nextEvents.length - 1];

      let nextSession = null;
      try {
        const revision = Number(session?.revision ?? 0);
        nextSession = normalizeForCanonicalJson(
          {
            ...session,
            updatedAt: payload.at,
            revision: Number.isSafeInteger(revision) && revision >= 0 ? revision + 1 : 1
          },
          { path: "$" }
        );
        validateSessionV1(nextSession);
      } catch (err) {
        return sendError(res, 409, "session event append blocked", { message: err?.message }, { code: "SESSION_EVENT_APPEND_BLOCKED" });
      }

      const responseBody = { ok: true, session: nextSession, event };
      const ops = [
        { kind: "SESSION_EVENTS_APPENDED", tenantId, sessionId, events: [event] },
        { kind: "SESSION_UPSERT", tenantId, sessionId, session: nextSession }
      ];
      if (idemStoreKey) {
        ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
      }
      try {
        await commitTx(ops);
      } catch (err) {
        if (err?.code === "PREV_CHAIN_HASH_MISMATCH") {
          if (await trySessionEventIdempotencyReplay()) return;
          let latestEvents = Array.isArray(existingEvents) ? existingEvents : [];
          try {
            const reloaded = await getSessionEventRecords({ tenantId, sessionId });
            if (Array.isArray(reloaded)) latestEvents = reloaded;
          } catch {
            // best-effort only; conflict details still fail closed.
          }
          return sendError(
            res,
            409,
            "event append conflict",
            buildSessionEventAppendConflictDetails({
              sessionId,
              expectedPrevChainHash: err.expectedPrevChainHash ?? null,
              gotPrevChainHash: err.gotPrevChainHash ?? null,
              events: latestEvents,
              phase: "commit_race"
            }),
            { code: "SESSION_EVENT_APPEND_CONFLICT" }
          );
        }
        throw err;
      }
      return sendJson(res, 201, responseBody);
    }
    }

    // Check if the response was sent by a route that uses bare "return;" (e.g. SSE streams).
    if (res.writableEnded || res.headersSent) return true;

    return false;
  };
}
