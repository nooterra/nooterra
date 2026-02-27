import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { computeArtifactHash } from "../src/core/artifacts.js";
import { createChainedEvent, appendChainedEvent } from "../src/core/event-chain.js";
import { GOVERNANCE_STREAM_ID } from "../src/core/governance.js";
import { DEFAULT_TENANT_ID } from "../src/core/tenancy.js";
import { buildJobProofBundleV1 } from "../src/core/proof-bundle.js";

import { verifyJobProofBundleDir } from "../packages/artifact-verify/src/job-proof-bundle.js";

function bytes(text) {
  return new TextEncoder().encode(text);
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

function governanceSnapshotFor(events) {
  const last = events.at(-1) ?? null;
  return { streamId: GOVERNANCE_STREAM_ID, lastChainHash: last?.chainHash ?? null, lastEventId: last?.id ?? null };
}

test("large JobProof bundle verifies with bounded hashing concurrency", async () => {
  const keypairsPath = path.resolve(process.cwd(), "test", "fixtures", "keys", "fixture_keypairs.json");
  const keypairs = JSON.parse(await fs.readFile(keypairsPath, "utf8"));
  const trustPath = path.resolve(process.cwd(), "test", "fixtures", "bundles", "v1", "trust.json");
  const trust = JSON.parse(await fs.readFile(trustPath, "utf8"));

  const prevTrustedGov = process.env.NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON;
  process.env.NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON = JSON.stringify(trust.governanceRoots ?? {});
  await test.after(() => {
    if (prevTrustedGov === undefined) delete process.env.NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON;
    else process.env.NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON = prevTrustedGov;
  });

  const govSigner = { keyId: keypairs.govRoot.keyId, privateKeyPem: keypairs.govRoot.privateKeyPem };
  const serverKeys = {
    serverA: keypairs.serverA,
    serverB: keypairs.serverB,
    signerA: { keyId: keypairs.serverA.keyId, privateKeyPem: keypairs.serverA.privateKeyPem }
  };

  const tenantId = "tenant_large_fixture";
  const jobId = "job_large_fixture";
  const generatedAt = "2026-02-02T00:00:00.000Z";

  // Minimal governance stream: register serverA signer key.
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
        reason: "large-fixture"
      }
    })
  });
  const governanceSnapshot = governanceSnapshotFor(governanceEvents);

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

  // Many small artifacts to stress hashing + file descriptor usage.
  const artifacts = [];
  const artifactsCount = 3000;
  for (let i = 0; i < artifactsCount; i += 1) {
    const core = {
      schemaVersion: "WorkCertificate.v1",
      artifactType: "WorkCertificate.v1",
      artifactId: `wc_${i}`,
      tenantId,
      issuedAt: generatedAt,
      payload: { n: i, note: "fixture" }
    };
    const artifactHash = computeArtifactHash(core);
    artifacts.push({ ...core, artifactHash });
  }
  // One medium artifact to guard against accidental full-buffer reads.
  {
    const big = {
      schemaVersion: "WorkCertificate.v1",
      artifactType: "WorkCertificate.v1",
      artifactId: "wc_big",
      tenantId,
      issuedAt: generatedAt,
      payload: { blob: "a".repeat(8 * 1024 * 1024) }
    };
    artifacts.push({ ...big, artifactHash: computeArtifactHash(big) });
  }

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
    artifacts,
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys: [],
    manifestSigner: serverKeys.signerA,
    verificationReportSigner: serverKeys.signerA,
    timestampAuthoritySigner: null,
    toolVersion: "0.0.0-large-fixture",
    toolCommit: "0123456789abcdef0123456789abcdef01234567",
    requireHeadAttestation: true,
    generatedAt
  });

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-large-jobproof-"));
  await test.after(() => fs.rm(tmp, { recursive: true, force: true }));
  await writeFilesToDirSorted({ files, outDir: tmp });

  const rssBefore = process.memoryUsage().rss;
  const res = await verifyJobProofBundleDir({ dir: tmp, strict: true, hashConcurrency: 16 });
  const rssAfter = process.memoryUsage().rss;

  assert.equal(res.ok, true, JSON.stringify(res, null, 2));
  assert.equal(rssAfter - rssBefore < 250 * 1024 * 1024, true, `rss delta too high: ${(rssAfter - rssBefore) / (1024 * 1024)} MB`);
});

