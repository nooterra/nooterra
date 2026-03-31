function parseReceipt(receipt) {
  if (!receipt) return {};
  if (typeof receipt === "string") {
    try {
      return JSON.parse(receipt);
    } catch {
      return {};
    }
  }
  return receipt;
}

export function isSuccessfulExecution(execution) {
  const receipt = parseReceipt(execution?.receipt);
  return (execution?.status === "completed" || execution?.status === "shadow_completed")
    && (!receipt.businessOutcome || receipt.businessOutcome === "passed" || receipt.businessOutcome === "partial");
}

export function isFailedExecution(execution) {
  const receipt = parseReceipt(execution?.receipt);
  return execution?.status === "failed"
    || execution?.status === "error"
    || execution?.status === "charter_blocked"
    || execution?.status === "auto_paused"
    || receipt.businessOutcome === "failed";
}

export function summarizeExecutionStatuses(executions = [], lookbackDays = 30) {
  const recent = recentExecutions(executions, lookbackDays);
  const counts = {};
  for (const execution of recent) {
    const status = String(execution?.status || 'unknown');
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function effectiveDecision(approval) {
  const status = String(approval?.status || '').toLowerCase();
  if (status === 'resumed' || status === 'pending') return status;
  return String(approval?.decision || status || '').toLowerCase();
}

function recentExecutions(executions, lookbackDays) {
  const cutoff = Date.now() - (lookbackDays * 24 * 60 * 60 * 1000);
  return executions.filter((execution) => {
    const startedAt = Date.parse(execution?.started_at || execution?.startedAt || "");
    return Number.isFinite(startedAt) && startedAt >= cutoff;
  });
}

export function summarizeExecutionOutcomes(executions = [], lookbackDays = 30) {
  const recent = recentExecutions(executions, lookbackDays);
  const successful = recent.filter(isSuccessfulExecution).length;
  const failed = recent.filter(isFailedExecution).length;
  const terminal = successful + failed;
  return {
    lookbackDays,
    totalRecentRuns: recent.length,
    successfulRecentRuns: successful,
    failedRecentRuns: failed,
    terminalRecentRuns: terminal,
    recentSuccessRate: terminal > 0 ? Math.round((successful / terminal) * 100) : 0
  };
}

export function analyzePromotionCandidates({
  charter,
  executions = [],
  approvals = [],
  lookbackDays = 30,
  minApprovedActions = 5,
  minRecentSuccessRate = 90
} = {}) {
  const askFirstRules = Array.isArray(charter?.askFirst) ? charter.askFirst : [];
  if (askFirstRules.length === 0) return [];

  const executionSummary = summarizeExecutionOutcomes(executions, lookbackDays);
  if (executionSummary.recentSuccessRate < minRecentSuccessRate) return [];

  const approvalStats = new Map(askFirstRules.map((rule) => [rule, {
    approved: 0,
    denied: 0,
    pending: 0,
    resumed: 0,
    latestDecisionAt: null
  }]));

  for (const approval of approvals) {
    const rule = approval?.matched_rule || null;
    if (!rule || !approvalStats.has(rule)) continue;

    const stats = approvalStats.get(rule);
    const decision = effectiveDecision(approval);
    if (decision === "approved") stats.approved += 1;
    else if (decision === "denied") stats.denied += 1;
    else if (decision === "resumed") stats.resumed += 1;
    else if (decision === "pending") stats.pending += 1;

    const decidedAt = approval?.decided_at || approval?.created_at || null;
    if (decidedAt && (!stats.latestDecisionAt || Date.parse(decidedAt) > Date.parse(stats.latestDecisionAt))) {
      stats.latestDecisionAt = decidedAt;
    }
  }

  return askFirstRules
    .map((rule) => {
      const stats = approvalStats.get(rule);
      if (!stats) return null;

      const approvedLikeCount = stats.approved + stats.resumed;
      if (approvedLikeCount < minApprovedActions || stats.denied > 0 || stats.pending > 0) {
        return null;
      }

      const confidence = Math.min(
        0.99,
        0.55 + Math.min(approvedLikeCount, 10) * 0.03 + (executionSummary.recentSuccessRate / 100) * 0.15
      );

      return {
        action: rule,
        confidence: Number(confidence.toFixed(2)),
        evidence: {
          lookbackDays,
          approvedActions: approvedLikeCount,
          deniedActions: stats.denied,
          pendingActions: stats.pending,
          recentRuns: executionSummary.totalRecentRuns,
          recentTerminalRuns: executionSummary.terminalRecentRuns,
          recentSuccessRate: executionSummary.recentSuccessRate,
          latestDecisionAt: stats.latestDecisionAt
        }
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.confidence - left.confidence);
}

export function summarizeSignals(signals = []) {
  const summary = {
    totalSignals: signals.length,
    verdictCounts: {},
    outcomeCounts: {},
    approvalDecisionCounts: {},
    interruptionCounts: {},
    tools: [],
  };

  const byTool = new Map();

  for (const signal of signals) {
    const toolName = String(signal?.tool_name || 'unknown');
    const verdict = String(signal?.charter_verdict || 'unknown');
    const outcome = String(signal?.execution_outcome || 'unknown');
    const approvalDecision = signal?.approval_decision ? String(signal.approval_decision) : null;
    const interruptionCode = signal?.interruption_code ? String(signal.interruption_code) : null;

    summary.verdictCounts[verdict] = (summary.verdictCounts[verdict] || 0) + 1;
    summary.outcomeCounts[outcome] = (summary.outcomeCounts[outcome] || 0) + 1;
    if (approvalDecision) {
      summary.approvalDecisionCounts[approvalDecision] = (summary.approvalDecisionCounts[approvalDecision] || 0) + 1;
    }
    if (interruptionCode) {
      summary.interruptionCounts[interruptionCode] = (summary.interruptionCounts[interruptionCode] || 0) + 1;
    }

    let toolSummary = byTool.get(toolName);
    if (!toolSummary) {
      toolSummary = {
        toolName,
        totalSignals: 0,
        successfulSignals: 0,
        failedSignals: 0,
        blockedSignals: 0,
        approvalSignals: 0,
        latestSeenAt: null,
        matchedRules: new Set(),
      };
      byTool.set(toolName, toolSummary);
    }

    toolSummary.totalSignals += 1;
    if (signal?.tool_success === true) toolSummary.successfulSignals += 1;
    if (signal?.tool_success === false && outcome !== 'blocked') toolSummary.failedSignals += 1;
    if (outcome === 'blocked') toolSummary.blockedSignals += 1;
    if (verdict === 'askFirst' || approvalDecision) toolSummary.approvalSignals += 1;
    if (signal?.matched_rule) toolSummary.matchedRules.add(String(signal.matched_rule));
    if (signal?.created_at && (!toolSummary.latestSeenAt || Date.parse(signal.created_at) > Date.parse(toolSummary.latestSeenAt))) {
      toolSummary.latestSeenAt = signal.created_at;
    }
  }

  summary.tools = [...byTool.values()]
    .map((tool) => ({
      ...tool,
      matchedRules: [...tool.matchedRules].sort(),
    }))
    .sort((left, right) => right.totalSignals - left.totalSignals || left.toolName.localeCompare(right.toolName));

  return summary;
}

export function buildRuleAnalytics({ charter, approvals = [], signals = [] } = {}) {
  const askFirstRules = Array.isArray(charter?.askFirst) ? charter.askFirst : [];
  const approvalStats = new Map(askFirstRules.map((rule) => [rule, {
    rule,
    approved: 0,
    denied: 0,
    pending: 0,
    resumed: 0,
    edited: 0,
    timeout: 0,
    successfulSignals: 0,
    failedSignals: 0,
    blockedSignals: 0,
    latestDecisionAt: null,
  }]));

  for (const approval of approvals) {
    const rule = approval?.matched_rule || null;
    if (!rule || !approvalStats.has(rule)) continue;

    const stats = approvalStats.get(rule);
    const decision = effectiveDecision(approval) || 'pending';
    if (decision === 'approved') stats.approved += 1;
    else if (decision === 'denied') stats.denied += 1;
    else if (decision === 'resumed') stats.resumed += 1;
    else if (decision === 'edited') stats.edited += 1;
    else if (decision === 'timeout') stats.timeout += 1;
    else stats.pending += 1;

    const decidedAt = approval?.decided_at || approval?.created_at || null;
    if (decidedAt && (!stats.latestDecisionAt || Date.parse(decidedAt) > Date.parse(stats.latestDecisionAt))) {
      stats.latestDecisionAt = decidedAt;
    }
  }

  for (const signal of signals) {
    const rule = signal?.matched_rule || null;
    if (!rule || !approvalStats.has(rule)) continue;
    const stats = approvalStats.get(rule);
    if (signal?.execution_outcome === 'blocked') stats.blockedSignals += 1;
    else if (signal?.tool_success === true) stats.successfulSignals += 1;
    else if (signal?.tool_success === false) stats.failedSignals += 1;
  }

  return [...approvalStats.values()].map((stats) => ({
    ...stats,
    approvedActions: stats.approved + stats.resumed,
    unstable: stats.denied > 0 || stats.pending > 0 || stats.failedSignals > 0 || stats.blockedSignals > 0,
  }));
}

export function buildLearningAnalytics({
  charter,
  executions = [],
  approvals = [],
  signals = [],
  lookbackDays = 30,
} = {}) {
  const executionSummary = summarizeExecutionOutcomes(executions, lookbackDays);
  const executionStatusCounts = summarizeExecutionStatuses(executions, lookbackDays);
  const signalSummary = summarizeSignals(signals);
  const ruleAnalytics = buildRuleAnalytics({ charter, approvals, signals });
  const promotionCandidates = analyzePromotionCandidates({ charter, executions, approvals, lookbackDays });

  return {
    lookbackDays,
    executionSummary,
    executionStatusCounts,
    signalSummary,
    ruleAnalytics,
    promotionCandidates,
    unstableRules: ruleAnalytics.filter((rule) => rule.unstable),
  };
}
