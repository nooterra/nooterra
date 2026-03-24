/**
 * Worker Scheduler
 *
 * Cron-like scheduler for recurring worker execution.
 * Zero external dependencies. Parses standard 5-field cron expressions,
 * persists schedules to disk, tracks execution history, and detects
 * missed runs on startup.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const SCHEDULES_FILE = path.join(os.homedir(), '.nooterra', 'schedules.json');
const CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds
const MAX_HISTORY_PER_SCHEDULE = 10;

// ---------------------------------------------------------------------------
// Cron Parser
// ---------------------------------------------------------------------------

/**
 * Parse a 5-field cron expression into a structured object.
 *
 * Fields: minute hour day-of-month month day-of-week
 *
 * Supports:
 *   *         — any value
 *   5         — exact value
 *   1-5       — range (inclusive)
 *   * /5       — step (every N) — written without space; spaced here for comment safety
 *   1,3,5     — list
 *   Combinations like 1-5/2
 */
export function parseCron(expr) {
  const raw = expr.trim().split(/\s+/);
  if (raw.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${raw.length} in "${expr}"`);
  }

  const fieldNames = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'];
  const ranges = [
    [0, 59],  // minute
    [0, 23],  // hour
    [1, 31],  // day of month
    [1, 12],  // month
    [0, 6],   // day of week (0=Sunday)
  ];

  const parsed = {};

  for (let i = 0; i < 5; i++) {
    parsed[fieldNames[i]] = parseField(raw[i], ranges[i][0], ranges[i][1]);
  }

  parsed.raw = expr.trim();
  return parsed;
}

function parseField(field, min, max) {
  const values = new Set();

  const parts = field.split(',');
  for (const part of parts) {
    // Handle step: */5 or 1-10/2
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    let range;
    let step = 1;

    if (stepMatch) {
      range = stepMatch[1];
      step = parseInt(stepMatch[2], 10);
      if (step <= 0) throw new Error(`Invalid step value: ${step}`);
    } else {
      range = part;
    }

    if (range === '*') {
      for (let v = min; v <= max; v += step) {
        values.add(v);
      }
    } else if (range.includes('-')) {
      const [startStr, endStr] = range.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) {
        throw new Error(`Invalid range: ${range} (must be ${min}-${max})`);
      }
      for (let v = start; v <= end; v += step) {
        values.add(v);
      }
    } else {
      const val = parseInt(range, 10);
      if (isNaN(val) || val < min || val > max) {
        throw new Error(`Invalid value: ${range} (must be ${min}-${max})`);
      }
      values.add(val);
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}

/**
 * Check if a Date matches a parsed cron expression.
 */
function cronMatches(parsed, date) {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // JS months are 0-based
  const dayOfWeek = date.getDay(); // 0=Sunday

  return (
    parsed.minute.includes(minute) &&
    parsed.hour.includes(hour) &&
    parsed.dayOfMonth.includes(dayOfMonth) &&
    parsed.month.includes(month) &&
    parsed.dayOfWeek.includes(dayOfWeek)
  );
}

/**
 * Get the next time a cron expression will match after `after`.
 * Scans minute-by-minute up to 366 days out.
 */
function getNextCronMatch(parsed, after) {
  const maxMinutes = 366 * 24 * 60;
  // Start from the next whole minute
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < maxMinutes; i++) {
    if (cronMatches(parsed, candidate)) {
      return new Date(candidate);
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null; // no match within a year — likely an impossible expression
}

// ---------------------------------------------------------------------------
// Schedule Persistence
// ---------------------------------------------------------------------------

function loadSchedules() {
  try {
    if (fs.existsSync(SCHEDULES_FILE)) {
      return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
    }
  } catch { /* corrupt file — start fresh */ }
  return {};
}

function saveSchedules(schedules) {
  const dir = path.dirname(SCHEDULES_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export function createScheduler(options = {}) {
  const executor = options.executor || null; // async (workerId, task) => result
  const onMissedRun = options.runMissed !== false; // default: run missed
  let intervalHandle = null;
  let running = false;
  let schedules = loadSchedules();

  function generateId() {
    return `sch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function persist() {
    saveSchedules(schedules);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Create a new schedule.
   */
  function schedule(workerId, cronExpr, task, scheduleOptions = {}) {
    const parsed = parseCron(cronExpr);
    const id = generateId();
    const now = new Date();

    schedules[id] = {
      id,
      workerId,
      cronExpr,
      cronParsed: parsed,
      task: typeof task === 'string' ? task : JSON.stringify(task),
      status: 'active', // active | paused
      createdAt: now.toISOString(),
      lastRunAt: null,
      nextRunAt: getNextCronMatch(parsed, now)?.toISOString() || null,
      history: [],
      options: {
        runMissed: scheduleOptions.runMissed !== false,
        timeoutMs: scheduleOptions.timeoutMs || 300000,
        label: scheduleOptions.label || null,
      },
    };

    persist();
    return schedules[id];
  }

  /**
   * List all schedules.
   */
  function list() {
    return Object.values(schedules);
  }

  /**
   * Pause a schedule.
   */
  function pause(id) {
    if (!schedules[id]) throw new Error(`Schedule ${id} not found`);
    schedules[id].status = 'paused';
    persist();
    return schedules[id];
  }

  /**
   * Resume a paused schedule.
   */
  function resume(id) {
    if (!schedules[id]) throw new Error(`Schedule ${id} not found`);
    schedules[id].status = 'active';
    const parsed = parseCron(schedules[id].cronExpr);
    schedules[id].nextRunAt = getNextCronMatch(parsed, new Date())?.toISOString() || null;
    persist();
    return schedules[id];
  }

  /**
   * Delete a schedule.
   */
  function del(id) {
    if (!schedules[id]) throw new Error(`Schedule ${id} not found`);
    const removed = schedules[id];
    delete schedules[id];
    persist();
    return removed;
  }

  /**
   * Get the next run time for a schedule.
   */
  function getNextRun(id) {
    if (!schedules[id]) throw new Error(`Schedule ${id} not found`);
    const sch = schedules[id];
    if (sch.status === 'paused') return null;
    const parsed = parseCron(sch.cronExpr);
    return getNextCronMatch(parsed, new Date());
  }

  /**
   * Execute a single schedule entry.
   */
  async function executeSchedule(sch) {
    if (!executor) return;

    const startTime = Date.now();
    let status = 'completed';
    let error = null;

    try {
      await executor(sch.workerId, sch.task);
    } catch (err) {
      status = 'failed';
      error = err.message || String(err);
    }

    const duration = Date.now() - startTime;
    const historyEntry = {
      runAt: new Date(startTime).toISOString(),
      status,
      duration,
      error,
    };

    // Keep last N runs
    sch.history.unshift(historyEntry);
    if (sch.history.length > MAX_HISTORY_PER_SCHEDULE) {
      sch.history = sch.history.slice(0, MAX_HISTORY_PER_SCHEDULE);
    }

    sch.lastRunAt = historyEntry.runAt;

    // Compute next run
    const parsed = parseCron(sch.cronExpr);
    sch.nextRunAt = getNextCronMatch(parsed, new Date())?.toISOString() || null;

    persist();
  }

  /**
   * Check all schedules and execute any that are due.
   */
  async function tick() {
    const now = new Date();

    for (const sch of Object.values(schedules)) {
      if (sch.status !== 'active') continue;
      if (!sch.nextRunAt) continue;

      const nextRun = new Date(sch.nextRunAt);
      if (now >= nextRun) {
        await executeSchedule(sch);
      }
    }
  }

  /**
   * Detect and optionally run missed schedules (e.g., scheduler was down).
   */
  async function handleMissedRuns() {
    if (!onMissedRun) return;

    const now = new Date();

    for (const sch of Object.values(schedules)) {
      if (sch.status !== 'active') continue;
      if (!sch.options.runMissed) continue;
      if (!sch.nextRunAt) continue;

      const nextRun = new Date(sch.nextRunAt);
      // If the scheduled time has passed and we haven't run since before it
      if (now > nextRun) {
        const lastRun = sch.lastRunAt ? new Date(sch.lastRunAt) : new Date(0);
        if (lastRun < nextRun) {
          // Missed run detected — execute now
          await executeSchedule(sch);
        }
      }
    }
  }

  /**
   * Start the scheduler loop.
   */
  async function start() {
    if (running) return;
    running = true;

    // Reload from disk in case another process updated
    schedules = loadSchedules();

    // Handle missed runs on startup
    await handleMissedRuns();

    intervalHandle = setInterval(async () => {
      try {
        await tick();
      } catch { /* swallow errors to keep the loop alive */ }
    }, CHECK_INTERVAL_MS);

    // Unref so the scheduler doesn't prevent process exit in CLI
    if (intervalHandle.unref) intervalHandle.unref();
  }

  /**
   * Stop the scheduler loop.
   */
  function stop() {
    running = false;
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  return {
    schedule,
    list,
    pause,
    resume,
    delete: del,
    start,
    stop,
    getNextRun,
    tick, // exposed for testing
  };
}

export default { createScheduler, parseCron };
