/**
 * Notification Delivery System
 *
 * Sends rich Slack messages using Block Kit when worker events occur.
 * Fetches tenant notification preferences from Postgres and delivers
 * notifications for enabled channels and event types.
 */

const DASHBOARD_BASE_URL = process.env.DASHBOARD_URL || 'https://nooterra.ai';

// ---------------------------------------------------------------------------
// Slack Block Kit Message Builders
// ---------------------------------------------------------------------------

function buildSlackBlocks({ event, worker, execution }) {
  switch (event) {
    case 'approval.required':
      return buildApprovalBlocks(worker, execution);
    case 'execution.completed':
      return buildCompletionBlocks(worker, execution);
    case 'execution.failed':
      return buildFailureBlocks(worker, execution);
    case 'budget.low':
      return buildBudgetBlocks(worker, execution);
    default:
      return buildGenericBlocks(event, worker, execution);
  }
}

function buildApprovalBlocks(worker, execution) {
  const action = execution?.action || 'perform an action';
  const approveUrl = `${DASHBOARD_BASE_URL}/dashboard?view=approvals&action=approve&id=${execution?.requestId || ''}`;
  const denyUrl = `${DASHBOARD_BASE_URL}/dashboard?view=approvals&action=deny&id=${execution?.requestId || ''}`;

  return {
    text: `${worker.name} needs your approval`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Approval Required', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${worker.name}* needs your approval to ${action}`,
        },
      },
      ...(execution?.details ? [{
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Details:*\n${execution.details}` },
        ],
      }] : []),
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve' },
            style: 'primary',
            url: approveUrl,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Deny' },
            style: 'danger',
            url: denyUrl,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Worker: ${worker.name} | ${new Date().toISOString()}` },
        ],
      },
    ],
  };
}

function buildCompletionBlocks(worker, execution) {
  const summary = execution?.summary || 'Execution completed successfully.';
  const cost = execution?.costUsd != null ? `$${execution.costUsd.toFixed(3)}` : 'N/A';
  const duration = execution?.durationMs != null ? `${(execution.durationMs / 1000).toFixed(1)}s` : 'N/A';

  return {
    text: `${worker.name} completed`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Worker Completed', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${worker.name}* completed successfully.\n${summary}`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Cost:*\n${cost}` },
          { type: 'mrkdwn', text: `*Duration:*\n${duration}` },
        ],
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Worker: ${worker.name} | ${new Date().toISOString()}` },
        ],
      },
    ],
  };
}

function buildFailureBlocks(worker, execution) {
  const errorMsg = execution?.error || 'Unknown error';
  const detailUrl = `${DASHBOARD_BASE_URL}/dashboard?view=workerDetail&id=${worker.id || ''}`;

  return {
    text: `${worker.name} failed`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Worker Error', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${worker.name}* failed: ${errorMsg}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View Details' },
            url: detailUrl,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Worker: ${worker.name} | ${new Date().toISOString()}` },
        ],
      },
    ],
  };
}

function buildBudgetBlocks(worker, execution) {
  const balance = execution?.balance != null ? `$${execution.balance.toFixed(2)}` : 'low';
  const topUpUrl = `${DASHBOARD_BASE_URL}/dashboard?view=settings&tab=usage`;

  return {
    text: `Credits running low (${balance})`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Budget Alert', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Credits below ${balance}. Top up to keep workers running.`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Top Up Credits' },
            style: 'primary',
            url: topUpUrl,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Balance: ${balance} | ${new Date().toISOString()}` },
        ],
      },
    ],
  };
}

function buildGenericBlocks(event, worker, execution) {
  return {
    text: `${worker.name}: ${event}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${worker.name}*: ${event}\n${execution?.summary || ''}`,
        },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: new Date().toISOString() },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Slack Delivery
// ---------------------------------------------------------------------------

/**
 * Send a rich Slack notification via webhook.
 */
async function sendSlackNotification({ webhookUrl, event, worker, execution }) {
  if (!webhookUrl) return { ok: false, error: 'No webhook URL' };

  const payload = buildSlackBlocks({ event, worker, execution });

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: `Slack returned ${response.status}: ${text}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Send a test Slack notification to verify webhook configuration.
 */
async function sendSlackTestNotification(webhookUrl) {
  return sendSlackNotification({
    webhookUrl,
    event: 'test',
    worker: { name: 'Nooterra Test', id: 'test' },
    execution: { summary: 'This is a test notification. Your Slack integration is working.' },
  });
}

// ---------------------------------------------------------------------------
// Email Delivery (stub)
// ---------------------------------------------------------------------------

async function sendEmailNotification({ email, event, worker, execution }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Nooterra <workers@nooterra.ai>';
  if (!apiKey || !email) {
    return { ok: false, error: 'Resend not configured or no email address' };
  }

  const subjects = {
    'approval.required': `🔔 ${worker.name} needs your approval`,
    'execution.completed': `✅ ${worker.name} completed`,
    'execution.failed': `❌ ${worker.name} failed`,
    'budget.low': `⚠️ Credits running low`,
  };

  const bodies = {
    'approval.required': `<h2>${worker.name} needs approval</h2><p>Action: <strong>${execution?.action || 'perform an action'}</strong></p><p>${execution?.details || ''}</p><p><a href="${DASHBOARD_BASE_URL}/dashboard" style="background:#5b8def;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:8px">Review in Dashboard</a></p>`,
    'execution.completed': `<h2>${worker.name} completed</h2><p>Cost: $${(execution?.costUsd || 0).toFixed(4)}</p><p>${execution?.result ? '<pre>' + String(execution.result).slice(0, 500) + '</pre>' : ''}</p>`,
    'execution.failed': `<h2>${worker.name} failed</h2><p>Error: <strong>${execution?.error || 'Unknown'}</strong></p><p><a href="${DASHBOARD_BASE_URL}/dashboard">View details</a></p>`,
    'budget.low': `<h2>Credits running low</h2><p>Current balance: <strong>$${(execution?.balance || 0).toFixed(2)}</strong></p><p><a href="${DASHBOARD_BASE_URL}/dashboard" style="background:#5b8def;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:8px">Top Up</a></p>`,
  };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: [email],
        subject: subjects[event] || `Nooterra: ${event}`,
        html: bodies[event] || `<p>Event: ${event}</p><p>Worker: ${worker.name}</p>`,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return { ok: false, error: `Resend ${res.status}: ${errBody.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Email send failed: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// SMS Delivery (Twilio)
// ---------------------------------------------------------------------------

async function sendSmsNotification({ phoneNumber, event, worker, execution }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber || !phoneNumber) {
    return { ok: false, error: 'Twilio not configured or no phone number' };
  }

  const messages = {
    'approval.required': `[Nooterra] ${worker.name} needs your approval to ${execution?.action || 'perform an action'}. Open your inbox: ${DASHBOARD_BASE_URL}/dashboard`,
    'execution.completed': `[Nooterra] ${worker.name} completed. Cost: $${(execution?.costUsd || 0).toFixed(3)}`,
    'execution.failed': `[Nooterra] ${worker.name} failed: ${execution?.error || 'Unknown error'}`,
    'budget.low': `[Nooterra] Credits running low ($${(execution?.balance || 0).toFixed(2)}). Top up at ${DASHBOARD_BASE_URL}/dashboard`,
  };
  const body = messages[event] || `[Nooterra] ${worker.name}: ${event}`;

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: phoneNumber, From: fromNumber, Body: body }).toString(),
    });
    if (!response.ok) return { ok: false, error: `Twilio returned ${response.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// WhatsApp Delivery (Twilio)
// ---------------------------------------------------------------------------

async function sendWhatsAppNotification({ phoneNumber, event, worker, execution }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
  if (!accountSid || !authToken || !phoneNumber) {
    return { ok: false, error: 'Twilio WhatsApp not configured or no phone number' };
  }

  const messages = {
    'approval.required': `*Approval Required*\n${worker.name} needs your approval to ${execution?.action || 'perform an action'}.\n\nOpen inbox: ${DASHBOARD_BASE_URL}/dashboard`,
    'execution.completed': `*Worker Completed*\n${worker.name} finished. Cost: $${(execution?.costUsd || 0).toFixed(3)}`,
    'execution.failed': `*Worker Error*\n${worker.name} failed: ${execution?.error || 'Unknown error'}`,
    'budget.low': `*Budget Alert*\nCredits at $${(execution?.balance || 0).toFixed(2)}. Top up: ${DASHBOARD_BASE_URL}/dashboard`,
  };
  const body = messages[event] || `*${worker.name}*: ${event}`;

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: `whatsapp:${phoneNumber}`, From: fromNumber, Body: body }).toString(),
    });
    if (!response.ok) return { ok: false, error: `Twilio WhatsApp returned ${response.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Telegram Delivery
// ---------------------------------------------------------------------------

async function sendTelegramNotification({ chatId, event, worker, execution }) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !chatId) {
    return { ok: false, error: 'Telegram not configured or no chat ID' };
  }

  const messages = {
    'approval.required': `<b>Approval Required</b>\n${worker.name} needs your approval to ${execution?.action || 'perform an action'}.\n\n<a href="${DASHBOARD_BASE_URL}/dashboard">Open Inbox</a>`,
    'execution.completed': `<b>Worker Completed</b>\n${worker.name} finished. Cost: $${(execution?.costUsd || 0).toFixed(3)}`,
    'execution.failed': `<b>Worker Error</b>\n${worker.name} failed: ${execution?.error || 'Unknown error'}`,
    'budget.low': `<b>Budget Alert</b>\nCredits at $${(execution?.balance || 0).toFixed(2)}. <a href="${DASHBOARD_BASE_URL}/dashboard">Top Up</a>`,
  };
  const text = messages[event] || `<b>${worker.name}</b>: ${event}`;

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!response.ok) return { ok: false, error: `Telegram returned ${response.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Preference Loading
// ---------------------------------------------------------------------------

/**
 * Load notification preferences for a tenant from Postgres.
 */
async function getNotificationPreferences(pool, tenantId) {
  try {
    const result = await pool.query(
      'SELECT preferences FROM notification_preferences WHERE tenant_id = $1',
      [tenantId]
    );
    if (result.rows.length === 0) return null;
    const prefs = result.rows[0].preferences;
    return typeof prefs === 'string' ? JSON.parse(prefs) : prefs;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Event-to-Preference Mapping
// ---------------------------------------------------------------------------

const EVENT_TO_PREF_KEY = {
  'approval.required': 'approvalRequired',
  'execution.completed': 'workerCompleted',
  'execution.failed': 'workerError',
  'budget.low': 'budgetAlert',
  'security.alert': 'securityAlert',
};

/**
 * Check if a tenant has enabled notifications for a given event type.
 */
function isEventEnabled(prefs, event) {
  if (!prefs || !prefs.events) return false;
  const key = EVENT_TO_PREF_KEY[event];
  if (!key) return false;
  return prefs.events[key] === true;
}

// ---------------------------------------------------------------------------
// Main Dispatch Function
// ---------------------------------------------------------------------------

/**
 * Deliver notifications for a worker event based on tenant preferences.
 *
 * @param {object} params
 * @param {object} params.pool - Postgres pool
 * @param {string} params.tenantId - Tenant ID
 * @param {string} params.event - Event type (e.g. 'execution.completed')
 * @param {object} params.worker - Worker info { id, name }
 * @param {object} params.execution - Execution data (varies by event type)
 * @param {function} [params.log] - Logging function
 */
async function deliverNotification({ pool, tenantId, event, worker, execution, log }) {
  const logFn = log || console.log;
  try {
    const prefs = await getNotificationPreferences(pool, tenantId);
    if (!prefs) return;
    if (!isEventEnabled(prefs, event)) return;

    const results = [];

    // Slack
    if (prefs.channels?.slack && prefs.slackWebhookUrl) {
      results.push(sendSlackNotification({ webhookUrl: prefs.slackWebhookUrl, event, worker, execution }));
    }

    // Email
    if (prefs.channels?.email && prefs.email) {
      results.push(sendEmailNotification({ email: prefs.email, event, worker, execution }));
    }

    // SMS
    if (prefs.channels?.sms && prefs.smsPhone) {
      results.push(sendSmsNotification({ phoneNumber: prefs.smsPhone, event, worker, execution }));
    }

    // WhatsApp
    if (prefs.channels?.whatsapp && prefs.whatsappPhone) {
      results.push(sendWhatsAppNotification({ phoneNumber: prefs.whatsappPhone, event, worker, execution }));
    }

    // Telegram
    if (prefs.channels?.telegram && prefs.telegramChatId) {
      results.push(sendTelegramNotification({ chatId: prefs.telegramChatId, event, worker, execution }));
    }

    const settled = await Promise.allSettled(results);
    for (const r of settled) {
      if (r.status === 'rejected' || (r.value && !r.value.ok)) {
        logFn('warn', `[notifications] delivery failed: ${r.reason || r.value?.error}`);
      }
    }
  } catch (err) {
    logFn('warn', `[notifications] error: ${err.message}`);
  }
}

export {
  sendSlackNotification,
  sendSlackTestNotification,
  sendEmailNotification,
  sendSmsNotification,
  sendWhatsAppNotification,
  sendTelegramNotification,
  getNotificationPreferences,
  deliverNotification,
  buildSlackBlocks,
};
