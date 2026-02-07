import { spawn } from "node:child_process";

function assertNonEmptyString(v, name) {
  if (typeof v !== "string" || v.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

// Shared waiter for "sync wait" on async child events.
const WAIT_SAB = new SharedArrayBuffer(4);
const WAIT_FLAG = new Int32Array(WAIT_SAB);

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function runJsonCommand({ command, args, inputJson, timeoutMs }) {
  const input = JSON.stringify(inputJson ?? {});
  const proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });

  const stdout = [];
  const stderr = [];
  proc.stdout.on("data", (d) => stdout.push(d));
  proc.stderr.on("data", (d) => stderr.push(d));

  let done = false;
  let exitCode = null;
  let spawnErr = null;
  proc.on("error", (e) => {
    spawnErr = e;
    done = true;
    Atomics.store(WAIT_FLAG, 0, 1);
    Atomics.notify(WAIT_FLAG, 0, 1);
  });
  proc.on("close", (code) => {
    exitCode = code ?? 1;
    done = true;
    Atomics.store(WAIT_FLAG, 0, 1);
    Atomics.notify(WAIT_FLAG, 0, 1);
  });

  proc.stdin.end(input);

  const deadline = Date.now() + timeoutMs;
  while (!done) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      const err = new Error("signer command timed out");
      err.code = "SIGNER_COMMAND_TIMEOUT";
      throw err;
    }
    Atomics.wait(WAIT_FLAG, 0, 0, remaining);
  }

  if (spawnErr) {
    const err = new Error("signer command failed to start");
    err.code = "SIGNER_COMMAND_SPAWN_FAILED";
    err.detail = spawnErr?.message ?? String(spawnErr);
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

export function createProcessSignerProvider({ command, args = [], timeoutMs = 30_000 } = {}) {
  assertNonEmptyString(command, "command");
  if (!Array.isArray(args)) throw new TypeError("args must be an array");

  return {
    kind: "process",
    getPublicKeyPem({ keyId }) {
      assertNonEmptyString(keyId, "keyId");
      const parsed = runJsonCommand({ command, args, timeoutMs, inputJson: { op: "publicKey", keyId } });
      const returnedKeyId = typeof parsed?.keyId === "string" ? parsed.keyId : null;
      const publicKeyPem = typeof parsed?.publicKeyPem === "string" ? parsed.publicKeyPem : null;
      if (returnedKeyId !== keyId) {
        const err = new Error("signer keyId mismatch in public key response");
        err.code = "SIGNER_KEY_MISMATCH";
        err.expected = keyId;
        err.actual = returnedKeyId ?? null;
        throw err;
      }
      if (!publicKeyPem || !publicKeyPem.includes("BEGIN PUBLIC KEY")) {
        const err = new Error("signer returned invalid publicKeyPem");
        err.code = "SIGNER_BAD_PUBLIC_KEY";
        throw err;
      }
      return publicKeyPem;
    },
    sign({ keyId, algorithm, messageBytes, purpose, context }) {
      assertNonEmptyString(keyId, "keyId");
      assertNonEmptyString(algorithm, "algorithm");
      assertNonEmptyString(purpose, "purpose");
      const body = {
        schemaVersion: "RemoteSignerSignRequest.v1",
        requestId: null,
        keyId,
        algorithm,
        messageBase64: Buffer.from(messageBytes).toString("base64"),
        purpose,
        context: isPlainObject(context) ? context : null
      };
      const parsed = runJsonCommand({ command, args, timeoutMs, inputJson: { op: "sign", body } });
      const returnedKeyId = typeof parsed?.keyId === "string" ? parsed.keyId : null;
      const signatureBase64 = typeof parsed?.signatureBase64 === "string" ? parsed.signatureBase64 : null;
      if (returnedKeyId !== keyId) {
        const err = new Error("signer keyId mismatch in sign response");
        err.code = "SIGNER_KEY_MISMATCH";
        err.expected = keyId;
        err.actual = returnedKeyId ?? null;
        throw err;
      }
      if (!signatureBase64 || !signatureBase64.trim()) {
        const err = new Error("signer returned invalid signatureBase64");
        err.code = "SIGNER_BAD_SIGNATURE";
        throw err;
      }
      const signerReceipt = typeof parsed?.signerReceipt === "string" ? parsed.signerReceipt : null;
      return { signatureBase64, signerReceipt, context: parsed?.context ?? null };
    }
  };
}
