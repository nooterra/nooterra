import fs from "node:fs";
import path from "node:path";

export function usage() {
  return [
    "Usage:",
    "  create-settld-paid-tool [directory] [--force] [--provider-id <id>] [--from-http <baseUrl>] [--from-openapi <specPath>]",
    "",
    "Options:",
    "  --force               Allow scaffolding into an existing non-empty directory",
    "  --provider-id <id>    Provider id used in the generated template (default: prov_paid_tool_demo)",
    "  --from-http <url>     Generate an HTTP->MCP bridge scaffold for an existing upstream base URL",
    "  --from-openapi <path> Generate HTTP->MCP bridge scaffold from a local OpenAPI JSON file",
    "  --help                Show this help"
  ].join("\n");
}

export function parseArgs(argv) {
  const out = {
    directory: null,
    force: false,
    providerId: "prov_paid_tool_demo",
    fromHttp: null,
    fromOpenApi: null,
    help: false
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--force") {
      out.force = true;
      continue;
    }
    if (arg === "--provider-id") {
      const value = String(argv[i + 1] ?? "").trim();
      if (!value) throw new Error("--provider-id requires a value");
      out.providerId = value;
      i += 1;
      continue;
    }
    if (arg === "--from-http") {
      const value = String(argv[i + 1] ?? "").trim();
      if (!value) throw new Error("--from-http requires a value");
      out.fromHttp = value;
      i += 1;
      continue;
    }
    if (arg === "--from-openapi") {
      const value = String(argv[i + 1] ?? "").trim();
      if (!value) throw new Error("--from-openapi requires a value");
      out.fromOpenApi = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    positional.push(arg);
  }
  if (positional.length > 1) throw new Error("only one target directory may be provided");
  out.directory = positional[0] ?? "settld-paid-tool";
  if (out.fromHttp && out.fromOpenApi) {
    throw new Error("--from-http and --from-openapi are mutually exclusive");
  }
  return out;
}

function ensureScaffoldTarget(targetDir, { force }) {
  const exists = fs.existsSync(targetDir);
  if (!exists) {
    fs.mkdirSync(targetDir, { recursive: true });
    return;
  }
  const stat = fs.statSync(targetDir);
  if (!stat.isDirectory()) throw new Error(`target path exists and is not a directory: ${targetDir}`);
  const entries = fs.readdirSync(targetDir);
  if (entries.length > 0 && !force) {
    throw new Error(`target directory is not empty: ${targetDir} (pass --force to continue)`);
  }
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content.replace(/\s+$/u, "")}\n`, "utf8");
}

function sanitizeIdSegment(text, { maxLen = 96 } = {}) {
  const raw = String(text ?? "").trim();
  const safe = raw.replaceAll(/[^A-Za-z0-9:_-]/g, "_").slice(0, maxLen);
  return safe || "tool";
}

function toToolIdFromMethodPath(method, routePath) {
  return sanitizeIdSegment(`${String(method ?? "GET").toLowerCase()}_${String(routePath ?? "/").replaceAll("/", "_")}`, { maxLen: 80 });
}

function buildDefaultBridgeManifest({ providerId, upstreamBaseUrl }) {
  return {
    schemaVersion: "PaidToolManifest.v1",
    providerId,
    upstreamBaseUrl,
    defaults: {
      currency: "USD",
      amountCents: 500,
      idempotency: "idempotent",
      signatureMode: "required"
    },
    tools: [
      {
        toolId: "get_root",
        mcpToolName: "bridge.get_root",
        description: "GET / from upstream service",
        method: "GET",
        upstreamPath: "/",
        paidPath: "/tool/get_root",
        pricing: { amountCents: 500, currency: "USD" },
        auth: { mode: "none" }
      }
    ]
  };
}

function buildBridgeManifestFromOpenApi({ providerId, upstreamBaseUrl, openApiSpecPath, cwd }) {
  const resolvedSpecPath = path.resolve(cwd, openApiSpecPath);
  if (!fs.existsSync(resolvedSpecPath)) {
    throw new Error(`OpenAPI spec not found: ${resolvedSpecPath}`);
  }
  const raw = fs.readFileSync(resolvedSpecPath, "utf8");
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`OpenAPI spec must be valid JSON: ${err?.message ?? String(err ?? "")}`);
  }
  const paths = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed.paths : null;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
    throw new Error("OpenAPI JSON must contain an object 'paths'");
  }

  const tools = [];
  const httpMethods = ["get", "post", "put", "patch", "delete"];
  for (const [routePath, routeValue] of Object.entries(paths)) {
    if (!routeValue || typeof routeValue !== "object" || Array.isArray(routeValue)) continue;
    for (const methodLower of httpMethods) {
      const op = routeValue[methodLower];
      if (!op || typeof op !== "object" || Array.isArray(op)) continue;
      const method = methodLower.toUpperCase();
      const operationIdRaw = typeof op.operationId === "string" && op.operationId.trim() !== "" ? op.operationId.trim() : null;
      const toolId = operationIdRaw ? sanitizeIdSegment(operationIdRaw, { maxLen: 80 }) : toToolIdFromMethodPath(method, routePath);
      const mcpToolName = `bridge.${toolId}`;
      const description =
        typeof op.summary === "string" && op.summary.trim() !== ""
          ? op.summary.trim()
          : typeof op.description === "string" && op.description.trim() !== ""
            ? op.description.trim().split(/\r?\n/u)[0]
            : `${method} ${routePath}`;
      tools.push({
        toolId,
        mcpToolName,
        description,
        method,
        upstreamPath: routePath,
        paidPath: `/tool/${toolId}`,
        pricing: { amountCents: 500, currency: "USD" },
        auth: { mode: "none" }
      });
      if (tools.length >= 24) break;
    }
    if (tools.length >= 24) break;
  }

  return {
    schemaVersion: "PaidToolManifest.v1",
    providerId,
    upstreamBaseUrl,
    sourceOpenApiPath: openApiSpecPath,
    defaults: {
      currency: "USD",
      amountCents: 500,
      idempotency: "idempotent",
      signatureMode: "required"
    },
    tools: tools.length > 0 ? tools : buildDefaultBridgeManifest({ providerId, upstreamBaseUrl }).tools
  };
}

function buildTemplate({ providerId }) {
  const packageJson = {
    name: "settld-paid-tool",
    version: "0.0.0",
    private: true,
    type: "module",
    engines: {
      node: ">=20"
    },
    scripts: {
      start: "node server.mjs"
    },
    dependencies: {
      "@settld/provider-kit": "latest"
    }
  };

  const envExample = [
    "PORT=9402",
    `SETTLD_PROVIDER_ID=${providerId}`,
    "SETTLD_PRICE_AMOUNT_CENTS=500",
    "SETTLD_PRICE_CURRENCY=USD",
    "SETTLD_PAYMENT_ADDRESS=mock:payee",
    "SETTLD_PAYMENT_NETWORK=mocknet",
    "SETTLD_PAY_KEYSET_URL=http://127.0.0.1:3000/.well-known/settld-keys.json",
    "PROVIDER_PUBLIC_KEY_PEM_FILE=./provider-public.pem",
    "PROVIDER_PRIVATE_KEY_PEM_FILE=./provider-private.pem",
    "",
    "# Optional inline alternatives:",
    "# PROVIDER_PUBLIC_KEY_PEM='-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----'",
    "# PROVIDER_PRIVATE_KEY_PEM='-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----'"
  ].join("\n");

  const server = `import fs from "node:fs";
import http from "node:http";

import { createSettldPaidNodeHttpHandler } from "@settld/provider-kit";

function readPem({ inlineName, fileName }) {
  const inlineRaw = process.env[inlineName];
  if (typeof inlineRaw === "string" && inlineRaw.trim() !== "") {
    return inlineRaw.replaceAll("\\\\n", "\\n");
  }
  const fileRaw = process.env[fileName];
  if (typeof fileRaw === "string" && fileRaw.trim() !== "") {
    return fs.readFileSync(fileRaw.trim(), "utf8");
  }
  throw new Error(\`Missing \${inlineName} or \${fileName}\`);
}

const PORT = Number(process.env.PORT ?? 9402);
if (!Number.isSafeInteger(PORT) || PORT <= 0) throw new Error("PORT must be a positive integer");

const providerId = typeof process.env.SETTLD_PROVIDER_ID === "string" && process.env.SETTLD_PROVIDER_ID.trim() !== ""
  ? process.env.SETTLD_PROVIDER_ID.trim()
  : "${providerId}";
const amountCents = Number(process.env.SETTLD_PRICE_AMOUNT_CENTS ?? 500);
if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("SETTLD_PRICE_AMOUNT_CENTS must be positive");
const currency = typeof process.env.SETTLD_PRICE_CURRENCY === "string" && process.env.SETTLD_PRICE_CURRENCY.trim() !== ""
  ? process.env.SETTLD_PRICE_CURRENCY.trim().toUpperCase()
  : "USD";

const providerPublicKeyPem = readPem({ inlineName: "PROVIDER_PUBLIC_KEY_PEM", fileName: "PROVIDER_PUBLIC_KEY_PEM_FILE" });
const providerPrivateKeyPem = readPem({ inlineName: "PROVIDER_PRIVATE_KEY_PEM", fileName: "PROVIDER_PRIVATE_KEY_PEM_FILE" });

const paidHandler = createSettldPaidNodeHttpHandler({
  providerId,
  providerPublicKeyPem,
  providerPrivateKeyPem,
  paymentAddress: process.env.SETTLD_PAYMENT_ADDRESS ?? "mock:payee",
  paymentNetwork: process.env.SETTLD_PAYMENT_NETWORK ?? "mocknet",
  priceFor: ({ req, url }) => ({
    amountCents,
    currency,
    providerId,
    toolId: \`\${String(req.method ?? "GET").toUpperCase()}:\${String(url.pathname ?? "/")}\`
  }),
  settldPay: {
    keysetUrl: process.env.SETTLD_PAY_KEYSET_URL ?? "http://127.0.0.1:3000/.well-known/settld-keys.json"
  },
  execute: async ({ url }) => ({
    body: {
      ok: true,
      providerId,
      query: url.searchParams.get("q") ?? "",
      timestamp: new Date().toISOString()
    }
  })
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/tool/search") {
    paidHandler(req, res).catch((err) => {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "provider_error", message: err?.message ?? String(err ?? "") }));
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error: "not_found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({ ok: true, service: "settld-paid-tool", port: PORT, providerId }));
});
`;

  const readme = `# Settld Paid Tool Template

This project was generated by \`create-settld-paid-tool\`.

## Run

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`
2. Configure environment:
   \`\`\`bash
   cp .env.example .env
   # set PROVIDER_PUBLIC_KEY_PEM_FILE / PROVIDER_PRIVATE_KEY_PEM_FILE
   \`\`\`
3. Start server:
   \`\`\`bash
   npm start
   \`\`\`

## Behavior

- \`GET /tool/search?q=...\` returns \`402\` until a valid \`Authorization: SettldPay <token>\` is provided.
- On paid requests, the server verifies SettldPay offline and returns provider signature headers:
  - \`x-settld-provider-key-id\`
  - \`x-settld-provider-signature\`
  - \`x-settld-provider-response-sha256\`

## Provider Id

Generated with provider id: \`${providerId}\`.

## Note

If \`@settld/provider-kit\` is not yet published to npm, replace it with your internal tarball or git source.
`;

  return {
    "package.json": JSON.stringify(packageJson, null, 2),
    ".env.example": envExample,
    "server.mjs": server,
    "README.md": readme
  };
}

function buildBridgeTemplate({ providerId, upstreamBaseUrl, manifest }) {
  const packageJson = {
    name: "settld-paid-tool-bridge",
    version: "0.0.0",
    private: true,
    type: "module",
    engines: {
      node: ">=20"
    },
    scripts: {
      start: "node server.mjs",
      "mcp:bridge": "node mcp-bridge.mjs"
    },
    dependencies: {
      "@settld/provider-kit": "latest",
      "settld-api-sdk": "latest"
    }
  };

  const envExample = [
    "PORT=9402",
    "MCP_BRIDGE_STDIO=1",
    `SETTLD_PROVIDER_ID=${providerId}`,
    `UPSTREAM_BASE_URL=${upstreamBaseUrl}`,
    "PAID_TOOL_MANIFEST_FILE=./paid-tool-manifest.json",
    "SETTLD_PRICE_AMOUNT_CENTS=500",
    "SETTLD_PRICE_CURRENCY=USD",
    "SETTLD_PAYMENT_ADDRESS=mock:payee",
    "SETTLD_PAYMENT_NETWORK=mocknet",
    "SETTLD_PAY_KEYSET_URL=http://127.0.0.1:3000/.well-known/settld-keys.json",
    "SETTLD_PAID_TOOLS_BASE_URL=http://127.0.0.1:8402",
    "SETTLD_TENANT_ID=tenant_default",
    "PROVIDER_PUBLIC_KEY_PEM_FILE=./provider-public.pem",
    "PROVIDER_PRIVATE_KEY_PEM_FILE=./provider-private.pem",
    "",
    "# Optional auth for upstream calls made by server.mjs",
    "# UPSTREAM_BEARER_TOKEN=...",
    "",
    "# Optional inline alternatives:",
    "# PROVIDER_PUBLIC_KEY_PEM='-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----'",
    "# PROVIDER_PRIVATE_KEY_PEM='-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----'"
  ].join("\n");

  const server = `import fs from "node:fs";
import http from "node:http";

import { createSettldPaidNodeHttpHandler } from "@settld/provider-kit";

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function readPem({ inlineName, fileName }) {
  const inlineRaw = process.env[inlineName];
  if (typeof inlineRaw === "string" && inlineRaw.trim() !== "") return inlineRaw.replaceAll("\\\\n", "\\n");
  const fileRaw = process.env[fileName];
  if (typeof fileRaw === "string" && fileRaw.trim() !== "") return fs.readFileSync(fileRaw.trim(), "utf8");
  throw new Error(\`Missing \${inlineName} or \${fileName}\`);
}

async function readRequestText(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const PORT = Number(process.env.PORT ?? 9402);
if (!Number.isSafeInteger(PORT) || PORT <= 0) throw new Error("PORT must be a positive integer");

const manifestPath = process.env.PAID_TOOL_MANIFEST_FILE ?? "./paid-tool-manifest.json";
const manifest = readJson(manifestPath);
const tools = Array.isArray(manifest?.tools) ? manifest.tools : [];
if (tools.length === 0) throw new Error("manifest must include at least one tool");

const providerId = String(process.env.SETTLD_PROVIDER_ID ?? manifest?.providerId ?? "${providerId}").trim();
if (!providerId) throw new Error("SETTLD_PROVIDER_ID is required");
const upstreamBaseUrl = String(process.env.UPSTREAM_BASE_URL ?? manifest?.upstreamBaseUrl ?? "${upstreamBaseUrl}").trim();
if (!upstreamBaseUrl) throw new Error("UPSTREAM_BASE_URL is required");
const upstreamBase = new URL(upstreamBaseUrl);

const toolByPaidPath = new Map();
for (const tool of tools) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) continue;
  const paidPath = typeof tool.paidPath === "string" && tool.paidPath.trim() !== "" ? tool.paidPath.trim() : null;
  if (!paidPath) continue;
  toolByPaidPath.set(paidPath, tool);
}
if (toolByPaidPath.size === 0) throw new Error("manifest tools missing paidPath entries");

const providerPublicKeyPem = readPem({ inlineName: "PROVIDER_PUBLIC_KEY_PEM", fileName: "PROVIDER_PUBLIC_KEY_PEM_FILE" });
const providerPrivateKeyPem = readPem({ inlineName: "PROVIDER_PRIVATE_KEY_PEM", fileName: "PROVIDER_PRIVATE_KEY_PEM_FILE" });

const paidHandler = createSettldPaidNodeHttpHandler({
  providerId,
  providerPublicKeyPem,
  providerPrivateKeyPem,
  paymentAddress: process.env.SETTLD_PAYMENT_ADDRESS ?? "mock:payee",
  paymentNetwork: process.env.SETTLD_PAYMENT_NETWORK ?? "mocknet",
  priceFor: ({ url }) => {
    const tool = toolByPaidPath.get(url.pathname);
    if (!tool) return { amountCents: 500, currency: "USD", providerId, toolId: \`unknown:\${url.pathname}\` };
    const pricing = tool.pricing && typeof tool.pricing === "object" ? tool.pricing : {};
    const amountCents = Number.isSafeInteger(Number(pricing.amountCents)) ? Number(pricing.amountCents) : Number(process.env.SETTLD_PRICE_AMOUNT_CENTS ?? 500);
    const currency =
      typeof pricing.currency === "string" && pricing.currency.trim() !== ""
        ? pricing.currency.trim().toUpperCase()
        : String(process.env.SETTLD_PRICE_CURRENCY ?? "USD").trim().toUpperCase();
    return {
      amountCents,
      currency,
      providerId,
      toolId: typeof tool.toolId === "string" && tool.toolId.trim() !== "" ? tool.toolId.trim() : url.pathname
    };
  },
  settldPay: {
    keysetUrl: process.env.SETTLD_PAY_KEYSET_URL ?? "http://127.0.0.1:3000/.well-known/settld-keys.json"
  },
  execute: async ({ req, url }) => {
    const tool = toolByPaidPath.get(url.pathname);
    if (!tool) {
      return {
        statusCode: 404,
        body: { ok: false, error: "tool_not_found", paidPath: url.pathname }
      };
    }

    const upstream = new URL(typeof tool.upstreamPath === "string" ? tool.upstreamPath : "/", upstreamBase);
    for (const [k, v] of url.searchParams.entries()) upstream.searchParams.set(k, v);

    const method = String(tool.method ?? req.method ?? "GET").toUpperCase();
    const headers = { accept: "application/json" };
    if (process.env.UPSTREAM_BEARER_TOKEN) {
      headers.authorization = \`Bearer \${process.env.UPSTREAM_BEARER_TOKEN}\`;
    }

    const bodyText = method === "GET" || method === "HEAD" ? "" : await readRequestText(req);
    if (bodyText && (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")) {
      headers["content-type"] = "application/json";
    }

    const upstreamRes = await fetch(upstream, {
      method,
      headers,
      body: bodyText || undefined
    });
    const upstreamText = await upstreamRes.text();
    let upstreamJson = null;
    try {
      upstreamJson = upstreamText ? JSON.parse(upstreamText) : null;
    } catch {
      upstreamJson = null;
    }
    return {
      statusCode: upstreamRes.status,
      body: {
        ok: upstreamRes.ok,
        toolId: tool.toolId ?? null,
        upstreamStatus: upstreamRes.status,
        upstream: upstream.toString(),
        response: upstreamJson ?? upstreamText
      }
    };
  }
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, providerId, tools: toolByPaidPath.size }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/manifest") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(manifest));
    return;
  }
  if (!toolByPaidPath.has(url.pathname)) {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
    return;
  }
  paidHandler(req, res).catch((err) => {
    const statusCode = Number.isSafeInteger(Number(err?.statusCode)) ? Number(err.statusCode) : 500;
    res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "provider_error", message: err?.message ?? String(err ?? "") }));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({ ok: true, service: "settld-paid-tool-bridge", port: PORT, providerId, tools: toolByPaidPath.size }));
});
`;

  const mcpBridge = `import fs from "node:fs";
import process from "node:process";

import { fetchWithSettldAutopay } from "settld-api-sdk";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function contentText(text) {
  return { type: "text", text: String(text ?? "") };
}

const manifestPath = process.env.PAID_TOOL_MANIFEST_FILE ?? "./paid-tool-manifest.json";
const paidToolsBaseUrl = process.env.SETTLD_PAID_TOOLS_BASE_URL ?? "http://127.0.0.1:8402";
const tenantId = process.env.SETTLD_TENANT_ID ?? "tenant_default";
const manifest = readJson(manifestPath);
const toolsConfig = Array.isArray(manifest?.tools) ? manifest.tools : [];
const tools = toolsConfig.map((tool) => ({
  name: typeof tool.mcpToolName === "string" && tool.mcpToolName.trim() !== "" ? tool.mcpToolName.trim() : \`bridge.\${tool.toolId}\`,
  description: typeof tool.description === "string" && tool.description.trim() !== "" ? tool.description.trim() : String(tool.toolId ?? "paid tool"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] }, default: {} },
      body: { type: ["object", "null"], default: null }
    }
  }
}));
const toolByName = new Map(tools.map((tool, idx) => [tool.name, toolsConfig[idx]]));

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

async function callTool(toolConfig, args) {
  const paidPath = String(toolConfig.paidPath ?? "/");
  const url = new URL(paidPath, paidToolsBaseUrl);
  const query = args?.query && typeof args.query === "object" && !Array.isArray(args.query) ? args.query : {};
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  const method = String(toolConfig.method ?? "GET").toUpperCase();
  const init = {
    method,
    headers: { "x-proxy-tenant-id": tenantId }
  };
  if (args?.body && (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(args.body);
  }
  const res = await fetchWithSettldAutopay(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    return {
      isError: true,
      content: [contentText(JSON.stringify({ ok: false, statusCode: res.status, body: json ?? text }, null, 2))]
    };
  }
  return {
    content: [contentText(JSON.stringify({ ok: true, statusCode: res.status, body: json ?? text }, null, 2))]
  };
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  for (;;) {
    const idx = buffer.indexOf("\\n");
    if (idx === -1) break;
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg = null;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const id = msg?.id;
    const method = msg?.method;
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "settld-paid-tool-bridge", version: "0.0.0" },
          capabilities: { tools: {} }
        }
      });
      continue;
    }
    if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
      continue;
    }
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools } });
      continue;
    }
    if (method === "tools/call") {
      const name = typeof msg?.params?.name === "string" ? msg.params.name : "";
      const toolConfig = toolByName.get(name);
      if (!toolConfig) {
        send({ jsonrpc: "2.0", id, result: { isError: true, content: [contentText(\`unknown tool: \${name}\`)] } });
        continue;
      }
      try {
        const result = await callTool(toolConfig, msg?.params?.arguments ?? {});
        send({ jsonrpc: "2.0", id, result });
      } catch (err) {
        send({
          jsonrpc: "2.0",
          id,
          result: { isError: true, content: [contentText(err?.message ?? String(err ?? ""))] }
        });
      }
      continue;
    }
    if (id !== undefined && id !== null) {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: \`method not found: \${String(method ?? "")}\` } });
    }
  }
});
`;

  const readme = `# Settld Paid Tool Bridge Template

This template was generated from an upstream API and includes:

- A paid HTTP bridge server (\`server.mjs\`) using \`@settld/provider-kit\`
- A manifest-driven MCP bridge (\`mcp-bridge.mjs\`)
- A declarative pricing/tool manifest (\`paid-tool-manifest.json\`)

## Quick Start

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`
2. Configure runtime:
   \`\`\`bash
   cp .env.example .env
   \`\`\`
3. Start the paid HTTP bridge:
   \`\`\`bash
   npm start
   \`\`\`
4. Start MCP bridge (stdio):
   \`\`\`bash
   npm run mcp:bridge
   \`\`\`

## Manifest-first pricing/policy

Edit \`paid-tool-manifest.json\` to declare:

- \`toolId\`, \`mcpToolName\`, \`method\`, \`upstreamPath\`, \`paidPath\`
- flat-call pricing (\`amountCents\`, \`currency\`)
- auth mode hints and idempotency assumptions

## Notes

- This scaffold provides a safe default and deterministic local workflow.
- For non-idempotent side-effect APIs, require request-bound tokens and stricter idempotency keys before production.
`;

  return {
    "package.json": JSON.stringify(packageJson, null, 2),
    ".env.example": envExample,
    "paid-tool-manifest.json": JSON.stringify(manifest, null, 2),
    "server.mjs": server,
    "mcp-bridge.mjs": mcpBridge,
    "README.md": readme
  };
}

export function scaffoldCreateSettldPaidTool({
  directory,
  force = false,
  providerId = "prov_paid_tool_demo",
  fromHttp = null,
  fromOpenApi = null,
  cwd = process.cwd()
} = {}) {
  if (fromHttp && fromOpenApi) throw new Error("fromHttp and fromOpenApi are mutually exclusive");
  const targetDir = path.resolve(cwd, directory);
  ensureScaffoldTarget(targetDir, { force });
  let files = null;
  let mode = "default";
  if (fromHttp || fromOpenApi) {
    mode = fromOpenApi ? "bridge_openapi" : "bridge_http";
    const upstreamBaseUrl = String(fromHttp ?? process.env.UPSTREAM_BASE_URL ?? "http://127.0.0.1:8080").trim();
    const manifest = fromOpenApi
      ? buildBridgeManifestFromOpenApi({
          providerId,
          upstreamBaseUrl,
          openApiSpecPath: fromOpenApi,
          cwd
        })
      : buildDefaultBridgeManifest({ providerId, upstreamBaseUrl });
    files = buildBridgeTemplate({ providerId, upstreamBaseUrl, manifest });
  } else {
    files = buildTemplate({ providerId });
  }
  for (const [relativePath, content] of Object.entries(files)) {
    writeText(path.join(targetDir, relativePath), content);
  }
  return {
    targetDir,
    providerId,
    mode,
    filesWritten: Object.keys(files).length,
    fromHttp: fromHttp ?? null,
    fromOpenApi: fromOpenApi ?? null
  };
}

export function runCreateSettldPaidToolCli({ argv = process.argv.slice(2), cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err && typeof err === "object") err.showUsage = true;
    throw err;
  }
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return { ok: true, help: true };
  }

  const result = scaffoldCreateSettldPaidTool({
    directory: args.directory,
    force: args.force,
    providerId: args.providerId,
    fromHttp: args.fromHttp,
    fromOpenApi: args.fromOpenApi,
    cwd
  });

  stdout.write(`created=${result.targetDir}\n`);
  stdout.write(`providerId=${result.providerId}\n`);
  stdout.write(`mode=${result.mode}\n`);
  stdout.write("next_steps:\n");
  stdout.write(`  cd ${result.targetDir}\n`);
  stdout.write("  npm install\n");
  stdout.write("  cp .env.example .env\n");
  stdout.write("  npm start\n");
  return { ok: true, ...result };
}
