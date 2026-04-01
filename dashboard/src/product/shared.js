import {
  loadRuntimeConfig,
  PRODUCT_RUNTIME_STORAGE_KEY,
  requestJson,
} from "./api.js";

/* ===================================================================
   Constants
   =================================================================== */

export const ONBOARDING_STORAGE_KEY = "nooterra_product_onboarding_v1";
export const THEME_STORAGE_KEY = "nooterra_theme";
export const SIDEBAR_STORAGE_KEY = "nooterra_sidebar_collapsed";
export const AUTH_BASE = "/__magic";
export const WORKER_API_BASE = "/__nooterra";

// TODO: Move ALL_MODELS to a server-side API endpoint (e.g. GET /api/models)
// so the catalog stays current without frontend deploys.
export const ALL_MODELS = [
  // Free — $0 cost, great for low-stakes tasks
  { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super 120B", provider: "NVIDIA", price: "Free", category: "free" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B", provider: "Meta", price: "Free", category: "free" },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free", name: "Qwen 3 Next 80B", provider: "Qwen", price: "Free", category: "free" },
  { id: "google/gemma-3-27b-it:free", name: "Gemma 3 27B", provider: "Google", price: "Free", category: "free" },
  { id: "openai/gpt-oss-120b:free", name: "GPT-OSS 120B", provider: "OpenAI", price: "Free", category: "free" },
  // Fast & Cheap — under $1/M tokens, best for high-volume workers
  { id: "google/gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", provider: "Google", price: "$0.10", category: "fast" },
  { id: "openai/gpt-5.4-nano", name: "GPT-5.4 Nano", provider: "OpenAI", price: "$0.20", category: "fast" },
  { id: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2", provider: "DeepSeek", price: "$0.26", category: "fast" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google", price: "$0.30", category: "fast" },
  { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "OpenAI", price: "$0.40", category: "fast" },
  { id: "openai/gpt-5.4-mini", name: "GPT-5.4 Mini", provider: "OpenAI", price: "$0.75", category: "fast" },
  { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "Anthropic", price: "$1.00", category: "fast" },
  // Best Quality — flagship models for important work
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "Google", price: "$1.25", category: "best" },
  { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", provider: "Google", price: "$2.00", category: "best" },
  { id: "openai/gpt-5.4", name: "GPT-5.4", provider: "OpenAI", price: "$2.50", category: "best" },
  { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", provider: "Anthropic", price: "$3.00", category: "best" },
  { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6", provider: "Anthropic", price: "$5.00", category: "best" },
  // Specialized — reasoning, thinking, and niche models
  { id: "deepseek/deepseek-r1-0528", name: "DeepSeek R1", provider: "DeepSeek", price: "$0.45", category: "specialized" },
  { id: "openai/o4-mini", name: "O4 Mini", provider: "OpenAI", price: "$1.10", category: "specialized" },
  { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash", provider: "Google", price: "$0.50", category: "specialized" },
  { id: "meta-llama/llama-4-maverick", name: "Llama 4 Maverick", provider: "Meta", price: "$0.15", category: "specialized" },
  { id: "mistralai/mistral-small-2603", name: "Mistral Small", provider: "Mistral", price: "$0.15", category: "specialized" },
  { id: "qwen/qwen3.5-397b-a17b", name: "Qwen 3.5 397B", provider: "Qwen", price: "$0.39", category: "specialized" },
];

export const MODEL_CATEGORIES = [
  { key: "free", label: "Free" },
  { key: "fast", label: "Fast & Cheap" },
  { key: "best", label: "Best Quality" },
  { key: "specialized", label: "Specialized" },
];

export const WORK_FUNCTIONS = [
  { value: "founder", label: "Founder / CEO" },
  { value: "engineer", label: "Engineering" },
  { value: "ops", label: "Operations" },
  { value: "designer", label: "Design" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Other" },
];

export const STATUS_COLORS = {
  running: "var(--green, #2a9d6e)",
  paused: "var(--amber, #c08c30)",
  ready: "var(--text-300, #8a8a84)",
  error: "var(--red, #c43a3a)",
};

export const CHARTER_SECTIONS = [
  { key: "canDo", label: "Handles on its own", color: "var(--green)", bg: "var(--green-bg)", icon: "\u2713" },
  { key: "askFirst", label: "Asks you first", color: "var(--amber)", bg: "var(--amber-bg)", icon: "?" },
  { key: "neverDo", label: "Never does", color: "var(--red)", bg: "var(--red-bg)", icon: "\u2717" },
];

export const WORKER_TEMPLATES = [
  {
    name: "Customer Support",
    description: "Reads emails, drafts replies, and handles common support questions. Escalates refunds for your approval.",
    charter: {
      canDo: ["Read incoming emails", "Draft reply to customer questions", "Search knowledge base", "Categorize support tickets"],
      askFirst: ["Issue refunds", "Send external emails", "Escalate to human agent"],
      neverDo: ["Delete customer data", "Share customer PII", "Make promises about timelines"],
    },
    model: "anthropic/claude-haiku-4.5",
    schedule: "continuous",
    integrations: ["Gmail"],
  },
  {
    name: "Social Media Monitor",
    description: "Tracks brand mentions across platforms. Drafts responses and alerts you to negative sentiment.",
    charter: {
      canDo: ["Monitor brand mentions", "Track competitor activity", "Draft response suggestions", "Summarize daily sentiment"],
      askFirst: ["Post public responses", "Engage with influencers", "Flag crisis-level mentions"],
      neverDo: ["Share internal data publicly", "Make commitments on behalf of company", "Engage with trolls"],
    },
    model: "google/gemini-2.5-flash",
    schedule: "0 */2 * * *",
    integrations: ["Slack"],
  },
  {
    name: "Invoice Processor",
    description: "Reads incoming invoices, categorizes expenses, and flags duplicates. Routes high-value items for approval.",
    charter: {
      canDo: ["Read and parse invoices", "Categorize expenses", "Match against purchase orders", "Flag duplicate invoices"],
      askFirst: ["Approve invoices over $500", "Create new vendor records", "Adjust payment terms"],
      neverDo: ["Modify bank account details", "Delete financial records", "Bypass approval thresholds"],
    },
    model: "openai/gpt-4.1-mini",
    schedule: "0 9 * * *",
    integrations: ["Gmail", "Stripe"],
  },
  {
    name: "Email Responder",
    description: "Monitors your inbox, drafts context-aware replies, and sends routine responses. Flags anything unusual.",
    charter: {
      canDo: ["Read incoming emails", "Draft replies using context", "Sort and label emails", "Archive handled threads"],
      askFirst: ["Send replies to new contacts", "Forward emails internally", "Unsubscribe from lists"],
      neverDo: ["Forward emails externally", "Delete emails", "Share attachments with third parties"],
    },
    model: "anthropic/claude-haiku-4.5",
    schedule: "continuous",
    integrations: ["Gmail"],
  },
  {
    name: "Competitor Tracker",
    description: "Monitors competitor websites, pricing, and announcements. Sends you a daily summary of changes.",
    charter: {
      canDo: ["Scan competitor websites", "Track pricing changes", "Monitor press releases", "Compare feature sets"],
      askFirst: ["Alert team about major changes", "Generate competitive analysis report"],
      neverDo: ["Share competitive intel externally", "Access paid/gated content", "Scrape at high frequency"],
    },
    model: "google/gemini-2.5-flash",
    schedule: "0 8 * * *",
    integrations: ["Slack"],
  },
];

/* ===================================================================
   Helper functions
   =================================================================== */

export function cls(...args) { return args.filter(Boolean).join(" "); }

export function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function saveRuntime(config) {
  try { localStorage.setItem(PRODUCT_RUNTIME_STORAGE_KEY, JSON.stringify(config)); } catch { /* ignore */ }
}

export function humanizeSchedule(schedule) {
  if (!schedule) return "On demand";
  if (schedule === "continuous") return "Always running";
  if (schedule === "on_demand") return "On demand";
  // Interval patterns
  if (/^\d+m$/.test(schedule)) return `Every ${schedule.replace("m", "")} minutes`;
  if (schedule === "1h") return "Every hour";
  if (/^\d+h$/.test(schedule)) return `Every ${schedule.replace("h", "")} hours`;
  // Common cron patterns
  const cronDays = { "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday", "4": "Thursday", "5": "Friday", "6": "Saturday" };
  const cronMatch = schedule.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+(\*|\d)$/);
  if (cronMatch) {
    const [, min, hour, dow] = cronMatch;
    const h = parseInt(hour, 10);
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const timeStr = min === "0" ? `${h12} ${period}` : `${h12}:${min.padStart(2, "0")} ${period}`;
    if (dow === "*") return `Daily at ${timeStr}`;
    return `Weekly on ${cronDays[dow] || dow} at ${timeStr}`;
  }
  // Fallback: show as-is with "Cron:" prefix for unrecognized patterns
  if (/^\d+\s+\d+/.test(schedule)) return `Cron: ${schedule}`;
  return schedule;
}

export function loadOnboardingState() {
  try { return JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) || "null") || null; } catch { return null; }
}

export function saveOnboardingState(state) {
  try { localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function loadTheme() {
  try { return localStorage.getItem(THEME_STORAGE_KEY) || "light"; } catch { return "light"; }
}

export function saveTheme(theme) {
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* ignore */ }
  applyTheme(theme);
}

export function applyTheme(theme) {
  if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else if (theme === "auto") document.documentElement.setAttribute("data-theme", "auto");
  else document.documentElement.removeAttribute("data-theme");
}

export function loadSidebarCollapsed() {
  try { return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true"; } catch { return false; }
}

export function saveSidebarCollapsed(collapsed) {
  try { localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "true" : "false"); } catch { /* ignore */ }
}

export function navigate(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function getInitials(email) {
  const name = typeof localStorage !== "undefined" ? localStorage.getItem("nooterra_user_name") : null;
  if (name) return name.charAt(0).toUpperCase();
  if (!email) return "?";
  return email.charAt(0).toUpperCase();
}

export function tierLabel(tier) {
  if (tier === "pro") return "Pro";
  if (tier === "scale") return "Scale";
  return "Free";
}

export function tierColor(tier) {
  if (tier === "pro") return "var(--accent)";
  if (tier === "scale") return "#5bb98c";
  return "var(--text-tertiary)";
}

/* -- Worker API helpers ------------------------------------------- */

export async function workerApiRequest({ pathname, method = "GET", body = null }) {
  const runtime = loadRuntimeConfig();
  return requestJson({
    baseUrl: WORKER_API_BASE, pathname, method,
    headers: { "x-tenant-id": runtime.tenantId, "content-type": "application/json" },
    body, credentials: "include",
  });
}

/* -- Auth helpers ------------------------------------------------- */

export async function authRequest({ pathname, method = "POST", body = null }) {
  return requestJson({
    baseUrl: AUTH_BASE, pathname, method,
    headers: { "content-type": "application/json" },
    body, credentials: "include",
  });
}

export async function fetchSessionPrincipal() {
  return authRequest({ pathname: "/v1/buyer/me", method: "GET" });
}

export async function logoutSession() {
  try { await authRequest({ pathname: "/v1/buyer/logout", method: "POST" }); } catch { /* ignore */ }
}

/* -- Template deploy helper --------------------------------------- */

export function templateScheduleToApiValue(schedule) {
  if (!schedule) return "daily";
  if (schedule.type === "continuous") return "continuous";
  if (schedule.type === "interval") return schedule.value || "1h";
  if (schedule.type === "cron") return schedule.value || "0 9 * * *";
  return "on_demand";
}

/* -- Builder inference helpers ------------------------------------ */

const CAPABILITY_CATALOG = {
  browser:    { id: "browser",    name: "Web Browser",    category: "browsing",      requiredAuth: null,             label: "Browse websites and extract content" },
  slack:      { id: "slack",      name: "Slack",          category: "communication", requiredAuth: "oauth_or_token", label: "Send and read Slack messages" },
  email:      { id: "email",      name: "Email (Gmail)",  category: "communication", requiredAuth: "oauth",          label: "Read and send emails" },
  github:     { id: "github",     name: "GitHub",         category: "development",   requiredAuth: "oauth_or_token", label: "Repos, issues, pull requests" },
  filesystem: { id: "filesystem", name: "File System",    category: "development",   requiredAuth: null,             label: "Read and write local files" },
  webSearch:  { id: "webSearch",  name: "Web Search",     category: "search",        requiredAuth: null,             label: "Search the web" },
  memory:     { id: "memory",     name: "Worker Memory",  category: "core",          requiredAuth: null,             label: "Persistent memory across runs" },
};

export function inferCapabilities(taskDescription) {
  const desc = taskDescription.toLowerCase();
  const ids = [];
  if (/browse|website|web page|scrape|url|http|click|form|screenshot|price|competitor|amazon|ebay|linkedin|twitter|reddit|news|blog|article|review/.test(desc)) ids.push("browser");
  if (/slack|channel|message|dm|thread/.test(desc)) ids.push("slack");
  if (/email|inbox|gmail|outlook|send mail|mail/.test(desc)) ids.push("email");
  if (/github|\brepo(?:sitory)?\b|issue|pull request|pull_request|\bpr\b|commit|branch|merge/.test(desc)) ids.push("github");
  if (/file|folder|directory|read file|write file|local/.test(desc)) ids.push("filesystem");
  if (/search|google|find|lookup|research/.test(desc)) ids.push("webSearch");
  if (/remember|track|history|previous|last time|context/.test(desc)) ids.push("memory");
  return [...new Set(ids)].map(id => CAPABILITY_CATALOG[id]).filter(Boolean);
}

export function inferRulesFromDescription(taskDescription, capabilities) {
  const rules = { canDo: [], askFirst: [], neverDo: [] };
  const desc = taskDescription.toLowerCase();
  for (const cap of capabilities) {
    switch (cap.id) {
      case "browser": rules.canDo.push("Browse websites and fetch web pages"); rules.canDo.push("Extract content from pages"); rules.askFirst.push("Fill forms or submit data on websites"); break;
      case "slack": rules.canDo.push("Read messages from allowed channels"); rules.canDo.push("Send messages to allowed channels"); rules.askFirst.push("Send direct messages to individuals"); rules.neverDo.push("Post to channels not in the allowed list"); break;
      case "email": rules.canDo.push("Read emails matching search criteria"); if (/send|reply|forward/.test(desc)) rules.askFirst.push("Send emails"); rules.neverDo.push("Delete emails permanently"); break;
      case "github": rules.canDo.push("Read repository contents"); rules.canDo.push("Create and update issues"); rules.askFirst.push("Create or merge pull requests"); rules.neverDo.push("Delete branches or repositories"); break;
      case "filesystem": rules.canDo.push("Read files in allowed directories"); if (/write|create|save/.test(desc)) rules.canDo.push("Write files in allowed directories"); rules.neverDo.push("Access files outside allowed directories"); break;
      case "webSearch": rules.canDo.push("Search the web for information"); break;
      default: break;
    }
  }
  if (/monitor|watch|track|alert/.test(desc)) { rules.canDo.push("Monitor specified data sources continuously"); rules.canDo.push("Send alerts when conditions are met"); }
  if (/write|draft|create|generate/.test(desc)) { rules.canDo.push("Draft content based on instructions"); rules.askFirst.push("Publish or send drafted content"); rules.neverDo.push("Publish without human approval"); }
  if (/price|cost|budget|spend/.test(desc)) { rules.askFirst.push("Make purchases above threshold"); rules.neverDo.push("Exceed budget limits"); }
  rules.neverDo.push("Spend money without approval");
  rules.neverDo.push("Access credentials or keys directly");
  rules.canDo = [...new Set(rules.canDo)]; rules.askFirst = [...new Set(rules.askFirst)]; rules.neverDo = [...new Set(rules.neverDo)];
  return rules;
}

export function inferSchedule(taskDescription) {
  const desc = taskDescription.toLowerCase();
  if (/continuous|always|24\/7|constantly/.test(desc)) return { type: "continuous", value: null, label: "Continuously" };
  const hourMatch = desc.match(/every\s+(\d+)\s*hours?/);
  if (hourMatch) return { type: "interval", value: `${hourMatch[1]}h`, label: `Every ${hourMatch[1]}h` };
  const minMatch = desc.match(/every\s+(\d+)\s*min(ute)?s?/);
  if (minMatch) return { type: "interval", value: `${minMatch[1]}m`, label: `Every ${minMatch[1]}m` };
  if (/hourly|every hour/.test(desc)) return { type: "interval", value: "1h", label: "Every hour" };
  if (/daily|every day|once a day/.test(desc)) return { type: "cron", value: "0 9 * * *", label: "Daily at 9 AM" };
  if (/weekly|every week/.test(desc)) return { type: "cron", value: "0 9 * * 1", label: "Weekly on Monday" };
  if (/monitor|watch|track|alert|check|scan/.test(desc)) return { type: "interval", value: "1h", label: "Every hour" };
  if (/morning|every morning/.test(desc)) return { type: "cron", value: "0 8 * * *", label: "Every morning at 8 AM" };
  return { type: "trigger", value: "on_demand", label: "On demand" };
}

export function inferWorkerName(description) {
  const patterns = [
    /(?:monitor|check|watch|track)\s+(?:my\s+|our\s+|the\s+)?(.{3,30}?)(?:\s+and|\s+every|\s+daily|\s+hourly|$)/i,
    /(?:draft|write|create|generate)\s+(?:my\s+|our\s+|the\s+)?(.{3,30}?)(?:\s+and|\s+every|\s+daily|\s+hourly|$)/i,
    /(?:send|forward|post)\s+(?:my\s+|our\s+|the\s+)?(.{3,30}?)(?:\s+to|\s+and|\s+every|$)/i,
  ];
  for (const pat of patterns) {
    const m = description.match(pat);
    if (m && m[1]) {
      const words = m[1].trim().split(/\s+/).slice(0, 3);
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") + " Worker";
    }
  }
  const words = description.trim().split(/\s+/).filter(w => !["a", "an", "the", "my", "our", "to", "and", "or", "for", "in", "on", "at", "i", "we"].includes(w.toLowerCase())).slice(0, 3);
  if (words.length === 0) return "New Worker";
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") + " Worker";
}

export function scheduleToApiValue(schedule) {
  if (!schedule) return "daily";
  if (schedule.type === "continuous") return "continuous";
  if (schedule.type === "interval") return schedule.value || "1h";
  if (schedule.type === "cron") return schedule.value || "0 9 * * *";
  return "on_demand";
}

/* -- Worker definition parser ------------------------------------- */

const WORKER_DEF_REGEX = /\[WORKER_DEFINITION\]([\s\S]*?)\[\/WORKER_DEFINITION\]/;

export function parseWorkerDefinition(text) {
  const match = text.match(WORKER_DEF_REGEX);
  if (!match) return null;
  const block = match[1];
  const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
  const def = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();
    if (key === "name") def.name = val;
    else if (key === "cando") def.canDo = val.split(",").map(s => s.trim()).filter(Boolean);
    else if (key === "askfirst") def.askFirst = val.split(",").map(s => s.trim()).filter(Boolean);
    else if (key === "neverdo") def.neverDo = val.split(",").map(s => s.trim()).filter(Boolean);
    else if (key === "schedule") def.schedule = val;
    else if (key === "model") def.model = val;
  }
  if (def.name && (def.canDo || def.askFirst || def.neverDo)) return def;
  return null;
}

export function stripWorkerDefinitionBlock(text) {
  return text.replace(WORKER_DEF_REGEX, "").trim();
}

/* ===================================================================
   Style tokens
   =================================================================== */

export const S = {
  shell: { minHeight: "100vh", background: "var(--bg-primary)", color: "var(--text-primary)", fontFamily: "var(--font-body)", WebkitFontSmoothing: "antialiased" },
  authWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" },
  label: { display: "block", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", marginBottom: "0.4rem", letterSpacing: "0.05em", textTransform: "uppercase" },
  input: { display: "block", width: "100%", padding: "0.75rem 1rem", fontSize: "15px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", outline: "none", marginBottom: "1.25rem", fontFamily: "inherit", transition: "border-color 0.15s", boxSizing: "border-box" },
  inputFocus: { borderColor: "var(--accent)" },
  btnPrimary: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.75rem 1.75rem", fontSize: "0.9rem", fontWeight: 600, background: "var(--text-100)", color: "var(--bg-100)", border: "none", borderRadius: 8, cursor: "pointer", letterSpacing: "0.01em", transition: "opacity 0.15s", width: "100%", fontFamily: "inherit" },
  btnSecondary: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.6rem 1.25rem", fontSize: "0.85rem", fontWeight: 600, background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", transition: "border-color 0.15s", fontFamily: "inherit" },
  btnGhost: { background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "0.85rem", fontWeight: 500, padding: 0, fontFamily: "inherit" },
  link: { color: "var(--accent)", textDecoration: "none", fontSize: "0.85rem", fontWeight: 500 },
  error: { fontSize: "0.85rem", color: "var(--red, #c43a3a)", marginBottom: "1rem" },
  success: { fontSize: "0.85rem", color: "var(--green, #2a9d6e)", marginBottom: "1rem" },
  appLayout: { display: "flex", minHeight: "100vh" },
  main: { flex: 1, padding: "clamp(1.25rem, 4vw, 2.5rem) clamp(1rem, 4vw, 3rem)", maxWidth: 960 },
  pageTitle: { fontSize: "clamp(1.4rem, 3vw, 1.75rem)", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.3rem", fontFamily: "var(--font-display, 'Fraunces', serif)" },
  pageSub: { fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "2rem", lineHeight: 1.5 },
  workerRow: { display: "grid", gridTemplateColumns: "1fr auto auto auto auto", alignItems: "center", gap: "1rem", padding: "1rem 0", borderBottom: "1px solid var(--border)", cursor: "pointer", transition: "background 0.1s" },
  workerName: { fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" },
  workerMeta: { fontSize: "13px", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" },
  statusDot: (color) => ({ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, marginRight: 6, verticalAlign: "middle", flexShrink: 0 }),
  charterLabel: { fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" },
  charterItem: { fontSize: "14px", color: "var(--text-secondary)", padding: "0.3rem 0", lineHeight: 1.6 },
  approvalRow: { padding: "1.25rem 0", borderBottom: "1px solid var(--border)" },
  textarea: { display: "block", width: "100%", padding: "0.75rem 1rem", fontSize: "15px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", outline: "none", fontFamily: "inherit", resize: "vertical", minHeight: 120, lineHeight: 1.6, marginBottom: "1.25rem", boxSizing: "border-box" },
  logEntry: { padding: "0.75rem 0", borderBottom: "1px solid var(--border)" },
  logTime: { fontSize: "13px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" },
  logSummary: { fontSize: "14px", color: "var(--text-secondary)", marginTop: "0.2rem", lineHeight: 1.6 },
  logDetail: { fontSize: "13px", color: "var(--text-tertiary)", marginTop: "0.4rem", lineHeight: 1.6, whiteSpace: "pre-wrap", padding: "0.75rem 1rem", background: "var(--bg-surface)", borderRadius: 6 },
  backLink: { display: "inline-block", fontSize: "13px", fontWeight: 500, color: "var(--text-secondary)", marginBottom: "2rem", cursor: "pointer", background: "none", border: "none", padding: 0, fontFamily: "inherit" },
  pricingWrap: { minHeight: "100vh", padding: "6rem 2rem 4rem", maxWidth: 1100, margin: "0 auto" },
  pricingTitle: { fontSize: "clamp(2rem, 5vw, 3rem)", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.75rem", lineHeight: 1.1 },
  tier: { padding: "2.5rem 0", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3rem", alignItems: "start" },
  tierName: { fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.3rem" },
  tierPrice: { fontSize: "15px", color: "var(--text-secondary)", marginBottom: "1rem" },
  tierFeature: { fontSize: "14px", color: "var(--text-secondary)", padding: "0.25rem 0", lineHeight: 1.6 },
};
