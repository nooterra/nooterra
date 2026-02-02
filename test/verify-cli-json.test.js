import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";
import { createChainedEvent, appendChainedEvent } from "../src/core/event-chain.js";
import { buildJobProofBundleV1 } from "../src/core/proof-bundle.js";
import { GOVERNANCE_STREAM_ID } from "../src/core/governance.js";
import { DEFAULT_TENANT_ID } from "../src/core/tenancy.js";

import { writeFilesToDir } from "../scripts/proof-bundle/lib.mjs";
import { VERIFICATION_WARNING_CODE } from "../packages/artifact-verify/src/verification-warnings.js";

async function runCli(args, { env } = {}) {
  const bin = path.resolve(process.cwd(), "packages", "artifact-verify", "bin", "settld-verify.js");
  const proc = spawn(process.execPath, [bin, ...args], {
    env: { ...process.env, ...(env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stdout = [];
  const stderr = [];
  proc.stdout.on("data", (d) => stdout.push(d));
  proc.stderr.on("data", (d) => stderr.push(d));
  const code = await new Promise((resolve) => proc.on("exit", resolve));
  return { code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
}

async function buildJobProofDirMissingVerificationReport({ strictReady } = {}) {
  const tenantId = "tenant_cli_json";
  const jobId = "job_cli_json_1";
  const generatedAt = "2026-02-01T00:00:00.000Z";

  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(publicKeyPem);
  const signer = { keyId, privateKeyPem };
  const publicKeyByKeyId = new Map([[keyId, publicKeyPem]]);

  const governanceEvents = [];
  governanceEvents.push(
    ...appendChainedEvent({
      events: governanceEvents,
      signer,
      event: createChainedEvent({
        streamId: GOVERNANCE_STREAM_ID,
        type: "SERVER_SIGNER_KEY_REGISTERED",
        at: "2026-01-01T00:00:00.000Z",
        actor: { type: "system", id: "proxy" },
        payload: { tenantId: DEFAULT_TENANT_ID, keyId, publicKeyPem, registeredAt: "2026-01-01T00:00:00.000Z" }
      })
    })
  );

  const jobEvents = [];
  jobEvents.push(
    ...appendChainedEvent({
      events: jobEvents,
      signer,
      event: createChainedEvent({
        streamId: jobId,
        type: "JOB_CREATED",
        at: generatedAt,
        actor: { type: "system", id: "proxy" },
        payload: { jobId }
      })
    })
  );

  const jobSnapshot = { id: jobId, lastChainHash: jobEvents.at(-1)?.chainHash ?? null, lastEventId: jobEvents.at(-1)?.id ?? null };
  const governanceSnapshot = { streamId: GOVERNANCE_STREAM_ID, lastChainHash: governanceEvents.at(-1)?.chainHash ?? null, lastEventId: governanceEvents.at(-1)?.id ?? null };

  const { files } = buildJobProofBundleV1({
    tenantId,
    jobId,
    jobEvents,
    jobSnapshot,
    governanceEvents,
    governanceSnapshot,
    tenantGovernanceEvents: [],
    tenantGovernanceSnapshot: { streamId: GOVERNANCE_STREAM_ID, lastChainHash: null, lastEventId: null },
    artifacts: [],
    contractDocsByHash: new Map(),
    publicKeyByKeyId,
    signerKeys: [{ tenantId: DEFAULT_TENANT_ID, keyId, publicKeyPem, validFrom: "2026-01-01T00:00:00.000Z", serverGoverned: true }],
    manifestSigner: signer,
    governancePolicySigner: strictReady ? signer : null,
    requireHeadAttestation: true,
    generatedAt
  });

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-cli-json-"));
  const dir = path.join(tmp, "bundle");
  await writeFilesToDir({ files, outDir: dir });
  await fs.rm(path.join(dir, "verify", "verification_report.json"));

  return { dir, keyId, publicKeyPem };
}

test("CLI --format json: non-strict missing report -> ok + warning; --fail-on-warnings flips exit code", async () => {
  const { dir } = await buildJobProofDirMissingVerificationReport({ strictReady: false });

  const ok = await runCli(["--format", "json", "--job-proof", dir]);
  assert.equal(ok.code, 0, ok.stderr || ok.stdout);
  const parsed = JSON.parse(ok.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.verificationOk, true);
  assert.ok(Array.isArray(parsed.warnings));
  assert.equal(parsed.warnings.some((w) => w.code === VERIFICATION_WARNING_CODE.VERIFICATION_REPORT_MISSING_LENIENT), true);

  const failOnWarnings = await runCli(["--format", "json", "--fail-on-warnings", "--job-proof", dir]);
  assert.equal(failOnWarnings.code, 1, failOnWarnings.stderr || failOnWarnings.stdout);
  const parsedFail = JSON.parse(failOnWarnings.stdout);
  assert.equal(parsedFail.ok, false);
  assert.equal(parsedFail.verificationOk, true);
  assert.equal(parsedFail.errors.some((e) => e.code === "FAIL_ON_WARNINGS"), true);
});

test("CLI --format json: strict missing report -> fail (exit 1) with stable error code", async () => {
  const { dir, keyId, publicKeyPem } = await buildJobProofDirMissingVerificationReport({ strictReady: true });

  const strict = await runCli(["--format", "json", "--strict", "--job-proof", dir], {
    env: { SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify({ [keyId]: publicKeyPem }) }
  });
  assert.equal(strict.code, 1, strict.stderr || strict.stdout);
  const parsed = JSON.parse(strict.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.verificationOk, false);
  assert.equal(parsed.errors.some((e) => e.code === "missing verify/verification_report.json"), true);
});

