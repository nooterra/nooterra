#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex } from "../../src/core/crypto.js";
import { buildSessionReplayPackV1, verifySessionReplayPackV1 } from "../../src/core/session-replay-pack.js";
import { buildSessionTranscriptV1, verifySessionTranscriptV1 } from "../../src/core/session-transcript.js";
import { readJsonFile, spawnCapture } from "./lib/harness.mjs";

function parseArgs(argv) {
  const out = {
    adapterBin: "nooterra-session-runtime-adapter",
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
    "  node conformance/session-v1/run.mjs [--adapter-bin <cmd>] [--adapter-node-bin <path/to/adapter.js>] [--case <id>] [--json-out <path>] [--cert-bundle-out <path>] [--list]"
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

function buildAdapterRequest({ caseId, fixture, signing }) {
  const requestFixture =
    signing && typeof signing === "object" && !Array.isArray(signing)
      ? { ...fixture, signing: { ...signing } }
      : { ...fixture };
  return {
    schemaVersion: "SessionArtifactConformanceRequest.v1",
    caseId,
    fixture: requestFixture
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

function verifyArtifacts({ caseId, fixture, signing, output }) {
  const errors = [];

  if (!output || typeof output !== "object" || Array.isArray(output)) {
    errors.push("adapter output must be an object");
    return { errors };
  }
  if (output.schemaVersion !== "SessionArtifactConformanceResponse.v1") {
    errors.push(`unexpected response schemaVersion: ${String(output.schemaVersion ?? "null")}`);
    return { errors };
  }
  if (output.ok !== true) {
    errors.push(`adapter returned ok=false code=${String(output.code ?? "")}`);
    return { errors };
  }
  if (normalizeString(output.caseId) !== caseId) {
    errors.push(`adapter caseId mismatch expected=${caseId} actual=${String(output.caseId ?? "null")}`);
    return { errors };
  }

  let replayPack = null;
  let transcript = null;
  try {
    replayPack = buildSessionReplayPackV1({
      tenantId: output?.replayPack?.tenantId,
      session: output?.replayPack?.session,
      events: Array.isArray(output?.replayPack?.events) ? output.replayPack.events : [],
      verification: output?.replayPack?.verification ?? null,
      signature: output?.replayPack?.signature ?? null
    });
  } catch (err) {
    errors.push(`replay pack invalid: ${err?.message ?? String(err ?? "")}`);
  }

  try {
    transcript = buildSessionTranscriptV1({
      tenantId: output?.transcript?.tenantId,
      session: output?.transcript?.session,
      events: Array.isArray(output?.transcript?.eventDigests)
        ? output.transcript.eventDigests
        : Array.isArray(output?.transcript?.events)
          ? output.transcript.events
          : [],
      verification: output?.transcript?.verification ?? null,
      signature: output?.transcript?.signature ?? null
    });
  } catch (err) {
    errors.push(`transcript invalid: ${err?.message ?? String(err ?? "")}`);
  }

  if (errors.length > 0) return { errors };

  const replaySignaturePresent = replayPack.signature !== undefined && replayPack.signature !== null;
  const transcriptSignaturePresent = transcript.signature !== undefined && transcript.signature !== null;

  if (signing && typeof signing === "object" && !Array.isArray(signing)) {
    const replayVerify = verifySessionReplayPackV1({ replayPack, publicKeyPem: signing.publicKeyPem });
    if (replayVerify.ok !== true) {
      errors.push(`replay signature verify failed: ${replayVerify.code ?? replayVerify.error ?? "unknown"}`);
    }
    const transcriptVerify = verifySessionTranscriptV1({ transcript, publicKeyPem: signing.publicKeyPem });
    if (transcriptVerify.ok !== true) {
      errors.push(`transcript signature verify failed: ${transcriptVerify.code ?? transcriptVerify.error ?? "unknown"}`);
    }
  }

  const actual = {
    eventCount: Number(replayPack.eventCount ?? 0),
    generatedAt: normalizeString(replayPack.generatedAt),
    replayPackHash: normalizeString(replayPack.packHash),
    transcriptHash: normalizeString(transcript.transcriptHash),
    replaySignaturePresent,
    transcriptSignaturePresent,
    replaySignatureBase64: normalizeString(replayPack?.signature?.signatureBase64),
    transcriptSignatureBase64: normalizeString(transcript?.signature?.signatureBase64)
  };

  return {
    errors,
    runtime: output.runtime ?? null,
    replayPack,
    transcript,
    actual
  };
}

function compareExpected({ expected, actual }) {
  const mismatches = [];
  if (Number(actual.eventCount) !== Number(expected.eventCount)) {
    mismatches.push(`eventCount expected ${expected.eventCount} got ${actual.eventCount}`);
  }
  if (String(actual.generatedAt) !== String(expected.generatedAt)) {
    mismatches.push(`generatedAt expected ${expected.generatedAt} got ${actual.generatedAt}`);
  }
  if (String(actual.replayPackHash) !== String(expected.replayPackHash)) {
    mismatches.push(`replayPackHash expected ${expected.replayPackHash} got ${actual.replayPackHash}`);
  }
  if (String(actual.transcriptHash) !== String(expected.transcriptHash)) {
    mismatches.push(`transcriptHash expected ${expected.transcriptHash} got ${actual.transcriptHash}`);
  }
  if (Boolean(actual.replaySignaturePresent) !== Boolean(expected.replaySignaturePresent)) {
    mismatches.push(`replaySignaturePresent expected ${Boolean(expected.replaySignaturePresent)} got ${Boolean(actual.replaySignaturePresent)}`);
  }
  if (Boolean(actual.transcriptSignaturePresent) !== Boolean(expected.transcriptSignaturePresent)) {
    mismatches.push(`transcriptSignaturePresent expected ${Boolean(expected.transcriptSignaturePresent)} got ${Boolean(actual.transcriptSignaturePresent)}`);
  }

  const expectedReplaySig = normalizeString(expected.replaySignatureBase64);
  if (expectedReplaySig !== null && String(actual.replaySignatureBase64) !== expectedReplaySig) {
    mismatches.push("replaySignatureBase64 does not match expected deterministic signature");
  }
  const expectedTranscriptSig = normalizeString(expected.transcriptSignatureBase64);
  if (expectedTranscriptSig !== null && String(actual.transcriptSignatureBase64) !== expectedTranscriptSig) {
    mismatches.push("transcriptSignatureBase64 does not match expected deterministic signature");
  }

  return mismatches;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    process.exit(0);
  }

  const packDir = path.dirname(fileURLToPath(import.meta.url));
  const vectors = await readJsonFile(path.join(packDir, "vectors.json"));
  if (vectors?.schemaVersion !== "SessionArtifactConformanceCases.v1") {
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

    const request = buildAdapterRequest({
      caseId,
      fixture,
      signing: row?.signing ?? null
    });

    const runA = await runAdapter({ cli, request, cwd: packDir });
    if (runA.exitCode !== 0) {
      fail += 1;
      results.push(
        normalizeForCanonicalJson(
          {
            id: caseId,
            invariantIds,
            status: "fail",
            reasonCode: "CONFORMANCE_ADAPTER_EXEC_FAILED",
            mismatches: [`adapter exited with code ${runA.exitCode}`],
            adapterStderr: normalizeString(runA.stderr)
          },
          { path: "$" }
        )
      );
      // eslint-disable-next-line no-console
      console.error(`FAIL ${caseId}: adapter exited with code ${runA.exitCode}`);
      continue;
    }

    if (!runA.parsed) {
      fail += 1;
      results.push(
        normalizeForCanonicalJson(
          {
            id: caseId,
            invariantIds,
            status: "fail",
            reasonCode: "CONFORMANCE_ADAPTER_OUTPUT_INVALID_JSON",
            mismatches: ["adapter stdout is not valid JSON"]
          },
          { path: "$" }
        )
      );
      // eslint-disable-next-line no-console
      console.error(`FAIL ${caseId}: adapter stdout is not valid JSON`);
      continue;
    }

    const runB = await runAdapter({ cli, request, cwd: packDir });
    if (runB.exitCode !== 0 || !runB.parsed) {
      fail += 1;
      results.push(
        normalizeForCanonicalJson(
          {
            id: caseId,
            invariantIds,
            status: "fail",
            reasonCode: "CONFORMANCE_ADAPTER_DETERMINISM_RERUN_FAILED",
            mismatches: ["adapter rerun failed (non-zero exit or invalid JSON)"]
          },
          { path: "$" }
        )
      );
      // eslint-disable-next-line no-console
      console.error(`FAIL ${caseId}: adapter rerun failed`);
      continue;
    }

    const verifiedA = verifyArtifacts({ caseId, fixture, signing: row?.signing ?? null, output: runA.parsed });
    const verifiedB = verifyArtifacts({ caseId, fixture, signing: row?.signing ?? null, output: runB.parsed });

    const mismatches = [];
    mismatches.push(...verifiedA.errors);
    mismatches.push(...verifiedB.errors.map((m) => `rerun: ${m}`));

    if (verifiedA.replayPack && verifiedB.replayPack) {
      const replayCanonicalA = canonicalJsonStringify(verifiedA.replayPack);
      const replayCanonicalB = canonicalJsonStringify(verifiedB.replayPack);
      if (replayCanonicalA !== replayCanonicalB) {
        mismatches.push("replayPack output is non-deterministic across identical reruns");
      }
    }

    if (verifiedA.transcript && verifiedB.transcript) {
      const transcriptCanonicalA = canonicalJsonStringify(verifiedA.transcript);
      const transcriptCanonicalB = canonicalJsonStringify(verifiedB.transcript);
      if (transcriptCanonicalA !== transcriptCanonicalB) {
        mismatches.push("transcript output is non-deterministic across identical reruns");
      }
    }

    if (verifiedA.actual) {
      mismatches.push(...compareExpected({ expected, actual: verifiedA.actual }));
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
            actual: verifiedA.actual ?? null,
            mismatches
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
          actual: verifiedA.actual,
          runtime: verifiedA.runtime ?? null
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
      pack: "conformance/session-v1",
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
        pack: "conformance/session-v1",
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
