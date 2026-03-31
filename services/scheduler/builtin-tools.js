/**
 * Built-in Tools — zero-dependency tools that work without Composio.
 *
 * Public API is intentionally stable; implementation is split by domain:
 * content/document tools, communication tools, and sandbox/runtime tools.
 */

import { WORKER_EXECUTION_TERMINAL_STATUSES, isTerminalExecutionStatus } from './state-machine.js';
import { getBuiltinToolPolicy, getBuiltinTools, isBuiltinTool, BUILTIN_TOOL_POLICIES } from './builtin-tools/catalog.js';
import { browseWebpage, readDocument, webSearch } from './builtin-tools/content.js';
import { makePhoneCall, sendEmail, sendSms } from './builtin-tools/communications.js';
import { generateImage, runCode, waitForEvent } from './builtin-tools/runtime.js';
import {
  isValidE164PhoneNumber,
  isValidEmailAddress,
  isValidIsoDate,
  log,
  normalizeString,
  normalizedPositiveNumber,
  randomId,
  sha256Hex,
  stableJsonStringify,
} from './builtin-tools/shared.js';

function resolveBuiltinToolPolicy(toolName, meta = {}) {
  const base = getBuiltinToolPolicy(toolName);
  if (!base) return null;

  const resolved = { ...base };
  const overrides = meta?.charter?.toolLimits?.[toolName];
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    for (const [key, value] of Object.entries(base)) {
      if (typeof value !== 'number') continue;
      const overrideValue = normalizedPositiveNumber(overrides[key]);
      if (overrideValue !== null) {
        resolved[key] = overrideValue;
      }
    }
  }

  if (toolName === 'make_payment') {
    const topLevelSpendOverride = normalizedPositiveNumber(meta?.charter?.maxDailySpendUsd);
    if (topLevelSpendOverride !== null) {
      resolved.maxDailySpendUsd = topLevelSpendOverride;
    }
  }

  return resolved;
}

function buildSideEffectRequestHash(toolName, args = {}) {
  return sha256Hex(`${toolName}\n${stableJsonStringify(args)}`);
}

function buildSideEffectIdempotencyKey(toolName, args = {}, meta = {}) {
  const explicit = normalizeString(meta?.side_effect_idempotency_key);
  if (explicit) return explicit;

  const executionId = normalizeString(meta?.execution_id);
  const toolCallId = normalizeString(meta?.tool_call_id);
  if (executionId && toolCallId) {
    return `exec:${executionId}:tool:${toolCallId}`;
  }
  if (executionId) {
    return `exec:${executionId}:tool:${toolName}:hash:${buildSideEffectRequestHash(toolName, args)}`;
  }
  return '';
}

function buildSideEffectTarget(toolName, args = {}) {
  switch (toolName) {
    case 'send_sms':
    case 'make_phone_call':
      return normalizeString(args.to);
    case 'send_email':
      return normalizeString(args.to);
    case 'make_payment':
      return normalizeString(args.recipient);
    case 'request_payment':
      return normalizeString(args.from);
    default:
      return '';
  }
}

function buildSideEffectAmount(toolName, args = {}) {
  if (toolName !== 'make_payment' && toolName !== 'request_payment') return null;
  const amount = Number(args.amount_usd);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function buildSideEffectProviderRef(toolName, result) {
  if (!result || typeof result !== 'object') return null;
  switch (toolName) {
    case 'send_sms':
    case 'make_phone_call':
      return normalizeString(result.sid);
    case 'send_email':
      return normalizeString(result.id);
    case 'make_payment':
      return normalizeString(result.transaction_id);
    case 'request_payment':
      return normalizeString(result.request_id);
    default:
      return null;
  }
}

let _pool = null;

export function setPool(pool) {
  _pool = pool;
}

async function readSideEffectUsage({ tenantId, workerId, toolName }) {
  if (!_pool || !tenantId || !toolName) {
    return { callCount: 0, totalAmount: 0 };
  }

  const params = [tenantId, toolName];
  let workerFilterSql = '';
  if (workerId) {
    params.push(workerId);
    workerFilterSql = ` AND worker_id = $${params.length}`;
  }

  const usageResult = await _pool.query(
    `SELECT COUNT(*)::int AS call_count,
            COALESCE(SUM(COALESCE(amount_usd, 0)), 0) AS total_amount
       FROM worker_tool_side_effects
      WHERE tenant_id = $1
        AND tool_name = $2
        AND status = 'succeeded'
        AND created_at > now() - interval '24 hours'${workerFilterSql}`,
    params
  );

  return {
    callCount: Number(usageResult.rows[0]?.call_count || 0),
    totalAmount: parseFloat(usageResult.rows[0]?.total_amount || 0),
  };
}

async function readSideEffectTargetUsage({ tenantId, toolName, target }) {
  if (!_pool || !tenantId || !toolName || !target) {
    return { callCount: 0, totalAmount: 0 };
  }

  const usageResult = await _pool.query(
    `SELECT COUNT(*)::int AS call_count,
            COALESCE(SUM(COALESCE(amount_usd, 0)), 0) AS total_amount
       FROM worker_tool_side_effects
      WHERE tenant_id = $1
        AND tool_name = $2
        AND target = $3
        AND status = 'succeeded'
        AND created_at > now() - interval '24 hours'`,
    [tenantId, toolName, target]
  );

  return {
    callCount: Number(usageResult.rows[0]?.call_count || 0),
    totalAmount: parseFloat(usageResult.rows[0]?.total_amount || 0),
  };
}

async function hasRecentDuplicateSideEffect({ tenantId, toolName, target, requestHash, windowMinutes, excludeIdempotencyKey = null }) {
  if (!_pool || !tenantId || !toolName || !target || !requestHash || !Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    return false;
  }

  const params = [tenantId, toolName, target, requestHash, windowMinutes];
  let excludeSql = '';
  if (excludeIdempotencyKey) {
    params.push(excludeIdempotencyKey);
    excludeSql = ` AND idempotency_key <> $${params.length}`;
  }

  const duplicateResult = await _pool.query(
    `SELECT COUNT(*)::int AS duplicate_count
       FROM worker_tool_side_effects
      WHERE tenant_id = $1
        AND tool_name = $2
        AND target = $3
        AND request_hash = $4
        AND status = 'succeeded'
        AND created_at > now() - ($5 * interval '1 minute')${excludeSql}`,
    params
  );

  return Number(duplicateResult.rows[0]?.duplicate_count || 0) > 0;
}

async function checkDailySideEffectPolicy(toolName, args = {}, meta = {}) {
  const tenantId = normalizeString(meta?.tenant_id);
  const workerId = normalizeString(meta?.worker_id);
  const policy = resolveBuiltinToolPolicy(toolName, meta);
  if (!_pool || !tenantId || !policy) {
    return { ok: true };
  }

  const usage = await readSideEffectUsage({ tenantId, workerId, toolName });
  if (Number.isFinite(policy.maxDailyCalls) && usage.callCount >= policy.maxDailyCalls) {
    return {
      ok: false,
      error: `${toolName} daily limit reached: ${usage.callCount}/${policy.maxDailyCalls} successful calls in the last 24 hours`,
    };
  }

  const amount = buildSideEffectAmount(toolName, args);
  const dailyAmountLimit = normalizedPositiveNumber(policy.maxDailyAmountUsd ?? policy.maxDailySpendUsd);
  if (dailyAmountLimit !== null && amount !== null && usage.totalAmount + amount > dailyAmountLimit) {
    return {
      ok: false,
      error: `${toolName} daily amount limit exceeded: $${usage.totalAmount.toFixed(2)} already used in the last 24 hours, limit is $${dailyAmountLimit.toFixed(2)}`,
    };
  }

  const target = buildSideEffectTarget(toolName, args);
  const targetDailyLimit = normalizedPositiveNumber(policy.maxTargetDailyAmountUsd ?? policy.maxTargetDailySpendUsd);
  if (targetDailyLimit !== null && amount !== null && target) {
    const targetUsage = await readSideEffectTargetUsage({ tenantId, toolName, target });
    if (targetUsage.totalAmount + amount > targetDailyLimit) {
      return {
        ok: false,
        error: `${toolName} target daily amount limit exceeded for ${target}: $${targetUsage.totalAmount.toFixed(2)} already used in the last 24 hours, limit is $${targetDailyLimit.toFixed(2)}`,
      };
    }
  }

  if ((toolName === 'make_payment' || toolName === 'request_payment') && target) {
    const duplicateWindowMinutes = normalizedPositiveNumber(policy.duplicateWindowMinutes);
    const requestHash = buildSideEffectRequestHash(toolName, args);
    const idempotencyKey = buildSideEffectIdempotencyKey(toolName, args, meta);
    if (duplicateWindowMinutes !== null) {
      const duplicateExists = await hasRecentDuplicateSideEffect({
        tenantId,
        toolName,
        target,
        requestHash,
        windowMinutes: duplicateWindowMinutes,
        excludeIdempotencyKey: idempotencyKey || null,
      });
      if (duplicateExists) {
        return {
          ok: false,
          error: `${toolName} duplicate safety envelope triggered for ${target}: an identical successful request already ran in the last ${duplicateWindowMinutes} minutes`,
        };
      }
    }
  }

  return { ok: true };
}

async function checkDailyPaymentBudget(tenantId, amountUsd, maxDailySpendUsd) {
  if (!_pool || !tenantId || !Number.isFinite(amountUsd) || !Number.isFinite(maxDailySpendUsd)) {
    return { ok: true };
  }

  const recentSpendResult = await _pool.query(
    `SELECT COALESCE(SUM(ABS(amount_usd)), 0) AS recent_spend
     FROM credit_transactions
     WHERE tenant_id = $1
       AND type = 'worker_payment'
       AND created_at > now() - interval '24 hours'`,
    [tenantId]
  );
  const recentSpend = parseFloat(recentSpendResult.rows[0]?.recent_spend || 0);
  if (recentSpend + amountUsd > maxDailySpendUsd) {
    return {
      ok: false,
      error: `Daily payment limit exceeded: $${recentSpend.toFixed(2)} spent in last 24h, limit is $${maxDailySpendUsd.toFixed(2)}`,
    };
  }

  return { ok: true };
}

export async function preflightBuiltinTool(toolName, args = {}, meta = {}) {
  const policy = resolveBuiltinToolPolicy(toolName, meta);

  switch (toolName) {
    case 'send_sms': {
      const to = normalizeString(args.to);
      const body = typeof args.body === 'string' ? args.body : '';
      if (!isValidE164PhoneNumber(to)) return { ok: false, error: 'send_sms requires a valid E.164 phone number' };
      if (!body.trim()) return { ok: false, error: 'send_sms requires a non-empty message body' };
      if (body.length > policy.maxBodyChars) {
        return { ok: false, error: `send_sms body exceeds ${policy.maxBodyChars} characters` };
      }
      const capCheck = await checkDailySideEffectPolicy(toolName, { ...args, to, body }, meta);
      if (!capCheck.ok) return capCheck;
      return { ok: true, normalizedArgs: { ...args, to, body } };
    }
    case 'make_phone_call': {
      const to = normalizeString(args.to);
      const message = typeof args.message === 'string' ? args.message : '';
      const voice = normalizeString(args.voice || 'alice') || 'alice';
      if (!isValidE164PhoneNumber(to)) return { ok: false, error: 'make_phone_call requires a valid E.164 phone number' };
      if (!message.trim()) return { ok: false, error: 'make_phone_call requires a non-empty message' };
      if (message.length > policy.maxMessageChars) {
        return { ok: false, error: `make_phone_call message exceeds ${policy.maxMessageChars} characters` };
      }
      if (!['alice', 'man', 'woman'].includes(voice)) return { ok: false, error: 'make_phone_call voice must be alice, man, or woman' };
      const capCheck = await checkDailySideEffectPolicy(toolName, { ...args, to, message, voice }, meta);
      if (!capCheck.ok) return capCheck;
      return { ok: true, normalizedArgs: { ...args, to, message, voice } };
    }
    case 'send_email': {
      const to = normalizeString(args.to);
      const subject = typeof args.subject === 'string' ? args.subject : '';
      const body = typeof args.body === 'string' ? args.body : '';
      if (!isValidEmailAddress(to)) return { ok: false, error: 'send_email requires a single valid email address' };
      if (!subject.trim()) return { ok: false, error: 'send_email requires a non-empty subject' };
      if (/[\r\n]/.test(subject)) return { ok: false, error: 'send_email subject must not contain CR/LF characters' };
      if (subject.length > policy.maxSubjectChars) {
        return { ok: false, error: `send_email subject exceeds ${policy.maxSubjectChars} characters` };
      }
      if (!body.trim()) return { ok: false, error: 'send_email requires a non-empty body' };
      if (body.length > policy.maxBodyChars) {
        return { ok: false, error: `send_email body exceeds ${policy.maxBodyChars} characters` };
      }
      const capCheck = await checkDailySideEffectPolicy(toolName, { ...args, to, subject, body }, meta);
      if (!capCheck.ok) return capCheck;
      return { ok: true, normalizedArgs: { ...args, to, subject, body } };
    }
    case 'make_payment': {
      const amountUsd = Number(args.amount_usd);
      const recipient = normalizeString(args.recipient);
      const description = normalizeString(args.description);
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) return { ok: false, error: 'make_payment requires a positive amount_usd' };
      if (amountUsd > policy.maxAmountUsd) {
        return { ok: false, error: `make_payment exceeds single-payment limit of $${policy.maxAmountUsd}` };
      }
      if (!recipient) return { ok: false, error: 'make_payment requires a non-empty recipient' };
      if (!description) return { ok: false, error: 'make_payment requires a non-empty description' };
      const budgetCheck = await checkDailyPaymentBudget(meta?.tenant_id, amountUsd, policy.maxTenantDailySpendUsd ?? policy.maxDailySpendUsd);
      if (!budgetCheck.ok) return budgetCheck;
      const capCheck = await checkDailySideEffectPolicy(toolName, { ...args, amount_usd: amountUsd, recipient, description }, meta);
      if (!capCheck.ok) return capCheck;
      return { ok: true, normalizedArgs: { ...args, amount_usd: amountUsd, recipient, description } };
    }
    case 'request_payment': {
      const amountUsd = Number(args.amount_usd);
      const from = normalizeString(args.from);
      const description = normalizeString(args.description);
      const dueDate = args.due_date == null ? null : normalizeString(args.due_date);
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) return { ok: false, error: 'request_payment requires a positive amount_usd' };
      if (amountUsd > policy.maxAmountUsd) {
        return { ok: false, error: `request_payment exceeds maximum amount of $${policy.maxAmountUsd}` };
      }
      if (!from) return { ok: false, error: 'request_payment requires a non-empty payer' };
      if (!description) return { ok: false, error: 'request_payment requires a non-empty description' };
      if (dueDate && !isValidIsoDate(dueDate)) return { ok: false, error: 'request_payment due_date must be YYYY-MM-DD when provided' };
      const capCheck = await checkDailySideEffectPolicy(toolName, { ...args, amount_usd: amountUsd, from, description, due_date: dueDate }, meta);
      if (!capCheck.ok) return capCheck;
      return { ok: true, normalizedArgs: { ...args, amount_usd: amountUsd, from, description, due_date: dueDate } };
    }
    default:
      return { ok: true, normalizedArgs: args };
  }
}

async function lookupSideEffectRecord({ tenantId, toolName, idempotencyKey }) {
  const existing = await _pool.query(
    `SELECT id, request_hash, status, response_json, error_text, replay_count, last_replayed_at
       FROM worker_tool_side_effects
      WHERE tenant_id = $1
        AND tool_name = $2
        AND idempotency_key = $3`,
    [tenantId, toolName, idempotencyKey]
  );
  return existing.rows[0] || null;
}

function formatReplayResult(result, { idempotencyKey, replay, replayCount = 0 }) {
  const base = result && typeof result === 'object' && !Array.isArray(result)
    ? { ...result }
    : { value: result };
  return {
    ...base,
    idempotent_replay: replay,
    side_effect_idempotency_key: idempotencyKey,
    replay_count: Number(replayCount || 0),
  };
}

function normalizeBuiltinExecutionResult(raw) {
  if (raw && typeof raw === 'object') {
    if (raw.ok === true) {
      return { success: true, result: raw };
    }
    if (typeof raw.error === 'string' && raw.error.trim()) {
      return { success: false, error: raw.error.trim() };
    }
  }
  return { success: true, result: raw };
}

async function beginSideEffectExecution(toolName, args = {}, meta = {}) {
  if (!_pool) {
    return { ok: false, response: { success: false, error: `${toolName} requires database-backed side-effect durability` } };
  }

  const tenantId = normalizeString(meta?.tenant_id);
  if (!tenantId) {
    return { ok: false, response: { success: false, error: `${toolName} requires tenant context` } };
  }

  const idempotencyKey = buildSideEffectIdempotencyKey(toolName, args, meta);
  if (!idempotencyKey) {
    return {
      ok: false,
      response: { success: false, error: `${toolName} requires execution_id or side_effect_idempotency_key for durable replay protection` },
    };
  }

  const requestHash = buildSideEffectRequestHash(toolName, args);
  const existing = await lookupSideEffectRecord({ tenantId, toolName, idempotencyKey });
  if (existing) {
    if (String(existing.request_hash) !== requestHash) {
      return {
        ok: false,
        response: { success: false, error: `${toolName} idempotency conflict: the same key was already used for a different request` },
      };
    }
    if (existing.status === 'succeeded') {
      await _pool.query(
        `UPDATE worker_tool_side_effects
            SET replay_count = COALESCE(replay_count, 0) + 1,
                last_replayed_at = NOW(),
                updated_at = NOW()
          WHERE tenant_id = $1
            AND tool_name = $2
            AND idempotency_key = $3`,
        [tenantId, toolName, idempotencyKey]
      );
      const replayCount = Number(existing.replay_count || 0) + 1;
      return {
        ok: false,
        response: { success: true, result: formatReplayResult(existing.response_json || {}, { idempotencyKey, replay: true, replayCount }) },
      };
    }
    if (existing.status === 'failed') {
      await _pool.query(
        `UPDATE worker_tool_side_effects
            SET replay_count = COALESCE(replay_count, 0) + 1,
                last_replayed_at = NOW(),
                updated_at = NOW()
          WHERE tenant_id = $1
            AND tool_name = $2
            AND idempotency_key = $3`,
        [tenantId, toolName, idempotencyKey]
      );
      return {
        ok: false,
        response: { success: false, error: existing.error_text || `${toolName} previously failed for this idempotency key` },
      };
    }
    return {
      ok: false,
      response: { success: false, error: `${toolName} with the same idempotency key is already in progress` },
    };
  }

  const insertResult = await _pool.query(
    `INSERT INTO worker_tool_side_effects (
       id, tenant_id, worker_id, execution_id, tool_name, idempotency_key, request_hash,
      request_json, status, target, amount_usd, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'pending', $9, $10, NOW(), NOW())
     ON CONFLICT (tenant_id, tool_name, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      randomId('wse'),
      tenantId,
      normalizeString(meta?.worker_id) || null,
      normalizeString(meta?.execution_id) || null,
      toolName,
      idempotencyKey,
      requestHash,
      stableJsonStringify(args),
      buildSideEffectTarget(toolName, args) || null,
      buildSideEffectAmount(toolName, args),
    ]
  );

  if (insertResult.rowCount === 0) {
    const raced = await lookupSideEffectRecord({ tenantId, toolName, idempotencyKey });
    if (raced && String(raced.request_hash) === requestHash && raced.status === 'succeeded') {
      await _pool.query(
        `UPDATE worker_tool_side_effects
            SET replay_count = COALESCE(replay_count, 0) + 1,
                last_replayed_at = NOW(),
                updated_at = NOW()
          WHERE tenant_id = $1
            AND tool_name = $2
            AND idempotency_key = $3`,
        [tenantId, toolName, idempotencyKey]
      );
      return {
        ok: false,
        response: { success: true, result: formatReplayResult(raced.response_json || {}, { idempotencyKey, replay: true, replayCount: Number(raced.replay_count || 0) + 1 }) },
      };
    }
    if (raced && String(raced.request_hash) === requestHash && raced.status === 'failed') {
      await _pool.query(
        `UPDATE worker_tool_side_effects
            SET replay_count = COALESCE(replay_count, 0) + 1,
                last_replayed_at = NOW(),
                updated_at = NOW()
          WHERE tenant_id = $1
            AND tool_name = $2
            AND idempotency_key = $3`,
        [tenantId, toolName, idempotencyKey]
      );
      return {
        ok: false,
        response: { success: false, error: raced.error_text || `${toolName} previously failed for this idempotency key` },
      };
    }
    return {
      ok: false,
      response: { success: false, error: `${toolName} side-effect idempotency claim failed` },
    };
  }

  return { ok: true, idempotencyKey };
}

async function finalizeSideEffectExecution({ toolName, meta = {}, status, result = null, error = null, idempotencyKey }) {
  if (!_pool) return;
  const tenantId = normalizeString(meta?.tenant_id);
  if (!tenantId || !idempotencyKey) return;

  await _pool.query(
    `UPDATE worker_tool_side_effects
        SET status = $4,
            response_json = $5::jsonb,
            error_text = $6,
            provider_ref = $7,
            updated_at = NOW()
      WHERE tenant_id = $1
        AND tool_name = $2
        AND idempotency_key = $3`,
    [
      tenantId,
      toolName,
      idempotencyKey,
      status,
      result == null ? null : stableJsonStringify(result),
      error,
      buildSideEffectProviderRef(toolName, result || {}),
    ]
  );
}

async function executeSideEffectTool(toolName, args, meta, executor) {
  const begin = await beginSideEffectExecution(toolName, args, meta);
  if (!begin.ok) {
    return begin.response;
  }

  try {
    const raw = await executor();
    const normalized = normalizeBuiltinExecutionResult(raw);
    if (!normalized.success) {
      await finalizeSideEffectExecution({
        toolName,
        meta,
        status: 'failed',
        error: normalized.error,
        idempotencyKey: begin.idempotencyKey,
      });
      return { success: false, error: normalized.error };
    }

    await finalizeSideEffectExecution({
      toolName,
      meta,
      status: 'succeeded',
      result: normalized.result,
      idempotencyKey: begin.idempotencyKey,
    });

    return {
      success: true,
      result: formatReplayResult(normalized.result, { idempotencyKey: begin.idempotencyKey, replay: false }),
    };
  } catch (err) {
    await finalizeSideEffectExecution({
      toolName,
      meta,
      status: 'failed',
      error: err.message,
      idempotencyKey: begin.idempotencyKey,
    });
    return { success: false, error: err.message };
  }
}

function delegationGenerateId(prefix = 'exec') {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}_${rand}`;
}

const DELEGATION_POLL_MS = 2000;
const DELEGATION_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_DELEGATION_DEPTH = 5;

async function delegateToWorker({ worker_id, task, context, wait_for_result = false }, meta) {
  if (!_pool) {
    return { error: 'Delegation not available — database pool not configured' };
  }

  if (meta?.delegation_depth >= MAX_DELEGATION_DEPTH) {
    return { error: `Delegation depth limit exceeded (max ${MAX_DELEGATION_DEPTH}). Cannot delegate further.` };
  }
  if (meta?.worker_id === worker_id) {
    return { error: 'A worker cannot delegate to itself' };
  }

  const wr = await _pool.query(
    `SELECT id, tenant_id, model, status FROM workers WHERE id = $1`,
    [worker_id]
  );
  if (wr.rowCount === 0) {
    return { error: `Target worker not found: ${worker_id}` };
  }
  const target = wr.rows[0];
  if (target.status === 'archived' || target.status === 'paused') {
    return { error: `Target worker is ${target.status} and cannot accept delegations` };
  }

  const initialActivity = [
    { ts: new Date().toISOString(), type: 'delegation', detail: `Delegated task: ${task}` },
  ];
  if (context) {
    initialActivity.push({ ts: new Date().toISOString(), type: 'delegation_context', detail: context.slice(0, 10000) });
  }

  const execId = delegationGenerateId('exec');
  const parentExecId = meta?.execution_id || null;
  const currentDepth = (meta?.delegation_depth || 0) + 1;
  await _pool.query(
    `INSERT INTO worker_executions (id, worker_id, tenant_id, trigger_type, status, model, started_at, activity, metadata)
     VALUES ($1, $2, $3, 'delegation', 'queued', $4, $5, $6::jsonb, $7::jsonb)`,
    [
      execId, worker_id, target.tenant_id, target.model,
      new Date().toISOString(), JSON.stringify(initialActivity),
      JSON.stringify({ parent_execution_id: parentExecId, delegated_task: task, delegation_depth: currentDepth }),
    ]
  );

  log('info', `Delegation created: exec ${execId} for worker ${worker_id} (parent: ${parentExecId})`);

  if (!wait_for_result) {
    return { ok: true, execution_id: execId, worker_id, status: 'queued', message: 'Delegation created. The target worker will execute asynchronously.' };
  }

  const deadline = Date.now() + DELEGATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, DELEGATION_POLL_MS));
    const check = await _pool.query(
      `SELECT status, result, error FROM worker_executions WHERE id = $1`,
      [execId]
    );
    if (check.rowCount === 0) {
      return { error: 'Delegated execution disappeared' };
    }
    const row = check.rows[0];
    if (isTerminalExecutionStatus(row.status)) {
      return {
        ok: row.status === 'completed' || row.status === 'shadow_completed',
        execution_id: execId,
        worker_id,
        status: row.status,
        result: row.result?.slice(0, 15000) || null,
        error: row.error || null,
      };
    }
  }

  return { ok: false, execution_id: execId, worker_id, status: 'timeout', message: 'Delegation timed out after 5 minutes' };
}

export async function executeBuiltinTool(toolName, args, meta) {
  try {
    const preflight = await preflightBuiltinTool(toolName, args, meta);
    if (!preflight.ok) {
      return { success: false, error: `Preflight blocked ${toolName}: ${preflight.error}` };
    }

    const normalizedArgs = preflight.normalizedArgs || args;
    let result;

    switch (toolName) {
      case 'web_search':
        result = await webSearch(normalizedArgs);
        break;
      case 'browse_webpage':
        result = await browseWebpage(normalizedArgs);
        break;
      case 'read_document':
        result = await readDocument(normalizedArgs);
        break;
      case 'send_sms':
        return executeSideEffectTool(toolName, normalizedArgs, meta, () => sendSms(normalizedArgs));
      case 'make_phone_call':
        return executeSideEffectTool(toolName, normalizedArgs, meta, () => makePhoneCall(normalizedArgs));
      case 'send_email':
        return executeSideEffectTool(toolName, normalizedArgs, meta, () => sendEmail(normalizedArgs));
      case 'delegate_to_worker':
        result = await delegateToWorker(normalizedArgs, meta);
        break;
      case 'run_code':
        return runCode(normalizedArgs);
      case 'generate_image':
        return generateImage(normalizedArgs);
      case 'wait_for_event':
        return waitForEvent(normalizedArgs);
      case 'check_balance': {
        if (!_pool) return { success: false, error: 'Database not available' };
        const tenantId = meta?.tenant_id;
        if (!tenantId) return { success: false, error: 'No tenant context' };

        const balResult = await _pool.query(
          'SELECT balance_usd, total_spent_usd FROM tenant_credits WHERE tenant_id = $1',
          [tenantId]
        );
        const credits = balResult.rows[0];
        if (!credits) {
          return { success: true, result: { balance_usd: 0, total_spent_usd: 0, message: 'No credit record found' } };
        }

        const recentResult = await _pool.query(
          `SELECT COALESCE(SUM(ABS(amount_usd)), 0) AS recent_spend
           FROM credit_transactions
           WHERE tenant_id = $1 AND created_at > now() - interval '24 hours'`,
          [tenantId]
        );

        result = {
          balance_usd: parseFloat(credits.balance_usd),
          total_spent_usd: parseFloat(credits.total_spent_usd),
          last_24h_spend_usd: parseFloat(recentResult.rows[0]?.recent_spend || 0),
        };
        break;
      }
      case 'make_payment':
        return executeSideEffectTool(toolName, normalizedArgs, meta, async () => {
          if (!_pool) return { error: 'Database not available' };
          const tenantId = meta?.tenant_id;
          if (!tenantId) return { error: 'No tenant context' };

          const { amount_usd, recipient, description } = normalizedArgs;
          if (!amount_usd || amount_usd <= 0) return { error: 'amount_usd must be positive' };

          const balCheck = await _pool.query('SELECT balance_usd FROM tenant_credits WHERE tenant_id = $1', [tenantId]);
          const balance = parseFloat(balCheck.rows[0]?.balance_usd ?? 0);
          if (balance < amount_usd) {
            return { error: `Insufficient balance: $${balance.toFixed(2)} available, $${amount_usd.toFixed(2)} requested` };
          }

          const client = await _pool.connect();
          try {
            await client.query('BEGIN');
            await client.query(
              'UPDATE tenant_credits SET balance_usd = balance_usd - $2, total_spent_usd = total_spent_usd + $2, updated_at = now() WHERE tenant_id = $1',
              [tenantId, amount_usd]
            );
            const txnId = `txn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
            await client.query(
              `INSERT INTO credit_transactions (id, tenant_id, amount_usd, type, description, execution_id, created_at)
               VALUES ($1, $2, $3, 'worker_payment', $4, $5, now())`,
              [txnId, tenantId, -amount_usd, `Payment to ${recipient}: ${description}`, meta?.execution_id]
            );
            await client.query('COMMIT');

            const newBal = await _pool.query('SELECT balance_usd FROM tenant_credits WHERE tenant_id = $1', [tenantId]);
            return {
              transaction_id: txnId,
              amount_usd,
              recipient,
              description,
              remaining_balance_usd: parseFloat(newBal.rows[0]?.balance_usd ?? 0),
            };
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw new Error(`Payment failed: ${err.message}`);
          } finally {
            client.release();
          }
        });
      case 'request_payment':
        return executeSideEffectTool(toolName, normalizedArgs, meta, async () => {
          if (!_pool) return { error: 'Database not available' };
          const { amount_usd, from: payer, description, due_date } = normalizedArgs;
          if (!amount_usd || amount_usd <= 0) return { error: 'amount_usd must be positive' };

          const requestId = `pr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
          const tenantId = meta?.tenant_id;
          if (tenantId) {
            try {
              await _pool.query(
                `INSERT INTO credit_transactions (id, tenant_id, amount_usd, type, description, execution_id, created_at)
                 VALUES ($1, $2, $3, 'payment_request', $4, $5, now())`,
                [requestId, tenantId, 0, `Payment request: $${amount_usd.toFixed(2)} from ${payer} — ${description}${due_date ? ` (due: ${due_date})` : ''}`, meta?.execution_id]
              );
            } catch (err) {
              log('warn', `Failed to record payment request: ${err.message}`);
            }
          }

          return {
            request_id: requestId,
            amount_usd,
            from: payer,
            description,
            due_date: due_date || null,
            status: 'pending',
            message: 'Payment request created. The account owner will be notified.',
          };
        });
      case 'store_file': {
        const { filename, content, content_type = 'text/plain' } = normalizedArgs;
        if (!filename || !content) return { success: false, error: 'filename and content are required' };
        if (content.length > 5 * 1024 * 1024) return { success: false, error: 'Content too large (max 5MB)' };

        const tenantId = meta?.tenant_id || 'default';
        const execId = meta?.execution_id || 'unknown';
        const key = `worker-files/${tenantId}/${execId}/${filename}`;

        const s3Endpoint = process.env.WORKER_S3_ENDPOINT || process.env.PROXY_EVIDENCE_S3_ENDPOINT;
        const s3Bucket = process.env.WORKER_S3_BUCKET || process.env.PROXY_EVIDENCE_S3_BUCKET;
        const s3AccessKey = process.env.WORKER_S3_ACCESS_KEY_ID || process.env.PROXY_EVIDENCE_S3_ACCESS_KEY_ID;
        const s3SecretKey = process.env.WORKER_S3_SECRET_ACCESS_KEY || process.env.PROXY_EVIDENCE_S3_SECRET_ACCESS_KEY;
        const s3Region = process.env.WORKER_S3_REGION || process.env.PROXY_EVIDENCE_S3_REGION || 'us-east-1';

        if (!s3Endpoint || !s3Bucket || !s3AccessKey || !s3SecretKey) {
          result = {
            filename,
            size_bytes: content.length,
            storage: 'inline',
            message: 'S3 not configured — content saved to execution log only',
          };
          break;
        }

        try {
          const { presignS3Url } = await import('./lib/s3-presign.js');

          const putUrl = presignS3Url({
            method: 'PUT',
            endpoint: s3Endpoint,
            bucket: s3Bucket,
            key,
            region: s3Region,
            accessKeyId: s3AccessKey,
            secretAccessKey: s3SecretKey,
            expiresIn: 300,
            contentType: content_type,
          });

          const uploadRes = await fetch(putUrl, {
            method: 'PUT',
            headers: { 'Content-Type': content_type },
            body: content,
          });

          if (!uploadRes.ok) {
            return { success: false, error: `S3 upload failed: ${uploadRes.status}` };
          }

          const downloadUrl = presignS3Url({
            method: 'GET',
            endpoint: s3Endpoint,
            bucket: s3Bucket,
            key,
            region: s3Region,
            accessKeyId: s3AccessKey,
            secretAccessKey: s3SecretKey,
            expiresIn: 3600,
          });

          result = {
            filename,
            size_bytes: content.length,
            download_url: downloadUrl,
            expires_in: '1 hour',
            storage: 's3',
            key,
          };
        } catch (err) {
          return { success: false, error: `File storage failed: ${err.message}` };
        }
        break;
      }
      case 'check_processed': {
        if (!_pool) return { success: false, error: 'Database not available' };
        const workerId = meta?.worker_id;
        if (!workerId || !normalizedArgs.item_id) return { success: false, error: 'worker_id and item_id required' };

        const cpResult = await _pool.query(
          `SELECT value FROM worker_memory WHERE worker_id = $1 AND key = $2 AND scope = 'processed'`,
          [workerId, `processed:${normalizedArgs.item_id}`]
        );

        result = {
          already_processed: cpResult.rowCount > 0,
          processed_at: cpResult.rows[0]?.value ? JSON.parse(cpResult.rows[0].value).processed_at : null,
          summary: cpResult.rows[0]?.value ? JSON.parse(cpResult.rows[0].value).summary : null,
        };
        break;
      }
      case 'mark_processed': {
        if (!_pool) return { success: false, error: 'Database not available' };
        const workerId = meta?.worker_id;
        if (!workerId || !normalizedArgs.item_id) return { success: false, error: 'worker_id and item_id required' };

        const value = JSON.stringify({
          processed_at: new Date().toISOString(),
          summary: normalizedArgs.summary || null,
          execution_id: meta?.execution_id,
        });

        await _pool.query(
          `INSERT INTO worker_memory (id, worker_id, tenant_id, key, value, scope, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'processed', now())
           ON CONFLICT (worker_id, key) DO UPDATE SET value = $5, updated_at = now()`,
          [
            `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            workerId,
            meta?.tenant_id || null,
            `processed:${normalizedArgs.item_id}`,
            value,
          ]
        );

        result = { marked: true, item_id: normalizedArgs.item_id };
        break;
      }
      default:
        return { success: false, error: `Unknown builtin tool: ${toolName}` };
    }

    log('info', `Builtin tool executed: ${toolName}`);
    return normalizeBuiltinExecutionResult(result);
  } catch (err) {
    log('error', `Builtin tool ${toolName} failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export {
  getBuiltinToolPolicy,
  getBuiltinTools,
  isBuiltinTool,
};

export default {
  getBuiltinTools,
  getBuiltinToolPolicy,
  isBuiltinTool,
  executeBuiltinTool,
  preflightBuiltinTool,
  setPool,
  WORKER_EXECUTION_TERMINAL_STATUSES,
};
