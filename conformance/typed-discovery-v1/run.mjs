#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { createApi } from "../../src/api/app.js";
import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex } from "../../src/core/crypto.js";

const DEFAULT_NOW_ISO = "2026-02-28T00:00:00.000Z";
const DEFAULT_OPS_TOKEN = "tok_ops";
const DEFAULT_TENANT_ID = "tenant_default";

function parseArgs(argv) {
  const out = {
    caseId: null,
    list: false,
    jsonOut: null,
    generatedAt: null,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const nextValue = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${a}`);
      return String(argv[i] ?? "");
    };
    if (a === "--case") {
      out.caseId = nextValue();
      continue;
    }
    if (a === "--json-out") {
      out.jsonOut = nextValue();
      continue;
    }
    if (a === "--generated-at") {
      out.generatedAt = assertIso8601Timestamp(nextValue(), "--generated-at");
      continue;
    }
    if (a.startsWith("--generated-at=")) {
      out.generatedAt = assertIso8601Timestamp(String(a.slice("--generated-at=".length)), "--generated-at");
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
  console.error(
    "  node conformance/typed-discovery-v1/run.mjs [--case <id>] [--json-out <path>] [--generated-at <iso-8601>] [--list]"
  );
}

function assertIso8601Timestamp(value, fieldName) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${fieldName} must not be empty`);
  const epochMs = Date.parse(text);
  if (!Number.isFinite(epochMs)) throw new Error(`${fieldName} must be a valid ISO-8601 timestamp`);
  return new Date(epochMs).toISOString();
}

async function loadVectors() {
  const packDir = path.dirname(fileURLToPath(import.meta.url));
  const vectorsPath = path.join(packDir, "vectors.json");
  const raw = await fs.readFile(vectorsPath, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed?.schemaVersion !== "TypedDiscoveryConformanceVectors.v1") {
    throw new Error(`unsupported vectors schemaVersion: ${parsed?.schemaVersion ?? "null"}`);
  }
  if (!Array.isArray(parsed?.cases)) throw new Error("vectors.cases must be an array");
  return parsed;
}

async function writeJsonOutput(fp, value) {
  const outPath = path.resolve(process.cwd(), String(fp));
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  return outPath;
}

function makeReq({ method, requestPath, headers, body }) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
  const req = Readable.from(chunks);
  req.method = String(method).toUpperCase();
  req.url = requestPath;
  req.headers = headers ?? {};
  return req;
}

function makeRes() {
  const headers = new Map();
  return {
    statusCode: 200,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    end(payload) {
      this.body = payload ?? "";
      this.headers = headers;
      this.ended = true;
    }
  };
}

async function apiRequest(api, { method, requestPath, body = undefined, headers = {} } = {}) {
  const reqHeaders = { ...headers };
  if (!Object.hasOwn(reqHeaders, "x-proxy-tenant-id")) reqHeaders["x-proxy-tenant-id"] = DEFAULT_TENANT_ID;
  if (!Object.hasOwn(reqHeaders, "x-proxy-ops-token")) reqHeaders["x-proxy-ops-token"] = DEFAULT_OPS_TOKEN;
  if (body !== undefined && !Object.hasOwn(reqHeaders, "content-type")) reqHeaders["content-type"] = "application/json";

  const req = makeReq({ method, requestPath, headers: reqHeaders, body });
  const res = makeRes();
  await api.handle(req, res);

  const text = typeof res.body === "string" ? res.body : Buffer.from(res.body ?? "").toString("utf8");
  let parsedJson = null;
  try {
    parsedJson = text ? JSON.parse(text) : null;
  } catch {
    parsedJson = null;
  }
  return {
    statusCode: res.statusCode,
    json: parsedJson,
    body: text
  };
}

function makeCheck(field, expected, actual, ok) {
  return normalizeForCanonicalJson(
    {
      field,
      expected,
      actual,
      ok: Boolean(ok)
    },
    { path: "$" }
  );
}

function isObjectLike(value) {
  return value !== null && typeof value === "object";
}

function deepDeterministicEqual(left, right) {
  if (!isObjectLike(left) && !isObjectLike(right)) return Object.is(left, right);
  return (
    canonicalJsonStringify(normalizeForCanonicalJson(left, { path: "$" })) ===
    canonicalJsonStringify(normalizeForCanonicalJson(right, { path: "$" }))
  );
}

function equalsCheck(field, expected, actual) {
  return makeCheck(field, expected, actual, deepDeterministicEqual(expected, actual));
}

function includesCheck(field, expectedSubstring, actual) {
  const actualText = typeof actual === "string" ? actual : "";
  return makeCheck(field, expectedSubstring, actualText, actualText.includes(expectedSubstring));
}

function ensureStatus(response, expectedStatusCode, label) {
  if (response.statusCode !== expectedStatusCode) {
    throw new Error(
      `${label} expected status ${expectedStatusCode} got ${response.statusCode} body=${String(response.body ?? "").slice(0, 600)}`
    );
  }
}

function makeIdempotencyKey(caseId, suffix) {
  const key = `typed_discovery_${caseId}_${suffix}`.replace(/[^A-Za-z0-9._:-]/g, "_");
  return key.slice(0, 200);
}

function buildDeterministicApi() {
  return createApi({
    opsToken: DEFAULT_OPS_TOKEN,
    now: () => DEFAULT_NOW_ISO
  });
}

async function registerAgent(api, { caseId, step, agentId, capabilities }) {
  const publicKeyPem = String(api?.store?.serverSigner?.publicKeyPem ?? "");
  if (!publicKeyPem.trim()) throw new Error("api.store.serverSigner.publicKeyPem is required");
  const response = await apiRequest(api, {
    method: "POST",
    requestPath: "/agents/register",
    headers: {
      "x-idempotency-key": makeIdempotencyKey(caseId, `${step}_register_${agentId}`)
    },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_typed_discovery" },
      publicKeyPem,
      capabilities
    }
  });
  ensureStatus(response, 201, `registerAgent(${agentId})`);
  return response;
}

async function upsertAgentCard(api, { caseId, step, agentId, capability, visibility = "public", hostSuffix = null, tools = undefined }) {
  const response = await apiRequest(api, {
    method: "POST",
    requestPath: "/agent-cards",
    headers: {
      "x-idempotency-key": makeIdempotencyKey(caseId, `${step}_card_${agentId}`)
    },
    body: {
      agentId,
      displayName: `Card ${agentId}`,
      capabilities: [capability],
      visibility,
      host: {
        runtime: "openclaw",
        endpoint: `https://example.test/typed-discovery/${hostSuffix ?? agentId}`,
        protocols: ["mcp"]
      },
      ...(tools !== undefined ? { tools } : {})
    }
  });
  return response;
}

async function issueCapabilityAttestation(
  api,
  {
    caseId,
    step,
    attestationId,
    subjectAgentId,
    issuerAgentId,
    capability,
    issuedAt = "2026-02-27T00:00:00.000Z",
    notBefore = "2026-02-27T00:00:00.000Z",
    expiresAt = "2027-02-27T00:00:00.000Z"
  }
) {
  const response = await apiRequest(api, {
    method: "POST",
    requestPath: "/capability-attestations",
    headers: {
      "x-idempotency-key": makeIdempotencyKey(caseId, `${step}_attestation_${attestationId}`)
    },
    body: {
      attestationId,
      subjectAgentId,
      capability,
      level: "attested",
      issuerAgentId,
      validity: {
        issuedAt,
        notBefore,
        expiresAt
      },
      signature: {
        keyId: `key_${issuerAgentId}`,
        signature: `sig_${attestationId}`
      }
    }
  });
  ensureStatus(response, 201, `issueCapabilityAttestation(${attestationId})`);
  return response;
}

function normalizeExcludedByAgent(excludedRows) {
  const byAgent = new Map();
  for (const row of Array.isArray(excludedRows) ? excludedRows : []) {
    const agentId = String(row?.agentId ?? "").trim();
    if (!agentId) continue;
    byAgent.set(agentId, String(row?.reasonCode ?? "").trim() || null);
  }
  return [...byAgent.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([agentId, reasonCode]) =>
      normalizeForCanonicalJson(
        {
          agentId,
          reasonCode
        },
        { path: "$" }
      )
    );
}

async function runMalformedToolDescriptorInputCase(testCase) {
  const caseId = String(testCase?.id ?? "");
  const fixture = testCase?.fixture ?? {};
  const expected = testCase?.expected ?? {};
  const agentId = String(fixture?.agentId ?? "agt_td_tool_invalid_1");
  const capability = String(fixture?.capability ?? "travel.booking");

  const api = buildDeterministicApi();
  await registerAgent(api, { caseId, step: "setup", agentId, capabilities: [capability] });

  const response = await upsertAgentCard(api, {
    caseId,
    step: "malformed",
    agentId,
    capability,
    tools: {
      schemaVersion: "ToolDescriptor.v1",
      toolId: "travel.book_flight",
      riskClass: "action"
    }
  });

  const actual = normalizeForCanonicalJson(
    {
      statusCode: response.statusCode,
      code: response.json?.code ?? null,
      detailMessage: response.json?.details?.message ?? null
    },
    { path: "$" }
  );

  const checks = [
    equalsCheck("statusCode", Number(expected?.statusCode ?? 400), actual.statusCode),
    equalsCheck("code", String(expected?.code ?? "SCHEMA_INVALID"), actual.code),
    includesCheck("detailMessage includes", String(expected?.detailIncludes ?? ""), actual.detailMessage)
  ];

  return { actual, checks };
}

async function runCapabilityNamespaceSpamInvalidUriCase(testCase) {
  const repeat = Number.isSafeInteger(Number(testCase?.repeat)) && Number(testCase.repeat) > 0 ? Number(testCase.repeat) : 2;
  const expected = testCase?.expected ?? {};

  const api = buildDeterministicApi();
  const probeResults = [];
  const checks = [];

  for (const probe of Array.isArray(testCase?.probes) ? testCase.probes : []) {
    const label = String(probe?.label ?? "probe");
    const capability = String(probe?.capability ?? "");
    const expectedReasonToken = String(probe?.expectedReasonToken ?? "");
    const attempts = [];
    for (let i = 0; i < repeat; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const response = await apiRequest(api, {
        method: "GET",
        requestPath: `/agent-cards/discover?capability=${encodeURIComponent(capability)}`
      });
      attempts.push(response);
    }

    const statusCodes = attempts.map((row) => Number(row?.statusCode ?? 0));
    const codes = attempts.map((row) => String(row?.json?.code ?? ""));
    const messages = attempts.map((row) => String(row?.json?.details?.message ?? ""));
    const deterministicMessage = messages.every((row) => row === messages[0]);

    probeResults.push(
      normalizeForCanonicalJson(
        {
          label,
          capability,
          statusCodes,
          codes,
          messages,
          deterministicMessage
        },
        { path: "$" }
      )
    );

    for (let i = 0; i < attempts.length; i += 1) {
      checks.push(equalsCheck(`${label}.attempt${i + 1}.statusCode`, Number(expected?.statusCode ?? 400), statusCodes[i]));
      checks.push(equalsCheck(`${label}.attempt${i + 1}.code`, String(expected?.code ?? "SCHEMA_INVALID"), codes[i]));
    }
    checks.push(equalsCheck(`${label}.deterministicMessage`, true, deterministicMessage));
    if (expectedReasonToken) {
      checks.push(includesCheck(`${label}.reasonToken`, expectedReasonToken, messages[0] ?? ""));
    }
  }

  const actual = normalizeForCanonicalJson(
    {
      probes: probeResults
    },
    { path: "$" }
  );
  return { actual, checks };
}

async function runInvalidAttestationReferenceCase(testCase) {
  const caseId = String(testCase?.id ?? "");
  const fixture = testCase?.fixture ?? {};
  const expected = testCase?.expected ?? {};
  const capability = String(fixture?.capability ?? "travel.booking");
  const attestedAgentId = String(fixture?.attestedAgentId ?? "agt_td_attested_subject_1");
  const plainAgentId = String(fixture?.plainAgentId ?? "agt_td_plain_subject_1");
  const issuerAgentId = String(fixture?.issuerAgentId ?? "agt_td_issuer_a_1");
  const requestedIssuerAgentId = String(fixture?.requestedIssuerAgentId ?? "agt_td_issuer_b_1");
  const attestationId = String(fixture?.attestationId ?? "catt_td_attested_subject_1");

  const api = buildDeterministicApi();

  await registerAgent(api, { caseId, step: "setup", agentId: attestedAgentId, capabilities: [capability] });
  await registerAgent(api, { caseId, step: "setup", agentId: plainAgentId, capabilities: [capability] });
  await registerAgent(api, { caseId, step: "setup", agentId: issuerAgentId, capabilities: ["attestation.issue"] });
  await registerAgent(api, { caseId, step: "setup", agentId: requestedIssuerAgentId, capabilities: ["attestation.issue"] });

  ensureStatus(
    await upsertAgentCard(api, { caseId, step: "setup", agentId: attestedAgentId, capability }),
    201,
    `upsertAgentCard(${attestedAgentId})`
  );
  ensureStatus(
    await upsertAgentCard(api, { caseId, step: "setup", agentId: plainAgentId, capability }),
    201,
    `upsertAgentCard(${plainAgentId})`
  );
  await issueCapabilityAttestation(api, {
    caseId,
    step: "setup",
    attestationId,
    subjectAgentId: attestedAgentId,
    issuerAgentId,
    capability
  });

  const response = await apiRequest(api, {
    method: "GET",
    requestPath:
      "/agent-cards/discover?capability=" +
      encodeURIComponent(capability) +
      "&visibility=public&runtime=openclaw&status=active&includeReputation=false&requireCapabilityAttestation=true&attestationMinLevel=attested&attestationIssuerAgentId=" +
      encodeURIComponent(requestedIssuerAgentId) +
      "&includeAttestationMetadata=true&limit=10&offset=0"
  });

  const results = Array.isArray(response.json?.results) ? response.json.results : [];
  const resultAgentIds = results.map((row) => String(row?.agentCard?.agentId ?? "")).filter(Boolean);
  const excludedByAgent = normalizeExcludedByAgent(response.json?.excludedAttestationCandidates);
  const excludedMap = new Map(excludedByAgent.map((row) => [row.agentId, row.reasonCode]));

  const actual = normalizeForCanonicalJson(
    {
      statusCode: response.statusCode,
      resultCount: resultAgentIds.length,
      resultAgentIds,
      excludedByAgent
    },
    { path: "$" }
  );

  const checks = [
    equalsCheck("statusCode", Number(expected?.statusCode ?? 200), actual.statusCode),
    equalsCheck("resultCount", Number(expected?.resultCount ?? 0), actual.resultCount)
  ];
  const expectedExcluded = expected?.excludedReasonByAgent && typeof expected.excludedReasonByAgent === "object" ? expected.excludedReasonByAgent : {};
  for (const agentId of Object.keys(expectedExcluded).sort((left, right) => left.localeCompare(right))) {
    checks.push(
      equalsCheck(
        `excludedReasonByAgent.${agentId}`,
        String(expectedExcluded[agentId] ?? ""),
        excludedMap.get(agentId) ?? null
      )
    );
  }
  return { actual, checks };
}

async function runTypedFilterOrderingCase(testCase) {
  const caseId = String(testCase?.id ?? "");
  const fixture = testCase?.fixture ?? {};
  const expected = testCase?.expected ?? {};
  const capability = String(fixture?.capability ?? "travel.booking");
  const includedAgentIds = Array.isArray(fixture?.includedAgentIds)
    ? fixture.includedAgentIds.map((row) => String(row ?? "")).filter(Boolean)
    : ["agt_td_order_a_1", "agt_td_order_b_1"];
  const excludedAgentId = String(fixture?.excludedAgentId ?? "agt_td_order_excluded_1");

  const api = buildDeterministicApi();

  const orderedSetup = [includedAgentIds[1], includedAgentIds[0], excludedAgentId].filter(Boolean);
  for (const agentId of orderedSetup) {
    // eslint-disable-next-line no-await-in-loop
    await registerAgent(api, { caseId, step: "setup", agentId, capabilities: [capability] });
  }

  const readTool = {
    schemaVersion: "ToolDescriptor.v1",
    toolId: "travel.search",
    mcpToolName: "travel_search",
    riskClass: "read",
    sideEffecting: false,
    pricing: { amountCents: 100, currency: "USD", unit: "call" },
    requiresEvidenceKinds: ["artifact"]
  };
  const actionTool = {
    schemaVersion: "ToolDescriptor.v1",
    toolId: "travel.book",
    mcpToolName: "travel_book",
    riskClass: "action",
    sideEffecting: true,
    pricing: { amountCents: 500, currency: "USD", unit: "booking" },
    requiresEvidenceKinds: ["artifact", "hash"]
  };

  ensureStatus(
    await upsertAgentCard(api, { caseId, step: "setup", agentId: includedAgentIds[1], capability, tools: [readTool] }),
    201,
    `upsertAgentCard(${includedAgentIds[1]})`
  );
  ensureStatus(
    await upsertAgentCard(api, { caseId, step: "setup", agentId: includedAgentIds[0], capability, tools: [readTool] }),
    201,
    `upsertAgentCard(${includedAgentIds[0]})`
  );
  ensureStatus(
    await upsertAgentCard(api, { caseId, step: "setup", agentId: excludedAgentId, capability, tools: [actionTool] }),
    201,
    `upsertAgentCard(${excludedAgentId})`
  );

  const queryPath =
    "/public/agent-cards/discover?capability=" +
    encodeURIComponent(capability) +
    "&visibility=public&runtime=openclaw&status=active&includeReputation=false&toolRiskClass=read&toolSideEffecting=false&toolRequiresEvidenceKind=artifact&limit=10&offset=0";

  const first = await apiRequest(api, { method: "GET", requestPath: queryPath });
  const second = await apiRequest(api, { method: "GET", requestPath: queryPath });
  const firstAgentIds = (Array.isArray(first.json?.results) ? first.json.results : [])
    .map((row) => String(row?.agentCard?.agentId ?? ""))
    .filter(Boolean);
  const secondAgentIds = (Array.isArray(second.json?.results) ? second.json.results : [])
    .map((row) => String(row?.agentCard?.agentId ?? ""))
    .filter(Boolean);
  const deterministicOrder = canonicalJsonStringify(firstAgentIds) === canonicalJsonStringify(secondAgentIds);

  const actual = normalizeForCanonicalJson(
    {
      first: {
        statusCode: first.statusCode,
        orderedAgentIds: firstAgentIds
      },
      second: {
        statusCode: second.statusCode,
        orderedAgentIds: secondAgentIds
      },
      deterministicOrder
    },
    { path: "$" }
  );

  const expectedOrderedAgentIds = Array.isArray(expected?.orderedAgentIds)
    ? expected.orderedAgentIds.map((row) => String(row ?? "")).filter(Boolean)
    : includedAgentIds.slice().sort((left, right) => left.localeCompare(right));
  const expectedStatusCode = Number(expected?.statusCode ?? 200);

  const checks = [
    equalsCheck("first.statusCode", expectedStatusCode, first.statusCode),
    equalsCheck("second.statusCode", expectedStatusCode, second.statusCode),
    equalsCheck("first.orderedAgentIds", expectedOrderedAgentIds, firstAgentIds),
    equalsCheck("second.orderedAgentIds", expectedOrderedAgentIds, secondAgentIds),
    equalsCheck("deterministicOrder", true, deterministicOrder)
  ];
  return { actual, checks };
}

const CASE_KIND_RUNNER = Object.freeze({
  malformed_tool_descriptor_input: runMalformedToolDescriptorInputCase,
  capability_namespace_spam_invalid_uri: runCapabilityNamespaceSpamInvalidUriCase,
  invalid_attestation_reference: runInvalidAttestationReferenceCase,
  typed_filter_ordering: runTypedFilterOrderingCase
});

async function runCase(testCase) {
  const kind = String(testCase?.kind ?? "");
  const runner = CASE_KIND_RUNNER[kind];
  if (!runner) throw new Error(`unsupported case kind: ${kind}`);
  return runner(testCase);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    process.exit(0);
  }

  const vectors = await loadVectors();
  const allCases = vectors.cases;
  if (opts.list) {
    for (const row of allCases) {
      // eslint-disable-next-line no-console
      console.log(String(row?.id ?? ""));
    }
    process.exit(0);
  }

  const selectedCases = opts.caseId ? allCases.filter((row) => String(row?.id ?? "") === opts.caseId) : allCases;
  if (opts.caseId && selectedCases.length === 0) {
    throw new Error(`unknown case id: ${opts.caseId}`);
  }

  let pass = 0;
  let fail = 0;
  const caseResults = [];

  for (const testCase of selectedCases) {
    const caseId = String(testCase?.id ?? "");
    const invariantIds = Array.isArray(testCase?.invariantIds)
      ? [...new Set(testCase.invariantIds.map((row) => String(row ?? "").trim()).filter(Boolean))].sort((left, right) =>
          left.localeCompare(right)
        )
      : [];
    try {
      // eslint-disable-next-line no-await-in-loop
      const ran = await runCase(testCase);
      const checks = Array.isArray(ran?.checks) ? ran.checks : [];
      const ok = checks.every((row) => row?.ok === true);
      const status = ok ? "pass" : "fail";
      if (ok) pass += 1;
      else fail += 1;
      caseResults.push(
        normalizeForCanonicalJson(
          {
            id: caseId,
            kind: String(testCase?.kind ?? ""),
            invariantIds,
            status,
            expected: testCase?.expected ?? {},
            actual: ran?.actual ?? null,
            checks
          },
          { path: "$" }
        )
      );
      // eslint-disable-next-line no-console
      console.log(`${status.toUpperCase()} ${caseId}`);
      continue;
    } catch (err) {
      fail += 1;
      caseResults.push(
        normalizeForCanonicalJson(
          {
            id: caseId,
            kind: String(testCase?.kind ?? ""),
            invariantIds,
            status: "fail",
            expected: testCase?.expected ?? {},
            actual: null,
            checks: [
              makeCheck(
                "caseExecution",
                "completed_without_error",
                String(err?.message ?? err ?? ""),
                false
              )
            ],
            reasonCode: "CONFORMANCE_CASE_EXECUTION_FAILED"
          },
          { path: "$" }
        )
      );
      // eslint-disable-next-line no-console
      console.error(`FAIL ${caseId}: ${err?.message ?? String(err ?? "")}`);
    }
  }

  const blockingIssues = caseResults.filter((row) => row.status === "fail").map((row) => row.id);
  const reportCore = normalizeForCanonicalJson(
    {
      schemaVersion: "TypedDiscoveryConformanceRunReportCore.v1",
      pack: "conformance/typed-discovery-v1",
      vectorsSchemaVersion: String(vectors?.schemaVersion ?? ""),
      selectedCaseId: opts.caseId,
      checks: caseResults,
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
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const report = normalizeForCanonicalJson(
    {
      schemaVersion: "TypedDiscoveryConformanceRunReport.v1",
      generatedAt,
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
