import fs from "node:fs/promises";
import path from "node:path";

import { normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../../src/core/crypto.js";
import { buildToolManifestV1 } from "../../src/core/tool-manifest.js";

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage:");
  console.error("  node scripts/init/capability.mjs <name> [--out <dir>] [--force]");
  console.error("");
  console.error("defaults:");
  console.error("  --out examples/capabilities/<name>");
}

function die(msg) {
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    name: null,
    outDir: null,
    force: false
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] ?? "");
    if (a === "--out") {
      out.outDir = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--force") {
      out.force = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }
    if (a.startsWith("-")) die(`unknown argument: ${a}`);
    positionals.push(a);
  }
  if (positionals.length) out.name = positionals[0];
  return out;
}

function slugify(name) {
  const raw = String(name ?? "").trim();
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (!slug) throw new Error("name must contain at least one alphanumeric character");
  if (slug.length > 64) throw new Error("name is too long (max 64 chars after normalization)");
  return slug;
}

async function exists(fp) {
  try {
    await fs.stat(fp);
    return true;
  } catch {
    return false;
  }
}

async function mkdirp(fp) {
  await fs.mkdir(fp, { recursive: true });
}

// ToolManifest is built via src/core/tool-manifest.js so protocol vectors/specs stay consistent.

function renderPackageJson({ name }) {
  return {
    name: `@settld/capability-${name}`,
    private: true,
    type: "module",
    scripts: {
      dev: "node server.js",
      "kernel:prove": "node scripts/kernel-prove.mjs",
      "kernel:conformance": "node scripts/kernel-conformance.mjs"
    }
  };
}

function renderServerJs() {
  return `import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.PORT || "3900");
const baseUrl = process.env.CAPABILITY_BASE_URL || \`http://127.0.0.1:\${port}\`;

const manifestPath = path.join(__dirname, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function sendJson(res, statusCode, body) {
  const bytes = Buffer.from(JSON.stringify(body, null, 2) + "\\n");
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(bytes.length)
  });
  res.end(bytes);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += String(chunk)));
    req.on("end", () => {
      if (!data) return resolve(null);
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", baseUrl);
  if (req.method === "GET" && url.pathname === "/healthz") return sendJson(res, 200, { ok: true });
  if (req.method === "GET" && url.pathname === "/manifest.json") return sendJson(res, 200, manifest);

  if (req.method === "POST" && url.pathname === "/call") {
    let body = null;
    try {
      body = (await readJson(req)) ?? {};
    } catch {
      return sendJson(res, 400, { ok: false, error: "invalid_json" });
    }
    const text = typeof body?.text === "string" ? body.text : "";
    const output = { upper: text.toUpperCase(), length: text.length };
    const outputHash = sha256Hex(JSON.stringify(output));
    return sendJson(res, 200, { ok: true, toolId: manifest.toolId, input: { text }, output, outputHash });
  }

  return sendJson(res, 404, { ok: false, error: "not_found" });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(\`capability server listening on \${baseUrl}\`);
});
`;
}

function renderKernelProveScript() {
  return `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const baseUrl = (process.env.SETTLD_BASE_URL || "http://127.0.0.1:3000").replace(/\\/+$/, "");
const tenantId = process.env.SETTLD_TENANT_ID || "tenant_default";
const opsToken = process.env.SETTLD_OPS_TOKEN || "tok_ops";
const protocol = process.env.SETTLD_PROTOCOL || "1.0";
const capabilityBaseUrl = (process.env.CAPABILITY_BASE_URL || "http://127.0.0.1:3900").replace(/\\/+$/, "");

function idem(prefix) {
  return \`\${prefix}_\${Date.now().toString(36)}_\${Math.random().toString(16).slice(2, 8)}\`;
}

async function requestJson(method, pathname, { body, expectedPrevChainHash, idempotencyKey } = {}) {
  const url = new URL(pathname, baseUrl);
  const headers = {
    "content-type": "application/json",
    "x-proxy-tenant-id": tenantId,
    "x-proxy-ops-token": opsToken,
    "x-settld-protocol": protocol
  };
  if (idempotencyKey) headers["x-idempotency-key"] = String(idempotencyKey);
  if (expectedPrevChainHash) headers["x-proxy-expected-prev-chain-hash"] = String(expectedPrevChainHash);
  const res = await fetch(url.toString(), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    throw new Error(parsed?.message || parsed?.error || text || \`HTTP \${res.status}\`);
  }
  return parsed;
}

async function callCapability(text) {
  const url = new URL("/call", capabilityBaseUrl);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });
  const parsed = await res.json();
  if (!res.ok || parsed?.ok !== true) throw new Error(parsed?.error || "capability call failed");
  return parsed;
}

async function main() {
  const manifest = await (await fetch(new URL("/manifest.json", capabilityBaseUrl).toString())).json();
  const toolId = String(manifest?.toolId || "capability");
  const devPublicKeyPem = fs.readFileSync(path.join(__dirname, "..", "keys", "dev-public-key.pem"), "utf8");

  const suffix = \`\${Date.now().toString(36)}_\${Math.random().toString(16).slice(2, 8)}\`;
  const payerAgentId = \`agt_demo_payer_\${suffix}\`;
  const payeeAgentId = \`agt_demo_payee_\${suffix}\`;

  // For the demo path, the server will mint keys for both agents.
  // This is not a production identity flow.
  await requestJson("POST", "/agents/register", {
    idempotencyKey: idem("payer_register"),
    body: {
      agentId: payerAgentId,
      displayName: "Starter Payer",
      owner: { ownerType: "service", ownerId: "starter" },
      publicKeyPem: devPublicKeyPem
    }
  });

  // Payee uses the same public key as the manifest signer for simplicity.
  await requestJson("POST", "/agents/register", {
    idempotencyKey: idem("payee_register"),
    body: {
      agentId: payeeAgentId,
      displayName: "Starter Payee",
      owner: { ownerType: "service", ownerId: "starter" },
      capabilities: [toolId],
      publicKeyPem: devPublicKeyPem
    }
  });

  await requestJson("POST", \`/agents/\${encodeURIComponent(payerAgentId)}/wallet/credit\`, {
    idempotencyKey: idem("wallet_credit"),
    body: { amountCents: 25000, currency: "USD" }
  });

  const rfqId = \`rfq_\${toolId}_\${suffix}\`;
  const bidId = \`bid_\${toolId}_\${suffix}\`;

  await requestJson("POST", "/marketplace/rfqs", {
    idempotencyKey: idem("rfq_create"),
    body: {
      rfqId,
      title: \`Starter capability: \${toolId}\`,
      description: "Generated by settld init capability",
      capability: toolId,
      posterAgentId: payerAgentId,
      budgetCents: 10000,
      currency: "USD"
    }
  });

  await requestJson("POST", \`/marketplace/rfqs/\${encodeURIComponent(rfqId)}/bids\`, {
    idempotencyKey: idem("bid_submit"),
    body: {
      bidId,
      bidderAgentId: payeeAgentId,
      amountCents: 10000,
      currency: "USD",
      etaSeconds: 60,
      note: "starter bid"
    }
  });

  const accepted = await requestJson("POST", \`/marketplace/rfqs/\${encodeURIComponent(rfqId)}/accept\`, {
    idempotencyKey: idem("accept"),
    body: {
      bidId,
      payerAgentId,
      acceptedByAgentId: payerAgentId,
      settlement: { payerAgentId }
    }
  });

  const runId = String(accepted?.run?.id || accepted?.run?.runId || accepted?.runId || "");
  if (!runId) throw new Error("accept response missing runId");
  let prev = String(accepted?.run?.lastChainHash || "");
  if (!prev) throw new Error("accept response missing run.lastChainHash");

  const capOut = await callCapability("hello kernel");
  const evidenceRef = \`evidence://capability/\${toolId}/run/\${runId}/output/\${capOut.outputHash}.json\`;

  const ev = await requestJson("POST", \`/agents/\${encodeURIComponent(payeeAgentId)}/runs/\${encodeURIComponent(runId)}/events\`, {
    idempotencyKey: idem("evidence"),
    expectedPrevChainHash: prev,
    body: { type: "EVIDENCE_ADDED", payload: { evidenceRef } }
  });
  prev = String(ev?.run?.lastChainHash || "");
  if (!prev) throw new Error("evidence append missing lastChainHash");

  await requestJson("POST", \`/agents/\${encodeURIComponent(payeeAgentId)}/runs/\${encodeURIComponent(runId)}/events\`, {
    idempotencyKey: idem("completed"),
    expectedPrevChainHash: prev,
    body: {
      type: "RUN_COMPLETED",
      payload: { outputRef: evidenceRef, metrics: { latencyMs: 250 } }
    }
  });

  const settlement = await requestJson("GET", \`/runs/\${encodeURIComponent(runId)}/settlement\`);
  const replay = await requestJson("GET", \`/runs/\${encodeURIComponent(runId)}/settlement/replay-evaluate\`);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ runId, settlement, replay }, null, 2));
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(\`Explorer: \${baseUrl}/ops/kernel/workspace?opsToken=\${encodeURIComponent(opsToken)}&runId=\${encodeURIComponent(runId)}\`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
`;
}

function renderKernelConformanceScript() {
  return `import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 20; i += 1) {
    if (fs.existsSync(path.join(dir, "bin", "settld.js")) && fs.existsSync(path.join(dir, "SETTLD_VERSION"))) return dir;
    const next = path.dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  return null;
}

const repoRoot = process.env.SETTLD_REPO_ROOT || findRepoRoot(process.cwd());
if (!repoRoot) {
  console.error("could not find Settld repo root (set SETTLD_REPO_ROOT)");
  process.exit(1);
}

const baseUrl = process.env.SETTLD_BASE_URL || "http://127.0.0.1:3000";
const tenantId = process.env.SETTLD_TENANT_ID || "tenant_default";
const protocol = process.env.SETTLD_PROTOCOL || "1.0";
const opsToken = process.env.SETTLD_OPS_TOKEN || "tok_ops";

const jsonOut = process.env.SETTLD_KERNEL_REPORT || "/tmp/settld-kernel-v0-report.json";

const args = [
  path.join(repoRoot, "conformance", "kernel-v0", "run.mjs"),
  "--base-url",
  baseUrl,
  "--tenant-id",
  tenantId,
  "--protocol",
  protocol,
  "--ops-token",
  opsToken,
  "--json-out",
  jsonOut
];

const res = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(typeof res.status === "number" ? res.status : 1);
`;
}

function renderGitignore() {
  return `node_modules/
keys/dev-keypair.json
tmp/
.env
`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    process.exit(0);
  }
  if (!opts.name) {
    usage();
    die("missing capability name");
  }

  const name = slugify(opts.name);
  const repoRoot = path.resolve(process.cwd());
  const outDir = path.resolve(repoRoot, opts.outDir && opts.outDir.trim() ? opts.outDir : path.join("examples", "capabilities", name));

  if (await exists(outDir)) {
    if (!opts.force) die(`output dir already exists: ${outDir} (pass --force to overwrite)`);
  }

  const keysDir = path.join(outDir, "keys");
  const schemasDir = path.join(outDir, "schemas");
  const scriptsDir = path.join(outDir, "scripts");

  await mkdirp(outDir);
  await mkdirp(keysDir);
  await mkdirp(schemasDir);
  await mkdirp(scriptsDir);

  const keypair = createEd25519Keypair();
  const signerKeyId = keyIdFromPublicKeyPem(keypair.publicKeyPem);

  const baseUrl = "http://127.0.0.1:3900";
  const toolId = `cap_${name}`;
  const toolVersion = "0.1.0";

  const inputSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: { text: { type: "string", minLength: 0, maxLength: 2000 } },
    required: ["text"]
  };
  const outputSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      upper: { type: "string" },
      length: { type: "integer", minimum: 0 }
    },
    required: ["upper", "length"]
  };

  const { manifest, manifestHash, inputSchema: inputSchemaNormalized, outputSchema: outputSchemaNormalized } = buildToolManifestV1({
    toolId,
    toolVersion,
    endpoints: [
      {
        kind: "http",
        baseUrl,
        callPath: "/call",
        manifestPath: "/manifest.json"
      }
    ],
    inputSchema,
    outputSchema,
    verifierHints: {
      mode: "deterministic",
      note: "dev starter template (not a hard security contract)"
    },
    signerKeyId,
    signerPrivateKeyPem: keypair.privateKeyPem,
    signerPublicKeyPem: keypair.publicKeyPem
  });

  const signatureFile = normalizeForCanonicalJson(
    {
      schemaVersion: "ToolManifestSignature.dev",
      toolId,
      toolVersion,
      manifestHash,
      algorithm: "ed25519",
      signerKeyId,
      signerPublicKeyPem: keypair.publicKeyPem,
      signature: manifest?.signature?.signature ?? null,
      createdAt: manifest.createdAt
    },
    { path: "$" }
  );

  await fs.writeFile(path.join(outDir, "package.json"), JSON.stringify(renderPackageJson({ name }), null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(outDir, ".gitignore"), renderGitignore(), "utf8");
  await fs.writeFile(path.join(outDir, "server.js"), renderServerJs(), "utf8");

  await fs.writeFile(path.join(schemasDir, "input.schema.json"), JSON.stringify(inputSchemaNormalized, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(schemasDir, "output.schema.json"), JSON.stringify(outputSchemaNormalized, null, 2) + "\n", "utf8");

  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(outDir, "manifest.sig.json"), JSON.stringify(signatureFile, null, 2) + "\n", "utf8");

  await fs.writeFile(path.join(keysDir, "dev-public-key.pem"), keypair.publicKeyPem + "\n", "utf8");
  await fs.writeFile(path.join(keysDir, "dev-keypair.json"), JSON.stringify({ schemaVersion: "Ed25519Keypair.dev", keyId: signerKeyId, ...keypair }, null, 2) + "\n", "utf8");

  await fs.writeFile(path.join(scriptsDir, "kernel-prove.mjs"), renderKernelProveScript(), "utf8");
  await fs.writeFile(path.join(scriptsDir, "kernel-conformance.mjs"), renderKernelConformanceScript(), "utf8");

  // eslint-disable-next-line no-console
  console.log(`created capability starter: ${outDir}`);
  // eslint-disable-next-line no-console
  console.log(`toolId=${toolId} toolVersion=${toolVersion}`);
  // eslint-disable-next-line no-console
  console.log(`manifestHash=${manifestHash}`);
  // eslint-disable-next-line no-console
  console.log(`signerKeyId=${signerKeyId}`);
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log("next:");
  // eslint-disable-next-line no-console
  console.log(`  cd ${outDir}`);
  // eslint-disable-next-line no-console
  console.log("  npm run dev");
  // eslint-disable-next-line no-console
  console.log("  npm run kernel:prove");
  // eslint-disable-next-line no-console
  console.log("  npm run kernel:conformance");
}

main().catch((err) => die(err?.message ?? String(err ?? "init failed")));
