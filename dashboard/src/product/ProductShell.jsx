import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  decideApprovalInboxItem,
  DEFAULT_AUTH_BASE_URL,
  fetchApprovalInbox,
  fetchTenantSettings,
  fetchWorkOrderReceipts,
  fetchWorkOrderReceiptDetail,
  formatDateTime,
  formatCurrency,
  generateBrowserEd25519KeypairPem,
  loadRuntimeConfig,
  loadStoredBuyerPasskeyBundle,
  PRODUCT_RUNTIME_STORAGE_KEY,
  requestJson,
  saveStoredBuyerPasskeyBundle,
  signBrowserPasskeyChallengeBase64Url,
  touchStoredBuyerPasskeyBundle,
  updateTenantSettings,
} from "./api.js";
import "./product.css";
// BI engine removed — the AI harness handles all industries dynamically.
// Stubs for legacy OnboardingFlow (to be removed):
function identifyIndustry() { return { industry: "general", confidence: 0 }; }
function proposeTeam() { return { teamName: "Your Team", workers: [] }; }
function identifyIntegrations() { return { required: [], optional: [] }; }

/* ===================================================================
   Constants & helpers
   =================================================================== */

const ONBOARDING_STORAGE_KEY = "nooterra_product_onboarding_v1";
const THEME_STORAGE_KEY = "nooterra_theme";
const SIDEBAR_STORAGE_KEY = "nooterra_sidebar_collapsed";
const AUTH_BASE = "/__magic";
const WORKER_API_BASE = "/__nooterra";

const ALL_MODELS = [
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

const MODEL_CATEGORIES = [
  { key: "free", label: "Free" },
  { key: "fast", label: "Fast & Cheap" },
  { key: "best", label: "Best Quality" },
  { key: "specialized", label: "Specialized" },
];

const STARTER_TEMPLATES = [
  {
    id: "support-monitor", name: "Support Monitor",
    description: "Watch your inbox and draft replies for common questions.",
    charter: { canDo: ["Read incoming emails", "Categorize by topic", "Draft reply templates", "Search knowledge base"], askFirst: ["Send replies to customers", "Forward to team members", "Issue refunds"], neverDo: ["Delete emails", "Share customer data", "Make commitments about features"] },
    schedule: { type: "continuous" }, model: "google/gemini-3-flash",
  },
  {
    id: "price-tracker", name: "Price Tracker",
    description: "Monitor competitor pricing pages daily and alert you on changes.",
    charter: { canDo: ["Check competitor websites", "Compare current vs previous prices", "Send alerts to Slack"], askFirst: ["Adjust your prices", "Send alerts to customers"], neverDo: ["Access payment systems", "Share competitor data externally"] },
    schedule: { type: "cron", value: "0 9 * * *" }, model: "google/gemini-3-flash",
  },
  {
    id: "inbox-summary", name: "Inbox Summary",
    description: "Summarize your emails every morning and send a digest.",
    charter: { canDo: ["Read all emails from the last 24 hours", "Categorize by priority", "Generate summary"], askFirst: ["Send digest to Slack or email", "Archive processed emails"], neverDo: ["Delete emails", "Reply on your behalf", "Forward to external contacts"] },
    schedule: { type: "cron", value: "0 8 * * 1-5" }, model: "google/gemini-3-flash",
  },
];

const WORK_FUNCTIONS = [
  { value: "founder", label: "Founder / CEO" },
  { value: "engineer", label: "Engineering" },
  { value: "ops", label: "Operations" },
  { value: "designer", label: "Design" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Other" },
];

function cls(...args) { return args.filter(Boolean).join(" "); }

function timeAgo(dateStr) {
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

function saveRuntime(config) {
  try { localStorage.setItem(PRODUCT_RUNTIME_STORAGE_KEY, JSON.stringify(config)); } catch { /* ignore */ }
}

function loadOnboardingState() {
  try { return JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) || "null") || null; } catch { return null; }
}

function saveOnboardingState(state) {
  try { localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function loadTheme() {
  try { return localStorage.getItem(THEME_STORAGE_KEY) || "light"; } catch { return "light"; }
}

function saveTheme(theme) {
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* ignore */ }
  applyTheme(theme);
}

function applyTheme(theme) {
  if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else if (theme === "auto") document.documentElement.setAttribute("data-theme", "auto");
  else document.documentElement.removeAttribute("data-theme");
}

function loadSidebarCollapsed() {
  try { return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true"; } catch { return false; }
}

function saveSidebarCollapsed(collapsed) {
  try { localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "true" : "false"); } catch { /* ignore */ }
}

function navigate(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function getInitials(email) {
  const name = typeof localStorage !== "undefined" ? localStorage.getItem("nooterra_user_name") : null;
  if (name) return name.charAt(0).toUpperCase();
  if (!email) return "?";
  return email.charAt(0).toUpperCase();
}

function tierLabel(tier) {
  if (tier === "pro") return "Pro";
  if (tier === "scale") return "Scale";
  return "Free";
}

function tierColor(tier) {
  if (tier === "pro") return "var(--accent)";
  if (tier === "scale") return "#5bb98c";
  return "var(--text-tertiary)";
}

/* -- Worker API helpers ------------------------------------------- */

async function workerApiRequest({ pathname, method = "GET", body = null }) {
  const runtime = loadRuntimeConfig();
  return requestJson({
    baseUrl: WORKER_API_BASE, pathname, method,
    headers: { "x-tenant-id": runtime.tenantId, "content-type": "application/json" },
    body, credentials: "include",
  });
}

/* -- Auth helpers ------------------------------------------------- */

async function authRequest({ pathname, method = "POST", body = null }) {
  return requestJson({
    baseUrl: AUTH_BASE, pathname, method,
    headers: { "content-type": "application/json" },
    body, credentials: "include",
  });
}

async function fetchSessionPrincipal() {
  return authRequest({ pathname: "/v1/buyer/me", method: "GET" });
}

async function logoutSession() {
  try { await authRequest({ pathname: "/v1/buyer/logout", method: "POST" }); } catch { /* ignore */ }
}

/* -- Template deploy helper --------------------------------------- */

function templateScheduleToApiValue(schedule) {
  if (!schedule) return "daily";
  if (schedule.type === "continuous") return "continuous";
  if (schedule.type === "interval") return schedule.value || "1h";
  if (schedule.type === "cron") return schedule.value || "0 9 * * *";
  return "on_demand";
}

/* ===================================================================
   Style tokens
   =================================================================== */

const S = {
  shell: { minHeight: "100vh", background: "var(--bg-primary)", color: "var(--text-primary)", fontFamily: "var(--font-body)", WebkitFontSmoothing: "antialiased" },
  authWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" },
  label: { display: "block", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", marginBottom: "0.4rem", letterSpacing: "0.05em", textTransform: "uppercase" },
  input: { display: "block", width: "100%", padding: "0.75rem 1rem", fontSize: "15px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", outline: "none", marginBottom: "1.25rem", fontFamily: "inherit", transition: "border-color 0.15s", boxSizing: "border-box" },
  inputFocus: { borderColor: "var(--accent)" },
  btnPrimary: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.75rem 1.75rem", fontSize: "0.9rem", fontWeight: 600, background: "#1a1a1a", color: "#ffffff", border: "none", borderRadius: 8, cursor: "pointer", letterSpacing: "0.01em", transition: "opacity 0.15s", width: "100%", fontFamily: "inherit" },
  btnSecondary: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.6rem 1.25rem", fontSize: "0.85rem", fontWeight: 600, background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", transition: "border-color 0.15s", fontFamily: "inherit" },
  btnGhost: { background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "0.85rem", fontWeight: 500, padding: 0, fontFamily: "inherit" },
  link: { color: "var(--accent)", textDecoration: "none", fontSize: "0.85rem", fontWeight: 500 },
  error: { fontSize: "0.85rem", color: "#c97055", marginBottom: "1rem" },
  success: { fontSize: "0.85rem", color: "#5bb98c", marginBottom: "1rem" },
  appLayout: { display: "flex", minHeight: "100vh" },
  main: { flex: 1, padding: "2.5rem 3rem", maxWidth: 960 },
  pageTitle: { fontSize: "clamp(1.4rem, 3vw, 1.75rem)", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.3rem" },
  pageSub: { fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "2rem", lineHeight: 1.5 },
  workerRow: { display: "grid", gridTemplateColumns: "1fr auto auto auto auto", alignItems: "center", gap: "1.5rem", padding: "1rem 0", borderBottom: "1px solid var(--border)", cursor: "pointer", transition: "background 0.1s" },
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

const STATUS_COLORS = {
  running: "#5bb98c",
  paused: "var(--accent)",
  ready: "var(--text-tertiary)",
  error: "#c97055",
};

/* ===================================================================
   FocusInput
   =================================================================== */

function FocusInput({ style, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      style={{ ...S.input, ...style, ...(focused ? S.inputFocus : {}) }}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

/* ===================================================================
   Inline SVG icons
   =================================================================== */

function SidebarToggleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" style={{ display: "block" }}>
      <path d="M3 4h12M3 9h12M3 14h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" style={{ display: "block" }}>
      <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ display: "block" }}>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SendArrow({ disabled, onClick }) {
  return (
    <button
      onClick={onClick} disabled={disabled} aria-label="Send"
      style={{
        width: 32, height: 32, borderRadius: "50%",
        background: disabled ? "var(--bg-hover)" : "var(--text-primary)",
        border: "none", cursor: disabled ? "default" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, transition: "opacity 150ms",
        opacity: disabled ? 0.3 : 1,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ display: "block" }}>
        <path d="M8 12V4M4 8l4-4 4 4" stroke={disabled ? "var(--text-tertiary)" : "var(--bg-primary)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function CloseIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" style={{ display: "block" }}>
      <path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function NooterraLogo({ height = 24, style: extraStyle }) {
  return (
    <svg viewBox="0 0 2172 724" fill="currentColor" style={{ height, width: "auto", display: "block", ...extraStyle }}>
      <path d="M0 0 C26.82470779 -0.51238206 48.35993864 8.34450534 67.94287109 26.45019531 C75.77680499 34.05522277 82.40238135 42.89909015 88.9765625 51.5859375 C92.11919943 55.73683711 95.33317141 59.83149753 98.5390625 63.93359375 C103.08579633 69.75984763 107.56435892 75.62989524 111.9765625 81.55859375 C116.70169946 87.89406357 121.55140725 94.09078243 126.6640625 100.12109375 C127.36789062 100.971875 128.07171875 101.82265625 128.796875 102.69921875 C136.21349966 111.36523896 145.07632687 118.70097111 155.6640625 123.12109375 C156.40011719 123.49105469 157.13617187 123.86101562 157.89453125 124.2421875 C169.05673162 129.24354549 183.27353069 128.85830137 194.7890625 125.05859375 C207.67429698 120.08338391 216.587739 112.08652183 222.62109375 99.7109375 C227.48411387 87.63534821 227.52914293 72.25782465 222.6640625 60.12109375 C216.01039096 46.75965577 206.30399199 39.85163693 192.5 35.01171875 C180.88091103 32.31400767 166.27017229 32.35729644 155.6640625 38.12109375 C154.85582031 38.52199219 154.04757812 38.92289062 153.21484375 39.3359375 C142.3473334 45.22179476 133.8643998 54.26647032 126.6015625 64.1015625 C125.9621875 64.76800781 125.3228125 65.43445313 124.6640625 66.12109375 C120.6640625 66.12109375 120.6640625 66.12109375 119.12890625 64.79296875 C118.62488281 64.15875 118.12085938 63.52453125 117.6015625 62.87109375 C114.01447146 58.51199834 110.24350306 54.37508458 106.39624023 50.24707031 C104.26982944 47.94682101 102.40688231 45.73532347 100.6640625 43.12109375 C101.10833159 37.66145927 106.0683126 34.18839809 109.7265625 30.55859375 C110.53206543 29.75663574 111.33756836 28.95467773 112.16748047 28.12841797 C132.03498754 8.79797573 154.2292148 -0.27547494 182.04858398 -0.25170898 C194.651332 0.02499806 206.53515251 3.15559695 217.6640625 9.12109375 C218.62570312 9.61222656 219.58734375 10.10335938 220.578125 10.609375 C239.87753877 21.05699046 253.35834006 38.64037229 259.9375 59.46484375 C265.26463291 78.94038344 262.43145853 100.38883528 252.80322266 117.90307617 C249.84715865 123.0348852 246.49675819 127.62344845 242.6640625 132.12109375 C242.03177734 132.98541016 242.03177734 132.98541016 241.38671875 133.8671875 C230.3163981 148.43694082 210.33522217 156.9562848 192.8125 159.58203125 C186.48774773 160.35321835 180.15449687 160.44926358 173.7890625 160.49609375 C172.09620117 160.51687988 172.09620117 160.51687988 170.36914062 160.53808594 C160.69818308 160.48407412 152.19090575 158.76446917 143.66796875 154.1328125 C141.50385858 153.04021107 139.32893435 152.28917132 137.0390625 151.49609375 C120.89870879 145.11904742 106.88667542 130.73143304 96.6640625 117.12109375 C95.35018909 115.44150833 94.02710563 113.76942567 92.70361328 112.09741211 C85.09379595 102.47415847 77.57950415 92.78499827 70.3515625 82.87109375 C48.71788768 51.05893033 48.71788768 51.05893033 15.6640625 34.12109375 C3.45829074 33.00036536 -8.58588928 32.63334535 -19.3359375 39.12109375 C-20.3878125 39.69859375 -21.4396875 40.27609375 -22.5234375 40.87109375 C-32.13524281 48.560538 -37.42648281 56.39272968 -41.3359375 68.12109375 C-42.66989133 83.78079178 -41.34219937 97.46919719 -31.3359375 110.12109375 C-29.06520141 112.80852881 -29.06520141 112.80852881 -26.3359375 115.12109375 C-25.70042969 115.68699219 -25.06492187 116.25289063 -24.41015625 116.8359375 C-18.8143425 121.53721619 -13.29111459 124.00033484 -6.3359375 126.12109375 C-4.8509375 126.61609375 -4.8509375 126.61609375 -3.3359375 127.12109375 C13.19549418 128.35346885 28.4168698 125.84685885 41.6640625 115.12109375 C47.47572052 109.89368608 52.87324757 104.30498252 57.6640625 98.12109375 C61.06159401 99.54495358 62.79231258 101.19660918 65.01171875 104.11328125 C65.61693359 104.90089844 66.22214844 105.68851562 66.84570312 106.5 C67.46638672 107.32371094 68.08707031 108.14742188 68.7265625 108.99609375 C69.35111328 109.81207031 69.97566406 110.62804687 70.61914062 111.46875 C72.30916457 113.68003 73.98990856 115.89778383 75.6640625 118.12109375 C76.50831787 119.16692627 76.50831787 119.16692627 77.36962891 120.23388672 C78.6640625 122.12109375 78.6640625 122.12109375 78.58984375 124.57421875 C75.16152126 134.00572197 64.61448399 140.72004696 56.6640625 146.12109375 C55.73980469 146.75015625 54.81554687 147.37921875 53.86328125 148.02734375 C34.26116223 160.39050595 8.22584593 164.02448785 -14.33984375 158.9921875 C-19.13787114 157.69476399 -23.75287145 156.03740499 -28.3359375 154.12109375 C-29.50125 153.6415625 -30.6665625 153.16203125 -31.8671875 152.66796875 C-38.83661404 149.46484847 -44.64702585 145.23312669 -50.3359375 140.12109375 C-51.25503906 139.29609375 -52.17414062 138.47109375 -53.12109375 137.62109375 C-59.94981991 131.1586954 -64.88310008 124.38227897 -69.3359375 116.12109375 C-70.18671875 114.57808594 -70.18671875 114.57808594 -71.0546875 113.00390625 C-80.58382107 94.27261918 -80.72072288 71.76113641 -74.33984375 52.04296875 C-71.25072044 43.87656663 -66.57940522 37.01758688 -61.3359375 30.12109375 C-60.71976563 29.30640625 -60.10359375 28.49171875 -59.46875 27.65234375 C-48.20182337 13.91926579 -29.77661541 3.35864671 -12.3359375 0.65625 C-8.2257669 0.25725737 -4.12512005 0.14974089 0 0 Z " transform="translate(749.3359375,289.87890625)"/>
      <path d="M0 0 C11.8480311 11.01441214 17.01089326 25.95698704 17.71753693 41.85995865 C17.8888242 48.83558456 17.83899388 55.8120426 17.8046875 62.7890625 C17.80095078 65.03492608 17.79810693 67.2807913 17.79611206 69.5266571 C17.7885275 75.39721286 17.76892422 81.26766743 17.7467041 87.13818359 C17.72613335 93.14484285 17.71708647 99.15151869 17.70703125 105.15820312 C17.68567282 116.91411379 17.65053364 128.66992322 17.609375 140.42578125 C5.729375 140.42578125 -6.150625 140.42578125 -18.390625 140.42578125 C-18.720625 134.81578125 -19.050625 129.20578125 -19.390625 123.42578125 C-21.040625 125.40578125 -22.690625 127.38578125 -24.390625 129.42578125 C-27.56358354 132.00699833 -30.96411354 134.19582935 -34.390625 136.42578125 C-35.999375 137.53953125 -35.999375 137.53953125 -37.640625 138.67578125 C-48.86139082 144.70174808 -66.13974397 145.71366235 -78.3984375 142.51171875 C-91.17274261 138.23522352 -102.69282893 130.38613138 -109.390625 118.42578125 C-114.91648242 106.12563195 -118.18726709 92.82640627 -113.890625 79.61328125 C-107.87944638 65.5378102 -97.37754853 56.09925785 -83.390625 50.42578125 C-67.67696368 45.09163027 -51.91021574 45.2762681 -35.515625 45.36328125 C-33.84505344 45.36831211 -32.1744804 45.37287218 -30.50390625 45.37695312 C-26.46610818 45.38781966 -22.42838368 45.40499444 -18.390625 45.42578125 C-18.69520945 43.33014253 -19.00475017 41.23522373 -19.31640625 39.140625 C-19.57417847 37.39060181 -19.57417847 37.39060181 -19.8371582 35.60522461 C-20.91325514 29.42348202 -23.42734048 25.64183763 -28.26953125 21.81640625 C-37.05343912 16.05752742 -47.16343531 15.02714805 -57.390625 16.42578125 C-65.52830792 18.3843716 -72.41069167 21.50745614 -77.390625 28.42578125 C-78.84132464 31.1574646 -78.84132464 31.1574646 -79.390625 33.42578125 C-86.83424586 32.80931327 -93.69969597 30.77972604 -100.828125 28.61328125 C-102.02373047 28.26974609 -103.21933594 27.92621094 -104.45117188 27.57226562 C-105.58490234 27.22873047 -106.71863281 26.88519531 -107.88671875 26.53125 C-108.91982178 26.22340576 -109.9529248 25.91556152 -111.01733398 25.59838867 C-113.390625 24.42578125 -113.390625 24.42578125 -114.30224609 22.44702148 C-114.55356466 16.69932429 -108.56381524 10.77234936 -105.01171875 6.6953125 C-79.06225591 -20.14755908 -29.66308359 -22.76170143 0 0 Z " transform="translate(1628.390625,303.57421875)"/>
      <path d="M0 0 C16.09066572 13.88878515 22.29079914 31.3441877 25.22265625 51.8671875 C25.22265625 59.1271875 25.22265625 66.3871875 25.22265625 73.8671875 C-10.08734375 73.8671875 -45.39734375 73.8671875 -81.77734375 73.8671875 C-78.30522473 92.75256143 -78.30522473 92.75256143 -66.34375 106.70703125 C-56.15101644 113.05227939 -45.54809203 114.34073506 -33.77734375 112.8671875 C-23.69678868 110.50243645 -15.18566121 104.84166114 -9.33984375 96.3671875 C-6.77734375 93.8671875 -6.77734375 93.8671875 -4.88574219 93.7890625 C-4.16418945 93.89734375 -3.44263672 94.005625 -2.69921875 94.1171875 C-1.89943604 94.23126953 -1.09965332 94.34535156 -0.27563477 94.46289062 C0.54880127 94.59630859 1.3732373 94.72972656 2.22265625 94.8671875 C3.38873413 95.04411133 3.38873413 95.04411133 4.57836914 95.22460938 C6.90089238 95.58631982 9.21796492 95.97285502 11.53515625 96.3671875 C12.31955078 96.49738281 13.10394531 96.62757813 13.91210938 96.76171875 C17.39117828 97.34698268 20.80629274 97.97840849 24.22265625 98.8671875 C23.23555756 109.90600952 15.38068569 120.5798837 7.22265625 127.8671875 C-1.16244985 134.16897305 -9.75376493 138.65207731 -19.77734375 141.8671875 C-20.64746094 142.18558594 -21.51757812 142.50398437 -22.4140625 142.83203125 C-41.34576483 148.82937345 -62.63542708 145.22638748 -80.27734375 137.0546875 C-99.05979538 126.87330338 -111.16558165 110.02951899 -117.24633789 89.88305664 C-119.25961252 82.2400182 -119.0279164 74.26511445 -119.07250977 66.41577148 C-119.0839637 65.02081099 -119.10431001 63.625892 -119.1340332 62.23120117 C-119.42292345 48.60494218 -117.34597743 36.14183292 -110.58984375 24.0546875 C-110.20183594 23.3438501 -109.81382813 22.6330127 -109.4140625 21.90063477 C-105.96001487 15.78850249 -101.85608892 10.72318069 -96.77734375 5.8671875 C-95.76800781 4.82884766 -95.76800781 4.82884766 -94.73828125 3.76953125 C-69.86910279 -20.40107478 -26.96235445 -20.70526797 0 0 Z " transform="translate(1253.77734375,303.1328125)"/>
      <path d="M0 0 C10.54959573 9.54973075 16.85456711 23.78759695 18.05391693 37.87115288 C18.3893869 45.07145299 18.29173783 52.27499339 18.22265625 59.48046875 C18.21518052 61.79073086 18.2094939 64.10099938 18.20550537 66.41127014 C18.19035391 72.44304423 18.15116407 78.47442286 18.10668945 84.50604248 C18.06550868 90.68040622 18.04744597 96.8548349 18.02734375 103.02929688 C17.98465829 115.10827315 17.91439587 127.18685406 17.83203125 139.265625 C5.95203125 139.265625 -5.92796875 139.265625 -18.16796875 139.265625 C-18.17731445 136.41510498 -18.18666016 133.56458496 -18.19628906 130.62768555 C-18.2301476 121.18000099 -18.28574587 111.73253281 -18.35187149 102.28502178 C-18.39127894 96.56036466 -18.4235005 90.83585982 -18.43896484 85.11108398 C-18.45417565 79.58010313 -18.48869993 74.04954111 -18.53627777 68.51874733 C-18.55104596 66.41502345 -18.55900713 64.31123976 -18.5598526 62.20746422 C-18.31629797 43.02452355 -18.31629797 43.02452355 -27.453125 26.69921875 C-35.94906294 19.59669205 -46.20815329 19.31081487 -56.77099609 19.95751953 C-65.78193036 21.11577977 -73.04576786 27.11858136 -78.5859375 34.01171875 C-84.65778133 42.66222219 -86.45721742 51.6428887 -86.48681641 62.09008789 C-86.50188484 63.3356395 -86.50188484 63.3356395 -86.51725769 64.60635376 C-86.54784109 67.31699 -86.5650549 70.02752866 -86.58203125 72.73828125 C-86.60076294 74.63114752 -86.62033782 76.52400561 -86.64071655 78.41685486 C-86.69183241 83.37331298 -86.73156755 88.32979812 -86.76885986 93.28637695 C-86.80902897 98.35439625 -86.86006216 103.42230518 -86.91015625 108.49023438 C-87.00667204 118.41529439 -87.09014867 128.34040077 -87.16796875 138.265625 C-98.71796875 138.265625 -110.26796875 138.265625 -122.16796875 138.265625 C-122.16796875 88.765625 -122.16796875 39.265625 -122.16796875 -11.734375 C-110.61796875 -11.734375 -99.06796875 -11.734375 -87.16796875 -11.734375 C-86.67296875 -3.319375 -86.67296875 -3.319375 -86.16796875 5.265625 C-85.11609375 4.110625 -84.06421875 2.955625 -82.98046875 1.765625 C-60.50249812 -20.51447617 -23.8872565 -19.1098052 0 0 Z " transform="translate(634.16796875,304.734375)"/>
      <path d="M0 0 C11.88 0 23.76 0 36 0 C36 14.19 36 28.38 36 43 C47.55 43 59.1 43 71 43 C71 53.23 71 63.46 71 74 C59.45 74 47.9 74 36 74 C36.03274174 87.08619255 36.03274174 87.08619255 36.11132812 100.171875 C36.15357243 105.51535221 36.19064463 110.85848947 36.19555664 116.20214844 C36.19986033 120.51429204 36.2284928 124.8256723 36.27343178 129.13757706 C36.28634105 130.77600774 36.29073794 132.41453009 36.28615379 134.05300522 C36.26665023 143.14735166 36.33094866 151.37084452 42 159 C47.1846131 163.53653646 51.7820912 163.39719636 58.5234375 163.23828125 C62.69294248 162.95250619 66.84627471 162.46152503 71 162 C71 172.56 71 183.12 71 194 C65.32778561 195.13444288 60.07422298 195.1839889 54.3125 195.1875 C53.27416016 195.19974609 52.23582031 195.21199219 51.16601562 195.22460938 C36.26253624 195.252641 25.20710147 191.76966519 14.2578125 181.38671875 C1.0539493 167.42900177 -0.31488961 150.68475242 -0.1953125 132.3984375 C-0.19157557 130.70879281 -0.18873181 129.01914593 -0.18673706 127.32949829 C-0.17915411 122.91381697 -0.1595524 118.49827027 -0.1373291 114.0826416 C-0.11675474 109.5642275 -0.10771072 105.04579134 -0.09765625 100.52734375 C-0.07630069 91.68482761 -0.041163 82.84244614 0 74 C-9.9 74 -19.8 74 -30 74 C-30 63.77 -30 53.54 -30 43 C-20.1 43 -10.2 43 0 43 C0 28.81 0 14.62 0 0 Z " transform="translate(1049,250)"/>
      <path d="M0 0 C0.90492187 0.00064453 1.80984375 0.00128906 2.7421875 0.00195312 C9.35916241 0.04666241 9.35916241 0.04666241 10.5 1.1875 C10.58855161 3.8537603 10.61524673 6.49397114 10.59765625 9.16015625 C10.5962413 9.95779892 10.59482635 10.75544159 10.59336853 11.57725525 C10.58775316 14.13487435 10.57519812 16.69240718 10.5625 19.25 C10.55748698 20.97981645 10.55292373 22.70963426 10.54882812 24.43945312 C10.53777875 28.68883553 10.52050386 32.93815312 10.5 37.1875 C2.83496094 36.25537109 2.83496094 36.25537109 -0.1796875 35.64453125 C-9.83060076 33.74359379 -18.66366318 35.55702276 -26.98046875 40.73046875 C-35.85693042 47.22797922 -41.50934269 55.58812356 -44.5 66.1875 C-45.41131387 72.87147495 -45.22328438 79.65961893 -45.20703125 86.390625 C-45.22016871 88.32405134 -45.23547916 90.25746402 -45.25285339 92.19085693 C-45.29247673 97.24110244 -45.30287915 102.29098706 -45.30688477 107.34136963 C-45.31625919 112.51024161 -45.35369943 117.6789053 -45.38867188 122.84765625 C-45.45301692 132.96097739 -45.48384726 143.07398697 -45.5 153.1875 C-57.38 153.1875 -69.26 153.1875 -81.5 153.1875 C-81.5 103.3575 -81.5 53.5275 -81.5 2.1875 C-69.62 2.1875 -57.74 2.1875 -45.5 2.1875 C-45.005 11.5925 -45.005 11.5925 -44.5 21.1875 C-42.97375 19.5375 -41.4475 17.8875 -39.875 16.1875 C-28.63610681 4.63393156 -15.99899264 -0.22417468 0 0 Z " transform="translate(1384.5,290.8125)"/>
      <path d="M0 0 C0 12.54 0 25.08 0 38 C-5 37 -5 37 -8 36 C-20.25561881 35.01632533 -30.37940325 36.85429127 -39.9296875 44.8984375 C-52.27289586 57.42795844 -52.4544444 72.83128671 -52.51171875 89.328125 C-52.52859583 91.17186657 -52.54675007 93.01559686 -52.56611633 94.85931396 C-52.61329385 99.67271392 -52.64331066 104.48606807 -52.66955566 109.29962158 C-52.69952532 114.22718345 -52.74599861 119.15458795 -52.79101562 124.08203125 C-52.87668124 133.72128921 -52.94265993 143.36053189 -53 153 C-64.55 153 -76.1 153 -88 153 C-88 103.5 -88 54 -88 3 C-76.45 3 -64.9 3 -53 3 C-52.505 12.405 -52.505 12.405 -52 22 C-50.6078125 20.2675 -50.6078125 20.2675 -49.1875 18.5 C-35.28119913 2.69102617 -20.62520751 0 0 0 Z " transform="translate(1503,290)"/>
    </svg>
  );
}

/* ===================================================================
   AUTH: AuthView (unified sign-up + sign-in, OpenAI-style light page)
   =================================================================== */

const A = {
  wrap: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem 1.5rem", background: "var(--bg-100, #faf9f6)", fontFamily: "var(--font-body, 'Plus Jakarta Sans', system-ui, sans-serif)", WebkitFontSmoothing: "antialiased" },
  inner: { width: "100%", maxWidth: 380, textAlign: "center" },
  heading: { fontSize: 28, fontWeight: 700, color: "var(--text-100, #111110)", marginBottom: "0.75rem", lineHeight: 1.15, letterSpacing: "-0.02em" },
  sub: { fontSize: 15, color: "var(--text-200, #4a4a45)", marginBottom: "2.5rem", lineHeight: 1.5 },
  input: { display: "block", width: "100%", padding: "14px 18px", fontSize: 15, background: "var(--bg-400, #ffffff)", border: "1px solid var(--border, #e5e3dd)", borderRadius: 10, color: "var(--text-100, #111110)", outline: "none", marginBottom: "1rem", fontFamily: "inherit", transition: "border-color 0.2s, box-shadow 0.2s", boxSizing: "border-box" },
  inputFocus: { borderColor: "var(--text-100, #111110)", boxShadow: "0 0 0 1px var(--text-100, #111110)" },
  otpInput: { display: "block", width: "100%", padding: "16px 18px", fontSize: "1.75rem", fontWeight: 700, letterSpacing: "0.5em", textAlign: "center", background: "var(--bg-400, #ffffff)", border: "1px solid var(--border, #e5e3dd)", borderRadius: 10, color: "var(--text-100, #111110)", outline: "none", marginBottom: "1.25rem", fontFamily: "var(--font-mono, monospace)", transition: "border-color 0.2s, box-shadow 0.2s", boxSizing: "border-box" },
  btn: { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "14px 22px", fontSize: 15, fontWeight: 600, background: "var(--text-100, #111110)", color: "var(--bg-100, #faf9f6)", border: "none", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s, transform 0.1s", letterSpacing: "0.01em", marginTop: "0.5rem" },
  error: { fontSize: 14, color: "#c43a3a", marginBottom: "1rem", lineHeight: 1.4, background: "var(--red-bg, #c43a3a14)", border: "1px solid rgba(196,58,58,0.2)", borderRadius: 10, padding: "10px 16px", textAlign: "left" },
  divider: { display: "flex", alignItems: "center", gap: "1rem", margin: "1.5rem 0", color: "var(--text-300, #8a8a82)", fontSize: 13 },
  dividerLine: { flex: 1, height: 1, background: "var(--border, #e5e3dd)" },
  links: { display: "flex", justifyContent: "center", gap: "0.5rem", marginTop: "3rem", alignItems: "center" },
  link: { fontSize: 13, color: "var(--text-300, #8a8a82)", textDecoration: "none", cursor: "pointer", background: "none", border: "none", fontFamily: "inherit", padding: 0 },
  linkSep: { fontSize: 13, color: "var(--border, #e5e3dd)" },
  resend: { fontSize: 14, color: "var(--text-200, #4a4a45)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0, marginTop: "1.5rem", textAlign: "center", width: "100%", textDecoration: "underline", textUnderlineOffset: "2px" },
};

function AuthInput({ style, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      style={{ ...A.input, ...style, ...(focused ? A.inputFocus : {}) }}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

function AuthView({ onAuth }) {
  const [step, setStep] = useState("form");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [isNewAccount, setIsNewAccount] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      // Handle Google OAuth callback
      const params = new URLSearchParams(window.location.search);
      const googleAuth = params.get("google_auth");
      const googleTenant = params.get("tenant");
      const googleError = params.get("message");
      if (googleAuth === "error" && googleError) {
        setError(googleError);
        window.history.replaceState({}, "", window.location.pathname);
        return;
      }
      if (googleAuth === "success" && googleTenant) {
        try {
          const principal = await fetchSessionPrincipal();
          if (principal?.ok) {
            saveRuntime({ ...loadRuntimeConfig(), tenantId: googleTenant });
            saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
            if (principal.principal?.email) {
              localStorage.setItem("nooterra_user_name", principal.principal.email.split("@")[0]);
            }
            window.history.replaceState({}, "", window.location.pathname);
            onAuth?.("dashboard");
            return;
          }
        } catch { /* session not established */ }
        setError("Google sign-in session failed. Please try again.");
        window.history.replaceState({}, "", window.location.pathname);
        return;
      }

      // Try passkey auto-login
      try {
        const stored = loadStoredBuyerPasskeyBundle({});
        if (!stored?.tenantId || !stored?.email) return;
        const tid = stored.tenantId; const em = stored.email;
        const optionsResp = await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey/options`, body: { email: em } });
        if (optionsResp?.challenge && optionsResp?.challengeId) {
          const signature = await signBrowserPasskeyChallengeBase64Url({ privateKeyPem: stored.privateKeyPem, challenge: optionsResp.challenge });
          await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey`, body: { challengeId: optionsResp.challengeId, challenge: optionsResp.challenge, credentialId: stored.credentialId, publicKeyPem: stored.publicKeyPem, signature } });
          touchStoredBuyerPasskeyBundle({ tenantId: tid, email: em });
          const principal = await fetchSessionPrincipal();
          saveRuntime({ ...loadRuntimeConfig(), tenantId: tid });
          saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
          onAuth?.("dashboard");
        }
      } catch { /* no stored passkey or it failed */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleContinue(e) {
    e.preventDefault(); setError(""); setLoading(true);
    const em = email.trim();
    try {
      const result = await authRequest({ pathname: "/v1/public/signup", body: { email: em, company: em.split("@")[0] } });
      const tid = result?.tenantId;
      if (!tid) { setError("Something went wrong. Please try again."); setLoading(false); return; }
      setTenantId(tid);
      const storedPasskey = loadStoredBuyerPasskeyBundle({ tenantId: tid, email: em });
      if (storedPasskey) {
        try {
          const optionsResp = await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey/options`, body: { email: em } });
          if (optionsResp?.challenge && optionsResp?.challengeId) {
            const signature = await signBrowserPasskeyChallengeBase64Url({ privateKeyPem: storedPasskey.privateKeyPem, challenge: optionsResp.challenge });
            await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey`, body: { challengeId: optionsResp.challengeId, challenge: optionsResp.challenge, credentialId: storedPasskey.credentialId, publicKeyPem: storedPasskey.publicKeyPem, signature } });
            touchStoredBuyerPasskeyBundle({ tenantId: tid, email: em });
            const principal = await fetchSessionPrincipal();
            saveRuntime({ ...loadRuntimeConfig(), tenantId: tid });
            saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
            onAuth?.("dashboard");
            return;
          }
        } catch { /* passkey failed, fall through to OTP */ }
      }
      const newAccount = !!result?.otpIssued;
      setIsNewAccount(newAccount);
      if (!newAccount) await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/otp`, body: { email: em } });
      setStep("otp");
    } catch (err) { setError(err?.message || "Something went wrong. Please try again."); }
    finally { setLoading(false); }
  }

  async function handleVerify(e) {
    e.preventDefault(); setError(""); setLoading(true);
    const tid = tenantId.trim(); const em = email.trim();
    try {
      await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login`, body: { email: em, code: otpCode.trim() } });
      const principal = await fetchSessionPrincipal();
      const runtime = loadRuntimeConfig();
      saveRuntime({ ...runtime, tenantId: tid });
      saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
      if (isNewAccount && fullName.trim()) {
        try {
          await updateTenantSettings({ ...runtime, tenantId: tid }, { displayName: fullName.trim(), callMe: fullName.trim().split(" ")[0] });
          localStorage.setItem("nooterra_user_name", fullName.trim());
        } catch { /* non-fatal */ }
      }
      try {
        const keypair = await generateBrowserEd25519KeypairPem();
        const optionsResp = await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey/options`, body: { email: em, company: em.split("@")[0] } });
        if (optionsResp?.challenge && optionsResp?.challengeId) {
          const signature = await signBrowserPasskeyChallengeBase64Url({ privateKeyPem: keypair.privateKeyPem, challenge: optionsResp.challenge });
          await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey`, body: { challengeId: optionsResp.challengeId, challenge: optionsResp.challenge, credentialId: keypair.keyId, publicKeyPem: keypair.publicKeyPem, signature, label: "Browser passkey" } });
          saveStoredBuyerPasskeyBundle({ tenantId: tid, email: em, credentialId: keypair.keyId, publicKeyPem: keypair.publicKeyPem, privateKeyPem: keypair.privateKeyPem, keyId: keypair.keyId, label: "Browser passkey", createdAt: new Date().toISOString() });
        }
      } catch { /* Passkey registration is optional */ }
      onAuth?.(isNewAccount ? "builder" : "dashboard");
    } catch (err) { setError(err?.message || "Invalid code. Please try again."); }
    finally { setLoading(false); }
  }

  async function handleResend() {
    setError("");
    const em = email.trim(); const tid = tenantId.trim();
    try {
      if (isNewAccount) await authRequest({ pathname: "/v1/public/signup", body: { email: em, company: em.split("@")[0] } });
      else await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/otp`, body: { email: em } });
    } catch { /* ignore */ }
  }

  if (step === "otp") {
    return (
      <div style={A.wrap}>
        <div style={A.inner} className="lovable-fade">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "3rem" }}>
            <img src="/nooterra-logo.png" alt="nooterra" style={{ height: 24 }} />
          </div>
          <h1 style={A.heading}>Enter your code</h1>
          <p style={A.sub}>We sent a verification code to <strong style={{ color: "#1a1a1a" }}>{email}</strong>.</p>
          {error && <div style={A.error}>{error}</div>}
          <form onSubmit={handleVerify}>
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000" required autoFocus={!isNewAccount}
              style={{ ...A.otpInput, ...(otpCode.length === 6 ? { borderColor: "#1a1a1a" } : {}) }}
            />
            <button type="submit" style={{ ...A.btn, opacity: loading || otpCode.length < 6 ? 0.5 : 1 }} disabled={loading || otpCode.length < 6}>
              {loading ? "Verifying..." : "Verify"}
            </button>
          </form>
          <div style={{ textAlign: "center" }}>
            <button style={A.resend} onClick={handleResend}>Resend code</button>
          </div>
        </div>
      </div>
    );
  }

  const socialBtnStyle = { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%", padding: "13px 20px", fontSize: 15, fontWeight: 500, background: "var(--bg-400, #ffffff)", color: "var(--text-100, #111110)", border: "1px solid var(--border, #e5e3dd)", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", transition: "background 0.15s, border-color 0.15s", marginBottom: "0.6rem" };
  return (
    <div style={A.wrap}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "1.5rem 1.5rem" }}>
        <img src="/nooterra-logo.png" alt="nooterra" style={{ height: 24 }} />
      </div>
      <div style={A.inner} className="lovable-fade">
        <h1 style={A.heading}>Log in or sign up</h1>
        <p style={A.sub}>Your AI team is one description away.</p>
        {error && <div style={A.error}>{error}</div>}
        <button style={socialBtnStyle} onClick={() => { window.location.href = `${AUTH_BASE}/v1/public/buyer/google/start?redirect=${encodeURIComponent(window.location.origin + "/signup")}`; }} onMouseOver={(e) => { e.currentTarget.style.background = "var(--bg-200, #f3f1ec)"; e.currentTarget.style.borderColor = "var(--border-strong, #d4d1c9)"; }} onMouseOut={(e) => { e.currentTarget.style.background = "var(--bg-400, #ffffff)"; e.currentTarget.style.borderColor = "var(--border, #e5e3dd)"; }}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          Continue with Google
        </button>
        <div style={A.divider}><div style={A.dividerLine} /><span>OR</span><div style={A.dividerLine} /></div>
        <form onSubmit={handleContinue}>
          <AuthInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" required autoFocus />
          <button type="submit" style={{ ...A.btn, opacity: loading || !email.trim() ? 0.5 : 1 }} disabled={loading || !email.trim()}>
            {loading ? "One moment..." : "Continue"}
          </button>
        </form>
        <div style={A.links}>
          <a href="/terms" style={A.link}>Terms of Use</a>
          <span style={A.linkSep}>|</span>
          <a href="/privacy" style={A.link}>Privacy Policy</a>
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   BUILDER: Inference logic
   =================================================================== */

const CAPABILITY_CATALOG = {
  browser:    { id: "browser",    name: "Web Browser",    category: "browsing",      requiredAuth: null,             label: "Browse websites and extract content" },
  slack:      { id: "slack",      name: "Slack",          category: "communication", requiredAuth: "oauth_or_token", label: "Send and read Slack messages" },
  email:      { id: "email",      name: "Email (Gmail)",  category: "communication", requiredAuth: "oauth",          label: "Read and send emails" },
  github:     { id: "github",     name: "GitHub",         category: "development",   requiredAuth: "oauth_or_token", label: "Repos, issues, pull requests" },
  filesystem: { id: "filesystem", name: "File System",    category: "development",   requiredAuth: null,             label: "Read and write local files" },
  webSearch:  { id: "webSearch",  name: "Web Search",     category: "search",        requiredAuth: null,             label: "Search the web" },
  memory:     { id: "memory",     name: "Worker Memory",  category: "core",          requiredAuth: null,             label: "Persistent memory across runs" },
};

function inferCapabilities(taskDescription) {
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

function inferCharterRules(taskDescription, capabilities) {
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

function inferSchedule(taskDescription) {
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

function inferWorkerName(description) {
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

function scheduleToApiValue(schedule) {
  if (!schedule) return "daily";
  if (schedule.type === "continuous") return "continuous";
  if (schedule.type === "interval") return schedule.value || "1h";
  if (schedule.type === "cron") return schedule.value || "0 9 * * *";
  return "on_demand";
}

/* ===================================================================
   BUILDER: Worker definition parser
   =================================================================== */

const WORKER_DEF_REGEX = /\[WORKER_DEFINITION\]([\s\S]*?)\[\/WORKER_DEFINITION\]/;

function parseWorkerDefinition(text) {
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

function stripWorkerDefinitionBlock(text) {
  return text.replace(WORKER_DEF_REGEX, "").trim();
}

/* ===================================================================
   CharterDisplay
   =================================================================== */

function CharterDisplay({ charter, compact = false }) {
  if (!charter) return null;
  const sections = [
    { key: "canDo", label: "Can do", color: "#5bb98c", items: charter.canDo || [] },
    { key: "askFirst", label: "Ask first", color: "var(--accent)", items: charter.askFirst || [] },
    { key: "neverDo", label: "Never do", color: "#c97055", items: charter.neverDo || [] },
  ];
  return (
    <div>
      {sections.map((sec) => sec.items.length > 0 ? (
        <div key={sec.key} style={{ marginBottom: compact ? "0.75rem" : "1.25rem" }}>
          <div style={{ ...S.charterLabel, color: sec.color, fontSize: compact ? "10px" : "11px" }}>{sec.label}</div>
          {sec.items.map((item, i) => (
            <div key={i} style={{ ...S.charterItem, fontSize: compact ? "13px" : "14px" }}>
              <span style={S.statusDot(sec.color)} />{item}
            </div>
          ))}
        </div>
      ) : null)}
    </div>
  );
}

/* ===================================================================
   BuilderMessage
   =================================================================== */

function parseOptionsBlock(text) {
  const optionsMatch = text.match(/\[OPTIONS\]([\s\S]*?)\[\/OPTIONS\]/);
  if (optionsMatch) {
    const options = optionsMatch[1].trim().split('\n').filter(Boolean).map(o => o.trim());
    const displayText = text.replace(/\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/, '').trim();
    return { options, displayText };
  }
  return { options: [], displayText: text };
}

function OptionPicker({ options, onSubmit }) {
  const [selected, setSelected] = useState(new Set());
  function toggle(opt) {
    setSelected(prev => {
      const next = new Set(prev);
      if (opt === "Custom...") { onSubmit?.("Custom..."); return prev; }
      if (next.has(opt)) next.delete(opt); else next.add(opt);
      return next;
    });
  }
  function handleContinue() {
    if (selected.size === 0) return;
    onSubmit?.(Array.from(selected).join(", "));
  }
  return (
    <div style={{ maxWidth: "85%" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {options.filter(o => o !== "Custom...").map((opt, i) => {
          const isSelected = selected.has(opt);
          return (
            <button key={i} onClick={() => toggle(opt)} style={{
              padding: "10px 16px", fontSize: "13px", fontWeight: 500, textAlign: "left",
              color: isSelected ? "var(--text-100, var(--text-primary))" : "var(--text-200, var(--text-secondary))",
              border: isSelected ? "1.5px solid var(--accent)" : "1px solid var(--border)",
              borderRadius: 10, background: isSelected ? "var(--accent-subtle, rgba(196,97,58,0.06))" : "var(--bg-400, var(--bg-surface))",
              cursor: "pointer", fontFamily: "inherit", transition: "all 150ms",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: 5, border: isSelected ? "none" : "1.5px solid var(--border-strong, var(--border))",
                background: isSelected ? "var(--accent)" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 150ms",
              }}>
                {isSelected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
              {opt}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={handleContinue} disabled={selected.size === 0} style={{
          padding: "8px 20px", fontSize: "13px", fontWeight: 600,
          background: selected.size > 0 ? "var(--text-100, #111)" : "var(--bg-300, #eee)",
          color: selected.size > 0 ? "var(--bg-100, #fff)" : "var(--text-300, #999)",
          border: "none", borderRadius: 8, cursor: selected.size > 0 ? "pointer" : "default",
          fontFamily: "inherit", transition: "all 150ms",
        }}>
          Continue {selected.size > 0 && `(${selected.size})`}
        </button>
        {options.includes("Custom...") && (
          <button onClick={() => onSubmit?.("Custom...")} style={{
            padding: "8px 16px", fontSize: "13px", fontWeight: 500,
            color: "var(--text-300, var(--text-tertiary))", background: "none",
            border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
          }}>
            Type my own
          </button>
        )}
      </div>
    </div>
  );
}

function BuilderMessage({ msg, isStreaming, onWorkerDefDetected, onOptionClick }) {
  const isUser = msg.role === "user";
  if (isUser) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }} className="lovable-fade">
        <div style={{ maxWidth: "85%", padding: "10px 14px", borderRadius: "16px 16px 4px 16px", fontSize: "14px", lineHeight: 1.5, color: "#fff", background: "var(--text-primary)", wordBreak: "break-word" }}>{msg.content}</div>
      </div>
    );
  }
  const workerDef = msg.content ? parseWorkerDefinition(msg.content) : null;
  const rawContent = workerDef ? stripWorkerDefinitionBlock(msg.content) : msg.content;
  const { options, displayText } = parseOptionsBlock(rawContent || "");

  // Notify parent when a worker definition is detected (after streaming completes)
  useEffect(() => {
    if (workerDef && !isStreaming) {
      onWorkerDefDetected?.(workerDef);
    }
  }, [workerDef?.name, isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", marginBottom: "0.75rem", gap: 8 }} className="lovable-fade">
      <div style={{ maxWidth: "85%", fontSize: "14px", lineHeight: 1.5, color: "var(--text-primary)", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
        {displayText}
        {isStreaming && <span style={{ display: "inline-block", width: 2, height: "1.1em", background: "var(--text-primary)", marginLeft: 1, verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" }} />}
      </div>
      {options.length > 0 && !isStreaming && (
        <OptionPicker options={options} onSubmit={onOptionClick} />
      )}
    </div>
  );
}

/* ===================================================================
   SchedulePicker
   =================================================================== */

const SCHEDULE_OPTIONS = [
  { label: "Continuous", value: "continuous", type: "continuous" },
  { label: "Hourly", value: "1h", type: "interval" },
  { label: "Daily at 9 AM", value: "0 9 * * *", type: "cron" },
  { label: "On demand", value: "on_demand", type: "trigger" },
  { label: "Custom cron", value: null, type: "custom" },
];

function SchedulePicker({ schedule, onScheduleChange }) {
  const [customCron, setCustomCron] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {SCHEDULE_OPTIONS.map(opt => {
          const isActive = opt.type !== "custom"
            ? (schedule?.label === opt.label || (!schedule && opt.label === "On demand"))
            : showCustom;
          return (
            <button
              key={opt.label}
              onClick={() => {
                if (opt.type === "custom") {
                  setShowCustom(true);
                } else {
                  setShowCustom(false);
                  onScheduleChange({ type: opt.type, value: opt.value, label: opt.label });
                }
              }}
              style={{
                padding: "6px 12px", fontSize: "13px", fontWeight: 500, borderRadius: 6, cursor: "pointer",
                background: isActive ? "var(--text-primary)" : "transparent",
                color: isActive ? "var(--bg-primary)" : "var(--text-secondary)",
                border: isActive ? "1px solid var(--text-primary)" : "1px solid var(--border)",
                transition: "all 150ms", fontFamily: "inherit",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {showCustom && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            value={customCron}
            onChange={e => setCustomCron(e.target.value)}
            placeholder="0 */2 * * *"
            style={{ ...S.input, marginBottom: 0, flex: 1, fontFamily: "var(--font-mono)", fontSize: "13px", padding: "6px 10px" }}
          />
          <button
            onClick={() => {
              if (customCron.trim()) {
                onScheduleChange({ type: "cron", value: customCron.trim(), label: `Cron: ${customCron.trim()}` });
              }
            }}
            style={{ ...S.btnSecondary, padding: "6px 14px", fontSize: "13px" }}
          >
            Set
          </button>
        </div>
      )}
    </div>
  );
}

/* ===================================================================
   CharterEditor — interactive charter editing panel
   =================================================================== */

const CHARTER_SECTIONS = [
  { key: "canDo", label: "Can Do", color: "var(--green)", bg: "var(--green-bg)", icon: "\u2713" },
  { key: "askFirst", label: "Ask First", color: "var(--amber)", bg: "var(--amber-bg)", icon: "?" },
  { key: "neverDo", label: "Never Do", color: "var(--red)", bg: "var(--red-bg)", icon: "\u2717" },
];

const CYCLE_ORDER = ["canDo", "askFirst", "neverDo"];

function CharterEditor({ charter, onCharterChange, workerName, onNameChange, schedule, onScheduleChange, model, onModelChange, onDeploy, deploying }) {
  const [newRuleTexts, setNewRuleTexts] = useState({ canDo: "", askFirst: "", neverDo: "" });

  function cycleRule(fromKey, ruleIndex) {
    const rule = charter[fromKey][ruleIndex];
    const nextIdx = (CYCLE_ORDER.indexOf(fromKey) + 1) % CYCLE_ORDER.length;
    const toKey = CYCLE_ORDER[nextIdx];
    const updated = { ...charter };
    updated[fromKey] = charter[fromKey].filter((_, i) => i !== ruleIndex);
    updated[toKey] = [...(charter[toKey] || []), rule];
    onCharterChange(updated);
  }

  function removeRule(key, index) {
    const updated = { ...charter };
    updated[key] = charter[key].filter((_, i) => i !== index);
    onCharterChange(updated);
  }

  function addRule(key) {
    const text = newRuleTexts[key]?.trim();
    if (!text) return;
    const updated = { ...charter };
    updated[key] = [...(charter[key] || []), text];
    onCharterChange(updated);
    setNewRuleTexts(prev => ({ ...prev, [key]: "" }));
  }

  const pillStyle = (sec) => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 12px",
    borderRadius: 20, fontSize: "13px", lineHeight: 1.4, fontFamily: "var(--font-mono)",
    background: sec.bg, color: sec.color, border: `1px solid ${sec.color}22`,
    cursor: "pointer", transition: "all 150ms", maxWidth: "100%", wordBreak: "break-word",
    userSelect: "none",
  });

  const removeBtn = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 16, height: 16, borderRadius: "50%", background: "transparent", border: "none",
    cursor: "pointer", color: "inherit", fontSize: "12px", fontWeight: 700, padding: 0,
    flexShrink: 0, opacity: 0.6, transition: "opacity 150ms",
  };

  return (
    <div className="lovable-fade" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
      {/* Header: Name + Schedule + Model */}
      <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--green-bg)", border: "1px solid var(--green)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="6" r="3.5" stroke="var(--green)" strokeWidth="1.5" fill="none"/><path d="M2.5 16c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" stroke="var(--green)" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
          </div>
          <input
            value={workerName}
            onChange={e => onNameChange(e.target.value)}
            style={{
              flex: 1, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)",
              background: "transparent", border: "none", outline: "none", fontFamily: "inherit",
              padding: "4px 0", borderBottom: "2px solid transparent",
              transition: "border-color 150ms",
            }}
            onFocus={e => { e.target.style.borderBottomColor = "var(--border)"; }}
            onBlur={e => { e.target.style.borderBottomColor = "transparent"; }}
            placeholder="Worker name"
          />
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Schedule</div>
            <SchedulePicker schedule={schedule} onScheduleChange={onScheduleChange} />
          </div>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Model</div>
            <ModelDropdown model={model} onModelChange={onModelChange} />
          </div>
        </div>
      </div>

      {/* Charter columns */}
      <div style={{ padding: "20px 24px" }}>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>
          Charter Rules
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 8, fontSize: "11px", color: "var(--text-tertiary)" }}>
            Click a rule to cycle its category
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          {CHARTER_SECTIONS.map(sec => {
            const rules = charter[sec.key] || [];
            return (
              <div key={sec.key}>
                <div style={{
                  fontSize: "12px", fontWeight: 700, color: sec.color, textTransform: "uppercase",
                  letterSpacing: "0.05em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, borderRadius: "50%", background: sec.bg, fontSize: "11px", fontWeight: 700,
                  }}>
                    {sec.icon}
                  </span>
                  {sec.label}
                  <span style={{ fontSize: "11px", fontWeight: 500, opacity: 0.6 }}>({rules.length})</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 40 }}>
                  {rules.map((rule, i) => (
                    <div
                      key={`${sec.key}-${i}`}
                      style={pillStyle(sec)}
                      onClick={() => cycleRule(sec.key, i)}
                      title={`Click to move to ${CYCLE_ORDER[(CYCLE_ORDER.indexOf(sec.key) + 1) % 3].replace(/([A-Z])/g, " $1").trim()}`}
                    >
                      <span style={{ flex: 1 }}>{rule}</span>
                      <button
                        style={removeBtn}
                        onClick={e => { e.stopPropagation(); removeRule(sec.key, i); }}
                        onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = "0.6"; }}
                        title="Remove rule"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add new rule input */}
                <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                  <input
                    value={newRuleTexts[sec.key] || ""}
                    onChange={e => setNewRuleTexts(prev => ({ ...prev, [sec.key]: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addRule(sec.key); } }}
                    placeholder="Add rule..."
                    style={{
                      flex: 1, fontSize: "12px", padding: "5px 8px", borderRadius: 6,
                      border: "1px solid var(--border)", background: "var(--bg-primary)",
                      color: "var(--text-primary)", outline: "none", fontFamily: "var(--font-mono)",
                      transition: "border-color 150ms", boxSizing: "border-box",
                    }}
                    onFocus={e => { e.target.style.borderColor = sec.color; }}
                    onBlur={e => { e.target.style.borderColor = "var(--border)"; }}
                  />
                  <button
                    onClick={() => addRule(sec.key)}
                    style={{
                      width: 26, height: 26, borderRadius: 6, border: `1px solid ${sec.color}44`,
                      background: sec.bg, color: sec.color, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "16px", fontWeight: 700, padding: 0, flexShrink: 0,
                    }}
                    title={`Add to ${sec.label}`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Deploy button */}
      <div style={{ padding: "16px 24px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1, fontSize: "12px", color: "var(--text-tertiary)" }}>
          {(charter.canDo?.length || 0) + (charter.askFirst?.length || 0) + (charter.neverDo?.length || 0)} rules defined
        </div>
        <button
          style={{
            ...S.btnPrimary, width: "auto", padding: "12px 32px", fontSize: "15px",
            opacity: deploying ? 0.5 : 1,
            background: "var(--green)", color: "#fff",
          }}
          disabled={deploying}
          onClick={onDeploy}
        >
          {deploying ? "Deploying..." : "Deploy Worker"}
        </button>
      </div>
    </div>
  );
}

/* ===================================================================
   AutoTextarea
   =================================================================== */

function AutoTextarea({ value, onChange, onKeyDown, placeholder, disabled, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) { ref.current.style.height = "auto"; ref.current.style.height = Math.min(ref.current.scrollHeight, 160) + "px"; }
  }, [value]);
  return (
    <textarea ref={ref} value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} disabled={disabled} autoFocus={autoFocus} rows={1}
      style={{ width: "100%", padding: "14px 20px", paddingBottom: "2.75rem", fontSize: "15px", background: "transparent", border: "none", color: "var(--text-primary)", outline: "none", fontFamily: "inherit", resize: "none", lineHeight: "24px", overflow: "auto", boxSizing: "border-box" }}
    />
  );
}

/* ===================================================================
   ModelDropdown
   =================================================================== */

function ModelDropdown({ model, onModelChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  const searchRef = useRef(null);
  const selectedModel = ALL_MODELS.find(m => m.id === model);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  const filtered = search.trim()
    ? ALL_MODELS.filter(m =>
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.provider.toLowerCase().includes(search.toLowerCase()) ||
        m.category.toLowerCase().includes(search.toLowerCase())
      )
    : ALL_MODELS;

  const priceColor = (price) => {
    if (price === "Free") return "var(--green)";
    if (price === "$") return "var(--text-tertiary)";
    if (price === "$$") return "var(--amber)";
    return "var(--red)";
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => { setOpen(!open); setSearch(""); }}
        style={{
          background: "transparent", border: "none", color: "var(--text-secondary)",
          fontSize: "13px", padding: "4px 8px", cursor: "pointer", fontFamily: "inherit",
          display: "flex", alignItems: "center", gap: 4, borderRadius: 6,
        }}
      >
        {selectedModel?.name || "Select model"}
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          className="popover-animate"
          style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4,
            background: "var(--bg-400, var(--bg-surface))", border: "1px solid var(--border)",
            borderRadius: 12, boxShadow: "var(--shadow-lg)", zIndex: 200,
            minWidth: 340, maxWidth: 400, overflow: "hidden",
          }}
        >
          {/* Search input */}
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search models..."
              style={{
                width: "100%", padding: "7px 10px", fontSize: "13px", fontFamily: "inherit",
                border: "1px solid var(--border)", borderRadius: 8, outline: "none",
                background: "var(--bg-primary, var(--bg-surface))", color: "var(--text-primary)",
                boxSizing: "border-box",
              }}
              onFocus={e => { e.currentTarget.style.borderColor = "var(--accent)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
            />
          </div>
          {/* Scrollable model list */}
          <div style={{ maxHeight: 400, overflowY: "auto", padding: "4px 0" }}>
            {MODEL_CATEGORIES.map(cat => {
              const catModels = filtered.filter(m => m.category === cat.key);
              if (catModels.length === 0) return null;
              return (
                <div key={cat.key}>
                  <div style={{
                    padding: "8px 14px 4px", fontSize: "10px", fontWeight: 700,
                    color: "var(--text-300, var(--text-tertiary))", textTransform: "uppercase",
                    letterSpacing: "0.08em", fontFamily: "var(--font-mono, monospace)",
                  }}>
                    {cat.label}
                  </div>
                  {catModels.map(m => {
                    const isSelected = m.id === model;
                    return (
                      <button
                        key={m.id}
                        onClick={() => { onModelChange(m.id); setOpen(false); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          width: "100%", padding: "7px 14px", fontSize: "13px",
                          background: isSelected ? "var(--bg-200, var(--bg-hover))" : "transparent",
                          color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
                          border: "none", borderLeft: isSelected ? "3px solid var(--accent)" : "3px solid transparent",
                          cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                          transition: "background 150ms",
                        }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--bg-200, var(--bg-hover))"; }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                      >
                        <span style={{ flex: 1, fontWeight: isSelected ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {m.name}
                        </span>
                        <span style={{
                          fontSize: "11px", fontWeight: 600, color: priceColor(m.price),
                          minWidth: 32, textAlign: "center",
                        }}>
                          {m.price}
                        </span>
                        <span style={{
                          fontSize: "10px", padding: "2px 6px", borderRadius: 4,
                          background: "var(--bg-200, var(--bg-hover))", color: "var(--text-tertiary)",
                          fontWeight: 500, whiteSpace: "nowrap",
                        }}>
                          {m.provider}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: "16px 14px", fontSize: "13px", color: "var(--text-tertiary)", textAlign: "center" }}>
                No models match your search
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================================================================
   PlusMenu
   =================================================================== */

function PlusMenu({ onClose, onAction }) {
  const ref = useRef(null);
  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);
  const itemStyle = { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 14px", fontSize: "14px", color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "background 150ms", borderRadius: 0 };
  const hover = (e) => { e.currentTarget.style.background = "var(--bg-hover)"; };
  const unhover = (e) => { e.currentTarget.style.background = "none"; };
  const sep = <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />;
  return (
    <div ref={ref} className="popover-animate" style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 8, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-lg)", padding: "4px 0", zIndex: 200, minWidth: 200, maxWidth: 240 }}>
      <button style={itemStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={() => { onAction?.("knowledge"); onClose(); }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M2 7h8M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        Add context
      </button>
      <button style={itemStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={() => { onAction?.("templates"); onClose(); }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
        Worker templates
      </button>
    </div>
  );
}

/* ===================================================================
   BuilderInputBox
   =================================================================== */

function BuilderInputBox({ value, onChange, onSend, disabled, model, onModelChange, placeholder }) {
  const [focused, setFocused] = useState(false);
  function handleKeyDown(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend?.(); } }
  return (
    <div style={{ position: "relative", maxWidth: 680, width: "100%" }}>
      <div
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 16, transition: "border-color 150ms, box-shadow 150ms", position: "relative", boxShadow: focused ? "var(--shadow-md)" : "var(--shadow-sm)" }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      >
        <AutoTextarea value={value} onChange={onChange} onKeyDown={handleKeyDown} placeholder={placeholder || "Describe what you need..."} disabled={disabled} autoFocus style={{ paddingLeft: "1rem" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 10px" }}>
          <ModelDropdown model={model} onModelChange={onModelChange} />
          <SendArrow disabled={disabled || !value.trim()} onClick={onSend} />
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   TemplateCard
   =================================================================== */

function TemplateCard({ template, onClick }) {
  return (
    <div
      style={{ padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-surface)", cursor: "pointer", transition: "border-color 150ms", display: "flex", flexDirection: "column", gap: "0.4rem" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--text-tertiary)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
      onClick={onClick}
    >
      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{template.name}</div>
      <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, flex: 1 }}>{template.description}</div>
    </div>
  );
}

/* ===================================================================
   TemplateCharterReview
   =================================================================== */

function TemplateCharterReview({ template, onDeploy, onCustomize, deploying }) {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "2rem" }} className="lovable-fade">
      <button style={S.backLink} onClick={onCustomize}>{"\u2190"} Back</button>
      <h2 style={{ ...S.pageTitle, marginBottom: "0.5rem" }}>{template.name}</h2>
      <p style={{ ...S.pageSub, marginBottom: "1.5rem" }}>{template.description}</p>
      <div style={{ padding: "1.25rem", borderRadius: 10, borderLeft: "2px solid var(--accent)", marginBottom: "2rem" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "1rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>What this worker can do</div>
        <CharterDisplay charter={template.charter} compact />
      </div>
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button style={{ ...S.btnPrimary, width: "auto", opacity: deploying ? 0.5 : 1 }} disabled={deploying} onClick={onDeploy}>{deploying ? "Deploying..." : "Deploy"}</button>
        <button style={S.btnSecondary} onClick={onCustomize}>Customize</button>
      </div>
    </div>
  );
}

/* ===================================================================
   TerraDotsInjector — animates "..." after "Terraforming"
   =================================================================== */

function TerraDotsInjector() {
  const ref = useRef(null);
  useEffect(() => {
    let frame = 0;
    const dots = ["", ".", "..", "..."];
    const el = ref.current?.parentElement?.querySelector("[data-terra-dots]");
    if (!el) return;
    const id = setInterval(() => {
      frame = (frame + 1) % dots.length;
      el.textContent = dots[frame];
    }, 500);
    return () => clearInterval(id);
  }, []);
  return <span ref={ref} style={{ display: "none" }} />;
}

/* ===================================================================
   BuilderView
   =================================================================== */

function BuilderView({ onComplete, onViewWorker, userName, isFirstTime }) {
  const [phase, setPhase] = useState("input"); // "input" | "generating" | "team"
  const [description, setDescription] = useState("");
  const [teamProposal, setTeamProposal] = useState(null);
  const [expandedCard, setExpandedCard] = useState(null);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef(null);

  function parseTeamProposal(text) {
    const match = text.match(/\[TEAM_PROPOSAL\]([\s\S]*?)\[\/TEAM_PROPOSAL\]/);
    if (!match) return null;
    const block = match[1];
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    let teamName = "";
    let summary = "";
    const workers = [];
    let current = null;
    for (const line of lines) {
      const [key, ...rest] = line.split(":");
      const k = key.trim().toLowerCase();
      const v = rest.join(":").trim();
      if (k === "team_name") { teamName = v; }
      else if (k === "summary" && !current) { summary = v; }
      else if (k === "worker") { if (current) workers.push(current); current = { role: v, title: "", description: "", canDo: [], askFirst: [], neverDo: [], schedule: "continuous", model: "", integrations: [] }; }
      else if (current && k === "title") current.title = v;
      else if (current && k === "description") current.description = v;
      else if (current && k === "cando") current.canDo = v.split(",").map(s => s.trim()).filter(Boolean);
      else if (current && k === "askfirst") current.askFirst = v.split(",").map(s => s.trim()).filter(Boolean);
      else if (current && k === "neverdo") current.neverDo = v.split(",").map(s => s.trim()).filter(Boolean);
      else if (current && k === "schedule") current.schedule = v;
      else if (current && k === "model") current.model = v;
      else if (current && k === "integrations") current.integrations = v.split(",").map(s => s.trim()).filter(Boolean);
    }
    if (current) workers.push(current);
    if (workers.length === 0) return null;
    return { teamName: teamName || "Your Team", summary, workers };
  }

  async function handleGo() {
    const text = description.trim();
    if (!text) return;
    setPhase("generating");
    setError("");

    const runtime = loadRuntimeConfig();
    try {
      const res = await fetch("/__nooterra/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-id": runtime.tenantId },
        credentials: "include",
        body: JSON.stringify({ messages: [{ role: "user", content: text }] }),
      });

      if (!res.ok) throw new Error("AI service unavailable");

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try { const p = JSON.parse(data); const d = p.choices?.[0]?.delta?.content || ""; if (d) fullResponse += d; } catch {}
        }
      }

      // Parse team from AI response
      const aiTeam = parseTeamProposal(fullResponse);
      if (aiTeam && aiTeam.workers.length > 0) {
        setTeamProposal(aiTeam);
        setPhase("team");
        return;
      }

      throw new Error("Could not generate team. Try describing your business in more detail.");
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
      setPhase("input");
    }
  }

  function handleExampleClick(text) {
    setDescription(text);
  }

  function goBackToPhase1() {
    setPhase("input");
    setTeamProposal(null);
    setExpandedCard(null);
    setError("");
  }

  async function handleActivate() {
    if (!teamProposal || activating) return;
    setActivating(true);
    setError("");
    try {
      for (const worker of teamProposal.workers) {
        const charter = {
          canDo: worker.canDo || [],
          askFirst: worker.askFirst || [],
          neverDo: worker.neverDo || [],
        };
        const scheduleValue = worker.schedule === "continuous" ? "continuous" : (worker.schedule || "0 9 * * *");
        await workerApiRequest({
          pathname: "/v1/workers", method: "POST",
          body: {
            name: worker.role,
            description: worker.description || "",
            charter: JSON.stringify(charter),
            schedule: scheduleValue,
            model: worker.model || "google/gemini-3-flash",
          },
        });
      }
      saveOnboardingState({ buyer: loadOnboardingState()?.buyer || null, sessionExpected: true, completed: true });
      onComplete?.();
    } catch (err) {
      setError("Activation failed: " + (err?.message || "Unknown error"));
    }
    setActivating(false);
  }

  // =============================================
  // GENERATING STATE — "Terraforming..."
  // =============================================
  if (phase === "generating") {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: "100%", padding: "2rem",
        background: "var(--bg-100, #faf9f6)",
      }}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          {/* Animated terra orb */}
          <div style={{
            width: 64, height: 64, margin: "0 auto 32px",
            borderRadius: "50%",
            background: "conic-gradient(from 0deg, var(--product-accent, #1f685c), var(--product-secondary, #8a5b3f), var(--product-accent, #1f685c))",
            animation: "terraSpin 2s linear infinite",
            opacity: 0.85,
            boxShadow: "0 0 40px rgba(31, 104, 92, 0.25)",
          }} />
          <h2 style={{
            fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.03em",
            color: "var(--text-100, var(--product-ink-strong))",
            marginBottom: 8,
            fontFamily: "var(--font-display, 'Fraunces', serif)",
          }}>
            Terraforming
            <span data-terra-dots style={{ display: "inline-block", width: "1.5em", textAlign: "left" }} />
          </h2>
          <p style={{
            fontSize: "14px", color: "var(--text-300, var(--product-ink-soft))",
            lineHeight: 1.6,
          }}>
            Designing your workforce from scratch
          </p>
        </div>
        <style>{`
          @keyframes terraSpin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes terraDots {
            0% { content: ""; }
            25% { content: "."; }
            50% { content: ".."; }
            75% { content: "..."; }
            100% { content: ""; }
          }
        `}</style>
        {/* CSS content property doesn't work on non-replaced elements, use JS instead */}
        <TerraDotsInjector />
      </div>
    );
  }

  // =============================================
  // PHASE 1: INPUT
  // =============================================
  if (phase === "input") {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: "100%", padding: "2rem",
        background: "var(--bg-100, #faf9f6)",
      }}>
        <div style={{ maxWidth: 580, width: "100%", textAlign: "center" }}>
          <h1 style={{
            fontSize: "clamp(1.75rem, 3vw, 2.5rem)", fontWeight: 800,
            letterSpacing: "-0.03em", color: "var(--text-100)",
            marginBottom: 12, lineHeight: 1.15,
          }}>
            What does your business do?
          </h1>
          <p style={{ fontSize: "15px", color: "var(--text-300)", marginBottom: 40 }}>
            Describe it in plain language. We'll build your team.
          </p>

          <textarea
            ref={textareaRef}
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGo(); }
            }}
            placeholder="e.g. We're a plumbing company in Denver with 8 technicians..."
            rows={3}
            style={{
              display: "block", width: "100%", padding: "16px 18px",
              fontSize: "16px", lineHeight: 1.6, fontFamily: "inherit",
              border: "1px solid var(--border)", borderRadius: 12,
              background: "var(--bg-400)", color: "var(--text-100)",
              outline: "none", resize: "vertical", boxSizing: "border-box",
              transition: "border-color 150ms",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = "var(--border-strong, var(--accent))"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
          />

          <button
            onClick={handleGo}
            disabled={!description.trim()}
            style={{
              display: "block", width: "100%", padding: "14px 24px",
              fontSize: "14px", fontWeight: 700, marginTop: 12,
              background: "var(--text-100)", color: "var(--bg-100)",
              border: "none", borderRadius: 10, cursor: "pointer",
              fontFamily: "inherit", transition: "opacity 150ms",
              opacity: description.trim() ? 1 : 0.35,
            }}
          >
            Go
          </button>

          <div style={{ marginTop: 24, color: "var(--text-300)", fontSize: "13px", lineHeight: 2 }}>
            {["Plumbing company in Denver with 8 techs", "Gem restoration studio in LA", "Shopify store selling supplements", "Personal injury law firm"].map((example, i) => (
              <span key={example}>
                {i > 0 && <span style={{ margin: "0 6px" }}>&middot;</span>}
                <span
                  onClick={() => handleExampleClick(example)}
                  style={{
                    cursor: "pointer", textDecoration: "underline",
                    textDecorationColor: "var(--border)", textUnderlineOffset: "3px",
                    transition: "color 120ms",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = "var(--text-100)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "var(--text-300)"; }}
                >{example}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // =============================================
  // PHASE 2: TEAM REVIEW
  // =============================================
  const workers = teamProposal?.workers || [];

  return (
    <div style={{
      minHeight: "100%", padding: "2rem 1.5rem", background: "var(--bg-100, #faf9f6)",
      overflowY: "auto",
    }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* Back button */}
        <button
          onClick={goBackToPhase1}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: "13px", fontWeight: 500, color: "var(--text-300)",
            padding: 0, fontFamily: "inherit", transition: "color 120ms",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "var(--text-100)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-300)"; }}
        >
          &larr; Start over
        </button>

        {/* Team header */}
        <div style={{ marginBottom: 40, marginTop: 16 }}>
          <h1 style={{
            fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 800,
            letterSpacing: "-0.03em", color: "var(--text-100)",
            lineHeight: 1.15,
          }}>
            {teamProposal?.teamName || "Your Team"}
          </h1>
          <p style={{ fontSize: "14px", color: "var(--text-300)", marginTop: 6, lineHeight: 1.6 }}>
            {teamProposal?.summary || `${workers.length} workers ready to deploy`}
          </p>
        </div>

        {/* Worker cards grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
        }}>
          {workers.map((worker, idx) => {
            const isExpanded = expandedCard === idx;
            const canDoCount = (worker.canDo || []).length;
            const askFirstCount = (worker.askFirst || []).length;
            const neverDoCount = (worker.neverDo || []).length;

            return (
              <div
                key={idx}
                onClick={() => setExpandedCard(isExpanded ? null : idx)}
                style={{
                  border: "1px solid var(--border)", borderRadius: 12,
                  background: "var(--bg-400)", padding: 24, cursor: "pointer",
                  transition: "box-shadow 200ms, border-color 200ms",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = "var(--shadow-sm, 0 1px 4px rgba(0,0,0,0.06))";
                  e.currentTarget.style.borderColor = "var(--border-strong, var(--border))";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-100)", marginBottom: 6 }}>
                  {worker.role}
                </div>
                <div style={{
                  fontSize: "13px", color: "var(--text-200)", marginBottom: 12,
                  lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>
                  {worker.title || worker.description || ""}
                </div>
                <div style={{
                  fontSize: "12px", fontFamily: "var(--font-mono)",
                  color: "var(--text-300)",
                }}>
                  {canDoCount} autonomous &middot; {askFirstCount} approval &middot; {neverDoCount} blocked
                </div>

                {/* Model badge */}
                {worker.model && (
                  <div style={{
                    display: "inline-block", marginTop: 10, padding: "3px 10px",
                    fontSize: "11px", fontFamily: "var(--font-mono)",
                    color: "var(--text-200)", background: "var(--bg-100, rgba(0,0,0,0.06))",
                    borderRadius: 6, fontWeight: 500,
                  }}>
                    {ALL_MODELS.find(m => m.id === worker.model)?.name || worker.model}
                  </div>
                )}

                {/* Integration pills */}
                {(worker.integrations || []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {worker.integrations.map((intg, ii) => (
                      <span key={ii} style={{
                        fontSize: "11px", padding: "2px 8px", borderRadius: 5,
                        border: "1px solid var(--border)", color: "var(--text-300)",
                        fontFamily: "var(--font-mono)",
                      }}>{intg}</span>
                    ))}
                  </div>
                )}

                {/* Expanded rules */}
                {isExpanded && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                    {/* Can Do — green */}
                    {canDoCount > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{
                          fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
                          letterSpacing: "0.08em", color: "var(--green, #5bb98c)",
                          marginBottom: 6, fontFamily: "var(--font-mono)",
                        }}>Acts on its own</div>
                        <div style={{ borderLeft: "3px solid var(--green, #5bb98c)", paddingLeft: 12 }}>
                          {worker.canDo.map((rule, ri) => (
                            <div key={ri} style={{
                              fontSize: "13px", color: "var(--text-200)", lineHeight: 1.6,
                              padding: "2px 0",
                            }}>{rule}</div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Ask First — amber */}
                    {askFirstCount > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{
                          fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
                          letterSpacing: "0.08em", color: "var(--amber, #d4a843)",
                          marginBottom: 6, fontFamily: "var(--font-mono)",
                        }}>Asks you first</div>
                        <div style={{ borderLeft: "3px solid var(--amber, #d4a843)", paddingLeft: 12 }}>
                          {worker.askFirst.map((rule, ri) => (
                            <div key={ri} style={{
                              fontSize: "13px", color: "var(--text-200)", lineHeight: 1.6,
                              padding: "2px 0",
                            }}>{rule}</div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Never Do — red */}
                    {neverDoCount > 0 && (
                      <div>
                        <div style={{
                          fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
                          letterSpacing: "0.08em", color: "var(--red, #c97055)",
                          marginBottom: 6, fontFamily: "var(--font-mono)",
                        }}>Never does</div>
                        <div style={{ borderLeft: "3px solid var(--red, #c97055)", paddingLeft: 12 }}>
                          {worker.neverDo.map((rule, ri) => (
                            <div key={ri} style={{
                              fontSize: "13px", color: "var(--text-200)", lineHeight: 1.6,
                              padding: "2px 0",
                            }}>{rule}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Model selector */}
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                      <div style={{
                        fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
                        letterSpacing: "0.08em", color: "var(--text-300)",
                        marginBottom: 8, fontFamily: "var(--font-mono)",
                      }}>Model</div>
                      <select
                        value={worker.model || ""}
                        onClick={e => e.stopPropagation()}
                        onChange={e => {
                          e.stopPropagation();
                          const updated = { ...teamProposal };
                          updated.workers = [...updated.workers];
                          updated.workers[idx] = { ...worker, model: e.target.value };
                          setTeamProposal(updated);
                        }}
                        style={{
                          width: "100%", padding: "8px 12px", fontSize: "13px",
                          fontFamily: "var(--font-mono)", background: "var(--bg-100, var(--bg-400))",
                          color: "var(--text-100)", border: "1px solid var(--border)",
                          borderRadius: 8, outline: "none", cursor: "pointer",
                          appearance: "auto",
                        }}
                      >
                        {MODEL_CATEGORIES.map(cat => (
                          <optgroup key={cat.key} label={cat.label}>
                            {ALL_MODELS.filter(m => m.category === cat.key).map(m => (
                              <option key={m.id} value={m.id}>{m.name} — {m.price}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Integrations section — derived from worker integrations */}
        {(() => {
          const allIntegrations = new Map();
          for (const w of workers) {
            for (const intg of (w.integrations || [])) {
              if (!allIntegrations.has(intg)) allIntegrations.set(intg, []);
              allIntegrations.get(intg).push(w.role);
            }
          }
          if (allIntegrations.size === 0) return null;
          return (
            <div style={{ marginTop: 48 }}>
              <h2 style={{
                fontSize: "15px", fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.08em", color: "var(--text-300)", marginBottom: 16,
              }}>Integrations needed</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[...allIntegrations.entries()].map(([intg, roles]) => (
                  <div key={intg} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "14px 18px", borderRadius: 10,
                    border: "1px solid var(--border)", background: "var(--bg-400)",
                  }}>
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-100)" }}>
                        {intg.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-300)", marginTop: 2 }}>
                        Used by {roles.join(", ")}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, marginLeft: 16 }}>
                      <button style={{
                        padding: "6px 14px", fontSize: "12px", fontWeight: 600,
                        border: "1px solid var(--border)", borderRadius: 8,
                        background: "transparent", color: "var(--text-200)",
                        cursor: "pointer", fontFamily: "inherit", transition: "border-color 120ms",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--text-300)"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
                      >Connect</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Error */}
        {error && (
          <div style={{ marginTop: 16, fontSize: "14px", color: "var(--red, #c97055)", textAlign: "center" }}>{error}</div>
        )}

        {/* Activate button */}
        <div style={{ marginTop: 40, textAlign: "center", paddingBottom: 40 }}>
          <button
            onClick={handleActivate}
            disabled={activating}
            style={{
              padding: "14px 48px", fontSize: "15px", fontWeight: 700,
              background: "var(--text-100)", color: "var(--bg-100)",
              border: "none", borderRadius: 10, cursor: "pointer",
              fontFamily: "inherit", transition: "opacity 150ms",
              opacity: activating ? 0.5 : 1,
            }}
          >
            {activating ? "Activating..." : "Activate Team"}
          </button>
          <p style={{ fontSize: "12px", color: "var(--text-300)", marginTop: 8 }}>
            All workers start in learning mode. You approve actions until they earn trust.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   UserMenu
   =================================================================== */

function UserMenu({ onClose, onNavigate, onOpenSettings, userEmail, userTier, collapsed }) {
  const itemStyle = { display: "block", width: "100%", padding: "8px 14px", fontSize: "14px", color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "background 150ms" };
  const hover = (e) => { e.currentTarget.style.background = "var(--bg-hover)"; };
  const unhover = (e) => { e.currentTarget.style.background = "none"; };
  const sep = <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />;
  const popoverPosition = collapsed
    ? { position: "absolute", left: 56, bottom: 0 }
    : { position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 4 };
  return (
    <div className="popover-animate" style={{ ...popoverPosition, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-lg)", padding: "4px 0", zIndex: 100, minWidth: 220 }}>
      <div style={{ padding: "10px 14px 6px" }}>
        <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userEmail || "User"}</div>
        <div style={{ fontSize: "12px", color: tierColor(userTier), fontWeight: 600, marginTop: 2 }}>{tierLabel(userTier)} plan</div>
      </div>
      {sep}
      <button style={itemStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={() => { onClose(); onOpenSettings(); }}>Settings</button>
      <a href="https://docs.nooterra.ai" target="_blank" rel="noopener noreferrer" style={{ ...itemStyle, textDecoration: "none" }} onMouseEnter={hover} onMouseLeave={unhover} onClick={onClose}>Help & docs</a>
      {sep}
      <a href="/pricing" style={{ ...itemStyle, textDecoration: "none", color: "var(--accent)", fontWeight: 600 }} onMouseEnter={hover} onMouseLeave={unhover} onClick={(e) => { e.preventDefault(); onClose(); navigate("/pricing"); }}>Upgrade to Pro</a>
      {sep}
      <button style={itemStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={async () => { onClose(); await logoutSession(); try { localStorage.removeItem(PRODUCT_RUNTIME_STORAGE_KEY); } catch { /* ignore */ } try { localStorage.removeItem(ONBOARDING_STORAGE_KEY); } catch { /* ignore */ } navigate("/login"); }}>Log out</button>
    </div>
  );
}

/* ===================================================================
   CollapsedSidebar
   =================================================================== */

function CollapsedSidebar({ onToggle, onNavigate, activeView, onNewWorker, onOpenSettings, userEmail, pendingApprovals }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => { if (!menuOpen) return; function handleClickOutside(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); } document.addEventListener("mousedown", handleClickOutside); return () => document.removeEventListener("mousedown", handleClickOutside); }, [menuOpen]);

  const iconBtn = (key, label, svgContent, badge) => (
    <button onClick={() => onNavigate(key)} style={{ width: 36, height: 36, borderRadius: 8, background: activeView === key ? "var(--bg-hover)" : "transparent", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0, color: activeView === key ? "var(--text-primary)" : "var(--text-secondary)", transition: "background 150ms", position: "relative", flexShrink: 0 }}
      onMouseEnter={e => { if (activeView !== key) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { if (activeView !== key) e.currentTarget.style.background = "transparent"; }}
    >
      {svgContent}
      {badge > 0 && <div style={{ position: "absolute", top: 2, right: 2, width: 14, height: 14, borderRadius: "50%", background: "var(--accent)", fontSize: "9px", fontWeight: 700, color: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center" }}>{badge}</div>}
    </button>
  );

  return (
    <nav style={{ width: 52, height: "100vh", position: "sticky", top: 0, display: "flex", flexDirection: "column", alignItems: "center", background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)", padding: "12px 0", gap: 4, flexShrink: 0 }}>
      <button onClick={onToggle} style={{ width: 36, height: 36, borderRadius: 8, background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 150ms", marginBottom: 4 }}
        onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
      ><SidebarToggleIcon /></button>
      <button onClick={onNewWorker} style={{ width: 36, height: 36, borderRadius: 8, background: "var(--accent-subtle, rgba(196,97,58,0.07))", border: "none", cursor: "pointer", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", transition: "opacity 150ms", marginBottom: 4 }}><PlusIcon size={18} /></button>
      {iconBtn("workers", "Workers", <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>)}
      {iconBtn("approvals", "Approvals", <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>, pendingApprovals)}
      {iconBtn("receipts", "History", <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>)}
      <div style={{ flex: 1 }} />
      <button onClick={onOpenSettings} style={{ width: 36, height: 36, borderRadius: 8, background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 150ms" }}
        onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
      ><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>
      <div style={{ position: "relative" }} ref={menuRef}>
        {menuOpen && <UserMenu onClose={() => setMenuOpen(false)} onNavigate={onNavigate} onOpenSettings={onOpenSettings} userEmail={userEmail} userTier="free" collapsed />}
        <button onClick={() => setMenuOpen(!menuOpen)} style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--accent)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, color: "#1a1a1a", transition: "opacity 150ms" }}>
          {getInitials(userEmail)}
        </button>
      </div>
    </nav>
  );
}

/* ===================================================================
   ExpandedSidebar
   =================================================================== */

function ExpandedSidebar({ activeView, onNavigate, workers, pendingApprovals, userEmail, creditBalance, onNewWorker, onToggle, onOpenSettings, userTier }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => { if (!menuOpen) return; function handleClickOutside(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); } document.addEventListener("mousedown", handleClickOutside); return () => document.removeEventListener("mousedown", handleClickOutside); }, [menuOpen]);

  const navBtn = (key, label, extra) => (
    <button style={{ display: "flex", alignItems: "center", padding: "8px 12px", margin: "0 12px", borderRadius: 8, fontSize: "14px", fontWeight: 500, color: activeView === key ? "var(--text-primary)" : "var(--text-secondary)", background: activeView === key ? "var(--bg-hover)" : "transparent", cursor: "pointer", border: "none", fontFamily: "inherit", textAlign: "left", transition: "background 150ms, color 150ms", boxSizing: "border-box", width: "calc(100% - 24px)" }}
      onMouseEnter={e => { if (activeView !== key) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { if (activeView !== key) e.currentTarget.style.background = "transparent"; }}
      onClick={() => onNavigate(key)}
    >{label}{extra}</button>
  );

  return (
    <nav style={{ width: 260, height: "100vh", position: "sticky", top: 0, display: "flex", flexDirection: "column", background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 16px 12px", height: 56, boxSizing: "border-box" }}>
        <button onClick={onToggle} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 4, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 150ms" }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
        ><SidebarToggleIcon /></button>
        <img src="/nooterra-logo.png" alt="nooterra" style={{ height: 18 }} />
      </div>
      <div style={{ padding: "0 12px 12px" }}>
        <button onClick={onNewWorker} style={{ display: "block", width: "100%", padding: "8px 12px", fontSize: "14px", fontWeight: 600, background: "var(--accent-subtle, rgba(196,97,58,0.07))", color: "var(--accent)", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", transition: "opacity 150ms" }}>+ New worker</button>
      </div>
      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", padding: "12px 24px 6px", letterSpacing: "0.05em", textTransform: "uppercase" }}>Workers</div>
      {workers && workers.length > 0 ? (
        <div className="sidebar-inner" style={{ overflowY: "auto", minHeight: 0, flex: 0 }}>
          {workers.map(w => (
            <button key={w.id} style={{ display: "flex", alignItems: "center", gap: 8, width: "calc(100% - 24px)", padding: "8px 12px", margin: "0 12px", borderRadius: 8, fontSize: "14px", fontWeight: 400, color: "var(--text-secondary)", background: "transparent", cursor: "pointer", border: "none", fontFamily: "inherit", textAlign: "left", transition: "background 150ms" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              onClick={() => onNavigate("workerDetail", w.id)}
            >
              <span style={S.statusDot(STATUS_COLORS[w.status] || STATUS_COLORS.ready)} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ padding: "4px 24px", fontSize: "13px", color: "var(--text-tertiary)" }}>No workers yet</div>
      )}
      <div style={{ borderTop: "1px solid var(--border)", margin: "16px 16px" }} />
      {navBtn("approvals", "Approvals", pendingApprovals > 0 && <span style={{ marginLeft: 8, fontSize: "12px", fontWeight: 700, color: "var(--accent)", fontVariantNumeric: "tabular-nums" }}>{pendingApprovals}</span>)}
      {navBtn("receipts", "History")}
      <div style={{ flex: 1 }} />
      <div style={{ borderTop: "1px solid var(--border)", margin: "8px 16px" }} />
      <div style={{ padding: "12px 16px", position: "relative" }} ref={menuRef}>
        {menuOpen && <UserMenu onClose={() => setMenuOpen(false)} onNavigate={onNavigate} onOpenSettings={onOpenSettings} userEmail={userEmail} userTier={userTier} />}
        <button style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", padding: 0 }} onClick={() => setMenuOpen(!menuOpen)}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, color: "#1a1a1a", flexShrink: 0 }}>{getInitials(userEmail)}</div>
          <div style={{ overflow: "hidden", flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "14px", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userEmail || "User"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: tierColor(userTier) }}>{tierLabel(userTier)}</span>
              {creditBalance != null && <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>${(creditBalance / 100).toFixed(2)}</span>}
            </div>
          </div>
        </button>
      </div>
    </nav>
  );
}

/* ===================================================================
   AppSidebar
   =================================================================== */

function AppSidebar({ activeView, onNavigate, workers, pendingApprovals, userEmail, creditBalance, onNewWorker, collapsed, onToggle, onOpenSettings, userTier }) {
  if (collapsed) return <CollapsedSidebar onToggle={onToggle} onNavigate={onNavigate} activeView={activeView} onNewWorker={onNewWorker} onOpenSettings={onOpenSettings} userEmail={userEmail} pendingApprovals={pendingApprovals} />;
  return (
    <div className="sidebar-wrap" style={{ width: 260, flexShrink: 0 }}>
      <ExpandedSidebar activeView={activeView} onNavigate={onNavigate} workers={workers} pendingApprovals={pendingApprovals} userEmail={userEmail} creditBalance={creditBalance} onNewWorker={onNewWorker} onToggle={onToggle} onOpenSettings={onOpenSettings} userTier={userTier} />
    </div>
  );
}

/* ===================================================================
   WorkersListView
   =================================================================== */

function WorkersListView({ onSelect, onCreate }) {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.items || result || []); } catch { setWorkers([]); } setLoading(false); })(); }, []);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div><h1 style={S.pageTitle}>Workers</h1><p style={{ ...S.pageSub, marginBottom: 0 }}>{loading ? "Loading..." : workers.length === 0 ? "No workers yet. Create one to get started." : `${workers.length} worker${workers.length === 1 ? "" : "s"}`}</p></div>
        <button style={{ ...S.btnPrimary, width: "auto" }} onClick={onCreate}>Create worker</button>
      </div>
      {!loading && workers.length === 0 && (
        <div style={{ padding: "4rem 2rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
          <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Your first worker is waiting</div>
          <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.5rem", maxWidth: 360, margin: "0 auto 1.5rem" }}>Describe what you need done, set a schedule, review the charter, and deploy.</div>
          <button style={{ ...S.btnPrimary, width: "auto" }} onClick={onCreate}>Create worker</button>
        </div>
      )}
      {workers.length > 0 && (
        <div>
          <div style={{ ...S.workerRow, cursor: "default", borderBottom: "1px solid var(--border)", padding: "0 0 0.5rem" }}>
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--text-secondary)" }}>Name</div>
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--text-secondary)" }}>Status</div>
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--text-secondary)" }}>Last run</div>
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--text-secondary)" }}>Schedule</div>
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--text-secondary)" }}>Cost</div>
          </div>
          {workers.map(w => (
            <div key={w.id} style={S.workerRow} onClick={() => onSelect(w)} onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
              <div style={S.workerName}>{w.name}</div>
              <div style={S.workerMeta}><span style={S.statusDot(STATUS_COLORS[w.status] || STATUS_COLORS.ready)} />{w.status}</div>
              <div style={S.workerMeta}>{w.lastRun || w.lastRunAt ? timeAgo(w.lastRun || w.lastRunAt) : "never"}</div>
              <div style={S.workerMeta}>{w.schedule || "manual"}</div>
              <div style={S.workerMeta}>{w.cost != null ? `$${(typeof w.cost === "number" ? w.cost : 0).toFixed(2)}` : "--"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===================================================================
   WorkerDetailView
   =================================================================== */

function WorkerDetailView({ workerId, onBack, isNewDeploy }) {
  const [worker, setWorker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(isNewDeploy ? "activity" : "charter");
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [runningAction, setRunningAction] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { (async () => { try { const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" }); setWorker(result); } catch { setWorker(null); } setLoading(false); })(); }, [workerId]);
  useEffect(() => { if (tab === "activity" && workerId) { setLogsLoading(true); (async () => { try { const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/logs`, method: "GET" }); setLogs(result?.items || result || []); } catch { setLogs([]); } setLogsLoading(false); })(); } }, [tab, workerId]);
  useEffect(() => { if (!isNewDeploy || !workerId) return; const interval = setInterval(async () => { try { const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" }); setWorker(result); if (tab === "activity") { const logResult = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/logs`, method: "GET" }); setLogs(logResult?.items || logResult || []); } } catch { /* ignore */ } }, 5000); return () => clearInterval(interval); }, [isNewDeploy, workerId, tab]);

  async function handleRunNow() { setRunningAction(true); setError(""); try { await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/run`, method: "POST" }); const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" }); setWorker(result); } catch (err) { setError(err?.message || "Failed to run worker."); } setRunningAction(false); }
  async function handlePauseResume() { if (!worker) return; setRunningAction(true); setError(""); const newStatus = worker.status === "paused" ? "ready" : "paused"; try { await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "PUT", body: { status: newStatus } }); setWorker(prev => prev ? { ...prev, status: newStatus } : prev); } catch (err) { setError(err?.message || "Failed to update worker."); } setRunningAction(false); }

  if (loading) return (<div><button style={S.backLink} onClick={onBack}>{"\u2190"} All workers</button><div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div></div>);
  if (!worker) return (<div><button style={S.backLink} onClick={onBack}>{"\u2190"} All workers</button><div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Worker not found.</div></div>);

  const charter = typeof worker.charter === "string" ? (() => { try { return JSON.parse(worker.charter); } catch { return null; } })() : worker.charter;
  const tabs = [{ key: "charter", label: "Charter" }, { key: "activity", label: "Activity" }, { key: "integrations", label: "Integrations" }, { key: "settings", label: "Settings" }];

  return (
    <div>
      <button style={S.backLink} onClick={onBack}>{"\u2190"} All workers</button>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.3rem" }}>
        <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>{worker.name}</h1>
        <span style={S.statusDot(STATUS_COLORS[worker.status] || STATUS_COLORS.ready)} />
        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{worker.status}</span>
      </div>
      <p style={S.pageSub}>{worker.description || "No description"}</p>
      {error && <div style={S.error}>{error}</div>}

      {/* Integration setup prompt for new deploys */}
      {isNewDeploy && (
        <div style={{ padding: "16px 20px", borderRadius: 12, border: "1px solid var(--accent)", background: "var(--accent-subtle, rgba(196,97,58,0.04))", marginBottom: "1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>Connect integrations</div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: 2 }}>This worker may need access to external services to run effectively.</div>
          </div>
          <button style={{ ...S.btnSecondary, width: "auto", padding: "6px 16px", fontSize: "13px", flexShrink: 0 }} onClick={() => setTab("integrations")}>Set up</button>
        </div>
      )}

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "2rem" }}>
        <button style={{ ...S.btnPrimary, width: "auto", opacity: runningAction ? 0.5 : 1 }} disabled={runningAction} onClick={handleRunNow}>{runningAction ? "Running..." : "Run now"}</button>
        <button style={S.btnSecondary} disabled={runningAction} onClick={handlePauseResume}>{worker.status === "paused" ? "Resume" : "Pause"}</button>
      </div>
      {worker.cost != null && <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "2rem" }}>Cost this period: <span style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>${(typeof worker.cost === "number" ? worker.cost : 0).toFixed(2)}</span></div>}
      <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border)", marginBottom: "2rem" }}>
        {tabs.map(t => <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "0.6rem 1rem", fontSize: "14px", fontWeight: 600, color: tab === t.key ? "var(--text-primary)" : "var(--text-secondary)", background: "none", border: "none", borderBottom: tab === t.key ? "2px solid var(--accent)" : "2px solid transparent", cursor: "pointer", fontFamily: "inherit", marginBottom: -1 }}>{t.label}</button>)}
      </div>
      {tab === "charter" && <CharterDisplay charter={charter} />}
      {tab === "activity" && (
        <div>
          {isNewDeploy && logs.length === 0 && !logsLoading && (
            <div style={{ padding: "2rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
              <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Your worker is queued and will run shortly.</div>
              <div style={{ width: 24, height: 24, border: "2px solid var(--border)", borderTop: "2px solid var(--accent)", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "1rem auto 0" }} />
            </div>
          )}
          {logsLoading ? <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading logs...</div> : logs.length === 0 && !isNewDeploy ? <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>No activity yet. This worker hasn't run.</div> : logs.map((entry, i) => <ActivityLogEntry key={entry.id || i} entry={entry} />)}
        </div>
      )}
      {tab === "integrations" && (
        <div style={{ maxWidth: 480 }}>
          <WorkerIntegrationsSection workerId={workerId} />
        </div>
      )}
      {tab === "settings" && (
        <div style={{ maxWidth: 480 }}>
          <label style={S.label}>Schedule</label>
          <div style={{ fontSize: "14px", color: "var(--text-primary)", marginBottom: "1rem" }}>{worker.schedule || "Manual (on-demand)"}</div>
          {worker.model && (<><label style={S.label}>Model</label><div style={{ fontSize: "14px", color: "var(--text-primary)", marginBottom: "2rem" }}>{ALL_MODELS.find(m => m.id === worker.model)?.name || worker.model}</div></>)}
        </div>
      )}
    </div>
  );
}

function ActivityLogEntry({ entry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={S.logEntry}>
      <div style={S.logTime}>{entry.time ? timeAgo(entry.time) : ""}</div>
      <div style={S.logSummary}>{entry.summary}</div>
      {entry.detail && (<><button style={{ ...S.btnGhost, marginTop: "0.4rem", fontSize: "12px" }} onClick={() => setExpanded(!expanded)}>{expanded ? "Hide details" : "Show details"}</button>{expanded && <div style={S.logDetail}>{entry.detail}</div>}</>)}
    </div>
  );
}

/* ===================================================================
   InboxView — "What needs me now?"
   =================================================================== */

function InboxView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);

  useEffect(() => { loadInbox(); }, []);

  async function loadInbox() {
    setLoading(true);
    try {
      const runtime = loadRuntimeConfig();
      const result = await fetchApprovalInbox(runtime, { status: "pending" });
      setItems(result?.items || result || []);
    } catch {
      setItems([]);
    }
    setLastChecked(new Date());
    setLoading(false);
  }

  async function handleDecide(requestId, decision) {
    setDeciding(requestId);
    try {
      const runtime = loadRuntimeConfig();
      await decideApprovalInboxItem(runtime, requestId, { approved: decision === "approved" });
      await loadInbox();
    } catch { /* ignore */ }
    setDeciding(null);
  }

  const pendingCount = Array.isArray(items) ? items.length : 0;
  const stats = [
    { label: "waiting", value: pendingCount, color: "#d97706" },
    { label: "blocked", value: 0, color: "#dc2626" },
    { label: "handled", value: 0, color: "var(--green, #5bb98c)" },
    { label: "hrs saved", value: 0, color: "var(--primary, #6366f1)" },
    { label: "violations", value: 0, color: "var(--green, #5bb98c)" },
  ];

  const roleColors = ["#6366f1", "#d97706", "#0ea5e9", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
  function avatarColor(name) { let h = 0; for (let i = 0; i < (name || "").length; i++) h = (h + (name || "").charCodeAt(i)) % roleColors.length; return roleColors[h]; }
  function getLeftBorderColor(item) {
    if (item.type === "failure" || item.type === "error") return "#dc2626";
    if (item.type === "info") return "#3b82f6";
    return "#d97706";
  }

  return (
    <div>
      <h1 style={S.pageTitle}>Inbox</h1>
      <p style={S.pageSub}>What needs you now.</p>

      {/* Summary strip */}
      <div style={{ display: "flex", gap: 16, padding: "20px 0", borderBottom: "1px solid var(--border)", marginBottom: 24, flexWrap: "wrap" }}>
        {stats.map(s => (
          <div key={s.label} style={{ padding: "12px 20px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-400)" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color: s.color, marginRight: 6 }}>{s.value}</span>
            <span style={{ fontSize: 13, color: "var(--text-200, var(--text-secondary))" }}>{s.label}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ fontSize: 14, color: "var(--text-200, var(--text-secondary))" }}>Loading...</div>
      ) : pendingCount === 0 ? (
        /* Empty state */
        <div style={{ padding: "4rem 2rem", textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--green, #5bb98c)", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-100, var(--text-primary))", marginBottom: 6 }}>All clear. Your team is handling everything.</div>
          <div style={{ fontSize: 13, color: "var(--text-300, var(--text-tertiary))", fontFamily: "var(--font-mono)" }}>
            Last checked: {lastChecked ? lastChecked.toLocaleTimeString() : "—"}
          </div>
        </div>
      ) : (
        /* Decision cards */
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {items.map(item => {
            const id = item.requestId || item.id;
            const workerName = item.workerName || item.agentName || "Worker";
            const avatarBg = avatarColor(workerName);
            const leftColor = getLeftBorderColor(item);
            const ruleLine = item.ruleName || item.rule || null;
            return (
              <div key={id} style={{ background: "var(--bg-400)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, borderLeft: `3px solid ${leftColor}` }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  {/* Avatar */}
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: avatarBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#fff", fontWeight: 700, fontSize: 15 }}>
                    {(workerName || "W")[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <span style={{ fontWeight: 600, color: "var(--text-100, var(--text-primary))", fontSize: 15 }}>{workerName}</span>
                      </div>
                      <span style={{ fontSize: 12, color: "var(--text-300, var(--text-tertiary))", fontFamily: "var(--font-mono)", flexShrink: 0, marginLeft: 12 }}>
                        {item.createdAt ? timeAgo(item.createdAt) : ""}
                      </span>
                    </div>
                    <div style={{ color: "var(--text-200, var(--text-secondary))", fontSize: 14, marginTop: 4 }}>
                      {item.action || item.summary || item.description || "Action requires approval"}
                    </div>
                    {ruleLine && (
                      <div style={{ color: "var(--text-300, var(--text-tertiary))", fontSize: 12, fontFamily: "var(--font-mono)", marginTop: 6 }}>
                        Matched: {ruleLine}
                      </div>
                    )}
                    {item.detail && (
                      <div style={{ fontSize: 13, color: "var(--text-300, var(--text-tertiary))", lineHeight: 1.5, marginTop: 4 }}>{item.detail}</div>
                    )}
                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                      {item.type === "connection" ? (
                        <button style={{ padding: "8px 20px", background: "var(--primary, #6366f1)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Reconnect</button>
                      ) : (<>
                        <button
                          style={{ padding: "8px 20px", background: "var(--green, #5bb98c)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: deciding === id ? 0.6 : 1 }}
                          disabled={deciding === id}
                          onClick={() => handleDecide(id, "approved")}
                        >Approve</button>
                        <button
                          style={{ padding: "8px 20px", background: "transparent", color: "var(--text-200, var(--text-secondary))", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, cursor: "pointer", opacity: deciding === id ? 0.6 : 1 }}
                          disabled={deciding === id}
                          onClick={() => handleDecide(id, "denied")}
                        >Deny</button>
                        <button
                          style={{ padding: "8px 20px", background: "transparent", color: "var(--text-200, var(--text-secondary))", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, cursor: "pointer", opacity: deciding === id ? 0.6 : 1 }}
                          disabled={deciding === id}
                          onClick={() => handleDecide(id, "approved")}
                        >Edit &amp; Approve</button>
                      </>)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ===================================================================
   ApprovalsView
   =================================================================== */

function ApprovalsView() {
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);

  useEffect(() => { loadApprovals(); }, []);
  async function loadApprovals() { setLoading(true); try { const runtime = loadRuntimeConfig(); const [pending, decided] = await Promise.all([fetchApprovalInbox(runtime, { status: "pending" }), fetchApprovalInbox(runtime, { status: "decided" })]); setItems(pending?.items || pending || []); setHistory(decided?.items || decided || []); } catch { setItems([]); setHistory([]); } setLoading(false); }
  async function handleDecide(requestId, approved) { setDeciding(requestId); try { const runtime = loadRuntimeConfig(); await decideApprovalInboxItem(runtime, requestId, { approved }); await loadApprovals(); } catch { /* ignore */ } setDeciding(null); }

  return (
    <div>
      <h1 style={S.pageTitle}>Approvals</h1>
      <p style={S.pageSub}>Workers ask before taking sensitive actions. Review and decide here.</p>
      {loading ? <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div> : (<>
        {items.length === 0 ? (
          <div style={{ padding: "3rem 2rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12, marginBottom: "3rem" }}>
            <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.3rem" }}>Nothing pending</div>
            <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>When a worker needs your approval, it will appear here.</div>
          </div>
        ) : (
          <div style={{ marginBottom: "3rem" }}>
            {items.map(item => (
              <div key={item.requestId || item.id} style={S.approvalRow}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.25rem" }}>{item.workerName || item.agentName || "Worker"}</div>
                    <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>{item.action || item.summary || item.description || "Action requires approval"}</div>
                    {item.detail && <div style={{ fontSize: "13px", color: "var(--text-tertiary)", lineHeight: 1.5 }}>{item.detail}</div>}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)", flexShrink: 0, marginLeft: "1rem" }}>{item.createdAt ? timeAgo(item.createdAt) : ""}</div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                  <button style={{ ...S.btnPrimary, width: "auto", padding: "0.5rem 1.25rem", fontSize: "13px" }} disabled={deciding === (item.requestId || item.id)} onClick={() => handleDecide(item.requestId || item.id, true)}>Approve</button>
                  <button style={{ ...S.btnSecondary, padding: "0.5rem 1.25rem", fontSize: "13px" }} disabled={deciding === (item.requestId || item.id)} onClick={() => handleDecide(item.requestId || item.id, false)}>Deny</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {history.length > 0 && (<>
          <div style={{ ...S.label, marginBottom: "1rem" }}>Recent decisions</div>
          {history.slice(0, 20).map(item => (
            <div key={item.requestId || item.id} style={{ ...S.approvalRow, opacity: 0.7 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <span style={{ fontSize: "14px", color: "var(--text-secondary)" }}>{item.workerName || item.agentName || "Worker"}</span>
                  <span style={{ fontSize: "13px", color: "var(--text-tertiary)", marginLeft: "0.75rem" }}>{item.action || item.summary || "Action"}</span>
                </div>
                <span style={{ fontSize: "12px", fontWeight: 600, color: item.approved || item.decision === "approved" ? "#5bb98c" : "#c97055" }}>{item.approved || item.decision === "approved" ? "Approved" : "Denied"}</span>
              </div>
            </div>
          ))}
        </>)}
      </>)}
    </div>
  );
}

/* ===================================================================
   ReceiptsView
   =================================================================== */

function ReceiptsView() {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { const runtime = loadRuntimeConfig(); const result = await fetchWorkOrderReceipts(runtime, { limit: 50 }); setReceipts(result?.items || result || []); } catch { setReceipts([]); } setLoading(false); })(); }, []);
  return (
    <div>
      <h1 style={S.pageTitle}>History</h1>
      <p style={S.pageSub}>Execution log across all workers.</p>
      {loading ? <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div> : receipts.length === 0 ? <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>No executions yet.</div> : receipts.map(r => (
        <div key={r.id || r.receiptId} style={S.logEntry}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "14px", color: "var(--text-primary)" }}>{r.workerName || r.agentName || r.summary || r.id || "Execution"}</div>
              <div style={S.logTime}>{r.completedAt ? formatDateTime(r.completedAt) : r.createdAt ? formatDateTime(r.createdAt) : ""}</div>
            </div>
            {r.cost != null && <div style={{ ...S.workerMeta, color: "var(--text-secondary)" }}>{typeof r.cost === "number" ? `$${r.cost.toFixed(2)}` : formatCurrency(r.cost)}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ===================================================================
   SettingsModal
   =================================================================== */

function ToggleSwitch({ on, onToggle }) {
  return <button onClick={onToggle} style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", background: on ? "var(--accent)" : "var(--bg-hover)", position: "relative", flexShrink: 0, transition: "background 150ms" }}><div style={{ width: 18, height: 18, borderRadius: "50%", background: "white", position: "absolute", top: 3, left: on ? 23 : 3, transition: "left 150ms" }} /></button>;
}

function ThemePreview({ opt, selected, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: "0.75rem", borderRadius: 10, cursor: "pointer", textAlign: "center", fontFamily: "inherit", transition: "border-color 150ms", flex: 1, border: selected ? "2px solid var(--accent)" : "2px solid var(--border)", background: selected ? "var(--gold-dim)" : "transparent" }}>
      {opt.key === "auto" ? (
        <div style={{ width: 80, height: 50, borderRadius: 8, margin: "0 auto 0.5rem", display: "flex", overflow: "hidden" }}>
          <div style={{ flex: 1, background: opt.bgLeft, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 4 }}><div style={{ width: "70%", height: 8, borderRadius: 2, background: opt.fgLeft }} /></div>
          <div style={{ flex: 1, background: opt.bgRight, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 4 }}><div style={{ width: "70%", height: 8, borderRadius: 2, background: opt.fgRight }} /></div>
        </div>
      ) : (
        <div style={{ width: 80, height: 50, borderRadius: 8, margin: "0 auto 0.5rem", background: opt.bg, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 6 }}><div style={{ width: "80%", height: 8, borderRadius: 2, background: opt.fg }} /></div>
      )}
      <div style={{ fontSize: "13px", fontWeight: 600, color: selected ? "var(--text-primary)" : "var(--text-secondary)" }}>{opt.label}</div>
    </button>
  );
}

function SettingsModal({ userEmail, userTier, creditBalance, onClose }) {
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [workFunction, setWorkFunction] = useState("founder");
  const [preferences, setPreferences] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [tab, setTab] = useState("general");
  const [theme, setTheme] = useState(() => loadTheme());
  const [font, setFont] = useState("default");
  const [defaultModel, setDefaultModel] = useState("nvidia/nemotron-3-super-120b-a12b:free");
  const [notifApproval, setNotifApproval] = useState(true);
  const [notifWeekly, setNotifWeekly] = useState(false);
  const [notifErrors, setNotifErrors] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copiedAccountId, setCopiedAccountId] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [showCreditPicker, setShowCreditPicker] = useState(false);
  const runtime = loadRuntimeConfig();

  useEffect(() => {
    try { const stored = JSON.parse(localStorage.getItem("nooterra_settings") || "{}"); if (stored.displayName) setDisplayName(stored.displayName); if (stored.workFunction) setWorkFunction(stored.workFunction); if (stored.preferences) setPreferences(stored.preferences); if (stored.defaultModel) setDefaultModel(stored.defaultModel); } catch { /* ignore */ }
    (async () => { try { const result = await fetchTenantSettings(runtime); if (result?.displayName) setDisplayName(result.displayName); if (result?.name && !displayName) setDisplayName(result.name); } catch { /* ignore */ } setLoading(false); })();
  }, []);

  useEffect(() => { function handleKey(e) { if (e.key === "Escape") onClose(); } document.addEventListener("keydown", handleKey); return () => document.removeEventListener("keydown", handleKey); }, [onClose]);

  async function handleSave() {
    setSaveState("saving");
    try {
      const settingsData = { displayName: displayName.trim(), workFunction, preferences: preferences.trim(), defaultModel };
      localStorage.setItem("nooterra_settings", JSON.stringify(settingsData));
      if (displayName.trim()) localStorage.setItem("nooterra_user_name", displayName.trim());
      try { await updateTenantSettings(runtime, { displayName: displayName.trim() }); } catch { /* backend may reject */ }
      setSaveState("saved"); setTimeout(() => setSaveState("idle"), 2000);
    } catch (err) { console.error("Settings save failed:", err); setSaveState("error"); setTimeout(() => setSaveState("idle"), 2000); }
  }

  function handleThemeChange(t) { setTheme(t); saveTheme(t); }
  function handleCopyAccountId() { try { navigator.clipboard.writeText(runtime.tenantId); setCopiedAccountId(true); setTimeout(() => setCopiedAccountId(false), 1500); } catch { /* ignore */ } }

  async function handleBillingCheckout(payload) {
    setBillingLoading(true);
    try { const result = await workerApiRequest({ pathname: "/v1/billing/checkout", method: "POST", body: { ...payload, email: userEmail } }); if (result?.url) window.location.href = result.url; else { console.error("No checkout URL returned", result); setBillingLoading(false); } } catch (err) { console.error("Billing checkout failed:", err); setBillingLoading(false); }
  }

  // --- Notification preferences state ---
  const [notifEmailEnabled, setNotifEmailEnabled] = useState(false);
  const [notifEmailAddress, setNotifEmailAddress] = useState(userEmail || "");
  const [notifSlackEnabled, setNotifSlackEnabled] = useState(false);
  const [notifSlackWebhook, setNotifSlackWebhook] = useState("");
  const [notifSlackTesting, setNotifSlackTesting] = useState(false);
  const [notifSlackTestResult, setNotifSlackTestResult] = useState(null);
  const [notifEvents, setNotifEvents] = useState({
    approvalRequired: true,
    workerCompleted: false,
    workerError: true,
    budgetAlert: true,
    securityAlert: true,
  });
  const [notifSaveState, setNotifSaveState] = useState("idle");

  // Load notification preferences on mount
  useEffect(() => {
    (async () => {
      try {
        const prefs = await workerApiRequest({ pathname: "/v1/notifications/preferences", method: "GET" });
        if (prefs) {
          if (prefs.emailEnabled != null) setNotifEmailEnabled(prefs.emailEnabled);
          if (prefs.emailAddress) setNotifEmailAddress(prefs.emailAddress);
          if (prefs.slackEnabled != null) setNotifSlackEnabled(prefs.slackEnabled);
          if (prefs.slackWebhookUrl) setNotifSlackWebhook(prefs.slackWebhookUrl);
          if (prefs.events) setNotifEvents(prev => ({ ...prev, ...prefs.events }));
        }
      } catch { /* no prefs yet */ }
    })();
  }, []);

  async function handleNotifSave() {
    setNotifSaveState("saving");
    try {
      await workerApiRequest({
        pathname: "/v1/notifications/preferences",
        method: "PUT",
        body: {
          emailEnabled: notifEmailEnabled,
          emailAddress: notifEmailAddress.trim(),
          slackEnabled: notifSlackEnabled,
          slackWebhookUrl: notifSlackWebhook.trim(),
          events: notifEvents,
        },
      });
      setNotifSaveState("saved");
      setTimeout(() => setNotifSaveState("idle"), 2000);
    } catch (err) {
      console.error("Notification preferences save failed:", err);
      setNotifSaveState("error");
      setTimeout(() => setNotifSaveState("idle"), 2000);
    }
  }

  async function handleSlackTest() {
    setNotifSlackTesting(true);
    setNotifSlackTestResult(null);
    try {
      const result = await workerApiRequest({
        pathname: "/v1/notifications/test-slack",
        method: "POST",
        body: { webhookUrl: notifSlackWebhook.trim() },
      });
      setNotifSlackTestResult(result?.ok ? "success" : "error");
    } catch {
      setNotifSlackTestResult("error");
    }
    setNotifSlackTesting(false);
    setTimeout(() => setNotifSlackTestResult(null), 3000);
  }

  function toggleNotifEvent(key) {
    setNotifEvents(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const sidebarTabs = [{ key: "general", label: "General" }, { key: "notifications", label: "Notifications" }, { key: "billing", label: "Billing" }, { key: "account", label: "Account" }];
  const themes = [{ key: "light", label: "Light", bg: "#FAF9F5", fg: "#EBE8E0" }, { key: "auto", label: "Auto", bgLeft: "#FAF9F5", bgRight: "#212121", fgLeft: "#EBE8E0", fgRight: "#2f2f2f" }, { key: "dark", label: "Dark", bg: "#212121", fg: "#2f2f2f" }];
  const fonts = [{ key: "default", label: "Default" }, { key: "sans", label: "Sans" }, { key: "mono", label: "Mono" }];

  function SaveButton({ label = "Save" }) {
    const isSaved = saveState === "saved"; const isSaving = saveState === "saving"; const isError = saveState === "error";
    return <button style={{ ...S.btnPrimary, width: "auto", padding: "8px 20px", fontSize: "14px", opacity: isSaving ? 0.6 : 1, background: isSaved ? "#5bb98c" : isError ? "#c97055" : "#1a1a1a", transition: "background 300ms, opacity 150ms, transform 150ms", transform: isSaved ? "scale(1.02)" : "scale(1)" }} disabled={isSaving} onClick={handleSave}>{isSaving ? "Saving..." : isSaved ? "\u2713 Saved" : isError ? "Failed -- try again" : label}</button>;
  }

  const currentTier = userTier || "free";
  const balance = creditBalance != null ? (creditBalance / 100).toFixed(2) : "0.00";

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" style={{ width: "100%", maxWidth: 720, maxHeight: "85vh", background: "var(--bg-surface)", borderRadius: 16, boxShadow: "var(--shadow-lg)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Settings</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 4, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 150ms" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
          ><CloseIcon /></button>
        </div>
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ width: 180, flexShrink: 0, borderRight: "1px solid var(--border)", padding: "16px 0", overflowY: "auto" }}>
            {sidebarTabs.map(s => (
              <button key={s.key} onClick={() => setTab(s.key)} style={{ display: "block", width: "100%", padding: "8px 20px", fontSize: "14px", fontWeight: tab === s.key ? 600 : 400, color: tab === s.key ? "var(--text-primary)" : "var(--text-secondary)", background: tab === s.key ? "var(--bg-hover)" : "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "background 150ms, color 150ms", borderLeft: tab === s.key ? "2px solid var(--accent)" : "2px solid transparent" }}
                onMouseEnter={e => { if (tab !== s.key) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={e => { if (tab !== s.key) e.currentTarget.style.background = "transparent"; }}
              >{s.label}</button>
            ))}
          </div>
          <div style={{ flex: 1, padding: "24px", overflowY: "auto" }}>
            {loading ? <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div> : (<>
              {tab === "general" && (<div>
                <div style={{ marginBottom: "2rem" }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1.25rem" }}>Profile</div>
                  <label style={S.label}>Display name</label>
                  <FocusInput type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
                  <label style={S.label}>Work function</label>
                  <select value={workFunction} onChange={(e) => setWorkFunction(e.target.value)} style={{ ...S.input, cursor: "pointer", appearance: "auto" }}>{WORK_FUNCTIONS.map(wf => <option key={wf.value} value={wf.value}>{wf.label}</option>)}</select>
                </div>
                <div style={{ marginBottom: "2rem" }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Preferences</div>
                  <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: 0, marginBottom: "0.75rem" }}>What preferences should workers consider?</p>
                  <textarea value={preferences} onChange={(e) => setPreferences(e.target.value)} placeholder="e.g. Always use formal language. Prefer bullet points over paragraphs." style={{ ...S.textarea, minHeight: 80 }} />
                </div>
                <div style={{ marginBottom: "2rem" }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Appearance</div>
                  <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: 0, marginBottom: "1rem" }}>Choose how Nooterra looks.</p>
                  <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>{themes.map(opt => <ThemePreview key={opt.key} opt={opt} selected={theme === opt.key} onClick={() => handleThemeChange(opt.key)} />)}</div>
                  <label style={S.label}>Font</label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    {fonts.map(f => <button key={f.key} onClick={() => setFont(f.key)} style={{ padding: "6px 16px", fontSize: "13px", fontWeight: 500, borderRadius: 6, border: font === f.key ? "1px solid var(--accent)" : "1px solid var(--border)", background: font === f.key ? "var(--gold-dim)" : "transparent", color: font === f.key ? "var(--text-primary)" : "var(--text-secondary)", cursor: "pointer", fontFamily: f.key === "mono" ? "monospace" : f.key === "sans" ? "sans-serif" : "inherit", transition: "all 150ms" }}>{f.label}</button>)}
                  </div>
                </div>
                <SaveButton />
              </div>)}
              {tab === "notifications" && (<div>
                <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Notification channels</div>
                <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: 0, marginBottom: "1.5rem" }}>Choose how you want to be notified about worker activity.</p>

                {[
                  { key: "email", label: "Email", desc: "Get notifications delivered to your inbox", enabled: notifEmailEnabled, onToggle: () => setNotifEmailEnabled(!notifEmailEnabled) },
                  { key: "slack", label: "Slack", desc: "Get notifications in a Slack channel", enabled: notifSlackEnabled, onToggle: () => setNotifSlackEnabled(!notifSlackEnabled) },
                  { key: "dashboard", label: "Dashboard", desc: "See notifications in your Nooterra dashboard", enabled: true, onToggle: () => {} },
                ].map((ch) => (
                  <div key={ch.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
                    <div>
                      <div style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: 500 }}>{ch.label}</div>
                      <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: 2 }}>{ch.desc}</div>
                    </div>
                    <ToggleSwitch on={ch.enabled} onToggle={ch.onToggle} />
                  </div>
                ))}

                <div style={{ marginTop: "2rem", marginBottom: "1rem" }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Events</div>
                  <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: 0, marginBottom: "1rem" }}>Choose which events trigger notifications.</p>
                </div>
                {[
                  { key: "approvalRequired", label: "Approval needed", desc: "Worker is waiting for your approval" },
                  { key: "workerCompleted", label: "Run completed", desc: "A scheduled run finished" },
                  { key: "workerError", label: "Run failed", desc: "Something went wrong during execution" },
                  { key: "budgetAlert", label: "Low credits", desc: "Credits are running low" },
                  { key: "securityAlert", label: "Security alert", desc: "Anomaly or policy violation detected" },
                ].map((evt) => (
                  <div key={evt.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                    <div>
                      <div style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: 500 }}>{evt.label}</div>
                      <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: 2 }}>{evt.desc}</div>
                    </div>
                    <ToggleSwitch on={notifEvents[evt.key]} onToggle={() => toggleNotifEvent(evt.key)} />
                  </div>
                ))}

                <div style={{ marginTop: "1.5rem" }}>
                  <button style={{ ...S.btnPrimary, width: "auto", padding: "8px 20px", fontSize: "14px", opacity: notifSaveState === "saving" ? 0.6 : 1, background: notifSaveState === "saved" ? "#5bb98c" : notifSaveState === "error" ? "#c97055" : "#1a1a1a", transition: "background 300ms" }} disabled={notifSaveState === "saving"} onClick={handleNotifSave}>{notifSaveState === "saving" ? "Saving..." : notifSaveState === "saved" ? "\u2713 Saved" : "Save"}</button>
                </div>
              </div>)}
              {tab === "account" && (<div>
                <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1.25rem" }}>Account</div>
                <label style={S.label}>Email</label>
                <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>{userEmail || "Not available"}</div>
                <label style={S.label}>Account ID</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem" }}>
                  <div style={{ fontSize: "13px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums", fontFamily: "monospace" }}>{runtime.tenantId}</div>
                  <button onClick={handleCopyAccountId} style={{ fontSize: "12px", padding: "2px 8px", borderRadius: 4, border: "1px solid var(--border)", background: copiedAccountId ? "#5bb98c" : "transparent", color: copiedAccountId ? "white" : "var(--text-tertiary)", cursor: "pointer", fontFamily: "inherit", transition: "all 150ms" }}>{copiedAccountId ? "Copied" : "Copy"}</button>
                </div>
                <div style={{ borderTop: "1px solid var(--border)", margin: "2rem 0" }} />
                <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1rem" }}>Active sessions</div>
                <div style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: 8, marginBottom: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div><div style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-primary)" }}>This browser</div><div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>Current session</div></div>
                    <div style={{ fontSize: "12px", color: "#5bb98c", fontWeight: 600 }}>Active</div>
                  </div>
                </div>
                <button style={{ ...S.btnSecondary, fontSize: "13px", padding: "0.5rem 1rem" }} onClick={async () => { await logoutSession(); navigate("/login"); }}>Log out of all devices</button>
                <div style={{ borderTop: "1px solid var(--border)", margin: "2rem 0" }} />
                {!showDeleteConfirm ? (
                  <button style={{ ...S.btnSecondary, borderColor: "#c97055", color: "#c97055" }} onClick={() => setShowDeleteConfirm(true)}>Delete account</button>
                ) : (
                  <div style={{ padding: "1.25rem", border: "1px solid #c97055", borderRadius: 10, background: "rgba(201,112,85,0.06)" }}>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: "#c97055", marginBottom: "0.5rem" }}>Are you sure?</div>
                    <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1rem", lineHeight: 1.5 }}>This will permanently delete your account and all workers. This action cannot be undone.</div>
                    <div style={{ display: "flex", gap: "0.75rem" }}>
                      <button style={{ ...S.btnPrimary, width: "auto", background: "#c97055" }} onClick={async () => { await logoutSession(); try { localStorage.removeItem(PRODUCT_RUNTIME_STORAGE_KEY); } catch { /* ignore */ } try { localStorage.removeItem(ONBOARDING_STORAGE_KEY); } catch { /* ignore */ } navigate("/login"); }}>Yes, delete my account</button>
                      <button style={S.btnSecondary} onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>)}
              {tab === "billing" && (<div>
                <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1.25rem" }}>Billing</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderRadius: 10, border: "1px solid var(--border)", marginBottom: "1.5rem" }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{tierLabel(currentTier)} plan</div>
                    <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: 2 }}>Credits: ${balance}</div>
                  </div>
                  {currentTier === "free" && <button style={{ ...S.btnSecondary, width: "auto", padding: "6px 16px", fontSize: "13px", opacity: billingLoading ? 0.6 : 1 }} disabled={billingLoading} onClick={() => handleBillingCheckout({ plan: "pro" })}>{billingLoading ? "..." : "Upgrade"}</button>}
                </div>
                <label style={S.label}>Credits</label>
                <div style={{ display: "flex", gap: 8, marginBottom: "1.5rem", flexWrap: "wrap" }}>
                  {[{ amount: 500, label: "$5" }, { amount: 2000, label: "$20" }, { amount: 5000, label: "$50" }].map(c => (
                    <button key={c.amount} style={{ ...S.btnSecondary, width: "auto", padding: "6px 16px", fontSize: "13px" }} onClick={() => handleBillingCheckout({ type: "credits", amount: c.amount })}>Add {c.label}</button>
                  ))}
                </div>
                {currentTier !== "free" && (<><div style={{ borderTop: "1px solid var(--border)", margin: "1.5rem 0" }} /><button style={{ ...S.btnGhost, color: "var(--text-tertiary)", fontSize: "13px" }}>Cancel plan</button></>)}
              </div>)}
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   PricingView
   =================================================================== */

function PricingView() {
  const tiers = [
    { name: "Free", price: "Free forever", features: ["Local CLI workers", "Any AI provider (bring your own key)", "Unlimited workers and runs", "Charter-based governance", "Full activity logs"], cta: "Install CLI", ctaHref: "https://docs.nooterra.ai", primary: false },
    { name: "Pro", price: "$29 / month", features: ["Everything in Free", "Cloud-hosted workers", "Web dashboard", "Slack approval integration", "Email notifications", "Priority support"], cta: "Start free trial", ctaAction: () => navigate("/signup"), primary: true },
    { name: "Team", price: "$99 / month", features: ["Everything in Pro", "Shared team dashboard", "SSO / SAML", "Audit log export", "Custom worker templates", "Dedicated support"], cta: "Contact us", ctaHref: "mailto:team@nooterra.ai", primary: false },
  ];
  return (
    <div style={S.pricingWrap} className="lovable-fade">
      <h1 style={S.pricingTitle}>Simple, honest pricing</h1>
      <p style={{ fontSize: "1.05rem", color: "var(--text-secondary)", marginBottom: "3rem", maxWidth: 520, lineHeight: 1.6 }}>Start free with local workers. Upgrade when you want cloud hosting and team features.</p>
      {tiers.map((tier, i) => (
        <div key={tier.name} style={{ ...S.tier, borderBottom: i < tiers.length - 1 ? S.tier.borderBottom : "none" }}>
          <div>
            <div style={S.tierName}>{tier.name}</div>
            <div style={S.tierPrice}>{tier.price}</div>
            {tier.features.map((f, j) => <div key={j} style={S.tierFeature}>{f}</div>)}
          </div>
          <div style={{ paddingTop: "0.5rem" }}>
            {tier.ctaHref ? (
              <a href={tier.ctaHref} target={tier.ctaHref.startsWith("http") ? "_blank" : undefined} rel={tier.ctaHref.startsWith("http") ? "noopener noreferrer" : undefined} style={{ ...(tier.primary ? S.btnPrimary : S.btnSecondary), textDecoration: "none", display: "inline-flex", width: "auto" }}>{tier.cta}</a>
            ) : (
              <button style={{ ...(tier.primary ? S.btnPrimary : S.btnSecondary), width: "auto" }} onClick={tier.ctaAction}>{tier.cta}</button>
            )}
          </div>
        </div>
      ))}
      <div style={{ marginTop: "3rem" }}><a href="/" style={S.link} onClick={(e) => { e.preventDefault(); navigate("/"); }}>{"\u2190"} Back to home</a></div>
    </div>
  );
}

/* ===================================================================
   IntegrationsView
   =================================================================== */

const AVAILABLE_INTEGRATIONS = [
  { key: "gmail", name: "Gmail", description: "Read and send emails", authType: "oauth", oauthUrl: "/v1/integrations/gmail/auth" },
  { key: "slack", name: "Slack", description: "Send messages and get approvals", authType: "webhook", fieldLabel: "Webhook URL", fieldPlaceholder: "https://hooks.slack.com/services/..." },
  { key: "github", name: "GitHub", description: "Repos, issues, PRs", authType: "oauth", oauthUrl: "/v1/integrations/github/auth" },
  { key: "google_calendar", name: "Google Calendar", description: "Schedule and manage events", authType: "oauth", oauthUrl: "/v1/integrations/google-calendar/auth" },
  { key: "stripe", name: "Stripe", description: "Payment and billing data", authType: "apikey", fieldLabel: "API Key", fieldPlaceholder: "sk_live_..." },
  { key: "notion", name: "Notion", description: "Notes and databases", authType: "oauth", oauthUrl: "/v1/integrations/notion/auth" },
  { key: "linear", name: "Linear", description: "Issue tracking", authType: "apikey", fieldLabel: "API Key", fieldPlaceholder: "lin_api_..." },
  { key: "custom_webhook", name: "Custom Webhook", description: "Any HTTP endpoint", authType: "webhook", fieldLabel: "URL", fieldPlaceholder: "https://example.com/webhook", hasSecret: true },
];

function IntegrationConnectModal({ integration, onClose, onSave }) {
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!value.trim()) { setError("This field is required."); return; }
    setSaving(true);
    setError("");
    try {
      const body = { service: integration.key, config: { [integration.authType === "apikey" ? "apiKey" : "webhookUrl"]: value.trim() } };
      if (integration.hasSecret && secret.trim()) body.config.secret = secret.trim();
      await workerApiRequest({ pathname: "/v1/integrations", method: "POST", body });
      onSave();
    } catch (err) {
      setError(err?.message || "Failed to save integration.");
    }
    setSaving(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <div className="popover-animate" style={{ position: "relative", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "2rem", width: "100%", maxWidth: 420, boxShadow: "var(--shadow-lg)" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.3rem" }}>Connect {integration.name}</h2>
        <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>{integration.description}</p>
        {error && <div style={S.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={S.label}>{integration.fieldLabel}</label>
          <FocusInput type="text" value={value} onChange={e => setValue(e.target.value)} placeholder={integration.fieldPlaceholder} />
          {integration.hasSecret && (<>
            <label style={S.label}>Secret (optional)</label>
            <FocusInput type="text" value={secret} onChange={e => setSecret(e.target.value)} placeholder="Signing secret" />
          </>)}
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
            <button type="button" style={S.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...S.btnPrimary, width: "auto", opacity: saving ? 0.5 : 1 }} disabled={saving}>{saving ? "Saving..." : "Connect"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function IntegrationsView() {
  const [connected, setConnected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connectModal, setConnectModal] = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);

  async function loadIntegrations() {
    try {
      const result = await workerApiRequest({ pathname: "/v1/integrations", method: "GET" });
      setConnected(result?.items || result || []);
    } catch { setConnected([]); }
    setLoading(false);
  }

  useEffect(() => { loadIntegrations(); }, []);

  function isConnected(serviceKey) {
    return connected.find(c => c.service === serviceKey || c.key === serviceKey);
  }

  async function handleConnect(integration) {
    if (integration.authType === "oauth") {
      window.location.href = WORKER_API_BASE + integration.oauthUrl;
      return;
    }
    setConnectModal(integration);
  }

  async function handleDisconnect(serviceKey) {
    const entry = isConnected(serviceKey);
    if (!entry) return;
    setDisconnecting(serviceKey);
    try {
      await workerApiRequest({ pathname: `/v1/integrations/${encodeURIComponent(entry.id)}`, method: "DELETE" });
      await loadIntegrations();
    } catch { /* ignore */ }
    setDisconnecting(null);
  }

  return (
    <div>
      <h1 style={S.pageTitle}>Integrations</h1>
      <p style={S.pageSub}>Connect services your workers can use to get work done.</p>
      {loading ? (
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {AVAILABLE_INTEGRATIONS.map(integration => {
            const conn = isConnected(integration.key);
            return (
              <div key={integration.key} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 24, background: "var(--bg-surface)", transition: "border-color 150ms" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>{integration.name}</div>
                </div>
                <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.5 }}>{integration.description}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={S.statusDot(conn ? "#5bb98c" : "var(--text-tertiary)")} />
                    <span style={{ fontSize: "13px", color: conn ? "#5bb98c" : "var(--text-tertiary)", fontWeight: 500 }}>{conn ? "Connected" : "Not connected"}</span>
                  </div>
                  {conn ? (
                    <button
                      style={{ ...S.btnSecondary, padding: "6px 14px", fontSize: "13px", opacity: disconnecting === integration.key ? 0.5 : 1 }}
                      disabled={disconnecting === integration.key}
                      onClick={() => handleDisconnect(integration.key)}
                    >{disconnecting === integration.key ? "..." : "Disconnect"}</button>
                  ) : (
                    <button
                      style={{ ...S.btnPrimary, width: "auto", padding: "6px 14px", fontSize: "13px" }}
                      onClick={() => handleConnect(integration)}
                    >Connect</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {connectModal && (
        <IntegrationConnectModal
          integration={connectModal}
          onClose={() => setConnectModal(null)}
          onSave={() => { setConnectModal(null); loadIntegrations(); }}
        />
      )}
    </div>
  );
}

/* ===================================================================
   WorkerIntegrationsSection
   =================================================================== */

function WorkerIntegrationsSection({ workerId }) {
  const [connected, setConnected] = useState([]);
  const [workerIntegrations, setWorkerIntegrations] = useState({});
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [allResult, workerResult] = await Promise.all([
          workerApiRequest({ pathname: "/v1/integrations", method: "GET" }),
          workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/integrations`, method: "GET" }),
        ]);
        const allItems = allResult?.items || allResult || [];
        setConnected(allItems);
        const wItems = workerResult?.items || workerResult || [];
        const map = {};
        wItems.forEach(wi => { map[wi.service || wi.key || wi.integrationId] = true; });
        setWorkerIntegrations(map);
      } catch { setConnected([]); setWorkerIntegrations({}); }
      setLoading(false);
    })();
  }, [workerId]);

  async function handleToggle(integration) {
    const serviceKey = integration.service || integration.key;
    const currentlyEnabled = !!workerIntegrations[serviceKey];
    setToggling(serviceKey);
    try {
      if (currentlyEnabled) {
        await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/integrations/${encodeURIComponent(serviceKey)}`, method: "DELETE" });
      } else {
        await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/integrations`, method: "POST", body: { service: serviceKey, integrationId: integration.id } });
      }
      setWorkerIntegrations(prev => ({ ...prev, [serviceKey]: !currentlyEnabled }));
    } catch { /* ignore */ }
    setToggling(null);
  }

  if (loading) return <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading integrations...</div>;
  if (connected.length === 0) return <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>No integrations connected yet. Go to Integrations to connect services.</div>;

  return (
    <div>
      <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1rem" }}>Choose which connected integrations this worker can access.</p>
      {connected.map(integration => {
        const serviceKey = integration.service || integration.key;
        const info = AVAILABLE_INTEGRATIONS.find(a => a.key === serviceKey);
        const enabled = !!workerIntegrations[serviceKey];
        return (
          <div key={serviceKey} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 0", borderBottom: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-primary)" }}>{info?.name || serviceKey}</div>
              <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{info?.description || ""}</div>
            </div>
            <ToggleSwitch on={enabled} onToggle={() => { if (toggling !== serviceKey) handleToggle(integration); }} />
          </div>
        );
      })}
    </div>
  );
}

/* ===================================================================
   OnboardingFlow
   =================================================================== */

function OnboardingFlow({ onComplete, userEmail }) {
  const [step, setStep] = useState(1);
  const [businessDescription, setBusinessDescription] = useState("");
  const [industryResult, setIndustryResult] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [selectedWorkflows, setSelectedWorkflows] = useState(new Set());
  const [teamWorkers, setTeamWorkers] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [connectingIntegration, setConnectingIntegration] = useState(null);
  const [skippedIntegrations, setSkippedIntegrations] = useState(new Set());
  const TOTAL_STEPS = 6;

  function handleContinue() {
    if (step === 1) {
      const result = identifyIndustry(businessDescription);
      setIndustryResult(result);
      setEditValues({
        industry: (result.industry || "") + (result.subIndustry ? " / " + result.subIndustry : ""),
        size: result.companySize || "Small",
        location: result.location || "Not specified",
      });
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else if (step === 3) {
      const team = proposeTeam(industryResult);
      const workflowKeywords = Array.from(selectedWorkflows);
      const relevantWorkers = team.workers.filter(w => {
        const desc = (w.role + " " + (w.description || "") + " " + (w.canDo || []).join(" ")).toLowerCase();
        return workflowKeywords.some(wf => {
          if (wf === "communication") return /email|call|reply|respond|inquir|message|communicat/.test(desc);
          if (wf === "scheduling") return /schedul|book|appoint|assign|calendar|coordinat/.test(desc);
          if (wf === "billing") return /invoice|payment|bill|receipt|follow.up|collect/.test(desc);
          return false;
        });
      });
      setTeamWorkers(relevantWorkers.length > 0 ? relevantWorkers : team.workers.slice(0, 3));
      setStep(4);
    } else if (step === 4) {
      const integ = identifyIntegrations(teamWorkers);
      const relevantInteg = (integ.required || []).filter(ig => {
        const name = (ig.name || ig.service || "").toLowerCase();
        const available = ["email", "gmail", "calendar", "google_calendar", "slack"];
        return available.some(a => name.includes(a) || (ig.service || "").includes(a));
      });
      const comingSoon = (integ.required || []).filter(ig => {
        const name = (ig.name || ig.service || "").toLowerCase();
        const available = ["email", "gmail", "calendar", "google_calendar", "slack"];
        return !available.some(a => name.includes(a) || (ig.service || "").includes(a));
      });
      setIntegrations([
        ...relevantInteg.map(ig => ({ ...ig, available: true })),
        ...comingSoon.map(ig => ({ ...ig, available: false })),
      ]);
      setStep(5);
    } else if (step === 5) {
      setStep(6);
    } else if (step === 6) {
      localStorage.setItem("nooterra_onboarding_complete", "true");
      onComplete();
    }
  }

  function toggleWorkflow(id) {
    setSelectedWorkflows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 2) next.add(id);
      return next;
    });
  }

  const stepDots = (
    <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: "3rem" }}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: "50%",
          background: i < step ? "var(--accent)" : "var(--border)",
          transition: "background 300ms",
        }} />
      ))}
    </div>
  );

  const continueBtn = (disabled = false) => (
    <button
      onClick={handleContinue}
      disabled={disabled}
      style={{
        ...S.btnPrimary, width: "auto", padding: "14px 40px", fontSize: "15px",
        marginTop: "2rem", opacity: disabled ? 0.4 : 1,
      }}
    >
      {step === 6 ? "Go to Dashboard" : "Continue"}
    </button>
  );

  const wrapStyle = {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", minHeight: "100vh", padding: "3rem 2rem",
    background: "var(--bg-100)",
  };

  // STEP 1: What does your business do?
  if (step === 1) {
    return (
      <div style={wrapStyle} className="lovable-fade">
        {stepDots}
        <div style={{ maxWidth: 580, width: "100%", textAlign: "center" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "var(--text-100)", marginBottom: "0.75rem", letterSpacing: "-0.02em" }}>
            What does your business do?
          </h1>
          <p style={{ fontSize: "16px", color: "var(--text-200)", marginBottom: "2.5rem", lineHeight: 1.6 }}>
            We'll propose an AI team tailored to your business.
          </p>
          <textarea
            value={businessDescription}
            onChange={e => setBusinessDescription(e.target.value)}
            placeholder="Describe your business..."
            rows={3}
            style={{
              display: "block", width: "100%", padding: "18px 20px", fontSize: "18px",
              lineHeight: 1.6, border: "1px solid var(--border)", borderRadius: 12,
              background: "var(--bg-400)", color: "var(--text-100)", outline: "none",
              resize: "vertical", fontFamily: "var(--font-body)", boxSizing: "border-box",
              transition: "border-color 150ms",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = "var(--accent)"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
          />
          <p style={{ fontSize: "13px", color: "var(--text-300)", marginTop: "1rem", lineHeight: 1.8 }}>
            e.g. Plumbing company in Denver with 5 techs &middot; Shopify store selling supplements &middot; Personal injury law firm
          </p>
          {continueBtn(!businessDescription.trim())}
        </div>
      </div>
    );
  }

  // STEP 2: Here's what we found
  if (step === 2) {
    const fields = [
      { key: "industry", label: "Industry" },
      { key: "size", label: "Size" },
      { key: "location", label: "Location" },
    ];
    return (
      <div style={wrapStyle} className="lovable-fade">
        {stepDots}
        <div style={{ maxWidth: 520, width: "100%" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "var(--text-100)", marginBottom: "0.75rem", letterSpacing: "-0.02em", textAlign: "center" }}>
            Here's what we found.
          </h1>
          <p style={{ fontSize: "16px", color: "var(--text-200)", marginBottom: "2.5rem", lineHeight: 1.6, textAlign: "center" }}>
            Edit any details below to improve our recommendations.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {fields.map(f => (
              <div key={f.key} style={{
                padding: "18px 20px", border: "1px solid var(--border)", borderRadius: 12,
                background: "var(--bg-400)", display: "flex", alignItems: "center",
                justifyContent: "space-between",
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-300)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{f.label}</div>
                  {editingField === f.key ? (
                    <input
                      autoFocus
                      value={editValues[f.key] || ""}
                      onChange={e => setEditValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                      onBlur={() => setEditingField(null)}
                      onKeyDown={e => { if (e.key === "Enter") setEditingField(null); }}
                      style={{
                        fontSize: "16px", fontWeight: 600, color: "var(--text-100)",
                        background: "transparent", border: "none", outline: "none",
                        padding: 0, fontFamily: "var(--font-body)", width: "100%",
                        borderBottom: "1px solid var(--accent)",
                      }}
                    />
                  ) : (
                    <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-100)" }}>{editValues[f.key] || "--"}</div>
                  )}
                </div>
                <button
                  onClick={() => setEditingField(editingField === f.key ? null : f.key)}
                  style={{
                    background: "none", border: "1px solid var(--border)", borderRadius: 6,
                    padding: "4px 12px", fontSize: "12px", fontWeight: 500, color: "var(--text-200)",
                    cursor: "pointer", fontFamily: "var(--font-body)", transition: "border-color 150ms",
                  }}
                >
                  {editingField === f.key ? "Done" : "Edit"}
                </button>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center" }}>{continueBtn()}</div>
        </div>
      </div>
    );
  }

  // STEP 3: What should we handle first?
  if (step === 3) {
    const workflows = [
      { id: "communication", title: "Customer communication", desc: "Answer calls, reply to emails, respond to inquiries" },
      { id: "scheduling", title: "Scheduling & coordination", desc: "Book appointments, assign jobs, manage calendar" },
      { id: "billing", title: "Billing & follow-up", desc: "Send invoices, chase payments, manage receipts" },
    ];
    return (
      <div style={wrapStyle} className="lovable-fade">
        {stepDots}
        <div style={{ maxWidth: 580, width: "100%" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "var(--text-100)", marginBottom: "0.75rem", letterSpacing: "-0.02em", textAlign: "center" }}>
            What should we handle first?
          </h1>
          <p style={{ fontSize: "16px", color: "var(--text-200)", marginBottom: "2.5rem", lineHeight: 1.6, textAlign: "center" }}>
            Select one or two areas to start with.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {workflows.map(wf => {
              const selected = selectedWorkflows.has(wf.id);
              return (
                <button
                  key={wf.id}
                  onClick={() => toggleWorkflow(wf.id)}
                  style={{
                    padding: "24px", textAlign: "left", border: selected ? "2px solid var(--accent)" : "1px solid var(--border)",
                    borderRadius: 12, background: selected ? "var(--accent-subtle, rgba(196,97,58,0.04))" : "var(--bg-400)",
                    cursor: "pointer", fontFamily: "var(--font-body)", transition: "all 150ms",
                  }}
                >
                  <div style={{ fontSize: "17px", fontWeight: 600, color: "var(--text-100)", marginBottom: 6 }}>{wf.title}</div>
                  <div style={{ fontSize: "14px", color: "var(--text-200)", lineHeight: 1.5 }}>{wf.desc}</div>
                </button>
              );
            })}
          </div>
          <div style={{ textAlign: "center" }}>{continueBtn(selectedWorkflows.size === 0)}</div>
        </div>
      </div>
    );
  }

  // STEP 4: Meet your team
  if (step === 4) {
    return (
      <div style={wrapStyle} className="lovable-fade">
        {stepDots}
        <div style={{ maxWidth: 720, width: "100%" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "var(--text-100)", marginBottom: "0.75rem", letterSpacing: "-0.02em", textAlign: "center" }}>
            Meet your team.
          </h1>
          <p style={{ fontSize: "16px", color: "var(--text-200)", marginBottom: "2.5rem", lineHeight: 1.6, textAlign: "center" }}>
            These AI workers are tailored to your business. You can customize them later.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
            {teamWorkers.map((w, i) => (
              <div key={i} style={{
                padding: "20px", border: "1px solid var(--border)", borderRadius: 12,
                background: "var(--bg-400)", display: "flex", flexDirection: "column", gap: 10,
              }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-100)" }}>{w.role}</div>
                <div style={{ fontSize: "13px", color: "var(--text-200)", lineHeight: 1.5 }}>{w.description || "Handles tasks for your business."}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                  {(w.canDo || []).length > 0 && <div style={{ fontSize: "12px", color: "var(--green)", fontFamily: "var(--font-mono)" }}>Handles: {(w.canDo || []).length} actions</div>}
                  {(w.askFirst || []).length > 0 && <div style={{ fontSize: "12px", color: "var(--amber)", fontFamily: "var(--font-mono)" }}>Asks first: {(w.askFirst || []).length}</div>}
                  {(w.neverDo || []).length > 0 && <div style={{ fontSize: "12px", color: "var(--red)", fontFamily: "var(--font-mono)" }}>Never does: {(w.neverDo || []).length}</div>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "var(--text-300)" }} />
                  <span style={{ fontSize: "12px", color: "var(--text-300)", fontWeight: 500 }}>New</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center" }}>{continueBtn()}</div>
        </div>
      </div>
    );
  }

  // STEP 5: Connect your tools
  if (step === 5) {
    return (
      <div style={wrapStyle} className="lovable-fade">
        {stepDots}
        <div style={{ maxWidth: 560, width: "100%" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "var(--text-100)", marginBottom: "0.75rem", letterSpacing: "-0.02em", textAlign: "center" }}>
            Connect your tools.
          </h1>
          <p style={{ fontSize: "16px", color: "var(--text-200)", marginBottom: "2.5rem", lineHeight: 1.6, textAlign: "center" }}>
            Your team needs access to these services to do their work.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {integrations.length === 0 && (
              <div style={{ padding: "2rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12, color: "var(--text-200)", fontSize: "14px" }}>
                No integrations required for your selected workflows. You can connect tools later from Settings.
              </div>
            )}
            {integrations.map((ig, i) => (
              <div key={i} style={{
                padding: "18px 20px", border: "1px solid var(--border)", borderRadius: 12,
                background: "var(--bg-400)", display: "flex", alignItems: "center",
                justifyContent: "space-between", gap: 16,
                opacity: ig.available ? 1 : 0.5,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-100)" }}>{ig.name || ig.service}</div>
                  <div style={{ fontSize: "13px", color: "var(--text-200)", marginTop: 2 }}>{ig.reason || ig.description || ""}</div>
                </div>
                {ig.available ? (
                  skippedIntegrations.has(ig.name || ig.service) ? (
                    <span style={{ fontSize: "13px", color: "var(--text-300)", fontWeight: 500 }}>Skipped</span>
                  ) : connectingIntegration === (ig.name || ig.service) ? (
                    <span style={{ fontSize: "13px", color: "var(--accent)", fontWeight: 500 }}>Connecting...</span>
                  ) : (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        style={{ ...S.btnPrimary, width: "auto", padding: "6px 16px", fontSize: "13px" }}
                        onClick={() => {
                          setConnectingIntegration(ig.name || ig.service);
                          setTimeout(() => setConnectingIntegration(null), 1500);
                        }}
                      >Connect</button>
                      <button
                        style={{ ...S.btnSecondary, padding: "6px 12px", fontSize: "12px" }}
                        onClick={() => setSkippedIntegrations(prev => new Set([...prev, ig.name || ig.service]))}
                      >Skip for now</button>
                    </div>
                  )
                ) : (
                  <span style={{ fontSize: "12px", color: "var(--text-300)", fontWeight: 500, padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 6 }}>Coming soon</span>
                )}
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center" }}>{continueBtn()}</div>
        </div>
      </div>
    );
  }

  // STEP 6: You're all set
  if (step === 6) {
    return (
      <div style={wrapStyle} className="lovable-fade">
        {stepDots}
        <div style={{ maxWidth: 480, width: "100%", textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1.5rem" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "var(--text-100)", marginBottom: "0.75rem", letterSpacing: "-0.02em" }}>
            You're all set.
          </h1>
          <p style={{ fontSize: "16px", color: "var(--text-200)", marginBottom: "0.5rem", lineHeight: 1.6 }}>
            Your team is learning. You'll get notifications when they need your input.
          </p>
          {continueBtn()}
        </div>
      </div>
    );
  }

  return null;
}

/* ===================================================================
   AppShell
   =================================================================== */

function AppShell({ initialView = "home", userEmail, isFirstTime }) {
  const [view, setView] = useState(() => {
    // First-time users go to builder; returning users go to inbox or team
    if (isFirstTime) return "builder";
    return initialView === "home" ? "builder" : initialView;
  });
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);
  const [isNewDeploy, setIsNewDeploy] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [workers, setWorkers] = useState([]);
  const [creditBalance, setCreditBalance] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userTier, setUserTier] = useState("free");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (isFirstTime && !localStorage.getItem("nooterra_onboarding_complete")) {
      setShowOnboarding(true);
    }
    (async () => { try { const runtime = loadRuntimeConfig(); const result = await fetchApprovalInbox(runtime, { status: "pending" }); const items = result?.items || result || []; const count = Array.isArray(items) ? items.length : 0; setPendingApprovals(count); } catch { /* ignore */ } })();
    (async () => { try { const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.items || result || []); } catch { /* ignore */ } })();
    (async () => { try { const result = await workerApiRequest({ pathname: "/v1/credits", method: "GET" }); if (result?.balance != null) setCreditBalance(result.balance); else if (result?.remaining != null) setCreditBalance(result.remaining); } catch { /* ignore */ } })();
    (async () => { try { const runtime = loadRuntimeConfig(); const settings = await fetchTenantSettings(runtime); if (settings?.tier) setUserTier(settings.tier); else if (settings?.plan) setUserTier(settings.plan); } catch { /* ignore */ } })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function refreshWorkers() {
    (async () => { try { const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.items || result || []); } catch { /* ignore */ } })();
  }

  function handleNavigate(dest, workerId) {
    if (dest === "workerDetail" && workerId) { setSelectedWorkerId(workerId); setIsNewDeploy(false); setView("workerDetail"); }
    else { setView(dest); setSelectedWorkerId(null); setIsNewDeploy(false); }
  }
  function handleSelectWorker(worker) { setSelectedWorkerId(worker.id); setIsNewDeploy(false); setView("workerDetail"); }
  function handleBuilderComplete() { refreshWorkers(); setView("team"); }
  function handleViewWorker(w) { refreshWorkers(); if (w?.id) { setSelectedWorkerId(w.id); setIsNewDeploy(true); setView("workerDetail"); } else setView("team"); }

  if (showOnboarding) {
    return <OnboardingFlow onComplete={() => { setShowOnboarding(false); }} userEmail={userEmail} />;
  }

  // =============================================
  // ALL VIEWS: Sidebar + content
  // =============================================

  // --- Icons ---
  const iconEnvelope = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
  const iconPeople = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
  const iconPulse = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
  const iconChart = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
  const iconPlug = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>;
  const iconGear = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;

  const operateNav = [
    { key: "inbox", label: "Inbox", icon: iconEnvelope, badge: pendingApprovals },
    { key: "team", label: "Team", icon: iconPeople },
    { key: "activity", label: "Activity", icon: iconPulse },
  ];
  const manageNav = [
    { key: "performance", label: "Performance", icon: iconChart },
    { key: "connections", label: "Connections", icon: iconPlug },
    { key: "settings", label: "Settings", icon: iconGear, action: () => setSettingsOpen(true) },
  ];

  const sidebarActiveView = view === "workerDetail" ? "team" : (view === "approvals" ? "inbox" : view);

  // --- Sidebar nav item renderer ---
  function NavItem({ item }) {
    const active = sidebarActiveView === item.key;
    return (
      <button
        onClick={() => { if (item.action) item.action(); else navAndClose(item.key); }}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
          borderRadius: 8, border: "none", cursor: "pointer", width: "100%",
          fontFamily: "var(--font-body)", fontSize: "14px",
          fontWeight: active ? 600 : 400,
          color: active ? "var(--text-100)" : "var(--text-200)",
          background: active ? "var(--bg-100)" : "transparent",
          transition: "all 120ms", textAlign: "left",
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--bg-300, var(--bg-hover))"; }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = active ? "var(--bg-100)" : "transparent"; }}
      >
        <span style={{ flexShrink: 0, display: "flex" }}>{item.icon}</span>
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.badge > 0 && (
          <span style={{
            fontSize: "11px", fontWeight: 700, color: "#fff",
            background: "var(--accent)", borderRadius: 10,
            padding: "1px 6px", minWidth: 18, textAlign: "center",
          }}>{item.badge}</span>
        )}
      </button>
    );
  }

  // --- Section label ---
  function SectionLabel({ children }) {
    return (
      <div style={{
        fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em",
        color: "var(--text-300)", fontFamily: "var(--font-mono)",
        padding: "16px 12px 4px",
      }}>{children}</div>
    );
  }

  // --- Determine what content shows ---
  function MainContent() {
    if (view === "builder") return <BuilderView onComplete={handleBuilderComplete} onViewWorker={handleViewWorker} userName={userEmail} isFirstTime={isFirstTime && workers.length === 0} />;
    if (view === "team") return <div style={S.main}><WorkersListView onSelect={handleSelectWorker} onCreate={() => setView("builder")} /></div>;
    if (view === "workerDetail" && selectedWorkerId) return <div style={S.main}><WorkerDetailView workerId={selectedWorkerId} onBack={() => { setSelectedWorkerId(null); setIsNewDeploy(false); setView("team"); }} isNewDeploy={isNewDeploy} /></div>;
    if (view === "inbox" || view === "approvals") return <div style={S.main}><InboxView /></div>;
    if (view === "activity" || view === "receipts") return <div style={S.main}><ReceiptsView /></div>;
    if (view === "performance") return <div style={S.main}><div style={{ padding: "3rem 2rem", textAlign: "center" }}><h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--text-100)" }}>Performance</h2><p style={{ fontSize: "14px", color: "var(--text-300)", marginTop: 8 }}>Business outcomes and worker metrics. Coming soon.</p></div></div>;
    if (view === "connections" || view === "integrations") return <div style={S.main}><IntegrationsView /></div>;
    return <div style={S.main}><WorkersListView onSelect={handleSelectWorker} onCreate={() => setView("builder")} /></div>;
  }

  // Close mobile menu when navigating
  const navAndClose = (dest) => { handleNavigate(dest); setMobileMenuOpen(false); };

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-100)", overflow: "hidden" }}>

      {/* ===== MOBILE HEADER BAR ===== */}
      <div className="mobile-topbar" style={{
        display: "none", position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        height: 48, background: "var(--bg-400)", borderBottom: "1px solid var(--border)",
        alignItems: "center", padding: "0 12px", justifyContent: "space-between",
      }}>
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} style={{
          background: "none", border: "none", cursor: "pointer", color: "var(--text-200)",
          padding: 8, display: "flex", alignItems: "center",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <img src="/nooterra-logo.png" alt="nooterra" style={{ height: 16 }} />
        <div style={{ width: 36 }} />
      </div>

      {/* ===== MOBILE OVERLAY ===== */}
      {mobileMenuOpen && (
        <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} style={{
          display: "none", position: "fixed", inset: 0, zIndex: 199,
          background: "rgba(0,0,0,0.4)",
        }} />
      )}

      {/* ===== LEFT SIDEBAR ===== */}
      <aside className="app-sidebar" style={{
        width: 240, flexShrink: 0, background: "var(--bg-400)",
        borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column",
        height: "100vh", overflow: "hidden",
        ...(mobileMenuOpen ? { position: "fixed", top: 0, left: 0, zIndex: 200, boxShadow: "4px 0 20px rgba(0,0,0,0.15)" } : {}),
      }}>
      <style>{`
        @media (max-width: 768px) {
          .mobile-topbar { display: flex !important; }
          .mobile-overlay { display: block !important; }
          .app-sidebar { display: ${mobileMenuOpen ? "flex" : "none"} !important; position: fixed !important; top: 0; left: 0; z-index: 200; box-shadow: 4px 0 20px rgba(0,0,0,0.15); }
          .app-main-content { margin-top: 48px; }
        }
      `}</style>
        {/* Logo */}
        <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "center" }}>
          <img src="/nooterra-logo.png" alt="nooterra" style={{ height: 18 }} />
        </div>

        {/* New team button */}
        <div style={{ padding: "0 12px 8px" }}>
          <button
            onClick={() => { setView("builder"); setMobileMenuOpen(false); }}
            style={{
              width: "100%", padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)",
              background: "transparent", color: "var(--text-200)", fontSize: "13px", fontWeight: 500,
              cursor: "pointer", fontFamily: "var(--font-body)", transition: "all 120ms",
              display: "flex", alignItems: "center", gap: 6, justifyContent: "center",
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New team
          </button>
        </div>

        {/* Nav sections */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 4px" }}>
          <SectionLabel>Operate</SectionLabel>
          {operateNav.map(item => <NavItem key={item.key} item={item} />)}

          <SectionLabel>Manage</SectionLabel>
          {manageNav.map(item => <NavItem key={item.key} item={item} />)}
        </div>

        {/* Bottom: user */}
        <div style={{ borderTop: "1px solid var(--border)", padding: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: "50%", background: "var(--accent)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "12px", fontWeight: 700, color: "#fff", flexShrink: 0,
            }}>
              {getInitials(userEmail)}
            </div>
            <div style={{ overflow: "hidden", flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "13px", color: "var(--text-100)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userEmail || "User"}</div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: tierColor(userTier) }}>{tierLabel(userTier)}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ===== MAIN CONTENT ===== */}
      <main className="app-main-content" style={{
        flex: 1, display: "flex", flexDirection: "column", minWidth: 0,
        background: "var(--bg-100)", height: "100vh", overflow: "auto",
      }}>
        <MainContent />
      </main>

      {settingsOpen && <SettingsModal userEmail={userEmail} userTier={userTier} creditBalance={creditBalance} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/* ===================================================================
   ProductShell -- top-level mode router
   =================================================================== */

export default function ProductShell({ mode, launchId, agentId, runId, requestedPath }) {
  const [currentMode, setCurrentMode] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [userEmail, setUserEmail] = useState(null);
  const [isFirstTime, setIsFirstTime] = useState(false);

  useEffect(() => { applyTheme(loadTheme()); }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      if (mode === "signup" || mode === "pricing") { setCurrentMode(mode); setSessionChecked(true); return; }
      try {
        const principal = await fetchSessionPrincipal();
        if (!cancelled && principal && principal.email) {
          setUserEmail(principal.email);
          const runtime = loadRuntimeConfig();
          if (principal.tenantId) saveRuntime({ ...runtime, tenantId: principal.tenantId });
          saveOnboardingState({ ...loadOnboardingState(), buyer: principal, sessionExpected: true, completed: true });
          try { const workersResult = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); if ((workersResult?.items || workersResult || []).length === 0) setIsFirstTime(true); } catch { /* ignore */ }
          if (mode === "login" || mode === "signup") setCurrentMode("dashboard"); else setCurrentMode(mode || "dashboard");
          setSessionChecked(true); return;
        }
      } catch { /* No valid session */ }
      if (!cancelled) {
        if (mode === "login" || mode === "signup" || mode === "pricing") setCurrentMode(mode); else setCurrentMode("login");
        setSessionChecked(true);
      }
    }
    checkSession();
    return () => { cancelled = true; };
  }, [mode]);

  useEffect(() => {
    if (sessionChecked) {
      const onboardState = loadOnboardingState();
      if (onboardState?.sessionExpected) setCurrentMode(mode);
      else if (mode === "signup" || mode === "login" || mode === "pricing") setCurrentMode(mode);
    }
  }, [mode, sessionChecked]);

  function handleAuth() { window.location.href = "/dashboard"; }

  if (!sessionChecked) {
    return (
      <div style={S.shell}>
        <div style={S.authWrap}>
          <div style={{ textAlign: "center" }}>
            <NooterraLogo height={24} style={{ color: "var(--text-primary)", margin: "0 auto 0.75rem" }} />
            <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  const resolvedMode = currentMode;

  function getInitialView() {
    switch (resolvedMode) {
      case "approvals": return "approvals";
      case "receipts": return "receipts";
      case "workspace": return "settings";
      default: return "builder";
    }
  }

  return (
    <div style={S.shell}>
      {(resolvedMode === "signup" || resolvedMode === "login") && <AuthView onAuth={handleAuth} />}
      {resolvedMode === "pricing" && <PricingView />}
      {!["signup", "login", "pricing"].includes(resolvedMode) && resolvedMode != null && (
        <AppShell initialView={getInitialView()} userEmail={userEmail} isFirstTime={isFirstTime} />
      )}
    </div>
  );
}
