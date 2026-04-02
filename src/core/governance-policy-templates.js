import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const GOVERNANCE_POLICY_TEMPLATE_SCHEMA_VERSION = "GovernancePolicyTemplate.v1";
export const GOVERNANCE_POLICY_TEMPLATE_CATALOG_SCHEMA_VERSION = "GovernancePolicyTemplateCatalog.v1";
export const GOVERNANCE_POLICY_DECISION_SCHEMA_VERSION = "GovernancePolicyDecision.v1";

export const OPERATING_PROFILE = Object.freeze({
  INDIE: "indie",
  SMB: "smb",
  ENTERPRISE: "enterprise"
});

const RISK_LEVEL = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical"
});

const DATA_CLASS = Object.freeze({
  PUBLIC: "public",
  INTERNAL: "internal",
  CONFIDENTIAL: "confidential",
  RESTRICTED: "restricted"
});

export const GOVERNANCE_POLICY_DECISION_CODE = Object.freeze({
  TEMPLATE_INVALID: "POLICY_TEMPLATE_INVALID",
  REQUEST_INVALID: "POLICY_REQUEST_INVALID",
  PER_ACTION_LIMIT_EXCEEDED: "PER_ACTION_LIMIT_EXCEEDED",
  MONTHLY_LIMIT_EXCEEDED: "MONTHLY_LIMIT_EXCEEDED",
  DATA_CLASS_FORBIDDEN: "DATA_CLASS_FORBIDDEN",
  EXTERNAL_TRANSFER_FORBIDDEN: "EXTERNAL_TRANSFER_FORBIDDEN",
  APPROVAL_THRESHOLD_NOT_MET: "APPROVAL_THRESHOLD_NOT_MET",
  RISK_APPROVAL_REQUIRED: "RISK_APPROVAL_REQUIRED",
  RISK_LEVEL_BLOCKED: "RISK_LEVEL_BLOCKED",
  POLICY_TEMPLATE_TIER_GAP: "POLICY_TEMPLATE_TIER_GAP"
});

const TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;
const ALLOWED_RISK_LEVELS = new Set(Object.values(RISK_LEVEL));
const ALLOWED_DATA_CLASSES = new Set(Object.values(DATA_CLASS));
const ALLOWED_OPERATING_PROFILES = new Set(Object.values(OPERATING_PROFILE));

const STARTER_TEMPLATE_SEEDS = Object.freeze([
  Object.freeze({
    templateId: "gov.indie.safe-default",
    templateVersion: 1,
    operatingProfile: OPERATING_PROFILE.INDIE,
    name: "Indie Safe Default",
    description: "Lean controls for solo builders with strict fail-closed limits.",
    controls: Object.freeze({
      spend: Object.freeze({
        currency: "USD",
        perActionUsdCents: 25_000,
        monthlyUsdCents: 300_000
      }),
      dataAccess: Object.freeze({
        allowedDataClasses: Object.freeze([DATA_CLASS.PUBLIC, DATA_CLASS.INTERNAL]),
        allowExternalTransfer: false
      }),
      approvals: Object.freeze({
        tiers: Object.freeze([
          Object.freeze({ tierId: "auto", maxAmountUsdCents: 10_000, requiredApprovers: 0, approverRole: "none" }),
          Object.freeze({ tierId: "owner", maxAmountUsdCents: 25_000, requiredApprovers: 1, approverRole: "owner" })
        ])
      }),
      escalation: Object.freeze({
        requireApprovalForRiskLevels: Object.freeze([RISK_LEVEL.HIGH, RISK_LEVEL.CRITICAL]),
        autoBlockRiskLevels: Object.freeze([RISK_LEVEL.CRITICAL])
      })
    })
  }),
  Object.freeze({
    templateId: "gov.smb.balanced-controls",
    templateVersion: 1,
    operatingProfile: OPERATING_PROFILE.SMB,
    name: "SMB Balanced Controls",
    description: "Balanced controls for growing teams with deterministic approval ladders.",
    controls: Object.freeze({
      spend: Object.freeze({
        currency: "USD",
        perActionUsdCents: 150_000,
        monthlyUsdCents: 1_500_000
      }),
      dataAccess: Object.freeze({
        allowedDataClasses: Object.freeze([DATA_CLASS.PUBLIC, DATA_CLASS.INTERNAL, DATA_CLASS.CONFIDENTIAL]),
        allowExternalTransfer: false
      }),
      approvals: Object.freeze({
        tiers: Object.freeze([
          Object.freeze({ tierId: "auto", maxAmountUsdCents: 40_000, requiredApprovers: 0, approverRole: "none" }),
          Object.freeze({ tierId: "manager", maxAmountUsdCents: 100_000, requiredApprovers: 1, approverRole: "team_manager" }),
          Object.freeze({ tierId: "director", maxAmountUsdCents: 150_000, requiredApprovers: 2, approverRole: "operations_director" })
        ])
      }),
      escalation: Object.freeze({
        requireApprovalForRiskLevels: Object.freeze([RISK_LEVEL.HIGH, RISK_LEVEL.CRITICAL]),
        autoBlockRiskLevels: Object.freeze([RISK_LEVEL.CRITICAL])
      })
    })
  }),
  Object.freeze({
    templateId: "gov.enterprise.strict-controls",
    templateVersion: 1,
    operatingProfile: OPERATING_PROFILE.ENTERPRISE,
    name: "Enterprise Strict Controls",
    description: "Conservative controls for regulated environments and multi-team governance.",
    controls: Object.freeze({
      spend: Object.freeze({
        currency: "USD",
        perActionUsdCents: 500_000,
        monthlyUsdCents: 8_000_000
      }),
      dataAccess: Object.freeze({
        allowedDataClasses: Object.freeze([DATA_CLASS.PUBLIC, DATA_CLASS.INTERNAL, DATA_CLASS.CONFIDENTIAL]),
        allowExternalTransfer: false
      }),
      approvals: Object.freeze({
        tiers: Object.freeze([
          Object.freeze({ tierId: "manager", maxAmountUsdCents: 100_000, requiredApprovers: 1, approverRole: "manager" }),
          Object.freeze({ tierId: "director", maxAmountUsdCents: 300_000, requiredApprovers: 2, approverRole: "director" }),
          Object.freeze({ tierId: "executive", maxAmountUsdCents: 500_000, requiredApprovers: 3, approverRole: "executive" })
        ])
      }),
      escalation: Object.freeze({
        requireApprovalForRiskLevels: Object.freeze([RISK_LEVEL.MEDIUM, RISK_LEVEL.HIGH, RISK_LEVEL.CRITICAL]),
        autoBlockRiskLevels: Object.freeze([RISK_LEVEL.CRITICAL])
      })
    })
  })
]);

function deepClone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeNonEmptyString(value, fieldPath) {
  const out = typeof value === "string" ? value.trim() : "";
  if (!out) throw new TypeError(`${fieldPath} is required`);
  return out;
}

function normalizeSafeInt(value, fieldPath, { min = 0 } = {}) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < min) throw new TypeError(`${fieldPath} must be a safe integer >= ${min}`);
  return out;
}

function normalizeStringList(value, fieldPath) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${fieldPath} must be a non-empty array`);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    const itemPath = `${fieldPath}[${i}]`;
    const item = normalizeNonEmptyString(value[i], itemPath).toLowerCase();
    if (seen.has(item)) throw new TypeError(`${itemPath} must not contain duplicates`);
    seen.add(item);
    out.push(item);
  }
  return out;
}

function normalizeApprovalTiers(value, fieldPath) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${fieldPath} must be a non-empty array`);
  const tiers = [];
  let previousMax = -1;
  for (let i = 0; i < value.length; i += 1) {
    const tierPath = `${fieldPath}[${i}]`;
    const raw = value[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TypeError(`${tierPath} must be an object`);
    }
    const tier = {
      tierId: normalizeNonEmptyString(raw.tierId, `${tierPath}.tierId`).toLowerCase(),
      maxAmountUsdCents: normalizeSafeInt(raw.maxAmountUsdCents, `${tierPath}.maxAmountUsdCents`, { min: 0 }),
      requiredApprovers: normalizeSafeInt(raw.requiredApprovers, `${tierPath}.requiredApprovers`, { min: 0 }),
      approverRole: normalizeNonEmptyString(raw.approverRole, `${tierPath}.approverRole`)
    };
    if (tier.maxAmountUsdCents <= previousMax) {
      throw new TypeError(`${tierPath}.maxAmountUsdCents must increase monotonically`);
    }
    previousMax = tier.maxAmountUsdCents;
    tiers.push(tier);
  }
  return tiers;
}

function computeTemplateHashCore({ templateId, templateVersion, operatingProfile, name, description, controls }) {
  const canonical = canonicalJsonStringify(
    normalizeForCanonicalJson(
      {
        templateId,
        templateVersion,
        operatingProfile,
        name,
        description,
        controls
      },
      { path: "$" }
    )
  );
  return sha256Hex(canonical);
}

function normalizeGovernancePolicyTemplateInternal(input, { fieldPath = "template", requireTemplateHash = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError(`${fieldPath} must be an object`);
  const templateId = normalizeNonEmptyString(input.templateId, `${fieldPath}.templateId`).toLowerCase();
  if (!TEMPLATE_ID_PATTERN.test(templateId)) {
    throw new TypeError(`${fieldPath}.templateId must match /^[a-z][a-z0-9._-]{2,63}$/`);
  }
  const templateVersion = normalizeSafeInt(input.templateVersion, `${fieldPath}.templateVersion`, { min: 1 });
  const operatingProfile = normalizeNonEmptyString(input.operatingProfile, `${fieldPath}.operatingProfile`).toLowerCase();
  if (!ALLOWED_OPERATING_PROFILES.has(operatingProfile)) {
    throw new TypeError(`${fieldPath}.operatingProfile must be indie|smb|enterprise`);
  }
  const name = normalizeNonEmptyString(input.name, `${fieldPath}.name`);
  const description = normalizeNonEmptyString(input.description, `${fieldPath}.description`);
  const controlsRaw = input.controls;
  if (!controlsRaw || typeof controlsRaw !== "object" || Array.isArray(controlsRaw)) throw new TypeError(`${fieldPath}.controls must be an object`);

  const spendRaw = controlsRaw.spend;
  if (!spendRaw || typeof spendRaw !== "object" || Array.isArray(spendRaw)) throw new TypeError(`${fieldPath}.controls.spend must be an object`);
  const spend = {
    currency: normalizeNonEmptyString(spendRaw.currency, `${fieldPath}.controls.spend.currency`).toUpperCase(),
    perActionUsdCents: normalizeSafeInt(spendRaw.perActionUsdCents, `${fieldPath}.controls.spend.perActionUsdCents`, { min: 1 }),
    monthlyUsdCents: normalizeSafeInt(spendRaw.monthlyUsdCents, `${fieldPath}.controls.spend.monthlyUsdCents`, { min: 1 })
  };
  if (spend.perActionUsdCents > spend.monthlyUsdCents) {
    throw new TypeError(`${fieldPath}.controls.spend.perActionUsdCents must be <= monthlyUsdCents`);
  }

  const dataAccessRaw = controlsRaw.dataAccess;
  if (!dataAccessRaw || typeof dataAccessRaw !== "object" || Array.isArray(dataAccessRaw)) {
    throw new TypeError(`${fieldPath}.controls.dataAccess must be an object`);
  }
  const allowedDataClasses = normalizeStringList(dataAccessRaw.allowedDataClasses, `${fieldPath}.controls.dataAccess.allowedDataClasses`);
  for (const dataClass of allowedDataClasses) {
    if (!ALLOWED_DATA_CLASSES.has(dataClass)) {
      throw new TypeError(`${fieldPath}.controls.dataAccess.allowedDataClasses contains unsupported class: ${dataClass}`);
    }
  }
  const dataAccess = {
    allowedDataClasses,
    allowExternalTransfer: dataAccessRaw.allowExternalTransfer === true
  };

  const approvalsRaw = controlsRaw.approvals;
  if (!approvalsRaw || typeof approvalsRaw !== "object" || Array.isArray(approvalsRaw)) {
    throw new TypeError(`${fieldPath}.controls.approvals must be an object`);
  }
  const approvals = {
    tiers: normalizeApprovalTiers(approvalsRaw.tiers, `${fieldPath}.controls.approvals.tiers`)
  };
  const highestTier = approvals.tiers[approvals.tiers.length - 1];
  if (highestTier.maxAmountUsdCents < spend.perActionUsdCents) {
    throw new TypeError(`${fieldPath}.controls.approvals.tiers must cover controls.spend.perActionUsdCents`);
  }

  const escalationRaw = controlsRaw.escalation;
  if (!escalationRaw || typeof escalationRaw !== "object" || Array.isArray(escalationRaw)) {
    throw new TypeError(`${fieldPath}.controls.escalation must be an object`);
  }
  const requireApprovalForRiskLevels = normalizeStringList(
    escalationRaw.requireApprovalForRiskLevels,
    `${fieldPath}.controls.escalation.requireApprovalForRiskLevels`
  );
  const autoBlockRiskLevels = normalizeStringList(escalationRaw.autoBlockRiskLevels, `${fieldPath}.controls.escalation.autoBlockRiskLevels`);
  for (const riskLevel of [...requireApprovalForRiskLevels, ...autoBlockRiskLevels]) {
    if (!ALLOWED_RISK_LEVELS.has(riskLevel)) {
      throw new TypeError(`${fieldPath}.controls.escalation contains unsupported risk level: ${riskLevel}`);
    }
  }
  const escalation = {
    requireApprovalForRiskLevels,
    autoBlockRiskLevels
  };

  const controls = { spend, dataAccess, approvals, escalation };
  const templateHashExpected = computeTemplateHashCore({ templateId, templateVersion, operatingProfile, name, description, controls });
  const templateHashInput =
    input.templateHash === null || input.templateHash === undefined || String(input.templateHash).trim() === ""
      ? null
      : String(input.templateHash).trim().toLowerCase();
  if (templateHashInput !== null && !/^[a-f0-9]{64}$/.test(templateHashInput)) {
    throw new TypeError(`${fieldPath}.templateHash must be a sha256 hex when provided`);
  }
  if (templateHashInput !== null && templateHashInput !== templateHashExpected) {
    throw new TypeError(`${fieldPath}.templateHash mismatch`);
  }
  if (requireTemplateHash && templateHashInput === null) {
    throw new TypeError(`${fieldPath}.templateHash is required`);
  }

  return normalizeForCanonicalJson(
    {
      schemaVersion: GOVERNANCE_POLICY_TEMPLATE_SCHEMA_VERSION,
      templateId,
      templateVersion,
      operatingProfile,
      name,
      description,
      controls,
      templateHash: templateHashInput ?? templateHashExpected
    },
    { path: "$" }
  );
}

function normalizeDecisionRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new TypeError("request must be an object");
  const amountUsdCents = normalizeSafeInt(request.amountUsdCents, "request.amountUsdCents", { min: 1 });
  const monthlySpendUsdCents = normalizeSafeInt(request.monthlySpendUsdCents ?? 0, "request.monthlySpendUsdCents", { min: 0 });
  const dataClass = normalizeNonEmptyString(request.dataClass, "request.dataClass").toLowerCase();
  if (!ALLOWED_DATA_CLASSES.has(dataClass)) throw new TypeError("request.dataClass must be public|internal|confidential|restricted");
  const riskLevel = normalizeNonEmptyString(request.riskLevel, "request.riskLevel").toLowerCase();
  if (!ALLOWED_RISK_LEVELS.has(riskLevel)) throw new TypeError("request.riskLevel must be low|medium|high|critical");
  const approvalsProvided = normalizeSafeInt(request.approvalsProvided ?? 0, "request.approvalsProvided", { min: 0 });
  const externalTransfer = request.externalTransfer === true;
  return {
    amountUsdCents,
    monthlySpendUsdCents,
    dataClass,
    riskLevel,
    approvalsProvided,
    externalTransfer
  };
}

function buildCheck(checkId, ok, message, code = null) {
  const out = { checkId, ok: ok === true, message: String(message) };
  if (!ok && code) out.code = String(code);
  return out;
}

function buildInvalidDecision({ code, message }) {
  return {
    schemaVersion: GOVERNANCE_POLICY_DECISION_SCHEMA_VERSION,
    decision: "deny",
    checks: [buildCheck("request_or_template_valid", false, message, code)],
    blockingIssues: [{ code, message }]
  };
}

function pushBlockingIssue(blockingIssues, checks, { checkId, okMessage, failMessage, code, ok }) {
  checks.push(buildCheck(checkId, ok, ok ? okMessage : failMessage, ok ? null : code));
  if (!ok) blockingIssues.push({ code, message: failMessage });
}

function resolveRequiredApprovers(tiers, amountUsdCents) {
  for (const tier of tiers) {
    if (amountUsdCents <= Number(tier.maxAmountUsdCents)) return tier;
  }
  return null;
}

const STARTER_TEMPLATES = Object.freeze(
  STARTER_TEMPLATE_SEEDS.map((seed) => Object.freeze(normalizeGovernancePolicyTemplateInternal(seed)))
);

export function listGovernancePolicyTemplates() {
  return STARTER_TEMPLATES.map((template) => deepClone(template));
}

export function getGovernancePolicyTemplate({ templateId = null, operatingProfile = null } = {}) {
  const templateIdFilter =
    templateId === null || templateId === undefined || String(templateId).trim() === "" ? null : String(templateId).trim().toLowerCase();
  const operatingProfileFilter =
    operatingProfile === null || operatingProfile === undefined || String(operatingProfile).trim() === ""
      ? null
      : String(operatingProfile).trim().toLowerCase();

  if (templateIdFilter !== null && !TEMPLATE_ID_PATTERN.test(templateIdFilter)) {
    throw new TypeError("templateId must match /^[a-z][a-z0-9._-]{2,63}$/");
  }
  if (operatingProfileFilter !== null && !ALLOWED_OPERATING_PROFILES.has(operatingProfileFilter)) {
    throw new TypeError("operatingProfile must be indie|smb|enterprise");
  }

  const found = STARTER_TEMPLATES.filter((row) => {
    if (templateIdFilter && row.templateId !== templateIdFilter) return false;
    if (operatingProfileFilter && row.operatingProfile !== operatingProfileFilter) return false;
    return true;
  });
  if (!found.length) return null;
  found.sort((left, right) => Number(right.templateVersion ?? 0) - Number(left.templateVersion ?? 0));
  return deepClone(found[0]);
}

export function createStarterGovernancePolicyTemplate({ operatingProfile } = {}) {
  const template = getGovernancePolicyTemplate({ operatingProfile });
  return template ? normalizeForCanonicalJson(template, { path: "$" }) : null;
}

export function buildGovernancePolicyTemplateCatalog() {
  const templates = listGovernancePolicyTemplates();
  return {
    schemaVersion: GOVERNANCE_POLICY_TEMPLATE_CATALOG_SCHEMA_VERSION,
    templates
  };
}

export function evaluateGovernancePolicyTemplate({ template, request } = {}) {
  let normalizedTemplate = null;
  try {
    normalizedTemplate = normalizeGovernancePolicyTemplateInternal(template, { requireTemplateHash: false });
  } catch (err) {
    return buildInvalidDecision({
      code: GOVERNANCE_POLICY_DECISION_CODE.TEMPLATE_INVALID,
      message: err?.message ?? "invalid policy template"
    });
  }

  let normalizedRequest = null;
  try {
    normalizedRequest = normalizeDecisionRequest(request);
  } catch (err) {
    return buildInvalidDecision({
      code: GOVERNANCE_POLICY_DECISION_CODE.REQUEST_INVALID,
      message: err?.message ?? "invalid policy evaluation request"
    });
  }

  const checks = [];
  const blockingIssues = [];
  const spend = normalizedTemplate.controls.spend;
  const dataAccess = normalizedTemplate.controls.dataAccess;
  const approvals = normalizedTemplate.controls.approvals;
  const escalation = normalizedTemplate.controls.escalation;

  pushBlockingIssue(blockingIssues, checks, {
    checkId: "spend_per_action_limit",
    ok: normalizedRequest.amountUsdCents <= spend.perActionUsdCents,
    okMessage: "amount is within per-action spend limit",
    failMessage: "amount exceeds per-action spend limit",
    code: GOVERNANCE_POLICY_DECISION_CODE.PER_ACTION_LIMIT_EXCEEDED
  });

  pushBlockingIssue(blockingIssues, checks, {
    checkId: "spend_monthly_limit",
    ok: normalizedRequest.monthlySpendUsdCents + normalizedRequest.amountUsdCents <= spend.monthlyUsdCents,
    okMessage: "monthly spend remains within configured limit",
    failMessage: "monthly spend limit would be exceeded",
    code: GOVERNANCE_POLICY_DECISION_CODE.MONTHLY_LIMIT_EXCEEDED
  });

  pushBlockingIssue(blockingIssues, checks, {
    checkId: "data_class_allowed",
    ok: dataAccess.allowedDataClasses.includes(normalizedRequest.dataClass),
    okMessage: "data class is allowlisted for this template",
    failMessage: "data class is not allowed by template controls",
    code: GOVERNANCE_POLICY_DECISION_CODE.DATA_CLASS_FORBIDDEN
  });

  pushBlockingIssue(blockingIssues, checks, {
    checkId: "external_transfer_allowed",
    ok: !normalizedRequest.externalTransfer || dataAccess.allowExternalTransfer,
    okMessage: "external transfer policy allows this request",
    failMessage: "external transfer is blocked by template controls",
    code: GOVERNANCE_POLICY_DECISION_CODE.EXTERNAL_TRANSFER_FORBIDDEN
  });

  const matchedTier = resolveRequiredApprovers(approvals.tiers, normalizedRequest.amountUsdCents);
  if (!matchedTier) {
    pushBlockingIssue(blockingIssues, checks, {
      checkId: "approval_tier_coverage",
      ok: false,
      okMessage: "approval tiers cover the request amount",
      failMessage: "approval tiers do not cover the request amount",
      code: GOVERNANCE_POLICY_DECISION_CODE.POLICY_TEMPLATE_TIER_GAP
    });
  } else {
    pushBlockingIssue(blockingIssues, checks, {
      checkId: "approval_threshold_met",
      ok: normalizedRequest.approvalsProvided >= matchedTier.requiredApprovers,
      okMessage: "request satisfies approval threshold",
      failMessage: "request does not satisfy approval threshold",
      code: GOVERNANCE_POLICY_DECISION_CODE.APPROVAL_THRESHOLD_NOT_MET
    });
  }

  pushBlockingIssue(blockingIssues, checks, {
    checkId: "risk_requires_approval",
    ok:
      !escalation.requireApprovalForRiskLevels.includes(normalizedRequest.riskLevel) ||
      normalizedRequest.approvalsProvided > 0,
    okMessage: "risk-level approval requirement is satisfied",
    failMessage: "risk level requires at least one explicit approval",
    code: GOVERNANCE_POLICY_DECISION_CODE.RISK_APPROVAL_REQUIRED
  });

  pushBlockingIssue(blockingIssues, checks, {
    checkId: "risk_level_not_blocked",
    ok: !escalation.autoBlockRiskLevels.includes(normalizedRequest.riskLevel),
    okMessage: "risk level is not auto-blocked",
    failMessage: "risk level is auto-blocked by template escalation controls",
    code: GOVERNANCE_POLICY_DECISION_CODE.RISK_LEVEL_BLOCKED
  });

  const denyCodes = new Set([
    GOVERNANCE_POLICY_DECISION_CODE.PER_ACTION_LIMIT_EXCEEDED,
    GOVERNANCE_POLICY_DECISION_CODE.MONTHLY_LIMIT_EXCEEDED,
    GOVERNANCE_POLICY_DECISION_CODE.DATA_CLASS_FORBIDDEN,
    GOVERNANCE_POLICY_DECISION_CODE.EXTERNAL_TRANSFER_FORBIDDEN,
    GOVERNANCE_POLICY_DECISION_CODE.RISK_LEVEL_BLOCKED,
    GOVERNANCE_POLICY_DECISION_CODE.POLICY_TEMPLATE_TIER_GAP
  ]);
  const hasDeny = blockingIssues.some((issue) => denyCodes.has(String(issue?.code ?? "")));
  const decision = hasDeny ? "deny" : blockingIssues.length > 0 ? "challenge" : "allow";

  return normalizeForCanonicalJson(
    {
      schemaVersion: GOVERNANCE_POLICY_DECISION_SCHEMA_VERSION,
      decision,
      templateRef: {
        templateId: normalizedTemplate.templateId,
        templateVersion: normalizedTemplate.templateVersion,
        operatingProfile: normalizedTemplate.operatingProfile,
        templateHash: normalizedTemplate.templateHash
      },
      request: normalizedRequest,
      matchedApprovalTierId: matchedTier ? matchedTier.tierId : null,
      requiredApprovers: matchedTier ? matchedTier.requiredApprovers : null,
      checks,
      blockingIssues
    },
    { path: "$" }
  );
}

export function validateGovernancePolicyTemplate(template) {
  return normalizeGovernancePolicyTemplateInternal(template, { requireTemplateHash: true });
}

export function computeGovernancePolicyTemplateHash(template) {
  const normalized = normalizeGovernancePolicyTemplateInternal(template, { requireTemplateHash: false });
  return computeTemplateHashCore({
    templateId: normalized.templateId,
    templateVersion: normalized.templateVersion,
    operatingProfile: normalized.operatingProfile,
    name: normalized.name,
    description: normalized.description,
    controls: normalized.controls
  });
}
