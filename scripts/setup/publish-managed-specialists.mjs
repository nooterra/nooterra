#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function readArg(name) {
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === name) return argv[index + 1] ?? null;
    if (value.startsWith(`${name}=`)) return value.slice(name.length + 1);
  }
  return null;
}

function parseRepeatedArg(name) {
  const out = [];
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === name) {
      if (argv[index + 1]) out.push(argv[index + 1]);
      continue;
    }
    if (value.startsWith(`${name}=`)) out.push(value.slice(name.length + 1));
  }
  return out.flatMap((value) => String(value).split(",")).map((value) => value.trim()).filter(Boolean);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`${name} is required`);
  }
  return String(value).trim();
}

function normalizeBaseUrl(value, name) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`${name} is required`);
  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

async function requestJson(url) {
  const response = await fetch(url, { method: "GET" });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    throw new Error(
      parsed && typeof parsed === "object"
        ? String(parsed.message ?? parsed.error ?? `HTTP ${response.status}`)
        : String(parsed ?? `HTTP ${response.status}`)
    );
  }
  return parsed;
}

async function requestJsonWithHeaders(url, { method = "GET", headers = {} } = {}) {
  const response = await fetch(url, { method, headers });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    throw new Error(
      parsed && typeof parsed === "object"
        ? String(parsed.message ?? parsed.error ?? `HTTP ${response.status}`)
        : String(parsed ?? `HTTP ${response.status}`)
    );
  }
  return parsed;
}

function runNode(args, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function parseJsonOutput(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

async function main() {
  const apiUrl = normalizeBaseUrl(process.env.NOOTERRA_BASE_URL ?? readArg("--api-url") ?? "http://127.0.0.1:3000", "api url");
  const tenantId = requireEnv("NOOTERRA_TENANT_ID");
  const catalogBaseUrl = normalizeBaseUrl(
    process.env.NOOTERRA_MANAGED_SPECIALIST_BASE_URL ?? readArg("--catalog-url") ?? "",
    "catalog url"
  );
  const publishProofKeyFile = String(process.env.NOOTERRA_PROVIDER_PUBLISH_PROOF_KEY_FILE ?? readArg("--publish-proof-key-file") ?? "").trim();
  const publishProofKeyPem = String(process.env.NOOTERRA_PROVIDER_PUBLISH_PROOF_KEY_PEM ?? readArg("--publish-proof-key-pem") ?? "").trim();
  const opsToken = String(process.env.NOOTERRA_OPS_TOKEN ?? readArg("--ops-token") ?? "").trim();
  const allowFail = process.argv.includes("--allow-fail");
  const dryRun = process.argv.includes("--dry-run");
  const verifyApiStatus = process.argv.includes("--verify-api-status");
  const apiKey = dryRun ? null : requireEnv("NOOTERRA_API_KEY");
  const requestedProfileIds = new Set(parseRepeatedArg("--profile"));
  const jsonOut = String(readArg("--json-out") ?? "").trim();

  if (!dryRun && !publishProofKeyFile && !publishProofKeyPem) {
    throw new Error("publish proof key material is required unless --dry-run is used");
  }
  if (verifyApiStatus && !opsToken) {
    throw new Error("ops token is required when --verify-api-status is used");
  }

  const catalog = await requestJson(`${catalogBaseUrl}/.well-known/managed-specialists.json`);
  const specialists = Array.isArray(catalog?.specialists) ? catalog.specialists : [];
  const selected = specialists.filter((entry) => requestedProfileIds.size === 0 || requestedProfileIds.has(String(entry?.profileId ?? "")));

  const result = {
    schemaVersion: "ManagedSpecialistPublishResult.v1",
    tenantId,
    apiUrl,
    catalogBaseUrl,
    dryRun,
    verifyApiStatus,
    specialists: []
  };

  if (dryRun) {
    result.specialists = selected.map((entry) => ({
      profileId: entry?.profileId ?? null,
      providerId: entry?.providerId ?? null,
      paidPath: entry?.paidPath ?? null,
      baseUrl: entry?.providerDraft?.baseUrl ?? null,
      manifestHash: entry?.manifest?.manifestHash ?? null,
      toolId: entry?.toolId ?? null
    }));
    const payload = `${JSON.stringify(result, null, 2)}\n`;
    if (jsonOut) fs.writeFileSync(path.resolve(process.cwd(), jsonOut), payload, "utf8");
    process.stdout.write(payload);
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nooterra-managed-specialists-"));
  try {
    for (const entry of selected) {
      const profileId = String(entry?.profileId ?? "").trim();
      const manifest = entry?.manifest;
      const baseUrl = String(entry?.providerDraft?.baseUrl ?? "").trim();
      if (!profileId || !manifest || typeof manifest !== "object" || !baseUrl) {
        throw new Error(`managed specialist catalog entry is incomplete for ${profileId || "unknown"}`);
      }
      const manifestPath = path.join(tmpDir, `${profileId}.manifest.json`);
      const publicationPath = path.join(tmpDir, `${profileId}.publication.json`);
      const conformancePath = path.join(tmpDir, `${profileId}.conformance.json`);
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      const args = [
        "scripts/provider/publish.mjs",
        "--manifest",
        manifestPath,
        "--base-url",
        baseUrl,
        "--api-url",
        apiUrl,
        "--api-key",
        apiKey,
        "--tenant-id",
        tenantId,
        "--json-out",
        publicationPath,
        "--conformance-json-out",
        conformancePath
      ];
      if (publishProofKeyFile) {
        args.push("--publish-proof-key-file", publishProofKeyFile);
      } else if (publishProofKeyPem) {
        args.push("--publish-proof-key-pem", publishProofKeyPem);
      }
      if (allowFail) args.push("--allow-fail");
      const run = await runNode(args);
      const parsed = parseJsonOutput(run.stdout);
      result.specialists.push({
        profileId,
        providerId: entry?.providerId ?? null,
        exitCode: run.code,
        output: parsed,
        publicationPath,
        conformancePath,
        stderr: run.stderr.trim() || null
      });
      if (run.code !== 0 && !allowFail) {
        const payload = `${JSON.stringify(result, null, 2)}\n`;
        if (jsonOut) fs.writeFileSync(path.resolve(process.cwd(), jsonOut), payload, "utf8");
        process.stdout.write(payload);
        process.exit(run.code || 1);
      }
    }
  } finally {
    // keep temp artifacts only when explicitly persisted through json-out paths
  }

  if (verifyApiStatus) {
    const apiStatus = await requestJsonWithHeaders(`${apiUrl}/ops/network/managed-specialists`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${opsToken}`,
        "x-proxy-tenant-id": tenantId
      }
    });
    const managedSpecialists =
      apiStatus?.managedSpecialists && typeof apiStatus.managedSpecialists === "object" && !Array.isArray(apiStatus.managedSpecialists)
        ? apiStatus.managedSpecialists
        : null;
    const specialistRows = Array.isArray(managedSpecialists?.specialists) ? managedSpecialists.specialists : [];
    const expectedProfileIds = selected.map((entry) => String(entry?.profileId ?? "").trim()).filter(Boolean);
    const blockedProfiles = specialistRows
      .filter((row) => expectedProfileIds.includes(String(row?.profileId ?? "").trim()) && row?.readiness?.invocationReady !== true)
      .map((row) => ({
        profileId: row?.profileId ?? null,
        gaps: Array.isArray(row?.readiness?.gaps) ? row.readiness.gaps : []
      }));
    const missingProfiles = expectedProfileIds.filter(
      (profileId) => !specialistRows.some((row) => String(row?.profileId ?? "").trim() === profileId)
    );
    result.apiStatus = {
      schemaVersion: "ManagedSpecialistPublishApiStatus.v1",
      summary:
        managedSpecialists?.summary && typeof managedSpecialists.summary === "object" && !Array.isArray(managedSpecialists.summary)
          ? managedSpecialists.summary
          : null,
      missingProfiles,
      blockedProfiles
    };
    if ((missingProfiles.length > 0 || blockedProfiles.length > 0) && !allowFail) {
      const payload = `${JSON.stringify(result, null, 2)}\n`;
      if (jsonOut) fs.writeFileSync(path.resolve(process.cwd(), jsonOut), payload, "utf8");
      process.stdout.write(payload);
      process.exit(1);
    }
  }

  const payload = `${JSON.stringify(result, null, 2)}\n`;
  if (jsonOut) fs.writeFileSync(path.resolve(process.cwd(), jsonOut), payload, "utf8");
  process.stdout.write(payload);
}

main().catch((err) => {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: false,
        code: "MANAGED_SPECIALIST_PUBLISH_FAILED",
        message: err?.message ?? String(err ?? "")
      },
      null,
      2
    )}\n`
  );
  process.exit(1);
});
