/**
 * Capability constraint checking for the Nooterra agent runtime.
 *
 * Evaluates parameterized constraints attached to charter capabilities,
 * producing allow/block/askFirst verdicts with specific failure reasons.
 */

import type {
  Capability,
  CapabilityAllow,
  CapabilityConstraints,
} from './types.ts';

// ── Result types ───────────────────────────────────────

export interface ConstraintCheckResult {
  passed: boolean;
  reason?: string;
}

export interface CapabilityCheckResult {
  verdict: CapabilityAllow;
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  failedConstraints: string[];
}

// ── Constraint context ─────────────────────────────────

interface ConstraintContext {
  dailyCount?: number;
}

// ── Helpers ────────────────────────────────────────────

const EMAIL_REGEX = /[^@\s]+@([^@\s]+)/;

function extractEmailDomain(value: string): string | null {
  const match = value.match(EMAIL_REGEX);
  return match ? `@${match[1]}` : null;
}

function findEmails(toolArgs: Record<string, unknown>): string[] {
  const emails: string[] = [];
  for (const [key, val] of Object.entries(toolArgs)) {
    if (typeof val !== 'string') continue;
    if (['to', 'email', 'recipient'].includes(key) || val.includes('@')) {
      const domain = extractEmailDomain(val);
      if (domain) emails.push(val);
    }
  }
  return emails;
}

const AMOUNT_KEYS = ['amount', 'amount_usd', 'total', 'price'];

// ── Constraint handlers ────────────────────────────────

type ConstraintHandler = (
  value: unknown,
  toolArgs: Record<string, unknown>,
  context: ConstraintContext,
) => ConstraintCheckResult;

const handlers: Record<string, ConstraintHandler> = {
  to_domains(value, toolArgs) {
    const domains = value as string[];
    const emails = findEmails(toolArgs);
    if (emails.length === 0) return { passed: true };
    for (const email of emails) {
      const domain = extractEmailDomain(email);
      if (domain && !domains.includes(domain)) {
        return {
          passed: false,
          reason: `Email domain ${domain} not in allowed domains`,
        };
      }
    }
    return { passed: true };
  },

  max_amount_usd(value, toolArgs) {
    const limit = value as number;
    for (const key of AMOUNT_KEYS) {
      const v = toolArgs[key];
      if (typeof v === 'number' && v > limit) {
        return {
          passed: false,
          reason: `Amount $${v} exceeds limit of $${limit}`,
        };
      }
    }
    return { passed: true };
  },

  max_per_day(value, _toolArgs, context) {
    const limit = value as number;
    const count = context.dailyCount ?? 0;
    if (count > limit) {
      return {
        passed: false,
        reason: `Daily limit of ${limit} exceeded (${count} calls today)`,
      };
    }
    return { passed: true };
  },

  allowed_values(value, toolArgs) {
    const allowed = value as Record<string, string[]>;
    for (const [key, list] of Object.entries(allowed)) {
      const v = toolArgs[key];
      if (v !== undefined && !list.includes(String(v))) {
        return {
          passed: false,
          reason: `Argument '${key}' value '${v}' not in allowed values`,
        };
      }
    }
    return { passed: true };
  },

  blocked_values(value, toolArgs) {
    const blocked = value as Record<string, string[]>;
    for (const [key, list] of Object.entries(blocked)) {
      const v = toolArgs[key];
      if (v !== undefined && list.includes(String(v))) {
        return {
          passed: false,
          reason: `Argument '${key}' value '${v}' is blocked`,
        };
      }
    }
    return { passed: true };
  },

  max_length(value, toolArgs) {
    const limits = value as Record<string, number>;
    for (const [key, maxLen] of Object.entries(limits)) {
      const v = toolArgs[key];
      if (typeof v === 'string' && v.length > maxLen) {
        return {
          passed: false,
          reason: `Argument '${key}' length ${v.length} exceeds max ${maxLen}`,
        };
      }
    }
    return { passed: true };
  },

  pattern(value, toolArgs) {
    const patterns = value as Record<string, string>;
    for (const [key, pat] of Object.entries(patterns)) {
      const v = toolArgs[key];
      if (typeof v === 'string') {
        try {
          const re = new RegExp(pat);
          if (!re.test(v)) {
            return {
              passed: false,
              reason: `Argument '${key}' does not match pattern '${pat}'`,
            };
          }
        } catch {
          return {
            passed: false,
            reason: `Invalid regex pattern '${pat}' for argument '${key}'`,
          };
        }
      }
    }
    return { passed: true };
  },
};

// ── Public API ─────────────────────────────────────────

export function checkConstraint(
  name: string,
  value: unknown,
  toolArgs: Record<string, unknown>,
  context: ConstraintContext,
): ConstraintCheckResult {
  const handler = handlers[name];
  if (!handler) return { passed: true };
  return handler(value, toolArgs, context);
}

export function checkCapability(
  capability: Capability,
  toolName: string,
  toolArgs: Record<string, unknown>,
  dailyCounts: Record<string, number>,
): CapabilityCheckResult {
  if (capability.allow === 'neverDo') {
    return {
      verdict: 'neverDo',
      allowed: false,
      requiresApproval: false,
      reason: `Tool '${toolName}' is blocked by neverDo policy`,
      failedConstraints: [],
    };
  }

  const constraints = capability.constraints;
  if (!constraints || Object.keys(constraints).length === 0) {
    const allowed = capability.allow === 'canDo';
    return {
      verdict: capability.allow,
      allowed,
      requiresApproval: capability.allow === 'askFirst',
      reason: allowed
        ? `Tool '${toolName}' allowed by ${capability.allow} policy`
        : `Tool '${toolName}' requires approval`,
      failedConstraints: [],
    };
  }

  const context: ConstraintContext = {
    dailyCount: dailyCounts[toolName] ?? 0,
  };
  const failedConstraints: string[] = [];
  const reasons: string[] = [];

  for (const [name, value] of Object.entries(constraints)) {
    const result = checkConstraint(name, value, toolArgs, context);
    if (!result.passed) {
      failedConstraints.push(name);
      if (result.reason) reasons.push(result.reason);
    }
  }

  if (failedConstraints.length > 0) {
    return {
      verdict: capability.allow,
      allowed: false,
      requiresApproval: false,
      reason: reasons.join('; '),
      failedConstraints,
    };
  }

  const allowed = capability.allow === 'canDo';
  return {
    verdict: capability.allow,
    allowed,
    requiresApproval: capability.allow === 'askFirst',
    reason: allowed
      ? `Tool '${toolName}' allowed — all constraints passed`
      : `Tool '${toolName}' requires approval — all constraints passed`,
    failedConstraints: [],
  };
}

export function getCapabilityVerdict(
  charter: { capabilities?: Record<string, Capability> },
  toolName: string,
  toolArgs: Record<string, unknown>,
  dailyCounts?: Record<string, number>,
): CapabilityCheckResult | null {
  const cap = charter.capabilities?.[toolName];
  if (!cap) return null;
  return checkCapability(cap, toolName, toolArgs, dailyCounts ?? {});
}
