/**
 * Router routes: /router/plan, /router/launch, /router/launches/:launchId/status, /router/dispatch
 *
 * Extracted from app.js following the route module pattern (see health.js).
 * The handler returns true if it handled the request, false otherwise.
 *
 * The original app.js code uses "return sendJson(...)" / "return sendError(...)"
 * and bare "return;" after writing to res. We wrap sendJson/sendError to return true
 * and fall back to checking res.writableEnded for SSE/stream routes.
 */
import { matchRoute } from "../router.js";

/**
 * @param {object} deps - Shared dependencies from createApi()
 * @returns {Function} Route handler
 */
export function createRouterRoutes(deps) {
  const {
    store,
    sendJson,
    sendError,
    readJsonBody,
    createId,
    nowIso,
    sha256Hex,
    commitTx,
    normalizeForCanonicalJson,
    buildRouterPlanFromBody,
    getMarketplaceRfq,
    listMarketplaceRfqsByRouterLaunchId,
    readRouterLaunchMetadataFromRfq,
    deriveRouterLaunchStatusTaskSnapshot,
    buildRouterMarketplaceLaunchV1,
    buildRouterLaunchStatusV1,
    buildRouterMarketplaceDispatchV1,
    toMarketplaceRfqResponse,
    toMarketplaceBidResponse,
    listMarketplaceRfqBids,
    getAgentIdentityRecord,
    getAgentRunSettlementRecord,
    enforceMarketplaceParticipantLifecycleGuards,
    parseInteractionDirection,
    normalizeMarketplaceCounterOfferPolicyInput,
    normalizeWorkOrderApprovalModeInput,
    normalizeWorkOrderApprovalPolicyInput,
    normalizeApprovalContinuationOptionsInput,
    normalizeApprovalDecisionInput,
    enforceHighRiskApproval,
    approvalDecisionV1ToHumanApprovalDecision,
    deriveMarketplaceRfqApprovalContext,
    resolveApprovalStandingPolicyDecision,
    buildApprovalContinuationV1,
    patchApprovalContinuationV1,
    assertApprovalRecordsPersistable,
    buildApprovalPersistenceOps,
    buildApprovalRecordRef,
    buildApprovalRequiredNotificationPayload,
    buildApprovalContinuationDecisionRef,
    getApprovalContinuationRecord,
    emitBuyerProductNotificationBestEffort,
    buildTaskWalletV1,
    APPROVAL_CONTINUATION_KIND,
    APPROVAL_CONTINUATION_STATUS,
    ROUTER_PLAN_ISSUE_CODE,
    ROUTER_PLAN_ISSUE_SEVERITY,
    ROUTER_PLAN_SCOPE,
    ROUTER_MARKETPLACE_DISPATCH_STATE,
    autoAcceptMarketplaceRfqBidForRfq,
    logger
  } = deps;

  // Wrap response helpers to return true (signals "handled" to dispatcher).
  const _sendJson = (...args) => { deps.sendJson(...args); return true; };
  const _sendError = (...args) => { deps.sendError(...args); return true; };

  /**
   * @param {object} ctx - Per-request context
   * @returns {Promise<boolean>} true if handled
   */
  return async function handleRouterRoutes(ctx) {
    const { req, res, path, url, tenantId, principalId, auth, readIdempotency, cloneJsonLike, parseRouterLaunchId, parseRouterLaunchTaskOverrides, makeRouteError, buildRouterPlanFromBody: ctxBuildRouterPlanFromBody, autoAcceptMarketplaceRfqBidForRfq: ctxAutoAccept } = ctx;
    // Prefer per-request functions from ctx (defined inside handle()).
    const buildRouterPlanFromBody = ctxBuildRouterPlanFromBody ?? deps.buildRouterPlanFromBody;
    const autoAcceptMarketplaceRfqBidForRfq = ctxAutoAccept ?? deps.autoAcceptMarketplaceRfqBidForRfq;
    // Use wrapped versions that return true for "return sendJson/sendError(...)" pattern.
    const sendJson = _sendJson;
    const sendError = _sendError;

    if (!path.startsWith("/router/")) return false;

    if (req.method === "POST" && path === "/router/plan") {
      const body = await readJsonBody(req);
      try {
        const { plan } = await buildRouterPlanFromBody(body);
        return sendJson(res, 200, { ok: true, plan });
      } catch (err) {
        return sendError(
          res,
          Number.isSafeInteger(Number(err?.statusCode)) ? Number(err.statusCode) : 400,
          err?.message ?? "invalid router plan request",
          err?.details ?? null,
          { code: typeof err?.code === "string" && err.code.trim() !== "" ? err.code.trim() : "SCHEMA_INVALID" }
        );
      }
    }

    if (req.method === "POST" && path === "/router/launch") {
      if (!(store.marketplaceRfqs instanceof Map)) store.marketplaceRfqs = new Map();
      if (!(store.marketplaceRfqBids instanceof Map)) store.marketplaceRfqBids = new Map();

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

      let routed = null;
      try {
        routed = await buildRouterPlanFromBody(body);
      } catch (err) {
        return sendError(
          res,
          Number.isSafeInteger(Number(err?.statusCode)) ? Number(err.statusCode) : 400,
          err?.message ?? "invalid router launch request",
          err?.details ?? null,
          { code: typeof err?.code === "string" && err.code.trim() !== "" ? err.code.trim() : "SCHEMA_INVALID" }
        );
      }

      const plan = routed.plan;
      const plannedTasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
      if (routed.productSurface === "consumer_shell" && routed.phase1TaskPolicy?.status && routed.phase1TaskPolicy.status !== "supported") {
        return sendError(
          res,
          409,
          routed.phase1TaskPolicy.message,
          {
            plan,
            taskPolicy: routed.phase1TaskPolicy
          },
          { code: ROUTER_PLAN_ISSUE_CODE.PHASE1_TASK_UNSUPPORTED }
        );
      }
      if (!plannedTasks.length) {
        return sendError(
          res,
          409,
          "router launch requires at least one routed task",
          { plan },
          { code: "ROUTER_LAUNCH_NO_TASKS" }
        );
      }

      const posterAgentId =
        typeof body?.posterAgentId === "string" && body.posterAgentId.trim() !== "" ? body.posterAgentId.trim() : null;
      if (!posterAgentId) return sendError(res, 400, "posterAgentId is required", null, { code: "SCHEMA_INVALID" });

      let posterIdentity = null;
      try {
        posterIdentity = await getAgentIdentityRecord({ tenantId, agentId: posterAgentId });
      } catch (err) {
        return sendError(res, 400, "invalid posterAgentId", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }
      if (!posterIdentity) return sendError(res, 404, "poster agent identity not found", null, { code: "NOT_FOUND" });

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

      let taskDirection = null;
      try {
        taskDirection = parseInteractionDirection({ fromTypeRaw: body?.fromType, toTypeRaw: body?.toType });
      } catch (err) {
        return sendError(res, 400, "invalid interaction direction", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      let defaultBudgetCents = null;
      if (body?.budgetCents !== undefined && body?.budgetCents !== null && body?.budgetCents !== "") {
        const parsedBudget = Number(body.budgetCents);
        if (!Number.isSafeInteger(parsedBudget) || parsedBudget <= 0) {
          return sendError(res, 400, "budgetCents must be a positive safe integer", null, { code: "SCHEMA_INVALID" });
        }
        defaultBudgetCents = parsedBudget;
      }

      const defaultCurrency = body?.currency ? String(body.currency).trim().toUpperCase() : "USD";
      if (!defaultCurrency || !/^[A-Z0-9_]{2,8}$/.test(defaultCurrency)) {
        return sendError(res, 400, "currency must be a non-empty string", null, { code: "SCHEMA_INVALID" });
      }

      let defaultDeadlineAt = null;
      if (body?.deadlineAt !== undefined && body?.deadlineAt !== null && body?.deadlineAt !== "") {
        if (typeof body.deadlineAt !== "string" || !Number.isFinite(Date.parse(body.deadlineAt))) {
          return sendError(res, 400, "deadlineAt must be an ISO date-time", null, { code: "SCHEMA_INVALID" });
        }
        defaultDeadlineAt = new Date(Date.parse(body.deadlineAt)).toISOString();
      }

      const launchMetadata =
        body?.metadata === undefined
          ? null
          : body.metadata === null
            ? null
            : typeof body.metadata === "object" && !Array.isArray(body.metadata)
              ? cloneJsonLike(body.metadata)
              : null;
      if (body?.metadata !== undefined && launchMetadata === null && body.metadata !== null) {
        return sendError(res, 400, "metadata must be an object or null", null, { code: "SCHEMA_INVALID" });
      }
      const phase1LaunchContract =
        routed.productSurface === "consumer_shell" && routed.phase1TaskPolicy?.status === "supported"
          ? normalizeForCanonicalJson(
              {
                schemaVersion: "Phase1LaunchContract.v1",
                productSurface: "consumer_shell",
                categoryId: routed.phase1TaskPolicy.categoryId,
                categoryLabel: routed.phase1TaskPolicy.categoryLabel,
                categorySummary: routed.phase1TaskPolicy.categorySummary,
                completionContract:
                  routed.phase1TaskPolicy.completionContract &&
                  typeof routed.phase1TaskPolicy.completionContract === "object" &&
                  !Array.isArray(routed.phase1TaskPolicy.completionContract)
                    ? routed.phase1TaskPolicy.completionContract
                    : null
              },
              { path: "$.phase1LaunchContract" }
            )
          : null;
      const launchMetadataWithProductContext = normalizeForCanonicalJson(
        {
          ...(launchMetadata ?? {}),
          ...(phase1LaunchContract ? { phase1Launch: phase1LaunchContract } : {})
        },
        { path: "$.launchMetadata" }
      );

      let counterOfferPolicy = null;
      try {
        counterOfferPolicy = normalizeMarketplaceCounterOfferPolicyInput(body?.counterOfferPolicy ?? null, {
          fieldPath: "counterOfferPolicy"
        });
      } catch (err) {
        return sendError(res, 400, "invalid counterOfferPolicy", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      let launchApprovalMode = null;
      let launchApprovalPolicy = null;
      let launchApprovalContinuationOptions = null;
      try {
        launchApprovalMode = normalizeWorkOrderApprovalModeInput(body?.approvalMode ?? body?.approval?.mode ?? null, { allowNull: true });
        launchApprovalPolicy = normalizeWorkOrderApprovalPolicyInput(body?.approvalPolicy ?? body?.approval?.policy ?? null);
        launchApprovalContinuationOptions = normalizeApprovalContinuationOptionsInput(body?.approvalContinuation ?? null);
      } catch (err) {
        return sendError(res, 400, "invalid router launch approval policy", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      let taskOverrides = null;
      try {
        taskOverrides = parseRouterLaunchTaskOverrides(body?.taskOverrides ?? null);
      } catch (err) {
        return sendError(res, 400, "invalid taskOverrides", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const knownTaskIds = new Set(plannedTasks.map((task) => String(task?.taskId ?? "")).filter(Boolean));
      for (const taskId of taskOverrides.keys()) {
        if (!knownTaskIds.has(taskId)) {
          return sendError(
            res,
            409,
            "taskOverrides contains unknown taskId",
            { taskId, knownTaskIds: Array.from(knownTaskIds.values()) },
            { code: "ROUTER_LAUNCH_TASK_OVERRIDE_UNKNOWN" }
          );
        }
      }

      let launchId = null;
      try {
        launchId = parseRouterLaunchId(body?.launchId ?? null, { allowNull: true }) ?? createId("rlaunch");
      } catch (err) {
        return sendError(res, 400, "invalid launchId", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const defaultDescription =
        typeof body?.description === "string" && body.description.trim() !== "" ? body.description.trim() : routed.text;
      const nowAt = nowIso();
      const requestTextSha256 = sha256Hex(routed.text);
      const seenRfqIds = new Set();
      const rfqs = [];
      const launchTasks = [];
      const ops = [];

      for (let index = 0; index < plannedTasks.length; index += 1) {
        const task = plannedTasks[index];
        const taskId = typeof task?.taskId === "string" && task.taskId.trim() !== "" ? task.taskId.trim() : null;
        const requiredCapability =
          typeof task?.requiredCapability === "string" && task.requiredCapability.trim() !== ""
            ? task.requiredCapability.trim()
            : null;
        if (!taskId || !requiredCapability) {
          return sendError(
            res,
            409,
            "router launch blocked by invalid task",
            { taskIndex: index, task },
            { code: "ROUTER_LAUNCH_INVALID_TASK" }
          );
        }

        const override = taskOverrides.get(taskId) ?? {};
        const rfqId = override.rfqId ?? createId("rfq");
        if (seenRfqIds.has(rfqId)) {
          return sendError(
            res,
            409,
            "router launch contains duplicate rfqId",
            { taskId, rfqId },
            { code: "ROUTER_LAUNCH_DUPLICATE_RFQ_ID" }
          );
        }
        seenRfqIds.add(rfqId);

        const existingRfq = getMarketplaceRfq({ tenantId, rfqId });
        if (existingRfq) {
          return sendError(
            res,
            409,
            "marketplace rfq already exists",
            { taskId, rfqId },
            { code: "CONFLICT" }
          );
        }

        const candidateAgentIds = Array.isArray(task?.candidates)
          ? task.candidates
              .map((candidate) => (typeof candidate?.agentId === "string" && candidate.agentId.trim() !== "" ? candidate.agentId.trim() : null))
              .filter(Boolean)
          : [];
        const budgetCents = override.budgetCents ?? defaultBudgetCents;
        const currency = override.currency ?? defaultCurrency;
        const deadlineAt = override.deadlineAt ?? defaultDeadlineAt;
        const taskApprovalMode = override.approvalMode ?? launchApprovalMode;
        const taskApprovalPolicy = override.approvalPolicy ?? launchApprovalPolicy;
        const taskWallet =
          phase1LaunchContract && typeof phase1LaunchContract === "object" && !Array.isArray(phase1LaunchContract)
            ? buildTaskWalletV1({
                walletId: `twal_${launchId}_${taskId}`,
                tenantId,
                launchId,
                taskId,
                rfqId,
                ownerAgentId: posterAgentId,
                categoryId: phase1LaunchContract.categoryId ?? null,
                currency,
                maxSpendCents: budgetCents ?? null,
                evidenceRequirements: Array.isArray(phase1LaunchContract?.completionContract?.evidenceRequirements)
                  ? phase1LaunchContract.completionContract.evidenceRequirements
                  : [],
                approvalMode: taskApprovalMode ?? null,
                expiresAt: deadlineAt ?? null,
                createdAt: nowAt
              })
            : null;
        const taskMetadata = normalizeForCanonicalJson(
          {
            ...(launchMetadataWithProductContext ?? {}),
            ...(override.metadata ?? {}),
            routerLaunch: {
              schemaVersion: "RouterLaunchMetadata.v1",
              launchId,
              requestTextSha256,
              planId: plan.planId ?? null,
              planHash: plan.planHash ?? null,
              taskId,
              taskIndex: index + 1,
              scope: routed.scope,
              dependsOnTaskIds: Array.isArray(task?.dependsOnTaskIds) ? task.dependsOnTaskIds : [],
              candidateCount: candidateAgentIds.length,
              candidateAgentIds,
              taskWallet
            }
          },
          { path: "$.metadata" }
        );

        let authorityEnvelope = null;
        let approvalRequest = null;
        let approvalDecision = null;
        let approvalContinuation = null;
        let approvalRef = null;
        const rawTaskApprovalRequest = override.approvalRequest ?? null;
        const rawTaskApprovalDecision = override.approvalDecision ?? override.humanApprovalDecision ?? null;
        const approvalManaged =
          taskApprovalMode !== null ||
          taskApprovalPolicy !== null ||
          override.authorityEnvelope !== null ||
          rawTaskApprovalRequest !== null ||
          rawTaskApprovalDecision !== null;
        if (approvalManaged) {
          let approvalContext = null;
          try {
            approvalContext = deriveMarketplaceRfqApprovalContext({
              rfqId,
              posterAgentId,
              capability: requiredCapability,
              title:
                typeof override.title === "string" && override.title.trim() !== ""
                  ? override.title.trim()
                  : typeof task?.title === "string" && task.title.trim() !== ""
                    ? task.title.trim()
                    : requiredCapability,
              budgetCents,
              currency,
              deadlineAt,
              authorityEnvelopeInput: override.authorityEnvelope ?? null,
              approvalRequestInput: rawTaskApprovalRequest,
              approvalPolicy: taskApprovalPolicy,
              candidateAgentIds,
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
                ? { taskId, rfqId, ...err.details }
                : { taskId, rfqId, message: err?.message ?? null };
            return sendError(
              res,
              statusCode,
              statusCode === 400 ? "invalid router task authority envelope" : "router task authority envelope blocked",
              details,
              { code: err?.code ?? (statusCode === 400 ? "SCHEMA_INVALID" : "MARKETPLACE_RFQ_AUTHORITY_ENVELOPE_MISMATCH") }
            );
          }
          authorityEnvelope = approvalContext.authorityEnvelope;
          approvalRequest = approvalContext.approvalRequest;
          const autoPolicyDecision =
            rawTaskApprovalDecision === null
              ? await resolveApprovalStandingPolicyDecision({
                  tenantId,
                  authorityEnvelope,
                  approvalRequest,
                  nowAt
                })
              : null;
          try {
            approvalDecision = normalizeApprovalDecisionInput({
              rawApprovalDecision: rawTaskApprovalDecision ?? autoPolicyDecision?.approvalDecision ?? null,
              approvalRequest,
              authorityEnvelope,
              errorCodePrefix: "ROUTER_LAUNCH_APPROVAL"
            });
          } catch (err) {
            return sendError(
              res,
              err?.statusCode ?? 409,
              err?.statusCode === 400 ? "invalid router task approval decision" : "router task approval decision blocked",
              err?.details ? { taskId, rfqId, ...err.details } : { taskId, rfqId, message: err?.message ?? null },
              { code: err?.code ?? (err?.statusCode === 400 ? "SCHEMA_INVALID" : "ROUTER_LAUNCH_APPROVAL_DECISION_INVALID") }
            );
          }
          const approvalPolicyForCheck =
            taskApprovalMode === "require"
              ? normalizeForCanonicalJson(
                  {
                    ...(taskApprovalPolicy ?? {}),
                    highRiskActionTypes: [approvalContext.approvalAction.actionType],
                    requireApprovalAboveCents: 0,
                    strictEvidenceRefs: taskApprovalPolicy?.strictEvidenceRefs !== false,
                    requireContextBinding: false,
                    decisionTimeoutAt: taskApprovalPolicy?.decisionTimeoutAt ?? null
                  },
                  { path: "$.approvalPolicyForCheck" }
                )
              : taskApprovalPolicy ?? {};
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
                  kind: APPROVAL_CONTINUATION_KIND.ROUTER_LAUNCH,
                  route: { method: "POST", path: "/router/launch" },
                  authorityEnvelope,
                  approvalRequest,
                  requestBody: body,
                  requestedBy: approvalRequest.requestedBy,
                  status: APPROVAL_CONTINUATION_STATUS.PENDING,
                  resume: {
                    taskId,
                    rfqId,
                    dispatchNow: launchApprovalContinuationOptions?.dispatchNow === true,
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
                    context: "router_launch.approval_required"
                  });
                }
              } catch (err) {
                return sendError(
                  res,
                  err?.statusCode ?? 409,
                  "router task approval persistence blocked",
                  err?.details ? { taskId, rfqId, ...err.details } : { taskId, rfqId, message: err?.message ?? null },
                  { code: err?.code ?? "APPROVAL_RECORD_PERSISTENCE_BLOCKED" }
                );
              }
            }
            return sendError(
              res,
              409,
              blockingIssue?.code === "HUMAN_APPROVAL_REQUIRED" ? "router task approval required" : "router task approval blocked",
              {
                taskId,
                rfqId,
                reasonCode: blockingIssue?.code ?? "ROUTER_LAUNCH_APPROVAL_REQUIRED",
                message: blockingIssue?.detail ?? "router task approval gate blocked launch",
                authorityEnvelope,
                approvalRequest,
                approvalContinuation,
                approvalCheck
              },
              { code: blockingIssue?.code ?? "ROUTER_LAUNCH_APPROVAL_REQUIRED" }
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
              launchId
            };
            if (
              String(currentContinuation.status ?? "") !== APPROVAL_CONTINUATION_STATUS.RESUMED ||
              String(currentContinuation?.decisionRef?.decisionHash ?? "") !== String(nextDecisionRef?.decisionHash ?? "") ||
              String(currentContinuation?.resultRef?.launchId ?? "") !== String(nextResultRef.launchId ?? "")
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
            "router task approval persistence blocked",
            err?.details ? { taskId, rfqId, ...err.details } : { taskId, rfqId, message: err?.message ?? null },
            { code: err?.code ?? "APPROVAL_RECORD_PERSISTENCE_BLOCKED" }
          );
        }

        const rfq = {
          schemaVersion: "MarketplaceRfq.v1",
          rfqId,
          tenantId,
          title:
            typeof override.title === "string" && override.title.trim() !== ""
              ? override.title.trim()
              : typeof task?.title === "string" && task.title.trim() !== ""
                ? task.title.trim()
                : requiredCapability,
          description:
            typeof override.description === "string" && override.description.trim() !== ""
              ? override.description.trim()
              : defaultDescription,
          capability: requiredCapability,
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
          metadata: taskMetadata,
          createdAt: nowAt,
          updatedAt: nowAt
        };
        rfqs.push(rfq);
        launchTasks.push({
          taskId,
          title: rfq.title,
          requiredCapability,
          rfqId,
          dependsOnTaskIds: Array.isArray(task?.dependsOnTaskIds) ? task.dependsOnTaskIds : [],
          budgetCents,
          currency,
          deadlineAt,
          candidateCount: candidateAgentIds.length,
          candidateAgentIds,
          taskWallet
        });
        ops.push({ kind: "MARKETPLACE_RFQ_UPSERT", tenantId, rfq });
        ops.push({ kind: "MARKETPLACE_RFQ_BIDS_SET", tenantId, rfqId, bids: [] });
        ops.push(
          ...buildApprovalPersistenceOps({
            tenantId,
            authorityEnvelope,
            approvalRequest,
            approvalDecision,
            approvalContinuation
          })
        );
      }

      let launch = null;
      try {
        launch = buildRouterMarketplaceLaunchV1({
          launchId,
          tenantId,
          posterAgentId,
          scope: routed.scope,
          request: {
            text: routed.text,
            asOf: routed.asOf
          },
          planRef: {
            planId: plan.planId,
            planHash: plan.planHash
          },
          tasks: launchTasks,
          metadata: launchMetadataWithProductContext,
          createdAt: nowAt
        });
      } catch (err) {
        return sendError(res, 400, "invalid router launch", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const rfqsWithLaunchHash = rfqs.map((rfq) => {
        const metadata =
          rfq?.metadata && typeof rfq.metadata === "object" && !Array.isArray(rfq.metadata) ? rfq.metadata : null;
        const routerLaunch =
          metadata?.routerLaunch && typeof metadata.routerLaunch === "object" && !Array.isArray(metadata.routerLaunch)
            ? metadata.routerLaunch
            : null;
        if (!metadata || !routerLaunch) return rfq;
        return {
          ...rfq,
          metadata: normalizeForCanonicalJson(
            {
              ...metadata,
              routerLaunch: {
                ...routerLaunch,
                launchHash: launch.launchHash
              }
            },
            { path: "$.metadata" }
          )
        };
      });
      const rfqById = new Map(rfqsWithLaunchHash.map((rfq) => [String(rfq.rfqId ?? ""), rfq]));
      for (const op of ops) {
        if (op?.kind !== "MARKETPLACE_RFQ_UPSERT") continue;
        const nextRfq = rfqById.get(String(op?.rfq?.rfqId ?? ""));
        if (nextRfq) op.rfq = nextRfq;
      }

      const responseBody = {
        ok: true,
        launch,
        plan,
        rfqs: rfqsWithLaunchHash.map((rfq) => toMarketplaceRfqResponse(rfq))
      };
      if (idemStoreKey) {
        ops.push({
          kind: "IDEMPOTENCY_PUT",
          key: idemStoreKey,
          value: { requestHash: idemRequestHash, statusCode: 201, body: responseBody }
        });
      }
      await commitTx(ops);
      return sendJson(res, 201, responseBody);
    }

    const routerLaunchStatusMatch = req.method === "GET" ? /^\/router\/launches\/([^/]+)\/status$/.exec(path) : null;
    if (req.method === "GET" && routerLaunchStatusMatch) {
      let launchId = null;
      try {
        launchId = parseRouterLaunchId(decodeURIComponent(routerLaunchStatusMatch[1] ?? ""), { allowNull: false });
      } catch (err) {
        return sendError(res, 400, "invalid router launch status request", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const launchRfqs = listMarketplaceRfqsByRouterLaunchId({ tenantId, launchId });
      if (!launchRfqs.length) {
        return sendError(res, 404, "router launch not found", { launchId }, { code: "ROUTER_LAUNCH_NOT_FOUND" });
      }

      const byTaskId = new Map();
      const launchHashes = new Set();
      const planIds = new Set();
      const planHashes = new Set();
      const requestTextHashes = new Set();
      const posterAgentIds = new Set();
      for (const rfq of launchRfqs) {
        const launch = readRouterLaunchMetadataFromRfq(rfq);
        if (!launch) {
          return sendError(
            res,
            409,
            "router launch metadata is invalid",
            { launchId, rfqId: rfq?.rfqId ?? null },
            { code: "ROUTER_LAUNCH_INVALID" }
          );
        }
        if (byTaskId.has(launch.taskId)) {
          return sendError(
            res,
            409,
            "router launch contains duplicate taskIds",
            { launchId, taskId: launch.taskId },
            { code: "ROUTER_LAUNCH_INVALID" }
          );
        }
        byTaskId.set(launch.taskId, { rfq, launch });
        if (launch.launchHash) launchHashes.add(launch.launchHash);
        if (launch.planId) planIds.add(launch.planId);
        if (launch.planHash) planHashes.add(launch.planHash);
        if (launch.requestTextSha256) requestTextHashes.add(launch.requestTextSha256);
        if (typeof rfq?.posterAgentId === "string" && rfq.posterAgentId.trim() !== "") {
          posterAgentIds.add(rfq.posterAgentId.trim());
        }
      }

      if (posterAgentIds.size !== 1 || planIds.size > 1 || planHashes.size > 1 || launchHashes.size > 1 || requestTextHashes.size > 1) {
        return sendError(
          res,
          409,
          "router launch metadata is inconsistent",
          {
            launchId,
            posterAgentIds: Array.from(posterAgentIds.values()),
            planIds: Array.from(planIds.values()),
            planHashes: Array.from(planHashes.values()),
            launchHashes: Array.from(launchHashes.values()),
            requestTextHashes: Array.from(requestTextHashes.values())
          },
          { code: "ROUTER_LAUNCH_INVALID" }
        );
      }

      const tasks = [];
      for (const rfq of launchRfqs) {
        const launch = readRouterLaunchMetadataFromRfq(rfq);
        const taskId = launch?.taskId ?? null;
        const taskIndex = launch?.taskIndex ?? null;
        const dependsOnTaskIds = Array.isArray(launch?.dependsOnTaskIds) ? launch.dependsOnTaskIds : [];
        const missingDependencies = dependsOnTaskIds.filter((dependencyTaskId) => !byTaskId.has(dependencyTaskId));
        const cancelledDependencies = [];
        const pendingDependencies = [];
        if (missingDependencies.length === 0) {
          for (const dependencyTaskId of dependsOnTaskIds) {
            const dependency = byTaskId.get(dependencyTaskId);
            const dependencyStatus = String(dependency?.rfq?.status ?? "open").toLowerCase();
            if (dependencyStatus === "cancelled") {
              cancelledDependencies.push(dependencyTaskId);
              continue;
            }
            if (dependencyStatus !== "closed") pendingDependencies.push(dependencyTaskId);
          }
        }

        const bids = listMarketplaceRfqBids({ tenantId, rfqId: rfq.rfqId, status: "all" }).map((bid) => toMarketplaceBidResponse(bid));
        const acceptedBidId =
          typeof rfq?.acceptedBidId === "string" && rfq.acceptedBidId.trim() !== "" ? rfq.acceptedBidId.trim() : null;
        const acceptedBid = acceptedBidId ? bids.find((bid) => String(bid?.bidId ?? "") === acceptedBidId) ?? null : null;
        const runId = typeof rfq?.runId === "string" && rfq.runId.trim() !== "" ? rfq.runId.trim() : null;
        let run = null;
        if (runId && typeof store.getAgentRun === "function") run = await store.getAgentRun({ tenantId, runId });
        const settlement = runId ? await getAgentRunSettlementRecord({ tenantId, runId }) : null;
        const snapshot = deriveRouterLaunchStatusTaskSnapshot({
          rfqStatus: rfq?.status ?? "open",
          missingDependencies,
          cancelledDependencies,
          pendingDependencies,
          bidCount: bids.length
        });
        tasks.push({
          taskId,
          taskIndex,
          rfqId: rfq?.rfqId ?? null,
          title: typeof rfq?.title === "string" && rfq.title.trim() !== "" ? rfq.title.trim() : String(rfq?.capability ?? taskId ?? "task"),
          requiredCapability:
            typeof rfq?.capability === "string" && rfq.capability.trim() !== "" ? rfq.capability.trim() : String(taskId ?? ""),
          dependsOnTaskIds,
          candidateAgentIds: Array.isArray(launch?.candidateAgentIds) ? launch.candidateAgentIds : [],
          candidateCount: Array.isArray(launch?.candidateAgentIds) ? launch.candidateAgentIds.length : 0,
          state: snapshot.state,
          blockedByTaskIds: snapshot.blockedByTaskIds,
          rfqStatus: typeof rfq?.status === "string" && rfq.status.trim() !== "" ? rfq.status.trim().toLowerCase() : "open",
          bidCount: bids.length,
          acceptedBidId,
          runId,
          settlementStatus:
            typeof settlement?.status === "string" && settlement.status.trim() !== "" ? settlement.status.trim().toLowerCase() : null,
          disputeStatus:
            typeof settlement?.disputeStatus === "string" && settlement.disputeStatus.trim() !== ""
              ? settlement.disputeStatus.trim().toLowerCase()
              : null,
          rfq: toMarketplaceRfqResponse(rfq),
          bids,
          acceptedBid,
          run,
          settlement
        });
      }

      let status = null;
      try {
        status = buildRouterLaunchStatusV1({
          launchRef: {
            launchId,
            launchHash: Array.from(launchHashes.values())[0] ?? null,
            planId: Array.from(planIds.values())[0] ?? null,
            planHash: Array.from(planHashes.values())[0] ?? null,
            requestTextSha256: Array.from(requestTextHashes.values())[0] ?? null
          },
          tenantId,
          posterAgentId: Array.from(posterAgentIds.values())[0],
          tasks,
          generatedAt: nowIso()
        });
      } catch (err) {
        return sendError(res, 400, "invalid router launch status", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      return sendJson(res, 200, { ok: true, status });
    }

    if (req.method === "POST" && path === "/router/dispatch") {
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

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return sendError(res, 400, "invalid router dispatch request", null, { code: "SCHEMA_INVALID" });
      }

      const allowedFields = new Set([
        "launchId",
        "dispatchId",
        "taskIds",
        "acceptedByAgentId",
        "payerAgentId",
        "selectionStrategy",
        "strategy",
        "allowOverBudget"
      ]);
      const unsupportedFields = Object.keys(body).filter((key) => !allowedFields.has(key));
      if (unsupportedFields.length > 0) {
        return sendError(
          res,
          400,
          "router dispatch contains unsupported fields",
          { unsupportedFields },
          { code: "SCHEMA_INVALID" }
        );
      }

      let launchId = null;
      let dispatchId = null;
      try {
        launchId = parseRouterLaunchId(body?.launchId ?? null, { allowNull: false });
        dispatchId = parseRouterLaunchId(body?.dispatchId ?? null, { fieldPath: "dispatchId", allowNull: true }) ?? createId("rdispatch");
      } catch (err) {
        return sendError(res, 400, "invalid router dispatch request", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const acceptedByAgentId =
        body?.acceptedByAgentId === undefined || body?.acceptedByAgentId === null || String(body.acceptedByAgentId).trim() === ""
          ? null
          : typeof body.acceptedByAgentId === "string"
            ? body.acceptedByAgentId.trim()
            : null;
      if (body?.acceptedByAgentId !== undefined && body?.acceptedByAgentId !== null && acceptedByAgentId === null) {
        return sendError(res, 400, "acceptedByAgentId must be a non-empty string", null, { code: "SCHEMA_INVALID" });
      }

      const payerAgentId =
        body?.payerAgentId === undefined || body?.payerAgentId === null || String(body.payerAgentId).trim() === ""
          ? null
          : typeof body.payerAgentId === "string"
            ? body.payerAgentId.trim()
            : null;
      if (body?.payerAgentId !== undefined && body?.payerAgentId !== null && payerAgentId === null) {
        return sendError(res, 400, "payerAgentId must be a non-empty string", null, { code: "SCHEMA_INVALID" });
      }

      const selectionStrategyRaw = body?.selectionStrategy ?? body?.strategy ?? null;
      if (
        selectionStrategyRaw !== null &&
        selectionStrategyRaw !== undefined &&
        (typeof selectionStrategyRaw !== "string" || selectionStrategyRaw.trim() === "")
      ) {
        return sendError(res, 400, "selectionStrategy must be a non-empty string", null, { code: "SCHEMA_INVALID" });
      }

      if (
        body?.allowOverBudget !== undefined &&
        body?.allowOverBudget !== null &&
        typeof body.allowOverBudget !== "boolean"
      ) {
        return sendError(res, 400, "allowOverBudget must be a boolean", null, { code: "SCHEMA_INVALID" });
      }

      let requestedTaskIds = null;
      if (body?.taskIds !== undefined && body?.taskIds !== null) {
        if (!Array.isArray(body.taskIds)) {
          return sendError(res, 400, "taskIds must be an array", null, { code: "SCHEMA_INVALID" });
        }
        try {
          requestedTaskIds = [...new Set(body.taskIds.map((row, index) => parseRouterLaunchId(row, { fieldPath: `taskIds[${index}]` })))];
        } catch (err) {
          return sendError(res, 400, "invalid router dispatch request", { message: err?.message }, { code: "SCHEMA_INVALID" });
        }
        if (requestedTaskIds.length === 0) {
          return sendError(res, 400, "taskIds must include at least one taskId", null, { code: "SCHEMA_INVALID" });
        }
        requestedTaskIds.sort((left, right) => left.localeCompare(right));
      }

      const launchRfqs = listMarketplaceRfqsByRouterLaunchId({ tenantId, launchId });
      if (!launchRfqs.length) {
        return sendError(res, 404, "router launch not found", { launchId }, { code: "ROUTER_DISPATCH_LAUNCH_NOT_FOUND" });
      }

      const byTaskId = new Map();
      const launchHashes = new Set();
      const planIds = new Set();
      const planHashes = new Set();
      const requestTextHashes = new Set();
      const posterAgentIds = new Set();
      for (const rfq of launchRfqs) {
        const launch = readRouterLaunchMetadataFromRfq(rfq);
        if (!launch) {
          return sendError(
            res,
            409,
            "router dispatch launch metadata is invalid",
            { launchId, rfqId: rfq?.rfqId ?? null },
            { code: "ROUTER_DISPATCH_LAUNCH_INVALID" }
          );
        }
        if (byTaskId.has(launch.taskId)) {
          return sendError(
            res,
            409,
            "router dispatch launch contains duplicate taskIds",
            { launchId, taskId: launch.taskId },
            { code: "ROUTER_DISPATCH_LAUNCH_INVALID" }
          );
        }
        byTaskId.set(launch.taskId, { rfq, launch });
        if (launch.launchHash) launchHashes.add(launch.launchHash);
        if (launch.planId) planIds.add(launch.planId);
        if (launch.planHash) planHashes.add(launch.planHash);
        if (launch.requestTextSha256) requestTextHashes.add(launch.requestTextSha256);
        if (typeof rfq?.posterAgentId === "string" && rfq.posterAgentId.trim() !== "") posterAgentIds.add(rfq.posterAgentId.trim());
      }

      if (posterAgentIds.size !== 1 || planIds.size > 1 || planHashes.size > 1 || launchHashes.size > 1 || requestTextHashes.size > 1) {
        return sendError(
          res,
          409,
          "router dispatch launch metadata is inconsistent",
          {
            launchId,
            posterAgentIds: Array.from(posterAgentIds.values()),
            planIds: Array.from(planIds.values()),
            planHashes: Array.from(planHashes.values()),
            launchHashes: Array.from(launchHashes.values()),
            requestTextHashes: Array.from(requestTextHashes.values())
          },
          { code: "ROUTER_DISPATCH_LAUNCH_INVALID" }
        );
      }

      if (requestedTaskIds) {
        const missingTaskIds = requestedTaskIds.filter((taskId) => !byTaskId.has(taskId));
        if (missingTaskIds.length > 0) {
          return sendError(
            res,
            409,
            "router dispatch references unknown taskIds",
            { launchId, missingTaskIds, knownTaskIds: Array.from(byTaskId.keys()).sort((left, right) => left.localeCompare(right)) },
            { code: "ROUTER_DISPATCH_TASK_NOT_FOUND" }
          );
        }
      }

      const dispatchAt = nowIso();
      const selectionStrategy = selectionStrategyRaw ? String(selectionStrategyRaw).trim().toLowerCase() : "lowest_amount_then_eta";
      const allowOverBudget = body.allowOverBudget === true;
      const selectedTaskSet = requestedTaskIds ? new Set(requestedTaskIds) : null;
      const selectedLaunchRows = launchRfqs.filter((rfq) => {
        if (!selectedTaskSet) return true;
        const launch = readRouterLaunchMetadataFromRfq(rfq);
        return Boolean(launch && selectedTaskSet.has(launch.taskId));
      });
      const posterAgentId = Array.from(posterAgentIds.values())[0];

      const dispatchTasks = [];
      const results = [];
      const autoAwardStateByCode = new Map([
        ["MARKETPLACE_AUTO_AWARD_NO_PENDING_BIDS", ROUTER_MARKETPLACE_DISPATCH_STATE.BLOCKED_NO_PENDING_BIDS],
        ["MARKETPLACE_AUTO_AWARD_AMBIGUOUS", ROUTER_MARKETPLACE_DISPATCH_STATE.BLOCKED_AMBIGUOUS],
        ["MARKETPLACE_AUTO_AWARD_OVER_BUDGET", ROUTER_MARKETPLACE_DISPATCH_STATE.BLOCKED_OVER_BUDGET]
      ]);

      for (const rfq of selectedLaunchRows) {
        const launch = readRouterLaunchMetadataFromRfq(rfq);
        const taskId = launch?.taskId ?? null;
        const taskIndex = launch?.taskIndex ?? null;
        const dependsOnTaskIds = Array.isArray(launch?.dependsOnTaskIds) ? launch.dependsOnTaskIds : [];
        const blockingTaskIds = [];
        let state = ROUTER_MARKETPLACE_DISPATCH_STATE.BLOCKED_RFQ_INVALID;
        let reasonCode = "ROUTER_DISPATCH_RFQ_INVALID";
        let decisionHash = null;
        let acceptedBidId = typeof rfq?.acceptedBidId === "string" && rfq.acceptedBidId.trim() !== "" ? rfq.acceptedBidId.trim() : null;
        let runId = typeof rfq?.runId === "string" && rfq.runId.trim() !== "" ? rfq.runId.trim() : null;
        let responseDetail = {
          taskId,
          taskIndex,
          rfqId: rfq?.rfqId ?? null
        };
        let rfqStatus = String(rfq?.status ?? "open").toLowerCase();

        if (!launch || !taskId || !Number.isSafeInteger(Number(taskIndex)) || !rfq?.rfqId) {
          state = ROUTER_MARKETPLACE_DISPATCH_STATE.BLOCKED_RFQ_INVALID;
          reasonCode = "ROUTER_DISPATCH_RFQ_INVALID";
        } else if (rfqStatus === "assigned") {
          state = ROUTER_MARKETPLACE_DISPATCH_STATE.ALREADY_ASSIGNED;
          reasonCode = null;
        } else if (rfqStatus === "closed") {
          state = ROUTER_MARKETPLACE_DISPATCH_STATE.ALREADY_CLOSED;
          reasonCode = null;
        } else if (rfqStatus === "cancelled") {
          state = ROUTER_MARKETPLACE_DISPATCH_STATE.BLOCKED_RFQ_CANCELLED;
          reasonCode = "ROUTER_DISPATCH_RFQ_CANCELLED";
        } else if (rfqStatus !== "open") {
          state = ROUTER_MARKETPLACE_DISPATCH_STATE.BLOCKED_RFQ_INVALID;
          reasonCode = "ROUTER_DISPATCH_RFQ_STATUS_INVALID";
        } else {
          const missingDependencies = dependsOnTaskIds.filter((dependencyTaskId) => !byTaskId.has(dependencyTaskId));
          if (missingDependencies.length > 0) {
            blockingTaskIds.push(...missingDependencies);
            state = ROUTER_MARKETPLACE_DISPATCH_STATE.BLOCKED_DEPENDENCY_MISSING;
            reasonCode = "ROUTER_DISPATCH_DEPENDENCY_MISSING";
          } else {
            const cancelledDependencies = [];
            const pendingDependencies = [];
            for (const dependencyTaskId of dependsOnTaskIds) {
              const dependency = byTaskId.get(dependencyTaskId);
              const dependencyStatus = String(dependency?.rfq?.status ?? "open").toLowerCase();
              if (dependencyStatus === "cancelled") {
                cancelledDependencies.push(dependencyTaskId);
                continue;
              }
              if (dependencyStatus !== "closed") pendingDependencies.push(dependencyTaskId);
            }
            if (cancelledDependencies.length > 0) {
              blockingTaskIds.push(...cancelledDependencies);
              state = ROUTER_MARKETPLACE_DISPATCH_STATE.BLOCKED_DEPENDENCY_CANCELLED;
              reasonCode = "ROUTER_DISPATCH_DEPENDENCY_CANCELLED";
            } else if (pendingDependencies.length > 0) {
              blockingTaskIds.push(...pendingDependencies);
              state = ROUTER_MARKETPLACE_DISPATCH_STATE.BLOCKED_DEPENDENCIES_PENDING;
              reasonCode = "ROUTER_DISPATCH_DEPENDENCIES_PENDING";
            } else {
              try {
                const accepted = await autoAcceptMarketplaceRfqBidForRfq({
                  rfq,
                  rfqId: rfq.rfqId,
                  body: {
                    ...(acceptedByAgentId ? { acceptedByAgentId } : {}),
                    ...(payerAgentId ? { payerAgentId } : {}),
                    selectionStrategy,
                    allowOverBudget
                  }
                });
                state = ROUTER_MARKETPLACE_DISPATCH_STATE.ACCEPTED;
                reasonCode = null;
                decisionHash = accepted?.decision?.decisionHash ?? null;
                acceptedBidId = accepted?.acceptedBid?.bidId ?? accepted?.rfq?.acceptedBidId ?? acceptedBidId;
                runId = accepted?.run?.runId ?? accepted?.rfq?.runId ?? runId;
                rfqStatus = String(accepted?.rfq?.status ?? "assigned").toLowerCase();
                responseDetail = {
                  ...responseDetail,
                  decision: accepted?.decision ?? null,
                  rfq: accepted?.rfq ?? null,
                  acceptedBid: accepted?.acceptedBid ?? null,
                  run: accepted?.run ?? null,
                  settlement: accepted?.settlement ?? null,
                  agreement: accepted?.agreement ?? null,
                  offer: accepted?.offer ?? null,
                  offerAcceptance: accepted?.offerAcceptance ?? null,
                  decisionRecord: accepted?.decisionRecord ?? null,
                  settlementReceipt: accepted?.settlementReceipt ?? null
                };
              } catch (err) {
                const mappedState = autoAwardStateByCode.get(err?.code ?? "");
                if (mappedState) {
                  state = mappedState;
                  reasonCode = err?.code ?? null;
                  decisionHash =
                    err?.details?.decision && typeof err.details.decision === "object" ? err.details.decision.decisionHash ?? null : null;
                  responseDetail = {
                    ...responseDetail,
                    decision:
                      err?.details?.decision && typeof err.details.decision === "object" ? err.details.decision : null
                  };
                } else {
                  state = ROUTER_MARKETPLACE_DISPATCH_STATE.BLOCKED_ACCEPT_FAILED;
                  reasonCode = typeof err?.code === "string" && err.code.trim() !== "" ? err.code.trim() : "ROUTER_DISPATCH_ACCEPT_FAILED";
                  responseDetail = {
                    ...responseDetail,
                    error: {
                      message: err?.message ?? "router dispatch accept failed",
                      code: typeof err?.code === "string" && err.code.trim() !== "" ? err.code.trim() : null,
                      details: err?.details ?? null
                    }
                  };
                }
              }
            }
          }
        }

        dispatchTasks.push({
          taskId,
          taskIndex,
          rfqId: rfq?.rfqId ?? null,
          dependsOnTaskIds,
          state,
          reasonCode,
          rfqStatus,
          acceptedBidId,
          runId,
          decisionHash,
          blockingTaskIds
        });
        results.push(
          normalizeForCanonicalJson(
            {
              ...responseDetail,
              state,
              reasonCode,
              dependsOnTaskIds,
              blockingTaskIds,
              rfqStatus,
              acceptedBidId,
              runId,
              decisionHash
            },
            { path: `$.results[${results.length}]` }
          )
        );
      }

      let dispatch = null;
      try {
        dispatch = buildRouterMarketplaceDispatchV1({
          dispatchId,
          launchRef: {
            launchId,
            launchHash: Array.from(launchHashes.values())[0] ?? null,
            planId: Array.from(planIds.values())[0] ?? null,
            planHash: Array.from(planHashes.values())[0] ?? null,
            requestTextSha256: Array.from(requestTextHashes.values())[0] ?? null
          },
          tenantId,
          posterAgentId,
          selectionStrategy,
          allowOverBudget,
          tasks: dispatchTasks,
          metadata: requestedTaskIds ? { requestedTaskIds } : null,
          dispatchedAt: dispatchAt
        });
      } catch (err) {
        return sendError(res, 400, "invalid router dispatch", { message: err?.message }, { code: "SCHEMA_INVALID" });
      }

      const responseBody = {
        ok: true,
        dispatch,
        results
      };
      if (idemStoreKey) {
        await commitTx([
          {
            kind: "IDEMPOTENCY_PUT",
            key: idemStoreKey,
            value: { requestHash: idemRequestHash, statusCode: 200, body: responseBody }
          }
        ]);
      }
      return sendJson(res, 200, responseBody);
    }

    // Check if the response was sent by a route that uses bare "return;" (e.g. SSE streams).
    if (res.writableEnded || res.headersSent) return true;

    return false;
  };
}
