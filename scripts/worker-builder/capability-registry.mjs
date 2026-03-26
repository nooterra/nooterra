/**
 * Capability Registry
 *
 * The universal catalog of everything workers can connect to.
 * Each capability listed here has a REAL, WORKING built-in implementation
 * in built-in-tools.mjs. No external MCP servers required.
 *
 * The registry knows:
 * - What capabilities exist
 * - How to connect them
 * - What permissions they require
 * - What actions they enable
 */

// Built-in capability definitions — only capabilities with real implementations
const CAPABILITY_CATALOG = {
  // === BROWSING ===
  browser: {
    id: "browser",
    name: "Web Browser",
    description: "Fetch web pages and extract content, links, or raw HTML",
    category: "browsing",
    implementation: "built-in",  // uses web_fetch tool
    actions: ["fetch", "extract", "links"],
    requiredAuth: null,
    setupInstructions: "Built-in. Uses web_fetch tool — no configuration required.",
    icon: "🌐"
  },

  // === COMMUNICATION ===
  slack: {
    id: "slack",
    name: "Slack",
    description: "Send messages, read channels, manage threads",
    category: "communication",
    implementation: "built-in",  // uses slack_send, slack_read tools
    actions: ["send_message", "read_channel", "reply_thread"],
    requiredAuth: "oauth_or_token",
    setupInstructions: "Save your Slack bot token to ~/.nooterra/credentials/slack-token.txt or run /connect slack <token>.",
    icon: "💬"
  },

  email: {
    id: "email",
    name: "Email (SMTP)",
    description: "Send emails via SMTP",
    category: "communication",
    implementation: "built-in",  // uses send_email tool
    actions: ["send"],
    requiredAuth: "smtp_config",
    setupInstructions: "Create ~/.nooterra/credentials/email-config.json with { host, port, user, pass, from }.",
    icon: "📧"
  },

  // Future: discord — available via MCP server
  // Future: sms — available via MCP server

  // === CODE & DEVELOPMENT ===
  github: {
    id: "github",
    name: "GitHub",
    description: "Make authenticated GitHub API calls for repos, issues, PRs",
    category: "development",
    implementation: "built-in",  // uses github_api tool
    actions: ["api_call"],
    requiredAuth: "oauth_or_token",
    setupInstructions: "Save your token to ~/.nooterra/credentials/github-token.txt, set GITHUB_TOKEN, or run /connect github <token>.",
    icon: "🐙"
  },

  filesystem: {
    id: "filesystem",
    name: "File System",
    description: "Read and write local files within allowed directories",
    category: "development",
    implementation: "built-in",  // uses read_file, write_file tools
    actions: ["read", "write"],
    requiredAuth: null,
    setupInstructions: "Built-in. Writes go to ~/.nooterra/workspace/. Reads limited to ~/.nooterra/ and cwd.",
    icon: "📁"
  },

  // Future: terminal — available via MCP server (run_command exists but is separate from capability)

  // === DATABASES ===
  // Future: postgres — available via MCP server
  // Future: sqlite — available via MCP server

  // === PRODUCTIVITY ===
  // Future: notion — available via MCP server
  // Future: googleSheets — available via MCP server
  // Future: calendar — available via MCP server

  // === E-COMMERCE & PAYMENTS ===
  // Future: stripe — available via MCP server
  // Future: shopify — available via MCP server

  // === MONITORING & ALERTS ===
  // Future: webhook — available via MCP server

  // === AI & SEARCH ===
  webSearch: {
    id: "webSearch",
    name: "Web Search",
    description: "Search the web using Brave Search API or DuckDuckGo fallback",
    category: "search",
    implementation: "built-in",  // uses web_search tool
    actions: ["search"],
    requiredAuth: null,  // works without key via DuckDuckGo, but Brave API key recommended
    setupInstructions: "Built-in. Works without config via DuckDuckGo. For best results, set BRAVE_API_KEY or save to ~/.nooterra/credentials/brave-search-token.txt.",
    icon: "🔍"
  },

  memory: {
    id: "memory",
    name: "Worker Memory",
    description: "Persistent memory across worker runs",
    category: "core",
    implementation: "built-in",  // uses __save_memory
    actions: ["store", "retrieve", "search", "forget"],
    requiredAuth: null,
    setupInstructions: "Built-in. Workers automatically have memory.",
    icon: "🧠"
  }
};

// ---------------------------------------------------------------------------
// MCP-capable capabilities — not available yet, but can be added in the future
// via `nooterra add @package/mcp-server-name`
// ---------------------------------------------------------------------------
const MCP_CAPABLE = [
  { id: "discord",      name: "Discord",          mcpServer: "TBD — nooterra-mcp-discord" },
  { id: "sms",          name: "SMS (Twilio)",      mcpServer: "TBD — nooterra-mcp-twilio" },
  { id: "terminal",     name: "Terminal/Shell",     mcpServer: "TBD — nooterra-mcp-shell" },
  { id: "postgres",     name: "PostgreSQL",         mcpServer: "TBD — @anthropic/mcp-server-postgres" },
  { id: "sqlite",       name: "SQLite",             mcpServer: "TBD — @anthropic/mcp-server-sqlite" },
  { id: "notion",       name: "Notion",             mcpServer: "TBD — nooterra-mcp-notion" },
  { id: "googleSheets", name: "Google Sheets",      mcpServer: "TBD — nooterra-mcp-google-sheets" },
  { id: "calendar",     name: "Google Calendar",    mcpServer: "TBD — nooterra-mcp-google-calendar" },
  { id: "stripe",       name: "Stripe",             mcpServer: "TBD — @stripe/mcp" },
  { id: "shopify",      name: "Shopify",            mcpServer: "TBD — nooterra-mcp-shopify" },
  { id: "webhook",      name: "Webhooks",           mcpServer: "TBD — nooterra-mcp-webhook" },
];

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
 * Get the list of capabilities that could be added via MCP servers in the future.
 */
export function getMcpCapable() {
  return MCP_CAPABLE;
}

/**
 * Infer required capabilities from a task description.
 * Only suggests capabilities that actually exist in the catalog.
 */
export function inferCapabilities(taskDescription) {
  const desc = taskDescription.toLowerCase();
  const inferred = [];

  // Browsing keywords — also catch monitoring/price tasks that imply web access
  if (/browse|website|web page|scrape|url|http|click|form|screenshot|price|competitor|amazon|ebay|linkedin|twitter|reddit|news|blog|article|review/.test(desc)) {
    inferred.push("browser");
  }

  // Communication keywords (only working capabilities)
  if (/slack|channel|message|dm|thread/.test(desc)) {
    inferred.push("slack");
  }
  if (/email|inbox|gmail|outlook|send mail|mail/.test(desc)) {
    inferred.push("email");
  }

  // Development keywords (only working capabilities)
  if (/github|\brepo(?:sitory)?\b|issue|pull request|pull_request|\bpr\b|commit|branch|merge/.test(desc)) {
    inferred.push("github");
  }
  if (/file|folder|directory|read file|write file|local/.test(desc)) {
    inferred.push("filesystem");
  }

  // Search keywords
  if (/search|google|find|lookup|research/.test(desc)) {
    inferred.push("webSearch");
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
    case "oauth_or_token":
      questions.push({
        type: "choice",
        question: `How do you want to connect ${cap.name}?`,
        options: ["OAuth (recommended)", "Personal access token"]
      });
      break;
    case "smtp_config":
      questions.push({
        type: "text",
        question: `Enter your SMTP host (e.g. smtp.gmail.com):`,
        field: "host"
      });
      questions.push({
        type: "text",
        question: `Enter your SMTP username:`,
        field: "user"
      });
      questions.push({
        type: "text",
        question: `Enter your SMTP password/app-password:`,
        sensitive: true,
        field: "pass"
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
  getMcpCapable,
  inferCapabilities,
  getSetupQuestions,
  validateCapabilityConfig,
  getCapabilitySummary,
  CAPABILITY_CATALOG,
  CATEGORIES,
  MCP_CAPABLE
};
