import fs from "node:fs/promises";
import path from "node:path";

import { effectiveRetentionDaysForRun } from "./policy.js";
import { deleteRunRecordBestEffort } from "./run-records.js";

function isPastRetention(createdAtIso, retentionDays) {
  const createdMs = Date.parse(String(createdAtIso ?? ""));
  if (!Number.isFinite(createdMs)) return true;
  const days = Number.isInteger(retentionDays) ? retentionDays : 30;
  return Date.now() > createdMs + days * 24 * 3600 * 1000;
}

async function loadMeta({ dataDir, token }) {
  const fp = path.join(dataDir, "meta", `${token}.json`);
  const raw = await fs.readFile(fp, "utf8");
  return JSON.parse(raw);
}

export async function deleteTokenFilesBestEffort({ dataDir, token, meta }) {
  const paths = [];
  const zipPath = typeof meta?.zipPath === "string" ? meta.zipPath : path.join(dataDir, "zips", `${token}.zip`);
  const verifyJsonPath = typeof meta?.verifyJsonPath === "string" ? meta.verifyJsonPath : path.join(dataDir, "verify", `${token}.json`);
  const metaPath = path.join(dataDir, "meta", `${token}.json`);
  const publicJsonPath = typeof meta?.publicJsonPath === "string" ? meta.publicJsonPath : path.join(dataDir, "public", `${token}.json`);
  const receiptJsonPath = typeof meta?.receiptJsonPath === "string" ? meta.receiptJsonPath : path.join(dataDir, "receipt", `${token}.json`);
  const summaryPdfPath = typeof meta?.summaryPdfPath === "string" ? meta.summaryPdfPath : path.join(dataDir, "pdf", `${token}.pdf`);
  const decisionPath = path.join(dataDir, "decisions", `${token}.json`);
  const settlementDecisionsDir = path.join(dataDir, "settlement_decisions", token);
  const closePackDir = typeof meta?.closePackDir === "string" ? meta.closePackDir : path.join(dataDir, "closepack", token);
  const approvalClosePackZipPath =
    typeof meta?.approvalClosePackZipPath === "string" ? meta.approvalClosePackZipPath : path.join(dataDir, "closepack_exports", `${token}.zip`);

  // Delete blobs first, then metadata/index surfaces.
  paths.push(zipPath, closePackDir, approvalClosePackZipPath, verifyJsonPath, summaryPdfPath, receiptJsonPath, decisionPath, settlementDecisionsDir, publicJsonPath, metaPath);

  // Webhook delivery records are stored outside per-run meta paths; remove attempts/records for this token.
  for (const sub of ["attempts", "record"]) {
    const dir = path.join(dataDir, "webhooks", sub);
    let names = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json") && n.startsWith(`${token}_`));
    } catch {
      names = [];
    }
    for (const name of names) {
      const fp = path.join(dir, name);
      try {
        // eslint-disable-next-line no-await-in-loop
        await fs.rm(fp, { force: true });
      } catch {
        // ignore
      }
    }
  }

  // Persistent webhook retry queue entries can outlive retention windows;
  // remove jobs that target this token from pending/dead-letter buckets.
  for (const sub of ["pending", "dead-letter"]) {
    const dir = path.join(dataDir, "webhook_retry", sub);
    let names = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json") && n.includes(`_${token}_`));
    } catch {
      names = [];
    }
    for (const name of names) {
      const fp = path.join(dir, name);
      try {
        // eslint-disable-next-line no-await-in-loop
        await fs.rm(fp, { force: true });
      } catch {
        // ignore
      }
    }
  }

  for (const p of paths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(p, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

export async function listTenantIdsWithIndex({ dataDir, max = 10_000 } = {}) {
  const idxRoot = path.join(dataDir, "index");
  let entries = [];
  try {
    entries = await fs.readdir(idxRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const tenants = entries.filter((e) => e.isDirectory()).map((e) => e.name).slice(0, max);
  tenants.sort();
  return tenants;
}

export async function garbageCollectTenantByRetention({ dataDir, tenantId, tenantSettings }) {
  const idxDir = path.join(dataDir, "index", tenantId);
  let names = [];
  try {
    names = (await fs.readdir(idxDir)).filter((n) => n.endsWith(".json"));
  } catch {
    return { ok: true, deleted: 0, kept: 0 };
  }
  let deleted = 0;
  let kept = 0;
  for (const name of names) {
    const fp = path.join(idxDir, name);
    let idx = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      idx = JSON.parse(await fs.readFile(fp, "utf8"));
    } catch {
      idx = null;
    }
    const token = typeof idx?.token === "string" ? idx.token : null;
    if (!token || !/^ml_[0-9a-f]{48}$/.test(token)) {
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(fp, { force: true });
      deleted += 1;
      continue;
    }
    let meta = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      meta = await loadMeta({ dataDir, token });
    } catch {
      meta = null;
    }
    const retentionDays = meta
      ? effectiveRetentionDaysForRun({
          tenantSettings,
          vendorId: typeof meta.vendorId === "string" ? meta.vendorId : null,
          contractId: typeof meta.contractId === "string" ? meta.contractId : null
        })
      : Number.isInteger(tenantSettings?.retentionDays)
        ? tenantSettings.retentionDays
        : 30;
    if (!meta || isPastRetention(meta.createdAt, retentionDays)) {
      // eslint-disable-next-line no-await-in-loop
      await deleteTokenFilesBestEffort({ dataDir, token, meta });
      // eslint-disable-next-line no-await-in-loop
      await deleteRunRecordBestEffort({ dataDir, tenantId, token });
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(fp, { force: true });
      deleted += 1;
      continue;
    }
    kept += 1;
  }
  return { ok: true, deleted, kept };
}
