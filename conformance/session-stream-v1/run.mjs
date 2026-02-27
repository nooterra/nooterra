#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex } from "../../src/core/crypto.js";
import { readJsonFile, spawnCapture } from "./lib/harness.mjs";

function parseArgs(argv) {
  const out = {
    adapterBin: "nooterra-session-stream-runtime-adapter",
    adapterNodeBin: null,
    caseId: null,
    list: false,
    jsonOut: null,
    certBundleOut: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--adapter-bin") {
      out.adapterBin = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--adapter-node-bin") {
      out.adapterNodeBin = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--case") {
      out.caseId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--json-out") {
      out.jsonOut = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--cert-bundle-out") {
      out.certBundleOut = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--list") {
      out.list = true;
      continue;
    }
    if (a === "--help" || a === "-h") return { ...out, help: true };
    throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage:");
  console.error(
    "  node conformance/session-stream-v1/run.mjs [--adapter-bin <cmd>] [--adapter-node-bin <path/to/adapter.js>] [--case <id>] [--json-out <path>] [--cert-bundle-out <path>] [--list]"
  );
}

async function writeOutputJson(fp, json) {
  const outPath = path.resolve(process.cwd(), String(fp));
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(json, null, 2) + "\n", "utf8");
  return outPath;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function buildAdapterRequest({ caseId, fixture }) {
  return {
    schemaVersion: "SessionStreamConformanceRequest.v1",
    caseId,
    fixture
  };
}

async function runAdapter({ cli, request, cwd }) {
  const run = await spawnCapture({
    cmd: cli.cmd,
    args: cli.args,
    cwd,
    env: { ...process.env },
    stdinText: `${JSON.stringify(request)}\n`
  });

  let parsed = null;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    parsed = null;
  }

  return {
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    parsed
  };
}

function compareSubset({ expected, actual, path = "$", mismatches }) {
  if (expected === null || expected === undefined) {
    if (actual !== expected) mismatches.push(`${path} expected ${String(expected)} got ${String(actual)}`);
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      mismatches.push(`${path} expected array got ${typeof actual}`);
      return;
    }
    if (actual.length !== expected.length) {
      mismatches.push(`${path}.length expected ${expected.length} got ${actual.length}`);
      return;
    }
    for (let i = 0; i < expected.length; i += 1) {
      compareSubset({ expected: expected[i], actual: actual[i], path: `${path}[${i}]`, mismatches });
    }
    return;
  }

  if (typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
      mismatches.push(`${path} expected object got ${typeof actual}`);
      return;
    }
    for (const [key, value] of Object.entries(expected)) {
      compareSubset({ expected: value, actual: actual[key], path: `${path}.${key}`, mismatches });
    }
    return;
  }

  if (actual !== expected) {
    mismatches.push(`${path} expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}

function extractActualPassShape(parsed) {
  const result = parsed?.result ?? null;
  const readyFrame = result?.readyFrame ?? null;
  const emittedFrames = Array.isArray(result?.emittedFrames) ? result.emittedFrames : [];
  const eventFrames = emittedFrames.filter((row) => String(row?.event ?? "") === "session.event");
  const watermarkFrames = emittedFrames.filter((row) => String(row?.event ?? "") === "session.watermark");

  return {
    headers: result?.headers ?? null,
    ready: {
      eventType: readyFrame?.data?.eventType ?? null,
      sinceEventId: readyFrame?.data?.sinceEventId ?? null,
      eventCount: readyFrame?.data?.eventCount ?? null,
      headEventCount: readyFrame?.data?.inbox?.headEventCount ?? null,
      headLastEventId: readyFrame?.data?.inbox?.headLastEventId ?? null
    },
    emitted: {
      frameEvents: emittedFrames.map((row) => row?.event ?? null),
      eventIds: eventFrames.map((row) => row?.id ?? null),
      watermarkIds: watermarkFrames.map((row) => row?.id ?? null),
      watermarkNextSinceEventIds: watermarkFrames.map((row) => row?.data?.inbox?.nextSinceEventId ?? null)
    },
    cursor: result?.cursor ?? null
  };
}

function extractActualFailShape(parsed) {
  return {
    outcome: "fail",
    code: parsed?.code ?? null,
    message: parsed?.message ?? null,
    details: parsed?.details ?? null
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    process.exit(0);
  }

  const packDir = path.dirname(fileURLToPath(import.meta.url));
  const vectors = await readJsonFile(path.join(packDir, "vectors.json"));
  if (vectors?.schemaVersion !== "SessionStreamConformanceCases.v1") {
    throw new Error(`unsupported vectors schemaVersion: ${vectors?.schemaVersion ?? "null"}`);
  }

  const allCases = Array.isArray(vectors?.cases) ? vectors.cases : [];
  if (opts.list) {
    for (const row of allCases) {
      // eslint-disable-next-line no-console
      console.log(String(row?.id ?? ""));
    }
    process.exit(0);
  }

  const selectedCases = opts.caseId ? allCases.filter((row) => String(row?.id ?? "") === opts.caseId) : allCases;
  if (opts.caseId && selectedCases.length === 0) throw new Error(`case not found: ${opts.caseId}`);

  const cli = opts.adapterNodeBin
    ? { cmd: process.execPath, args: [path.resolve(opts.adapterNodeBin)], mode: "node" }
    : { cmd: opts.adapterBin, args: [], mode: "bin" };

  let pass = 0;
  let fail = 0;
  const results = [];

  for (const row of selectedCases) {
    const caseId = String(row?.id ?? "");
    const fixtureId = String(row?.fixtureId ?? "");
    const fixture = vectors?.fixtures?.[fixtureId] ?? null;
    const expected = row?.expected && typeof row.expected === "object" && !Array.isArray(row.expected) ? row.expected : null;
    const invariantIds = Array.isArray(row?.invariantIds)
      ? [...new Set(row.invariantIds.map((v) => String(v ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
      : [];

    if (!fixture || !expected) {
      fail += 1;
      results.push(
        normalizeForCanonicalJson(
          {
            id: caseId,
            invariantIds,
            status: "fail",
            reasonCode: "CONFORMANCE_CASE_INVALID",
            mismatches: ["fixture or expected definition missing"]
          },
          { path: "$" }
        )
      );
      // eslint-disable-next-line no-console
      console.error(`FAIL ${caseId}: fixture or expected definition missing`);
      continue;
    }

    const request = buildAdapterRequest({ caseId, fixture });
    const runA = await runAdapter({ cli, request, cwd: packDir });
    const runB = await runAdapter({ cli, request, cwd: packDir });

    const mismatches = [];
    if (!runA.parsed) mismatches.push("adapter stdout is not valid JSON");
    if (!runB.parsed) mismatches.push("adapter rerun stdout is not valid JSON");

    if (runA.parsed && runB.parsed) {
      if (canonicalJsonStringify(runA.parsed) !== canonicalJsonStringify(runB.parsed)) {
        mismatches.push("adapter output is non-deterministic across identical reruns");
      }
    }

    if (runA.parsed) {
      const expectedOutcome = String(expected.outcome ?? "").toLowerCase();
      if (expectedOutcome === "pass") {
        if (runA.parsed.ok !== true) {
          mismatches.push(`expected pass but adapter returned ok=${String(runA.parsed.ok)}`);
        }
        if (runA.exitCode !== 0) {
          mismatches.push(`expected pass exit code 0 got ${runA.exitCode}`);
        }

        const actualShape = extractActualPassShape(runA.parsed);
        const expectedShape = {
          headers: expected.headers ?? null,
          ready: expected.ready ?? null,
          emitted: expected.emitted ?? null,
          cursor: expected.cursor ?? null
        };
        compareSubset({ expected: expectedShape, actual: actualShape, mismatches });
      } else if (expectedOutcome === "fail") {
        if (runA.parsed.ok !== false) {
          mismatches.push(`expected fail but adapter returned ok=${String(runA.parsed.ok)}`);
        }
        const actualShape = extractActualFailShape(runA.parsed);
        compareSubset({ expected, actual: actualShape, mismatches });
      } else {
        mismatches.push(`expected.outcome must be pass|fail (got ${String(expected.outcome ?? "null")})`);
      }
    }

    if (mismatches.length > 0) {
      fail += 1;
      results.push(
        normalizeForCanonicalJson(
          {
            id: caseId,
            invariantIds,
            status: "fail",
            reasonCode: "CONFORMANCE_EXPECTATION_MISMATCH",
            expected,
            exitCode: runA.exitCode,
            actual: runA.parsed ?? null,
            mismatches,
            adapterStderr: normalizeString(runA.stderr)
          },
          { path: "$" }
        )
      );
      // eslint-disable-next-line no-console
      console.error(`FAIL ${caseId}: ${mismatches.join("; ")}`);
      continue;
    }

    pass += 1;
    results.push(
      normalizeForCanonicalJson(
        {
          id: caseId,
          invariantIds,
          status: "pass",
          expected,
          actual: runA.parsed,
          runtime: runA.parsed?.runtime ?? null
        },
        { path: "$" }
      )
    );
    // eslint-disable-next-line no-console
    console.log(`PASS ${caseId}`);
  }

  const reportCore = normalizeForCanonicalJson(
    {
      schemaVersion: "ConformanceRunReportCore.v1",
      pack: "conformance/session-stream-v1",
      casesSchemaVersion: String(vectors?.schemaVersion ?? ""),
      adapterProtocolVersion: String(vectors?.adapterProtocolVersion ?? ""),
      selectedCaseId: opts.caseId,
      runner: {
        mode: cli.mode,
        adapterBin: cli.mode === "bin" ? opts.adapterBin : null,
        adapterNodeBin: cli.mode === "node" ? path.resolve(opts.adapterNodeBin) : null
      },
      summary: {
        total: selectedCases.length,
        pass,
        fail,
        skip: 0,
        ok: fail === 0
      },
      results
    },
    { path: "$" }
  );

  const reportHash = sha256Hex(canonicalJsonStringify(reportCore));
  const report = normalizeForCanonicalJson(
    {
      schemaVersion: "ConformanceRunReport.v1",
      generatedAt: new Date().toISOString(),
      reportHash,
      reportCore
    },
    { path: "$" }
  );

  if (opts.jsonOut) {
    const outPath = await writeOutputJson(opts.jsonOut, report);
    // eslint-disable-next-line no-console
    console.log(`wrote ${outPath}`);
  }

  if (opts.certBundleOut) {
    const certCore = normalizeForCanonicalJson(
      {
        schemaVersion: "ConformanceCertBundleCore.v1",
        pack: "conformance/session-stream-v1",
        reportSchemaVersion: report.schemaVersion,
        reportHash,
        reportCore
      },
      { path: "$" }
    );
    const certHash = sha256Hex(canonicalJsonStringify(certCore));
    const certBundle = normalizeForCanonicalJson(
      {
        schemaVersion: "ConformanceCertBundle.v1",
        generatedAt: new Date().toISOString(),
        certHash,
        certCore
      },
      { path: "$" }
    );
    const outPath = await writeOutputJson(opts.certBundleOut, certBundle);
    // eslint-disable-next-line no-console
    console.log(`wrote ${outPath}`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nSummary: pass=${pass} fail=${fail} skip=0`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack ?? String(err ?? ""));
  process.exit(2);
});
