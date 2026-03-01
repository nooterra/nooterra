import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const AGENT_LOCATOR_SCHEMA_VERSION = "AgentLocator.v1";

export const AGENT_LOCATOR_REASON_CODE = Object.freeze({
  MALFORMED: "AGENT_LOCATOR_MALFORMED_REF",
  NOT_FOUND: "AGENT_LOCATOR_NOT_FOUND",
  AMBIGUOUS: "AGENT_LOCATOR_AMBIGUOUS"
});

export const AGENT_LOCATOR_STATUS = Object.freeze({
  RESOLVED: "resolved",
  MALFORMED: "malformed",
  NOT_FOUND: "not_found",
  AMBIGUOUS: "ambiguous"
});

const AGENT_LOCATOR_REF_KIND = Object.freeze({
  AGENT_ID: "agent_id",
  DID: "did",
  URL: "url"
});

const AGENT_ID_PATTERN = /^[A-Za-z0-9:_-]+$/;

function createLocatorError(message, code) {
  const err = new TypeError(String(message ?? "invalid agent locator ref"));
  err.code = code;
  return err;
}

function normalizeNonEmptyString(value, name, { max = 1024 } = {}) {
  if (typeof value !== "string") throw createLocatorError(`${name} must be a string`, AGENT_LOCATOR_REASON_CODE.MALFORMED);
  const out = value.trim();
  if (!out) throw createLocatorError(`${name} must be a non-empty string`, AGENT_LOCATOR_REASON_CODE.MALFORMED);
  if (out.length > max) throw createLocatorError(`${name} must be <= ${max} chars`, AGENT_LOCATOR_REASON_CODE.MALFORMED);
  return out;
}

function normalizeAgentId(value, name) {
  const out = normalizeNonEmptyString(value, name, { max: 200 });
  if (!AGENT_ID_PATTERN.test(out)) {
    throw createLocatorError(`${name} must match ^[A-Za-z0-9:_-]+$`, AGENT_LOCATOR_REASON_CODE.MALFORMED);
  }
  return out;
}

function normalizeDid(value) {
  const out = normalizeNonEmptyString(value, "agentRef", { max: 512 });
  if (!out.startsWith("did:")) {
    throw createLocatorError("agentRef DID must start with did:", AGENT_LOCATOR_REASON_CODE.MALFORMED);
  }
  const parts = out.split(":");
  if (parts.length < 3) {
    throw createLocatorError("agentRef DID must include did:<method>:<id>", AGENT_LOCATOR_REASON_CODE.MALFORMED);
  }
  return out;
}

function normalizeUrl(value) {
  const raw = normalizeNonEmptyString(value, "agentRef", { max: 1024 });
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw createLocatorError("agentRef URL is invalid", AGENT_LOCATOR_REASON_CODE.MALFORMED);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createLocatorError("agentRef URL must use http or https", AGENT_LOCATOR_REASON_CODE.MALFORMED);
  }
  parsed.hash = "";
  const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
  parsed.pathname = normalizedPath;
  return parsed.toString();
}

function parseAgentRefKind(agentRef) {
  const raw = normalizeNonEmptyString(agentRef, "agentRef", { max: 1024 });

  if (/^agent:\/\//i.test(raw)) {
    const id = raw.slice("agent://".length);
    return {
      kind: AGENT_LOCATOR_REF_KIND.AGENT_ID,
      value: normalizeAgentId(id, "agentRef")
    };
  }

  if (/^did:/i.test(raw)) {
    return {
      kind: AGENT_LOCATOR_REF_KIND.DID,
      value: normalizeDid(raw)
    };
  }

  if (/^https?:\/\//i.test(raw)) {
    return {
      kind: AGENT_LOCATOR_REF_KIND.URL,
      value: normalizeUrl(raw)
    };
  }

  return {
    kind: AGENT_LOCATOR_REF_KIND.AGENT_ID,
    value: normalizeAgentId(raw, "agentRef")
  };
}

function normalizeOptionalString(value, { max = 512 } = {}) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const out = value.trim();
  if (!out) return null;
  if (out.length > max) return out.slice(0, max);
  return out;
}

function normalizeCandidateRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const tenantId = normalizeOptionalString(row.tenantId, { max: 200 }) ?? null;
  const agentId = normalizeOptionalString(row.agentId, { max: 200 }) ?? null;
  if (!tenantId || !agentId) return null;
  if (!AGENT_ID_PATTERN.test(agentId)) return null;

  const displayName = normalizeOptionalString(row.displayName, { max: 200 });
  const executionCoordinatorDid = normalizeOptionalString(row.executionCoordinatorDid, { max: 512 });
  const hostEndpointRaw =
    row?.host && typeof row.host === "object" && !Array.isArray(row.host)
      ? normalizeOptionalString(row.host.endpoint, { max: 1024 })
      : null;
  let hostEndpoint = null;
  if (hostEndpointRaw) {
    try {
      hostEndpoint = normalizeUrl(hostEndpointRaw);
    } catch {
      hostEndpoint = null;
    }
  }

  return {
    tenantId,
    agentId,
    displayName,
    executionCoordinatorDid,
    hostEndpoint
  };
}

function matchCandidate(parsedRef, candidate) {
  const reasons = [];
  let score = 0;

  if (parsedRef.kind === AGENT_LOCATOR_REF_KIND.AGENT_ID) {
    if (candidate.agentId === parsedRef.value) {
      score = 1000;
      reasons.push("AGENT_ID_EXACT");
    }
  }

  if (parsedRef.kind === AGENT_LOCATOR_REF_KIND.DID) {
    if (candidate.executionCoordinatorDid === parsedRef.value) {
      score = 1000;
      reasons.push("EXECUTION_COORDINATOR_DID_EXACT");
    }
  }

  if (parsedRef.kind === AGENT_LOCATOR_REF_KIND.URL) {
    if (candidate.hostEndpoint === parsedRef.value) {
      score = 1000;
      reasons.push("HOST_ENDPOINT_EXACT");
    }
  }

  const tieBreakSeed = normalizeForCanonicalJson(
    {
      schemaVersion: "AgentLocatorRankSeed.v1",
      parsedRef,
      candidate
    },
    { path: "$.rankSeed" }
  );

  return {
    score,
    matchReasons: reasons,
    tieBreakHash: sha256Hex(canonicalJsonStringify(tieBreakSeed))
  };
}

function buildLocatorBody({
  agentRef,
  parsedRef = null,
  status,
  reasonCode = null,
  rankedCandidates = [],
  resolved = null
}) {
  const normalizedBody = normalizeForCanonicalJson(
    {
      schemaVersion: AGENT_LOCATOR_SCHEMA_VERSION,
      agentRef,
      parsedRef,
      status,
      reasonCode,
      matchCount: rankedCandidates.length,
      resolved,
      candidates: rankedCandidates
    },
    { path: "$.locator" }
  );

  const deterministicHash = sha256Hex(canonicalJsonStringify(normalizedBody));
  return normalizeForCanonicalJson(
    {
      ...normalizedBody,
      deterministicHash
    },
    { path: "$.locator" }
  );
}

export function parseAgentLocatorRef(agentRef) {
  const parsedRef = parseAgentRefKind(agentRef);
  return normalizeForCanonicalJson(
    {
      kind: parsedRef.kind,
      value: parsedRef.value
    },
    { path: "$.parsedRef" }
  );
}

export function rankAgentLocatorCandidates({ parsedRef, candidates = [] } = {}) {
  if (!parsedRef || typeof parsedRef !== "object" || Array.isArray(parsedRef)) {
    throw createLocatorError("parsedRef is required", AGENT_LOCATOR_REASON_CODE.MALFORMED);
  }
  if (!Array.isArray(candidates)) {
    throw createLocatorError("candidates must be an array", AGENT_LOCATOR_REASON_CODE.MALFORMED);
  }

  const normalized = [];
  for (const row of candidates) {
    const candidate = normalizeCandidateRow(row);
    if (!candidate) continue;
    const matched = matchCandidate(parsedRef, candidate);
    if (matched.score <= 0) continue;
    normalized.push({
      ...candidate,
      score: matched.score,
      matchReasons: matched.matchReasons,
      tieBreakHash: matched.tieBreakHash
    });
  }

  normalized.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.tieBreakHash < right.tieBreakHash) return -1;
    if (left.tieBreakHash > right.tieBreakHash) return 1;
    const tenantOrder = String(left.tenantId ?? "").localeCompare(String(right.tenantId ?? ""));
    if (tenantOrder !== 0) return tenantOrder;
    return String(left.agentId ?? "").localeCompare(String(right.agentId ?? ""));
  });

  return normalized.map((row, index) =>
    normalizeForCanonicalJson(
      {
        rank: index + 1,
        score: row.score,
        tieBreakHash: row.tieBreakHash,
        matchReasons: row.matchReasons,
        tenantId: row.tenantId,
        agentId: row.agentId,
        displayName: row.displayName,
        executionCoordinatorDid: row.executionCoordinatorDid,
        hostEndpoint: row.hostEndpoint
      },
      { path: "$.candidates[]" }
    )
  );
}

export function resolveAgentLocator({ agentRef, candidates = [] } = {}) {
  const normalizedAgentRef =
    typeof agentRef === "string" ? agentRef.trim() : agentRef === null || agentRef === undefined ? "" : String(agentRef).trim();

  let parsedRef;
  try {
    parsedRef = parseAgentLocatorRef(normalizedAgentRef);
  } catch (err) {
    const reasonCode = err?.code ?? AGENT_LOCATOR_REASON_CODE.MALFORMED;
    return {
      ok: false,
      status: AGENT_LOCATOR_STATUS.MALFORMED,
      reasonCode,
      locator: buildLocatorBody({
        agentRef: normalizedAgentRef,
        parsedRef: null,
        status: AGENT_LOCATOR_STATUS.MALFORMED,
        reasonCode,
        rankedCandidates: [],
        resolved: null
      }),
      resolved: null
    };
  }

  const rankedCandidates = rankAgentLocatorCandidates({ parsedRef, candidates });
  if (!rankedCandidates.length) {
    const reasonCode = AGENT_LOCATOR_REASON_CODE.NOT_FOUND;
    return {
      ok: false,
      status: AGENT_LOCATOR_STATUS.NOT_FOUND,
      reasonCode,
      locator: buildLocatorBody({
        agentRef: normalizedAgentRef,
        parsedRef,
        status: AGENT_LOCATOR_STATUS.NOT_FOUND,
        reasonCode,
        rankedCandidates,
        resolved: null
      }),
      resolved: null
    };
  }

  const topScore = rankedCandidates[0].score;
  const topCandidates = rankedCandidates.filter((row) => row.score === topScore);
  if (topCandidates.length > 1) {
    const reasonCode = AGENT_LOCATOR_REASON_CODE.AMBIGUOUS;
    return {
      ok: false,
      status: AGENT_LOCATOR_STATUS.AMBIGUOUS,
      reasonCode,
      locator: buildLocatorBody({
        agentRef: normalizedAgentRef,
        parsedRef,
        status: AGENT_LOCATOR_STATUS.AMBIGUOUS,
        reasonCode,
        rankedCandidates,
        resolved: null
      }),
      resolved: null
    };
  }

  const winner = rankedCandidates[0];
  const resolved = normalizeForCanonicalJson(
    {
      tenantId: winner.tenantId,
      agentId: winner.agentId,
      displayName: winner.displayName,
      executionCoordinatorDid: winner.executionCoordinatorDid,
      hostEndpoint: winner.hostEndpoint
    },
    { path: "$.resolved" }
  );

  return {
    ok: true,
    status: AGENT_LOCATOR_STATUS.RESOLVED,
    reasonCode: null,
    locator: buildLocatorBody({
      agentRef: normalizedAgentRef,
      parsedRef,
      status: AGENT_LOCATOR_STATUS.RESOLVED,
      reasonCode: null,
      rankedCandidates,
      resolved
    }),
    resolved
  };
}
