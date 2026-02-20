#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import {
  PROFILE_TEMPLATE_CATALOG_VERSION,
  PROFILE_SCHEMA_VERSION,
  createStarterProfile,
  listProfileTemplates
} from "../../src/core/profile-templates.js";

const VALIDATION_REPORT_SCHEMA_VERSION = "SettldProfileValidationReport.v1";
const SIMULATION_REPORT_SCHEMA_VERSION = "SettldProfileSimulationReport.v1";

function usage() {
  const lines = [
    "usage:",
    "  settld profile list [--format json|text] [--json-out <path>]",
    "  settld profile init <profile-id> [--out <path>] [--force] [--format json|text] [--json-out <path>]",
    "  settld profile validate <profile.json|-> [--format json|text] [--json-out <path>]",
    "  settld profile simulate <profile.json|-> [--scenario <scenario.json|->|--scenario-json <json>] [--format json|text] [--json-out <path>]"
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
}

function fail(message) {
  throw new Error(String(message));
}

function parseArgs(argv) {
  const out = {
    command: String(argv[0] ?? "").trim() || null,
    profileId: null,
    inputPath: null,
    scenarioPath: null,
    scenarioJson: null,
    outPath: null,
    jsonOut: null,
    format: "text",
    force: false,
    help: false
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
    if (arg === "--profile") {
      out.profileId = String(argv[i + 1] ?? "").trim();
      i += 1;
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

    if (arg.startsWith("-")) fail(`unknown argument: ${arg}`);

    if (out.command === "init" && !out.profileId) {
      out.profileId = arg;
      continue;
    }
    if ((out.command === "validate" || out.command === "simulate") && !out.inputPath) {
      out.inputPath = arg;
      continue;
    }
    fail(`unexpected positional argument: ${arg}`);
  }

  if (!out.command || out.command === "--help" || out.command === "-h") {
    out.help = true;
    out.command = out.command && out.command.startsWith("-") ? "list" : out.command;
    return out;
  }
  if (!["list", "init", "validate", "simulate"].includes(out.command)) fail(`unsupported command: ${out.command}`);
  if (out.format !== "json" && out.format !== "text") fail("--format must be json or text");
  if (out.command === "init" && !out.profileId) fail("profile id is required for init");
  if ((out.command === "validate" || out.command === "simulate") && !out.inputPath) fail("profile input is required");
  if (out.command !== "simulate" && (out.scenarioPath || out.scenarioJson)) fail("--scenario/--scenario-json only apply to simulate");
  if (out.scenarioPath && out.scenarioJson) fail("choose one of --scenario or --scenario-json");
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

function validateProfileDocument(profile) {
  const report = {
    schemaVersion: VALIDATION_REPORT_SCHEMA_VERSION,
    ok: false,
    profileId: typeof profile?.profileId === "string" ? profile.profileId : null,
    errors: [],
    warnings: []
  };

  if (!isPlainObject(profile)) {
    addValidationError(report, { code: "invalid_profile", path: "$", message: "profile must be an object" });
    return report;
  }

  if (profile.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    addValidationError(report, { code: "unsupported_schema_version", path: "$.schemaVersion", message: `must be ${PROFILE_SCHEMA_VERSION}` });
  }

  validateString(report, profile.profileId, "$.profileId");

  if (!isPlainObject(profile.metadata)) {
    addValidationError(report, { code: "invalid_metadata", path: "$.metadata", message: "metadata must be an object" });
  } else {
    validateString(report, profile.metadata.name, "$.metadata.name");
    validateString(report, profile.metadata.vertical, "$.metadata.vertical");
    validateString(report, profile.metadata.description, "$.metadata.description");
  }

  if (!isPlainObject(profile.policy)) {
    addValidationError(report, { code: "invalid_policy", path: "$.policy", message: "policy must be an object" });
    return report;
  }

  validateString(report, profile.policy.currency, "$.policy.currency");

  if (!isPlainObject(profile.policy.limits)) {
    addValidationError(report, { code: "invalid_limits", path: "$.policy.limits", message: "limits must be an object" });
  } else {
    validateSafeInt(report, profile.policy.limits.perRequestUsdCents, "$.policy.limits.perRequestUsdCents", { min: 1 });
    validateSafeInt(report, profile.policy.limits.monthlyUsdCents, "$.policy.limits.monthlyUsdCents", { min: 1 });
    if (
      Number.isSafeInteger(profile.policy.limits.perRequestUsdCents) &&
      Number.isSafeInteger(profile.policy.limits.monthlyUsdCents) &&
      profile.policy.limits.perRequestUsdCents > profile.policy.limits.monthlyUsdCents
    ) {
      addValidationError(report, {
        code: "limits_inconsistent",
        path: "$.policy.limits",
        message: "perRequestUsdCents must be <= monthlyUsdCents"
      });
    }
  }

  if (!isPlainObject(profile.policy.allowlists)) {
    addValidationError(report, { code: "invalid_allowlists", path: "$.policy.allowlists", message: "allowlists must be an object" });
  } else {
    validateStringArray(report, profile.policy.allowlists.providers, "$.policy.allowlists.providers");
    validateStringArray(report, profile.policy.allowlists.tools, "$.policy.allowlists.tools");
  }

  if (!Array.isArray(profile.policy.approvalTiers) || profile.policy.approvalTiers.length === 0) {
    addValidationError(report, {
      code: "invalid_approval_tiers",
      path: "$.policy.approvalTiers",
      message: "approvalTiers must be a non-empty array"
    });
  } else {
    let previousMax = -1;
    for (let i = 0; i < profile.policy.approvalTiers.length; i += 1) {
      const tier = profile.policy.approvalTiers[i];
      const tierPath = `$.policy.approvalTiers[${i}]`;
      if (!isPlainObject(tier)) {
        addValidationError(report, { code: "invalid_tier", path: tierPath, message: "tier must be an object" });
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

  if (!isPlainObject(profile.policy.disputeDefaults)) {
    addValidationError(report, {
      code: "invalid_dispute_defaults",
      path: "$.policy.disputeDefaults",
      message: "disputeDefaults must be an object"
    });
  } else {
    validateSafeInt(report, profile.policy.disputeDefaults.responseWindowHours, "$.policy.disputeDefaults.responseWindowHours", { min: 1 });
    if (typeof profile.policy.disputeDefaults.autoOpenIfReceiptMissing !== "boolean") {
      addValidationError(report, {
        code: "invalid_boolean",
        path: "$.policy.disputeDefaults.autoOpenIfReceiptMissing",
        message: "must be a boolean"
      });
    }
    validateStringArray(report, profile.policy.disputeDefaults.evidenceChecklist, "$.policy.disputeDefaults.evidenceChecklist");
  }

  if (!isPlainObject(profile.policy.compliance)) {
    addValidationError(report, { code: "invalid_compliance", path: "$.policy.compliance", message: "compliance must be an object" });
  } else {
    const boolKeys = ["enforceVendorAllowlist", "requireReceiptSignature", "requireToolManifestHash", "allowUnknownToolVersion"];
    for (const key of boolKeys) {
      if (typeof profile.policy.compliance[key] !== "boolean") {
        addValidationError(report, { code: "invalid_boolean", path: `$.policy.compliance.${key}`, message: "must be a boolean" });
      }
    }
  }

  report.ok = report.errors.length === 0;
  return report;
}

function buildDefaultScenario(profile) {
  const providers = Array.isArray(profile?.policy?.allowlists?.providers) ? profile.policy.allowlists.providers : [];
  const tools = Array.isArray(profile?.policy?.allowlists?.tools) ? profile.policy.allowlists.tools : [];
  return {
    providerId: providers[0] ?? "",
    toolId: tools[0] ?? "",
    amountUsdCents: 0,
    monthToDateSpendUsdCents: 0,
    approvalsProvided: 0,
    receiptSigned: true,
    toolManifestHashPresent: true
  };
}

function normalizeScenario(raw, { profile }) {
  if (!isPlainObject(raw)) fail("scenario must be a JSON object");
  const fallback = buildDefaultScenario(profile);
  const out = {
    providerId: String(raw.providerId ?? fallback.providerId).trim(),
    toolId: String(raw.toolId ?? fallback.toolId).trim(),
    amountUsdCents: Number(raw.amountUsdCents ?? fallback.amountUsdCents),
    monthToDateSpendUsdCents: Number(raw.monthToDateSpendUsdCents ?? fallback.monthToDateSpendUsdCents),
    approvalsProvided: Number(raw.approvalsProvided ?? fallback.approvalsProvided),
    receiptSigned: raw.receiptSigned === undefined ? fallback.receiptSigned : Boolean(raw.receiptSigned),
    toolManifestHashPresent: raw.toolManifestHashPresent === undefined ? fallback.toolManifestHashPresent : Boolean(raw.toolManifestHashPresent)
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

function findApprovalTier(profile, amountUsdCents) {
  const tiers = profile.policy.approvalTiers;
  for (const tier of tiers) {
    if (amountUsdCents <= tier.maxAmountUsdCents) return tier;
  }
  return tiers[tiers.length - 1];
}

function simulateProfile({ profile, scenario }) {
  const allowlists = profile.policy.allowlists;
  const limits = profile.policy.limits;
  const compliance = profile.policy.compliance;
  const tier = findApprovalTier(profile, scenario.amountUsdCents);

  const checks = [
    { id: "provider_allowlisted", ok: compliance.enforceVendorAllowlist ? allowlists.providers.includes(scenario.providerId) : true },
    { id: "tool_allowlisted", ok: allowlists.tools.includes(scenario.toolId) },
    { id: "per_request_limit", ok: scenario.amountUsdCents <= limits.perRequestUsdCents },
    { id: "monthly_limit", ok: scenario.amountUsdCents + scenario.monthToDateSpendUsdCents <= limits.monthlyUsdCents },
    { id: "receipt_signature", ok: compliance.requireReceiptSignature ? scenario.receiptSigned : true },
    { id: "tool_manifest_hash", ok: compliance.requireToolManifestHash ? scenario.toolManifestHashPresent : true }
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
    profileId: profile.profileId,
    decision,
    requiredApprovers,
    approvalsProvided: scenario.approvalsProvided,
    selectedApprovalTier: tier.tierId,
    reasons,
    checks,
    scenario
  };
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

function renderListText(templates) {
  const lines = [];
  for (const profile of templates) {
    lines.push(`${profile.profileId}\t${profile.metadata.vertical}\t${profile.metadata.name}`);
  }
  return `${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

function renderValidationText(report) {
  if (report.ok) return "ok\n";
  return report.errors.map((row) => `${row.code}\t${row.path}\t${row.message}`).join("\n") + "\n";
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

async function handleList(parsed) {
  const templates = listProfileTemplates();
  const payload = {
    schemaVersion: PROFILE_TEMPLATE_CATALOG_VERSION,
    profiles: templates
  };
  await writeOutput({
    format: parsed.format,
    payload,
    text: renderListText(templates),
    jsonOut: parsed.jsonOut
  });
  return 0;
}

async function handleInit(parsed) {
  const profile = createStarterProfile({ profileId: parsed.profileId });
  if (!profile) fail(`unknown profile template: ${parsed.profileId}`);
  const targetPath = path.resolve(process.cwd(), parsed.outPath || `${parsed.profileId}.profile.json`);
  if (!parsed.force && (await exists(targetPath))) fail(`output path exists: ${targetPath}`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");

  const payload = {
    ok: true,
    command: "init",
    profileId: parsed.profileId,
    outPath: targetPath
  };
  await writeOutput({
    format: parsed.format,
    payload,
    text: `ok\t${parsed.profileId}\t${targetPath}\n`,
    jsonOut: parsed.jsonOut
  });
  return 0;
}

async function handleValidate(parsed) {
  const profile = await readJsonPath(parsed.inputPath);
  const report = validateProfileDocument(profile);
  await writeOutput({
    format: parsed.format,
    payload: report,
    text: renderValidationText(report),
    jsonOut: parsed.jsonOut
  });
  return report.ok ? 0 : 1;
}

async function loadScenario(parsed, profile) {
  if (parsed.scenarioJson) return normalizeScenario(JSON.parse(parsed.scenarioJson), { profile });
  if (parsed.scenarioPath) return normalizeScenario(await readJsonPath(parsed.scenarioPath), { profile });
  return normalizeScenario(buildDefaultScenario(profile), { profile });
}

async function handleSimulate(parsed) {
  const profile = await readJsonPath(parsed.inputPath);
  const validation = validateProfileDocument(profile);
  if (!validation.ok) {
    await writeOutput({
      format: parsed.format,
      payload: validation,
      text: renderValidationText(validation),
      jsonOut: parsed.jsonOut
    });
    return 1;
  }
  const scenario = await loadScenario(parsed, profile);
  const report = simulateProfile({ profile, scenario });
  await writeOutput({
    format: parsed.format,
    payload: report,
    text: renderSimulationText(report),
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
    if (parsed.command === "list") code = await handleList(parsed);
    if (parsed.command === "init") code = await handleInit(parsed);
    if (parsed.command === "validate") code = await handleValidate(parsed);
    if (parsed.command === "simulate") code = await handleSimulate(parsed);
    process.exit(code);
  } catch (err) {
    process.stderr.write(`${err?.message ?? "command failed"}\n`);
    process.exit(1);
  }
}

main();
