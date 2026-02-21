#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex } from "../../src/core/crypto.js";
import { createStarterPolicyPack, listPolicyPackTemplates, POLICY_PACK_SCHEMA_VERSION } from "../../src/core/policy-packs.js";

const VALIDATION_REPORT_SCHEMA_VERSION = "SettldPolicyPackValidationReport.v1";
const SIMULATION_REPORT_SCHEMA_VERSION = "SettldPolicySimulationReport.v1";
const PUBLISH_REPORT_SCHEMA_VERSION = "SettldPolicyPublishReport.v1";
const PUBLICATION_ARTIFACT_SCHEMA_VERSION = "SettldPolicyPublication.v1";

function usage() {
  const lines = [
    "usage:",
    "  settld policy init <pack-id> [--out <path>] [--force] [--format json|text] [--json-out <path>]",
    "  settld policy simulate <policy-pack.json|-> [--scenario <scenario.json|->|--scenario-json <json>] [--format json|text] [--json-out <path>]",
    "  settld policy publish <policy-pack.json|-> [--out <path>] [--force] [--channel <name>] [--owner <id>] [--format json|text] [--json-out <path>]"
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
}

function fail(message) {
  throw new Error(String(message));
}

function parseArgs(argv) {
  const out = {
    command: String(argv[0] ?? "").trim() || null,
    packId: null,
    inputPath: null,
    scenarioPath: null,
    scenarioJson: null,
    outPath: null,
    jsonOut: null,
    format: "text",
    force: false,
    help: false,
    channel: null,
    owner: null
  };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--format") {
      out.format = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === "--json-out") {
      out.jsonOut = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (arg === "--out") {
      out.outPath = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (arg === "--force") {
      out.force = true;
      continue;
    }
    if (arg === "--in") {
      out.inputPath = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (arg === "--scenario") {
      out.scenarioPath = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (arg === "--scenario-json") {
      out.scenarioJson = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (arg === "--channel") {
      out.channel = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (arg === "--owner") {
      out.owner = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }

    if (arg !== "-" && arg.startsWith("-")) fail(`unknown argument: ${arg}`);

    if (out.command === "init" && !out.packId) {
      out.packId = arg;
      continue;
    }
    if ((out.command === "simulate" || out.command === "publish") && !out.inputPath) {
      out.inputPath = arg;
      continue;
    }
    fail(`unexpected positional argument: ${arg}`);
  }

  if (!out.command || out.command === "--help" || out.command === "-h") {
    out.help = true;
    return out;
  }
  if (!["init", "simulate", "publish"].includes(out.command)) fail(`unsupported command: ${out.command}`);
  if (out.format !== "json" && out.format !== "text") fail("--format must be json or text");
  if (out.command === "init" && !out.packId) fail("pack id is required for init");
  if ((out.command === "simulate" || out.command === "publish") && !out.inputPath) fail("policy pack input is required");
  if (out.command !== "simulate" && (out.scenarioPath || out.scenarioJson)) fail("--scenario/--scenario-json only apply to simulate");
  if (out.scenarioPath && out.scenarioJson) fail("choose one of --scenario or --scenario-json");
  const publishOptionsUsed = out.channel !== null || out.owner !== null;
  if (out.command !== "publish" && publishOptionsUsed) fail("--channel/--owner only apply to publish");
  return out;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function addValidationError(report, { code, path: errorPath, message }) {
  report.errors.push({ code: String(code), path: String(errorPath), message: String(message) });
}

function validateString(report, value, fieldPath) {
  if (typeof value !== "string" || !value.trim()) {
    addValidationError(report, { code: "invalid_string", path: fieldPath, message: "must be a non-empty string" });
    return false;
  }
  return true;
}

function validateSafeInt(report, value, fieldPath, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) {
    addValidationError(report, { code: "invalid_integer", path: fieldPath, message: `must be a safe integer >= ${min}` });
    return false;
  }
  return true;
}

function validateStringArray(report, value, fieldPath) {
  if (!Array.isArray(value)) {
    addValidationError(report, { code: "invalid_array", path: fieldPath, message: "must be an array of strings" });
    return false;
  }
  let ok = true;
  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    const itemPath = `${fieldPath}[${i}]`;
    if (!validateString(report, item, itemPath)) {
      ok = false;
      continue;
    }
    if (seen.has(item)) {
      addValidationError(report, { code: "duplicate_value", path: itemPath, message: "must not contain duplicates" });
      ok = false;
      continue;
    }
    seen.add(item);
  }
  return ok;
}

function validatePolicyPackDocument(policyPack) {
  const report = {
    schemaVersion: VALIDATION_REPORT_SCHEMA_VERSION,
    ok: false,
    packId: typeof policyPack?.packId === "string" ? policyPack.packId : null,
    errors: [],
    warnings: []
  };

  if (!isPlainObject(policyPack)) {
    addValidationError(report, { code: "invalid_policy_pack", path: "$", message: "policy pack must be an object" });
    return report;
  }
  if (policyPack.schemaVersion !== POLICY_PACK_SCHEMA_VERSION) {
    addValidationError(report, {
      code: "unsupported_schema_version",
      path: "$.schemaVersion",
      message: `must be ${POLICY_PACK_SCHEMA_VERSION}`
    });
  }

  validateString(report, policyPack.packId, "$.packId");
  if (!isPlainObject(policyPack.metadata)) {
    addValidationError(report, { code: "invalid_metadata", path: "$.metadata", message: "metadata must be an object" });
  } else {
    validateString(report, policyPack.metadata.name, "$.metadata.name");
    validateString(report, policyPack.metadata.vertical, "$.metadata.vertical");
    validateString(report, policyPack.metadata.description, "$.metadata.description");
  }

  if (!isPlainObject(policyPack.policy)) {
    addValidationError(report, { code: "invalid_policy", path: "$.policy", message: "policy must be an object" });
    return report;
  }

  validateString(report, policyPack.policy.currency, "$.policy.currency");
  if (!isPlainObject(policyPack.policy.limits)) {
    addValidationError(report, { code: "invalid_limits", path: "$.policy.limits", message: "limits must be an object" });
  } else {
    validateSafeInt(report, policyPack.policy.limits.perRequestUsdCents, "$.policy.limits.perRequestUsdCents", { min: 1 });
    validateSafeInt(report, policyPack.policy.limits.monthlyUsdCents, "$.policy.limits.monthlyUsdCents", { min: 1 });
    if (
      Number.isSafeInteger(policyPack.policy.limits.perRequestUsdCents) &&
      Number.isSafeInteger(policyPack.policy.limits.monthlyUsdCents) &&
      policyPack.policy.limits.perRequestUsdCents > policyPack.policy.limits.monthlyUsdCents
    ) {
      addValidationError(report, {
        code: "limits_inconsistent",
        path: "$.policy.limits",
        message: "perRequestUsdCents must be <= monthlyUsdCents"
      });
    }
  }

  if (!isPlainObject(policyPack.policy.allowlists)) {
    addValidationError(report, { code: "invalid_allowlists", path: "$.policy.allowlists", message: "allowlists must be an object" });
  } else {
    validateStringArray(report, policyPack.policy.allowlists.providers, "$.policy.allowlists.providers");
    validateStringArray(report, policyPack.policy.allowlists.tools, "$.policy.allowlists.tools");
  }

  if (!Array.isArray(policyPack.policy.approvals) || policyPack.policy.approvals.length === 0) {
    addValidationError(report, { code: "invalid_approvals", path: "$.policy.approvals", message: "approvals must be a non-empty array" });
  } else {
    let previousMax = -1;
    for (let i = 0; i < policyPack.policy.approvals.length; i += 1) {
      const tier = policyPack.policy.approvals[i];
      const tierPath = `$.policy.approvals[${i}]`;
      if (!isPlainObject(tier)) {
        addValidationError(report, { code: "invalid_approval_tier", path: tierPath, message: "tier must be an object" });
        continue;
      }
      validateString(report, tier.tierId, `${tierPath}.tierId`);
      validateSafeInt(report, tier.maxAmountUsdCents, `${tierPath}.maxAmountUsdCents`, { min: 0 });
      validateSafeInt(report, tier.requiredApprovers, `${tierPath}.requiredApprovers`, { min: 0 });
      validateString(report, tier.approverRole, `${tierPath}.approverRole`);
      if (Number.isSafeInteger(tier.maxAmountUsdCents) && tier.maxAmountUsdCents <= previousMax) {
        addValidationError(report, {
          code: "tier_order_invalid",
          path: `${tierPath}.maxAmountUsdCents`,
          message: "maxAmountUsdCents must increase monotonically"
        });
      }
      if (Number.isSafeInteger(tier.maxAmountUsdCents)) previousMax = tier.maxAmountUsdCents;
    }
  }

  if (!isPlainObject(policyPack.policy.enforcement)) {
    addValidationError(report, { code: "invalid_enforcement", path: "$.policy.enforcement", message: "enforcement must be an object" });
  } else {
    const boolKeys = ["enforceProviderAllowlist", "requireReceiptSignature", "requireToolManifestHash", "allowUnknownToolVersion"];
    for (const key of boolKeys) {
      if (typeof policyPack.policy.enforcement[key] !== "boolean") {
        addValidationError(report, { code: "invalid_boolean", path: `$.policy.enforcement.${key}`, message: "must be a boolean" });
      }
    }
  }

  if (!isPlainObject(policyPack.policy.disputeDefaults)) {
    addValidationError(report, {
      code: "invalid_dispute_defaults",
      path: "$.policy.disputeDefaults",
      message: "disputeDefaults must be an object"
    });
  } else {
    validateSafeInt(report, policyPack.policy.disputeDefaults.responseWindowHours, "$.policy.disputeDefaults.responseWindowHours", { min: 1 });
    if (typeof policyPack.policy.disputeDefaults.autoOpenIfReceiptMissing !== "boolean") {
      addValidationError(report, {
        code: "invalid_boolean",
        path: "$.policy.disputeDefaults.autoOpenIfReceiptMissing",
        message: "must be a boolean"
      });
    }
    validateStringArray(report, policyPack.policy.disputeDefaults.evidenceChecklist, "$.policy.disputeDefaults.evidenceChecklist");
  }

  report.ok = report.errors.length === 0;
  return report;
}

function buildDefaultScenario(policyPack) {
  const providers = Array.isArray(policyPack?.policy?.allowlists?.providers) ? policyPack.policy.allowlists.providers : [];
  const tools = Array.isArray(policyPack?.policy?.allowlists?.tools) ? policyPack.policy.allowlists.tools : [];
  return {
    providerId: providers[0] ?? "",
    toolId: tools[0] ?? "",
    amountUsdCents: 0,
    monthToDateSpendUsdCents: 0,
    approvalsProvided: 0,
    receiptSigned: true,
    toolManifestHashPresent: true,
    toolVersionKnown: true
  };
}

function normalizeScenario(raw, { policyPack }) {
  if (!isPlainObject(raw)) fail("scenario must be a JSON object");
  const fallback = buildDefaultScenario(policyPack);
  const out = {
    providerId: String(raw.providerId ?? fallback.providerId).trim(),
    toolId: String(raw.toolId ?? fallback.toolId).trim(),
    amountUsdCents: Number(raw.amountUsdCents ?? fallback.amountUsdCents),
    monthToDateSpendUsdCents: Number(raw.monthToDateSpendUsdCents ?? fallback.monthToDateSpendUsdCents),
    approvalsProvided: Number(raw.approvalsProvided ?? fallback.approvalsProvided),
    receiptSigned: raw.receiptSigned === undefined ? fallback.receiptSigned : Boolean(raw.receiptSigned),
    toolManifestHashPresent: raw.toolManifestHashPresent === undefined ? fallback.toolManifestHashPresent : Boolean(raw.toolManifestHashPresent),
    toolVersionKnown: raw.toolVersionKnown === undefined ? fallback.toolVersionKnown : Boolean(raw.toolVersionKnown)
  };
  if (!out.providerId) fail("scenario.providerId is required");
  if (!out.toolId) fail("scenario.toolId is required");
  if (!Number.isSafeInteger(out.amountUsdCents) || out.amountUsdCents < 0) fail("scenario.amountUsdCents must be a safe integer >= 0");
  if (!Number.isSafeInteger(out.monthToDateSpendUsdCents) || out.monthToDateSpendUsdCents < 0) {
    fail("scenario.monthToDateSpendUsdCents must be a safe integer >= 0");
  }
  if (!Number.isSafeInteger(out.approvalsProvided) || out.approvalsProvided < 0) fail("scenario.approvalsProvided must be a safe integer >= 0");
  return out;
}

function findApprovalTier(policyPack, amountUsdCents) {
  const tiers = policyPack.policy.approvals;
  for (const tier of tiers) {
    if (amountUsdCents <= tier.maxAmountUsdCents) return tier;
  }
  return tiers[tiers.length - 1];
}

function simulatePolicyPack({ policyPack, scenario }) {
  const allowlists = policyPack.policy.allowlists;
  const limits = policyPack.policy.limits;
  const enforcement = policyPack.policy.enforcement;
  const tier = findApprovalTier(policyPack, scenario.amountUsdCents);

  const checks = [
    { id: "provider_allowlisted", ok: enforcement.enforceProviderAllowlist ? allowlists.providers.includes(scenario.providerId) : true },
    { id: "tool_allowlisted", ok: allowlists.tools.includes(scenario.toolId) },
    { id: "per_request_limit", ok: scenario.amountUsdCents <= limits.perRequestUsdCents },
    { id: "monthly_limit", ok: scenario.amountUsdCents + scenario.monthToDateSpendUsdCents <= limits.monthlyUsdCents },
    { id: "receipt_signature", ok: enforcement.requireReceiptSignature ? scenario.receiptSigned : true },
    { id: "tool_manifest_hash", ok: enforcement.requireToolManifestHash ? scenario.toolManifestHashPresent : true },
    { id: "tool_version_known", ok: enforcement.allowUnknownToolVersion ? true : scenario.toolVersionKnown }
  ];

  const checksOk = checks.every((item) => item.ok === true);
  const requiredApprovers = tier.requiredApprovers;
  const approvalsSatisfied = scenario.approvalsProvided >= requiredApprovers;
  const reasons = [];
  for (const check of checks) {
    if (check.ok !== true) reasons.push(check.id);
  }
  if (checksOk && !approvalsSatisfied) reasons.push("approval_required");
  const decision = !checksOk ? "deny" : approvalsSatisfied ? "allow" : "challenge";

  return {
    schemaVersion: SIMULATION_REPORT_SCHEMA_VERSION,
    ok: true,
    packId: policyPack.packId,
    decision,
    requiredApprovers,
    approvalsProvided: scenario.approvalsProvided,
    selectedApprovalTier: tier.tierId,
    reasons,
    checks,
    scenario
  };
}

function toTrimmedOrNull(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function buildPublicationArtifact(policyPack, { channel, owner }) {
  const normalizedPack = normalizeForCanonicalJson(policyPack, { path: "$" });
  const packCanonical = canonicalJsonStringify(normalizedPack);
  const policyFingerprint = sha256Hex(packCanonical);
  const publicationRef = `${channel}:${policyPack.packId}:${policyFingerprint.slice(0, 16)}`;
  const artifact = {
    schemaVersion: PUBLICATION_ARTIFACT_SCHEMA_VERSION,
    publicationRef,
    channel,
    owner,
    packId: policyPack.packId,
    policySchemaVersion: policyPack.schemaVersion,
    policyFingerprint,
    metadata: policyPack.metadata,
    policy: policyPack.policy,
    checksums: {
      policyPackCanonicalSha256: policyFingerprint
    }
  };
  return { policyFingerprint, publicationRef, artifact };
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonPath(pathLike) {
  if (pathLike === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8"));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  return JSON.parse(await fs.readFile(pathLike, "utf8"));
}

async function writeOutput({ format, payload, text, jsonOut }) {
  const jsonBody = `${JSON.stringify(payload, null, 2)}\n`;
  if (jsonOut) {
    const target = path.resolve(process.cwd(), jsonOut);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, jsonBody, "utf8");
  }
  if (format === "json") {
    process.stdout.write(jsonBody);
    return;
  }
  process.stdout.write(text);
}

function renderValidationText(report) {
  if (report.ok) return "ok\n";
  return `${report.errors.map((row) => `${row.code}\t${row.path}\t${row.message}`).join("\n")}\n`;
}

function renderSimulationText(report) {
  const reasonText = report.reasons.length ? report.reasons.join(",") : "none";
  return [
    `decision: ${report.decision}`,
    `requiredApprovers: ${report.requiredApprovers}`,
    `approvalsProvided: ${report.approvalsProvided}`,
    `reasons: ${reasonText}`
  ].join("\n") + "\n";
}

function renderPublishText(report) {
  return [
    `ok: ${report.ok ? "true" : "false"}`,
    `packId: ${report.packId}`,
    `publicationRef: ${report.publicationRef}`,
    `policyFingerprint: ${report.policyFingerprint}`,
    `artifactPath: ${report.artifactPath}`,
    `artifactSha256: ${report.artifactSha256}`
  ].join("\n") + "\n";
}

function formatKnownPackIds() {
  return listPolicyPackTemplates()
    .map((pack) => pack.packId)
    .sort()
    .join(", ");
}

async function handleInit(parsed) {
  const policyPack = createStarterPolicyPack({ packId: parsed.packId });
  if (!policyPack) fail(`unknown policy pack: ${parsed.packId} (known: ${formatKnownPackIds()})`);
  const targetPath = path.resolve(process.cwd(), parsed.outPath || `${parsed.packId}.policy-pack.json`);
  if (!parsed.force && (await exists(targetPath))) fail(`output path exists: ${targetPath}`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(policyPack, null, 2)}\n`, "utf8");

  const payload = {
    ok: true,
    command: "init",
    packId: parsed.packId,
    outPath: targetPath
  };
  await writeOutput({
    format: parsed.format,
    payload,
    text: `ok\t${parsed.packId}\t${targetPath}\n`,
    jsonOut: parsed.jsonOut
  });
  return 0;
}

async function loadScenario(parsed, policyPack) {
  if (parsed.scenarioJson) return normalizeScenario(JSON.parse(parsed.scenarioJson), { policyPack });
  if (parsed.scenarioPath) return normalizeScenario(await readJsonPath(parsed.scenarioPath), { policyPack });
  return normalizeScenario(buildDefaultScenario(policyPack), { policyPack });
}

async function handleSimulate(parsed) {
  const policyPack = await readJsonPath(parsed.inputPath);
  const validation = validatePolicyPackDocument(policyPack);
  if (!validation.ok) {
    await writeOutput({
      format: parsed.format,
      payload: validation,
      text: renderValidationText(validation),
      jsonOut: parsed.jsonOut
    });
    return 1;
  }

  const scenario = await loadScenario(parsed, policyPack);
  const report = simulatePolicyPack({ policyPack, scenario });
  await writeOutput({
    format: parsed.format,
    payload: report,
    text: renderSimulationText(report),
    jsonOut: parsed.jsonOut
  });
  return 0;
}

async function handlePublish(parsed) {
  const policyPack = await readJsonPath(parsed.inputPath);
  const validation = validatePolicyPackDocument(policyPack);
  if (!validation.ok) {
    await writeOutput({
      format: parsed.format,
      payload: validation,
      text: renderValidationText(validation),
      jsonOut: parsed.jsonOut
    });
    return 1;
  }

  const channel = toTrimmedOrNull(parsed.channel) ?? "local";
  const owner = toTrimmedOrNull(parsed.owner) ?? "local-operator";
  const { policyFingerprint, publicationRef, artifact } = buildPublicationArtifact(policyPack, { channel, owner });
  const artifactPath = path.resolve(process.cwd(), parsed.outPath || `${policyPack.packId}.publish.${policyFingerprint.slice(0, 12)}.json`);
  if (!parsed.force && (await exists(artifactPath))) fail(`output path exists: ${artifactPath}`);
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const artifactSha256 = sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(artifact, { path: "$" })));
  const report = {
    schemaVersion: PUBLISH_REPORT_SCHEMA_VERSION,
    ok: true,
    packId: policyPack.packId,
    publicationRef,
    channel,
    owner,
    policyFingerprint,
    artifactPath,
    artifactSha256
  };
  await writeOutput({
    format: parsed.format,
    payload: report,
    text: renderPublishText(report),
    jsonOut: parsed.jsonOut
  });
  return 0;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    usage();
    process.stderr.write(`${err?.message ?? "invalid arguments"}\n`);
    process.exit(2);
    return;
  }

  if (parsed.help) {
    usage();
    process.exit(0);
    return;
  }

  try {
    let code = 1;
    if (parsed.command === "init") code = await handleInit(parsed);
    if (parsed.command === "simulate") code = await handleSimulate(parsed);
    if (parsed.command === "publish") code = await handlePublish(parsed);
    process.exit(code);
  } catch (err) {
    process.stderr.write(`${err?.message ?? "command failed"}\n`);
    process.exit(1);
  }
}

main();
