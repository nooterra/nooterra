/**
 * Notification Delivery
 *
 * Real multi-channel notification delivery. When a worker finds something
 * important, the user actually gets notified — terminal, Slack, email,
 * desktop, webhook.
 *
 * No external dependencies. Node.js built-ins only.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { execSync } from 'child_process';

const HOME = os.homedir();
const NOOTERRA_DIR = path.join(HOME, '.nooterra');
const CREDENTIALS_DIR = path.join(NOOTERRA_DIR, 'credentials');
const NOTIFICATIONS_DIR = path.join(NOOTERRA_DIR, 'notifications');
const CONFIG_PATH = path.join(NOOTERRA_DIR, 'config.json');

// ---------------------------------------------------------------------------
// Notification events
// ---------------------------------------------------------------------------

export const NOTIFICATION_EVENTS = {
  WORKER_COMPLETE:    'worker:complete',
  WORKER_ERROR:       'worker:error',
  WORKER_APPROVAL:    'worker:approval_needed',
  WORKER_ALERT:       'worker:alert',
  DAEMON_STARTED:     'daemon:started',
  DAEMON_STOPPED:     'daemon:stopped',
  DAEMON_ERROR:       'daemon:error',
};

const URGENCY_COLORS = {
  high:   '\x1b[1;31m',   // bold red
  medium: '\x1b[1;33m',   // bold yellow
  low:    '\x1b[0;36m',   // cyan
};
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readFileQuiet(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8').trim();
  } catch { /* ignore */ }
  return null;
}

function loadConfig() {
  const raw = readFileQuiet(CONFIG_PATH);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function generateId() {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Channel: Terminal
// ---------------------------------------------------------------------------

async function deliverTerminal(notification) {
  const { event, worker, title, message, urgency = 'medium', timestamp } = notification;
  const color = URGENCY_COLORS[urgency] || URGENCY_COLORS.medium;
  const ts = new Date(timestamp).toLocaleTimeString();

  const prefix = urgency === 'high' ? '[!!!]' : urgency === 'medium' ? '[!]' : '[i]';

  process.stderr.write(
    `${color}${prefix}${RESET} ${BOLD}${worker}${RESET} ${DIM}${ts}${RESET}\n` +
    `  ${title}\n` +
    `  ${DIM}${message}${RESET}\n\n`
  );

  // Persist to disk
  ensureDir(NOTIFICATIONS_DIR);
  const entry = {
    id: generateId(),
    event,
    worker,
    title,
    message,
    urgency,
    timestamp,
    read: false,
  };

  const logFile = path.join(NOTIFICATIONS_DIR, 'notifications.json');
  let existing = [];
  try {
    const raw = readFileQuiet(logFile);
    if (raw) existing = JSON.parse(raw);
  } catch { /* ignore corrupt file */ }

  existing.unshift(entry);
  if (existing.length > 500) existing = existing.slice(0, 500);
  fs.writeFileSync(logFile, JSON.stringify(existing, null, 2));

  return { channel: 'terminal', success: true, id: entry.id };
}

// ---------------------------------------------------------------------------
// Channel: Slack
// ---------------------------------------------------------------------------

async function deliverSlack(notification, config) {
  const token = readFileQuiet(path.join(CREDENTIALS_DIR, 'slack-token.txt'));
  if (!token) return { channel: 'slack', success: false, skipped: true, reason: 'no token' };

  const channel = config.slackChannel || '#alerts';
  const { worker, title, message, urgency = 'medium', timestamp } = notification;

  const urgencyEmoji = urgency === 'high' ? ':rotating_light:' : urgency === 'medium' ? ':warning:' : ':information_source:';
  const ts = new Date(timestamp).toISOString();

  const payload = {
    channel,
    text: `${urgencyEmoji} *${worker}*: ${title}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${urgencyEmoji} *${worker}*\n*${title}*\n${message}\n_${ts}_`
        }
      }
    ]
  };

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  if (!result.ok) {
    return { channel: 'slack', success: false, error: result.error };
  }

  return { channel: 'slack', success: true, ts: result.ts };
}

// ---------------------------------------------------------------------------
// Channel: Email (raw SMTP, same approach as built-in-tools send_email)
// ---------------------------------------------------------------------------

async function deliverEmail(notification, config) {
  const configRaw = readFileQuiet(path.join(CREDENTIALS_DIR, 'email-config.json'));
  if (!configRaw) return { channel: 'email', success: false, skipped: true, reason: 'no config' };

  let emailConfig;
  try { emailConfig = JSON.parse(configRaw); } catch {
    return { channel: 'email', success: false, error: 'invalid email-config.json' };
  }

  const to = config.emailTo || emailConfig.to;
  if (!to) return { channel: 'email', success: false, skipped: true, reason: 'no recipient' };

  const from = emailConfig.from || emailConfig.user;
  const host = emailConfig.host;
  const port = emailConfig.port || 587;
  const user = emailConfig.user;
  const pass = emailConfig.pass;

  if (!host || !user || !pass) {
    return { channel: 'email', success: false, error: 'email-config.json missing host/user/pass' };
  }

  const { worker, title, message, timestamp } = notification;
  const subject = `[Nooterra] ${worker}: ${title}`;
  const body = `${message}\n\nWorker: ${worker}\nTime: ${new Date(timestamp).toISOString()}\nEvent: ${notification.event}`;

  return new Promise((resolve) => {
    let tls;
    try { tls = require('tls'); } catch {
      resolve({ channel: 'email', success: false, error: 'tls module unavailable' });
      return;
    }

    let socket;
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => {
      if (socket) socket.destroy();
      resolve({ channel: 'email', success: false, error: 'SMTP timeout (30s)' });
    }, 30_000);

    const commands = [
      null, // wait for greeting
      `EHLO nooterra.local\r\n`,
      `STARTTLS\r\n`,
      null, // TLS upgrade
      `EHLO nooterra.local\r\n`,
      `AUTH LOGIN\r\n`,
      Buffer.from(user).toString('base64') + '\r\n',
      Buffer.from(pass).toString('base64') + '\r\n',
      `MAIL FROM:<${from}>\r\n`,
      `RCPT TO:<${to}>\r\n`,
      'DATA\r\n',
      `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\nDate: ${new Date().toUTCString()}\r\n\r\n${body}\r\n.\r\n`,
      'QUIT\r\n'
    ];

    function advance(data) {
      buffer += data.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line) continue;
        const code = parseInt(line.slice(0, 3), 10);

        // Multi-line responses
        if (line[3] === '-') continue;

        if (code >= 400) {
          clearTimeout(timer);
          if (socket) socket.destroy();
          resolve({ channel: 'email', success: false, error: `SMTP error: ${line}` });
          return;
        }

        step++;
        if (step === 3) {
          // STARTTLS accepted, upgrade
          const tlsSocket = tls.connect({ socket, servername: host }, () => {
            socket = tlsSocket;
            socket.on('data', advance);
            step++;
            socket.write(commands[step]);
          });
          tlsSocket.on('error', (err) => {
            clearTimeout(timer);
            resolve({ channel: 'email', success: false, error: `TLS error: ${err.message}` });
          });
          return;
        }

        if (step < commands.length && commands[step]) {
          socket.write(commands[step]);
        }

        if (step >= commands.length) {
          clearTimeout(timer);
          if (socket) socket.destroy();
          resolve({ channel: 'email', success: true, to, subject });
          return;
        }
      }
    }

    socket = net.createConnection({ host, port }, () => {
      socket.on('data', advance);
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      resolve({ channel: 'email', success: false, error: `SMTP error: ${err.message}` });
    });
  });
}

// ---------------------------------------------------------------------------
// Channel: Desktop (macOS osascript)
// ---------------------------------------------------------------------------

async function deliverDesktop(notification) {
  if (process.platform !== 'darwin') {
    return { channel: 'desktop', success: false, skipped: true, reason: 'not macOS' };
  }

  const { worker, title, message } = notification;

  // Escape for AppleScript string (backslash and double-quote)
  const escape = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const displayTitle = escape(`Nooterra: ${worker}`);
  const displayMsg = escape(`${title}\n${message}`.slice(0, 200));

  try {
    execSync(
      `osascript -e 'display notification "${displayMsg}" with title "${displayTitle}"'`,
      { timeout: 5_000, stdio: 'pipe' }
    );
    return { channel: 'desktop', success: true };
  } catch (err) {
    return { channel: 'desktop', success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Channel: Webhook
// ---------------------------------------------------------------------------

async function deliverWebhook(notification, config) {
  const url = config.webhookUrl;
  if (!url) return { channel: 'webhook', success: false, skipped: true, reason: 'no webhookUrl' };

  const { worker, event, title, message, timestamp } = notification;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker, event, title, message, timestamp })
    });

    if (!response.ok) {
      return { channel: 'webhook', success: false, error: `HTTP ${response.status}` };
    }

    return { channel: 'webhook', success: true, status: response.status };
  } catch (err) {
    return { channel: 'webhook', success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Channel dispatch map
// ---------------------------------------------------------------------------

const CHANNEL_HANDLERS = {
  terminal: deliverTerminal,
  slack:    deliverSlack,
  email:    deliverEmail,
  desktop:  deliverDesktop,
  webhook:  deliverWebhook,
};

// ---------------------------------------------------------------------------
// Notifier
// ---------------------------------------------------------------------------

/**
 * Create a notifier instance.
 *
 * @param {Object} [configOverride] - Override for ~/.nooterra/config.json notifications block
 * @returns {{ send, getHistory, test }}
 */
export function createNotifier(configOverride) {
  const fileConfig = loadConfig();
  const notifConfig = {
    channels: ['terminal', 'desktop'],
    ...fileConfig.notifications,
    ...configOverride,
  };

  const activeChannels = notifConfig.channels || ['terminal', 'desktop'];

  /**
   * Send a notification across all configured channels.
   */
  async function send({ event, worker, title, message, urgency = 'medium' }) {
    const timestamp = new Date().toISOString();
    const notification = { event, worker, title, message, urgency, timestamp };

    const results = [];
    const promises = activeChannels.map(async (ch) => {
      const handler = CHANNEL_HANDLERS[ch];
      if (!handler) {
        results.push({ channel: ch, success: false, error: 'unknown channel' });
        return;
      }
      try {
        const result = await handler(notification, notifConfig);
        results.push(result);
      } catch (err) {
        results.push({ channel: ch, success: false, error: err.message });
      }
    });

    await Promise.allSettled(promises);
    return { notification, results };
  }

  /**
   * Get notification history from disk.
   */
  function getHistory(limit = 50) {
    const logFile = path.join(NOTIFICATIONS_DIR, 'notifications.json');
    const raw = readFileQuiet(logFile);
    if (!raw) return [];
    try {
      const all = JSON.parse(raw);
      return all.slice(0, limit);
    } catch {
      return [];
    }
  }

  /**
   * Send a test notification to all configured channels.
   */
  async function test() {
    return send({
      event: 'worker:alert',
      worker: 'System Test',
      title: 'Notification test',
      message: `Test notification sent at ${new Date().toLocaleTimeString()}. Channels: ${activeChannels.join(', ')}`,
      urgency: 'low',
    });
  }

  return { send, getHistory, test };
}

export default { createNotifier, NOTIFICATION_EVENTS };
