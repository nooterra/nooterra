/**
 * Job routes: /jobs, /jobs/:jobId, /jobs/:jobId/events, /jobs/:jobId/audit, etc.
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
export function createJobRoutes(deps) {
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
    reduceJob,
    createChainedEvent,
    appendChainedEvent,
    verifyChainedEvents,
    ledgerEntriesForJobEvent,
    serverSigner,
    listJobs,
    getJobEventsFresh,
    countOpenJobsForTenant,
    getTenantConfig,
    clampQuota,
    isQuotaExceeded,
    quotaPlatformMaxOpenJobs,
    buildAuditExport,
    buildEvidenceExport,
    buildEvidenceDownloadUrl,
    normalizeArtifactAccessScopeQuery,
    normalizeTenant,
    DEFAULT_TENANT_ID,
    requireScope,
    OPS_SCOPES,
    requireProtocolHeaderForWrite,
    evidenceSigningSecret,
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
  return async function handleJobRoutes(ctx) {
    const { req, res, method, path, url, tenantId, principalId, auth, readIdempotency } = ctx;
    // Use wrapped versions that return true for "return sendJson/sendError(...)" pattern.
    const sendJson = _sendJson;
    const sendError = _sendError;

    if (!path.startsWith("/jobs")) return false;

    if (req.method === "GET" && path === "/jobs") {
    return sendJson(res, 200, { jobs: listJobs({ tenantId }) });
    }

    if (req.method === "POST" && path === "/jobs") {
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

    {
      const cfg = getTenantConfig(tenantId) ?? {};
      const requestedLimit = cfg?.quotas?.maxOpenJobs ?? 0;
      const limit = clampQuota({ tenantLimit: Number.isSafeInteger(requestedLimit) ? requestedLimit : 0, defaultLimit: 0, maxLimit: quotaPlatformMaxOpenJobs });
      if (limit > 0) {
        const open = countOpenJobsForTenant(tenantId);
        if (isQuotaExceeded({ current: open, limit })) {
          return sendError(res, 429, "tenant quota exceeded", { kind: "open_jobs", limit, current: open }, { code: "TENANT_QUOTA_EXCEEDED" });
        }
      }
    }

    const templateId = body?.templateId;
    if (!templateId) return sendError(res, 400, "templateId is required");

    const jobId = createId("job");

    const createdEvent = createChainedEvent({
      streamId: jobId,
      type: "JOB_CREATED",
      actor: { type: "system", id: "proxy" },
      payload: {
        tenantId,
        customerId: body?.customerId ?? null,
        siteId: body?.siteId ?? null,
        contractId: body?.contractId ?? null,
        templateId,
        constraints: body?.constraints ?? {}
      },
      at: nowIso()
    });
    const events = appendChainedEvent({ events: [], event: createdEvent, signer: serverSigner });
    const jobWithHead = reduceJob(events);

    const ops = [{ kind: "JOB_EVENTS_APPENDED", tenantId, jobId, events }];
    if (idemStoreKey) {
      const responseBody = { job: jobWithHead };
      ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
    }

    const responseBody = { job: jobWithHead };
    await commitTx(ops);
    return sendJson(res, 201, responseBody);
    }

    if (parts[0] === "jobs" && parts[1]) {
    const jobId = parts[1];
    const needsFreshForExport =
      req.method === "GET" && (parts[2] === "audit" || parts[2] === "evidence") && store.kind === "pg" && typeof store.refreshFromDb === "function";
    if (needsFreshForExport) await store.refreshFromDb();

    const events = await getJobEventsFresh(tenantId, jobId, { force: req.method !== "GET" });
    const job = reduceJob(events);
    if (!job) return sendError(res, 404, "job not found");
    if (normalizeTenant(job.tenantId ?? DEFAULT_TENANT_ID) !== normalizeTenant(tenantId)) return sendError(res, 404, "job not found");

    if (req.method === "GET" && parts.length === 2) {
      return sendJson(res, 200, { job });
    }

    if (req.method === "GET" && parts[2] === "audit" && parts.length === 3) {
      if (!requireScope(auth.scopes, OPS_SCOPES.AUDIT_READ)) return sendError(res, 403, "forbidden");
      const audit = buildAuditExport({ job, events });
      return sendJson(res, 200, { audit });
    }

      if (req.method === "GET" && parts[2] === "evidence" && parts.length === 3) {
        if (!requireScope(auth.scopes, OPS_SCOPES.AUDIT_READ)) return sendError(res, 403, "forbidden");
        const evidenceExport = buildEvidenceExport({ job });

      const at = nowIso();
      const nowMs = Date.parse(at);
      const ttlMs = 5 * 60_000;
      const expiresAt = new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + ttlMs).toISOString();

      const evidence = Array.isArray(evidenceExport.evidence) ? evidenceExport.evidence : [];
      const withUrls = evidence.map((e) => {
        const evidenceId = e?.evidenceId ?? null;
        const evidenceRef = e?.evidenceRef ?? null;
        if (e?.expiredAt) return e;
        if (typeof evidenceId !== "string" || !evidenceId) return e;
        if (typeof evidenceRef !== "string" || !evidenceRef.startsWith("obj://")) return e;
        const downloadUrl = buildEvidenceDownloadUrl({
          tenantId,
          jobId,
          evidenceId,
          evidenceRef,
          expiresAt,
          secret: evidenceSigningSecret
        });
        return { ...e, downloadUrl, downloadExpiresAt: expiresAt };
      });

        return sendJson(res, 200, { evidence: { ...evidenceExport, evidence: withUrls } });
      }

      if (req.method === "GET" && parts[2] === "artifacts" && parts[3] === "effective" && parts.length === 4) {
        if (!(requireScope(auth.scopes, OPS_SCOPES.AUDIT_READ) || requireScope(auth.scopes, OPS_SCOPES.FINANCE_READ))) {
          return sendError(res, 403, "forbidden");
        }
        if (typeof store.listArtifacts !== "function") return sendError(res, 501, "artifacts not supported for this store");

        const artifactType = url.searchParams.get("type");
        if (!artifactType || String(artifactType).trim() === "") return sendError(res, 400, "type is required");
        let requestedAccessScope = null;
        try {
          requestedAccessScope = normalizeArtifactAccessScopeQuery(url);
        } catch (err) {
          return sendError(res, 400, "invalid artifact access scope query", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }

        const settledEventId = job?.settlement?.settledEventId ?? null;
        const artifactPolicyContextCache = new Map();
        if (typeof settledEventId === "string" && settledEventId.trim() !== "") {
          const artifacts = await store.listArtifacts({
            tenantId,
            jobId,
            artifactType: String(artifactType),
            sourceEventId: String(settledEventId),
            limit: 10,
            offset: 0
          });
          if (!artifacts.length) return sendError(res, 404, "effective artifact not found", { settledEventId });
          if (artifacts.length > 1) {
            return sendError(res, 500, "multiple settlement-backed artifacts found", { settledEventId, count: artifacts.length });
          }
          const artifactPolicy = await enforceArtifactReadPolicy({
            tenantId,
            artifact: artifacts[0],
            scopes: auth.scopes,
            contextCache: artifactPolicyContextCache,
            requestedAccessScope
          });
          if (!artifactPolicy?.ok) {
            return sendError(
              res,
              artifactPolicy?.statusCode ?? 403,
              artifactPolicy?.message ?? "artifact access denied",
              artifactPolicy?.details ?? null,
              { code: artifactPolicy?.code ?? "ARTIFACT_ACCESS_DENIED" }
            );
          }
          return sendJson(res, 200, {
            artifact: artifactPolicy.artifact,
            selection: { kind: "SETTLED_EVENT", sourceEventId: settledEventId }
          });
        }

        // Unsettled jobs: choose an anchor based on the current proof for the latest completion anchor.
        // NOTE: For WorkCertificate/SettlementStatement/ProofReceipt, artifacts are anchored to PROOF_EVALUATED.
        const completionTypes = new Set(["EXECUTION_COMPLETED", "JOB_EXECUTION_COMPLETED", "EXECUTION_ABORTED", "JOB_EXECUTION_ABORTED"]);
        const completion = [...events].reverse().find((e) => completionTypes.has(e?.type) && typeof e?.chainHash === "string" && e.chainHash.trim() !== "");
        const completionChainHash = completion?.chainHash ?? null;
        if (!completionChainHash) return sendError(res, 409, "job has no completion anchor yet");

        let proofEvent = null;
        let proofFreshness = "none";
        let expectedFactsHash = null;
        try {
          const anchorIdx = events.findIndex((e) => e?.chainHash === completionChainHash);
          const anchorSlice = anchorIdx === -1 ? null : events.slice(0, anchorIdx + 1);
          const jobAtAnchor = anchorSlice ? reduceJob(anchorSlice) : null;
          if (jobAtAnchor) {
            const current = verifyZoneCoverageProofV1({
              job: jobAtAnchor,
              events,
              evaluatedAtChainHash: completionChainHash,
              customerPolicyHash: jobAtAnchor.customerPolicyHash ?? jobAtAnchor.booking?.policyHash ?? null,
              operatorPolicyHash: jobAtAnchor.operatorPolicyHash ?? null
            });
            const factsHash = current?.factsHash ?? null;
            const customerPolicyHash = current?.anchors?.customerPolicyHash ?? (jobAtAnchor.customerPolicyHash ?? jobAtAnchor.booking?.policyHash ?? null);
            if (factsHash && customerPolicyHash) {
              proofEvent =
                [...events]
                  .reverse()
                  .find(
                    (e) =>
                      e?.type === "PROOF_EVALUATED" &&
                      e?.payload?.evaluatedAtChainHash === completionChainHash &&
                      e?.payload?.customerPolicyHash === customerPolicyHash &&
                      e?.payload?.factsHash === factsHash &&
                      typeof e?.id === "string" &&
                      e.id.trim() !== ""
                  ) ?? null;
              if (proofEvent) {
                proofFreshness = "fresh";
              } else {
                proofFreshness = "stale";
                expectedFactsHash = factsHash;
                proofEvent =
                  [...events]
                    .reverse()
                    .find(
                      (e) =>
                        e?.type === "PROOF_EVALUATED" &&
                        e?.payload?.evaluatedAtChainHash === completionChainHash &&
                        typeof e?.id === "string" &&
                        e.id.trim() !== ""
                    ) ?? null;
              }
            }
          }
        } catch {
          // ignore, fall back below
        }

        if (!proofEvent) {
          proofEvent = [...events].reverse().find((e) => e?.type === "PROOF_EVALUATED" && typeof e?.id === "string" && e.id.trim() !== "") ?? null;
        }
        if (!proofEvent?.id) return sendError(res, 409, "effective proof not available yet");

        const artifacts = await store.listArtifacts({
          tenantId,
          jobId,
          artifactType: String(artifactType),
          sourceEventId: String(proofEvent.id),
          limit: 10,
          offset: 0
        });
        if (!artifacts.length) {
          return sendError(res, 409, "effective artifact not available yet", { sourceEventId: proofEvent.id });
        }
        if (artifacts.length > 1) {
          return sendError(res, 500, "multiple artifacts found for effective source event", { sourceEventId: proofEvent.id, count: artifacts.length });
        }
          const artifactPolicy = await enforceArtifactReadPolicy({
            tenantId,
            artifact: artifacts[0],
            scopes: auth.scopes,
            contextCache: artifactPolicyContextCache,
            requestedAccessScope
          });
        if (!artifactPolicy?.ok) {
          return sendError(
            res,
            artifactPolicy?.statusCode ?? 403,
            artifactPolicy?.message ?? "artifact access denied",
            artifactPolicy?.details ?? null,
            { code: artifactPolicy?.code ?? "ARTIFACT_ACCESS_DENIED" }
          );
        }
        return sendJson(res, 200, {
          artifact: artifactPolicy.artifact,
          selection: {
            kind: "PROOF_EVENT",
            sourceEventId: proofEvent.id,
            proofFreshness,
            expectedFactsHash
          }
        });
      }

      if (req.method === "GET" && parts[2] === "artifacts" && parts.length === 3) {
        if (!(requireScope(auth.scopes, OPS_SCOPES.AUDIT_READ) || requireScope(auth.scopes, OPS_SCOPES.FINANCE_READ))) {
          return sendError(res, 403, "forbidden");
        }
        if (typeof store.listArtifacts !== "function") return sendError(res, 501, "artifacts not supported for this store");

        const type = url.searchParams.get("type");
        const sourceEventId = url.searchParams.get("sourceEventId");
        let requestedAccessScope = null;
        try {
          requestedAccessScope = normalizeArtifactAccessScopeQuery(url);
        } catch (err) {
          return sendError(res, 400, "invalid artifact access scope query", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }
        const cursor = url.searchParams.get("cursor");
        const limitRaw = url.searchParams.get("limit");
        const offsetRaw = url.searchParams.get("offset");
        const limit = limitRaw ? Number(limitRaw) : 200;
        const offset = offsetRaw ? Number(offsetRaw) : 0;

        if (cursor && String(cursor).trim() !== "" && offsetRaw && String(offsetRaw).trim() !== "") {
          return sendError(res, 400, "invalid artifacts query", { message: "cursor and offset cannot be used together" }, { code: "INVALID_PAGINATION" });
        }

        if (cursor && String(cursor).trim() !== "") {
          if (store.kind !== "pg") {
            return sendError(res, 501, "cursor pagination not supported for this store", null, { code: "CURSOR_PAGINATION_UNSUPPORTED" });
          }
          const CURSOR_VERSION = 1;
          const CURSOR_ORDER = "created_at_desc_artifact_id_desc";
          const isCursorTimestampV1 = (s) => {
            if (typeof s !== "string") return false;
            // RFC3339 UTC with microseconds: 2026-01-01T00:00:00.123456Z
            // (We require microseconds for v1 to preserve Postgres timestamptz precision.)
            return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(s);
          };
          const decodeCursor = (raw) => {
            try {
              const buf = Buffer.from(String(raw), "base64url");
              const parsed = JSON.parse(buf.toString("utf8"));
              const vRaw = parsed?.v ?? null;
              const v = vRaw === null || vRaw === undefined ? CURSOR_VERSION : Number(vRaw);
              if (!Number.isFinite(v) || !Number.isSafeInteger(v)) throw new Error("cursor.v must be an integer");
              if (v !== CURSOR_VERSION) throw new Error(`unsupported cursor version: ${v}`);

              const order = parsed?.order ?? null;
              if (order !== null && String(order) !== CURSOR_ORDER) throw new Error(`unsupported cursor order: ${String(order)}`);

              const createdAt = parsed?.createdAt ?? null;
              const artifactId = parsed?.artifactId ?? null;
              if (typeof createdAt !== "string" || !createdAt.trim()) throw new Error("cursor.createdAt is required");
              if (typeof artifactId !== "string" || !artifactId.trim()) throw new Error("cursor.artifactId is required");
              if (!isCursorTimestampV1(createdAt)) throw new Error("cursor.createdAt must be an RFC3339 UTC timestamp with microseconds");
              return { createdAt, artifactId };
            } catch (err) {
              const e = new Error(`invalid cursor: ${err?.message ?? "parse failed"}`);
              e.code = "INVALID_CURSOR";
              throw e;
            }
          };
          const encodeCursor = ({ createdAt, artifactId }) => {
            if (!isCursorTimestampV1(createdAt)) throw new Error("internal: createdAt must be RFC3339 UTC with microseconds");
            const body = JSON.stringify({ v: CURSOR_VERSION, order: CURSOR_ORDER, createdAt, artifactId });
            return Buffer.from(body, "utf8").toString("base64url");
          };

          let cur;
          try {
            cur = decodeCursor(cursor);
          } catch (err) {
            return sendError(res, 400, "invalid artifacts query", { message: err?.message }, { code: err?.code ?? "INVALID_CURSOR" });
          }

          const pageSize = Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.floor(limit))) : 200;
          let rows;
          try {
            rows = await store.listArtifacts({
              tenantId,
              jobId,
              artifactType: type && String(type).trim() !== "" ? String(type) : null,
              sourceEventId: sourceEventId && String(sourceEventId).trim() !== "" ? String(sourceEventId) : null,
              sessionId: requestedAccessScope?.sessionId ?? null,
              taskId: requestedAccessScope?.taskId ?? null,
              projectId: requestedAccessScope?.projectId ?? null,
              beforeCreatedAt: cur.createdAt,
              beforeArtifactId: cur.artifactId,
              includeDbMeta: true,
              limit: pageSize + 1,
              offset: 0
            });
          } catch (err) {
            return sendError(res, 400, "invalid artifacts query", { message: err?.message });
          }

            const hasMore = rows.length > pageSize;
            const page = rows.slice(0, pageSize);
            const artifactsRaw = page.map((r) => r?.artifact ?? null).filter(Boolean);
            const artifactPolicyContextCache = new Map();
            const artifacts = [];
            for (const artifact of artifactsRaw) {
              // eslint-disable-next-line no-await-in-loop
              const artifactPolicy = await enforceArtifactReadPolicy({
                tenantId,
                artifact,
                scopes: auth.scopes,
                contextCache: artifactPolicyContextCache,
                requestedAccessScope
              });
              if (!artifactPolicy?.ok) {
                return sendError(
                  res,
                  artifactPolicy?.statusCode ?? 403,
                  artifactPolicy?.message ?? "artifact access denied",
                  artifactPolicy?.details ?? null,
                  { code: artifactPolicy?.code ?? "ARTIFACT_ACCESS_DENIED" }
                );
              }
              artifacts.push(artifactPolicy.artifact);
            }
            const last = page.length ? page[page.length - 1] : null;
            const nextCursor = hasMore && last?.db?.createdAt && last?.db?.artifactId ? encodeCursor(last.db) : null;
            return sendJson(res, 200, { artifacts, nextCursor, hasMore, limit: pageSize });
          }

        let artifacts;
        try {
          artifacts = await store.listArtifacts({
            tenantId,
            jobId,
            artifactType: type && String(type).trim() !== "" ? String(type) : null,
            sourceEventId: sourceEventId && String(sourceEventId).trim() !== "" ? String(sourceEventId) : null,
            sessionId: requestedAccessScope?.sessionId ?? null,
            taskId: requestedAccessScope?.taskId ?? null,
            projectId: requestedAccessScope?.projectId ?? null,
            limit,
            offset
          });
          } catch (err) {
            return sendError(res, 400, "invalid artifacts query", { message: err?.message });
          }
          const artifactPolicyContextCache = new Map();
          const visibleArtifacts = [];
          for (const artifact of artifacts) {
            // eslint-disable-next-line no-await-in-loop
            const artifactPolicy = await enforceArtifactReadPolicy({
              tenantId,
              artifact,
              scopes: auth.scopes,
              contextCache: artifactPolicyContextCache,
              requestedAccessScope
            });
            if (!artifactPolicy?.ok) {
              return sendError(
                res,
                artifactPolicy?.statusCode ?? 403,
                artifactPolicy?.message ?? "artifact access denied",
                artifactPolicy?.details ?? null,
                { code: artifactPolicy?.code ?? "ARTIFACT_ACCESS_DENIED" }
              );
            }
            visibleArtifacts.push(artifactPolicy.artifact);
          }
          return sendJson(res, 200, { artifacts: visibleArtifacts });
        }

    const getWindowZoneId = (windowZoneId) => normalizeZoneId(windowZoneId ?? job.booking?.zoneId ?? job.constraints?.zoneId);

    if (req.method === "POST" && parts[2] === "quote" && parts.length === 3) {
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
        if (idemStoreKey) {
          const existingIdem = store.idempotency.get(idemStoreKey);
          if (existingIdem) {
            if (existingIdem.requestHash !== idemRequestHash) {
              return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
            }
            return sendJson(res, existingIdem.statusCode, existingIdem.body);
          }
        }

      if (job.status !== "CREATED") return sendError(res, 400, "job is not quoteable");

      const quoteCustomerId = body?.customerId ?? job.customerId ?? null;
      const quoteSiteId = body?.siteId ?? job.siteId ?? null;
      const quoteContractId = body?.contractId ?? job.contractId ?? null;

      const quoteInput = {
        startAt: body?.startAt,
        endAt: body?.endAt,
        environmentTier: body?.environmentTier,
        requiresOperatorCoverage: body?.requiresOperatorCoverage,
        customerId: quoteCustomerId,
        siteId: quoteSiteId,
        contractId: quoteContractId
      };
      try {
        validateBookingWindowInput(quoteInput);
      } catch (err) {
        return sendError(res, 400, "invalid quote input", { message: err?.message });
      }

      const zoneId = getWindowZoneId(quoteInput.zoneId);
      const window = { startAt: quoteInput.startAt, endAt: quoteInput.endAt };

      const activeOperators = listAvailableOperators({ tenantId, zoneId, window, ignoreJobId: jobId }).length;
      const requiresOperatorCoverage =
        quoteInput.requiresOperatorCoverage === true || quoteInput.environmentTier === ENV_TIER.ENV_IN_HOME;
      if (requiresOperatorCoverage && activeOperators <= 0) {
        return sendError(res, 409, "insufficient operator coverage");
      }

      const availableRobotList = listAvailableRobots({ tenantId, zoneId, window, ignoreJobId: jobId });
      const availableRobots = availableRobotList.length;
      if (availableRobots <= 0) return sendError(res, 409, "no available robots for window");
      let avgAvailableRobotTrustScoreBps = 0;
      if (availableRobots > 0) {
        let sum = 0;
        for (const r of availableRobotList) {
          const score = typeof r?.trustScore === "number" && Number.isFinite(r.trustScore) ? r.trustScore : 0;
          sum += Math.max(0, Math.min(1, score));
        }
        avgAvailableRobotTrustScoreBps = Math.max(0, Math.min(10_000, Math.round((sum / availableRobots) * 10_000)));
      }

      const contracts = listContracts({ tenantId });
      let contract = null;
      if (quoteContractId) {
        contract = contracts.find((c) => c?.contractId === quoteContractId) ?? null;
        if (!contract) return sendError(res, 400, "unknown contractId");
      } else {
        contract = selectBestContract(contracts, { customerId: quoteCustomerId, siteId: quoteSiteId, templateId: job.templateId });
      }
      if (!contract) contract = createDefaultContract({ tenantId, nowIso });

      const contractVersion =
        Number.isSafeInteger(contract?.contractVersion) && contract.contractVersion > 0 ? contract.contractVersion : 1;

      const baseSla = computeSlaPolicy({ environmentTier: quoteInput.environmentTier });
      const sla = applyContractSlaOverrides({ sla: baseSla, environmentTier: quoteInput.environmentTier, contract });
      const creditPolicy =
        contract.policies?.creditPolicy ?? { enabled: false, defaultAmountCents: 0, maxAmountCents: 0, currency: "USD" };

      const coveragePolicy = contract.policies?.coveragePolicy ?? null;
      const coverageRequired = coveragePolicy?.required === true;
      const coverageFeeModel = coveragePolicy?.feeModel ?? COVERAGE_FEE_MODEL.PER_JOB;
      const coverageFeeCentsPerJob =
        Number.isSafeInteger(coveragePolicy?.feeCentsPerJob) && coveragePolicy.feeCentsPerJob > 0 ? coveragePolicy.feeCentsPerJob : 0;
      const coverageFeeCents =
        coverageRequired && coverageFeeCentsPerJob > 0
          ? coverageFeeModel === COVERAGE_FEE_MODEL.PER_JOB
            ? coverageFeeCentsPerJob
            : 0
          : 0;

      const quote = computeQuote({
        templateId: job.templateId,
        currency: "USD",
        environmentTier: quoteInput.environmentTier,
        requiresOperatorCoverage,
        coverageFeeCents,
        availableRobots,
        activeOperators
      });
      const payload = {
        ...quote,
        sla,
        inputs: {
          ...quoteInput,
          requiresOperatorCoverage,
          zoneId,
          customerId: quoteCustomerId,
          siteId: quoteSiteId,
          contractId: contract.contractId,
          contractVersion
        }
      };
      const existing = await getJobEventsFresh(tenantId, jobId);
      const currentPrevChainHash = getCurrentPrevChainHash(existing);
      if (expectedHeader.expectedPrevChainHash !== currentPrevChainHash) {
        return sendError(res, 409, "event append conflict", {
          expectedPrevChainHash: currentPrevChainHash,
          gotExpectedPrevChainHash: expectedHeader.expectedPrevChainHash
        });
      }

      const draft = createChainedEvent({
        streamId: jobId,
        type: "QUOTE_PROPOSED",
        actor: { type: "pricing", id: "pricing_v0" },
        payload,
        at: nowIso()
      });
      const eventsAfterQuote = appendChainedEvent({ events: existing, event: draft, signer: serverSigner });
      const event = eventsAfterQuote[eventsAfterQuote.length - 1];

      let jobAfterQuote;
      try {
        jobAfterQuote = reduceJob(eventsAfterQuote);
      } catch (err) {
        return sendError(res, 400, "job transition rejected", { message: err?.message });
      }

      let riskEvent = null;
      let nextEvents = eventsAfterQuote;
      let jobAfter = jobAfterQuote;
      try {
        const scoredAt = nowIso();
        const assessment = computeRiskAssessment({
          basis: RISK_BASIS.QUOTE,
          templateId: job.templateId,
          environmentTier: quoteInput.environmentTier,
          requiresOperatorCoverage,
          zoneId,
          siteId: quoteSiteId,
          customerId: quoteCustomerId,
          availableRobots,
          activeOperators,
          avgAvailableRobotTrustScoreBps,
          creditPolicy,
          policyHash: null,
          jobs: listJobs({ tenantId }),
          getEventsForJob: (id) => getJobEvents(tenantId, id),
          nowIso
        });
        const riskPayload = {
          jobId,
          basis: RISK_BASIS.QUOTE,
          scoredAt,
          sourceEventId: event.id,
          ...assessment
        };
        const riskDraft = createChainedEvent({
          streamId: jobId,
          type: "RISK_SCORED",
          actor: { type: "risk", id: "risk_v1" },
          payload: riskPayload,
          at: scoredAt
        });
        nextEvents = appendChainedEvent({ events: eventsAfterQuote, event: riskDraft, signer: serverSigner });
        riskEvent = nextEvents[nextEvents.length - 1];
        validateDomainEvent({ jobBefore: jobAfterQuote, event: riskEvent, eventsBefore: eventsAfterQuote });
        jobAfter = reduceJob(nextEvents);
      } catch {
        // Best-effort: risk scoring should not block quoting.
        riskEvent = null;
        nextEvents = eventsAfterQuote;
        jobAfter = jobAfterQuote;
      }

      let ledgerEntries = [];
      try {
        ledgerEntries = ledgerEntriesForJobEvent({ jobBefore: job, event, eventsBefore: existing });
      } catch (err) {
        return sendError(res, 400, "ledger posting rejected", { message: err?.message });
      }

      const responseBody = {
        event,
        job: jobAfter,
        ledgerEntryId: ledgerEntries.length ? ledgerEntries[0]?.id ?? null : null,
        ledgerEntryIds: ledgerEntries.map((e) => e?.id).filter(Boolean)
      };

      const outboxMessages = [];
      for (const entry of ledgerEntries) {
        if (!entry) continue;
        outboxMessages.push({ type: "LEDGER_ENTRY_APPLY", tenantId, jobId, sourceEventId: event.id, entry });
      }
      if (job.status !== jobAfter.status) {
        outboxMessages.push({ type: "JOB_STATUS_CHANGED", tenantId, jobId, fromStatus: job.status, toStatus: jobAfter.status, at: event.at });
      }

      const appended = riskEvent ? [event, riskEvent] : [event];
      const ops = [{ kind: "JOB_EVENTS_APPENDED", tenantId, jobId, events: appended }];
      if (idemStoreKey) ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
      if (outboxMessages.length) ops.push({ kind: "OUTBOX_ENQUEUE", messages: outboxMessages });
      await commitTx(ops);
      return sendJson(res, 201, responseBody);
    }

    if (req.method === "POST" && parts[2] === "book" && parts.length === 3) {
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
        if (idemStoreKey) {
          const existingIdem = store.idempotency.get(idemStoreKey);
          if (existingIdem) {
            if (existingIdem.requestHash !== idemRequestHash) {
              return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
            }
            return sendJson(res, existingIdem.statusCode, existingIdem.body);
          }
        }

      if (job.status !== "QUOTED") return sendError(res, 400, "job is not bookable");

      const bookingCustomerId = body?.customerId ?? job.customerId ?? null;
      const bookingSiteId = body?.siteId ?? job.siteId ?? null;
      const bookingContractId = body?.contractId ?? job.contractId ?? null;

      const contracts = listContracts({ tenantId });
      let contract = null;
      if (bookingContractId) {
        contract = contracts.find((c) => c?.contractId === bookingContractId) ?? null;
        if (!contract) return sendError(res, 400, "unknown contractId");
      } else {
        contract = selectBestContract(contracts, { customerId: bookingCustomerId, siteId: bookingSiteId, templateId: job.templateId });
      }
      if (!contract) contract = createDefaultContract({ tenantId, nowIso });

      const bookingInput = {
        paymentHoldId: body?.paymentHoldId,
        startAt: body?.startAt,
        endAt: body?.endAt,
        environmentTier: body?.environmentTier,
        requiresOperatorCoverage: body?.requiresOperatorCoverage,
        zoneId: body?.zoneId,
        customerId: bookingCustomerId,
        siteId: bookingSiteId,
        contractId: contract.contractId
      };
      try {
        validateBookingWindowInput(bookingInput);
      } catch (err) {
        return sendError(res, 400, "invalid booking", { message: err?.message });
      }

      const derivedRequiresOperatorCoverage =
        bookingInput.requiresOperatorCoverage === true || bookingInput.environmentTier === ENV_TIER.ENV_IN_HOME;

      const quotedInputs = job.quote?.inputs ?? null;
      const zoneId = normalizeZoneId(bookingInput.zoneId ?? quotedInputs?.zoneId ?? job.constraints?.zoneId);
      if (quotedInputs) {
        if (quotedInputs.startAt !== bookingInput.startAt || quotedInputs.endAt !== bookingInput.endAt) {
          return sendError(res, 409, "booking window differs from quoted window");
        }
        if (quotedInputs.environmentTier && quotedInputs.environmentTier !== bookingInput.environmentTier) {
          return sendError(res, 409, "booking environment tier differs from quoted tier");
        }
        if (
          typeof quotedInputs.requiresOperatorCoverage === "boolean" &&
          quotedInputs.requiresOperatorCoverage !== derivedRequiresOperatorCoverage
        ) {
          return sendError(res, 409, "booking operator coverage differs from quoted coverage");
        }
        if (quotedInputs.zoneId && normalizeZoneId(quotedInputs.zoneId) !== zoneId) {
          return sendError(res, 409, "booking zone differs from quoted zone");
        }
        if (quotedInputs.customerId !== undefined && quotedInputs.customerId !== bookingCustomerId) {
          return sendError(res, 409, "booking customer differs from quoted customer");
        }
        if (quotedInputs.siteId !== undefined && quotedInputs.siteId !== bookingSiteId) {
          return sendError(res, 409, "booking site differs from quoted site");
        }
        if (quotedInputs.contractId !== undefined && quotedInputs.contractId !== contract.contractId) {
          return sendError(res, 409, "booking contract differs from quoted contract");
        }
      }

      const contractVersion =
        Number.isSafeInteger(contract?.contractVersion) && contract.contractVersion > 0 ? contract.contractVersion : 1;
      if (quotedInputs && quotedInputs.contractVersion !== undefined && quotedInputs.contractVersion !== contractVersion) {
        return sendError(res, 409, "booking contract version differs from quoted contract version");
      }

      const baseSla = computeSlaPolicy({ environmentTier: bookingInput.environmentTier });
      const sla = applyContractSlaOverrides({ sla: baseSla, environmentTier: bookingInput.environmentTier, contract });
      const window = { startAt: bookingInput.startAt, endAt: bookingInput.endAt };

      const activeOperatorsList = listAvailableOperators({ tenantId, zoneId, window, ignoreJobId: jobId });
      const activeOperators = activeOperatorsList.length;
      if (derivedRequiresOperatorCoverage && activeOperators <= 0) {
        return sendError(res, 409, "insufficient operator coverage");
      }

      const availableRobotList = listAvailableRobots({ tenantId, zoneId, window, ignoreJobId: jobId });
      const availableRobots = availableRobotList.length;
      if (availableRobots <= 0) return sendError(res, 409, "no available robots for window");
      let avgAvailableRobotTrustScoreBps = 0;
      if (availableRobots > 0) {
        let sum = 0;
        for (const r of availableRobotList) {
          const score = typeof r?.trustScore === "number" && Number.isFinite(r.trustScore) ? r.trustScore : 0;
          sum += Math.max(0, Math.min(1, score));
        }
        avgAvailableRobotTrustScoreBps = Math.max(0, Math.min(10_000, Math.round((sum / availableRobots) * 10_000)));
      }

      const creditPolicy =
        contract.policies?.creditPolicy ?? { enabled: false, defaultAmountCents: 0, maxAmountCents: 0, currency: "USD" };
      const evidencePolicy = contract.policies?.evidencePolicy ?? { retentionDays: 0 };
      const claimPolicy = contract.policies?.claimPolicy ?? { currency: "USD", autoApproveThresholdCents: 0, maxPayoutCents: 0, reservePercent: 0 };
      const coveragePolicy =
        contract.policies?.coveragePolicy ?? {
          required: false,
          coverageTierId: null,
          feeModel: COVERAGE_FEE_MODEL.PER_JOB,
          feeCentsPerJob: 0,
          creditFundingModel: CREDIT_FUNDING_MODEL.PLATFORM_EXPENSE,
          reserveFundPercent: 100,
          insurerId: null,
          recoverablePercent: 100,
          recoverableTerms: null,
          responseSlaSeconds: 0,
          includedAssistSeconds: 0,
          overageRateCentsPerMinute: 0
        };

      const contractDoc = contractDocumentV1FromLegacyContract({ ...contract, contractVersion });
      const customerContractHash = hashContractDocumentV1(contractDoc);
      const { policySnapshot, policyHash, compilerId } = compileBookingPolicySnapshot({
        contractDoc,
        environmentTier: bookingInput.environmentTier,
        requiresOperatorCoverage: derivedRequiresOperatorCoverage,
        sla,
        creditPolicy,
        evidencePolicy,
        claimPolicy,
        coveragePolicy
      });

      const requiredZonesInput = body?.requiredZones ?? null;
      const requiredZones =
        requiredZonesInput && typeof requiredZonesInput === "object"
          ? requiredZonesInput
          : {
              schemaVersion: "ZoneSet.v1",
              zoneSetId: `zones_${jobId}`,
              zones: [{ zoneId: String(zoneId), label: String(zoneId) }]
            };
      let requiredZonesHash;
      try {
        validateZoneSetV1(requiredZones);
        requiredZonesHash = computeZoneSetHash(requiredZones);
      } catch (err) {
        return sendError(res, 400, "invalid requiredZones", { message: err?.message });
      }

      const bookingPayload = {
        paymentHoldId: bookingInput.paymentHoldId,
        startAt: bookingInput.startAt,
        endAt: bookingInput.endAt,
        environmentTier: bookingInput.environmentTier,
        requiresOperatorCoverage: derivedRequiresOperatorCoverage,
        zoneId,
        requiredZones,
        requiredZonesHash,
        sla,
        customerId: bookingCustomerId,
        siteId: bookingSiteId,
        contractId: contract.contractId,
        contractVersion,
        customerContractHash,
        customerCompilerId: compilerId,
        creditPolicy,
        evidencePolicy,
        policySnapshot,
        policyHash
      };
      try {
        validateBookedPayload(bookingPayload);
      } catch (err) {
        return sendError(res, 400, "invalid booking", { message: err?.message });
      }

      const existing = await getJobEventsFresh(tenantId, jobId);
      const currentPrevChainHash = getCurrentPrevChainHash(existing);
      if (expectedHeader.expectedPrevChainHash !== currentPrevChainHash) {
        return sendError(res, 409, "event append conflict", {
          expectedPrevChainHash: currentPrevChainHash,
          gotExpectedPrevChainHash: expectedHeader.expectedPrevChainHash
        });
      }

      const draft = createChainedEvent({
        streamId: jobId,
        type: "BOOKED",
        actor: { type: "requester", id: body?.requesterId ?? "requester_demo" },
        payload: bookingPayload,
        at: nowIso()
      });
      const eventsAfterBook = appendChainedEvent({ events: existing, event: draft, signer: serverSigner });
      const bookedEvent = eventsAfterBook[eventsAfterBook.length - 1];

      try {
        validateDomainEvent({ jobBefore: job, event: bookedEvent, eventsBefore: existing });
      } catch (err) {
        return sendError(res, 400, "event rejected", { message: err?.message });
      }

      let jobAfterBook;
      try {
        jobAfterBook = reduceJob(eventsAfterBook);
      } catch (err) {
        return sendError(res, 400, "job transition rejected", { message: err?.message });
      }

      // Risk scoring is best-effort and should not block booking.
      let riskEvent = null;
      let eventsBeforeDispatch = eventsAfterBook;
      let jobBeforeDispatch = jobAfterBook;
      try {
        const scoredAt = bookedEvent.at;
        const assessment = computeRiskAssessment({
          basis: RISK_BASIS.BOOK,
          templateId: job.templateId,
          environmentTier: bookingInput.environmentTier,
          requiresOperatorCoverage: derivedRequiresOperatorCoverage,
          zoneId,
          siteId: bookingSiteId,
          customerId: bookingCustomerId,
          availableRobots,
          activeOperators,
          avgAvailableRobotTrustScoreBps,
          creditPolicy,
          policyHash,
          jobs: listJobs({ tenantId }),
          getEventsForJob: (id) => getJobEvents(tenantId, id),
          nowIso
        });
        const riskPayload = {
          jobId,
          basis: RISK_BASIS.BOOK,
          scoredAt,
          sourceEventId: bookedEvent.id,
          ...assessment
        };
        const riskDraft = createChainedEvent({
          streamId: jobId,
          type: "RISK_SCORED",
          actor: { type: "risk", id: "risk_v1" },
          payload: riskPayload,
          at: scoredAt
        });
        const eventsAfterRisk = appendChainedEvent({ events: eventsAfterBook, event: riskDraft, signer: serverSigner });
        riskEvent = eventsAfterRisk[eventsAfterRisk.length - 1];
        validateDomainEvent({ jobBefore: jobAfterBook, event: riskEvent, eventsBefore: eventsAfterBook });
        jobBeforeDispatch = reduceJob(eventsAfterRisk);
        eventsBeforeDispatch = eventsAfterRisk;
      } catch {
        riskEvent = null;
        eventsBeforeDispatch = eventsAfterBook;
        jobBeforeDispatch = jobAfterBook;
      }

      const requestedAt = nowIso();
      const dispatchRequestDraft = createChainedEvent({
        streamId: jobId,
        type: "DISPATCH_REQUESTED",
        actor: { type: "dispatch", id: "dispatch_v1" },
        payload: { jobId, requestedAt, trigger: "BOOKED" },
        at: requestedAt
      });
      const nextEvents = appendChainedEvent({ events: eventsBeforeDispatch, event: dispatchRequestDraft, signer: serverSigner });
      const dispatchRequestedEvent = nextEvents[nextEvents.length - 1];

      try {
        validateDomainEvent({ jobBefore: jobBeforeDispatch, event: dispatchRequestedEvent, eventsBefore: eventsBeforeDispatch });
      } catch (err) {
        return sendError(res, 400, "event rejected", { message: err?.message });
      }

      let jobAfter;
      try {
        jobAfter = reduceJob(nextEvents);
      } catch (err) {
        return sendError(res, 400, "job transition rejected", { message: err?.message });
      }

      let ledgerEntries = [];
      try {
        ledgerEntries = ledgerEntriesForJobEvent({ jobBefore: job, event: bookedEvent, eventsBefore: existing });
      } catch (err) {
        return sendError(res, 400, "ledger posting rejected", { message: err?.message });
      }

      const responseBody = {
        event: bookedEvent,
        job: jobAfter,
        ledgerEntryId: ledgerEntries.length ? ledgerEntries[0]?.id ?? null : null,
        ledgerEntryIds: ledgerEntries.map((e) => e?.id).filter(Boolean),
        dispatchRequestedEventId: dispatchRequestedEvent.id
      };

      const outboxMessages = [];
      for (const entry of ledgerEntries) {
        if (!entry) continue;
        outboxMessages.push({ type: "LEDGER_ENTRY_APPLY", tenantId, jobId, sourceEventId: bookedEvent.id, entry });
      }
      if (job.status !== jobAfter.status) {
        outboxMessages.push({ type: "JOB_STATUS_CHANGED", tenantId, jobId, fromStatus: job.status, toStatus: jobAfter.status, at: bookedEvent.at });
      }
      outboxMessages.push({ type: "DISPATCH_REQUESTED", tenantId, jobId, sourceEventId: dispatchRequestedEvent.id, at: dispatchRequestedEvent.at });

      const appended = riskEvent ? [bookedEvent, riskEvent, dispatchRequestedEvent] : [bookedEvent, dispatchRequestedEvent];
      const ops = [{ kind: "JOB_EVENTS_APPENDED", tenantId, jobId, events: appended }];
      if (idemStoreKey) ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
      if (outboxMessages.length) ops.push({ kind: "OUTBOX_ENQUEUE", messages: outboxMessages });
      await commitTx(ops);
      return sendJson(res, 201, responseBody);
    }

    if (req.method === "POST" && parts[2] === "dispatch" && parts.length === 3) {
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
        if (idemStoreKey) {
          const existingIdem = store.idempotency.get(idemStoreKey);
          if (existingIdem) {
            if (existingIdem.requestHash !== idemRequestHash) {
              return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
            }
            return sendJson(res, existingIdem.statusCode, existingIdem.body);
          }
        }

      if (job.status !== "BOOKED") return sendError(res, 400, "job is not dispatchable");
      if (!job.booking?.startAt || !job.booking?.endAt) return sendError(res, 400, "job booking window is missing");

      const requiresOperatorCoverage =
        job.booking.requiresOperatorCoverage === true || job.booking.environmentTier === ENV_TIER.ENV_IN_HOME;

      const window = { startAt: job.booking.startAt, endAt: job.booking.endAt };
      const zoneId = getJobZoneId(job);

      const availableOperators = listAvailableOperators({ tenantId, zoneId, window, ignoreJobId: jobId });
      if (requiresOperatorCoverage && availableOperators.length <= 0) {
        return sendError(res, 409, "insufficient operator coverage");
      }

      const robotsInZone = listAvailableRobots({ tenantId, zoneId, window, ignoreJobId: jobId });
      const { selected, candidates } = selectRobotForJob({
        robots: robotsInZone,
        window,
        reservations: (robotId, win) => robotHasOverlappingReservation({ tenantId, robotId, window: win, ignoreJobId: jobId }),
        minTrustScore: 0
      });
      if (!selected) return sendError(res, 409, "no available robots for window");

      const existing = getJobEvents(tenantId, jobId);
      const currentPrevChainHash = getCurrentPrevChainHash(existing);
      if (expectedHeader.expectedPrevChainHash !== currentPrevChainHash) {
        return sendError(res, 409, "event append conflict", {
          expectedPrevChainHash: currentPrevChainHash,
          gotExpectedPrevChainHash: expectedHeader.expectedPrevChainHash
        });
      }

      const evaluatedAt = nowIso();
      const evalPayload = {
        jobId,
        evaluatedAt,
        window,
        zoneId,
        requiresOperatorCoverage,
        candidates: candidates.map((c) => ({ robotId: c.robotId, score: c.score, reasons: ["candidate"], rejected: false })).slice(0, 10),
        selected: { robotId: selected.robotId, operatorId: requiresOperatorCoverage ? availableOperators[0].id : null }
      };
      const evalDraft = createChainedEvent({
        streamId: jobId,
        type: "DISPATCH_EVALUATED",
        actor: { type: "dispatch", id: "dispatch_v1" },
        payload: evalPayload,
        at: evaluatedAt
      });
      const eventsAfterEval = appendChainedEvent({ events: existing, event: evalDraft, signer: serverSigner });
      const evalEvent = eventsAfterEval[eventsAfterEval.length - 1];

      try {
        validateDomainEvent({ jobBefore: job, event: evalEvent, eventsBefore: existing });
      } catch (err) {
        return sendError(res, 400, "event rejected", { message: err?.message });
      }

      let jobAfterEval;
      try {
        jobAfterEval = reduceJob(eventsAfterEval);
      } catch (err) {
        return sendError(res, 400, "job transition rejected", { message: err?.message });
      }

        const matchDraft = createChainedEvent({
          streamId: jobId,
          type: "MATCHED",
          actor: { type: "dispatch", id: "dispatch_v1" },
          payload: {
            robotId: selected.robotId,
            score: selected.score,
            algorithm: "trustScore_v2",
            operatorContractHash: job.booking?.customerContractHash ?? null,
            operatorPolicyHash: job.booking?.policyHash ?? null,
            operatorCompilerId: job.booking?.customerCompilerId ?? null
          },
          at: nowIso()
        });
      const eventsAfterMatch = appendChainedEvent({ events: eventsAfterEval, event: matchDraft, signer: serverSigner });
      const matchEvent = eventsAfterMatch[eventsAfterMatch.length - 1];

      try {
        validateDomainEvent({ jobBefore: jobAfterEval, event: matchEvent, eventsBefore: eventsAfterEval });
      } catch (err) {
        return sendError(res, 400, "event rejected", { message: err?.message });
      }

      let jobAfterMatch;
      try {
        jobAfterMatch = reduceJob(eventsAfterMatch);
      } catch (err) {
        return sendError(res, 400, "job transition rejected", { message: err?.message });
      }

      const reservationPayload = {
        robotId: selected.robotId,
        startAt: window.startAt,
        endAt: window.endAt,
        reservationId: createId("rsv"),
        reservedUntil: window.startAt
      };
      const reserveDraft = createChainedEvent({
        streamId: jobId,
        type: "RESERVED",
        actor: { type: "dispatch", id: "dispatch_v1" },
        payload: reservationPayload,
        at: nowIso()
      });
      const nextEvents = appendChainedEvent({ events: eventsAfterMatch, event: reserveDraft, signer: serverSigner });
      const reservedEvent = nextEvents[nextEvents.length - 1];

      try {
        validateDomainEvent({ jobBefore: jobAfterMatch, event: reservedEvent, eventsBefore: eventsAfterMatch });
      } catch (err) {
        return sendError(res, 400, "event rejected", { message: err?.message });
      }

      let jobAfter;
      try {
        jobAfter = reduceJob(nextEvents);
      } catch (err) {
        return sendError(res, 400, "job transition rejected", { message: err?.message });
      }

      let eventsFinal = nextEvents;
      const appendedEvents = [evalEvent, matchEvent, reservedEvent];

      if (requiresOperatorCoverage) {
        const operatorId = availableOperators[0].id;
        const coveragePayload = {
          jobId,
          operatorId,
          startAt: window.startAt,
          endAt: window.endAt,
          reservationId: createId("opcov"),
          zoneId
        };
        const coverageDraft = createChainedEvent({
          streamId: jobId,
          type: "OPERATOR_COVERAGE_RESERVED",
          actor: { type: "dispatch", id: "dispatch_v1" },
          payload: coveragePayload,
          at: nowIso()
        });
        eventsFinal = appendChainedEvent({ events: eventsFinal, event: coverageDraft, signer: serverSigner });
        const coverageEvent = eventsFinal[eventsFinal.length - 1];

        try {
          validateDomainEvent({ jobBefore: jobAfter, event: coverageEvent, eventsBefore: nextEvents });
        } catch (err) {
          return sendError(res, 400, "event rejected", { message: err?.message });
        }

        appendedEvents.push(coverageEvent);
        jobAfter = reduceJob(eventsFinal);
      }

      const confirmedAt = nowIso();
      const confirmDraft = createChainedEvent({
        streamId: jobId,
        type: "DISPATCH_CONFIRMED",
        actor: { type: "dispatch", id: "dispatch_v1" },
        payload: { jobId, confirmedAt },
        at: confirmedAt
      });
      eventsFinal = appendChainedEvent({ events: eventsFinal, event: confirmDraft, signer: serverSigner });
      const confirmEvent = eventsFinal[eventsFinal.length - 1];
      try {
        validateDomainEvent({ jobBefore: jobAfter, event: confirmEvent, eventsBefore: eventsFinal.slice(0, -1) });
      } catch (err) {
        return sendError(res, 400, "event rejected", { message: err?.message });
      }
      appendedEvents.push(confirmEvent);
      jobAfter = reduceJob(eventsFinal);

      const responseBody = { events: appendedEvents, job: jobAfter };
      const outboxMessages = [];
      if (job.status !== jobAfter.status) {
        outboxMessages.push({ type: "JOB_STATUS_CHANGED", tenantId, jobId, fromStatus: job.status, toStatus: jobAfter.status, at: confirmedAt });
      }

      const ops = [{ kind: "JOB_EVENTS_APPENDED", tenantId, jobId, events: appendedEvents }];
      if (idemStoreKey) ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
      if (outboxMessages.length) ops.push({ kind: "OUTBOX_ENQUEUE", messages: outboxMessages });
      await commitTx(ops);

      return sendJson(res, 201, responseBody);
    }

      if (req.method === "POST" && parts[2] === "reschedule" && parts.length === 3) {
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
        if (idemStoreKey) {
          const existingIdem = store.idempotency.get(idemStoreKey);
          if (existingIdem) {
            if (existingIdem.requestHash !== idemRequestHash) {
              return sendError(res, 409, "idempotency key conflict", "request differs from initial use of this key");
            }
            return sendJson(res, existingIdem.statusCode, existingIdem.body);
          }
        }

      if (job.status !== "BOOKED" && job.status !== "MATCHED" && job.status !== "RESERVED") {
        return sendError(res, 400, "job is not reschedulable");
      }

      const booking = job.booking;
      if (!booking) return sendError(res, 400, "job is missing booking");

      const reschedulePayload = {
        jobId,
        oldWindow: { startAt: booking.startAt, endAt: booking.endAt },
        newWindow: { startAt: body?.startAt, endAt: body?.endAt },
        reason: body?.reason ?? "CUSTOMER_REQUEST",
        requestedBy: body?.requestedBy ?? "customer",
        requiresRequote: false
      };
      try {
        validateJobRescheduledPayload(reschedulePayload);
      } catch (err) {
        return sendError(res, 400, "invalid reschedule", { message: err?.message });
      }

      const newWindow = reschedulePayload.newWindow;

      const zoneId = getJobZoneId(job);
      const requiresOperatorCoverage = booking.requiresOperatorCoverage === true;
      const availableOperators = requiresOperatorCoverage ? listAvailableOperators({ tenantId, zoneId, window: newWindow, ignoreJobId: jobId }) : [];
      if (requiresOperatorCoverage && availableOperators.length <= 0) {
        return sendError(res, 409, "insufficient operator coverage");
      }

      const robotsInZone = listAvailableRobots({ tenantId, zoneId, window: newWindow, ignoreJobId: jobId });
      if (robotsInZone.length <= 0) return sendError(res, 409, "no available robots for window");

      const existing = getJobEvents(tenantId, jobId);
      const currentPrevChainHash = getCurrentPrevChainHash(existing);
      if (expectedHeader.expectedPrevChainHash !== currentPrevChainHash) {
        return sendError(res, 409, "event append conflict", {
          expectedPrevChainHash: currentPrevChainHash,
          gotExpectedPrevChainHash: expectedHeader.expectedPrevChainHash
        });
      }

      const rescheduleDraft = createChainedEvent({
        streamId: jobId,
        type: "JOB_RESCHEDULED",
        at: nowIso(),
        actor: { type: "scheduler", id: "scheduler_v0" },
        payload: reschedulePayload
      });
      const eventsAfterReschedule = appendChainedEvent({ events: existing, event: rescheduleDraft, signer: serverSigner });
      const rescheduleEvent = eventsAfterReschedule[eventsAfterReschedule.length - 1];

      try {
        validateDomainEvent({ jobBefore: job, event: rescheduleEvent, eventsBefore: existing });
      } catch (err) {
        return sendError(res, 400, "event rejected", { message: err?.message });
      }

      let jobAfterReschedule;
      try {
        jobAfterReschedule = reduceJob(eventsAfterReschedule);
      } catch (err) {
        return sendError(res, 400, "job transition rejected", { message: err?.message });
      }

      let nextEvents = eventsAfterReschedule;
      const appendedEvents = [rescheduleEvent];
      let jobAfter = jobAfterReschedule;

      // If previously reserved, re-dispatch/reserve atomically (or fail).
      if (job.reservation) {
        const selection = selectRobotForJob({
          robots: robotsInZone,
          window: newWindow,
          reservations: (robotId, win) => robotHasOverlappingReservation({ tenantId, robotId, window: win, ignoreJobId: jobId }),
          minTrustScore: 0
        });
        const selected = selection.selected;
        if (!selected) return sendError(res, 409, "no available robots for window");

          const matchDraft = createChainedEvent({
            streamId: jobId,
            type: "MATCHED",
            at: nowIso(),
            actor: { type: "dispatch", id: "dispatch_v1" },
            payload: {
              robotId: selected.robotId,
              score: selected.score,
              algorithm: "trustScore_v2",
              operatorContractHash: jobAfterReschedule.booking?.customerContractHash ?? null,
              operatorPolicyHash: jobAfterReschedule.booking?.policyHash ?? null,
              operatorCompilerId: jobAfterReschedule.booking?.customerCompilerId ?? null
            }
          });
        const eventsAfterMatch = appendChainedEvent({ events: nextEvents, event: matchDraft, signer: serverSigner });
        const matchEvent = eventsAfterMatch[eventsAfterMatch.length - 1];

        try {
          validateDomainEvent({ jobBefore: jobAfterReschedule, event: matchEvent, eventsBefore: nextEvents });
        } catch (err) {
          return sendError(res, 400, "event rejected", { message: err?.message });
        }

        let jobAfterMatch;
        try {
          jobAfterMatch = reduceJob(eventsAfterMatch);
        } catch (err) {
          return sendError(res, 400, "job transition rejected", { message: err?.message });
        }

        const reservationPayload = {
          robotId: selected.robotId,
          startAt: newWindow.startAt,
          endAt: newWindow.endAt,
          reservationId: createId("rsv"),
          reservedUntil: newWindow.startAt
        };
        const reserveDraft = createChainedEvent({
          streamId: jobId,
          type: "RESERVED",
          at: nowIso(),
          actor: { type: "dispatch", id: "dispatch_v1" },
          payload: reservationPayload
        });
        const eventsAfterReserve = appendChainedEvent({ events: eventsAfterMatch, event: reserveDraft, signer: serverSigner });
        const reservedEvent = eventsAfterReserve[eventsAfterReserve.length - 1];

        try {
          validateDomainEvent({ jobBefore: jobAfterMatch, event: reservedEvent, eventsBefore: eventsAfterMatch });
        } catch (err) {
          return sendError(res, 400, "event rejected", { message: err?.message });
        }

        try {
          jobAfter = reduceJob(eventsAfterReserve);
        } catch (err) {
          return sendError(res, 400, "job transition rejected", { message: err?.message });
        }

        nextEvents = eventsAfterReserve;
        appendedEvents.push(matchEvent, reservedEvent);

        if (requiresOperatorCoverage) {
          const operatorId = availableOperators[0].id;
          const coveragePayload = {
            jobId,
            operatorId,
            startAt: newWindow.startAt,
            endAt: newWindow.endAt,
            reservationId: createId("opcov"),
            zoneId
          };
          const coverageDraft = createChainedEvent({
            streamId: jobId,
            type: "OPERATOR_COVERAGE_RESERVED",
            actor: { type: "dispatch", id: "dispatch_v1" },
            payload: coveragePayload,
            at: nowIso()
          });
          const eventsAfterCoverage = appendChainedEvent({ events: nextEvents, event: coverageDraft, signer: serverSigner });
          const coverageEvent = eventsAfterCoverage[eventsAfterCoverage.length - 1];

          try {
            validateDomainEvent({ jobBefore: jobAfter, event: coverageEvent, eventsBefore: nextEvents });
          } catch (err) {
            return sendError(res, 400, "event rejected", { message: err?.message });
          }

          try {
            jobAfter = reduceJob(eventsAfterCoverage);
          } catch (err) {
            return sendError(res, 400, "job transition rejected", { message: err?.message });
          }

          nextEvents = eventsAfterCoverage;
          appendedEvents.push(coverageEvent);
        }
      }

      const responseBody = { events: appendedEvents, job: jobAfter };
      const outboxMessages = [];
      if (job.status !== jobAfter.status) {
        outboxMessages.push({ type: "JOB_STATUS_CHANGED", tenantId, jobId, fromStatus: job.status, toStatus: jobAfter.status, at: rescheduleEvent.at });
      }

      const ops = [{ kind: "JOB_EVENTS_APPENDED", tenantId, jobId, events: appendedEvents }];
      if (idemStoreKey) ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
      if (outboxMessages.length) ops.push({ kind: "OUTBOX_ENQUEUE", messages: outboxMessages });

      await commitTx(ops);

        return sendJson(res, 201, responseBody);
      }

      if (req.method === "POST" && parts[2] === "dispute" && parts[3] === "open" && parts.length === 4) {
        const body = await readJsonBody(req);
        const expectedHeader = parseExpectedPrevChainHashHeader(req);
        if (!expectedHeader.ok) return sendError(res, 428, "missing precondition", "x-proxy-expected-prev-chain-hash is required");

        const ok = requireScope(auth.scopes, OPS_SCOPES.OPS_WRITE) || requireScope(auth.scopes, OPS_SCOPES.FINANCE_WRITE);
        if (!ok) return sendError(res, 403, "forbidden");

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

        const existing = getJobEvents(tenantId, jobId);
        const currentPrevChainHash = getCurrentPrevChainHash(existing);
        if (expectedHeader.expectedPrevChainHash !== currentPrevChainHash) {
          return sendError(res, 409, "event append conflict", {
            expectedPrevChainHash: currentPrevChainHash,
            gotExpectedPrevChainHash: expectedHeader.expectedPrevChainHash
          });
        }

        const disputeId = body?.disputeId ?? createId("dsp");
        const openedAt = nowIso();
        const payload = { jobId, disputeId, openedAt, reason: body?.reason ?? null };
        const draft = createChainedEvent({
          streamId: jobId,
          type: "DISPUTE_OPENED",
          actor: { type: "ops", id: principalId },
          payload,
          at: openedAt
        });
        const nextEvents = appendChainedEvent({ events: existing, event: draft, signer: serverSigner });
        const event = nextEvents[nextEvents.length - 1];

        try {
          validateDomainEvent({ jobBefore: reduceJob(existing), event, eventsBefore: existing });
        } catch (err) {
          return sendError(res, 400, "event rejected", { message: err?.message }, { code: err?.code ?? null });
        }

        let jobAfter;
        try {
          jobAfter = reduceJob(nextEvents);
        } catch (err) {
          return sendError(res, 400, "job transition rejected", { message: err?.message });
        }

        const responseBody = { event, job: jobAfter };
        const ops = [{ kind: "JOB_EVENTS_APPENDED", tenantId, jobId, events: [event] }];
        if (idemStoreKey) ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
        await commitTx(ops);
        return sendJson(res, 201, responseBody);
      }

      if (req.method === "POST" && parts[2] === "dispute" && parts[3] === "close" && parts.length === 4) {
        const body = await readJsonBody(req);
        const expectedHeader = parseExpectedPrevChainHashHeader(req);
        if (!expectedHeader.ok) return sendError(res, 428, "missing precondition", "x-proxy-expected-prev-chain-hash is required");

        const ok = requireScope(auth.scopes, OPS_SCOPES.OPS_WRITE) || requireScope(auth.scopes, OPS_SCOPES.FINANCE_WRITE);
        if (!ok) return sendError(res, 403, "forbidden");

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

        const existing = getJobEvents(tenantId, jobId);
        const currentPrevChainHash = getCurrentPrevChainHash(existing);
        if (expectedHeader.expectedPrevChainHash !== currentPrevChainHash) {
          return sendError(res, 409, "event append conflict", {
            expectedPrevChainHash: currentPrevChainHash,
            gotExpectedPrevChainHash: expectedHeader.expectedPrevChainHash
          });
        }

        const disputeId = body?.disputeId ?? null;
        if (typeof disputeId !== "string" || disputeId.trim() === "") return sendError(res, 400, "disputeId is required");

        const closedAt = nowIso();
        const payload = { jobId, disputeId, closedAt, resolution: body?.resolution ?? null };
        const draft = createChainedEvent({
          streamId: jobId,
          type: "DISPUTE_CLOSED",
          actor: { type: "ops", id: principalId },
          payload,
          at: closedAt
        });
        const nextEvents = appendChainedEvent({ events: existing, event: draft, signer: serverSigner });
        const event = nextEvents[nextEvents.length - 1];

        try {
          validateDomainEvent({ jobBefore: reduceJob(existing), event, eventsBefore: existing });
        } catch (err) {
          return sendError(res, 400, "event rejected", { message: err?.message }, { code: err?.code ?? null });
        }

        let jobAfter;
        try {
          jobAfter = reduceJob(nextEvents);
        } catch (err) {
          return sendError(res, 400, "job transition rejected", { message: err?.message });
        }

        const responseBody = { event, job: jobAfter };
        const ops = [{ kind: "JOB_EVENTS_APPENDED", tenantId, jobId, events: [event] }];
        if (idemStoreKey) ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
        await commitTx(ops);
        return sendJson(res, 201, responseBody);
      }

      if (parts[2] === "events") {
        if (req.method === "GET" && parts.length === 3) {
          return sendJson(res, 200, { events: await getJobEventsFresh(tenantId, jobId, { force: true }) });
        }

      if (req.method === "POST" && parts.length === 3) {
        if (!requireProtocolHeaderForWrite(req, res)) return;
        const body = await readJsonBody(req);
        {
          const schemaCheck = parseEventSchemaVersionFromBody(body);
          if (!schemaCheck.ok) return sendError(res, schemaCheck.statusCode ?? 400, schemaCheck.message, schemaCheck.details ?? null, { code: schemaCheck.code });
        }
          const type = body?.type;
          if (!type) return sendError(res, 400, "type is required");

          {
            const financeOnly = new Set(["SETTLED", "SETTLEMENT_FORFEITED", "DECISION_RECORDED"]);
            const dispute = new Set(["DISPUTE_OPENED", "DISPUTE_CLOSED"]);
            if (financeOnly.has(type)) {
              if (!requireScope(auth.scopes, OPS_SCOPES.FINANCE_WRITE)) return sendError(res, 403, "forbidden");
            } else if (dispute.has(type)) {
              const ok = requireScope(auth.scopes, OPS_SCOPES.OPS_WRITE) || requireScope(auth.scopes, OPS_SCOPES.FINANCE_WRITE);
              if (!ok) return sendError(res, 403, "forbidden");
            } else {
              if (!requireScope(auth.scopes, OPS_SCOPES.OPS_WRITE)) return sendError(res, 403, "forbidden");
            }
          }

          const signerKind = requiredSignerKindForEventType(type);
          const existing = await getJobEventsFresh(tenantId, jobId, { force: true });
          const jobBefore = reduceJob(existing);
            if (!jobBefore) return sendError(res, 404, "job not found");
          const currentPrevChainHash = getCurrentPrevChainHash(existing);

          const expectedHeader = parseExpectedPrevChainHashHeader(req);
          let idemStoreKey = null;
          let idemRequestHash = null;
          try {
            ({ idemStoreKey, idemRequestHash } = readIdempotency({
              method: "POST",
              requestPath: path,
              expectedPrevChainHash: expectedHeader.ok ? expectedHeader.expectedPrevChainHash : null,
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

        // If a client supplies hash/signature, treat it as a finalized (agent-signed) event.
        const isClientFinalized = Boolean(body?.payloadHash || body?.chainHash || body?.signature || body?.signerKeyId || body?.prevChainHash);

        let nextEvents;
        let event;

        if (isClientFinalized) {
          event = {
            v: body?.v ?? 1,
            id: body?.id,
            at: body?.at,
            streamId: body?.streamId,
            type,
            actor: body?.actor ?? null,
            payload: body?.payload ?? null,
            payloadHash: body?.payloadHash ?? null,
            prevChainHash: body?.prevChainHash ?? null,
            chainHash: body?.chainHash ?? null,
            signature: body?.signature ?? null,
            signerKeyId: body?.signerKeyId ?? null
          };

          try {
            if (event.v !== 1) throw new TypeError("event.v must be 1");
            assertNonEmptyString(event.id, "event.id");
            assertIsoDate(event.at, "event.at");
            assertNonEmptyString(event.streamId, "event.streamId");
            if (event.streamId !== jobId) throw new TypeError("event.streamId must match jobId");
            assertActor(event.actor);
            assertNonEmptyString(event.type, "event.type");
            assertNonEmptyString(event.payloadHash, "event.payloadHash");
            assertNonEmptyString(event.chainHash, "event.chainHash");
          } catch (err) {
            return sendError(res, 400, "invalid event envelope", { message: err?.message });
          }

          {
            const atMs = Date.parse(event.at);
            const nowMs = Date.parse(nowIso());
            const maxSkewMs = 5 * 60_000;
            if (Number.isFinite(atMs) && Number.isFinite(nowMs) && atMs > nowMs + maxSkewMs) {
              return sendError(res, 400, "event.at is too far in the future");
            }
          }

          if (event.prevChainHash !== currentPrevChainHash) {
            return sendError(res, 409, "event append conflict", {
              expectedPrevChainHash: currentPrevChainHash,
              gotPrevChainHash: event.prevChainHash
            });
          }

          await ensureSignerContextFresh({ tenantId, event });
          nextEvents = [...existing, event];
          const verify = verifyChainedEvents(nextEvents, { publicKeyByKeyId: store.publicKeyByKeyId });
          if (!verify.ok) return sendError(res, 400, "event chain verification failed", verify.error);

          try {
            enforceSignaturePolicy({ tenantId, signerKind, event });
          } catch (err) {
            return sendError(res, 400, "signature policy rejected", { message: err?.message });
          }
        } else {
          try {
            assertActor(body?.actor);
          } catch (err) {
            return sendError(res, 400, "invalid actor", { message: err?.message });
          }

          if (
            signerKind === SIGNER_KIND.ROBOT ||
            signerKind === SIGNER_KIND.OPERATOR ||
            signerKind === SIGNER_KIND.ROBOT_OR_OPERATOR
          ) {
            return sendError(res, 400, "event must be client-finalized and signed for this type");
          }
          if (body.actor.type === "robot" || body.actor.type === "operator") {
            return sendError(res, 400, "robot/operator actors must use signer-enforced event types");
          }

          if (!expectedHeader.ok) {
            return sendError(res, 428, "missing precondition", "x-proxy-expected-prev-chain-hash is required");
          }
          if (expectedHeader.expectedPrevChainHash !== currentPrevChainHash) {
            return sendError(res, 409, "event append conflict", {
              expectedPrevChainHash: currentPrevChainHash,
              gotExpectedPrevChainHash: expectedHeader.expectedPrevChainHash
            });
          }

            let serverPayload = body?.payload ?? null;
            if (type === "DECISION_RECORDED") {
              const base = serverPayload && typeof serverPayload === "object" && !Array.isArray(serverPayload) ? serverPayload : {};
              const decisionId = typeof base.decisionId === "string" && base.decisionId.trim() ? base.decisionId : createId("dec");
              const kind = typeof base.kind === "string" && base.kind.trim() ? base.kind : "SETTLEMENT_FORFEIT";

              // Best-effort: infer holdId from the current active hold if omitted.
              let holdId = typeof base.holdId === "string" && base.holdId.trim() ? base.holdId : null;
              if (!holdId) {
                for (let i = existing.length - 1; i >= 0; i -= 1) {
                  const e = existing[i];
                  if (e?.type !== "SETTLEMENT_HELD") continue;
                  const hp = e.payload ?? null;
                  if (!hp || typeof hp !== "object") continue;
                  if (typeof hp.holdId === "string" && hp.holdId.trim()) {
                    holdId = hp.holdId;
                    break;
                  }
                }
              }

              serverPayload = {
                jobId,
                decisionId,
                decidedAt: nowIso(),
                kind,
                holdId,
                forfeitureReason: base.forfeitureReason ?? base.reason ?? null,
                reasonCodes: Array.isArray(base.reasonCodes) ? base.reasonCodes : [],
                evidenceRefs: Array.isArray(base.evidenceRefs) ? base.evidenceRefs : [],
                policyHash: base.policyHash ?? jobBefore?.booking?.policyHash ?? jobBefore?.customerPolicyHash ?? null
              };
            }
            if (type === "SETTLED") {
            const proofPolicy = jobBefore.booking?.policySnapshot?.proofPolicy ?? null;
            const gateModeRaw = typeof proofPolicy?.gateMode === "string" ? proofPolicy.gateMode : "warn";
            const gateMode = gateModeRaw === "strict" || gateModeRaw === "holdback" ? gateModeRaw : "warn";

            if (jobBefore.status === "COMPLETED" && gateMode !== "warn") {
              let completionChainHash = null;
              for (let i = existing.length - 1; i >= 0; i -= 1) {
                const e = existing[i];
                if (e?.type !== "EXECUTION_COMPLETED" && e?.type !== "JOB_EXECUTION_COMPLETED") continue;
                const ch = typeof e?.chainHash === "string" ? e.chainHash.trim() : "";
                if (!ch) continue;
                completionChainHash = ch;
                break;
              }

              const anchorIdx = completionChainHash ? existing.findIndex((e) => e?.chainHash === completionChainHash) : -1;
              const anchorSlice = anchorIdx === -1 ? null : existing.slice(0, anchorIdx + 1);
              const jobAtAnchor = anchorSlice ? reduceJob(anchorSlice) : null;
              const current =
                jobAtAnchor && completionChainHash
                  ? verifyZoneCoverageProofV1({
                      job: jobAtAnchor,
                      events: existing,
                      evaluatedAtChainHash: completionChainHash,
                      customerPolicyHash: jobAtAnchor.customerPolicyHash ?? jobAtAnchor.booking?.policyHash ?? null,
                      operatorPolicyHash: jobAtAnchor.operatorPolicyHash ?? null
                    })
                  : null;
              const expectedFactsHash = current?.factsHash ?? null;
              const expectedCustomerPolicyHash = current?.anchors?.customerPolicyHash ?? (jobAtAnchor?.customerPolicyHash ?? jobAtAnchor?.booking?.policyHash ?? null);

              let proofEvent = null;
              if (completionChainHash && expectedFactsHash) {
                for (let i = existing.length - 1; i >= 0; i -= 1) {
                  const e = existing[i];
                  if (e?.type !== "PROOF_EVALUATED") continue;
                  const p = e.payload ?? null;
                  if (!p || typeof p !== "object") continue;
                  if (p.evaluatedAtChainHash !== completionChainHash) continue;
                  if (p.factsHash !== expectedFactsHash) continue;
                  if (expectedCustomerPolicyHash && p.customerPolicyHash !== expectedCustomerPolicyHash) continue;
                  proofEvent = e;
                  break;
                }
              }

                if (proofEvent) {
                  const p = proofEvent.payload ?? {};
                  const proofStatus = p.status === null || p.status === undefined ? null : String(p.status).trim();

                  let forfeit = null;
                  if (proofStatus === "INSUFFICIENT_EVIDENCE") {
                    let holdId = null;
                    for (let i = existing.length - 1; i >= 0; i -= 1) {
                      const e = existing[i];
                      if (e?.type !== "SETTLEMENT_HELD") continue;
                      const hp = e.payload ?? null;
                      if (!hp || typeof hp !== "object") continue;
                      if (hp.evaluatedAtChainHash !== completionChainHash) continue;
                      if (hp.factsHash !== expectedFactsHash) continue;
                      if (typeof hp.holdId === "string" && hp.holdId.trim()) {
                        holdId = hp.holdId;
                        break;
                      }
                    }

                    const forfeitEvent =
                      holdId &&
                      existing
                        .slice()
                        .reverse()
                        .find((e) => e?.type === "SETTLEMENT_FORFEITED" && e?.payload?.holdId === holdId && e?.payload?.factsHash === expectedFactsHash);
                    if (forfeitEvent) {
                      const fp = forfeitEvent.payload ?? null;
                      forfeit = {
                        holdId,
                        forfeitureReason: fp?.forfeitureReason ?? null,
                        forfeitEventId: forfeitEvent.id ?? null,
                        forfeitEventChainHash: forfeitEvent.chainHash ?? null,
                        forfeitEventPayloadHash: forfeitEvent.payloadHash ?? null
                      };
                    }
                  }

                  if (proofStatus !== "INSUFFICIENT_EVIDENCE" || forfeit) {
                    const settlementProofRef = {
                      proofEventId: proofEvent.id ?? null,
                      proofEventAt: p.evaluatedAt ?? proofEvent.at ?? null,
                      proofEventChainHash: proofEvent.chainHash ?? null,
                      proofEventPayloadHash: proofEvent.payloadHash ?? null,
                      proofEventSignerKeyId: proofEvent.signerKeyId ?? null,
                      proofEventSignature: proofEvent.signature ?? null,
                      evaluationId: p.evaluationId ?? null,
                      evaluatedAtChainHash: p.evaluatedAtChainHash ?? null,
                      status: forfeit ? "FAIL" : proofStatus,
                      reasonCodes: Array.isArray(p.reasonCodes) ? p.reasonCodes : [],
                      requiredZonesHash: p.requiredZonesHash ?? null,
                      customerPolicyHash: p.customerPolicyHash ?? null,
                      operatorPolicyHash: p.operatorPolicyHash ?? null,
                      factsHash: p.factsHash ?? null,
                      metrics: p.metrics ?? null,
                      ...(forfeit ? { forfeit } : null)
                    };

                    const base = serverPayload && typeof serverPayload === "object" && !Array.isArray(serverPayload) ? serverPayload : {};
                    serverPayload = { ...base, settlementProofRef };
                  }
                }
              }
            }

            if (type === "SETTLEMENT_FORFEITED") {
              const base = serverPayload && typeof serverPayload === "object" && !Array.isArray(serverPayload) ? serverPayload : {};
              let completionChainHash = null;
              for (let i = existing.length - 1; i >= 0; i -= 1) {
                const e = existing[i];
                if (e?.type !== "EXECUTION_COMPLETED" && e?.type !== "JOB_EXECUTION_COMPLETED") continue;
                const ch = typeof e?.chainHash === "string" ? e.chainHash.trim() : "";
                if (!ch) continue;
                completionChainHash = ch;
                break;
              }

              const anchorIdx = completionChainHash ? existing.findIndex((e) => e?.chainHash === completionChainHash) : -1;
              const anchorSlice = anchorIdx === -1 ? null : existing.slice(0, anchorIdx + 1);
              const jobAtAnchor = anchorSlice ? reduceJob(anchorSlice) : null;
              const current =
                jobAtAnchor && completionChainHash
                  ? verifyZoneCoverageProofV1({
                      job: jobAtAnchor,
                      events: existing,
                      evaluatedAtChainHash: completionChainHash,
                      customerPolicyHash: jobAtAnchor.customerPolicyHash ?? jobAtAnchor.booking?.policyHash ?? null,
                      operatorPolicyHash: jobAtAnchor.operatorPolicyHash ?? null
                    })
                  : null;
              const expectedFactsHash = current?.factsHash ?? null;

              let holdId = typeof base.holdId === "string" && base.holdId.trim() ? base.holdId : null;
              if (!holdId && completionChainHash && expectedFactsHash) {
                for (let i = existing.length - 1; i >= 0; i -= 1) {
                  const e = existing[i];
                  if (e?.type !== "SETTLEMENT_HELD") continue;
                  const hp = e.payload ?? null;
                  if (!hp || typeof hp !== "object") continue;
                  if (hp.evaluatedAtChainHash !== completionChainHash) continue;
                  if (hp.factsHash !== expectedFactsHash) continue;
                  if (typeof hp.holdId === "string" && hp.holdId.trim()) {
                    holdId = hp.holdId;
                    break;
                  }
                }
              }

              serverPayload = {
                ...base,
                jobId,
                holdId,
                forfeitedAt: nowIso(),
                forfeitureReason: base.forfeitureReason ?? base.reason ?? "MANUAL",
                decisionRef: base.decisionRef ?? null,
                evaluatedAtChainHash: completionChainHash,
                factsHash: expectedFactsHash
              };

              // Prefer a verifiable, signed decision event reference when present.
              let decisionEvent = null;
              const decisionEventIdRaw = typeof base.decisionEventId === "string" && base.decisionEventId.trim() ? base.decisionEventId : null;
              const decisionIdRaw = typeof base.decisionId === "string" && base.decisionId.trim() ? base.decisionId : null;

              if (decisionEventIdRaw) {
                decisionEvent = existing.find((e) => e?.id === decisionEventIdRaw) ?? null;
              } else if (decisionIdRaw) {
                decisionEvent =
                  existing
                    .slice()
                    .reverse()
                    .find((e) => e?.type === "DECISION_RECORDED" && e?.payload?.decisionId === decisionIdRaw) ?? null;
              } else {
                decisionEvent =
                  existing
                    .slice()
                    .reverse()
                    .find(
                      (e) =>
                        e?.type === "DECISION_RECORDED" &&
                        e?.payload?.kind === "SETTLEMENT_FORFEIT" &&
                        e?.payload?.holdId === holdId &&
                        e?.payload?.forfeitureReason === (serverPayload.forfeitureReason ?? null)
                    ) ?? null;
              }

              if (decisionEvent && decisionEvent.type === "DECISION_RECORDED") {
                const p = decisionEvent.payload ?? null;
                serverPayload = {
                  ...serverPayload,
                  decisionEventRef: {
                    decisionEventId: decisionEvent.id ?? null,
                    decisionEventAt: p?.decidedAt ?? decisionEvent.at ?? null,
                    decisionEventChainHash: decisionEvent.chainHash ?? null,
                    decisionEventPayloadHash: decisionEvent.payloadHash ?? null,
                    decisionEventSignerKeyId: decisionEvent.signerKeyId ?? null,
                    decisionEventSignature: decisionEvent.signature ?? null,
                    decisionId: p?.decisionId ?? null,
                    kind: p?.kind ?? null,
                    holdId: p?.holdId ?? null,
                    forfeitureReason: p?.forfeitureReason ?? null,
                    reasonCodes: Array.isArray(p?.reasonCodes) ? p.reasonCodes : [],
                    evidenceRefs: Array.isArray(p?.evidenceRefs) ? p.evidenceRefs : [],
                    policyHash: p?.policyHash ?? null
                  }
                };
              }
            }

            event = createChainedEvent({
              streamId: jobId,
              type,
            actor: body?.actor,
            payload: serverPayload,
            at: nowIso()
          });
          nextEvents = appendChainedEvent({ events: existing, event, signer: serverSigner });
          event = nextEvents[nextEvents.length - 1];
        }

        try {
          validateDomainEvent({ jobBefore, event, eventsBefore: existing });
        } catch (err) {
          if (err?.code === "TENANT_QUOTA_EXCEEDED") {
            return sendError(res, 429, "tenant quota exceeded", err?.quota ?? { message: err?.message }, { code: "TENANT_QUOTA_EXCEEDED" });
          }
          return sendError(res, 400, "event rejected", { message: err?.message }, { code: err?.code ?? null });
        }

        let jobAfter;
        try {
          jobAfter = reduceJob(nextEvents);
        } catch (err) {
          return sendError(res, 400, "job transition rejected", {
            name: err?.name,
            message: err?.message,
            fromStatus: err?.fromStatus,
            eventType: err?.eventType
          });
        }

        let ledgerEntries = [];
        try {
          ledgerEntries = ledgerEntriesForJobEvent({ jobBefore, event, eventsBefore: existing });
        } catch (err) {
          return sendError(res, 400, "ledger posting rejected", { message: err?.message });
        }

        const responseBody = {
          event,
          job: jobAfter,
          ledgerEntryId: ledgerEntries.length ? ledgerEntries[0]?.id ?? null : null,
          ledgerEntryIds: ledgerEntries.map((e) => e?.id).filter(Boolean)
        };

        const outboxMessages = [];
        for (const entry of ledgerEntries) {
          if (!entry) continue;
          outboxMessages.push({ type: "LEDGER_ENTRY_APPLY", tenantId, jobId, sourceEventId: event.id, entry });
        }
        if (jobBefore?.status !== jobAfter?.status) {
          outboxMessages.push({
            type: "JOB_STATUS_CHANGED",
            tenantId,
            jobId,
            fromStatus: jobBefore.status,
            toStatus: jobAfter.status,
            at: event.at
          });
        }
        if (event.type === "SETTLED") {
          outboxMessages.push({ type: "JOB_SETTLED", tenantId, jobId, settledEventId: event.id, at: event.at, sourceEventId: event.id });
        }
        if (event.type === "INCIDENT_DETECTED" || event.type === "INCIDENT_REPORTED") {
          const robotId = jobAfter.execution?.robotId ?? jobAfter.reservation?.robotId ?? jobAfter.match?.robotId ?? null;
          if (robotId) {
            outboxMessages.push({
              type: "INCIDENT_RECORDED",
              tenantId,
              jobId,
              robotId,
              incidentId: event.payload?.incidentId ?? null,
              incidentType: event.payload?.type ?? null,
              severity: event.payload?.severity ?? null,
              at: event.at,
              sourceEventId: event.id
            });
          }
        }

          // Proof re-evaluation: if evidence that affects proof arrives after completion, enqueue a re-eval for the completion anchor.
          if (event.type === "ZONE_COVERAGE_REPORTED" || event.type === "INCIDENT_DETECTED" || event.type === "INCIDENT_REPORTED") {
            if (jobAfter?.status === "COMPLETED") {
              let completionChainHash = null;
            for (let i = nextEvents.length - 1; i >= 0; i -= 1) {
              const e = nextEvents[i];
              if (e?.type !== "EXECUTION_COMPLETED" && e?.type !== "JOB_EXECUTION_COMPLETED") continue;
              if (typeof e.chainHash === "string" && e.chainHash.trim()) {
                completionChainHash = e.chainHash;
                break;
              }
            }
              if (completionChainHash) {
                outboxMessages.push({
                  type: "PROOF_EVAL_ENQUEUE",
                  tenantId,
                  jobId,
                  sourceEventId: event.id,
                  evaluatedAtChainHash: completionChainHash,
                  sourceAt: event.at ?? null
                });
              }
            }

            // Post-settlement proof re-evaluation is governed: only allow if a dispute is open,
            // or within the configured dispute window (if explicitly enabled).
            if (jobAfter?.status === "SETTLED") {
              const disputeOpen = jobAfter?.dispute?.status === "OPEN";
              const proofPolicy = jobAfter?.booking?.policySnapshot?.proofPolicy ?? null;
              const disputeWindowDays = Number.isSafeInteger(proofPolicy?.disputeWindowDays) ? proofPolicy.disputeWindowDays : 0;
              const allowWindow = proofPolicy?.allowReproofAfterSettlementWithinDisputeWindow === true && disputeWindowDays > 0;
              const settledAtMs = jobAfter?.settlement?.settledAt ? Date.parse(String(jobAfter.settlement.settledAt)) : NaN;
              const atMs = event.at ? Date.parse(String(event.at)) : NaN;
              const withinWindow = allowWindow && Number.isFinite(settledAtMs) && Number.isFinite(atMs) && atMs <= settledAtMs + disputeWindowDays * 24 * 60 * 60_000;

              if (disputeOpen || withinWindow) {
                let completionChainHash = null;
                for (let i = nextEvents.length - 1; i >= 0; i -= 1) {
                  const e = nextEvents[i];
                  if (e?.type !== "EXECUTION_COMPLETED" && e?.type !== "JOB_EXECUTION_COMPLETED") continue;
                  if (typeof e.chainHash === "string" && e.chainHash.trim()) {
                    completionChainHash = e.chainHash;
                    break;
                  }
                }
                if (completionChainHash) {
                  outboxMessages.push({
                    type: "PROOF_EVAL_ENQUEUE",
                    tenantId,
                    jobId,
                    sourceEventId: event.id,
                    evaluatedAtChainHash: completionChainHash,
                    sourceAt: event.at ?? null
                  });
                }
              } else {
                try {
                  store.metrics?.incCounter?.("proof_reeval_skipped_total", { reason: "job_settled" }, 1);
                } catch {}
              }
            }
          }

          if (event.type === "DISPUTE_OPENED") {
            let completionChainHash = null;
            for (let i = nextEvents.length - 1; i >= 0; i -= 1) {
              const e = nextEvents[i];
              if (e?.type !== "EXECUTION_COMPLETED" && e?.type !== "JOB_EXECUTION_COMPLETED") continue;
              if (typeof e.chainHash === "string" && e.chainHash.trim()) {
                completionChainHash = e.chainHash;
                break;
              }
            }
            if (completionChainHash) {
              outboxMessages.push({
                type: "PROOF_EVAL_ENQUEUE",
                tenantId,
                jobId,
                sourceEventId: event.id,
                evaluatedAtChainHash: completionChainHash,
                sourceAt: event.at ?? null
              });
            }
          }

        const ops = [{ kind: "JOB_EVENTS_APPENDED", tenantId, jobId, events: [event] }];
        if (idemStoreKey) ops.push({ kind: "IDEMPOTENCY_PUT", key: idemStoreKey, value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody } });
        if (outboxMessages.length) ops.push({ kind: "OUTBOX_ENQUEUE", messages: outboxMessages });

        await commitTx(ops);

        return sendJson(res, 201, responseBody);
      }
    }
    }

    // Check if the response was sent by a route that uses bare "return;" (e.g. SSE streams).
    if (res.writableEnded || res.headersSent) return true;

    return false;
  };
}
