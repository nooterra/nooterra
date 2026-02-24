import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

function normalizeNonEmptyString(value) {
  const text = String(value ?? "").trim();
  return text ? text : "";
}

function isCiEnvironment(env = process.env) {
  const raw = String(env?.CI ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function assertLoopbackHttpBaseUrl(rawBaseUrl) {
  let url;
  try {
    url = new URL(String(rawBaseUrl ?? ""));
  } catch {
    throw new Error(`invalid bootstrap base URL: ${String(rawBaseUrl ?? "")}`);
  }
  if (url.protocol !== "http:") {
    throw new Error("--bootstrap-base-url must use http:// for local bootstrap");
  }
  const host = String(url.hostname ?? "").trim().toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("--bootstrap-base-url must target loopback (127.0.0.1/localhost/::1)");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function parsePortFromBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  const portRaw = url.port ? Number(url.port) : 80;
  if (!Number.isSafeInteger(portRaw) || portRaw <= 0 || portRaw > 65535) {
    throw new Error(`invalid port in --bootstrap-base-url: ${url.port || "(default)"}`);
  }
  return portRaw;
}

async function requestJson(url, { method = "GET", headers = {}, body = null } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body === null ? {} : { "content-type": "application/json" }),
      ...headers
    },
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok, statusCode: response.status, text, json };
}

async function isApiHealthy(baseUrl) {
  try {
    const health = await requestJson(new URL("/healthz", baseUrl).toString());
    return health.ok;
  } catch {
    return false;
  }
}

function startLocalApiServer({ baseUrl, opsToken, logger }) {
  const port = parsePortFromBaseUrl(baseUrl);
  const child = spawn(process.execPath, ["src/api/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROXY_BIND_HOST: "127.0.0.1",
      BIND_HOST: "127.0.0.1",
      PORT: String(port),
      PROXY_OPS_TOKEN: opsToken,
      PROXY_OPS_TOKENS: `${opsToken}:ops_read,ops_write,finance_read,finance_write,audit_read`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    const line = String(chunk ?? "").trim();
    if (line) logger(`api stdout: ${line}`);
  });
  child.stderr?.on("data", (chunk) => {
    const line = String(chunk ?? "").trim();
    if (line) logger(`api stderr: ${line}`);
  });

  return child;
}

async function waitForHealthyApi({ baseUrl, child, timeoutMs = 15_000 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child && child.exitCode !== null) {
      throw new Error(`local bootstrap API exited early (exitCode=${child.exitCode})`);
    }
    if (await isApiHealthy(baseUrl)) return;
    await delay(200);
  }
  throw new Error(`local bootstrap API did not become healthy within ${timeoutMs}ms`);
}

async function mintApiKey({ baseUrl, tenantId, opsToken }) {
  const response = await requestJson(new URL("/ops/api-keys", baseUrl).toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${opsToken}`,
      "x-proxy-ops-token": opsToken,
      "x-proxy-tenant-id": tenantId
    },
    body: {
      description: "local bootstrap key for gate scripts",
      scopes: ["ops_read", "ops_write", "finance_read", "finance_write", "audit_read"]
    }
  });

  if (!response.ok) {
    throw new Error(`failed minting local bootstrap API key (HTTP ${response.statusCode}): ${response.text}`);
  }
  const keyId = normalizeNonEmptyString(response.json?.keyId);
  const secret = normalizeNonEmptyString(response.json?.secret);
  if (!keyId || !secret) {
    throw new Error("mint API key response missing keyId/secret");
  }
  return `${keyId}.${secret}`;
}

async function stopChildProcess(child) {
  if (!child || typeof child.kill !== "function") return;
  if (child.exitCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(3000).then(() => false)
  ]);
  if (!exited) {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
}

export async function bootstrapLocalGateEnv(options = {}) {
  const enabled = Boolean(options.enabled);
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const env = options.env ?? process.env;

  if (!enabled) {
    return {
      envPatch: {},
      metadata: { enabled: false },
      cleanup: async () => {}
    };
  }

  if (isCiEnvironment(env)) {
    throw new Error("--bootstrap-local is disabled in CI; provide explicit SETTLD_* env for fail-closed reproducibility");
  }

  const baseUrl = assertLoopbackHttpBaseUrl(options.baseUrl ?? env.SETTLD_BASE_URL ?? "http://127.0.0.1:3000");
  const tenantId = normalizeNonEmptyString(options.tenantId ?? env.SETTLD_TENANT_ID ?? "tenant_default");
  const opsToken = normalizeNonEmptyString(options.opsToken ?? env.PROXY_OPS_TOKEN ?? "tok_ops");
  const existingApiKey = normalizeNonEmptyString(options.apiKey ?? env.SETTLD_API_KEY ?? "");

  if (!tenantId) throw new Error("--bootstrap-tenant-id must be non-empty");
  if (!opsToken) throw new Error("--bootstrap-ops-token must be non-empty");

  let child = null;
  let startedLocalApi = false;
  if (!(await isApiHealthy(baseUrl))) {
    logger(`starting local API at ${baseUrl}`);
    child = startLocalApiServer({ baseUrl, opsToken, logger });
    startedLocalApi = true;
    await waitForHealthyApi({ baseUrl, child });
  }

  const apiKey = existingApiKey || (await mintApiKey({ baseUrl, tenantId, opsToken }));
  if (!existingApiKey) logger("minted temporary SETTLD_API_KEY");

  const envPatch = {
    SETTLD_BASE_URL: baseUrl,
    SETTLD_TENANT_ID: tenantId,
    SETTLD_API_KEY: apiKey
  };

  return {
    envPatch,
    metadata: {
      enabled: true,
      baseUrl,
      tenantId,
      startedLocalApi,
      usedExistingApiKey: Boolean(existingApiKey)
    },
    cleanup: async () => {
      await stopChildProcess(child);
    }
  };
}
