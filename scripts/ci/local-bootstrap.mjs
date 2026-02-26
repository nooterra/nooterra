import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";

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
  const allowBootstrapLocalInCi =
    String(env.NOOTERRA_CI_ALLOW_BOOTSTRAP_LOCAL ?? "").trim() === "1" ||
    String(env.NOOTERRA_CI_ALLOW_BOOTSTRAP_LOCAL ?? "").trim().toLowerCase() === "true";

  if (!enabled) {
    return {
      envPatch: {},
      metadata: { enabled: false },
      cleanup: async () => {}
    };
  }

  if (isCiEnvironment(env) && !allowBootstrapLocalInCi) {
    throw new Error(
      "--bootstrap-local is disabled in CI by default; set NOOTERRA_CI_ALLOW_BOOTSTRAP_LOCAL=1 to opt in, or provide explicit NOOTERRA_* env"
    );
  }

  const baseUrl = assertLoopbackHttpBaseUrl(options.baseUrl ?? env.NOOTERRA_BASE_URL ?? "http://127.0.0.1:3000");
  const tenantId = normalizeNonEmptyString(options.tenantId ?? env.NOOTERRA_TENANT_ID ?? "tenant_default");
  const opsToken = normalizeNonEmptyString(options.opsToken ?? env.PROXY_OPS_TOKEN ?? "tok_ops");
  const existingApiKey = normalizeNonEmptyString(options.apiKey ?? env.NOOTERRA_API_KEY ?? "");

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
  if (!existingApiKey) logger("minted temporary NOOTERRA_API_KEY");

  const envPatch = {
    NOOTERRA_BASE_URL: baseUrl,
    NOOTERRA_TENANT_ID: tenantId,
    NOOTERRA_API_KEY: apiKey
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

function commandSucceeded(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return result.status === 0;
}

function runCommand(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${stderr || "unknown error"}`);
  }
  return String(result.stdout ?? "").trim();
}

async function reserveLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        server.close(() => reject(new Error("failed to reserve local port")));
        return;
      }
      const port = Number(address.port);
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function waitForPostgresContainerReady({ containerName, timeoutMs = 60_000 }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (
      commandSucceeded("docker", ["exec", containerName, "pg_isready", "-U", "postgres", "-d", "postgres"])
    ) {
      return;
    }
    await delay(500);
  }
  throw new Error(`postgres bootstrap container did not become ready within ${timeoutMs}ms`);
}

export async function bootstrapLocalPgEnv(options = {}) {
  const enabled = Boolean(options.enabled);
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const env = options.env ?? process.env;
  const existingDatabaseUrl = normalizeNonEmptyString(options.databaseUrl ?? env.DATABASE_URL ?? "");

  if (!enabled) {
    return {
      envPatch: {},
      metadata: { enabled: false },
      cleanup: async () => {}
    };
  }

  if (existingDatabaseUrl) {
    return {
      envPatch: { DATABASE_URL: existingDatabaseUrl },
      metadata: {
        enabled: true,
        usedExistingDatabaseUrl: true
      },
      cleanup: async () => {}
    };
  }

  if (isCiEnvironment(env)) {
    throw new Error("PG bootstrap requires DATABASE_URL in CI; local docker bootstrap is disabled in CI");
  }

  if (!commandSucceeded("docker", ["version"])) {
    throw new Error("docker is required for PG bootstrap when DATABASE_URL is not provided");
  }

  const port = await reserveLocalPort();
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  const containerName = `nooterra_pg_bootstrap_${suffix}`.toLowerCase();
  let startedContainer = false;

  try {
    logger(`starting postgres bootstrap container ${containerName} on 127.0.0.1:${port}`);
    runCommand("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-e",
      "POSTGRES_PASSWORD=test",
      "-e",
      "POSTGRES_DB=postgres",
      "-p",
      `${port}:5432`,
      "postgres:15"
    ]);
    startedContainer = true;
    await waitForPostgresContainerReady({ containerName });
    const databaseUrl = `postgres://postgres:test@127.0.0.1:${port}/postgres`;
    return {
      envPatch: { DATABASE_URL: databaseUrl },
      metadata: {
        enabled: true,
        usedExistingDatabaseUrl: false,
        startedLocalPostgres: true,
        postgresContainerName: containerName,
        postgresPort: port
      },
      cleanup: async () => {
        if (!startedContainer) return;
        spawnSync("docker", ["stop", containerName], {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        });
      }
    };
  } catch (err) {
    if (startedContainer) {
      spawnSync("docker", ["stop", containerName], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    }
    throw err;
  }
}
