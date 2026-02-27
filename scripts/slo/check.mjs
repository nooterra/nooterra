import assert from "node:assert/strict";
import fs from "node:fs/promises";

const SLO_CHECK_SCHEMA_VERSION = "OperationalSloCheck.v1";

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function assertFiniteNumber(n, name) {
  if (!Number.isFinite(n)) throw new TypeError(`${name} must be finite`);
}

export function parseSloThresholds(env = process.env) {
  return {
    maxHttp5xxTotal: Number(env.SLO_MAX_HTTP_5XX_TOTAL ?? "0"),
    maxOutboxPending: Number(env.SLO_MAX_OUTBOX_PENDING ?? "200"),
    maxDeliveryDlq: Number(env.SLO_MAX_DELIVERY_DLQ ?? "0"),
    maxDeliveriesPending: Number(env.SLO_MAX_DELIVERIES_PENDING ?? "0"),
    maxDeliveriesFailed: Number(env.SLO_MAX_DELIVERIES_FAILED ?? "0")
  };
}

export function validateSloThresholds(thresholds) {
  for (const [k, v] of [
    ["SLO_MAX_HTTP_5XX_TOTAL", thresholds.maxHttp5xxTotal],
    ["SLO_MAX_OUTBOX_PENDING", thresholds.maxOutboxPending],
    ["SLO_MAX_DELIVERY_DLQ", thresholds.maxDeliveryDlq],
    ["SLO_MAX_DELIVERIES_PENDING", thresholds.maxDeliveriesPending],
    ["SLO_MAX_DELIVERIES_FAILED", thresholds.maxDeliveriesFailed]
  ]) {
    assertFiniteNumber(v, k);
    if (v < 0) throw new TypeError(`${k} must be >= 0`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextWithTimeout(url, timeoutMs = 5000, { headers } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function unescapeLabelValue(value) {
  return String(value).replaceAll("\\\\", "\\").replaceAll("\\n", "\n").replaceAll('\\"', '"');
}

function parseLabels(src) {
  const labels = {};
  let i = 0;
  while (i < src.length) {
    while (i < src.length && (src[i] === " " || src[i] === ",")) i += 1;
    if (i >= src.length) break;
    let key = "";
    while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) {
      key += src[i];
      i += 1;
    }
    while (i < src.length && src[i] === " ") i += 1;
    if (src[i] !== "=") break;
    i += 1;
    while (i < src.length && src[i] === " ") i += 1;
    if (src[i] !== '"') break;
    i += 1;
    let value = "";
    while (i < src.length) {
      const ch = src[i];
      if (ch === '"') {
        i += 1;
        break;
      }
      if (ch === "\\") {
        const next = src[i + 1];
        if (next === "n") {
          value += "\n";
          i += 2;
          continue;
        }
        if (next === "\\" || next === '"') {
          value += next;
          i += 2;
          continue;
        }
      }
      value += ch;
      i += 1;
    }
    labels[key] = unescapeLabelValue(value);
    while (i < src.length && src[i] !== ",") i += 1;
    if (src[i] === ",") i += 1;
  }
  return labels;
}

export function parsePrometheusText(text) {
  const series = [];
  const lines = String(text ?? "").split("\n");
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?|NaN|Inf|-Inf)\s*$/.exec(line);
    if (!m) continue;
    const name = m[1];
    const labelsRaw = m[2] ?? "";
    const value = Number(m[3]);
    const labels = labelsRaw.startsWith("{") ? parseLabels(labelsRaw.slice(1, -1)) : {};
    series.push({ name, labels, value });
  }
  return series;
}

export function sumWhere(series, { name, where = () => true } = {}) {
  let sum = 0;
  for (const sample of series) {
    if (sample.name !== name) continue;
    if (!where(sample.labels, sample.value)) continue;
    const value = Number(sample.value);
    if (!Number.isFinite(value)) continue;
    sum += value;
  }
  return sum;
}

export function getOne(series, { name, where = () => true } = {}) {
  for (const sample of series) {
    if (sample.name !== name) continue;
    if (!where(sample.labels, sample.value)) continue;
    return Number(sample.value);
  }
  return null;
}

export function collectOperationalSloSummary(series) {
  const http5xxTotal = sumWhere(series, {
    name: "http_requests_total",
    where: (labels) => typeof labels.status === "string" && labels.status.startsWith("5")
  });
  const outboxPending = sumWhere(series, { name: "outbox_pending_gauge" });
  const deliveryDlq = sumWhere(series, { name: "delivery_dlq_pending_total_gauge" });
  const deliveriesPending = sumWhere(series, {
    name: "deliveries_pending_gauge",
    where: (labels) => labels.state === "pending"
  });
  const deliveriesFailed = sumWhere(series, {
    name: "deliveries_pending_gauge",
    where: (labels) => labels.state === "failed"
  });
  return {
    http5xxTotal,
    outboxPending,
    deliveryDlq,
    deliveriesPending,
    deliveriesFailed
  };
}

export function assertOperationalSlo(summary, thresholds) {
  assert.ok(
    summary.http5xxTotal <= thresholds.maxHttp5xxTotal,
    `SLO breach: http 5xx total ${summary.http5xxTotal} > ${thresholds.maxHttp5xxTotal}`
  );
  assert.ok(
    summary.outboxPending <= thresholds.maxOutboxPending,
    `SLO breach: outbox pending ${summary.outboxPending} > ${thresholds.maxOutboxPending}`
  );
  assert.ok(
    summary.deliveryDlq <= thresholds.maxDeliveryDlq,
    `SLO breach: delivery DLQ ${summary.deliveryDlq} > ${thresholds.maxDeliveryDlq}`
  );
  assert.ok(
    summary.deliveriesPending <= thresholds.maxDeliveriesPending,
    `SLO breach: deliveries pending ${summary.deliveriesPending} > ${thresholds.maxDeliveriesPending}`
  );
  assert.ok(
    summary.deliveriesFailed <= thresholds.maxDeliveriesFailed,
    `SLO breach: deliveries failed ${summary.deliveriesFailed} > ${thresholds.maxDeliveriesFailed}`
  );
}

export function buildMetricsRequestHeaders(env = process.env) {
  const headers = {};
  const opsToken = normalizeOptionalString(env.SLO_METRICS_OPS_TOKEN);
  const tenantId = normalizeOptionalString(env.SLO_METRICS_TENANT_ID);
  const protocol = normalizeOptionalString(env.SLO_METRICS_PROTOCOL);
  if (opsToken) headers["x-proxy-ops-token"] = opsToken;
  if (tenantId) headers["x-proxy-tenant-id"] = tenantId;
  if (protocol) headers["x-nooterra-protocol"] = protocol;
  return headers;
}

export async function loadMetricsText({
  metricsFile = null,
  apiBaseUrl = "http://127.0.0.1:3000",
  metricsPath = "/metrics",
  requestHeaders = {},
  flushDelayMs = 250
} = {}) {
  if (metricsFile) {
    return await fs.readFile(metricsFile, "utf8");
  }
  await sleep(flushDelayMs);
  const response = await fetchTextWithTimeout(`${apiBaseUrl}${metricsPath}`, 10_000, { headers: requestHeaders });
  assert.equal(response.status, 200, `GET ${metricsPath} failed: http ${response.status}`);
  return response.text;
}

export async function runSloCheck({ env = process.env } = {}) {
  const thresholds = parseSloThresholds(env);
  validateSloThresholds(thresholds);
  const metricsFile = normalizeOptionalString(env.SLO_METRICS_FILE);
  const metricsText = await loadMetricsText({
    metricsFile,
    apiBaseUrl: env.SLO_API_BASE_URL ?? "http://127.0.0.1:3000",
    metricsPath: env.SLO_METRICS_PATH ?? "/metrics",
    requestHeaders: buildMetricsRequestHeaders(env)
  });
  const series = parsePrometheusText(metricsText);
  const summary = collectOperationalSloSummary(series);
  assertOperationalSlo(summary, thresholds);
  return summary;
}

async function main() {
  const summary = await runSloCheck({ env: process.env });
  console.log(JSON.stringify({ schemaVersion: SLO_CHECK_SCHEMA_VERSION, slo: summary }));
}

const isDirectExecution = (() => {
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
    process.exit(1);
  });
}
