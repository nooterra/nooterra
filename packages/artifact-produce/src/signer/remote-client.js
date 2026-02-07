import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";

function assertNonEmptyString(v, name) {
  if (typeof v !== "string" || v.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function isBase64(s) {
  if (typeof s !== "string" || !s.trim()) return false;
  return /^[A-Za-z0-9+/=]+$/.test(s);
}

function clampToUtf8Bytes(str, maxBytes, label) {
  const b = Buffer.from(String(str), "utf8");
  if (b.byteLength > maxBytes) {
    const err = new Error(`${label} exceeds max size`);
    err.code = "REMOTE_SIGNER_RESPONSE_TOO_LARGE";
    err.maxBytes = maxBytes;
    err.actualBytes = b.byteLength;
    throw err;
  }
  return b;
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function requestIdFor({ keyId, purpose, messageBytes }) {
  const messageHashHex = sha256Hex(messageBytes);
  return crypto.createHash("sha256").update(`${keyId}|${purpose}|${messageHashHex}`, "utf8").digest("hex").slice(0, 32);
}

async function runProcessJson({ command, args, inputJson, timeoutMs, state }) {
  assertNonEmptyString(command, "command");
  if (!Array.isArray(args)) throw new TypeError("args must be an array");
  const input = JSON.stringify(inputJson ?? {});

  async function runOnce({ useArgRequest }) {
    const reqArgs = useArgRequest
      ? [...args, "--request-json-base64", Buffer.from(input, "utf8").toString("base64")]
      : args;

    let proc;
    try {
      proc = spawn(command, reqArgs, { stdio: [useArgRequest ? "ignore" : "pipe", "pipe", "pipe"] });
    } catch (e) {
      const err = new Error("signer command failed to start");
      err.code = "SIGNER_COMMAND_SPAWN_FAILED";
      err.detail = e?.message ?? String(e);
      throw err;
    }
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const MAX_STDOUT_BYTES = 512 * 1024;
    const MAX_STDERR_BYTES = 512 * 1024;

    proc.stdout.on("data", (d) => {
      stdoutBytes += d.length;
      if (stdoutBytes <= MAX_STDOUT_BYTES) stdout.push(d);
    });
    proc.stderr.on("data", (d) => {
      stderrBytes += d.length;
      if (stderrBytes <= MAX_STDERR_BYTES) stderr.push(d);
    });

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);

    if (!useArgRequest) proc.stdin.end(input);

    let spawnErr = null;
    const exitCode = await new Promise((resolve, reject) => {
      proc.on("error", (e) => {
        spawnErr = e;
        reject(e);
      });
      proc.on("close", (code) => resolve(code ?? 1));
    })
      .catch(() => 1)
      .finally(() => clearTimeout(timeout));

    if (spawnErr) {
      const err = new Error("signer command failed to start");
      err.code = "SIGNER_COMMAND_SPAWN_FAILED";
      err.detail = spawnErr?.message ?? String(spawnErr);
      throw err;
    }

    if (timedOut) {
      const err = new Error("signer command timed out");
      err.code = "SIGNER_COMMAND_TIMEOUT";
      throw err;
    }

    const outText = Buffer.concat(stdout).toString("utf8");
    const errText = Buffer.concat(stderr).toString("utf8");

    if (exitCode !== 0) {
      const err = new Error("signer command failed");
      err.code = "SIGNER_COMMAND_FAILED";
      err.exitCode = exitCode;
      err.stderr = errText.trim();
      err.stdout = outText.trim();
      throw err;
    }

    try {
      return JSON.parse(outText || "null");
    } catch (e) {
      const err = new Error("signer command returned invalid JSON");
      err.code = "SIGNER_COMMAND_BAD_JSON";
      err.detail = e?.message ?? String(e);
      err.stdout = outText;
      err.stderr = errText;
      throw err;
    }
  }

  const mode = state?.processInputMode ?? "unknown";
  if (mode === "argv") return runOnce({ useArgRequest: true });
  if (mode === "stdin") return runOnce({ useArgRequest: false });

  try {
    const out = await runOnce({ useArgRequest: false });
    if (state) state.processInputMode = "stdin";
    return out;
  } catch (e) {
    // Some CI sandboxes disable stdin pipes for child processes; fall back to argv-based requests.
    if (e?.code === "SIGNER_COMMAND_FAILED" && String(e?.stderr ?? "").includes("unknown op") && !String(e?.stdout ?? "").trim()) {
      if (state) state.processInputMode = "argv";
      return runOnce({ useArgRequest: true });
    }
    throw e;
  }
}

async function fetchJsonWithTimeout(url, { method, headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const maxResponseBytes = 512 * 1024;
    let text = "";
    if (!res.body) {
      text = await res.text();
      clampToUtf8Bytes(text, maxResponseBytes, "remote signer response");
    } else {
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxResponseBytes) {
          const err = new Error("remote signer response exceeds max size");
          err.code = "REMOTE_SIGNER_RESPONSE_TOO_LARGE";
          err.maxBytes = maxResponseBytes;
          err.actualBytes = total;
          throw err;
        }
        chunks.push(Buffer.from(value));
      }
      text = Buffer.concat(chunks).toString("utf8");
    }
    if (!res.ok) {
      const err = new Error(`remote signer request failed (HTTP ${res.status})`);
      err.code = res.status === 401 || res.status === 403 ? "REMOTE_SIGNER_AUTH_FAILED" : "REMOTE_SIGNER_HTTP_ERROR";
      err.status = res.status;
      err.detail = text;
      throw err;
    }
    try {
      return JSON.parse(text || "null");
    } catch (e) {
      const err = new Error("remote signer returned invalid JSON");
      err.code = "REMOTE_SIGNER_BAD_JSON";
      err.detail = e?.message ?? String(e);
      err.responseText = text;
      throw err;
    }
  } catch (e) {
    if (e?.name === "AbortError") {
      const err = new Error("remote signer request timed out");
      err.code = "REMOTE_SIGNER_TIMEOUT";
      throw err;
    }
    if (
      e?.code === "REMOTE_SIGNER_HTTP_ERROR" ||
      e?.code === "REMOTE_SIGNER_AUTH_FAILED" ||
      e?.code === "REMOTE_SIGNER_BAD_JSON" ||
      e?.code === "REMOTE_SIGNER_TIMEOUT" ||
      e?.code === "REMOTE_SIGNER_RESPONSE_TOO_LARGE"
    ) {
      throw e;
    }
    const err = new Error("remote signer request failed");
    err.code = "REMOTE_SIGNER_UNREACHABLE";
    err.detail = e?.message ?? String(e);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function readTokenFromFileBestEffort(fp, { maxBytes }) {
  const raw = await fs.readFile(fp, "utf8");
  const b = clampToUtf8Bytes(raw, maxBytes, "signer token file");
  return b.toString("utf8").trim();
}

export async function resolveRemoteSignerAuth({ auth, tokenEnv, tokenFile, headers = [], env = process.env } = {}) {
  const mode = typeof auth === "string" && auth.trim() ? auth.trim() : null;
  if (mode !== null && mode !== "none" && mode !== "bearer") {
    const err = new Error("--signer-auth must be 'none' or 'bearer'");
    err.code = "INVALID_SIGNER_AUTH_MODE";
    throw err;
  }

  const outHeaders = new Map();
  for (const h of Array.isArray(headers) ? headers : []) {
    if (typeof h !== "string" || !h.includes(":")) continue;
    const idx = h.indexOf(":");
    const k = h.slice(0, idx).trim();
    const v = h.slice(idx + 1).trim();
    if (!k) continue;
    outHeaders.set(k, v);
  }

  if (!mode || mode === "none") return { headers: outHeaders };

  const maxTokenBytes = 8 * 1024;
  let token = null;
  if (typeof tokenEnv === "string" && tokenEnv.trim()) {
    const v = env[String(tokenEnv)] ?? null;
    token = typeof v === "string" && v.trim() ? v.trim() : null;
  }
  if (!token && typeof tokenFile === "string" && tokenFile.trim()) {
    token = await readTokenFromFileBestEffort(String(tokenFile), { maxBytes: maxTokenBytes });
  }

  if (!token) {
    const err = new Error("missing remote signer bearer token");
    err.code = "REMOTE_SIGNER_AUTH_MISSING";
    throw err;
  }
  clampToUtf8Bytes(token, maxTokenBytes, "signer token");
  outHeaders.set("authorization", `Bearer ${token}`);
  return { headers: outHeaders };
}

export function createRemoteSignerClient({ url, command, args = [], timeoutMs = 30_000, auth = null, tokenEnv = null, tokenFile = null, headers = [], env } = {}) {
  const haveUrl = typeof url === "string" && url.trim();
  const haveCmd = typeof command === "string" && command.trim();
  if (haveUrl === haveCmd) throw new TypeError("exactly one of url or command is required");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs must be a positive number");
  if (!Array.isArray(args)) throw new TypeError("args must be an array");

  const baseUrl = haveUrl ? String(url).trim().replace(/\/$/, "") : null;
  const cmd = haveCmd ? String(command).trim() : null;
  const cmdArgs = args.map((v) => String(v));
  const processState = { processInputMode: "unknown" };
  const headerState = { headers: null, authResolved: false };

  async function resolveHeaders() {
    if (headerState.authResolved) return headerState.headers;
    const resolved = await resolveRemoteSignerAuth({ auth, tokenEnv, tokenFile, headers, env: env ?? process.env });
    headerState.headers = resolved.headers;
    headerState.authResolved = true;
    return headerState.headers;
  }

  return {
    kind: haveCmd ? "process" : "remote-signer",
    async getPublicKeyPem({ keyId }) {
      assertNonEmptyString(keyId, "keyId");

      let parsed;
      if (cmd) {
        parsed = await runProcessJson({ command: cmd, args: cmdArgs, timeoutMs, inputJson: { op: "publicKey", keyId }, state: processState });
      } else {
        const hdrs = await resolveHeaders();
        parsed = await fetchJsonWithTimeout(`${baseUrl}/v1/public-key?keyId=${encodeURIComponent(keyId)}`, {
          method: "GET",
          timeoutMs,
          headers: Object.fromEntries(hdrs.entries())
        });
      }

      const returnedKeyId = typeof parsed?.keyId === "string" ? parsed.keyId : null;
      const publicKeyPem = typeof parsed?.publicKeyPem === "string" ? parsed.publicKeyPem : null;
      if (returnedKeyId !== keyId) {
        const err = new Error("remote signer keyId mismatch in public key response");
        err.code = "REMOTE_SIGNER_KEY_MISMATCH";
        err.expected = keyId;
        err.actual = returnedKeyId ?? null;
        throw err;
      }
      if (!publicKeyPem || !publicKeyPem.includes("BEGIN PUBLIC KEY")) {
        const err = new Error("remote signer returned invalid publicKeyPem");
        err.code = "REMOTE_SIGNER_BAD_PUBLIC_KEY";
        throw err;
      }
      return publicKeyPem;
    },
    async sign({ keyId, algorithm, messageBytes, purpose, context }) {
      assertNonEmptyString(keyId, "keyId");
      assertNonEmptyString(algorithm, "algorithm");
      assertNonEmptyString(purpose, "purpose");
      if (!(messageBytes instanceof Uint8Array)) throw new TypeError("messageBytes must be a Uint8Array");
      if (messageBytes.byteLength > 1024 * 1024) {
        const err = new Error("signing message exceeds max size");
        err.code = "REMOTE_SIGNER_MESSAGE_TOO_LARGE";
        err.maxBytes = 1024 * 1024;
        err.actualBytes = messageBytes.byteLength;
        throw err;
      }

      const body = {
        schemaVersion: "RemoteSignerSignRequest.v1",
        requestId: requestIdFor({ keyId, purpose, messageBytes }),
        keyId,
        algorithm,
        messageBase64: Buffer.from(messageBytes).toString("base64"),
        purpose,
        context: isPlainObject(context) ? context : null
      };

      let parsed;
      if (cmd) {
        parsed = await runProcessJson({ command: cmd, args: cmdArgs, timeoutMs, inputJson: { op: "sign", body }, state: processState });
      } else {
        const hdrs = await resolveHeaders();
        parsed = await fetchJsonWithTimeout(`${baseUrl}/v1/sign`, {
          method: "POST",
          timeoutMs,
          headers: { "content-type": "application/json", ...Object.fromEntries(hdrs.entries()) },
          body: JSON.stringify(body)
        });
      }

      const returnedKeyId = typeof parsed?.keyId === "string" ? parsed.keyId : null;
      const signatureBase64 = typeof parsed?.signatureBase64 === "string" ? parsed.signatureBase64 : null;
      if (returnedKeyId !== keyId) {
        const err = new Error("remote signer keyId mismatch in sign response");
        err.code = "REMOTE_SIGNER_KEY_MISMATCH";
        err.expected = keyId;
        err.actual = returnedKeyId ?? null;
        throw err;
      }
      if (!signatureBase64 || !isBase64(signatureBase64)) {
        const err = new Error("remote signer returned invalid signatureBase64");
        err.code = "REMOTE_SIGNER_BAD_SIGNATURE";
        throw err;
      }
      const signerReceipt = typeof parsed?.signerReceipt === "string" ? parsed.signerReceipt : null;
      return { signatureBase64, signerReceipt };
    }
  };
}
