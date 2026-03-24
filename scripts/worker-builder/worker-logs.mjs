#!/usr/bin/env node

/**
 * nooterra logs <worker>
 *
 * Show execution history for a worker.
 * Displays receipts with timestamps, durations, tool calls, and charter decisions.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { listWorkers } from './worker-persistence.mjs';

const RUNS_DIR = path.join(os.homedir(), '.nooterra', 'runs');

const GOLD = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const GRAY = '\x1b[90m';

function loadReceipts(workerId) {
  try {
    return fs.readdirSync(RUNS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8'));
        } catch { return null; }
      })
      .filter(r => r && (r.workerId === workerId || r.workerName))
      .sort((a, b) => {
        const ta = a.completedAt || a.startedAt || a.timestamp || '';
        const tb = b.completedAt || b.startedAt || b.timestamp || '';
        return tb.localeCompare(ta); // newest first
      });
  } catch { return []; }
}

async function main() {
  const nameOrId = process.argv.slice(2).join(' ').trim();

  if (!nameOrId) {
    console.log(`\n  ${BOLD}Usage:${RESET} nooterra logs <worker name>\n`);
    const workers = listWorkers();
    if (workers.length > 0) {
      console.log(`  ${BOLD}Available workers:${RESET}`);
      for (const w of workers) {
        console.log(`    ${CYAN}●${RESET} ${w.charter?.name || w.id}`);
      }
      console.log('');
    }
    process.exit(0);
  }

  // Find the worker
  const workers = listWorkers();
  const worker = workers.find(w =>
    (w.charter?.name || '').toLowerCase().includes(nameOrId.toLowerCase()) || w.id === nameOrId
  );

  if (!worker) {
    console.error(`\n  ${RED}✗${RESET} Worker "${nameOrId}" not found.\n`);
    process.exit(1);
  }

  const receipts = loadReceipts(worker.id);

  console.log(`\n  ${BOLD}${GOLD}Logs: ${worker.charter?.name || worker.id}${RESET}`);
  console.log(`  ${DIM}${receipts.length} run${receipts.length !== 1 ? 's' : ''} recorded${RESET}\n`);

  if (receipts.length === 0) {
    console.log(`  ${DIM}No runs yet. Use /run ${worker.charter?.name} to execute.${RESET}\n`);
    process.exit(0);
  }

  for (const receipt of receipts.slice(0, 15)) {
    const ok = receipt.success || receipt.status === 'completed';
    const icon = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const time = receipt.completedAt || receipt.startedAt || receipt.timestamp || '';
    const short = time ? new Date(time).toLocaleString() : 'unknown time';
    const dur = receipt.duration || receipt.durationMs || 0;
    const tools = receipt.toolCallCount || receipt.executionLog?.reduce((n, l) => n + (l.toolCalls?.length || 0), 0) || 0;
    const blocked = receipt.blockedActions?.length || 0;
    const approvals = receipt.approvalsPending?.length || 0;
    const taskId = receipt.taskId || receipt.id || '';

    console.log(`  ${icon} ${BOLD}${short}${RESET}  ${DIM}${dur}ms${RESET}  ${DIM}${taskId}${RESET}`);

    if (tools > 0) console.log(`    ${DIM}Tool calls: ${tools}${RESET}`);
    if (blocked > 0) console.log(`    ${RED}Blocked: ${blocked} action${blocked !== 1 ? 's' : ''}${RESET}`);
    if (approvals > 0) console.log(`    ${GOLD}Approvals pending: ${approvals}${RESET}`);

    // Show response preview
    const response = receipt.response || receipt.content || '';
    if (response) {
      const preview = response.split('\n')[0].slice(0, 80);
      console.log(`    ${GRAY}${preview}${preview.length >= 80 ? '...' : ''}${RESET}`);
    }

    console.log('');
  }

  if (receipts.length > 15) {
    console.log(`  ${DIM}... and ${receipts.length - 15} more. Receipts stored in ~/.nooterra/runs/${RESET}\n`);
  }
}

main();
