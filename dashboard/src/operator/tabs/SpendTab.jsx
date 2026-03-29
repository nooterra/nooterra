import { useCallback, useEffect, useState } from "react";
import { requestJson } from "../operator-api.js";
import { STATUS_OPTIONS, statusTone, toIso } from "../operator-constants.js";

export default function SpendTab({ config, requestHeaders, refreshSeq }) {
  const [statusFilter, setStatusFilter] = useState("pending");
  const [escalations, setEscalations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [resolveOutput, setResolveOutput] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [spendError, setSpendError] = useState(null);

  const loadEscalations = useCallback(async () => {
    setLoadingList(true);
    setSpendError(null);
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
      setSpendError(err?.message ?? String(err));
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
    setSpendError(null);
    try {
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/x402/gate/escalations/${encodeURIComponent(selectedId)}`,
        method: "GET",
        headers: requestHeaders
      });
      setSelected(out?.escalation ?? null);
    } catch (err) {
      setSpendError(err?.message ?? String(err));
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  }, [config.baseUrl, requestHeaders, selectedId]);

  useEffect(() => {
    void loadEscalations();
  }, [loadEscalations]);

  useEffect(() => {
    if (refreshSeq > 0) void loadEscalations();
  }, [refreshSeq]);

  useEffect(() => {
    void loadSelected();
  }, [loadSelected]);

  async function resolveEscalation(action) {
    if (!selectedId) return;
    setResolving(true);
    setSpendError(null);
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
      setSpendError(err?.message ?? String(err));
    } finally {
      setResolving(false);
    }
  }

  const pendingCount = escalations.filter((row) => String(row?.status ?? "").toLowerCase() === "pending").length;
  const pillLabel = `pending ${pendingCount}`;

  return (
    <>
      <div className="operator-top-actions">
        <span className="operator-pending-pill">{pillLabel}</span>
        <button className="operator-ghost-btn" onClick={() => void loadEscalations()}>
          Refresh
        </button>
      </div>
      <main className="operator-main-grid">
        <section className="operator-card operator-queue">
          <div className="operator-card-head">
            <h2>Queue</h2>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
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
            {spendError ? <div className="operator-error">{spendError}</div> : null}

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
                    onChange={(event) => setReason(event.target.value)}
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
    </>
  );
}
