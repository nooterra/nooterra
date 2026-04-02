/**
 * Charter → AuthorityGrant migration shim.
 *
 * Translates existing canDo/askFirst/neverDo charter arrays into
 * typed AuthorityGrants. This is the backward-compatibility bridge
 * that lets old-style workers work with the new authority system.
 *
 * Translation rules:
 *   canDo: ["Send emails"]    → actionClass 'communicate.email', allowed
 *   askFirst: ["Make payments"] → actionClass 'financial.payment', requireApproval
 *   neverDo: ["Delete data"]   → actionClass 'data.delete', forbidden
 *   Unknown tool names         → 'legacy.<tool_name>' as fallback
 */

import type { GrantScope, GrantConstraints, CreateGrantInput } from './authority-graph.js';
import type { ActionClass } from '../core/objects.js';
import { ACTION_CLASSES } from '../core/objects.js';

// ---------------------------------------------------------------------------
// Charter rule → ActionClass mapping
// ---------------------------------------------------------------------------

const RULE_TO_ACTION_CLASS: Record<string, string> = {
  // Communication
  'send email': 'communicate.email',
  'send emails': 'communicate.email',
  'email': 'communicate.email',
  'send messages': 'communicate.chat',
  'send message': 'communicate.chat',
  'slack': 'communicate.chat',
  'chat': 'communicate.chat',
  'make calls': 'communicate.phone',
  'make call': 'communicate.phone',
  'phone': 'communicate.phone',
  'schedule meetings': 'communicate.meeting',
  'schedule meeting': 'communicate.meeting',

  // Financial
  'send invoices': 'financial.invoice.send',
  'send invoice': 'financial.invoice.send',
  'create invoices': 'financial.invoice.create',
  'create invoice': 'financial.invoice.create',
  'read invoices': 'financial.invoice.read',
  'view invoices': 'financial.invoice.read',
  'make payments': 'financial.payment.initiate',
  'make payment': 'financial.payment.initiate',
  'process payments': 'financial.payment.initiate',
  'issue refunds': 'financial.refund',
  'issue refund': 'financial.refund',
  'refund': 'financial.refund',

  // Documents
  'read documents': 'document.read',
  'create documents': 'document.create',
  'sign documents': 'document.sign',
  'share documents': 'document.share',

  // Schedule
  'read calendar': 'schedule.read',
  'create events': 'schedule.create',
  'modify events': 'schedule.modify',
  'cancel events': 'schedule.cancel',
  'schedule': 'schedule.create',
  'reschedule': 'schedule.modify',

  // Tasks
  'create tasks': 'task.create',
  'create task': 'task.create',
  'assign tasks': 'task.assign',
  'assign task': 'task.assign',
  'complete tasks': 'task.complete',

  // Data
  'read data': 'data.read',
  'write data': 'data.write',
  'delete data': 'data.delete',
  'delete': 'data.delete',

  // Agent management
  'create workers': 'agent.create',
  'create worker': 'agent.create',
  'modify workers': 'agent.modify',
  'pause workers': 'agent.pause',
  'delegate': 'agent.delegate',
  'delegate tasks': 'agent.delegate',
};

/**
 * Map a charter rule string to an action class.
 * Falls back to 'legacy.<normalized_name>' for unknown rules.
 */
export function ruleToActionClass(rule: string): string {
  const normalized = rule.trim().toLowerCase();

  // Direct match
  if (RULE_TO_ACTION_CLASS[normalized]) {
    return RULE_TO_ACTION_CLASS[normalized]!;
  }

  // Try matching against known action classes directly
  if ((ACTION_CLASSES as readonly string[]).includes(normalized)) {
    return normalized;
  }

  // Try partial matching: "Send emails to customers" → check if it starts with a known pattern
  for (const [pattern, actionClass] of Object.entries(RULE_TO_ACTION_CLASS)) {
    if (normalized.startsWith(pattern) || normalized.includes(pattern)) {
      return actionClass;
    }
  }

  // Fallback: create a legacy action class from the tool/rule name
  const legacyName = normalized
    .replace(/[^a-z0-9_\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return `legacy.${legacyName}`;
}

// ---------------------------------------------------------------------------
// Charter → Grant conversion
// ---------------------------------------------------------------------------

export interface Charter {
  role?: string;
  goal?: string;
  canDo?: string[];
  askFirst?: string[];
  neverDo?: string[];
  maxDailyRuns?: number;
  [key: string]: unknown;
}

/**
 * Convert a charter to an AuthorityGrant input.
 * This produces a root grant (no parent) from a human grantor.
 */
export function charterToGrantInput(
  tenantId: string,
  grantorId: string,
  granteeId: string,
  charter: Charter,
): CreateGrantInput {
  const canDo = charter.canDo ?? [];
  const askFirst = charter.askFirst ?? [];
  const neverDo = charter.neverDo ?? [];

  // Map all rules to action classes
  const allowedActions = canDo.map(ruleToActionClass);
  const approvalActions = askFirst.map(ruleToActionClass);
  const forbiddenActions = neverDo.map(ruleToActionClass);

  // Scope: all allowed + approval-required action classes
  const allActionClasses = [...new Set([...allowedActions, ...approvalActions])];

  const scope: GrantScope = {
    actionClasses: allActionClasses,
    // No budget limit from charter (unlimited, matches current behavior)
    maxDelegationDepth: 1,
  };

  const constraints: GrantConstraints = {
    requireApproval: approvalActions,
    forbidden: forbiddenActions,
    disclosureRequired: false,
    auditLevel: 'full',
  };

  // Add rate limit from charter if specified
  if (charter.maxDailyRuns) {
    constraints.rateLimit = { maxPerDay: charter.maxDailyRuns };
  }

  return {
    tenantId,
    grantorType: 'human',
    grantorId,
    granteeId,
    scope,
    constraints,
  };
}

/**
 * Check if an existing charter authorization decision matches what the
 * authority graph would produce. Used for migration validation.
 */
export function charterDecisionMatches(
  charterVerdict: 'canDo' | 'askFirst' | 'neverDo' | 'unknown',
  authDecision: 'allow' | 'deny' | 'require_approval',
): boolean {
  switch (charterVerdict) {
    case 'canDo': return authDecision === 'allow';
    case 'askFirst': return authDecision === 'require_approval';
    case 'neverDo': return authDecision === 'deny';
    case 'unknown': return authDecision === 'require_approval' || authDecision === 'deny';
  }
}
