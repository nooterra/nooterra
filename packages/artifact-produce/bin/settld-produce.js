#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { parseCommonArgs, resolveNowIso } from "../src/cli/args.js";
import { buildProduceCliOutputV1 } from "../src/cli/output.js";
import { writeStdout, writeStderr } from "../src/cli/io.js";
import { PRODUCE_ERROR_CODE } from "../src/cli/produce-error-codes.js";
import { issueFromError } from "../src/cli/normalize-produce-error.js";
import { readPackageVersionBestEffort, readToolCommitBestEffort } from "../src/tool-provenance.js";
import {
  produceClosePackBundle,
  produceClosePackFromJson,
  produceFinancePackBundle,
  produceInvoiceBundle,
  produceJobProofBundle,
  produceMonthProofBundle,
  verifyAfterProduce
} from "../src/produce.js";

function headerNamesOnly(headers) {
  const out = [];
  for (const h of Array.isArray(headers) ? headers : []) {
    if (typeof h !== "string") continue;
    const idx = h.indexOf(":");
    const name = (idx === -1 ? h : h.slice(0, idx)).trim();
    if (name) out.push(name);
  }
  return [...new Set(out)].sort();
}

function writeExplain({ out, args, err }) {
  const lines = [];
  lines.push("settld-produce explain");
  lines.push(`ok=${String(Boolean(out?.ok))}`);

  const kind = out?.target?.kind ?? null;
  const outDir = out?.target?.out ?? null;
  if (kind) lines.push(`kind=${String(kind)}`);
  if (outDir) lines.push(`out=${String(outDir)}`);

  if (args?.signerMode) lines.push(`signerMode=${String(args.signerMode)}`);
  if (args?.signerMode === "remote") {
    if (args?.signerUrl) lines.push("signerTransport=http");
    else if (args?.signerCommand) lines.push("signerTransport=process");
  }
  if (args?.signerMode === "plugin") {
    if (args?.signerPlugin) lines.push("signerTransport=plugin");
  }

  if (args?.signerAuth === "bearer") {
    const src = args?.signerTokenEnv ? `env:${String(args.signerTokenEnv)}` : args?.signerTokenFile ? "file:<redacted>" : "missing";
    lines.push(`signerAuth=bearer tokenSource=${src}`);
  }

  const headerNames = headerNamesOnly(args?.signerHeaders);
  if (headerNames.length) lines.push(`signerHeaders=${headerNames.join(",")}`);

  const mh = out?.result?.manifestHash ?? null;
  const ah = out?.result?.attestationHash ?? null;
  if (mh) lines.push(`manifestHash=${String(mh)}`);
  if (ah) lines.push(`attestationHash=${String(ah)}`);

  const errs = Array.isArray(out?.errors) ? out.errors : [];
  for (const e of errs) {
    if (!e || typeof e !== "object") continue;
    const code = e.code ?? null;
    const ck = e.causeKind ?? null;
    const cc = e.causeCode ?? null;
    lines.push(`error=${String(code ?? "")} causeKind=${String(ck ?? "")} causeCode=${String(cc ?? "")}`);
  }

  // Deterministic hints (no secrets).
  const codes = new Set(errs.map((e) => (e && typeof e === "object" ? e.code : null)).filter(Boolean));
  if (codes.has(PRODUCE_ERROR_CODE.SIGNER_AUTH_MISSING)) {
    lines.push("hint: set --signer-token-env or --signer-token-file (see docs/spec/REMOTE_SIGNER.md)");
  }
  if (codes.has(PRODUCE_ERROR_CODE.SIGNER_BAD_RESPONSE)) {
    lines.push("hint: check signer response shape (see docs/spec/REMOTE_SIGNER.md and RemoteSigner*.v1.md)");
  }
  if (codes.has(PRODUCE_ERROR_CODE.SIGNER_PLUGIN_LOAD_FAILED) || codes.has(PRODUCE_ERROR_CODE.SIGNER_PLUGIN_MISSING_EXPORT)) {
    lines.push("hint: check plugin path/export (see docs/spec/SIGNER_PROVIDER_PLUGIN.md)");
  }
  if (codes.has(PRODUCE_ERROR_CODE.VERIFY_AFTER_FAILED)) {
    lines.push("hint: verify-after failed; run settld-verify directly for details");
  }

  if (err && typeof err === "object" && typeof err.code === "string" && err.code.trim()) {
    lines.push(`internalErrorCode=${String(err.code)}`);
  }

  // Explain is a deterministic, pipe-safe human diagnostic surface:
  // - exactly one trailing newline
  // - no blank trailing lines
  while (lines.length && String(lines[lines.length - 1] ?? "") === "") lines.pop();
  writeStderr(lines.join("\n") + "\n");
}

function usage() {
  writeStderr(
    [
      "usage:",
      "  settld-produce jobproof --out <bundleDir> (--keys <keypairs.json> | --signer remote --gov-key-id <id> --server-key-id <id> [--signer-url <url> | --signer-command <cmd> --signer-args-json <json>] [--signer-auth bearer --signer-token-env <ENV>|--signer-token-file <path>] [--signer-header \"X-Foo: bar\"] | --signer plugin --signer-plugin <path|pkg> [--signer-plugin-export <name>] [--signer-plugin-config <json>]) [--tenant <id>] [--job-id <id>] [--format json|text] [--deterministic] [--now <iso>] [--force]",
      "  settld-produce monthproof --out <bundleDir> (--keys <keypairs.json> | --signer remote --gov-key-id <id> --server-key-id <id> [--signer-url <url> | --signer-command <cmd> --signer-args-json <json>] [--signer-auth bearer --signer-token-env <ENV>|--signer-token-file <path>] [--signer-header \"X-Foo: bar\"] | --signer plugin --signer-plugin <path|pkg> [--signer-plugin-export <name>] [--signer-plugin-config <json>]) [--tenant <id>] [--period YYYY-MM] [--basis <settledAt|...>] [--format json|text] [--deterministic] [--now <iso>] [--force]",
      "  settld-produce financepack --out <bundleDir> (--keys <keypairs.json> | --signer remote --gov-key-id <id> --server-key-id <id> [--signer-url <url> | --signer-command <cmd> --signer-args-json <json>] [--signer-auth bearer --signer-token-env <ENV>|--signer-token-file <path>] [--signer-header \"X-Foo: bar\"] | --signer plugin --signer-plugin <path|pkg> [--signer-plugin-export <name>] [--signer-plugin-config <json>]) --monthproof <monthProofBundleDir> [--tenant <id>] [--period YYYY-MM] [--protocol <string>] [--format json|text] [--deterministic] [--now <iso>] [--force]",
      "  settld-produce invoicebundle --out <bundleDir> (--keys <keypairs.json> | --signer remote --gov-key-id <id> --server-key-id <id> [--signer-url <url> | --signer-command <cmd> --signer-args-json <json>] [--signer-auth bearer --signer-token-env <ENV>|--signer-token-file <path>] [--signer-header \"X-Foo: bar\"] | --signer plugin --signer-plugin <path|pkg> [--signer-plugin-export <name>] [--signer-plugin-config <json>]) --jobproof <jobProofBundleDir> [--tenant <id>] [--invoice-id <id>] [--protocol <string>] [--format json|text] [--deterministic] [--now <iso>] [--force]",
      "  settld-produce closepack --out <bundleDir> (--keys <keypairs.json> | --signer remote --gov-key-id <id> --server-key-id <id> [--signer-url <url> | --signer-command <cmd> --signer-args-json <json>] [--signer-auth bearer --signer-token-env <ENV>|--signer-token-file <path>] [--signer-header \"X-Foo: bar\"] | --signer plugin --signer-plugin <path|pkg> [--signer-plugin-export <name>] [--signer-plugin-config <json>]) --invoicebundle <invoiceBundleDir> [--tenant <id>] [--invoice-id <id>] [--protocol <string>] [--format json|text] [--deterministic] [--now <iso>] [--force]",
      "  settld-produce closepack-from-json --out <bundleDir> (--keys <keypairs.json> | --signer remote --gov-key-id <id> --server-key-id <id> [--signer-url <url> | --signer-command <cmd> --signer-args-json <json>] [--signer-auth bearer --signer-token-env <ENV>|--signer-token-file <path>] [--signer-header \"X-Foo: bar\"] | --signer plugin --signer-plugin <path|pkg> [--signer-plugin-export <name>] [--signer-plugin-config <json>]) --jobproof <jobProofBundleDir> --pricing-matrix <pricing_matrix.json> --pricing-signatures <pricing_matrix_signatures.json> --metering-report <metering_report.json> [--invoice-claim <invoice_claim.json>] [--sla-definition <sla_definition.json>] [--acceptance-criteria <acceptance_criteria.json>] [--tenant <id>] [--invoice-id <id>] [--protocol <string>] [--format json|text] [--deterministic] [--now <iso>] [--force]",
      "",
      "optional verification:",
      "  --verify-after --trust-file <trust.json> [--hash-concurrency N] [--strict|--nonstrict]",
      "",
      "operator diagnostics:",
      "  --explain   # prints deterministic, non-secret diagnostics to stderr"
    ].join("\n") + "\n"
  );
  process.exit(2);
}

function parse(argv) {
  const cmd = argv[0] ?? null;
  if (cmd === "--version") return { cmd: "--version" };
  const args = argv.slice(1);
  if (!cmd || cmd === "--help" || cmd === "-h") usage();

  const common = parseCommonArgs(args);

  const out = { cmd, ...common };
  const remaining = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (
      [
        "--format",
        "--explain",
        "--out",
        "--keys",
        "--signer",
        "--signer-url",
        "--signer-command",
        "--signer-args-json",
        "--signer-auth",
        "--signer-token-env",
        "--signer-token-file",
        "--signer-header",
        "--signer-plugin",
        "--signer-plugin-export",
        "--signer-plugin-config",
        "--gov-key-id",
        "--server-key-id",
        "--trust-file",
        "--deterministic",
        "--now",
        "--verify-after",
        "--hash-concurrency",
        "--strict",
        "--nonstrict",
        "--force"
      ].includes(a)
    ) {
      if (
        [
          "--format",
          "--out",
          "--keys",
          "--signer",
          "--signer-url",
          "--signer-command",
          "--signer-args-json",
          "--signer-auth",
          "--signer-token-env",
          "--signer-token-file",
          "--signer-header",
          "--signer-plugin",
          "--signer-plugin-export",
          "--signer-plugin-config",
          "--gov-key-id",
          "--server-key-id",
          "--trust-file",
          "--now",
          "--hash-concurrency"
        ].includes(a)
      ) {
        i += 1;
      }
      continue;
    }
    remaining.push(a);
  }

  if (cmd === "jobproof") {
    out.tenantId = "tenant_default";
    out.jobId = "job_default";
    for (let i = 0; i < remaining.length; i += 1) {
      const a = remaining[i];
      if (a === "--tenant") {
        out.tenantId = remaining[i + 1] ?? null;
        if (!out.tenantId) usage();
        i += 1;
        continue;
      }
      if (a === "--job-id") {
        out.jobId = remaining[i + 1] ?? null;
        if (!out.jobId) usage();
        i += 1;
        continue;
      }
      usage();
    }
    return out;
  }

  if (cmd === "closepack") {
    out.tenantId = "tenant_default";
    out.invoiceId = "invoice_default";
    out.protocol = "1.0";
    out.invoiceBundleDir = null;
    for (let i = 0; i < remaining.length; i += 1) {
      const a = remaining[i];
      if (a === "--tenant") {
        out.tenantId = remaining[i + 1] ?? null;
        if (!out.tenantId) usage();
        i += 1;
        continue;
      }
      if (a === "--invoice-id") {
        out.invoiceId = remaining[i + 1] ?? null;
        if (!out.invoiceId) usage();
        i += 1;
        continue;
      }
      if (a === "--protocol") {
        out.protocol = remaining[i + 1] ?? null;
        if (!out.protocol) usage();
        i += 1;
        continue;
      }
      if (a === "--invoicebundle") {
        out.invoiceBundleDir = remaining[i + 1] ?? null;
        if (!out.invoiceBundleDir) usage();
        i += 1;
        continue;
      }
      usage();
    }
    if (!out.invoiceBundleDir) usage();
    return out;
  }

  if (cmd === "closepack-from-json") {
    out.tenantId = "tenant_default";
    out.invoiceId = "invoice_default";
    out.protocol = "1.0";
    out.jobProofDir = null;
    out.pricingMatrixPath = null;
    out.pricingSignaturesPath = null;
    out.meteringReportPath = null;
    out.invoiceClaimPath = null;
    out.slaDefinitionPath = null;
    out.acceptanceCriteriaPath = null;
    for (let i = 0; i < remaining.length; i += 1) {
      const a = remaining[i];
      if (a === "--tenant") {
        out.tenantId = remaining[i + 1] ?? null;
        if (!out.tenantId) usage();
        i += 1;
        continue;
      }
      if (a === "--invoice-id") {
        out.invoiceId = remaining[i + 1] ?? null;
        if (!out.invoiceId) usage();
        i += 1;
        continue;
      }
      if (a === "--protocol") {
        out.protocol = remaining[i + 1] ?? null;
        if (!out.protocol) usage();
        i += 1;
        continue;
      }
      if (a === "--jobproof") {
        out.jobProofDir = remaining[i + 1] ?? null;
        if (!out.jobProofDir) usage();
        i += 1;
        continue;
      }
      if (a === "--pricing-matrix") {
        out.pricingMatrixPath = remaining[i + 1] ?? null;
        if (!out.pricingMatrixPath) usage();
        i += 1;
        continue;
      }
      if (a === "--pricing-signatures") {
        out.pricingSignaturesPath = remaining[i + 1] ?? null;
        if (!out.pricingSignaturesPath) usage();
        i += 1;
        continue;
      }
      if (a === "--metering-report") {
        out.meteringReportPath = remaining[i + 1] ?? null;
        if (!out.meteringReportPath) usage();
        i += 1;
        continue;
      }
      if (a === "--invoice-claim") {
        out.invoiceClaimPath = remaining[i + 1] ?? null;
        if (!out.invoiceClaimPath) usage();
        i += 1;
        continue;
      }
      if (a === "--sla-definition") {
        out.slaDefinitionPath = remaining[i + 1] ?? null;
        if (!out.slaDefinitionPath) usage();
        i += 1;
        continue;
      }
      if (a === "--acceptance-criteria") {
        out.acceptanceCriteriaPath = remaining[i + 1] ?? null;
        if (!out.acceptanceCriteriaPath) usage();
        i += 1;
        continue;
      }
      usage();
    }
    if (!out.jobProofDir || !out.pricingMatrixPath || !out.pricingSignaturesPath || !out.meteringReportPath) usage();
    return out;
  }

  if (cmd === "monthproof") {
    out.tenantId = "tenant_default";
    out.period = "1970-01";
    out.basis = "settledAt";
    for (let i = 0; i < remaining.length; i += 1) {
      const a = remaining[i];
      if (a === "--tenant") {
        out.tenantId = remaining[i + 1] ?? null;
        if (!out.tenantId) usage();
        i += 1;
        continue;
      }
      if (a === "--period") {
        out.period = remaining[i + 1] ?? null;
        if (!out.period) usage();
        i += 1;
        continue;
      }
      if (a === "--basis") {
        out.basis = remaining[i + 1] ?? null;
        if (!out.basis) usage();
        i += 1;
        continue;
      }
      usage();
    }
    return out;
  }

  if (cmd === "financepack") {
    out.tenantId = "tenant_default";
    out.period = "1970-01";
    out.protocol = "1.0";
    out.monthProofDir = null;
    for (let i = 0; i < remaining.length; i += 1) {
      const a = remaining[i];
      if (a === "--tenant") {
        out.tenantId = remaining[i + 1] ?? null;
        if (!out.tenantId) usage();
        i += 1;
        continue;
      }
      if (a === "--period") {
        out.period = remaining[i + 1] ?? null;
        if (!out.period) usage();
        i += 1;
        continue;
      }
      if (a === "--protocol") {
        out.protocol = remaining[i + 1] ?? null;
        if (!out.protocol) usage();
        i += 1;
        continue;
      }
      if (a === "--monthproof") {
        out.monthProofDir = remaining[i + 1] ?? null;
        if (!out.monthProofDir) usage();
        i += 1;
        continue;
      }
      usage();
    }
    if (!out.monthProofDir) usage();
    return out;
  }

  if (cmd === "invoicebundle") {
    out.tenantId = "tenant_default";
    out.invoiceId = "invoice_default";
    out.protocol = "1.0";
    out.jobProofDir = null;
    for (let i = 0; i < remaining.length; i += 1) {
      const a = remaining[i];
      if (a === "--tenant") {
        out.tenantId = remaining[i + 1] ?? null;
        if (!out.tenantId) usage();
        i += 1;
        continue;
      }
      if (a === "--invoice-id") {
        out.invoiceId = remaining[i + 1] ?? null;
        if (!out.invoiceId) usage();
        i += 1;
        continue;
      }
      if (a === "--protocol") {
        out.protocol = remaining[i + 1] ?? null;
        if (!out.protocol) usage();
        i += 1;
        continue;
      }
      if (a === "--jobproof") {
        out.jobProofDir = remaining[i + 1] ?? null;
        if (!out.jobProofDir) usage();
        i += 1;
        continue;
      }
      usage();
    }
    if (!out.jobProofDir) usage();
    return out;
  }

  usage();
}

async function readTrustJson(fp) {
  const raw = await fs.readFile(path.resolve(process.cwd(), fp), "utf8");
  return JSON.parse(raw);
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.cmd === "--version") {
    const v = await readPackageVersionBestEffort();
    writeStdout(`${String(v ?? "0.0.0")}\n`);
    process.exit(0);
  }
  if (!args.outDir) usage();
  if (args.signerMode === "local" && !args.keysPath) usage();
  if ((args.signerMode === "remote" || args.signerMode === "plugin") && (!args.govKeyId || !args.serverKeyId)) usage();
  if (args.signerMode === "remote" && !args.signerCommand && !args.signerUrl) usage();
  if (args.signerMode === "plugin" && !args.signerPlugin) usage();
  const packageVersion = await readPackageVersionBestEffort();
  const toolCommit = readToolCommitBestEffort();
  const now = resolveNowIso({ deterministic: args.deterministic, nowFlag: args.now, env: process.env });

  const warnings = [];
  const errors = [];

  try {
    let produced;
    if (args.cmd === "jobproof") {
      produced = await produceJobProofBundle({
        outDir: args.outDir,
        force: args.force,
        keys: args.keysPath,
        signerMode: args.signerMode,
        signerUrl: args.signerUrl,
        signerCommand: args.signerCommand,
        signerArgsJson: args.signerArgsJson,
        signerAuth: args.signerAuth,
        signerTokenEnv: args.signerTokenEnv,
        signerTokenFile: args.signerTokenFile,
        signerHeaders: args.signerHeaders,
        signerPlugin: args.signerPlugin,
        signerPluginExport: args.signerPluginExport,
        signerPluginConfig: args.signerPluginConfig,
        govKeyId: args.govKeyId,
        serverKeyId: args.serverKeyId,
        tenantId: args.tenantId,
        jobId: args.jobId,
        now,
        packageVersion,
        toolCommit
      });
    } else if (args.cmd === "monthproof") {
      produced = await produceMonthProofBundle({
        outDir: args.outDir,
        force: args.force,
        keys: args.keysPath,
        signerMode: args.signerMode,
        signerUrl: args.signerUrl,
        signerCommand: args.signerCommand,
        signerArgsJson: args.signerArgsJson,
        signerAuth: args.signerAuth,
        signerTokenEnv: args.signerTokenEnv,
        signerTokenFile: args.signerTokenFile,
        signerHeaders: args.signerHeaders,
        signerPlugin: args.signerPlugin,
        signerPluginExport: args.signerPluginExport,
        signerPluginConfig: args.signerPluginConfig,
        govKeyId: args.govKeyId,
        serverKeyId: args.serverKeyId,
        tenantId: args.tenantId,
        period: args.period,
        basis: args.basis,
        now,
        packageVersion,
        toolCommit
      });
    } else if (args.cmd === "financepack") {
      produced = await produceFinancePackBundle({
        outDir: args.outDir,
        force: args.force,
        keys: args.keysPath,
        signerMode: args.signerMode,
        signerUrl: args.signerUrl,
        signerCommand: args.signerCommand,
        signerArgsJson: args.signerArgsJson,
        signerAuth: args.signerAuth,
        signerTokenEnv: args.signerTokenEnv,
        signerTokenFile: args.signerTokenFile,
        signerHeaders: args.signerHeaders,
        signerPlugin: args.signerPlugin,
        signerPluginExport: args.signerPluginExport,
        signerPluginConfig: args.signerPluginConfig,
        govKeyId: args.govKeyId,
        serverKeyId: args.serverKeyId,
        tenantId: args.tenantId,
        period: args.period,
        protocol: args.protocol,
        now,
        monthProofDir: args.monthProofDir,
        packageVersion,
        toolCommit
      });
    } else if (args.cmd === "invoicebundle") {
      produced = await produceInvoiceBundle({
        outDir: args.outDir,
        force: args.force,
        keys: args.keysPath,
        signerMode: args.signerMode,
        signerUrl: args.signerUrl,
        signerCommand: args.signerCommand,
        signerArgsJson: args.signerArgsJson,
        signerAuth: args.signerAuth,
        signerTokenEnv: args.signerTokenEnv,
        signerTokenFile: args.signerTokenFile,
        signerHeaders: args.signerHeaders,
        signerPlugin: args.signerPlugin,
        signerPluginExport: args.signerPluginExport,
        signerPluginConfig: args.signerPluginConfig,
        govKeyId: args.govKeyId,
        serverKeyId: args.serverKeyId,
        tenantId: args.tenantId,
        invoiceId: args.invoiceId,
        protocol: args.protocol,
        now,
        jobProofDir: args.jobProofDir,
        packageVersion,
        toolCommit
      });
    } else if (args.cmd === "closepack") {
      produced = await produceClosePackBundle({
        outDir: args.outDir,
        force: args.force,
        keys: args.keysPath,
        signerMode: args.signerMode,
        signerUrl: args.signerUrl,
        signerCommand: args.signerCommand,
        signerArgsJson: args.signerArgsJson,
        signerAuth: args.signerAuth,
        signerTokenEnv: args.signerTokenEnv,
        signerTokenFile: args.signerTokenFile,
        signerHeaders: args.signerHeaders,
        signerPlugin: args.signerPlugin,
        signerPluginExport: args.signerPluginExport,
        signerPluginConfig: args.signerPluginConfig,
        govKeyId: args.govKeyId,
        serverKeyId: args.serverKeyId,
        tenantId: args.tenantId,
        invoiceId: args.invoiceId,
        protocol: args.protocol,
        now,
        invoiceBundleDir: args.invoiceBundleDir,
        packageVersion,
        toolCommit
      });
    } else if (args.cmd === "closepack-from-json") {
      produced = await produceClosePackFromJson({
        outDir: args.outDir,
        force: args.force,
        keys: args.keysPath,
        signerMode: args.signerMode,
        signerUrl: args.signerUrl,
        signerCommand: args.signerCommand,
        signerArgsJson: args.signerArgsJson,
        signerAuth: args.signerAuth,
        signerTokenEnv: args.signerTokenEnv,
        signerTokenFile: args.signerTokenFile,
        signerHeaders: args.signerHeaders,
        signerPlugin: args.signerPlugin,
        signerPluginExport: args.signerPluginExport,
        signerPluginConfig: args.signerPluginConfig,
        govKeyId: args.govKeyId,
        serverKeyId: args.serverKeyId,
        tenantId: args.tenantId,
        invoiceId: args.invoiceId,
        protocol: args.protocol,
        now,
        jobProofDir: args.jobProofDir,
        pricingMatrixPath: args.pricingMatrixPath,
        pricingSignaturesPath: args.pricingSignaturesPath,
        meteringReportPath: args.meteringReportPath,
        invoiceClaimPath: args.invoiceClaimPath,
        slaDefinitionPath: args.slaDefinitionPath,
        acceptanceCriteriaPath: args.acceptanceCriteriaPath,
        packageVersion,
        toolCommit
      });
    } else {
      usage();
    }

    let verifyAfter = undefined;
    if (args.verifyAfter) {
      if (!args.trustFile) throw new Error("--verify-after requires --trust-file");
      const trustJson = await readTrustJson(args.trustFile);
      const res = await verifyAfterProduce({
        bundleKind: produced.kind,
        bundleDir: produced.bundleDir,
        trustJson,
        strict: args.strictVerify,
        hashConcurrency: args.hashConcurrency
      });
      let parsed = null;
      try {
        parsed = JSON.parse(res.stdout || "null");
      } catch {
        parsed = null;
      }
      verifyAfter = {
        ok: res.code === 0,
        exitCode: res.code,
        output: parsed
      };
      if (res.code !== 0) {
        errors.push({
          code: PRODUCE_ERROR_CODE.VERIFY_AFTER_FAILED,
          causeKind: "verify",
          causeCode: "VERIFY_AFTER_FAILED",
          path: null,
          message: "verify-after failed",
          detail: null
        });
      }
    }

    const out = buildProduceCliOutputV1({
      tool: { name: "settld", version: packageVersion, commit: toolCommit },
      mode: { deterministic: Boolean(args.deterministic), now },
      target: { kind: produced.kind, out: produced.bundleDir },
      ok: errors.length === 0,
      produceOk: true,
      verifyAfter,
      result: {
        bundleDir: produced.bundleDir,
        type: produced.bundle?.schemaVersion ?? null,
        tenantId: produced.tenantId ?? null,
        jobId: produced.jobId ?? null,
        period: produced.period ?? null,
        basis: produced.basis ?? null,
        protocol: produced.protocol ?? null,
        manifestHash: produced.manifestHash ?? null,
        attestationHash: produced.attestationHash ?? null
      },
      warnings,
      errors
    });

    if (args.format === "json") {
      if (args.explain) writeExplain({ out, args, err: null });
      writeStdout(`${JSON.stringify(out, null, 2)}\n`);
    } else {
      if (args.explain) writeExplain({ out, args, err: null });
      writeStdout(
        [
          `ok=${out.ok}`,
          `kind=${String(out.target?.kind ?? "")}`,
          `out=${String(out.target?.out ?? "")}`,
          `manifestHash=${String(out.result?.manifestHash ?? "")}`
        ].join("\n") + "\n"
      );
    }
    process.exit(out.ok ? 0 : 1);
  } catch (err) {
    const out = buildProduceCliOutputV1({
      tool: { name: "settld", version: packageVersion, commit: toolCommit },
      mode: { deterministic: Boolean(args?.deterministic), now },
      target: { kind: args?.cmd ?? null, out: args?.outDir ?? null },
      ok: false,
      produceOk: false,
      result: null,
      warnings,
      errors: [issueFromError(err)]
    });
    if (args?.format === "json") {
      if (args?.explain) writeExplain({ out, args, err });
      writeStdout(`${JSON.stringify(out, null, 2)}\n`);
    } else {
      if (args?.explain) writeExplain({ out, args, err });
      else writeStderr(`error: ${err?.message ?? String(err)}\n`);
    }
    process.exit(1);
  }
}

await main();
