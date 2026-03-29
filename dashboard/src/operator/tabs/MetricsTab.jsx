import { useCallback, useEffect, useMemo, useState } from "react";
import { requestJson } from "../operator-api.js";
import {
  LAUNCH_SCOPE,
  OUT_OF_SCOPE_ISSUE_CODE_MARKERS,
  buildLaunchScopedMetrics,
  buildLaunchLifecycleRows,
  buildLaunchChannelScorecards,
  buildExecutionPathHealth,
  countIssueCodeMatches,
  isLaunchRescueItem,
  launchGateTone,
  launchChannelGateLabel,
  toIso,
  toPct,
  toSafeNumber
} from "../operator-constants.js";

export default function MetricsTab({ config, requestHeaders, rescueQueue, emergencyEvents, setActiveTab, refreshSeq }) {
  const [phase1Metrics, setPhase1Metrics] = useState(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [metricsError, setMetricsError] = useState(null);

  const loadPhase1Metrics = useCallback(async () => {
    setLoadingMetrics(true);
    setMetricsError(null);
    try {
      const out = await requestJson({
        baseUrl: config.baseUrl,
        pathname: "/ops/network/phase1-metrics?staleRunMinutes=60",
        method: "GET",
        headers: requestHeaders
      });
      setPhase1Metrics(out?.metrics ?? null);
    } catch (err) {
      setMetricsError(err?.message ?? String(err));
      setPhase1Metrics(null);
    } finally {
      setLoadingMetrics(false);
    }
  }, [config.baseUrl, requestHeaders]);

  useEffect(() => {
    void loadPhase1Metrics();
  }, [loadPhase1Metrics]);

  useEffect(() => {
    if (refreshSeq > 0) void loadPhase1Metrics();
  }, [refreshSeq]);

  const launchMetrics = useMemo(() => buildLaunchScopedMetrics(phase1Metrics), [phase1Metrics]);
  const launchRescueItems = useMemo(() => (rescueQueue ?? []).filter((item) => isLaunchRescueItem(item)), [rescueQueue]);
  const approvalConversionPct = useMemo(
    () => toPct(launchMetrics?.totals?.successRuns ?? 0, Math.max(1, launchMetrics?.totals?.approvalsTriggered ?? 0)),
    [launchMetrics]
  );
  const outOfScopeAttemptCount = useMemo(
    () => countIssueCodeMatches(launchMetrics?.topIssueCodes, OUT_OF_SCOPE_ISSUE_CODE_MARKERS),
    [launchMetrics]
  );
  const disputeLinkedLaunchRescueCount = useMemo(
    () =>
      launchRescueItems.filter((item) => {
        const disputeHref = typeof item?.links?.dispute === "string" ? item.links.dispute.trim() : "";
        const disputeId = typeof item?.refs?.disputeId === "string" ? item.refs.disputeId.trim() : "";
        return disputeHref !== "" || disputeId !== "";
      }).length,
    [launchRescueItems]
  );
  const launchChannelScorecards = useMemo(() => buildLaunchChannelScorecards(launchMetrics), [launchMetrics]);
  const launchLifecycleRows = useMemo(() => buildLaunchLifecycleRows(launchMetrics), [launchMetrics]);
  const executionPathHealth = useMemo(
    () => buildExecutionPathHealth(launchMetrics, launchRescueItems, emergencyEvents ?? []),
    [emergencyEvents, launchMetrics, launchRescueItems]
  );

  const pillLabel = `runs ${Number(launchMetrics?.totals?.runs ?? 0)}`;

  return (
    <>
      <div className="operator-top-actions">
        <span className="operator-pending-pill">{pillLabel}</span>
        <button className="operator-ghost-btn" onClick={() => void loadPhase1Metrics()}>
          Refresh
        </button>
      </div>
      <main className="operator-main-grid">
        <section className="operator-card operator-detail">
          <div className="operator-card-head">
            <h2>Launch readiness</h2>
          </div>
          <div className="operator-detail-body">
            {metricsError ? <div className="operator-error">{metricsError}</div> : null}
            {loadingMetrics ? <p className="operator-muted">Loading launch metrics...</p> : null}
            {!loadingMetrics && !phase1Metrics ? <p className="operator-muted">Metrics are unavailable.</p> : null}
            {!loadingMetrics && phase1Metrics && launchMetrics.launchRows.length === 0 ? (
              <p className="operator-muted">No launch-scoped rows are present. The raw endpoint may only contain follow-on categories.</p>
            ) : null}
            {phase1Metrics ? (
              <>
                <section className="operator-json-block">
                  <p>Locked scope</p>
                  <div className="operator-queue-tags">
                    {LAUNCH_SCOPE.actions.map((value) => (
                      <span key={`action_${value}`} className="operator-pill operator-pill-normal">
                        action {value}
                      </span>
                    ))}
                    {LAUNCH_SCOPE.channels.map((value) => (
                      <span key={`channel_${value}`} className="operator-pill operator-pill-normal">
                        channel {value}
                      </span>
                    ))}
                    {LAUNCH_SCOPE.trustSurfaces.map((value) => (
                      <span key={`surface_${value}`} className="operator-pill operator-pill-normal">
                        {value}
                      </span>
                    ))}
                  </div>
                </section>
                <div className="operator-meta-grid">
                  <article>
                    <span>Launch runs</span>
                    <p>{Number(launchMetrics?.totals?.runs ?? 0)}</p>
                  </article>
                  <article>
                    <span>Approval conversion</span>
                    <p>{approvalConversionPct}%</p>
                  </article>
                  <article>
                    <span>Receipt coverage</span>
                    <p>
                      {launchMetrics?.receiptCoverageSupported === true
                        ? `${Number(launchMetrics?.totals?.receiptCoveragePct ?? 0)}%`
                        : "n/a"}
                    </p>
                  </article>
                  <article>
                    <span>Out-of-scope attempts</span>
                    <p>{outOfScopeAttemptCount}</p>
                  </article>
                </div>
                <div className="operator-meta-grid">
                  <article>
                    <span>Approvals pending</span>
                    <p>{Number(launchMetrics?.approvals?.pending ?? 0)}</p>
                  </article>
                  <article>
                    <span>Approved, waiting to resume</span>
                    <p>{Number(launchMetrics?.approvals?.approvedPendingResume ?? 0)}</p>
                  </article>
                  <article>
                    <span>Dispute-linked rescues</span>
                    <p>{disputeLinkedLaunchRescueCount}</p>
                  </article>
                  <article>
                    <span>Open launch rescues</span>
                    <p>{Number(launchMetrics?.rescue?.total ?? 0)}</p>
                  </article>
                </div>
                <p className="operator-muted operator-small">
                  Launch readiness is gated by approval conversion, receipt coverage, out-of-scope blocking, dispute handling, and operator recovery on Claude MCP and OpenClaw only.
                </p>

                <section className="operator-json-block">
                  <p>By launch channel</p>
                  <div className="operator-channel-grid">
                    {launchChannelScorecards.map((card) => (
                      <article key={card.channel} className="operator-channel-card">
                        <div className="operator-channel-card-head">
                          <div>
                            <strong>{card.channel}</strong>
                            <p className="operator-muted operator-small">{card.summary}</p>
                          </div>
                          <span className={launchGateTone(card.status)}>{launchChannelGateLabel(card.status)}</span>
                        </div>
                        <div className="operator-channel-metrics">
                          <article>
                            <span>Runs</span>
                            <p>{Number(card.row?.runs ?? 0)}</p>
                          </article>
                          <article>
                            <span>Approval conversion</span>
                            <p>{card.row?.approvalsTriggered > 0 ? `${card.approvalConversionPct}%` : "pending"}</p>
                          </article>
                          <article>
                            <span>Receipt coverage</span>
                            <p>{launchMetrics?.receiptCoverageSupported === true ? `${Number(card.row?.receiptCoveragePct ?? 0)}%` : "n/a"}</p>
                          </article>
                          <article>
                            <span>Open rescues</span>
                            <p>{Number(card.row?.rescueOpenRuns ?? 0)}</p>
                          </article>
                          <article>
                            <span>Pending approvals</span>
                            <p>{Number(card.row?.approvalsPending ?? 0)}</p>
                          </article>
                          <article>
                            <span>Resume queue</span>
                            <p>{Number(card.row?.approvalsApprovedPendingResume ?? 0)}</p>
                          </article>
                          <article>
                            <span>Out-of-scope</span>
                            <p>{card.outOfScopeAttemptCount}</p>
                          </article>
                          <article>
                            <span>Managed handoffs</span>
                            <p>{Number(card.row?.managedHandoffRuns ?? 0)}</p>
                          </article>
                        </div>
                        <div className="operator-queue-tags">
                          {card.checks.map((check) => (
                            <span
                              key={`${card.channel}:${check.label}`}
                              className={launchGateTone(check.status)}
                              title={check.detail}
                            >
                              {check.label} {check.value}
                            </span>
                          ))}
                        </div>
                        <div className="operator-channel-reasons">
                          <span>Watchpoints</span>
                          {card.reasons.length > 0 ? (
                            <div className="operator-queue-tags">
                              {card.reasons.map((reason) => (
                                <span key={`${card.channel}:${reason}`} className="operator-pill operator-pill-high">
                                  {reason}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="operator-muted operator-small">No active blockers or watchpoints from the current packet.</p>
                          )}
                        </div>
                        {card.topIssues.length > 0 ? (
                          <div className="operator-channel-reasons">
                            <span>Top issue codes</span>
                            <div className="operator-queue-tags">
                              {card.topIssues.map((row) => (
                                <span key={`${card.channel}:${row.code}`} className="operator-pill operator-pill-normal">
                                  {row.code} {Number(row.count ?? 0)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                  <p className="operator-muted operator-small">
                    Channel cards stay inside the locked wallet-only launch scope and now read the per-channel partitions from <code>/ops/network/phase1-metrics</code>.
                  </p>
                </section>

                <section className="operator-json-block">
                  <p>Lifecycle funnel</p>
                  <div className="operator-table-wrap">
                    <table className="operator-table">
                      <thead>
                        <tr>
                          <th>Event</th>
                          <th>Total</th>
                          <th>Claude MCP</th>
                          <th>OpenClaw</th>
                          <th>buy</th>
                          <th>cancel/recover</th>
                        </tr>
                      </thead>
                      <tbody>
                        {launchLifecycleRows.map((row) => (
                          <tr key={row.eventType}>
                            <td><code>{row.eventType}</code></td>
                            <td>{row.total}</td>
                            <td>{row.byChannel.find((candidate) => candidate.channel === "Claude MCP")?.count ?? 0}</td>
                            <td>{row.byChannel.find((candidate) => candidate.channel === "OpenClaw")?.count ?? 0}</td>
                            <td>{row.byActionType.find((candidate) => candidate.actionType === "buy")?.count ?? 0}</td>
                            <td>{row.byActionType.find((candidate) => candidate.actionType === "cancel/recover")?.count ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="operator-muted operator-small">
                    Funnel counts come from the frozen Action Wallet lifecycle taxonomy and stay scoped to the two launch channels and launch action types only.
                  </p>
                </section>

                <section className="operator-json-block">
                  <p>Execution path health</p>
                  <div className="operator-queue-tags" style={{ marginBottom: "0.75rem" }}>
                    <button type="button" className="operator-ghost-btn" onClick={() => setActiveTab("rescue")}>
                      Open rescue queue
                    </button>
                    <button type="button" className="operator-ghost-btn" onClick={() => setActiveTab("emergency")}>
                      Open emergency controls
                    </button>
                  </div>
                  <div className="operator-channel-grid">
                    {executionPathHealth.byChannel.map((card) => (
                      <article key={`execution:${card.channel}`} className="operator-channel-card">
                        <div className="operator-channel-card-head">
                          <div>
                            <strong>{card.channel}</strong>
                            <p className="operator-muted operator-small">
                              Runtime failures {card.runtimeFailureRatePct}% · provider touchpoint failures {card.providerFailureRatePct}%.
                            </p>
                          </div>
                          <span className={card.runtimeFailureCount > 0 ? "operator-pill operator-pill-high" : "operator-pill operator-pill-normal"}>
                            {card.runtimeFailureCount > 0 ? "watch" : "stable"}
                          </span>
                        </div>
                        <div className="operator-meta-grid">
                          <article>
                            <span>Runs</span>
                            <p>{Number(card.row?.runs ?? 0)}</p>
                          </article>
                          <article>
                            <span>Managed handoffs</span>
                            <p>{Number(card.row?.managedHandoffRuns ?? 0)}</p>
                          </article>
                          <article>
                            <span>Managed invocations</span>
                            <p>{Number(card.row?.managedInvocationRuns ?? 0)}</p>
                          </article>
                          <article>
                            <span>Open rescues</span>
                            <p>{Number(card.row?.rescueOpenRuns ?? 0)}</p>
                          </article>
                        </div>
                        <div className="operator-channel-reasons">
                          <span>Runtime verification path</span>
                          <div className="operator-queue-tags">
                            {card.runtimeBuckets.map((bucket) => (
                              <span
                                key={`${card.channel}:runtime:${bucket.id}`}
                                className={bucket.count > 0 ? "operator-pill operator-pill-high" : "operator-pill operator-pill-normal"}
                                title={`${bucket.count} issues across ${Number(card.row?.runs ?? 0)} runs`}
                              >
                                {bucket.label} {bucket.count}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="operator-channel-reasons">
                          <span>Provider touchpoints</span>
                          <div className="operator-queue-tags">
                            {card.providerBuckets.map((bucket) => (
                              <span
                                key={`${card.channel}:provider:${bucket.id}`}
                                className={bucket.count > 0 ? "operator-pill operator-pill-high" : "operator-pill operator-pill-normal"}
                                title={`${bucket.count} issues across ${Number(card.row?.runs ?? 0)} runs`}
                              >
                                {bucket.label} {bucket.count}
                              </span>
                            ))}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="operator-meta-grid">
                    <article>
                      <span>Runtime totals</span>
                      <p>{executionPathHealth.runtimeTotals.reduce((total, bucket) => total + toSafeNumber(bucket.count), 0)}</p>
                    </article>
                    <article>
                      <span>Provider totals</span>
                      <p>{executionPathHealth.providerTotals.reduce((total, bucket) => total + toSafeNumber(bucket.count), 0)}</p>
                    </article>
                    <article>
                      <span>Recent incidents</span>
                      <p>{executionPathHealth.recentIncidents.length}</p>
                    </article>
                    <article>
                      <span>Rescue-linked disputes</span>
                      <p>{disputeLinkedLaunchRescueCount}</p>
                    </article>
                  </div>
                  <div className="operator-channel-grid">
                    <article className="operator-channel-card">
                      <div className="operator-channel-card-head">
                        <div>
                          <strong>Provider touchpoint totals</strong>
                          <p className="operator-muted operator-small">Failures stay bucketed by handoff, invocation, and money-state touchpoints.</p>
                        </div>
                      </div>
                      <div className="operator-queue-tags">
                        {executionPathHealth.providerTotals.map((bucket) => (
                          <span
                            key={`provider-total:${bucket.id}`}
                            className={bucket.count > 0 ? "operator-pill operator-pill-high" : "operator-pill operator-pill-normal"}
                          >
                            {bucket.label} {bucket.count}
                          </span>
                        ))}
                      </div>
                    </article>
                    <article className="operator-channel-card">
                      <div className="operator-channel-card-head">
                        <div>
                          <strong>Recent incidents</strong>
                          <p className="operator-muted operator-small">Latest rescues and emergency actions affecting the locked launch scope.</p>
                        </div>
                      </div>
                      {executionPathHealth.recentIncidents.length > 0 ? (
                        <div className="operator-channel-reasons">
                          {executionPathHealth.recentIncidents.map((incident) => (
                            <div key={incident.id} className="operator-step-item">
                              <div>
                                <strong>{incident.title}</strong>
                                <p className="operator-muted operator-small">{incident.detail}</p>
                                <small>{toIso(incident.at)}</small>
                              </div>
                              <div className="operator-queue-tags">
                                <span className={incident.tone}>{incident.badge}</span>
                                {incident.href ? (
                                  <a className="operator-ghost-btn" href={incident.href}>
                                    Open
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="operator-muted operator-small">No recent launch incidents are attached to rescue or emergency telemetry right now.</p>
                      )}
                    </article>
                  </div>
                  <p className="operator-muted operator-small">
                    This panel reads the same launch metrics, rescue queue, and emergency telemetry already loaded by the console, then groups failures by runtime verification path and provider touchpoint for launch ops.
                  </p>
                </section>

                <section className="operator-json-block">
                  <p>By launch category</p>
                  <div className="operator-table-wrap">
                    <table className="operator-table">
                      <thead>
                        <tr>
                          <th>Family</th>
                          <th>Runs</th>
                          <th>Completion</th>
                          <th>Evidence</th>
                          <th>Receipts</th>
                          <th>Rescue</th>
                          <th>Approvals</th>
                        </tr>
                      </thead>
                      <tbody>
                        {launchMetrics.launchRows.map((row) => (
                          <tr key={row?.categoryId ?? row?.categoryLabel}>
                            <td>{row?.categoryLabel ?? row?.categoryId ?? "Unknown"}</td>
                            <td>{Number(row?.runs ?? 0)}</td>
                            <td>{Number(row?.completionRatePct ?? 0)}%</td>
                            <td>{Number(row?.evidenceCoveragePct ?? 0)}%</td>
                            <td>{launchMetrics?.receiptCoverageSupported === true ? `${Number(row?.receiptCoveragePct ?? 0)}%` : "n/a"}</td>
                            <td>{Number(row?.rescueRatePct ?? 0)}%</td>
                            <td>{Number(row?.approvalsTriggered ?? 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {launchMetrics.ignoredRows.length > 0 ? (
                  <section className="operator-json-block">
                    <p>Ignored for launch gate</p>
                    <div className="operator-queue-tags">
                      {launchMetrics.ignoredRows.map((row) => (
                        <span key={`ignored_${row?.categoryId ?? row?.categoryLabel}`} className="operator-pill operator-pill-normal">
                          {row?.categoryLabel ?? row?.categoryId ?? "Unknown"} {Number(row?.runs ?? 0)}
                        </span>
                      ))}
                    </div>
                    <p className="operator-muted operator-small">
                      These categories remain visible in the raw endpoint but do not count toward Action Wallet launch readiness.
                    </p>
                  </section>
                ) : null}

                <section className="operator-json-block">
                  <p>Launch issue codes</p>
                  <div className="operator-queue-tags">
                    {launchMetrics.topIssueCodes.map((row) => (
                      <span key={row?.code} className="operator-pill operator-pill-normal">
                        {row?.code} {Number(row?.count ?? 0)}
                      </span>
                    ))}
                  </div>
                  <p className="operator-muted operator-small">Generated {toIso(launchMetrics?.generatedAt)}</p>
                </section>
              </>
            ) : null}
          </div>
        </section>
      </main>
    </>
  );
}
