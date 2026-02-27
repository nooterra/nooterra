import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";

import { buildDeterministicZipStore } from "../src/core/deterministic-zip.js";

async function listFilesRecursive(dir) {
  const out = [];
  async function walk(cur) {
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(cur, e.name);
      if (e.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(fp);
      } else if (e.isFile()) out.push(fp);
    }
  }
  await walk(dir);
  out.sort();
  return out;
}

async function zipDir(dir) {
  const files = new Map();
  const fps = await listFilesRecursive(dir);
  for (const fp of fps) {
    const rel = path.relative(dir, fp).split(path.sep).join("/");
    // eslint-disable-next-line no-await-in-loop
    files.set(rel, await fs.readFile(fp));
  }
  const zip = buildDeterministicZipStore({ files, mtime: new Date("2000-01-01T00:00:00.000Z") });
  return Buffer.from(zip);
}

function makeMockRes() {
  const headers = new Map();
  const chunks = [];
  return {
    statusCode: 200,
    setHeader(k, v) {
      headers.set(String(k).toLowerCase(), String(v));
    },
    getHeader(k) {
      return headers.get(String(k).toLowerCase()) ?? null;
    },
    end(data) {
      if (data !== undefined && data !== null) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
      this.ended = true;
    },
    ended: false,
    _headers: headers,
    _body() {
      return Buffer.concat(chunks);
    }
  };
}

test("magic-link: persists ClosePack summary + evaluation downloads", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-magic-link-closepack-summary-test-"));
  await t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  // Configure a per-test instance (import with query to avoid ESM module cache collisions).
  process.env.MAGIC_LINK_DISABLE_LISTEN = "1";
  process.env.MAGIC_LINK_PORT = "0";
  process.env.MAGIC_LINK_HOST = "127.0.0.1";
  process.env.MAGIC_LINK_API_KEY = "test_key";
  process.env.MAGIC_LINK_DATA_DIR = dataDir;
  process.env.MAGIC_LINK_VERIFY_TIMEOUT_MS = "60000";
  process.env.MAGIC_LINK_RATE_LIMIT_UPLOADS_PER_MINUTE = "120";
  process.env.MAGIC_LINK_MAX_UPLOAD_BYTES = String(50 * 1024 * 1024);
  process.env.MAGIC_LINK_WEBHOOK_DELIVERY_MODE = "record";
  process.env.MAGIC_LINK_WEBHOOK_TIMEOUT_MS = "1000";
  process.env.MAGIC_LINK_SETTINGS_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.MAGIC_LINK_BUYER_OTP_DELIVERY_MODE = "record";

  const { magicLinkHandler } = await import(`../services/magic-link/src/server.js?closepack-summary-test=1`);

  async function runReq({ method, url, headers, bodyChunks }) {
    const req = Readable.from(bodyChunks ?? []);
    req.method = method;
    req.url = url;
    req.headers = headers ?? {};
    const res = makeMockRes();
    await magicLinkHandler(req, res);
    return res;
  }

  const trust = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "test/fixtures/bundles/v1/trust.json"), "utf8"));
  process.env.NOOTERRA_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON = JSON.stringify(trust.governanceRoots ?? {});
  process.env.NOOTERRA_TRUSTED_PRICING_SIGNER_KEYS_JSON = JSON.stringify(trust.pricingSigners ?? {});

  const fxCloseDir = path.resolve(process.cwd(), "test/fixtures/bundles/v1/closepack/strict-pass");
  const zipClose = await zipDir(fxCloseDir);

  const upRes = await runReq({
    method: "POST",
    url: `/v1/upload?mode=strict`,
    headers: {
      "x-api-key": "test_key",
      "x-tenant-id": "tenant_close_summary",
      "content-type": "application/zip",
      "content-length": String(zipClose.length)
    },
    bodyChunks: [zipClose]
  });
  assert.equal(upRes.statusCode, 200, upRes._body().toString("utf8"));
  const up = JSON.parse(upRes._body().toString("utf8"));
  assert.equal(up.ok, true);

  const summary = await runReq({ method: "GET", url: `/r/${up.token}/closepack/closepack_summary_v1.json`, headers: {}, bodyChunks: [] });
  assert.equal(summary.statusCode, 200, summary._body().toString("utf8"));
  const summaryJson = JSON.parse(summary._body().toString("utf8"));
  assert.equal(summaryJson.hasClosePack, true);
  assert.equal(typeof summaryJson.evidenceIndex?.itemCount, "number");
  assert.equal(typeof summaryJson.sla?.present, "boolean");
  assert.equal(typeof summaryJson.acceptance?.present, "boolean");

  const evidenceIndex = await runReq({ method: "GET", url: `/r/${up.token}/closepack/evidence_index.json`, headers: {}, bodyChunks: [] });
  assert.equal(evidenceIndex.statusCode, 200);
  assert.equal(JSON.parse(evidenceIndex._body().toString("utf8")).schemaVersion, "EvidenceIndex.v1");

  const slaEval = await runReq({ method: "GET", url: `/r/${up.token}/closepack/sla_evaluation.json`, headers: {}, bodyChunks: [] });
  assert.equal(slaEval.statusCode, 200);
  assert.equal(JSON.parse(slaEval._body().toString("utf8")).schemaVersion, "SlaEvaluation.v1");

  const accEval = await runReq({ method: "GET", url: `/r/${up.token}/closepack/acceptance_evaluation.json`, headers: {}, bodyChunks: [] });
  assert.equal(accEval.statusCode, 200);
  assert.equal(JSON.parse(accEval._body().toString("utf8")).schemaVersion, "AcceptanceEvaluation.v1");
});

