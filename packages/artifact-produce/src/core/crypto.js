import { createHash, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from "node:crypto";

export function sha256Hex(data) {
  const hash = createHash("sha256");
  if (typeof data === "string") hash.update(data, "utf8");
  else hash.update(data);
  return hash.digest("hex");
}

export function createEd25519Keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" });

  return { publicKeyPem, privateKeyPem };
}

export function keyIdFromPublicKeyPem(publicKeyPem) {
  return `key_${sha256Hex(publicKeyPem).slice(0, 24)}`;
}

function isHex64(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function canSign(signer) {
  if (!signer || typeof signer !== "object") return false;
  if (typeof signer.privateKeyPem === "string" && signer.privateKeyPem.trim()) return true;
  if (signer.provider && typeof signer.provider.sign === "function") return true;
  return false;
}

export function signHashHexEd25519({ hashHex, signer, purpose, context } = {}) {
  if (!isHex64(hashHex)) throw new TypeError("hashHex must be a 64-char lowercase hex sha256");
  if (!signer || typeof signer !== "object") throw new TypeError("signer is required");
  const keyId = typeof signer.keyId === "string" && signer.keyId.trim() ? signer.keyId : null;
  if (!keyId) throw new TypeError("signer.keyId is required");

  if (!canSign(signer)) return null;

  if (typeof signer.privateKeyPem === "string" && signer.privateKeyPem.trim()) {
    const signature = nodeSign(null, Buffer.from(hashHex, "hex"), signer.privateKeyPem);
    return signature.toString("base64");
  }

  if (signer.provider && typeof signer.provider.sign === "function") {
    const res = signer.provider.sign({
      keyId,
      algorithm: "ed25519",
      messageBytes: Buffer.from(hashHex, "hex"),
      purpose: typeof purpose === "string" ? purpose : null,
      context: context ?? null
    });
    const sig = typeof res?.signatureBase64 === "string" ? res.signatureBase64 : null;
    if (!sig || !sig.trim()) {
      const err = new Error("provider did not return a signature");
      err.code = "SIGNER_PROVIDER_INVALID_RESPONSE";
      throw err;
    }
    return sig;
  }

  return null;
}

export function verifyHashHexEd25519({ hashHex, signatureBase64, publicKeyPem }) {
  return nodeVerify(null, Buffer.from(hashHex, "hex"), publicKeyPem, Buffer.from(signatureBase64, "base64"));
}
