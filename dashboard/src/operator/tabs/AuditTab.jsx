import { useCallback, useEffect, useMemo, useState } from "react";
import { requestJson } from "../operator-api.js";
import {
  AUDIT_TARGET_FILTER_OPTIONS,
  auditMatchesFilter,
  buildAuditLinkedRefs,
  buildAuditActorLabel,
  auditNoteValue,
  normalizeAuditDetails,
  toIso
} from "../operator-constants.js";

export default function AuditTab({ config, requestHeaders, refreshSeq }) {
  const [auditTargetTypeFilter, setAuditTargetTypeFilter] = useState("all");
  const [auditTargetIdFilter, setAuditTargetIdFilter] = useState("");
  const [auditRecords, setAuditRecords] = useState([]);
  const [selectedAuditId, setSelectedAuditId] = useState(null);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState(null);

  const loadAuditFeed = useCallback(async () => {
    setLoadingAudit(true);
    setAuditError(null);
    try {
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: "/ops/audit?limit=200&offset=0",
        method: "GET",
        headers: requestHeaders
      });
      const rows = Array.isArray(out?.audit) ? out.audit : [];
      setAuditRecords(rows);
      if (rows.length === 0) {
        setSelectedAuditId(null);
      } else if (!selectedAuditId || !rows.some((row) => Number(row?.id) === Number(selectedAuditId))) {
        setSelectedAuditId(rows[0]?.id ?? null);
      }
    } catch (err) {
      setAuditError(err?.message ?? String(err));
      setAuditRecords([]);
      setSelectedAuditId(null);
    } finally {
      setLoadingAudit(false);
    }
  }, [config.baseUrl, requestHeaders, selectedAuditId]);

  useEffect(() => {
    void loadAuditFeed();
  }, [loadAuditFeed]);

  useEffect(() => {
    if (refreshSeq > 0) void loadAuditFeed();
  }, [refreshSeq]);

  const filteredAuditRecords = useMemo(
    () => auditRecords.filter((row) => auditMatchesFilter(row, auditTargetTypeFilter, auditTargetIdFilter)),
    [auditRecords, auditTargetIdFilter, auditTargetTypeFilter]
  );
  const selectedAuditRecord = useMemo(
    () => filteredAuditRecords.find((row) => Number(row?.id) === Number(selectedAuditId)) ?? filteredAuditRecords[0] ?? null,
    [filteredAuditRecords, selectedAuditId]
  );

  const pillLabel = `events ${filteredAuditRecords.length}`;

  return (
    <>
      <div className="operator-top-actions">
        <span className="operator-pending-pill">{pillLabel}</span>
        <button className="operator-ghost-btn" onClick={() => void loadAuditFeed()}>
          Refresh
        </button>
      </div>
      <main className="operator-main-grid">
        <section className="operator-card operator-queue">
          <div className="operator-card-head operator-card-head-stack">
            <div>
              <h2>Feed</h2>
              <p className="operator-muted operator-small">
                Append-only operator actions across rescue, dispute, emergency, and governance controls. Filter by run or dispute when support needs the full chain.
              </p>
            </div>
            <div className="operator-filter-row">
              <select value={auditTargetTypeFilter} onChange={(event) => setAuditTargetTypeFilter(event.target.value)}>
                {AUDIT_TARGET_FILTER_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <input
                value={auditTargetIdFilter}
                onChange={(event) => setAuditTargetIdFilter(event.target.value)}
                placeholder={auditTargetTypeFilter === "run" ? "run_..." : auditTargetTypeFilter === "dispute" ? "disp_..." : "run, dispute, receipt, note"}
              />
            </div>
          </div>

          <div className="operator-queue-summary">
            <span className="operator-pill operator-pill-normal">total {auditRecords.length}</span>
            <span className="operator-pill operator-pill-normal">filtered {filteredAuditRecords.length}</span>
            <span className="operator-pill operator-pill-normal">
              disputes {auditRecords.filter((row) => buildAuditLinkedRefs(row).disputeId !== "").length}
            </span>
            <span className="operator-pill operator-pill-normal">
              runs {auditRecords.filter((row) => buildAuditLinkedRefs(row).runId !== "").length}
            </span>
          </div>

          <div className="operator-queue-body">
            {loadingAudit ? <p className="operator-muted">Loading audit feed...</p> : null}
            {auditError ? <div className="operator-error">{auditError}</div> : null}
            {!loadingAudit && !auditError && filteredAuditRecords.length === 0 ? (
              <p className="operator-muted">No audit records matched the current filter.</p>
            ) : null}
            {!loadingAudit && !auditError && filteredAuditRecords.map((row, index) => {
              const isSelected = Number(row?.id) === Number(selectedAuditRecord?.id);
              const refs = buildAuditLinkedRefs(row);
              return (
                <button
                  key={row?.id ?? `audit_${index}`}
                  type="button"
                  onClick={() => setSelectedAuditId(row?.id ?? null)}
                  className={`operator-queue-item ${isSelected ? "is-selected" : ""}`}
                >
                  <div className="operator-queue-line">
                    <p>{String(row?.action ?? "audit_event").replaceAll("_", " ")}</p>
                    <span className="operator-pill operator-pill-normal">{buildAuditActorLabel(row)}</span>
                  </div>
                  <p className="operator-muted operator-truncate">
                    {String(row?.targetType ?? "target")} · {String(row?.targetId ?? "n/a")}
                  </p>
                  <div className="operator-queue-tags">
                    {refs.runId ? <span className="operator-pill operator-pill-high">run {refs.runId}</span> : null}
                    {refs.disputeId ? <span className="operator-pill operator-pill-high">dispute {refs.disputeId}</span> : null}
                    {auditNoteValue(row) ? <span className="operator-pill operator-pill-normal">note</span> : null}
                  </div>
                  <p className="operator-muted operator-small">{toIso(row?.at)}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="operator-card operator-detail">
          <div className="operator-card-head">
            <h2>Audit Detail</h2>
            {loadingAudit ? <span className="operator-muted operator-small">Refreshing...</span> : null}
          </div>

          <div className="operator-detail-body">
            {!selectedAuditRecord && !loadingAudit ? <p className="operator-muted">Select an audit event from the feed.</p> : null}

            {selectedAuditRecord ? (
              <>
                <div className="operator-meta-grid">
                  <article>
                    <span>Action</span>
                    <p>{String(selectedAuditRecord?.action ?? "n/a").replaceAll("_", " ")}</p>
                  </article>
                  <article>
                    <span>Actor</span>
                    <p>{buildAuditActorLabel(selectedAuditRecord)}</p>
                  </article>
                  <article>
                    <span>Target</span>
                    <p>{String(selectedAuditRecord?.targetType ?? "n/a")} · {String(selectedAuditRecord?.targetId ?? "n/a")}</p>
                  </article>
                  <article>
                    <span>At</span>
                    <p>{toIso(selectedAuditRecord?.at)}</p>
                  </article>
                </div>

                <section className="operator-json-block">
                  <p>Linked refs</p>
                  <div className="operator-queue-tags">
                    {Object.entries(buildAuditLinkedRefs(selectedAuditRecord))
                      .filter(([, value]) => String(value ?? "").trim() !== "")
                      .map(([key, value]) => (
                        <span key={key} className="operator-pill operator-pill-normal">
                          {key} {value}
                        </span>
                      ))}
                  </div>
                  {Object.values(buildAuditLinkedRefs(selectedAuditRecord)).every((value) => String(value ?? "").trim() === "") ? (
                    <p className="operator-muted operator-small">No run/dispute-linked refs were attached to this record.</p>
                  ) : null}
                </section>

                <section className="operator-json-block">
                  <p>Note metadata</p>
                  <div className="operator-rescue-action-grid">
                    <article className="operator-rescue-action-card">
                      <div className="operator-rescue-action-head">
                        <strong>Note</strong>
                        <span className="operator-pill operator-pill-normal">internal</span>
                      </div>
                      <span>{auditNoteValue(selectedAuditRecord) || "No note metadata recorded."}</span>
                    </article>
                    <article className="operator-rescue-action-card">
                      <div className="operator-rescue-action-head">
                        <strong>Details hash</strong>
                        <span className="operator-pill operator-pill-normal">audit</span>
                      </div>
                      <span>{String(selectedAuditRecord?.detailsHash ?? "").trim() || "No details hash exposed."}</span>
                    </article>
                  </div>
                </section>

                <section className="operator-json-block">
                  <p>Raw details</p>
                  <pre>{JSON.stringify(normalizeAuditDetails(selectedAuditRecord?.details), null, 2)}</pre>
                </section>
              </>
            ) : null}
          </div>
        </section>
      </main>
    </>
  );
}
