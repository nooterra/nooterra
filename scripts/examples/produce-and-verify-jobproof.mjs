import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { createChainedEvent, appendChainedEvent } from "../../src/core/event-chain.js";
import { GOVERNANCE_STREAM_ID } from "../../src/core/governance.js";
import { DEFAULT_TENANT_ID } from "../../src/core/tenancy.js";
import { buildJobProofBundleV1 } from "../../src/core/proof-bundle.js";

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage: node scripts/examples/produce-and-verify-jobproof.mjs [--out <dir>]");
  process.exit(2);
}

function bytes(text) {
  return new TextEncoder().encode(text);
}

async function ensureEmptyDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function writeFilesToDirSorted({ files, outDir }) {
  const entries = Array.from(files.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [name, content] of entries) {
    const fp = path.join(outDir, name);
    // eslint-disable-next-line no-await-in-loop
    await fs.mkdir(path.dirname(fp), { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(fp, content);
  }
}

async function readFixtureKeypairs() {
  const p = path.resolve(process.cwd(), "test", "fixtures", "keys", "fixture_keypairs.json");
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}

async function readTrustFile() {
  const p = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "trust.json");
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}

async function runVerifyCli({ bundleDir, outJsonPath, env }) {
  const bin = path.resolve(process.cwd(), "packages", "artifact-verify", "bin", "nooterra-verify.js");
  const proc = spawn(process.execPath, [bin, "--format", "json", "--strict", "--job-proof", bundleDir], {
    env: { ...process.env, ...(env ?? {}) },
    stdio: ["ignore", "pipe", "inherit"]
  });
  const stdout = [];
  proc.stdout.on("data", (d) => stdout.push(d));
  const code = await new Promise((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
  const out = Buffer.concat(stdout).toString("utf8");
  await fs.writeFile(outJsonPath, out, "utf8");
  if (code !== 0) throw new Error(`nooterra-verify failed with exit code ${code}`);
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  let outDir = path.resolve(process.cwd(), "out", "produce-and-verify-jobproof");
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--out") {
      outDir = path.resolve(process.cwd(), String(argv[i + 1] ?? ""));
      if (!outDir) usage();
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    usage();
  }

  const trust = await readTrustFile();
  const keypairs = await readFixtureKeypairs();

  const govSigner = { keyId: keypairs.govRoot.keyId, privateKeyPem: keypairs.govRoot.privateKeyPem };
  const serverSigner = { keyId: keypairs.serverA.keyId, privateKeyPem: keypairs.serverA.privateKeyPem };
  const serverKeys = {
    serverA: keypairs.serverA,
    serverB: keypairs.serverB,
    signerA: serverSigner
  };

  const tenantId = "tenant_example";
  const jobId = "job_example";
  const generatedAt = "2026-02-02T00:00:00.000Z";

  // Governance stream: register serverA signer key (minimal).
  let governanceEvents = [];
  governanceEvents = appendChainedEvent({
    events: governanceEvents,
    signer: serverKeys.signerA,
    event: createChainedEvent({
      id: "evt_gov_serverA_registered",
      streamId: GOVERNANCE_STREAM_ID,
      type: "SERVER_SIGNER_KEY_REGISTERED",
      at: generatedAt,
      actor: { type: "system", id: "proxy" },
      payload: {
        tenantId: DEFAULT_TENANT_ID,
        keyId: serverKeys.serverA.keyId,
        publicKeyPem: serverKeys.serverA.publicKeyPem,
        registeredAt: generatedAt,
        reason: "example"
      }
    })
  });
  const governanceSnapshot = {
    streamId: GOVERNANCE_STREAM_ID,
    lastChainHash: governanceEvents.at(-1)?.chainHash ?? null,
    lastEventId: governanceEvents.at(-1)?.id ?? null
  };

  // Job stream: create job (minimal).
  let jobEvents = [];
  jobEvents = appendChainedEvent({
    events: jobEvents,
    signer: serverKeys.signerA,
    event: createChainedEvent({
      id: "evt_job_created",
      streamId: jobId,
      type: "JOB_CREATED",
      at: generatedAt,
      actor: { type: "system", id: "proxy" },
      payload: { jobId }
    })
  });
  const jobSnapshot = { id: jobId, lastChainHash: jobEvents.at(-1)?.chainHash ?? null, lastEventId: jobEvents.at(-1)?.id ?? null };

  const publicKeyByKeyId = new Map([
    [serverKeys.serverA.keyId, serverKeys.serverA.publicKeyPem],
    [serverKeys.serverB.keyId, serverKeys.serverB.publicKeyPem]
  ]);

  const { files } = buildJobProofBundleV1({
    tenantId,
    jobId,
    jobEvents,
    jobSnapshot,
    governanceEvents,
    governanceSnapshot,
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: null, lastEventId: null },
    governancePolicy: null,
    governancePolicySigner: govSigner,
    revocationList: null,
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys: [],
    manifestSigner: serverKeys.signerA,
    verificationReportSigner: serverKeys.signerA,
    timestampAuthoritySigner: null,
    toolVersion: "0.0.0-example",
    toolCommit: "0123456789abcdef0123456789abcdef01234567",
    requireHeadAttestation: true,
    generatedAt
  });

  const bundleDir = path.join(outDir, "bundle");
  const verifyOutPath = path.join(outDir, "nooterra-verify-output.json");

  await ensureEmptyDir(outDir);
  await ensureEmptyDir(bundleDir);
  await writeFilesToDirSorted({ files, outDir: bundleDir });

  // Verify strictly using the public CLI entrypoint, and write VerifyCliOutput.v1 JSON.
  await runVerifyCli({
    bundleDir,
    outJsonPath: verifyOutPath,
    env: {
      NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust.governanceRoots ?? {}),
      NOOTERRA_TRUSTED_TIME_AUTHORITY_KEYS_JSON: JSON.stringify(trust.timeAuthorities ?? {})
    }
  });

  // eslint-disable-next-line no-console
  console.log(`wrote bundle: ${bundleDir}`);
  // eslint-disable-next-line no-console
  console.log(`wrote verify output: ${verifyOutPath}`);
}

await main();
