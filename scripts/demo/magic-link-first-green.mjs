import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";

import { buildDeterministicZipStore } from "../../src/core/deterministic-zip.js";

const baseUrl = process.env.MAGIC_LINK_DEMO_URL ?? "http://127.0.0.1:8787";
const apiKey = process.env.MAGIC_LINK_DEMO_API_KEY ?? "dev_key";
const tenantId = process.env.MAGIC_LINK_DEMO_TENANT_ID ?? "tenant_example";

async function listFilesRecursive(dir) {
  const out = [];
  async function walk(cur) {
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(cur, e.name);
      if (e.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(fp);
      } else if (e.isFile()) {
        out.push(fp);
      }
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
    const bytes = await fs.readFile(fp);
    files.set(rel, bytes);
  }
  const zip = buildDeterministicZipStore({ files, mtime: new Date("2000-01-01T00:00:00.000Z") });
  return Buffer.from(zip);
}

function requestJson({ method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        headers
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ statusCode: res.statusCode ?? 0, json: text ? JSON.parse(text) : null, text });
          } catch (err) {
            reject(new Error(`invalid json response status=${res.statusCode}: ${text.slice(0, 500)}`));
          }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const fixtureDir = "test/fixtures/bundles/v1/closepack/strict-pass";
  const zipBuf = await zipDir(fixtureDir);

  const upload = await requestJson({
    method: "POST",
    url: `${baseUrl}/v1/upload?mode=auto`,
    headers: {
      "x-api-key": apiKey,
      "x-tenant-id": tenantId,
      "content-type": "application/zip",
      "content-length": String(zipBuf.length)
    },
    body: zipBuf
  });
  assert.equal(upload.statusCode, 200, upload.text);
  assert.equal(upload.json?.ok, true, upload.text);
  const token = upload.json.token;
  assert.match(String(token), /^ml_[0-9a-f]{48}$/);

  const inbox = await requestJson({
    method: "GET",
    url: `${baseUrl}/v1/inbox?status=green&limit=50`,
    headers: {
      "x-api-key": apiKey,
      "x-tenant-id": tenantId
    }
  });
  assert.equal(inbox.statusCode, 200, inbox.text);
  assert.equal(inbox.json?.ok, true, inbox.text);
  const rows = Array.isArray(inbox.json?.rows) ? inbox.json.rows : [];
  if (!rows.some((r) => String(r?.token ?? "") === token)) {
    throw new Error(`uploaded token not found in green inbox: token=${token}`);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, token, baseUrl, tenantId }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack ?? String(err ?? ""));
  process.exit(1);
});

