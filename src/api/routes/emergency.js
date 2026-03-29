/**
 * Emergency and network ops routes: /ops/emergency/*, /ops/network/*
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
export function createEmergencyRoutes(deps) {
  const {
    store,
    sendJson,
    sendError,
    readJsonBody,
    createId,
    nowIso,
    commitTx,
    normalizeForCanonicalJson,
    listEmergencyControlState,
    getEmergencyControlRecord,
    upsertEmergencyControlRecord,
    revokeEmergencyControl,
    resolveRescueQueueItem,
    listRescueQueueItems,
    getNetworkCommandCenterWorkspace,
    resolveNetworkPhase1Metrics,
    listManagedSpecialists,
    invokeInternalApiRequest,
    buildForwardedInternalRequestHeaders,
    sha256Hex,
    requireScope,
    OPS_SCOPES,
    requireProtocolHeaderForWrite,
    decodePathPart,
    normalizeNonEmptyStringOrNull,
    logger
  } = deps;

  // These routes live under /ops/* and expect parts to already be split.
  // The caller in app.js passes the pre-split parts array.

  // Wrap response helpers to return true (signals "handled" to dispatcher).
  const _sendJson = (...args) => { deps.sendJson(...args); return true; };
  const _sendError = (...args) => { deps.sendError(...args); return true; };

  /**
   * @param {object} ctx - Per-request context
   * @returns {Promise<boolean>} true if handled
   */
  return async function handleEmergencyRoutes(ctx) {
    const { req, res, method, path, url, tenantId, principalId, auth, parts, readIdempotency, makeOpsAudit } = ctx;
    // Use wrapped versions that return true for "return sendJson/sendError(...)" pattern.
    const sendJson = _sendJson;
    const sendError = _sendError;

    if (parts[1] !== "emergency" && parts[1] !== "network") return false;

    if (parts[1] === "emergency") {
      const hasReadScope = requireScope(auth.scopes, OPS_SCOPES.OPS_READ) || requireScope(auth.scopes, OPS_SCOPES.OPS_WRITE);
      const hasWriteScope = requireScope(auth.scopes, OPS_SCOPES.OPS_WRITE);

      if (req.method === "GET" && parts[2] === "state" && parts.length === 3) {
        if (!hasReadScope) return sendError(res, 403, "forbidden");
        if (typeof store.listEmergencyControlState !== "function") {
          return sendError(res, 501, "emergency controls not supported for this store");
        }
        const activeRaw = url.searchParams.get("active");
        let active = true;
        if (activeRaw !== null && activeRaw !== "") {
          const normalized = String(activeRaw).trim().toLowerCase();
          if (normalized === "all") active = null;
          else if (normalized === "true" || normalized === "1") active = true;
          else if (normalized === "false" || normalized === "0") active = false;
          else return sendError(res, 400, "active must be true|false|all", null, { code: "SCHEMA_INVALID" });
        }
        let scopeType = null;
        let scopeId = null;
        let controlType = null;
        try {
          scopeType =
            typeof url.searchParams.get("scopeType") === "string" && url.searchParams.get("scopeType").trim() !== ""
              ? normalizeEmergencyScopeTypeInput(url.searchParams.get("scopeType"))
              : null;
          scopeId =
            typeof url.searchParams.get("scopeId") === "string" && url.searchParams.get("scopeId").trim() !== ""
              ? url.searchParams.get("scopeId").trim()
              : null;
          controlType =
            typeof url.searchParams.get("controlType") === "string" && url.searchParams.get("controlType").trim() !== ""
              ? normalizeEmergencyControlTypeInput(url.searchParams.get("controlType"), { allowNull: false })
              : null;
          if (scopeType === EMERGENCY_SCOPE_TYPE.TENANT) scopeId = null;
          if (scopeType !== null && scopeType !== EMERGENCY_SCOPE_TYPE.TENANT && scopeId === null) {
            return sendError(res, 400, "scopeId is required for non-tenant scope", null, { code: "SCHEMA_INVALID" });
          }
        } catch (err) {
          return sendError(res, 400, "invalid emergency state query", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }
        const limitRaw = url.searchParams.get("limit");
        const offsetRaw = url.searchParams.get("offset");
        const limit = limitRaw === null || limitRaw === "" ? 200 : Number(limitRaw);
        const offset = offsetRaw === null || offsetRaw === "" ? 0 : Number(offsetRaw);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) {
          return sendError(res, 400, "limit must be an integer within 1..2000", null, { code: "SCHEMA_INVALID" });
        }
        if (!Number.isSafeInteger(offset) || offset < 0) {
          return sendError(res, 400, "offset must be a non-negative integer", null, { code: "SCHEMA_INVALID" });
        }
        const controls = await store.listEmergencyControlState({ tenantId, active, scopeType, scopeId, controlType, limit, offset });
        return sendJson(res, 200, { tenantId, active, scopeType, scopeId, controlType, limit, offset, controls });
      }

      if (req.method === "GET" && parts[2] === "events" && parts.length === 3) {
        if (!hasReadScope) return sendError(res, 403, "forbidden");
        if (typeof store.listEmergencyControlEvents !== "function") {
          return sendError(res, 501, "emergency controls not supported for this store");
        }
        let action = null;
        let scopeType = null;
        let scopeId = null;
        let controlType = null;
        try {
          action =
            typeof url.searchParams.get("action") === "string" && url.searchParams.get("action").trim() !== ""
              ? normalizeEmergencyActionInput(url.searchParams.get("action"))
              : null;
          scopeType =
            typeof url.searchParams.get("scopeType") === "string" && url.searchParams.get("scopeType").trim() !== ""
              ? normalizeEmergencyScopeTypeInput(url.searchParams.get("scopeType"))
              : null;
          scopeId =
            typeof url.searchParams.get("scopeId") === "string" && url.searchParams.get("scopeId").trim() !== ""
              ? url.searchParams.get("scopeId").trim()
              : null;
          controlType =
            typeof url.searchParams.get("controlType") === "string" && url.searchParams.get("controlType").trim() !== ""
              ? normalizeEmergencyControlTypeInput(url.searchParams.get("controlType"), { allowNull: false })
              : null;
          if (scopeType === EMERGENCY_SCOPE_TYPE.TENANT) scopeId = null;
          if (scopeType !== null && scopeType !== EMERGENCY_SCOPE_TYPE.TENANT && scopeId === null) {
            return sendError(res, 400, "scopeId is required for non-tenant scope", null, { code: "SCHEMA_INVALID" });
          }
        } catch (err) {
          return sendError(res, 400, "invalid emergency events query", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }
        const limitRaw = url.searchParams.get("limit");
        const offsetRaw = url.searchParams.get("offset");
        const limit = limitRaw === null || limitRaw === "" ? 200 : Number(limitRaw);
        const offset = offsetRaw === null || offsetRaw === "" ? 0 : Number(offsetRaw);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) {
          return sendError(res, 400, "limit must be an integer within 1..2000", null, { code: "SCHEMA_INVALID" });
        }
        if (!Number.isSafeInteger(offset) || offset < 0) {
          return sendError(res, 400, "offset must be a non-negative integer", null, { code: "SCHEMA_INVALID" });
        }
        const events = await store.listEmergencyControlEvents({ tenantId, action, scopeType, scopeId, controlType, limit, offset });
        return sendJson(res, 200, { tenantId, action, scopeType, scopeId, controlType, limit, offset, events });
      }

      if (req.method === "POST" && parts.length === 3) {
        if (!hasWriteScope) return sendError(res, 403, "forbidden");
        if (!requireProtocolHeaderForWrite(req, res)) return;
        if (typeof store.listEmergencyControlState !== "function") {
          return sendError(res, 501, "emergency controls not supported for this store");
        }

        let action = null;
        try {
          action = normalizeEmergencyActionInput(parts[2]);
        } catch {
          return sendError(res, 404, "not found");
        }

        const body = (await readJsonBody(req)) ?? {};
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

        let scopeType = EMERGENCY_SCOPE_TYPE.TENANT;
        let scopeId = null;
        try {
          const scopeInput = body?.scope && typeof body.scope === "object" && !Array.isArray(body.scope) ? body.scope : {};
          const requestedScopeType = scopeInput.type ?? body?.scopeType ?? null;
          scopeType = requestedScopeType === null || requestedScopeType === undefined ? EMERGENCY_SCOPE_TYPE.TENANT : normalizeEmergencyScopeTypeInput(requestedScopeType);
          const requestedScopeId =
            scopeInput.id ??
            body?.scopeId ??
            body?.agentId ??
            body?.adapterId ??
            body?.providerId ??
            null;
          scopeId = normalizeEmergencyScopeIdInput(scopeType, requestedScopeId);
        } catch (err) {
          return sendError(res, 400, "invalid emergency scope", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }

        const controlType = action === EMERGENCY_ACTION.RESUME ? null : normalizeEmergencyControlTypeInput(action, { allowNull: false });
        let resumeControlTypes = [];
        if (action === EMERGENCY_ACTION.RESUME) {
          try {
            resumeControlTypes = normalizeEmergencyResumeControlTypesInput(
              body?.controlTypes ??
                body?.resumeControlTypes ??
                body?.controlType ??
                body?.resumeControlType ??
                null
            );
          } catch (err) {
            return sendError(res, 400, "invalid resume controlTypes", { message: err?.message }, { code: "SCHEMA_INVALID" });
          }
        }

        const reasonCode =
          body?.reasonCode === null || body?.reasonCode === undefined || String(body.reasonCode).trim() === ""
            ? null
            : String(body.reasonCode).trim().slice(0, 120);
        const reason =
          body?.reason === null || body?.reason === undefined || String(body.reason).trim() === ""
            ? null
            : String(body.reason).trim().slice(0, 500);
        const requestedEmergencyControlTypes =
          action === EMERGENCY_ACTION.RESUME ? resumeControlTypes : controlType ? [controlType] : [];
        const allowedOperatorRoles = emergencyAllowedOperatorRolesForAction({
          action,
          resumeControlTypes: requestedEmergencyControlTypes
        });
        const dualControlRequired = emergencyDualControlRequiredForAction({
          action,
          resumeControlTypes: requestedEmergencyControlTypes
        });
        const operatorActionValidation = await verifyEmergencyOperatorActionInput({
          tenantId,
          emergencyAction: action,
          operatorActionInput: body?.operatorAction ?? null,
          allowedRoles: allowedOperatorRoles,
          actionLabel: "operatorAction"
        });
        if (!operatorActionValidation.ok) {
          return sendError(
            res,
            operatorActionValidation.statusCode,
            operatorActionValidation.message,
            null,
            { code: operatorActionValidation.code }
          );
        }
        const operatorAction = operatorActionValidation.operatorAction;
        let secondOperatorAction = null;
        if (dualControlRequired) {
          const secondOperatorActionInput =
            body?.secondOperatorAction && typeof body.secondOperatorAction === "object" && !Array.isArray(body.secondOperatorAction)
              ? body.secondOperatorAction
              : null;
          if (!secondOperatorActionInput) {
            logger.warn("ops.emergency.dual_control_required", {
              tenantId,
              action,
              scopeType,
              scopeId,
              requiredRoles: Array.from(allowedOperatorRoles.values()),
              primaryOperatorId: operatorActionValidation.actorOperatorId ?? null,
              primarySignerKeyId: operatorActionValidation.signerKeyId ?? null
            });
            return sendError(
              res,
              409,
              "secondOperatorAction is required for revoke/kill-switch class controls",
              null,
              { code: "DUAL_CONTROL_REQUIRED" }
            );
          }
          const secondOperatorActionValidation = await verifyEmergencyOperatorActionInput({
            tenantId,
            emergencyAction: action,
            operatorActionInput: secondOperatorActionInput,
            allowedRoles: allowedOperatorRoles,
            actionLabel: "secondOperatorAction"
          });
          if (!secondOperatorActionValidation.ok) {
            return sendError(
              res,
              secondOperatorActionValidation.statusCode,
              secondOperatorActionValidation.message,
              null,
              { code: secondOperatorActionValidation.code }
            );
          }
          if (secondOperatorActionValidation.actorOperatorId === operatorActionValidation.actorOperatorId) {
            logger.warn("ops.emergency.dual_control_same_operator_blocked", {
              tenantId,
              action,
              scopeType,
              scopeId,
              operatorId: operatorActionValidation.actorOperatorId ?? null
            });
            return sendError(
              res,
              409,
              "secondOperatorAction.actor.operatorId must differ from operatorAction.actor.operatorId",
              null,
              { code: "DUAL_CONTROL_DISTINCT_OPERATOR_REQUIRED" }
            );
          }
          if (secondOperatorActionValidation.signerKeyId === operatorActionValidation.signerKeyId) {
            logger.warn("ops.emergency.dual_control_same_signer_blocked", {
              tenantId,
              action,
              scopeType,
              scopeId,
              signerKeyId: operatorActionValidation.signerKeyId ?? null
            });
            return sendError(
              res,
              409,
              "secondOperatorAction.signature.keyId must differ from operatorAction.signature.keyId",
              null,
              { code: "DUAL_CONTROL_DISTINCT_SIGNER_KEY_REQUIRED" }
            );
          }
          secondOperatorAction = secondOperatorActionValidation.operatorAction;
        }
        const effectiveAt =
          typeof body?.effectiveAt === "string" && body.effectiveAt.trim() !== ""
            ? body.effectiveAt.trim()
            : nowIso();
        if (!Number.isFinite(Date.parse(effectiveAt))) {
          return sendError(res, 400, "effectiveAt must be an ISO timestamp", null, { code: "SCHEMA_INVALID" });
        }

        const matchingControls = await store.listEmergencyControlState({
          tenantId,
          active: true,
          scopeType,
          scopeId,
          controlType: action === EMERGENCY_ACTION.RESUME ? null : controlType,
          limit: 1000,
          offset: 0
        });

        if (action !== EMERGENCY_ACTION.RESUME && Array.isArray(matchingControls) && matchingControls.length > 0) {
          const existingControl = matchingControls.find((row) => String(row.controlType ?? "") === String(controlType)) ?? matchingControls[0];
          const responseBody = {
            tenantId,
            applied: false,
            action,
            reason: "already_active",
            control: existingControl
          };
          if (idemStoreKey) {
            await commitTx([{ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody } }]);
          }
          return sendJson(res, 200, responseBody);
        }

        let activeResumeControls = [];
        if (action === EMERGENCY_ACTION.RESUME) {
          activeResumeControls = (Array.isArray(matchingControls) ? matchingControls : []).filter(
            (row) => row && row.active === true && resumeControlTypes.includes(String(row.controlType ?? ""))
          );
          if (activeResumeControls.length === 0) {
            const responseBody = {
              tenantId,
              applied: false,
              action,
              reason: "no_active_controls",
              resumeControlTypes
            };
            if (idemStoreKey) {
              await commitTx([{ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody } }]);
            }
            return sendJson(res, 200, responseBody);
          }
        }

        const event = normalizeForCanonicalJson(
          {
            schemaVersion: "OpsEmergencyControlEvent.v1",
            eventId: createId("emg"),
            tenantId,
            action,
            controlType,
            resumeControlTypes: action === EMERGENCY_ACTION.RESUME ? resumeControlTypes : [],
            scope: { type: scopeType, id: scopeId },
            reasonCode,
            reason,
            operatorAction,
            secondOperatorAction,
            requestedBy: {
              keyId: auth.ok ? (auth.keyId ?? null) : null,
              principalId: principalId ?? null
            },
            requestId,
            createdAt: nowIso(),
            effectiveAt
          },
          { path: "$" }
        );

        const responseBody = {
          tenantId,
          applied: true,
          action,
          event,
          scope: { type: scopeType, id: scopeId },
          controlType,
          resumeControlTypes: action === EMERGENCY_ACTION.RESUME ? resumeControlTypes : [],
          dualControl: {
            required: dualControlRequired,
            satisfied: dualControlRequired ? true : null
          }
        };
        const statusCode = action === EMERGENCY_ACTION.RESUME ? 200 : 201;
        const ops = [{ kind: "EMERGENCY_CONTROL_EVENT_APPEND", tenantId, event }];
        if (idemStoreKey) ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode, body: responseBody } });
        await commitTx(ops, {
          audit: makeOpsAudit({
            action: `EMERGENCY_CONTROL_${String(action).replaceAll("-", "_").toUpperCase()}`,
            targetType: "emergency_control",
            targetId:
              action === EMERGENCY_ACTION.RESUME
                ? `${scopeType}:${scopeId ?? "*"}:${resumeControlTypes.join(",")}`
                : `${scopeType}:${scopeId ?? "*"}:${controlType}`,
            details: {
              action,
              controlType,
              resumeControlTypes: action === EMERGENCY_ACTION.RESUME ? resumeControlTypes : [],
              scopeType,
              scopeId,
              reasonCode,
              reason,
              operatorAction,
              secondOperatorAction,
              dualControl: {
                required: dualControlRequired,
                requiredRoles: Array.from(allowedOperatorRoles.values())
              }
            }
          })
        });
        return sendJson(res, statusCode, responseBody);
      }
    }

    if (parts[1] === "network" && parts[2] === "rescue-queue" && parts.length === 3 && req.method === "GET") {
      if (!requireScope(auth.scopes, OPS_SCOPES.OPS_READ)) return sendError(res, 403, "forbidden");
      let sourceType = "all";
      let priority = "all";
      let staleRunMinutes = 60;
      let limit = 50;
      let offset = 0;
      try {
        sourceType = parseOpsRescueSourceType(url.searchParams.get("sourceType"), { allowAll: true, defaultValue: "all" });
        priority = parseOpsRescuePriority(url.searchParams.get("priority"), { allowAll: true, defaultValue: "all" });
        staleRunMinutes =
          url.searchParams.get("staleRunMinutes") === null || url.searchParams.get("staleRunMinutes") === ""
            ? 60
            : Number(url.searchParams.get("staleRunMinutes"));
        if (!Number.isSafeInteger(staleRunMinutes) || staleRunMinutes < 1 || staleRunMinutes > 10_080) {
          return sendError(res, 400, "staleRunMinutes must be an integer within 1..10080");
        }
        ({ limit, offset } = parsePagination({
          limitRaw: url.searchParams.get("limit"),
          offsetRaw: url.searchParams.get("offset"),
          defaultLimit: 50,
          maxLimit: 500
        }));
      } catch (err) {
        return sendError(res, 400, "invalid ops rescue queue query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      let rescueQueue;
      try {
        rescueQueue = await buildOpsRescueQueue({
          tenantId,
          sourceType,
          priority,
          limit,
          offset,
          staleRunMinutes
        });
      } catch (err) {
        if (typeof err?.message === "string" && err.message.includes("not supported")) {
          return sendError(
            res,
            501,
            "ops rescue queue dependencies unavailable",
            { message: err.message },
            { code: "OPS_RESCUE_QUEUE_DEPENDENCY_UNAVAILABLE" }
          );
        }
        return sendError(
          res,
          500,
          "failed to compute ops rescue queue",
          { message: err?.message ?? String(err) },
          { code: "OPS_RESCUE_QUEUE_FAILED" }
        );
      }

      return sendJson(res, 200, {
        ok: true,
        tenantId,
        rescueQueue
      });
    }

    if (parts[1] === "network" && parts[2] === "phase1-metrics" && parts.length === 3 && req.method === "GET") {
      if (!requireScope(auth.scopes, OPS_SCOPES.OPS_READ)) return sendError(res, 403, "forbidden");
      let staleRunMinutes = 60;
      try {
        staleRunMinutes =
          url.searchParams.get("staleRunMinutes") === null || url.searchParams.get("staleRunMinutes") === ""
            ? 60
            : Number(url.searchParams.get("staleRunMinutes"));
        if (!Number.isSafeInteger(staleRunMinutes) || staleRunMinutes < 1 || staleRunMinutes > 10_080) {
          return sendError(res, 400, "staleRunMinutes must be an integer within 1..10080");
        }
      } catch (err) {
        return sendError(res, 400, "invalid phase1 metrics query", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      let metricsPacket = null;
      try {
        metricsPacket = await buildOpsPhase1Metrics({ tenantId, staleRunMinutes });
      } catch (err) {
        return sendError(
          res,
          500,
          "failed to compute phase1 metrics",
          { message: err?.message ?? String(err) },
          { code: "OPS_PHASE1_METRICS_FAILED" }
        );
      }
      return sendJson(res, 200, {
        ok: true,
        tenantId,
        metrics: metricsPacket
      });
    }

    if (parts[1] === "network" && parts[2] === "managed-specialists" && parts.length === 3 && req.method === "GET") {
      if (!requireScope(auth.scopes, OPS_SCOPES.OPS_READ)) return sendError(res, 403, "forbidden");
      let managedSpecialists = null;
      try {
        managedSpecialists = await buildOpsManagedSpecialistsStatus({ tenantId });
      } catch (err) {
        return sendError(
          res,
          500,
          "failed to compute managed specialist status",
          { message: err?.message ?? String(err) },
          { code: "OPS_MANAGED_SPECIALISTS_FAILED" }
        );
      }
      return sendJson(res, 200, {
        ok: true,
        tenantId,
        managedSpecialists
      });
    }

    if (parts[1] === "network" && parts[2] === "rescue-queue" && parts[3] && parts[4] === "triage" && parts.length === 5 && req.method === "POST") {
      if (!requireScope(auth.scopes, OPS_SCOPES.OPS_WRITE)) return sendError(res, 403, "forbidden");
      const rescueId = decodeURIComponent(String(parts[3] ?? "")).trim();
      const rescueItem = await getOpsRescueQueueItemRecord({ tenantId, rescueId });
      if (!rescueItem) return sendError(res, 404, "rescue item not found", { rescueId }, { code: "NOT_FOUND" });

      const body = await readJsonBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return sendError(res, 400, "invalid rescue triage request", null, { code: "SCHEMA_INVALID" });
      }

      let existingRecord = null;
      try {
        existingRecord = await getOpsRescueTriageRecord({ tenantId, rescueId });
      } catch (err) {
        return sendError(res, 501, "ops rescue triage not supported for this store", { message: err?.message });
      }

      let status = null;
      try {
        status = normalizeOpsRescueTriageStatus(body?.status ?? existingRecord?.status ?? OPS_RESCUE_TRIAGE_STATUS.OPEN, {
          fieldName: "status",
          allowNull: false
        });
      } catch (err) {
        return sendError(res, 400, "invalid rescue triage status", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      const ownerPrincipalId = normalizeNonEmptyStringOrNull(body?.ownerPrincipalId ?? existingRecord?.ownerPrincipalId ?? null);
      const notes = normalizeNonEmptyStringOrNull(body?.notes ?? existingRecord?.notes ?? null);
      const note = normalizeNonEmptyStringOrNull(body?.note ?? null) ?? notes;
      const hasChanges =
        !existingRecord ||
        String(existingRecord.status ?? "") !== String(status) ||
        String(existingRecord.ownerPrincipalId ?? "") !== String(ownerPrincipalId ?? "") ||
        String(existingRecord.notes ?? "") !== String(notes ?? "");
      if (!hasChanges) {
        return sendJson(res, 200, {
          ok: true,
          tenantId,
          changed: false,
          rescueItem: mergeOpsRescueQueueItemWithTriage(rescueItem, existingRecord),
          triage: existingRecord
        });
      }
      const nowAt = nowIso();
      const nextTriage = buildNextOpsRescueTriageRecord({
        tenantId,
        rescueItem,
        existingRecord,
        status,
        ownerPrincipalId,
        notes,
        actorPrincipalId: principalId,
        note,
        action: "triage_updated",
        metadata: {
          previousStatus: existingRecord?.status ?? null,
          rescueState: rescueItem.rescueState ?? null
        },
        nowAt
      });
      let saved = null;
      try {
        saved = await putOpsRescueTriageRecord({
          tenantId,
          triage: nextTriage,
          audit: makeOpsAudit({
            action: "OPS_RESCUE_TRIAGE_UPSERT",
            targetType: "ops_rescue_triage",
            targetId: rescueId,
            details: {
              sourceType: rescueItem.sourceType ?? null,
              rescueState: rescueItem.rescueState ?? null,
              status,
              ownerPrincipalId
            }
          })
        });
      } catch (err) {
        return sendError(res, 501, "ops rescue triage not supported for this store", { message: err?.message });
      }
      return sendJson(res, 200, {
        ok: true,
        tenantId,
        changed: true,
        rescueItem: mergeOpsRescueQueueItemWithTriage(rescueItem, saved),
        triage: saved
      });
    }

    if (parts[1] === "network" && parts[2] === "rescue-queue" && parts[3] && parts[4] === "actions" && parts.length === 5 && req.method === "POST") {
      if (!requireScope(auth.scopes, OPS_SCOPES.OPS_WRITE)) return sendError(res, 403, "forbidden");
      const rescueId = decodeURIComponent(String(parts[3] ?? "")).trim();
      const rescueItem = await getOpsRescueQueueItemRecord({ tenantId, rescueId });
      if (!rescueItem) return sendError(res, 404, "rescue item not found", { rescueId }, { code: "NOT_FOUND" });

      const body = await readJsonBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return sendError(res, 400, "invalid rescue action request", null, { code: "SCHEMA_INVALID" });
      }
      const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
      if (!action) {
        return sendError(res, 400, "action is required", null, { code: "SCHEMA_INVALID" });
      }

      let existingRecord = null;
      try {
        existingRecord = await getOpsRescueTriageRecord({ tenantId, rescueId });
      } catch (err) {
        return sendError(res, 501, "ops rescue triage not supported for this store", { message: err?.message });
      }

      let actionResult = null;
      let triageStatus = existingRecord?.status ?? OPS_RESCUE_TRIAGE_STATUS.IN_PROGRESS;
      const note = normalizeNonEmptyStringOrNull(body?.note ?? null);

      if (action === "resume") {
        if (rescueItem.sourceType !== OPS_RESCUE_SOURCE_TYPE.APPROVAL_CONTINUATION) {
          return sendError(res, 409, "resume is only supported for approval continuations", { rescueId }, { code: "OPS_RESCUE_ACTION_UNSUPPORTED" });
        }
        const requestId = normalizeNonEmptyStringOrNull(rescueItem?.refs?.requestId);
        const continuation = requestId ? await getApprovalContinuationRecord({ tenantId, requestId }) : null;
        if (!continuation) {
          return sendError(res, 409, "approval continuation is missing", { rescueId, requestId }, { code: "OPS_RESCUE_CONTINUATION_MISSING" });
        }
        if (String(continuation.status ?? "").trim().toLowerCase() !== APPROVAL_CONTINUATION_STATUS.APPROVED) {
          return sendError(
            res,
            409,
            "approval continuation is not ready to resume",
            { rescueId, requestId, status: continuation.status ?? null },
            { code: "OPS_RESCUE_CONTINUATION_NOT_APPROVED" }
          );
        }
        if (String(continuation?.route?.method ?? "").trim().toUpperCase() !== "POST" || String(continuation?.route?.path ?? "").trim() !== "/router/launch") {
          return sendError(
            res,
            409,
            "resume is only supported for router launch continuations",
            { rescueId, requestId, route: continuation.route ?? null },
            { code: "OPS_RESCUE_CONTINUATION_ROUTE_UNSUPPORTED" }
          );
        }
        const decisions = await listApprovalDecisionRecords({ tenantId, requestId, limit: 200, offset: 0 });
        const approvalDecision = selectLatestApprovalDecision(decisions);
        if (!approvalDecision || approvalDecision.approved !== true) {
          return sendError(
            res,
            409,
            "approval decision is missing or denied",
            { rescueId, requestId },
            { code: "OPS_RESCUE_APPROVAL_DECISION_REQUIRED" }
          );
        }
        let launchBody = null;
        try {
          launchBody = buildRouterLaunchResumeRequestBodyFromContinuation({ continuation, approvalDecision });
        } catch (err) {
          return sendError(res, 409, "approval continuation resume context is invalid", { message: err?.message }, { code: "OPS_RESCUE_CONTINUATION_INVALID" });
        }
        const resumeKey = `ops_rescue_resume_${sha256Hex(`${rescueId}:${continuation.continuationHash ?? ""}:${approvalDecision.decisionHash ?? ""}`)}`;
        const launchOut = await invokeInternalApiRequest({
          method: "POST",
          path: "/router/launch",
          body: launchBody,
          headers: buildForwardedInternalRequestHeaders(req, { idempotencyKey: resumeKey })
        });
        if (launchOut.statusCode < 200 || launchOut.statusCode >= 300) {
          return sendError(
            res,
            launchOut.statusCode,
            "failed to resume approval continuation",
            launchOut.json ?? { body: launchOut.body },
            { code: "OPS_RESCUE_RESUME_FAILED" }
          );
        }
        const nextLaunchId = normalizeNonEmptyStringOrNull(launchOut?.json?.launch?.launchId);
        let dispatchOut = null;
        if (continuation?.resume?.dispatchNow === true && nextLaunchId) {
          const dispatchKey = `ops_rescue_dispatch_${sha256Hex(`${rescueId}:${nextLaunchId}:${continuation.updatedAt ?? ""}`)}`;
          dispatchOut = await invokeInternalApiRequest({
            method: "POST",
            path: "/router/dispatch",
            body: { launchId: nextLaunchId },
            headers: buildForwardedInternalRequestHeaders(req, { idempotencyKey: dispatchKey })
          });
          if (dispatchOut.statusCode < 200 || dispatchOut.statusCode >= 300) {
            return sendError(
              res,
              dispatchOut.statusCode,
              "approval continuation resumed but dispatch failed",
              {
                launch: launchOut.json ?? null,
                dispatch: dispatchOut.json ?? dispatchOut.body
              },
              { code: "OPS_RESCUE_DISPATCH_FAILED" }
            );
          }
        }
        triageStatus = OPS_RESCUE_TRIAGE_STATUS.RESOLVED;
        actionResult = normalizeForCanonicalJson(
          {
            action: "resume",
            launch: launchOut.json?.launch ?? null,
            dispatch: dispatchOut?.json?.dispatch ?? null,
            results: dispatchOut?.json?.results ?? null
          },
          { path: "$.opsRescueActionResult" }
        );
      } else if (action === "revoke") {
        if (rescueItem.sourceType !== OPS_RESCUE_SOURCE_TYPE.APPROVAL_CONTINUATION) {
          return sendError(res, 409, "revoke is only supported for approval continuations", { rescueId }, { code: "OPS_RESCUE_ACTION_UNSUPPORTED" });
        }
        const requestId = normalizeNonEmptyStringOrNull(rescueItem?.refs?.requestId);
        if (!requestId) {
          return sendError(res, 409, "approval continuation is missing request context", { rescueId }, { code: "OPS_RESCUE_CONTINUATION_MISSING" });
        }
        const revocationReasonCode =
          normalizeNonEmptyStringOrNull(body?.revocationReasonCode) ??
          normalizeNonEmptyStringOrNull(body?.reasonCode) ??
          "ops_rescue_revoked";
        const revokeKey = `ops_rescue_revoke_${sha256Hex(`${rescueId}:${requestId}:${revocationReasonCode}`)}`;
        const revokeOut = await invokeInternalApiRequest({
          method: "POST",
          path: `/v1/execution-grants/${encodeURIComponent(requestId)}/revoke`,
          body: {
            reasonCode: revocationReasonCode
          },
          headers: buildForwardedInternalRequestHeaders(req, { idempotencyKey: revokeKey, protocol: "1.0" })
        });
        if (revokeOut.statusCode < 200 || revokeOut.statusCode >= 300) {
          return sendError(
            res,
            revokeOut.statusCode,
            "failed to revoke execution grant",
            revokeOut.json ?? { body: revokeOut.body },
            { code: "OPS_RESCUE_REVOKE_FAILED" }
          );
        }
        const revokeApprovalStatus =
          typeof revokeOut?.json?.approvalStatus === "string" && revokeOut.json.approvalStatus.trim() !== ""
            ? revokeOut.json.approvalStatus.trim().toLowerCase()
            : revokeOut?.json?.approvalRequest && revokeOut?.json?.approvalDecision
              ? buildActionWalletApprovalStatus({
                  approvalRequest: revokeOut.json.approvalRequest,
                  approvalDecision: revokeOut.json.approvalDecision,
                  nowAt: nowIso()
                })
              : null;
        triageStatus = OPS_RESCUE_TRIAGE_STATUS.RESOLVED;
        actionResult = normalizeForCanonicalJson(
          {
            action: "revoke",
            approvalStatus: revokeApprovalStatus,
            actionIntent: revokeOut.json?.actionIntent ?? null,
            executionGrant: revokeOut.json?.executionGrant ?? null,
            revocationReasonCode
          },
          { path: "$.opsRescueActionResult" }
        );
      } else if (action === "pause") {
        if (rescueItem.sourceType !== OPS_RESCUE_SOURCE_TYPE.RUN) {
          return sendError(res, 409, "pause is only supported for run rescue items", { rescueId }, { code: "OPS_RESCUE_ACTION_UNSUPPORTED" });
        }
        const runId = normalizeNonEmptyStringOrNull(rescueItem?.refs?.runId);
        if (!runId) {
          return sendError(res, 409, "run rescue item is missing run context", { rescueId }, { code: "OPS_RESCUE_RUN_CONTEXT_INVALID" });
        }
        const agentId =
          normalizeNonEmptyStringOrNull(body?.agentId) ??
          normalizeNonEmptyStringOrNull(body?.scope?.id) ??
          normalizeNonEmptyStringOrNull(rescueItem?.details?.agentId);
        if (!agentId) {
          return sendError(
            res,
            409,
            "pause requires run agent context",
            { rescueId, runId },
            { code: "OPS_RESCUE_AGENT_CONTEXT_MISSING" }
          );
        }
        const operatorAction =
          body?.operatorAction && typeof body.operatorAction === "object" && !Array.isArray(body.operatorAction) ? body.operatorAction : null;
        if (!operatorAction) {
          return sendError(res, 400, "pause requires operatorAction", null, { code: "SCHEMA_INVALID" });
        }
        const pauseReasonCode =
          normalizeNonEmptyStringOrNull(body?.reasonCode) ??
          normalizeNonEmptyStringOrNull(body?.pauseReasonCode) ??
          "ops_rescue_paused";
        const pauseReason =
          normalizeNonEmptyStringOrNull(body?.reason) ??
          note ??
          "Operator paused the run from the rescue queue.";
        const pauseKey = `ops_rescue_pause_${sha256Hex(`${rescueId}:${runId}:${agentId}:${pauseReasonCode}`)}`;
        const pauseOut = await invokeInternalApiRequest({
          method: "POST",
          path: "/ops/emergency/pause",
          body: {
            scope: { type: "agent", id: agentId },
            reasonCode: pauseReasonCode,
            reason: pauseReason,
            operatorAction
          },
          headers: buildForwardedInternalRequestHeaders(req, { idempotencyKey: pauseKey, protocol: "1.0" })
        });
        if (pauseOut.statusCode < 200 || pauseOut.statusCode >= 300) {
          return sendError(
            res,
            pauseOut.statusCode,
            "failed to pause run agent",
            pauseOut.json ?? { body: pauseOut.body },
            { code: "OPS_RESCUE_PAUSE_FAILED" }
          );
        }
        triageStatus = OPS_RESCUE_TRIAGE_STATUS.IN_PROGRESS;
        actionResult = normalizeForCanonicalJson(
          {
            action: "pause",
            runId,
            agentId,
            applied: pauseOut.json?.applied ?? null,
            controlType: pauseOut.json?.controlType ?? "pause",
            scope: pauseOut.json?.scope ?? { type: "agent", id: agentId },
            reasonCode: pauseReasonCode,
            reason: pauseReason,
            event: pauseOut.json?.event ?? null
          },
          { path: "$.opsRescueActionResult" }
        );
      } else if (action === "dispatch") {
        if (rescueItem.sourceType !== OPS_RESCUE_SOURCE_TYPE.ROUTER_LAUNCH) {
          return sendError(res, 409, "dispatch is only supported for router launch rescue items", { rescueId }, { code: "OPS_RESCUE_ACTION_UNSUPPORTED" });
        }
        if (String(rescueItem.rescueState ?? "").trim().toLowerCase() !== ROUTER_LAUNCH_STATUS_TASK_STATE.OPEN_READY) {
          return sendError(
            res,
            409,
            "router launch rescue item is not ready to dispatch",
            { rescueId, rescueState: rescueItem.rescueState ?? null },
            { code: "OPS_RESCUE_DISPATCH_STATE_INVALID" }
          );
        }
        const launchId = normalizeNonEmptyStringOrNull(rescueItem?.refs?.launchId);
        const taskId = normalizeNonEmptyStringOrNull(rescueItem?.refs?.taskId);
        if (!launchId || !taskId) {
          return sendError(res, 409, "router launch rescue item is missing launch context", { rescueId }, { code: "OPS_RESCUE_DISPATCH_CONTEXT_INVALID" });
        }
        const dispatchKey = `ops_rescue_dispatch_${sha256Hex(`${rescueId}:${rescueItem.updatedAt ?? ""}`)}`;
        const dispatchOut = await invokeInternalApiRequest({
          method: "POST",
          path: "/router/dispatch",
          body: {
            launchId,
            taskIds: [taskId],
            ...(normalizeNonEmptyStringOrNull(body?.acceptedByAgentId) ? { acceptedByAgentId: String(body.acceptedByAgentId).trim() } : {}),
            ...(normalizeNonEmptyStringOrNull(body?.payerAgentId) ? { payerAgentId: String(body.payerAgentId).trim() } : {}),
            ...(body?.allowOverBudget === true ? { allowOverBudget: true } : {})
          },
          headers: buildForwardedInternalRequestHeaders(req, { idempotencyKey: dispatchKey })
        });
        if (dispatchOut.statusCode < 200 || dispatchOut.statusCode >= 300) {
          return sendError(
            res,
            dispatchOut.statusCode,
            "failed to dispatch router launch task",
            dispatchOut.json ?? { body: dispatchOut.body },
            { code: "OPS_RESCUE_DISPATCH_FAILED" }
          );
        }
        const dispatchTask =
          Array.isArray(dispatchOut?.json?.dispatch?.tasks) && dispatchOut.json.dispatch.tasks.length > 0
            ? dispatchOut.json.dispatch.tasks[0]
            : null;
        const accepted =
          String(dispatchTask?.state ?? "").trim().toLowerCase() === ROUTER_MARKETPLACE_DISPATCH_STATE.ACCEPTED ||
          String(dispatchTask?.state ?? "").trim().toLowerCase() === ROUTER_MARKETPLACE_DISPATCH_STATE.ALREADY_ASSIGNED ||
          String(dispatchTask?.state ?? "").trim().toLowerCase() === ROUTER_MARKETPLACE_DISPATCH_STATE.ALREADY_CLOSED;
        triageStatus = accepted ? OPS_RESCUE_TRIAGE_STATUS.RESOLVED : OPS_RESCUE_TRIAGE_STATUS.IN_PROGRESS;
        actionResult = normalizeForCanonicalJson(
          {
            action: "dispatch",
            dispatch: dispatchOut.json?.dispatch ?? null,
            results: dispatchOut.json?.results ?? null
          },
          { path: "$.opsRescueActionResult" }
        );
      } else if (action === "request_info" || action === "request_evidence") {
        if (rescueItem.sourceType !== OPS_RESCUE_SOURCE_TYPE.RUN) {
          return sendError(res, 409, `${action} is only supported for run rescue items`, { rescueId }, { code: "OPS_RESCUE_ACTION_UNSUPPORTED" });
        }
        const runId = normalizeNonEmptyStringOrNull(rescueItem?.refs?.runId);
        if (!runId) {
          return sendError(res, 409, "run rescue item is missing run context", { rescueId }, { code: "OPS_RESCUE_RUN_CONTEXT_INVALID" });
        }
        const run = await getAgentRunRecord({ tenantId, runId });
        if (!run) {
          return sendError(res, 409, "run record is missing", { rescueId, runId }, { code: "OPS_RESCUE_RUN_MISSING" });
        }
        const runEvents = await getAgentRunEvents(tenantId, runId);
        const latestRunEvent = Array.isArray(runEvents) && runEvents.length > 0 ? runEvents[runEvents.length - 1] : null;
        const expectedPrevChainHash =
          typeof latestRunEvent?.chainHash === "string" && latestRunEvent.chainHash.trim() !== ""
            ? latestRunEvent.chainHash.trim()
            : null;
        if (!expectedPrevChainHash) {
          return sendError(
            res,
            409,
            "run rescue item is missing run event chain context",
            { rescueId, runId },
            { code: "OPS_RESCUE_RUN_CHAIN_CONTEXT_MISSING" }
          );
        }
        const requestedFieldsInput = body?.requestedFields ?? body?.fields ?? null;
        const requestedEvidenceKindsInput = body?.requestedEvidenceKinds ?? body?.evidenceKinds ?? null;
        let requestedFields = [];
        let requestedEvidenceKinds = [];
        try {
          requestedFields = normalizeOpsRescueRequestedStringArray(requestedFieldsInput, { fieldName: "requestedFields" });
          requestedEvidenceKinds = normalizeOpsRescueRequestedStringArray(requestedEvidenceKindsInput, {
            fieldName: "requestedEvidenceKinds"
          });
        } catch (err) {
          return sendError(res, 400, "invalid request-info payload", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }
        if (action === "request_evidence" && requestedEvidenceKinds.length === 0) {
          requestedEvidenceKinds = normalizeOpsRescueRequestedStringArray(rescueItem?.details?.missingEvidence ?? null, {
            fieldName: "requestedEvidenceKinds"
          });
        }
        if (requestedFields.length === 0 && requestedEvidenceKinds.length === 0) {
          return sendError(
            res,
            400,
            `${action} requires requestedFields or requestedEvidenceKinds`,
            null,
            { code: "SCHEMA_INVALID" }
          );
        }
        const requestInfoTitle =
          normalizeNonEmptyStringOrNull(body?.title) ??
          (action === "request_evidence"
            ? rescueItem?.phase1?.categoryLabel
              ? `${String(rescueItem.phase1.categoryLabel).trim()} needs proof`
              : "This run needs proof"
            : rescueItem?.phase1?.categoryLabel
              ? `${String(rescueItem.phase1.categoryLabel).trim()} needs more input`
              : "This run needs more input");
        const requestInfoDetail =
          normalizeNonEmptyStringOrNull(body?.detail) ??
          note ??
          (action === "request_evidence"
            ? requestedEvidenceKinds.length > 0
              ? `Please provide ${requestedEvidenceKinds.join(", ")} so the network can continue.`
              : "Please provide the requested evidence so the network can continue."
            : requestedFields.length > 0
              ? `Please provide ${requestedFields.join(", ")} so the network can continue.`
              : "Please provide the requested evidence so the network can continue.");
        const requestInfoKey = `ops_rescue_${action}_${sha256Hex(`${rescueId}:${run.lastChainHash ?? ""}:${requestInfoTitle}:${requestInfoDetail}`)}`;
        const actionRequiredPayload = normalizeForCanonicalJson(
          {
            code: normalizeNonEmptyStringOrNull(body?.code) ?? (action === "request_evidence" ? "needs_evidence" : "needs_user_input"),
            title: requestInfoTitle,
            detail: requestInfoDetail,
            requestedFields,
            requestedEvidenceKinds,
            requestedAt: nowIso()
          },
          { path: "$.opsRescueRequestActionRequired" }
        );
        const runStatus = String(run?.status ?? "").trim().toLowerCase();
        const runIsTerminal = runStatus === AGENT_RUN_STATUS.COMPLETED || runStatus === AGENT_RUN_STATUS.FAILED;
        let eventOut = null;
        if (!runIsTerminal) {
          eventOut = await invokeInternalApiRequest({
            method: "POST",
            path: `/agents/${encodeURIComponent(String(run.agentId ?? ""))}/runs/${encodeURIComponent(runId)}/events`,
            body: {
              type: AGENT_RUN_EVENT_TYPE.RUN_ACTION_REQUIRED,
              actor: { type: "operator", id: principalId },
              payload: {
                code: actionRequiredPayload.code,
                title: actionRequiredPayload.title,
                detail: actionRequiredPayload.detail,
                requestedFields: actionRequiredPayload.requestedFields,
                requestedEvidenceKinds: actionRequiredPayload.requestedEvidenceKinds
              }
            },
            headers: buildForwardedInternalRequestHeaders(req, {
              idempotencyKey: requestInfoKey,
              expectedPrevChainHash
            })
          });
          if (eventOut.statusCode < 200 || eventOut.statusCode >= 300) {
            return sendError(
              res,
              eventOut.statusCode,
              "failed to request additional user input",
              eventOut.json ?? { body: eventOut.body },
              { code: "OPS_RESCUE_REQUEST_INFO_FAILED" }
            );
          }
        } else {
          eventOut = {
            statusCode: 200,
            json: {
              event: normalizeForCanonicalJson(
                {
                  type: AGENT_RUN_EVENT_TYPE.RUN_ACTION_REQUIRED,
                  at: actionRequiredPayload.requestedAt,
                  synthetic: true,
                  actor: { type: "operator", id: principalId },
                  payload: {
                    code: actionRequiredPayload.code,
                    title: actionRequiredPayload.title,
                    detail: actionRequiredPayload.detail,
                    requestedFields: actionRequiredPayload.requestedFields,
                    requestedEvidenceKinds: actionRequiredPayload.requestedEvidenceKinds
                  }
                },
                { path: "$.opsRescueActionResult.event" }
              ),
              run: normalizeForCanonicalJson(
                {
                  runId,
                  agentId: run.agentId ?? null,
                  status: run.status ?? null,
                  actionRequired: actionRequiredPayload
                },
                { path: "$.opsRescueActionResult.run" }
              )
            }
          };
        }
        triageStatus = OPS_RESCUE_TRIAGE_STATUS.IN_PROGRESS;
        actionResult = normalizeForCanonicalJson(
          {
            action,
            event: eventOut.json?.event ?? null,
            run: eventOut.json?.run ?? null,
            requestedFields,
            requestedEvidenceKinds,
            terminalRunFallback: runIsTerminal
          },
          { path: "$.opsRescueActionResult" }
        );
      } else if (action === "recommend_reroute" || action === "handoff_reroute") {
        if (rescueItem.sourceType !== OPS_RESCUE_SOURCE_TYPE.RUN) {
          return sendError(
            res,
            409,
            `${action} is only supported for run rescue items`,
            { rescueId },
            { code: "OPS_RESCUE_ACTION_UNSUPPORTED" }
          );
        }
        const runId = normalizeNonEmptyStringOrNull(rescueItem?.refs?.runId);
        if (!runId) {
          return sendError(res, 409, "run rescue item is missing run context", { rescueId }, { code: "OPS_RESCUE_RUN_CONTEXT_INVALID" });
        }
        const run = await getAgentRunRecord({ tenantId, runId }).catch(() => null);
        if (!run) {
          return sendError(res, 409, "run record is missing", { rescueId, runId }, { code: "OPS_RESCUE_RUN_MISSING" });
        }
        const candidates = Array.isArray(rescueItem?.details?.managedSpecialistCandidates)
          ? rescueItem.details.managedSpecialistCandidates
          : [];
        if (candidates.length === 0) {
          return sendError(
            res,
            409,
            "run rescue item does not have managed reroute candidates",
            { rescueId, runId },
            { code: "OPS_RESCUE_REROUTE_UNAVAILABLE" }
          );
        }
        const targetProfileId =
          normalizeNonEmptyStringOrNull(body?.targetProfileId) ??
          normalizeNonEmptyStringOrNull(body?.profileId) ??
          normalizeNonEmptyStringOrNull(body?.specialistId);
        if (!targetProfileId) {
          return sendError(res, 400, "targetProfileId is required", null, { code: "SCHEMA_INVALID" });
        }
        const recommendedSpecialist =
          candidates.find((candidate) => String(candidate?.profileId ?? "").trim() === targetProfileId) ?? null;
        if (!recommendedSpecialist) {
          return sendError(
            res,
            409,
            "targetProfileId is not a valid managed reroute candidate",
            { rescueId, runId, targetProfileId },
            { code: "OPS_RESCUE_REROUTE_TARGET_INVALID" }
          );
        }
        const providerCandidates = Array.isArray(recommendedSpecialist?.providerCandidates)
          ? recommendedSpecialist.providerCandidates
          : [];
        const targetProviderId = normalizeNonEmptyStringOrNull(body?.targetProviderId ?? body?.providerId ?? null);
        const targetProviderRef = normalizeNonEmptyStringOrNull(body?.targetProviderRef ?? body?.providerRef ?? null);
        const targetToolId = normalizeNonEmptyStringOrNull(body?.targetToolId ?? body?.toolId ?? null);
        const selectedProviderCandidate =
          targetProviderId || targetProviderRef || targetToolId
            ? providerCandidates.find((candidate) => {
                if (targetProviderId && String(candidate?.providerId ?? "").trim() !== targetProviderId) return false;
                if (targetProviderRef && String(candidate?.providerRef ?? "").trim() !== targetProviderRef) return false;
                if (targetToolId && String(candidate?.toolId ?? "").trim() !== targetToolId) return false;
                return true;
              }) ?? null
            : providerCandidates.find((candidate) => candidate?.handoffReady === true) ?? providerCandidates[0] ?? null;
        if ((targetProviderId || targetProviderRef || targetToolId) && !selectedProviderCandidate) {
          return sendError(
            res,
            409,
            "target provider candidate is not a valid managed reroute candidate",
            {
              rescueId,
              runId,
              targetProviderId,
              targetProviderRef,
              targetToolId
            },
            { code: "OPS_RESCUE_REROUTE_PROVIDER_TARGET_INVALID" }
          );
        }
        const autoHandoff = body?.autoHandoff === true || body?.autoHandoff === "true";
        if (action === "handoff_reroute" || (action === "recommend_reroute" && autoHandoff && selectedProviderCandidate?.handoffReady === true)) {
          const runStatus = String(run?.status ?? "").trim().toLowerCase();
          if (runStatus === AGENT_RUN_STATUS.COMPLETED || runStatus === AGENT_RUN_STATUS.FAILED) {
            return sendError(
              res,
              409,
              "handoff_reroute requires a non-terminal run",
              { rescueId, runId, status: run.status ?? null },
              { code: "OPS_RESCUE_HANDOFF_RUN_TERMINAL" }
            );
          }
          if (!selectedProviderCandidate || selectedProviderCandidate.handoffReady !== true) {
            return sendError(
              res,
              409,
              "selected managed specialist is not ready for provider handoff",
              { rescueId, runId, targetProfileId },
              { code: "OPS_RESCUE_HANDOFF_NOT_READY" }
            );
          }
          const runEvents = await getAgentRunEvents(tenantId, runId);
          let responseBody = null;
          try {
            responseBody = await executeManagedProviderRunHandoff({
              tenantId,
              rescueId,
              run,
              targetProfileId,
              providerCandidate: selectedProviderCandidate,
              assignmentMode: action === "handoff_reroute" ? "rescue_forced_handoff" : "rescue_auto_handoff",
              note,
              actorPrincipalId: principalId,
              existingEvents: runEvents
            });
          } catch (err) {
            return sendError(
              res,
              coerceManagedProviderHandoffErrorStatusCode(err),
              "failed to invoke managed provider handoff",
              {
                message: err?.message ?? null,
                statusCode: Number.isSafeInteger(Number(err?.statusCode)) ? Number(err.statusCode) : null,
                details: err?.details ?? null
              },
              { code: err?.code ?? "OPS_RESCUE_HANDOFF_PROVIDER_EXECUTION_FAILED" }
            );
          }
          triageStatus = OPS_RESCUE_TRIAGE_STATUS.IN_PROGRESS;
          actionResult = normalizeForCanonicalJson(
            {
              action: action === "handoff_reroute" ? "handoff_reroute" : "recommend_reroute",
              runId,
              targetProfileId,
              recommendedSpecialist,
              managedExecution: {
                ready: true,
                providerCandidate: selectedProviderCandidate,
                candidateCount: providerCandidates.length
              },
              ...responseBody
            },
            { path: "$.opsRescueActionResult" }
          );
        } else {
          triageStatus = OPS_RESCUE_TRIAGE_STATUS.IN_PROGRESS;
          actionResult = normalizeForCanonicalJson(
            {
              action: "recommend_reroute",
              runId,
              targetProfileId,
              recommendedSpecialist,
              managedExecution: {
                ready: selectedProviderCandidate?.handoffReady === true,
                providerCandidate: selectedProviderCandidate,
                candidateCount: providerCandidates.length
              }
            },
            { path: "$.opsRescueActionResult" }
          );
        }
      } else if (action === "retry_finalize") {
        if (rescueItem.sourceType !== OPS_RESCUE_SOURCE_TYPE.RUN) {
          return sendError(res, 409, "retry_finalize is only supported for run rescue items", { rescueId }, { code: "OPS_RESCUE_ACTION_UNSUPPORTED" });
        }
        const runId = normalizeNonEmptyStringOrNull(rescueItem?.refs?.runId);
        if (!runId) {
          return sendError(res, 409, "run rescue item is missing run context", { rescueId }, { code: "OPS_RESCUE_RUN_CONTEXT_INVALID" });
        }
        const executionGrantId =
          normalizeNonEmptyStringOrNull(body?.executionGrantId) ??
          normalizeNonEmptyStringOrNull(rescueItem?.refs?.requestId) ??
          normalizeNonEmptyStringOrNull(rescueItem?.details?.executionGrantId);
        const workOrderId =
          normalizeNonEmptyStringOrNull(body?.workOrderId) ??
          normalizeNonEmptyStringOrNull(rescueItem?.details?.workOrderId);
        if (!executionGrantId || !workOrderId) {
          return sendError(
            res,
            409,
            "retry_finalize requires linked Action Wallet context",
            { rescueId, runId, executionGrantId, workOrderId },
            { code: "OPS_RESCUE_ACTION_WALLET_CONTEXT_MISSING" }
          );
        }
        const completionInput =
          body?.completion && typeof body.completion === "object" && !Array.isArray(body.completion) ? body.completion : null;
        if (!completionInput) {
          return sendError(res, 400, "retry_finalize requires completion payload", null, { code: "SCHEMA_INVALID" });
        }
        let verifierVerdict = null;
        try {
          verifierVerdict = normalizeActionWalletVerifierVerdictInput(completionInput?.verifierVerdict ?? null, {
            fieldPath: "completion.verifierVerdict",
            allowNull: false
          });
        } catch (err) {
          return sendError(res, 400, "invalid verifier verdict", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }
        const finalizeBody = normalizeForCanonicalJson(
          {
            workOrderId,
            completion: {
              ...completionInput,
              verifierVerdict
            },
            ...(body?.settlement && typeof body.settlement === "object" && !Array.isArray(body.settlement)
              ? { settlement: body.settlement }
              : {})
          },
          { path: "$.opsRescueRetryFinalize" }
        );
        const finalizeKey = `ops_rescue_retry_finalize_${sha256Hex(
          canonicalJsonStringify({
            rescueId,
            runId,
            executionGrantId,
            finalizeBody
          })
        )}`;
        const finalizeOut = await invokeInternalApiRequest({
          method: "POST",
          path: `/v1/execution-grants/${encodeURIComponent(executionGrantId)}/finalize`,
          body: finalizeBody,
          headers: buildForwardedInternalRequestHeaders(req, { idempotencyKey: finalizeKey, protocol: "1.0" })
        });
        if (finalizeOut.statusCode < 200 || finalizeOut.statusCode >= 300) {
          return sendError(
            res,
            finalizeOut.statusCode,
            "failed to retry Action Wallet finalization",
            finalizeOut.json ?? { body: finalizeOut.body },
            { code: "OPS_RESCUE_RETRY_FINALIZE_FAILED" }
          );
        }
        triageStatus = OPS_RESCUE_TRIAGE_STATUS.RESOLVED;
        actionResult = normalizeForCanonicalJson(
          {
            action: "retry_finalize",
            runId,
            executionGrantId,
            workOrderId,
            executionGrant: finalizeOut.json?.executionGrant ?? null,
            workOrder: finalizeOut.json?.workOrder ?? null,
            completionReceipt: finalizeOut.json?.completionReceipt ?? null,
            actionReceipt: finalizeOut.json?.actionReceipt ?? null
          },
          { path: "$.opsRescueActionResult" }
        );
      } else if (action === "escalate_refund") {
        if (rescueItem.sourceType !== OPS_RESCUE_SOURCE_TYPE.RUN) {
          return sendError(res, 409, "escalate_refund is only supported for run rescue items", { rescueId }, { code: "OPS_RESCUE_ACTION_UNSUPPORTED" });
        }
        const runId = normalizeNonEmptyStringOrNull(rescueItem?.refs?.runId);
        if (!runId) {
          return sendError(res, 409, "run rescue item is missing run context", { rescueId }, { code: "OPS_RESCUE_RUN_CONTEXT_INVALID" });
        }
        const settlement = await getAgentRunSettlementRecord({ tenantId, runId }).catch(() => null);
        if (!settlement) {
          return sendError(res, 409, "run settlement is missing", { rescueId, runId }, { code: "OPS_RESCUE_SETTLEMENT_MISSING" });
        }
        if (String(settlement.status ?? "").trim().toLowerCase() === AGENT_RUN_SETTLEMENT_STATUS.LOCKED) {
          return sendError(
            res,
            409,
            "refund escalation requires a resolved settlement",
            { rescueId, runId, status: settlement.status ?? null },
            { code: "OPS_RESCUE_SETTLEMENT_NOT_RESOLVED" }
          );
        }
        const expectedRequestSha256 = resolveSettlementRequestBindingSha256(settlement);
        if (!expectedRequestSha256) {
          return sendError(
            res,
            409,
            "refund escalation requires settlement request binding evidence",
            { rescueId, runId },
            { code: "OPS_RESCUE_REFUND_BINDING_MISSING" }
          );
        }
        const disputeId =
          normalizeNonEmptyStringOrNull(body?.disputeId) ??
          normalizeNonEmptyStringOrNull(rescueItem?.refs?.disputeId) ??
          `dsp_rescue_${sha256Hex(`${tenantId}:${runId}:${rescueId}`).slice(0, 16)}`;
        const disputeReason =
          normalizeNonEmptyStringOrNull(body?.reason) ??
          note ??
          "Operator opened refund escalation from the rescue queue.";
        const evidenceRefs = mergeUniqueStringArrays(
          [`http:request_sha256:${expectedRequestSha256}`, buildOpsRescueEvidenceRef({ rescueId, action: "refund", suffix: "context" })],
          normalizeOpsRescueRequestedStringArray(body?.evidenceRefs ?? null, { fieldName: "evidenceRefs" })
        );
        let disputeOut = null;
        if (String(settlement.disputeStatus ?? "").trim().toLowerCase() === "open" && String(settlement.disputeId ?? "").trim() === disputeId) {
          const escalationKey = `ops_rescue_refund_escalate_${sha256Hex(`${rescueId}:${settlement.updatedAt ?? settlement.releasedAt ?? ""}`)}`;
          disputeOut = await invokeInternalApiRequest({
            method: "POST",
            path: `/runs/${encodeURIComponent(runId)}/dispute/escalate`,
            body: {
              disputeId,
              escalationLevel: AGENT_RUN_SETTLEMENT_DISPUTE_ESCALATION_LEVEL.L2_ARBITER,
              channel: AGENT_RUN_SETTLEMENT_DISPUTE_CHANNEL.ARBITER,
              reason: disputeReason
            },
            headers: buildForwardedInternalRequestHeaders(req, { idempotencyKey: escalationKey })
          });
        } else {
          const openKey = `ops_rescue_refund_open_${sha256Hex(`${rescueId}:${settlement.updatedAt ?? settlement.releasedAt ?? ""}`)}`;
          disputeOut = await invokeInternalApiRequest({
            method: "POST",
            path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
            body: {
              disputeId,
              disputeType: "payment",
              disputePriority: "high",
              disputeChannel: AGENT_RUN_SETTLEMENT_DISPUTE_CHANNEL.COUNTERPARTY,
              escalationLevel: AGENT_RUN_SETTLEMENT_DISPUTE_ESCALATION_LEVEL.L2_ARBITER,
              reason: disputeReason,
              evidenceRefs
            },
            headers: buildForwardedInternalRequestHeaders(req, { idempotencyKey: openKey })
          });
        }
        if (disputeOut.statusCode < 200 || disputeOut.statusCode >= 300) {
          return sendError(
            res,
            disputeOut.statusCode,
            "failed to escalate refund/dispute handling",
            disputeOut.json ?? { body: disputeOut.body },
            { code: "OPS_RESCUE_REFUND_ESCALATION_FAILED" }
          );
        }
        triageStatus = OPS_RESCUE_TRIAGE_STATUS.IN_PROGRESS;
        actionResult = normalizeForCanonicalJson(
          {
            action: "escalate_refund",
            dispute: disputeOut.json?.settlement ?? null,
            disputeId,
            evidenceRefs
          },
          { path: "$.opsRescueActionResult" }
        );
      } else if (action === "resolve_dispute") {
        if (rescueItem.sourceType !== OPS_RESCUE_SOURCE_TYPE.RUN) {
          return sendError(res, 409, "resolve_dispute is only supported for run rescue items", { rescueId }, { code: "OPS_RESCUE_ACTION_UNSUPPORTED" });
        }
        const runId = normalizeNonEmptyStringOrNull(rescueItem?.refs?.runId);
        if (!runId) {
          return sendError(res, 409, "run rescue item is missing run context", { rescueId }, { code: "OPS_RESCUE_RUN_CONTEXT_INVALID" });
        }
        const settlement = await getAgentRunSettlementRecord({ tenantId, runId }).catch(() => null);
        if (!settlement) {
          return sendError(res, 409, "run settlement is missing", { rescueId, runId }, { code: "OPS_RESCUE_SETTLEMENT_MISSING" });
        }
        const disputeId =
          normalizeNonEmptyStringOrNull(body?.disputeId) ??
          normalizeNonEmptyStringOrNull(rescueItem?.refs?.disputeId) ??
          normalizeNonEmptyStringOrNull(settlement?.disputeId);
        if (!disputeId) {
          return sendError(
            res,
            409,
            "resolve_dispute requires an open dispute",
            { rescueId, runId },
            { code: "OPS_RESCUE_DISPUTE_MISSING" }
          );
        }
        if (
          String(settlement?.disputeStatus ?? "").trim().toLowerCase() !== AGENT_RUN_SETTLEMENT_DISPUTE_STATUS.OPEN ||
          String(settlement?.disputeId ?? "").trim() !== disputeId
        ) {
          return sendError(
            res,
            409,
            "resolve_dispute requires the requested dispute to be open",
            {
              rescueId,
              runId,
              disputeId,
              settlementDisputeId: settlement?.disputeId ?? null,
              disputeStatus: settlement?.disputeStatus ?? null
            },
            { code: "OPS_RESCUE_DISPUTE_NOT_OPEN" }
          );
        }
        const expectedRequestSha256 = resolveSettlementRequestBindingSha256(settlement);
        if (!expectedRequestSha256) {
          return sendError(
            res,
            409,
            "resolve_dispute requires settlement request binding evidence",
            { rescueId, runId, disputeId },
            { code: "OPS_RESCUE_DISPUTE_BINDING_MISSING" }
          );
        }
        const resolutionOutcome = normalizeNonEmptyStringOrNull(body?.resolutionOutcome ?? body?.outcome);
        if (!resolutionOutcome) {
          return sendError(res, 400, "resolutionOutcome is required", null, { code: "SCHEMA_INVALID" });
        }
        const resolutionSummary =
          normalizeNonEmptyStringOrNull(body?.resolutionSummary ?? body?.summary) ??
          note ??
          "Operator resolved the dispute from the rescue queue.";
        const closedByAgentId =
          normalizeNonEmptyStringOrNull(body?.closedByAgentId) ??
          normalizeNonEmptyStringOrNull(body?.resolvedByAgentId) ??
          normalizeNonEmptyStringOrNull(body?.operatorAgentId);
        const resolutionEscalationLevel =
          normalizeNonEmptyStringOrNull(body?.resolutionEscalationLevel ?? body?.escalationLevel) ??
          normalizeNonEmptyStringOrNull(settlement?.disputeContext?.escalationLevel);
        const evidenceRefs = mergeUniqueStringArrays(
          [`http:request_sha256:${expectedRequestSha256}`, buildOpsRescueEvidenceRef({ rescueId, action: "resolve_dispute", suffix: "context" })],
          normalizeOpsRescueRequestedStringArray(body?.evidenceRefs ?? null, { fieldName: "evidenceRefs" })
        );
        const closeKey = `ops_rescue_dispute_close_${sha256Hex(`${rescueId}:${disputeId}:${resolutionOutcome}:${settlement.updatedAt ?? settlement.releasedAt ?? ""}`)}`;
        const disputeCloseOut = await invokeInternalApiRequest({
          method: "POST",
          path: `/runs/${encodeURIComponent(runId)}/dispute/close`,
          body: {
            disputeId,
            resolutionOutcome,
            resolutionSummary,
            ...(resolutionEscalationLevel ? { resolutionEscalationLevel } : {}),
            ...(closedByAgentId ? { closedByAgentId } : {}),
            resolutionEvidenceRefs: evidenceRefs
          },
          headers: buildForwardedInternalRequestHeaders(req, { idempotencyKey: closeKey })
        });
        if (disputeCloseOut.statusCode < 200 || disputeCloseOut.statusCode >= 300) {
          return sendError(
            res,
            disputeCloseOut.statusCode,
            "failed to close dispute from rescue queue",
            disputeCloseOut.json ?? { body: disputeCloseOut.body },
            { code: "OPS_RESCUE_DISPUTE_CLOSE_FAILED" }
          );
        }
        const resolveKey = `ops_rescue_settlement_resolve_${sha256Hex(`${rescueId}:${disputeId}:${resolutionOutcome}:${settlement.updatedAt ?? settlement.releasedAt ?? ""}`)}`;
        const settlementResolveOut = await invokeInternalApiRequest({
          method: "POST",
          path: `/runs/${encodeURIComponent(runId)}/settlement/resolve`,
          body: {
            reason: resolutionSummary,
            ...(closedByAgentId ? { resolvedByAgentId: closedByAgentId } : {}),
            evidenceRefs
          },
          headers: buildForwardedInternalRequestHeaders(req, { idempotencyKey: resolveKey, protocol: "1.0" })
        });
        if (settlementResolveOut.statusCode < 200 || settlementResolveOut.statusCode >= 300) {
          return sendError(
            res,
            settlementResolveOut.statusCode,
            "failed to resolve settlement after dispute close",
            {
              dispute: disputeCloseOut.json ?? null,
              settlement: settlementResolveOut.json ?? settlementResolveOut.body
            },
            { code: "OPS_RESCUE_SETTLEMENT_RESOLVE_FAILED" }
          );
        }
        triageStatus = OPS_RESCUE_TRIAGE_STATUS.RESOLVED;
        actionResult = normalizeForCanonicalJson(
          {
            action: "resolve_dispute",
            disputeId,
            resolutionOutcome,
            resolutionSummary,
            evidenceRefs,
            dispute: disputeCloseOut.json?.settlement ?? null,
            settlement: settlementResolveOut.json?.settlement ?? null
          },
          { path: "$.opsRescueActionResult" }
        );
      } else {
        return sendError(res, 400, "unsupported rescue action", { action }, { code: "SCHEMA_INVALID" });
      }

      const nextTriage = buildNextOpsRescueTriageRecord({
        tenantId,
        rescueItem,
        existingRecord,
        status: triageStatus,
        ownerPrincipalId: normalizeNonEmptyStringOrNull(body?.ownerPrincipalId ?? existingRecord?.ownerPrincipalId ?? null),
        notes: normalizeNonEmptyStringOrNull(body?.notes ?? existingRecord?.notes ?? null),
        actorPrincipalId: principalId,
        note,
        action: `rescue_${action}`,
        metadata: actionResult,
        nowAt: nowIso()
      });
      let saved = null;
      try {
        saved = await putOpsRescueTriageRecord({
          tenantId,
          triage: nextTriage,
          audit: makeOpsAudit({
            action: "OPS_RESCUE_ACTION",
            targetType: "ops_rescue_queue_item",
            targetId: rescueId,
            details: {
              action,
              sourceType: rescueItem.sourceType ?? null,
              rescueState: rescueItem.rescueState ?? null,
              triageStatus
            }
          })
        });
      } catch (err) {
        return sendError(res, 501, "ops rescue triage not supported for this store", { message: err?.message });
      }
      const updatedRescueItem = await getOpsRescueQueueItemRecord({ tenantId, rescueId });
      return sendJson(res, 200, {
        ok: true,
        tenantId,
        rescueItem: updatedRescueItem ? mergeOpsRescueQueueItemWithTriage(updatedRescueItem, saved) : null,
        triage: saved,
        actionResult
      });
    }

    if (parts[1] === "network" && parts[2] === "command-center" && parts.length === 3 && req.method === "GET") {
      if (!requireScope(auth.scopes, OPS_SCOPES.OPS_READ)) return sendError(res, 403, "forbidden");
      const transactionFeeBpsRaw = url.searchParams.get("transactionFeeBps");
      const windowHoursRaw = url.searchParams.get("windowHours");
      const disputeSlaHoursRaw = url.searchParams.get("disputeSlaHours");

      const transactionFeeBps =
        transactionFeeBpsRaw === null || transactionFeeBpsRaw.trim() === ""
          ? 100
          : Number(transactionFeeBpsRaw);
      if (!Number.isSafeInteger(transactionFeeBps) || transactionFeeBps < 0 || transactionFeeBps > 5000) {
        return sendError(res, 400, "transactionFeeBps must be an integer within 0..5000");
      }

      const windowHours =
        windowHoursRaw === null || windowHoursRaw.trim() === ""
          ? 24
          : Number(windowHoursRaw);
      if (!Number.isSafeInteger(windowHours) || windowHours <= 0 || windowHours > 24 * 365) {
        return sendError(res, 400, "windowHours must be an integer within 1..8760");
      }

      const disputeSlaHours =
        disputeSlaHoursRaw === null || disputeSlaHoursRaw.trim() === ""
          ? 24
          : Number(disputeSlaHoursRaw);
      if (!Number.isSafeInteger(disputeSlaHours) || disputeSlaHours <= 0 || disputeSlaHours > 24 * 365) {
        return sendError(res, 400, "disputeSlaHours must be an integer within 1..8760");
      }

      const commandCenter = await computeNetworkCommandCenterSummary({
        tenantId,
        transactionFeeBps,
        windowHours,
        disputeSlaHours
      });
      const emitAlertsRaw = url.searchParams.get("emitAlerts");
      const persistAlertsRaw = url.searchParams.get("persistAlerts");

      let emitAlerts;
      let persistAlerts;
      try {
        emitAlerts = parseBooleanQueryValue(emitAlertsRaw, { defaultValue: false, name: "emitAlerts" });
        persistAlerts = parseBooleanQueryValue(persistAlertsRaw, { defaultValue: false, name: "persistAlerts" });
      } catch (err) {
        return sendError(res, 400, err?.message ?? "invalid alert query parameters");
      }
      if (persistAlerts && !requireScope(auth.scopes, OPS_SCOPES.OPS_WRITE)) return sendError(res, 403, "forbidden");

      let alertsSummary = null;
      if (emitAlerts || persistAlerts) {
        let thresholds;
        try {
          thresholds = {
            httpClientErrorRateThresholdPct: parseThresholdNumberQueryValue(url.searchParams.get("httpClientErrorRateThresholdPct"), {
              defaultValue: COMMAND_CENTER_ALERT_DEFAULT_THRESHOLDS.httpClientErrorRateThresholdPct,
              min: 0,
              name: "httpClientErrorRateThresholdPct"
            }),
            httpServerErrorRateThresholdPct: parseThresholdNumberQueryValue(url.searchParams.get("httpServerErrorRateThresholdPct"), {
              defaultValue: COMMAND_CENTER_ALERT_DEFAULT_THRESHOLDS.httpServerErrorRateThresholdPct,
              min: 0,
              name: "httpServerErrorRateThresholdPct"
            }),
            deliveryDlqThreshold: parseThresholdIntegerQueryValue(url.searchParams.get("deliveryDlqThreshold"), {
              defaultValue: COMMAND_CENTER_ALERT_DEFAULT_THRESHOLDS.deliveryDlqThreshold,
              min: 0,
              name: "deliveryDlqThreshold"
            }),
            disputeOverSlaThreshold: parseThresholdIntegerQueryValue(url.searchParams.get("disputeOverSlaThreshold"), {
              defaultValue: COMMAND_CENTER_ALERT_DEFAULT_THRESHOLDS.disputeOverSlaThreshold,
              min: 0,
              name: "disputeOverSlaThreshold"
            }),
            determinismRejectThreshold: parseThresholdIntegerQueryValue(url.searchParams.get("determinismRejectThreshold"), {
              defaultValue: COMMAND_CENTER_ALERT_DEFAULT_THRESHOLDS.determinismRejectThreshold,
              min: 0,
              name: "determinismRejectThreshold"
            }),
            kernelVerificationErrorThreshold: parseThresholdIntegerQueryValue(
              url.searchParams.get("kernelVerificationErrorThreshold"),
              {
                defaultValue: COMMAND_CENTER_ALERT_DEFAULT_THRESHOLDS.kernelVerificationErrorThreshold,
                min: 0,
                name: "kernelVerificationErrorThreshold"
              }
            )
          };
        } catch (err) {
          return sendError(res, 400, err?.message ?? "invalid alert thresholds");
        }

        const alerts = evaluateNetworkCommandCenterAlerts({ commandCenter, thresholds });
        const emitted = persistAlerts
          ? await emitCommandCenterAlertArtifacts({
              tenantId,
              commandCenter,
              thresholds,
              alerts
            })
          : [];
        alertsSummary = {
          evaluatedCount: Object.keys(COMMAND_CENTER_ALERT_DEFAULT_THRESHOLDS).length,
          breachCount: alerts.length,
          emittedCount: emitted.length,
          emitted
        };
      }

      return sendJson(res, 200, {
        ok: true,
        tenantId,
        commandCenter,
        alerts: alertsSummary
      });
    }

    if (parts[1] === "network" && parts[2] === "command-center" && parts[3] === "workspace" && parts.length === 4 && req.method === "GET") {
      if (!requireScope(auth.scopes, OPS_SCOPES.OPS_READ)) return sendError(res, 403, "forbidden");
      const transactionFeeBpsRaw = url.searchParams.get("transactionFeeBps");
      const windowHoursRaw = url.searchParams.get("windowHours");
      const disputeSlaHoursRaw = url.searchParams.get("disputeSlaHours");

      const transactionFeeBps =
        transactionFeeBpsRaw === null || transactionFeeBpsRaw.trim() === ""
          ? 100
          : Number(transactionFeeBpsRaw);
      if (!Number.isSafeInteger(transactionFeeBps) || transactionFeeBps < 0 || transactionFeeBps > 5000) {
        return sendError(res, 400, "transactionFeeBps must be an integer within 0..5000");
      }

      const windowHours =
        windowHoursRaw === null || windowHoursRaw.trim() === ""
          ? 24
          : Number(windowHoursRaw);
      if (!Number.isSafeInteger(windowHours) || windowHours <= 0 || windowHours > 24 * 365) {
        return sendError(res, 400, "windowHours must be an integer within 1..8760");
      }

      const disputeSlaHours =
        disputeSlaHoursRaw === null || disputeSlaHoursRaw.trim() === ""
          ? 24
          : Number(disputeSlaHoursRaw);
      if (!Number.isSafeInteger(disputeSlaHours) || disputeSlaHours <= 0 || disputeSlaHours > 24 * 365) {
        return sendError(res, 400, "disputeSlaHours must be an integer within 1..8760");
      }

      let thresholds;
      try {
        thresholds = {
          httpClientErrorRateThresholdPct: parseThresholdNumberQueryValue(url.searchParams.get("httpClientErrorRateThresholdPct"), {
            defaultValue: COMMAND_CENTER_ALERT_DEFAULT_THRESHOLDS.httpClientErrorRateThresholdPct,
            min: 0,
            name: "httpClientErrorRateThresholdPct"
          }),
          httpServerErrorRateThresholdPct: parseThresholdNumberQueryValue(url.searchParams.get("httpServerErrorRateThresholdPct"), {
            defaultValue: COMMAND_CENTER_ALERT_DEFAULT_THRESHOLDS.httpServerErrorRateThresholdPct,
            min: 0,
            name: "httpServerErrorRateThresholdPct"
          }),
          deliveryDlqThreshold: parseThresholdIntegerQueryValue(url.searchParams.get("deliveryDlqThreshold"), {
            defaultValue: COMMAND_CENTER_ALERT_DEFAULT_THRESHOLDS.deliveryDlqThreshold,
            min: 0,
            name: "deliveryDlqThreshold"
          }),
          disputeOverSlaThreshold: parseThresholdIntegerQueryValue(url.searchParams.get("disputeOverSlaThreshold"), {
            defaultValue: COMMAND_CENTER_ALERT_DEFAULT_THRESHOLDS.disputeOverSlaThreshold,
            min: 0,
            name: "disputeOverSlaThreshold"
          }),
          determinismRejectThreshold: parseThresholdIntegerQueryValue(url.searchParams.get("determinismRejectThreshold"), {
            defaultValue: COMMAND_CENTER_ALERT_DEFAULT_THRESHOLDS.determinismRejectThreshold,
            min: 0,
            name: "determinismRejectThreshold"
          }),
          kernelVerificationErrorThreshold: parseThresholdIntegerQueryValue(
            url.searchParams.get("kernelVerificationErrorThreshold"),
            {
              defaultValue: COMMAND_CENTER_ALERT_DEFAULT_THRESHOLDS.kernelVerificationErrorThreshold,
              min: 0,
              name: "kernelVerificationErrorThreshold"
            }
          )
        };
      } catch (err) {
        return sendError(res, 400, err?.message ?? "invalid alert thresholds");
      }

      let commandCenter;
      try {
        commandCenter = await computeNetworkCommandCenterSummary({
          tenantId,
          transactionFeeBps,
          windowHours,
          disputeSlaHours,
          failClosed: true
        });
      } catch (err) {
        if (isCommandCenterDependencyUnavailableError(err)) {
          return sendError(
            res,
            501,
            "command-center workspace dependencies unavailable",
            { message: err?.message ?? String(err) },
            { code: "COMMAND_CENTER_DEPENDENCY_UNAVAILABLE" }
          );
        }
        return sendError(
          res,
          500,
          "failed to compute command-center workspace",
          { message: err?.message ?? String(err) },
          { code: "COMMAND_CENTER_WORKSPACE_FAILED" }
        );
      }

      const breaches = evaluateNetworkCommandCenterAlerts({ commandCenter, thresholds });
      const workspace = normalizeForCanonicalJson(
        {
          schemaVersion: COMMAND_CENTER_WORKSPACE_SCHEMA_VERSION,
          generatedAt: commandCenter.generatedAt,
          parameters: {
            transactionFeeBps,
            windowHours,
            disputeSlaHours
          },
          reliability: commandCenter.reliability,
          safety: {
            determinism: commandCenter.determinism,
            settlement: commandCenter.settlement,
            disputes: commandCenter.disputes,
            alerts: {
              thresholds,
              evaluatedCount: Object.keys(COMMAND_CENTER_ALERT_DEFAULT_THRESHOLDS).length,
              breachCount: breaches.length,
              breaches
            }
          },
          trust: commandCenter.trust,
          revenue: commandCenter.revenue,
          actionability: {
            canPersistAlerts: requireScope(auth.scopes, OPS_SCOPES.OPS_WRITE)
          },
          links: {
            summary: "/ops/network/command-center",
            status: "/ops/status"
          }
        },
        { path: "$" }
      );
      return sendJson(res, 200, {
        ok: true,
        tenantId,
        workspace
      });
    }

    // Check if the response was sent by a route that uses bare "return;" (e.g. SSE streams).
    if (res.writableEnded || res.headersSent) return true;

    return false;
  };
}
