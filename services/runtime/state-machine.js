export const WORKER_EXECUTION_STATUSES = Object.freeze([
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'shadow_completed',
  'failed',
  'charter_blocked',
  'budget_exceeded',
  'auto_paused',
  'error',
  'billing_error',
  'rate_limited',
  'skipped',
]);

export const WORKER_EXECUTION_TERMINAL_STATUSES = Object.freeze([
  'completed',
  'shadow_completed',
  'failed',
  'charter_blocked',
  'budget_exceeded',
  'auto_paused',
  'error',
  'billing_error',
  'rate_limited',
  'skipped',
]);

const EXECUTION_TRANSITIONS = Object.freeze({
  queued: new Set(['running', 'failed']),
  running: new Set([
    'queued',
    'awaiting_approval',
    'completed',
    'shadow_completed',
    'failed',
    'charter_blocked',
    'budget_exceeded',
    'auto_paused',
    'error',
    'billing_error',
    'rate_limited',
    'skipped',
  ]),
  awaiting_approval: new Set(['running', 'failed', 'charter_blocked']),
});

export function isTerminalExecutionStatus(status) {
  return WORKER_EXECUTION_TERMINAL_STATUSES.includes(String(status || ''));
}

export function isKnownExecutionStatus(status) {
  return WORKER_EXECUTION_STATUSES.includes(String(status || ''));
}

export function isValidExecutionTransition(fromStatus, toStatus) {
  const from = fromStatus == null ? null : String(fromStatus);
  const to = String(toStatus || '');

  if (!isKnownExecutionStatus(to)) return false;
  if (from == null) return to === 'queued' || to === 'running';
  if (!isKnownExecutionStatus(from)) return false;
  if (from === to) return true;
  if (isTerminalExecutionStatus(from)) return false;
  return EXECUTION_TRANSITIONS[from]?.has(to) === true;
}

export const WORKER_APPROVAL_STATUSES = Object.freeze([
  'pending',
  'approved',
  'denied',
  'resumed',
  'edited',
  'timeout',
]);

export const WORKER_APPROVAL_DECISIONS = Object.freeze([
  'approved',
  'denied',
  'edited',
  'timeout',
]);

const APPROVAL_TRANSITIONS = Object.freeze({
  pending: new Set(['approved', 'denied', 'edited', 'timeout']),
  approved: new Set(['resumed']),
});

const APPROVAL_STATUS_TO_DECISION = Object.freeze({
  pending: null,
  approved: 'approved',
  denied: 'denied',
  resumed: 'approved',
  edited: 'edited',
  timeout: 'timeout',
});

export function isKnownApprovalStatus(status) {
  return WORKER_APPROVAL_STATUSES.includes(String(status || ''));
}

export function isKnownApprovalDecision(decision) {
  return decision == null || decision === '' || WORKER_APPROVAL_DECISIONS.includes(String(decision));
}

export function isValidApprovalStatusDecision(status, decision) {
  const normalizedStatus = String(status || '');
  const normalizedDecision = decision == null || decision === '' ? null : String(decision);

  if (!isKnownApprovalStatus(normalizedStatus) || !isKnownApprovalDecision(normalizedDecision)) {
    return false;
  }

  return APPROVAL_STATUS_TO_DECISION[normalizedStatus] === normalizedDecision;
}

export function isValidApprovalTransition(fromStatus, toStatus) {
  const from = fromStatus == null ? null : String(fromStatus);
  const to = String(toStatus || '');

  if (!isKnownApprovalStatus(to)) return false;
  if (from == null) return to === 'pending';
  if (!isKnownApprovalStatus(from)) return false;
  if (from === to) return true;
  return APPROVAL_TRANSITIONS[from]?.has(to) === true;
}
