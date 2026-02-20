import { useCallback, useEffect, useMemo, useState } from "react";

const DEFAULT_BASE_URL = typeof import.meta !== "undefined" && import.meta.env?.VITE_SETTLD_API_BASE_URL
  ? String(import.meta.env.VITE_SETTLD_API_BASE_URL)
  : "/__settld";

const STORAGE_KEY = "settld_operator_console_config_v1";
const STATUS_OPTIONS = ["all", "pending", "approved", "denied"];

function loadSavedConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() !== "" ? parsed.baseUrl.trim() : DEFAULT_BASE_URL,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      tenantId: typeof parsed.tenantId === "string" && parsed.tenantId.trim() !== "" ? parsed.tenantId.trim() : "tenant_default",
      protocol: typeof parsed.protocol === "string" && parsed.protocol.trim() !== "" ? parsed.protocol.trim() : "1.0"
    };
  } catch {
    return null;
  }
}

function toIso(value) {
  const ms = Date.parse(String(value ?? ""));
  if (!Number.isFinite(ms)) return "n/a";
  return new Date(ms).toLocaleString();
}

function headersFor({ tenantId, protocol, apiKey }) {
  const out = {
    "content-type": "application/json",
    "x-proxy-tenant-id": tenantId,
    "x-settld-protocol": protocol
  };
  if (apiKey && apiKey.trim() !== "") out.authorization = `Bearer ${apiKey.trim()}`;
  return out;
}

async function requestJson({ baseUrl, pathname, method = "GET", headers, body = null }) {
  const url = `${String(baseUrl).replace(/\/$/, "")}${pathname}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const message = typeof parsed === "object" && parsed !== null
      ? String(parsed?.message ?? parsed?.error ?? `HTTP ${res.status}`)
      : String(parsed ?? `HTTP ${res.status}`);
    throw new Error(message);
  }
  return parsed;
}

function statusTone(status) {
  const value = String(status ?? "").toLowerCase();
  if (value === "pending") return "badge badge-pending";
  if (value === "approved") return "badge badge-approved";
  if (value === "denied") return "badge badge-denied";
  return "badge";
}

export default function OperatorDashboard() {
  const saved = loadSavedConfig();
  const [config, setConfig] = useState(
    saved ?? {
      baseUrl: DEFAULT_BASE_URL,
      apiKey: "",
      tenantId: "tenant_default",
      protocol: "1.0"
    }
  );
  const [statusFilter, setStatusFilter] = useState("pending");
  const [escalations, setEscalations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [resolveOutput, setResolveOutput] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // ignore
    }
  }, [config]);

  const requestHeaders = useMemo(
    () => headersFor({ tenantId: config.tenantId, protocol: config.protocol, apiKey: config.apiKey }),
    [config]
  );

  const loadEscalations = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== "all") qs.set("status", statusFilter);
      qs.set("limit", "100");
      qs.set("offset", "0");
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/x402/gate/escalations?${qs.toString()}`,
        method: "GET",
        headers: requestHeaders
      });
      const rows = Array.isArray(out?.escalations) ? out.escalations : [];
      setEscalations(rows);
      if (rows.length === 0) {
        setSelectedId(null);
        setSelected(null);
      } else if (!selectedId || !rows.some((row) => row?.escalationId === selectedId)) {
        setSelectedId(rows[0]?.escalationId ?? null);
      }
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setLoadingList(false);
    }
  }, [config.baseUrl, requestHeaders, selectedId, statusFilter]);

  const loadSelected = useCallback(async () => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    setLoadingDetail(true);
    setError(null);
    try {
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/x402/gate/escalations/${encodeURIComponent(selectedId)}`,
        method: "GET",
        headers: requestHeaders
      });
      setSelected(out?.escalation ?? null);
    } catch (err) {
      setError(err?.message ?? String(err));
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  }, [config.baseUrl, requestHeaders, selectedId]);

  useEffect(() => {
    void loadEscalations();
  }, [loadEscalations]);

  useEffect(() => {
    void loadSelected();
  }, [loadSelected]);

  async function resolveEscalation(action) {
    if (!selectedId) return;
    setResolving(true);
    setError(null);
    setResolveOutput(null);
    try {
      const payload = {
        action,
        ...(reason.trim() ? { reason: reason.trim() } : {})
      };
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/x402/gate/escalations/${encodeURIComponent(selectedId)}/resolve`,
        method: "POST",
        headers: requestHeaders,
        body: payload
      });
      setResolveOutput(out);
      setReason("");
      await loadEscalations();
      await loadSelected();
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setResolving(false);
    }
  }

  const pendingCount = escalations.filter((row) => String(row?.status ?? "").toLowerCase() === "pending").length;

  return (
    <div className="operator-root">
      <div className="operator-bg operator-bg-a" aria-hidden="true" />
      <div className="operator-bg operator-bg-b" aria-hidden="true" />

      <header className="operator-topbar">
        <div>
          <p className="operator-eyebrow">Settld Operator Console</p>
          <h1>Escalation Inbox</h1>
          <p>Review blocked autonomous spend and issue signed override decisions.</p>
        </div>
        <div className="operator-top-actions">
          <span className="operator-pending-pill">pending {pendingCount}</span>
          <button className="operator-ghost-btn" onClick={() => void loadEscalations()}>
            Refresh
          </button>
          <a className="operator-ghost-btn" href="/">
            Back to site
          </a>
        </div>
      </header>

      <section className="operator-config-grid">
        <label>
          <span>API base URL</span>
          <input
            value={config.baseUrl}
            onChange={(e) => setConfig((prev) => ({ ...prev, baseUrl: e.target.value }))}
            placeholder="/__settld or http://127.0.0.1:3000"
          />
        </label>
        <label>
          <span>Tenant</span>
          <input
            value={config.tenantId}
            onChange={(e) => setConfig((prev) => ({ ...prev, tenantId: e.target.value }))}
            placeholder="tenant_default"
          />
        </label>
        <label>
          <span>Protocol</span>
          <input
            value={config.protocol}
            onChange={(e) => setConfig((prev) => ({ ...prev, protocol: e.target.value }))}
            placeholder="1.0"
          />
        </label>
        <label>
          <span>API key (Bearer)</span>
          <input
            value={config.apiKey}
            onChange={(e) => setConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
            placeholder="sk_test_..."
          />
        </label>
      </section>

      <main className="operator-main-grid">
        <section className="operator-card operator-queue">
          <div className="operator-card-head">
            <h2>Queue</h2>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div className="operator-queue-body">
            {loadingList && <p className="operator-muted">Loading escalations...</p>}
            {!loadingList && escalations.length === 0 && <p className="operator-muted">No escalations found.</p>}
            {!loadingList &&
              escalations.map((row, index) => {
                const isSelected = row?.escalationId === selectedId;
                const status = String(row?.status ?? "").toLowerCase();
                return (
                  <button
                    key={row?.escalationId ?? `row_${index}`}
                    onClick={() => setSelectedId(row?.escalationId ?? null)}
                    className={`operator-queue-item ${isSelected ? "is-selected" : ""}`}
                  >
                    <div className="operator-queue-line">
                      <p>{row?.escalationId ?? "escalation"}</p>
                      <span className={statusTone(status)}>{status || "unknown"}</span>
                    </div>
                    <p className="operator-muted operator-truncate">{row?.toolId ?? "tool"} · {row?.payeeProviderId ?? "provider"}</p>
                    <p className="operator-muted operator-small">
                      {Number.isFinite(Number(row?.amountCents))
                        ? `${(Number(row.amountCents) / 100).toFixed(2)} ${row?.currency ?? "USD"}`
                        : "amount n/a"}
                      {" · "}
                      {toIso(row?.createdAt)}
                    </p>
                  </button>
                );
              })}
          </div>
        </section>

        <section className="operator-card operator-detail">
          <div className="operator-card-head">
            <h2>Escalation Detail</h2>
            {loadingDetail ? <span className="operator-muted operator-small">Loading...</span> : null}
          </div>

          <div className="operator-detail-body">
            {error ? <div className="operator-error">{error}</div> : null}

            {!selected && !loadingDetail ? <p className="operator-muted">Select an escalation from the queue.</p> : null}

            {selected ? (
              <>
                <div className="operator-meta-grid">
                  <article>
                    <span>Gate</span>
                    <p>{selected?.gateId ?? "n/a"}</p>
                  </article>
                  <article>
                    <span>Reason</span>
                    <p>{selected?.reasonCode ?? "n/a"}</p>
                  </article>
                  <article>
                    <span>Tool / Provider</span>
                    <p>{selected?.toolId ?? "n/a"} · {selected?.payeeProviderId ?? "n/a"}</p>
                  </article>
                  <article>
                    <span>Amount</span>
                    <p>
                      {Number.isFinite(Number(selected?.amountCents))
                        ? `${(Number(selected.amountCents) / 100).toFixed(2)} ${selected?.currency ?? "USD"}`
                        : "n/a"}
                    </p>
                  </article>
                </div>

                <label className="operator-textarea-wrap">
                  <span>Resolution reason (optional)</span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Explain override or denial rationale"
                  />
                </label>

                <div className="operator-decision-actions">
                  <button
                    disabled={resolving || String(selected?.status ?? "").toLowerCase() !== "pending"}
                    onClick={() => void resolveEscalation("approve")}
                    className="operator-approve-btn"
                  >
                    Approve
                  </button>
                  <button
                    disabled={resolving || String(selected?.status ?? "").toLowerCase() !== "pending"}
                    onClick={() => void resolveEscalation("deny")}
                    className="operator-deny-btn"
                  >
                    Deny
                  </button>
                </div>

                {resolveOutput ? (
                  <section className="operator-json-block">
                    <p>Resolution output</p>
                    <pre>{JSON.stringify(resolveOutput, null, 2)}</pre>
                  </section>
                ) : null}

                {Array.isArray(selected?.events) && selected.events.length > 0 ? (
                  <section className="operator-events">
                    <p>Lifecycle events</p>
                    <ul>
                      {selected.events.map((event, index) => (
                        <li key={event?.eventId ?? `evt_${index}`}>
                          <strong>{event?.eventType ?? "event"}</strong>
                          <span>{toIso(event?.occurredAt)}</span>
                          <small>{event?.reasonCode ?? "no_reason_code"}</small>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
