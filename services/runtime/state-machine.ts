export const WORKER_EXECUTION_STATUSES = [
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
] as const;

export type WorkerExecutionStatus = typeof WORKER_EXECUTION_STATUSES[number];

export const WORKER_EXECUTION_TERMINAL_STATUSES = [
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
] as const;

export type WorkerExecutionTerminalStatus = typeof WORKER_EXECUTION_TERMINAL_STATUSES[number];

const EXECUTION_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
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

export function isTerminalExecutionStatus(status: unknown): boolean {
  return (WORKER_EXECUTION_TERMINAL_STATUSES as readonly string[]).includes(String(status || ''));
}

export function isKnownExecutionStatus(status: unknown): boolean {
  return (WORKER_EXECUTION_STATUSES as readonly string[]).includes(String(status || ''));
}

export function isValidExecutionTransition(fromStatus: unknown, toStatus: unknown): boolean {
  const from = fromStatus == null ? null : String(fromStatus);
  const to = String(toStatus || '');

  if (!isKnownExecutionStatus(to)) return false;
  if (from == null) return to === 'queued' || to === 'running';
  if (!isKnownExecutionStatus(from)) return false;
  if (from === to) return true;
  if (isTerminalExecutionStatus(from)) return false;
  return EXECUTION_TRANSITIONS[from]?.has(to) === true;
}

export const WORKER_APPROVAL_STATUSES = [
  'pending',
  'approved',
  'denied',
  'resumed',
  'edited',
  'timeout',
] as const;

export type WorkerApprovalStatus = typeof WORKER_APPROVAL_STATUSES[number];

export const WORKER_APPROVAL_DECISIONS = [
  'approved',
  'denied',
  'edited',
  'timeout',
] as const;

export type WorkerApprovalDecision = typeof WORKER_APPROVAL_DECISIONS[number];

const APPROVAL_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  pending: new Set(['approved', 'denied', 'edited', 'timeout']),
  approved: new Set(['resumed']),
});

const APPROVAL_STATUS_TO_DECISION: Readonly<Record<string, string | null>> = Object.freeze({
  pending: null,
  approved: 'approved',
  denied: 'denied',
  resumed: 'approved',
  edited: 'edited',
  timeout: 'timeout',
});

export function isKnownApprovalStatus(status: unknown): boolean {
  return (WORKER_APPROVAL_STATUSES as readonly string[]).includes(String(status || ''));
}

export function isKnownApprovalDecision(decision: unknown): boolean {
  return decision == null || decision === '' || (WORKER_APPROVAL_DECISIONS as readonly string[]).includes(String(decision));
}

export function isValidApprovalStatusDecision(status: unknown, decision: unknown): boolean {
  const normalizedStatus = String(status || '');
  const normalizedDecision = decision == null || decision === '' ? null : String(decision);

  if (!isKnownApprovalStatus(normalizedStatus) || !isKnownApprovalDecision(normalizedDecision)) {
    return false;
  }

  return APPROVAL_STATUS_TO_DECISION[normalizedStatus] === normalizedDecision;
}

export function isValidApprovalTransition(fromStatus: unknown, toStatus: unknown): boolean {
  const from = fromStatus == null ? null : String(fromStatus);
  const to = String(toStatus || '');

  if (!isKnownApprovalStatus(to)) return false;
  if (from == null) return to === 'pending';
  if (!isKnownApprovalStatus(from)) return false;
  if (from === to) return true;
  return APPROVAL_TRANSITIONS[from]?.has(to) === true;
}
