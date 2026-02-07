import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

import { safeTruncate } from "./redaction.js";

const { Client } = pg;

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function cmpString(a, b) {
  const aa = String(a ?? "");
  const bb = String(b ?? "");
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function isRunToken(value) {
  return typeof value === "string" && /^ml_[0-9a-f]{48}$/.test(value);
}

function normalizeRunRecordForList(record, tokenHint = null) {
  if (!isPlainObject(record)) return null;
  const token = isRunToken(record.token) ? record.token : isRunToken(tokenHint) ? tokenHint : null;
  if (!token) return null;
  return { ...record, token };
}

export function runRecordPath({ dataDir, tenantId, token }) {
  return path.join(String(dataDir ?? ""), "runs", String(tenantId ?? "default"), `${String(token ?? "")}.json`);
}

const runStoreModeRaw = String(process.env.MAGIC_LINK_RUN_STORE_MODE ?? "fs").trim().toLowerCase();
const runStoreMode = runStoreModeRaw === "db" || runStoreModeRaw === "dual" ? runStoreModeRaw : "fs";
const runStoreDatabaseUrl = String(process.env.MAGIC_LINK_RUN_STORE_DATABASE_URL ?? process.env.DATABASE_URL ?? "").trim();
const runStoreDbEnabled = runStoreMode !== "fs" && Boolean(runStoreDatabaseUrl);

let pgClientPromise = null;

function hasDbWriteMode() {
  return runStoreDbEnabled && (runStoreMode === "db" || runStoreMode === "dual");
}

function hasFsWriteMode() {
  return runStoreMode === "fs" || runStoreMode === "dual" || !runStoreDbEnabled;
}

async function getPgClient() {
  if (!runStoreDbEnabled) return null;
  if (!pgClientPromise) {
    pgClientPromise = (async () => {
      const client = new Client({ connectionString: runStoreDatabaseUrl });
      await client.connect();
      await client.query(`
        create table if not exists magic_link_run_records_v1 (
          tenant_id text not null,
          token text not null,
          created_at timestamptz null,
          updated_at timestamptz not null default now(),
          verification_status text null,
          evidence_count integer null,
          active_evidence_count integer null,
          sla_compliance_pct integer null,
          template_id text null,
          template_config_hash text null,
          decision text null,
          decision_decided_at timestamptz null,
          decision_decided_by_email text null,
          record_json jsonb not null,
          primary key (tenant_id, token)
        )
      `);
      await client.query(`create index if not exists magic_link_run_records_v1_tenant_created_idx on magic_link_run_records_v1 (tenant_id, created_at desc nulls last)`);
      await client.query(`create index if not exists magic_link_run_records_v1_tenant_status_idx on magic_link_run_records_v1 (tenant_id, verification_status)`);
      return client;
    })();
  }
  try {
    return await pgClientPromise;
  } catch {
    pgClientPromise = null;
    return null;
  }
}

function dbProjectionFromRecord(record) {
  const verification = isPlainObject(record?.verification) ? record.verification : null;
  const closePack = isPlainObject(record?.closePackSummaryV1) ? record.closePackSummaryV1 : null;
  const evidenceIndex = isPlainObject(closePack?.evidenceIndex) ? closePack.evidenceIndex : null;
  const sla = isPlainObject(closePack?.sla) ? closePack.sla : null;
  const decision = isPlainObject(record?.decision) ? record.decision : null;

  const verificationStatus = verification?.ok ? (Array.isArray(verification.warningCodes) && verification.warningCodes.length ? "amber" : "green") : "red";
  const evidenceCount = Number.isInteger(evidenceIndex?.itemCount) ? evidenceIndex.itemCount : null;
  const activeEvidenceCount = Number.isInteger(record?.metering?.evidenceRefsCount) ? record.metering.evidenceRefsCount : evidenceCount;
  const slaCompliancePct = Number.isInteger(sla?.failingClausesCount) ? Math.max(0, 100 - sla.failingClausesCount) : null;

  return {
    verificationStatus,
    evidenceCount,
    activeEvidenceCount,
    slaCompliancePct,
    templateId: typeof record?.templateId === "string" ? record.templateId : null,
    templateConfigHash: typeof record?.templateConfigHash === "string" ? record.templateConfigHash : null,
    decision: typeof decision?.decision === "string" ? decision.decision : null,
    decisionDecidedAt: typeof decision?.decidedAt === "string" ? decision.decidedAt : null,
    decisionDecidedByEmail: typeof decision?.decidedByEmail === "string" ? decision.decidedByEmail : null,
    createdAt: typeof record?.createdAt === "string" ? record.createdAt : null
  };
}

async function upsertRunRecordDbBestEffort({ tenantId, token, record }) {
  const client = await getPgClient();
  if (!client) return { ok: false, skipped: true };
  const proj = dbProjectionFromRecord(record);
  await client.query(
    `
      insert into magic_link_run_records_v1 (
        tenant_id,
        token,
        created_at,
        updated_at,
        verification_status,
        evidence_count,
        active_evidence_count,
        sla_compliance_pct,
        template_id,
        template_config_hash,
        decision,
        decision_decided_at,
        decision_decided_by_email,
        record_json
      ) values ($1,$2,$3,now(),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
      on conflict (tenant_id, token)
      do update set
        created_at = excluded.created_at,
        updated_at = now(),
        verification_status = excluded.verification_status,
        evidence_count = excluded.evidence_count,
        active_evidence_count = excluded.active_evidence_count,
        sla_compliance_pct = excluded.sla_compliance_pct,
        template_id = excluded.template_id,
        template_config_hash = excluded.template_config_hash,
        decision = excluded.decision,
        decision_decided_at = excluded.decision_decided_at,
        decision_decided_by_email = excluded.decision_decided_by_email,
        record_json = excluded.record_json
    `,
    [
      tenantId,
      token,
      proj.createdAt,
      proj.verificationStatus,
      proj.evidenceCount,
      proj.activeEvidenceCount,
      proj.slaCompliancePct,
      proj.templateId,
      proj.templateConfigHash,
      proj.decision,
      proj.decisionDecidedAt,
      proj.decisionDecidedByEmail,
      JSON.stringify(record ?? {})
    ]
  );
  return { ok: true };
}

async function readRunRecordDbBestEffort({ tenantId, token }) {
  const client = await getPgClient();
  if (!client) return null;
  try {
    const out = await client.query(`select record_json from magic_link_run_records_v1 where tenant_id = $1 and token = $2 limit 1`, [tenantId, token]);
    if (!out.rows.length) return null;
    const row = out.rows[0];
    return row?.record_json && typeof row.record_json === "object" && !Array.isArray(row.record_json) ? row.record_json : null;
  } catch {
    return null;
  }
}

async function listTenantRunRecordsDbBestEffort({ tenantId, max }) {
  const client = await getPgClient();
  if (!client) return [];
  try {
    const out = await client.query(
      `select token from magic_link_run_records_v1 where tenant_id = $1 order by created_at asc nulls last, token asc limit $2`,
      [tenantId, Math.max(1, Math.min(200_000, Number.parseInt(String(max ?? "50000"), 10) || 50_000))]
    );
    return out.rows.map((r) => String(r?.token ?? "")).filter((t) => /^ml_[0-9a-f]{48}$/.test(t));
  } catch {
    return [];
  }
}

async function listTenantRunRecordRowsDbBestEffort({ tenantId, max }) {
  const client = await getPgClient();
  if (!client) return [];
  try {
    const out = await client.query(
      `
        select token, record_json
        from magic_link_run_records_v1
        where tenant_id = $1
        order by created_at desc nulls last, token desc
        limit $2
      `,
      [tenantId, Math.max(1, Math.min(200_000, Number.parseInt(String(max ?? "50000"), 10) || 50_000))]
    );
    const rows = [];
    for (const row of out.rows) {
      const rec = normalizeRunRecordForList(row?.record_json, row?.token);
      if (rec) rows.push(rec);
    }
    return rows;
  } catch {
    return [];
  }
}

async function listTenantRunRecordRowsFsBestEffort({ dataDir, tenantId, max }) {
  const dir = path.join(String(dataDir ?? ""), "runs", String(tenantId ?? "default"));
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json")).slice(0, max);
  } catch {
    names = [];
  }
  const rows = [];
  for (const name of names) {
    const token = name.endsWith(".json") ? name.slice(0, -".json".length) : name;
    if (!isRunToken(token)) continue;
    const fp = path.join(dir, name);
    let row = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      row = JSON.parse(await fs.readFile(fp, "utf8"));
    } catch {
      row = null;
    }
    const rec = normalizeRunRecordForList(row, token);
    if (rec) rows.push(rec);
  }
  rows.sort((a, b) => cmpString(b?.createdAt, a?.createdAt) || cmpString(b?.token, a?.token));
  return rows.slice(0, max);
}

export async function writeRunRecordV1({ dataDir, tenantId, token, meta, publicSummary, cliOut, retentionDaysEffective }) {
  const fp = runRecordPath({ dataDir, tenantId, token });
  const existing = await readRunRecordBestEffort({ dataDir, tenantId, token });
  const record = buildRunRecordV1({ token, tenantId, meta, publicSummary, cliOut, retentionDaysEffective, existing });

  if (hasFsWriteMode()) {
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, JSON.stringify(record, null, 2) + "\n", "utf8");
  }
  if (hasDbWriteMode()) {
    try {
      await upsertRunRecordDbBestEffort({ tenantId, token, record });
    } catch {
      // ignore db write failures in best-effort mode
    }
  }
  return record;
}

export async function readRunRecordBestEffort({ dataDir, tenantId, token }) {
  if (runStoreMode === "db" && runStoreDbEnabled) {
    const db = await readRunRecordDbBestEffort({ tenantId, token });
    if (db) return db;
    return null;
  }
  if (runStoreMode === "dual" && runStoreDbEnabled) {
    const db = await readRunRecordDbBestEffort({ tenantId, token });
    if (db) return db;
  }

  const fp = runRecordPath({ dataDir, tenantId, token });
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    if (runStoreMode !== "dual" || !runStoreDbEnabled) return null;
    return await readRunRecordDbBestEffort({ tenantId, token });
  }
}

export async function listTenantRunRecordsBestEffort({ dataDir, tenantId, max = 50_000 } = {}) {
  const limit = Math.max(1, Math.min(200_000, Number.parseInt(String(max ?? "50000"), 10) || 50_000));

  let dbTokens = [];
  if (runStoreMode === "db" || runStoreMode === "dual") dbTokens = await listTenantRunRecordsDbBestEffort({ tenantId, max: limit });

  let fsTokens = [];
  if (runStoreMode === "fs" || runStoreMode === "dual" || !runStoreDbEnabled) {
    const dir = path.join(String(dataDir ?? ""), "runs", String(tenantId ?? "default"));
    let names = [];
    try {
      names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json")).slice(0, limit);
    } catch {
      names = [];
    }
    fsTokens = names
      .map((n) => (n.endsWith(".json") ? n.slice(0, -".json".length) : n))
      .filter((t) => /^ml_[0-9a-f]{48}$/.test(t));
  }

  if (runStoreMode === "db" && runStoreDbEnabled) return dbTokens.slice(0, limit);
  if (runStoreMode === "fs" || !runStoreDbEnabled) return fsTokens.sort().slice(0, limit);

  const merged = [...new Set([...dbTokens, ...fsTokens])].sort();
  return merged.slice(0, limit);
}

export async function listTenantRunRecordRowsBestEffort({ dataDir, tenantId, max = 50_000 } = {}) {
  const limit = Math.max(1, Math.min(200_000, Number.parseInt(String(max ?? "50000"), 10) || 50_000));

  let dbRows = [];
  if (runStoreMode === "db" || runStoreMode === "dual") dbRows = await listTenantRunRecordRowsDbBestEffort({ tenantId, max: limit });

  let fsRows = [];
  if (runStoreMode === "fs" || runStoreMode === "dual" || !runStoreDbEnabled) {
    fsRows = await listTenantRunRecordRowsFsBestEffort({ dataDir, tenantId, max: limit });
  }

  if (runStoreMode === "db" && runStoreDbEnabled) return dbRows.slice(0, limit);
  if (runStoreMode === "fs" || !runStoreDbEnabled) return fsRows.slice(0, limit);

  const out = new Map();
  for (const row of dbRows) out.set(row.token, row);
  for (const row of fsRows) {
    if (!out.has(row.token)) out.set(row.token, row);
  }
  const merged = [...out.values()];
  merged.sort((a, b) => cmpString(b?.createdAt, a?.createdAt) || cmpString(b?.token, a?.token));
  return merged.slice(0, limit);
}

export async function updateRunRecordDecisionBestEffort({ dataDir, tenantId, token, decisionReport }) {
  if (!isPlainObject(decisionReport)) return { ok: false, skipped: true };
  const cur = await readRunRecordBestEffort({ dataDir, tenantId, token });
  if (!isPlainObject(cur)) return { ok: false, skipped: true };

  const updated = { ...cur };
  updated.decision = {
    schemaVersion: "MagicLinkDecisionSummary.v1",
    decision: typeof decisionReport.decision === "string" ? safeTruncate(decisionReport.decision, { max: 64 }) : null,
    decidedAt: typeof decisionReport.decidedAt === "string" ? safeTruncate(decisionReport.decidedAt, { max: 500 }) : null,
    decidedByEmail: typeof decisionReport?.actor?.email === "string" ? safeTruncate(decisionReport.actor.email, { max: 320 }) : null
  };

  const fp = runRecordPath({ dataDir, tenantId, token });
  if (hasFsWriteMode()) {
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, JSON.stringify(updated, null, 2) + "\n", "utf8");
  }
  if (hasDbWriteMode()) {
    try {
      await upsertRunRecordDbBestEffort({ tenantId, token, record: updated });
    } catch {
      // ignore
    }
  }
  return { ok: true };
}

export async function deleteRunRecordBestEffort({ dataDir, tenantId, token, deleteFs = false }) {
  const fp = runRecordPath({ dataDir, tenantId, token });
  if (deleteFs && hasFsWriteMode()) {
    try {
      await fs.rm(fp, { force: true });
    } catch {
      // ignore
    }
  }
  if (hasDbWriteMode()) {
    try {
      const client = await getPgClient();
      if (client) await client.query(`delete from magic_link_run_records_v1 where tenant_id = $1 and token = $2`, [tenantId, token]);
    } catch {
      // ignore
    }
  }
  return { ok: true };
}

export async function migrateRunRecordsFromFsToDbBestEffort({ dataDir, tenantIds = null, max = 500_000 } = {}) {
  if (!hasDbWriteMode()) return { ok: false, skipped: true, reason: "DB_DISABLED" };
  const tenants = Array.isArray(tenantIds) && tenantIds.length
    ? tenantIds.map((x) => String(x ?? "").trim()).filter(Boolean)
    : await (async () => {
      try {
        const dir = path.join(String(dataDir ?? ""), "runs");
        const names = await fs.readdir(dir, { withFileTypes: true });
        return names.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        return [];
      }
    })();
  let migrated = 0;
  let skipped = 0;
  for (const tenantId of tenants) {
    const dir = path.join(String(dataDir ?? ""), "runs", tenantId);
    let names = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json")).sort();
    } catch {
      names = [];
    }
    const tokens = names.map((n) => n.slice(0, -".json".length)).filter((t) => /^ml_[0-9a-f]{48}$/.test(t));
    for (const token of tokens) {
      if (migrated + skipped >= max) break;
      // eslint-disable-next-line no-await-in-loop
      const fp = runRecordPath({ dataDir, tenantId, token });
      let row = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        row = JSON.parse(await fs.readFile(fp, "utf8"));
      } catch {
        row = null;
      }
      if (!isPlainObject(row)) {
        skipped += 1;
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await upsertRunRecordDbBestEffort({ tenantId, token, record: row });
        migrated += 1;
      } catch {
        skipped += 1;
      }
    }
  }
  return { ok: true, migrated, skipped };
}

export function runStoreModeInfo() {
  return { mode: runStoreMode, dbEnabled: runStoreDbEnabled, databaseConfigured: Boolean(runStoreDatabaseUrl) };
}

function buildRunRecordV1({ token, tenantId, meta, publicSummary, cliOut, retentionDaysEffective, existing }) {
  const pub = isPlainObject(publicSummary) ? publicSummary : {};
  const m = isPlainObject(meta) ? meta : {};
  const ex = isPlainObject(existing) ? existing : null;

  const errorCodes = Array.isArray(pub?.verification?.errorCodes) ? pub.verification.errorCodes.map(String).filter(Boolean) : [];
  const warningCodes = Array.isArray(pub?.verification?.warningCodes) ? pub.verification.warningCodes.map(String).filter(Boolean) : [];

  const out = {
    schemaVersion: "MagicLinkRunRecord.v1",
    token: typeof token === "string" ? token : null,
    tenantId: typeof tenantId === "string" ? tenantId : null,
    createdAt: typeof m.createdAt === "string" ? m.createdAt : typeof pub.createdAt === "string" ? pub.createdAt : null,
    startedAt: typeof m.startedAt === "string" ? m.startedAt : null,
    finishedAt: typeof m.finishedAt === "string" ? m.finishedAt : null,
    durationMs: Number.isFinite(Number(m.durationMs)) ? Number(m.durationMs) : null,
    retentionDaysEffective: Number.isInteger(retentionDaysEffective) ? retentionDaysEffective : null,
    vendorId: typeof m.vendorId === "string" ? safeTruncate(m.vendorId, { max: 128 }) : typeof pub.vendorId === "string" ? safeTruncate(pub.vendorId, { max: 128 }) : null,
    vendorName: typeof m.vendorName === "string" ? safeTruncate(m.vendorName, { max: 500 }) : typeof pub.vendorName === "string" ? safeTruncate(pub.vendorName, { max: 500 }) : null,
    runId: typeof m.runId === "string" ? safeTruncate(m.runId, { max: 128 }) : typeof pub.runId === "string" ? safeTruncate(pub.runId, { max: 128 }) : null,
    contractId: typeof m.contractId === "string" ? safeTruncate(m.contractId, { max: 128 }) : typeof pub.contractId === "string" ? safeTruncate(pub.contractId, { max: 128 }) : null,
    templateId: typeof m.templateId === "string" ? safeTruncate(m.templateId, { max: 128 }) : typeof pub.templateId === "string" ? safeTruncate(pub.templateId, { max: 128 }) : null,
    zipSha256: typeof m.zipSha256 === "string" ? m.zipSha256 : typeof pub.zipSha256 === "string" ? pub.zipSha256 : null,
    zipBytes: Number.isFinite(Number(m.zipBytes)) ? Number(m.zipBytes) : Number.isFinite(Number(pub.zipBytes)) ? Number(pub.zipBytes) : null,
    modeRequested: typeof m.modeRequested === "string" ? safeTruncate(m.modeRequested, { max: 16 }) : typeof pub.modeRequested === "string" ? safeTruncate(pub.modeRequested, { max: 16 }) : null,
    modeResolved: typeof m.modeResolved === "string" ? safeTruncate(m.modeResolved, { max: 16 }) : typeof pub.modeResolved === "string" ? safeTruncate(pub.modeResolved, { max: 16 }) : null,
    policySource: typeof m.policySource === "string" ? safeTruncate(m.policySource, { max: 64 }) : typeof pub.policySource === "string" ? safeTruncate(pub.policySource, { max: 64 }) : null,
    policySetHash: typeof m.policySetHash === "string" ? safeTruncate(m.policySetHash, { max: 128 }) : typeof pub.policySetHash === "string" ? safeTruncate(pub.policySetHash, { max: 128 }) : null,
    trustSetHash: typeof m.trustSetHash === "string" ? safeTruncate(m.trustSetHash, { max: 128 }) : null,
    pricingTrustSetHash: typeof m.pricingTrustSetHash === "string" ? safeTruncate(m.pricingTrustSetHash, { max: 128 }) : null,
    verification: {
      ok: Boolean(pub?.verification?.ok),
      verificationOk: Boolean(pub?.verification?.verificationOk),
      errorCodes: errorCodes.map((c) => safeTruncate(c, { max: 200 })).slice(0, 200),
      warningCodes: warningCodes.map((c) => safeTruncate(c, { max: 200 })).slice(0, 200),
      tool: isPlainObject(cliOut?.tool)
        ? {
            name: typeof cliOut.tool.name === "string" ? safeTruncate(cliOut.tool.name, { max: 64 }) : null,
            version: typeof cliOut.tool.version === "string" ? safeTruncate(cliOut.tool.version, { max: 64 }) : null,
            commit: typeof cliOut.tool.commit === "string" ? safeTruncate(cliOut.tool.commit, { max: 64 }) : null
          }
        : null
    },
    bundle: isPlainObject(pub?.bundle) ? pub.bundle : null,
    pricingMatrixSignatures: isPlainObject(pub?.pricingMatrixSignatures) ? pub.pricingMatrixSignatures : null,
    closePackSummaryV1: isPlainObject(pub?.closePackSummaryV1) ? pub.closePackSummaryV1 : null,
    invoiceClaim: isPlainObject(pub?.invoiceClaim) ? pub.invoiceClaim : null,
    metering: isPlainObject(pub?.metering) ? pub.metering : null,
    receiptPresent: Boolean(pub?.receiptPresent)
  };
  if (ex && isPlainObject(ex.decision)) out.decision = ex.decision;
  return out;
}
