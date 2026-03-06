#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex } from "../../src/core/crypto.js";
import { evaluateSignerLifecycleForContinuity } from "../../src/services/identity/signer-lifecycle.js";

function parseArgs(argv) {
  const out = {
    caseId: null,
    list: false,
    jsonOut: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    const nextValue = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return String(argv[i] ?? "");
    };
    if (arg === "--case") {
      out.caseId = nextValue();
      continue;
    }
    if (arg === "--json-out") {
      out.jsonOut = nextValue();
      continue;
    }
    if (arg === "--list") {
      out.list = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") return { ...out, help: true };
    throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage:");
  console.error("  node conformance/signer-lifecycle-v1/run.mjs [--case <id>] [--json-out <path>] [--list]");
}

function assertCaseResult({ id, verdict, expected }) {
  const errors = [];
  const expectEq = (field, actual, wanted) => {
    if (actual !== wanted) errors.push(`${field} expected=${String(wanted)} actual=${String(actual)}`);
  };

  expectEq("ok", verdict?.ok === true, expected?.ok === true);
  expectEq("legacyCode", verdict?.legacyCode ?? null, expected?.legacyCode ?? null);
  expectEq("canonicalCode", verdict?.canonicalCode ?? null, expected?.canonicalCode ?? null);
  expectEq("validAtOk", verdict?.validAt?.ok ?? null, expected?.validAtOk ?? null);
  expectEq("validAtCanonicalCode", verdict?.validAt?.canonicalCode ?? null, expected?.validAtCanonicalCode ?? null);
  expectEq("validNowOk", verdict?.validNow?.ok ?? null, expected?.validNowOk ?? null);
  expectEq("validNowCanonicalCode", verdict?.validNow?.canonicalCode ?? null, expected?.validNowCanonicalCode ?? null);

  if (errors.length > 0) {
    throw new Error(`case ${id} mismatch:\n- ${errors.join("\n- ")}`);
  }
}

async function writeOutputJson(fp, json) {
  const outPath = path.resolve(process.cwd(), String(fp));
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  return outPath;
}

function normalizeCaseInput(input) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err?.message ?? "invalid arguments"}\n`);
    usage();
    return 1;
  }
  if (parsed.help) {
    usage();
    return 0;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const vectorsPath = path.join(here, "vectors.json");
  const vectors = JSON.parse(await fs.readFile(vectorsPath, "utf8"));
  const allCases = Array.isArray(vectors?.cases) ? vectors.cases : [];
  if (allCases.length === 0) throw new Error("vectors.json must contain at least one case");

  if (parsed.list) {
    const ids = allCases.map((row) => String(row?.id ?? "")).filter(Boolean).sort((a, b) => a.localeCompare(b));
    process.stdout.write(`${ids.join("\n")}\n`);
    return 0;
  }

  const selected =
    parsed.caseId === null
      ? allCases
      : allCases.filter((row) => String(row?.id ?? "") === String(parsed.caseId));
  if (selected.length === 0) throw new Error(`unknown case id: ${parsed.caseId}`);

  const results = [];
  for (const row of selected) {
    const id = String(row?.id ?? "").trim();
    if (!id) throw new Error("case id must be non-empty");
    const input = normalizeCaseInput(row?.input);
    const expected = row?.expected && typeof row.expected === "object" && !Array.isArray(row.expected) ? row.expected : {};

    const verdict = evaluateSignerLifecycleForContinuity(input);
    const repeat = evaluateSignerLifecycleForContinuity(input);
    const canonicalVerdict = canonicalJsonStringify(normalizeForCanonicalJson(verdict, { path: "$.verdict" }));
    const canonicalRepeat = canonicalJsonStringify(normalizeForCanonicalJson(repeat, { path: "$.verdictRepeat" }));
    if (canonicalVerdict !== canonicalRepeat) {
      throw new Error(`case ${id} is non-deterministic across repeated evaluation`);
    }

    assertCaseResult({ id, verdict, expected });
    results.push(
      normalizeForCanonicalJson(
        {
          id,
          ok: true,
          verdictHash: sha256Hex(canonicalVerdict)
        },
        { path: "$.results[]" }
      )
    );
  }

  const report = normalizeForCanonicalJson(
    {
      schemaVersion: "SignerLifecycleConformanceReport.v1",
      pack: "conformance/signer-lifecycle-v1",
      vectorSchemaVersion: String(vectors?.schemaVersion ?? ""),
      generatedAt: new Date().toISOString(),
      caseCount: results.length,
      passCount: results.length,
      failCount: 0,
      results
    },
    { path: "$" }
  );

  if (parsed.jsonOut) {
    const written = await writeOutputJson(parsed.jsonOut, report);
    process.stdout.write(`${written}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  return 0;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (err) => {
    process.stderr.write(`${err?.message ?? "conformance run failed"}\n`);
    process.exit(1);
  }
);
