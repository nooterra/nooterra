#!/usr/bin/env node

/**
 * Daemon Service
 *
 * Makes the Nooterra worker daemon a real persistent background service.
 * Survives terminal close, reboots (via launchd/systemd), and crashes
 * (auto-restart with backoff). Zero external dependencies.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const NOOTERRA_DIR = path.join(os.homedir(), '.nooterra');
const LOGS_DIR = path.join(NOOTERRA_DIR, 'logs');
const PID_FILE = path.join(NOOTERRA_DIR, 'daemon.pid');
const STATUS_FILE = path.join(NOOTERRA_DIR, 'daemon-status.json');
const LOG_FILE = path.join(LOGS_DIR, 'daemon.log');
const DAEMON_SCRIPT = path.resolve(
  new URL('.', import.meta.url).pathname,
  'daemon-service.mjs'
);

const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB
const ROTATED_LOG_COUNT = 3;
const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_HEARTBEAT_MS = 2 * 60 * 1000; // 2 minutes
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RESTART_DELAY_MS = 5_000;

// launchd / systemd identifiers
const LAUNCHD_LABEL = 'com.nooterra.daemon';
const LAUNCHD_PLIST = path.join(
  os.homedir(),
  'Library',
  'LaunchAgents',
  `${LAUNCHD_LABEL}.plist`
);
const SYSTEMD_SERVICE_DIR = path.join(
  os.homedir(),
  '.config',
  'systemd',
  'user'
);
const SYSTEMD_SERVICE_FILE = path.join(SYSTEMD_SERVICE_DIR, 'nooterra.service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  ensureDir(LOGS_DIR);
  fs.appendFileSync(LOG_FILE, line);
}

function readPid() {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function writePid(pid) {
  ensureDir(NOOTERRA_DIR);
  fs.writeFileSync(PID_FILE, String(pid));
}

function removePid() {
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Log Rotation
// ---------------------------------------------------------------------------

function rotateLogs() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < MAX_LOG_BYTES) return;
  } catch {
    return; // no log file yet
  }

  // Shift existing rotated logs: .3 -> deleted, .2 -> .3, .1 -> .2
  for (let i = ROTATED_LOG_COUNT; i >= 1; i--) {
    const src = i === 1 ? LOG_FILE : `${LOG_FILE}.${i - 1}`;
    const dst = `${LOG_FILE}.${i}`;
    try {
      if (i === ROTATED_LOG_COUNT) {
        try { fs.unlinkSync(dst); } catch { /* ok */ }
      }
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
      }
    } catch { /* best effort */ }
  }

  // Truncate the main log
  fs.writeFileSync(LOG_FILE, '');
}

// ---------------------------------------------------------------------------
// Health Heartbeat
// ---------------------------------------------------------------------------

function writeHeartbeat(extra = {}) {
  const status = {
    pid: process.pid,
    phase: 'running',
    startedAt: extra.startedAt || new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    uptime: process.uptime(),
    workers: extra.workers || 0,
    nextScheduledRun: extra.nextScheduledRun || null,
    memoryUsage: process.memoryUsage()
  };
  ensureDir(NOOTERRA_DIR);
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
}

function readHeartbeat() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stale Daemon Detection
// ---------------------------------------------------------------------------

/**
 * Check if the daemon is actually running.
 * Validates both PID liveness and heartbeat freshness.
 */
export function isRunning() {
  const pid = readPid();
  if (!pid) return false;
  if (!pidIsAlive(pid)) return false;

  // PID is alive — but is it *our* daemon and not a recycled PID?
  const hb = readHeartbeat();
  if (!hb) return false;

  // If heartbeat is stale, treat as dead
  const lastBeat = new Date(hb.lastHeartbeat).getTime();
  if (Date.now() - lastBeat > STALE_HEARTBEAT_MS) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

function installShutdownHandlers(cleanup) {
  const handler = (signal) => {
    log(`Received ${signal}, shutting down gracefully...`);
    cleanup();
    removePid();
    try { fs.unlinkSync(STATUS_FILE); } catch { /* ok */ }
    process.exit(0);
  };

  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}

// ---------------------------------------------------------------------------
// Auto-Restart Wrapper
// ---------------------------------------------------------------------------

/**
 * Run the daemon main loop with crash recovery.
 * On uncaught exception: log, wait 5s, restart.
 * Max 5 restarts within 10 minutes before giving up.
 */
async function runWithAutoRestart(mainFn) {
  const restartTimestamps = [];
  const startedAt = new Date().toISOString();
  let workerCount = 0;

  // Heartbeat timer
  const heartbeatTimer = setInterval(() => {
    rotateLogs();
    writeHeartbeat({ startedAt, workers: workerCount });
  }, HEARTBEAT_INTERVAL_MS);

  // Allow the daemon to stay alive
  // (setInterval already keeps the event loop open)

  installShutdownHandlers(() => {
    clearInterval(heartbeatTimer);
    log('Flushing state before exit.');
  });

  // Initial heartbeat
  writeHeartbeat({ startedAt, workers: 0 });

  while (true) {
    try {
      log('Daemon main loop starting.');
      workerCount = await mainFn({
        onWorkerCountChange: (n) => { workerCount = n; }
      });
      // If mainFn returns (shouldn't normally), break
      break;
    } catch (err) {
      log(`CRASH: ${err?.stack || err}`);

      // Track restart timestamps
      const now = Date.now();
      restartTimestamps.push(now);

      // Prune timestamps outside the window
      while (restartTimestamps.length > 0 && now - restartTimestamps[0] > RESTART_WINDOW_MS) {
        restartTimestamps.shift();
      }

      if (restartTimestamps.length > MAX_RESTARTS) {
        log(`Too many restarts (${restartTimestamps.length} in ${RESTART_WINDOW_MS / 60000} min). Giving up.`);
        clearInterval(heartbeatTimer);
        removePid();
        process.exit(1);
      }

      log(`Restarting in ${RESTART_DELAY_MS / 1000}s... (${restartTimestamps.length}/${MAX_RESTARTS} restarts)`);
      await new Promise(r => setTimeout(r, RESTART_DELAY_MS));
    }
  }

  clearInterval(heartbeatTimer);
}

// ---------------------------------------------------------------------------
// Daemonize (fork to background)
// ---------------------------------------------------------------------------

/**
 * Fork the current process as a detached background daemon.
 * The parent writes the child PID and exits. The child runs forever.
 */
export function daemonize() {
  ensureDir(LOGS_DIR);

  const logFd = fs.openSync(LOG_FILE, 'a');

  const child = spawn(process.execPath, [DAEMON_SCRIPT, '--daemon-child'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, NOOTERRA_DAEMON: '1' },
    cwd: os.homedir()
  });

  child.unref();
  writePid(child.pid);
  fs.closeSync(logFd);

  return child.pid;
}

// ---------------------------------------------------------------------------
// Start / Stop / Status
// ---------------------------------------------------------------------------

/**
 * Start the daemon. Detects OS and uses the appropriate method.
 * Returns { pid, method }.
 */
export function startDaemon() {
  if (isRunning()) {
    const pid = readPid();
    return { pid, method: 'already-running' };
  }

  // Clean up stale state
  removePid();
  try { fs.unlinkSync(STATUS_FILE); } catch { /* ok */ }

  const platform = os.platform();

  // macOS: prefer launchctl if plist is installed
  if (platform === 'darwin' && fs.existsSync(LAUNCHD_PLIST)) {
    try {
      execSync(`launchctl load -w "${LAUNCHD_PLIST}"`, { stdio: 'ignore' });
      // launchd starts the process; wait briefly for PID file
      const pid = waitForPid(3000);
      return { pid, method: 'launchd' };
    } catch {
      // Fall through to direct spawn
    }
  }

  // Linux: prefer systemd if service is installed
  if (platform === 'linux' && fs.existsSync(SYSTEMD_SERVICE_FILE)) {
    try {
      execSync('systemctl --user start nooterra', { stdio: 'ignore' });
      const pid = waitForPid(3000);
      return { pid, method: 'systemd' };
    } catch {
      // Fall through to direct spawn
    }
  }

  // Fallback: detached child_process
  const pid = daemonize();
  return { pid, method: 'spawn' };
}

/**
 * Stop the daemon.
 */
export function stopDaemon() {
  const platform = os.platform();

  // Try launchctl unload first on macOS
  if (platform === 'darwin' && fs.existsSync(LAUNCHD_PLIST)) {
    try {
      execSync(`launchctl unload "${LAUNCHD_PLIST}"`, { stdio: 'ignore' });
    } catch { /* may not be loaded */ }
  }

  // Try systemctl stop on Linux
  if (platform === 'linux' && fs.existsSync(SYSTEMD_SERVICE_FILE)) {
    try {
      execSync('systemctl --user stop nooterra', { stdio: 'ignore' });
    } catch { /* may not be running */ }
  }

  const pid = readPid();
  if (pid && pidIsAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch { /* already gone */ }

    // Give it a moment to clean up, then force-kill
    let waited = 0;
    while (pidIsAlive(pid) && waited < 5000) {
      const start = Date.now();
      // Busy-wait in small increments (no async context here)
      while (Date.now() - start < 200) { /* spin */ }
      waited += 200;
    }
    if (pidIsAlive(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* ok */ }
    }
  }

  removePid();
  try { fs.unlinkSync(STATUS_FILE); } catch { /* ok */ }

  return { stopped: true };
}

/**
 * Get daemon status.
 */
export function daemonStatus() {
  const running = isRunning();
  const pid = readPid();
  const heartbeat = readHeartbeat();

  if (!running) {
    return {
      running: false,
      pid: null,
      message: pid
        ? 'Daemon PID exists but process is not healthy (stale or dead).'
        : 'Daemon is not running.'
    };
  }

  return {
    running: true,
    pid,
    phase: heartbeat?.phase || 'unknown',
    startedAt: heartbeat?.startedAt || null,
    lastHeartbeat: heartbeat?.lastHeartbeat || null,
    uptime: heartbeat?.uptime || null,
    workers: heartbeat?.workers || 0,
    nextScheduledRun: heartbeat?.nextScheduledRun || null,
    memoryUsage: heartbeat?.memoryUsage || null
  };
}

function waitForPid(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pid = readPid();
    if (pid && pidIsAlive(pid)) return pid;
    // Spin briefly
    const s = Date.now();
    while (Date.now() - s < 100) { /* spin */ }
  }
  return readPid();
}

// ---------------------------------------------------------------------------
// macOS launchd Integration
// ---------------------------------------------------------------------------

function buildLaunchdPlist() {
  const nodeExec = process.execPath;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${nodeExec}</string>
    <string>${DAEMON_SCRIPT}</string>
    <string>--daemon-child</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>NOOTERRA_DAEMON</key>
    <string>1</string>
    <key>HOME</key>
    <string>${os.homedir()}</string>
    <key>PATH</key>
    <string>${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>

  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>

  <key>WorkingDirectory</key>
  <string>${os.homedir()}</string>

  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>`;
}

// ---------------------------------------------------------------------------
// Linux systemd Integration
// ---------------------------------------------------------------------------

function buildSystemdUnit() {
  const nodeExec = process.execPath;
  return `[Unit]
Description=Nooterra Worker Daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodeExec} ${DAEMON_SCRIPT} --daemon-child
Environment=NOOTERRA_DAEMON=1
Environment=HOME=${os.homedir()}
Environment=PATH=${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}
WorkingDirectory=${os.homedir()}
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

[Install]
WantedBy=default.target
`;
}

// ---------------------------------------------------------------------------
// Install / Uninstall Service
// ---------------------------------------------------------------------------

/**
 * Install the daemon as a system service (auto-start on login).
 * macOS: launchd plist in ~/Library/LaunchAgents
 * Linux: systemd user service in ~/.config/systemd/user
 */
export function installService() {
  const platform = os.platform();

  if (platform === 'darwin') {
    const dir = path.dirname(LAUNCHD_PLIST);
    ensureDir(dir);
    ensureDir(LOGS_DIR);
    fs.writeFileSync(LAUNCHD_PLIST, buildLaunchdPlist());
    // Load it so it starts now + on next login
    try {
      execSync(`launchctl load -w "${LAUNCHD_PLIST}"`, { stdio: 'ignore' });
    } catch { /* may already be loaded */ }
    return { installed: true, method: 'launchd', path: LAUNCHD_PLIST };
  }

  if (platform === 'linux') {
    ensureDir(SYSTEMD_SERVICE_DIR);
    ensureDir(LOGS_DIR);
    fs.writeFileSync(SYSTEMD_SERVICE_FILE, buildSystemdUnit());
    try {
      execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
      execSync('systemctl --user enable nooterra', { stdio: 'ignore' });
      execSync('systemctl --user start nooterra', { stdio: 'ignore' });
    } catch { /* best effort */ }
    return { installed: true, method: 'systemd', path: SYSTEMD_SERVICE_FILE };
  }

  return { installed: false, error: `Unsupported platform: ${platform}. Use "nooterra daemon start" for manual start.` };
}

/**
 * Remove the system service.
 */
export function uninstallService() {
  const platform = os.platform();

  if (platform === 'darwin') {
    try {
      execSync(`launchctl unload "${LAUNCHD_PLIST}"`, { stdio: 'ignore' });
    } catch { /* may not be loaded */ }
    try { fs.unlinkSync(LAUNCHD_PLIST); } catch { /* ok */ }
    return { uninstalled: true, method: 'launchd' };
  }

  if (platform === 'linux') {
    try {
      execSync('systemctl --user stop nooterra', { stdio: 'ignore' });
      execSync('systemctl --user disable nooterra', { stdio: 'ignore' });
    } catch { /* may not be running */ }
    try { fs.unlinkSync(SYSTEMD_SERVICE_FILE); } catch { /* ok */ }
    try {
      execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
    } catch { /* ok */ }
    return { uninstalled: true, method: 'systemd' };
  }

  return { uninstalled: false, error: `Unsupported platform: ${platform}` };
}

// ---------------------------------------------------------------------------
// Schedule Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an interval string like "1h", "30m", "5s", "1d" to a cron expression.
 * Falls back to every-hour if unrecognized.
 */
function intervalToCron(value) {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return '0 * * * *'; // fallback: every hour

  const num = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'm': {
      // "every N minutes"
      if (num <= 0 || num > 59) return '0 * * * *';
      return `*/${num} * * * *`;
    }
    case 'h': {
      // "every N hours"
      if (num <= 0 || num > 23) return '0 0 * * *';
      return `0 */${num} * * *`;
    }
    case 'd': {
      // "every N days" — run at midnight
      if (num === 1) return '0 0 * * *';
      // cron can't do "every N days" natively; approximate with day-of-month step
      return `0 0 */${num} * *`;
    }
    case 's': {
      // Cron can't go below 1 minute; clamp to every minute
      return '* * * * *';
    }
    default:
      return '0 * * * *';
  }
}

/**
 * Extract a cron expression from a worker trigger.
 * Handles { type: 'interval', value: '1h' } and { type: 'cron', value: '0 9 * * *' }.
 */
function triggerToCron(schedule) {
  if (!schedule) return null;
  if (schedule.type === 'cron') return schedule.value;
  if (schedule.type === 'interval') return intervalToCron(schedule.value);
  return null;
}

/**
 * Collect all schedule triggers from a worker.
 * Returns array of { trigger, cronExpr }.
 */
function getWorkerSchedules(worker) {
  const results = [];
  if (!worker.triggers || !Array.isArray(worker.triggers)) return results;

  for (const trigger of worker.triggers) {
    if (trigger.type !== 'schedule') continue;
    const schedule = trigger.config?.schedule;
    if (!schedule) continue;
    const cronExpr = triggerToCron(schedule);
    if (cronExpr) results.push({ trigger, cronExpr });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Daemon Child Entry Point
// ---------------------------------------------------------------------------

/**
 * This is the actual long-running daemon process.
 * Called when the process is spawned with --daemon-child or NOOTERRA_DAEMON=1.
 */
export async function runDaemonChild() {
  writePid(process.pid);
  log(`Daemon child started, PID ${process.pid}`);

  await runWithAutoRestart(async ({ onWorkerCountChange }) => {
    // Dynamic imports to avoid circular deps at module load time
    const { runWorkerExecution } = await import('./worker-daemon.mjs');
    const { createScheduler } = await import('./worker-scheduler.mjs');
    const { listWorkers, loadWorker, recordWorkerRun } = await import('./worker-persistence.mjs');
    const { createNotifier, NOTIFICATION_EVENTS } = await import('./notification-delivery.mjs');
    const { loadCredentials } = await import('./provider-auth.mjs');
    const { getConnectionManager } = await import('./mcp-integration.mjs');
    const { getNotificationBus } = await import('./notification-bus.mjs');

    const notifier = createNotifier();
    const mcpManager = getConnectionManager();
    const notificationBus = getNotificationBus();

    // Track which workers have registered schedules: scheduleId -> workerId
    const registeredSchedules = new Map();
    // Track known worker IDs to detect new ones
    const knownWorkerIds = new Set();

    // ── Executor: called by the scheduler when a schedule fires ──────────

    async function executeScheduledWorker(workerId, _task) {
      const worker = loadWorker(workerId);
      if (!worker) {
        log(`[scheduler] Worker ${workerId} not found on disk, skipping execution`);
        return;
      }

      if (worker.status === 'paused' || worker.status === 'archived') {
        log(`[scheduler] Worker ${worker.charter?.name || workerId} is ${worker.status}, skipping`);
        return;
      }

      log(`[scheduler] Executing worker: ${worker.charter?.name || workerId}`);

      // Resolve API key for this worker's provider
      const provider = worker.provider || 'openai';
      let apiKey;
      try {
        apiKey = loadCredentials(provider);
      } catch (err) {
        log(`[scheduler] No API key for provider "${provider}": ${err.message}`);
        await notifier.send({
          event: NOTIFICATION_EVENTS.WORKER_ERROR,
          worker: worker.charter?.name || workerId,
          title: 'Scheduled run failed — no API key',
          message: `Provider "${provider}" has no configured API key. Run "nooterra auth" to set one up.`,
          urgency: 'high',
        });
        return;
      }

      let result;
      try {
        result = await runWorkerExecution(worker, mcpManager, notificationBus, apiKey);
      } catch (err) {
        log(`[scheduler] Worker ${workerId} execution crashed: ${err.message}`);
        await notifier.send({
          event: NOTIFICATION_EVENTS.WORKER_ERROR,
          worker: worker.charter?.name || workerId,
          title: 'Scheduled run crashed',
          message: `Error: ${err.message}`,
          urgency: 'high',
        });
        // Record the failure
        try { recordWorkerRun(workerId, { success: false, duration: 0 }); } catch {}
        return;
      }

      // Record the run
      try {
        recordWorkerRun(workerId, {
          success: result.success,
          taskId: result.taskId,
          duration: result.duration,
        });
      } catch (err) {
        log(`[scheduler] Failed to record run for ${workerId}: ${err.message}`);
      }

      // Send notification with result summary
      const eventType = result.success
        ? NOTIFICATION_EVENTS.WORKER_COMPLETE
        : NOTIFICATION_EVENTS.WORKER_ERROR;
      const urgency = result.success ? 'low' : 'medium';
      const summary = result.response
        ? result.response.slice(0, 300) + (result.response.length > 300 ? '...' : '')
        : '(no response)';

      await notifier.send({
        event: eventType,
        worker: worker.charter?.name || workerId,
        title: result.success ? 'Scheduled run completed' : 'Scheduled run failed',
        message: `Duration: ${(result.duration / 1000).toFixed(1)}s | Task: ${result.taskId}\n${summary}`,
        urgency,
      });

      log(`[scheduler] Worker ${worker.charter?.name || workerId} finished — success=${result.success} duration=${result.duration}ms`);
    }

    // ── Create the scheduler with our executor ───────────────────────────

    const scheduler = createScheduler({
      executor: executeScheduledWorker,
      runMissed: true,
    });

    // ── Register a single worker's schedules ─────────────────────────────

    function registerWorkerSchedules(worker) {
      const schedules = getWorkerSchedules(worker);
      if (schedules.length === 0) return 0;

      let count = 0;
      for (const { trigger, cronExpr } of schedules) {
        try {
          const sch = scheduler.schedule(worker.id, cronExpr, trigger.id || 'default', {
            label: `${worker.charter?.name || worker.id} — ${cronExpr}`,
          });
          registeredSchedules.set(sch.id, worker.id);
          count++;
          log(`[scheduler] Registered schedule for "${worker.charter?.name || worker.id}": ${cronExpr} (schedule ${sch.id})`);
        } catch (err) {
          log(`[scheduler] Failed to register schedule for ${worker.id}: ${err.message}`);
        }
      }
      return count;
    }

    // ── Load all workers and register their schedules ────────────────────

    function syncWorkers() {
      const workers = listWorkers();
      let newCount = 0;

      for (const worker of workers) {
        if (knownWorkerIds.has(worker.id)) continue;

        knownWorkerIds.add(worker.id);
        const registered = registerWorkerSchedules(worker);
        if (registered > 0) newCount += registered;
      }

      onWorkerCountChange(knownWorkerIds.size);
      return newCount;
    }

    // ── Initial load ─────────────────────────────────────────────────────

    const initialSchedules = syncWorkers();
    log(`[scheduler] Initial sync: ${knownWorkerIds.size} workers, ${initialSchedules} schedules registered`);

    // Start the scheduler tick loop
    await scheduler.start();
    log('[scheduler] Scheduler started');

    // ── Poll for new workers every 60 seconds ────────────────────────────

    const workerPollTimer = setInterval(() => {
      try {
        const added = syncWorkers();
        if (added > 0) {
          log(`[scheduler] Detected new workers, registered ${added} new schedules (total workers: ${knownWorkerIds.size})`);
        }
      } catch (err) {
        log(`[scheduler] Worker poll error: ${err.message}`);
      }
    }, 60_000);

    // Keep alive forever — clean up on process exit
    await new Promise((_resolve, _reject) => {
      const cleanup = () => {
        clearInterval(workerPollTimer);
        scheduler.stop();
        log('[scheduler] Scheduler stopped');
      };
      process.once('beforeExit', cleanup);
    });
  });
}

// ---------------------------------------------------------------------------
// CLI Interface
// ---------------------------------------------------------------------------

function tailLog(lines = 50) {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const allLines = content.split('\n');
    const tail = allLines.slice(-lines).join('\n');
    console.log(tail);
  } catch {
    console.log('No log file found.');
  }
}

function printStatus() {
  const s = daemonStatus();
  if (!s.running) {
    console.log(`Daemon: stopped`);
    if (s.message) console.log(s.message);
    return;
  }

  console.log(`Daemon: running`);
  console.log(`  PID:            ${s.pid}`);
  console.log(`  Phase:          ${s.phase}`);
  console.log(`  Started:        ${s.startedAt}`);
  console.log(`  Last heartbeat: ${s.lastHeartbeat}`);
  console.log(`  Uptime:         ${Math.floor(s.uptime)}s`);
  console.log(`  Workers:        ${s.workers}`);
  if (s.nextScheduledRun) {
    console.log(`  Next run:       ${s.nextScheduledRun}`);
  }
  if (s.memoryUsage) {
    const mb = (s.memoryUsage.rss / 1024 / 1024).toFixed(1);
    console.log(`  Memory (RSS):   ${mb} MB`);
  }
}

async function cli() {
  const args = process.argv.slice(2);

  // If launched as daemon child, run the daemon loop
  if (args.includes('--daemon-child') || process.env.NOOTERRA_DAEMON === '1') {
    await runDaemonChild();
    return;
  }

  // CLI subcommand: could be "daemon start", "daemon stop", etc.
  // or just "start", "stop" if called via bin/nooterra wrapper
  const cmd = args.find(a => !a.startsWith('-')) || 'status';

  switch (cmd) {
    case 'start': {
      console.log('Starting daemon...');
      const result = startDaemon();
      if (result.method === 'already-running') {
        console.log(`Daemon already running (PID ${result.pid}).`);
      } else {
        console.log(`Daemon started (PID ${result.pid}, method: ${result.method}).`);
      }
      break;
    }

    case 'stop': {
      console.log('Stopping daemon...');
      stopDaemon();
      console.log('Daemon stopped.');
      break;
    }

    case 'restart': {
      console.log('Restarting daemon...');
      stopDaemon();
      // Brief pause to let the old process fully exit
      await new Promise(r => setTimeout(r, 1000));
      const result = startDaemon();
      console.log(`Daemon restarted (PID ${result.pid}, method: ${result.method}).`);
      break;
    }

    case 'status': {
      printStatus();
      break;
    }

    case 'logs': {
      const lineCount = parseInt(args.find(a => /^\d+$/.test(a)) || '50', 10);
      tailLog(lineCount);
      break;
    }

    case 'install': {
      console.log('Installing as system service...');
      const result = installService();
      if (result.installed) {
        console.log(`Installed via ${result.method}: ${result.path}`);
      } else {
        console.log(`Failed: ${result.error}`);
      }
      break;
    }

    case 'uninstall': {
      console.log('Removing system service...');
      stopDaemon();
      const result = uninstallService();
      if (result.uninstalled) {
        console.log(`Removed ${result.method} service.`);
      } else {
        console.log(`Failed: ${result.error}`);
      }
      break;
    }

    default:
      console.log(`Unknown command: ${cmd}`);
      console.log('');
      console.log('Usage: nooterra daemon <command>');
      console.log('');
      console.log('Commands:');
      console.log('  start     Start the daemon (backgrounds itself)');
      console.log('  stop      Stop the daemon');
      console.log('  status    Show daemon health');
      console.log('  restart   Stop then start');
      console.log('  logs      Tail the daemon log');
      console.log('  install   Install as system service (auto-start on login)');
      console.log('  uninstall Remove system service');
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { runWithAutoRestart, rotateLogs, log };

export default {
  startDaemon,
  stopDaemon,
  daemonStatus,
  installService,
  uninstallService,
  isRunning,
  daemonize
};

// ---------------------------------------------------------------------------
// Run CLI if executed directly
// ---------------------------------------------------------------------------

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectRun) {
  cli().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
