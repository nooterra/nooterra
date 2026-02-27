#!/usr/bin/env node
import fs from "node:fs/promises";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    [
      "usage:",
      "  nooterra-magic-link upload <InvoiceBundle.v1.zip> --url <http(s)://host[:port]> [--mode auto|strict|compat] [--tenant <id>] [--format json|text]",
      "  nooterra-magic-link ingest <InvoiceBundle.v1.zip> --url <http(s)://host[:port]> --tenant <buyerTenant> --ingest-key <igk_...> [--mode auto|strict|compat] [--contract <id>] [--format json|text]",
      "  nooterra-magic-link tenant get --url <http(s)://host[:port]> --tenant <id> [--format json|text]",
      "  nooterra-magic-link tenant set --url <http(s)://host[:port]> --tenant <id> [--default-mode auto|strict|compat] [--format json|text]",
      "  nooterra-magic-link tenant trust set --url <http(s)://host[:port]> --tenant <id> --file <trust-roots.json> [--format json|text]",
      "  nooterra-magic-link ingest-key create --url <http(s)://host[:port]> --tenant <buyerTenant> --vendor <vendorId> [--vendor-name <name>] [--expires-at <iso>] [--format json|text]",
      "  nooterra-magic-link ingest-key revoke --url <http(s)://host[:port]> --tenant <buyerTenant> --key-hash <64hex> [--reason <text>] [--format json|text]",
      "  nooterra-magic-link vendor pack --url <http(s)://host[:port]> --tenant <buyerTenant> --vendor <vendorId> [--vendor-name <name>] [--contract <id>] [--expires-at <iso>] [--pricing-matrix <pricing_matrix.json>] [--pricing-signatures <pricing_matrix_signatures.json>] --out <pack.zip>",
      "  nooterra-magic-link inbox --url <http(s)://host[:port]> --tenant <buyerTenant> [--status green|amber|red|processing] [--vendor <vendorId>] [--contract <id>] [--from <iso>] [--to <iso>] [--limit <n>] [--format json|text]",
      "  nooterra-magic-link billing export --url <http(s)://host[:port]> --tenant <id> [--month <YYYY-MM>] --out <invoice.pdf> [--format pdf|json]",
      "",
      "env:",
      "  MAGIC_LINK_API_KEY   # optional; sent as x-api-key header"
    ].join("\n")
  );
  process.exit(2);
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function formatMoneyFromCentsString({ currency, cents }) {
  const cur = String(currency ?? "").trim() || "UNK";
  const raw = String(cents ?? "").trim();
  if (!/^[0-9]+$/.test(raw)) return `${cur} ${raw}`;
  if (cur === "USD") {
    const padded = raw.padStart(3, "0");
    const dollars = padded.slice(0, -2);
    const centsPart = padded.slice(-2);
    return `$${dollars}.${centsPart}`;
  }
  return `${cur} ${raw} cents`;
}

function parseArgs(argv) {
  if (!argv.length) usage();
  const cmd = argv[0];
  if (cmd === "upload") {
    const filePath = argv[1] ?? null;
    if (!filePath || filePath.startsWith("-")) usage();

    const out = { cmd, filePath, url: null, mode: "auto", tenantId: "default", format: "json" };
    for (let i = 2; i < argv.length; i += 1) {
      const a = argv[i];
      if (a === "--url") {
        out.url = String(argv[i + 1] ?? "");
        if (!out.url) usage();
        i += 1;
        continue;
      }
      if (a === "--mode") {
        out.mode = String(argv[i + 1] ?? "").toLowerCase();
        if (out.mode !== "auto" && out.mode !== "strict" && out.mode !== "compat") usage();
        i += 1;
        continue;
      }
      if (a === "--tenant") {
        out.tenantId = String(argv[i + 1] ?? "");
        if (!out.tenantId || !/^[a-zA-Z0-9_-]{1,64}$/.test(out.tenantId)) usage();
        i += 1;
        continue;
      }
      if (a === "--format") {
        out.format = String(argv[i + 1] ?? "").toLowerCase();
        if (out.format !== "json" && out.format !== "text") usage();
        i += 1;
        continue;
      }
      if (a === "--help" || a === "-h") usage();
      usage();
    }
    if (!out.url) usage();
    return out;
  }

  if (cmd === "ingest") {
    const filePath = argv[1] ?? null;
    if (!filePath || filePath.startsWith("-")) usage();

    const out = { cmd, filePath, url: null, mode: "auto", tenantId: null, ingestKey: null, contractId: null, format: "json" };
    for (let i = 2; i < argv.length; i += 1) {
      const a = argv[i];
      if (a === "--url") {
        out.url = String(argv[i + 1] ?? "");
        if (!out.url) usage();
        i += 1;
        continue;
      }
      if (a === "--mode") {
        out.mode = String(argv[i + 1] ?? "").toLowerCase();
        if (out.mode !== "auto" && out.mode !== "strict" && out.mode !== "compat") usage();
        i += 1;
        continue;
      }
      if (a === "--tenant") {
        out.tenantId = String(argv[i + 1] ?? "");
        if (!out.tenantId || !/^[a-zA-Z0-9_-]{1,64}$/.test(out.tenantId)) usage();
        i += 1;
        continue;
      }
      if (a === "--ingest-key") {
        out.ingestKey = String(argv[i + 1] ?? "");
        if (!out.ingestKey || !out.ingestKey.startsWith("igk_")) usage();
        i += 1;
        continue;
      }
      if (a === "--contract") {
        out.contractId = String(argv[i + 1] ?? "");
        if (!out.contractId || !/^[a-zA-Z0-9_-]{1,128}$/.test(out.contractId)) usage();
        i += 1;
        continue;
      }
      if (a === "--format") {
        out.format = String(argv[i + 1] ?? "").toLowerCase();
        if (out.format !== "json" && out.format !== "text") usage();
        i += 1;
        continue;
      }
      if (a === "--help" || a === "-h") usage();
      usage();
    }
    if (!out.url || !out.tenantId || !out.ingestKey) usage();
    return out;
  }

  if (cmd === "tenant") {
    const sub = argv[1] ?? null;
    if (!sub) usage();

    const out = { cmd, sub, url: null, tenantId: null, format: "json", defaultMode: null, trustFile: null };
    const start = sub === "trust" ? 3 : 2;
    if (sub === "trust" && argv[2] !== "set") usage();

    for (let i = start; i < argv.length; i += 1) {
      const a = argv[i];
      if (a === "--url") {
        out.url = String(argv[i + 1] ?? "");
        if (!out.url) usage();
        i += 1;
        continue;
      }
      if (a === "--tenant") {
        out.tenantId = String(argv[i + 1] ?? "");
        if (!out.tenantId || !/^[a-zA-Z0-9_-]{1,64}$/.test(out.tenantId)) usage();
        i += 1;
        continue;
      }
      if (a === "--format") {
        out.format = String(argv[i + 1] ?? "").toLowerCase();
        if (out.format !== "json" && out.format !== "text") usage();
        i += 1;
        continue;
      }
      if (a === "--default-mode") {
        out.defaultMode = String(argv[i + 1] ?? "").toLowerCase();
        if (out.defaultMode !== "auto" && out.defaultMode !== "strict" && out.defaultMode !== "compat") usage();
        i += 1;
        continue;
      }
      if (a === "--file") {
        out.trustFile = String(argv[i + 1] ?? "");
        if (!out.trustFile) usage();
        i += 1;
        continue;
      }
      if (a === "--help" || a === "-h") usage();
      usage();
    }

    if (!out.url || !out.tenantId) usage();
    if (sub === "set" && out.defaultMode === null) usage();
    if (sub === "trust" && out.trustFile === null) usage();
    if (sub !== "get" && sub !== "set" && sub !== "trust") usage();
    return out;
  }

  if (cmd === "ingest-key") {
    const sub = argv[1] ?? null;
    if (sub !== "create" && sub !== "revoke") usage();

    const out = { cmd, sub, url: null, tenantId: null, vendorId: null, vendorName: null, expiresAt: null, keyHash: null, reason: null, format: "json" };
    for (let i = 2; i < argv.length; i += 1) {
      const a = argv[i];
      if (a === "--url") {
        out.url = String(argv[i + 1] ?? "");
        if (!out.url) usage();
        i += 1;
        continue;
      }
      if (a === "--tenant") {
        out.tenantId = String(argv[i + 1] ?? "");
        if (!out.tenantId || !/^[a-zA-Z0-9_-]{1,64}$/.test(out.tenantId)) usage();
        i += 1;
        continue;
      }
      if (a === "--vendor") {
        out.vendorId = String(argv[i + 1] ?? "");
        if (!out.vendorId || !/^[a-zA-Z0-9_-]{1,64}$/.test(out.vendorId)) usage();
        i += 1;
        continue;
      }
      if (a === "--vendor-name") {
        out.vendorName = String(argv[i + 1] ?? "");
        if (!out.vendorName) usage();
        i += 1;
        continue;
      }
      if (a === "--expires-at") {
        out.expiresAt = String(argv[i + 1] ?? "");
        if (!out.expiresAt) usage();
        i += 1;
        continue;
      }
      if (a === "--key-hash") {
        out.keyHash = String(argv[i + 1] ?? "").toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(out.keyHash)) usage();
        i += 1;
        continue;
      }
      if (a === "--reason") {
        out.reason = String(argv[i + 1] ?? "");
        if (!out.reason) usage();
        i += 1;
        continue;
      }
      if (a === "--format") {
        out.format = String(argv[i + 1] ?? "").toLowerCase();
        if (out.format !== "json" && out.format !== "text") usage();
        i += 1;
        continue;
      }
      if (a === "--help" || a === "-h") usage();
      usage();
    }
    if (!out.url || !out.tenantId) usage();
    if (sub === "create" && !out.vendorId) usage();
    if (sub === "revoke" && !out.keyHash) usage();
    return out;
  }

  if (cmd === "inbox") {
    const out = { cmd, url: null, tenantId: null, status: null, vendorId: null, contractId: null, from: null, to: null, limit: null, format: "json" };
    for (let i = 1; i < argv.length; i += 1) {
      const a = argv[i];
      if (a === "--url") {
        out.url = String(argv[i + 1] ?? "");
        if (!out.url) usage();
        i += 1;
        continue;
      }
      if (a === "--tenant") {
        out.tenantId = String(argv[i + 1] ?? "");
        if (!out.tenantId || !/^[a-zA-Z0-9_-]{1,64}$/.test(out.tenantId)) usage();
        i += 1;
        continue;
      }
      if (a === "--status") {
        out.status = String(argv[i + 1] ?? "").toLowerCase();
        if (out.status !== "green" && out.status !== "amber" && out.status !== "red" && out.status !== "processing") usage();
        i += 1;
        continue;
      }
      if (a === "--vendor") {
        out.vendorId = String(argv[i + 1] ?? "");
        if (!out.vendorId) usage();
        i += 1;
        continue;
      }
      if (a === "--contract") {
        out.contractId = String(argv[i + 1] ?? "");
        if (!out.contractId) usage();
        i += 1;
        continue;
      }
      if (a === "--from") {
        out.from = String(argv[i + 1] ?? "");
        if (!out.from) usage();
        i += 1;
        continue;
      }
      if (a === "--to") {
        out.to = String(argv[i + 1] ?? "");
        if (!out.to) usage();
        i += 1;
        continue;
      }
      if (a === "--limit") {
        out.limit = Number.parseInt(String(argv[i + 1] ?? ""), 10);
        if (!Number.isInteger(out.limit) || out.limit < 1) usage();
        i += 1;
        continue;
      }
      if (a === "--format") {
        out.format = String(argv[i + 1] ?? "").toLowerCase();
        if (out.format !== "json" && out.format !== "text") usage();
        i += 1;
        continue;
      }
      if (a === "--help" || a === "-h") usage();
      usage();
    }
    if (!out.url || !out.tenantId) usage();
    return out;
  }

  if (cmd === "billing") {
    const sub = argv[1] ?? null;
    if (sub !== "export") usage();

    const out = { cmd, sub, url: null, tenantId: null, month: null, outPath: null, format: "pdf" };
    for (let i = 2; i < argv.length; i += 1) {
      const a = argv[i];
      if (a === "--url") {
        out.url = String(argv[i + 1] ?? "");
        if (!out.url) usage();
        i += 1;
        continue;
      }
      if (a === "--tenant") {
        out.tenantId = String(argv[i + 1] ?? "");
        if (!out.tenantId || !/^[a-zA-Z0-9_-]{1,64}$/.test(out.tenantId)) usage();
        i += 1;
        continue;
      }
      if (a === "--month") {
        out.month = String(argv[i + 1] ?? "");
        if (!/^[0-9]{4}-[0-9]{2}$/.test(out.month)) usage();
        i += 1;
        continue;
      }
      if (a === "--out") {
        out.outPath = String(argv[i + 1] ?? "");
        if (!out.outPath) usage();
        i += 1;
        continue;
      }
      if (a === "--format") {
        out.format = String(argv[i + 1] ?? "").toLowerCase();
        if (out.format !== "pdf" && out.format !== "json") usage();
        i += 1;
        continue;
      }
      if (a === "--help" || a === "-h") usage();
      usage();
    }
    if (!out.url || !out.tenantId) usage();
    if (out.format === "pdf" && !out.outPath) usage();
    return out;
  }

  if (cmd === "vendor") {
    const sub = argv[1] ?? null;
    if (sub !== "pack") usage();

    const out = {
      cmd,
      sub,
      url: null,
      tenantId: null,
      vendorId: null,
      vendorName: null,
      contractId: null,
      expiresAt: null,
      pricingMatrixPath: null,
      pricingSignaturesPath: null,
      outPath: null
    };
    for (let i = 2; i < argv.length; i += 1) {
      const a = argv[i];
      if (a === "--url") {
        out.url = String(argv[i + 1] ?? "");
        if (!out.url) usage();
        i += 1;
        continue;
      }
      if (a === "--tenant") {
        out.tenantId = String(argv[i + 1] ?? "");
        if (!out.tenantId || !/^[a-zA-Z0-9_-]{1,64}$/.test(out.tenantId)) usage();
        i += 1;
        continue;
      }
      if (a === "--vendor") {
        out.vendorId = String(argv[i + 1] ?? "");
        if (!out.vendorId || !/^[a-zA-Z0-9_-]{1,64}$/.test(out.vendorId)) usage();
        i += 1;
        continue;
      }
      if (a === "--vendor-name") {
        out.vendorName = String(argv[i + 1] ?? "");
        if (!out.vendorName) usage();
        i += 1;
        continue;
      }
      if (a === "--contract") {
        out.contractId = String(argv[i + 1] ?? "");
        if (!out.contractId || !/^[a-zA-Z0-9_-]{1,128}$/.test(out.contractId)) usage();
        i += 1;
        continue;
      }
      if (a === "--expires-at") {
        out.expiresAt = String(argv[i + 1] ?? "");
        if (!out.expiresAt) usage();
        i += 1;
        continue;
      }
      if (a === "--pricing-matrix") {
        out.pricingMatrixPath = String(argv[i + 1] ?? "");
        if (!out.pricingMatrixPath) usage();
        i += 1;
        continue;
      }
      if (a === "--pricing-signatures") {
        out.pricingSignaturesPath = String(argv[i + 1] ?? "");
        if (!out.pricingSignaturesPath) usage();
        i += 1;
        continue;
      }
      if (a === "--out") {
        out.outPath = String(argv[i + 1] ?? "");
        if (!out.outPath) usage();
        i += 1;
        continue;
      }
      if (a === "--help" || a === "-h") usage();
      usage();
    }
    if (!out.url || !out.tenantId || !out.vendorId || !out.outPath) usage();
    if ((out.pricingMatrixPath !== null) !== (out.pricingSignaturesPath !== null)) usage();
    return out;
  }

  usage();
}

async function requestJson({ url, method, headers, body }) {
  const u = new URL(url);
  const lib = u.protocol === "https:" ? https : http;
  return await new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80,
        path: u.pathname + u.search,
        method,
        headers
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = raw.trim() ? JSON.parse(raw) : null;
          } catch (err) {
            return reject(new Error(`invalid JSON response (status=${res.statusCode}): ${err?.message ?? String(err ?? "")}\nraw=${raw}`));
          }
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers ?? {}, json });
        });
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

async function requestBytes({ url, method, headers, body }) {
  const u = new URL(url);
  const lib = u.protocol === "https:" ? https : http;
  return await new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80,
        path: u.pathname + u.search,
        method,
        headers
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers ?? {}, body: Buffer.concat(chunks) });
        });
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apiKey = process.env.MAGIC_LINK_API_KEY ? String(process.env.MAGIC_LINK_API_KEY) : null;
  const base = new URL(args.url);

  if (args.cmd === "upload") {
    const buf = await fs.readFile(args.filePath);
    const zipSha256 = sha256Hex(buf);
    const zipBytes = buf.length;

    const uploadUrl = new URL("/v1/upload", base);
    uploadUrl.searchParams.set("mode", args.mode);

    const headers = {
      "content-type": "application/zip",
      "content-length": String(buf.length),
      "x-tenant-id": args.tenantId
    };
    if (apiKey && apiKey.trim()) headers["x-api-key"] = apiKey.trim();

    const res = await requestJson({ url: uploadUrl.toString(), method: "POST", headers, body: buf });
    if (!res.json || typeof res.json !== "object") throw new Error("unexpected response");
    if (res.statusCode !== 200 || res.json.ok !== true) {
      throw new Error(`upload failed (status=${res.statusCode}): ${JSON.stringify(res.json)}`);
    }

    const token = res.json.token ?? null;
    const relativeUrl = res.json.url ?? null;
    const link = relativeUrl ? new URL(String(relativeUrl), base).toString() : null;

    const out = {
      ok: true,
      token,
      url: link,
      zipSha256,
      zipBytes,
      modeResolved: res.json.modeResolved ?? null,
      deduped: Boolean(res.json.deduped),
      rerun: Boolean(res.json.rerun)
    };

    if (args.format === "text") {
      // eslint-disable-next-line no-console
      console.log(link ?? "");
      // eslint-disable-next-line no-console
      console.log(`bundleSha256=${zipSha256} bytes=${zipBytes}`);
      return;
    }
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }

  if (args.cmd === "billing") {
    const month = args.month ?? null;
    const invoiceUrl = new URL(`/v1/tenants/${encodeURIComponent(args.tenantId)}/billing-invoice`, base);
    if (month) invoiceUrl.searchParams.set("month", month);
    invoiceUrl.searchParams.set("format", args.format);

    const headers = {};
    if (apiKey && apiKey.trim()) headers["x-api-key"] = apiKey.trim();

    if (args.format === "json") {
      const res = await requestJson({ url: invoiceUrl.toString(), method: "GET", headers, body: null });
      if (!res.json || typeof res.json !== "object") throw new Error("unexpected response");
      if (res.statusCode !== 200) {
        throw new Error(`billing export failed (status=${res.statusCode}): ${JSON.stringify(res.json)}`);
      }
      process.stdout.write(JSON.stringify(res.json, null, 2) + "\n");
      return;
    }

    const res = await requestBytes({ url: invoiceUrl.toString(), method: "GET", headers, body: null });
    if (res.statusCode !== 200) throw new Error(`billing export failed (status=${res.statusCode})`);
    await fs.writeFile(args.outPath, res.body);
    // eslint-disable-next-line no-console
    console.log(args.outPath);
    return;
  }

  if (args.cmd === "vendor") {
    const base = new URL(args.url);
    const packUrl = new URL(`/v1/tenants/${encodeURIComponent(args.tenantId)}/vendors/${encodeURIComponent(args.vendorId)}/onboarding-pack`, base);

    const bodyJson = {
      vendorName: args.vendorName ?? null,
      contractId: args.contractId ?? null,
      expiresAt: args.expiresAt ?? null,
      pricingMatrixJsonText: null,
      pricingMatrixSignaturesJsonText: null
    };

    if (args.pricingMatrixPath) {
      bodyJson.pricingMatrixJsonText = await fs.readFile(args.pricingMatrixPath, "utf8");
      bodyJson.pricingMatrixSignaturesJsonText = await fs.readFile(args.pricingSignaturesPath, "utf8");
    }

    const body = Buffer.from(JSON.stringify(bodyJson), "utf8");
    const headers = {
      "content-type": "application/json",
      "content-length": String(body.length)
    };
    if (apiKey && apiKey.trim()) headers["x-api-key"] = apiKey.trim();

    const res = await requestBytes({ url: packUrl.toString(), method: "POST", headers, body });
    if (res.statusCode !== 200) throw new Error(`vendor pack failed (status=${res.statusCode}): ${res.body.toString("utf8")}`);
    await fs.writeFile(args.outPath, res.body);
    // eslint-disable-next-line no-console
    console.log(args.outPath);
    return;
  }

  if (args.cmd === "ingest") {
    const buf = await fs.readFile(args.filePath);
    const zipSha256 = sha256Hex(buf);
    const zipBytes = buf.length;

    const ingestUrl = new URL(`/v1/ingest/${encodeURIComponent(args.tenantId)}`, base);
    ingestUrl.searchParams.set("mode", args.mode);
    if (args.contractId) ingestUrl.searchParams.set("contractId", args.contractId);

    const headers = {
      "content-type": "application/zip",
      "content-length": String(buf.length),
      authorization: `Bearer ${args.ingestKey}`
    };

    const res = await requestJson({ url: ingestUrl.toString(), method: "POST", headers, body: buf });
    if (!res.json || typeof res.json !== "object") throw new Error("unexpected response");
    if (res.statusCode !== 200 || res.json.ok !== true) {
      throw new Error(`ingest failed (status=${res.statusCode}): ${JSON.stringify(res.json)}`);
    }

    const token = res.json.token ?? null;
    const relativeUrl = res.json.url ?? null;
    const link = relativeUrl ? new URL(String(relativeUrl), base).toString() : null;

    const out = {
      ok: true,
      token,
      url: link,
      zipSha256,
      zipBytes,
      modeResolved: res.json.modeResolved ?? null,
      deduped: Boolean(res.json.deduped),
      rerun: Boolean(res.json.rerun)
    };
    if (args.format === "text") {
      // eslint-disable-next-line no-console
      console.log(link ?? "");
      // eslint-disable-next-line no-console
      console.log(`bundleSha256=${zipSha256} bytes=${zipBytes}`);
      return;
    }
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }

  if (args.cmd === "tenant") {
    const endpointBase = `/v1/tenants/${encodeURIComponent(args.tenantId)}`;
    const headers = {};
    if (apiKey && apiKey.trim()) headers["x-api-key"] = apiKey.trim();

    if (args.sub === "get") {
      const u = new URL(`${endpointBase}/settings`, base);
      const res = await requestJson({ url: u.toString(), method: "GET", headers });
      if (res.statusCode !== 200 || !res.json || res.json.ok !== true) throw new Error(`tenant get failed (status=${res.statusCode}): ${JSON.stringify(res.json)}`);
      if (args.format === "text") {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(res.json.settings ?? {}, null, 2));
        return;
      }
      process.stdout.write(JSON.stringify(res.json, null, 2) + "\n");
      return;
    }

    if (args.sub === "set") {
      const u = new URL(`${endpointBase}/settings`, base);
      const body = Buffer.from(JSON.stringify({ defaultMode: args.defaultMode }), "utf8");
      const res = await requestJson({
        url: u.toString(),
        method: "PUT",
        headers: { ...headers, "content-type": "application/json; charset=utf-8", "content-length": String(body.length) },
        body
      });
      if (res.statusCode !== 200 || !res.json || res.json.ok !== true) throw new Error(`tenant set failed (status=${res.statusCode}): ${JSON.stringify(res.json)}`);
      if (args.format === "text") {
        // eslint-disable-next-line no-console
        console.log("ok");
        return;
      }
      process.stdout.write(JSON.stringify(res.json, null, 2) + "\n");
      return;
    }

    if (args.sub === "trust") {
      const raw = await fs.readFile(args.trustFile, "utf8");
      const roots = JSON.parse(raw);
      const u = new URL(`${endpointBase}/settings`, base);
      const body = Buffer.from(JSON.stringify({ governanceTrustRootsJson: roots }), "utf8");
      const res = await requestJson({
        url: u.toString(),
        method: "PUT",
        headers: { ...headers, "content-type": "application/json; charset=utf-8", "content-length": String(body.length) },
        body
      });
      if (res.statusCode !== 200 || !res.json || res.json.ok !== true) throw new Error(`tenant trust set failed (status=${res.statusCode}): ${JSON.stringify(res.json)}`);
      if (args.format === "text") {
        // eslint-disable-next-line no-console
        console.log("ok");
        return;
      }
      process.stdout.write(JSON.stringify(res.json, null, 2) + "\n");
      return;
    }
  }

  if (args.cmd === "ingest-key") {
    const headers = {};
    if (apiKey && apiKey.trim()) headers["x-api-key"] = apiKey.trim();

    if (args.sub === "create") {
      const u = new URL(`/v1/tenants/${encodeURIComponent(args.tenantId)}/vendors/${encodeURIComponent(args.vendorId)}/ingest-keys`, base);
      const payload = { vendorName: args.vendorName ?? null, expiresAt: args.expiresAt ?? null };
      const body = Buffer.from(JSON.stringify(payload), "utf8");
      const res = await requestJson({
        url: u.toString(),
        method: "POST",
        headers: { ...headers, "content-type": "application/json; charset=utf-8", "content-length": String(body.length) },
        body
      });
      if (res.statusCode !== 200 || !res.json || res.json.ok !== true) throw new Error(`ingest-key create failed (status=${res.statusCode}): ${JSON.stringify(res.json)}`);
      if (args.format === "text") {
        // eslint-disable-next-line no-console
        console.log(String(res.json.ingestKey ?? ""));
        return;
      }
      process.stdout.write(JSON.stringify(res.json, null, 2) + "\n");
      return;
    }

    if (args.sub === "revoke") {
      const u = new URL(`/v1/tenants/${encodeURIComponent(args.tenantId)}/ingest-keys/${encodeURIComponent(args.keyHash)}/revoke`, base);
      const payload = args.reason ? { reason: args.reason } : {};
      const body = Buffer.from(JSON.stringify(payload), "utf8");
      const res = await requestJson({
        url: u.toString(),
        method: "POST",
        headers: { ...headers, "content-type": "application/json; charset=utf-8", "content-length": String(body.length) },
        body
      });
      if (res.statusCode !== 200 || !res.json || res.json.ok !== true) throw new Error(`ingest-key revoke failed (status=${res.statusCode}): ${JSON.stringify(res.json)}`);
      if (args.format === "text") {
        // eslint-disable-next-line no-console
        console.log("ok");
        return;
      }
      process.stdout.write(JSON.stringify(res.json, null, 2) + "\n");
      return;
    }
  }

  if (args.cmd === "inbox") {
    const headers = { "x-tenant-id": args.tenantId };
    if (apiKey && apiKey.trim()) headers["x-api-key"] = apiKey.trim();

    const u = new URL("/v1/inbox", base);
    if (args.status) u.searchParams.set("status", args.status);
    if (args.vendorId) u.searchParams.set("vendorId", args.vendorId);
    if (args.contractId) u.searchParams.set("contractId", args.contractId);
    if (args.from) u.searchParams.set("from", args.from);
    if (args.to) u.searchParams.set("to", args.to);
    if (args.limit) u.searchParams.set("limit", String(args.limit));

    const res = await requestJson({ url: u.toString(), method: "GET", headers });
    if (res.statusCode !== 200 || !res.json || res.json.ok !== true) throw new Error(`inbox failed (status=${res.statusCode}): ${JSON.stringify(res.json)}`);
    if (args.format === "text") {
      const rows = Array.isArray(res.json.rows) ? res.json.rows : [];
      // eslint-disable-next-line no-console
      for (const r of rows) console.log(`${r.status}\t${r.invoiceId ?? ""}\t${formatMoneyFromCentsString({ currency: r.currency, cents: r.totalCents })}\t${r.url ?? ""}`);
      return;
    }
    process.stdout.write(JSON.stringify(res.json, null, 2) + "\n");
    return;
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(String(err?.stack ?? err?.message ?? err ?? "error"));
  process.exitCode = 1;
});
