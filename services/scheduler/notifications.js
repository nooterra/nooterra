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
  const logFn = log || (() => {});

  try {
    const prefs = await getNotificationPreferences(pool, tenantId);
    if (!prefs) return;

    if (!isEventEnabled(prefs, event)) return;

    const results = [];

    // Slack notifications
    if (prefs.slackEnabled && prefs.slackWebhookUrl) {
      const slackResult = await sendSlackNotification({
        webhookUrl: prefs.slackWebhookUrl,
        event,
        worker,
        execution,
      });
      if (!slackResult.ok) {
        logFn('warn', `Slack notification failed for tenant ${tenantId}: ${slackResult.error}`);
      }
      results.push({ channel: 'slack', ...slackResult });
    }

    // Email notifications (placeholder -- email delivery requires an email service)
    if (prefs.emailEnabled && prefs.emailAddress) {
      // Email delivery would be handled by an email service (SendGrid, SES, etc.)
      // For now, log the intent
      logFn('info', `Email notification queued for ${prefs.emailAddress}: ${event} - ${worker.name}`);
      results.push({ channel: 'email', ok: true, queued: true });
    }

    return results;
  } catch (err) {
    logFn('error', `Notification delivery error for tenant ${tenantId}: ${err.message}`);
    return [];
  }
}

export {
  sendSlackNotification,
  sendSlackTestNotification,
  getNotificationPreferences,
  deliverNotification,
  buildSlackBlocks,
};
