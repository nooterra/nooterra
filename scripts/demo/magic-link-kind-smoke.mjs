import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { buildDeterministicZipStore } from "../../src/core/deterministic-zip.js";
import { unzipToTempSafe } from "../../packages/artifact-verify/src/safe-unzip.js";

const baseUrl = process.env.MAGIC_LINK_SMOKE_URL ?? "http://127.0.0.1:8787";
const apiKey = process.env.MAGIC_LINK_SMOKE_API_KEY ?? "dev_key";
const tenantId = process.env.MAGIC_LINK_SMOKE_TENANT_ID ?? "tenant_example";

const buyerEmail = process.env.MAGIC_LINK_SMOKE_BUYER_EMAIL ?? "aiden@settld.work";
const buyerEmailDomain = buyerEmail.split("@")[1] ?? "example.com";

const vendorId = process.env.MAGIC_LINK_SMOKE_VENDOR_ID ?? "vendor_a";
const vendorName = process.env.MAGIC_LINK_SMOKE_VENDOR_NAME ?? "Vendor A";
const contractId = process.env.MAGIC_LINK_SMOKE_CONTRACT_ID ?? "contract_1";

const k8sNamespace = process.env.MAGIC_LINK_SMOKE_NAMESPACE ?? "magic-link-demo";
const helmRelease = process.env.MAGIC_LINK_SMOKE_HELM_RELEASE ?? "magic-link";
const kubectl = process.env.KUBECTL_BIN ?? "kubectl";

const deploymentName = `${helmRelease}-settld-magic-link`;
const magicLinkContainerName = "magic-link";

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

async function zipDirStore(dir) {
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

function requestRaw({ method, url, headers, body }) {
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
          const buf = Buffer.concat(chunks);
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers ?? {}, body: buf });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function requestJson({ method, url, headers, body }) {
  const res = await requestRaw({ method, url, headers, body });
  const text = res.body.toString("utf8");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    throw new Error(`invalid json response status=${res.statusCode}: ${text.slice(0, 500)}`);
  }
  return { ...res, text, json };
}

function kubectlExecNode({ jsModuleSource }) {
  const args = [
    "-n",
    k8sNamespace,
    "exec",
    `deploy/${deploymentName}`,
    "-c",
    magicLinkContainerName,
    "--",
    "node",
    "--input-type=module",
    "-e",
    jsModuleSource
  ];
  const run = spawnSync(kubectl, args, { encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(`kubectl exec failed: ${run.stderr || run.stdout || "unknown error"}`);
  }
  return run.stdout;
}

function kubectlLogsTail() {
  const args = ["-n", k8sNamespace, "logs", `deploy/${deploymentName}`, "-c", magicLinkContainerName, "--tail=400"];
  const run = spawnSync(kubectl, args, { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`kubectl logs failed: ${run.stderr || run.stdout || "unknown error"}`);
  return run.stdout || "";
}

async function waitForLogOtp({ kind, token, email, timeoutMs = 15_000 }) {
  const deadline = Date.now() + timeoutMs;
  const re =
    kind === "buyer"
      ? new RegExp(`buyer otp tenant=${tenantId} email=${email} code=([0-9]{6})\\b`, "g")
      : new RegExp(`decision otp token=${token} email=${email} code=([0-9]{6})\\b`, "g");

  while (Date.now() < deadline) {
    const text = kubectlLogsTail();
    let last = null;
    for (const m of text.matchAll(re)) last = m;
    if (last) return last[1];
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${kind} otp in logs`);
}

async function main() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "settld-kind-smoke-"));

  // A) Deploy + basic health.
  {
    const health = await requestJson({ method: "GET", url: `${baseUrl}/healthz`, headers: {}, body: null });
    assert.equal(health.statusCode, 200, health.text);
    assert.equal(health.json?.ok, true);

    const metrics = await requestRaw({ method: "GET", url: `${baseUrl}/metrics`, headers: {}, body: null });
    assert.equal(metrics.statusCode, 200);
    const text = metrics.body.toString("utf8");
    assert.match(text, /\n# TYPE magic_link_data_dir_writable_gauge gauge\n/);
  }

  // B) Create tenant + policies/settings.
  {
    const demoTrust = await requestJson({
      method: "POST",
      url: `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/onboarding/demo-trust`,
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: Buffer.from("{}", "utf8")
    });
    assert.equal(demoTrust.statusCode, 200, demoTrust.text);
    assert.equal(demoTrust.json?.ok, true);

    const buyerSigner = JSON.parse(await fs.readFile("test/fixtures/keys/ed25519_test_keypair.json", "utf8"));
    const settingsPut = await requestJson({
      method: "PUT",
      url: `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/settings`,
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: Buffer.from(
        JSON.stringify(
          {
            defaultMode: "strict",
            buyerAuthEmailDomains: [buyerEmailDomain],
            buyerUserRoles: { [buyerEmail]: "admin" },
            decisionAuthEmailDomains: [buyerEmailDomain],
            settlementDecisionSigner: { signerKeyId: "buyer_ed25519_test", privateKeyPem: buyerSigner.privateKeyPem }
          },
          null,
          2
        ),
        "utf8"
      )
    });
    assert.equal(settingsPut.statusCode, 200, settingsPut.text);
    assert.equal(settingsPut.json?.ok, true);
    assert.equal(settingsPut.json?.settings?.schemaVersion, "TenantSettings.v2");
    assert.equal(settingsPut.json?.settings?.defaultMode, "strict");
    assert.equal(settingsPut.json?.settings?.buyerAuthEmailDomains?.includes(buyerEmailDomain), true);
    assert.equal(settingsPut.json?.settings?.decisionAuthEmailDomains?.includes(buyerEmailDomain), true);
    assert.equal(settingsPut.json?.settings?.settlementDecisionSigner?.privateKeyPem, null, "private key must be redacted in API output");
  }

  // C) Vendor onboarding pack + ingest key.
  const packZipPath = path.join(tmpRoot, `vendor_onboarding_pack_${tenantId}_${vendorId}.zip`);
  const packDir = path.join(tmpRoot, "pack");
  let ingestKey = null;
  {
    const pack = await requestRaw({
      method: "POST",
      url: `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/vendors/${encodeURIComponent(vendorId)}/onboarding-pack`,
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ vendorName, contractId }), "utf8")
    });
    assert.equal(pack.statusCode, 200);
    assert.equal(String(pack.headers["content-type"] ?? "").includes("application/zip"), true);
    await fs.writeFile(packZipPath, pack.body);
    const unzip = await unzipToTempSafe({
      zipPath: packZipPath,
      budgets: { maxEntries: 20_000, maxPathBytes: 512, maxFileBytes: 50 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024, maxCompressionRatio: 200 }
    });
    assert.equal(unzip.ok, true);

    // Move extracted files to a stable path we control (unzip dir is already temp).
    await fs.rename(unzip.dir, packDir);

    const required = [
      "ingest_key.txt",
      "README.md",
      "VENDOR_ENGINEER.md",
      "verify-locally.sh",
      "verify-locally.ps1",
      "samples/trust.json",
      "samples/known_good_closepack/manifest.json",
      "samples/known_bad_closepack/manifest.json"
    ];
    for (const rel of required) {
      // eslint-disable-next-line no-await-in-loop
      await fs.stat(path.join(packDir, rel));
    }

    ingestKey = (await fs.readFile(path.join(packDir, "ingest_key.txt"), "utf8")).trim();
    assert.ok(ingestKey && ingestKey.length >= 20, "ingest key missing/too short");
  }

  // D) Upload good + bad bundles via ingest key path (real vendor flow).
  let tokenClosePackGood = null;
  let tokenClosePackBad = null;
  let tokenInvoiceGood = null;
  {
    const goodZip = await zipDirStore(path.join(packDir, "samples/known_good_closepack"));
    const badZip = await zipDirStore(path.join(packDir, "samples/known_bad_closepack"));
    const invZip = await zipDirStore("test/fixtures/bundles/v1/invoicebundle/strict-pass");

    const good = await requestJson({
      method: "POST",
      url: `${baseUrl}/v1/ingest/${encodeURIComponent(tenantId)}?mode=strict&contractId=${encodeURIComponent(contractId)}`,
      headers: { authorization: `Bearer ${ingestKey}`, "content-type": "application/zip", "content-length": String(goodZip.length) },
      body: goodZip
    });
    assert.equal(good.statusCode, 200, good.text);
    assert.equal(good.json?.ok, true, good.text);
    tokenClosePackGood = good.json?.token;
    assert.match(String(tokenClosePackGood), /^ml_[0-9a-f]{48}$/);

    const bad = await requestJson({
      method: "POST",
      url: `${baseUrl}/v1/ingest/${encodeURIComponent(tenantId)}?mode=strict&contractId=${encodeURIComponent(contractId)}`,
      headers: { authorization: `Bearer ${ingestKey}`, "content-type": "application/zip", "content-length": String(badZip.length) },
      body: badZip
    });
    assert.equal(bad.statusCode, 200, bad.text);
    assert.equal(bad.json?.ok, true, bad.text);
    tokenClosePackBad = bad.json?.token;
    assert.match(String(tokenClosePackBad), /^ml_[0-9a-f]{48}$/);

    const inv = await requestJson({
      method: "POST",
      url: `${baseUrl}/v1/ingest/${encodeURIComponent(tenantId)}?mode=strict&contractId=${encodeURIComponent(contractId)}`,
      headers: { authorization: `Bearer ${ingestKey}`, "content-type": "application/zip", "content-length": String(invZip.length) },
      body: invZip
    });
    assert.equal(inv.statusCode, 200, inv.text);
    assert.equal(inv.json?.ok, true, inv.text);
    tokenInvoiceGood = inv.json?.token;
    assert.match(String(tokenInvoiceGood), /^ml_[0-9a-f]{48}$/);
  }

  // Metrics should now include counters.
  {
    const metrics = await requestRaw({ method: "GET", url: `${baseUrl}/metrics`, headers: {}, body: null });
    assert.equal(metrics.statusCode, 200);
    const text = metrics.body.toString("utf8");

    function maxSeriesValue(metricName) {
      const re = new RegExp(`^${metricName}(?:\\{[^}]*\\})?\\s+([0-9eE+\\-.]+)\\s*$`, "gm");
      const values = [];
      for (const m of text.matchAll(re)) {
        const n = Number(m[1]);
        if (Number.isFinite(n)) values.push(n);
      }
      if (!values.length) return null;
      return Math.max(...values);
    }

    const uploads = maxSeriesValue("uploads_total");
    const verifications = maxSeriesValue("verifications_total");
    assert.ok(uploads !== null, "uploads_total missing from /metrics");
    assert.ok(verifications !== null, "verifications_total missing from /metrics");
    assert.ok(uploads >= 1, `uploads_total expected >= 1, got ${uploads}`);
    assert.ok(verifications >= 1, `verifications_total expected >= 1, got ${verifications}`);
  }

  // Confirm inbox shows both.
  {
    const inbox = await requestJson({
      method: "GET",
      url: `${baseUrl}/v1/inbox?limit=50&vendorId=${encodeURIComponent(vendorId)}`,
      headers: { "x-api-key": apiKey, "x-tenant-id": tenantId },
      body: null
    });
    assert.equal(inbox.statusCode, 200, inbox.text);
    assert.equal(inbox.json?.ok, true, inbox.text);
    const rows = Array.isArray(inbox.json?.rows) ? inbox.json.rows : [];
    const tokens = new Set(rows.map((r) => String(r?.token ?? "")));
    assert.ok(tokens.has(String(tokenClosePackGood)));
    assert.ok(tokens.has(String(tokenClosePackBad)));
    assert.ok(tokens.has(String(tokenInvoiceGood)));
  }

  // E) Buyer auth + approve/hold with OTP (codes are emitted to pod logs in kind demo values).
  let buyerSessionCookie = null;
  {
    const otpReq = await requestJson({
      method: "POST",
      url: `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login/otp`,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ email: buyerEmail }), "utf8")
    });
    assert.equal(otpReq.statusCode, 200, otpReq.text);
    assert.equal(otpReq.json?.ok, true);
    const code = await waitForLogOtp({ kind: "buyer", token: null, email: buyerEmail });

    const login = await requestJson({
      method: "POST",
      url: `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login`,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ email: buyerEmail, code }), "utf8")
    });
    assert.equal(login.statusCode, 200, login.text);
    assert.equal(login.json?.ok, true);
    assert.equal(login.json?.role, "admin");

    const setCookie = login.headers["set-cookie"];
    assert.ok(setCookie, "missing set-cookie on buyer login");
    buyerSessionCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;

    const me = await requestJson({
      method: "GET",
      url: `${baseUrl}/v1/buyer/me`,
      headers: { cookie: buyerSessionCookie },
      body: null
    });
    assert.equal(me.statusCode, 200, me.text);
    assert.equal(me.json?.ok, true);
    assert.equal(me.json?.principal?.email, buyerEmail.toLowerCase());
  }

  // Approve invoice token (strict-pass) via decision OTP.
  {
    const decisionOtp = await requestJson({
      method: "POST",
      url: `${baseUrl}/r/${encodeURIComponent(tokenInvoiceGood)}/otp/request`,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ email: buyerEmail }), "utf8")
    });
    assert.equal(decisionOtp.statusCode, 200, decisionOtp.text);
    assert.equal(decisionOtp.json?.ok, true);
    const code = await waitForLogOtp({ kind: "decision", token: tokenInvoiceGood, email: buyerEmail });

    const approve = await requestJson({
      method: "POST",
      url: `${baseUrl}/r/${encodeURIComponent(tokenInvoiceGood)}/decision`,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ decision: "approve", email: buyerEmail, otp: code, note: "ok" }), "utf8")
    });
    assert.equal(approve.statusCode, 200, approve.text);
    assert.equal(approve.json?.ok, true);
    assert.equal(approve.json?.decisionReport?.schemaVersion, "SettlementDecisionReport.v1");
    assert.equal(approve.json?.decisionReport?.decision, "approve");
  }

  // Offline verify story: bundle + decision + buyer public keys.
  {
    const bundle = await requestRaw({ method: "GET", url: `${baseUrl}/r/${encodeURIComponent(tokenInvoiceGood)}/bundle.zip`, headers: {}, body: null });
    assert.equal(bundle.statusCode, 200);
    const decision = await requestRaw({
      method: "GET",
      url: `${baseUrl}/r/${encodeURIComponent(tokenInvoiceGood)}/settlement_decision_report.json`,
      headers: {},
      body: null
    });
    assert.equal(decision.statusCode, 200);
    const keys = JSON.parse(await fs.readFile("test/fixtures/keys/ed25519_test_keypair.json", "utf8"));
    const keysPath = path.join(tmpRoot, "trusted_buyer_keys.json");
    await fs.writeFile(keysPath, JSON.stringify({ buyer_ed25519_test: keys.publicKeyPem }, null, 2) + "\n", "utf8");

    const bundlePath = path.join(tmpRoot, `offline_${tokenInvoiceGood}.zip`);
    const decisionPath = path.join(tmpRoot, `offline_${tokenInvoiceGood}_decision.json`);
    await fs.writeFile(bundlePath, bundle.body);
    await fs.writeFile(decisionPath, decision.body);

    const nodeBin = path.resolve(process.cwd(), "packages/artifact-verify/bin/settld-verify.js");
    const trust = JSON.parse(await fs.readFile("test/fixtures/bundles/v1/trust.json", "utf8"));
    const run = spawnSync(
      process.execPath,
      [nodeBin, "--format", "json", "--invoice-bundle", bundlePath, "--settlement-decision", decisionPath, "--trusted-buyer-keys", keysPath],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          LANG: "C",
          LC_ALL: "C",
          SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON: JSON.stringify(trust.governanceRoots ?? {}),
          SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON: JSON.stringify(trust.pricingSigners ?? {})
        }
      }
    );
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const out = JSON.parse(run.stdout || "null");
    assert.equal(out.schemaVersion, "VerifyCliOutput.v1");
    assert.equal(out.ok, true);
    assert.equal(out.target?.kind, "settlement-decision");
  }

  // F) Export artifacts buyers/procurement will demand.
  const month = new Date().toISOString().slice(0, 7);
  {
    const csv = await requestRaw({
      method: "GET",
      url: `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/export.csv?month=${encodeURIComponent(month)}`,
      headers: { "x-api-key": apiKey },
      body: null
    });
    assert.equal(csv.statusCode, 200);
    assert.match(csv.body.toString("utf8"), /invoiceId,vendorId,contractId/);

    const auditPacket = await requestRaw({
      method: "GET",
      url: `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/audit-packet?month=${encodeURIComponent(month)}&includeBundles=0`,
      headers: { "x-api-key": apiKey },
      body: null
    });
    assert.equal(auditPacket.statusCode, 200);
    assert.equal(String(auditPacket.headers["content-type"] ?? "").includes("application/zip"), true);
    assert.ok(auditPacket.body.length > 100);

    const sec = await requestRaw({
      method: "GET",
      url: `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/security-controls-packet?month=${encodeURIComponent(month)}`,
      headers: { "x-api-key": apiKey },
      body: null
    });
    assert.equal(sec.statusCode, 200);
    const secZipPath = path.join(tmpRoot, `security_controls_${tenantId}_${month}.zip`);
    await fs.writeFile(secZipPath, sec.body);
    const unzip = await unzipToTempSafe({
      zipPath: secZipPath,
      budgets: { maxEntries: 20_000, maxPathBytes: 512, maxFileBytes: 50 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024, maxCompressionRatio: 200 }
    });
    assert.equal(unzip.ok, true);
    const secDir = unzip.dir;
    const required = [
      "index.json",
      "packet_index.json",
      "checksums.sha256",
      "data_inventory.json",
      "redaction_allowlist.json",
      "retention_behavior.json",
      "pilot-kit/security-qa.md",
      "pilot-kit/architecture-one-pager.md",
      "pilot-kit/procurement-one-pager.md",
      "pilot-kit/rfp-clause.md"
    ];
    for (const rel of required) {
      // eslint-disable-next-line no-await-in-loop
      await fs.stat(path.join(secDir, rel));
    }
  }

  // G) Retention GC safety: backdate a token, confirm 410 retained, then GC deletes blobs but leaves run record.
  {
    const retainedToken = tokenInvoiceGood;

    // Backdate meta.createdAt so retention logic applies immediately.
    kubectlExecNode({
      jsModuleSource: `
        import fs from "node:fs/promises";
        import path from "node:path";
        const token = ${JSON.stringify(retainedToken)};
        const tenantId = ${JSON.stringify(tenantId)};

        const metaFp = "/data/meta/" + token + ".json";
        const meta = JSON.parse(await fs.readFile(metaFp, "utf8"));
        meta.createdAt = "2000-01-01T00:00:00.000Z";
        await fs.writeFile(metaFp, JSON.stringify(meta, null, 2) + "\\n", "utf8");

        const rrFp = path.join("/data/runs", tenantId, token + ".json");
        const rr = JSON.parse(await fs.readFile(rrFp, "utf8"));
        rr.createdAt = "2000-01-01T00:00:00.000Z";
        await fs.writeFile(rrFp, JSON.stringify(rr, null, 2) + "\\n", "utf8");
        console.log("ok");
      `
    });

    const report = await requestRaw({ method: "GET", url: `${baseUrl}/r/${encodeURIComponent(retainedToken)}`, headers: {}, body: null });
    assert.equal(report.statusCode, 410, report.body.toString("utf8"));

    // GC removes blobs + meta + index entry.
    const gcOut = kubectlExecNode({
      jsModuleSource: `
        import { garbageCollectTenantByRetention } from "./services/magic-link/src/retention-gc.js";
        import { loadTenantSettings } from "./services/magic-link/src/tenant-settings.js";
        const dataDir = "/data";
        const tenantId = ${JSON.stringify(tenantId)};
        const tenantSettings = await loadTenantSettings({ dataDir, tenantId });
        const res = await garbageCollectTenantByRetention({ dataDir, tenantId, tenantSettings });
        console.log(JSON.stringify(res));
      `
    });
    const gc = JSON.parse(String(gcOut || "null"));
    assert.equal(gc.ok, true);

    const report2 = await requestRaw({ method: "GET", url: `${baseUrl}/r/${encodeURIComponent(retainedToken)}`, headers: {}, body: null });
    assert.ok(report2.statusCode === 404 || report2.statusCode === 410);

    const support = await requestRaw({
      method: "GET",
      url: `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/support-bundle?from=1999-12-31T00:00:00.000Z&to=2000-01-02T00:00:00.000Z`,
      headers: { "x-api-key": apiKey },
      body: null
    });
    assert.equal(support.statusCode, 200);
    const zipPath = path.join(tmpRoot, `support_bundle_${tenantId}.zip`);
    await fs.writeFile(zipPath, support.body);
    const unzip = await unzipToTempSafe({
      zipPath,
      budgets: { maxEntries: 20_000, maxPathBytes: 512, maxFileBytes: 50 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024, maxCompressionRatio: 200 }
    });
    assert.equal(unzip.ok, true);
    const index = JSON.parse(await fs.readFile(path.join(unzip.dir, "index.json"), "utf8"));
    assert.equal(index.schemaVersion, "MagicLinkSupportBundle.v1");
    const runs = Array.isArray(index.runs) ? index.runs : [];
    const row = runs.find((r) => r && r.token === retainedToken);
    assert.ok(row, "retained run must be present in support bundle index");
    assert.equal(row.retained, true);
    await fs.stat(path.join(unzip.dir, "runs", retainedToken, "run_record.json"));
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        tenantId,
        vendorId,
        contractId,
        tokens: { closePackGood: tokenClosePackGood, closePackBad: tokenClosePackBad, invoiceGood: tokenInvoiceGood }
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack ?? String(err ?? ""));
  process.exit(1);
});
