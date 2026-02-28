#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex } from "../../src/core/crypto.js";
import { createFederationReplayLedger } from "../../src/api/federation/replay-ledger.js";
import { buildFederationProxyPolicy, evaluateFederationTrustAndRoute, validateFederationEnvelope } from "../../src/federation/proxy-policy.js";

const DEFAULT_CONFORMANCE_AS_OF = "2026-01-01T00:00:00.000Z";

function parseArgs(argv) {
  const out = {
    caseId: null,
    list: false,
    jsonOut: null,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
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
    if (a === "--list") {
      out.list = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage:");
  console.error("  node conformance/federation-v1/run.mjs [--case <id>] [--json-out <path>] [--list]");
}

async function loadVectors() {
  const packDir = path.dirname(fileURLToPath(import.meta.url));
  const vectorsPath = path.join(packDir, "vectors.json");
  const raw = await fs.readFile(vectorsPath, "utf8");
  const doc = JSON.parse(raw);
  if (doc?.schemaVersion !== "FederationConformanceVectors.v1") {
    throw new Error(`unsupported vectors schemaVersion: ${doc?.schemaVersion ?? "null"}`);
  }
  if (!Array.isArray(doc?.cases)) throw new Error("vectors.cases must be an array");
  return doc;
}

function buildConformancePolicy(policyInput = {}) {
  const namespaceRoutes =
    policyInput?.namespaceRoutes && typeof policyInput.namespaceRoutes === "object" && !Array.isArray(policyInput.namespaceRoutes)
      ? policyInput.namespaceRoutes
      : {
          "did:nooterra:coord_bravo": "https://federation-bravo.nooterra.test"
        };
  const trustedCoordinatorDids =
    typeof policyInput?.trustedCoordinatorDids === "string" && policyInput.trustedCoordinatorDids.trim() !== ""
      ? policyInput.trustedCoordinatorDids.trim()
      : "did:nooterra:coord_bravo,did:nooterra:coord_charlie";
  const coordinatorDid =
    typeof policyInput?.coordinatorDid === "string" && policyInput.coordinatorDid.trim() !== ""
      ? policyInput.coordinatorDid.trim()
      : "did:nooterra:coord_alpha";
  const namespaceRegistry = Array.isArray(policyInput?.namespaceRegistry) ? policyInput.namespaceRegistry : null;
  const fallbackBaseUrl =
    typeof policyInput?.fallbackBaseUrl === "string" && policyInput.fallbackBaseUrl.trim() !== ""
      ? policyInput.fallbackBaseUrl.trim()
      : null;
  const namespaceAsOf =
    typeof policyInput?.namespaceAsOf === "string" && policyInput.namespaceAsOf.trim() !== ""
      ? policyInput.namespaceAsOf.trim()
      : DEFAULT_CONFORMANCE_AS_OF;
  return buildFederationProxyPolicy({
    env: {
      COORDINATOR_DID: coordinatorDid,
      PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: trustedCoordinatorDids,
      PROXY_FEDERATION_NAMESPACE_ROUTES: JSON.stringify(namespaceRoutes),
      ...(namespaceRegistry ? { PROXY_FEDERATION_NAMESPACE_REGISTRY: JSON.stringify(namespaceRegistry) } : {}),
      PROXY_FEDERATION_NAMESPACE_AS_OF: namespaceAsOf
    },
    fallbackBaseUrl
  });
}

function applyMutation(envelope, mutation) {
  const pathText = String(mutation?.path ?? "");
  const value = mutation?.value;
  const keys = pathText.split(".").map((row) => row.trim()).filter(Boolean);
  if (!keys.length) {
    throw new Error(`invalid mutation path: ${pathText}`);
  }
  const out = structuredClone(envelope);
  let cursor = out;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const k = keys[i];
    if (!cursor[k] || typeof cursor[k] !== "object" || Array.isArray(cursor[k])) cursor[k] = {};
    cursor = cursor[k];
  }
  cursor[keys[keys.length - 1]] = value;
  return out;
}

function makeReplayKey(endpoint, envelope) {
  return [endpoint, envelope.type, envelope.invocationId, envelope.originDid, envelope.targetDid].join("\n");
}

function makeRequestHash(envelope) {
  return sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(envelope, { path: "$" })));
}

function evaluateEnvelope({ endpoint, envelope, policy, replayLedger, completeOnNew = false, asOf = null }) {
  const valid = validateFederationEnvelope({ endpoint, body: envelope });
  if (!valid.ok) return { accept: false, code: valid.code, phase: "validate" };

  const routed = evaluateFederationTrustAndRoute({ endpoint, envelope: valid.envelope, policy, asOf });
  if (!routed.ok) return { accept: false, code: routed.code, phase: "trust" };

  const replayKey = makeReplayKey(endpoint, valid.envelope);
  const requestHash = makeRequestHash(envelope);
  const replay = replayLedger.claim({ key: replayKey, requestHash });
  if (replay.type === "conflict") return { accept: false, code: "FEDERATION_ENVELOPE_CONFLICT", phase: "replay" };
  if (replay.type === "in_flight") return { accept: false, code: "FEDERATION_ENVELOPE_IN_FLIGHT", phase: "replay" };
  if (replay.type === "replay") {
    return {
      accept: true,
      duplicateReplayHeader: "x-federation-replay=duplicate",
      namespaceDid: routed.namespaceDid,
      resolvedCoordinatorDid: routed.resolvedCoordinatorDid ?? null,
      routingReasonCode: routed.routingReasonCode ?? null,
      namespaceDecisionId: routed.namespaceLineage?.decisionId ?? null
    };
  }
  if (completeOnNew) {
    replayLedger.complete({
      key: replayKey,
      requestHash,
      response: {
        statusCode: 201,
        headers: { "content-type": "application/json; charset=utf-8" },
        bodyBytes: Buffer.from(JSON.stringify({ ok: true }))
      }
    });
  }
  return {
    accept: true,
    namespaceDid: routed.namespaceDid,
    resolvedCoordinatorDid: routed.resolvedCoordinatorDid ?? null,
    routingReasonCode: routed.routingReasonCode ?? null,
    namespaceDecisionId: routed.namespaceLineage?.decisionId ?? null
  };
}

function compareExpected({ expected, actual }) {
  const checks = [];
  for (const [key, expectedValue] of Object.entries(expected ?? {})) {
    const actualValue = actual?.[key];
    let ok = false;
    if (expectedValue === "$nonEmptyString") {
      ok = typeof actualValue === "string" && actualValue.trim() !== "";
    } else if (expectedValue === "$present") {
      ok = actualValue !== null && actualValue !== undefined;
    } else {
      ok = Object.is(expectedValue, actualValue);
    }
    checks.push({
      field: key,
      expected: expectedValue,
      actual: actualValue,
      ok
    });
  }
  return checks;
}

function runCase(testCase) {
  const endpoint = String(testCase?.endpoint ?? "");
  const envelope = testCase?.envelope;
  const expected = testCase?.expected ?? {};
  const policy = buildConformancePolicy(testCase?.policy ?? {});
  const replayLedger = createFederationReplayLedger();
  const asOf = typeof testCase?.asOf === "string" && testCase.asOf.trim() !== "" ? testCase.asOf.trim() : DEFAULT_CONFORMANCE_AS_OF;

  let actual = null;
  if (String(expected?.duplicateReplayHeader ?? "").toLowerCase() === "x-federation-replay=duplicate") {
    evaluateEnvelope({ endpoint, envelope, policy, replayLedger, completeOnNew: true, asOf });
    actual = evaluateEnvelope({ endpoint, envelope, policy, replayLedger, completeOnNew: false, asOf });
  } else if (String(expected?.code ?? "") === "FEDERATION_ENVELOPE_CONFLICT" && Array.isArray(testCase?.mutations) && testCase.mutations.length > 0) {
    const mutated = applyMutation(envelope, testCase.mutations[0]);
    evaluateEnvelope({ endpoint, envelope, policy, replayLedger, completeOnNew: true, asOf });
    actual = evaluateEnvelope({ endpoint, envelope: mutated, policy, replayLedger, completeOnNew: false, asOf });
  } else {
    actual = evaluateEnvelope({ endpoint, envelope, policy, replayLedger, completeOnNew: true, asOf });
  }

  const checks = compareExpected({ expected, actual });
  const ok = checks.every((row) => row.ok);
  return { ok, checks, actual };
}

async function writeJsonOutput(fp, value) {
  const outPath = path.resolve(process.cwd(), fp);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  return outPath;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    process.exit(0);
  }

  const vectors = await loadVectors();
  const cases = vectors.cases;
  if (opts.list) {
    for (const c of cases) {
      // eslint-disable-next-line no-console
      console.log(c.id);
    }
    process.exit(0);
  }

  const selectedCases = opts.caseId ? cases.filter((row) => String(row?.id ?? "") === opts.caseId) : cases;
  if (opts.caseId && selectedCases.length === 0) {
    throw new Error(`unknown case id: ${opts.caseId}`);
  }

  const results = [];
  let pass = 0;
  let fail = 0;

  for (const testCase of selectedCases) {
    const id = String(testCase?.id ?? "");
    const ran = runCase(testCase);
    const status = ran.ok ? "pass" : "fail";
    if (ran.ok) pass += 1;
    else fail += 1;
    results.push(
      normalizeForCanonicalJson(
        {
          id,
          status,
          expected: testCase.expected ?? {},
          actual: ran.actual,
          checks: ran.checks
        },
        { path: "$" }
      )
    );
    // eslint-disable-next-line no-console
    console.log(`${status.toUpperCase()} ${id}`);
  }

  const blockingIssues = results.filter((row) => row.status === "fail").map((row) => row.id);
  const reportCore = normalizeForCanonicalJson(
    {
      schemaVersion: "FederationConformanceRunReportCore.v1",
      pack: "conformance/federation-v1",
      vectorsSchemaVersion: String(vectors?.schemaVersion ?? ""),
      selectedCaseId: opts.caseId,
      checks: results,
      summary: {
        total: selectedCases.length,
        pass,
        fail,
        ok: fail === 0
      },
      verdictCounts: {
        pass,
        fail
      },
      blockingIssues
    },
    { path: "$" }
  );
  const reportHash = sha256Hex(canonicalJsonStringify(reportCore));
  const report = normalizeForCanonicalJson(
    {
      schemaVersion: "FederationConformanceRunReport.v1",
      generatedAt: new Date().toISOString(),
      reportHash,
      reportCore
    },
    { path: "$" }
  );

  if (opts.jsonOut) {
    const outPath = await writeJsonOutput(opts.jsonOut, report);
    // eslint-disable-next-line no-console
    console.log(`wrote ${outPath}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Summary: pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack ?? String(err ?? ""));
  process.exit(2);
});
