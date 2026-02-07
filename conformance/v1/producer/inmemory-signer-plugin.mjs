import fs from "node:fs/promises";
import path from "node:path";
import { sign as nodeSign } from "node:crypto";

function assertNonEmptyString(v, name) {
  if (typeof v !== "string" || v.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

async function readJson(fp) {
  const raw = await fs.readFile(fp, "utf8");
  return JSON.parse(raw);
}

export async function createSignerProvider({ config } = {}) {
  if (!config || typeof config !== "object") throw new TypeError("config is required");
  assertNonEmptyString(config.keypairsPath, "config.keypairsPath");
  const abs = path.resolve(process.cwd(), config.keypairsPath);
  const keypairs = await readJson(abs);
  const byKeyId = new Map();
  for (const v of Object.values(keypairs ?? {})) {
    const keyId = typeof v?.keyId === "string" ? v.keyId : null;
    const publicKeyPem = typeof v?.publicKeyPem === "string" ? v.publicKeyPem : null;
    const privateKeyPem = typeof v?.privateKeyPem === "string" ? v.privateKeyPem : null;
    if (!keyId || !publicKeyPem || !privateKeyPem) continue;
    byKeyId.set(keyId, { keyId, publicKeyPem, privateKeyPem });
  }

  return {
    async getPublicKeyPem({ keyId }) {
      assertNonEmptyString(keyId, "keyId");
      const kp = byKeyId.get(keyId) ?? null;
      if (!kp) throw new Error("unknown keyId");
      return kp.publicKeyPem;
    },
    async sign({ keyId, algorithm, messageBytes }) {
      assertNonEmptyString(keyId, "keyId");
      assertNonEmptyString(algorithm, "algorithm");
      if (!(messageBytes instanceof Uint8Array)) throw new TypeError("messageBytes must be a Uint8Array");
      if (algorithm !== "ed25519") throw new Error("unsupported algorithm");
      const kp = byKeyId.get(keyId) ?? null;
      if (!kp) throw new Error("unknown keyId");
      const sig = nodeSign(null, Buffer.from(messageBytes), kp.privateKeyPem).toString("base64");
      return { signatureBase64: sig };
    }
  };
}

