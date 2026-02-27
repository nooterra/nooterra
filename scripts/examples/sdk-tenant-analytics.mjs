import { NooterraClient } from "../../packages/api-sdk/src/index.js";

function monthKeyUtcNow() {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function previousMonthKey(monthKey) {
  const m = /^([0-9]{4})-([0-9]{2})$/.exec(String(monthKey ?? "").trim());
  if (!m) return monthKeyUtcNow();
  const year = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const d = new Date(Date.UTC(year, month - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${mm}`;
}

async function main() {
  const baseUrl = process.env.NOOTERRA_BASE_URL ?? "http://127.0.0.1:8787";
  const tenantId = process.env.NOOTERRA_TENANT_ID ?? "tenant_default";
  const apiKey = process.env.NOOTERRA_API_KEY ?? "";
  const xApiKey = process.env.NOOTERRA_X_API_KEY ?? "";
  const month = process.env.NOOTERRA_MONTH ?? monthKeyUtcNow();
  const baseMonth = process.env.NOOTERRA_BASE_MONTH ?? previousMonthKey(month);

  if (!xApiKey) {
    // eslint-disable-next-line no-console
    console.error("NOOTERRA_X_API_KEY is not set; calls will fail unless Magic Link auth is disabled.");
  }

  const client = new NooterraClient({
    baseUrl,
    tenantId,
    apiKey: apiKey || undefined,
    xApiKey: xApiKey || undefined
  });

  const analyticsRes = await client.getTenantAnalytics(tenantId, {
    month,
    bucket: "day",
    limit: 20
  });
  const graphRes = await client.getTenantTrustGraph(tenantId, {
    month,
    minRuns: 1,
    maxEdges: 200
  });
  const snapshotsRes = await client.listTenantTrustGraphSnapshots(tenantId, { limit: 10 });
  const snapshotCreateRes = await client.createTenantTrustGraphSnapshot(tenantId, {
    month,
    minRuns: 1,
    maxEdges: 200
  });
  const diffRes = await client.diffTenantTrustGraph(tenantId, {
    baseMonth,
    compareMonth: month,
    limit: 20,
    minRuns: 1,
    maxEdges: 200
  });

  const report = analyticsRes?.body?.report ?? null;
  const graph = graphRes?.body?.graph ?? null;
  const snapshot = snapshotCreateRes?.body?.snapshot ?? null;
  const diff = diffRes?.body?.diff ?? null;
  const totals = report?.totals ?? null;
  const summary = {
    tenantId,
    month,
    baseMonth,
    analytics: {
      runs: totals?.runs ?? null,
      greenRatePct: totals?.greenRatePct ?? null,
      approvalRatePct: totals?.approvalRatePct ?? null,
      holdRatePct: totals?.holdRatePct ?? null
    },
    trustGraph: {
      nodes: Array.isArray(graph?.nodes) ? graph.nodes.length : null,
      edges: Array.isArray(graph?.edges) ? graph.edges.length : null,
      runs: Number.isFinite(Number(graph?.summary?.runs)) ? Number(graph.summary.runs) : null
    },
    snapshots: {
      listed: Number.isFinite(Number(snapshotsRes?.body?.count)) ? Number(snapshotsRes.body.count) : null,
      createdMonth: typeof snapshot?.month === "string" ? snapshot.month : null,
      createdAt: typeof snapshot?.generatedAt === "string" ? snapshot.generatedAt : null
    },
    diff: {
      nodeChanges: Number.isFinite(Number(diff?.summary?.nodeChanges)) ? Number(diff.summary.nodeChanges) : null,
      edgeChanges: Number.isFinite(Number(diff?.summary?.edgeChanges)) ? Number(diff.summary.edgeChanges) : null,
      added: Number.isFinite(Number(diff?.summary?.added)) ? Number(diff.summary.added) : null,
      removed: Number.isFinite(Number(diff?.summary?.removed)) ? Number(diff.summary.removed) : null,
      changed: Number.isFinite(Number(diff?.summary?.changed)) ? Number(diff.summary.changed) : null
    }
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
