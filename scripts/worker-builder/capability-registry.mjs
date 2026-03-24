/**
 * Capability Registry
 * 
 * The universal catalog of everything workers can connect to.
 * Each capability is an MCP server, API, or tool that workers can use.
 * 
 * The registry knows:
 * - What capabilities exist
 * - How to connect them
 * - What permissions they require
 * - What actions they enable
 */

// Built-in capability definitions
const CAPABILITY_CATALOG = {
  // === BROWSING ===
  browser: {
    id: "browser",
    name: "Web Browser",
    description: "Browse websites, extract content, fill forms, click buttons",
    category: "browsing",
    mcpServer: "@anthropic/mcp-server-puppeteer",
    actions: ["browse", "screenshot", "extract", "click", "fill", "submit"],
    requiredAuth: null,
    setupInstructions: "Runs locally via Puppeteer. No auth required.",
    icon: "🌐"
  },

  // === COMMUNICATION ===
  slack: {
    id: "slack",
    name: "Slack",
    description: "Send messages, read channels, manage threads",
    category: "communication",
    mcpServer: "@anthropic/mcp-server-slack",
    actions: ["send_message", "read_channel", "reply_thread", "list_channels", "search"],
    requiredAuth: "oauth",
    authUrl: "https://slack.com/oauth/v2/authorize",
    scopes: ["chat:write", "channels:read", "channels:history"],
    setupInstructions: "Connect your Slack workspace via OAuth.",
    icon: "💬"
  },
  
  email: {
    id: "email",
    name: "Email (Gmail/IMAP)",
    description: "Read, send, and organize emails",
    category: "communication",
    mcpServer: "nooterra-mcp-email",
    actions: ["read", "send", "search", "label", "archive", "draft"],
    requiredAuth: "oauth_or_credentials",
    setupInstructions: "Connect Gmail via OAuth or provide IMAP credentials.",
    icon: "📧"
  },

  discord: {
    id: "discord",
    name: "Discord",
    description: "Send messages, manage channels, respond to commands",
    category: "communication",
    mcpServer: "nooterra-mcp-discord",
    actions: ["send_message", "read_channel", "manage_roles", "create_thread"],
    requiredAuth: "bot_token",
    setupInstructions: "Create a Discord bot and provide the token.",
    icon: "🎮"
  },

  sms: {
    id: "sms",
    name: "SMS (Twilio)",
    description: "Send and receive text messages",
    category: "communication",
    mcpServer: "nooterra-mcp-twilio",
    actions: ["send_sms", "receive_sms", "send_mms"],
    requiredAuth: "api_key",
    setupInstructions: "Provide Twilio Account SID and Auth Token.",
    icon: "📱"
  },

  // === CODE & DEVELOPMENT ===
  github: {
    id: "github",
    name: "GitHub",
    description: "Manage repos, issues, PRs, actions",
    category: "development",
    mcpServer: "@anthropic/mcp-server-github",
    actions: ["create_issue", "create_pr", "merge", "comment", "list_repos", "read_file", "commit"],
    requiredAuth: "oauth_or_token",
    scopes: ["repo", "issues", "pull_requests"],
    setupInstructions: "Connect via GitHub OAuth or provide a personal access token.",
    icon: "🐙"
  },

  filesystem: {
    id: "filesystem",
    name: "File System",
    description: "Read, write, and manage local files",
    category: "development",
    mcpServer: "@anthropic/mcp-server-filesystem",
    actions: ["read", "write", "list", "delete", "move", "search"],
    requiredAuth: null,
    setupInstructions: "Specify allowed directories for the worker.",
    icon: "📁"
  },

  terminal: {
    id: "terminal",
    name: "Terminal/Shell",
    description: "Execute shell commands",
    category: "development",
    mcpServer: "nooterra-mcp-shell",
    actions: ["execute", "background", "kill"],
    requiredAuth: null,
    requiresApproval: true,
    setupInstructions: "Runs locally. Commands require approval by default.",
    icon: "⌨️"
  },

  // === DATA & DATABASES ===
  postgres: {
    id: "postgres",
    name: "PostgreSQL",
    description: "Query and modify PostgreSQL databases",
    category: "database",
    mcpServer: "@anthropic/mcp-server-postgres",
    actions: ["query", "insert", "update", "delete", "schema"],
    requiredAuth: "connection_string",
    setupInstructions: "Provide PostgreSQL connection string.",
    icon: "🐘"
  },

  sqlite: {
    id: "sqlite",
    name: "SQLite",
    description: "Local SQLite database operations",
    category: "database",
    mcpServer: "@anthropic/mcp-server-sqlite",
    actions: ["query", "insert", "update", "delete", "schema"],
    requiredAuth: null,
    setupInstructions: "Specify the SQLite database file path.",
    icon: "💾"
  },

  // === PRODUCTIVITY ===
  notion: {
    id: "notion",
    name: "Notion",
    description: "Read and write Notion pages, databases, blocks",
    category: "productivity",
    mcpServer: "nooterra-mcp-notion",
    actions: ["read_page", "create_page", "update_page", "query_database", "create_database"],
    requiredAuth: "oauth",
    setupInstructions: "Connect via Notion OAuth.",
    icon: "📝"
  },

  googleSheets: {
    id: "googleSheets",
    name: "Google Sheets",
    description: "Read and write spreadsheets",
    category: "productivity",
    mcpServer: "nooterra-mcp-google-sheets",
    actions: ["read", "write", "append", "create", "format"],
    requiredAuth: "oauth",
    setupInstructions: "Connect via Google OAuth.",
    icon: "📊"
  },

  calendar: {
    id: "calendar",
    name: "Google Calendar",
    description: "Manage calendar events and schedules",
    category: "productivity",
    mcpServer: "nooterra-mcp-google-calendar",
    actions: ["list_events", "create_event", "update_event", "delete_event", "find_free_time"],
    requiredAuth: "oauth",
    setupInstructions: "Connect via Google OAuth.",
    icon: "📅"
  },

  // === E-COMMERCE & PAYMENTS ===
  stripe: {
    id: "stripe",
    name: "Stripe",
    description: "Process payments, manage subscriptions, issue refunds",
    category: "payments",
    mcpServer: "nooterra-mcp-stripe",
    actions: ["charge", "refund", "create_subscription", "cancel_subscription", "list_invoices"],
    requiredAuth: "api_key",
    requiresApproval: true,
    setupInstructions: "Provide Stripe API key. Payment actions require approval.",
    icon: "💳"
  },

  shopify: {
    id: "shopify",
    name: "Shopify",
    description: "Manage products, orders, inventory",
    category: "ecommerce",
    mcpServer: "nooterra-mcp-shopify",
    actions: ["list_products", "update_inventory", "list_orders", "fulfill_order", "create_discount"],
    requiredAuth: "oauth",
    setupInstructions: "Connect via Shopify OAuth.",
    icon: "🛒"
  },

  // === MONITORING & ALERTS ===
  webhook: {
    id: "webhook",
    name: "Webhooks",
    description: "Send and receive HTTP webhooks",
    category: "integration",
    mcpServer: "nooterra-mcp-webhook",
    actions: ["send", "receive", "transform"],
    requiredAuth: null,
    setupInstructions: "Configure webhook URLs.",
    icon: "🔗"
  },

  // === AI & SEARCH ===
  webSearch: {
    id: "webSearch",
    name: "Web Search",
    description: "Search the web using various engines",
    category: "search",
    mcpServer: "@anthropic/mcp-server-brave-search",
    actions: ["search", "news", "images"],
    requiredAuth: "api_key",
    setupInstructions: "Provide Brave Search API key.",
    icon: "🔍"
  },

  memory: {
    id: "memory",
    name: "Worker Memory",
    description: "Persistent memory across worker runs",
    category: "core",
    mcpServer: "@anthropic/mcp-server-memory",
    actions: ["store", "retrieve", "search", "forget"],
    requiredAuth: null,
    setupInstructions: "Built-in. Workers automatically have memory.",
    icon: "🧠"
  }
};

// Category metadata
const CATEGORIES = {
  browsing: { name: "Browsing", icon: "🌐", description: "Web browsing and scraping" },
  communication: { name: "Communication", icon: "💬", description: "Email, chat, messaging" },
  development: { name: "Development", icon: "⌨️", description: "Code, files, terminals" },
  database: { name: "Databases", icon: "🗄️", description: "Data storage and queries" },
  productivity: { name: "Productivity", icon: "📝", description: "Docs, sheets, calendars" },
  payments: { name: "Payments", icon: "💳", description: "Money and transactions" },
  ecommerce: { name: "E-Commerce", icon: "🛒", description: "Stores and inventory" },
  integration: { name: "Integration", icon: "🔗", description: "APIs and webhooks" },
  search: { name: "Search", icon: "🔍", description: "Web and data search" },
  core: { name: "Core", icon: "⚙️", description: "Built-in capabilities" }
};

/**
 * Get all capabilities
 */
export function getAllCapabilities() {
  return Object.values(CAPABILITY_CATALOG);
}

/**
 * Get capability by ID
 */
export function getCapability(id) {
  return CAPABILITY_CATALOG[id] || null;
}

/**
 * Get capabilities by category
 */
export function getCapabilitiesByCategory(category) {
  return Object.values(CAPABILITY_CATALOG).filter(cap => cap.category === category);
}

/**
 * Get all categories
 */
export function getCategories() {
  return CATEGORIES;
}

/**
 * Infer required capabilities from a task description
 * This is the AI-powered part - analyzes what the user wants and suggests capabilities
 */
export function inferCapabilities(taskDescription) {
  const desc = taskDescription.toLowerCase();
  const inferred = [];

  // Browsing keywords
  if (/browse|website|web page|scrape|url|http|click|form|screenshot/.test(desc)) {
    inferred.push("browser");
  }

  // Communication keywords
  if (/slack|channel|message|dm|thread/.test(desc)) {
    inferred.push("slack");
  }
  if (/email|inbox|gmail|outlook|send mail|mail/.test(desc)) {
    inferred.push("email");
  }
  if (/discord|server|role/.test(desc)) {
    inferred.push("discord");
  }
  if (/sms|text message|twilio|phone/.test(desc)) {
    inferred.push("sms");
  }

  // Development keywords
  if (/github|repo|issue|pull request|pr|commit|branch/.test(desc)) {
    inferred.push("github");
  }
  if (/file|folder|directory|read file|write file|local/.test(desc)) {
    inferred.push("filesystem");
  }
  if (/command|terminal|shell|bash|script|execute/.test(desc)) {
    inferred.push("terminal");
  }

  // Database keywords
  if (/postgres|postgresql|database|sql query/.test(desc)) {
    inferred.push("postgres");
  }
  if (/sqlite|local database/.test(desc)) {
    inferred.push("sqlite");
  }

  // Productivity keywords
  if (/notion|page|block|workspace/.test(desc)) {
    inferred.push("notion");
  }
  if (/spreadsheet|google sheet|excel|csv/.test(desc)) {
    inferred.push("googleSheets");
  }
  if (/calendar|event|meeting|schedule|appointment/.test(desc)) {
    inferred.push("calendar");
  }

  // Payment keywords
  if (/stripe|payment|charge|refund|subscription|invoice/.test(desc)) {
    inferred.push("stripe");
  }

  // E-commerce keywords
  if (/shopify|product|inventory|order|store/.test(desc)) {
    inferred.push("shopify");
  }

  // Search keywords
  if (/search|google|find|lookup|research/.test(desc)) {
    inferred.push("webSearch");
  }

  // Webhook keywords
  if (/webhook|api|http|endpoint|callback/.test(desc)) {
    inferred.push("webhook");
  }

  // Always include memory for workers that need to remember things
  if (/remember|track|history|previous|last time|context/.test(desc)) {
    inferred.push("memory");
  }

  return [...new Set(inferred)].map(id => CAPABILITY_CATALOG[id]).filter(Boolean);
}

/**
 * Get setup questions for a capability
 */
export function getSetupQuestions(capabilityId) {
  const cap = CAPABILITY_CATALOG[capabilityId];
  if (!cap) return [];

  const questions = [];

  switch (cap.requiredAuth) {
    case "oauth":
      questions.push({
        type: "oauth",
        question: `Connect your ${cap.name} account?`,
        provider: capabilityId
      });
      break;
    case "api_key":
      questions.push({
        type: "text",
        question: `Enter your ${cap.name} API key:`,
        sensitive: true,
        field: "apiKey"
      });
      break;
    case "connection_string":
      questions.push({
        type: "text",
        question: `Enter your ${cap.name} connection string:`,
        sensitive: true,
        field: "connectionString"
      });
      break;
    case "bot_token":
      questions.push({
        type: "text",
        question: `Enter your ${cap.name} bot token:`,
        sensitive: true,
        field: "botToken"
      });
      break;
    case "oauth_or_credentials":
      questions.push({
        type: "choice",
        question: `How do you want to connect ${cap.name}?`,
        options: ["OAuth (recommended)", "Manual credentials"]
      });
      break;
    case "oauth_or_token":
      questions.push({
        type: "choice",
        question: `How do you want to connect ${cap.name}?`,
        options: ["OAuth (recommended)", "Personal access token"]
      });
      break;
  }

  // Capability-specific questions
  if (capabilityId === "filesystem") {
    questions.push({
      type: "text",
      question: "Which directories should this worker have access to?",
      placeholder: "e.g., ~/Documents, ~/Projects",
      field: "allowedPaths"
    });
  }

  if (capabilityId === "slack") {
    questions.push({
      type: "text",
      question: "Which Slack channels should this worker use?",
      placeholder: "e.g., #general, #alerts",
      field: "channels"
    });
  }

  if (capabilityId === "postgres" || capabilityId === "sqlite") {
    questions.push({
      type: "choice",
      question: "What database permissions should this worker have?",
      options: ["Read only", "Read and write", "Full access (including schema changes)"],
      field: "permissions"
    });
  }

  return questions;
}

/**
 * Validate capability configuration
 */
export function validateCapabilityConfig(capabilityId, config) {
  const cap = CAPABILITY_CATALOG[capabilityId];
  if (!cap) {
    return { valid: false, error: `Unknown capability: ${capabilityId}` };
  }

  // Check required auth
  if (cap.requiredAuth && !config.authenticated) {
    return { valid: false, error: `${cap.name} requires authentication` };
  }

  return { valid: true };
}

/**
 * Get human-readable capability summary for charter
 */
export function getCapabilitySummary(capabilityId, config = {}) {
  const cap = CAPABILITY_CATALOG[capabilityId];
  if (!cap) return null;

  let summary = `${cap.icon} ${cap.name}`;
  
  if (config.channels) {
    summary += ` (${config.channels})`;
  }
  if (config.allowedPaths) {
    summary += ` (${config.allowedPaths})`;
  }
  if (config.permissions) {
    summary += ` (${config.permissions})`;
  }

  return summary;
}

export default {
  getAllCapabilities,
  getCapability,
  getCapabilitiesByCategory,
  getCategories,
  inferCapabilities,
  getSetupQuestions,
  validateCapabilityConfig,
  getCapabilitySummary,
  CAPABILITY_CATALOG,
  CATEGORIES
};
