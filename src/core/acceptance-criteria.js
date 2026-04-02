import { normalizeForCanonicalJson } from "./canonical-json.js";

export const ACCEPTANCE_CRITERION_KIND_V1 = Object.freeze({
  PROOF_STATUS_EQUALS: "PROOF_STATUS_EQUALS",
  SLA_OVERALL_OK: "SLA_OVERALL_OK"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError(`${name} must be a plain object`);
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

export function deriveAcceptanceCriteriaV1({ generatedAt, job, slaEvaluation }) {
  assertNonEmptyString(generatedAt, "generatedAt");
  assertPlainObject(job, "job");
  if (slaEvaluation !== null && slaEvaluation !== undefined) assertPlainObject(slaEvaluation, "slaEvaluation");

  const criteria = [];
  criteria.push({ criterionId: "proof_status_pass", kind: ACCEPTANCE_CRITERION_KIND_V1.PROOF_STATUS_EQUALS, expectedStatus: "PASS" });
  if (slaEvaluation) criteria.push({ criterionId: "sla_overall_ok", kind: ACCEPTANCE_CRITERION_KIND_V1.SLA_OVERALL_OK });

  criteria.sort((a, b) => String(a.criterionId ?? "").localeCompare(String(b.criterionId ?? "")));
  return normalizeForCanonicalJson({ schemaVersion: "AcceptanceCriteria.v1", generatedAt, criteria }, { path: "$" });
}

export function evaluateAcceptanceCriteriaV1({ generatedAt, job, acceptanceCriteria, slaEvaluation }) {
  assertNonEmptyString(generatedAt, "generatedAt");
  assertPlainObject(job, "job");
  assertPlainObject(acceptanceCriteria, "acceptanceCriteria");
  if (acceptanceCriteria.schemaVersion !== "AcceptanceCriteria.v1") throw new TypeError("unsupported acceptanceCriteria.schemaVersion");
  if (slaEvaluation !== null && slaEvaluation !== undefined) assertPlainObject(slaEvaluation, "slaEvaluation");

  const results = [];
  for (const c of Array.isArray(acceptanceCriteria.criteria) ? acceptanceCriteria.criteria : []) {
    if (!c || typeof c !== "object") continue;
    const criterionId = String(c.criterionId ?? "");
    const kind = String(c.kind ?? "");
    if (!criterionId || !kind) continue;

    if (kind === ACCEPTANCE_CRITERION_KIND_V1.PROOF_STATUS_EQUALS) {
      const expectedStatus = typeof c.expectedStatus === "string" && c.expectedStatus.trim() ? c.expectedStatus.trim() : null;
      const actualStatus = typeof job?.proof?.status === "string" ? job.proof.status : null;
      if (!expectedStatus || !actualStatus) {
        results.push({ criterionId, kind, status: "unknown", detail: { expectedStatus, actualStatus } });
      } else {
        const ok = actualStatus === expectedStatus;
        results.push({ criterionId, kind, status: ok ? "ok" : "fail", detail: { expectedStatus, actualStatus } });
      }
      continue;
    }

    if (kind === ACCEPTANCE_CRITERION_KIND_V1.SLA_OVERALL_OK) {
      const overallStatus = typeof slaEvaluation?.overallStatus === "string" ? slaEvaluation.overallStatus : null;
      if (!overallStatus) {
        results.push({ criterionId, kind, status: "unknown", detail: { overallStatus: null } });
      } else {
        const ok = overallStatus === "ok";
        results.push({ criterionId, kind, status: ok ? "ok" : "fail", detail: { overallStatus } });
      }
      continue;
    }

    results.push({ criterionId, kind, status: "unknown", detail: { reason: "unsupported criterion kind" } });
  }

  results.sort((a, b) => String(a.criterionId ?? "").localeCompare(String(b.criterionId ?? "")));

  let overallStatus = "ok";
  if (results.some((r) => r.status === "fail")) overallStatus = "fail";
  else if (results.some((r) => r.status === "unknown")) overallStatus = "unknown";

  return normalizeForCanonicalJson({ schemaVersion: "AcceptanceEvaluation.v1", generatedAt, overallStatus, results }, { path: "$" });
}

