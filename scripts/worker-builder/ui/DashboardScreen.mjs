/**
 * Nooterra TUI — Dashboard Screen
 *
 * Real-time status dashboard showing:
 * - Provider health (circuit breaker status, latency, cost)
 * - Worker status (running, idle, errored, delegations)
 * - Execution lanes (parallel task progress)
 * - Approval queue (pending approvals)
 * - Scheduled runs (next cron fires)
 * - System health (memory, uptime, receipts)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { Spinner } from '@inkjs/ui';

import { palette, icons } from './theme.mjs';
import { listWorkers, WORKER_STATUS } from '../worker-persistence.mjs';
import { PROVIDERS, getDefaultProvider, getConfiguredProviders } from '../provider-auth.mjs';

import fs from 'fs';
import path from 'path';
import os from 'os';

const NOOTERRA_DIR = path.join(os.homedir(), '.nooterra');
const RUNS_DIR = path.join(NOOTERRA_DIR, 'runs');
const APPROVALS_DIR = path.join(NOOTERRA_DIR, 'approvals');
const SCHEDULES_FILE = path.join(NOOTERRA_DIR, 'schedules.json');

// ── Data loaders ─────────────────────────────────────────────────────────

function loadProviderHealth() {
  try {
    const file = path.join(NOOTERRA_DIR, 'provider-health.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  return {};
}

function loadPendingApprovals() {
  try {
    if (!fs.existsSync(APPROVALS_DIR)) return [];
    return fs.readdirSync(APPROVALS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(APPROVALS_DIR, f), 'utf8')); } catch { return null; } })
      .filter(a => a && a.status === 'pending');
  } catch { return []; }
}

function loadSchedules() {
  try {
    if (fs.existsSync(SCHEDULES_FILE)) {
      const data = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
      return data.schedules || [];
    }
  } catch {}
  return [];
}

function countReceipts() {
  try { return fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json')).length; } catch { return 0; }
}

function getRecentReceipts(limit = 5) {
  try {
    return fs.readdirSync(RUNS_DIR)
      .filter(f => f.endsWith('.json'))
      .sort().reverse().slice(0, limit)
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8')); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function getUptime() {
  try {
    const statusFile = path.join(NOOTERRA_DIR, 'daemon-status.json');
    if (fs.existsSync(statusFile)) {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      if (status.startedAt) {
        const ms = Date.now() - new Date(status.startedAt).getTime();
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
      }
    }
  } catch {}
  return 'offline';
}

// ── Circuit breaker state names ──────────────────────────────────────────
const CB_COLORS = {
  CLOSED: palette.success,
  HALF_OPEN: palette.warning,
  OPEN: palette.error,
};

const CB_LABELS = {
  CLOSED: 'healthy',
  HALF_OPEN: 'testing',
  OPEN: 'down',
};

// ── Sub-components ──────────────────────────────────────────────────────

function SectionHeader({ title, icon }) {
  return React.createElement(Box, { marginTop: 1 },
    React.createElement(Text, { bold: true, color: palette.gold },
      `${icon || icons.hexagon}  ${title}`
    )
  );
}

function ProviderPanel() {
  const health = loadProviderHealth();
  const configured = getConfiguredProviders();
  const defaultProv = getDefaultProvider();

  const providers = configured.length > 0
    ? configured
    : Object.keys(PROVIDERS).filter(p => p !== 'chatgpt'); // show all if none configured

  return React.createElement(Box, { flexDirection: 'column', marginLeft: 2 },
    React.createElement(SectionHeader, { title: 'PROVIDERS', icon: icons.hexagon }),
    ...providers.map(pid => {
      const pd = PROVIDERS[pid];
      if (!pd) return null;
      const h = health[pid] || {};
      const cbState = h.circuitBreaker || 'CLOSED';
      const cbColor = CB_COLORS[cbState] || palette.textDim;
      const cbLabel = CB_LABELS[cbState] || cbState;
      const latency = h.p95Latency ? `${h.p95Latency}ms` : '-';
      const cost = h.totalCost ? `$${h.totalCost.toFixed(4)}` : '$0.00';
      const isDefault = pid === defaultProv;

      return React.createElement(Box, { key: pid, gap: 1, marginLeft: 1 },
        React.createElement(Text, { color: cbColor },
          cbState === 'CLOSED' ? icons.success : cbState === 'OPEN' ? icons.failure : icons.warning
        ),
        React.createElement(Box, { width: 16 },
          React.createElement(Text, { bold: isDefault },
            `${pd.name}${isDefault ? ' *' : ''}`
          )
        ),
        React.createElement(Box, { width: 10 },
          React.createElement(Text, { color: cbColor }, cbLabel)
        ),
        React.createElement(Box, { width: 10 },
          React.createElement(Text, { color: palette.textDim }, `p95: ${latency}`)
        ),
        React.createElement(Text, { color: palette.textDim }, `cost: ${cost}`),
      );
    }).filter(Boolean)
  );
}

function WorkerPanel() {
  const workers = listWorkers();

  if (workers.length === 0) {
    return React.createElement(Box, { flexDirection: 'column', marginLeft: 2 },
      React.createElement(SectionHeader, { title: 'WORKERS', icon: icons.bullet }),
      React.createElement(Text, { color: palette.textDim, marginLeft: 1 }, '  No workers. Type /new to create one.')
    );
  }

  return React.createElement(Box, { flexDirection: 'column', marginLeft: 2 },
    React.createElement(SectionHeader, { title: 'WORKERS', icon: icons.bullet }),
    ...workers.slice(0, 8).map(w => {
      const status = w.status === WORKER_STATUS.RUNNING
        ? { icon: icons.success, color: palette.success, label: 'running' }
        : w.status === WORKER_STATUS.ERROR
          ? { icon: icons.failure, color: palette.error, label: 'error' }
          : w.status === WORKER_STATUS.PAUSED
            ? { icon: icons.warning, color: palette.warning, label: 'paused' }
            : { icon: icons.dim, color: palette.textDim, label: 'idle' };

      const runs = w.stats?.totalRuns || 0;
      const lastRun = w.stats?.lastRunAt ? new Date(w.stats.lastRunAt).toLocaleString() : 'never';
      const provName = PROVIDERS[w.provider]?.name || w.provider || '';

      return React.createElement(Box, { key: w.id, gap: 1, marginLeft: 1 },
        React.createElement(Text, { color: status.color }, status.icon),
        React.createElement(Box, { width: 22 },
          React.createElement(Text, { bold: true }, (w.charter?.name || w.id).slice(0, 20))
        ),
        React.createElement(Box, { width: 8 },
          React.createElement(Text, { color: status.color }, status.label)
        ),
        React.createElement(Box, { width: 12 },
          React.createElement(Text, { color: palette.textDim }, `${runs} runs`)
        ),
        React.createElement(Text, { color: palette.textMuted }, provName),
      );
    }),
    workers.length > 8
      ? React.createElement(Text, { color: palette.textMuted, marginLeft: 2 },
          `  ... and ${workers.length - 8} more`
        )
      : null,
  );
}

function ApprovalPanel() {
  const pending = loadPendingApprovals();
  if (pending.length === 0) return null;

  return React.createElement(Box, { flexDirection: 'column', marginLeft: 2 },
    React.createElement(SectionHeader, { title: `APPROVALS (${pending.length} pending)`, icon: icons.warning }),
    ...pending.slice(0, 5).map((a, i) => {
      const age = a.requestedAt
        ? `${Math.round((Date.now() - new Date(a.requestedAt).getTime()) / 60000)}m ago`
        : '';
      return React.createElement(Box, { key: a.id || i, gap: 1, marginLeft: 1 },
        React.createElement(Text, { color: palette.warning }, icons.warning),
        React.createElement(Box, { width: 22 },
          React.createElement(Text, { bold: true }, (a.workerName || 'Worker').slice(0, 20))
        ),
        React.createElement(Box, { width: 30 },
          React.createElement(Text, { color: palette.textDim }, (a.description || a.action || '').slice(0, 28))
        ),
        React.createElement(Text, { color: palette.textMuted }, age),
      );
    }),
    React.createElement(Text, { color: palette.textMuted, marginLeft: 2 },
      '  /approve <id> or /deny <id>'
    ),
  );
}

function SchedulePanel() {
  const schedules = loadSchedules();
  if (schedules.length === 0) return null;

  return React.createElement(Box, { flexDirection: 'column', marginLeft: 2 },
    React.createElement(SectionHeader, { title: 'SCHEDULES', icon: icons.dim }),
    ...schedules.slice(0, 5).map((s, i) => {
      const paused = s.paused ? ' (paused)' : '';
      const lastRun = s.lastRun ? new Date(s.lastRun).toLocaleString() : 'never';
      return React.createElement(Box, { key: s.id || i, gap: 1, marginLeft: 1 },
        React.createElement(Text, { color: s.paused ? palette.textMuted : palette.success },
          s.paused ? icons.dim : icons.success
        ),
        React.createElement(Box, { width: 22 },
          React.createElement(Text, null, (s.workerName || 'Worker').slice(0, 20))
        ),
        React.createElement(Box, { width: 18 },
          React.createElement(Text, { color: palette.gold }, s.cron || '')
        ),
        React.createElement(Text, { color: palette.textDim }, `last: ${lastRun}${paused}`),
      );
    })
  );
}

function RecentActivity() {
  const receipts = getRecentReceipts(5);
  if (receipts.length === 0) return null;

  return React.createElement(Box, { flexDirection: 'column', marginLeft: 2 },
    React.createElement(SectionHeader, { title: 'RECENT ACTIVITY', icon: icons.bullet }),
    ...receipts.map((r, i) => {
      const ok = r.success || r.status === 'completed';
      const time = r.completedAt || r.timestamp || '';
      const short = time ? new Date(time).toLocaleTimeString() : '';
      const dur = r.duration ? `${r.duration}ms` : '';

      return React.createElement(Box, { key: i, gap: 1, marginLeft: 1 },
        React.createElement(Text, { color: ok ? palette.success : palette.error },
          ok ? icons.success : icons.failure
        ),
        React.createElement(Box, { width: 22 },
          React.createElement(Text, null, (r.workerName || 'Worker').slice(0, 20))
        ),
        React.createElement(Box, { width: 12 },
          React.createElement(Text, { color: palette.textDim }, short)
        ),
        React.createElement(Text, { color: palette.textMuted }, dur),
      );
    })
  );
}

function SystemHealth() {
  const uptime = getUptime();
  const receipts = countReceipts();
  const mem = process.memoryUsage();
  const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);

  return React.createElement(Box, { flexDirection: 'column', marginLeft: 2, marginBottom: 1 },
    React.createElement(SectionHeader, { title: 'SYSTEM', icon: icons.hexagon }),
    React.createElement(Box, { marginLeft: 1, gap: 2 },
      React.createElement(Text, { color: palette.textDim }, `Uptime: ${uptime}`),
      React.createElement(Text, { color: palette.textDim }, `Receipts: ${receipts}`),
      React.createElement(Text, { color: palette.textDim }, `Heap: ${heapMB}MB`),
      React.createElement(Text, { color: palette.textDim }, `Node: ${process.version}`),
    )
  );
}

// ── Main Dashboard ──────────────────────────────────────────────────────

export default function DashboardScreen({ onBack }) {
  const { stdout } = useStdout();
  const w = stdout?.columns || 80;
  const [tick, setTick] = useState(0);

  // Auto-refresh every 3 seconds
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 3000);
    return () => clearInterval(timer);
  }, []);

  useInput((_, key) => {
    if (key.escape) onBack();
  });

  const lineWidth = w > 4 ? w - 4 : 76;

  return React.createElement(Box, { flexDirection: 'column' },
    // Header
    React.createElement(Box, { marginLeft: 2, marginTop: 1 },
      React.createElement(Text, { bold: true, color: palette.gold }, `${icons.hexagon}  NOOTERRA DASHBOARD`),
      React.createElement(Text, { color: palette.textMuted }, `  (auto-refresh ${icons.bullet} Esc to go back)`),
    ),
    React.createElement(Box, { marginLeft: 2 },
      React.createElement(Text, { color: palette.border }, '\u2500'.repeat(lineWidth))
    ),

    // Panels
    React.createElement(ProviderPanel),
    React.createElement(WorkerPanel),
    React.createElement(ApprovalPanel),
    React.createElement(SchedulePanel),
    React.createElement(RecentActivity),

    // Separator
    React.createElement(Box, { marginLeft: 2, marginTop: 1 },
      React.createElement(Text, { color: palette.border }, '\u2500'.repeat(lineWidth))
    ),

    React.createElement(SystemHealth),
  );
}
