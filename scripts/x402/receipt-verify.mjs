import fs from "node:fs/promises";

import {
  formatX402ReceiptVerificationReportText,
  verifyX402ReceiptRecord
} from "../../src/core/x402-receipt-verifier.js";
import { verifyX402ExecutionProofV1 } from "../../src/core/zk-verifier.js";

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage:");
  console.error("  settld x402 receipt verify <receipt.json|-> [--strict] [--format json|text] [--json-out <path>]");
  console.error("  settld x402 receipt verify --in <receipt.json|-> [--strict] [--format json|text] [--json-out <path>]");
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  let inPath = null;
  let strict = false;
  let format = "text";
  let jsonOut = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] ?? "");
    if (!arg) continue;
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    if (arg === "--in") {
      const value = String(args[i + 1] ?? "").trim();
      if (!value) throw new Error("--in requires a value");
      inPath = value;
      i += 1;
      continue;
    }
    if (arg === "--json-out") {
      const value = String(args[i + 1] ?? "").trim();
      if (!value) throw new Error("--json-out requires a value");
      jsonOut = value;
      i += 1;
      continue;
    }
    if (arg === "--format") {
      const value = String(args[i + 1] ?? "").trim().toLowerCase();
      if (value !== "json" && value !== "text") throw new Error("--format must be json|text");
      format = value;
      i += 1;
      continue;
    }
    if (!arg.startsWith("-") && inPath === null) {
      inPath = arg;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!inPath) throw new Error("receipt input path is required");
  return { help: false, inPath, strict, format, jsonOut };
}

async function readReceiptInput(pathLike) {
  if (pathLike === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8"));
    return Buffer.concat(chunks).toString("utf8");
  }
  return await fs.readFile(pathLike, "utf8");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function appendReportIssue(target, { code, message, detail = null }) {
  if (!Array.isArray(target)) return;
  target.push({
    code: String(code),
    message: String(message),
    ...(detail === null || detail === undefined ? {} : { detail })
  });
}

function appendReportCheck(target, { id, ok, detail = null }) {
  if (!Array.isArray(target)) return;
  target.push({
    id: String(id),
    ok: ok === true,
    ...(detail === null || detail === undefined ? {} : { detail })
  });
}

function rebuildReportSummary(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const warnings = Array.isArray(report?.warnings) ? report.warnings : [];
  const errors = Array.isArray(report?.errors) ? report.errors : [];
  const failedChecks = checks.filter((check) => check?.ok !== true).length;
  report.summary = {
    totalChecks: checks.length,
    failedChecks,
    warningCount: warnings.length,
    errorCount: errors.length
  };
  report.ok = errors.length === 0;
}

function resolveReceiptZkProofEvidence(receipt) {
  const fromTopLevel = isPlainObject(receipt?.zkProof) ? receipt.zkProof : null;
  const fromBindings = isPlainObject(receipt?.bindings?.zkProof) ? receipt.bindings.zkProof : null;
  if (fromTopLevel) return fromTopLevel;
  if (fromBindings) return fromBindings;
  return null;
}

async function applyOfflineZkProofVerification({ receipt, report }) {
  const evidence = resolveReceiptZkProofEvidence(receipt);
  if (!evidence) return;

  const required = evidence.required === true;
  const protocol = typeof evidence.protocol === "string" && evidence.protocol.trim() !== "" ? evidence.protocol.trim().toLowerCase() : null;
  const verificationKey =
    evidence.verificationKey && typeof evidence.verificationKey === "object" && !Array.isArray(evidence.verificationKey)
      ? evidence.verificationKey
      : null;
  const verificationKeyRef =
    typeof evidence.verificationKeyRef === "string" && evidence.verificationKeyRef.trim() !== "" ? evidence.verificationKeyRef.trim() : null;
  const publicSignals = Array.isArray(evidence.publicSignals) ? evidence.publicSignals : null;
  const proofData = evidence.proofData && typeof evidence.proofData === "object" && !Array.isArray(evidence.proofData) ? evidence.proofData : null;
  const statementHashSha256 =
    typeof evidence.statementHashSha256 === "string" && evidence.statementHashSha256.trim() !== ""
      ? evidence.statementHashSha256.trim().toLowerCase()
      : null;
  const inputDigestSha256 =
    typeof evidence.inputDigestSha256 === "string" && evidence.inputDigestSha256.trim() !== ""
      ? evidence.inputDigestSha256.trim().toLowerCase()
      : null;
  const outputDigestSha256 =
    typeof evidence.outputDigestSha256 === "string" && evidence.outputDigestSha256.trim() !== ""
      ? evidence.outputDigestSha256.trim().toLowerCase()
      : null;

  const hasProofMaterial = Boolean(protocol && publicSignals && proofData);
  if (!hasProofMaterial) {
    if (required) {
      appendReportIssue(report.errors, {
        code: "zk_proof_offline_material_missing",
        message: "required zk proof material is missing from receipt export"
      });
      appendReportCheck(report.checks, {
        id: "zk_proof_offline_crypto",
        ok: false,
        detail: { required: true, present: false }
      });
      rebuildReportSummary(report);
      return;
    }
    appendReportIssue(report.warnings, {
      code: "zk_proof_offline_not_present",
      message: "no zk proof material was present in receipt export"
    });
    appendReportCheck(report.checks, {
      id: "zk_proof_offline_crypto",
      ok: true,
      detail: { required: false, present: false, skipped: true }
    });
    rebuildReportSummary(report);
    return;
  }

  const verification = await verifyX402ExecutionProofV1({
    proof: {
      protocol,
      publicSignals,
      proofData,
      ...(verificationKey ? { verificationKey } : {}),
      ...(verificationKeyRef ? { verificationKeyRef } : {}),
      ...(statementHashSha256 ? { statementHashSha256 } : {}),
      ...(inputDigestSha256 ? { inputDigestSha256 } : {}),
      ...(outputDigestSha256 ? { outputDigestSha256 } : {})
    },
    verificationKey,
    expectedVerificationKeyRef: verificationKeyRef,
    requiredProtocol: protocol,
    expectedBindings: {
      statementHashSha256,
      inputDigestSha256,
      outputDigestSha256
    },
    requireBindings: required
  });

  const verified = verification?.verified === true;
  const detail = {
    required,
    protocol,
    verificationKeyRef: verificationKeyRef ?? null,
    status: verification?.status ?? null,
    code: verification?.code ?? null
  };
  if (verified) {
    appendReportCheck(report.checks, { id: "zk_proof_offline_crypto", ok: true, detail });
    rebuildReportSummary(report);
    return;
  }

  if (required) {
    appendReportIssue(report.errors, {
      code: "zk_proof_offline_invalid",
      message: "required zk proof failed offline cryptographic verification",
      detail
    });
    appendReportCheck(report.checks, { id: "zk_proof_offline_crypto", ok: false, detail });
  } else {
    appendReportIssue(report.warnings, {
      code: "zk_proof_offline_unverified_optional",
      message: "optional zk proof did not verify offline; settlement remained valid because proof was not required",
      detail
    });
    appendReportCheck(report.checks, { id: "zk_proof_offline_crypto", ok: true, detail: { ...detail, optional: true } });
  }
  rebuildReportSummary(report);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    usage();
    // eslint-disable-next-line no-console
    console.error(String(err?.message ?? err));
    process.exit(1);
    return;
  }
  if (parsed.help) {
    usage();
    process.exit(0);
    return;
  }

  let raw;
  try {
    raw = await readReceiptInput(parsed.inPath);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`failed to read receipt input: ${err?.message ?? String(err ?? "")}`);
    process.exit(1);
    return;
  }

  let receipt;
  try {
    receipt = JSON.parse(raw);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`invalid receipt JSON: ${err?.message ?? String(err ?? "")}`);
    process.exit(1);
    return;
  }

  let report;
  try {
    report = verifyX402ReceiptRecord({ receipt, strict: parsed.strict });
    await applyOfflineZkProofVerification({ receipt, report });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`receipt verification failed: ${err?.message ?? String(err ?? "")}`);
    process.exit(1);
    return;
  }

  if (parsed.jsonOut) {
    await fs.writeFile(parsed.jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (parsed.format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const baseText = formatX402ReceiptVerificationReportText(report);
    const zkCheck = Array.isArray(report?.checks) ? report.checks.find((check) => check?.id === "zk_proof_offline_crypto") : null;
    if (!zkCheck) {
      process.stdout.write(baseText);
    } else {
      const zkState = zkCheck.ok === true ? "verified" : "failed";
      process.stdout.write(`${baseText}zkProof: ${zkState}\n`);
    }
  }
  process.exit(report.ok === true ? 0 : 1);
}

await main();
