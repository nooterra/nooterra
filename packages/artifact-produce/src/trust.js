import fs from "node:fs/promises";
import path from "node:path";

import { createEd25519Keypair, keyIdFromPublicKeyPem } from "./core/crypto.js";
import { createRemoteSignerClient } from "./signer/remote-client.js";

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

async function ensureEmptyDir({ dir, force }) {
  try {
    const st = await fs.stat(dir);
    if (!st.isDirectory()) throw new Error(`${dir} exists and is not a directory`);
    const entries = await fs.readdir(dir);
    if (entries.length === 0) return;
    if (!force) throw new Error(`${dir} is not empty (use --force to overwrite)`);
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // doesn't exist
  }
  await fs.mkdir(dir, { recursive: true });
}

async function writeJson({ fp, json, privateFile = false }) {
  const data = `${JSON.stringify(json, null, 2)}\n`;
  if (privateFile) {
    // Best-effort private perms (POSIX). On Windows, chmod is a no-op.
    await fs.writeFile(fp, data, { encoding: "utf8", mode: 0o600 });
    try {
      await fs.chmod(fp, 0o600);
    } catch {
      // ignore
    }
  } else {
    await fs.writeFile(fp, data, "utf8");
  }
}

export async function initTrustDir({ outDir, force = false, includeTimeAuthority = false } = {}) {
  const abs = path.resolve(process.cwd(), String(outDir ?? ""));
  if (!abs) throw new TypeError("outDir is required");
  await ensureEmptyDir({ dir: abs, force });

  const mode = "local";
  if (mode !== "local") throw new Error("unreachable");

  const trustPath = path.join(abs, "trust.json");
  const keypairsPath = path.join(abs, "keypairs.json");

  // local mode: generate fresh keypairs and persist for dev/demo.
  const govRoot = createEd25519Keypair();
  const govKeyId = keyIdFromPublicKeyPem(govRoot.publicKeyPem);
  const serverA = createEd25519Keypair();
  const serverKeyId = keyIdFromPublicKeyPem(serverA.publicKeyPem);

  let timeAuthority = null;
  let timeKeyId = null;
  if (includeTimeAuthority) {
    timeAuthority = createEd25519Keypair();
    timeKeyId = keyIdFromPublicKeyPem(timeAuthority.publicKeyPem);
  }

  const trust = {
    governanceRoots: { [govKeyId]: govRoot.publicKeyPem },
    ...(includeTimeAuthority ? { timeAuthorities: { [String(timeKeyId)]: timeAuthority.publicKeyPem } } : { timeAuthorities: {} })
  };

  const keypairs = {
    govRoot: { keyId: govKeyId, publicKeyPem: govRoot.publicKeyPem, privateKeyPem: govRoot.privateKeyPem },
    serverA: { keyId: serverKeyId, publicKeyPem: serverA.publicKeyPem, privateKeyPem: serverA.privateKeyPem },
    ...(includeTimeAuthority
      ? { timeAuthority: { keyId: String(timeKeyId), publicKeyPem: timeAuthority.publicKeyPem, privateKeyPem: timeAuthority.privateKeyPem } }
      : {})
  };

  await writeJson({ fp: trustPath, json: trust, privateFile: false });
  await writeJson({ fp: keypairsPath, json: keypairs, privateFile: true });

  return { outDir: abs, trustPath, keypairsPath, keyIds: { governanceRoot: govKeyId, server: serverKeyId, timeAuthority: timeKeyId }, mode };
}

export async function initTrustDirRemoteOnly({
  outDir,
  force = false,
  signerUrl = null,
  signerCommand = null,
  signerArgs = [],
  signerAuth = null,
  signerTokenEnv = null,
  signerTokenFile = null,
  signerHeaders = [],
  governanceRootKeyId,
  timeAuthorityKeyId = null
} = {}) {
  const abs = path.resolve(process.cwd(), String(outDir ?? ""));
  if (!abs) throw new TypeError("outDir is required");
  const haveUrl = typeof signerUrl === "string" && signerUrl.trim();
  const haveCmd = typeof signerCommand === "string" && signerCommand.trim();
  if (!haveUrl && !haveCmd) throw new TypeError("signerUrl or signerCommand is required");
  if (typeof governanceRootKeyId !== "string" || !governanceRootKeyId.trim()) throw new TypeError("governanceRootKeyId is required");
  await ensureEmptyDir({ dir: abs, force });

  const client = createRemoteSignerClient({
    url: haveUrl ? signerUrl : null,
    command: haveCmd ? signerCommand : null,
    args: Array.isArray(signerArgs) ? signerArgs : [],
    auth: haveUrl ? signerAuth : null,
    tokenEnv: haveUrl ? signerTokenEnv : null,
    tokenFile: haveUrl ? signerTokenFile : null,
    headers: haveUrl ? signerHeaders : []
  });

  const govPem = await client.getPublicKeyPem({ keyId: governanceRootKeyId });
  const timePem = timeAuthorityKeyId ? await client.getPublicKeyPem({ keyId: timeAuthorityKeyId }) : null;

  const trust = {
    governanceRoots: { [governanceRootKeyId]: govPem },
    timeAuthorities: timePem ? { [timeAuthorityKeyId]: timePem } : {},
    metadata: {
      keys: {
        [governanceRootKeyId]: {
          source: haveCmd ? { kind: "process", command: signerCommand, args: Array.isArray(signerArgs) ? signerArgs : [] } : { kind: "remote-signer", url: signerUrl },
          role: "governanceRoot"
        },
        ...(timeAuthorityKeyId
          ? {
              [timeAuthorityKeyId]: {
                source: haveCmd
                  ? { kind: "process", command: signerCommand, args: Array.isArray(signerArgs) ? signerArgs : [] }
                  : { kind: "remote-signer", url: signerUrl },
                role: "timeAuthority"
              }
            }
          : {})
      }
    }
  };

  const trustPath = path.join(abs, "trust.json");
  await writeJson({ fp: trustPath, json: trust, privateFile: false });

  return { outDir: abs, trustPath, keypairsPath: null, keyIds: { governanceRoot: governanceRootKeyId, server: null, timeAuthority: timeAuthorityKeyId }, mode: "remote-only" };
}
