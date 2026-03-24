/**
 * Trigger Engine
 * 
 * Makes workers run forever by handling:
 * - Schedules (cron, intervals)
 * - Webhooks (incoming HTTP)
 * - File watchers (directory changes)
 * - Email polling (inbox monitoring)
 * - Event triggers (cross-worker, system events)
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

/**
 * Trigger types
 */
export const TRIGGER_TYPES = {
  SCHEDULE: 'schedule',       // Cron or interval
  WEBHOOK: 'webhook',         // Incoming HTTP request
  FILE_WATCH: 'file_watch',   // File system changes
  EMAIL_POLL: 'email_poll',   // New emails
  EVENT: 'event',             // System/worker events
  MANUAL: 'manual'            // On-demand
};

/**
 * Parse cron expression to next run time
 * Simplified cron: minute hour day month weekday
 */
function parseCron(cronExpr) {
  const parts = cronExpr.split(' ');
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${cronExpr}`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  
  return {
    minute: minute === '*' ? null : parseInt(minute),
    hour: hour === '*' ? null : parseInt(hour),
    dayOfMonth: dayOfMonth === '*' ? null : parseInt(dayOfMonth),
    month: month === '*' ? null : parseInt(month),
    dayOfWeek: dayOfWeek === '*' ? null : parseInt(dayOfWeek)
  };
}

/**
 * Calculate next run time for a cron schedule
 */
function getNextCronRun(cronParsed, fromDate = new Date()) {
  const next = new Date(fromDate);
  next.setSeconds(0);
  next.setMilliseconds(0);

  // Simple implementation - find next matching time
  for (let i = 0; i < 366 * 24 * 60; i++) { // Max 1 year ahead
    next.setMinutes(next.getMinutes() + 1);

    const matches =
      (cronParsed.minute === null || next.getMinutes() === cronParsed.minute) &&
      (cronParsed.hour === null || next.getHours() === cronParsed.hour) &&
      (cronParsed.dayOfMonth === null || next.getDate() === cronParsed.dayOfMonth) &&
      (cronParsed.month === null || next.getMonth() + 1 === cronParsed.month) &&
      (cronParsed.dayOfWeek === null || next.getDay() === cronParsed.dayOfWeek);

    if (matches) {
      return next;
    }
  }

  throw new Error('Could not calculate next cron run');
}

/**
 * Parse interval string (e.g., "5m", "1h", "30s")
 */
function parseInterval(intervalStr) {
  const match = intervalStr.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid interval: ${intervalStr}`);
  }

  const value = parseInt(match[1]);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return value * multipliers[unit];
}

/**
 * Trigger class - represents a single trigger
 */
class Trigger {
  constructor(config) {
    this.id = config.id || `trg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.type = config.type;
    this.workerId = config.workerId;
    this.config = config.config || {};
    this.enabled = config.enabled !== false;
    this.lastRun = null;
    this.nextRun = null;
    this.runCount = 0;
    this.errorCount = 0;
    this.createdAt = new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      workerId: this.workerId,
      config: this.config,
      enabled: this.enabled,
      lastRun: this.lastRun,
      nextRun: this.nextRun,
      runCount: this.runCount,
      errorCount: this.errorCount,
      createdAt: this.createdAt
    };
  }
}

/**
 * Trigger Engine - manages all triggers
 */
export class TriggerEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.triggers = new Map();
    this.timers = new Map();
    this.watchers = new Map();
    this.pollers = new Map();
    this.webhookServer = null;
    this.options = {
      webhookPort: options.webhookPort || 3847,
      dataDir: options.dataDir || path.join(process.env.HOME, '.nooterra', 'triggers'),
      ...options
    };
    this.running = false;
  }

  /**
   * Start the trigger engine
   */
  async start() {
    if (this.running) return;
    this.running = true;

    // Ensure data directory exists
    if (!fs.existsSync(this.options.dataDir)) {
      fs.mkdirSync(this.options.dataDir, { recursive: true });
    }

    // Load persisted triggers
    await this.loadTriggers();

    // Start webhook server
    await this.startWebhookServer();

    // Initialize all triggers
    for (const trigger of this.triggers.values()) {
      if (trigger.enabled) {
        await this.activateTrigger(trigger);
      }
    }

    this.emit('started');
    console.log(`⏰ Trigger engine started with ${this.triggers.size} triggers`);
  }

  /**
   * Stop the trigger engine
   */
  async stop() {
    if (!this.running) return;
    this.running = false;

    // Stop all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer.timeout);
      clearInterval(timer.interval);
    }
    this.timers.clear();

    // Stop all file watchers
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();

    // Stop all pollers
    for (const poller of this.pollers.values()) {
      clearInterval(poller);
    }
    this.pollers.clear();

    // Stop webhook server
    if (this.webhookServer) {
      this.webhookServer.close();
      this.webhookServer = null;
    }

    // Persist triggers
    await this.saveTriggers();

    this.emit('stopped');
    console.log('⏰ Trigger engine stopped');
  }

  /**
   * Create a new trigger
   */
  async createTrigger(config) {
    const trigger = new Trigger(config);
    this.triggers.set(trigger.id, trigger);

    if (this.running && trigger.enabled) {
      await this.activateTrigger(trigger);
    }

    await this.saveTriggers();
    this.emit('trigger:created', trigger);
    return trigger;
  }

  async addTrigger(config) {
    const trigger = await this.createTrigger(config);
    return trigger.id;
  }

  /**
   * Delete a trigger
   */
  async deleteTrigger(triggerId) {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) return false;

    await this.deactivateTrigger(trigger);
    this.triggers.delete(triggerId);
    await this.saveTriggers();
    this.emit('trigger:deleted', trigger);
    return true;
  }

  /**
   * Enable a trigger
   */
  async enableTrigger(triggerId) {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) return false;

    trigger.enabled = true;
    if (this.running) {
      await this.activateTrigger(trigger);
    }
    await this.saveTriggers();
    return true;
  }

  /**
   * Disable a trigger
   */
  async disableTrigger(triggerId) {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) return false;

    trigger.enabled = false;
    await this.deactivateTrigger(trigger);
    await this.saveTriggers();
    return true;
  }

  /**
   * Activate a trigger (start watching/polling/scheduling)
   */
  async activateTrigger(trigger) {
    switch (trigger.type) {
      case TRIGGER_TYPES.SCHEDULE:
        await this.activateScheduleTrigger(trigger);
        break;
      case TRIGGER_TYPES.FILE_WATCH:
        await this.activateFileWatchTrigger(trigger);
        break;
      case TRIGGER_TYPES.EMAIL_POLL:
        await this.activateEmailPollTrigger(trigger);
        break;
      case TRIGGER_TYPES.WEBHOOK:
        // Webhooks are handled by the webhook server
        break;
    }
  }

  /**
   * Deactivate a trigger
   */
  async deactivateTrigger(trigger) {
    // Stop timer if exists
    if (this.timers.has(trigger.id)) {
      const timer = this.timers.get(trigger.id);
      clearTimeout(timer.timeout);
      clearInterval(timer.interval);
      this.timers.delete(trigger.id);
    }

    // Stop file watcher if exists
    if (this.watchers.has(trigger.id)) {
      this.watchers.get(trigger.id).close();
      this.watchers.delete(trigger.id);
    }

    // Stop poller if exists
    if (this.pollers.has(trigger.id)) {
      clearInterval(this.pollers.get(trigger.id));
      this.pollers.delete(trigger.id);
    }
  }

  /**
   * Activate a schedule trigger (cron or interval)
   */
  async activateScheduleTrigger(trigger) {
    const { schedule } = trigger.config;

    if (schedule.type === 'cron') {
      // Cron schedule
      const cronParsed = parseCron(schedule.value);
      
      const scheduleNext = () => {
        const nextRun = getNextCronRun(cronParsed);
        trigger.nextRun = nextRun.toISOString();
        
        const delay = nextRun.getTime() - Date.now();
        const timeout = setTimeout(() => {
          this.fireTrigger(trigger);
          scheduleNext();
        }, delay);

        this.timers.set(trigger.id, { timeout });
      };

      scheduleNext();

    } else if (schedule.type === 'interval') {
      // Interval schedule
      const intervalMs = parseInterval(schedule.value);
      
      const interval = setInterval(() => {
        this.fireTrigger(trigger);
      }, intervalMs);

      trigger.nextRun = new Date(Date.now() + intervalMs).toISOString();
      this.timers.set(trigger.id, { interval });

    } else if (schedule.type === 'continuous') {
      // Continuous means the worker is always running
      // Fire immediately then on a short interval
      this.fireTrigger(trigger);
      
      const interval = setInterval(() => {
        this.fireTrigger(trigger);
      }, 60000); // Check every minute

      this.timers.set(trigger.id, { interval });
    }
  }

  /**
   * Activate a file watch trigger
   */
  async activateFileWatchTrigger(trigger) {
    const { watchPath, events } = trigger.config;

    try {
      const watcher = fs.watch(watchPath, { recursive: true }, (eventType, filename) => {
        if (!events || events.includes(eventType)) {
          this.fireTrigger(trigger, { eventType, filename, path: path.join(watchPath, filename) });
        }
      });

      this.watchers.set(trigger.id, watcher);
    } catch (err) {
      console.error(`Failed to watch ${watchPath}:`, err.message);
      trigger.errorCount++;
    }
  }

  /**
   * Activate an email poll trigger
   */
  async activateEmailPollTrigger(trigger) {
    const { pollInterval, filter } = trigger.config;
    const intervalMs = parseInterval(pollInterval || '5m');

    const poll = async () => {
      try {
        // This would integrate with the email capability
        // For now, emit an event that the worker can handle
        this.emit('email:poll', { triggerId: trigger.id, filter });
      } catch (err) {
        console.error(`Email poll failed:`, err.message);
        trigger.errorCount++;
      }
    };

    const interval = setInterval(poll, intervalMs);
    this.pollers.set(trigger.id, interval);

    // Initial poll
    poll();
  }

  /**
   * Start the webhook server
   */
  async startWebhookServer() {
    const http = await import('http');
    
    this.webhookServer = http.createServer((req, res) => {
      // Parse webhook path: /webhook/{triggerId}
      const match = req.url.match(/^\/webhook\/([^/?]+)/);
      if (!match) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const triggerId = match[1];
      const trigger = this.triggers.get(triggerId);

      if (!trigger || trigger.type !== TRIGGER_TYPES.WEBHOOK) {
        res.writeHead(404);
        res.end('Webhook not found');
        return;
      }

      if (!trigger.enabled) {
        res.writeHead(503);
        res.end('Webhook disabled');
        return;
      }

      // Collect body
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        let payload;
        try {
          payload = body ? JSON.parse(body) : {};
        } catch {
          payload = { raw: body };
        }

        this.fireTrigger(trigger, {
          method: req.method,
          headers: req.headers,
          query: new URL(req.url, `http://localhost`).searchParams,
          body: payload
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true, triggerId }));
      });
    });

    this.webhookServer.listen(this.options.webhookPort, () => {
      console.log(`🔗 Webhook server listening on port ${this.options.webhookPort}`);
    });
  }

  /**
   * Fire a trigger - execute the worker
   */
  fireTrigger(trigger, context = {}) {
    trigger.lastRun = new Date().toISOString();
    trigger.runCount++;

    this.emit('trigger:fired', {
      triggerId: trigger.id,
      workerId: trigger.workerId,
      type: trigger.type,
      context,
      timestamp: trigger.lastRun
    });

    // Save updated trigger state
    this.saveTriggers().catch(err => {
      console.error('Failed to save triggers:', err.message);
    });
  }

  /**
   * Get webhook URL for a trigger
   */
  getWebhookUrl(triggerId) {
    const host = this.options.webhookHost || `http://localhost:${this.options.webhookPort}`;
    return `${host}/webhook/${triggerId}`;
  }

  /**
   * Get all triggers for a worker
   */
  getTriggersForWorker(workerId) {
    return Array.from(this.triggers.values()).filter(t => t.workerId === workerId);
  }

  /**
   * Get all triggers
   */
  getAllTriggers() {
    return Array.from(this.triggers.values());
  }

  getTriggerCount() {
    return this.triggers.size;
  }

  /**
   * Load triggers from disk
   */
  async loadTriggers() {
    const filePath = path.join(this.options.dataDir, 'triggers.json');
    
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        for (const triggerData of data) {
          const trigger = new Trigger(triggerData);
          trigger.lastRun = triggerData.lastRun;
          trigger.runCount = triggerData.runCount || 0;
          trigger.errorCount = triggerData.errorCount || 0;
          this.triggers.set(trigger.id, trigger);
        }
      }
    } catch (err) {
      console.error('Failed to load triggers:', err.message);
    }
  }

  /**
   * Save triggers to disk
   */
  async saveTriggers() {
    const filePath = path.join(this.options.dataDir, 'triggers.json');
    const data = Array.from(this.triggers.values()).map(t => t.toJSON());
    
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Failed to save triggers:', err.message);
    }
  }

  /**
   * Get engine status
   */
  getStatus() {
    return {
      running: this.running,
      triggerCount: this.triggers.size,
      activeTriggers: Array.from(this.triggers.values()).filter(t => t.enabled).length,
      webhookPort: this.options.webhookPort,
      timers: this.timers.size,
      watchers: this.watchers.size,
      pollers: this.pollers.size
    };
  }
}

/**
 * Create schedule trigger
 */
export function createScheduleTrigger(workerId, schedule) {
  return {
    type: TRIGGER_TYPES.SCHEDULE,
    workerId,
    config: { schedule }
  };
}

/**
 * Create webhook trigger
 */
export function createWebhookTrigger(workerId, options = {}) {
  return {
    type: TRIGGER_TYPES.WEBHOOK,
    workerId,
    config: {
      secret: options.secret,
      allowedMethods: options.methods || ['POST'],
      transform: options.transform
    }
  };
}

/**
 * Create file watch trigger
 */
export function createFileWatchTrigger(workerId, watchPath, options = {}) {
  return {
    type: TRIGGER_TYPES.FILE_WATCH,
    workerId,
    config: {
      watchPath,
      events: options.events || ['change', 'rename'],
      filter: options.filter
    }
  };
}

/**
 * Create email poll trigger
 */
export function createEmailPollTrigger(workerId, options = {}) {
  return {
    type: TRIGGER_TYPES.EMAIL_POLL,
    workerId,
    config: {
      pollInterval: options.interval || '5m',
      filter: options.filter,
      markRead: options.markRead !== false
    }
  };
}

// Singleton instance
let engineInstance = null;

/**
 * Get or create the trigger engine instance
 */
export function getTriggerEngine(options) {
  if (!engineInstance) {
    engineInstance = new TriggerEngine(options);
  }
  return engineInstance;
}

export default {
  TriggerEngine,
  getTriggerEngine,
  createScheduleTrigger,
  createWebhookTrigger,
  createFileWatchTrigger,
  createEmailPollTrigger,
  TRIGGER_TYPES
};
