/**
 * Charter Compiler
 * 
 * Converts a conversation into a structured worker charter.
 * A charter defines exactly what a worker can do, must ask about, and must never do.
 * 
 * Charter Structure:
 * - name: Worker name
 * - purpose: What this worker does (one sentence)
 * - canDo: Actions the worker can take autonomously
 * - askFirst: Actions that require human approval
 * - neverDo: Hard restrictions - worker will refuse these
 * - budget: Spending limits (if applicable)
 * - schedule: When the worker runs
 * - notifications: How to alert the human
 * - capabilities: What tools/services the worker can use
 */

import { getCapability, getCapabilitySummary } from './capability-registry.mjs';

/**
 * Create an empty charter template
 */
export function createEmptyCharter() {
  return {
    schemaVersion: "1.0",
    name: "",
    purpose: "",
    canDo: [],
    askFirst: [],
    neverDo: [],
    budget: null,
    schedule: null,
    notifications: {
      channels: [],
      events: ["approval_needed", "task_complete", "error"]
    },
    capabilities: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Build charter from conversation context
 * This is called as the conversation progresses
 */
export function buildCharterFromContext(context) {
  const charter = createEmptyCharter();

  // Name
  if (context.workerName) {
    charter.name = context.workerName;
  }

  // Purpose - derived from initial description
  if (context.taskDescription) {
    charter.purpose = context.taskDescription;
  }

  // Capabilities — merge in any capabilityConfigs collected during setup
  if (context.capabilities && context.capabilities.length > 0) {
    const capConfigs = context.capabilityConfigs || {};
    charter.capabilities = context.capabilities.map(cap => {
      const config = { ...(cap.config || {}), ...(capConfigs[cap.id] || {}) };
      return {
        id: cap.id,
        name: cap.name,
        config,
        summary: getCapabilitySummary(cap.id, config)
      };
    });
  }

  // Can Do - autonomous actions
  if (context.canDo && context.canDo.length > 0) {
    charter.canDo = context.canDo;
  }

  // Ask First - approval required
  if (context.askFirst && context.askFirst.length > 0) {
    charter.askFirst = context.askFirst;
  }

  // Never Do - hard restrictions
  if (context.neverDo && context.neverDo.length > 0) {
    charter.neverDo = context.neverDo;
  }

  // Budget
  if (context.budget) {
    charter.budget = {
      amount: context.budget.amount,
      currency: context.budget.currency || "USD",
      period: context.budget.period || "monthly",
      approvalThreshold: context.budget.approvalThreshold || context.budget.amount
    };
  }

  // Schedule
  if (context.schedule) {
    charter.schedule = {
      type: context.schedule.type, // "continuous", "interval", "cron", "trigger"
      value: context.schedule.value,
      timezone: context.schedule.timezone || "UTC"
    };
  }

  // Notifications
  if (context.notifications) {
    charter.notifications = {
      channels: context.notifications.channels || [],
      events: context.notifications.events || ["approval_needed", "task_complete", "error"]
    };
  }

  charter.updatedAt = new Date().toISOString();
  return charter;
}

/**
 * Infer canDo/askFirst/neverDo from task description and capabilities
 */
export function inferCharterRules(taskDescription, capabilities) {
  const rules = {
    canDo: [],
    askFirst: [],
    neverDo: []
  };

  const desc = taskDescription.toLowerCase();

  // Infer based on capabilities
  for (const cap of capabilities) {
    const capDef = getCapability(cap.id);
    if (!capDef) continue;

    // High-risk capabilities default to askFirst
    if (capDef.requiresApproval) {
      rules.askFirst.push(`Use ${capDef.name} for any action`);
    }

    // Capability-specific inferences
    switch (cap.id) {
      case "browser":
        rules.canDo.push("Browse websites and fetch web pages");
        rules.canDo.push("Search the web for information");
        rules.canDo.push("Extract content from pages");
        rules.canDo.push("Use web_fetch and web_search tools freely");
        rules.askFirst.push("Fill forms or submit data on websites");
        break;

      case "slack":
        rules.canDo.push("Read messages from allowed channels");
        rules.canDo.push("Send messages to allowed channels");
        rules.askFirst.push("Send direct messages to individuals");
        rules.neverDo.push("Post to channels not in the allowed list");
        break;

      case "email":
        rules.canDo.push("Read emails matching search criteria");
        if (/send|reply|forward/.test(desc)) {
          rules.askFirst.push("Send emails");
        }
        rules.neverDo.push("Delete emails permanently");
        rules.neverDo.push("Share email content externally");
        break;

      case "github":
        rules.canDo.push("Read repository contents");
        rules.canDo.push("Create and update issues");
        rules.askFirst.push("Create pull requests");
        rules.askFirst.push("Merge pull requests");
        rules.neverDo.push("Delete branches or repositories");
        rules.neverDo.push("Modify repository settings");
        break;

      case "filesystem":
        rules.canDo.push("Read files in allowed directories");
        if (/write|create|save/.test(desc)) {
          rules.canDo.push("Write files in allowed directories");
        }
        rules.neverDo.push("Access files outside allowed directories");
        rules.neverDo.push("Delete files without explicit instruction");
        break;

      case "terminal":
        rules.askFirst.push("Execute shell commands");
        rules.neverDo.push("Execute destructive commands (rm -rf, drop, etc.)");
        rules.neverDo.push("Modify system configuration");
        break;

      case "stripe":
        rules.askFirst.push("Process any payment");
        rules.askFirst.push("Issue refunds");
        rules.askFirst.push("Modify subscriptions");
        rules.neverDo.push("Delete customer data");
        break;

      case "postgres":
      case "sqlite":
        rules.canDo.push("Execute read queries");
        rules.askFirst.push("Execute write queries (INSERT, UPDATE)");
        rules.neverDo.push("Execute destructive queries (DROP, TRUNCATE, DELETE without WHERE)");
        break;

      case "calendar":
        rules.canDo.push("Read calendar events");
        rules.askFirst.push("Create or modify events");
        rules.neverDo.push("Delete events without confirmation");
        break;

      case "shopify":
        rules.canDo.push("Read product and order information");
        rules.askFirst.push("Modify inventory levels");
        rules.askFirst.push("Fulfill orders");
        rules.neverDo.push("Delete products");
        break;

      case "webSearch":
        rules.canDo.push("Search the web for information");
        rules.canDo.push("Use web_search tool freely");
        break;
    }
  }

  // Task-specific inferences
  if (/monitor|watch|track|alert/.test(desc)) {
    rules.canDo.push("Monitor specified data sources continuously");
    rules.canDo.push("Send alerts when conditions are met");
  }

  if (/price|cost|budget|spend/.test(desc)) {
    rules.askFirst.push("Make purchases above threshold");
    rules.neverDo.push("Exceed budget limits");
  }

  if (/automat|auto-/.test(desc)) {
    // Automation should still have guardrails
    rules.askFirst.push("Take actions with irreversible consequences");
  }

  // Deduplicate
  rules.canDo = [...new Set(rules.canDo)];
  rules.askFirst = [...new Set(rules.askFirst)];
  rules.neverDo = [...new Set(rules.neverDo)];

  return rules;
}

/**
 * Infer schedule from task description
 */
export function inferSchedule(taskDescription) {
  const desc = taskDescription.toLowerCase();

  // Continuous monitoring
  if (/continuous|always|24\/7|forever|constantly/.test(desc)) {
    return { type: "continuous", value: null };
  }

  // Interval patterns
  const hourMatch = desc.match(/every\s+(\d+)\s*hours?/);
  if (hourMatch) {
    return { type: "interval", value: `${hourMatch[1]}h` };
  }

  const minMatch = desc.match(/every\s+(\d+)\s*min(ute)?s?/);
  if (minMatch) {
    return { type: "interval", value: `${minMatch[1]}m` };
  }

  if (/hourly|every hour/.test(desc)) {
    return { type: "interval", value: "1h" };
  }

  if (/daily|every day|once a day/.test(desc)) {
    return { type: "cron", value: "0 9 * * *" }; // 9 AM daily
  }

  if (/weekly|every week|once a week/.test(desc)) {
    return { type: "cron", value: "0 9 * * 1" }; // Monday 9 AM
  }

  // Monitoring/watching tasks default to hourly
  if (/monitor|watch|track|alert|check|scan/.test(desc)) {
    return { type: "interval", value: "1h" };
  }

  // Morning tasks
  if (/morning|every morning/.test(desc)) {
    return { type: "cron", value: "0 8 * * *" };
  }

  // Trigger-based (default for most tasks)
  if (/when|if|trigger|on/.test(desc)) {
    return { type: "trigger", value: "on_demand" };
  }

  // Default to on-demand
  return { type: "trigger", value: "on_demand" };
}

/**
 * Validate a charter
 */
export function validateCharter(charter) {
  const errors = [];

  if (!charter.name || charter.name.trim() === "") {
    errors.push("Worker name is required");
  }

  if (!charter.purpose || charter.purpose.trim() === "") {
    errors.push("Worker purpose is required");
  }

  if (!charter.capabilities || charter.capabilities.length === 0) {
    errors.push("Worker must have at least one capability");
  }

  if (charter.budget && charter.budget.amount < 0) {
    errors.push("Budget cannot be negative");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Generate human-readable charter summary
 */
export function generateCharterSummary(charter) {
  const lines = [];

  lines.push(`╭${"─".repeat(58)}╮`);
  lines.push(`│ CHARTER: ${charter.name.padEnd(46)} │`);
  lines.push(`├${"─".repeat(58)}┤`);
  
  // Purpose
  lines.push(`│ Purpose: ${charter.purpose.substring(0, 46).padEnd(46)} │`);
  lines.push(`├${"─".repeat(58)}┤`);

  // Can Do
  lines.push(`│ ✓ CAN DO:                                               │`);
  for (const item of charter.canDo.slice(0, 5)) {
    lines.push(`│   • ${item.substring(0, 51).padEnd(51)} │`);
  }
  if (charter.canDo.length > 5) {
    lines.push(`│   ... and ${charter.canDo.length - 5} more                                    │`);
  }

  // Ask First
  if (charter.askFirst.length > 0) {
    lines.push(`├${"─".repeat(58)}┤`);
    lines.push(`│ ⚡ ASK FIRST:                                            │`);
    for (const item of charter.askFirst.slice(0, 3)) {
      lines.push(`│   • ${item.substring(0, 51).padEnd(51)} │`);
    }
  }

  // Never Do
  if (charter.neverDo.length > 0) {
    lines.push(`├${"─".repeat(58)}┤`);
    lines.push(`│ ✗ NEVER DO:                                             │`);
    for (const item of charter.neverDo.slice(0, 3)) {
      lines.push(`│   • ${item.substring(0, 51).padEnd(51)} │`);
    }
  }

  // Budget
  if (charter.budget) {
    lines.push(`├${"─".repeat(58)}┤`);
    lines.push(`│ 💰 Budget: $${charter.budget.amount}/${charter.budget.period}`.padEnd(58) + ` │`);
    if (charter.budget.approvalThreshold < charter.budget.amount) {
      lines.push(`│    Approval needed above: $${charter.budget.approvalThreshold}`.padEnd(58) + ` │`);
    }
  }

  // Schedule
  if (charter.schedule) {
    lines.push(`├${"─".repeat(58)}┤`);
    let scheduleText = "⏰ Schedule: ";
    switch (charter.schedule.type) {
      case "continuous":
        scheduleText += "Runs continuously (24/7)";
        break;
      case "interval":
        scheduleText += `Every ${charter.schedule.value}`;
        break;
      case "cron":
        scheduleText += `Cron: ${charter.schedule.value}`;
        break;
      case "trigger":
        scheduleText += "On demand / triggered";
        break;
    }
    lines.push(`│ ${scheduleText.padEnd(56)} │`);
  }

  // Capabilities
  lines.push(`├${"─".repeat(58)}┤`);
  lines.push(`│ 🔧 Capabilities:                                         │`);
  for (const cap of charter.capabilities) {
    lines.push(`│   ${cap.summary || cap.name}`.substring(0, 57).padEnd(57) + ` │`);
  }

  lines.push(`╰${"─".repeat(58)}╯`);

  return lines.join("\n");
}

/**
 * Serialize charter to JSON
 */
export function serializeCharter(charter) {
  return JSON.stringify(charter, null, 2);
}

/**
 * Parse charter from JSON
 */
export function parseCharter(json) {
  try {
    const charter = JSON.parse(json);
    const validation = validateCharter(charter);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }
    return { success: true, charter };
  } catch (err) {
    return { success: false, errors: [`Invalid JSON: ${err.message}`] };
  }
}

export default {
  createEmptyCharter,
  buildCharterFromContext,
  inferCharterRules,
  inferSchedule,
  validateCharter,
  generateCharterSummary,
  serializeCharter,
  parseCharter
};
