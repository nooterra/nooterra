/**
 * Deterministic world-model predicate evaluation for hosted workers.
 *
 * This upgrades charter enforcement from fuzzy string matching to typed,
 * argument-aware invariants without introducing any LLM dependency.
 */

export const PREDICATE_TYPES = Object.freeze({
  IN_SET: 'IN_SET',
  NOT_IN_SET: 'NOT_IN_SET',
  LESS_THAN: 'LESS_THAN',
  LESS_THAN_OR_EQUAL: 'LESS_THAN_OR_EQUAL',
  GREATER_THAN: 'GREATER_THAN',
  GREATER_THAN_OR_EQUAL: 'GREATER_THAN_OR_EQUAL',
  EQUALS: 'EQUALS',
  NOT_EQUALS: 'NOT_EQUALS',
  MATCHES_PATTERN: 'MATCHES_PATTERN',
  NOT_MATCHES_PATTERN: 'NOT_MATCHES_PATTERN',
  ARG_PATH_EXISTS: 'ARG_PATH_EXISTS',
  ARG_PATH_NOT_EXISTS: 'ARG_PATH_NOT_EXISTS',
  STRING_LENGTH_LESS_THAN: 'STRING_LENGTH_LESS_THAN',
  STRING_LENGTH_GREATER_THAN: 'STRING_LENGTH_GREATER_THAN',
  ARRAY_LENGTH_LESS_THAN: 'ARRAY_LENGTH_LESS_THAN',
  ARRAY_LENGTH_GREATER_THAN: 'ARRAY_LENGTH_GREATER_THAN',
  COMPOSITE_AND: 'COMPOSITE_AND',
  COMPOSITE_OR: 'COMPOSITE_OR',
});

const MAX_REGEX_LENGTH = 200;
const UNSAFE_REGEX_PATTERNS = [
  { pattern: /\\[1-9]/, reason: 'backreferences are not allowed' },
  { pattern: /\(\?(?:[=!]|<[=!])/, reason: 'lookaround assertions are not allowed' },
  { pattern: /(^|[^\\])\|/, reason: 'alternation is not allowed' },
  { pattern: /(^|[^\\])\((?!\?:)/, reason: 'capturing groups are not allowed' },
  { pattern: /(^|[^\\])(?:\.\*|\.\+)(?:[^?]|$)/, reason: 'greedy wildcard quantifiers are not allowed' },
  { pattern: /\{(?:\d+,|\d*,\d+)\}/, reason: 'range quantifiers are not allowed' },
];

function safeRegex(pattern) {
  const patternStr = String(pattern || '');
  if (patternStr.length > MAX_REGEX_LENGTH) {
    throw new Error(`regex pattern exceeds max length (${MAX_REGEX_LENGTH})`);
  }
  for (const rule of UNSAFE_REGEX_PATTERNS) {
    if (rule.pattern.test(patternStr)) {
      throw new Error(`regex pattern is not allowed: ${rule.reason}`);
    }
  }
  return new RegExp(patternStr, 'i');
}

export function getArgAtPath(obj, dotPath) {
  if (obj == null || typeof dotPath !== 'string' || dotPath === '') return undefined;
  const normalized = dotPath.replace(/\[(\d+)\]/g, '.$1');
  return normalized.split('.').reduce((current, segment) => {
    if (current == null || typeof current !== 'object') return undefined;
    return current[segment];
  }, obj);
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildExpectedDescription(type, predicate = {}) {
  if (predicate.set) return `${type} ${JSON.stringify(predicate.set)}`;
  if (predicate.pattern) return `${type} ${predicate.pattern}`;
  if (predicate.threshold != null) return `${type} ${predicate.threshold}`;
  if (predicate.value !== undefined) return `${type} ${JSON.stringify(predicate.value)}`;
  return type;
}

export function evaluatePredicate(predicate, toolArgs) {
  try {
    if (!predicate || typeof predicate !== 'object') {
      return { passed: false, reason: 'predicate must be an object' };
    }

    if (predicate.type === PREDICATE_TYPES.COMPOSITE_AND) {
      const parts = Array.isArray(predicate.predicates) ? predicate.predicates : [];
      if (parts.length === 0) return { passed: false, reason: 'COMPOSITE_AND requires predicates' };
      for (const part of parts) {
        const result = evaluatePredicate(part, toolArgs);
        if (!result.passed) return result;
      }
      return { passed: true, reason: 'all predicates passed' };
    }

    if (predicate.type === PREDICATE_TYPES.COMPOSITE_OR) {
      const parts = Array.isArray(predicate.predicates) ? predicate.predicates : [];
      if (parts.length === 0) return { passed: false, reason: 'COMPOSITE_OR requires predicates' };
      const failures = [];
      for (const part of parts) {
        const result = evaluatePredicate(part, toolArgs);
        if (result.passed) return { passed: true, reason: 'one predicate passed' };
        failures.push(result.reason);
      }
      return { passed: false, reason: failures.join('; ') || 'no predicate passed' };
    }

    const argPath = predicate.argPath;
    const value = getArgAtPath(toolArgs, argPath);
    const expected = buildExpectedDescription(predicate.type, predicate);

    switch (predicate.type) {
      case PREDICATE_TYPES.IN_SET: {
        const allowed = new Set(Array.isArray(predicate.set) ? predicate.set : []);
        return {
          passed: allowed.has(value),
          reason: `${argPath} expected IN_SET ${JSON.stringify([...allowed])}, got ${JSON.stringify(value)}`,
        };
      }
      case PREDICATE_TYPES.NOT_IN_SET: {
        const denied = new Set(Array.isArray(predicate.set) ? predicate.set : []);
        return {
          passed: !denied.has(value),
          reason: `${argPath} expected NOT_IN_SET ${JSON.stringify([...denied])}, got ${JSON.stringify(value)}`,
        };
      }
      case PREDICATE_TYPES.LESS_THAN:
      case PREDICATE_TYPES.LESS_THAN_OR_EQUAL:
      case PREDICATE_TYPES.GREATER_THAN:
      case PREDICATE_TYPES.GREATER_THAN_OR_EQUAL: {
        const actual = asNumber(value);
        const threshold = asNumber(predicate.threshold);
        if (actual == null || threshold == null) {
          return { passed: false, reason: `${argPath} expected ${expected}, got non-numeric value` };
        }
        const passed =
          predicate.type === PREDICATE_TYPES.LESS_THAN ? actual < threshold :
          predicate.type === PREDICATE_TYPES.LESS_THAN_OR_EQUAL ? actual <= threshold :
          predicate.type === PREDICATE_TYPES.GREATER_THAN ? actual > threshold :
          actual >= threshold;
        return { passed, reason: `${argPath} expected ${expected}, got ${actual}` };
      }
      case PREDICATE_TYPES.EQUALS:
        return { passed: value === predicate.value, reason: `${argPath} expected EQUALS ${JSON.stringify(predicate.value)}, got ${JSON.stringify(value)}` };
      case PREDICATE_TYPES.NOT_EQUALS:
        return { passed: value !== predicate.value, reason: `${argPath} expected NOT_EQUALS ${JSON.stringify(predicate.value)}, got ${JSON.stringify(value)}` };
      case PREDICATE_TYPES.MATCHES_PATTERN:
      case PREDICATE_TYPES.NOT_MATCHES_PATTERN: {
        const text = value == null ? '' : String(value);
        const regex = safeRegex(predicate.pattern);
        const matches = regex.test(text);
        return {
          passed: predicate.type === PREDICATE_TYPES.MATCHES_PATTERN ? matches : !matches,
          reason: `${argPath} expected ${expected}, got ${JSON.stringify(text)}`,
        };
      }
      case PREDICATE_TYPES.ARG_PATH_EXISTS:
        return { passed: value !== undefined, reason: `${argPath} expected ARG_PATH_EXISTS` };
      case PREDICATE_TYPES.ARG_PATH_NOT_EXISTS:
        return { passed: value === undefined, reason: `${argPath} expected ARG_PATH_NOT_EXISTS` };
      case PREDICATE_TYPES.STRING_LENGTH_LESS_THAN:
      case PREDICATE_TYPES.STRING_LENGTH_GREATER_THAN: {
        if (typeof value !== 'string') return { passed: false, reason: `${argPath} expected string length check` };
        const threshold = asNumber(predicate.threshold);
        if (threshold == null) return { passed: false, reason: `${argPath} length threshold missing` };
        return {
          passed: predicate.type === PREDICATE_TYPES.STRING_LENGTH_LESS_THAN ? value.length < threshold : value.length > threshold,
          reason: `${argPath} expected ${expected}, got length ${value.length}`,
        };
      }
      case PREDICATE_TYPES.ARRAY_LENGTH_LESS_THAN:
      case PREDICATE_TYPES.ARRAY_LENGTH_GREATER_THAN: {
        if (!Array.isArray(value)) return { passed: false, reason: `${argPath} expected array length check` };
        const threshold = asNumber(predicate.threshold);
        if (threshold == null) return { passed: false, reason: `${argPath} array threshold missing` };
        return {
          passed: predicate.type === PREDICATE_TYPES.ARRAY_LENGTH_LESS_THAN ? value.length < threshold : value.length > threshold,
          reason: `${argPath} expected ${expected}, got length ${value.length}`,
        };
      }
      default:
        return { passed: false, reason: `unknown predicate type: ${predicate.type}` };
    }
  } catch (err) {
    return { passed: false, reason: err.message || String(err) };
  }
}

export function evaluateInvariants(invariants, toolName, toolArgs) {
  const result = { applicableCount: 0, passed: [], violations: [] };
  if (!Array.isArray(invariants)) return result;

  for (const invariant of invariants) {
    if (!invariant || !Array.isArray(invariant.appliesTo) || !invariant.appliesTo.includes(toolName)) continue;
    result.applicableCount++;
    const evalResult = evaluatePredicate({
      type: invariant.predicate,
      argPath: invariant.argPath,
      ...(invariant.predicateArgs || {}),
    }, toolArgs);

    if (evalResult.passed) {
      result.passed.push({
        invariantId: invariant.id || null,
        statement: invariant.statement || null,
      });
      continue;
    }

    result.violations.push({
      invariantId: invariant.id || null,
      statement: invariant.statement || null,
      violationCategory: invariant.violationCategory || 'askFirst',
      reason: evalResult.reason,
      rationale: invariant.rationale || null,
    });
  }

  return result;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function classifyWithPredicates(toolName, toolArgs, worldModel) {
  if (!worldModel || typeof worldModel !== 'object') return null;

  const evalResult = evaluateInvariants(worldModel.invariants || [], toolName, toolArgs);
  if (evalResult.applicableCount === 0 && !Array.isArray(worldModel.domainKnowledge?.highRiskPatterns)) {
    return null;
  }

  const neverDoViolation = evalResult.violations.find(v => v.violationCategory === 'neverDo');
  if (neverDoViolation) {
    return {
      verdict: 'neverDo',
      rule: neverDoViolation.statement || neverDoViolation.reason,
      invariantViolations: evalResult.violations,
    };
  }

  const askFirstViolation = evalResult.violations.find(v => v.violationCategory === 'askFirst');
  if (askFirstViolation) {
    return {
      verdict: 'askFirst',
      rule: askFirstViolation.statement || askFirstViolation.reason,
      invariantViolations: evalResult.violations,
    };
  }

  const riskPatterns = Array.isArray(worldModel.domainKnowledge?.highRiskPatterns)
    ? worldModel.domainKnowledge.highRiskPatterns
    : [];
  if (riskPatterns.length > 0) {
    const argsText = safeStringify(toolArgs);
    for (const pattern of riskPatterns) {
      try {
        const regex = safeRegex(pattern);
        if (regex.test(argsText)) {
          return {
            verdict: 'askFirst',
            rule: `Tool args matched high-risk pattern: ${pattern}`,
            invariantViolations: evalResult.violations,
          };
        }
      } catch {
        // Ignore invalid regexes in user-authored world models.
      }
    }
  }

  return evalResult.applicableCount > 0
    ? { verdict: 'canDo', rule: 'world-model invariants passed', invariantViolations: [] }
    : null;
}
