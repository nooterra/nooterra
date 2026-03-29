/**
 * Charter Enforcement Layer
 *
 * Enforces canDo/askFirst/neverDo rules BEFORE actions are taken.
 * Detects prompt injection attempts and anomalous execution patterns.
 */

// ---------------------------------------------------------------------------
// Prompt Injection Detection
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS = [
  // Direct instruction override attempts
  { pattern: /ignore\s+(all\s+)?previous\s+(instructions|prompts|rules)/i, reason: 'Attempted instruction override', severity: 'high' },
  { pattern: /disregard\s+(all\s+)?previous/i, reason: 'Attempted instruction override', severity: 'high' },
  { pattern: /forget\s+(all\s+)?(your\s+)?(previous|prior|above)/i, reason: 'Attempted instruction override', severity: 'high' },
  { pattern: /override\s+(your\s+)?(instructions|charter|rules|constraints)/i, reason: 'Attempted charter override', severity: 'high' },

  // Role reassignment
  { pattern: /you\s+are\s+now\s+(a|an|the)\s/i, reason: 'Role reassignment attempt', severity: 'high' },
  { pattern: /act\s+as\s+if\s+you\s+(are|were)\s/i, reason: 'Role reassignment attempt', severity: 'medium' },
  { pattern: /pretend\s+(you\s+are|to\s+be)\s/i, reason: 'Role reassignment attempt', severity: 'medium' },

  // Fake system messages
  { pattern: /^system\s*:/im, reason: 'Fake system message injection', severity: 'high' },
  { pattern: /\[system\]/i, reason: 'Fake system message injection', severity: 'high' },
  { pattern: /<\s*system\s*>/i, reason: 'Fake system tag injection', severity: 'high' },

  // Charter redefinition
  { pattern: /new\s+charter\s*[:=]/i, reason: 'Charter redefinition attempt', severity: 'high' },
  { pattern: /update(d)?\s+charter\s*[:=]/i, reason: 'Charter redefinition attempt', severity: 'high' },
  { pattern: /(canDo|askFirst|neverDo)\s*[:=]\s*\[/i, reason: 'Direct charter field manipulation', severity: 'high' },

  // Delimiter injection
  { pattern: /---+\s*(system|assistant|instructions)\s*---+/i, reason: 'Delimiter injection attempt', severity: 'medium' },
  { pattern: /#{3,}\s*(system|new\s+instructions)/i, reason: 'Delimiter injection attempt', severity: 'medium' },
];

// Unicode homoglyph ranges that could be used to bypass keyword filters
const HOMOGLYPH_RANGES = [
  [0x0400, 0x04FF],  // Cyrillic (a looks like a, e like e, etc.)
  [0xFF00, 0xFFEF],  // Fullwidth forms
  [0x2000, 0x206F],  // General punctuation (zero-width chars, etc.)
];

/**
 * Detect prompt injection attempts in input text.
 * @param {string} input - Text to analyze
 * @returns {{ safe: boolean, reason?: string, severity?: string, matches?: string[] }}
 */
export function detectPromptInjection(input) {
  if (!input || typeof input !== 'string') {
    return { safe: true };
  }

  const matches = [];
  let highestSeverity = null;
  const severityOrder = { high: 3, medium: 2, low: 1 };

  // Check against known patterns
  for (const { pattern, reason, severity } of INJECTION_PATTERNS) {
    // Clone regex to avoid lastIndex issues
    const re = new RegExp(pattern.source, pattern.flags);
    if (re.test(input)) {
      matches.push({ reason, severity });
      if (!highestSeverity || severityOrder[severity] > severityOrder[highestSeverity]) {
        highestSeverity = severity;
      }
    }
  }

  // Check for suspicious Unicode homoglyphs
  if (containsHomoglyphs(input)) {
    matches.push({ reason: 'Contains Unicode homoglyphs that may bypass filters', severity: 'medium' });
    if (!highestSeverity || severityOrder.medium > severityOrder[highestSeverity]) {
      highestSeverity = 'medium';
    }
  }

  // Check for base64 that decodes to instruction-like content
  const base64Injection = checkBase64Injection(input);
  if (base64Injection) {
    matches.push({ reason: base64Injection, severity: 'high' });
    highestSeverity = 'high';
  }

  if (matches.length > 0) {
    return {
      safe: false,
      reason: matches[0].reason,
      severity: highestSeverity,
      matches: matches.map(m => m.reason),
    };
  }

  return { safe: true };
}

/**
 * Validate user-submitted charter rules for injection attempts.
 * Called when users create/update workers to prevent malicious rules.
 * @param {{ canDo?: string[], askFirst?: string[], neverDo?: string[] }} charter
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCharterRules(charter) {
  const errors = [];

  for (const [section, rules] of Object.entries(charter)) {
    if (!['canDo', 'askFirst', 'neverDo'].includes(section)) continue;
    if (!Array.isArray(rules)) continue;

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (typeof rule !== 'string') {
        errors.push(`${section}[${i}]: rule must be a string`);
        continue;
      }
      if (rule.length > 200) {
        errors.push(`${section}[${i}]: rule exceeds 200 character limit`);
        continue;
      }
      if (rule.trim().length === 0) {
        errors.push(`${section}[${i}]: rule cannot be empty`);
        continue;
      }
      // Check for prompt injection in the rule text itself
      const injection = detectPromptInjection(rule);
      if (!injection.safe && injection.severity === 'high') {
        errors.push(`${section}[${i}]: rejected — ${injection.reason}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function containsHomoglyphs(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    for (const [start, end] of HOMOGLYPH_RANGES) {
      if (code >= start && code <= end) return true;
    }
  }
  return false;
}

function checkBase64Injection(text) {
  const base64Regex = /[A-Za-z0-9+/]{40,}={0,2}/g;
  let match;
  while ((match = base64Regex.exec(text)) !== null) {
    try {
      const decoded = Buffer.from(match[0], 'base64').toString('utf-8');
      // Check if decoded content looks like instructions
      if (/ignore|system|instruction|override|charter/i.test(decoded)) {
        return 'Base64 encoded instruction injection detected';
      }
    } catch {
      // Not valid base64, skip
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Charter Rule Matching
// ---------------------------------------------------------------------------

/**
 * Normalize a string for fuzzy matching: lowercase, strip punctuation, collapse whitespace.
 */
function normalize(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Check if an action string matches a charter rule using fuzzy matching.
 * Supports exact match, substring match, and keyword overlap.
 * @param {string} action - The action being attempted
 * @param {string} rule - The charter rule to match against
 * @returns {boolean}
 */
function matchesRule(action, rule) {
  const normAction = normalize(action);
  const normRule = normalize(rule);

  if (!normAction || !normRule) return false;

  // Exact match
  if (normAction === normRule) return true;

  // Substring: rule contained in action or action contained in rule
  if (normAction.includes(normRule) || normRule.includes(normAction)) return true;

  // Keyword overlap: if >60% of rule keywords appear in action
  const ruleWords = normRule.split(' ').filter(w => w.length > 2);
  const actionWords = normAction.split(' ').filter(w => w.length > 2);
  if (ruleWords.length > 0) {
    const overlap = ruleWords.filter(w => actionWords.includes(w)).length;
    if (overlap / ruleWords.length >= 0.6) return true;
  }

  return false;
}

/**
 * Find the best matching rule from a list for a given action.
 * @param {string} action - The action to match
 * @param {string[]} rules - Array of rule strings
 * @returns {{ matched: boolean, rule?: string, index?: number }}
 */
function findMatchingRule(action, rules) {
  if (!rules || !Array.isArray(rules)) return { matched: false };
  for (let i = 0; i < rules.length; i++) {
    if (matchesRule(action, rules[i])) {
      return { matched: true, rule: rules[i], index: i };
    }
  }
  return { matched: false };
}

// ---------------------------------------------------------------------------
// Charter Enforcement
// ---------------------------------------------------------------------------

/**
 * Validate an action against the charter's canDo/askFirst/neverDo rules.
 * Evaluation order: neverDo (block) -> askFirst (pause) -> canDo (allow) -> default deny.
 *
 * @param {object} charter - The worker charter with canDo, askFirst, neverDo arrays
 * @param {string} action - Description of the action being attempted
 * @returns {{ allowed: boolean, reason?: string, rule?: string, ruleType?: string }}
 */
export function enforceCharter(charter, action) {
  if (!charter || !action) {
    return { allowed: false, reason: 'Missing charter or action', rule: null, ruleType: 'missing' };
  }

  const { canDo, askFirst, neverDo } = charter;

  // 1. Check neverDo first - hard block
  const neverMatch = findMatchingRule(action, neverDo);
  if (neverMatch.matched) {
    return {
      allowed: false,
      reason: `Action blocked by neverDo rule: "${neverMatch.rule}"`,
      rule: neverMatch.rule,
      ruleType: 'neverDo',
    };
  }

  // 2. Check askFirst - requires approval
  const askMatch = findMatchingRule(action, askFirst);
  if (askMatch.matched) {
    return {
      allowed: false,
      reason: `Action requires approval per askFirst rule: "${askMatch.rule}"`,
      rule: askMatch.rule,
      ruleType: 'askFirst',
    };
  }

  // 3. Check canDo - explicitly allowed
  const canMatch = findMatchingRule(action, canDo);
  if (canMatch.matched) {
    return { allowed: true };
  }

  // 4. If charter has canDo rules defined, default deny anything not listed
  if (canDo && Array.isArray(canDo) && canDo.length > 0) {
    return {
      allowed: false,
      reason: `Action not in canDo list. Allowed actions: ${canDo.join(', ')}`,
      rule: null,
      ruleType: 'default_deny',
    };
  }

  // 5. If no canDo rules defined, allow by default (charter is permissive)
  return { allowed: true };
}

/**
 * Check if an action requires human approval.
 *
 * @param {object} charter - The worker charter
 * @param {string} action - Description of the action
 * @returns {{ required: boolean, matchedRule?: string }}
 */
export function requiresApproval(charter, action) {
  if (!charter || !action) return { required: false };

  const { askFirst } = charter;
  const match = findMatchingRule(action, askFirst);

  if (match.matched) {
    return { required: true, matchedRule: match.rule };
  }

  return { required: false };
}

/**
 * Validate a tool call against the charter before execution.
 * Maps tool names and arguments to charter rules using fuzzy matching.
 *
 * @param {object} charter - The worker charter
 * @param {string} toolName - Name of the tool being called
 * @param {object} toolArgs - Arguments passed to the tool
 * @returns {{ allowed: boolean, reason?: string, rule?: string, ruleType?: string, requiresApproval?: boolean, matchedRule?: string }}
 */
export function validateToolCall(charter, toolName, toolArgs) {
  if (!charter) {
    return { allowed: false, reason: 'No charter provided' };
  }

  // Build a description of the action from tool name + args
  const argSummary = toolArgs
    ? Object.entries(toolArgs).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ')
    : '';
  const actionDescription = `${toolName} ${argSummary}`.trim();

  // Check neverDo against both tool name alone and full description
  const neverMatchName = findMatchingRule(toolName, charter.neverDo);
  if (neverMatchName.matched) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" blocked by neverDo rule: "${neverMatchName.rule}"`,
      rule: neverMatchName.rule,
      ruleType: 'neverDo',
    };
  }
  const neverMatchFull = findMatchingRule(actionDescription, charter.neverDo);
  if (neverMatchFull.matched) {
    return {
      allowed: false,
      reason: `Tool call blocked by neverDo rule: "${neverMatchFull.rule}"`,
      rule: neverMatchFull.rule,
      ruleType: 'neverDo',
    };
  }

  // Check askFirst
  const askMatchName = findMatchingRule(toolName, charter.askFirst);
  if (askMatchName.matched) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: `Tool "${toolName}" requires approval per askFirst rule: "${askMatchName.rule}"`,
      rule: askMatchName.rule,
      ruleType: 'askFirst',
      matchedRule: askMatchName.rule,
    };
  }
  const askMatchFull = findMatchingRule(actionDescription, charter.askFirst);
  if (askMatchFull.matched) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: `Tool call requires approval per askFirst rule: "${askMatchFull.rule}"`,
      rule: askMatchFull.rule,
      ruleType: 'askFirst',
      matchedRule: askMatchFull.rule,
    };
  }

  // Check canDo
  const canMatchName = findMatchingRule(toolName, charter.canDo);
  if (canMatchName.matched) {
    return { allowed: true };
  }
  const canMatchFull = findMatchingRule(actionDescription, charter.canDo);
  if (canMatchFull.matched) {
    return { allowed: true };
  }

  // Default: if canDo is defined and non-empty, deny unlisted tools
  if (charter.canDo && Array.isArray(charter.canDo) && charter.canDo.length > 0) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" not in canDo list`,
      rule: null,
      ruleType: 'default_deny',
    };
  }

  // Permissive charter (no canDo defined)
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Anomaly Detection
// ---------------------------------------------------------------------------

/**
 * Configuration for anomaly thresholds.
 */
const ANOMALY_THRESHOLDS = {
  costMultiplier: 10,       // Cost > 10x average triggers anomaly
  maxToolCalls: 50,         // More than 50 tool calls per execution
  maxExecutionMs: 300000,   // 5 minutes max execution time
};

/**
 * Check execution metrics for anomalies that should trigger an auto-pause.
 *
 * @param {object} params
 * @param {number} params.costUsd - Cost of this execution
 * @param {number} params.avgCostUsd - Average cost of recent executions
 * @param {number} params.toolCallCount - Number of tool calls in this execution
 * @param {number} params.executionMs - Elapsed time in milliseconds
 * @param {string[]} params.toolNames - Names of tools called
 * @param {object} params.charter - The worker charter
 * @returns {{ anomaly: boolean, reasons: string[] }}
 */
export function detectAnomalies({
  costUsd = 0,
  avgCostUsd = 0,
  toolCallCount = 0,
  executionMs = 0,
  toolNames = [],
  charter = {},
} = {}) {
  const reasons = [];

  // 1. Cost spike
  if (avgCostUsd > 0 && costUsd > avgCostUsd * ANOMALY_THRESHOLDS.costMultiplier) {
    reasons.push(
      `Cost $${costUsd.toFixed(6)} exceeds ${ANOMALY_THRESHOLDS.costMultiplier}x average ($${avgCostUsd.toFixed(6)})`
    );
  }

  // 2. Excessive tool calls
  if (toolCallCount > ANOMALY_THRESHOLDS.maxToolCalls) {
    reasons.push(
      `${toolCallCount} tool calls exceeds maximum of ${ANOMALY_THRESHOLDS.maxToolCalls}`
    );
  }

  // 3. Execution timeout
  if (executionMs > ANOMALY_THRESHOLDS.maxExecutionMs) {
    reasons.push(
      `Execution time ${Math.round(executionMs / 1000)}s exceeds ${ANOMALY_THRESHOLDS.maxExecutionMs / 1000}s limit`
    );
  }

  // 4. Tool not in canDo list
  if (charter.canDo && Array.isArray(charter.canDo) && charter.canDo.length > 0) {
    for (const toolName of toolNames) {
      const match = findMatchingRule(toolName, charter.canDo);
      if (!match.matched) {
        reasons.push(`Tool "${toolName}" not in charter canDo list`);
      }
    }
  }

  return {
    anomaly: reasons.length > 0,
    reasons,
  };
}

/**
 * Get the average cost of recent executions for a worker.
 *
 * @param {object} pool - Postgres pool
 * @param {string} workerId - Worker ID
 * @param {number} lookback - Number of recent executions to average (default 20)
 * @returns {Promise<number>} Average cost in USD
 */
export async function getAvgExecutionCost(pool, workerId, lookback = 20) {
  const result = await pool.query(`
    SELECT AVG(cost_usd) AS avg_cost
    FROM (
      SELECT cost_usd FROM worker_executions
      WHERE worker_id = $1 AND status = 'completed' AND cost_usd > 0
      ORDER BY completed_at DESC
      LIMIT $2
    ) recent
  `, [workerId, lookback]);

  return parseFloat(result.rows[0]?.avg_cost ?? 0);
}

/**
 * Pause a worker due to anomaly detection and record the reason.
 *
 * @param {object} pool - Postgres pool
 * @param {string} workerId - Worker ID
 * @param {string} executionId - Execution that triggered the pause
 * @param {string[]} reasons - Anomaly reasons
 */
export async function autoPauseWorker(pool, workerId, executionId, reasons) {
  await pool.query(`
    UPDATE workers SET
      status = 'paused',
      stats = jsonb_set(
        COALESCE(stats, '{}'::jsonb),
        '{autoPausedAt}',
        to_jsonb($2::text)
      ),
      updated_at = now()
    WHERE id = $1
  `, [workerId, new Date().toISOString()]);

  // Store pause reason in execution activity
  await pool.query(`
    UPDATE worker_executions SET
      status = 'auto_paused',
      error = $2
    WHERE id = $1
  `, [executionId, `Auto-paused: ${reasons.join('; ')}`]);
}

/**
 * Create an approval record for askFirst actions.
 *
 * @param {object} pool - Postgres pool
 * @param {object} params
 * @param {string} params.workerId - Worker ID
 * @param {string} params.tenantId - Tenant ID
 * @param {string} params.executionId - Execution ID
 * @param {string} params.action - The action requiring approval
 * @param {string} params.matchedRule - The askFirst rule that matched
 * @returns {Promise<string>} Approval record ID
 */
export async function createApprovalRecord(pool, { workerId, tenantId, executionId, action, matchedRule }) {
  const id = `apr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  await pool.query(`
    INSERT INTO worker_approvals (id, tenant_id, worker_id, execution_id, tool_name, tool_args, rule, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
    ON CONFLICT DO NOTHING
  `, [id, tenantId, workerId, executionId, action || 'unknown', JSON.stringify({ matchedRule }), matchedRule || null]);

  return id;
}
