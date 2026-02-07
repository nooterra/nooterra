#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import { canonicalJsonStringify } from "../src/canonical-json.js";
import { sha256HexUtf8 } from "../src/crypto.js";
import {
  reconcileGlBatchAgainstPartyStatements,
  verifyArtifactHash,
  verifyArtifactVersion,
  verifyClosePackBundleDir,
  verifyFinancePackBundleDir,
  verifyInvoiceBundleDir,
  verifyJobProofBundleDir,
  verifyMonthProofBundleDir,
  verifySettlementDecisionReportV1Binding,
  verifySettlementDecisionReportV1Signature,
  verifySettlementBalances
} from "../src/index.js";
import { unzipToTempSafe } from "../src/safe-unzip.js";
import { readToolCommitBestEffort, readToolVersionBestEffort } from "../src/tool-provenance.js";

function usage() {
  const text = [
    "usage:",
    "  settld-verify --version",
    "  settld-verify --about [--format human|json]",
    "  settld-verify <artifact.json> [artifact2.json ...]",
    "  settld-verify --reconcile <month-proof-bundle-dir>",
    "  settld-verify [--strict] [--fail-on-warnings] [--explain] [--format human|json|sarif] [--report-json <path>] [--hash-concurrency <n>] --job-proof <JobProofBundle.v1.zip|dir>",
    "  settld-verify [--strict] [--fail-on-warnings] [--explain] [--format human|json|sarif] [--report-json <path>] [--hash-concurrency <n>] --month-proof <MonthProofBundle.v1.zip|dir>",
    "  settld-verify [--strict] [--fail-on-warnings] [--explain] [--format human|json|sarif] [--report-json <path>] [--hash-concurrency <n>] --finance-pack <FinancePackBundle.v1.zip|dir>",
    "  settld-verify [--strict] [--fail-on-warnings] [--explain] [--format human|json|sarif] [--report-json <path>] [--hash-concurrency <n>] --invoice-bundle <InvoiceBundle.v1.zip|dir> [--settlement-decision <SettlementDecisionReport.v1.json> --trusted-buyer-keys <keys.json|json>]",
    "  settld-verify [--strict] [--fail-on-warnings] [--explain] [--format human|json|sarif] [--report-json <path>] [--hash-concurrency <n>] --close-pack <ClosePack.v1.zip|dir>"
  ].join("\n");
  fsSync.writeFileSync(2, text + "\n");
}

async function writeStdout(data) {
  // Use sync FD writes so spawned callers reading from pipes don't race on "exit"
  // vs "stdout data" delivery, and so we don't depend on process.exit semantics.
  fsSync.writeFileSync(1, data);
}

async function writeStderr(data) {
  fsSync.writeFileSync(2, data);
}

async function listFilesRecursive(dir) {
  const out = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(current, e.name);
      if (e.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(fp);
      } else if (e.isFile()) {
        out.push(fp);
      }
    }
  }
  await walk(dir);
  out.sort();
  return out;
}

async function unzipToTemp(zipPath) {
  return await unzipToTempSafe({ zipPath });
}

function normalizeFinding(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { code: "UNKNOWN", path: null, message: null, detail: item ?? null };
  }
  const code = typeof item.code === "string" && item.code.trim() ? item.code : typeof item.warning === "string" && item.warning.trim() ? item.warning : "UNKNOWN";
  const out = { code, path: null, message: null, detail: null };
  if (typeof item.path === "string" && item.path.trim()) out.path = item.path.replaceAll("\\", "/");
  if (typeof item.name === "string" && item.name.trim() && !out.path) out.path = item.name.replaceAll("\\", "/");
  if (typeof item.message === "string" && item.message.trim()) out.message = item.message;
  if (item.detail !== undefined) out.detail = item.detail;
  else if (item.warning !== undefined || item.code !== undefined) {
    const { warning: _w, code: _c, path: _p, name: _n, message: _m, ...rest } = item;
    if (Object.keys(rest).length) out.detail = rest;
  } else {
    out.detail = item;
  }
  return out;
}

function cmpString(a, b) {
  const aa = String(a ?? "");
  const bb = String(b ?? "");
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function normalizeFindings(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = arr.map(normalizeFinding);
  out.sort((a, b) => cmpString(a.path ?? "", b.path ?? "") || cmpString(a.code ?? "", b.code ?? ""));
  return out;
}

function primaryErrorFromResult(result) {
  if (result && result.ok === false) {
    const detailValue = result.detail !== undefined ? result.detail : result;
    const promotedCode = (() => {
      let cur = detailValue;
      let code = null;
      for (let i = 0; i < 20; i += 1) {
        if (!cur || typeof cur !== "object" || Array.isArray(cur)) break;
        if (typeof cur.error === "string" && cur.error.trim()) code = cur.error;
        cur = cur.detail;
      }
      return code;
    })();
    const code = promotedCode ?? (typeof result.error === "string" && result.error.trim() ? result.error : "FAILED");
    const pathValue =
      typeof result.path === "string" && result.path.trim()
        ? result.path
        : typeof result.name === "string" && result.name.trim()
          ? result.name
          : null;
    const message = promotedCode && promotedCode !== result.error ? (typeof result.error === "string" && result.error.trim() ? result.error : null) : null;
    return [{ code, path: pathValue, message, detail: detailValue }];
  }
  return [];
}

function formatCliOutput({ kind, input, resolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit }) {
  const warnings = normalizeFindings(result?.warnings ?? []);
  const errors = [...primaryErrorFromResult(result)];
  if (failOnWarnings && (result?.ok === true || result?.ok === undefined) && warnings.length) {
    errors.push({ code: "FAIL_ON_WARNINGS", path: null, message: "warnings treated as errors", detail: { warningsCount: warnings.length } });
  }
  errors.sort((a, b) => cmpString(a.path ?? "", b.path ?? "") || cmpString(a.code ?? "", b.code ?? ""));

  const verificationOk = Boolean(result && result.ok === true);
  const ok = errors.length === 0 && verificationOk;

  return {
    schemaVersion: "VerifyCliOutput.v1",
    tool: { name: "settld-verify", version: toolVersion ?? null, commit: toolCommit ?? null },
    mode: { strict, failOnWarnings },
    target: { kind, input, resolved: String(resolved ?? "").replaceAll("\\", "/"), dir: dir === null ? null : String(dir ?? "").replaceAll("\\", "/") },
    ok,
    verificationOk,
    errors,
    warnings,
    summary: {
      tenantId: result?.tenantId ?? null,
      period: result?.period ?? null,
      type: result?.type ?? result?.kind ?? null,
      manifestHash: result?.manifestHash ?? null
    }
  };
}

function formatAboutOutput({ toolVersion, toolCommit }) {
  return {
    schemaVersion: "VerifyAboutOutput.v1",
    tool: { name: "settld-verify", version: toolVersion ?? null, commit: toolCommit ?? null },
    protocol: {
      canonicalJson: "RFC8785",
      objects: [
        "ProofBundleManifest.v1",
        "FinancePackBundleManifest.v1",
        "InvoiceBundleManifest.v1",
        "ClosePackManifest.v1",
        "BundleHeadAttestation.v1",
        "VerificationReport.v1",
        "PricingMatrix.v1",
        "PricingMatrixSignatures.v1",
        "PricingMatrixSignatures.v2",
        "MeteringReport.v1",
        "InvoiceClaim.v1",
        "EvidenceIndex.v1",
        "SlaDefinition.v1",
        "SlaEvaluation.v1",
        "AcceptanceCriteria.v1",
        "AcceptanceEvaluation.v1",
        "VerifyCliOutput.v1",
        "VerifyAboutOutput.v1"
      ]
    },
    defaults: { strict: false, hashConcurrency: 16 },
    features: { format: ["human", "json"], failOnWarnings: true, hashConcurrency: true }
  };
}

function sarifLevelForFinding(code, { isWarning }) {
  if (isWarning) return "warning";
  if (code === "FAIL_ON_WARNINGS") return "error";
  return "error";
}

function normalizeExplainPath(p) {
  if (p === null || p === undefined) return "";
  return String(p).replaceAll("\\", "/");
}

function tryParseKeyCount(jsonText) {
  if (typeof jsonText !== "string" || !jsonText.trim()) return "";
  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    return String(Object.keys(parsed).length);
  } catch {
    return "";
  }
}

function csvCodes(list) {
  const codes = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== "object") continue;
    const c = typeof item.code === "string" && item.code.trim() ? item.code.trim() : null;
    if (c) codes.push(c);
  }
  return Array.from(new Set(codes)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(",");
}

async function writeExplain({ kind, input, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut }) {
  const lines = [];
  lines.push("settld-verify explain v1");
  lines.push(`target.kind=${String(kind ?? "")}`);
  lines.push(`target.input=${normalizeExplainPath(input)}`);
  lines.push(`target.resolved=${normalizeExplainPath(resolved)}`);
  lines.push(`target.dir=${normalizeExplainPath(dir)}`);
  lines.push(`mode.strict=${strict ? "true" : "false"}`);
  lines.push(`mode.failOnWarnings=${failOnWarnings ? "true" : "false"}`);
  lines.push(`mode.format=${String(format ?? "")}`);
  lines.push(`hash.concurrency=${hashConcurrency === null || hashConcurrency === undefined ? "" : String(hashConcurrency)}`);
  lines.push(`trust.governanceRoots.count=${tryParseKeyCount(process.env.SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON ?? "")}`);
  lines.push(`trust.timeAuthorities.count=${tryParseKeyCount(process.env.SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON ?? "")}`);
  lines.push(`trust.pricingSigners.count=${tryParseKeyCount(process.env.SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON ?? "")}`);

  lines.push(`result.ok=${result?.ok === true ? "true" : "false"}`);
  if (result?.ok !== true) lines.push(`result.error=${String(result?.error ?? "FAILED")}`);
  lines.push(`result.manifestHash=${String(result?.manifestHash ?? "")}`);

  if (result?.pricingMatrixSignatures && typeof result.pricingMatrixSignatures === "object" && !Array.isArray(result.pricingMatrixSignatures)) {
    lines.push(`result.pricingMatrixSignatures.present=${result.pricingMatrixSignatures.present === true ? "true" : "false"}`);
    lines.push(`result.pricingMatrixSignatures.hashKind=${String(result.pricingMatrixSignatures.pricingMatrixHashKind ?? "")}`);
    lines.push(`result.pricingMatrixSignatures.schemaVersion=${String(result.pricingMatrixSignatures.pricingMatrixSignaturesSchemaVersion ?? "")}`);
    lines.push(`result.pricingMatrixSignatures.pricingMatrixHash=${String(result.pricingMatrixSignatures.pricingMatrixHash ?? "")}`);
    const kids = Array.isArray(result.pricingMatrixSignatures.signerKeyIds) ? result.pricingMatrixSignatures.signerKeyIds.map(String).filter(Boolean) : [];
    lines.push(`result.pricingMatrixSignatures.signerKeyIds=${kids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(",")}`);
  }

  if (result?.headAttestation && typeof result.headAttestation === "object" && !Array.isArray(result.headAttestation)) {
    lines.push(`result.headAttestation.ok=${result.headAttestation.ok === true ? "true" : "false"}`);
    lines.push(`result.headAttestation.attestationHash=${String(result.headAttestation.attestationHash ?? "")}`);
    lines.push(`result.headAttestation.signerKeyId=${String(result.headAttestation.signerKeyId ?? "")}`);
    lines.push(`result.headAttestation.signedAt=${String(result.headAttestation.signedAt ?? "")}`);
  }
  if (result?.verificationReport && typeof result.verificationReport === "object" && !Array.isArray(result.verificationReport)) {
    lines.push(`result.verificationReport.ok=${result.verificationReport.ok === true ? "true" : "false"}`);
    lines.push(`result.verificationReport.signerKeyId=${String(result.verificationReport.signerKeyId ?? "")}`);
    lines.push(`result.verificationReport.signedAt=${String(result.verificationReport.signedAt ?? "")}`);
    lines.push(`result.verificationReport.manifestHash=${String(result.verificationReport.manifestHash ?? "")}`);
    lines.push(`result.verificationReport.expectedBundleHeadAttestationHash=${String(result.verificationReport.expectedBundleHeadAttestationHash ?? "")}`);
  }

  if (cliOut && typeof cliOut === "object" && !Array.isArray(cliOut)) {
    lines.push(`cli.ok=${cliOut.ok === true ? "true" : "false"}`);
    lines.push(`cli.verificationOk=${cliOut.verificationOk === true ? "true" : "false"}`);
    lines.push(`cli.errors=${csvCodes(cliOut.errors)}`);
    lines.push(`cli.warnings=${csvCodes(cliOut.warnings)}`);
  }

  // Explain is a deterministic, pipe-safe human diagnostic surface:
  // - exactly one trailing newline
  // - no blank trailing lines
  while (lines.length && String(lines[lines.length - 1] ?? "") === "") lines.pop();
  await writeStderr(lines.join("\n") + "\n");
}

function formatSarifFromCliOutput(cliOut) {
  const results = [];
  const all = [
    ...(Array.isArray(cliOut.errors) ? cliOut.errors.map((e) => ({ ...e, _isWarning: false })) : []),
    ...(Array.isArray(cliOut.warnings) ? cliOut.warnings.map((w) => ({ ...w, _isWarning: true })) : [])
  ];
  for (const f of all) {
    if (!f || typeof f !== "object") continue;
    const code = String(f.code ?? "UNKNOWN");
    const message = f.message ? String(f.message) : code;
    const relPath = typeof f.path === "string" && f.path.trim() ? f.path : null;
    const locations = relPath
      ? [
          {
            physicalLocation: {
              artifactLocation: { uri: relPath }
            }
          }
        ]
      : [];
    results.push({
      ruleId: code,
      level: sarifLevelForFinding(code, { isWarning: Boolean(f._isWarning) }),
      message: { text: message },
      locations: locations.length ? locations : undefined
    });
  }

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: cliOut?.tool?.name ?? "settld-verify",
            version: cliOut?.tool?.version ?? undefined,
            semanticVersion: cliOut?.tool?.version ?? undefined,
            properties: { commit: cliOut?.tool?.commit ?? null }
          }
        },
        results
      }
    ]
  };
}

async function main() {
  const rawArgs = process.argv.slice(2).filter(Boolean);
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    usage();
    return 0;
  }
  let strict = false;
  let failOnWarnings = false;
  let format = "human";
  let reportJsonPath = null;
  let hashConcurrency = null;
  let about = false;
  let explain = false;
  let settlementDecisionPath = null;
  let trustedBuyerKeys = null;
  const args = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const a = rawArgs[i];
    if (a === "--version") {
      const toolVersion = await readToolVersionBestEffort();
      if (!toolVersion || typeof toolVersion !== "string") {
        await writeStderr("tool version unknown\n");
        return 2;
      }
      await writeStdout(String(toolVersion).trim() + "\n");
      return 0;
    }
    if (a === "--about") {
      about = true;
      continue;
    }
    if (a === "--strict") {
      strict = true;
      continue;
    }
    if (a === "--fail-on-warnings") {
      failOnWarnings = true;
      continue;
    }
    if (a === "--explain") {
      explain = true;
      continue;
    }
    if (a === "--format") {
      format = String(rawArgs[i + 1] ?? "");
      if (!format) {
        usage();
        return 2;
      }
      i += 1;
      continue;
    }
    if (a === "--report-json") {
      reportJsonPath = rawArgs[i + 1] ?? null;
      if (!reportJsonPath) {
        usage();
        return 2;
      }
      i += 1;
      continue;
    }
    if (a === "--hash-concurrency") {
      const v = rawArgs[i + 1] ?? null;
      const n = Number.parseInt(String(v ?? ""), 10);
      if (!Number.isInteger(n) || n < 1) {
        await writeStderr(`invalid --hash-concurrency: ${String(v ?? "")}\n`);
        usage();
        return 2;
      }
      hashConcurrency = n;
      i += 1;
      continue;
    }
    if (a === "--settlement-decision") {
      settlementDecisionPath = rawArgs[i + 1] ?? null;
      if (!settlementDecisionPath) {
        usage();
        return 2;
      }
      i += 1;
      continue;
    }
    if (a === "--trusted-buyer-keys") {
      trustedBuyerKeys = rawArgs[i + 1] ?? null;
      if (!trustedBuyerKeys) {
        usage();
        return 2;
      }
      i += 1;
      continue;
    }
    args.push(a);
  }
  if (format !== "human" && format !== "json" && format !== "sarif") {
    await writeStderr(`invalid --format: ${format}\n`);
    usage();
    return 2;
  }
  if (about) {
    if (format === "sarif") {
      await writeStderr("--about does not support --format sarif\n");
      return 2;
    }
    const toolVersion = await readToolVersionBestEffort();
    const toolCommit = readToolCommitBestEffort();
    const out = formatAboutOutput({ toolVersion, toolCommit });
    if (format === "json") await writeStdout(JSON.stringify(out, null, 2) + "\n");
    else await writeStdout(`settld-verify ${toolVersion ?? "unknown"} (${toolCommit ?? "commit-unknown"})\n`);
    return 0;
  }
  if (!args.length) {
    usage();
    return 2;
  }

  const toolVersion = await readToolVersionBestEffort();
  const toolCommit = readToolCommitBestEffort();

  if (args[0] === "--reconcile") {
    const dir = args[1] ?? null;
    if (!dir) {
      usage();
      return 2;
    }

    const files = await listFilesRecursive(dir);
    const glCandidates = files.filter((fp) => fp.includes(`${path.sep}artifacts${path.sep}GLBatch.v1${path.sep}`) && fp.endsWith(".json"));
    const psCandidates = files.filter((fp) => fp.includes(`${path.sep}artifacts${path.sep}PartyStatement.v1${path.sep}`) && fp.endsWith(".json"));

    if (glCandidates.length !== 1) {
      await writeStderr(`reconcile: expected exactly 1 GLBatch.v1 artifact, got ${glCandidates.length}\n`);
      return 1;
    }
    if (!psCandidates.length) {
      await writeStderr("reconcile: expected at least 1 PartyStatement.v1 artifact, got 0\n");
      return 1;
    }

    const glBatch = JSON.parse(await fs.readFile(glCandidates[0], "utf8"));
    const partyStatements = [];
    for (const fp of psCandidates) {
      // eslint-disable-next-line no-await-in-loop
      partyStatements.push(JSON.parse(await fs.readFile(fp, "utf8")));
    }

    const result = reconcileGlBatchAgainstPartyStatements({ glBatch, partyStatements });
    if (!result.ok) {
      if (format === "json") {
        await writeStdout(
          JSON.stringify(
            formatCliOutput({
              kind: "reconcile",
              input: dir,
              resolved: path.resolve(dir),
              dir: path.resolve(dir),
              strict: false,
              failOnWarnings,
              result: { ok: false, error: result.error, detail: result, warnings: [] },
              toolVersion,
              toolCommit
            }),
            null,
            2
          ) + "\n"
        );
      } else {
        await writeStderr(`reconcile: FAILED (${result.error})\n`);
        await writeStderr(JSON.stringify(result, null, 2) + "\n");
      }
      return 1;
    }
    if (format === "json") {
      const out = formatCliOutput({
        kind: "reconcile",
        input: dir,
        resolved: path.resolve(dir),
        dir: path.resolve(dir),
        strict: false,
        failOnWarnings,
        result: { ok: true, warnings: [], ...result },
        toolVersion,
        toolCommit
      });
      await writeStdout(JSON.stringify(out, null, 2) + "\n");
      return out.ok ? 0 : 1;
    }
    await writeStdout(`reconcile: OK (period=${result.period} basis=${result.basis} entries=${result.entryCount})\n`);
    return 0;
  }

  if (args[0] === "--finance-pack") {
    const target = args[1] ?? null;
    if (!target) {
      usage();
      return 2;
    }

    const resolved = path.resolve(target);
    let dir = resolved;
    if (resolved.endsWith(".zip")) {
      const unzip = await unzipToTemp(resolved);
      if (!unzip.ok) {
        const result = { ok: false, error: unzip.error, detail: unzip.detail, warnings: [] };
        if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
        if (format === "json" || format === "sarif") {
          const out = formatCliOutput({ kind: "finance-pack", input: target, resolved, dir: null, strict, failOnWarnings, result, toolVersion, toolCommit });
          if (explain) await writeExplain({ kind: "finance-pack", input: target, resolved, dir: null, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
          if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
          else await writeStdout(JSON.stringify(out, null, 2) + "\n");
          return out.ok ? 0 : 1;
        }
        if (explain) await writeExplain({ kind: "finance-pack", input: target, resolved, dir: null, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
        await writeStderr(`finance-pack: FAILED (${unzip.error})\n`);
        await writeStderr(JSON.stringify(unzip, null, 2) + "\n");
        return 1;
      }
      dir = unzip.dir;
    }
    const result = await verifyFinancePackBundleDir({ dir, strict, hashConcurrency });
    if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
    if (format === "json" || format === "sarif") {
      const out = formatCliOutput({ kind: "finance-pack", input: target, resolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
      if (explain) await writeExplain({ kind: "finance-pack", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
      if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
      else await writeStdout(JSON.stringify(out, null, 2) + "\n");
      return out.ok ? 0 : 1;
    }
    if (!result.ok) {
      if (explain) await writeExplain({ kind: "finance-pack", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
      await writeStderr(`finance-pack: FAILED (${result.error})\n`);
      await writeStderr(JSON.stringify(result, null, 2) + "\n");
      return 1;
    }
    if (explain) await writeExplain({ kind: "finance-pack", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
    await writeStdout(`finance-pack: OK (tenant=${result.tenantId} period=${result.period})\n`);
    return 0;
  }

  if (args[0] === "--job-proof") {
    const target = args[1] ?? null;
    if (!target) {
      usage();
      return 2;
    }

    const resolved = path.resolve(target);
    let dir = resolved;
    if (resolved.endsWith(".zip")) {
      const unzip = await unzipToTemp(resolved);
      if (!unzip.ok) {
        const result = { ok: false, error: unzip.error, detail: unzip.detail, warnings: [] };
        if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
        if (format === "json" || format === "sarif") {
          const out = formatCliOutput({ kind: "job-proof", input: target, resolved, dir: null, strict, failOnWarnings, result, toolVersion, toolCommit });
          if (explain) await writeExplain({ kind: "job-proof", input: target, resolved, dir: null, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
          if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
          else await writeStdout(JSON.stringify(out, null, 2) + "\n");
          return out.ok ? 0 : 1;
        }
        if (explain) await writeExplain({ kind: "job-proof", input: target, resolved, dir: null, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
        await writeStderr(`job-proof: FAILED (${unzip.error})\n`);
        await writeStderr(JSON.stringify(unzip, null, 2) + "\n");
        return 1;
      }
      dir = unzip.dir;
    }
    const result = await verifyJobProofBundleDir({ dir, strict, hashConcurrency });
    if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
    if (format === "json" || format === "sarif") {
      const out = formatCliOutput({ kind: "job-proof", input: target, resolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
      if (explain) await writeExplain({ kind: "job-proof", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
      if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
      else await writeStdout(JSON.stringify(out, null, 2) + "\n");
      return out.ok ? 0 : 1;
    }
    if (!result.ok) {
      if (explain) await writeExplain({ kind: "job-proof", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
      await writeStderr(`job-proof: FAILED (${result.error})\n`);
      await writeStderr(JSON.stringify(result, null, 2) + "\n");
      return 1;
    }
    if (explain) await writeExplain({ kind: "job-proof", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
    await writeStdout(`job-proof: OK (tenant=${result.tenantId ?? "?"} kind=${result.kind ?? "?"})\n`);
    return 0;
  }

  if (args[0] === "--month-proof") {
    const target = args[1] ?? null;
    if (!target) {
      usage();
      return 2;
    }

    const resolved = path.resolve(target);
    let dir = resolved;
    if (resolved.endsWith(".zip")) {
      const unzip = await unzipToTemp(resolved);
      if (!unzip.ok) {
        const result = { ok: false, error: unzip.error, detail: unzip.detail, warnings: [] };
        if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
        if (format === "json" || format === "sarif") {
          const out = formatCliOutput({ kind: "month-proof", input: target, resolved, dir: null, strict, failOnWarnings, result, toolVersion, toolCommit });
          if (explain) await writeExplain({ kind: "month-proof", input: target, resolved, dir: null, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
          if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
          else await writeStdout(JSON.stringify(out, null, 2) + "\n");
          return out.ok ? 0 : 1;
        }
        if (explain) await writeExplain({ kind: "month-proof", input: target, resolved, dir: null, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
        await writeStderr(`month-proof: FAILED (${unzip.error})\n`);
        await writeStderr(JSON.stringify(unzip, null, 2) + "\n");
        return 1;
      }
      dir = unzip.dir;
    }
    const result = await verifyMonthProofBundleDir({ dir, strict, hashConcurrency });
    if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
    if (format === "json" || format === "sarif") {
      const out = formatCliOutput({ kind: "month-proof", input: target, resolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
      if (explain) await writeExplain({ kind: "month-proof", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
      if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
      else await writeStdout(JSON.stringify(out, null, 2) + "\n");
      return out.ok ? 0 : 1;
    }
    if (!result.ok) {
      if (explain) await writeExplain({ kind: "month-proof", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
      await writeStderr(`month-proof: FAILED (${result.error})\n`);
      await writeStderr(JSON.stringify(result, null, 2) + "\n");
      return 1;
    }
    if (explain) await writeExplain({ kind: "month-proof", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
    await writeStdout(`month-proof: OK (tenant=${result.tenantId ?? "?"} kind=${result.kind ?? "?"})\n`);
    return 0;
  }

  if (args[0] === "--close-pack") {
    const target = args[1] ?? null;
    if (!target) {
      usage();
      return 2;
    }

    const resolved = path.resolve(target);
    let dir = resolved;
    if (resolved.endsWith(".zip")) {
      const unzip = await unzipToTemp(resolved);
      if (!unzip.ok) {
        const result = { ok: false, error: unzip.error, detail: unzip.detail, warnings: [] };
        if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
        if (format === "json" || format === "sarif") {
          const out = formatCliOutput({ kind: "close-pack", input: target, resolved, dir: null, strict, failOnWarnings, result, toolVersion, toolCommit });
          if (explain) await writeExplain({ kind: "close-pack", input: target, resolved, dir: null, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
          if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
          else await writeStdout(JSON.stringify(out, null, 2) + "\n");
          return out.ok ? 0 : 1;
        }
        if (explain) await writeExplain({ kind: "close-pack", input: target, resolved, dir: null, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
        await writeStderr(`close-pack: FAILED (${unzip.error})\n`);
        await writeStderr(JSON.stringify(unzip, null, 2) + "\n");
        return 1;
      }
      dir = unzip.dir;
    }
    const result = await verifyClosePackBundleDir({ dir, strict, hashConcurrency });
    if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
    if (format === "json" || format === "sarif") {
      const out = formatCliOutput({ kind: "close-pack", input: target, resolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
      if (explain) await writeExplain({ kind: "close-pack", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
      if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
      else await writeStdout(JSON.stringify(out, null, 2) + "\n");
      return out.ok ? 0 : 1;
    }
    if (!result.ok) {
      if (explain) await writeExplain({ kind: "close-pack", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
      await writeStderr(`close-pack: FAILED (${result.error})\n`);
      await writeStderr(JSON.stringify(result, null, 2) + "\n");
      return 1;
    }
    if (explain) await writeExplain({ kind: "close-pack", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
    await writeStdout(`close-pack: OK (tenant=${result.tenantId ?? "?"} kind=${result.kind ?? "?"})\n`);
    return 0;
  }

  if (args[0] === "--invoice-bundle") {
    const target = args[1] ?? null;
    if (!target) {
      usage();
      return 2;
    }

    const resolved = path.resolve(target);
    let dir = resolved;
    if (resolved.endsWith(".zip")) {
      const unzip = await unzipToTemp(resolved);
      if (!unzip.ok) {
        const result = { ok: false, error: unzip.error, detail: unzip.detail, warnings: [] };
        if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
        if (format === "json" || format === "sarif") {
          const out = formatCliOutput({ kind: "invoice-bundle", input: target, resolved, dir: null, strict, failOnWarnings, result, toolVersion, toolCommit });
          if (explain) await writeExplain({ kind: "invoice-bundle", input: target, resolved, dir: null, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
          if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
          else await writeStdout(JSON.stringify(out, null, 2) + "\n");
          return out.ok ? 0 : 1;
        }
        if (explain) await writeExplain({ kind: "invoice-bundle", input: target, resolved, dir: null, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
        await writeStderr(`invoice-bundle: FAILED (${unzip.error})\n`);
        await writeStderr(JSON.stringify(unzip, null, 2) + "\n");
        return 1;
      }
      dir = unzip.dir;
    }

    if (settlementDecisionPath) {
      const decisionInput = settlementDecisionPath;
      const decisionResolved = path.resolve(decisionInput);

      let decisionReport;
      try {
        decisionReport = JSON.parse(await fs.readFile(decisionResolved, "utf8"));
      } catch (err) {
        const result = { ok: false, error: "invalid JSON", name: decisionInput, detail: { message: err?.message ?? String(err ?? "") }, warnings: [] };
        if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
        if (format === "json" || format === "sarif") {
          const out = formatCliOutput({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
          if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
          if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
          else await writeStdout(JSON.stringify(out, null, 2) + "\n");
          return out.ok ? 0 : 1;
        }
        if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
        await writeStderr(`settlement-decision: FAILED (invalid JSON)\n`);
        await writeStderr(JSON.stringify(result, null, 2) + "\n");
        return 1;
      }

      let manifestJson;
      try {
        manifestJson = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8"));
      } catch (err) {
        const result = { ok: false, error: "invalid JSON", name: "manifest.json", detail: { message: err?.message ?? String(err ?? "") }, warnings: [] };
        if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
        if (format === "json" || format === "sarif") {
          const out = formatCliOutput({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
          if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
          if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
          else await writeStdout(JSON.stringify(out, null, 2) + "\n");
          return out.ok ? 0 : 1;
        }
        if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
        await writeStderr(`settlement-decision: FAILED (invalid JSON)\n`);
        await writeStderr(JSON.stringify(result, null, 2) + "\n");
        return 1;
      }

      const { manifestHash: declaredManifestHash, ...manifestCore } = manifestJson ?? {};
      const computedManifestHash = sha256HexUtf8(canonicalJsonStringify(manifestCore));
      const actualManifestHash = typeof declaredManifestHash === "string" ? declaredManifestHash : null;
      if (actualManifestHash !== computedManifestHash) {
        const result = { ok: false, error: "manifestHash mismatch", expected: computedManifestHash, actual: actualManifestHash, warnings: [] };
        if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
        if (format === "json" || format === "sarif") {
          const out = formatCliOutput({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
          if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
          if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
          else await writeStdout(JSON.stringify(out, null, 2) + "\n");
          return out.ok ? 0 : 1;
        }
        if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
        await writeStderr(`settlement-decision: FAILED (${result.error})\n`);
        await writeStderr(JSON.stringify(result, null, 2) + "\n");
        return 1;
      }

      let headAttestation;
      try {
        headAttestation = JSON.parse(await fs.readFile(path.join(dir, "attestation", "bundle_head_attestation.json"), "utf8"));
      } catch {
        headAttestation = null;
      }
      const headAttestationHash = typeof headAttestation?.attestationHash === "string" ? headAttestation.attestationHash : null;
      if (!headAttestationHash) {
        const result = { ok: false, error: "missing attestation/bundle_head_attestation.json", warnings: [] };
        if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
        if (format === "json" || format === "sarif") {
          const out = formatCliOutput({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
          if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
          if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
          else await writeStdout(JSON.stringify(out, null, 2) + "\n");
          return out.ok ? 0 : 1;
        }
        if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
        await writeStderr(`settlement-decision: FAILED (${result.error})\n`);
        await writeStderr(JSON.stringify(result, null, 2) + "\n");
        return 1;
      }

      const rawKeys = trustedBuyerKeys ?? process.env.SETTLD_TRUSTED_SETTLEMENT_DECISION_SIGNER_KEYS_JSON ?? "";
      const keysText = String(rawKeys ?? "").trim();
      if (!keysText) {
        const result = { ok: false, error: "settlement decision trusted buyer keys missing", env: "SETTLD_TRUSTED_SETTLEMENT_DECISION_SIGNER_KEYS_JSON", warnings: [] };
        if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
        if (format === "json" || format === "sarif") {
          const out = formatCliOutput({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
          if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
          if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
          else await writeStdout(JSON.stringify(out, null, 2) + "\n");
          return out.ok ? 0 : 1;
        }
        if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
        await writeStderr(`settlement-decision: FAILED (${result.error})\n`);
        await writeStderr(JSON.stringify(result, null, 2) + "\n");
        return 1;
      }

      let keyJsonText = keysText;
      if (!keysText.startsWith("{")) {
        try {
          keyJsonText = await fs.readFile(path.resolve(keysText), "utf8");
        } catch (err) {
          const result = { ok: false, error: "settlement decision trusted buyer keys invalid", detail: { message: err?.message ?? String(err ?? ""), path: keysText }, warnings: [] };
          if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
          if (format === "json" || format === "sarif") {
            const out = formatCliOutput({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
            if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
            if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
            else await writeStdout(JSON.stringify(out, null, 2) + "\n");
            return out.ok ? 0 : 1;
          }
          if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
          await writeStderr(`settlement-decision: FAILED (${result.error})\n`);
          await writeStderr(JSON.stringify(result, null, 2) + "\n");
          return 1;
        }
      }

      let keysJson;
      try {
        keysJson = JSON.parse(keyJsonText);
      } catch (err) {
        const result = { ok: false, error: "settlement decision trusted buyer keys invalid", detail: { message: err?.message ?? String(err ?? "") }, warnings: [] };
        if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
        if (format === "json" || format === "sarif") {
          const out = formatCliOutput({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
          if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
          if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
          else await writeStdout(JSON.stringify(out, null, 2) + "\n");
          return out.ok ? 0 : 1;
        }
        if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
        await writeStderr(`settlement-decision: FAILED (${result.error})\n`);
        await writeStderr(JSON.stringify(result, null, 2) + "\n");
        return 1;
      }

      if (!keysJson || typeof keysJson !== "object" || Array.isArray(keysJson)) {
        const result = { ok: false, error: "settlement decision trusted buyer keys invalid", detail: { message: "must be a JSON object mapping keyId -> publicKeyPem" }, warnings: [] };
        if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
        if (format === "json" || format === "sarif") {
          const out = formatCliOutput({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
          if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
          if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
          else await writeStdout(JSON.stringify(out, null, 2) + "\n");
          return out.ok ? 0 : 1;
        }
        if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
        await writeStderr(`settlement-decision: FAILED (${result.error})\n`);
        await writeStderr(JSON.stringify(result, null, 2) + "\n");
        return 1;
      }

      const trustedByKeyId = new Map();
      for (const [keyId, publicKeyPem] of Object.entries(keysJson)) {
        if (typeof keyId !== "string" || !keyId.trim()) continue;
        if (typeof publicKeyPem !== "string" || !publicKeyPem.trim()) continue;
        trustedByKeyId.set(keyId.trim(), publicKeyPem);
      }

      const sig = verifySettlementDecisionReportV1Signature({ report: decisionReport, trustedBuyerDecisionPublicKeyByKeyId: trustedByKeyId });
      if (!sig.ok) {
        const result = { ok: false, error: sig.error, detail: sig, warnings: [] };
        if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
        if (format === "json" || format === "sarif") {
          const out = formatCliOutput({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
          if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
          if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
          else await writeStdout(JSON.stringify(out, null, 2) + "\n");
          return out.ok ? 0 : 1;
        }
        if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
        await writeStderr(`settlement-decision: FAILED (${sig.error})\n`);
        await writeStderr(JSON.stringify(sig, null, 2) + "\n");
        return 1;
      }

      const bind = verifySettlementDecisionReportV1Binding({ report: decisionReport, expectedManifestHash: computedManifestHash, expectedHeadAttestationHash: headAttestationHash });
      if (!bind.ok) {
        const result = { ok: false, error: bind.error, detail: bind, warnings: [] };
        if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
        if (format === "json" || format === "sarif") {
          const out = formatCliOutput({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
          if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
          if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
          else await writeStdout(JSON.stringify(out, null, 2) + "\n");
          return out.ok ? 0 : 1;
        }
        if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
        await writeStderr(`settlement-decision: FAILED (${bind.error})\n`);
        await writeStderr(JSON.stringify(bind, null, 2) + "\n");
        return 1;
      }

      const tenantId = (() => {
        try {
          const j = JSON.parse(fsSync.readFileSync(path.join(dir, "settld.json"), "utf8"));
          return typeof j?.tenantId === "string" ? j.tenantId : null;
        } catch {
          return null;
        }
      })();

      const result = {
        ok: true,
        warnings: [],
        type: "SettlementDecisionReport.v1",
        tenantId,
        manifestHash: computedManifestHash,
        decision: decisionReport?.decision ?? null,
        signerKeyId: sig.signerKeyId ?? null,
        signedAt: typeof decisionReport?.signedAt === "string" ? decisionReport.signedAt : null,
        reportHash: sig.reportHash ?? null,
        invoiceBundle: { manifestHash: computedManifestHash, headAttestationHash }
      };
      if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
      if (format === "json" || format === "sarif") {
        const out = formatCliOutput({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
        if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
        if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
        else await writeStdout(JSON.stringify(out, null, 2) + "\n");
        return out.ok ? 0 : 1;
      }
      if (explain) await writeExplain({ kind: "settlement-decision", input: decisionInput, resolved: decisionResolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
      await writeStdout(`settlement-decision: OK (tenant=${tenantId ?? "?"} manifestHash=${computedManifestHash.slice(0, 16)}...)\n`);
      return 0;
    }

    const result = await verifyInvoiceBundleDir({ dir, strict, hashConcurrency });
    if (reportJsonPath) await fs.writeFile(reportJsonPath, canonicalJsonStringify(result) + "\n", "utf8");
    if (format === "json" || format === "sarif") {
      const out = formatCliOutput({ kind: "invoice-bundle", input: target, resolved, dir, strict, failOnWarnings, result, toolVersion, toolCommit });
      if (explain) await writeExplain({ kind: "invoice-bundle", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: out });
      if (format === "sarif") await writeStdout(JSON.stringify(formatSarifFromCliOutput(out), null, 2) + "\n");
      else await writeStdout(JSON.stringify(out, null, 2) + "\n");
      return out.ok ? 0 : 1;
    }
    if (!result.ok) {
      if (explain) await writeExplain({ kind: "invoice-bundle", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
      await writeStderr(`invoice-bundle: FAILED (${result.error})\n`);
      await writeStderr(JSON.stringify(result, null, 2) + "\n");
      return 1;
    }
    if (explain) await writeExplain({ kind: "invoice-bundle", input: target, resolved, dir, strict, failOnWarnings, format, hashConcurrency, result, cliOut: null });
    await writeStdout(`invoice-bundle: OK (tenant=${result.tenantId ?? "?"} invoiceId=${result.invoiceId ?? "?"})\n`);
    return 0;
  }

  let okAll = true;
  const outputs = [];
  for (const fp of args) {
    let json;
    try {
      const raw = await fs.readFile(fp, "utf8");
      json = JSON.parse(raw);
    } catch (err) {
      okAll = false;
      if (format === "json") {
        outputs.push(
          formatCliOutput({
            kind: "artifact",
            input: fp,
            resolved: path.resolve(fp),
            dir: null,
            strict: false,
            failOnWarnings,
            result: { ok: false, error: "invalid JSON", detail: { message: err?.message ?? String(err ?? "") }, warnings: [] },
            toolVersion,
            toolCommit
          })
        );
      } else {
        await writeStderr(`${fp}: FAILED (invalid JSON) ${err?.message ?? ""}`.trim() + "\n");
      }
      continue;
    }

    const hash = verifyArtifactHash(json);
    if (!hash.ok) {
      okAll = false;
      if (format === "json") {
        outputs.push(
          formatCliOutput({
            kind: "artifact",
            input: fp,
            resolved: path.resolve(fp),
            dir: null,
            strict: false,
            failOnWarnings,
            result: { ok: false, error: hash.error, detail: hash, warnings: [] },
            toolVersion,
            toolCommit
          })
        );
      } else {
        await writeStderr(`${fp}: FAILED (${hash.error})\n`);
      }
      continue;
    }

    const ver = verifyArtifactVersion(json);
    if (!ver.ok) {
      okAll = false;
      if (format === "json") {
        outputs.push(
          formatCliOutput({
            kind: "artifact",
            input: fp,
            resolved: path.resolve(fp),
            dir: null,
            strict: false,
            failOnWarnings,
            result: { ok: false, error: ver.error, detail: ver, warnings: [] },
            toolVersion,
            toolCommit
          })
        );
      } else {
        await writeStderr(`${fp}: FAILED (${ver.error})\n`);
      }
      continue;
    }

    const bal = verifySettlementBalances(json);
    if (!bal.ok) {
      okAll = false;
      if (format === "json") {
        outputs.push(
          formatCliOutput({
            kind: "artifact",
            input: fp,
            resolved: path.resolve(fp),
            dir: null,
            strict: false,
            failOnWarnings,
            result: { ok: false, error: bal.error, detail: bal, warnings: [] },
            toolVersion,
            toolCommit
          })
        );
      } else {
        await writeStderr(`${fp}: FAILED (${bal.error})\n`);
      }
      continue;
    }

    if (format === "json") {
      outputs.push(
        formatCliOutput({
          kind: "artifact",
          input: fp,
          resolved: path.resolve(fp),
          dir: null,
          strict: false,
          failOnWarnings,
          result: { ok: true, warnings: [] },
          toolVersion,
          toolCommit
        })
      );
    } else {
      await writeStdout(`${fp}: VERIFIED\n`);
    }
  }
  if (format === "sarif") {
    const sarif = formatSarifFromCliOutput({
      schemaVersion: "VerifyCliOutput.v1",
      tool: { name: "settld-verify", version: toolVersion ?? null, commit: toolCommit ?? null },
      mode: { strict: false, failOnWarnings },
      target: { kind: "artifact", input: args.join(" "), resolved: null, dir: null },
      ok: okAll,
      verificationOk: okAll,
      errors: outputs.flatMap((o) => Array.isArray(o?.errors) ? o.errors : []),
      warnings: outputs.flatMap((o) => Array.isArray(o?.warnings) ? o.warnings : []),
      summary: { tenantId: null, period: null, type: null, manifestHash: null }
    });
    await writeStdout(JSON.stringify(sarif, null, 2) + "\n");
    return okAll ? 0 : 1;
  }

  if (format === "json") {
    // If multiple inputs were provided, emit an array (still stable and machine-readable).
    await writeStdout(JSON.stringify(outputs.length === 1 ? outputs[0] : outputs, null, 2) + "\n");
  }
  return okAll ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch(async (err) => {
    await writeStderr(String(err?.stack ?? err?.message ?? err ?? "unknown error") + "\n");
    process.exitCode = 1;
  });
