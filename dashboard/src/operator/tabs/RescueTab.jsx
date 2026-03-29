import { useCallback, useEffect, useMemo, useState } from "react";
import { requestJson } from "../operator-api.js";
import {
  RESCUE_SOURCE_OPTIONS,
  RESCUE_PRIORITY_OPTIONS,
  RESCUE_TRIAGE_STATUS_OPTIONS,
  RESOLUTION_OUTCOME_OPTIONS,
  buildAvailableRescueActions,
  buildRescueTrustSurfaceRows,
  buildRescueInterventionRows,
  buildRescueLinks,
  buildLaunchSafeRescueDetails,
  rescueSourceLabel,
  rescuePriorityTone,
  rescueStateTone,
  rescueTriageTone,
  rescueScopeLabel,
  rescueDisputeId,
  formatRescueState,
  formatRescueTriageStatus,
  toIso
} from "../operator-constants.js";

export default function RescueTab({ config, requestHeaders, onQueueChange, refreshSeq }) {
  const [rescueSourceFilter, setRescueSourceFilter] = useState("all");
  const [rescuePriorityFilter, setRescuePriorityFilter] = useState("all");
  const [rescueQueue, setRescueQueue] = useState([]);
  const [rescueCounts, setRescueCounts] = useState({
    bySourceType: {},
    byPriority: {},
    byState: {}
  });
  const [selectedRescueId, setSelectedRescueId] = useState(null);
  const [loadingRescue, setLoadingRescue] = useState(false);
  const [rescueError, setRescueError] = useState(null);
  const [rescueTriageStatus, setRescueTriageStatus] = useState("open");
  const [rescueOwnerPrincipalId, setRescueOwnerPrincipalId] = useState("");
  const [rescueNotes, setRescueNotes] = useState("");
  const [rescueActionNote, setRescueActionNote] = useState("");
  const [rescueRequestedFields, setRescueRequestedFields] = useState("");
  const [rescueRequestedEvidenceKinds, setRescueRequestedEvidenceKinds] = useState("");
  const [rescueActionTitle, setRescueActionTitle] = useState("");
  const [rescueRevocationReasonCode, setRescueRevocationReasonCode] = useState("operator_revoked");
  const [rescueResolutionOutcome, setRescueResolutionOutcome] = useState("rejected");
  const [rescueCompletionJson, setRescueCompletionJson] = useState("");
  const [rescueSettlementJson, setRescueSettlementJson] = useState("");
  const [savingRescueTriage, setSavingRescueTriage] = useState(false);
  const [runningRescueAction, setRunningRescueAction] = useState(false);
  const [rescueMutationError, setRescueMutationError] = useState(null);
  const [rescueMutationOutput, setRescueMutationOutput] = useState(null);

  const loadRescueQueue = useCallback(async () => {
    setLoadingRescue(true);
    setRescueError(null);
    try {
      const qs = new URLSearchParams();
      if (rescueSourceFilter !== "all") qs.set("sourceType", rescueSourceFilter);
      if (rescuePriorityFilter !== "all") qs.set("priority", rescuePriorityFilter);
      qs.set("limit", "100");
      qs.set("offset", "0");
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/ops/network/rescue-queue?${qs.toString()}`,
        method: "GET",
        headers: requestHeaders
      });
      const queue = Array.isArray(out?.rescueQueue?.queue) ? out.rescueQueue.queue : [];
      setRescueQueue(queue);
      if (onQueueChange) onQueueChange(queue);
      setRescueCounts(
        out?.rescueQueue?.counts && typeof out.rescueQueue.counts === "object"
          ? out.rescueQueue.counts
          : { bySourceType: {}, byPriority: {}, byState: {} }
      );
      if (queue.length === 0) {
        setSelectedRescueId(null);
      } else if (!selectedRescueId || !queue.some((row) => row?.rescueId === selectedRescueId)) {
        setSelectedRescueId(queue[0]?.rescueId ?? null);
      }
    } catch (err) {
      setRescueError(err?.message ?? String(err));
      setRescueQueue([]);
      if (onQueueChange) onQueueChange([]);
      setSelectedRescueId(null);
    } finally {
      setLoadingRescue(false);
    }
  }, [config.baseUrl, requestHeaders, rescuePriorityFilter, rescueSourceFilter, selectedRescueId, onQueueChange]);

  useEffect(() => {
    void loadRescueQueue();
  }, [loadRescueQueue]);

  useEffect(() => {
    if (refreshSeq > 0) void loadRescueQueue();
  }, [refreshSeq]);

  const selectedRescue = useMemo(
    () => rescueQueue.find((row) => row?.rescueId === selectedRescueId) ?? null,
    [rescueQueue, selectedRescueId]
  );
  const rescueLinks = useMemo(() => buildRescueLinks(selectedRescue), [selectedRescue]);
  const rescueActions = useMemo(() => buildAvailableRescueActions(selectedRescue), [selectedRescue]);
  const rescueTrustSurfaceRows = useMemo(() => buildRescueTrustSurfaceRows(selectedRescue), [selectedRescue]);
  const rescueInterventionRows = useMemo(
    () => buildRescueInterventionRows(selectedRescue, rescueActions),
    [selectedRescue, rescueActions]
  );
  const selectedRescueDetails = useMemo(
    () => buildLaunchSafeRescueDetails(selectedRescue?.details),
    [selectedRescue?.details]
  );

  useEffect(() => {
    const triage = selectedRescue?.triage && typeof selectedRescue.triage === "object" ? selectedRescue.triage : null;
    setRescueTriageStatus(String(triage?.status ?? "open").trim().toLowerCase() || "open");
    setRescueOwnerPrincipalId(String(triage?.ownerPrincipalId ?? ""));
    setRescueNotes(String(triage?.notes ?? ""));
    setRescueActionNote("");
    setRescueRequestedFields("");
    setRescueRequestedEvidenceKinds("");
    setRescueActionTitle("");
    setRescueRevocationReasonCode("operator_revoked");
    setRescueResolutionOutcome("rejected");
    setRescueCompletionJson("");
    setRescueSettlementJson("");
    setRescueMutationError(null);
    setRescueMutationOutput(null);
  }, [selectedRescue?.rescueId, selectedRescue?.triage?.revision]);

  async function saveRescueTriage() {
    if (!selectedRescueId) return;
    setSavingRescueTriage(true);
    setRescueMutationError(null);
    setRescueMutationOutput(null);
    try {
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/ops/network/rescue-queue/${encodeURIComponent(selectedRescueId)}/triage`,
        method: "POST",
        headers: requestHeaders,
        body: {
          status: rescueTriageStatus,
          ownerPrincipalId: rescueOwnerPrincipalId.trim() || null,
          notes: rescueNotes.trim() || null
        }
      });
      setRescueMutationOutput(out);
      await loadRescueQueue();
    } catch (err) {
      setRescueMutationError(err?.message ?? String(err));
    } finally {
      setSavingRescueTriage(false);
    }
  }

  async function runRescueAction(action) {
    if (!selectedRescueId || !action) return;
    let retryFinalizeCompletion = null;
    let retryFinalizeSettlement = null;
    if (action === "retry_finalize") {
      try {
        retryFinalizeCompletion = rescueCompletionJson.trim() ? JSON.parse(rescueCompletionJson) : null;
      } catch (err) {
        setRescueMutationError(`Completion JSON is invalid: ${err?.message ?? String(err)}`);
        return;
      }
      if (!retryFinalizeCompletion || typeof retryFinalizeCompletion !== "object" || Array.isArray(retryFinalizeCompletion)) {
        setRescueMutationError("Retry finalize requires a completion JSON object.");
        return;
      }
      try {
        retryFinalizeSettlement = rescueSettlementJson.trim() ? JSON.parse(rescueSettlementJson) : null;
      } catch (err) {
        setRescueMutationError(`Settlement JSON is invalid: ${err?.message ?? String(err)}`);
        return;
      }
      if (retryFinalizeSettlement !== null && (typeof retryFinalizeSettlement !== "object" || Array.isArray(retryFinalizeSettlement))) {
        setRescueMutationError("Settlement JSON must be an object when provided.");
        return;
      }
    }
    setRunningRescueAction(true);
    setRescueMutationError(null);
    setRescueMutationOutput(null);
    try {
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/ops/network/rescue-queue/${encodeURIComponent(selectedRescueId)}/actions`,
        method: "POST",
        headers: requestHeaders,
        body: {
          action,
          ...(rescueActionNote.trim() ? { note: rescueActionNote.trim() } : {}),
          ...(action === "request_info" && rescueRequestedFields.trim() ? { requestedFields: rescueRequestedFields } : {}),
          ...(action === "request_info" && rescueRequestedEvidenceKinds.trim()
            ? { requestedEvidenceKinds: rescueRequestedEvidenceKinds }
            : {}),
          ...(action === "request_info" && rescueActionTitle.trim() ? { title: rescueActionTitle.trim() } : {}),
          ...(action === "revoke" && rescueRevocationReasonCode.trim()
            ? { reasonCode: rescueRevocationReasonCode.trim() }
            : {}),
          ...(action === "resolve_dispute"
            ? {
                resolutionOutcome: rescueResolutionOutcome,
                ...(rescueDisputeId(selectedRescue) ? { disputeId: rescueDisputeId(selectedRescue) } : {})
              }
            : {}),
          ...(action === "retry_finalize"
            ? {
                completion: retryFinalizeCompletion,
                ...(retryFinalizeSettlement ? { settlement: retryFinalizeSettlement } : {})
              }
            : {})
        }
      });
      setRescueMutationOutput(out);
      await loadRescueQueue();
    } catch (err) {
      setRescueMutationError(err?.message ?? String(err));
    } finally {
      setRunningRescueAction(false);
    }
  }

  const rescueTotal = rescueQueue.length;
  const pillLabel = `open ${rescueTotal}`;

  return (
    <>
      <div className="operator-top-actions">
        <span className="operator-pending-pill">{pillLabel}</span>
        <button className="operator-ghost-btn" onClick={() => void loadRescueQueue()}>
          Refresh
        </button>
      </div>
      <main className="operator-main-grid">
        <section className="operator-card operator-queue">
          <div className="operator-card-head operator-card-head-stack">
            <div>
              <h2>Queue</h2>
              <p className="operator-muted operator-small">
                Priority-sorted recovery work for Action Wallet launch actions. Follow-on categories stay visible for ops awareness but do not move the launch gate.
              </p>
            </div>
            <div className="operator-filter-row">
              <select value={rescueSourceFilter} onChange={(event) => setRescueSourceFilter(event.target.value)}>
                {RESCUE_SOURCE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select value={rescuePriorityFilter} onChange={(event) => setRescuePriorityFilter(event.target.value)}>
                {RESCUE_PRIORITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="operator-queue-summary">
            <span className="operator-pill operator-pill-normal">approval {Number(rescueCounts?.bySourceType?.approval_continuation ?? 0)}</span>
            <span className="operator-pill operator-pill-normal">launch {Number(rescueCounts?.bySourceType?.router_launch ?? 0)}</span>
            <span className="operator-pill operator-pill-normal">run {Number(rescueCounts?.bySourceType?.run ?? 0)}</span>
          </div>

          <div className="operator-queue-body">
            {loadingRescue && <p className="operator-muted">Loading rescue queue...</p>}
            {!loadingRescue && rescueQueue.length === 0 && <p className="operator-muted">No rescue items found.</p>}
            {!loadingRescue && rescueQueue.map((item, index) => {
              const isSelected = item?.rescueId === selectedRescueId;
              return (
                <button
                  key={item?.rescueId ?? `rescue_${index}`}
                  type="button"
                  onClick={() => setSelectedRescueId(item?.rescueId ?? null)}
                  className={`operator-queue-item ${isSelected ? "is-selected" : ""}`}
                >
                  <div className="operator-queue-line">
                    <p>{item?.title ?? "Rescue item"}</p>
                    <span className={rescuePriorityTone(item?.priority)}>{item?.priority ?? "normal"}</span>
                  </div>
                  <p className="operator-muted operator-truncate">{item?.summary ?? rescueSourceLabel(item?.sourceType)}</p>
                  <div className="operator-queue-tags">
                    <span className={rescueStateTone(item?.rescueState)}>{formatRescueState(item?.rescueState)}</span>
                    <span className="operator-muted operator-small">{rescueSourceLabel(item?.sourceType)}</span>
                    {item?.triage?.status ? (
                      <span className={rescueTriageTone(item.triage.status)}>{formatRescueTriageStatus(item.triage.status)}</span>
                    ) : null}
                    {item?.phase1?.categoryLabel ? <span className="operator-muted operator-small">{item.phase1.categoryLabel}</span> : null}
                    {item?.phase1?.categoryId ? <span className="badge">{rescueScopeLabel(item.phase1.categoryId)}</span> : null}
                  </div>
                  <p className="operator-muted operator-small">{toIso(item?.openedAt)}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="operator-card operator-detail">
          <div className="operator-card-head">
            <h2>Rescue Detail</h2>
          </div>

          <div className="operator-detail-body">
            {rescueError ? <div className="operator-error">{rescueError}</div> : null}
            {rescueMutationError ? <div className="operator-error">{rescueMutationError}</div> : null}
            {!selectedRescue && !loadingRescue ? <p className="operator-muted">Select a rescue item from the queue.</p> : null}

            {selectedRescue ? (
              <>
                <div className="operator-meta-grid">
                  <article>
                    <span>Source</span>
                    <p>{rescueSourceLabel(selectedRescue?.sourceType)}</p>
                  </article>
                  <article>
                    <span>State</span>
                    <p>{formatRescueState(selectedRescue?.rescueState)}</p>
                  </article>
                  <article>
                    <span>Priority</span>
                    <p>{selectedRescue?.priority ?? "normal"}</p>
                  </article>
                  <article>
                    <span>Updated</span>
                    <p>{toIso(selectedRescue?.updatedAt)}</p>
                  </article>
                </div>

                {rescueTrustSurfaceRows.length > 0 ? (
                  <section className="operator-json-block">
                    <p>Trust surface state</p>
                    <div className="operator-rescue-surface-grid">
                      {rescueTrustSurfaceRows.map((row) => (
                        <article key={row.title} className="operator-rescue-surface-card">
                          <div className="operator-rescue-surface-head">
                            <strong>{row.title}</strong>
                            <span className={row.statusTone}>{row.statusLabel}</span>
                          </div>
                          <span>{row.detail}</span>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                {rescueInterventionRows.length > 0 ? (
                  <section className="operator-json-block">
                    <p>Launch-scoped interventions</p>
                    <div className="operator-rescue-action-grid">
                      {rescueInterventionRows.map((row) => (
                        <article key={row.title} className="operator-rescue-action-card">
                          <div className="operator-rescue-action-head">
                            <strong>{row.title}</strong>
                            <span className={row.tone}>{row.mode === "wired" ? "wired here" : "runbook"}</span>
                          </div>
                          <span>{row.detail}</span>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="operator-json-block">
                  <p>Triage</p>
                  <div className="operator-triage-grid">
                    <label>
                      <span>Status</span>
                      <select
                        value={rescueTriageStatus}
                        onChange={(event) => setRescueTriageStatus(event.target.value)}
                        disabled={savingRescueTriage || runningRescueAction}
                      >
                        {RESCUE_TRIAGE_STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Owner</span>
                      <input
                        value={rescueOwnerPrincipalId}
                        onChange={(event) => setRescueOwnerPrincipalId(event.target.value)}
                        placeholder="ops.alex"
                        disabled={savingRescueTriage || runningRescueAction}
                      />
                    </label>
                  </div>
                  <label className="operator-textarea-wrap">
                    <span>Notes</span>
                    <textarea
                      value={rescueNotes}
                      onChange={(event) => setRescueNotes(event.target.value)}
                      placeholder="Capture what the operator knows and what happens next."
                      disabled={savingRescueTriage || runningRescueAction}
                    />
                  </label>
                  <div className="operator-decision-actions">
                    <button
                      type="button"
                      className="operator-ghost-btn"
                      onClick={() => void saveRescueTriage()}
                      disabled={savingRescueTriage || runningRescueAction}
                    >
                      {savingRescueTriage ? "Saving..." : "Save triage"}
                    </button>
                    {selectedRescue?.triage?.updatedAt ? (
                      <span className="operator-muted operator-small">
                        Updated {toIso(selectedRescue.triage.updatedAt)}
                      </span>
                    ) : null}
                  </div>
                </section>

                {rescueActions.length > 0 ? (
                  <section className="operator-json-block">
                    <p>Actions</p>
                    {rescueActions.some((action) => action.action === "revoke") ? (
                      <label className="operator-textarea-wrap">
                        <span>Revocation reason code</span>
                        <input
                          value={rescueRevocationReasonCode}
                          onChange={(event) => setRescueRevocationReasonCode(event.target.value)}
                          placeholder="operator_revoked"
                          disabled={savingRescueTriage || runningRescueAction}
                        />
                      </label>
                    ) : null}
                    {selectedRescue?.sourceType === "run" ? (
                      <div className="operator-triage-grid">
                        <label>
                          <span>Requested fields</span>
                          <input
                            value={rescueRequestedFields}
                            onChange={(event) => setRescueRequestedFields(event.target.value)}
                            placeholder="document_upload, calendar_confirmation"
                            disabled={savingRescueTriage || runningRescueAction}
                          />
                        </label>
                        <label>
                          <span>Evidence kinds</span>
                          <input
                            value={rescueRequestedEvidenceKinds}
                            onChange={(event) => setRescueRequestedEvidenceKinds(event.target.value)}
                            placeholder="document_ref, screenshot"
                            disabled={savingRescueTriage || runningRescueAction}
                          />
                        </label>
                      </div>
                    ) : null}
                    {rescueActions.some((action) => action.action === "resolve_dispute") ? (
                      <div className="operator-triage-grid">
                        <label>
                          <span>Resolution outcome</span>
                          <select
                            value={rescueResolutionOutcome}
                            onChange={(event) => setRescueResolutionOutcome(event.target.value)}
                            disabled={savingRescueTriage || runningRescueAction}
                          >
                            {RESOLUTION_OUTCOME_OPTIONS.map((outcome) => (
                              <option key={outcome} value={outcome}>
                                {outcome}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Dispute</span>
                          <input
                            value={rescueDisputeId(selectedRescue) || "linked dispute will be inferred"}
                            readOnly
                            disabled
                          />
                        </label>
                      </div>
                    ) : null}
                    {rescueActions.some((action) => action.action === "retry_finalize") ? (
                      <>
                        <label className="operator-textarea-wrap">
                          <span>Completion JSON</span>
                          <textarea
                            value={rescueCompletionJson}
                            onChange={(event) => setRescueCompletionJson(event.target.value)}
                            placeholder={'{"receiptId":"worec_...","status":"success","verifierVerdict":{"decision":"pass","reasonCode":"verified"},"evidenceRefs":["artifact://..."],"completedAt":"2026-03-08T16:12:30.000Z"}'}
                            disabled={savingRescueTriage || runningRescueAction}
                          />
                        </label>
                        <label className="operator-textarea-wrap">
                          <span>Settlement JSON</span>
                          <textarea
                            value={rescueSettlementJson}
                            onChange={(event) => setRescueSettlementJson(event.target.value)}
                            placeholder={'{"status":"released","x402GateId":"x402gate_...","x402ReceiptId":"x402rcpt_...","settledAt":"2026-03-08T16:13:00.000Z"}'}
                            disabled={savingRescueTriage || runningRescueAction}
                          />
                        </label>
                        <p className="operator-muted operator-small">
                          Retry finalize is operator-only and expects the same fail-closed payload the public finalize route requires. Leave settlement blank if only completion needs replay.
                        </p>
                      </>
                    ) : null}
                    {selectedRescue?.sourceType === "run" ? (
                      <p className="operator-muted operator-small">
                        Launch rescue stays inside host-first recovery: request missing evidence, continue an approved launch, refund, dispute, or quarantine. This console does not promise rerouting or Nooterra-run fulfillment.
                      </p>
                    ) : null}
                    {selectedRescue?.sourceType === "run" ? (
                      <label className="operator-textarea-wrap">
                        <span>Request title</span>
                        <input
                          value={rescueActionTitle}
                          onChange={(event) => setRescueActionTitle(event.target.value)}
                          placeholder="This run needs one more thing from you"
                          disabled={savingRescueTriage || runningRescueAction}
                        />
                      </label>
                    ) : null}
                    <label className="operator-textarea-wrap">
                      <span>Action note</span>
                      <textarea
                        value={rescueActionNote}
                        onChange={(event) => setRescueActionNote(event.target.value)}
                        placeholder="Explain why this intervention is safe."
                        disabled={savingRescueTriage || runningRescueAction}
                      />
                    </label>
                    <p className="operator-muted operator-small">
                      Only launch-safe interventions are wired from this screen. Pause, revoke, and quarantine stay explicit but remain separate emergency controls until the operator console gets dedicated dual-control flows.
                    </p>
                    <div className="operator-decision-actions">
                      {rescueActions.map((action) => (
                        <button
                          key={action.action}
                          type="button"
                          className={action.tone}
                          onClick={() => void runRescueAction(action.action)}
                          disabled={savingRescueTriage || runningRescueAction}
                          title={action.summary ?? action.label}
                        >
                          {runningRescueAction ? "Working..." : action.label}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedRescue?.phase1?.categoryLabel ? (
                  <section className="operator-json-block">
                    <p>Contract scope</p>
                    <div className="operator-phase1-summary">
                      <strong>{selectedRescue.phase1.categoryLabel}</strong>
                      {selectedRescue?.phase1?.categoryId ? <span className="badge">{rescueScopeLabel(selectedRescue.phase1.categoryId)}</span> : null}
                      <span>{selectedRescue.phase1.proofSummary ?? "Proof contract unavailable."}</span>
                      {selectedRescue.phase1.verificationStatus ? (
                        <span className={rescueStateTone(selectedRescue.phase1.verificationStatus)}>
                          verification {selectedRescue.phase1.verificationStatus}
                        </span>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {selectedRescue?.details?.latestUserResponse ? (
                  <section className="operator-json-block">
                    <p>Latest user response</p>
                    <div className="operator-meta-grid">
                      <article>
                        <span>Responded at</span>
                        <p>{toIso(selectedRescue.details.latestUserResponse.respondedAt)}</p>
                      </article>
                      <article>
                        <span>Boundary</span>
                        <p>{selectedRescue.details.latestUserResponse.actionRequiredCode || "n/a"}</p>
                      </article>
                      <article>
                        <span>Provided fields</span>
                        <p>
                          {Array.isArray(selectedRescue.details.latestUserResponse.providedFieldKeys) &&
                          selectedRescue.details.latestUserResponse.providedFieldKeys.length > 0
                            ? selectedRescue.details.latestUserResponse.providedFieldKeys.join(", ")
                            : "n/a"}
                        </p>
                      </article>
                      <article>
                        <span>Evidence refs</span>
                        <p>{Number.isFinite(Number(selectedRescue.details.latestUserResponse.evidenceRefCount)) ? String(selectedRescue.details.latestUserResponse.evidenceRefCount) : "0"}</p>
                      </article>
                    </div>
                    {selectedRescue.details.latestUserResponse.consumerConnectorBinding ? (
                      <div className="operator-inline-note">
                        Connector{" "}
                        {[
                          selectedRescue.details.latestUserResponse.consumerConnectorBinding.kind,
                          selectedRescue.details.latestUserResponse.consumerConnectorBinding.provider,
                          selectedRescue.details.latestUserResponse.consumerConnectorBinding.accountAddress ||
                            selectedRescue.details.latestUserResponse.consumerConnectorBinding.accountLabel
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    ) : null}
                    {selectedRescue.details.latestUserResponse.accountSessionBinding ? (
                      <div className="operator-inline-note">
                        Session{" "}
                        {[
                          selectedRescue.details.latestUserResponse.accountSessionBinding.siteKey,
                          selectedRescue.details.latestUserResponse.accountSessionBinding.accountHandleMasked,
                          selectedRescue.details.latestUserResponse.accountSessionBinding.mode
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {rescueLinks.length > 0 ? (
                  <section className="operator-json-block">
                    <p>Operator links</p>
                    <div className="operator-link-list">
                      {rescueLinks.map((link) => (
                        <a key={`${link.label}:${link.href}`} className="operator-ghost-btn" href={link.href}>
                          {link.label}
                        </a>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="operator-json-block">
                  <p>Refs</p>
                  <pre>{JSON.stringify(selectedRescue?.refs ?? {}, null, 2)}</pre>
                </section>

                <section className="operator-json-block">
                  <p>Details</p>
                  <pre>{JSON.stringify(selectedRescueDetails ?? {}, null, 2)}</pre>
                  {selectedRescue?.details?.managedExecution || Array.isArray(selectedRescue?.details?.managedSpecialistCandidates) ? (
                    <p className="operator-muted operator-small">
                      Non-launch managed execution fields are omitted from this Action Wallet launch view.
                    </p>
                  ) : null}
                </section>

                {Array.isArray(selectedRescue?.triage?.actionLog) && selectedRescue.triage.actionLog.length > 0 ? (
                  <section className="operator-events">
                    <p>Triage activity</p>
                    <ul>
                      {selectedRescue.triage.actionLog.map((event, index) => (
                        <li key={`${event?.at ?? "log"}:${index}`}>
                          <strong>{String(event?.action ?? "triage").replaceAll("_", " ")}</strong>
                          <span>{toIso(event?.at)}</span>
                          <small>{event?.actorPrincipalId ?? "system"}</small>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            ) : null}

            {rescueMutationOutput ? (
              <section className="operator-json-block">
                <p>Latest output</p>
                <pre>{JSON.stringify(rescueMutationOutput, null, 2)}</pre>
              </section>
            ) : null}
          </div>
        </section>
      </main>
    </>
  );
}
