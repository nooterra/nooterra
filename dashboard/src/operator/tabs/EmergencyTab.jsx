import { useCallback, useEffect, useMemo, useState } from "react";
import { requestJson } from "../operator-api.js";
import {
  EMERGENCY_SCOPE_TYPE_OPTIONS,
  EMERGENCY_CONTROL_TYPE_OPTIONS,
  EMERGENCY_ACTION_OPTIONS,
  EMERGENCY_ACTIVE_FILTER_OPTIONS,
  buildEmergencyControlKey,
  defaultEmergencyReasonCode,
  emergencySecondOperatorRequired,
  emergencyControlTone,
  formatEmergencyActionLabel,
  formatEmergencyScopeLabel,
  toIso
} from "../operator-constants.js";

export default function EmergencyTab({ config, requestHeaders, onEventsChange, refreshSeq }) {
  const [emergencyActiveFilter, setEmergencyActiveFilter] = useState("active");
  const [emergencyScopeTypeFilter, setEmergencyScopeTypeFilter] = useState("all");
  const [emergencyScopeIdFilter, setEmergencyScopeIdFilter] = useState("");
  const [emergencyControlTypeFilter, setEmergencyControlTypeFilter] = useState("all");
  const [emergencyEventActionFilter, setEmergencyEventActionFilter] = useState("all");
  const [emergencyControls, setEmergencyControls] = useState([]);
  const [emergencyEvents, setEmergencyEvents] = useState([]);
  const [selectedEmergencyControlKey, setSelectedEmergencyControlKey] = useState("");
  const [loadingEmergency, setLoadingEmergency] = useState(false);
  const [emergencyError, setEmergencyError] = useState(null);
  const [runningEmergencyAction, setRunningEmergencyAction] = useState(false);
  const [emergencyMutationError, setEmergencyMutationError] = useState(null);
  const [emergencyMutationOutput, setEmergencyMutationOutput] = useState(null);
  const [emergencyAction, setEmergencyAction] = useState("pause");
  const [emergencyActionScopeType, setEmergencyActionScopeType] = useState("tenant");
  const [emergencyActionScopeId, setEmergencyActionScopeId] = useState("");
  const [emergencyReasonCode, setEmergencyReasonCode] = useState(defaultEmergencyReasonCode("pause"));
  const [emergencyReason, setEmergencyReason] = useState("");
  const [emergencyResumeControlTypes, setEmergencyResumeControlTypes] = useState("pause");
  const [emergencyOperatorActionJson, setEmergencyOperatorActionJson] = useState("");
  const [emergencySecondOperatorActionJson, setEmergencySecondOperatorActionJson] = useState("");

  const emergencyResumeControlTypeList = useMemo(
    () =>
      emergencyResumeControlTypes
        .split(",")
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean),
    [emergencyResumeControlTypes]
  );
  const emergencyNeedsSecondOperatorAction = useMemo(
    () => emergencySecondOperatorRequired(emergencyAction, emergencyResumeControlTypeList),
    [emergencyAction, emergencyResumeControlTypeList]
  );
  const emergencyActiveCount = useMemo(
    () => emergencyControls.filter((control) => control?.active === true).length,
    [emergencyControls]
  );
  const selectedEmergencyControl = useMemo(
    () => emergencyControls.find((control) => buildEmergencyControlKey(control) === selectedEmergencyControlKey) ?? null,
    [emergencyControls, selectedEmergencyControlKey]
  );

  const loadEmergencyData = useCallback(async () => {
    setLoadingEmergency(true);
    setEmergencyError(null);
    try {
      const stateQs = new URLSearchParams();
      stateQs.set("limit", "100");
      stateQs.set("offset", "0");
      stateQs.set(
        "active",
        emergencyActiveFilter === "all" ? "all" : emergencyActiveFilter === "inactive" ? "false" : "true"
      );
      if (emergencyScopeTypeFilter !== "all") stateQs.set("scopeType", emergencyScopeTypeFilter);
      if (emergencyScopeTypeFilter !== "all" && emergencyScopeTypeFilter !== "tenant" && emergencyScopeIdFilter.trim() !== "") {
        stateQs.set("scopeId", emergencyScopeIdFilter.trim());
      }
      if (emergencyControlTypeFilter !== "all") stateQs.set("controlType", emergencyControlTypeFilter);

      const eventsQs = new URLSearchParams();
      eventsQs.set("limit", "25");
      eventsQs.set("offset", "0");
      if (emergencyEventActionFilter !== "all") eventsQs.set("action", emergencyEventActionFilter);
      if (emergencyScopeTypeFilter !== "all") eventsQs.set("scopeType", emergencyScopeTypeFilter);
      if (emergencyScopeTypeFilter !== "all" && emergencyScopeTypeFilter !== "tenant" && emergencyScopeIdFilter.trim() !== "") {
        eventsQs.set("scopeId", emergencyScopeIdFilter.trim());
      }
      if (emergencyControlTypeFilter !== "all") eventsQs.set("controlType", emergencyControlTypeFilter);

      const [stateOut, eventsOut] = await Promise.all([
        requestJson({
          baseUrl: config.baseUrl,
          pathname: `/ops/emergency/state?${stateQs.toString()}`,
          method: "GET",
          headers: requestHeaders
        }),
        requestJson({
          baseUrl: config.baseUrl,
          pathname: `/ops/emergency/events?${eventsQs.toString()}`,
          method: "GET",
          headers: requestHeaders
        })
      ]);

      const nextControls = Array.isArray(stateOut?.controls) ? stateOut.controls : [];
      const nextEvents = Array.isArray(eventsOut?.events) ? eventsOut.events : [];
      setEmergencyControls(nextControls);
      setEmergencyEvents(nextEvents);
      if (onEventsChange) onEventsChange(nextEvents);
      if (nextControls.length === 0) {
        setSelectedEmergencyControlKey("");
      } else if (!selectedEmergencyControlKey || !nextControls.some((control) => buildEmergencyControlKey(control) === selectedEmergencyControlKey)) {
        setSelectedEmergencyControlKey(buildEmergencyControlKey(nextControls[0]));
      }
    } catch (err) {
      setEmergencyError(err?.message ?? String(err));
      setEmergencyControls([]);
      setEmergencyEvents([]);
      if (onEventsChange) onEventsChange([]);
      setSelectedEmergencyControlKey("");
    } finally {
      setLoadingEmergency(false);
    }
  }, [
    config.baseUrl,
    emergencyActiveFilter,
    emergencyControlTypeFilter,
    emergencyEventActionFilter,
    emergencyScopeIdFilter,
    emergencyScopeTypeFilter,
    requestHeaders,
    selectedEmergencyControlKey,
    onEventsChange
  ]);

  useEffect(() => {
    void loadEmergencyData();
  }, [loadEmergencyData]);

  useEffect(() => {
    if (refreshSeq > 0) void loadEmergencyData();
  }, [refreshSeq]);

  useEffect(() => {
    setEmergencyReasonCode(defaultEmergencyReasonCode(emergencyAction));
    if (emergencyAction !== "resume") setEmergencyResumeControlTypes("pause");
    if (!emergencySecondOperatorRequired(emergencyAction, emergencyResumeControlTypeList)) {
      setEmergencySecondOperatorActionJson("");
    }
  }, [emergencyAction]);

  async function runEmergencyAction() {
    let operatorAction = null;
    let secondOperatorAction = null;
    try {
      operatorAction = JSON.parse(emergencyOperatorActionJson);
    } catch (err) {
      setEmergencyMutationError(`OperatorAction JSON is invalid: ${err?.message ?? String(err)}`);
      return;
    }
    if (!operatorAction || typeof operatorAction !== "object" || Array.isArray(operatorAction)) {
      setEmergencyMutationError("OperatorAction must be a JSON object.");
      return;
    }
    if (emergencyNeedsSecondOperatorAction || emergencySecondOperatorActionJson.trim() !== "") {
      try {
        secondOperatorAction = JSON.parse(emergencySecondOperatorActionJson);
      } catch (err) {
        setEmergencyMutationError(`SecondOperatorAction JSON is invalid: ${err?.message ?? String(err)}`);
        return;
      }
      if (!secondOperatorAction || typeof secondOperatorAction !== "object" || Array.isArray(secondOperatorAction)) {
        setEmergencyMutationError("SecondOperatorAction must be a JSON object when provided.");
        return;
      }
    }

    setRunningEmergencyAction(true);
    setEmergencyMutationError(null);
    setEmergencyMutationOutput(null);
    try {
      const body = {
        scope: {
          type: emergencyActionScopeType,
          id: emergencyActionScopeType === "tenant" ? null : emergencyActionScopeId.trim()
        },
        reasonCode: emergencyReasonCode.trim() || null,
        reason: emergencyReason.trim() || null,
        operatorAction
      };
      if (emergencyAction === "resume") body.controlTypes = emergencyResumeControlTypeList;
      if (secondOperatorAction) body.secondOperatorAction = secondOperatorAction;
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: `/ops/emergency/${encodeURIComponent(emergencyAction)}`,
        method: "POST",
        headers: requestHeaders,
        body
      });
      setEmergencyMutationOutput(out);
      await loadEmergencyData();
    } catch (err) {
      setEmergencyMutationError(err?.message ?? String(err));
    } finally {
      setRunningEmergencyAction(false);
    }
  }

  const pillLabel = `active ${emergencyActiveCount}`;

  return (
    <>
      <div className="operator-top-actions">
        <span className="operator-pending-pill">{pillLabel}</span>
        <button className="operator-ghost-btn" onClick={() => void loadEmergencyData()}>
          Refresh
        </button>
      </div>
      <main className="operator-main-grid">
        <section className="operator-card operator-queue">
          <div className="operator-card-head operator-card-head-stack">
            <div>
              <h2>Active state</h2>
              <p className="operator-muted operator-small">
                Launch-safe emergency scopes now include tenant, host channel, and Action Wallet action type. Sensitive actions still require pasted signed operator payloads.
              </p>
            </div>
            <div className="operator-filter-row">
              <select value={emergencyActiveFilter} onChange={(event) => setEmergencyActiveFilter(event.target.value)}>
                {EMERGENCY_ACTIVE_FILTER_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select value={emergencyScopeTypeFilter} onChange={(event) => setEmergencyScopeTypeFilter(event.target.value)}>
                <option value="all">all scopes</option>
                {EMERGENCY_SCOPE_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select value={emergencyControlTypeFilter} onChange={(event) => setEmergencyControlTypeFilter(event.target.value)}>
                <option value="all">all controls</option>
                {EMERGENCY_CONTROL_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="operator-queue-summary">
            {EMERGENCY_CONTROL_TYPE_OPTIONS.map((controlType) => {
              const count = emergencyControls.filter(
                (control) => String(control?.controlType ?? "").trim().toLowerCase() === controlType && control?.active === true
              ).length;
              return (
                <span key={controlType} className={emergencyControlTone(controlType, count > 0)}>
                  {controlType} {count}
                </span>
              );
            })}
          </div>

          <div className="operator-detail-body">
            <label className="operator-textarea-wrap">
              <span>Scope ID filter</span>
              <input
                value={emergencyScopeIdFilter}
                onChange={(event) => setEmergencyScopeIdFilter(event.target.value)}
                placeholder={emergencyScopeTypeFilter === "channel" ? "Claude MCP" : emergencyScopeTypeFilter === "action_type" ? "buy" : "agt_..."}
              />
            </label>
          </div>

          <div className="operator-queue-body">
            {loadingEmergency ? <p className="operator-muted">Loading emergency control state...</p> : null}
            {!loadingEmergency && emergencyControls.length === 0 ? (
              <p className="operator-muted">No emergency control state found for the current filter.</p>
            ) : null}
            {!loadingEmergency &&
              emergencyControls.map((control, index) => {
                const controlKey = buildEmergencyControlKey(control) || `control_${index}`;
                const isSelected = controlKey === selectedEmergencyControlKey;
                return (
                  <button
                    key={controlKey}
                    type="button"
                    onClick={() => setSelectedEmergencyControlKey(controlKey)}
                    className={`operator-queue-item ${isSelected ? "is-selected" : ""}`}
                  >
                    <div className="operator-queue-line">
                      <p>{formatEmergencyScopeLabel(control?.scopeType, control?.scopeId)}</p>
                      <span className={emergencyControlTone(control?.controlType, control?.active === true)}>
                        {control?.controlType ?? "unknown"}
                      </span>
                    </div>
                    <div className="operator-queue-tags">
                      <span className={control?.active === true ? "operator-pill operator-pill-critical" : "operator-pill operator-pill-normal"}>
                        {control?.active === true ? "active" : "inactive"}
                      </span>
                      {control?.lastAction ? (
                        <span className="operator-pill operator-pill-normal">{formatEmergencyActionLabel(control.lastAction)}</span>
                      ) : null}
                      {control?.reasonCode ? <span className="operator-pill operator-pill-high">{control.reasonCode}</span> : null}
                    </div>
                    <p className="operator-muted operator-small">{toIso(control?.updatedAt)}</p>
                  </button>
                );
              })}
          </div>
        </section>

        <section className="operator-card operator-detail">
          <div className="operator-card-head">
            <h2>Emergency detail</h2>
            {loadingEmergency ? <span className="operator-muted operator-small">Refreshing...</span> : null}
          </div>

          <div className="operator-detail-body">
            {emergencyError ? <div className="operator-error">{emergencyError}</div> : null}
            {emergencyMutationError ? <div className="operator-error">{emergencyMutationError}</div> : null}

            {selectedEmergencyControl ? (
              <>
                <div className="operator-meta-grid">
                  <article>
                    <span>Scope</span>
                    <p>{formatEmergencyScopeLabel(selectedEmergencyControl?.scopeType, selectedEmergencyControl?.scopeId)}</p>
                  </article>
                  <article>
                    <span>Control</span>
                    <p>{selectedEmergencyControl?.controlType ?? "n/a"}</p>
                  </article>
                  <article>
                    <span>Status</span>
                    <p>{selectedEmergencyControl?.active === true ? "active" : "inactive"}</p>
                  </article>
                  <article>
                    <span>Revision</span>
                    <p>{Number(selectedEmergencyControl?.revision ?? 0)}</p>
                  </article>
                  <article>
                    <span>Activated</span>
                    <p>{toIso(selectedEmergencyControl?.activatedAt)}</p>
                  </article>
                  <article>
                    <span>Resumed</span>
                    <p>{selectedEmergencyControl?.resumedAt ? toIso(selectedEmergencyControl.resumedAt) : "not resumed"}</p>
                  </article>
                </div>

                <section className="operator-json-block">
                  <p>Latest reason</p>
                  <div className="operator-rescue-action-grid">
                    <article className="operator-rescue-action-card">
                      <div className="operator-rescue-action-head">
                        <strong>Reason code</strong>
                        <span className={emergencyControlTone(selectedEmergencyControl?.controlType, selectedEmergencyControl?.active === true)}>
                          {selectedEmergencyControl?.lastAction ?? "unknown"}
                        </span>
                      </div>
                      <span>{selectedEmergencyControl?.reasonCode ?? "No reason code attached."}</span>
                    </article>
                    <article className="operator-rescue-action-card">
                      <div className="operator-rescue-action-head">
                        <strong>Reason</strong>
                        <span className="operator-pill operator-pill-normal">operator note</span>
                      </div>
                      <span>{selectedEmergencyControl?.reason ?? "No freeform reason recorded."}</span>
                    </article>
                  </div>
                </section>
              </>
            ) : (
              <p className="operator-muted">Select a control state row, or use the action form below to create a new one.</p>
            )}

            <section className="operator-json-block">
              <p>Write action</p>
              <div className="operator-triage-grid">
                <label>
                  <span>Action</span>
                  <select value={emergencyAction} onChange={(event) => setEmergencyAction(event.target.value)} disabled={runningEmergencyAction}>
                    {EMERGENCY_ACTION_OPTIONS.map((action) => (
                      <option key={action} value={action}>
                        {action}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Scope type</span>
                  <select
                    value={emergencyActionScopeType}
                    onChange={(event) => setEmergencyActionScopeType(event.target.value)}
                    disabled={runningEmergencyAction}
                  >
                    {EMERGENCY_SCOPE_TYPE_OPTIONS.map((scopeType) => (
                      <option key={scopeType} value={scopeType}>
                        {scopeType}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {emergencyActionScopeType !== "tenant" ? (
                <label className="operator-textarea-wrap">
                  <span>Scope ID</span>
                  <input
                    value={emergencyActionScopeId}
                    onChange={(event) => setEmergencyActionScopeId(event.target.value)}
                    placeholder={emergencyActionScopeType === "channel" ? "Claude MCP" : emergencyActionScopeType === "action_type" ? "buy" : "agt_example"}
                    disabled={runningEmergencyAction}
                  />
                </label>
              ) : null}
              {emergencyAction === "resume" ? (
                <label className="operator-textarea-wrap">
                  <span>Resume control types</span>
                  <input
                    value={emergencyResumeControlTypes}
                    onChange={(event) => setEmergencyResumeControlTypes(event.target.value)}
                    placeholder="pause or kill-switch,revoke"
                    disabled={runningEmergencyAction}
                  />
                </label>
              ) : null}
              <div className="operator-triage-grid">
                <label>
                  <span>Reason code</span>
                  <input
                    value={emergencyReasonCode}
                    onChange={(event) => setEmergencyReasonCode(event.target.value)}
                    placeholder="OPS_EMERGENCY_PAUSE"
                    disabled={runningEmergencyAction}
                  />
                </label>
                <label>
                  <span>Reason</span>
                  <input
                    value={emergencyReason}
                    onChange={(event) => setEmergencyReason(event.target.value)}
                    placeholder="Explain why the control is being changed."
                    disabled={runningEmergencyAction}
                  />
                </label>
              </div>
              <label className="operator-textarea-wrap">
                <span>OperatorAction JSON</span>
                <textarea
                  value={emergencyOperatorActionJson}
                  onChange={(event) => setEmergencyOperatorActionJson(event.target.value)}
                  placeholder='Paste signed OperatorAction.v1 JSON from the incident runbook.'
                  disabled={runningEmergencyAction}
                />
              </label>
              <label className="operator-textarea-wrap">
                <span>{emergencyNeedsSecondOperatorAction ? "SecondOperatorAction JSON (required)" : "SecondOperatorAction JSON (optional)"}</span>
                <textarea
                  value={emergencySecondOperatorActionJson}
                  onChange={(event) => setEmergencySecondOperatorActionJson(event.target.value)}
                  placeholder='Paste a distinct signed operator action when dual control is required.'
                  disabled={runningEmergencyAction}
                />
              </label>
              <p className="operator-muted operator-small">
                Browser signing is intentionally not supported here. This console accepts the same signed operator action envelopes the emergency API requires, including dual control for kill-switch and revoke-class changes.
              </p>
              <div className="operator-decision-actions">
                <button
                  type="button"
                  className={emergencyAction === "resume" ? "operator-ghost-btn" : "operator-deny-btn"}
                  onClick={() => void runEmergencyAction()}
                  disabled={runningEmergencyAction}
                >
                  {runningEmergencyAction ? "Applying..." : `${formatEmergencyActionLabel(emergencyAction)} control`}
                </button>
              </div>
            </section>

            {emergencyMutationOutput ? (
              <section className="operator-json-block">
                <p>Latest output</p>
                <pre>{JSON.stringify(emergencyMutationOutput, null, 2)}</pre>
              </section>
            ) : null}

            <section className="operator-card-head operator-card-head-stack operator-emergency-inline-head">
              <div>
                <h2>Recent events</h2>
                <p className="operator-muted operator-small">
                  Filtered against the same scope selectors as state plus the action filter below.
                </p>
              </div>
              <div className="operator-filter-row">
                <select value={emergencyEventActionFilter} onChange={(event) => setEmergencyEventActionFilter(event.target.value)}>
                  <option value="all">all actions</option>
                  {EMERGENCY_ACTION_OPTIONS.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
              </div>
            </section>
            <section className="operator-events">
              {emergencyEvents.length === 0 ? <p className="operator-muted">No emergency events matched the current filters.</p> : null}
              {emergencyEvents.length > 0 ? (
                <ul>
                  {emergencyEvents.map((event, index) => (
                    <li key={event?.eventId ?? `emg_evt_${index}`}>
                      <strong>{formatEmergencyActionLabel(event?.action)} · {formatEmergencyScopeLabel(event?.scope?.type, event?.scope?.id)}</strong>
                      <span>
                        {event?.controlType ?? (Array.isArray(event?.resumeControlTypes) ? event.resumeControlTypes.join(", ") : "n/a")}
                        {" · "}
                        {toIso(event?.effectiveAt)}
                      </span>
                      <small>
                        {event?.reasonCode ?? "no_reason_code"}
                        {event?.requestId ? ` · ${event.requestId}` : ""}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
        </section>
      </main>
    </>
  );
}
