/**
 * Approval Engine
 *
 * Multi-channel approval system for worker actions.
 * When a worker hits an `askFirst` action from its charter, the engine
 * routes the approval request across configured channels, enforces
 * timeouts, deduplicates cross-channel responses, and persists history.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createInterface } from 'readline';
import http from 'http';

const APPROVALS_DIR = path.join(os.homedir(), '.nooterra', 'approvals');
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const AUTO_APPROVE_THRESHOLD = 3; // approve if same action approved 3+ times in 24h
const AUTO_APPROVE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Channel adapters
// ---------------------------------------------------------------------------

/**
 * Terminal channel — prompts on stdin.
 */
function createTerminalChannel() {
  return {
    id: 'terminal',
    name: 'Terminal',

    async send(request) {
      return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const timeout = setTimeout(() => {
          rl.close();
          resolve({ decision: 'timeout', respondedBy: 'terminal:timeout' });
        }, request.timeoutMs || DEFAULT_TIMEOUT_MS);

        const prompt = [
          '',
          `  Approval required for worker "${request.workerId}"`,
          `  Action:  ${request.action}`,
          `  Detail:  ${request.description}`,
          `  Expires: ${new Date(request.expiresAt).toLocaleTimeString()}`,
          '',
          '  Approve? (y/n) ',
        ].join('\n');

        rl.question(prompt, (answer) => {
          clearTimeout(timeout);
          rl.close();
          const approved = /^y(es)?$/i.test((answer || '').trim());
          resolve({
            decision: approved ? 'approved' : 'denied',
            respondedBy: 'terminal:user',
          });
        });
      });
    },
  };
}

/**
 * Webhook channel — POST the request to a URL, then wait for a callback.
 */
function createWebhookChannel(webhookUrl, callbackPort = 0) {
  return {
    id: 'webhook',
    name: 'Webhook',

    async send(request) {
      // POST the approval request to the webhook
      const payload = JSON.stringify({
        approvalId: request.id,
        workerId: request.workerId,
        action: request.action,
        description: request.description,
        expiresAt: request.expiresAt,
        callbackUrl: `http://localhost:${callbackPort}/approval-callback`,
      });

      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        return { decision: 'error', respondedBy: 'webhook:send-failed' };
      }

      // Start a temporary HTTP server to receive the callback
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          server.close();
          resolve({ decision: 'timeout', respondedBy: 'webhook:timeout' });
        }, request.timeoutMs || DEFAULT_TIMEOUT_MS);

        const server = http.createServer((req, res) => {
          if (req.method === 'POST' && req.url === '/approval-callback') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
              clearTimeout(timeout);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
              server.close();
              try {
                const data = JSON.parse(body);
                const decision = data.approved ? 'approved' : 'denied';
                resolve({ decision, respondedBy: `webhook:${data.respondedBy || 'unknown'}` });
              } catch {
                resolve({ decision: 'denied', respondedBy: 'webhook:parse-error' });
              }
            });
          } else {
            res.writeHead(404);
            res.end();
          }
        });

        server.listen(callbackPort, () => {
          // Update the actual port if ephemeral
          callbackPort = server.address().port;
        });
      });
    },
  };
}

/**
 * Stubbed channels — return pending and never resolve on their own.
 * Real implementations would integrate with Slack/email/SMS APIs.
 */
function createSlackChannel(_config) {
  return {
    id: 'slack',
    name: 'Slack',
    async send(_request) {
      // Stub: in production, post to Slack and await interaction callback
      return new Promise(() => {}); // never resolves — cancelled by anti-stamping
    },
  };
}

function createEmailChannel(_config) {
  return {
    id: 'email',
    name: 'Email',
    async send(_request) {
      return new Promise(() => {});
    },
  };
}

function createSmsChannel(_config) {
  return {
    id: 'sms',
    name: 'SMS',
    async send(_request) {
      return new Promise(() => {});
    },
  };
}

const CHANNEL_FACTORIES = {
  terminal: createTerminalChannel,
  webhook: createWebhookChannel,
  slack: createSlackChannel,
  email: createEmailChannel,
  sms: createSmsChannel,
};

// ---------------------------------------------------------------------------
// Approval Engine
// ---------------------------------------------------------------------------

export function createApprovalEngine(options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const failOpen = options.failOpen === true; // default fail-closed
  const channels = [];
  const pending = new Map(); // id -> request
  const abortControllers = new Map(); // id -> AbortController

  // Ensure persistence directory
  fs.mkdirSync(APPROVALS_DIR, { recursive: true });

  // Register channels
  if (options.channels) {
    for (const ch of options.channels) {
      if (typeof ch === 'string' && CHANNEL_FACTORIES[ch]) {
        channels.push(CHANNEL_FACTORIES[ch]());
      } else if (typeof ch === 'object' && ch.id) {
        channels.push(ch);
      }
    }
  }

  // Default to terminal if nothing configured
  if (channels.length === 0) {
    channels.push(createTerminalChannel());
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function generateId() {
    return `apr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function persistApproval(record) {
    const file = path.join(APPROVALS_DIR, `${record.id}.json`);
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
  }

  function loadApprovalHistory(workerId) {
    try {
      const files = fs.readdirSync(APPROVALS_DIR).filter(f => f.endsWith('.json'));
      const records = [];
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(APPROVALS_DIR, file), 'utf8'));
          if (!workerId || data.workerId === workerId) {
            records.push(data);
          }
        } catch { /* skip corrupt files */ }
      }
      return records.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
    } catch {
      return [];
    }
  }

  /**
   * Create a deterministic hash of a tool call for exact-match auto-approve.
   * Sorts args keys so key order doesn't matter.
   */
  function hashToolCall(toolName, toolArgs) {
    const sortedArgs = toolArgs && typeof toolArgs === 'object'
      ? JSON.stringify(toolArgs, Object.keys(toolArgs).sort())
      : JSON.stringify(toolArgs ?? '');
    const payload = `${toolName}:${sortedArgs}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Check auto-approve policies:
   * 1. Action is in worker's canDo list (charter-based, handled by classifyAction)
   * 2. EXACT same tool call (name + args hash) approved 3+ times in last 24h
   *
   * Uses exact matching to prevent "send email to sarah" from auto-approving
   * "send email to entire company".
   */
  function shouldAutoApprove(workerId, action, charter) {
    // Policy 1: action is in canDo — defer to classifyAction in worker-daemon,
    // but also check here for backward compat when charter is passed directly.
    if (charter && charter.canDo) {
      for (const rule of charter.canDo) {
        if (rule.toLowerCase() === action.toLowerCase()) {
          return { autoApprove: true, reason: `canDo rule: ${rule}` };
        }
      }
    }

    // Policy 2: exact same action approved 3+ times in 24h
    // Uses exact string match on the action field (which should be the hash
    // when callers use requestApproval with toolName+args).
    const cutoff = Date.now() - AUTO_APPROVE_WINDOW_MS;
    const history = loadApprovalHistory(workerId);
    const recentApprovals = history.filter(
      (r) =>
        r.status === 'approved' &&
        r.action === action &&
        r.actionHash && r.actionHash === (action) &&
        new Date(r.requestedAt).getTime() > cutoff
    );

    // Also check by exact action string as fallback (for records without hash)
    const recentExactApprovals = history.filter(
      (r) =>
        r.status === 'approved' &&
        r.action === action &&
        new Date(r.requestedAt).getTime() > cutoff
    );

    const matchCount = Math.max(recentApprovals.length, recentExactApprovals.length);

    if (matchCount >= AUTO_APPROVE_THRESHOLD) {
      console.log(`[approval-engine] Auto-approve triggered for worker=${workerId} action="${action}" (${matchCount} exact matches in 24h)`);
      return { autoApprove: true, reason: `auto-approved: ${matchCount} exact-match approvals in last 24h` };
    }

    return { autoApprove: false };
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Request approval for a worker action.
   * Sends to all configured channels simultaneously.
   * First response wins — all other channels are cancelled (anti-stamping).
   */
  async function requestApproval(workerId, action, description, requestOptions = {}) {
    const id = generateId();
    const requestTimeoutMs = requestOptions.timeoutMs || timeoutMs;
    const expiresAt = new Date(Date.now() + requestTimeoutMs).toISOString();

    const record = {
      id,
      workerId,
      action,
      actionHash: requestOptions.actionHash || action,
      description,
      channels: channels.map(ch => ch.id),
      status: 'pending',
      requestedAt: new Date().toISOString(),
      respondedAt: null,
      respondedBy: null,
      expiresAt,
    };

    // Check auto-approve policies
    const autoResult = shouldAutoApprove(workerId, action, requestOptions.charter);
    if (autoResult.autoApprove) {
      record.status = 'approved';
      record.respondedAt = new Date().toISOString();
      record.respondedBy = `auto:${autoResult.reason}`;
      console.log(`[approval-engine] Auto-approved: worker=${workerId} action="${action}" reason="${autoResult.reason}"`);
      persistApproval(record);
      return record;
    }

    // Check bulk approval
    if (requestOptions.bulkApproved) {
      record.status = 'approved';
      record.respondedAt = new Date().toISOString();
      record.respondedBy = 'bulk:approveAll';
      persistApproval(record);
      return record;
    }

    pending.set(id, record);
    persistApproval(record);

    // Create an AbortController so we can cancel all channels on first response
    const controller = new AbortController();
    abortControllers.set(id, controller);

    const request = {
      id,
      workerId,
      action,
      description,
      expiresAt,
      timeoutMs: requestTimeoutMs,
    };

    // Race all channels + timeout
    const timeoutPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ decision: 'timeout', respondedBy: 'system:timeout' });
      }, requestTimeoutMs);

      // Clean up timer if aborted
      controller.signal.addEventListener('abort', () => clearTimeout(timer));
    });

    const channelPromises = channels.map((ch) =>
      ch.send(request).catch(() => ({ decision: 'error', respondedBy: `${ch.id}:error` }))
    );

    // First response wins
    const result = await Promise.race([...channelPromises, timeoutPromise]);

    // Anti-stamping: signal all channels to stop
    controller.abort();
    abortControllers.delete(id);

    // Update record
    record.status = result.decision === 'approved' ? 'approved' :
                    result.decision === 'timeout' ? 'expired' : 'denied';
    record.respondedAt = new Date().toISOString();
    record.respondedBy = result.respondedBy || 'unknown';

    // On timeout: fail-closed by default
    if (result.decision === 'timeout' && !failOpen) {
      record.status = 'denied';
    }

    pending.delete(id);
    persistApproval(record);

    return record;
  }

  /**
   * Externally respond to a pending approval (e.g., from a webhook or UI).
   */
  function respond(approvalId, decision, respondedBy) {
    const record = pending.get(approvalId);
    if (!record) {
      // Try loading from disk
      const file = path.join(APPROVALS_DIR, `${approvalId}.json`);
      if (!fs.existsSync(file)) {
        throw new Error(`Approval ${approvalId} not found`);
      }
      const diskRecord = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (diskRecord.status !== 'pending') {
        throw new Error(`Approval ${approvalId} already resolved: ${diskRecord.status}`);
      }
      diskRecord.status = decision === 'approved' ? 'approved' : 'denied';
      diskRecord.respondedAt = new Date().toISOString();
      diskRecord.respondedBy = respondedBy || 'external';
      persistApproval(diskRecord);

      // Cancel any in-flight channel requests
      const controller = abortControllers.get(approvalId);
      if (controller) {
        controller.abort();
        abortControllers.delete(approvalId);
      }
      pending.delete(approvalId);

      return diskRecord;
    }

    record.status = decision === 'approved' ? 'approved' : 'denied';
    record.respondedAt = new Date().toISOString();
    record.respondedBy = respondedBy || 'external';

    // Anti-stamping: cancel all channels
    const controller = abortControllers.get(approvalId);
    if (controller) {
      controller.abort();
      abortControllers.delete(approvalId);
    }

    pending.delete(approvalId);
    persistApproval(record);

    return record;
  }

  /**
   * Get approval history for a worker (or all workers if no id).
   */
  function getHistory(workerId) {
    return loadApprovalHistory(workerId);
  }

  /**
   * Get all pending approval requests.
   */
  function getPending() {
    return Array.from(pending.values());
  }

  /**
   * Bulk-approve all actions for a worker (development use).
   */
  function approveAll(workerId) {
    const pendingForWorker = Array.from(pending.values()).filter(
      (r) => r.workerId === workerId
    );
    const results = [];
    for (const record of pendingForWorker) {
      results.push(respond(record.id, 'approved', 'bulk:approveAll'));
    }
    return results;
  }

  return {
    requestApproval,
    respond,
    getHistory,
    getPending,
    approveAll,
    hashToolCall,
    channels,
  };
}

export default { createApprovalEngine };
