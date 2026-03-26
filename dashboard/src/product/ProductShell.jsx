import { useEffect, useRef, useState, useCallback } from "react";
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

/* ===================================================================
   Constants & helpers
   =================================================================== */

const ONBOARDING_STORAGE_KEY = "nooterra_product_onboarding_v1";
const THEME_STORAGE_KEY = "nooterra_theme";
const SIDEBAR_STORAGE_KEY = "nooterra_sidebar_collapsed";
const AUTH_BASE = "/__magic";
const WORKER_API_BASE = "/__nooterra";

const RECOMMENDED_MODELS = [
  { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super", inputPer1M: 0, outputPer1M: 0, tag: "Free" },
  { id: "openai/gpt-oss-120b:free", name: "GPT-OSS 120B", inputPer1M: 0, outputPer1M: 0, tag: "Free" },
  { id: "google/gemini-3-flash", name: "Gemini 3 Flash", inputPer1M: 0.50, outputPer1M: 3.00, tag: "Fast & cheap" },
  { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", inputPer1M: 2.00, outputPer1M: 12.00, tag: "Smartest" },
  { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", inputPer1M: 3.00, outputPer1M: 15.00, tag: "Best for writing" },
  { id: "openai/gpt-5.4", name: "GPT-5.4", inputPer1M: 2.50, outputPer1M: 15.00, tag: "Best for agents" },
];

const STARTER_TEMPLATES = [
  {
    id: "support-monitor",
    name: "Support Monitor",
    description: "Watch your inbox and draft replies for common questions.",
    charter: {
      canDo: ["Read incoming emails", "Categorize by topic", "Draft reply templates", "Search knowledge base"],
      askFirst: ["Send replies to customers", "Forward to team members", "Issue refunds"],
      neverDo: ["Delete emails", "Share customer data", "Make commitments about features"],
    },
    schedule: { type: "continuous" },
    model: "google/gemini-3-flash",
  },
  {
    id: "price-tracker",
    name: "Price Tracker",
    description: "Monitor competitor pricing pages daily and alert you on changes.",
    charter: {
      canDo: ["Check competitor websites", "Compare current vs previous prices", "Send alerts to Slack"],
      askFirst: ["Adjust your prices", "Send alerts to customers"],
      neverDo: ["Access payment systems", "Share competitor data externally"],
    },
    schedule: { type: "cron", value: "0 9 * * *" },
    model: "google/gemini-3-flash",
  },
  {
    id: "inbox-summary",
    name: "Inbox Summary",
    description: "Summarize your emails every morning and send a digest.",
    charter: {
      canDo: ["Read all emails from the last 24 hours", "Categorize by priority", "Generate summary"],
      askFirst: ["Send digest to Slack or email", "Archive processed emails"],
      neverDo: ["Delete emails", "Reply on your behalf", "Forward to external contacts"],
    },
    schedule: { type: "cron", value: "0 8 * * 1-5" },
    model: "google/gemini-3-flash",
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
  try { return localStorage.getItem(THEME_STORAGE_KEY) || "dark"; } catch { return "dark"; }
}

function saveTheme(theme) {
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* ignore */ }
  applyTheme(theme);
}

function applyTheme(theme) { document.documentElement.setAttribute("data-theme", theme); }

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
  if (tier === "pro") return "var(--gold)";
  if (tier === "scale") return "#5bb98c";
  return "var(--text-tertiary)";
}

/* -- Worker API helpers ------------------------------------------- */

async function workerApiRequest({ pathname, method = "GET", body = null }) {
  const runtime = loadRuntimeConfig();
  return requestJson({
    baseUrl: WORKER_API_BASE,
    pathname,
    method,
    headers: { "x-tenant-id": runtime.tenantId, "content-type": "application/json" },
    body,
    credentials: "include",
  });
}

/* -- Auth helpers ------------------------------------------------- */

async function authRequest({ pathname, method = "POST", body = null }) {
  return requestJson({
    baseUrl: AUTH_BASE,
    pathname,
    method,
    headers: { "content-type": "application/json" },
    body,
    credentials: "include",
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
   Shared inline styles
   =================================================================== */

const S = {
  shell: { minHeight: "100vh", background: "var(--bg-primary)", color: "var(--text-primary)", fontFamily: "var(--font-body)", WebkitFontSmoothing: "antialiased" },
  authWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" },
  authBox: { width: "100%", maxWidth: 400 },
  authTitle: { fontSize: "clamp(1.6rem, 4vw, 2rem)", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.5rem", lineHeight: 1.15 },
  authSub: { fontSize: "0.95rem", color: "var(--text-secondary)", marginBottom: "2.5rem", lineHeight: 1.5 },
  label: { display: "block", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", marginBottom: "0.4rem", letterSpacing: "0.05em", textTransform: "uppercase" },
  input: { display: "block", width: "100%", padding: "0.75rem 1rem", fontSize: "15px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", outline: "none", marginBottom: "1.25rem", fontFamily: "inherit", transition: "border-color 0.15s", boxSizing: "border-box" },
  inputFocus: { borderColor: "var(--gold)" },
  btnPrimary: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.75rem 1.75rem", fontSize: "0.9rem", fontWeight: 600, background: "var(--gold)", color: "#1a1a1a", border: "none", borderRadius: 8, cursor: "pointer", letterSpacing: "0.01em", transition: "background 0.15s, opacity 0.15s", width: "100%", fontFamily: "inherit" },
  btnSecondary: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.6rem 1.25rem", fontSize: "0.85rem", fontWeight: 600, background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", transition: "border-color 0.15s", fontFamily: "inherit" },
  btnGhost: { background: "none", border: "none", color: "var(--gold)", cursor: "pointer", fontSize: "0.85rem", fontWeight: 500, padding: 0, fontFamily: "inherit" },
  link: { color: "var(--gold)", textDecoration: "none", fontSize: "0.85rem", fontWeight: 500 },
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
  charterSection: { marginBottom: "1.5rem" },
  charterLabel: { fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" },
  charterItem: { fontSize: "14px", color: "var(--text-secondary)", padding: "0.3rem 0", lineHeight: 1.6 },
  approvalRow: { padding: "1.25rem 0", borderBottom: "1px solid var(--border)" },
  textarea: { display: "block", width: "100%", padding: "0.75rem 1rem", fontSize: "15px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", outline: "none", fontFamily: "inherit", resize: "vertical", minHeight: 120, lineHeight: 1.6, marginBottom: "1.25rem", boxSizing: "border-box" },
  logEntry: { padding: "0.75rem 0", borderBottom: "1px solid var(--border)" },
  logTime: { fontSize: "13px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" },
  logSummary: { fontSize: "14px", color: "var(--text-secondary)", marginTop: "0.2rem", lineHeight: 1.6 },
  logDetail: { fontSize: "13px", color: "var(--text-tertiary)", marginTop: "0.4rem", lineHeight: 1.6, whiteSpace: "pre-wrap", padding: "0.75rem 1rem", background: "var(--bg-surface)", borderRadius: 6 },
  backLink: { display: "inline-block", fontSize: "13px", fontWeight: 500, color: "var(--text-secondary)", marginBottom: "2rem", cursor: "pointer", background: "none", border: "none", padding: 0, fontFamily: "inherit" },
  otpInput: { display: "block", width: "100%", padding: "0.75rem 1rem", fontSize: "1.5rem", fontWeight: 700, letterSpacing: "0.5em", textAlign: "center", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", outline: "none", marginBottom: "1.25rem", fontFamily: "inherit", transition: "border-color 0.15s", boxSizing: "border-box" },
  pricingWrap: { minHeight: "100vh", padding: "6rem 2rem 4rem", maxWidth: 1100, margin: "0 auto" },
  pricingTitle: { fontSize: "clamp(2rem, 5vw, 3rem)", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.75rem", lineHeight: 1.1 },
  tier: { padding: "2.5rem 0", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3rem", alignItems: "start" },
  tierName: { fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.3rem" },
  tierPrice: { fontSize: "15px", color: "var(--text-secondary)", marginBottom: "1rem" },
  tierFeature: { fontSize: "14px", color: "var(--text-secondary)", padding: "0.25rem 0", lineHeight: 1.6 },
};

const STATUS_COLORS = {
  running: "#5bb98c",
  paused: "var(--gold)",
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
   Inline SVG icons (no imports -- all tiny inline SVGs)
   =================================================================== */

function SidebarToggleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" style={{ display: "block" }}>
      <rect x="1" y="1" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="10" y="1" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="1" y="10" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="10" y="10" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
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
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 32, height: 32, borderRadius: "50%",
        background: disabled ? "var(--bg-hover)" : "var(--text-primary)",
        border: "none", cursor: disabled ? "default" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, transition: "opacity 150ms",
        opacity: disabled ? 0.3 : 1,
      }}
      aria-label="Send"
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
   AUTH: SignUpView
   =================================================================== */

function SignUpView({ onAuth }) {
  const [step, setStep] = useState("form");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [signupResult, setSignupResult] = useState(null);

  async function handleSubmitForm(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await authRequest({ pathname: "/v1/public/signup", body: { email: email.trim(), company: email.trim().split("@")[0] } });
      setSignupResult(result);
      setStep("otp");
    } catch (err) {
      setError(err?.message || "Sign up failed. Please try again.");
    } finally { setLoading(false); }
  }

  async function handleSubmitOtp(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const tenantId = signupResult?.tenantId;
      if (tenantId) {
        await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login`, body: { email: email.trim(), code: otpCode.trim() } });
      }
      const principal = await fetchSessionPrincipal();
      const runtime = loadRuntimeConfig();
      saveRuntime({ ...runtime, tenantId: tenantId || principal?.tenantId || runtime.tenantId });
      saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
      // Save name to tenant settings and localStorage
      if (fullName.trim()) {
        try {
          await updateTenantSettings({ ...runtime, tenantId: tenantId || principal?.tenantId || runtime.tenantId }, { displayName: fullName.trim(), callMe: fullName.trim().split(" ")[0] });
          localStorage.setItem("nooterra_user_name", fullName.trim());
        } catch { /* non-fatal */ }
      }
      try {
        const keypair = await generateBrowserEd25519KeypairPem();
        const optionsResp = await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login/passkey/options`, body: { email: email.trim(), company: email.trim().split("@")[0] } });
        if (optionsResp?.challenge && optionsResp?.challengeId) {
          const signature = await signBrowserPasskeyChallengeBase64Url({ privateKeyPem: keypair.privateKeyPem, challenge: optionsResp.challenge });
          await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login/passkey`, body: { challengeId: optionsResp.challengeId, challenge: optionsResp.challenge, credentialId: keypair.keyId, publicKeyPem: keypair.publicKeyPem, signature, label: "Browser passkey" } });
          saveStoredBuyerPasskeyBundle({ tenantId, email: email.trim(), credentialId: keypair.keyId, publicKeyPem: keypair.publicKeyPem, privateKeyPem: keypair.privateKeyPem, keyId: keypair.keyId, label: "Browser passkey", createdAt: new Date().toISOString() });
        }
      } catch { /* Passkey registration is optional */ }
      onAuth?.("builder");
    } catch (err) {
      setError(err?.message || "Invalid code. Please try again.");
    } finally { setLoading(false); }
  }

  if (step === "otp") {
    return (
      <div style={S.authWrap}>
        <div style={S.authBox} className="lovable-fade">
          <h1 style={S.authTitle}>Check your email</h1>
          <p style={S.authSub}>We sent a 6-digit code to <strong style={{ color: "var(--text-primary)" }}>{email}</strong>. Enter it below to verify your account.</p>
          {error && <div style={S.error}>{error}</div>}
          <form onSubmit={handleSubmitOtp}>
            <label style={S.label}>Verification code</label>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" required autoFocus style={{ ...S.otpInput, ...(otpCode.length === 6 ? { borderColor: "var(--gold)" } : {}) }} />
            <button type="submit" style={{ ...S.btnPrimary, opacity: loading || otpCode.length < 6 ? 0.5 : 1 }} disabled={loading || otpCode.length < 6}>{loading ? "Verifying..." : "Verify and continue"}</button>
          </form>
          <p style={{ ...S.authSub, marginTop: "1.5rem", marginBottom: 0, fontSize: "13px" }}>
            Didn't receive a code?{" "}
            <button style={S.btnGhost} onClick={async () => { setError(""); try { await authRequest({ pathname: "/v1/public/signup", body: { email: email.trim(), company: email.trim().split("@")[0] } }); } catch { /* ignore */ } }}>Resend</button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.authWrap}>
      <div style={S.authBox} className="lovable-fade">
        <div style={{ marginBottom: "2rem" }}><NooterraLogo height={22} style={{ color: "var(--text-primary)" }} /></div>
        <h1 style={S.authTitle}>Get started</h1>
        <p style={S.authSub}>We'll send a verification code to your email. No password needed.</p>
        {error && <div style={S.error}>{error}</div>}
        <form onSubmit={handleSubmitForm}>
          <label style={S.label}>Name</label>
          <FocusInput type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" required autoFocus />
          <label style={S.label}>Email</label>
          <FocusInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          <button type="submit" style={{ ...S.btnPrimary, opacity: loading ? 0.6 : 1 }} disabled={loading || !email.trim() || !fullName.trim()}>{loading ? "One moment..." : "Continue \u2192"}</button>
        </form>
        <p style={{ ...S.authSub, marginTop: "1.5rem", marginBottom: 0 }}>
          Already have an account?{" "}
          <a href="/login" style={S.link} onClick={(e) => { e.preventDefault(); navigate("/login"); }}>Sign in</a>
        </p>
      </div>
    </div>
  );
}

/* ===================================================================
   AUTH: SignInView
   =================================================================== */

function SignInView({ onAuth }) {
  const [step, setStep] = useState("form");
  const [tenantId, setTenantId] = useState("");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasStoredPasskey, setHasStoredPasskey] = useState(false);

  useEffect(() => {
    try {
      const stored = loadStoredBuyerPasskeyBundle({});
      if (stored && stored.tenantId && stored.email) {
        setTenantId(stored.tenantId);
        setEmail(stored.email);
        setHasStoredPasskey(true);
      }
    } catch { /* ignore */ }
  }, []);

  async function handlePasskeyLogin() {
    setError(""); setLoading(true);
    const tid = tenantId.trim(); const em = email.trim();
    try {
      const storedPasskey = loadStoredBuyerPasskeyBundle({ tenantId: tid, email: em });
      if (!storedPasskey) { setError("No stored passkey found. Please use email sign-in."); setLoading(false); return; }
      const optionsResp = await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey/options`, body: { email: em } });
      if (optionsResp?.challenge && optionsResp?.challengeId) {
        const signature = await signBrowserPasskeyChallengeBase64Url({ privateKeyPem: storedPasskey.privateKeyPem, challenge: optionsResp.challenge });
        await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey`, body: { challengeId: optionsResp.challengeId, challenge: optionsResp.challenge, credentialId: storedPasskey.credentialId, publicKeyPem: storedPasskey.publicKeyPem, signature } });
        touchStoredBuyerPasskeyBundle({ tenantId: tid, email: em });
        const principal = await fetchSessionPrincipal();
        const runtime = loadRuntimeConfig();
        saveRuntime({ ...runtime, tenantId: tid });
        saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
        onAuth?.("dashboard");
        return;
      }
      setError("Passkey authentication failed. Try email sign-in instead.");
    } catch (err) { setError(err?.message || "Passkey sign-in failed. Try email sign-in instead."); }
    finally { setLoading(false); }
  }

  async function handleSubmit(e) {
    e.preventDefault(); setError(""); setLoading(true);
    const em = email.trim();
    try {
      // Use signup endpoint to get tenant ID — it returns existing tenant for known emails
      const result = await authRequest({ pathname: "/v1/public/signup", body: { email: em, company: em.split("@")[0] } });
      const tid = result?.tenantId;
      if (!tid) { setError("Could not find your account. Try signing up instead."); setLoading(false); return; }
      setTenantId(tid);
      // Try passkey login first
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
      // Fall through to OTP
      await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/otp`, body: { email: em } });
      setStep("otp");
    } catch (err) { setError(err?.message || "Sign in failed. Please try again."); }
    finally { setLoading(false); }
  }

  async function handleSubmitOtp(e) {
    e.preventDefault(); setError(""); setLoading(true);
    const tid = tenantId.trim(); const em = email.trim();
    try {
      await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login`, body: { email: em, code: otpCode.trim() } });
      const principal = await fetchSessionPrincipal();
      const runtime = loadRuntimeConfig();
      saveRuntime({ ...runtime, tenantId: tid });
      saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
      onAuth?.("dashboard");
    } catch (err) { setError(err?.message || "Invalid code. Please try again."); }
    finally { setLoading(false); }
  }

  if (step === "otp") {
    return (
      <div style={S.authWrap}>
        <div style={S.authBox} className="lovable-fade">
          <h1 style={S.authTitle}>Check your email</h1>
          <p style={S.authSub}>We sent a 6-digit code to <strong style={{ color: "var(--text-primary)" }}>{email}</strong>.</p>
          {error && <div style={S.error}>{error}</div>}
          <form onSubmit={handleSubmitOtp}>
            <label style={S.label}>Verification code</label>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" required autoFocus style={{ ...S.otpInput, ...(otpCode.length === 6 ? { borderColor: "var(--gold)" } : {}) }} />
            <button type="submit" style={{ ...S.btnPrimary, opacity: loading || otpCode.length < 6 ? 0.5 : 1 }} disabled={loading || otpCode.length < 6}>{loading ? "Verifying..." : "Sign in"}</button>
          </form>
          <p style={{ ...S.authSub, marginTop: "1.5rem", marginBottom: 0, fontSize: "13px" }}>
            <button style={S.btnGhost} onClick={() => { setStep("form"); setOtpCode(""); setError(""); }}>Back to login</button>
          </p>
        </div>
      </div>
    );
  }

  if (hasStoredPasskey) {
    return (
      <div style={S.authWrap}>
        <div style={S.authBox} className="lovable-fade">
          <div style={{ marginBottom: "2rem" }}><NooterraLogo height={22} style={{ color: "var(--text-primary)" }} /></div>
          <h1 style={S.authTitle}>Welcome back</h1>
          <p style={S.authSub}>Signing in as <strong style={{ color: "var(--text-primary)" }}>{email}</strong></p>
          {error && <div style={S.error}>{error}</div>}
          <button style={{ ...S.btnPrimary, opacity: loading ? 0.6 : 1, marginBottom: "1rem" }} disabled={loading} onClick={handlePasskeyLogin}>{loading ? "Signing in..." : "Sign in with passkey"}</button>
          <p style={{ ...S.authSub, marginTop: "1rem", marginBottom: 0, fontSize: "13px" }}>
            Not you?{" "}
            <button style={S.btnGhost} onClick={() => { setHasStoredPasskey(false); setTenantId(""); setEmail(""); setError(""); }}>Use a different account</button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.authWrap}>
      <div style={S.authBox} className="lovable-fade">
        <div style={{ marginBottom: "2rem" }}><NooterraLogo height={22} style={{ color: "var(--text-primary)" }} /></div>
        <h1 style={S.authTitle}>Welcome back</h1>
        <p style={S.authSub}>We'll send a verification code to your email.</p>
        {error && <div style={S.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={S.label}>Email</label>
          <FocusInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
          <button type="submit" style={{ ...S.btnPrimary, opacity: loading || !email.trim() ? 0.5 : 1 }} disabled={loading || !email.trim()}>{loading ? "Sending code..." : "Continue \u2192"}</button>
        </form>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.5rem" }}>
          <a href="/signup" style={S.link} onClick={(e) => { e.preventDefault(); navigate("/signup"); }}>Create account</a>
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
    { key: "askFirst", label: "Ask first", color: "var(--gold)", items: charter.askFirst || [] },
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
   BuilderMessage -- single message in the chat
   =================================================================== */

function BuilderMessage({ msg, isStreaming, onDeployWorker }) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }} className="lovable-fade">
        <div style={{
          maxWidth: "85%", padding: "12px 16px", borderRadius: 18,
          fontSize: "15px", lineHeight: 1.6, color: "var(--text-primary)",
          background: "var(--bg-surface)", wordBreak: "break-word",
        }}>{msg.content}</div>
      </div>
    );
  }

  const workerDef = msg.content ? parseWorkerDefinition(msg.content) : null;
  const displayContent = workerDef ? stripWorkerDefinitionBlock(msg.content) : msg.content;

  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "0.75rem" }} className="lovable-fade">
      <div style={{ maxWidth: "85%", fontSize: "15px", lineHeight: 1.6, color: "var(--text-primary)", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
        {displayContent}
        {isStreaming && <span style={{ display: "inline-block", width: 2, height: "1.1em", background: "var(--text-primary)", marginLeft: 1, verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" }} />}

        {workerDef && !isStreaming && (
          <div style={{ marginTop: "1rem", padding: "1rem", borderRadius: 10, borderLeft: "2px solid var(--gold)" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.75rem" }}>{workerDef.name}</div>
            <CharterDisplay charter={{ canDo: workerDef.canDo || [], askFirst: workerDef.askFirst || [], neverDo: workerDef.neverDo || [] }} compact />
            {workerDef.schedule && <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "0.5rem" }}>Schedule: {workerDef.schedule}</div>}
            <button
              style={{ padding: "0.6rem 1.5rem", fontSize: "14px", fontWeight: 600, background: "var(--gold)", color: "#1a1a1a", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", marginTop: "0.5rem" }}
              onClick={() => onDeployWorker?.(workerDef)}
            >Deploy this worker</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===================================================================
   AutoTextarea -- grows with content
   =================================================================== */

function AutoTextarea({ value, onChange, onKeyDown, placeholder, disabled, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = Math.min(ref.current.scrollHeight, 160) + "px";
    }
  }, [value]);

  return (
    <textarea ref={ref} value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} disabled={disabled} autoFocus={autoFocus} rows={1}
      style={{
        width: "100%", padding: "14px 16px", paddingLeft: "48px", paddingBottom: "2.75rem",
        fontSize: "15px", background: "transparent", border: "none",
        color: "var(--text-primary)", outline: "none", fontFamily: "inherit",
        resize: "none", lineHeight: "24px", overflow: "auto", boxSizing: "border-box",
      }}
    />
  );
}

/* ===================================================================
   ModelDropdown -- popover for model selection
   =================================================================== */

function ModelDropdown({ model, onModelChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selectedModel = RECOMMENDED_MODELS.find(m => m.id === model);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{
        background: "transparent", border: "none", color: "var(--text-secondary)",
        fontSize: "13px", padding: "4px 8px", cursor: "pointer", fontFamily: "inherit",
        display: "flex", alignItems: "center", gap: 4, borderRadius: 6,
      }}>
        {selectedModel?.name || "Select model"}
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div className="popover-animate" style={{
          position: "absolute", bottom: "100%", left: 0, marginBottom: 4,
          background: "var(--bg-surface)", border: "1px solid var(--border)",
          borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
          padding: "4px 0", zIndex: 50, minWidth: 300, maxWidth: 380,
        }}>
          {RECOMMENDED_MODELS.map(m => (
            <button key={m.id} onClick={() => { onModelChange(m.id); setOpen(false); }} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              width: "100%", padding: "8px 12px", fontSize: "14px",
              background: m.id === model ? "var(--bg-hover)" : "transparent",
              color: m.id === model ? "var(--text-primary)" : "var(--text-secondary)",
              border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
              transition: "background 150ms",
            }}
              onMouseEnter={e => { if (m.id !== model) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={e => { if (m.id !== model) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontWeight: m.id === model ? 600 : 400 }}>{m.name}</span>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                ${m.inputPer1M.toFixed(2)}/${m.outputPer1M.toFixed(2)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===================================================================
   PlusMenu -- popover from + button in input box
   =================================================================== */

function PlusMenu({ onClose, onAction }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const itemStyle = {
    display: "flex", alignItems: "center", gap: 10, width: "100%",
    padding: "8px 14px", fontSize: "14px", color: "var(--text-secondary)",
    background: "none", border: "none", cursor: "pointer",
    fontFamily: "inherit", textAlign: "left", transition: "background 150ms",
    borderRadius: 0,
  };
  const hover = (e) => { e.currentTarget.style.background = "var(--bg-hover)"; };
  const unhover = (e) => { e.currentTarget.style.background = "none"; };
  const sep = <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />;

  return (
    <div ref={ref} className="popover-animate" style={{
      position: "absolute", bottom: "calc(100% + 4px)", left: 8,
      background: "var(--bg-surface)", border: "1px solid var(--border)",
      borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
      padding: "4px 0", zIndex: 50, minWidth: 200, maxWidth: 240,
    }}>
      <button style={itemStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={() => { onAction?.("knowledge"); onClose(); }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M2 7h8M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        Add knowledge
      </button>
      <button style={itemStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={() => { onAction?.("tools"); onClose(); }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 2v4H2M10 14v-4h4M2 10h4v4M14 6h-4V2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        Connect tools
      </button>
      <button style={itemStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={() => { onAction?.("websearch"); onClose(); }}>
        <SearchIcon size={16} />
        Web search
      </button>
      {sep}
      <button style={itemStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={() => { onAction?.("templates"); onClose(); }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
        Worker templates
      </button>
    </div>
  );
}

/* ===================================================================
   BuilderInputBox -- Claude-style with + button, model selector, send
   =================================================================== */

function BuilderInputBox({ value, onChange, onSend, disabled, model, onModelChange, placeholder }) {
  const [focused, setFocused] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend?.(); }
  }

  return (
    <div style={{ position: "relative", maxWidth: 680, width: "100%" }}>
      <div
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border)",
          borderRadius: 16, transition: "border-color 150ms", position: "relative",
          boxShadow: "0 1px 6px rgba(0,0,0,0.08)",
          ...(focused ? { borderColor: "var(--border)" } : {}),
        }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      >
        {/* + button */}
        <button
          onClick={() => setPlusMenuOpen(!plusMenuOpen)}
          style={{
            position: "absolute", left: 10, top: 12, zIndex: 2,
            width: 28, height: 28, borderRadius: "50%",
            background: "var(--bg-hover)", border: "none",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--text-secondary)", transition: "background 150ms",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--border)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
        >
          <PlusIcon size={16} />
        </button>

        {plusMenuOpen && <PlusMenu onClose={() => setPlusMenuOpen(false)} />}

        <AutoTextarea value={value} onChange={onChange} onKeyDown={handleKeyDown} placeholder={placeholder || "Describe what you need..."} disabled={disabled} autoFocus />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 10px" }}>
          <ModelDropdown model={model} onModelChange={onModelChange} />
          <SendArrow disabled={disabled || !value.trim()} onClick={onSend} />
        </div>
      </div>
      <div style={{ textAlign: "center", marginTop: 8, fontSize: "12px", color: "var(--text-tertiary)", lineHeight: 1.4 }}>
        Nooterra can make mistakes. Review worker actions before approving.
      </div>
    </div>
  );
}

/* ===================================================================
   TemplateCard -- small suggestion card
   =================================================================== */

function TemplateCard({ template, onClick }) {
  return (
    <div
      style={{
        padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 12,
        background: "var(--bg-surface)", cursor: "pointer", transition: "border-color 150ms",
        display: "flex", flexDirection: "column", gap: "0.4rem",
      }}
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
      <div style={{ padding: "1.25rem", borderRadius: 10, borderLeft: "2px solid var(--gold)", marginBottom: "2rem" }}>
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
   BuilderView -- main AI chat
   =================================================================== */

function BuilderView({ onComplete, onViewWorker, userName, isFirstTime }) {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [selectedModel, setSelectedModel] = useState("nvidia/nemotron-3-super-120b-a12b:free");
  const [streaming, setStreaming] = useState(false);
  const [deployingWorker, setDeployingWorker] = useState(false);
  const messagesEndRef = useRef(null);
  const [templateReview, setTemplateReview] = useState(null);
  const [templateDeploying, setTemplateDeploying] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const streamAbortRef = useRef(null);

  const hasMessages = messages.length > 0;

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendChatMessage(userContent) {
    const newMessages = [...messages, { role: "user", content: userContent }];
    setMessages(newMessages);
    setStreaming(true);

    const runtime = loadRuntimeConfig();
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    try {
      const res = await fetch("/__nooterra/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-id": runtime.tenantId },
        credentials: "include",
        body: JSON.stringify({ messages: newMessages, model: selectedModel }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Chat request failed" }));
        setMessages([...newMessages, { role: "assistant", content: errBody.error || "Something went wrong. Please try again." }]);
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";

      setMessages([...newMessages, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content || "";
            if (delta) {
              assistantContent += delta;
              const captured = assistantContent;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: captured };
                return updated;
              });
            }
          } catch { /* skip malformed SSE */ }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages(prev => {
          if (prev.length > 0 && prev[prev.length - 1].role === "assistant" && !prev[prev.length - 1].content) {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: "Something went wrong. Please try again." };
            return updated;
          }
          return [...prev, { role: "assistant", content: "Something went wrong. Please try again." }];
        });
      }
    }
    setStreaming(false);
    streamAbortRef.current = null;
  }

  function handleSend() {
    const text = inputValue.trim();
    if (!text || streaming) return;
    setInputValue("");
    sendChatMessage(text);
  }

  async function handleDeployWorker(workerDef) {
    setDeployingWorker(true);
    try {
      const charter = { canDo: workerDef.canDo || [], askFirst: workerDef.askFirst || [], neverDo: workerDef.neverDo || [] };
      const scheduleVal = workerDef.schedule || "on_demand";
      const result = await workerApiRequest({
        pathname: "/v1/workers", method: "POST",
        body: {
          name: workerDef.name || "New Worker",
          description: "",
          charter: JSON.stringify(charter),
          schedule: scheduleVal,
          model: workerDef.model || selectedModel,
        },
      });
      saveOnboardingState({ buyer: loadOnboardingState()?.buyer || null, sessionExpected: true, completed: true });
      if (result?.id) onViewWorker?.(result); else onComplete?.();
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Deploy failed: ${err?.message || "Unknown error"}. Try again?` }]);
    }
    setDeployingWorker(false);
  }

  async function handleTemplateDeploy(template) {
    setTemplateDeploying(true); setTemplateError("");
    try {
      const result = await workerApiRequest({ pathname: "/v1/workers", method: "POST", body: { name: template.name, description: template.description, charter: JSON.stringify(template.charter), schedule: templateScheduleToApiValue(template.schedule), model: template.model } });
      saveOnboardingState({ buyer: loadOnboardingState()?.buyer || null, sessionExpected: true, completed: true });
      if (result?.id) onViewWorker?.(result); else onComplete?.();
    } catch (err) { setTemplateError(err?.message || "Failed to deploy worker."); }
    setTemplateDeploying(false);
  }

  function handleTemplateClick(template) {
    setInputValue(template.description);
  }

  function handleReset() { setMessages([]); }

  if (templateReview) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: "calc(100vh - 1px)", padding: "2rem" }}>
        {templateError && <div style={{ ...S.error, textAlign: "center", marginBottom: "1rem" }}>{templateError}</div>}
        <TemplateCharterReview template={templateReview} onDeploy={() => handleTemplateDeploy(templateReview)} onCustomize={() => { setTemplateReview(null); setTemplateError(""); }} deploying={templateDeploying} />
      </div>
    );
  }

  if (!hasMessages) {
    const greeting = getGreeting();
    const storedName = typeof localStorage !== "undefined" ? localStorage.getItem("nooterra_user_name") : null;
    const displayName = storedName ? storedName.split(" ")[0] : (userName ? userName.split("@")[0] : null);
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: "calc(100vh - 1px)", padding: "2rem" }}>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.2, marginBottom: "0.25rem" }}>
            {displayName ? `${greeting}, ${displayName}.` : "What do you need done?"}
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-secondary)", marginTop: "0.5rem" }}>
            {isFirstTime ? "Deploy your first worker in 30 seconds." : "Ask me anything, or describe a worker you need."}
          </p>
        </div>
        <BuilderInputBox value={inputValue} onChange={(e) => setInputValue(e.target.value)} onSend={handleSend} disabled={false} model={selectedModel} onModelChange={setSelectedModel} />

        {isFirstTime && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", width: "100%", maxWidth: 680, marginTop: "1.5rem" }}>
            {STARTER_TEMPLATES.map(t => (
              <TemplateCard key={t.id} template={t} onClick={() => handleTemplateClick(t)} />
            ))}
          </div>
        )}
        <div style={{ flex: 1.5 }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "2rem 0", display: "flex", flexDirection: "column" }}>
        <div style={{ maxWidth: 680, width: "100%", margin: "0 auto", padding: "0 1.5rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {messages.map((msg, i) => (
            <BuilderMessage
              key={`msg_${i}`}
              msg={msg}
              isStreaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
              onDeployWorker={handleDeployWorker}
            />
          ))}
          {streaming && messages.length > 0 && messages[messages.length - 1].role === "assistant" && !messages[messages.length - 1].content && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "0.5rem" }} className="lovable-fade">
              <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>Thinking...</div>
            </div>
          )}
          {deployingWorker && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "0.5rem" }} className="lovable-fade">
              <div style={{ fontSize: "15px", color: "var(--text-secondary)" }}>Deploying...</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div style={{ flexShrink: 0, padding: "1rem 1.5rem 1.5rem", display: "flex", justifyContent: "center", background: "var(--bg-primary)" }}>
        <BuilderInputBox value={inputValue} onChange={(e) => setInputValue(e.target.value)} onSend={handleSend} disabled={streaming || deployingWorker} model={selectedModel} onModelChange={setSelectedModel} placeholder="Type a message..." />
      </div>
    </div>
  );
}

/* ===================================================================
   UserMenu -- popover above email/avatar in sidebar
   =================================================================== */

function UserMenu({ onClose, onNavigate, onOpenSettings, userEmail, userTier }) {
  const itemStyle = {
    display: "block", width: "100%", padding: "8px 14px", fontSize: "14px",
    color: "var(--text-secondary)", background: "none", border: "none",
    cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "background 150ms",
  };
  const hover = (e) => { e.currentTarget.style.background = "var(--bg-hover)"; };
  const unhover = (e) => { e.currentTarget.style.background = "none"; };
  const sep = <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />;

  return (
    <div className="popover-animate" style={{
      position: "absolute", bottom: "100%", left: "8px", right: "8px",
      background: "var(--bg-surface)", border: "1px solid var(--border)",
      borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
      padding: "4px 0", zIndex: 100, marginBottom: 4,
    }}>
      {/* Email + tier header */}
      <div style={{ padding: "10px 14px 6px" }}>
        <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userEmail || "User"}</div>
        <div style={{ fontSize: "12px", color: tierColor(userTier), fontWeight: 600, marginTop: 2 }}>{tierLabel(userTier)} plan</div>
      </div>
      {sep}
      <button style={itemStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={() => { onClose(); onOpenSettings(); }}>Settings</button>
      <a href="https://docs.nooterra.ai" target="_blank" rel="noopener noreferrer" style={{ ...itemStyle, textDecoration: "none" }} onMouseEnter={hover} onMouseLeave={unhover} onClick={onClose}>Help & docs</a>
      {sep}
      <a href="/pricing" style={{ ...itemStyle, textDecoration: "none", color: "var(--gold)", fontWeight: 600 }} onMouseEnter={hover} onMouseLeave={unhover} onClick={(e) => { e.preventDefault(); onClose(); navigate("/pricing"); }}>Upgrade to Pro</a>
      {sep}
      <button style={itemStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={async () => {
        onClose();
        await logoutSession();
        try { localStorage.removeItem(PRODUCT_RUNTIME_STORAGE_KEY); } catch { /* ignore */ }
        try { localStorage.removeItem(ONBOARDING_STORAGE_KEY); } catch { /* ignore */ }
        navigate("/login");
      }}>Log out</button>
    </div>
  );
}

/* ===================================================================
   CollapsedSidebar -- 48px icon-only sidebar
   =================================================================== */

function CollapsedSidebar({ onToggle, onNavigate, activeView, onNewWorker, onOpenSettings, userEmail, pendingApprovals }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const iconBtn = (key, label, svgContent, badge) => (
    <button
      onClick={() => onNavigate(key)}
      title={label}
      style={{
        width: 36, height: 36, borderRadius: 8,
        background: activeView === key ? "var(--bg-hover)" : "transparent",
        border: "none", cursor: "pointer", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 0,
        color: activeView === key ? "var(--text-primary)" : "var(--text-secondary)",
        transition: "background 150ms", position: "relative", flexShrink: 0,
      }}
      onMouseEnter={e => { if (activeView !== key) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { if (activeView !== key) e.currentTarget.style.background = "transparent"; }}
    >
      {svgContent}
      {badge > 0 && (
        <div style={{
          position: "absolute", top: 2, right: 2, width: 14, height: 14,
          borderRadius: "50%", background: "var(--gold)", fontSize: "9px",
          fontWeight: 700, color: "#1a1a1a", display: "flex", alignItems: "center",
          justifyContent: "center",
        }}>{badge}</div>
      )}
    </button>
  );

  return (
    <nav style={{
      width: 48, height: "100vh", position: "sticky", top: 0,
      display: "flex", flexDirection: "column", alignItems: "center",
      background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)",
      padding: "12px 0", gap: 4, flexShrink: 0,
    }}>
      {/* Toggle button */}
      <button onClick={onToggle} title="Expand sidebar" style={{
        width: 36, height: 36, borderRadius: 8, background: "none",
        border: "none", cursor: "pointer", color: "var(--text-secondary)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 150ms", marginBottom: 4,
      }}
        onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
      >
        <SidebarToggleIcon />
      </button>

      {/* New worker */}
      <button onClick={onNewWorker} title="New worker" style={{
        width: 36, height: 36, borderRadius: 8, background: "var(--gold)",
        border: "none", cursor: "pointer", color: "#1a1a1a",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "opacity 150ms", marginBottom: 4,
      }}>
        <PlusIcon size={18} />
      </button>

      {/* Nav icons */}
      {iconBtn("workers", "Workers",
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
      )}
      {iconBtn("approvals", "Approvals",
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
        pendingApprovals
      )}
      {iconBtn("receipts", "History",
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
      )}

      <div style={{ flex: 1 }} />

      {/* Settings */}
      <button onClick={onOpenSettings} title="Settings" style={{
        width: 36, height: 36, borderRadius: 8, background: "none",
        border: "none", cursor: "pointer", color: "var(--text-secondary)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 150ms",
      }}
        onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </button>

      {/* User avatar */}
      <div style={{ position: "relative" }} ref={menuRef}>
        {menuOpen && <UserMenu onClose={() => setMenuOpen(false)} onNavigate={onNavigate} onOpenSettings={onOpenSettings} userEmail={userEmail} userTier="free" />}
        <button onClick={() => setMenuOpen(!menuOpen)} title={userEmail || "Account"} style={{
          width: 32, height: 32, borderRadius: "50%",
          background: "var(--gold)", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "13px", fontWeight: 700, color: "#1a1a1a",
          transition: "opacity 150ms",
        }}>
          {getInitials(userEmail)}
        </button>
      </div>
    </nav>
  );
}

/* ===================================================================
   ExpandedSidebar -- 260px text sidebar
   =================================================================== */

function ExpandedSidebar({ activeView, onNavigate, workers, pendingApprovals, userEmail, creditBalance, onNewWorker, onToggle, onOpenSettings, userTier }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const navBtn = (key, label, extra) => (
    <button
      style={{
        display: "flex", alignItems: "center",
        padding: "8px 12px", margin: "0 12px", borderRadius: 8,
        fontSize: "14px", fontWeight: 500,
        color: activeView === key ? "var(--text-primary)" : "var(--text-secondary)",
        background: activeView === key ? "var(--bg-hover)" : "transparent",
        cursor: "pointer", border: "none", fontFamily: "inherit", textAlign: "left",
        transition: "background 150ms, color 150ms",
        boxSizing: "border-box", width: "calc(100% - 24px)",
      }}
      onMouseEnter={e => { if (activeView !== key) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { if (activeView !== key) e.currentTarget.style.background = "transparent"; }}
      onClick={() => onNavigate(key)}
    >
      {label}{extra}
    </button>
  );

  return (
    <nav style={{
      width: 260, height: "100vh", position: "sticky", top: 0,
      display: "flex", flexDirection: "column",
      background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)",
      overflow: "hidden",
    }}>
      {/* Header: toggle + logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 16px 12px", height: 56, boxSizing: "border-box" }}>
        <button onClick={onToggle} style={{
          background: "none", border: "none", cursor: "pointer",
          color: "var(--text-secondary)", padding: 4, borderRadius: 6,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "background 150ms",
        }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
        >
          <SidebarToggleIcon />
        </button>
        <NooterraLogo height={20} style={{ color: "var(--text-primary)" }} />
      </div>

      {/* New worker button */}
      <div style={{ padding: "0 12px 12px" }}>
        <button onClick={onNewWorker} style={{
          display: "block", width: "100%", padding: "8px 12px",
          fontSize: "14px", fontWeight: 600, background: "var(--gold)",
          color: "#1a1a1a", border: "none", borderRadius: 8,
          cursor: "pointer", fontFamily: "inherit", transition: "opacity 150ms",
        }}>+ New worker</button>
      </div>

      {/* Section: Workers */}
      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", padding: "12px 24px 6px", letterSpacing: "0.05em", textTransform: "uppercase" }}>Workers</div>
      {workers && workers.length > 0 ? (
        <div className="sidebar-inner" style={{ overflowY: "auto", minHeight: 0, flex: 0 }}>
          {workers.map(w => (
            <button key={w.id} style={{
              display: "flex", alignItems: "center", gap: 8, width: "calc(100% - 24px)",
              padding: "8px 12px", margin: "0 12px", borderRadius: 8,
              fontSize: "14px", fontWeight: 400, color: "var(--text-secondary)",
              background: "transparent", cursor: "pointer", border: "none",
              fontFamily: "inherit", textAlign: "left", transition: "background 150ms",
            }}
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

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--border)", margin: "16px 16px" }} />

      {/* Nav items */}
      {navBtn("approvals", "Approvals", pendingApprovals > 0 && <span style={{ marginLeft: 8, fontSize: "12px", fontWeight: 700, color: "var(--gold)", fontVariantNumeric: "tabular-nums" }}>{pendingApprovals}</span>)}
      {navBtn("receipts", "History")}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--border)", margin: "8px 16px" }} />

      {/* User info */}
      <div style={{ padding: "12px 16px", position: "relative" }} ref={menuRef}>
        {menuOpen && <UserMenu onClose={() => setMenuOpen(false)} onNavigate={onNavigate} onOpenSettings={onOpenSettings} userEmail={userEmail} userTier={userTier} />}
        <button style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%",
          background: "none", border: "none", cursor: "pointer",
          fontFamily: "inherit", textAlign: "left", padding: 0,
        }} onClick={() => setMenuOpen(!menuOpen)}>
          {/* Avatar */}
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "13px", fontWeight: 700, color: "#1a1a1a", flexShrink: 0,
          }}>
            {getInitials(userEmail)}
          </div>
          <div style={{ overflow: "hidden", flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "14px", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {userEmail || "User"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: tierColor(userTier) }}>{tierLabel(userTier)}</span>
              {creditBalance != null && (
                <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>${(creditBalance / 100).toFixed(2)}</span>
              )}
            </div>
          </div>
        </button>
      </div>
    </nav>
  );
}

/* ===================================================================
   AppSidebar -- dual-mode wrapper with smooth transition
   =================================================================== */

function AppSidebar({ activeView, onNavigate, workers, pendingApprovals, userEmail, creditBalance, onNewWorker, collapsed, onToggle, onOpenSettings, userTier }) {
  if (collapsed) {
    return (
      <CollapsedSidebar
        onToggle={onToggle}
        onNavigate={onNavigate}
        activeView={activeView}
        onNewWorker={onNewWorker}
        onOpenSettings={onOpenSettings}
        userEmail={userEmail}
        pendingApprovals={pendingApprovals}
      />
    );
  }

  return (
    <div className="sidebar-wrap" style={{ width: 260, flexShrink: 0 }}>
      <ExpandedSidebar
        activeView={activeView}
        onNavigate={onNavigate}
        workers={workers}
        pendingApprovals={pendingApprovals}
        userEmail={userEmail}
        creditBalance={creditBalance}
        onNewWorker={onNewWorker}
        onToggle={onToggle}
        onOpenSettings={onOpenSettings}
        userTier={userTier}
      />
    </div>
  );
}

/* ===================================================================
   DASHBOARD: WorkersListView
   =================================================================== */

function WorkersListView({ onSelect, onCreate }) {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.items || result || []); } catch { setWorkers([]); }
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={S.pageTitle}>Workers</h1>
          <p style={{ ...S.pageSub, marginBottom: 0 }}>
            {loading ? "Loading..." : workers.length === 0 ? "No workers yet. Create one to get started." : `${workers.length} worker${workers.length === 1 ? "" : "s"}`}
          </p>
        </div>
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
            <div key={w.id} style={S.workerRow} onClick={() => onSelect(w)}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
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
   DASHBOARD: WorkerDetailView
   =================================================================== */

function WorkerDetailView({ workerId, onBack, isNewDeploy }) {
  const [worker, setWorker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(isNewDeploy ? "activity" : "charter");
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [runningAction, setRunningAction] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try { const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" }); setWorker(result); } catch { setWorker(null); }
      setLoading(false);
    })();
  }, [workerId]);

  useEffect(() => {
    if (tab === "activity" && workerId) {
      setLogsLoading(true);
      (async () => {
        try { const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/logs`, method: "GET" }); setLogs(result?.items || result || []); } catch { setLogs([]); }
        setLogsLoading(false);
      })();
    }
  }, [tab, workerId]);

  useEffect(() => {
    if (!isNewDeploy || !workerId) return;
    const interval = setInterval(async () => {
      try {
        const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" });
        setWorker(result);
        if (tab === "activity") { const logResult = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/logs`, method: "GET" }); setLogs(logResult?.items || logResult || []); }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [isNewDeploy, workerId, tab]);

  async function handleRunNow() {
    setRunningAction(true); setError("");
    try { await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/run`, method: "POST" }); const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" }); setWorker(result); }
    catch (err) { setError(err?.message || "Failed to run worker."); }
    setRunningAction(false);
  }

  async function handlePauseResume() {
    if (!worker) return;
    setRunningAction(true); setError("");
    const newStatus = worker.status === "paused" ? "ready" : "paused";
    try { await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "PUT", body: { status: newStatus } }); setWorker(prev => prev ? { ...prev, status: newStatus } : prev); }
    catch (err) { setError(err?.message || "Failed to update worker."); }
    setRunningAction(false);
  }

  if (loading) return (<div><button style={S.backLink} onClick={onBack}>{"\u2190"} All workers</button><div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div></div>);
  if (!worker) return (<div><button style={S.backLink} onClick={onBack}>{"\u2190"} All workers</button><div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Worker not found.</div></div>);

  const charter = typeof worker.charter === "string" ? (() => { try { return JSON.parse(worker.charter); } catch { return null; } })() : worker.charter;
  const tabs = [{ key: "charter", label: "Charter" }, { key: "activity", label: "Activity" }, { key: "settings", label: "Settings" }];

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
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "2rem" }}>
        <button style={{ ...S.btnPrimary, width: "auto", opacity: runningAction ? 0.5 : 1 }} disabled={runningAction} onClick={handleRunNow}>{runningAction ? "Running..." : "Run now"}</button>
        <button style={S.btnSecondary} disabled={runningAction} onClick={handlePauseResume}>{worker.status === "paused" ? "Resume" : "Pause"}</button>
      </div>
      {worker.cost != null && (
        <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "2rem" }}>
          Cost this period: <span style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>${(typeof worker.cost === "number" ? worker.cost : 0).toFixed(2)}</span>
        </div>
      )}
      <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border)", marginBottom: "2rem" }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "0.6rem 1rem", fontSize: "14px", fontWeight: 600,
            color: tab === t.key ? "var(--text-primary)" : "var(--text-secondary)",
            background: "none", border: "none",
            borderBottom: tab === t.key ? "2px solid var(--gold)" : "2px solid transparent",
            cursor: "pointer", fontFamily: "inherit", marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>
      {tab === "charter" && <CharterDisplay charter={charter} />}
      {tab === "activity" && (
        <div>
          {isNewDeploy && logs.length === 0 && !logsLoading && (
            <div style={{ padding: "2rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
              <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Your worker is queued and will run shortly.</div>
              <div style={{ width: 24, height: 24, border: "2px solid var(--border)", borderTop: "2px solid var(--gold)", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "1rem auto 0" }} />
            </div>
          )}
          {logsLoading ? (
            <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading logs...</div>
          ) : logs.length === 0 && !isNewDeploy ? (
            <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>No activity yet. This worker hasn't run.</div>
          ) : (
            logs.map((entry, i) => <ActivityLogEntry key={entry.id || i} entry={entry} />)
          )}
        </div>
      )}
      {tab === "settings" && (
        <div style={{ maxWidth: 480 }}>
          <label style={S.label}>Schedule</label>
          <div style={{ fontSize: "14px", color: "var(--text-primary)", marginBottom: "1rem" }}>{worker.schedule || "Manual (on-demand)"}</div>
          {worker.model && (<>
            <label style={S.label}>Model</label>
            <div style={{ fontSize: "14px", color: "var(--text-primary)", marginBottom: "2rem" }}>{RECOMMENDED_MODELS.find(m => m.id === worker.model)?.name || worker.model}</div>
          </>)}
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
      {entry.detail && (<>
        <button style={{ ...S.btnGhost, marginTop: "0.4rem", fontSize: "12px" }} onClick={() => setExpanded(!expanded)}>{expanded ? "Hide details" : "Show details"}</button>
        {expanded && <div style={S.logDetail}>{entry.detail}</div>}
      </>)}
    </div>
  );
}

/* ===================================================================
   APPROVALS VIEW
   =================================================================== */

function ApprovalsView() {
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);

  useEffect(() => { loadApprovals(); }, []);

  async function loadApprovals() {
    setLoading(true);
    try {
      const runtime = loadRuntimeConfig();
      const [pending, decided] = await Promise.all([fetchApprovalInbox(runtime, { status: "pending" }), fetchApprovalInbox(runtime, { status: "decided" })]);
      setItems(pending?.items || pending || []);
      setHistory(decided?.items || decided || []);
    } catch { setItems([]); setHistory([]); }
    setLoading(false);
  }

  async function handleDecide(requestId, approved) {
    setDeciding(requestId);
    try { const runtime = loadRuntimeConfig(); await decideApprovalInboxItem(runtime, requestId, { approved }); await loadApprovals(); } catch { /* ignore */ }
    setDeciding(null);
  }

  return (
    <div>
      <h1 style={S.pageTitle}>Approvals</h1>
      <p style={S.pageSub}>Workers ask before taking sensitive actions. Review and decide here.</p>
      {loading ? (
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div>
      ) : (<>
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
   RECEIPTS VIEW
   =================================================================== */

function ReceiptsView() {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const runtime = loadRuntimeConfig(); const result = await fetchWorkOrderReceipts(runtime, { limit: 50 }); setReceipts(result?.items || result || []); } catch { setReceipts([]); }
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <h1 style={S.pageTitle}>History</h1>
      <p style={S.pageSub}>Execution log across all workers.</p>
      {loading ? (
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div>
      ) : receipts.length === 0 ? (
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>No executions yet.</div>
      ) : (
        receipts.map(r => (
          <div key={r.id || r.receiptId} style={S.logEntry}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: "14px", color: "var(--text-primary)" }}>{r.workerName || r.agentName || r.summary || r.id || "Execution"}</div>
                <div style={S.logTime}>{r.completedAt ? formatDateTime(r.completedAt) : r.createdAt ? formatDateTime(r.createdAt) : ""}</div>
              </div>
              {r.cost != null && <div style={{ ...S.workerMeta, color: "var(--text-secondary)" }}>{typeof r.cost === "number" ? `$${r.cost.toFixed(2)}` : formatCurrency(r.cost)}</div>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ===================================================================
   SETTINGS MODAL -- full-page style with left sidebar navigation
   =================================================================== */

function ToggleSwitch({ on, onToggle }) {
  return (
    <button onClick={onToggle} style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", background: on ? "var(--gold)" : "var(--bg-hover)", position: "relative", flexShrink: 0, transition: "background 150ms" }}>
      <div style={{ width: 18, height: 18, borderRadius: "50%", background: "white", position: "absolute", top: 3, left: on ? 23 : 3, transition: "left 150ms" }} />
    </button>
  );
}

function ThemePreview({ opt, selected, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "0.75rem", borderRadius: 10, cursor: "pointer", textAlign: "center",
      fontFamily: "inherit", transition: "border-color 150ms", flex: 1,
      border: selected ? "2px solid var(--gold)" : "2px solid var(--border)",
      background: selected ? "var(--gold-dim)" : "transparent",
    }}>
      {opt.key === "auto" ? (
        <div style={{ width: 80, height: 50, borderRadius: 8, margin: "0 auto 0.5rem", display: "flex", overflow: "hidden" }}>
          <div style={{ flex: 1, background: opt.bgLeft, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 4 }}>
            <div style={{ width: "70%", height: 8, borderRadius: 2, background: opt.fgLeft }} />
          </div>
          <div style={{ flex: 1, background: opt.bgRight, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 4 }}>
            <div style={{ width: "70%", height: 8, borderRadius: 2, background: opt.fgRight }} />
          </div>
        </div>
      ) : (
        <div style={{ width: 80, height: 50, borderRadius: 8, margin: "0 auto 0.5rem", background: opt.bg, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 6 }}>
          <div style={{ width: "80%", height: 8, borderRadius: 2, background: opt.fg }} />
        </div>
      )}
      <div style={{ fontSize: "13px", fontWeight: 600, color: selected ? "var(--text-primary)" : "var(--text-secondary)" }}>{opt.label}</div>
    </button>
  );
}

function SettingsModal({ userEmail, userTier, creditBalance, onClose }) {
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [callMe, setCallMe] = useState("");
  const [workFunction, setWorkFunction] = useState("founder");
  const [preferences, setPreferences] = useState("");
  const [saving, setSaving] = useState(false);
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
  const runtime = loadRuntimeConfig();

  useEffect(() => {
    (async () => {
      try {
        const result = await fetchTenantSettings(runtime);
        setDisplayName(result?.displayName || result?.name || "");
        if (result?.callMe) setCallMe(result.callMe);
        if (result?.workFunction) setWorkFunction(result.workFunction);
        if (result?.preferences) setPreferences(result.preferences);
        if (result?.defaultModel) setDefaultModel(result.defaultModel);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    function handleKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleSave() {
    setSaveState("saving");
    try {
      await updateTenantSettings(runtime, { displayName: displayName.trim(), callMe: callMe.trim(), workFunction, preferences: preferences.trim(), defaultModel });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (err) {
      console.error("Settings save failed:", err);
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 2000);
    }
  }

  function handleThemeChange(t) { setTheme(t); saveTheme(t); }

  function handleCopyAccountId() {
    try { navigator.clipboard.writeText(runtime.tenantId); setCopiedAccountId(true); setTimeout(() => setCopiedAccountId(false), 1500); } catch { /* ignore */ }
  }

  const sidebarTabs = [
    { key: "general", label: "General" },
    { key: "account", label: "Account" },
    { key: "billing", label: "Billing" },
    { key: "usage", label: "Usage" },
  ];

  const themes = [
    { key: "light", label: "Light", bg: "#eeece2", fg: "#e0ddd3" },
    { key: "auto", label: "Auto", bgLeft: "#eeece2", bgRight: "#1a1a1a", fgLeft: "#e0ddd3", fgRight: "#2a2a2a" },
    { key: "dark", label: "Dark", bg: "#1a1a1a", fg: "#2a2a2a" },
  ];

  const fonts = [
    { key: "default", label: "Default" },
    { key: "sans", label: "Sans" },
    { key: "mono", label: "Mono" },
  ];

  function SaveButton({ label = "Save" }) {
    const isSaved = saveState === "saved";
    const isSaving = saveState === "saving";
    const isError = saveState === "error";
    return (
      <button style={{
        ...S.btnPrimary, width: "auto", padding: "8px 20px", fontSize: "14px",
        opacity: isSaving ? 0.6 : 1,
        background: isSaved ? "#5bb98c" : isError ? "#c97055" : "var(--gold)",
        transition: "background 300ms, opacity 150ms, transform 150ms",
        transform: isSaved ? "scale(1.02)" : "scale(1)",
      }} disabled={isSaving} onClick={handleSave}>
        {isSaving ? "Saving..." : isSaved ? "\u2713 Saved" : isError ? "Failed — try again" : label}
      </button>
    );
  }

  const currentTier = userTier || "free";
  const balance = creditBalance != null ? (creditBalance / 100).toFixed(2) : "0.00";

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" style={{
        width: "100%", maxWidth: 720, maxHeight: "85vh",
        background: "var(--bg-surface)", borderRadius: 16,
        boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
        overflow: "hidden", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Settings</h2>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-secondary)", padding: 4, borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 150ms",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body: left sidebar + content */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Left sidebar nav */}
          <div style={{ width: 180, flexShrink: 0, borderRight: "1px solid var(--border)", padding: "16px 0", overflowY: "auto" }}>
            {sidebarTabs.map(s => (
              <button key={s.key} onClick={() => setTab(s.key)} style={{
                display: "block", width: "100%", padding: "8px 20px",
                fontSize: "14px", fontWeight: tab === s.key ? 600 : 400,
                color: tab === s.key ? "var(--text-primary)" : "var(--text-secondary)",
                background: tab === s.key ? "var(--bg-hover)" : "transparent",
                border: "none", cursor: "pointer", fontFamily: "inherit",
                textAlign: "left", transition: "background 150ms, color 150ms",
                borderLeft: tab === s.key ? "2px solid var(--gold)" : "2px solid transparent",
              }}
                onMouseEnter={e => { if (tab !== s.key) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={e => { if (tab !== s.key) e.currentTarget.style.background = "transparent"; }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, padding: "24px", overflowY: "auto" }}>
            {loading ? <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div> : (<>

              {/* GENERAL TAB */}
              {tab === "general" && (<div>
                {/* Profile */}
                <div style={{ marginBottom: "2rem" }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1.25rem" }}>Profile</div>
                  <label style={S.label}>Display name</label>
                  <FocusInput type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
                  <label style={S.label}>What should Nooterra call you?</label>
                  <FocusInput type="text" value={callMe} onChange={(e) => setCallMe(e.target.value)} placeholder="e.g. Aiden, boss, chief..." />
                  <label style={S.label}>Work function</label>
                  <select value={workFunction} onChange={(e) => setWorkFunction(e.target.value)} style={{ ...S.input, cursor: "pointer", appearance: "auto" }}>
                    {WORK_FUNCTIONS.map(wf => <option key={wf.value} value={wf.value}>{wf.label}</option>)}
                  </select>
                </div>

                {/* Preferences */}
                <div style={{ marginBottom: "2rem" }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Preferences</div>
                  <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: 0, marginBottom: "0.75rem" }}>What preferences should workers consider?</p>
                  <textarea value={preferences} onChange={(e) => setPreferences(e.target.value)} placeholder="e.g. Always use formal language. Prefer bullet points over paragraphs." style={{ ...S.textarea, minHeight: 80 }} />
                </div>

                {/* Notifications */}
                <div style={{ marginBottom: "2rem" }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1rem" }}>Notifications</div>
                  {[
                    { label: "Approval emails", desc: "Get notified when a worker needs your decision.", on: notifApproval, toggle: () => setNotifApproval(!notifApproval) },
                    { label: "Weekly reports", desc: "Receive a weekly summary of worker activity.", on: notifWeekly, toggle: () => setNotifWeekly(!notifWeekly) },
                    { label: "Worker errors", desc: "Get notified when a worker encounters an error.", on: notifErrors, toggle: () => setNotifErrors(!notifErrors) },
                  ].map((n, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0", borderBottom: "1px solid var(--border)" }}>
                      <div>
                        <div style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: 500 }}>{n.label}</div>
                        <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: "0.15rem" }}>{n.desc}</div>
                      </div>
                      <ToggleSwitch on={n.on} onToggle={n.toggle} />
                    </div>
                  ))}
                </div>

                {/* Appearance */}
                <div style={{ marginBottom: "2rem" }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Appearance</div>
                  <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: 0, marginBottom: "1rem" }}>Choose how Nooterra looks.</p>
                  <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>
                    {themes.map(opt => <ThemePreview key={opt.key} opt={opt} selected={theme === opt.key} onClick={() => handleThemeChange(opt.key)} />)}
                  </div>
                  <label style={S.label}>Font</label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    {fonts.map(f => (
                      <button key={f.key} onClick={() => setFont(f.key)} style={{
                        padding: "6px 16px", fontSize: "13px", fontWeight: 500,
                        borderRadius: 6, border: font === f.key ? "1px solid var(--gold)" : "1px solid var(--border)",
                        background: font === f.key ? "var(--gold-dim)" : "transparent",
                        color: font === f.key ? "var(--text-primary)" : "var(--text-secondary)",
                        cursor: "pointer", fontFamily: f.key === "mono" ? "monospace" : f.key === "sans" ? "sans-serif" : "inherit",
                        transition: "all 150ms",
                      }}>{f.label}</button>
                    ))}
                  </div>
                </div>

                <SaveButton />
              </div>)}

              {/* ACCOUNT TAB */}
              {tab === "account" && (<div>
                <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1.25rem" }}>Account</div>

                <label style={S.label}>Email</label>
                <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>{userEmail || "Not available"}</div>

                <label style={S.label}>Account ID</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem" }}>
                  <div style={{ fontSize: "13px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums", fontFamily: "monospace" }}>{runtime.tenantId}</div>
                  <button onClick={handleCopyAccountId} style={{
                    fontSize: "12px", padding: "2px 8px", borderRadius: 4,
                    border: "1px solid var(--border)", background: copiedAccountId ? "#5bb98c" : "transparent",
                    color: copiedAccountId ? "white" : "var(--text-tertiary)", cursor: "pointer",
                    fontFamily: "inherit", transition: "all 150ms",
                  }}>{copiedAccountId ? "Copied" : "Copy"}</button>
                </div>

                <div style={{ borderTop: "1px solid var(--border)", margin: "2rem 0" }} />

                {/* Active sessions */}
                <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1rem" }}>Active sessions</div>
                <div style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: 8, marginBottom: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-primary)" }}>This browser</div>
                      <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>Current session</div>
                    </div>
                    <div style={{ fontSize: "12px", color: "#5bb98c", fontWeight: 600 }}>Active</div>
                  </div>
                </div>
                <button style={{ ...S.btnSecondary, fontSize: "13px", padding: "0.5rem 1rem" }} onClick={async () => { await logoutSession(); navigate("/login"); }}>Log out of all devices</button>

                <div style={{ borderTop: "1px solid var(--border)", margin: "2rem 0" }} />

                {/* Delete account */}
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

              {/* BILLING TAB */}
              {tab === "billing" && (<div>
                <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1.25rem" }}>Billing</div>

                {/* Current plan */}
                <label style={S.label}>Current plan</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1.5rem" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", padding: "4px 12px",
                    borderRadius: 6, fontSize: "14px", fontWeight: 700,
                    background: currentTier === "free" ? "var(--bg-hover)" : "var(--gold-dim)",
                    color: currentTier === "free" ? "var(--text-secondary)" : "var(--gold)",
                  }}>{tierLabel(currentTier)}</span>
                </div>

                {currentTier === "free" && (
                  <button style={{ ...S.btnPrimary, width: "auto", marginBottom: "2rem" }} onClick={() => { onClose(); navigate("/pricing"); }}>Upgrade to Pro</button>
                )}

                <div style={{ borderTop: "1px solid var(--border)", margin: "1.5rem 0" }} />

                {/* Payment method */}
                <label style={S.label}>Payment method</label>
                <div style={{ fontSize: "14px", color: "var(--text-tertiary)", marginBottom: "1.5rem" }}>No payment method on file</div>

                <div style={{ borderTop: "1px solid var(--border)", margin: "1.5rem 0" }} />

                {/* Invoice history */}
                <label style={S.label}>Invoice history</label>
                <div style={{ padding: "2rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8, marginBottom: "1.5rem" }}>
                  <div style={{ fontSize: "14px", color: "var(--text-tertiary)" }}>No invoices yet</div>
                </div>

                {currentTier !== "free" && (<>
                  <div style={{ borderTop: "1px solid var(--border)", margin: "1.5rem 0" }} />
                  <button style={{ ...S.btnSecondary, borderColor: "#c97055", color: "#c97055" }}>Cancel plan</button>
                </>)}
              </div>)}

              {/* USAGE TAB */}
              {tab === "usage" && (<div>
                <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1.25rem" }}>Usage</div>

                {/* Credits remaining */}
                <label style={S.label}>Credits remaining</label>
                <div style={{ fontSize: "28px", fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", marginBottom: "1.5rem" }}>${balance}</div>

                {/* Usage bar */}
                <label style={S.label}>Usage this period</label>
                <div style={{ marginBottom: "1.5rem" }}>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--bg-hover)", overflow: "hidden", marginBottom: 6 }}>
                    <div style={{ height: "100%", borderRadius: 4, background: "var(--gold)", width: "12%", transition: "width 300ms" }} />
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>12% of weekly limit</div>
                </div>

                <div style={{ borderTop: "1px solid var(--border)", margin: "1.5rem 0" }} />

                {/* Model breakdown */}
                <label style={S.label}>Model breakdown</label>
                <div style={{ marginBottom: "1.5rem" }}>
                  {[
                    { name: "Gemini 3 Flash", tokens: "24,500" },
                    { name: "Nemotron 3 Super", tokens: "12,300" },
                    { name: "GPT-5.4", tokens: "0" },
                  ].map((m, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ fontSize: "14px", color: "var(--text-secondary)" }}>{m.name}</span>
                      <span style={{ fontSize: "14px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>{m.tokens} tokens</span>
                    </div>
                  ))}
                </div>

                <button style={{ ...S.btnPrimary, width: "auto" }} onClick={() => { onClose(); navigate("/pricing"); }}>Top up credits</button>
              </div>)}
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   PRICING VIEW
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
      <div style={{ marginTop: "3rem" }}>
        <a href="/" style={S.link} onClick={(e) => { e.preventDefault(); navigate("/"); }}>{"\u2190"} Back to home</a>
      </div>
    </div>
  );
}

/* ===================================================================
   APP SHELL -- unified layout with dual-mode sidebar
   =================================================================== */

function AppShell({ initialView = "workers", userEmail, isFirstTime }) {
  const [view, setView] = useState(initialView);
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);
  const [isNewDeploy, setIsNewDeploy] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [workers, setWorkers] = useState([]);
  const [creditBalance, setCreditBalance] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => loadSidebarCollapsed());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userTier, setUserTier] = useState("free");

  useEffect(() => {
    (async () => { try { const runtime = loadRuntimeConfig(); const result = await fetchApprovalInbox(runtime, { status: "pending" }); const items = result?.items || result || []; setPendingApprovals(Array.isArray(items) ? items.length : 0); } catch { /* ignore */ } })();
    (async () => { try { const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.items || result || []); } catch { /* ignore */ } })();
    (async () => { try { const result = await workerApiRequest({ pathname: "/v1/credits", method: "GET" }); if (result?.balance != null) setCreditBalance(result.balance); else if (result?.remaining != null) setCreditBalance(result.remaining); } catch { /* ignore */ } })();
    (async () => {
      try {
        const runtime = loadRuntimeConfig();
        const settings = await fetchTenantSettings(runtime);
        if (settings?.tier) setUserTier(settings.tier);
        else if (settings?.plan) setUserTier(settings.plan);
      } catch { /* ignore */ }
    })();
  }, []);

  function handleToggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    saveSidebarCollapsed(next);
  }

  function handleNavigate(dest, workerId) {
    if (dest === "workerDetail" && workerId) { setSelectedWorkerId(workerId); setIsNewDeploy(false); setView("workerDetail"); }
    else { setView(dest); setSelectedWorkerId(null); setIsNewDeploy(false); }
  }

  function handleSelectWorker(worker) { setSelectedWorkerId(worker.id); setIsNewDeploy(false); setView("workerDetail"); }
  function handleNewWorker() { setView("builder"); setSelectedWorkerId(null); setIsNewDeploy(false); }

  function handleBuilderComplete() {
    (async () => { try { const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.items || result || []); } catch { /* ignore */ } })();
    setView("workers");
  }

  function handleViewWorker(w) {
    (async () => { try { const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.items || result || []); } catch { /* ignore */ } })();
    if (w?.id) { setSelectedWorkerId(w.id); setIsNewDeploy(true); setView("workerDetail"); }
    else setView("workers");
  }

  const sidebarActiveView = view === "workerDetail" || view === "builder" ? "workers" : view;

  return (
    <div style={S.appLayout}>
      <AppSidebar
        activeView={sidebarActiveView}
        onNavigate={handleNavigate}
        workers={workers}
        pendingApprovals={pendingApprovals}
        userEmail={userEmail}
        creditBalance={creditBalance}
        onNewWorker={handleNewWorker}
        collapsed={sidebarCollapsed}
        onToggle={handleToggleSidebar}
        onOpenSettings={() => setSettingsOpen(true)}
        userTier={userTier}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {view === "builder" && <BuilderView onComplete={handleBuilderComplete} onViewWorker={handleViewWorker} userName={userEmail} isFirstTime={isFirstTime && workers.length === 0} />}
        {view === "workers" && <div style={S.main}><WorkersListView onSelect={handleSelectWorker} onCreate={handleNewWorker} /></div>}
        {view === "workerDetail" && selectedWorkerId && <div style={S.main}><WorkerDetailView workerId={selectedWorkerId} onBack={() => { setSelectedWorkerId(null); setIsNewDeploy(false); setView("workers"); }} isNewDeploy={isNewDeploy} /></div>}
        {view === "approvals" && <div style={S.main}><ApprovalsView /></div>}
        {view === "receipts" && <div style={S.main}><ReceiptsView /></div>}
      </div>
      {settingsOpen && <SettingsModal userEmail={userEmail} userTier={userTier} creditBalance={creditBalance} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/* ===================================================================
   PRODUCT SHELL -- top-level mode router with session check
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
          setSessionChecked(true);
          return;
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

  function handleAuth(dest) {
    if (dest === "builder") {
      const onboardState = loadOnboardingState();
      setUserEmail(onboardState?.buyer?.email || null);
      setIsFirstTime(true);
      setCurrentMode("dashboard");
      navigate("/dashboard");
    } else {
      const onboardState = loadOnboardingState();
      setUserEmail(onboardState?.buyer?.email || null);
      setIsFirstTime(false);
      setCurrentMode("dashboard");
      navigate("/dashboard");
    }
  }

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
      default: return "builder"; // Always land on chat, like Claude/ChatGPT
    }
  }

  return (
    <div style={S.shell}>
      {resolvedMode === "signup" && <SignUpView onAuth={handleAuth} />}
      {resolvedMode === "login" && <SignInView onAuth={handleAuth} />}
      {resolvedMode === "pricing" && <PricingView />}
      {!["signup", "login", "pricing"].includes(resolvedMode) && resolvedMode != null && (
        <AppShell initialView={getInitialView()} userEmail={userEmail} isFirstTime={isFirstTime} />
      )}
    </div>
  );
}
