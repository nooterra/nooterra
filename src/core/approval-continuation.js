import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";
import { validateApprovalRequestV1, validateAuthorityEnvelopeV1 } from "./authority-envelope.js";

export const APPROVAL_CONTINUATION_SCHEMA_VERSION = "ApprovalContinuation.v1";

export const APPROVAL_CONTINUATION_KIND = Object.freeze({
  ROUTER_LAUNCH: "router_launch",
  MARKETPLACE_RFQ: "marketplace_rfq",
  WORK_ORDER: "work_order"
});

export const APPROVAL_CONTINUATION_STATUS = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  DENIED: "denied",
  RESUMED: "resumed"
});

const KIND_SET = new Set(Object.values(APPROVAL_CONTINUATION_KIND));
const STATUS_SET = new Set(Object.values(APPROVAL_CONTINUATION_STATUS));
const ROUTE_PATH_SET = new Set(["/router/launch", "/marketplace/rfqs", "/work-orders"]);
const ROUTE_METHOD_SET = new Set(["POST"]);

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be a plain object`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`${name} must be a plain object`);
}

function assertNonEmptyString(value, name, { max = 5000 } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeOptionalString(value, name, { max = 5000 } = {}) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeId(value, name, { max = 200 } = {}) {
  const normalized = assertNonEmptyString(value, name, { max });
  if (!/^[A-Za-z0-9:_/-]+$/.test(normalized)) throw new TypeError(`${name} must match ^[A-Za-z0-9:_/-]+$`);
  return normalized;
}

function normalizeIsoDateTime(value, name, { allowNull = false } = {}) {
  if (allowNull && (value === null || value === undefined || String(value).trim() === "")) return null;
  const normalized = assertNonEmptyString(value, name, { max: 128 });
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${name} must be an ISO date-time`);
  return normalized;
}

function normalizeHash(value, name) {
  const normalized = assertNonEmptyString(value, name, { max: 64 }).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError(`${name} must be a 64-char lowercase sha256`);
  return normalized;
}

function normalizeKind(value) {
  const normalized = assertNonEmptyString(value, "kind", { max: 64 }).toLowerCase();
  if (!KIND_SET.has(normalized)) throw new TypeError(`kind must be one of ${Array.from(KIND_SET).join("|")}`);
  return normalized;
}

function normalizeStatus(value) {
  const normalized =
    value === null || value === undefined || String(value).trim() === ""
      ? APPROVAL_CONTINUATION_STATUS.PENDING
      : assertNonEmptyString(value, "status", { max: 64 }).toLowerCase();
  if (!STATUS_SET.has(normalized)) throw new TypeError(`status must be one of ${Array.from(STATUS_SET).join("|")}`);
  return normalized;
}

function normalizeRoute(value) {
  assertPlainObject(value, "route");
  const method = assertNonEmptyString(value.method, "route.method", { max: 16 }).toUpperCase();
  if (!ROUTE_METHOD_SET.has(method)) throw new TypeError(`route.method must be one of ${Array.from(ROUTE_METHOD_SET).join("|")}`);
  const path = assertNonEmptyString(value.path, "route.path", { max: 200 });
  if (!ROUTE_PATH_SET.has(path)) throw new TypeError(`route.path must be one of ${Array.from(ROUTE_PATH_SET).join("|")}`);
  return normalizeForCanonicalJson({ method, path }, { path: "$.route" });
}

function normalizeRequestBody(value) {
  assertPlainObject(value, "requestBody");
  return normalizeForCanonicalJson(value, { path: "$.requestBody" });
}

function normalizeResume(value) {
  if (value === null || value === undefined) {
    return normalizeForCanonicalJson(
      {
        taskId: null,
        rfqId: null,
        workOrderId: null,
        dispatchNow: false,
        approvalPath: null
      },
      { path: "$.resume" }
    );
  }
  assertPlainObject(value, "resume");
  return normalizeForCanonicalJson(
    {
      taskId: normalizeOptionalString(value.taskId, "resume.taskId", { max: 200 }),
      rfqId: normalizeOptionalString(value.rfqId, "resume.rfqId", { max: 200 }),
      workOrderId: normalizeOptionalString(value.workOrderId, "resume.workOrderId", { max: 200 }),
      dispatchNow: value.dispatchNow === true,
      approvalPath: normalizeOptionalString(value.approvalPath, "resume.approvalPath", { max: 500 })
    },
    { path: "$.resume" }
  );
}

function normalizeDecisionRef(value) {
  if (value === null || value === undefined) return null;
  assertPlainObject(value, "decisionRef");
  return normalizeForCanonicalJson(
    {
      decisionId: normalizeId(value.decisionId, "decisionRef.decisionId"),
      decisionHash: normalizeHash(value.decisionHash, "decisionRef.decisionHash"),
      approved: value.approved === true,
      decidedAt: normalizeIsoDateTime(value.decidedAt, "decisionRef.decidedAt")
    },
    { path: "$.decisionRef" }
  );
}

function normalizeResultRef(value) {
  if (value === null || value === undefined) return null;
  assertPlainObject(value, "resultRef");
  return normalizeForCanonicalJson(
    {
      launchId: normalizeOptionalString(value.launchId, "resultRef.launchId", { max: 200 }),
      rfqId: normalizeOptionalString(value.rfqId, "resultRef.rfqId", { max: 200 }),
      workOrderId: normalizeOptionalString(value.workOrderId, "resultRef.workOrderId", { max: 200 }),
      dispatchId: normalizeOptionalString(value.dispatchId, "resultRef.dispatchId", { max: 200 }),
      runId: normalizeOptionalString(value.runId, "resultRef.runId", { max: 200 })
    },
    { path: "$.resultRef" }
  );
}

export function computeApprovalContinuationHashV1(approvalContinuation) {
  assertPlainObject(approvalContinuation, "approvalContinuation");
  const copy = { ...approvalContinuation };
  delete copy.continuationHash;
  return sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(copy, { path: "$" })));
}

export function buildApprovalContinuationV1({
  requestId,
  kind,
  route,
  authorityEnvelope,
  approvalRequest,
  requestBody,
  requestedBy = null,
  status = APPROVAL_CONTINUATION_STATUS.PENDING,
  resume = null,
  decisionRef = null,
  resultRef = null,
  createdAt = new Date().toISOString(),
  updatedAt = null,
  resumedAt = null
} = {}) {
  validateAuthorityEnvelopeV1(authorityEnvelope);
  validateApprovalRequestV1(approvalRequest);
  const normalizedRequestId = normalizeId(requestId ?? approvalRequest?.requestId, "requestId");
  if (approvalRequest.requestId !== normalizedRequestId) {
    throw new TypeError("approvalRequest.requestId must match requestId");
  }
  if (approvalRequest.envelopeRef?.envelopeId !== authorityEnvelope.envelopeId) {
    throw new TypeError("approvalRequest.envelopeRef.envelopeId must match authorityEnvelope.envelopeId");
  }
  if (approvalRequest.envelopeRef?.envelopeHash !== authorityEnvelope.envelopeHash) {
    throw new TypeError("approvalRequest.envelopeRef.envelopeHash must match authorityEnvelope.envelopeHash");
  }
  const body = normalizeForCanonicalJson(
    {
      schemaVersion: APPROVAL_CONTINUATION_SCHEMA_VERSION,
      requestId: normalizedRequestId,
      kind: normalizeKind(kind),
      status: normalizeStatus(status),
      route: normalizeRoute(route),
      requestedBy: normalizeOptionalString(requestedBy ?? approvalRequest.requestedBy, "requestedBy", { max: 200 }),
      authorityEnvelope: normalizeForCanonicalJson(authorityEnvelope, { path: "$.authorityEnvelope" }),
      approvalRequest: normalizeForCanonicalJson(approvalRequest, { path: "$.approvalRequest" }),
      requestBody: normalizeRequestBody(requestBody),
      resume: normalizeResume(resume),
      decisionRef: normalizeDecisionRef(decisionRef),
      resultRef: normalizeResultRef(resultRef),
      createdAt: normalizeIsoDateTime(createdAt, "createdAt"),
      updatedAt: updatedAt === null || updatedAt === undefined ? null : normalizeIsoDateTime(updatedAt, "updatedAt"),
      resumedAt: normalizeIsoDateTime(resumedAt, "resumedAt", { allowNull: true }),
      continuationHash: null
    },
    { path: "$" }
  );
  return normalizeForCanonicalJson(
    {
      ...body,
      continuationHash: computeApprovalContinuationHashV1(body)
    },
    { path: "$" }
  );
}

export function validateApprovalContinuationV1(approvalContinuation) {
  assertPlainObject(approvalContinuation, "approvalContinuation");
  if (approvalContinuation.schemaVersion !== APPROVAL_CONTINUATION_SCHEMA_VERSION) {
    throw new TypeError(`approvalContinuation.schemaVersion must be ${APPROVAL_CONTINUATION_SCHEMA_VERSION}`);
  }
  normalizeId(approvalContinuation.requestId, "approvalContinuation.requestId");
  normalizeKind(approvalContinuation.kind);
  normalizeStatus(approvalContinuation.status);
  normalizeRoute(approvalContinuation.route);
  validateAuthorityEnvelopeV1(approvalContinuation.authorityEnvelope);
  validateApprovalRequestV1(approvalContinuation.approvalRequest);
  normalizeRequestBody(approvalContinuation.requestBody);
  normalizeResume(approvalContinuation.resume);
  if (approvalContinuation.decisionRef !== null && approvalContinuation.decisionRef !== undefined) {
    normalizeDecisionRef(approvalContinuation.decisionRef);
  }
  if (approvalContinuation.resultRef !== null && approvalContinuation.resultRef !== undefined) {
    normalizeResultRef(approvalContinuation.resultRef);
  }
  normalizeIsoDateTime(approvalContinuation.createdAt, "approvalContinuation.createdAt");
  if (approvalContinuation.updatedAt !== null && approvalContinuation.updatedAt !== undefined) {
    normalizeIsoDateTime(approvalContinuation.updatedAt, "approvalContinuation.updatedAt");
  }
  if (approvalContinuation.resumedAt !== null && approvalContinuation.resumedAt !== undefined) {
    normalizeIsoDateTime(approvalContinuation.resumedAt, "approvalContinuation.resumedAt");
  }
  const computed = computeApprovalContinuationHashV1(approvalContinuation);
  if (approvalContinuation.continuationHash !== computed) throw new TypeError("approvalContinuation.continuationHash mismatch");
  return true;
}

export function patchApprovalContinuationV1(approvalContinuation, updates = {}) {
  validateApprovalContinuationV1(approvalContinuation);
  const next = {
    ...approvalContinuation,
    ...updates,
    authorityEnvelope:
      updates.authorityEnvelope && typeof updates.authorityEnvelope === "object" && !Array.isArray(updates.authorityEnvelope)
        ? updates.authorityEnvelope
        : approvalContinuation.authorityEnvelope,
    approvalRequest:
      updates.approvalRequest && typeof updates.approvalRequest === "object" && !Array.isArray(updates.approvalRequest)
        ? updates.approvalRequest
        : approvalContinuation.approvalRequest,
    requestBody:
      updates.requestBody && typeof updates.requestBody === "object" && !Array.isArray(updates.requestBody)
        ? updates.requestBody
        : approvalContinuation.requestBody,
    resume:
      updates.resume && typeof updates.resume === "object" && !Array.isArray(updates.resume)
        ? { ...(approvalContinuation.resume ?? {}), ...updates.resume }
        : approvalContinuation.resume
  };
  return buildApprovalContinuationV1({
    requestId: next.requestId,
    kind: next.kind,
    route: next.route,
    authorityEnvelope: next.authorityEnvelope,
    approvalRequest: next.approvalRequest,
    requestBody: next.requestBody,
    requestedBy: next.requestedBy,
    status: next.status,
    resume: next.resume,
    decisionRef: next.decisionRef,
    resultRef: next.resultRef,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt ?? new Date().toISOString(),
    resumedAt: next.resumedAt
  });
}
