/**
 * Hosted worker verification.
 *
 * Deterministic post-run verification that evaluates whether an execution
 * achieved an acceptable outcome using receipt data only.
 */

function getMetricFromReceipt(receipt, metric) {
  if (!receipt || typeof receipt !== 'object') return undefined;
  switch (metric) {
    case 'toolCallCount':
      return Number(receipt.toolCallCount ?? 0);
    case 'durationMs':
    case 'duration':
      return Number(receipt.durationMs ?? receipt.duration ?? 0);
    case 'rounds':
      return Number(receipt.rounds ?? 0);
    case 'blockedActionCount':
      return Array.isArray(receipt.blockedActions) ? receipt.blockedActions.length : 0;
    case 'pendingApprovalCount':
      return Array.isArray(receipt.approvalsPending) ? receipt.approvalsPending.length : 0;
    default:
      return receipt[metric];
  }
}

function buildAssertionResult(assertion, passed, actualValue, evidence = null) {
  return {
    type: assertion.type,
    passed,
    actualValue,
    expectedDescription: assertion.expectedDescription || null,
    evidence,
  };
}

function assertExecutionMetric(assertion, receipt) {
  const actual = getMetricFromReceipt(receipt, assertion.metric);
  const threshold = Number(assertion.threshold);
  const predicate = String(assertion.predicate || '').toUpperCase();
  if (!Number.isFinite(Number(actual)) || !Number.isFinite(threshold)) {
    return buildAssertionResult(assertion, false, actual, 'metric or threshold is not numeric');
  }

  const passed =
    predicate === 'LESS_THAN' ? actual < threshold :
    predicate === 'LESS_THAN_OR_EQUAL' ? actual <= threshold :
    predicate === 'GREATER_THAN' ? actual > threshold :
    predicate === 'GREATER_THAN_OR_EQUAL' ? actual >= threshold :
    predicate === 'EQUALS' ? actual === threshold :
    false;

  return buildAssertionResult(assertion, passed, actual, passed ? null : `${assertion.metric}=${actual}, expected ${predicate} ${threshold}`);
}

function assertResponseContent(assertion, receipt) {
  const response = String(receipt?.response || '');
  const pattern = assertion.pattern;
  if (!pattern) return buildAssertionResult(assertion, false, null, 'pattern is required');

  let regex;
  try {
    regex = new RegExp(pattern, 'i');
  } catch (err) {
    return buildAssertionResult(assertion, false, null, `invalid regex: ${err.message}`);
  }

  const matches = regex.test(response);
  const rule = String(assertion.contentRule || '').toUpperCase();
  const passed = rule === 'NOT_MATCHES_PATTERN' ? !matches : matches;
  return buildAssertionResult(assertion, passed, matches, passed ? null : `response content rule failed for /${pattern}/`);
}

function toolCallCount(receipt, toolName) {
  const entries = Array.isArray(receipt?.toolResults) ? receipt.toolResults : [];
  return entries.filter(entry => entry && entry.name === toolName).length;
}

function assertToolCallRequired(assertion, receipt) {
  const count = toolCallCount(receipt, assertion.toolName);
  const minimum = Number(assertion.minimumCallCount ?? 1);
  return buildAssertionResult(
    assertion,
    count >= minimum,
    count,
    count >= minimum ? null : `tool "${assertion.toolName}" called ${count} time(s), expected >= ${minimum}`
  );
}

function assertToolCallAbsent(assertion, receipt) {
  const count = toolCallCount(receipt, assertion.toolName);
  return buildAssertionResult(
    assertion,
    count === 0,
    count,
    count === 0 ? null : `tool "${assertion.toolName}" was called ${count} time(s)`
  );
}

function assertDurationLimit(assertion, receipt) {
  const duration = Number(receipt?.durationMs ?? receipt?.duration ?? 0);
  const maxDuration = Number(assertion.maxDurationMs);
  if (!Number.isFinite(duration) || !Number.isFinite(maxDuration)) {
    return buildAssertionResult(assertion, false, duration, 'duration or maxDurationMs is invalid');
  }
  return buildAssertionResult(
    assertion,
    duration <= maxDuration,
    duration,
    duration <= maxDuration ? null : `duration ${duration}ms exceeds ${maxDuration}ms`
  );
}

function assertNoBlockedActions(assertion, receipt) {
  const count = Array.isArray(receipt?.blockedActions) ? receipt.blockedActions.length : 0;
  return buildAssertionResult(assertion, count === 0, count, count === 0 ? null : `${count} blocked action(s) detected`);
}

function assertNoPendingApprovals(assertion, receipt) {
  const count = Array.isArray(receipt?.approvalsPending) ? receipt.approvalsPending.length : 0;
  return buildAssertionResult(assertion, count === 0, count, count === 0 ? null : `${count} pending approval(s) detected`);
}

function assertNoErrorsInLog(assertion, receipt) {
  const entries = Array.isArray(receipt?.toolResults) ? receipt.toolResults : [];
  const errorCount = entries.filter(entry => entry && entry.success === false).length;
  return buildAssertionResult(assertion, errorCount === 0, errorCount, errorCount === 0 ? null : `${errorCount} tool execution error(s) detected`);
}

function assertNoInterruption(assertion, receipt) {
  const interruption = receipt?.interruption ?? null;
  const code = interruption && typeof interruption === 'object'
    ? interruption.code || 'interrupted'
    : interruption;
  const detail = interruption && typeof interruption === 'object' ? interruption.detail : null;
  return buildAssertionResult(
    assertion,
    !code,
    code,
    code ? `execution interrupted: ${code}${detail ? ` (${detail})` : ''}` : null
  );
}

const ASSERTION_HANDLERS = {
  execution_metric: assertExecutionMetric,
  response_content: assertResponseContent,
  tool_call_required: assertToolCallRequired,
  tool_call_absent: assertToolCallAbsent,
  duration_limit: assertDurationLimit,
  no_blocked_actions: assertNoBlockedActions,
  no_pending_approvals: assertNoPendingApprovals,
  no_errors_in_log: assertNoErrorsInLog,
  no_interruption: assertNoInterruption,
};

export function createDefaultVerificationPlan() {
  return {
    schemaVersion: 'VerificationPlan.v1',
    passCriteria: 'all_required_pass',
    outcomeAssertions: [
      {
        type: 'no_blocked_actions',
        expectedDescription: 'no blocked actions during execution',
      },
      {
        type: 'no_pending_approvals',
        expectedDescription: 'no pending approvals at completion',
      },
      {
        type: 'no_interruption',
        expectedDescription: 'execution reached a natural completion path',
      },
      {
        type: 'duration_limit',
        maxDurationMs: 300000,
        expectedDescription: 'duration <= 300000ms',
      },
      {
        type: 'no_errors_in_log',
        expectedDescription: 'no tool execution errors',
      },
    ],
  };
}

export function deriveBusinessOutcome(results, criteria = 'all_required_pass') {
  if (!Array.isArray(results) || results.length === 0) return 'skipped';
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;
  if (failedCount === 0) return 'passed';
  if (criteria === 'all_required_pass') return 'failed';
  return passedCount > 0 ? 'partial' : 'failed';
}

export function runVerification(receipt, verificationPlan) {
  if (!verificationPlan || typeof verificationPlan !== 'object') {
    return {
      schemaVersion: 'VerificationReport.v1',
      businessOutcome: 'skipped',
      passCriteria: null,
      assertions: [],
      warnings: [],
    };
  }

  const assertions = Array.isArray(verificationPlan.outcomeAssertions)
    ? verificationPlan.outcomeAssertions
    : [];
  const warnings = [];
  const results = assertions.map(assertion => {
    const handler = ASSERTION_HANDLERS[assertion.type];
    if (!handler) {
      warnings.push({
        code: 'unknown_assertion_type',
        assertionType: assertion.type || null,
        message: `Unknown verification assertion type: ${assertion.type}`,
      });
      return buildAssertionResult(assertion, false, null, `unknown assertion type: ${assertion.type}`);
    }
    try {
      return handler(assertion, receipt);
    } catch (err) {
      warnings.push({
        code: 'assertion_handler_error',
        assertionType: assertion.type || null,
        message: err?.message || String(err),
      });
      return buildAssertionResult(assertion, false, null, err.message || String(err));
    }
  });

  return {
    schemaVersion: 'VerificationReport.v1',
    verifiedAt: new Date().toISOString(),
    passCriteria: verificationPlan.passCriteria || 'all_required_pass',
    businessOutcome: deriveBusinessOutcome(results, verificationPlan.passCriteria || 'all_required_pass'),
    assertions: results,
    warnings,
  };
}
