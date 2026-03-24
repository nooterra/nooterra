/**
 * Notification Bus
 * 
 * Send notifications to humans when workers need attention.
 * Supports multiple channels:
 * - Slack (webhooks and bot)
 * - Email (SMTP or services like Resend/SendGrid)
 * - SMS (Twilio)
 * - Discord (webhooks)
 * - Webhooks (custom)
 * - In-app (TUI/web dashboard)
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

/**
 * Notification channels
 */
export const CHANNELS = {
  SLACK: 'slack',
  EMAIL: 'email',
  SMS: 'sms',
  DISCORD: 'discord',
  WEBHOOK: 'webhook',
  APP: 'app'
};

/**
 * Notification event types
 */
export const EVENTS = {
  APPROVAL_NEEDED: 'approval_needed',
  TASK_COMPLETE: 'task_complete',
  TASK_FAILED: 'task_failed',
  ERROR: 'error',
  BUDGET_WARNING: 'budget_warning',
  BUDGET_EXCEEDED: 'budget_exceeded',
  WORKER_STARTED: 'worker_started',
  WORKER_STOPPED: 'worker_stopped',
  ESCALATION: 'escalation'
};

/**
 * Notification templates
 */
const TEMPLATES = {
  [EVENTS.APPROVAL_NEEDED]: {
    title: '⚡ Approval Needed',
    body: (data) => `Worker "${data.workerName}" needs approval to: ${data.action}`,
    urgent: true
  },
  [EVENTS.TASK_COMPLETE]: {
    title: '✅ Task Complete',
    body: (data) => `Worker "${data.workerName}" completed: ${data.task}`,
    urgent: false
  },
  [EVENTS.TASK_FAILED]: {
    title: '❌ Task Failed',
    body: (data) => `Worker "${data.workerName}" failed: ${data.error}`,
    urgent: true
  },
  [EVENTS.ERROR]: {
    title: '🚨 Error',
    body: (data) => `Worker "${data.workerName}" error: ${data.error}`,
    urgent: true
  },
  [EVENTS.BUDGET_WARNING]: {
    title: '💰 Budget Warning',
    body: (data) => `Worker "${data.workerName}" is at ${data.percent}% of budget ($${data.spent}/$${data.limit})`,
    urgent: false
  },
  [EVENTS.BUDGET_EXCEEDED]: {
    title: '🚫 Budget Exceeded',
    body: (data) => `Worker "${data.workerName}" exceeded budget. Paused.`,
    urgent: true
  },
  [EVENTS.WORKER_STARTED]: {
    title: '🚀 Worker Started',
    body: (data) => `Worker "${data.workerName}" is now running.`,
    urgent: false
  },
  [EVENTS.WORKER_STOPPED]: {
    title: '⏹️ Worker Stopped',
    body: (data) => `Worker "${data.workerName}" has stopped.`,
    urgent: false
  },
  [EVENTS.ESCALATION]: {
    title: '⬆️ Escalation',
    body: (data) => `Worker "${data.workerName}" escalated: ${data.reason}`,
    urgent: true
  }
};

/**
 * Slack channel adapter
 */
class SlackAdapter {
  constructor(config) {
    this.webhookUrl = config.webhookUrl;
    this.channel = config.channel;
    this.botToken = config.botToken;
  }

  async send(notification) {
    if (this.webhookUrl) {
      return this.sendWebhook(notification);
    } else if (this.botToken) {
      return this.sendBot(notification);
    }
    throw new Error('Slack not configured');
  }

  async sendWebhook(notification) {
    const payload = {
      text: notification.title,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: notification.title }
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: notification.body }
        }
      ]
    };

    if (notification.actions) {
      payload.blocks.push({
        type: 'actions',
        elements: notification.actions.map(action => ({
          type: 'button',
          text: { type: 'plain_text', text: action.label },
          url: action.url,
          style: action.primary ? 'primary' : undefined
        }))
      });
    }

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.status}`);
    }

    return { success: true, channel: CHANNELS.SLACK };
  }

  async sendBot(notification) {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.botToken}`
      },
      body: JSON.stringify({
        channel: this.channel,
        text: notification.body,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: notification.title }
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: notification.body }
          }
        ]
      })
    });

    const result = await response.json();
    if (!result.ok) {
      throw new Error(`Slack API failed: ${result.error}`);
    }

    return { success: true, channel: CHANNELS.SLACK, ts: result.ts };
  }
}

/**
 * Email adapter
 */
class EmailAdapter {
  constructor(config) {
    this.provider = config.provider || 'smtp';
    this.config = config;
  }

  async send(notification) {
    switch (this.provider) {
      case 'resend':
        return this.sendResend(notification);
      case 'sendgrid':
        return this.sendSendGrid(notification);
      default:
        return this.sendSmtp(notification);
    }
  }

  async sendResend(notification) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        from: this.config.from || 'Nooterra <notifications@nooterra.ai>',
        to: notification.to || this.config.to,
        subject: notification.title,
        html: `<h2>${notification.title}</h2><p>${notification.body}</p>`
      })
    });

    if (!response.ok) {
      throw new Error(`Resend failed: ${response.status}`);
    }

    return { success: true, channel: CHANNELS.EMAIL };
  }

  async sendSendGrid(notification) {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: notification.to || this.config.to }] }],
        from: { email: this.config.from || 'notifications@nooterra.ai' },
        subject: notification.title,
        content: [{ type: 'text/html', value: `<h2>${notification.title}</h2><p>${notification.body}</p>` }]
      })
    });

    if (!response.ok) {
      throw new Error(`SendGrid failed: ${response.status}`);
    }

    return { success: true, channel: CHANNELS.EMAIL };
  }

  async sendSmtp(notification) {
    // SMTP would require nodemailer - for now just log
    console.log(`[EMAIL] To: ${notification.to}, Subject: ${notification.title}`);
    return { success: true, channel: CHANNELS.EMAIL, mock: true };
  }
}

/**
 * SMS adapter (Twilio)
 */
class SmsAdapter {
  constructor(config) {
    this.accountSid = config.accountSid;
    this.authToken = config.authToken;
    this.from = config.from;
  }

  async send(notification) {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')
      },
      body: new URLSearchParams({
        To: notification.to,
        From: this.from,
        Body: `${notification.title}\n\n${notification.body}`
      })
    });

    if (!response.ok) {
      throw new Error(`Twilio failed: ${response.status}`);
    }

    return { success: true, channel: CHANNELS.SMS };
  }
}

/**
 * Discord adapter (webhooks)
 */
class DiscordAdapter {
  constructor(config) {
    this.webhookUrl = config.webhookUrl;
  }

  async send(notification) {
    const payload = {
      embeds: [{
        title: notification.title,
        description: notification.body,
        color: notification.urgent ? 0xff0000 : 0x00ff00
      }]
    };

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status}`);
    }

    return { success: true, channel: CHANNELS.DISCORD };
  }
}

/**
 * Generic webhook adapter
 */
class WebhookAdapter {
  constructor(config) {
    this.url = config.url;
    this.headers = config.headers || {};
    this.method = config.method || 'POST';
  }

  async send(notification) {
    const response = await fetch(this.url, {
      method: this.method,
      headers: {
        'Content-Type': 'application/json',
        ...this.headers
      },
      body: JSON.stringify({
        event: notification.event,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status}`);
    }

    return { success: true, channel: CHANNELS.WEBHOOK };
  }
}

/**
 * In-app adapter (stores for TUI/web to fetch)
 */
class AppAdapter {
  constructor(config) {
    this.dataDir = config.dataDir || path.join(process.env.HOME, '.nooterra', 'notifications');
    this.maxNotifications = config.maxNotifications || 100;
    this.notifications = [];
    this.loadNotifications();
  }

  loadNotifications() {
    const filePath = path.join(this.dataDir, 'notifications.json');
    try {
      if (fs.existsSync(filePath)) {
        this.notifications = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch {
      this.notifications = [];
    }
  }

  saveNotifications() {
    const filePath = path.join(this.dataDir, 'notifications.json');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(this.notifications, null, 2));
  }

  async send(notification) {
    const entry = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ...notification,
      read: false,
      createdAt: new Date().toISOString()
    };

    this.notifications.unshift(entry);
    
    // Trim old notifications
    if (this.notifications.length > this.maxNotifications) {
      this.notifications = this.notifications.slice(0, this.maxNotifications);
    }

    this.saveNotifications();

    return { success: true, channel: CHANNELS.APP, id: entry.id };
  }

  getUnread() {
    return this.notifications.filter(n => !n.read);
  }

  markRead(notificationId) {
    const notif = this.notifications.find(n => n.id === notificationId);
    if (notif) {
      notif.read = true;
      this.saveNotifications();
    }
  }

  markAllRead() {
    for (const notif of this.notifications) {
      notif.read = true;
    }
    this.saveNotifications();
  }

  getAll() {
    return this.notifications;
  }
}

/**
 * Notification Bus - main class
 */
export class NotificationBus extends EventEmitter {
  constructor(options = {}) {
    super();
    this.adapters = new Map();
    this.options = options;
    this.dataDir = options.dataDir || path.join(process.env.HOME, '.nooterra', 'notifications');
    
    // Always have app adapter
    this.adapters.set(CHANNELS.APP, new AppAdapter({ dataDir: this.dataDir }));
  }

  /**
   * Configure a notification channel
   */
  configureChannel(channel, config) {
    switch (channel) {
      case CHANNELS.SLACK:
        this.adapters.set(channel, new SlackAdapter(config));
        break;
      case CHANNELS.EMAIL:
        this.adapters.set(channel, new EmailAdapter(config));
        break;
      case CHANNELS.SMS:
        this.adapters.set(channel, new SmsAdapter(config));
        break;
      case CHANNELS.DISCORD:
        this.adapters.set(channel, new DiscordAdapter(config));
        break;
      case CHANNELS.WEBHOOK:
        this.adapters.set(channel, new WebhookAdapter(config));
        break;
    }
  }

  /**
   * Send a notification
   */
  async notify(event, data, options = {}) {
    const template = TEMPLATES[event];
    if (!template) {
      console.warn(`Unknown notification event: ${event}`);
      return { success: false, error: 'Unknown event' };
    }

    const notification = {
      event,
      title: options.title || template.title,
      body: template.body(data),
      urgent: template.urgent,
      data,
      ...options
    };

    const channels = options.channels || [CHANNELS.APP];
    const results = [];

    for (const channel of channels) {
      const adapter = this.adapters.get(channel);
      if (!adapter) {
        results.push({ channel, success: false, error: 'Channel not configured' });
        continue;
      }

      try {
        const result = await adapter.send(notification);
        results.push(result);
        this.emit('sent', { channel, notification, result });
      } catch (err) {
        results.push({ channel, success: false, error: err.message });
        this.emit('error', { channel, notification, error: err });
      }
    }

    return { results, notification };
  }

  /**
   * Get unread app notifications
   */
  getUnreadNotifications() {
    const appAdapter = this.adapters.get(CHANNELS.APP);
    return appAdapter ? appAdapter.getUnread() : [];
  }

  /**
   * Get all app notifications
   */
  getAllNotifications() {
    const appAdapter = this.adapters.get(CHANNELS.APP);
    return appAdapter ? appAdapter.getAll() : [];
  }

  /**
   * Mark notification as read
   */
  markRead(notificationId) {
    const appAdapter = this.adapters.get(CHANNELS.APP);
    if (appAdapter) {
      appAdapter.markRead(notificationId);
    }
  }

  /**
   * Mark all notifications as read
   */
  markAllRead() {
    const appAdapter = this.adapters.get(CHANNELS.APP);
    if (appAdapter) {
      appAdapter.markAllRead();
    }
  }

  /**
   * Get configured channels
   */
  getConfiguredChannels() {
    return Array.from(this.adapters.keys());
  }
}

// Singleton instance
let busInstance = null;

/**
 * Get or create the notification bus instance
 */
export function getNotificationBus(options) {
  if (!busInstance) {
    busInstance = new NotificationBus(options);
  }
  return busInstance;
}

export default {
  NotificationBus,
  getNotificationBus,
  CHANNELS,
  EVENTS
};
