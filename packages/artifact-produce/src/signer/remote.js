import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

function assertNonEmptyString(v, name) {
  if (typeof v !== "string" || v.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function isBase64(s) {
  if (typeof s !== "string" || !s.trim()) return false;
  // Best-effort base64 sanity check (not strict url-safe).
  return /^[A-Za-z0-9+/=]+$/.test(s);
}

function requestIdFor({ keyId, purpose, hashHex }) {
  return crypto.createHash("sha256").update(`${keyId}|${purpose}|${hashHex}`, "utf8").digest("hex").slice(0, 32);
}

export function createRemoteSignerProvider({ url, timeoutMs = 30_000 } = {}) {
  assertNonEmptyString(url, "url");
  const helperUrl = new URL("./remote-helper.mjs", import.meta.url);
  const helperPath = fileURLToPath(helperUrl);
  const baseUrl = String(url).trim();

  function callHelper(json) {
    try {
      const out = execFileSync(process.execPath, [helperPath], {
        input: JSON.stringify(json ?? {}),
        encoding: "utf8",
        timeout: timeoutMs
      });
      return out;
    } catch (e) {
      const err = new Error("remote signer call failed");
      err.code = "REMOTE_SIGNER_CALL_FAILED";
      err.detail = String(e?.stderr ?? e?.message ?? "");
      throw err;
    }
  }

  return {
    kind: "remote",
    getPublicKeyPem({ keyId }) {
      assertNonEmptyString(keyId, "keyId");
      const raw = callHelper({ op: "publicKey", url: baseUrl, keyId });
      const parsed = JSON.parse(raw || "null");
      const publicKeyPem = typeof parsed?.publicKeyPem === "string" ? parsed.publicKeyPem : null;
      const returnedKeyId = typeof parsed?.keyId === "string" ? parsed.keyId : null;
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
    sign({ keyId, algorithm, messageBytes, purpose, context }) {
      assertNonEmptyString(keyId, "keyId");
      assertNonEmptyString(algorithm, "algorithm");
      assertNonEmptyString(purpose, "purpose");
      const messageBase64 = Buffer.from(messageBytes).toString("base64");
      const requestId = requestIdFor({ keyId, purpose, hashHex: crypto.createHash("sha256").update(messageBytes).digest("hex") });
      const body = {
        schemaVersion: "RemoteSignerSignRequest.v1",
        requestId,
        keyId,
        algorithm,
        messageBase64,
        purpose,
        context: isPlainObject(context) ? context : null
      };
      const raw = callHelper({ op: "sign", url: baseUrl, body });
      const parsed = JSON.parse(raw || "null");
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
      return { signatureBase64, signerReceipt, context: parsed?.context ?? null };
    }
  };
}
