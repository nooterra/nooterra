#!/usr/bin/env node

/**
 * Activity Feed
 *
 * Live execution visibility and history for workers.
 * Emits human-readable activity events during execution,
 * persists them alongside receipts, and provides CLI display helpers.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const NOOTERRA_DIR = path.join(os.homedir(), '.nooterra');
const RUNS_DIR = path.join(NOOTERRA_DIR, 'runs');

// ── ANSI Colors (matches cli.mjs) ──────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  gold: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
};

// ---------------------------------------------------------------------------
// Part 1: ActivityFeed class
// ---------------------------------------------------------------------------

class ActivityFeed {
  constructor(options = {}) {
    this.entries = [];
    this.onActivity = options.onActivity || (() => {});
    this.startedAt = null;
    this._workerName = null;
    this._taskId = null;
  }

  _elapsed() {
    if (!this.startedAt) return 0;
    return Date.now() - this.startedAt;
  }

  _push(type, data) {
    const entry = {
      timestamp: Date.now(),
      elapsed: this._elapsed(),
      type,
      data,
    };
    this.entries.push(entry);
    this.onActivity(entry);
    return entry;
  }

  start(workerName, taskId) {
    this.startedAt = Date.now();
    this._workerName = workerName;
    this._taskId = taskId;
    return this._push('start', { workerName, taskId });
  }

  thinking(round) {
    return this._push('thinking', { round });
  }

  toolCall(toolName, args, round) {
    return this._push('tool_call', { toolName, args, round });
  }

  toolResult(toolName, result, durationMs, blocked) {
    const summary = typeof result === 'string' ? result : JSON.stringify(result);
    // Build a compact preview
    let preview;
    if (blocked) {
      preview = 'BLOCKED';
    } else if (summary.length <= 80) {
      preview = summary;
    } else {
      preview = `${summary.length} chars`;
    }
    return this._push('tool_result', { toolName, preview, durationMs, blocked, resultLength: summary.length });
  }

  charterCheck(toolName, verdict, rule) {
    return this._push('charter', { toolName, verdict, rule });
  }

  memorySave(key) {
    return this._push('memory', { key });
  }

  knowledgeLoaded(itemCount, totalChars) {
    return this._push('knowledge', { itemCount, totalChars });
  }

  response(content, round) {
    const preview = content && content.length > 120 ? content.slice(0, 120) + '...' : (content || '');
    return this._push('response', { preview, contentLength: content?.length || 0, round });
  }

  complete(receipt) {
    return this._push('complete', {
      taskId: receipt?.taskId,
      duration: receipt?.duration,
      toolCallCount: receipt?.toolCallCount || 0,
      rounds: receipt?.executionLog?.length || 0,
      success: receipt?.success,
    });
  }

  error(message) {
    return this._push('error', { message });
  }

  getEntries() {
    return this.entries;
  }

  // ── Part 2: formatEntry ─────────────────────────────────────────────────

  formatEntry(entry) {
    const elapsed = (entry.elapsed / 1000).toFixed(1);
    const ts = `${c.dim}${elapsed.padStart(6)}s${c.reset}`;

    switch (entry.type) {
      case 'start':
        return `  ${c.bold}${c.gold}\u25b6${c.reset} ${ts}  ${c.bold}Starting ${entry.data.workerName}${c.reset} ${c.dim}(${entry.data.taskId})${c.reset}`;

      case 'thinking':
        return `  \u23f3 ${ts}  ${c.dim}Thinking... (round ${entry.data.round + 1})${c.reset}`;

      case 'tool_call': {
        const argsStr = entry.data.args ? JSON.stringify(entry.data.args) : '';
        const argsPreview = argsStr.length > 80 ? argsStr.slice(0, 77) + '...' : argsStr;
        return `  ${c.gold}\ud83d\udd27${c.reset} ${ts}  ${c.gold}${entry.data.toolName}${c.reset}(${c.dim}${argsPreview}${c.reset})`;
      }

      case 'tool_result': {
        if (entry.data.blocked) {
          return `  ${c.red}\u2717${c.reset}  ${ts}  ${c.red}${entry.data.toolName} \u2192 BLOCKED${c.reset}`;
        }
        const durStr = entry.data.durationMs != null ? ` (${entry.data.durationMs}ms)` : '';
        return `  ${c.green}\u2713${c.reset}  ${ts}  ${c.green}${entry.data.toolName}${c.reset} \u2192 ${entry.data.preview}${c.dim}${durStr}${c.reset}`;
      }

      case 'charter': {
        const verdictColor = entry.data.verdict === 'canDo' ? c.cyan
          : entry.data.verdict === 'askFirst' ? c.gold
          : c.red;
        const ruleStr = entry.data.rule ? ` (${entry.data.rule})` : '';
        return `  ${c.cyan}\ud83d\udee1\ufe0f${c.reset} ${ts}  ${c.cyan}Charter:${c.reset} ${verdictColor}${entry.data.verdict}${c.reset}${c.dim}${ruleStr}${c.reset}`;
      }

      case 'memory':
        return `  ${c.blue}\ud83d\udcbe${c.reset} ${ts}  ${c.blue}Memory saved: ${entry.data.key}${c.reset}`;

      case 'knowledge':
        return `  ${c.cyan}\ud83d\udcda${c.reset} ${ts}  ${c.dim}Knowledge loaded: ${entry.data.itemCount} items (${entry.data.totalChars} chars)${c.reset}`;

      case 'response': {
        const preview = entry.data.preview.replace(/\n/g, ' ');
        return `  ${c.white}\ud83d\udcac${c.reset} ${ts}  ${c.white}Response:${c.reset} "${preview}"`;
      }

      case 'complete': {
        const d = entry.data;
        return `  ${c.bold}${c.green}\u2705${c.reset} ${ts}  ${c.bold}${c.green}Complete${c.reset} \u2014 ${d.rounds} round${d.rounds !== 1 ? 's' : ''}, ${d.toolCallCount} tool call${d.toolCallCount !== 1 ? 's' : ''}, ${((d.duration || 0) / 1000).toFixed(1)}s`;
      }

      case 'error':
        return `  ${c.bold}${c.red}\u274c${c.reset} ${ts}  ${c.bold}${c.red}Error:${c.reset} ${entry.data.message}`;

      default:
        return `  ${c.dim}? ${ts}  ${entry.type}: ${JSON.stringify(entry.data)}${c.reset}`;
    }
  }

  formatAll() {
    return this.entries.map(e => this.formatEntry(e)).join('\n');
  }
}

// ---------------------------------------------------------------------------
// Part 3: Activity History (persistence)
// ---------------------------------------------------------------------------

function ensureRunsDir() {
  try { fs.mkdirSync(RUNS_DIR, { recursive: true }); } catch {}
}

function saveActivityLog(taskId, entries) {
  ensureRunsDir();
  const filePath = path.join(RUNS_DIR, `${taskId}.activity.json`);
  const payload = {
    taskId,
    savedAt: new Date().toISOString(),
    entryCount: entries.length,
    entries,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

function loadActivityLog(taskId) {
  const filePath = path.join(RUNS_DIR, `${taskId}.activity.json`);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.entries || [];
  } catch {
    return null;
  }
}

function loadWorkerActivity(workerId, limit = 10) {
  ensureRunsDir();
  let files;
  try {
    files = fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.activity.json'));
  } catch {
    return [];
  }

  // Load all activity files, filter to this worker, sort newest first
  const results = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(RUNS_DIR, f), 'utf8');
      const parsed = JSON.parse(raw);
      const entries = parsed.entries || [];
      // Check if any entry references this worker
      const startEntry = entries.find(e => e.type === 'start');
      if (!startEntry) continue;

      // Also check the corresponding receipt for workerId match
      const taskId = parsed.taskId;
      let matchesWorker = false;
      try {
        const receiptPath = path.join(RUNS_DIR, `${taskId}.json`);
        const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
        matchesWorker = receipt.workerId === workerId;
      } catch {
        // No receipt found — skip
        continue;
      }

      if (matchesWorker) {
        results.push({
          taskId: parsed.taskId,
          savedAt: parsed.savedAt,
          entries,
        });
      }
    } catch {
      // skip corrupt files
    }
  }

  // Sort newest first, then limit
  results.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Part 4: CLI display helpers
// ---------------------------------------------------------------------------

function printLiveActivity(entry) {
  const feed = new ActivityFeed();
  process.stderr.write(feed.formatEntry(entry) + '\n');
}

function printRunSummary(entries) {
  if (!entries || entries.length === 0) {
    console.log(`  ${c.dim}No activity recorded.${c.reset}`);
    return;
  }

  const completeEntry = entries.find(e => e.type === 'complete');
  const toolCalls = entries.filter(e => e.type === 'tool_call');
  const memorySaves = entries.filter(e => e.type === 'memory');
  const responses = entries.filter(e => e.type === 'response');
  const errors = entries.filter(e => e.type === 'error');

  // Count unique tool types
  const toolTypes = {};
  for (const tc of toolCalls) {
    const name = tc.data?.toolName || 'unknown';
    toolTypes[name] = (toolTypes[name] || 0) + 1;
  }

  const parts = [];

  if (completeEntry) {
    parts.push(`${completeEntry.data.rounds} round${completeEntry.data.rounds !== 1 ? 's' : ''}`);
  }

  parts.push(`${toolCalls.length} tool call${toolCalls.length !== 1 ? 's' : ''}`);

  // Show top tool types
  const sortedTools = Object.entries(toolTypes).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [name, count] of sortedTools) {
    parts.push(`${count} ${name}`);
  }

  if (memorySaves.length > 0) {
    parts.push(`${memorySaves.length} memory save${memorySaves.length !== 1 ? 's' : ''}`);
  }

  // Duration
  const totalMs = completeEntry?.data?.duration || (entries[entries.length - 1]?.elapsed || 0);
  const totalSec = (totalMs / 1000).toFixed(1);

  const statusIcon = errors.length > 0 ? `${c.red}\u2717${c.reset}` : `${c.green}\u2713${c.reset}`;
  console.log(`  ${statusIcon} ${parts.join(', ')} \u2014 ${totalSec}s`);
}

function printActivityLog(entries, options = {}) {
  if (!entries || entries.length === 0) {
    console.log(`  ${c.dim}No activity entries.${c.reset}`);
    return;
  }

  let filtered = entries;

  // Filter by type
  if (options.type) {
    filtered = filtered.filter(e => e.type === options.type);
  }

  // Apply limit
  if (options.limit && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }

  const feed = new ActivityFeed();

  for (const entry of filtered) {
    console.log(feed.formatEntry(entry));

    // Verbose mode — show full args/results
    if (options.verbose) {
      if (entry.type === 'tool_call' && entry.data.args) {
        const argsStr = JSON.stringify(entry.data.args, null, 2);
        const indented = argsStr.split('\n').map(l => `          ${c.dim}${l}${c.reset}`).join('\n');
        console.log(indented);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Part 5: Integration — createExecutionFeed
// ---------------------------------------------------------------------------

function createExecutionFeed(options = {}) {
  const feed = new ActivityFeed(options);

  return {
    feed,

    // Drop-in notification bus replacement
    notify: async (event, data) => {
      switch (event) {
        case 'tool_call':
          feed.toolCall(data.name, data.args, data.round);
          break;
        case 'tool_result':
          feed.toolResult(data.name, data.result, data.durationMs, data.blocked);
          break;
        case 'thinking':
          feed.thinking(data.round);
          break;
        case 'charter_check':
          feed.charterCheck(data.toolName, data.verdict, data.rule);
          break;
        case 'memory_save':
          feed.memorySave(data.key);
          break;
        case 'knowledge_loaded':
          feed.knowledgeLoaded(data.itemCount, data.totalChars);
          break;
        case 'response':
          feed.response(data.content, data.round);
          break;
        case 'complete':
          feed.complete(data.receipt || data);
          break;
        case 'error':
          feed.error(data.message || String(data));
          break;
        case 'approval_needed':
          // Pass through — handled by outer notification bus
          break;
        default:
          break;
      }
    },

    // Direct callbacks the daemon can inject at each step
    onStart: (workerName, taskId) => feed.start(workerName, taskId),
    onRound: (round) => feed.thinking(round),
    onToolCall: (name, args, round) => feed.toolCall(name, args, round),
    onToolResult: (name, result, ms, blocked) => feed.toolResult(name, result, ms, blocked),
    onCharterCheck: (toolName, verdict, rule) => feed.charterCheck(toolName, verdict, rule),
    onMemorySave: (key) => feed.memorySave(key),
    onKnowledgeLoaded: (itemCount, totalChars) => feed.knowledgeLoaded(itemCount, totalChars),
    onResponse: (content, round) => feed.response(content, round),
    onComplete: (receipt) => feed.complete(receipt),
    onError: (message) => feed.error(message),

    // Persist when done
    save: () => {
      const taskId = feed._taskId;
      if (taskId && feed.entries.length > 0) {
        return saveActivityLog(taskId, feed.entries);
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  ActivityFeed,
  createExecutionFeed,
  printLiveActivity,
  printRunSummary,
  printActivityLog,
  saveActivityLog,
  loadActivityLog,
  loadWorkerActivity,
};
