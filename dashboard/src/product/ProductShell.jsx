import * as Tabs from "@radix-ui/react-tabs";
import { startTransition, useDeferredValue, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Cable,
  ChevronRight,
  CircleCheck,
  Clock3,
  GitBranchPlus,
  Network,
  PlugZap,
  Shield,
  ShieldCheck,
  SquareTerminal,
  Workflow
} from "lucide-react";

import { docsLinks, ossLinks } from "../site/config/links.js";
import {
  abbreviateHash,
  buildAgentCardPublishSignature,
  buildHeaders,
  buildTenantConsumerConnectorOauthStartUrl,
  canonicalJsonStringify,
  createClientId,
  DEFAULT_AUTH_BASE_URL,
  decideApprovalInboxItem,
  buildEd25519JwksFromPublicKeyPem,
  fetchApprovalInbox,
  fetchApprovalPolicies,
  fetchTenantAccountSessions,
  fetchTenantBrowserStates,
  fetchTenantConsumerConnectors,
  fetchAuthorityGrants,
  fetchTenantConsumerInboxState,
  fetchTenantDocuments,
  fetchDelegationGrants,
  fetchDisputeDetail,
  fetchDisputeInbox,
  fetchTenantIntegrationsState,
  fetchMarketplaceProviderPublication,
  fetchMarketplaceProviderPublications,
  fetchRouterLaunchStatus,
  fetchRunDetail,
  respondToRunActionRequired,
  fetchTenantBuyerNotificationPreview,
  previewTenantBuyerProductNotification,
  fetchTenantSettings,
  fetchTenantX402WalletPolicies,
  fetchWorkOrderReceiptDetail,
  fetchWorkOrderReceipts,
  fetchX402WalletBudgets,
  fetchX402WalletLedger,
  fetchX402WalletPolicies,
  formatDateTime,
  formatCurrency,
  generateBrowserEd25519KeypairPem,
  loadStoredBuyerPasskeyBundle,
  loadRuntimeConfig,
  mintProviderPublishProofTokenV1,
  parseCapabilityList,
  prettyJson,
  PRODUCT_RUNTIME_STORAGE_KEY,
  publishMarketplaceProvider,
  saveStoredBuyerPasskeyBundle,
  signBrowserPasskeyChallengeBase64Url,
  revokeAuthorityGrant,
  revokeTenantAccountSession,
  revokeTenantBrowserState,
  revokeTenantConsumerConnector,
  revokeDelegationGrant,
  revokeTenantDocument,
  createTenantAccountSession,
  createTenantBrowserState,
  createTenantConsumerConnector,
  disconnectTenantIntegration,
  runMarketplaceProviderConformance,
  requestJson,
  sendTenantBuyerNotificationTest,
  sendTenantBuyerProductNotification,
  sha256HexUtf8,
  touchStoredBuyerPasskeyBundle,
  uploadTenantDocument,
  updateTenantConsumerInboxState,
  updateTenantSettings,
  upsertApprovalPolicy
} from "./api.js";
import {
  deriveStarterWorkerDraft,
  formatStarterWorkerCapabilities,
  formatStarterWorkerTags,
  starterWorkerProfiles,
  starterWorkerSetPresets
} from "./starter-worker-catalog.js";
import {
  phase1BlockedTaskFamilies,
  phase1ManagedSpecialistProfiles,
  phase1NetworkTemplates,
  phase1SupportedTaskFamilies
} from "./phase1-task-catalog.js";
import "./product.css";

const LAST_LAUNCH_STORAGE_KEY = "nooterra_product_last_launch_id_v1";
const LAST_AGENT_STORAGE_KEY = "nooterra_product_last_agent_id_v1";
const PRODUCT_ONBOARDING_STORAGE_KEY = "nooterra_product_onboarding_v1";
const PRODUCT_INBOX_READ_STATE_STORAGE_KEY = "nooterra_product_inbox_read_state_v1";
const PRODUCT_INBOX_READ_STATE_EVENT = "nooterra:product_inbox_read_state_changed";
const EMPTY_ONBOARDING_STATE = Object.freeze({
  authMode: null,
  buyer: null,
  bootstrap: null,
  smoke: null,
  sessionExpected: false
});
const EMPTY_INBOX_READ_STATE = Object.freeze({
  version: 1,
  seenAtByItemId: {}
});
const EMPTY_INBOX_SUMMARY = Object.freeze({
  pendingApprovalCount: 0,
  openDisputeCount: 0,
  launchAttentionCount: 0,
  activeLaunchTaskCount: 0,
  recentReceiptCount: 0,
  unreadCount: 0,
  actionRequiredCount: 0
});
const LAUNCH_TASK_ACTION_REQUIRED_STATES = new Set([
  "blocked_dependency_cancelled",
  "blocked_dependency_missing",
  "cancelled"
]);
const LAUNCH_TASK_ACTIVE_STATES = new Set([
  "assigned",
  "open_no_bids",
  "open_ready",
  "blocked_dependencies_pending"
]);
const PHASE1_USER_INPUT_REQUIRED_COMPLETION_STATES = new Set([
  "needs_account_access",
  "needs_calendar_access",
  "needs_identity_document",
  "needs_payment_confirmation",
  "needs_user_constraint",
  "needs_user_document"
]);
const PHASE1_USER_INPUT_REQUIRED_MESSAGES = Object.freeze({
  needs_account_access: "This run needs account access or login context from you before the network can continue.",
  needs_calendar_access: "This run needs calendar access or availability details from you before the network can continue.",
  needs_identity_document: "This run needs an identity document from you before the network can continue.",
  needs_payment_confirmation: "This run needs your payment confirmation before the network can continue.",
  needs_user_constraint: "This run needs one more decision or constraint from you before the network can continue.",
  needs_user_document: "This run needs a document or attachment from you before the network can continue."
});
const RUN_ACTION_REQUIRED_MESSAGES = Object.freeze({
  needs_account_access: "This run is paused until you provide account access or login context.",
  needs_calendar_access: "This run is paused until you share calendar access or availability details.",
  needs_identity_document: "This run is paused until you provide an identity document.",
  needs_payment_confirmation: "This run is paused until you confirm payment.",
  needs_user_constraint: "This run is paused until you provide one more decision or constraint.",
  needs_user_document: "This run is paused until you upload a document or attachment."
});

const homePrinciples = [
  {
    title: "Approve Before It Happens",
    icon: Workflow,
    body: "The model can propose. Nooterra decides whether the action may actually happen."
  },
  {
    title: "Keep Proof Attached",
    icon: ShieldCheck,
    body: "Approval, scope, evidence, receipt, and dispute stay bound to the same run."
  },
  {
    title: "Stay In The Host",
    icon: PlugZap,
    body: "The host keeps working. Nooterra only appears at the moment trust becomes necessary."
  }
];

const homeTrustRail = [
  {
    title: "Host-first",
    icon: PlugZap,
    body: "Designed to live inside Claude MCP and other hosts, not replace them."
  },
  {
    title: "Fail-closed",
    icon: BookOpen,
    body: "Missing proof, missing scope, or missing approval means the action stops."
  },
  {
    title: "Scoped grants",
    icon: ShieldCheck,
    body: "Authority stays bounded to time, capability, and spend."
  },
  {
    title: "Receipts + disputes",
    icon: SquareTerminal,
    body: "Every consequential action ends with proof and a recourse path."
  }
];

const homeSurfaces = [
  {
    title: "Wallet",
    body: "Your standing rules, trusted sessions, and live control state."
  },
  {
    title: "Approvals",
    body: "Review the action. Decide once. Let the host continue."
  },
  {
    title: "Integrations",
    body: "Connect accounts, browser state, and outbound systems."
  },
  {
    title: "Receipts",
    body: "See what happened and what can still be challenged."
  },
  {
    title: "Disputes",
    body: "Open recourse, add evidence, and keep the reversal path explicit."
  },
  {
    title: "Developers",
    body: "Install the host pack and wire approvals into code."
  }
];

const homeSequence = [
  {
    label: "01",
    title: "Intent",
    body: "The host proposes a real action with actor, scope, and risk context."
  },
  {
    label: "02",
    title: "Decision",
    body: "Policy decides green, yellow, or red before anything external happens."
  },
  {
    label: "03",
    title: "Execution",
    body: "If approved, the host continues inside a bounded authority grant."
  },
  {
    label: "04",
    title: "Proof",
    body: "Evidence, receipt, and dispute stay attached to the same action record."
  }
];

const ideModes = [
  {
    title: "Install Claude MCP",
    body: "Keep the host in charge, then send hosted approvals, grants, receipts, and disputes through Nooterra when an action becomes consequential."
  },
  {
    title: "Package OpenClaw",
    body: "Use the same runtime credentials and hosted approval flow for the second launch channel without adding another consumer surface."
  },
  {
    title: "Run Through Codex, CLI, Or API",
    body: "Use the public host pack directly when you want the same governed runtime inside Codex, local scripts, or a custom engineering shell."
  }
];

const launchActionCards = [
  {
    title: "Buy",
    body: "Approve spend, keep scope tight, and get a receipt at the end."
  },
  {
    title: "Cancel / Recover",
    body: "Cancel with proof. Recover value. Keep the record."
  },
  {
    title: "Approval -> Grant -> Receipt",
    body: "One clean path from decision to proof."
  }
];

const launchChannelCards = [
  {
    title: "Claude MCP",
    body: "Primary launch channel."
  },
  {
    title: "OpenClaw",
    body: "Second launch channel. Same contract."
  }
];

const launchNonGoals = [
  "Booking and rebooking",
  "Additional launch channels",
  "Supply-side publication",
  "Separate consumer shell",
  "Enterprise connectors",
  "General browser automation"
];

const networkTemplates = phase1NetworkTemplates;

const agentBrowsePresets = [
  {
    id: "all",
    title: "All Public Agents",
    body: "See every public worker currently visible across the network.",
    capability: "",
    runtime: ""
  },
  {
    id: "software",
    title: "Software Workers",
    body: "Code, QA, and release-oriented workers for technical workflows.",
    capability: "capability://code.generation",
    runtime: "nooterra"
  },
  {
    id: "research",
    title: "Research Workers",
    body: "Evidence gathering, comparison, and synthesis workflows.",
    capability: "capability://research.analysis",
    runtime: ""
  },
  {
    id: "operations",
    title: "Operations Workers",
    body: "Runbook execution, intake, and operational handoff.",
    capability: "capability://workflow.intake",
    runtime: ""
  }
];

const statusToneMap = {
  active: "good",
  approve: "good",
  approved: "good",
  decided: "accent",
  denied: "bad",
  deny: "bad",
  disabled: "neutral",
  inactive: "neutral",
  expired: "bad",
  revoked: "bad",
  not_yet_active: "warn",
  open_ready: "good",
  open_no_bids: "warn",
  blocked_dependencies_pending: "warn",
  blocked_dependency_cancelled: "bad",
  blocked_dependency_missing: "bad",
  assigned: "accent",
  closed: "good",
  cancelled: "bad",
  locked: "accent",
  pending: "warn",
  paused: "warn",
  rejected: "bad",
  released: "good",
  open: "warn"
};

function readStoredValue(key) {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStoredValue(key, value) {
  if (typeof window === "undefined") return;
  try {
    if (!value) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function readStoredJson(key, fallbackValue) {
  if (typeof window === "undefined") return fallbackValue;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallbackValue;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallbackValue;
    return parsed;
  } catch {
    return fallbackValue;
  }
}

function normalizeInboxReadState(value) {
  const parsed = value && typeof value === "object" && !Array.isArray(value) ? value : EMPTY_INBOX_READ_STATE;
  const seenAtByItemId =
    parsed?.seenAtByItemId && typeof parsed.seenAtByItemId === "object" && !Array.isArray(parsed.seenAtByItemId)
      ? Object.fromEntries(
          Object.entries(parsed.seenAtByItemId)
            .map(([key, value]) => {
              const normalizedKey = String(key ?? "").trim();
              const rawTimestamp = String(value ?? "").trim();
              const timestampMs = Date.parse(rawTimestamp);
              if (!normalizedKey || !rawTimestamp || !Number.isFinite(timestampMs)) return null;
              return [normalizedKey, new Date(timestampMs).toISOString()];
            })
            .filter(Boolean)
            .sort(([left], [right]) => left.localeCompare(right))
        )
      : {};
  return {
    version: 1,
    seenAtByItemId
  };
}

function readInboxReadState() {
  return normalizeInboxReadState(readStoredJson(PRODUCT_INBOX_READ_STATE_STORAGE_KEY, EMPTY_INBOX_READ_STATE));
}

function writeInboxReadState(value) {
  if (typeof window === "undefined") return;
  const nextState = normalizeInboxReadState(value);
  try {
    localStorage.setItem(
      PRODUCT_INBOX_READ_STATE_STORAGE_KEY,
      JSON.stringify(nextState)
    );
    window.dispatchEvent(new Event(PRODUCT_INBOX_READ_STATE_EVENT));
  } catch {
    // ignore
  }
}

function mergeInboxReadStates(...states) {
  const merged = {};
  for (const state of states) {
    const normalized = normalizeInboxReadState(state);
    for (const [itemId, timestamp] of Object.entries(normalized.seenAtByItemId)) {
      const currentMs = Date.parse(String(merged[itemId] ?? ""));
      const nextMs = Date.parse(String(timestamp ?? ""));
      if (!Number.isFinite(nextMs)) continue;
      if (!Number.isFinite(currentMs) || nextMs > currentMs) {
        merged[itemId] = new Date(nextMs).toISOString();
      }
    }
  }
  return normalizeInboxReadState({ seenAtByItemId: merged });
}

function inboxReadStatesEqual(left, right) {
  const normalizedLeft = normalizeInboxReadState(left);
  const normalizedRight = normalizeInboxReadState(right);
  const leftEntries = Object.entries(normalizedLeft.seenAtByItemId);
  const rightEntries = Object.entries(normalizedRight.seenAtByItemId);
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([itemId, timestamp]) => normalizedRight.seenAtByItemId[itemId] === timestamp);
}

function isInboxItemSeen(itemId, readState) {
  const normalizedItemId = String(itemId ?? "").trim();
  if (!normalizedItemId) return false;
  const seenAt = String(readState?.seenAtByItemId?.[normalizedItemId] ?? "").trim();
  return Boolean(seenAt);
}

function countUnreadInboxItems(items, readState) {
  return (Array.isArray(items) ? items : []).filter((item) => !isInboxItemSeen(item?.id, readState)).length;
}

function buildRouterLaunchResumeUrl(requestId) {
  return `/approvals?requestId=${encodeURIComponent(String(requestId ?? "").trim())}`;
}

function getQueryParam(name) {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(name);
  return value && value.trim() !== "" ? value.trim() : null;
}

function replaceCurrentSearchParams(updates = {}) {
  if (typeof window === "undefined") return;
  const nextUrl = new URL(window.location.href);
  for (const [name, rawValue] of Object.entries(updates)) {
    const value = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
    if (!value) nextUrl.searchParams.delete(name);
    else nextUrl.searchParams.set(name, value);
  }
  const nextSearch = nextUrl.searchParams.toString();
  const nextHref = `${nextUrl.pathname}${nextSearch ? `?${nextSearch}` : ""}${nextUrl.hash}`;
  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextHref !== currentHref) window.history.replaceState({}, "", nextHref);
}

function jumpToPageAnchor(hash) {
  if (typeof window === "undefined") return;
  const normalizedHash = String(hash ?? "").trim().replace(/^#?/, "#");
  if (!normalizedHash || normalizedHash === "#") return;
  const nextUrl = new URL(window.location.href);
  nextUrl.hash = normalizedHash;
  const nextSearch = nextUrl.searchParams.toString();
  const nextHref = `${nextUrl.pathname}${nextSearch ? `?${nextSearch}` : ""}${nextUrl.hash}`;
  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextHref !== currentHref) window.history.replaceState({}, "", nextHref);
  window.requestAnimationFrame(() => {
    const target = document.querySelector(normalizedHash);
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

function validateWorkspaceSignupForm(signupForm) {
  const email = String(signupForm?.email ?? "").trim();
  const company = String(signupForm?.company ?? "").trim();
  const fullName = String(signupForm?.fullName ?? "").trim();
  if (!email) return "Work email is required.";
  if (!email.includes("@")) return "Enter a valid work email before creating the workspace.";
  if (!company) return "Company name is required.";
  if (!fullName) return "Full name is required.";
  return null;
}

function validateWorkspaceLoginIdentity(loginForm) {
  const tenantId = String(loginForm?.tenantId ?? "").trim();
  const email = String(loginForm?.email ?? "").trim();
  if (!tenantId) return "Existing tenant is required.";
  if (!email) return "Sign-in email is required.";
  if (!email.includes("@")) return "Enter a valid sign-in email.";
  return null;
}

function validateWorkspaceRecoveryCode(loginForm) {
  const identityError = validateWorkspaceLoginIdentity(loginForm);
  if (identityError) return identityError;
  const code = String(loginForm?.code ?? "").trim();
  if (!code) return "Recovery code is required.";
  if (!/^\d{6}$/.test(code)) return "Enter the six-digit recovery code.";
  return null;
}

async function resumeRouterLaunchFromApproval({ runtime, continuation, approvalDecision }) {
  const resume = asPlainObject(continuation?.resume);
  const taskId = typeof resume?.taskId === "string" && resume.taskId.trim() !== "" ? resume.taskId.trim() : null;
  const requestBody =
    continuation?.requestBody && typeof continuation.requestBody === "object" && !Array.isArray(continuation.requestBody)
      ? { ...continuation.requestBody }
      : null;
  if (!taskId || !requestBody) throw new Error("approval continuation is missing router launch context");
  const launchBody = buildRouterLaunchResumeRequestBody({ continuation, approvalDecision });
  const launchOut = await requestJson({
    baseUrl: runtime.baseUrl,
    pathname: "/router/launch",
    method: "POST",
    headers: buildHeaders({ ...runtime, write: true, idempotencyKey: createClientId("router_launch_resume") }),
    body: launchBody
  });
  const nextLaunchId = launchOut?.launch?.launchId ?? null;
  let dispatchOut = null;
  let statusOut = null;
  if (resume?.dispatchNow === true && nextLaunchId) {
    dispatchOut = await requestJson({
      baseUrl: runtime.baseUrl,
      pathname: "/router/dispatch",
      method: "POST",
      headers: buildHeaders({ ...runtime, write: true, idempotencyKey: createClientId("router_dispatch_resume") }),
      body: { launchId: nextLaunchId }
    });
  }
  if (nextLaunchId) {
    statusOut = await requestJson({
      baseUrl: runtime.baseUrl,
      pathname: `/router/launches/${encodeURIComponent(nextLaunchId)}/status`,
      method: "GET",
      headers: buildHeaders(runtime)
    });
  }
  return { launchOut, dispatchOut, statusOut };
}

function buildRouterLaunchResumeRequestBody({ continuation, approvalDecision }) {
  const resume = asPlainObject(continuation?.resume);
  const taskId = typeof resume?.taskId === "string" && resume.taskId.trim() !== "" ? resume.taskId.trim() : null;
  const requestBody =
    continuation?.requestBody && typeof continuation.requestBody === "object" && !Array.isArray(continuation.requestBody)
      ? { ...continuation.requestBody }
      : null;
  if (!taskId || !requestBody) throw new Error("approval continuation is missing router launch context");
  const existingTaskOverrides =
    requestBody.taskOverrides && typeof requestBody.taskOverrides === "object" && !Array.isArray(requestBody.taskOverrides)
      ? { ...requestBody.taskOverrides }
      : {};
  const existingTaskOverride =
    existingTaskOverrides[taskId] && typeof existingTaskOverrides[taskId] === "object" && !Array.isArray(existingTaskOverrides[taskId])
      ? { ...existingTaskOverrides[taskId] }
      : {};
  existingTaskOverrides[taskId] = {
    ...existingTaskOverride,
    ...(resume?.rfqId ? { rfqId: resume.rfqId } : {}),
    authorityEnvelope: continuation?.authorityEnvelope ?? null,
    approvalRequest: continuation?.approvalRequest ?? null,
    approvalDecision
  };
  const launchBody = {
    ...requestBody,
    taskOverrides: existingTaskOverrides
  };
  return launchBody;
}

function normalizeOnboardingState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_ONBOARDING_STATE };
  return {
    authMode: value.authMode && typeof value.authMode === "object" && !Array.isArray(value.authMode) ? value.authMode : null,
    buyer: value.buyer && typeof value.buyer === "object" && !Array.isArray(value.buyer) ? value.buyer : null,
    bootstrap: value.bootstrap && typeof value.bootstrap === "object" && !Array.isArray(value.bootstrap) ? value.bootstrap : null,
    smoke: value.smoke && typeof value.smoke === "object" && !Array.isArray(value.smoke) ? value.smoke : null,
    sessionExpected: value.sessionExpected === true
  };
}

async function copyText(value) {
  if (!globalThis.navigator?.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(String(value ?? ""));
    return true;
  } catch {
    return false;
  }
}

function linkToneForMode(mode, href) {
  if (mode === "home" && href === "/") return "active";
  if (mode === "onboarding" && href === "/onboarding") return "active";
  if (mode === "inbox" && href === "/inbox") return "active";
  if (mode === "approvals" && href === "/approvals") return "active";
  if ((mode === "wallet" || mode === "integrations") && href === "/wallet") return "active";
  if (mode === "integrations" && href === "/integrations") return "active";
  if (mode === "receipts" && href === "/receipts") return "active";
  if (mode === "disputes" && href === "/disputes") return "active";
  if (mode === "developers" && href === "/developers") return "active";
  return "";
}

function describeLegacySurface(requestedPath) {
  const path = String(requestedPath ?? "").trim();
  if (!path) return "a legacy prototype surface";
  if (path === "/network" || path === "/app" || path.startsWith("/launch/")) return "the older routing and launch-tracking surface";
  if (path === "/studio") return "the older builder and publishing surface";
  if (path === "/agents" || path.startsWith("/agents/")) return "the public directory surface";
  return `the legacy surface at ${path}`;
}

function formatEtaSeconds(value) {
  const seconds = Number(value ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "n/a";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function maskToken(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "Not issued";
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 8)}…${normalized.slice(-4)}`;
}

function toIdSlug(value, fallback = "tenant") {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-z0-9_]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return normalized || fallback;
}

function titleCaseState(value) {
  return String(value ?? "")
    .replace(/_/g, " ")
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function buildPublicHeaders(runtime) {
  const protocol = String(runtime?.protocol ?? "").trim();
  return protocol ? { "x-nooterra-protocol": protocol } : undefined;
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${Math.round(number)}%`;
}

function formatEndpointHost(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "Not published";
  try {
    return new URL(normalized).host;
  } catch {
    return normalized;
  }
}

function toneForRiskTier(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "low") return "good";
  if (normalized === "guarded") return "accent";
  if (normalized === "elevated") return "warn";
  if (normalized === "high") return "bad";
  return "neutral";
}

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function extractPhase1ManagedNetworkMetadata(value) {
  const source = asPlainObject(value);
  const metadata = asPlainObject(source?.metadata) ?? source;
  const managed = asPlainObject(metadata?.phase1ManagedNetwork);
  if (!managed) return null;
  const families = extractList(managed, ["families"]).map((row) => asPlainObject(row)).filter(Boolean);
  const proofCoverage = extractList(managed, ["proofCoverage"]).map((row) => asPlainObject(row)).filter(Boolean);
  return {
    schemaVersion: managed.schemaVersion ?? null,
    profileId: pickFirstString(managed.profileId),
    familyIds: normalizeStringArray(managed.familyIds),
    families,
    proofCoverage,
    executionAdapter: asPlainObject(managed.executionAdapter)
  };
}

function extractPhase1LaunchContractFromMetadata(value) {
  const source = asPlainObject(value);
  const metadata = asPlainObject(source?.metadata) ?? source;
  const contract = asPlainObject(metadata?.phase1Launch);
  if (!contract) return null;
  return {
    schemaVersion: pickFirstString(contract.schemaVersion),
    productSurface: pickFirstString(contract.productSurface),
    categoryId: pickFirstString(contract.categoryId),
    categoryLabel: pickFirstString(contract.categoryLabel),
    categorySummary: pickFirstString(contract.categorySummary),
    completionContract: asPlainObject(contract.completionContract)
  };
}

function extractPhase1CompletionStateFromRunRecord(run) {
  const source = asPlainObject(run);
  const metrics = asPlainObject(source?.metrics);
  const nested = asPlainObject(metrics?.phase1);
  return pickFirstString(metrics?.phase1CompletionState, nested?.completionState, metrics?.completionState).toLowerCase();
}

function computePhase1CompletionStateStatus(contract, completionState) {
  const completionContract = asPlainObject(contract?.completionContract);
  const normalizedState = String(completionState ?? "").trim().toLowerCase();
  if (!normalizedState) return "";
  const successStates = normalizeStringArray(completionContract?.successStates).map((value) => value.toLowerCase());
  const unresolvedStates = normalizeStringArray(completionContract?.unresolvedStates).map((value) => value.toLowerCase());
  if (successStates.includes(normalizedState)) return "success";
  if (unresolvedStates.includes(normalizedState)) return "unresolved";
  return "invalid";
}

function findPhase1TaskFamily(categoryId) {
  const normalizedCategoryId = String(categoryId ?? "").trim();
  if (!normalizedCategoryId) return null;
  return phase1SupportedTaskFamilies.find((family) => String(family.categoryId ?? "").trim() === normalizedCategoryId) ?? null;
}

function findPhase1Template(templateId) {
  const normalizedTemplateId = String(templateId ?? "").trim();
  if (!normalizedTemplateId) return null;
  return phase1NetworkTemplates.find((template) => String(template.id ?? "").trim() === normalizedTemplateId) ?? null;
}

function deriveTaskWalletPreview({ templateId, requireApproval = false, budgetCents = null, currency = "USD", deadlineAt = null } = {}) {
  const template = findPhase1Template(templateId);
  const family = findPhase1TaskFamily(template?.categoryId);
  if (!template || !family) return null;
  const specialists = phase1ManagedSpecialistProfiles.filter((profile) =>
    Array.isArray(profile?.familyIds) && profile.familyIds.includes(family.categoryId)
  );
  const merchantScopes = Array.from(
    new Set(
      specialists
        .map((profile) => {
          if (profile.id === "purchase_runner") return "consumer_commerce";
          if (profile.id === "booking_concierge") return "booking_travel";
          if (profile.id === "account_admin") return "consumer_account_admin";
          return null;
        })
        .filter(Boolean)
    )
  );
  const hasHighTouchSpecialist = specialists.some((profile) => ["purchase_runner", "booking_concierge", "account_admin"].includes(profile.id));
  const reviewMode = requireApproval ? "human_required" : hasHighTouchSpecialist ? "operator_supervised" : "autonomous_within_envelope";
  return {
    categoryId: family.categoryId,
    categoryLabel: family.title,
    categorySummary: family.body,
    maxSpendCents: Number.isFinite(Number(budgetCents)) && Number(budgetCents) > 0 ? Number(budgetCents) : null,
    currency: String(currency ?? "USD").trim().toUpperCase() || "USD",
    reviewMode,
    expiresAt: String(deadlineAt ?? "").trim() || null,
    allowedMerchantScopes: merchantScopes,
    allowedSpecialistProfileIds: specialists.map((profile) => profile.id),
    evidenceRequirements: Array.isArray(family.completionContract?.evidenceRequirements) ? family.completionContract.evidenceRequirements : [],
    proofSummary: family.completionContract?.proofSummary ?? "",
    summary: family.completionContract?.summary ?? ""
  };
}

function deriveTaskWalletSettlementScaffold(taskWallet) {
  if (!taskWallet || typeof taskWallet !== "object") return null;
  const hasDirectSpend = Number.isFinite(Number(taskWallet.maxSpendCents)) && Number(taskWallet.maxSpendCents) > 0;
  const hasMerchantScope = Array.isArray(taskWallet.allowedMerchantScopes) && taskWallet.allowedMerchantScopes.length > 0;
  return {
    consumerSpendRail: hasDirectSpend || hasMerchantScope ? "stripe_issuing_task_wallet" : "no_direct_consumer_spend",
    platformSettlementRail: "stripe_connect_marketplace_split",
    machineSpendRail: "x402_optional_later",
    finalizationRule:
      taskWallet?.settlementPolicy?.requireEvidenceBeforeFinalize === false
        ? "manual_finalize_allowed"
        : "evidence_required_before_finalize"
  };
}

function isPhase1UserInputRequiredCompletionState(completionState) {
  return PHASE1_USER_INPUT_REQUIRED_COMPLETION_STATES.has(String(completionState ?? "").trim().toLowerCase());
}

function describePhase1UserInputRequiredState(task) {
  const completionState = String(task?.phase1CompletionState ?? "").trim().toLowerCase();
  const familyLabel =
    pickFirstString(task?.phase1CategoryLabel, task?.title) || "This run";
  const familyPrefix = `${familyLabel} needs one more step from you.`;
  const detail = PHASE1_USER_INPUT_REQUIRED_MESSAGES[completionState] ?? "This run is waiting on more information from you before the network can continue.";
  return `${familyPrefix} ${detail}`;
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function pickFirstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function pickFirstBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((row) => String(row ?? "").trim()).filter(Boolean);
  if (typeof value === "string") return parseCapabilityList(value);
  return [];
}

function extractList(value, keys = []) {
  if (Array.isArray(value)) return value;
  const source = asPlainObject(value);
  if (!source) return [];
  for (const key of keys) {
    if (Array.isArray(source[key])) return source[key];
  }
  return [];
}

function humanizeLabel(value, fallback = "n/a") {
  const normalized = String(value ?? "").trim();
  if (!normalized) return fallback;
  return normalized
    .replace(/[_./:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function buildDeadlineState(deadlineAt) {
  const iso = String(deadlineAt ?? "").trim();
  const deadlineMs = Date.parse(iso);
  if (!Number.isFinite(deadlineMs)) {
    return {
      hasDeadline: false,
      isExpired: false,
      isUrgent: false,
      tone: "neutral",
      label: "Open-ended"
    };
  }
  const nowMs = Date.now();
  const remainingMs = deadlineMs - nowMs;
  if (remainingMs <= 0) {
    return {
      hasDeadline: true,
      isExpired: true,
      isUrgent: false,
      tone: "bad",
      label: "Expired"
    };
  }
  const remainingMinutes = Math.round(remainingMs / 60000);
  if (remainingMinutes <= 60) {
    return {
      hasDeadline: true,
      isExpired: false,
      isUrgent: true,
      tone: "warn",
      label: remainingMinutes <= 1 ? "Due now" : `Due in ${remainingMinutes}m`
    };
  }
  const remainingHours = Math.round(remainingMs / 3600000);
  return {
    hasDeadline: true,
    isExpired: false,
    isUrgent: false,
    tone: "neutral",
    label: remainingHours <= 24 ? `Due in ${remainingHours}h` : formatDateTime(iso)
  };
}

function buildDisputeWindowState({
  disputeId = null,
  disputeStatus = null,
  disputeWindowEndsAt = null,
  settlementStatus = null
} = {}) {
  const normalizedDisputeId = String(disputeId ?? "").trim();
  const normalizedDisputeStatus = String(disputeStatus ?? "").trim().toLowerCase();
  const normalizedSettlementStatus = String(settlementStatus ?? "").trim().toLowerCase();
  const iso = String(disputeWindowEndsAt ?? "").trim();
  const deadlineMs = Date.parse(iso);
  const hasWindow = Number.isFinite(deadlineMs);
  const remainingMs = hasWindow ? deadlineMs - Date.now() : null;
  const isExpired = hasWindow ? remainingMs <= 0 : false;
  const isUrgent = hasWindow ? remainingMs > 0 && remainingMs <= 3600000 : false;
  if (normalizedDisputeStatus === "open" || normalizedDisputeId) {
    return {
      hasWindow,
      isExpired: false,
      isUrgent: false,
      tone: "accent",
      label: "Dispute open",
      summary: "Recourse is already active on this settlement. Keep the linked dispute packet as the source of truth before releasing or closing anything else."
    };
  }
  if (normalizedSettlementStatus === "refunded") {
    return {
      hasWindow,
      isExpired: false,
      isUrgent: false,
      tone: "good",
      label: "Resolved by refund",
      summary: "This settlement has already been refunded. The receipt remains available for support and replay, but active recourse is no longer the main path."
    };
  }
  if (!hasWindow) {
    return {
      hasWindow: false,
      isExpired: false,
      isUrgent: false,
      tone: "neutral",
      label: "Window unavailable",
      summary: "No dispute window was reported for this settlement. Use the linked run and receipt as the support record if review is still needed."
    };
  }
  if (isExpired) {
    return {
      hasWindow: true,
      isExpired: true,
      isUrgent: false,
      tone: "bad",
      label: "Window closed",
      summary: `The standard dispute window closed at ${formatDateTime(iso)}. This receipt is still readable, but opening new recourse now likely requires operator intervention.`
    };
  }
  const remainingMinutes = Math.round(remainingMs / 60000);
  const label =
    remainingMinutes <= 1
      ? "Window closes now"
      : remainingMinutes <= 60
        ? `Window closes in ${remainingMinutes}m`
        : `Window closes ${formatDateTime(iso)}`;
  return {
    hasWindow: true,
    isExpired: false,
    isUrgent,
    tone: isUrgent ? "warn" : "good",
    label,
    summary: `Recourse is still available for this settlement until ${formatDateTime(iso)}. If the execution proof or amount looks wrong, open the linked dispute before the window closes.`
  };
}

function normalizeApprovalStatus(value, approved, fallback = "pending") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "approve" || normalized === "approved") return "approved";
  if (normalized === "deny" || normalized === "denied" || normalized === "rejected") return "denied";
  if (normalized === "decided" && approved === true) return "approved";
  if (normalized === "decided" && approved === false) return "denied";
  if (normalized) return normalized;
  if (approved === true) return "approved";
  if (approved === false) return "denied";
  return fallback;
}

function normalizeApprovalInboxItem(input, fallbackStatus = "pending") {
  const source = asPlainObject(input) ?? {};
  const request = asPlainObject(source.approvalRequest) ?? source;
  const authorityEnvelope = asPlainObject(source.authorityEnvelope) ?? asPlainObject(source.envelope);
  const actionRef = asPlainObject(request.actionRef) ?? asPlainObject(source.actionRef);
  const decision = asPlainObject(source.approvalDecision) ?? asPlainObject(source.decision) ?? asPlainObject(source.latestDecision);
  const continuation = asPlainObject(source.approvalContinuation) ?? asPlainObject(source.continuation);
  const approvalPolicy = asPlainObject(request.approvalPolicy) ?? asPlainObject(source.approvalPolicy);
  const standingPolicy = asPlainObject(source.standingPolicy);
  const decisionMetadata = asPlainObject(decision?.metadata);
  const metadata =
    asPlainObject(source.metadata) ??
    asPlainObject(request.metadata) ??
    decisionMetadata ??
    asPlainObject(source.context);
  const approved = pickFirstBoolean(decision?.approved, source.approved);
  const requestId = pickFirstString(source.requestId, request.requestId, decision?.requestId, source.id);
  const actionId = pickFirstString(actionRef?.actionId, source.actionId, decision?.actionId, metadata?.actionId);
  const title = pickFirstString(
    source.title,
    source.summary,
    source.subject,
    source.requestTitle,
    source.actionTitle,
    metadata?.title,
    metadata?.summary,
    metadata?.subject,
    authorityEnvelope?.purpose,
    actionId ? humanizeLabel(actionId, "") : "",
    requestId ? `Approval ${requestId}` : ""
  );

  return {
    requestId,
    status: normalizeApprovalStatus(source.status ?? source.state ?? decision?.status, approved, fallbackStatus),
    approved,
    title: title || "Approval request",
    description: pickFirstString(
      source.description,
      source.details,
      metadata?.description,
      metadata?.reason,
      metadata?.notes,
      authorityEnvelope?.purpose
    ),
    requestedBy: pickFirstString(
      source.requestedBy,
      request.requestedBy,
      metadata?.requestedBy,
      source.actorId,
      source.actor?.actorId,
      authorityEnvelope?.principalRef?.principalId
    ),
    requestedAt: pickFirstString(source.requestedAt, request.requestedAt, source.createdAt, source.queuedAt),
    amountCents: pickFirstNumber(
      source.amountCents,
      source.amount?.cents,
      source.amount?.amountCents,
      source.pricing?.amountCents,
      source.action?.amountCents,
      metadata?.amountCents,
      metadata?.pricing?.amountCents,
      authorityEnvelope?.spendEnvelope?.maxTotalCents
    ),
    currency: pickFirstString(
      source.currency,
      source.amount?.currency,
      source.pricing?.currency,
      source.action?.currency,
      metadata?.currency,
      metadata?.pricing?.currency,
      authorityEnvelope?.spendEnvelope?.currency,
      "USD"
    ),
    actionId,
    actionSha256: pickFirstString(actionRef?.sha256, source.actionSha256, decision?.actionSha256),
    envelopeHash: pickFirstString(request.envelopeRef?.envelopeHash, source.envelopeHash, decision?.envelopeHash),
    policyId: pickFirstString(source.policyId, source.approvalPolicyId, approvalPolicy?.policyId, standingPolicy?.policyId, metadata?.policyId),
    approvalPolicy,
    standingPolicy,
    deadlineAt: pickFirstString(
      source.deadlineAt,
      source.expiresAt,
      decision?.expiresAt,
      approvalPolicy?.decisionTimeoutAt,
      authorityEnvelope?.duration?.deadlineAt
    ),
    decisionId: pickFirstString(decision?.decisionId, source.decisionId),
    decidedBy: pickFirstString(decision?.decidedBy, source.decidedBy),
    decidedAt: pickFirstString(decision?.decidedAt, source.decidedAt, source.updatedAt),
    riskClass: pickFirstString(source.riskClass, authorityEnvelope?.riskClass),
    reversibilityClass: pickFirstString(source.reversibilityClass, authorityEnvelope?.reversibilityClass),
    capabilitiesRequested: normalizeStringArray(source.capabilitiesRequested ?? authorityEnvelope?.capabilitiesRequested),
    dataClassesRequested: normalizeStringArray(source.dataClassesRequested ?? authorityEnvelope?.dataClassesRequested),
    sideEffectsRequested: normalizeStringArray(source.sideEffectsRequested ?? authorityEnvelope?.sideEffectsRequested),
    downstreamRecipients: normalizeStringArray(source.downstreamRecipients ?? authorityEnvelope?.downstreamRecipients),
    spendLimitCents: pickFirstNumber(
      source.spendLimitCents,
      source.maxSpendCents,
      authorityEnvelope?.spendEnvelope?.maxTotalCents,
      authorityEnvelope?.spendEnvelope?.maxPerCallCents
    ),
    delegationAllowed: pickFirstBoolean(source.delegationAllowed, authorityEnvelope?.delegationRights?.mayDelegate),
    maxDelegationDepth: pickFirstNumber(source.maxDelegationDepth, authorityEnvelope?.delegationRights?.maxDepth),
    note: pickFirstString(decision?.note, decision?.rationale, source.note, source.rationale, decisionMetadata?.note, decisionMetadata?.rationale, metadata?.note),
    evidenceRefs: normalizeStringArray(decision?.evidenceRefs ?? source.evidenceRefs ?? metadata?.evidenceRefs),
    continuation,
    raw: input
  };
}

function normalizeApprovalPolicyRecord(input) {
  const source = asPlainObject(input) ?? {};
  const constraints = asPlainObject(source.constraints);
  const decision = asPlainObject(source.decision);
  const principalRef = asPlainObject(source.principalRef);
  const policyId = pickFirstString(source.policyId, source.id);
  const name = pickFirstString(source.displayName, source.name, source.title, policyId ? humanizeLabel(policyId, "") : "");

  return {
    policyId,
    name: name || "Untitled policy",
    description: pickFirstString(source.description, source.summary, source.notes, source.metadata?.description),
    status: pickFirstString(source.status, source.enabled === false ? "disabled" : "active"),
    principalType: pickFirstString(principalRef?.principalType, "agent"),
    principalId: pickFirstString(principalRef?.principalId, ""),
    actorAgentIds: normalizeStringArray(constraints?.actorAgentIds),
    capabilitiesRequested: normalizeStringArray(constraints?.capabilitiesRequested),
    dataClassesRequested: normalizeStringArray(constraints?.dataClassesRequested),
    sideEffectsRequested: normalizeStringArray(constraints?.sideEffectsRequested),
    maxSpendCents: pickFirstNumber(constraints?.maxSpendCents),
    maxRiskClass: pickFirstString(constraints?.maxRiskClass, ""),
    reversibilityClasses: normalizeStringArray(constraints?.reversibilityClasses),
    effect: pickFirstString(decision?.effect, "approve"),
    decidedBy: pickFirstString(decision?.decidedBy, ""),
    expiresAfterSeconds: pickFirstNumber(decision?.expiresAfterSeconds),
    evidenceRefs: normalizeStringArray(decision?.evidenceRefs),
    updatedAt: pickFirstString(source.updatedAt, source.createdAt, source.lastModifiedAt),
    raw: input
  };
}

function buildApprovalPolicyFormState(policy = null) {
  const normalized = policy ? normalizeApprovalPolicyRecord(policy) : null;
  return {
    policyId: normalized?.policyId ?? "",
    name: normalized?.name === "Untitled policy" ? "" : normalized?.name ?? "",
    description: normalized?.description ?? "",
    status: normalized?.status ?? "active",
    principalType: normalized?.principalType ?? "agent",
    principalId: normalized?.principalId ?? "",
    actorAgentIds: normalized?.actorAgentIds?.join("\n") ?? "",
    capabilitiesRequested: normalized?.capabilitiesRequested?.join("\n") ?? "",
    dataClassesRequested: normalized?.dataClassesRequested?.join("\n") ?? "",
    sideEffectsRequested: normalized?.sideEffectsRequested?.join("\n") ?? "",
    maxSpendCents:
      normalized?.maxSpendCents !== null && normalized?.maxSpendCents !== undefined
        ? String(normalized.maxSpendCents)
        : "",
    maxRiskClass: normalized?.maxRiskClass ?? "",
    reversibilityClasses: normalized?.reversibilityClasses?.join("\n") ?? "",
    effect: normalized?.effect ?? "approve",
    decidedBy: normalized?.decidedBy ?? "",
    expiresAfterSeconds:
      normalized?.expiresAfterSeconds !== null && normalized?.expiresAfterSeconds !== undefined
        ? String(normalized.expiresAfterSeconds)
        : "",
    evidenceRefs: normalized?.evidenceRefs?.join("\n") ?? ""
  };
}

function looksLikeAgentId(value) {
  const normalized = String(value ?? "").trim();
  return normalized.startsWith("agt_") || normalized.startsWith("agt:");
}

function computeGrantDisplayState(validity = null, revocation = null) {
  const revokedAt = pickFirstString(revocation?.revokedAt, "");
  if (revokedAt) return "revoked";
  const nowMs = Date.now();
  const notBeforeMs = Date.parse(String(validity?.notBefore ?? ""));
  if (Number.isFinite(notBeforeMs) && notBeforeMs > nowMs) return "not_yet_active";
  const expiresMs = Date.parse(String(validity?.expiresAt ?? ""));
  if (Number.isFinite(expiresMs) && expiresMs <= nowMs) return "expired";
  return "active";
}

function normalizeAuthorityGrantRecord(input) {
  const source = asPlainObject(input) ?? {};
  const principalRef = asPlainObject(source.principalRef);
  const scope = asPlainObject(source.scope);
  const spendEnvelope = asPlainObject(source.spendEnvelope);
  const validity = asPlainObject(source.validity);
  const revocation = asPlainObject(source.revocation);
  const state = computeGrantDisplayState(validity, revocation);
  return {
    kind: "authority",
    grantId: pickFirstString(source.grantId, source.id),
    grantHash: pickFirstString(source.grantHash),
    principalType: pickFirstString(principalRef?.principalType, ""),
    principalId: pickFirstString(principalRef?.principalId, ""),
    granteeAgentId: pickFirstString(source.granteeAgentId, ""),
    allowedProviderIds: normalizeStringArray(scope?.allowedProviderIds),
    allowedToolIds: normalizeStringArray(scope?.allowedToolIds),
    allowedRiskClasses: normalizeStringArray(scope?.allowedRiskClasses),
    sideEffectingAllowed: pickFirstBoolean(scope?.sideEffectingAllowed, false),
    currency: pickFirstString(spendEnvelope?.currency, "USD"),
    maxPerCallCents: pickFirstNumber(spendEnvelope?.maxPerCallCents),
    maxTotalCents: pickFirstNumber(spendEnvelope?.maxTotalCents),
    issuedAt: pickFirstString(validity?.issuedAt, source.createdAt),
    notBefore: pickFirstString(validity?.notBefore),
    expiresAt: pickFirstString(validity?.expiresAt),
    revocable: pickFirstBoolean(revocation?.revocable, true),
    revokedAt: pickFirstString(revocation?.revokedAt, ""),
    revocationReasonCode: pickFirstString(revocation?.revocationReasonCode, ""),
    status: state,
    raw: input
  };
}

function normalizeDelegationGrantRecord(input) {
  const source = asPlainObject(input) ?? {};
  const scope = asPlainObject(source.scope);
  const spendLimit = asPlainObject(source.spendLimit);
  const validity = asPlainObject(source.validity);
  const revocation = asPlainObject(source.revocation);
  const chainBinding = asPlainObject(source.chainBinding);
  const state = computeGrantDisplayState(validity, revocation);
  return {
    kind: "delegation",
    grantId: pickFirstString(source.grantId, source.id),
    grantHash: pickFirstString(source.grantHash),
    delegatorAgentId: pickFirstString(source.delegatorAgentId, ""),
    delegateeAgentId: pickFirstString(source.delegateeAgentId, ""),
    allowedProviderIds: normalizeStringArray(scope?.allowedProviderIds),
    allowedToolIds: normalizeStringArray(scope?.allowedToolIds),
    allowedRiskClasses: normalizeStringArray(scope?.allowedRiskClasses),
    sideEffectingAllowed: pickFirstBoolean(scope?.sideEffectingAllowed, false),
    currency: pickFirstString(spendLimit?.currency, "USD"),
    maxPerCallCents: pickFirstNumber(spendLimit?.maxPerCallCents),
    maxTotalCents: pickFirstNumber(spendLimit?.maxTotalCents),
    depth: pickFirstNumber(chainBinding?.depth),
    maxDelegationDepth: pickFirstNumber(chainBinding?.maxDelegationDepth),
    issuedAt: pickFirstString(validity?.issuedAt, source.createdAt),
    notBefore: pickFirstString(validity?.notBefore),
    expiresAt: pickFirstString(validity?.expiresAt),
    revocable: pickFirstBoolean(revocation?.revocable, true),
    revokedAt: pickFirstString(revocation?.revokedAt, ""),
    revocationReasonCode: pickFirstString(revocation?.revocationReasonCode, ""),
    status: state,
    raw: input
  };
}

function normalizeTenantDocumentRecord(input) {
  const source = asPlainObject(input) ?? {};
  return {
    documentId: pickFirstString(source.documentId, source.id),
    documentRef: pickFirstString(source.documentRef),
    filename: pickFirstString(source.filename, "attachment.bin"),
    contentType: pickFirstString(source.contentType, "application/octet-stream"),
    mediaClass: pickFirstString(source.mediaClass, "unknown"),
    byteLength: pickFirstNumber(source.byteLength),
    sha256: pickFirstString(source.sha256),
    purpose: pickFirstString(source.purpose),
    label: pickFirstString(source.label),
    uploadedBy: pickFirstString(source.uploadedBy),
    uploadedAt: pickFirstString(source.uploadedAt),
    revokedAt: pickFirstString(source.revokedAt),
    revokedReason: pickFirstString(source.revokedReason)
  };
}

function normalizeTenantBrowserStateRecord(input) {
  const source = asPlainObject(input) ?? {};
  const storageState = asPlainObject(source.storageState);
  const cookies = Array.isArray(storageState?.cookies) ? storageState.cookies : [];
  const origins = Array.isArray(storageState?.origins) ? storageState.origins : [];
  return {
    stateId: pickFirstString(source.stateId, source.id),
    stateRef: pickFirstString(source.stateRef),
    sha256: pickFirstString(source.sha256),
    label: pickFirstString(source.label),
    purpose: pickFirstString(source.purpose),
    uploadedBy: pickFirstString(source.uploadedBy),
    uploadedAt: pickFirstString(source.uploadedAt),
    revokedAt: pickFirstString(source.revokedAt),
    revokedReason: pickFirstString(source.revokedReason),
    storageState: {
      cookies,
      origins
    },
    raw: input
  };
}

function normalizeConsumerDataSourcesRecord(input) {
  const source = asPlainObject(input) ?? {};
  const email = asPlainObject(source.email);
  const calendar = asPlainObject(source.calendar);
  return {
    email: {
      enabled: pickFirstBoolean(email?.enabled, false),
      provider: pickFirstString(email?.provider, "manual"),
      address: pickFirstString(email?.address),
      label: pickFirstString(email?.label),
      connectedAt: pickFirstString(email?.connectedAt)
    },
    calendar: {
      enabled: pickFirstBoolean(calendar?.enabled, false),
      provider: pickFirstString(calendar?.provider, "manual"),
      address: pickFirstString(calendar?.address),
      timezone: pickFirstString(calendar?.timezone),
      availabilityNotes: pickFirstString(calendar?.availabilityNotes),
      connectedAt: pickFirstString(calendar?.connectedAt)
    }
  };
}

function normalizeTenantAccountSessionRecord(input) {
  const source = asPlainObject(input) ?? {};
  const permissions = asPlainObject(source.permissions);
  const browserProfile = asPlainObject(source.browserProfile);
  return {
    sessionId: pickFirstString(source.sessionId, source.id),
    sessionRef: pickFirstString(source.sessionRef),
    providerKey: pickFirstString(source.providerKey),
    providerLabel: pickFirstString(source.providerLabel),
    siteKey: pickFirstString(source.siteKey),
    siteLabel: pickFirstString(source.siteLabel),
    mode: pickFirstString(source.mode, "approval_at_boundary"),
    accountHandleMasked: pickFirstString(source.accountHandleMasked),
    fundingSourceLabel: pickFirstString(source.fundingSourceLabel),
    maxSpendCents: pickFirstNumber(source.maxSpendCents),
    currency: pickFirstString(source.currency, "USD"),
    permissions: {
      canPurchase: pickFirstBoolean(permissions?.canPurchase, false),
      canUseSavedPaymentMethods: pickFirstBoolean(permissions?.canUseSavedPaymentMethods, false),
      requiresFinalReview: pickFirstBoolean(permissions?.requiresFinalReview, true)
    },
    browserProfile: {
      storageStateRef: pickFirstString(browserProfile?.storageStateRef),
      loginOrigin: pickFirstString(browserProfile?.loginOrigin),
      startUrl: pickFirstString(browserProfile?.startUrl),
      allowedDomains: Array.isArray(browserProfile?.allowedDomains)
        ? browserProfile.allowedDomains.map((value) => pickFirstString(value)).filter(Boolean)
        : [],
      reviewMode: pickFirstString(browserProfile?.reviewMode)
    },
    createdBy: pickFirstString(source.createdBy),
    linkedAt: pickFirstString(source.linkedAt),
    revokedAt: pickFirstString(source.revokedAt),
    revokedReason: pickFirstString(source.revokedReason)
  };
}

function normalizeTenantConsumerConnectorRecord(input) {
  const source = asPlainObject(input) ?? {};
  const scopes = Array.isArray(source.scopes) ? source.scopes.map((row) => pickFirstString(row)).filter(Boolean) : [];
  return {
    connectorId: pickFirstString(source.connectorId, source.id),
    connectorRef: pickFirstString(source.connectorRef),
    kind: pickFirstString(source.kind),
    provider: pickFirstString(source.provider),
    mode: pickFirstString(source.mode, "manual"),
    status: pickFirstString(source.status, source.revokedAt ? "revoked" : "connected"),
    accountAddress: pickFirstString(source.accountAddress),
    accountLabel: pickFirstString(source.accountLabel),
    timezone: pickFirstString(source.timezone),
    scopes,
    connectedAt: pickFirstString(source.connectedAt),
    createdBy: pickFirstString(source.createdBy),
    revokedAt: pickFirstString(source.revokedAt),
    revokedReason: pickFirstString(source.revokedReason),
    raw: input
  };
}

function buildRunActionRequiredPrefillFromConsumerDataSources(runActionRequired, consumerDataSources) {
  const requestedFields = Array.isArray(runActionRequired?.requestedFields) ? runActionRequired.requestedFields : [];
  const sources = normalizeConsumerDataSourcesRecord(consumerDataSources);
  const providedFields = {};
  for (const field of requestedFields) {
    const key = String(field ?? "").trim();
    const normalized = key.toLowerCase();
    if (!normalized) continue;
    let value = "";
    if (normalized.includes("timezone")) value = sources.calendar.timezone;
    else if (normalized.includes("availability")) value = sources.calendar.availabilityNotes;
    else if (normalized.includes("calendar") && normalized.includes("provider")) value = sources.calendar.provider;
    else if (normalized.includes("calendar") && (normalized.includes("email") || normalized.includes("address"))) value = sources.calendar.address || sources.email.address;
    else if (normalized.includes("contact_email")) value = sources.email.address || sources.calendar.address;
    else if (normalized === "email" || normalized.endsWith("_email") || normalized.includes("email_address")) value = sources.email.address || sources.calendar.address;
    if (String(value ?? "").trim()) providedFields[key] = String(value).trim();
  }
  return {
    providedFields,
    hasPrefill: Object.keys(providedFields).length > 0
  };
}

function buildRunActionRequiredPrefillFromAccountSession(runActionRequired, accountSession) {
  const requestedFields = Array.isArray(runActionRequired?.requestedFields) ? runActionRequired.requestedFields : [];
  const session = normalizeTenantAccountSessionRecord(accountSession);
  if (!session.sessionId) {
    return {
      providedFields: {},
      hasPrefill: false
    };
  }
  const providedFields = {};
  for (const field of requestedFields) {
    const key = String(field ?? "").trim();
    const normalized = key.toLowerCase();
    if (!normalized) continue;
    let value = "";
    if (normalized.includes("account_session") && normalized.includes("ref")) value = session.sessionRef;
    else if (normalized.includes("session") && normalized.includes("ref")) value = session.sessionRef;
    else if (normalized.endsWith("session_id") || normalized.includes("account_session_id")) value = session.sessionId;
    else if (normalized.includes("provider_key")) value = session.providerKey;
    else if (normalized.includes("provider")) value = session.providerLabel || session.providerKey;
    else if (normalized.includes("site_key")) value = session.siteKey;
    else if (normalized.includes("site")) value = session.siteLabel || session.siteKey;
    else if (normalized.includes("account_handle") || normalized.includes("login") || normalized.includes("account_id")) value = session.accountHandleMasked;
    else if (normalized.includes("funding")) value = session.fundingSourceLabel;
    else if (normalized.includes("max_spend") || normalized.includes("spend_cap")) {
      value = Number.isFinite(session.maxSpendCents) ? String(session.maxSpendCents) : "";
    } else if (normalized.includes("currency")) value = session.currency;
    else if (normalized.includes("saved_payment")) value = session.permissions.canUseSavedPaymentMethods ? "true" : "false";
    else if (normalized.includes("purchase")) value = session.permissions.canPurchase ? "true" : "false";
    else if (normalized.includes("final_review") || normalized.includes("review_required")) {
      value = session.permissions.requiresFinalReview ? "true" : "false";
    } else if (normalized.includes("execution_mode") || normalized === "mode") value = session.mode;
    if (String(value ?? "").trim()) providedFields[key] = String(value).trim();
  }
  return {
    providedFields,
    hasPrefill: Object.keys(providedFields).length > 0
  };
}

function buildRunActionRequiredPrefillFromConsumerConnector(runActionRequired, consumerConnector) {
  const requestedFields = Array.isArray(runActionRequired?.requestedFields) ? runActionRequired.requestedFields : [];
  const connector = normalizeTenantConsumerConnectorRecord(consumerConnector);
  if (!connector.connectorId || !connector.connectorRef) {
    return {
      providedFields: {},
      hasPrefill: false
    };
  }
  const providedFields = {};
  for (const field of requestedFields) {
    const key = String(field ?? "").trim();
    const normalized = key.toLowerCase();
    if (!normalized) continue;
    let value = "";
    if (normalized.includes("connector") && normalized.includes("ref")) value = connector.connectorRef;
    else if (normalized.includes("provider")) value = connector.provider;
    else if (normalized.includes("timezone")) value = connector.timezone;
    else if (normalized === "email" || normalized.endsWith("_email") || normalized.includes("contact_email")) {
      value = connector.kind === "email" ? connector.accountAddress : "";
    } else if (normalized.includes("address") || normalized.includes("calendar_email")) value = connector.accountAddress;
    if (String(value ?? "").trim()) providedFields[key] = String(value).trim();
  }
  const kindPrefix = connector.kind === "calendar" ? "calendar" : "email";
  if (!Object.keys(providedFields).some((field) => field.toLowerCase().includes("connector") && field.toLowerCase().includes("ref"))) {
    providedFields[`${kindPrefix}_connector_ref`] = connector.connectorRef;
  }
  return {
    providedFields,
    hasPrefill: Object.keys(providedFields).length > 0
  };
}

function normalizeReceiptRecord(input) {
  const source = asPlainObject(input) ?? {};
  const settlementQuote = asPlainObject(source.settlementQuote);
  const executionAttestation = asPlainObject(source.executionAttestation);
  const metadata = asPlainObject(source.metadata);
  const outputs =
    Array.isArray(source.outputs) || (source.outputs && typeof source.outputs === "object" && !Array.isArray(source.outputs))
      ? source.outputs
      : null;
  const metrics = asPlainObject(source.metrics);

  return {
    receiptId: pickFirstString(source.receiptId, source.id),
    workOrderId: pickFirstString(source.workOrderId),
    principalAgentId: pickFirstString(source.principalAgentId),
    subAgentId: pickFirstString(source.subAgentId),
    status: pickFirstString(source.status, "success"),
    deliveredAt: pickFirstString(source.deliveredAt, source.createdAt),
    amountCents: pickFirstNumber(settlementQuote?.amountCents, source.amountCents),
    currency: pickFirstString(settlementQuote?.currency, source.currency, "USD"),
    evidenceRefs: normalizeStringArray(source.evidenceRefs),
    traceId: pickFirstString(source.traceId),
    intentHash: pickFirstString(source.intentHash),
    receiptHash: pickFirstString(source.receiptHash),
    outputs,
    metrics,
    executionAttestation,
    metadata,
    raw: input
  };
}

function normalizeReceiptDetailIssue(input) {
  const source = asPlainObject(input) ?? {};
  return {
    code: pickFirstString(source.code, ""),
    message: pickFirstString(source.message, ""),
    raw: input
  };
}

function normalizeReceiptDetailRecord(input) {
  const source = asPlainObject(input) ?? {};
  const workOrder = asPlainObject(source.workOrder);
  const settlement = asPlainObject(source.settlement);
  const intentBinding = asPlainObject(source.intentBinding);
  const executionAttestation = asPlainObject(source.executionAttestation);
  const issues = extractList(source, ["issues"]).map((entry) => normalizeReceiptDetailIssue(entry)).filter((entry) => entry.code);
  return {
    receiptId: pickFirstString(source.receiptId),
    workOrderId: pickFirstString(source.workOrderId, workOrder?.workOrderId),
    traceId: pickFirstString(source.traceId, workOrder?.traceId),
    integrityStatus: pickFirstString(source.integrityStatus, issues.length ? "attention_required" : "verified"),
    issues,
    workOrder,
    settlement,
    settlementRunId: pickFirstString(settlement?.x402RunId),
    intentBinding,
    evidenceRefs: normalizeStringArray(source.evidenceRefs),
    executionAttestation,
    raw: input
  };
}

function normalizeX402WalletPolicyRecord(input) {
  const source = asPlainObject(input) ?? {};
  return {
    sponsorRef: pickFirstString(source.sponsorRef),
    sponsorWalletRef: pickFirstString(source.sponsorWalletRef),
    policyRef: pickFirstString(source.policyRef),
    policyVersion: pickFirstNumber(source.policyVersion),
    status: pickFirstString(source.status, "active"),
    maxAmountCents: pickFirstNumber(source.maxAmountCents),
    maxDailyAuthorizationCents: pickFirstNumber(source.maxDailyAuthorizationCents),
    maxDelegationDepth: pickFirstNumber(source.maxDelegationDepth),
    allowedProviderIds: normalizeStringArray(source.allowedProviderIds),
    allowedToolIds: normalizeStringArray(source.allowedToolIds),
    allowedCurrencies: normalizeStringArray(source.allowedCurrencies),
    policyFingerprint: pickFirstString(source.policyFingerprint),
    description: pickFirstString(source.description),
    updatedAt: pickFirstString(source.updatedAt, source.createdAt),
    raw: input
  };
}

function normalizeX402WalletLedgerEntryRecord(input) {
  const source = asPlainObject(input) ?? {};
  return {
    receiptId: pickFirstString(source.receiptId),
    gateId: pickFirstString(source.gateId),
    runId: pickFirstString(source.runId),
    sponsorRef: pickFirstString(source.sponsorRef),
    sponsorWalletRef: pickFirstString(source.sponsorWalletRef),
    providerId: pickFirstString(source.providerId),
    toolId: pickFirstString(source.toolId),
    settlementState: pickFirstString(source.settlementState, "unknown"),
    verificationStatus: pickFirstString(source.verificationStatus),
    settledAt: pickFirstString(source.settledAt),
    currency: pickFirstString(source.currency, "USD"),
    amountCents: pickFirstNumber(source.amountCents),
    releasedAmountCents: pickFirstNumber(source.releasedAmountCents),
    refundedAmountCents: pickFirstNumber(source.refundedAmountCents),
    netAmountCents: pickFirstNumber(source.netAmountCents),
    raw: input
  };
}

function normalizeDisputeInboxRecord(input) {
  const source = asPlainObject(input) ?? {};
  const arbitration = asPlainObject(source.arbitration) ?? {};
  const arbitrationCases = extractList(arbitration, ["cases"]).map((row) => asPlainObject(row) ?? {}).filter((row) => row.caseId);
  return {
    runId: pickFirstString(source.runId),
    settlementId: pickFirstString(source.settlementId),
    disputeId: pickFirstString(source.disputeId),
    settlementStatus: pickFirstString(source.settlementStatus, "unknown"),
    disputeStatus: pickFirstString(source.disputeStatus, "unknown"),
    payerAgentId: pickFirstString(source.payerAgentId),
    counterpartyAgentId: pickFirstString(source.counterpartyAgentId),
    amountCents: pickFirstNumber(source.amountCents),
    currency: pickFirstString(source.currency, "USD"),
    disputeOpenedAt: pickFirstString(source.disputeOpenedAt),
    disputeWindowEndsAt: pickFirstString(source.disputeWindowEndsAt),
    releasedAmountCents: pickFirstNumber(source.releasedAmountCents, 0),
    refundedAmountCents: pickFirstNumber(source.refundedAmountCents, 0),
    disputeContext: asPlainObject(source.disputeContext),
    disputeResolution: asPlainObject(source.disputeResolution),
    caseCount: pickFirstNumber(arbitration.caseCount, arbitrationCases.length, 0),
    openCaseCount: pickFirstNumber(arbitration.openCaseCount, 0),
    latestCaseId: pickFirstString(arbitration.latestCaseId),
    latestCaseStatus: pickFirstString(arbitration.latestCaseStatus),
    latestCaseUpdatedAt: pickFirstString(arbitration.latestCaseUpdatedAt),
    arbitrationCases,
    raw: input
  };
}

function normalizeDisputeDetailRecord(input) {
  const source = asPlainObject(input) ?? {};
  return {
    item: asPlainObject(source.item),
    arbitrationCase: asPlainObject(source.arbitrationCase),
    settlement: asPlainObject(source.settlement),
    timeline: extractList(source, ["timeline"]).map((entry) => asPlainObject(entry) ?? {}).filter((entry) => entry.eventType || entry.at),
    relatedCases: extractList(source, ["relatedCases"]).map((entry) => asPlainObject(entry) ?? {}).filter((entry) => entry.caseId),
    evidenceRefs: asPlainObject(source.evidenceRefs),
    raw: input
  };
}

function normalizeRunTimelineEntry(input) {
  const source = asPlainObject(input) ?? {};
  return {
    eventId: pickFirstString(source.eventId, source.id),
    eventType: pickFirstString(source.eventType, source.type, "run.event"),
    occurredAt: pickFirstString(source.occurredAt, source.at, source.createdAt),
    label: pickFirstString(source.label, source.eventType, source.type, "Run event"),
    summary: pickFirstString(source.summary, source.message, source.note),
    status: pickFirstString(source.status),
    category: pickFirstString(source.category, "run"),
    refs: asPlainObject(source.refs),
    raw: input
  };
}

function normalizeRunDetailRecord(input) {
  const source = asPlainObject(input) ?? {};
  const run = asPlainObject(source.run);
  const settlementPacket = asPlainObject(source.settlement);
  const settlement = asPlainObject(settlementPacket?.settlement);
  const agreementPacket = asPlainObject(source.agreement);
  const arbitration = asPlainObject(source.arbitration);
  const issues = extractList(source, ["issues"]).map((entry) => normalizeReceiptDetailIssue(entry)).filter((entry) => entry.code);
  const timeline = extractList(source, ["timeline"]).map((entry) => normalizeRunTimelineEntry(entry)).filter((entry) => entry.eventId);
  return {
    schemaVersion: pickFirstString(source.schemaVersion),
    runId: pickFirstString(source.runId, run?.runId),
    integrityStatus: pickFirstString(source.integrityStatus, issues.length ? "attention_required" : "verified"),
    issues,
    run,
    events: extractList(source, ["events"]),
    verification: asPlainObject(source.verification),
    taskWallet: asPlainObject(source.taskWallet),
    latestUserResponse: asPlainObject(source.latestUserResponse),
    managedExecution: asPlainObject(source.managedExecution),
    linkedTask: asPlainObject(source.linkedTask),
    agreement: agreementPacket,
    settlement: settlementPacket,
    settlementRecord: settlement,
    settlementReceipt: asPlainObject(settlementPacket?.settlementReceipt),
    decisionRecord: asPlainObject(settlementPacket?.decisionRecord),
    arbitration: arbitration ?? { caseCount: 0, openCaseCount: 0, cases: [] },
    timeline,
    raw: input
  };
}

function normalizeLaunchStatusTaskRecord(input) {
  const source = asPlainObject(input) ?? {};
  const run = asPlainObject(source.run);
  const phase1Contract = extractPhase1LaunchContractFromMetadata(source.rfq);
  const phase1CompletionState = extractPhase1CompletionStateFromRunRecord(run);
  const actionRequired = normalizeRunActionRequiredRecord(run);
  return {
    taskId: pickFirstString(source.taskId),
    taskIndex: pickFirstNumber(source.taskIndex),
    title: pickFirstString(source.title, source.taskId, "Untitled task"),
    requiredCapability: pickFirstString(source.requiredCapability),
    state: pickFirstString(source.state, "unknown"),
    rfqId: pickFirstString(source.rfqId),
    rfqStatus: pickFirstString(source.rfqStatus),
    bidCount: pickFirstNumber(source.bidCount, 0),
    candidateCount: pickFirstNumber(source.candidateCount, 0),
    runId: pickFirstString(source.runId, run?.runId),
    runStatus: pickFirstString(run?.status),
    runUpdatedAt: pickFirstString(run?.updatedAt, run?.createdAt),
    runActionRequiredCode: pickFirstString(actionRequired?.code),
    runActionRequiredTitle: pickFirstString(actionRequired?.title),
    runActionRequiredDetail: pickFirstString(actionRequired?.detail),
    runActionRequiredRequestedAt: pickFirstString(actionRequired?.requestedAt),
    runActionRequiredFields: normalizeStringArray(actionRequired?.requestedFields),
    runActionRequiredEvidenceKinds: normalizeStringArray(actionRequired?.requestedEvidenceKinds),
    settlementStatus: pickFirstString(source.settlementStatus),
    disputeStatus: pickFirstString(source.disputeStatus),
    phase1CategoryId: pickFirstString(phase1Contract?.categoryId),
    phase1CategoryLabel: pickFirstString(phase1Contract?.categoryLabel),
    phase1CompletionState,
    phase1CompletionStateStatus: computePhase1CompletionStateStatus(phase1Contract, phase1CompletionState),
    blockedByTaskIds: normalizeStringArray(source.blockedByTaskIds),
    dependsOnTaskIds: normalizeStringArray(source.dependsOnTaskIds),
    raw: input
  };
}

function normalizeRunActionRequiredRecord(run) {
  const source = asPlainObject(run?.actionRequired);
  if (!source) return null;
  const code = pickFirstString(source.code);
  if (!code) return null;
  return {
    code: code.toLowerCase(),
    title: pickFirstString(source.title),
    detail: pickFirstString(source.detail),
    requestedAt: pickFirstString(source.requestedAt),
    requestedFields: normalizeStringArray(source.requestedFields),
    requestedEvidenceKinds: normalizeStringArray(source.requestedEvidenceKinds)
  };
}

function normalizeLaunchStatusRecord(input) {
  const source = asPlainObject(input) ?? {};
  const launchRef = asPlainObject(source.launchRef);
  const summary = asPlainObject(source.summary);
  const tasks = extractList(source, ["tasks"])
    .map((entry) => normalizeLaunchStatusTaskRecord(entry))
    .filter((entry) => entry.taskId)
    .sort((left, right) => {
      const leftIndex = Number.isFinite(left.taskIndex) ? left.taskIndex : Number.MAX_SAFE_INTEGER;
      const rightIndex = Number.isFinite(right.taskIndex) ? right.taskIndex : Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return String(left.taskId ?? "").localeCompare(String(right.taskId ?? ""));
    });
  return {
    launchId: pickFirstString(launchRef?.launchId),
    launchHash: pickFirstString(launchRef?.launchHash),
    planId: pickFirstString(launchRef?.planId),
    posterAgentId: pickFirstString(source.posterAgentId),
    generatedAt: pickFirstString(source.generatedAt),
    summary: {
      openCount: pickFirstNumber(summary?.openCount, 0),
      readyCount: pickFirstNumber(summary?.readyCount, 0),
      blockedCount: pickFirstNumber(summary?.blockedCount, 0),
      assignedCount: pickFirstNumber(summary?.assignedCount, 0),
      closedCount: pickFirstNumber(summary?.closedCount, 0),
      cancelledCount: pickFirstNumber(summary?.cancelledCount, 0),
      settlementLockedCount: pickFirstNumber(summary?.settlementLockedCount, 0),
      settlementReleasedCount: pickFirstNumber(summary?.settlementReleasedCount, 0),
      disputeOpenCount: pickFirstNumber(summary?.disputeOpenCount, 0)
    },
    tasks,
    raw: input
  };
}

function isLaunchTaskActionRequired(task) {
  return (
    LAUNCH_TASK_ACTION_REQUIRED_STATES.has(String(task?.state ?? "").trim().toLowerCase()) ||
    String(task?.runStatus ?? "").trim().toLowerCase() === "failed" ||
    String(task?.runActionRequiredCode ?? "").trim() !== ""
  );
}

function isLaunchTaskActive(task) {
  const normalizedState = String(task?.state ?? "").trim().toLowerCase();
  const normalizedRunStatus = String(task?.runStatus ?? "").trim().toLowerCase();
  return LAUNCH_TASK_ACTIVE_STATES.has(normalizedState) || normalizedRunStatus === "working";
}

function describeLaunchTaskState(task) {
  const normalizedState = String(task?.state ?? "").trim().toLowerCase();
  if (String(task?.runActionRequiredCode ?? "").trim()) {
    return describeRunActionRequired(task);
  }
  if (normalizedState === "assigned") return "A specialist is currently executing this task.";
  if (normalizedState === "open_ready") return "The work is ready to award as soon as the network selects a bid.";
  if (normalizedState === "open_no_bids") return "The network is still waiting for a matching specialist bid.";
  if (normalizedState === "blocked_dependencies_pending") return "This task is paused until an upstream step completes.";
  if (normalizedState === "blocked_dependency_cancelled") return "An upstream dependency was cancelled, so this task needs manual intervention.";
  if (normalizedState === "blocked_dependency_missing") return "A required upstream dependency is missing from the launch graph.";
  if (normalizedState === "cancelled") return "The task was cancelled before it could complete.";
  if (String(task?.runStatus ?? "").trim().toLowerCase() === "failed") return "Execution failed after the task was assigned.";
  if (normalizedState === "closed") return "The task completed and its launch branch is closed.";
  return "This task is still being tracked by the managed network.";
}

function describeRunActionRequired(task) {
  const code = String(task?.runActionRequiredCode ?? "").trim().toLowerCase();
  const detail = String(task?.runActionRequiredDetail ?? "").trim();
  if (detail) return detail;
  const requestedFields = normalizeStringArray(task?.runActionRequiredFields);
  const requestedEvidenceKinds = normalizeStringArray(task?.runActionRequiredEvidenceKinds);
  if (requestedFields.length > 0 || requestedEvidenceKinds.length > 0) {
    const parts = [];
    if (requestedFields.length > 0) parts.push(`fields: ${requestedFields.join(", ")}`);
    if (requestedEvidenceKinds.length > 0) parts.push(`evidence: ${requestedEvidenceKinds.join(", ")}`);
    return `This run is paused until you provide ${parts.join(" and ")}.`;
  }
  return RUN_ACTION_REQUIRED_MESSAGES[code] ?? "This run is paused until you provide more information.";
}

function buildLaunchTaskHref(_launchId, task) {
  if (String(task?.runId ?? "").trim()) return `/runs/${encodeURIComponent(task.runId)}`;
  return "/inbox";
}

function buildInboxActionItems({ pendingItems = [], openDisputes = [], launchStatus = null } = {}) {
  const launchTasks = Array.isArray(launchStatus?.tasks) ? launchStatus.tasks : [];
  const informationRequiredTasks = launchTasks.filter((task) => {
    if (!String(task?.runId ?? "").trim()) return false;
    if (String(task?.runActionRequiredCode ?? "").trim()) return true;
    return (
      String(task?.phase1CompletionStateStatus ?? "").trim().toLowerCase() === "unresolved" &&
      isPhase1UserInputRequiredCompletionState(task?.phase1CompletionState)
    );
  });
  const informationTaskIds = new Set(informationRequiredTasks.map((task) => `${task.taskId}:${task.runId}`));
  const launchAttentionTasks = launchTasks.filter((task) => isLaunchTaskActionRequired(task));
  return [
    ...(Array.isArray(pendingItems) ? pendingItems : []).map((item) => ({
      id: `approval:${item.requestId}`,
      kind: "approval",
      requestId: item.requestId,
      title: item.title || "Approval required",
      summary:
        item.description ||
        `${item.requestedBy ? `${item.requestedBy} is requesting ` : "The network is requesting "}${item.capabilitiesRequested.length ? item.capabilitiesRequested.slice(0, 2).join(", ") : "bounded authority"}.`,
      status: item.status || "pending",
      occurredAt: item.requestedAt,
      href: `/approvals?requestId=${encodeURIComponent(item.requestId)}`,
      cta: "Review approval",
      meta: [
        item.amountCents !== null && item.amountCents !== undefined ? formatCurrency(item.amountCents, item.currency) : null,
        item.riskClass ? `Risk ${humanizeLabel(item.riskClass)}` : null,
        item.reversibilityClass ? `Reversibility ${humanizeLabel(item.reversibilityClass)}` : null
      ].filter(Boolean)
    })),
    ...(Array.isArray(informationRequiredTasks) ? informationRequiredTasks : []).map((task) => ({
      id: `information:${task.runId}`,
      kind: "information",
      launchId: launchStatus?.launchId ?? null,
      runId: task.runId ?? null,
      taskId: task.taskId ?? null,
      title: `${task.title || task.phase1CategoryLabel || "Run"} needs your input`,
      summary: String(task?.runActionRequiredCode ?? "").trim() ? describeRunActionRequired(task) : describePhase1UserInputRequiredState(task),
      status: task.runActionRequiredCode || task.phase1CompletionState || task.runStatus || "needs_input",
      occurredAt: task.runActionRequiredRequestedAt || task.runUpdatedAt || launchStatus?.generatedAt,
      href: buildLaunchTaskHref(launchStatus?.launchId, task),
      cta: "Review next step",
      meta: [
        task.phase1CategoryLabel ? task.phase1CategoryLabel : null,
        task.runActionRequiredCode ? humanizeLabel(task.runActionRequiredCode) : task.phase1CompletionState ? humanizeLabel(task.phase1CompletionState) : null
      ].filter(Boolean)
    })),
    ...(Array.isArray(launchAttentionTasks) ? launchAttentionTasks : []).map((task) => ({
      id: `launch:${launchStatus?.launchId}:${task.taskId}`,
      kind: "launch",
      launchId: launchStatus?.launchId ?? null,
      runId: task.runId ?? null,
      taskId: task.taskId ?? null,
      title: task.title,
      summary: describeLaunchTaskState(task),
      status: task.runStatus || task.state,
      occurredAt: launchStatus?.generatedAt,
      href: buildLaunchTaskHref(launchStatus?.launchId, task),
      cta: task.runId ? "Inspect execution" : "Review task state",
      meta: [
        task.requiredCapability ? humanizeLabel(task.requiredCapability) : null,
        task.bidCount !== null ? `${task.bidCount} bid${task.bidCount === 1 ? "" : "s"}` : null,
        task.blockedByTaskIds.length ? `Blocked by ${task.blockedByTaskIds.join(", ")}` : null
      ].filter(Boolean)
    })).filter((item) => !informationTaskIds.has(`${item.taskId}:${item.runId}`)),
    ...(Array.isArray(openDisputes) ? openDisputes : []).map((item) => ({
      id: `dispute:${item.disputeId}`,
      kind: "dispute",
      title: item.disputeContext?.reason ? `Dispute: ${item.disputeContext.reason}` : `Dispute ${item.disputeId}`,
      summary: `Settlement ${titleCaseState(item.settlementStatus)} is currently under review${item.counterpartyAgentId ? ` with ${item.counterpartyAgentId}` : ""}.`,
      status: item.latestCaseStatus || item.disputeStatus,
      occurredAt: item.latestCaseUpdatedAt || item.disputeOpenedAt,
      href: `/disputes?selectedDisputeId=${encodeURIComponent(item.disputeId)}`,
      cta: "Open dispute",
      meta: [
        item.runId ? `Run ${item.runId}` : null,
        item.amountCents !== null && item.amountCents !== undefined ? formatCurrency(item.amountCents, item.currency) : null,
        item.openCaseCount ? `${item.openCaseCount} open case${item.openCaseCount === 1 ? "" : "s"}` : null
      ].filter(Boolean)
    }))
  ].sort((left, right) => {
    const priority = { approval: 0, information: 1, launch: 2, dispute: 3 };
    const leftPriority = priority[left.kind] ?? 9;
    const rightPriority = priority[right.kind] ?? 9;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    const rightMs = Date.parse(right.occurredAt || "");
    const leftMs = Date.parse(left.occurredAt || "");
    return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
  });
}

function buildInboxReceiptItems(receipts = []) {
  return (Array.isArray(receipts) ? receipts : [])
    .map((receipt) => ({
      id: `receipt:${receipt.receiptId}`,
      kind: "receipt",
      receiptId: receipt.receiptId,
      title: receipt.receiptId || "Completion receipt",
      summary:
        `${receipt.workOrderId ? `Work order ${receipt.workOrderId}` : "Completion receipt"}${receipt.deliveredAt ? ` delivered ${formatDateTime(receipt.deliveredAt)}` : ""}.`,
      status: receipt.status || "success",
      occurredAt: receipt.deliveredAt,
      href: `/receipts?selectedReceiptId=${encodeURIComponent(receipt.receiptId)}`,
      cta: "Open receipt",
      meta: [
        receipt.principalAgentId ? `Principal ${receipt.principalAgentId}` : null,
        receipt.subAgentId ? `Worker ${receipt.subAgentId}` : null,
        receipt.amountCents !== null && receipt.amountCents !== undefined ? formatCurrency(receipt.amountCents, receipt.currency) : null
      ].filter(Boolean)
    }))
    .sort((left, right) => {
      const rightMs = Date.parse(right.occurredAt || "");
      const leftMs = Date.parse(left.occurredAt || "");
      return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
    });
}

function buildInboxProductNotificationPayload(item) {
  const kind = String(item?.kind ?? "").trim().toLowerCase();
  if (kind === "approval" && String(item?.requestId ?? "").trim()) {
    return {
      eventType: "approval.required",
      title: item.title || "Approval required",
      detail: item.summary || "A Nooterra approval request is waiting for review.",
      deepLinkPath: `/approvals?requestId=${encodeURIComponent(String(item.requestId).trim())}`,
      itemRef: {
        requestId: String(item.requestId).trim()
      }
    };
  }
  if (kind === "information" && String(item?.runId ?? "").trim()) {
    return {
      eventType: "information.required",
      title: item.title || "Information required",
      detail: item.summary || "Nooterra needs more information from you before the network can continue this run.",
      deepLinkPath: `/runs/${encodeURIComponent(String(item.runId).trim())}`,
      itemRef: {
        runId: String(item.runId).trim()
      }
    };
  }
  if (kind === "receipt" && String(item?.receiptId ?? "").trim()) {
    return {
      eventType: "receipt.ready",
      title: item.title || "Receipt ready",
      detail: item.summary || "A Nooterra completion receipt is ready for review.",
      deepLinkPath: `/receipts?selectedReceiptId=${encodeURIComponent(String(item.receiptId).trim())}`,
      itemRef: {
        receiptId: String(item.receiptId).trim()
      }
    };
  }
  if (kind === "launch" && String(item?.runId ?? "").trim()) {
    return {
      eventType: "run.update",
      title: item.title || "Run update",
      detail: item.summary || "A Nooterra run changed state and needs review.",
      deepLinkPath: `/runs/${encodeURIComponent(String(item.runId).trim())}`,
      itemRef: {
        runId: String(item.runId).trim()
      }
    };
  }
  if (kind === "dispute" && String(item?.disputeId ?? "").trim()) {
    const disputeId = String(item.disputeId).trim();
    const caseId = String(item?.caseId ?? "").trim();
    return {
      eventType: "dispute.update",
      title: item.title || "Dispute update",
      detail: item.summary || "A dispute changed state and is ready to review.",
      deepLinkPath: caseId
        ? `/disputes?selectedDisputeId=${encodeURIComponent(disputeId)}&caseId=${encodeURIComponent(caseId)}`
        : `/disputes?selectedDisputeId=${encodeURIComponent(disputeId)}`,
      itemRef: {
        disputeId,
        ...(String(item?.runId ?? "").trim() ? { runId: String(item.runId).trim() } : {}),
        ...(caseId ? { caseId } : {})
      }
    };
  }
  return null;
}

function StatusPill({ value }) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const tone = statusToneMap[normalized] ?? "neutral";
  return <span className={`product-status-pill tone-${tone}`}>{titleCaseState(normalized || "unknown")}</span>;
}

function CodeBlock({ title, code, hint = null }) {
  return (
    <article className="product-code-card">
      <div className="product-code-head">
        <div>
          <p>{title}</p>
          {hint ? <span>{hint}</span> : null}
        </div>
      </div>
      <pre><code>{code}</code></pre>
    </article>
  );
}

function RuntimeBar({ config, setConfig, onboardingState }) {
  const buyer = onboardingState?.buyer ?? null;
  const runtimeKeyId = onboardingState?.bootstrap?.bootstrap?.apiKey?.keyId ?? null;
  return (
    <section className="product-runtime">
      <div className="product-runtime-copy">
        <p>Runtime Control</p>
        <h2>Point the product shell at your live kernel.</h2>
        <span>Use onboarding for managed bootstrap, then override any field manually when you need a custom runtime.</span>
      </div>
      <div className="product-runtime-grid">
        <label>
          <span>API base URL</span>
          <input
            value={config.baseUrl}
            onChange={(event) => setConfig((previous) => ({ ...previous, baseUrl: event.target.value }))}
            placeholder="/__nooterra or https://api.nooterra.ai"
          />
        </label>
        <label>
          <span>Auth base URL</span>
          <input
            value={config.authBaseUrl}
            onChange={(event) => setConfig((previous) => ({ ...previous, authBaseUrl: event.target.value }))}
            placeholder="/__magic or https://auth.nooterra.ai"
          />
        </label>
        <label>
          <span>Tenant</span>
          <input
            value={config.tenantId}
            onChange={(event) => setConfig((previous) => ({ ...previous, tenantId: event.target.value }))}
            placeholder="tenant_default"
          />
        </label>
        <label>
          <span>Protocol</span>
          <input
            value={config.protocol}
            onChange={(event) => setConfig((previous) => ({ ...previous, protocol: event.target.value }))}
            placeholder="1.0"
          />
        </label>
        <label>
          <span>Bearer API key</span>
          <input
            value={config.apiKey}
            onChange={(event) => setConfig((previous) => ({ ...previous, apiKey: event.target.value }))}
            placeholder="sk_test_..."
          />
        </label>
      </div>
      <div className="product-inline-meta">
        <span>{buyer ? `Signed in as ${buyer.email}` : "Guest mode"}</span>
        <span>{runtimeKeyId ? `Bootstrap key ${runtimeKeyId}` : "Manual runtime"}</span>
        <a href="/onboarding">{buyer ? "Manage onboarding" : "Start onboarding"}</a>
      </div>
    </section>
  );
}

function InstallTabs({ runtime, onboardingState, agentId = "host_action_wallet", showResolvedConfig = false }) {
  const bootstrapBundle = onboardingState?.bootstrap ?? null;
  const resolvedMcpConfig = bootstrapBundle?.mcpConfigJson ? prettyJson(bootstrapBundle.mcpConfigJson) : null;
  const publicMcpConfig = `{
  "mcpServers": {
    "nooterra": {
      "command": "npx",
      "args": ["-y", "--package", "nooterra", "nooterra-mcp"]
    }
  }
}`;
  const cliSnippet = `npx nooterra setup
nooterra login
# Optional host identifier: ${agentId}`;
  const openClawSnippet = `${bootstrapBundle?.bootstrap?.exportCommands ?? "# Runtime bootstrap not issued yet"}

# Use the same runtime values when packaging the OpenClaw launch adapter.`;
  const apiSnippet = `const runtime = {
  baseUrl: process.env.NOOTERRA_BASE_URL,
  tenantId: process.env.NOOTERRA_TENANT_ID,
  protocol: "1.0",
  apiKey: process.env.NOOTERRA_API_KEY
};

// Create action intents, request hosted approvals,
// and fetch execution receipts from your host runtime.`;

  const installMethods = [
    {
      value: "mcp",
      label: "Claude MCP",
      title: "Connect Claude",
      body: "Use the MCP server for the primary launch channel and route approvals back through hosted approval pages.",
      code: showResolvedConfig && resolvedMcpConfig ? resolvedMcpConfig : publicMcpConfig
    },
    {
      value: "openclaw",
      label: "OpenClaw",
      title: "Package OpenClaw",
      body: "Reuse the same runtime credentials and hosted approval flow for the second launch channel.",
      code: openClawSnippet
    },
    {
      value: "cli",
      label: "CLI",
      title: "Set up locally",
      body: "Best for engineers validating the host pack, smoke flows, and staged installs.",
      code: cliSnippet
    },
    {
      value: "api",
      label: "Codex / API",
      title: "Run through Codex or code",
      body: "Use the public API when you want to create intents, request hosted approvals, and fetch receipts from Codex, custom shells, or application code.",
      code: apiSnippet
    }
  ];

  return (
    <Tabs.Root className="product-tabs" defaultValue="mcp">
      <Tabs.List className="product-tab-list" aria-label="Install methods">
        {installMethods.map((method) => (
          <Tabs.Trigger key={method.value} className="product-tab-trigger" value={method.value}>
            {method.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {installMethods.map((method) => (
        <Tabs.Content key={method.value} className="product-tab-content" value={method.value}>
          <div className="product-tab-copy">
            <strong>{method.title}</strong>
            <span>{method.body}</span>
          </div>
          <CodeBlock title={method.title} code={method.code} hint={method.body} />
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

function HomePage({ lastAgentId, onboardingState }) {
  const buyer = onboardingState?.buyer ?? null;
  const primaryHref = buyer ? "/wallet" : "/onboarding";
  const primaryLabel = buyer ? "Open Action Wallet" : "Set up Action Wallet";
  const secondaryHref = buyer ? "/approvals" : "/developers";
  const secondaryLabel = buyer ? "Review approvals" : "Open developer toolkit";
  return (
    <div className="product-page">
      <section className="product-home-hero-shell">
        <div className="product-home-command">
          <div className="product-home-command-lines" aria-hidden="true">
            <span />
            <span />
          </div>
          <div className="product-home-command-copy">
            <p className="product-kicker">Delegated Authority Infrastructure</p>
            <h1>Let AI act. Keep control.</h1>
            <p className="product-lead">
              Nooterra is the host-first authority layer for consequential AI actions. Policy decides what may happen, humans step in only when needed, and every approved action ends with proof.
            </p>
            <div className="product-hero-actions">
              <a className="product-button product-button-solid" href={primaryHref}>{primaryLabel}</a>
              <a className="product-button product-button-ghost" href={secondaryHref}>{secondaryLabel}</a>
            </div>
            <div className="product-badge-row">
              <span className="product-badge">Claude MCP</span>
              <span className="product-badge">OpenClaw</span>
              <span className="product-badge">Hosted approvals</span>
              <span className="product-badge">Scoped grants</span>
              <span className="product-badge">Receipts + disputes</span>
            </div>
          </div>
          <div className="product-home-command-stage">
            <div className="product-home-stage-card product-home-stage-card-main">
              <span>Action Wallet v1</span>
              <strong>Approve consequential actions before anything external happens.</strong>
              <p>One authority contract from decision to receipt.</p>
            </div>
            <div className="product-home-stage-card">
              <span>Decision</span>
              <strong>Green · Yellow · Red</strong>
              <p>Safe actions flow, risky actions escalate, out-of-policy actions stop.</p>
            </div>
            <div className="product-home-stage-card">
              <span>Boundaries</span>
              <strong>Time · Capability · Spend</strong>
              <p>Authority grants stay explicit, reviewable, and small.</p>
            </div>
          </div>
        </div>

        <div className="product-home-proofband">
          {homeTrustRail.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className="product-home-proofband-item">
                <div className="product-mini-card-head">
                  <Icon size={18} />
                  <span>{item.title}</span>
                </div>
                <p>{item.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="product-home-manifesto">
        <article className="product-card product-home-manifesto-copy">
          <div className="product-section-head compact">
            <p>Why This Exists</p>
            <h2>The model is not the product. The decision is.</h2>
          </div>
          <p className="product-lead">
            Enterprises do not need another chat box. They need a system that decides what an AI operator may do, under what conditions, with what approvals, and how the action can be challenged later.
          </p>
          <div className="product-inline-note accent">
            Nooterra is not the agent and not the payment rail. It is the control layer between intent and action.
          </div>
        </article>

        <div className="product-home-principles">
          {homePrinciples.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className="product-card product-home-principle-card">
                <div className="product-mini-card-head">
                  <Icon size={18} />
                  <span>{item.title}</span>
                </div>
                <p>{item.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="product-section">
        <div className="product-section-head">
          <p>How It Works</p>
          <h2>One clean path from intent to proof.</h2>
        </div>
        <div className="product-home-sequence">
          {homeSequence.map((item) => (
            <article key={item.label} className="product-home-sequence-step">
              <span>{item.label}</span>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="product-section">
        <div className="product-section-head">
          <p>Product Surfaces</p>
          <h2>Small product. Sharp boundaries.</h2>
        </div>
        <div className="product-home-surface-grid">
          {homeSurfaces.map((section) => (
            <a key={section.title} className="product-home-surface-card" href={`/${section.title.toLowerCase() === "wallet" ? "wallet" : section.title.toLowerCase()}`}>
              <strong>{section.title}</strong>
              <span>{section.body}</span>
              <ArrowUpRight size={16} />
            </a>
          ))}
        </div>
      </section>

      <section className="product-home-boundary">
        <article className="product-card product-home-boundary-panel">
          <div className="product-section-head compact">
            <p>Now Shipping</p>
            <h2>Two actions. Two channels. Nothing fuzzy.</h2>
          </div>
          <div className="product-bullet-grid">
            {launchActionCards.map((item) => (
              <div key={item.title} className="product-bullet-card">
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </div>
            ))}
            {launchChannelCards.map((item) => (
              <div key={item.title} className="product-bullet-card">
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="product-card product-home-boundary-panel">
          <div className="product-section-head compact">
            <p>Not Now</p>
            <h2>We are not pretending to be a bigger product than we are.</h2>
          </div>
          <div className="product-badge-row">
            {launchNonGoals.map((item) => (
              <span key={item} className="product-badge product-badge-muted">{item}</span>
            ))}
          </div>
          <div className="product-inline-note warn">
            Unsupported requests stay out of the launch shell and fail closed. Action Wallet v1 only supports buy plus cancel / recover flows with clear spend, approval, and proof requirements.
          </div>
        </article>
      </section>

      <section className="product-card product-home-install-card">
        <div className="product-home-install-head">
          <div className="product-section-head">
            <p>Install</p>
            <h2>Install it where the action already starts.</h2>
          </div>
          <p className="product-lead">
            The host stays primary. Nooterra adds authority, proof, and recourse at the point where the action becomes real.
          </p>
        </div>
        <InstallTabs onboardingState={onboardingState} agentId={lastAgentId || "host_action_wallet"} />
      </section>
    </div>
  );
}

function LaunchScopePage({ requestedPath, onboardingState }) {
  const primaryHref = onboardingState?.buyer ? "/approvals" : "/onboarding";
  const primaryLabel = onboardingState?.buyer ? "Open approvals" : "Complete onboarding";
  return (
    <div className="product-page">
      <section className="product-page-top">
        <div>
          <p className="product-kicker">Action Wallet v1</p>
          <h1>This route is outside the production shell.</h1>
          <p className="product-lead">
            You opened {describeLegacySurface(requestedPath)}. Action Wallet v1 is intentionally limited to approvals,
            wallet state, receipts, disputes, integrations, and developer tooling.
          </p>
        </div>
        <div className="product-page-top-actions">
          <a className="product-button product-button-solid" href={primaryHref}>{primaryLabel}</a>
          <a className="product-button product-button-ghost" href="/wallet">Open wallet</a>
        </div>
      </section>

      <div className="product-inline-note warn">
        Unsupported routes stay out of the production shell and fail closed instead of silently dropping users into older prototype surfaces.
      </div>

      <section className="product-grid-two">
        <article className="product-card" id="runtime-bootstrap">
          <div className="product-section-head compact">
            <p>Supported surfaces</p>
            <h2>Use the launch-safe pages that are part of the v1 contract.</h2>
          </div>
          <div className="product-access-grid">
            {[
              {
                href: "/approvals",
                title: "Approvals",
                body: "Review human decisions and manage standing policy boundaries."
              },
              {
                href: "/wallet",
                title: "Wallet",
                body: "Inspect scoped grants, sessions, connectors, and live workspace state."
              },
              {
                href: "/receipts",
                title: "Receipts",
                body: "Inspect proof, settlement references, and final completion artifacts."
              },
              {
                href: "/disputes",
                title: "Disputes",
                body: "Open recourse, add evidence, and track arbitration state."
              },
              {
                href: "/integrations",
                title: "Integrations",
                body: "Connect the host-side systems and browser state the wallet needs."
              },
              {
                href: "/developers",
                title: "Developers",
                body: "Get the API, SDK, CLI, and host-pack entry points for the v1 wedge."
              }
            ].map((surface) => (
              <a key={surface.href} className="product-access-card" href={surface.href}>
                <h3>{surface.title}</h3>
                <p>{surface.body}</p>
              </a>
            ))}
          </div>
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Requested route</p>
            <h2>Keep the legacy footprint explicit while the v1 shell stays narrow.</h2>
          </div>
          <div className="product-badge-row">
            <span className="product-badge">{requestedPath || "unknown route"}</span>
            <span className="product-badge product-badge-muted">legacy</span>
            <span className="product-badge product-badge-muted">out of scope</span>
          </div>
          <p className="product-lead" style={{ margin: "0.75rem 0 0" }}>
            {Object.keys(LEGACY_PROTOTYPE_COMPONENTS).length} legacy prototype surfaces are still gated in the repo.
            If this one needs to return later, it should come back as a deliberate post-v1 product decision rather than an accidental carry-over from earlier prototypes.
          </p>
        </article>
      </section>
    </div>
  );
}

function LaunchTaskCard({ task }) {
  const taskWallet = asPlainObject(task?.rfq?.metadata?.routerLaunch?.taskWallet);
  const taskWalletSettlement = deriveTaskWalletSettlementScaffold(taskWallet);
  return (
    <article className="product-task-card">
      <div className="product-task-head">
        <div>
          <p>{task.title}</p>
          <h3>{task.requiredCapability}</h3>
        </div>
        <StatusPill value={task.state} />
      </div>
      <div className="product-task-meta">
        <span>RFQ {task.rfqId}</span>
        <span>{task.candidateCount} candidates</span>
        <span>{task.bidCount} bids</span>
        {task.runId ? <span>Run {abbreviateHash(task.runId, 18)}</span> : null}
      </div>
      <div className="product-task-points">
        {task.rfq?.budgetCents ? <span>Budget {formatCurrency(task.rfq.budgetCents, task.rfq.currency)}</span> : null}
        {task.acceptedBid ? (
          <span>Accepted {formatCurrency(task.acceptedBid.amountCents, task.acceptedBid.currency)} by {task.acceptedBid.bidderAgentId}</span>
        ) : null}
        {task.settlementStatus ? <span>Settlement {titleCaseState(task.settlementStatus)}</span> : null}
      </div>
      {taskWallet ? (
        <div className="product-wallet-inline">
          <strong>Action Wallet</strong>
          <span>
            {taskWallet.reviewMode ? humanizeLabel(taskWallet.reviewMode, taskWallet.reviewMode) : "bounded"} ·{" "}
            {Number.isFinite(Number(taskWallet.maxSpendCents))
              ? formatCurrency(taskWallet.maxSpendCents, taskWallet.currency)
              : "no direct spend"}
          </span>
          {Array.isArray(taskWallet.allowedSpecialistProfileIds) && taskWallet.allowedSpecialistProfileIds.length > 0 ? (
            <span>Execution profiles: {taskWallet.allowedSpecialistProfileIds.join(", ")}</span>
          ) : null}
          {taskWalletSettlement ? (
            <span>Settlement: {humanizeLabel(taskWalletSettlement.platformSettlementRail)}</span>
          ) : null}
        </div>
      ) : null}
      {Array.isArray(task.blockedByTaskIds) && task.blockedByTaskIds.length > 0 ? (
        <div className="product-inline-note bad">Blocked by {task.blockedByTaskIds.join(", ")}</div>
      ) : null}
      {task.runId ? (
        <div className="product-actions">
          <a className="product-button product-button-solid" href={`/runs/${encodeURIComponent(task.runId)}`}>
            Open execution
          </a>
          <a className="product-button product-button-ghost" href={`/disputes?runId=${encodeURIComponent(task.runId)}`}>
            Open dispute state
          </a>
        </div>
      ) : null}
      <div className="product-bid-list">
        {(task.bids ?? []).slice(0, 4).map((bid) => (
          <div key={bid.bidId} className="product-bid-row">
            <div>
              <strong>{bid.bidderAgentId}</strong>
              <span>{bid.bidId}</span>
            </div>
            <div>
              <span>{formatCurrency(bid.amountCents, bid.currency)}</span>
              <span>{formatEtaSeconds(bid.etaSeconds)}</span>
              <StatusPill value={bid.status ?? "pending"} />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function ManagedCoveragePanel({
  metadata,
  compact = false,
  title = "Managed network contract",
  subtitle = "Which Phase 1 task families this worker can take, and the proof it promises to return."
}) {
  const managed = extractPhase1ManagedNetworkMetadata(metadata);
  if (!managed) return null;
  const families = managed.families;
  const proofCoverage = managed.proofCoverage;
  const executionAdapter = asPlainObject(managed.executionAdapter);
  const sessionModes = normalizeStringArray(executionAdapter?.supportedSessionModes);
  const requiredRunFields = normalizeStringArray(executionAdapter?.requiredRunFields);

  if (compact) {
    const familyTitles = families.map((family) => family?.title).filter(Boolean);
    const primaryProof = proofCoverage[0] ?? null;
    const evidenceLabels = normalizeStringArray(primaryProof?.requiredEvidence).slice(0, 3);
    return (
      <div className="product-managed-contract compact">
        <div className="product-managed-contract-head">
          <strong>{title}</strong>
          {familyTitles.length > 0 ? <span>{familyTitles.join(" · ")}</span> : null}
        </div>
        {primaryProof?.proofSummary ? <p>{primaryProof.proofSummary}</p> : null}
        {executionAdapter?.requiresDelegatedAccountSession ? (
          <div className="product-inline-note accent">
            Uses delegated account sessions for bounded execution.
          </div>
        ) : null}
        {evidenceLabels.length > 0 ? (
          <div className="product-badge-row">
            {evidenceLabels.map((item) => (
              <span key={`${managed.profileId}_${item}`} className="product-badge subtle">
                {humanizeLabel(item)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="product-managed-contract">
      <div className="product-section-head compact">
        <p>Managed Coverage</p>
        <h2>{title}</h2>
      </div>
      <p className="product-managed-contract-copy">{subtitle}</p>
      {executionAdapter ? (
        <div className="product-managed-proof-copy">
          <strong>Execution boundary</strong>
          <span>
            {executionAdapter.requiresDelegatedAccountSession
              ? "Runs inside a delegated account session instead of using raw credentials."
              : "Uses the generic paid-tool execution path."}
          </span>
        </div>
      ) : null}
      {executionAdapter?.merchantScope ? (
        <div className="product-managed-proof-copy">
          <strong>Action Wallet fit</strong>
          <span>
            Merchant scope <code>{executionAdapter.merchantScope}</code> with{" "}
            {executionAdapter.requiresDelegatedAccountSession ? "delegated account session" : "generic paid execution"}.
          </span>
        </div>
      ) : null}
      {sessionModes.length > 0 ? (
        <div className="product-badge-row">
          {sessionModes.map((mode) => (
            <span key={`${managed.profileId}_${mode}`} className="product-badge subtle">
              {humanizeLabel(mode)}
            </span>
          ))}
        </div>
      ) : null}
      {requiredRunFields.length > 0 ? (
        <div className="product-managed-proof-copy">
          <strong>Required account-session fields</strong>
          <span>{requiredRunFields.map((field) => humanizeLabel(field)).join(", ")}</span>
        </div>
      ) : null}
      {executionAdapter?.reviewPolicy ? (
        <div className="product-inline-note accent">{executionAdapter.reviewPolicy}</div>
      ) : null}
      {families.length > 0 ? (
        <div className="product-managed-family-list">
          {families.map((family) => {
            const completionContract = asPlainObject(family?.completionContract);
            const evidenceItems = normalizeStringArray(completionContract?.evidenceRequirements);
            return (
              <article key={`${managed.profileId}_${family?.categoryId}`} className="product-managed-family-card">
                <div className="product-managed-family-head">
                  <strong>{family?.title ?? humanizeLabel(family?.categoryId, "Task family")}</strong>
                  <span>{humanizeLabel(family?.categoryId, "")}</span>
                </div>
                {family?.body ? <p>{family.body}</p> : null}
                {completionContract?.summary ? <div className="product-inline-note accent">{completionContract.summary}</div> : null}
                {completionContract?.proofSummary ? (
                  <div className="product-managed-proof-copy">
                    <strong>Proof returned</strong>
                    <span>{completionContract.proofSummary}</span>
                  </div>
                ) : null}
                {evidenceItems.length > 0 ? (
                  <div className="product-badge-row">
                    {evidenceItems.map((item) => (
                      <span key={`${family?.categoryId}_${item}`} className="product-badge subtle">
                        {humanizeLabel(item)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="product-empty-state">No managed Phase 1 contract is attached to this worker yet.</div>
      )}
    </div>
  );
}

function AgentDiscoveryCard({ result }) {
  const agentCard = result?.agentCard ?? null;
  if (!agentCard) return null;
  const reputation = result?.reputation ?? null;
  const riskTier = reputation?.riskTier ?? result?.riskTier ?? null;
  const riskTone = toneForRiskTier(riskTier);
  const badges = [...(agentCard.capabilities ?? []).slice(0, 3), ...(agentCard.tags ?? []).slice(0, 2)];

  return (
    <article className="product-card product-agent-card">
      <div className="product-task-head">
        <div>
          <p>{agentCard.agentId}</p>
          <h3>{agentCard.displayName ?? agentCard.agentId}</h3>
        </div>
        {riskTier ? <span className={`product-status-pill tone-${riskTone}`}>{titleCaseState(riskTier)}</span> : null}
      </div>
      <p className="product-agent-description">{agentCard.description ?? "No public description yet."}</p>
      {badges.length > 0 ? (
        <div className="product-badge-row">
          {badges.map((badge) => (
            <span key={`${agentCard.agentId}_${badge}`} className="product-badge">{badge}</span>
          ))}
        </div>
      ) : null}
      <ManagedCoveragePanel metadata={agentCard} compact />
      <div className="product-detail-meta">
        <div>
          <strong>Runtime</strong>
          <span>{agentCard.host?.runtime ?? "runtime n/a"}</span>
        </div>
        <div>
          <strong>Endpoint</strong>
          <span>{formatEndpointHost(agentCard.host?.endpoint)}</span>
        </div>
        <div>
          <strong>Price</strong>
          <span>
            {agentCard.priceHint?.amountCents
              ? formatCurrency(agentCard.priceHint.amountCents, agentCard.priceHint.currency)
              : "No public price"}
          </span>
        </div>
        <div>
          <strong>Trust</strong>
          <span>{reputation ? `${reputation.trustScore}/100` : "Not requested"}</span>
        </div>
      </div>
      <div className="product-actions">
        <a className="product-button product-button-solid" href={`/agents/${encodeURIComponent(agentCard.agentId)}`}>
          Open profile
        </a>
        {agentCard.host?.endpoint ? (
          <a className="product-button product-button-ghost" href={agentCard.host.endpoint} target="_blank" rel="noreferrer">
            Open endpoint
          </a>
        ) : null}
      </div>
    </article>
  );
}

function AgentsPage({ runtime }) {
  const [filters, setFilters] = useState({
    capability: "",
    runtime: "",
    minTrustScore: "",
    riskTier: ""
  });
  const [selectedPresetId, setSelectedPresetId] = useState(agentBrowsePresets[0].id);
  const [reloadToken, setReloadToken] = useState(0);
  const [busyState, setBusyState] = useState("loading");
  const [statusMessage, setStatusMessage] = useState("Loading public agents from the network...");
  const [discovery, setDiscovery] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setBusyState("loading");
      try {
        const query = new URLSearchParams({
          visibility: "public",
          status: "active",
          includeReputation: "true",
          reputationVersion: "v2",
          reputationWindow: "30d",
          limit: "24",
          offset: "0"
        });
        if (filters.capability.trim()) query.set("capability", filters.capability.trim());
        if (filters.runtime.trim()) query.set("runtime", filters.runtime.trim());
        if (filters.minTrustScore.trim()) query.set("minTrustScore", filters.minTrustScore.trim());
        if (filters.riskTier.trim()) query.set("riskTier", filters.riskTier.trim());

        const out = await requestJson({
          baseUrl: runtime.baseUrl,
          pathname: `/public/agent-cards/discover?${query.toString()}`,
          method: "GET",
          headers: buildPublicHeaders(runtime)
        });
        if (cancelled) return;
        startTransition(() => {
          setDiscovery(out);
        });
        setStatusMessage(`${out?.total ?? 0} public agent${out?.total === 1 ? "" : "s"} loaded.`);
      } catch (error) {
        if (cancelled) return;
        startTransition(() => {
          setDiscovery(null);
        });
        setStatusMessage(`Agent discovery failed: ${error.message}`);
      } finally {
        if (!cancelled) setBusyState("");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [filters.capability, filters.minTrustScore, filters.riskTier, filters.runtime, reloadToken, runtime]);

  function applyPreset(preset) {
    setSelectedPresetId(preset.id);
    setFilters((previous) => ({
      ...previous,
      capability: preset.capability,
      runtime: preset.runtime
    }));
    setStatusMessage(`${preset.title} selected. Refreshing the public directory.`);
  }

  const results = Array.isArray(discovery?.results) ? discovery.results : [];

  return (
    <div className="product-page">
      <section className="product-page-top">
        <div>
          <p className="product-kicker">Public Directory</p>
          <h1>Browse the public workers already visible on the network.</h1>
          <p className="product-lead">
            Compare live public agents by capability, runtime, and trust before you decide where work should go.
          </p>
        </div>
        <div className="product-page-top-actions">
          <a className="product-button product-button-ghost" href="/network">Ask the Network</a>
          <a className="product-button product-button-ghost" href="/studio">Publish an agent</a>
          <button className="product-button product-button-solid" type="button" disabled={busyState !== ""} onClick={() => setReloadToken((value) => value + 1)}>
            {busyState === "loading" ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Browse Lenses</p>
            <h2>Start from a category instead of an empty filter form.</h2>
          </div>
          <div className="product-option-grid">
            {agentBrowsePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`product-option-card ${selectedPresetId === preset.id ? "active" : ""}`}
                onClick={() => applyPreset(preset)}
              >
                <strong>{preset.title}</strong>
                <span>{preset.body}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Filters</p>
            <h2>Trim the list to the workers you actually want to compare.</h2>
          </div>
          <div className="product-form-grid">
            <label>
              <span>Capability</span>
              <input
                value={filters.capability}
                onChange={(event) => {
                  setSelectedPresetId("");
                  setFilters((previous) => ({ ...previous, capability: event.target.value }));
                }}
                placeholder="capability://code.generation"
              />
            </label>
            <label>
              <span>Runtime</span>
              <input
                value={filters.runtime}
                onChange={(event) => {
                  setSelectedPresetId("");
                  setFilters((previous) => ({ ...previous, runtime: event.target.value }));
                }}
                placeholder="nooterra"
              />
            </label>
            <label>
              <span>Min trust score</span>
              <input
                value={filters.minTrustScore}
                onChange={(event) => setFilters((previous) => ({ ...previous, minTrustScore: event.target.value }))}
                inputMode="numeric"
                placeholder="60"
              />
            </label>
            <label>
              <span>Risk tier</span>
              <select
                value={filters.riskTier}
                onChange={(event) => setFilters((previous) => ({ ...previous, riskTier: event.target.value }))}
              >
                <option value="">any</option>
                <option value="low">low</option>
                <option value="guarded">guarded</option>
                <option value="elevated">elevated</option>
                <option value="high">high</option>
              </select>
            </label>
          </div>
          <div className="product-inline-note">{statusMessage}</div>
        </article>
      </section>

      <section className="product-section">
        <div className="product-section-head">
          <p>Agents</p>
          <h2>Open a profile before you route work.</h2>
        </div>
        {results.length > 0 ? (
          <div className="product-agent-grid">
            {results.map((result) => (
              <AgentDiscoveryCard
                key={result?.agentCard?.agentId ?? `agent_result_${result?.rank ?? createClientId("agent")}`}
                result={result}
              />
            ))}
          </div>
        ) : (
          <div className="product-empty-state">
            {busyState === "loading"
              ? "Loading public agents..."
              : "No public agents matched the current filters. Adjust the filters or refresh to try again."}
          </div>
        )}
      </section>
    </div>
  );
}

function AgentProfilePage({ runtime, agentId }) {
  const [cardBundle, setCardBundle] = useState(null);
  const [publicSummary, setPublicSummary] = useState(null);
  const [statusMessage, setStatusMessage] = useState("Loading public agent profile...");
  const [relationshipNote, setRelationshipNote] = useState("Relationship-level reputation appears here when an agent publishes it.");
  const [copyMessage, setCopyMessage] = useState("");
  const [busyState, setBusyState] = useState("loading");

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;

    async function load() {
      setBusyState("loading");
      try {
        const detail = await requestJson({
          baseUrl: runtime.baseUrl,
          pathname:
            `/public/agent-cards/${encodeURIComponent(agentId)}` +
            "?includeReputation=true&reputationVersion=v2&reputationWindow=30d",
          method: "GET",
          headers: buildPublicHeaders(runtime)
        });
        if (cancelled) return;
        startTransition(() => {
          setCardBundle(detail);
          setPublicSummary(null);
        });
        setStatusMessage(`Public profile loaded for ${detail?.agentCard?.displayName ?? agentId}.`);
        setRelationshipNote("Relationship-level reputation appears here when an agent publishes it.");
      } catch (error) {
        if (cancelled) return;
        startTransition(() => {
          setCardBundle(null);
          setPublicSummary(null);
        });
        setStatusMessage(`Agent profile failed: ${error.message}`);
        setRelationshipNote("Relationship-level reputation appears here when an agent publishes it.");
      } finally {
        if (!cancelled) setBusyState("");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [agentId, runtime]);

  async function handleCopyAgentId() {
    const ok = await copyText(agentId);
    setCopyMessage(ok ? "Agent ID copied." : "Copy failed.");
  }

  const agentCard = cardBundle?.agentCard ?? null;
  const reputation = cardBundle?.reputation ?? null;
  const publicRelationships = Array.isArray(publicSummary?.relationships) ? publicSummary.relationships : [];

  return (
    <div className="product-page">
      <section className="product-page-top">
        <div>
          <p className="product-kicker">Agent Profile</p>
          <h1>{agentCard?.displayName ?? agentId ?? "Public agent"}</h1>
          <p className="product-lead">
            {agentCard?.description ?? "Open a stable public page for one agent before you decide where work should go."}
          </p>
        </div>
        <div className="product-page-top-actions">
          <a className="product-button product-button-ghost" href="/agents">Browse agents</a>
          <button className="product-button product-button-ghost" type="button" onClick={() => void handleCopyAgentId()}>
            Copy agent ID
          </button>
          {agentCard?.host?.endpoint ? (
            <a className="product-button product-button-solid" href={agentCard.host.endpoint} target="_blank" rel="noreferrer">
              Open endpoint
            </a>
          ) : null}
        </div>
      </section>

      <div className="product-inline-note">{statusMessage}</div>
      {copyMessage ? <div className="product-inline-note good">{copyMessage}</div> : null}

      {agentCard ? (
        <>
          <section className="product-detail-layout">
            <article className="product-card">
              <div className="product-section-head compact">
                <p>Overview</p>
                <h2>Public card and runtime details.</h2>
              </div>
              <div className="product-badge-row">
                <span className="product-badge">{agentCard.agentId}</span>
                <span className="product-badge">{agentCard.visibility}</span>
                <span className="product-badge">{agentCard.host?.runtime ?? "runtime n/a"}</span>
                {reputation?.riskTier ? (
                  <span className={`product-status-pill tone-${toneForRiskTier(reputation.riskTier)}`}>
                    {titleCaseState(reputation.riskTier)}
                  </span>
                ) : null}
              </div>
              <div className="product-detail-meta">
                <div>
                  <strong>Trust score</strong>
                  <span>{reputation ? `${reputation.trustScore}/100` : "Not requested"}</span>
                </div>
                <div>
                  <strong>Price</strong>
                  <span>
                    {agentCard.priceHint?.amountCents
                      ? formatCurrency(agentCard.priceHint.amountCents, agentCard.priceHint.currency)
                      : "No public price"}
                  </span>
                </div>
                <div>
                  <strong>Endpoint</strong>
                  <span>{formatEndpointHost(agentCard.host?.endpoint)}</span>
                </div>
                <div>
                  <strong>Updated</strong>
                  <span>{formatDateTime(agentCard.updatedAt)}</span>
                </div>
              </div>
            </article>

            <article className="product-card">
              <div className="product-section-head compact">
                <p>Reputation</p>
                <h2>What the public trust signals say.</h2>
              </div>
              <div className="product-metric-grid">
                <div className="product-metric-card">
                  <span>Trust</span>
                  <strong>{reputation?.trustScore ?? 0}</strong>
                  <small>current discovery score</small>
                </div>
                <div className="product-metric-card">
                  <span>Window</span>
                  <strong>{reputation?.primaryWindow ?? publicSummary?.reputationWindow ?? "30d"}</strong>
                  <small>active public frame</small>
                </div>
                <div className="product-metric-card">
                  <span>Events</span>
                  <strong>{publicSummary?.eventCount ?? 0}</strong>
                  <small>public reputation events</small>
                </div>
                <div className="product-metric-card">
                  <span>Success</span>
                  <strong>{formatPercent(publicSummary?.successRate)}</strong>
                  <small>relationship success rate</small>
                </div>
              </div>
              <div className={`product-inline-note ${publicSummary ? "good" : ""}`}>{relationshipNote}</div>
            </article>
          </section>

          <section className="product-grid-two">
            <article className="product-card">
              <div className="product-section-head compact">
                <p>Capabilities</p>
                <h2>What this agent says it can do.</h2>
              </div>
              {(agentCard.capabilities ?? []).length > 0 ? (
                <div className="product-badge-row">
                  {agentCard.capabilities.map((capability) => (
                    <span key={capability} className="product-badge">{capability}</span>
                  ))}
                </div>
              ) : (
                <div className="product-empty-state">No public capabilities listed.</div>
              )}
              {(agentCard.tags ?? []).length > 0 ? (
                <>
                  <div className="product-section-head compact">
                    <p>Tags</p>
                    <h2>How the publisher grouped this worker.</h2>
                  </div>
                  <div className="product-badge-row">
                    {agentCard.tags.map((tag) => (
                      <span key={tag} className="product-badge">{tag}</span>
                    ))}
                  </div>
                </>
              ) : null}
            </article>

            <article className="product-card">
              <ManagedCoveragePanel metadata={agentCard} />
            </article>

            <article className="product-card">
              <div className="product-section-head compact">
                <p>Relationships</p>
                <h2>Public counterparties, if this agent opted in.</h2>
              </div>
              {publicRelationships.length > 0 ? (
                <div className="product-step-list">
                  {publicRelationships.map((row) => (
                    <div key={row.counterpartyAgentId} className="product-step-item">
                      <div className="product-step-copy">
                        <strong>{row.counterpartyAgentId}</strong>
                        <span>
                          Worked together {row.workedWithCount} times. Success {formatPercent(row.successRate)}. Disputes {formatPercent(row.disputeRate)}.
                        </span>
                      </div>
                      <span className="product-status-pill tone-accent">
                        {row.lastInteractionAt ? formatDateTime(row.lastInteractionAt) : "No recent date"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="product-empty-state">{relationshipNote}</div>
              )}
            </article>
          </section>
        </>
      ) : (
        <div className="product-empty-state">
          {busyState === "loading"
            ? "Loading public agent profile..."
            : "This public agent profile could not be loaded. It may not exist, may not be public, or the agent id may be ambiguous across tenants."}
        </div>
      )}
    </div>
  );
}

function NetworkPage({ runtime, onboardingState, lastAgentId, launchId, onLaunchRecorded, debugMode = false }) {
  const buyer = onboardingState?.buyer ?? null;
  const bootstrapBundle = onboardingState?.bootstrap ?? null;
  const [form, setForm] = useState({
    text: networkTemplates[0].text,
    posterAgentId: "",
    scope: "public",
    budgetCents: networkTemplates[0].budgetCents,
    currency: "USD",
    deadlineAt: "",
    maxCandidates: networkTemplates[0].maxCandidates,
    requireApproval: true
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState(networkTemplates[0].id);
  const [statusMessage, setStatusMessage] = useState("Pick a request template, then plan or dispatch the work.");
  const [busyState, setBusyState] = useState("");
  const [plan, setPlan] = useState(null);
  const [launchResponse, setLaunchResponse] = useState(null);
  const [dispatchResponse, setDispatchResponse] = useState(null);
  const [launchStatus, setLaunchStatus] = useState(null);
  const [pendingApprovalResume, setPendingApprovalResume] = useState(null);
  const [taskWalletApproved, setTaskWalletApproved] = useState(false);
  const [activeLaunchId, setActiveLaunchId] = useState(launchId ?? readStoredValue(LAST_LAUNCH_STORAGE_KEY));
  const deferredLaunchStatus = useDeferredValue(launchStatus);
  const runtimeReady = Boolean(String(runtime.apiKey ?? "").trim());
  const suggestedPosterAgentId = lastAgentId || (buyer?.tenantId ? `agt_${toIdSlug(buyer.tenantId)}_requester` : "");
  const planIssues = Array.isArray(plan?.issues) ? plan.issues : [];
  const blockingPlanIssues = planIssues.filter((issue) => issue?.severity === "blocking");
  const taskWalletPreview = deriveTaskWalletPreview({
    templateId: selectedTemplateId,
    requireApproval: form.requireApproval,
    budgetCents: form.budgetCents,
    currency: form.currency,
    deadlineAt: form.deadlineAt
  });
  const taskWalletSettlementPreview = deriveTaskWalletSettlementScaffold(taskWalletPreview);

  useEffect(() => {
    setTaskWalletApproved(false);
  }, [selectedTemplateId, form.requireApproval, form.budgetCents, form.currency, form.deadlineAt]);

  useEffect(() => {
    if (!launchId) return;
    setActiveLaunchId(launchId);
  }, [launchId]);

  useEffect(() => {
    if (!suggestedPosterAgentId || form.posterAgentId.trim()) return;
    setForm((previous) => ({ ...previous, posterAgentId: suggestedPosterAgentId }));
  }, [form.posterAgentId, suggestedPosterAgentId]);

  useEffect(() => {
    if (!activeLaunchId) return;
    let cancelled = false;

    async function load() {
      try {
        const out = await requestJson({
          baseUrl: runtime.baseUrl,
          pathname: `/router/launches/${encodeURIComponent(activeLaunchId)}/status`,
          method: "GET",
          headers: buildHeaders(runtime)
        });
        if (cancelled) return;
        startTransition(() => {
          setLaunchStatus(out?.status ?? null);
        });
        setStatusMessage(`Launch ${activeLaunchId} loaded from the live kernel.`);
      } catch (error) {
        if (cancelled) return;
        setStatusMessage(`Launch status failed: ${error.message}`);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeLaunchId, runtime]);

  function applyNetworkTemplate(template) {
    setSelectedTemplateId(template.id);
    setForm((previous) => ({
      ...previous,
      text: template.text,
      budgetCents: template.budgetCents,
      maxCandidates: template.maxCandidates,
      posterAgentId: previous.posterAgentId || suggestedPosterAgentId
    }));
    setStatusMessage(`${template.title} template loaded. Adjust the request, then preview the plan.`);
  }

  async function previewPlan() {
    if (!runtimeReady) {
      setStatusMessage("Issue runtime bootstrap on onboarding before planning or dispatching work.");
      return;
    }
    setBusyState("plan");
    setStatusMessage("Planning against the network graph...");
    try {
      const out = await requestJson({
        baseUrl: runtime.baseUrl,
        pathname: "/router/plan",
        method: "POST",
        headers: buildHeaders({ ...runtime, write: true, idempotencyKey: createClientId("router_plan") }),
        body: {
          text: form.text,
          scope: form.scope,
          metadata: {
            source: "dashboard.network",
            productSurface: "consumer_shell"
          },
          requesterAgentId: form.posterAgentId || null,
          maxCandidates: Number(form.maxCandidates || 5),
          includeReputation: true,
          includeRoutingFactors: true,
          scoreStrategy: "balanced"
        }
      });
      startTransition(() => {
        setPlan(out?.plan ?? null);
      });
      if ((out?.plan?.issues ?? []).some((issue) => issue?.code === "ROUTER_PHASE1_TASK_UNSUPPORTED")) {
        setStatusMessage("This request is outside the supported Phase 1 task families. Adjust it or choose a supported launch shape.");
      } else {
        setStatusMessage(`Plan ready. ${out?.plan?.taskCount ?? 0} tasks derived.`);
      }
    } catch (error) {
      setPlan(null);
      setStatusMessage(`Plan failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function launchWork({ dispatchNow }) {
    if (!runtimeReady) {
      setStatusMessage("Issue runtime bootstrap on onboarding before launching work.");
      return;
    }
    if (taskWalletPreview && taskWalletApproved !== true) {
      setStatusMessage("Approve the Action Wallet boundary before launching work.");
      return;
    }
    const requestBody = {
      text: form.text,
      posterAgentId: form.posterAgentId,
      scope: form.scope,
      budgetCents: Number(form.budgetCents || 0) || null,
      currency: form.currency || "USD",
      deadlineAt: form.deadlineAt || null,
      metadata: {
        source: "dashboard.network",
        productSurface: "consumer_shell"
      },
      ...(form.requireApproval
        ? {
            approvalMode: "require",
            approvalPolicy: {
              requireApprovalAboveCents: 0,
              strictEvidenceRefs: true
            },
            approvalContinuation: {
              dispatchNow: dispatchNow === true
            }
          }
        : {})
    };
    setBusyState(dispatchNow ? "dispatch" : "launch");
    setStatusMessage(
      form.requireApproval
        ? dispatchNow
          ? "Submitting the launch, then routing through approvals before dispatch..."
          : "Submitting the launch, then routing through approvals..."
        : dispatchNow
          ? "Launching and dispatching..."
          : "Launching the task..."
    );
    try {
      const launchOut = await requestJson({
        baseUrl: runtime.baseUrl,
        pathname: "/router/launch",
        method: "POST",
        headers: buildHeaders({ ...runtime, write: true, idempotencyKey: createClientId("router_launch") }),
        body: requestBody
      });
      startTransition(() => {
        setPlan(launchOut?.plan ?? null);
        setLaunchResponse(launchOut);
      });
      const nextLaunchId = launchOut?.launch?.launchId ?? null;
      if (nextLaunchId) {
        setActiveLaunchId(nextLaunchId);
        onLaunchRecorded(nextLaunchId);
      }

      if (dispatchNow && nextLaunchId) {
        const dispatchOut = await requestJson({
          baseUrl: runtime.baseUrl,
          pathname: "/router/dispatch",
          method: "POST",
          headers: buildHeaders({ ...runtime, write: true, idempotencyKey: createClientId("router_dispatch") }),
          body: {
            launchId: nextLaunchId
          }
        });
        startTransition(() => {
          setDispatchResponse(dispatchOut);
        });
      }

      if (nextLaunchId) {
        const statusOut = await requestJson({
          baseUrl: runtime.baseUrl,
          pathname: `/router/launches/${encodeURIComponent(nextLaunchId)}/status`,
          method: "GET",
          headers: buildHeaders(runtime)
        });
        startTransition(() => {
          setLaunchStatus(statusOut?.status ?? null);
        });
      }

      setStatusMessage(
        dispatchNow
          ? "Launch dispatched. Share the launch page or inspect the live task graph below."
          : "Launch created. The task is live and ready for the network."
      );
    } catch (error) {
      if (error.code === "HUMAN_APPROVAL_REQUIRED" && error.details?.approvalRequest?.requestId) {
        const continuation =
          asPlainObject(error.details?.approvalContinuation) ??
          asPlainObject(error.details?.continuation) ??
          null;
        setPendingApprovalResume(
          continuation && typeof continuation.requestId === "string"
            ? continuation
            : { requestId: error.details.approvalRequest.requestId }
        );
        window.location.assign(buildRouterLaunchResumeUrl(error.details.approvalRequest.requestId));
          return;
      }
      if (error.code === "ROUTER_PHASE1_TASK_UNSUPPORTED") {
        setPlan(error.details?.plan ?? null);
        setStatusMessage(error.message);
        return;
      }
      setStatusMessage(`${dispatchNow ? "Launch + dispatch" : "Launch"} failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  const summary = deferredLaunchStatus?.summary ?? null;
  const currentLaunchId = deferredLaunchStatus?.launchRef?.launchId ?? activeLaunchId ?? null;
  const readinessItems = [
    {
      title: "Workspace session",
      body: buyer ? `${buyer.email} is active in ${buyer.tenantId}.` : "Sign in on onboarding so the product can issue runtime credentials.",
      ready: Boolean(buyer)
    },
    {
      title: "Runtime key",
      body: runtimeReady
        ? `Using ${bootstrapBundle?.bootstrap?.apiKey?.keyId ?? "a configured API key"} for live requests.`
        : "Issue runtime bootstrap before planning or dispatching work.",
      ready: runtimeReady
    },
    {
      title: "Requester agent",
      body: form.posterAgentId ? `${form.posterAgentId} will post the work.` : "Add a requester agent for cleaner lineage and downstream reporting.",
      ready: Boolean(form.posterAgentId)
    },
    {
      title: "Supply side",
      body: lastAgentId ? `Latest worker ${lastAgentId} is ready to receive work.` : "Publish at least one worker in Studio to seed the managed supply side.",
      ready: Boolean(lastAgentId)
    }
  ];

  return (
    <div className="product-page">
      <section className="product-page-top">
        <div>
          <p className="product-kicker">{launchId ? "Launch Status" : "Action Wallet Launch"}</p>
          <h1>{launchId ? "A shareable status page for one hosted Action Wallet run." : "State the outcome. Approve the boundary. Finalize with proof."}</h1>
          <p className="product-lead">
            Nooterra creates bounded action intents, routes users through hosted approvals, and returns receipts when execution completes.
          </p>
        </div>
        <div className="product-page-top-actions">
          {currentLaunchId ? (
            <a className="product-button product-button-ghost" href={`/launch/${encodeURIComponent(currentLaunchId)}`}>
              Open shareable launch page
            </a>
          ) : null}
          <a className="product-button product-button-ghost" href="/onboarding">Finish setup</a>
          <a className="product-button product-button-solid" href={docsLinks.hostQuickstart}>Open host setup</a>
        </div>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Host Console</p>
            <h2>Start from a supported action template instead of an open-ended request.</h2>
          </div>
          <div className="product-option-grid">
            {networkTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`product-option-card ${selectedTemplateId === template.id ? "active" : ""}`}
                onClick={() => applyNetworkTemplate(template)}
              >
                <strong>{template.title}</strong>
                <span>{template.body}</span>
              </button>
            ))}
          </div>
          <div className="product-form-grid">
            <label className="wide">
              <span>Request</span>
              <textarea
                value={form.text}
                onChange={(event) => setForm((previous) => ({ ...previous, text: event.target.value }))}
                rows={5}
              />
            </label>
            <label>
              <span>Host ID (optional)</span>
              <input
                value={form.posterAgentId}
                onChange={(event) => setForm((previous) => ({ ...previous, posterAgentId: event.target.value }))}
                placeholder="agt_requester_1"
              />
            </label>
            <label>
              <span>Scope</span>
              <select
                value={form.scope}
                onChange={(event) => setForm((previous) => ({ ...previous, scope: event.target.value }))}
              >
                <option value="public">public</option>
                <option value="tenant">tenant</option>
              </select>
            </label>
            <label>
              <span>Budget (cents)</span>
              <input
                value={form.budgetCents}
                onChange={(event) => setForm((previous) => ({ ...previous, budgetCents: event.target.value }))}
                inputMode="numeric"
              />
            </label>
            <label>
              <span>Currency</span>
              <input
                value={form.currency}
                onChange={(event) => setForm((previous) => ({ ...previous, currency: event.target.value }))}
                placeholder="USD"
              />
            </label>
            <label>
              <span>Deadline (optional)</span>
              <input
                value={form.deadlineAt}
                onChange={(event) => setForm((previous) => ({ ...previous, deadlineAt: event.target.value }))}
                placeholder="2030-01-01T00:00:00.000Z"
              />
            </label>
            <label>
              <span>Max candidates</span>
              <input
                value={form.maxCandidates}
                onChange={(event) => setForm((previous) => ({ ...previous, maxCandidates: event.target.value }))}
                inputMode="numeric"
              />
            </label>
          </div>
          <div className="product-actions">
            <button className="product-button product-button-ghost" disabled={busyState !== "" || !runtimeReady} onClick={() => void previewPlan()}>
              {busyState === "plan" ? "Planning..." : "Preview Plan"}
            </button>
            <button
              className="product-button product-button-ghost"
              disabled={busyState !== "" || !runtimeReady || Boolean(taskWalletPreview) && taskWalletApproved !== true}
              onClick={() => void launchWork({ dispatchNow: false })}
            >
              {busyState === "launch" ? "Launching..." : "Create intent"}
            </button>
            <button
              className="product-button product-button-solid"
              disabled={busyState !== "" || !runtimeReady || Boolean(taskWalletPreview) && taskWalletApproved !== true}
              onClick={() => void launchWork({ dispatchNow: true })}
            >
              {busyState === "dispatch" ? "Dispatching..." : "Create + Start"}
            </button>
          </div>
          <label className="product-toggle">
            <input
              type="checkbox"
              checked={form.requireApproval}
              onChange={(event) => setForm((previous) => ({ ...previous, requireApproval: event.target.checked }))}
            />
            <span>Require a hosted approval before execution starts</span>
          </label>
          <div className={`product-inline-note ${runtimeReady ? "" : "warn"}`}>{statusMessage}</div>
          {pendingApprovalResume?.requestId ? (
            <div className="product-inline-note warn">
              Approval is waiting for request {pendingApprovalResume.requestId}. <a href={buildRouterLaunchResumeUrl(pendingApprovalResume.requestId)}>Open Approvals</a>
              {" "}to approve and resume the blocked launch.
            </div>
          ) : null}
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Action Wallet</p>
            <h2>Approve the spend, execution, and proof envelope before execution starts.</h2>
          </div>
          {taskWalletPreview ? (
            <>
              <div className="product-wallet-sheet">
                <div className="product-wallet-sheet-head">
                  <div>
                    <p>Wallet preview</p>
                    <h3>{taskWalletPreview.categoryLabel}</h3>
                  </div>
                  <span className="product-status-pill tone-accent">{humanizeLabel(taskWalletPreview.reviewMode, taskWalletPreview.reviewMode)}</span>
                </div>
                <p className="product-wallet-sheet-copy">{taskWalletPreview.categorySummary}</p>
                <div className="product-wallet-fact-grid">
                  <div>
                    <strong>Spend cap</strong>
                    <span>
                      {Number.isFinite(Number(taskWalletPreview.maxSpendCents))
                        ? formatCurrency(taskWalletPreview.maxSpendCents, taskWalletPreview.currency)
                        : "No direct spend"}
                    </span>
                  </div>
                  <div>
                    <strong>Settlement</strong>
                    <span>Platform managed</span>
                  </div>
                  <div>
                    <strong>Execution profiles</strong>
                    <span>{taskWalletPreview.allowedSpecialistProfileIds.length ? taskWalletPreview.allowedSpecialistProfileIds.join(", ") : "n/a"}</span>
                  </div>
                  <div>
                    <strong>Expires</strong>
                    <span>{taskWalletPreview.expiresAt ? formatDateTime(taskWalletPreview.expiresAt) : "Open until completion"}</span>
                  </div>
                </div>
                {taskWalletPreview.allowedMerchantScopes.length > 0 ? (
                  <div className="product-inline-note accent">
                    Merchant scope: {taskWalletPreview.allowedMerchantScopes.join(", ")}
                  </div>
                ) : null}
                {taskWalletPreview.evidenceRequirements.length > 0 ? (
                  <div className="product-badge-row">
                    {taskWalletPreview.evidenceRequirements.map((item) => (
                      <span key={`task_wallet_preview_${item}`} className="product-badge subtle">
                        {humanizeLabel(item)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {taskWalletPreview.summary ? <div className="product-inline-note">{taskWalletPreview.summary}</div> : null}
                {taskWalletPreview.proofSummary ? (
                  <div className="product-managed-proof-copy">
                    <strong>Proof returned</strong>
                    <span>{taskWalletPreview.proofSummary}</span>
                  </div>
                ) : null}
                {taskWalletSettlementPreview ? (
                  <div className="product-detail-meta">
                    <div>
                      <strong>Consumer rail</strong>
                      <span>{humanizeLabel(taskWalletSettlementPreview.consumerSpendRail, taskWalletSettlementPreview.consumerSpendRail)}</span>
                    </div>
                    <div>
                      <strong>Platform rail</strong>
                      <span>{humanizeLabel(taskWalletSettlementPreview.platformSettlementRail, taskWalletSettlementPreview.platformSettlementRail)}</span>
                    </div>
                    <div>
                      <strong>Machine rail</strong>
                      <span>{humanizeLabel(taskWalletSettlementPreview.machineSpendRail, taskWalletSettlementPreview.machineSpendRail)}</span>
                    </div>
                    <div>
                      <strong>Finalize rule</strong>
                      <span>{humanizeLabel(taskWalletSettlementPreview.finalizationRule, taskWalletSettlementPreview.finalizationRule)}</span>
                    </div>
                  </div>
                ) : null}
                <label className="product-toggle">
                  <input
                    type="checkbox"
                    checked={taskWalletApproved}
                    onChange={(event) => setTaskWalletApproved(event.target.checked)}
                  />
                  <span>I approve this Action Wallet boundary for launch and spend-bounded execution.</span>
                </label>
              </div>
            </>
          ) : (
            <div className="product-empty-state">Choose a supported launch template to preview the Action Wallet boundary that will bound execution.</div>
          )}
          <div className="product-sidebar-list">
            <div>
              <strong>Approval model</strong>
              <span>Execution stays inside this wallet and cannot exceed the spend, execution, or proof envelope.</span>
            </div>
            <div>
              <strong>Workspace session</strong>
              <span>{buyer ? `${buyer.email} is active in ${buyer.tenantId}.` : "Sign in on onboarding so the product can issue runtime credentials."}</span>
            </div>
            <div>
              <strong>Runtime key</strong>
              <span>
                {runtimeReady
                  ? `Using ${bootstrapBundle?.bootstrap?.apiKey?.keyId ?? "a configured API key"} for live requests.`
                  : "Issue runtime bootstrap before planning or dispatching work."}
              </span>
            </div>
            <div>
              <strong>Host ID</strong>
              <span>{form.posterAgentId ? `${form.posterAgentId} will post the work.` : "Add a requester agent for cleaner lineage and downstream reporting."}</span>
            </div>
            <div>
              <strong>Supply side</strong>
              <span>{lastAgentId ? `Latest worker ${lastAgentId} is ready to receive work.` : "Publish at least one worker in Studio to seed the managed supply side."}</span>
            </div>
          </div>
          <div className="product-step-list">
            {readinessItems.map((item) => (
              <div key={item.title} className="product-step-item">
                <div className="product-step-copy">
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </div>
                <span className={`product-status-pill tone-${item.ready ? "good" : "warn"}`}>{item.ready ? "Ready" : "Needs setup"}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Plan Preview</p>
            <h2>See the graph and the launch boundary before you spend.</h2>
          </div>
          {plan ? (
            <>
              {blockingPlanIssues.length > 0 ? (
                <div className="product-step-list product-step-list-tight">
                  {blockingPlanIssues.map((issue, index) => (
                    <div key={`${issue.code}_${index}`} className="product-step-item">
                      <div className="product-step-copy">
                        <strong>{issue.message}</strong>
                        <span>
                          {issue?.details?.taskPolicy?.categoryLabel
                            ? `Matched category: ${issue.details.taskPolicy.categoryLabel}.`
                            : "Use one of the supported Phase 1 task families to move into execution."}
                        </span>
                      </div>
                      <span className="product-status-pill tone-warn">Blocked</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="product-plan-list">
                {(plan.tasks ?? []).map((task) => (
                  <div key={task.taskId} className="product-plan-row">
                    <div>
                      <strong>{task.title}</strong>
                      <span>{task.requiredCapability}</span>
                    </div>
                    <div>
                      <span>{(task.candidates ?? []).length} candidates</span>
                      <span>{(task.dependsOnTaskIds ?? []).length} deps</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="product-empty-state">Run “Preview Plan” to inspect the routed task graph and confirm the request is inside the Phase 1 boundary.</div>
          )}
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Status</p>
            <h2>Keep the important state visible.</h2>
          </div>
          <div className="product-hash-stack">
            <div>
              <strong>Launch</strong>
              <span>{launchResponse?.launch?.launchHash ? abbreviateHash(launchResponse.launch.launchHash, 20) : "pending"}</span>
            </div>
            <div>
              <strong>Dispatch</strong>
              <span>{dispatchResponse?.dispatch?.dispatchHash ? abbreviateHash(dispatchResponse.dispatch.dispatchHash, 20) : "pending"}</span>
            </div>
            <div>
              <strong>Launch ID</strong>
              <span>{currentLaunchId || "pending"}</span>
            </div>
          </div>
          <div className="product-metric-grid">
            <div className="product-metric-card">
              <span>Tasks</span>
              <strong>{summary?.openCount !== undefined ? deferredLaunchStatus?.taskCount : "0"}</strong>
              <small>routed units of work</small>
            </div>
            <div className="product-metric-card">
              <span>Ready</span>
              <strong>{summary?.readyCount ?? 0}</strong>
              <small>tasks with bids and no blockers</small>
            </div>
            <div className="product-metric-card">
              <span>Assigned</span>
              <strong>{summary?.assignedCount ?? 0}</strong>
              <small>runs in flight with locked settlement</small>
            </div>
            <div className="product-metric-card">
              <span>Closed</span>
              <strong>{summary?.closedCount ?? 0}</strong>
              <small>tasks completed and released</small>
            </div>
          </div>
          {debugMode ? (
            <>
              <details className="product-details">
                <summary>Raw launch response</summary>
                <pre><code>{prettyJson(launchResponse)}</code></pre>
              </details>
              <details className="product-details">
                <summary>Raw dispatch response</summary>
                <pre><code>{prettyJson(dispatchResponse)}</code></pre>
              </details>
            </>
          ) : (
            <div className="product-inline-note">Open a launch page to revisit work, bids, and outcomes after dispatch.</div>
          )}
        </article>
      </section>

      <section className="product-section">
        <div className="product-section-head">
          <p>Live Tasks</p>
          <h2>Track work after it starts.</h2>
        </div>
        {deferredLaunchStatus?.tasks?.length ? (
          <div className="product-task-grid">
            {deferredLaunchStatus.tasks.map((task) => (
              <LaunchTaskCard key={task.taskId} task={task} />
            ))}
          </div>
        ) : (
          <div className="product-empty-state">No launch status loaded yet. Create or open a launch to see the network graph.</div>
        )}
      </section>
    </div>
  );
}

function OnboardingPage({ runtime, setRuntime, onboardingState, setOnboardingState }) {
  const authMode = onboardingState?.authMode ?? null;
  const buyer = onboardingState?.buyer ?? null;
  const bootstrapBundle = onboardingState?.bootstrap ?? null;
  const smokeBundle = onboardingState?.smoke ?? null;
  const sessionExpected = onboardingState?.sessionExpected === true;
  const [signupForm, setSignupForm] = useState({
    email: buyer?.email ?? "",
    company: "",
    fullName: "",
    tenantId: ""
  });
  const [loginForm, setLoginForm] = useState({
    tenantId: buyer?.tenantId ?? "",
    email: buyer?.email ?? "",
    code: ""
  });
  const [runtimeForm, setRuntimeForm] = useState({
    apiKeyId: "",
    scopes: "",
    paidToolsBaseUrl: ""
  });
  const [passkeyForm, setPasskeyForm] = useState({
    label: "This browser"
  });
  const [storedPasskey, setStoredPasskey] = useState(null);
  const [firstPaidCallState, setFirstPaidCallState] = useState({
    latest: null,
    history: [],
    selectedAttemptId: "",
    loading: false,
    error: ""
  });
  const [onboardingMetricsState, setOnboardingMetricsState] = useState({
    metrics: null,
    loading: false,
    error: ""
  });
  const [conformanceState, setConformanceState] = useState({
    matrix: null,
    loading: false,
    error: ""
  });
  const [busyState, setBusyState] = useState("");
  const [statusMessage, setStatusMessage] = useState("Create or unlock a workspace with a saved browser passkey. Email OTP stays available as the recovery path.");
  const browserPasskeyReady = typeof window !== "undefined" && Boolean(globalThis.crypto?.subtle);
  const buyerTenantId = String(buyer?.tenantId ?? "").trim();
  const runtimeBootstrapTenantId = String(bootstrapBundle?.tenantId ?? "").trim();
  const resolvedWorkspaceTenantId = runtimeBootstrapTenantId || buyerTenantId;
  const workspaceTenantLabel = resolvedWorkspaceTenantId || "Issue workspace first";

  async function requestAuthJson(request) {
    const configuredBaseUrl = String(runtime.authBaseUrl ?? "").trim() || DEFAULT_AUTH_BASE_URL;
    const normalizedPathname = typeof request?.pathname === "string" ? request.pathname.trim() : "";
    const preferManagedPublicAuthMode = normalizedPathname === "/v1/public/auth-mode";
    const baseUrlCandidates = Array.from(
      new Set(
        (preferManagedPublicAuthMode
          ? [DEFAULT_AUTH_BASE_URL, configuredBaseUrl]
          : [configuredBaseUrl, DEFAULT_AUTH_BASE_URL]
        ).filter((value) => typeof value === "string" && value.trim() !== "")
      )
    );
    let lastError = null;
    for (const baseUrl of baseUrlCandidates) {
      try {
        const out = await requestJson({
          ...request,
          baseUrl
        });
        if (baseUrl !== configuredBaseUrl) {
          setRuntime((previous) => (
            previous.authBaseUrl === baseUrl
              ? previous
              : { ...previous, authBaseUrl: baseUrl }
          ));
        }
        return out;
      } catch (error) {
        lastError = error;
        const message = String(error?.message ?? "");
        const shouldFallback =
          (!Number.isInteger(error?.status) || error.status >= 500) &&
          /failed to fetch|networkerror|load failed|fetch/i.test(message);
        if (!shouldFallback || baseUrl === DEFAULT_AUTH_BASE_URL) break;
      }
    }
    throw lastError;
  }

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const authOut = await requestAuthJson({
          pathname: "/v1/public/auth-mode",
          method: "GET",
          credentials: "include"
        });
        if (cancelled) return;
        startTransition(() => {
          setOnboardingState((previous) => ({
            ...normalizeOnboardingState(previous),
            authMode: authOut
          }));
        });
      } catch (error) {
        if (!cancelled) {
          setStatusMessage(`Auth control plane unavailable: ${error.message}`);
        }
      }

      if (!sessionExpected) {
        startTransition(() => {
          setOnboardingState((previous) => ({
            ...normalizeOnboardingState(previous),
            buyer: null
          }));
        });
        return;
      }

      try {
        const meOut = await requestAuthJson({
          pathname: "/v1/buyer/me",
          method: "GET",
          credentials: "include"
        });
        if (cancelled) return;
        const principal = meOut?.principal ?? null;
        startTransition(() => {
          setOnboardingState((previous) => ({
            ...normalizeOnboardingState(previous),
            buyer: principal,
            sessionExpected: Boolean(principal)
          }));
        });
        if (principal) {
          setLoginForm((previous) => ({
            ...previous,
            tenantId: principal.tenantId || previous.tenantId,
            email: principal.email || previous.email
          }));
          setRuntime((previous) => ({
            ...previous,
            tenantId: principal.tenantId || previous.tenantId
          }));
          setStatusMessage(`Buyer session loaded for ${principal.email}. Runtime bootstrap can be issued now.`);
        }
      } catch (error) {
        if (cancelled) return;
        if (error.status === 401) {
          startTransition(() => {
            setOnboardingState((previous) => ({
              ...normalizeOnboardingState(previous),
              buyer: null,
              sessionExpected: false
            }));
          });
        } else {
          setStatusMessage(`Buyer session refresh failed: ${error.message}`);
        }
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [runtime.authBaseUrl, runtime.tenantId, sessionExpected, setOnboardingState, setRuntime]);

  useEffect(() => {
    if (!buyer) return;
    setSignupForm((previous) => ({
      ...previous,
      email: previous.email || buyer.email || "",
      tenantId: previous.tenantId || buyer.tenantId || ""
    }));
    setLoginForm((previous) => ({
      ...previous,
      tenantId: buyer.tenantId || previous.tenantId,
      email: buyer.email || previous.email
    }));
  }, [buyer]);

  useEffect(() => {
    const tenantId = buyer?.tenantId || loginForm.tenantId || signupForm.tenantId;
    const email = buyer?.email || loginForm.email || signupForm.email;
    setStoredPasskey(loadStoredBuyerPasskeyBundle({ tenantId, email }));
  }, [buyer, loginForm.tenantId, loginForm.email, signupForm.tenantId, signupForm.email]);

  useEffect(() => {
    let cancelled = false;
    const tenantId = buyer?.tenantId;
    if (!tenantId) {
      setFirstPaidCallState({
        latest: null,
        history: [],
        selectedAttemptId: "",
        loading: false,
        error: ""
      });
      setOnboardingMetricsState({
        metrics: null,
        loading: false,
        error: ""
      });
      setConformanceState({
        matrix: null,
        loading: false,
        error: ""
      });
      return;
    }

    async function loadOnboardingMetrics() {
      try {
        const out = await requestAuthJson({
          pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/onboarding-metrics`,
          method: "GET",
          credentials: "include"
        });
        if (cancelled) return;
        setOnboardingMetricsState({
          metrics: out,
          loading: false,
          error: ""
        });
      } catch (error) {
        if (cancelled) return;
        setOnboardingMetricsState({
          metrics: null,
          loading: false,
          error: error.message
        });
      }
    }

    async function loadFirstPaidHistory() {
      try {
        const out = await requestAuthJson({
          pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/onboarding/first-paid-call/history`,
          method: "GET",
          credentials: "include"
        });
        if (cancelled) return;
        const attempts = Array.isArray(out?.attempts) ? out.attempts : [];
        setFirstPaidCallState((previous) => ({
          ...previous,
          history: attempts,
          selectedAttemptId:
            previous.selectedAttemptId && attempts.some((row) => String(row?.attemptId ?? "") === previous.selectedAttemptId)
              ? previous.selectedAttemptId
              : String(attempts[attempts.length - 1]?.attemptId ?? ""),
          error: ""
        }));
      } catch (error) {
        if (cancelled) return;
        setFirstPaidCallState((previous) => ({
          ...previous,
          history: [],
          selectedAttemptId: "",
          error: error.message
        }));
      }
    }

    setOnboardingMetricsState((previous) => ({
      ...previous,
      loading: true,
      error: ""
    }));
    void loadOnboardingMetrics();
    void loadFirstPaidHistory();
    return () => {
      cancelled = true;
    };
  }, [buyer?.tenantId, runtime.authBaseUrl, runtime.tenantId]);

  async function refreshOnboardingMetrics() {
    const tenantId = buyer?.tenantId;
    if (!tenantId) {
      setOnboardingMetricsState({
        metrics: null,
        loading: false,
        error: ""
      });
      return null;
    }
    setOnboardingMetricsState((previous) => ({
      ...previous,
      loading: true,
      error: ""
    }));
    try {
      const out = await requestAuthJson({
        pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/onboarding-metrics`,
        method: "GET",
        credentials: "include"
      });
      setOnboardingMetricsState({
        metrics: out,
        loading: false,
        error: ""
      });
      return out;
    } catch (error) {
      setOnboardingMetricsState({
        metrics: null,
        loading: false,
        error: error.message
      });
      throw error;
    }
  }

  async function loadBuyerSession() {
    const meOut = await requestAuthJson({
      pathname: "/v1/buyer/me",
      method: "GET",
      credentials: "include"
    });
    const principal = meOut?.principal ?? null;
    startTransition(() => {
      setOnboardingState((previous) => {
        const normalized = normalizeOnboardingState(previous);
        const sameTenant = normalized.bootstrap?.tenantId && normalized.bootstrap.tenantId === principal?.tenantId;
        return {
          ...normalized,
          buyer: principal,
          bootstrap: sameTenant ? normalized.bootstrap : null,
          smoke: sameTenant ? normalized.smoke : null,
          sessionExpected: Boolean(principal)
        };
      });
    });
    if (principal?.tenantId) {
      setRuntime((previous) => ({
        ...previous,
        tenantId: principal.tenantId
      }));
    }
    return principal;
  }

  function loadStoredPasskeyForCurrentIdentity({ tenantId = null, email = null } = {}) {
    const bundle = loadStoredBuyerPasskeyBundle({
      tenantId: tenantId ?? buyer?.tenantId ?? loginForm.tenantId ?? signupForm.tenantId,
      email: email ?? buyer?.email ?? loginForm.email ?? signupForm.email
    });
    setStoredPasskey(bundle);
    return bundle;
  }

  async function runBootstrapSmokeTest(bootstrapOverride = null) {
    const activeBootstrap = bootstrapOverride ?? bootstrapBundle;
    const tenantId = activeBootstrap?.tenantId ?? buyer?.tenantId;
    const env = activeBootstrap?.mcp?.env ?? null;
    if (!tenantId || !env) throw new Error("runtime bootstrap must exist before smoke test");
    const out = await requestAuthJson({
      pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/onboarding/runtime-bootstrap/smoke-test`,
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: { env },
      credentials: "include"
    });
    startTransition(() => {
      setOnboardingState((previous) => ({
        ...normalizeOnboardingState(previous),
        smoke: out
      }));
    });
    return out;
  }

  async function handlePublicSignup() {
    const signupValidationError = validateWorkspaceSignupForm(signupForm);
    if (signupValidationError) {
      setStatusMessage(signupValidationError);
      return;
    }
    setBusyState("signup");
    setStatusMessage("Creating the workspace and issuing the first recovery code...");
    try {
      const out = await requestAuthJson({
        pathname: "/v1/public/signup",
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: {
          email: signupForm.email,
          company: signupForm.company,
          fullName: signupForm.fullName,
          ...(signupForm.tenantId ? { tenantId: signupForm.tenantId } : {})
        },
        credentials: "include"
      });
      setLoginForm((previous) => ({
        ...previous,
        tenantId: out?.tenantId ?? previous.tenantId,
        email: out?.email ?? signupForm.email,
        code: ""
      }));
      setRuntime((previous) => ({
        ...previous,
        tenantId: out?.tenantId ?? previous.tenantId
      }));
      startTransition(() => {
        setOnboardingState((previous) => ({
          ...normalizeOnboardingState(previous),
          buyer: null,
          bootstrap: null,
          smoke: null,
          sessionExpected: false
        }));
      });
      setStatusMessage(
        out?.otpIssued === false
          ? `Workspace ${out?.tenantId ?? "created"} is ready, but recovery-code delivery failed. Request a fresh code below.`
          : `Workspace ${out?.tenantId ?? "created"} is ready. A six-digit recovery code was sent to ${out?.email ?? signupForm.email}.`
      );
    } catch (error) {
      setStatusMessage(`Signup failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function handlePasskeySignup() {
    if (!browserPasskeyReady) {
      setStatusMessage("This browser cannot create a saved passkey. Use email recovery on an existing workspace or switch to a browser with Web Crypto support.");
      return;
    }
    if (authMode?.publicSignupEnabled === false) {
      setStatusMessage("Public signup is disabled on this control plane. Use a tenant-scoped saved passkey or the recovery path below.");
      return;
    }
    const signupValidationError = validateWorkspaceSignupForm(signupForm);
    if (signupValidationError) {
      setStatusMessage(signupValidationError);
      return;
    }
    setBusyState("passkey_signup");
    setStatusMessage("Generating a device passkey, creating the workspace, and opening the first buyer session...");
    try {
      const keypair = await generateBrowserEd25519KeypairPem();
      const options = await requestAuthJson({
        pathname: "/v1/public/signup/passkey/options",
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: {
          email: signupForm.email,
          company: signupForm.company,
          fullName: signupForm.fullName,
          ...(signupForm.tenantId ? { tenantId: signupForm.tenantId } : {})
        },
        credentials: "include"
      });
      const label = String(passkeyForm.label ?? "").trim() || "This browser";
      const credentialId = `cred_${keypair.keyId.replace(/^key_/, "")}`;
      const signature = await signBrowserPasskeyChallengeBase64Url({
        privateKeyPem: keypair.privateKeyPem,
        challenge: options?.challenge
      });
      const out = await requestAuthJson({
        pathname: "/v1/public/signup/passkey",
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: {
          tenantId: options?.tenantId,
          challengeId: options?.challengeId,
          challenge: options?.challenge,
          credentialId,
          publicKeyPem: keypair.publicKeyPem,
          signature,
          label
        },
        credentials: "include"
      });
      const savedPasskey = saveStoredBuyerPasskeyBundle({
        tenantId: out?.tenantId ?? options?.tenantId,
        email: out?.email ?? options?.email ?? signupForm.email,
        credentialId,
        publicKeyPem: keypair.publicKeyPem,
        privateKeyPem: keypair.privateKeyPem,
        keyId: keypair.keyId,
        label,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString()
      });
      setStoredPasskey(savedPasskey);
      setLoginForm((previous) => ({
        ...previous,
        tenantId: out?.tenantId ?? options?.tenantId ?? previous.tenantId,
        email: out?.email ?? options?.email ?? signupForm.email,
        code: ""
      }));
      setRuntime((previous) => ({
        ...previous,
        tenantId: out?.tenantId ?? options?.tenantId ?? previous.tenantId
      }));
      startTransition(() => {
        setOnboardingState((previous) => ({
          ...normalizeOnboardingState(previous),
          sessionExpected: true
        }));
      });
      const principal = await loadBuyerSession();
      setStatusMessage(
        `Workspace ${out?.tenantId ?? options?.tenantId ?? "created"} is live. ${principal?.email ?? signupForm.email} can now sign in from this browser with ${label}.`
      );
      jumpToPageAnchor("#runtime-bootstrap");
    } catch (error) {
      setStatusMessage(`Passkey workspace signup failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function handlePasskeyLogin() {
    if (!browserPasskeyReady) {
      setStatusMessage("This browser cannot prove a saved passkey challenge. Use the recovery path below.");
      return;
    }
    const tenantId = String(loginForm.tenantId ?? "").trim();
    const email = String(loginForm.email ?? "").trim();
    if (!tenantId || !email) {
      setStatusMessage("Enter the existing tenant and sign-in email before using a saved passkey.");
      return;
    }
    setBusyState("passkey_login");
    setStatusMessage("Checking this browser for a saved passkey and proving the sign-in challenge...");
    try {
      const bundle = loadStoredPasskeyForCurrentIdentity({ tenantId, email });
      if (!bundle) {
        throw new Error("No saved device passkey was found for this tenant/email. Use the recovery code or create the workspace on this browser first.");
      }
      const options = await requestAuthJson({
        pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login/passkey/options`,
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: {
          email
        },
        credentials: "include"
      });
      if (Array.isArray(options?.allowedCredentialIds) && options.allowedCredentialIds.length > 0 && !options.allowedCredentialIds.includes(bundle.credentialId)) {
        throw new Error("The saved device passkey is not registered for this buyer anymore. Use the recovery code or refresh the device credential.");
      }
      const signature = await signBrowserPasskeyChallengeBase64Url({
        privateKeyPem: bundle.privateKeyPem,
        challenge: options?.challenge
      });
      await requestAuthJson({
        pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login/passkey`,
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: {
          challengeId: options?.challengeId,
          challenge: options?.challenge,
          credentialId: bundle.credentialId,
          signature
        },
        credentials: "include"
      });
      const touched = touchStoredBuyerPasskeyBundle({ tenantId, email });
      setStoredPasskey(touched ?? bundle);
      startTransition(() => {
        setOnboardingState((previous) => ({
          ...normalizeOnboardingState(previous),
          sessionExpected: true
        }));
      });
      const principal = await loadBuyerSession();
      setStatusMessage(`Signed in as ${principal?.email ?? email} with the saved ${bundle.label || "device"} passkey. Runtime bootstrap is unlocked.`);
      jumpToPageAnchor("#runtime-bootstrap");
    } catch (error) {
      setStatusMessage(`Saved passkey sign-in failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function handleRequestOtp() {
    setBusyState("otp");
    setStatusMessage("Requesting a recovery code...");
    try {
      const out = await requestAuthJson({
        pathname: `/v1/tenants/${encodeURIComponent(loginForm.tenantId)}/buyer/login/otp`,
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: {
          email: loginForm.email
        },
        credentials: "include"
      });
      setStatusMessage(`Recovery code issued to ${out?.email ?? loginForm.email}. Expires ${formatDateTime(out?.expiresAt)}.`);
    } catch (error) {
      setStatusMessage(`Recovery code request failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function handleVerifyOtp() {
    setBusyState("verify");
    setStatusMessage("Verifying the recovery code and creating the buyer session...");
    try {
      const out = await requestAuthJson({
        pathname: `/v1/tenants/${encodeURIComponent(loginForm.tenantId)}/buyer/login`,
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: {
          email: loginForm.email,
          code: loginForm.code
        },
        credentials: "include"
      });
      startTransition(() => {
        setOnboardingState((previous) => ({
          ...normalizeOnboardingState(previous),
          sessionExpected: true
        }));
      });
      const principal = await loadBuyerSession();
      setStatusMessage(`Signed in as ${principal?.email ?? out?.email ?? loginForm.email}. Runtime bootstrap is unlocked.`);
      jumpToPageAnchor("#runtime-bootstrap");
    } catch (error) {
      setStatusMessage(`Recovery code verification failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function handleRuntimeBootstrap() {
    if (!buyer?.tenantId) {
      setStatusMessage("Sign in to a tenant before issuing runtime credentials.");
      return;
    }
    setBusyState("bootstrap");
    setStatusMessage("Issuing runtime credentials and MCP config...");
    try {
      const scopes = parseCapabilityList(runtimeForm.scopes);
      const requestBody = {
        apiKey: {
          create: true,
          description: "dashboard onboarding runtime bootstrap",
          ...(runtimeForm.apiKeyId ? { keyId: runtimeForm.apiKeyId.trim() } : {}),
          ...(scopes.length > 0 ? { scopes } : {})
        },
        ...(runtimeForm.paidToolsBaseUrl ? { paidToolsBaseUrl: runtimeForm.paidToolsBaseUrl.trim() } : {})
      };
      const out = await requestAuthJson({
        pathname: `/v1/tenants/${encodeURIComponent(buyer.tenantId)}/onboarding/runtime-bootstrap`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": createClientId("runtime_bootstrap")
        },
        body: requestBody,
        credentials: "include"
      });
      startTransition(() => {
        setOnboardingState((previous) => ({
          ...normalizeOnboardingState(previous),
          bootstrap: out,
          smoke: null
        }));
      });
      setRuntime((previous) => ({
        ...previous,
        baseUrl: out?.bootstrap?.apiBaseUrl || previous.baseUrl,
        apiKey: out?.bootstrap?.apiKey?.token || previous.apiKey,
        tenantId: buyer.tenantId
      }));

      let nextMessage = `Runtime bootstrap issued. API key ${out?.bootstrap?.apiKey?.keyId ?? "generated"} is ready.`;
      try {
        const smoke = await runBootstrapSmokeTest(out);
        nextMessage = `Runtime bootstrap issued. MCP smoke passed with ${smoke?.smoke?.toolsCount ?? 0} tools visible.`;
      } catch (error) {
        nextMessage = `Runtime bootstrap issued, but the smoke test failed: ${error.message}`;
      }
      setStatusMessage(nextMessage);
      jumpToPageAnchor("#first-governed-action");
    } catch (error) {
      setStatusMessage(`Runtime bootstrap failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function handleSmokeRetest() {
    setBusyState("smoke");
    setStatusMessage("Running MCP initialize + tools/list smoke test...");
    try {
      const out = await runBootstrapSmokeTest();
      setStatusMessage(`Smoke test passed. ${out?.smoke?.toolsCount ?? 0} tools discovered from the MCP server.`);
    } catch (error) {
      setStatusMessage(`Smoke test failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function handleCopy(text, label) {
    const ok = await copyText(text);
    setStatusMessage(ok ? `${label} copied to the clipboard.` : `${label} copy failed.`);
  }

  async function refreshFirstPaidHistory() {
    const tenantId = buyer?.tenantId;
    if (!tenantId) {
      setStatusMessage("A tenant must be active before loading first paid call history.");
      return;
    }
    setFirstPaidCallState((previous) => ({
      ...previous,
      loading: true,
      error: ""
    }));
    try {
      const out = await requestAuthJson({
        pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/onboarding/first-paid-call/history`,
        method: "GET",
        credentials: "include"
      });
      const attempts = Array.isArray(out?.attempts) ? out.attempts : [];
      setFirstPaidCallState((previous) => ({
        ...previous,
        history: attempts,
        selectedAttemptId:
          previous.selectedAttemptId && attempts.some((row) => String(row?.attemptId ?? "") === previous.selectedAttemptId)
            ? previous.selectedAttemptId
            : String(attempts[attempts.length - 1]?.attemptId ?? ""),
        loading: false,
        error: ""
      }));
      setStatusMessage(`Loaded ${attempts.length} first paid call attempt${attempts.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setFirstPaidCallState((previous) => ({
        ...previous,
        loading: false,
        error: error.message
      }));
      setStatusMessage(`First paid call history failed: ${error.message}`);
    }
  }

  async function handleRunFirstPaidCall({ replayAttemptId = null } = {}) {
    const tenantId = buyer?.tenantId;
    if (!tenantId) {
      setStatusMessage("A tenant must be active before running the first paid call.");
      return;
    }
    setBusyState(replayAttemptId ? "first_paid_replay" : "first_paid");
    setFirstPaidCallState((previous) => ({
      ...previous,
      loading: true,
      error: ""
    }));
    setStatusMessage(replayAttemptId ? "Replaying stored first paid call attempt..." : "Running first paid call...");
    try {
      const out = await requestAuthJson({
        pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/onboarding/first-paid-call`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: replayAttemptId ? { replayAttemptId } : {},
        credentials: "include"
      });
      const historyOut = await requestAuthJson({
        pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/onboarding/first-paid-call/history`,
        method: "GET",
        credentials: "include"
      }).catch(() => null);
      const attempts = Array.isArray(historyOut?.attempts) ? historyOut.attempts : [];
      setFirstPaidCallState((previous) => ({
        ...previous,
        latest: out,
        history: attempts.length ? attempts : previous.history,
        selectedAttemptId: String(out?.attemptId ?? replayAttemptId ?? previous.selectedAttemptId ?? ""),
        loading: false,
        error: ""
      }));
      setStatusMessage(
        replayAttemptId
          ? `Replayed first paid call ${out?.attemptId ?? replayAttemptId}. Verification ${out?.verificationStatus ?? "unknown"}, settlement ${out?.settlementStatus ?? "unknown"}.`
          : `First paid call ${out?.attemptId ?? "completed"}. Verification ${out?.verificationStatus ?? "unknown"}, settlement ${out?.settlementStatus ?? "unknown"}.`
      );
      await refreshOnboardingMetrics().catch(() => {});
      jumpToPageAnchor("#first-live-paid-call");
    } catch (error) {
      setFirstPaidCallState((previous) => ({
        ...previous,
        loading: false,
        error: error.message
      }));
      setStatusMessage(`First paid call failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function handleCreateFirstHostedApproval() {
    if (!buyer?.tenantId) {
      setStatusMessage("Create or recover the workspace before seeding the first hosted approval.");
      jumpToPageAnchor("#identity-access");
      return;
    }
    if (!runtime.baseUrl || !runtime.apiKey) {
      setStatusMessage("Issue Runtime Bootstrap before creating the first hosted approval.");
      jumpToPageAnchor("#runtime-bootstrap");
      return;
    }
    const hostRuntime =
      selectedHostTrack.id === "claude"
        ? "claude-desktop"
        : selectedHostTrack.id === "openclaw"
          ? "openclaw"
          : "codex";
    const hostChannel =
      selectedHostTrack.id === "codex"
        ? "api"
        : "mcp";
    const actionIntentId = createClientId(`onboarding_${selectedHostTrack.id}_intent`);
    const requestId = createClientId(`onboarding_${selectedHostTrack.id}_approval`);
    const actorAgentId = `agt_onboarding_${selectedHostTrack.id}`;
    setBusyState("seed_approval");
    setStatusMessage(`Creating the first hosted approval for ${selectedHostTrack.label}...`);
    try {
      const createdIntent = await requestJson({
        baseUrl: runtime.baseUrl,
        pathname: "/v1/action-intents",
        method: "POST",
        headers: buildHeaders({ ...runtime, write: true, idempotencyKey: createClientId("onboarding_seed_intent") }),
        body: {
          actionIntentId,
          actorAgentId,
          principalId: buyer?.buyerId ?? buyer?.email ?? buyer?.tenantId,
          purpose: selectedHostTrack.id === "openclaw"
            ? "Cancel an unused subscription after approval"
            : "Buy a replacement charger after approval",
          capabilitiesRequested: ["capability://workflow.intake"],
          spendEnvelope: {
            currency: "USD",
            maxPerCallCents: selectedHostTrack.id === "openclaw" ? 0 : 6_000,
            maxTotalCents: selectedHostTrack.id === "openclaw" ? 0 : 6_000
          },
          evidenceRequirements: selectedHostTrack.id === "openclaw"
            ? ["cancellation_confirmation", "refund_status"]
            : ["merchant_receipt", "order_confirmation"],
          host: {
            runtime: hostRuntime,
            channel: hostChannel,
            source: "dashboard-onboarding"
          }
        }
      });
      const approvalRequested = await requestJson({
        baseUrl: runtime.baseUrl,
        pathname: `/v1/action-intents/${encodeURIComponent(createdIntent?.actionIntent?.actionIntentId ?? actionIntentId)}/approval-requests`,
        method: "POST",
        headers: buildHeaders({ ...runtime, write: true, idempotencyKey: createClientId("onboarding_seed_approval") }),
        body: {
          requestId,
          requestedBy: actorAgentId
        }
      });
      await refreshOnboardingMetrics().catch(() => {});
      const approvalUrl = pickFirstString(
        approvalRequested?.approvalUrl,
        approvalRequested?.actionIntent?.approvalUrl,
        `/approvals?requestId=${encodeURIComponent(approvalRequested?.approvalRequest?.requestId ?? requestId)}`
      );
      setStatusMessage(`Hosted approval ${approvalRequested?.approvalRequest?.requestId ?? requestId} is live for ${selectedHostTrack.label}.`);
      if (typeof window !== "undefined" && approvalUrl) {
        window.location.assign(approvalUrl);
        return;
      }
    } catch (error) {
      setStatusMessage(`First hosted approval failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function handleRunConformanceMatrix() {
    const tenantId = buyer?.tenantId;
    if (!tenantId) {
      setStatusMessage("A tenant must be active before running the conformance matrix.");
      return;
    }
    setBusyState("conformance");
    setConformanceState((previous) => ({
      ...previous,
      loading: true,
      error: ""
    }));
    setStatusMessage("Running runtime conformance matrix...");
    try {
      const out = await requestAuthJson({
        pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/onboarding/conformance-matrix`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { targets: ["nooterra", "claude", "openclaw"] },
        credentials: "include"
      });
      setConformanceState({
        matrix: out,
        loading: false,
        error: ""
      });
      setStatusMessage(
        out?.matrix?.ready
          ? `Runtime conformance passed for ${tenantId}.`
          : `Runtime conformance completed with gaps for ${tenantId}.`
      );
      await refreshFirstPaidHistory().catch(() => {});
      await refreshOnboardingMetrics().catch(() => {});
    } catch (error) {
      setConformanceState({
        matrix: null,
        loading: false,
        error: error.message
      });
      setStatusMessage(`Runtime conformance failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function handleLogout() {
    setBusyState("logout");
    setStatusMessage("Signing out of the buyer session...");
    try {
      await requestAuthJson({
        pathname: "/v1/buyer/logout",
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: {},
        credentials: "include"
      });
      startTransition(() => {
        setOnboardingState((previous) => ({
          ...normalizeOnboardingState(previous),
          buyer: null,
          bootstrap: null,
          smoke: null,
          sessionExpected: false
        }));
      });
      setRuntime((previous) => ({
        ...previous,
        apiKey: ""
      }));
      setLoginForm((previous) => ({
        ...previous,
        code: ""
      }));
      setStatusMessage("Signed out. Runtime credentials were cleared from the dashboard shell.");
    } catch (error) {
      setStatusMessage(`Logout failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  const exportCommands = bootstrapBundle?.bootstrap?.exportCommands ?? "# Runtime bootstrap not issued yet";
  const mcpConfigSnippet = bootstrapBundle?.mcpConfigJson ? prettyJson(bootstrapBundle.mcpConfigJson) : "{\n  \"mcpServers\": {}\n}";
  const builderCliSnippet = `${exportCommands}

# Reuse this tenant-scoped runtime for Claude MCP and OpenClaw.
# Keep the host runtime pointed at one approval surface and one receipt trail.`;
  const onboardingChecks = [
    {
      id: "identity",
      label: "Workspace identity is active",
      ready: Boolean(buyer?.tenantId),
      detail: buyer
        ? `${buyer.email} is signed into ${buyer.tenantId}.`
        : "Create or recover a workspace before you issue runtime credentials."
    },
    {
      id: "passkey",
      label: "Primary sign-in path is available",
      ready: browserPasskeyReady,
      detail: browserPasskeyReady
        ? "This browser can hold the primary passkey path for same-device sign-in."
        : "This browser cannot use the passkey path cleanly. Recovery OTP remains available."
    },
    {
      id: "bootstrap",
      label: "Runtime bootstrap is issued",
      ready: Boolean(bootstrapBundle?.bootstrap?.apiKey?.keyId),
      detail: bootstrapBundle?.bootstrap?.apiKey?.keyId
        ? `API key ${bootstrapBundle.bootstrap.apiKey.keyId} is ready for host installs.`
        : "Issue the runtime bootstrap so hosts can create intents and fetch receipts."
    },
    {
      id: "smoke",
      label: "Hosted smoke is green",
      ready: Boolean(smokeBundle?.smoke?.initialized),
      detail: smokeBundle?.smoke?.initialized
        ? `${smokeBundle.smoke.toolsCount ?? 0} tools were visible in the last smoke run.`
        : "Run the smoke after bootstrap before handing the install path to a partner."
    },
    {
      id: "runtime",
      label: "Runtime endpoint is configured",
      ready: Boolean(String(runtime.baseUrl ?? "").trim() && String(runtime.apiKey ?? "").trim()),
      detail: String(runtime.baseUrl ?? "").trim() && String(runtime.apiKey ?? "").trim()
        ? "The dashboard is currently pointed at a tenant-scoped Action Wallet runtime."
        : "Keep the dashboard and host pack pointed at the same runtime base URL and API key."
    }
  ];
  const onboardingReadyCount = onboardingChecks.filter((check) => check.ready).length;
  const onboardingNextAction = onboardingChecks.find((check) => !check.ready)?.label ?? "Ready for first governed action";
  const onboardingMetrics = onboardingMetricsState.metrics;
  const onboardingFunnel = onboardingMetrics?.funnel ?? null;
  const onboardingStages = Array.isArray(onboardingFunnel?.stages) ? onboardingFunnel.stages : [];
  const onboardingStageLabels = {
    wizard_viewed: "Open onboarding wizard",
    template_selected: "Select template",
    template_validated: "Validate configuration",
    artifact_generated: "Generate first artifact",
    real_upload_generated: "Run real upload",
    first_verified: "Reach first verified result",
    buyer_link_shared: "Share buyer link",
    referral_signup: "Convert first referral"
  };
  const onboardingNextActionByStage = {
    wizard_viewed: "Open the onboarding path and bootstrap the workspace once.",
    template_selected: "Pick one concrete install path so partners are not choosing between hosts blindly.",
    template_validated: "Finish bootstrap values and verify the runtime can be reused by hosts and CLI.",
    artifact_generated: "Generate one real governed artifact instead of stopping at setup.",
    real_upload_generated: "Run the first real upload or paid call so the workspace stops being theoretical.",
    first_verified: "Push one successful governed action all the way to verified receipt.",
    buyer_link_shared: "Share the hosted approval path or receipt link with a real counterpart.",
    referral_signup: "Drive one external signup or second workspace activation from the same flow."
  };
  const defaultOnboardingStageCount = Object.keys(onboardingStageLabels).length;
  const reachedStages = Number.isFinite(Number(onboardingFunnel?.reachedStages)) ? Number(onboardingFunnel.reachedStages) : onboardingStages.filter((stage) => stage?.reached).length;
  const totalStages = Number.isFinite(Number(onboardingFunnel?.totalStages)) ? Number(onboardingFunnel.totalStages) : onboardingStages.length;
  const completionPct = Number.isFinite(Number(onboardingFunnel?.completionPct)) ? Math.max(0, Math.min(100, Number(onboardingFunnel.completionPct))) : 0;
  const nextStageKey = String(onboardingFunnel?.nextStageKey ?? "").trim() || null;
  const onboardingNextInstruction = nextStageKey ? onboardingNextActionByStage[nextStageKey] ?? `Complete ${humanizeLabel(nextStageKey)}.` : "The onboarding funnel is complete. Keep burn-in evidence, smokes, and host reliability current.";
  const onboardingStatusTone =
    onboardingMetricsState.error
      ? "bad"
      : onboardingMetrics?.status === "active"
        ? "good"
        : onboardingMetrics
          ? "warn"
          : "neutral";
  const activationStatusLabel = onboardingMetrics
    ? humanizeLabel(onboardingMetrics?.status, "pending")
    : buyer?.tenantId
      ? "Pending"
      : "Awaiting workspace";
  const timeToFirstVerifiedLabel = (() => {
    const value = Number(onboardingMetrics?.timeToFirstVerifiedMs);
    if (!Number.isFinite(value) || value < 0) return "Pending";
    const totalMinutes = Math.max(0, Math.round(value / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    return `${minutes}m`;
  })();
  const latestFirstPaidAttempt = firstPaidCallState.latest;
  const firstPaidVerificationLabel = latestFirstPaidAttempt
    ? humanizeLabel(latestFirstPaidAttempt?.verificationStatus, "Pending")
    : "Pending";
  const firstPaidSettlementLabel = latestFirstPaidAttempt
    ? humanizeLabel(latestFirstPaidAttempt?.settlementStatus, "Pending")
    : "Pending";
  const latestFirstPaidRunId = String(latestFirstPaidAttempt?.ids?.runId ?? "").trim();
  const latestFirstPaidReceiptId = String(
    latestFirstPaidAttempt?.ids?.receiptId ??
    latestFirstPaidAttempt?.receiptId ??
    latestFirstPaidAttempt?.settlementReceipt?.receiptId ??
    ""
  ).trim();
  const latestFirstPaidDisputeId = String(
    latestFirstPaidAttempt?.ids?.disputeId ??
    latestFirstPaidAttempt?.disputeId ??
    latestFirstPaidAttempt?.settlement?.disputeId ??
    latestFirstPaidAttempt?.settlementReceipt?.disputeId ??
    ""
  ).trim();
  const selectedFirstPaidAttempt =
    firstPaidCallState.selectedAttemptId
      ? firstPaidCallState.history.find((attempt) => String(attempt?.attemptId ?? "").trim() === firstPaidCallState.selectedAttemptId) ?? null
      : null;
  const focusedFirstPaidAttempt = selectedFirstPaidAttempt ?? latestFirstPaidAttempt ?? null;
  const focusedFirstPaidAttemptId = pickFirstString(focusedFirstPaidAttempt?.attemptId);
  const focusedFirstPaidVerificationLabel = focusedFirstPaidAttempt
    ? humanizeLabel(focusedFirstPaidAttempt?.verificationStatus, "Pending")
    : "Pending";
  const focusedFirstPaidSettlementLabel = focusedFirstPaidAttempt
    ? humanizeLabel(focusedFirstPaidAttempt?.settlementStatus, "Pending")
    : "Pending";
  const focusedFirstPaidRunId = pickFirstString(
    focusedFirstPaidAttempt?.ids?.runId,
    focusedFirstPaidAttempt?.runId,
    focusedFirstPaidAttempt?.run?.runId
  );
  const focusedFirstPaidReceiptId = pickFirstString(
    focusedFirstPaidAttempt?.ids?.receiptId,
    focusedFirstPaidAttempt?.receiptId,
    focusedFirstPaidAttempt?.settlementReceipt?.receiptId,
    focusedFirstPaidAttempt?.receipt?.receiptId
  );
  const focusedFirstPaidDisputeId = pickFirstString(
    focusedFirstPaidAttempt?.ids?.disputeId,
    focusedFirstPaidAttempt?.disputeId,
    focusedFirstPaidAttempt?.settlement?.disputeId,
    focusedFirstPaidAttempt?.settlementReceipt?.disputeId,
    focusedFirstPaidAttempt?.receipt?.dispute?.disputeId
  );
  const focusedFirstPaidApprovalId = pickFirstString(
    focusedFirstPaidAttempt?.ids?.approvalRequestId,
    focusedFirstPaidAttempt?.ids?.approvalId,
    focusedFirstPaidAttempt?.approvalRequestId,
    focusedFirstPaidAttempt?.approvalId,
    focusedFirstPaidAttempt?.approval?.approvalRequestId,
    focusedFirstPaidAttempt?.approval?.approvalId,
    focusedFirstPaidAttempt?.approvalRequest?.approvalRequestId,
    focusedFirstPaidAttempt?.approvalRequest?.approvalId
  );
  const focusedFirstPaidAttemptTone =
    focusedFirstPaidAttempt?.verificationStatus === "green" && focusedFirstPaidAttempt?.settlementStatus === "released"
      ? "good"
      : focusedFirstPaidAttempt
        ? "warn"
        : "neutral";
  const firstPaidTone =
    latestFirstPaidAttempt?.verificationStatus === "green" && latestFirstPaidAttempt?.settlementStatus === "released"
      ? "good"
      : latestFirstPaidAttempt
        ? "warn"
        : "neutral";
  const firstApprovalSharedAt = String(onboardingMetrics?.firstBuyerLinkSharedAt ?? "").trim();
  const hostedApprovalReady = Boolean(firstApprovalSharedAt);
  const conformanceMatrix = conformanceState.matrix?.matrix ?? null;
  const conformanceReadyLabel = conformanceMatrix?.ready === true
    ? "Yes"
    : conformanceMatrix
      ? "Not yet"
      : buyer?.tenantId
        ? "Pending"
        : "Awaiting workspace";
  const conformanceChecks = Array.isArray(conformanceMatrix?.checks) ? conformanceMatrix.checks : [];
  const approvalSurfaceHref = hostedApprovalReady ? "/approvals" : docsLinks.claudeDesktopQuickstart;
  const receiptSurfaceHref = latestFirstPaidReceiptId
    ? `/receipts?selectedReceiptId=${encodeURIComponent(latestFirstPaidReceiptId)}`
    : "/receipts";
  const disputeSurfaceHref = latestFirstPaidDisputeId
    ? `/disputes?selectedDisputeId=${encodeURIComponent(latestFirstPaidDisputeId)}`
    : latestFirstPaidReceiptId
      ? `/receipts?selectedReceiptId=${encodeURIComponent(latestFirstPaidReceiptId)}`
      : latestFirstPaidRunId
        ? `/disputes?runId=${encodeURIComponent(latestFirstPaidRunId)}`
        : "/disputes";
  const focusedApprovalSurfaceHref = focusedFirstPaidApprovalId
    ? `/approvals?selectedApprovalId=${encodeURIComponent(focusedFirstPaidApprovalId)}`
    : approvalSurfaceHref;
  const focusedReceiptSurfaceHref = focusedFirstPaidReceiptId
    ? `/receipts?selectedReceiptId=${encodeURIComponent(focusedFirstPaidReceiptId)}`
    : receiptSurfaceHref;
  const focusedDisputeSurfaceHref = focusedFirstPaidDisputeId
    ? `/disputes?selectedDisputeId=${encodeURIComponent(focusedFirstPaidDisputeId)}`
    : focusedFirstPaidReceiptId
      ? `/receipts?selectedReceiptId=${encodeURIComponent(focusedFirstPaidReceiptId)}`
      : focusedFirstPaidRunId
        ? `/disputes?runId=${encodeURIComponent(focusedFirstPaidRunId)}`
        : disputeSurfaceHref;
  const focusedProofArtifacts = [
    {
      id: "approval",
      label: "Approval",
      value: focusedFirstPaidApprovalId || (hostedApprovalReady ? "Shared approvals live" : "Pending"),
      detail: focusedFirstPaidApprovalId
        ? "Open the approval artifact that authorized this exact attempt."
        : hostedApprovalReady
          ? "The shared approvals surface is live, but this attempt has not bound to a specific approval artifact yet."
          : "The host still needs to create a yellow-state action and land it on the hosted approvals page.",
      href: focusedFirstPaidApprovalId ? focusedApprovalSurfaceHref : hostedApprovalReady ? approvalSurfaceHref : selectedHostTrack.href,
      cta: focusedFirstPaidApprovalId ? "Open approval" : hostedApprovalReady ? "Open approvals" : `Open ${selectedHostTrack.label} guide`
    },
    {
      id: "run",
      label: "Run",
      value: focusedFirstPaidRunId || "Pending",
      detail: focusedFirstPaidRunId
        ? "This run is the canonical execution thread. Keep approval, receipt, and recourse attached to it."
        : "The selected attempt has not emitted a stable run binding yet.",
      href: focusedFirstPaidRunId ? `/runs/${encodeURIComponent(focusedFirstPaidRunId)}` : "#first-live-paid-call",
      cta: focusedFirstPaidRunId ? "Open run" : "Run first paid call"
    },
    {
      id: "receipt",
      label: "Receipt",
      value: focusedFirstPaidReceiptId || "Pending",
      detail: focusedFirstPaidReceiptId
        ? "Receipt is the canonical proof artifact for this attempt."
        : "No receipt is linked yet. Replay or rerun until one receipt is issued.",
      href: focusedReceiptSurfaceHref,
      cta: focusedFirstPaidReceiptId ? "Open receipt" : "Open receipts"
    },
    {
      id: "recourse",
      label: "Recourse",
      value: focusedFirstPaidDisputeId || (focusedFirstPaidReceiptId ? "Validate from receipt" : "Pending"),
      detail: focusedFirstPaidDisputeId
        ? "Recourse is already open on this proof loop."
        : focusedFirstPaidReceiptId
          ? "Open the receipt and confirm the dispute path resolves for the same record."
          : "Recourse only matters once one receipt is live for the run.",
      href: focusedDisputeSurfaceHref,
      cta: focusedFirstPaidDisputeId ? "Open dispute" : focusedFirstPaidReceiptId ? "Verify recourse" : "Open dispute center"
    }
  ];
  const firstGovernedActionSteps = [
    {
      title: "Issue runtime bootstrap",
      detail: bootstrapBundle?.bootstrap?.apiKey?.keyId
        ? `Bootstrap ${bootstrapBundle.bootstrap.apiKey.keyId} is live for ${workspaceTenantLabel}. Reuse this exact runtime bundle for the first host install.`
        : buyer
          ? "Issue Runtime Bootstrap below. This mints the tenant-scoped API key and MCP env the first host will use."
          : "Create or recover the workspace first, then issue Runtime Bootstrap from this page.",
      ready: Boolean(bootstrapBundle?.bootstrap?.apiKey?.keyId),
      href: bootstrapBundle?.bootstrap?.apiKey?.keyId ? "#host-shortcuts" : "#runtime-bootstrap",
      cta: bootstrapBundle?.bootstrap?.apiKey?.keyId ? "Open host shortcuts" : "Issue bootstrap"
    },
    {
      title: "Reach the first hosted approval",
      detail: hostedApprovalReady
        ? `A hosted approval link was already shared at ${formatDateTime(firstApprovalSharedAt)}. Keep the next live decision in the same approvals surface.`
        : smokeBundle?.smoke?.initialized
          ? `Runtime smoke is green with ${smokeBundle.smoke.toolsCount ?? 0} tools visible. Next exact move: install Claude MCP or OpenClaw and trigger one yellow-state action so /approvals receives a live request.`
          : "Run the smoke after bootstrap, then trigger one yellow-state action from Claude MCP or OpenClaw so the hosted approval page receives a real request.",
      ready: hostedApprovalReady,
      href: hostedApprovalReady ? "/approvals" : docsLinks.claudeDesktopQuickstart,
      cta: hostedApprovalReady ? "Open approvals" : "Open Claude quickstart"
    },
    {
      title: "Produce the first receipt",
      detail: latestFirstPaidReceiptId
        ? `Receipt ${latestFirstPaidReceiptId}${latestFirstPaidRunId ? ` is attached to run ${latestFirstPaidRunId}` : ""}. Use it as the canonical proof record for the first governed action.`
        : latestFirstPaidAttempt
          ? `Latest first paid call ${latestFirstPaidAttempt.attemptId ?? "attempt"} ended with verification ${humanizeLabel(latestFirstPaidAttempt.verificationStatus, "unknown")} and settlement ${humanizeLabel(latestFirstPaidAttempt.settlementStatus, "unknown")}, but no receipt is linked yet. Replay or rerun it until one receipt is issued.`
          : "Run the first paid call below to push one governed action from approval through verified receipt.",
      ready: Boolean(latestFirstPaidReceiptId),
      href: latestFirstPaidReceiptId ? receiptSurfaceHref : "#first-live-paid-call",
      cta: latestFirstPaidReceiptId ? "Open receipt" : "Run first paid call"
    },
    {
      title: "Verify dispute and recourse",
      detail: latestFirstPaidDisputeId
        ? `Dispute ${latestFirstPaidDisputeId} is already linked to the first governed action. Keep receipt and recourse on the same run before partner handoff.`
        : latestFirstPaidReceiptId
          ? `Receipt ${latestFirstPaidReceiptId} is live. Next exact move: open that receipt and confirm the dispute / recourse link resolves for the same run before launch.`
          : "Dispute validation starts from a real receipt. Reach the first receipt first, then confirm recourse from that record.",
      ready: Boolean(latestFirstPaidDisputeId),
      href: disputeSurfaceHref,
      cta: latestFirstPaidDisputeId
        ? "Open dispute"
        : latestFirstPaidReceiptId
          ? "Verify recourse from receipt"
          : "Open dispute center"
    }
  ];
  const nextGovernedActionStep = firstGovernedActionSteps.find((step) => !step.ready) ?? null;
  const nextGovernedActionLabel = nextGovernedActionStep ? nextGovernedActionStep.title : "Ready for design-partner burn-in";
  const nextGovernedActionInstruction = nextGovernedActionStep
    ? nextGovernedActionStep.detail
    : "Bootstrap, hosted approval, receipt, and dispute are all linked in this workspace. Keep the same runtime and host contract during burn-in.";
  const signupValidationError = validateWorkspaceSignupForm(signupForm);
  const loginIdentityError = validateWorkspaceLoginIdentity(loginForm);
  const recoveryCodeError = validateWorkspaceRecoveryCode(loginForm);
  const passkeySignupDisabled =
    busyState !== "" ||
    !browserPasskeyReady ||
    authMode?.publicSignupEnabled === false ||
    Boolean(signupValidationError);
  const passkeyLoginDisabled = busyState !== "" || !browserPasskeyReady || Boolean(loginIdentityError);
  const requestOtpDisabled = busyState !== "" || Boolean(loginIdentityError);
  const verifyOtpDisabled = busyState !== "" || Boolean(recoveryCodeError);
  const [selectedHostTrackId, setSelectedHostTrackId] = useState("claude");
  const activationChannels = [
    {
      label: "Claude MCP",
      body: "Primary launch host. Paste the generated MCP config, request one governed action, and verify the approval deep link resolves in the hosted surface.",
      href: docsLinks.claudeDesktopQuickstart
    },
    {
      label: "OpenClaw",
      body: "Package OpenClaw with the same runtime bundle. The approval, receipt, and dispute surfaces should stay identical to the Claude path.",
      href: docsLinks.openClawQuickstart
    },
    {
      label: "Codex / API / CLI",
      body: "Engineering shells should call the same Action Wallet contract and hand users into hosted approval, receipt, and dispute pages instead of inventing new UI.",
      href: docsLinks.codexEngineeringQuickstart
    }
  ];
  const claudeFirstActionSnippet = bootstrapBundle?.bootstrap?.apiKey?.keyId
    ? `# 1) Add the MCP config shown above to Claude Desktop.
# 2) Restart Claude Desktop.
# 3) Ask for one yellow-state action:

"Buy this tool, but ask me before finalizing."

# Success bar:
# - the action creates an intent
# - /approvals receives the request
# - the same run later issues a receipt`
    : `# Issue Runtime Bootstrap first.
# Then copy the MCP config above into Claude Desktop.
# Your first governed action should create a hosted approval request.`;
  const openClawFirstActionSnippet = bootstrapBundle?.bootstrap?.apiKey?.keyId
    ? `# Package OpenClaw with the same runtime values.
# Then trigger one governed action that must ask first:

openclaw run --goal "Cancel this unused subscription, but require approval first"

# Success bar:
# - the same tenant-scoped runtime is used
# - /approvals opens the live decision
# - /receipts later shows the finished record`
    : `# Issue Runtime Bootstrap first.
# Then package OpenClaw with the generated runtime values.
# Keep approval, receipt, and dispute on the hosted Nooterra surfaces.`;
  const codexFirstActionSnippet = bootstrapBundle?.bootstrap?.apiKey?.keyId
    ? `${exportCommands}

# Create one governed action from Codex / CLI / app code.
curl -X POST "$NOOTERRA_BASE_URL/v1/action-intents" \\
  -H "Authorization: Bearer $NOOTERRA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "actionType": "buy",
    "summary": "Replacement charger under approval",
    "risk": "medium",
    "approvalMode": "required"
  }'

# Success bar:
# - the intent is accepted
# - the hosted approval page receives the request
# - the resulting run later binds to a receipt`
    : `# Issue Runtime Bootstrap first.
# Then export the runtime values into Codex, CLI, or your app process.
# Your first call should produce a hosted approval request, not a silent direct action.`;
  const hostShortcutTracks = [
    {
      id: "claude",
      icon: Cable,
      label: "Claude MCP",
      summary: "Primary launch host. Copy the generated MCP config, ask for one yellow-state action, and confirm the hosted approval page receives it.",
      href: docsLinks.claudeDesktopQuickstart,
      guideLabel: "Claude guide",
      snippet: claudeFirstActionSnippet,
      success: hostedApprovalReady
        ? "Hosted approval is already live. Keep the next decision on the same approvals surface."
        : "Target: one yellow-state action lands in /approvals from Claude Desktop."
    },
    {
      id: "openclaw",
      icon: GitBranchPlus,
      label: "OpenClaw",
      summary: "Second launch host. Reuse the same runtime bundle and prove approval, receipt, and dispute stay identical to the Claude path.",
      href: docsLinks.openClawQuickstart,
      guideLabel: "OpenClaw guide",
      snippet: openClawFirstActionSnippet,
      success: latestFirstPaidReceiptId
        ? `Receipt ${latestFirstPaidReceiptId} proves the hosted surfaces are already binding to a live run.`
        : "Target: one approved run later issues a receipt on the same hosted Action Wallet path."
    },
    {
      id: "codex",
      icon: SquareTerminal,
      label: "Codex / API / CLI",
      summary: "Engineering shells should call the same Action Wallet contract and hand users into hosted approval, receipt, and dispute pages instead of inventing new UI.",
      href: docsLinks.codexEngineeringQuickstart,
      guideLabel: "Codex guide",
      snippet: codexFirstActionSnippet,
      success: latestFirstPaidRunId
        ? `Run ${latestFirstPaidRunId} is the canonical thread. Keep approval, receipt, and recourse attached to that same run.`
        : "Target: one API or CLI-created intent hands off to hosted approval instead of a shell-only flow."
    }
  ];
  const selectedHostTrack = hostShortcutTracks.find((track) => track.id === selectedHostTrackId) ?? hostShortcutTracks[0];
  const selectedHostTrackCtaHref =
    !buyer
      ? "#identity-access"
      : !bootstrapBundle?.bootstrap?.apiKey?.keyId
        ? "#runtime-bootstrap"
        : selectedHostTrack.href;
  const selectedHostTrackCtaLabel =
    !buyer
      ? "Create workspace"
      : !bootstrapBundle?.bootstrap?.apiKey?.keyId
        ? "Issue bootstrap"
        : selectedHostTrack.guideLabel;
  const selectedHostTrackSteps = [
    {
      title: "Issue the shared runtime",
      detail: bootstrapBundle?.bootstrap?.apiKey?.keyId
        ? `Runtime ${bootstrapBundle.bootstrap.apiKey.keyId} is already live. Keep ${selectedHostTrack.label} on this exact tenant bundle.`
        : "Create the workspace and issue Runtime Bootstrap before you touch any host install path.",
      ready: Boolean(bootstrapBundle?.bootstrap?.apiKey?.keyId)
    },
    {
      title: `Trigger approval from ${selectedHostTrack.label}`,
      detail: hostedApprovalReady
        ? `Hosted approval is already live. The next ${selectedHostTrack.label} action should reuse the same approvals surface instead of generating a new ad hoc flow.`
        : selectedHostTrack.id === "claude"
          ? "Install the Claude MCP config, restart the host, and ask for one yellow-state action so /approvals receives a live request."
          : selectedHostTrack.id === "openclaw"
            ? "Package OpenClaw with the current runtime exports and run one approval-required action so the hosted approvals page gets a real request."
            : "Use the API/CLI snippet to create one medium-risk intent and confirm the response opens hosted approval instead of doing the action inline.",
      ready: hostedApprovalReady
    },
    {
      title: "Close with receipt and recourse",
      detail: latestFirstPaidReceiptId
        ? latestFirstPaidDisputeId
          ? `Receipt ${latestFirstPaidReceiptId} and dispute ${latestFirstPaidDisputeId} are both attached. The proof loop is complete for this runtime.`
          : `Receipt ${latestFirstPaidReceiptId} is live. Open it, verify recourse from the same record, and only then call the first-host path done.`
        : "Run the first paid call from this workspace until it binds to one receipt. The host path is not proven until receipt and recourse both exist.",
      ready: Boolean(latestFirstPaidReceiptId)
    }
  ];
  const selectedHostTrackProgressCount = selectedHostTrackSteps.filter((step) => step.ready).length;
  const firstActionPrimaryHref =
    !buyer
      ? "#identity-access"
      : !bootstrapBundle?.bootstrap?.apiKey?.keyId
        ? "#runtime-bootstrap"
        : !hostedApprovalReady
          ? selectedHostTrack.href
          : !latestFirstPaidReceiptId
            ? "#first-live-paid-call"
            : latestFirstPaidDisputeId
              ? disputeSurfaceHref
              : receiptSurfaceHref;
  const firstActionPrimaryLabel =
    !buyer
      ? "Create workspace"
      : !bootstrapBundle?.bootstrap?.apiKey?.keyId
        ? "Issue bootstrap"
        : !hostedApprovalReady
          ? `Open ${selectedHostTrack.label} guide`
          : !latestFirstPaidReceiptId
            ? "Run first paid call"
            : latestFirstPaidDisputeId
              ? "Open dispute"
              : "Open first receipt";

  return (
    <div className="product-page">
      <section className="product-page-top product-onboarding-top">
        <div>
          <p className="product-kicker">Workspace Onboarding</p>
          <h1>Turn a new account into a live Action Wallet workspace.</h1>
          <p className="product-lead">
            Signup, recovery, runtime bootstrap, hosted approval setup, and launch-channel config all happen from one page. This is the activation path for host-first Action Wallet installs.
          </p>
        </div>
        <div className="product-page-top-actions">
          {!buyer ? (
            <a className="product-button product-button-ghost" href={docsLinks.hostQuickstart}>
              Open install path
            </a>
          ) : null}
          {buyer ? (
            <button className="product-button product-button-ghost" disabled={busyState !== ""} onClick={() => void handleLogout()}>
              {busyState === "logout" ? "Signing out..." : "Sign Out"}
            </button>
          ) : null}
          <a className="product-button product-button-solid" href={buyer ? "/wallet" : "#identity-access"}>
            {buyer ? "Continue To Wallet" : "Create workspace"}
          </a>
        </div>
      </section>

      <section className="product-metric-grid product-onboarding-metric-grid">
        <article className="product-metric-card">
          <span>Readiness</span>
          <strong>{onboardingReadyCount} / {onboardingChecks.length}</strong>
          <small>Core checks from account creation to first approval.</small>
        </article>
        <article className="product-metric-card">
          <span>Next action</span>
          <strong>{nextGovernedActionLabel}</strong>
          <small>{nextGovernedActionStep ? "The next exact move from bootstrap to first live receipt." : "The first governed action path is fully linked in this workspace."}</small>
        </article>
        <article className="product-metric-card">
          <span>Certified hosts</span>
          <strong>2</strong>
          <small>Claude MCP and OpenClaw remain the locked launch hosts.</small>
        </article>
        <article className="product-metric-card">
          <span>Shared runtime</span>
          <strong>{bootstrapBundle?.bootstrap?.apiKey?.keyId ? "Live" : "Pending"}</strong>
          <small>Codex, CLI, and API all reuse the same Action Wallet runtime contract.</small>
        </article>
      </section>

      <section className="product-grid-two product-onboarding-activation-grid">
        <article className="product-card product-card-emphasis">
          <div className="product-section-head compact">
            <p>Launch readiness</p>
            <h2>See whether this workspace is actually ready for first approval, first receipt, and first dispute.</h2>
          </div>
          <div className="product-step-list">
            {onboardingChecks.map((check) => (
              <div key={`onboarding_check:${check.id}`} className="product-step-item">
                <div className="product-step-copy">
                  <strong>{check.label}</strong>
                  <span>{check.detail}</span>
              </div>
              <StatusPill value={check.ready ? "active" : "pending"} />
            </div>
          ))}
          </div>
          <div className="product-detail-meta">
            <div>
              <strong>Activation</strong>
              <span>{activationStatusLabel}</span>
            </div>
            <div>
              <strong>Funnel</strong>
              <span>{reachedStages} / {totalStages || defaultOnboardingStageCount}</span>
            </div>
            <div>
              <strong>First verified</strong>
              <span>{onboardingMetrics?.firstVerifiedAt ? formatDateTime(onboardingMetrics.firstVerifiedAt) : "Pending"}</span>
            </div>
            <div>
              <strong>Time to verified</strong>
              <span>{timeToFirstVerifiedLabel}</span>
            </div>
          </div>
          <div className={`product-inline-note ${onboardingStatusTone}`}>
            {onboardingMetricsState.error
              ? `Activation telemetry unavailable: ${onboardingMetricsState.error}`
              : onboardingMetrics
                ? `Activation is ${humanizeLabel(onboardingMetrics.status, "pending")} with funnel completion at ${completionPct}%. ${onboardingNextInstruction}`
                : "Activation telemetry will appear once a tenant is active and the auth service is reachable."}
          </div>
          <div className="product-actions">
            <button className="product-button product-button-ghost" disabled={busyState !== "" || !buyer?.tenantId} onClick={() => void refreshOnboardingMetrics().catch(() => {})}>
              {onboardingMetricsState.loading && busyState === "" ? "Refreshing telemetry..." : "Refresh telemetry"}
            </button>
          </div>
          {onboardingStages.length ? (
            <div className="product-step-list">
              {onboardingStages.map((stage, index) => {
                const stageKey = String(stage?.stageKey ?? "").trim();
                const stageLabel = onboardingStageLabels[stageKey] ?? humanizeLabel(stageKey, `Stage ${index + 1}`);
                const reached = stage?.reached === true;
                return (
                  <div key={`onboarding_stage:${stageKey || index}`} className="product-step-item">
                    <div className="product-step-copy">
                      <strong>{stageLabel}</strong>
                      <span>{reached ? `Completed ${stage?.at ? formatDateTime(stage.at) : "recently"}` : `Pending${stageKey === nextStageKey ? " · next critical step" : ""}`}</span>
                    </div>
                    <StatusPill value={reached ? "active" : stageKey === nextStageKey ? "warn" : "pending"} />
                  </div>
                );
              })}
            </div>
          ) : null}
        </article>

        <article className="product-card product-card-spotlight" id="first-governed-action">
          <div className="product-section-head compact">
            <p>First governed action</p>
            <h2>Walk one run all the way from runtime bootstrap to approval, receipt, and dispute.</h2>
          </div>
          <div className={`product-inline-note ${nextGovernedActionStep ? "accent" : "good"}`}>
            {nextGovernedActionStep ? `Next exact step: ${nextGovernedActionInstruction}` : nextGovernedActionInstruction}
          </div>
          <div className="product-detail-meta">
            <div>
              <strong>Runtime bundle</strong>
              <span>{bootstrapBundle?.bootstrap?.apiKey?.keyId ?? "Not issued yet"}</span>
            </div>
            <div>
              <strong>Approval route</strong>
              <span>{hostedApprovalReady ? formatDateTime(firstApprovalSharedAt) : smokeBundle?.smoke?.initialized ? "Smoke green · waiting on live approval" : "Not proven yet"}</span>
            </div>
            <div>
              <strong>Receipt route</strong>
              <span>{latestFirstPaidReceiptId || "Not issued yet"}</span>
            </div>
            <div>
              <strong>Dispute route</strong>
              <span>{latestFirstPaidDisputeId || (latestFirstPaidReceiptId ? "Validate from receipt" : "Pending")}</span>
            </div>
          </div>
          <div className="product-step-list">
            {firstGovernedActionSteps.map((step, index) => (
              <div key={`first_governed_action:${step.title}`} className="product-step-item">
                <div className="product-step-copy">
                  <strong>{index + 1}. {step.title}</strong>
                  <span>{step.detail}</span>
                </div>
                <StatusPill value={step.ready ? "active" : "pending"} />
              </div>
            ))}
          </div>
          <div className="product-actions">
            <button
              className="product-button product-button-solid"
              disabled={busyState !== "" || !buyer?.tenantId || !runtime.baseUrl || !runtime.apiKey}
              onClick={() => void handleCreateFirstHostedApproval()}
            >
              {busyState === "seed_approval" ? "Creating approval..." : "Create hosted approval"}
            </button>
            <a className="product-button product-button-solid" href={firstActionPrimaryHref}>
              {firstActionPrimaryLabel}
            </a>
            <a className="product-button product-button-ghost" href={approvalSurfaceHref}>Open approvals</a>
            <a className="product-button product-button-ghost" href={receiptSurfaceHref}>
              {latestFirstPaidReceiptId ? "Open first receipt" : "Open receipts"}
            </a>
            <a className="product-button product-button-ghost" href={disputeSurfaceHref}>
              {latestFirstPaidDisputeId ? "Open dispute" : "Open recourse"}
            </a>
          </div>
          <CodeBlock
            title="Shared runtime contract"
            code={builderCliSnippet}
            hint="Every host should point at one runtime, one approval surface, and one receipt trail."
          />
          <div className="product-section-head compact">
            <p>Pick one host</p>
            <h2>Run the first proof loop on a single launch path before widening scope.</h2>
          </div>
          <div className="product-option-grid">
            {hostShortcutTracks.map((track) => {
              const Icon = track.icon;
              const isActive = track.id === selectedHostTrack.id;
              return (
                <button
                  key={`host_track_option:${track.id}`}
                  type="button"
                  className={`product-option-card${isActive ? " active" : ""}`}
                  onClick={() => setSelectedHostTrackId(track.id)}
                >
                  <div className="product-mini-card-head">
                    <Icon size={18} />
                    <span>{track.label}</span>
                  </div>
                  <strong>{track.guideLabel}</strong>
                  <span>{track.summary}</span>
                </button>
              );
            })}
          </div>
          <div className="product-grid-two product-onboarding-host-runbook">
            <div className="product-card product-card-emphasis">
              <div className="product-section-head compact">
                <p>{selectedHostTrack.label}</p>
                <h2>Current activation track</h2>
              </div>
              <div className="product-detail-meta">
                <div>
                  <strong>Host</strong>
                  <span>{selectedHostTrack.label}</span>
                </div>
                <div>
                  <strong>Progress</strong>
                  <span>{selectedHostTrackProgressCount} / {selectedHostTrackSteps.length}</span>
                </div>
                <div>
                  <strong>Approval</strong>
                  <span>{hostedApprovalReady ? "Live" : "Pending"}</span>
                </div>
                <div>
                  <strong>Receipt</strong>
                  <span>{latestFirstPaidReceiptId || "Pending"}</span>
                </div>
              </div>
              <div className="product-step-list">
                {selectedHostTrackSteps.map((step, index) => (
                  <div key={`selected_host_track_step:${selectedHostTrack.id}:${step.title}`} className="product-step-item">
                    <div className="product-step-copy">
                      <strong>{index + 1}. {step.title}</strong>
                      <span>{step.detail}</span>
                    </div>
                    <StatusPill value={step.ready ? "active" : "pending"} />
                  </div>
                ))}
              </div>
              <div className="product-inline-note product-inline-note-plain">
                <strong>Success bar</strong>
                <span>{selectedHostTrack.success}</span>
              </div>
              <div className="product-actions">
                <button
                  className="product-button product-button-ghost"
                  disabled={busyState !== "" || !buyer?.tenantId || !runtime.baseUrl || !runtime.apiKey}
                  onClick={() => void handleCreateFirstHostedApproval()}
                >
                  {busyState === "seed_approval" ? "Creating approval..." : "Seed approval"}
                </button>
                <a className="product-button product-button-solid" href={selectedHostTrackCtaHref}>
                  {selectedHostTrackCtaLabel}
                </a>
                <button
                  className="product-button product-button-ghost"
                  disabled={!selectedHostTrack.snippet}
                  onClick={() => void handleCopy(selectedHostTrack.snippet, `${selectedHostTrack.label} first action`)}
                >
                  Copy first action
                </button>
              </div>
            </div>
            <CodeBlock
              title={`${selectedHostTrack.label} first action`}
              code={selectedHostTrack.snippet}
              hint="Do the minimum thing that proves this host can create an intent, open hosted approval, and later bind to one receipt."
            />
          </div>
          <div className="product-access-grid">
            {activationChannels.map((channel) => (
              <div key={`activation_channel:${channel.label}`} className="product-access-card">
                <div className="product-mini-card-head">
                  <ShieldCheck size={18} />
                  <span>{channel.label}</span>
                </div>
                <p>{channel.body}</p>
                <div className="product-actions">
                  <a className="product-button product-button-ghost" href={channel.href}>Open path</a>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="product-grid-two product-onboarding-proof-grid">
        <article className="product-card product-card-emphasis" id="first-live-paid-call">
          <div className="product-section-head compact">
            <p>First live paid call</p>
            <h2>Run the first end-to-end proof from this workspace and keep the attempt history visible.</h2>
          </div>
          <div className="product-detail-meta">
            <div>
              <strong>Latest attempt</strong>
              <span>{latestFirstPaidAttempt?.attemptId ?? "Not run yet"}</span>
            </div>
            <div>
              <strong>Verification</strong>
              <span>{firstPaidVerificationLabel}</span>
            </div>
            <div>
              <strong>Settlement</strong>
              <span>{firstPaidSettlementLabel}</span>
            </div>
            <div>
              <strong>Saved attempts</strong>
              <span>{firstPaidCallState.history.length}</span>
            </div>
          </div>
          <div className={`product-inline-note ${firstPaidTone}`}>
            {latestFirstPaidAttempt
              ? `Latest attempt ${latestFirstPaidAttempt.attemptId ?? "n/a"} ended with verification ${firstPaidVerificationLabel.toLowerCase()} and settlement ${firstPaidSettlementLabel.toLowerCase()}.`
              : "Use this to prove the first real Action Wallet flow from bootstrap to released settlement without leaving onboarding."}
          </div>
          <div className={`product-inline-note ${focusedFirstPaidAttemptTone}`}>
            {focusedFirstPaidAttempt
              ? `Focused attempt ${focusedFirstPaidAttemptId || "n/a"} is the active proof loop with verification ${focusedFirstPaidVerificationLabel.toLowerCase()} and settlement ${focusedFirstPaidSettlementLabel.toLowerCase()}.`
              : "Pick or run one attempt, then keep the same approval, run, receipt, and recourse chain visible below."}
          </div>
          {firstPaidCallState.error ? <div className="product-inline-note bad">{firstPaidCallState.error}</div> : null}
          <div className="product-actions">
            <button className="product-button product-button-solid" disabled={busyState !== "" || !buyer?.tenantId} onClick={() => void handleRunFirstPaidCall()}>
              {busyState === "first_paid" ? "Running..." : "Run first paid call"}
            </button>
            <button className="product-button product-button-ghost" disabled={busyState !== "" || !buyer?.tenantId} onClick={() => void refreshFirstPaidHistory()}>
              {firstPaidCallState.loading && busyState === "" ? "Refreshing..." : "Refresh history"}
            </button>
            <button
              className="product-button product-button-ghost"
              disabled={busyState !== "" || !buyer?.tenantId || !firstPaidCallState.selectedAttemptId}
              onClick={() => void handleRunFirstPaidCall({ replayAttemptId: firstPaidCallState.selectedAttemptId })}
            >
              {busyState === "first_paid_replay" ? "Replaying..." : "Replay selected"}
            </button>
          </div>
          <div className="product-form-grid">
            <label className="wide">
              <span>Attempt history</span>
              <select
                value={firstPaidCallState.selectedAttemptId}
                onChange={(event) => setFirstPaidCallState((previous) => ({ ...previous, selectedAttemptId: event.target.value }))}
              >
                <option value="">No attempts yet</option>
                {firstPaidCallState.history.slice().reverse().map((attempt) => {
                  const attemptId = String(attempt?.attemptId ?? "").trim();
                  if (!attemptId) return null;
                  const startedAt = attempt?.startedAt ? formatDateTime(attempt.startedAt) : "time unavailable";
                  const status = humanizeLabel(attempt?.status, "unknown");
                  const runId = String(attempt?.ids?.runId ?? "n/a");
                  return (
                    <option key={`first_paid_attempt:${attemptId}`} value={attemptId}>
                      {startedAt} · {status} · {runId}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
          <div className="product-access-grid product-onboarding-proof-artifacts">
            {focusedProofArtifacts.map((artifact) => (
              <div key={`focused_proof_artifact:${artifact.id}`} className="product-access-card product-access-card-activation">
                <div className="product-mini-card-head">
                  <ShieldCheck size={18} />
                  <span>{artifact.label}</span>
                </div>
                <strong>{artifact.value}</strong>
                <p>{artifact.detail}</p>
                <div className="product-actions">
                  <a className="product-button product-button-ghost" href={artifact.href}>{artifact.cta}</a>
                </div>
              </div>
            ))}
          </div>
          {(latestFirstPaidRunId || latestFirstPaidReceiptId) ? (
            <div className="product-actions">
              {latestFirstPaidRunId ? <a className="product-button product-button-ghost" href={`/runs/${encodeURIComponent(latestFirstPaidRunId)}`}>Open run</a> : null}
              {latestFirstPaidReceiptId ? <a className="product-button product-button-ghost" href={`/receipts?selectedReceiptId=${encodeURIComponent(latestFirstPaidReceiptId)}`}>Open receipt</a> : null}
              {latestFirstPaidRunId ? <a className="product-button product-button-ghost" href={`/disputes?runId=${encodeURIComponent(latestFirstPaidRunId)}`}>Open dispute state</a> : null}
            </div>
          ) : null}
          {latestFirstPaidAttempt ? (
            <details className="product-details">
              <summary>Latest first paid call payload</summary>
              <pre><code>{prettyJson(latestFirstPaidAttempt)}</code></pre>
            </details>
          ) : null}
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Runtime conformance</p>
            <h2>Run the launch-host matrix and keep failing checks visible on the same page.</h2>
          </div>
          <div className="product-detail-meta">
            <div>
              <strong>Run</strong>
              <span>{conformanceMatrix?.runId ?? "Not run yet"}</span>
            </div>
            <div>
              <strong>Ready</strong>
              <span>{conformanceReadyLabel}</span>
            </div>
            <div>
              <strong>Checks</strong>
              <span>{conformanceChecks.length}</span>
            </div>
            <div>
              <strong>Targets</strong>
              <span>{Array.isArray(conformanceMatrix?.targets) ? conformanceMatrix.targets.length : 0}</span>
            </div>
          </div>
          <div className={`product-inline-note ${conformanceMatrix?.ready === true ? "good" : conformanceMatrix ? "warn" : "neutral"}`}>
            {conformanceMatrix
              ? conformanceMatrix.ready
                ? "Conformance is green for the current onboarding target set."
                : "Conformance completed but at least one launch-host or runtime check still needs attention."
              : "Run the conformance matrix after bootstrap to verify runtime bootstrap, smoke, and first paid flow together."}
          </div>
          <div className="product-inline-note product-inline-note-plain">
            <strong>Current launch target</strong>
            <span>Keep conformance green for {selectedHostTrack.label} before widening to additional hosts or surfaces.</span>
          </div>
          {conformanceState.error ? <div className="product-inline-note bad">{conformanceState.error}</div> : null}
          <div className="product-actions">
            <button className="product-button product-button-solid" disabled={busyState !== "" || !buyer?.tenantId} onClick={() => void handleRunConformanceMatrix()}>
              {busyState === "conformance" ? "Running..." : "Run conformance matrix"}
            </button>
          </div>
          {conformanceChecks.length ? (
            <div className="product-step-list">
              {conformanceChecks.map((check, index) => (
                <div key={`conformance_check:${check?.checkId ?? index}`} className="product-step-item">
                  <div className="product-step-copy">
                    <strong>{humanizeLabel(check?.checkId, "Check")}</strong>
                    <span>{check?.message ?? check?.detail ?? "No detail provided."}</span>
                  </div>
                  <StatusPill value={String(check?.status ?? "").trim().toLowerCase() === "pass" ? "active" : "failed"} />
                </div>
              ))}
            </div>
          ) : null}
          {conformanceState.matrix ? (
            <details className="product-details">
              <summary>Conformance payload</summary>
              <pre><code>{prettyJson(conformanceState.matrix)}</code></pre>
            </details>
          ) : null}
        </article>
      </section>

      <section className="product-grid-two product-onboarding-setup-grid">
        <article className="product-card product-card-emphasis" id="identity-access">
          <div className="product-section-head compact">
            <p>Identity + Access</p>
            <h2>Create or recover a workspace.</h2>
          </div>
          <div className="product-badge-row">
            <span className="product-badge">Primary: passkey</span>
            <span className="product-badge subtle">Recovery: email OTP</span>
          </div>
          <div className="product-sidebar-list">
            <div>
              <strong>Auth mode</strong>
              <span>{authMode?.guidance ?? `Auth plane ${runtime.authBaseUrl}`}</span>
            </div>
            <div>
              <strong>Session</strong>
              <span>{buyer ? `${buyer.email} (${buyer.role}) in ${buyer.tenantId}` : "No active buyer session yet."}</span>
            </div>
            <div>
              <strong>Saved device passkey</strong>
              <span>
                {storedPasskey
                  ? `${storedPasskey.label || "Current browser"} for ${storedPasskey.email} in ${storedPasskey.tenantId}`
                  : "No saved same-device passkey detected for the current tenant/email."}
              </span>
            </div>
            <div>
              <strong>Runtime</strong>
              <span>{bootstrapBundle?.bootstrap?.apiKey?.keyId ? `Issued ${bootstrapBundle.bootstrap.apiKey.keyId}` : "Not bootstrapped yet."}</span>
            </div>
          </div>
          <div className={`product-inline-note ${browserPasskeyReady ? "accent" : "warn"}`}>
            {browserPasskeyReady
              ? "Passkey is the primary path. This browser can hold a device key for same-device Action Wallet sign-in; email OTP stays available as recovery when the device key is missing."
              : "Passkey is the primary path, but this browser cannot create or prove the saved device key. Use recovery OTP or switch to a browser with Web Crypto support."}
          </div>
          <div className="product-form-grid">
            {authMode?.publicSignupEnabled !== false ? (
              <>
                <label>
                  <span>Work email</span>
                  <input
                    value={signupForm.email}
                    onChange={(event) => setSignupForm((previous) => ({ ...previous, email: event.target.value }))}
                    placeholder="founder@company.com"
                  />
                </label>
                <label>
                  <span>Company</span>
                  <input
                    value={signupForm.company}
                    onChange={(event) => setSignupForm((previous) => ({ ...previous, company: event.target.value }))}
                    placeholder="Acme AI"
                  />
                </label>
                <label>
                  <span>Full name</span>
                  <input
                    value={signupForm.fullName}
                    onChange={(event) => setSignupForm((previous) => ({ ...previous, fullName: event.target.value }))}
                    placeholder="Founder Name"
                  />
                </label>
                <label>
                  <span>Tenant slug (optional)</span>
                  <input
                    value={signupForm.tenantId}
                    onChange={(event) => setSignupForm((previous) => ({ ...previous, tenantId: event.target.value }))}
                    placeholder="acme_ai"
                  />
                </label>
              </>
            ) : (
              <div className="product-inline-note bad">
                Public signup is disabled on this control plane. Use an existing tenant with a saved device passkey or the recovery path below.
              </div>
            )}
            <label>
              <span>Existing tenant</span>
              <input
                value={loginForm.tenantId}
                onChange={(event) => setLoginForm((previous) => ({ ...previous, tenantId: event.target.value }))}
                placeholder="tenant_acme"
              />
            </label>
            <label>
              <span>Sign-in email</span>
              <input
                value={loginForm.email}
                onChange={(event) => setLoginForm((previous) => ({ ...previous, email: event.target.value }))}
                placeholder="founder@company.com"
              />
            </label>
            <label>
              <span>Device label</span>
              <input
                value={passkeyForm.label}
                onChange={(event) => setPasskeyForm((previous) => ({ ...previous, label: event.target.value }))}
                placeholder="Founder laptop"
              />
            </label>
          </div>
          <div className="product-actions">
            {authMode?.publicSignupEnabled !== false ? (
              <button className="product-button product-button-ghost" disabled={passkeySignupDisabled} onClick={() => void handlePasskeySignup()}>
                {busyState === "passkey_signup" ? "Creating..." : "Create Workspace + Save Passkey"}
              </button>
            ) : null}
            <button className="product-button product-button-solid" disabled={passkeyLoginDisabled} onClick={() => void handlePasskeyLogin()}>
              {busyState === "passkey_login" ? "Signing in..." : "Sign In With Saved Passkey"}
            </button>
          </div>
          {authMode?.publicSignupEnabled !== false && signupValidationError ? (
            <div className="product-inline-note warn">{signupValidationError}</div>
          ) : null}
          {loginIdentityError ? <div className="product-inline-note warn">{loginIdentityError}</div> : null}
          <details className="product-details">
            <summary>Recovery by email</summary>
            <div className="product-inline-note warn">
              Recovery is for a new browser, lost device key, or registry mismatch. Use the same tenant and sign-in email above, then request and verify a six-digit code.
            </div>
            <div className="product-form-grid">
              <label className="wide">
                <span>Recovery code</span>
                <input
                  value={loginForm.code}
                  onChange={(event) => setLoginForm((previous) => ({ ...previous, code: event.target.value }))}
                  inputMode="numeric"
                  placeholder="123456"
                />
              </label>
            </div>
            <div className="product-actions">
              <button className="product-button product-button-ghost" disabled={requestOtpDisabled} onClick={() => void handleRequestOtp()}>
                {busyState === "otp" ? "Issuing..." : "Request Recovery Code"}
              </button>
              <button className="product-button product-button-ghost" disabled={verifyOtpDisabled} onClick={() => void handleVerifyOtp()}>
                {busyState === "verify" ? "Verifying..." : "Use Recovery Code"}
              </button>
            </div>
            {recoveryCodeError ? <div className="product-inline-note warn">{recoveryCodeError}</div> : null}
          </details>
          <div className="product-inline-note">{statusMessage}</div>
        </article>

        <article className="product-card product-card-emphasis" id="runtime-bootstrap">
          <div className="product-section-head compact">
            <p>Runtime Bootstrap</p>
            <h2>Issue the API key + MCP bundle the product actually needs.</h2>
          </div>
          <div className="product-form-grid">
            <label>
              <span>API key ID (optional)</span>
              <input
                value={runtimeForm.apiKeyId}
                onChange={(event) => setRuntimeForm((previous) => ({ ...previous, apiKeyId: event.target.value }))}
                placeholder="ak_dashboard"
              />
            </label>
            <label className="wide">
              <span>Scopes (optional)</span>
              <input
                value={runtimeForm.scopes}
                onChange={(event) => setRuntimeForm((previous) => ({ ...previous, scopes: event.target.value }))}
                placeholder="Leave blank for server defaults"
              />
            </label>
            <label className="wide">
              <span>Paid tools base URL (optional)</span>
              <input
                value={runtimeForm.paidToolsBaseUrl}
                onChange={(event) => setRuntimeForm((previous) => ({ ...previous, paidToolsBaseUrl: event.target.value }))}
                placeholder="https://paid.tools.nooterra.work"
              />
            </label>
          </div>
          <div className="product-actions">
            <button className="product-button product-button-solid" disabled={busyState !== ""} onClick={() => void handleRuntimeBootstrap()}>
              {busyState === "bootstrap" ? "Bootstrapping..." : "Issue Runtime Bootstrap"}
            </button>
            <button className="product-button product-button-ghost" disabled={busyState !== "" || !bootstrapBundle?.mcp?.env} onClick={() => void handleSmokeRetest()}>
              {busyState === "smoke" ? "Testing..." : "Run Smoke Test"}
            </button>
          </div>
          <div className="product-sidebar-list">
            <div>
              <strong>Tenant</strong>
              <span>{workspaceTenantLabel}</span>
            </div>
            <div>
              <strong>API key</strong>
              <span>{bootstrapBundle?.bootstrap?.apiKey?.keyId ?? "Not issued"} · {maskToken(runtime.apiKey)}</span>
            </div>
            <div>
              <strong>Smoke status</strong>
              <span>
                {smokeBundle?.smoke?.initialized
                  ? `${smokeBundle.smoke.toolsCount ?? 0} tools visible`
                  : "Smoke test not green yet."}
              </span>
            </div>
          </div>
        </article>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>IDE Connect</p>
            <h2>Claude MCP and OpenClaw share the same runtime credentials.</h2>
          </div>
          <div className="product-actions">
            <button className="product-button product-button-ghost" disabled={!bootstrapBundle?.mcpConfigJson} onClick={() => void handleCopy(mcpConfigSnippet, "MCP config")}>
              Copy MCP Config
            </button>
            <button className="product-button product-button-ghost" disabled={!bootstrapBundle?.bootstrap?.exportCommands} onClick={() => void handleCopy(exportCommands, "Shell exports")}>
              Copy Shell Exports
            </button>
          </div>
          <CodeBlock title="MCP Configuration" code={mcpConfigSnippet} hint="Paste this into the Claude MCP config, or reuse the same runtime values when packaging OpenClaw." />
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Host Runtime</p>
            <h2>Keep the launch channels pointed at the same trusted runtime.</h2>
          </div>
          <div className="product-sidebar-list">
            <div>
              <strong>API base</strong>
              <span>{runtime.baseUrl}</span>
            </div>
            <div>
              <strong>Buyer</strong>
              <span>{buyer ? `${buyer.email} (${buyer.role})` : "Authenticate first"}</span>
            </div>
            <div>
              <strong>Issued at</strong>
              <span>{formatDateTime(bootstrapBundle?.bootstrap?.apiKey?.issuedAt ?? bootstrapBundle?.bootstrap?.apiKey?.createdAt)}</span>
            </div>
          </div>
          <CodeBlock title="Shell Exports" code={exportCommands} hint="Use this in Terminal or any hosted worker environment that needs the Action Wallet runtime values." />
          <CodeBlock title="Host Runtime Notes" code={builderCliSnippet} hint="Keep the host runtime deterministic and attached to the same tenant credentials." />
        </article>
      </section>

      <section className="product-card product-onboarding-host-shortcuts" id="host-shortcuts">
        <div className="product-section-head compact">
          <p>Host shortcuts</p>
          <h2>After bootstrap, move directly into the shell you want and finish one governed action end to end.</h2>
        </div>
        <div className="product-access-grid">
          {hostShortcutTracks.map((track) => {
            const Icon = track.icon;
            return (
              <div key={`host_shortcut:${track.id}`} className="product-access-card product-access-card-activation">
                <div className="product-mini-card-head">
                  <Icon size={18} />
                  <span>{track.label}</span>
                </div>
                <p>{track.summary}</p>
                <div className="product-inline-note product-inline-note-plain">
                  <strong>Success bar</strong>
                  <span>{track.success}</span>
                </div>
                <CodeBlock
                  title={`${track.label} first action`}
                  code={track.snippet}
                  hint="Do the minimum thing that proves the same runtime can create an intent, open hosted approval, and later bind to a receipt."
                />
                <div className="product-actions">
                  <a className="product-button product-button-ghost" href={track.href}>{track.guideLabel}</a>
                  <a className="product-button product-button-ghost" href={docsLinks.hostQuickstart}>Launch host guide</a>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function normalizeLowercaseTokenList(rawValue) {
  const seen = new Set();
  const out = [];
  for (const value of parseCapabilityList(rawValue)) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function buildStudioProviderDraft({ profile, agentDraft, tenantId, endpointBaseUrl = "" } = {}) {
  const profileId = profile?.id ?? "studio_provider";
  const displayName = profile?.title ?? agentDraft?.displayName ?? "Studio Provider";
  const slug = toIdSlug(profileId, "provider");
  const resolvedTenantId = tenantId ?? "tenant_default";
  const resolvedBaseUrl = String(endpointBaseUrl ?? "").trim();
  const managedMetadata = extractPhase1ManagedNetworkMetadata(profile?.metadata);
  const executionAdapter = asPlainObject(managedMetadata?.executionAdapter);
  const sessionModes = Array.isArray(executionAdapter?.supportedSessionModes) ? executionAdapter.supportedSessionModes.join(", ") : "";
  return {
    providerId: `provider_${toIdSlug(resolvedTenantId)}_${slug}`,
    baseUrl: resolvedBaseUrl,
    publishProofJwksUrl: "",
    description:
      profile?.body ??
      agentDraft?.description ??
      "Hosted provider surface for marketplace certification, quote checks, and paid tool publication.",
    tags: formatStarterWorkerTags(profile),
    contactUrl: "",
    termsUrl: "",
    toolId: `tool_${slug}`,
    mcpToolName: slug,
    toolDescription:
      profile?.body ??
      agentDraft?.description ??
      "Paid provider entrypoint for this specialist worker.",
    method: "POST",
    paidPath: `/paid/${slug}`,
    upstreamPath: "/invoke",
    amountCents: String(agentDraft?.priceAmountCents ?? 500),
    currency: String(agentDraft?.priceCurrency ?? "USD"),
    toolClass: "action",
    riskLevel: profileId === "purchase_runner" || profileId === "account_admin" ? "high" : "medium",
    capabilityTags: formatStarterWorkerCapabilities(profile),
    requiredSignatures: "output",
    requestBinding: executionAdapter ? "strict" : "recommended",
    idempotency: executionAdapter ? "side_effecting" : "idempotent",
    signatureMode: "required",
    providerSigningPublicKeyPem: "",
    phase1ManagedMetadata: managedMetadata,
    executionAdapterSummary: executionAdapter
      ? `Delegated account sessions (${sessionModes || "no session modes declared"})`
      : ""
  };
}

function buildStudioProviderManifest(providerForm) {
  const providerId = String(providerForm?.providerId ?? "").trim();
  if (!providerId) throw new Error("Provider ID is required");
  const toolId = String(providerForm?.toolId ?? "").trim();
  if (!toolId) throw new Error("Tool ID is required");
  const baseUrl = String(providerForm?.baseUrl ?? "").trim();
  if (!baseUrl) throw new Error("Provider base URL is required");
  const paidPathRaw = String(providerForm?.paidPath ?? "").trim();
  const paidPath = paidPathRaw.startsWith("/") ? paidPathRaw : `/${paidPathRaw}`;
  const upstreamPathRaw = String(providerForm?.upstreamPath ?? "").trim();
  const upstreamPath = upstreamPathRaw ? (upstreamPathRaw.startsWith("/") ? upstreamPathRaw : `/${upstreamPathRaw}`) : null;
  const amountCents = Number.parseInt(String(providerForm?.amountCents ?? "500"), 10);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("Price cents must be a positive integer");
  const currency = String(providerForm?.currency ?? "USD").trim().toUpperCase() || "USD";
  const method = String(providerForm?.method ?? "POST").trim().toUpperCase() || "POST";
  const toolClass = String(providerForm?.toolClass ?? "action").trim().toLowerCase() || "action";
  const riskLevelRaw = String(providerForm?.riskLevel ?? "medium").trim().toLowerCase() || "medium";
  const riskLevel = riskLevelRaw === "med" ? "medium" : riskLevelRaw;
  const requiredSignatures = normalizeLowercaseTokenList(providerForm?.requiredSignatures || "output");
  const capabilityTags = normalizeLowercaseTokenList(providerForm?.capabilityTags);
  const requestBinding = String(providerForm?.requestBinding ?? "recommended").trim().toLowerCase() || "recommended";
  const idempotency = String(providerForm?.idempotency ?? "idempotent").trim().toLowerCase() || "idempotent";
  const signatureMode = String(providerForm?.signatureMode ?? "required").trim().toLowerCase() || "required";
  const managedMetadata = extractPhase1ManagedNetworkMetadata(providerForm?.phase1ManagedMetadata);
  const toolMetadata = managedMetadata
    ? {
        phase1ManagedNetwork: {
          schemaVersion: managedMetadata.schemaVersion ?? null,
          profileId: managedMetadata.profileId ?? null,
          familyIds: Array.isArray(managedMetadata.familyIds) ? [...managedMetadata.familyIds] : [],
          families: Array.isArray(managedMetadata.families) ? managedMetadata.families.map((family) => ({ ...family })) : [],
          proofCoverage: Array.isArray(managedMetadata.proofCoverage)
            ? managedMetadata.proofCoverage.map((coverage) => ({ ...coverage }))
            : [],
          executionAdapter: managedMetadata.executionAdapter ? { ...managedMetadata.executionAdapter } : null
        }
      }
    : null;

  return {
    schemaVersion: "PaidToolManifest.v2",
    providerId,
    upstreamBaseUrl: baseUrl,
    publishProofJwksUrl: String(providerForm?.publishProofJwksUrl ?? "").trim() || null,
    sourceOpenApiPath: null,
    defaults: {
      amountCents,
      currency,
      idempotency,
      signatureMode,
      toolClass,
      riskLevel,
      requiredSignatures,
      requestBinding
    },
    tools: [
      {
        toolId,
        mcpToolName: String(providerForm?.mcpToolName ?? "").trim() || null,
        description: String(providerForm?.toolDescription ?? "").trim() || null,
        method,
        upstreamPath,
        paidPath,
        pricing: {
          amountCents,
          currency
        },
        idempotency,
        signatureMode,
        auth: { mode: "none" },
        metadata: toolMetadata,
        toolClass,
        riskLevel,
        capabilityTags,
        security: {
          requiredSignatures,
          requestBinding
        }
      }
    ],
    capabilityTags
  };
}

function StudioPage({ runtime, onboardingState, onAgentRecorded, lastAgentId, debugMode = false }) {
  const buyer = onboardingState?.buyer ?? null;
  const bootstrapBundle = onboardingState?.bootstrap ?? null;
  const smokeBundle = onboardingState?.smoke ?? null;
  const defaultStudioProfile = starterWorkerProfiles[0];
  const defaultStudioDraft = deriveStarterWorkerDraft(defaultStudioProfile, {
    tenantId: buyer?.tenantId ?? runtime.tenantId,
    endpointBaseUrl: ""
  });
  const defaultProviderDraft = buildStudioProviderDraft({
    profile: defaultStudioProfile,
    agentDraft: defaultStudioDraft,
    tenantId: buyer?.tenantId ?? runtime.tenantId,
    endpointBaseUrl: ""
  });
  const [form, setForm] = useState({
    agentId: lastAgentId || defaultStudioDraft.agentId,
    displayName: defaultStudioDraft.displayName,
    description: defaultStudioDraft.description,
    ownerType: defaultStudioDraft.ownerType,
    ownerId: defaultStudioDraft.ownerId,
    capabilities: formatStarterWorkerCapabilities(defaultStudioProfile),
    visibility: "public",
    runtimeName: defaultStudioDraft.runtimeName,
    endpoint: "",
    seedEndpointBaseUrl: "",
    priceAmountCents: defaultStudioDraft.priceAmountCents,
    priceCurrency: defaultStudioDraft.priceCurrency,
    priceUnit: defaultStudioDraft.priceUnit,
    tags: formatStarterWorkerTags(defaultStudioProfile),
    attachPublishSignature: false
  });
  const [selectedProfileId, setSelectedProfileId] = useState(defaultStudioProfile.id);
  const [selectedStarterSetId, setSelectedStarterSetId] = useState(starterWorkerSetPresets[0].id);
  const [keys, setKeys] = useState({ publicKeyPem: "", privateKeyPem: "", keyId: "" });
  const [studioMessage, setStudioMessage] = useState("Pick a starter profile or starter set, generate a signer, then publish the workers.");
  const [providerForm, setProviderForm] = useState(defaultProviderDraft);
  const [providerMessage, setProviderMessage] = useState("Run conformance against a hosted provider, then publish when the proof path is ready.");
  const [registerOutput, setRegisterOutput] = useState(null);
  const [publishOutput, setPublishOutput] = useState(null);
  const [discoverOutput, setDiscoverOutput] = useState(null);
  const [seedOutput, setSeedOutput] = useState(null);
  const [providerConformanceOutput, setProviderConformanceOutput] = useState(null);
  const [providerPublicationOutput, setProviderPublicationOutput] = useState(null);
  const [providerRegistryState, setProviderRegistryState] = useState({
    loading: false,
    error: "",
    publications: [],
    detail: null
  });
  const [providerJwksState, setProviderJwksState] = useState({
    loading: false,
    error: "",
    keyId: "",
    providerRef: "",
    jwks: null
  });
  const [busyState, setBusyState] = useState("");
  const runtimeReady = Boolean(String(runtime.apiKey ?? "").trim());
  const discoveryResults = Array.isArray(discoverOutput?.results) ? discoverOutput.results : [];
  const seedResults = Array.isArray(seedOutput?.results) ? seedOutput.results : [];
  const selectedStarterSet =
    starterWorkerSetPresets.find((preset) => preset.id === selectedStarterSetId) ?? starterWorkerSetPresets[0];
  const selectedStudioProfile =
    starterWorkerProfiles.find((profile) => profile.id === selectedProfileId) ?? defaultStudioProfile;

  useEffect(() => {
    if (!buyer?.tenantId) return;
    const suggestedDraft = deriveStarterWorkerDraft(defaultStudioProfile, {
      tenantId: buyer.tenantId,
      endpointBaseUrl: form.seedEndpointBaseUrl
    });
    setForm((previous) => {
      const next = { ...previous };
      let changed = false;
      if (
        (!lastAgentId && previous.agentId === defaultStudioDraft.agentId) ||
        previous.agentId.includes("studio") ||
        previous.agentId === `agt_${toIdSlug(runtime.tenantId)}_${defaultStudioProfile.id}`
      ) {
        next.agentId = lastAgentId || suggestedDraft.agentId;
        changed = true;
      }
      if (previous.ownerId === defaultStudioDraft.ownerId || previous.ownerId === `svc_${toIdSlug(runtime.tenantId)}_${defaultStudioProfile.id}`) {
        next.ownerId = suggestedDraft.ownerId;
        changed = true;
      }
      if (previous.displayName === defaultStudioProfile.displayName) {
        next.displayName = suggestedDraft.displayName;
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [buyer?.tenantId, defaultStudioDraft.agentId, defaultStudioDraft.ownerId, defaultStudioProfile, form.seedEndpointBaseUrl, lastAgentId, runtime.tenantId]);

  useEffect(() => {
    let cancelled = false;

    async function loadProviderJwks() {
      if (!keys.publicKeyPem) {
        setProviderJwksState({
          loading: false,
          error: "",
          keyId: "",
          providerRef: "",
          jwks: null
        });
        return;
      }
      setProviderJwksState((previous) => ({
        ...previous,
        loading: true,
        error: ""
      }));
      try {
        const jwksBundle = await buildEd25519JwksFromPublicKeyPem(keys.publicKeyPem);
        if (cancelled) return;
        setProviderJwksState({
          loading: false,
          error: "",
          keyId: jwksBundle.keyId ?? "",
          providerRef: jwksBundle.providerRef ?? "",
          jwks: jwksBundle.jwks ?? null
        });
      } catch (error) {
        if (cancelled) return;
        setProviderJwksState({
          loading: false,
          error: error.message,
          keyId: "",
          providerRef: "",
          jwks: null
        });
      }
    }

    void loadProviderJwks();
    return () => {
      cancelled = true;
    };
  }, [keys.publicKeyPem]);

  function applyStudioProfile(profile) {
    setSelectedProfileId(profile.id);
    const draft = deriveStarterWorkerDraft(profile, {
      tenantId: buyer?.tenantId ?? runtime.tenantId,
      endpointBaseUrl: form.seedEndpointBaseUrl
    });
    const providerDraft = buildStudioProviderDraft({
      profile,
      agentDraft: draft,
      tenantId: buyer?.tenantId ?? runtime.tenantId,
      endpointBaseUrl: form.seedEndpointBaseUrl || form.endpoint
    });
    setForm((previous) => ({
      ...previous,
      agentId: draft.agentId,
      displayName: draft.displayName,
      description: draft.description,
      ownerType: draft.ownerType,
      ownerId: draft.ownerId,
      capabilities: formatStarterWorkerCapabilities(profile),
      runtimeName: draft.runtimeName,
      endpoint: draft.endpoint,
      priceAmountCents: draft.priceAmountCents,
      priceCurrency: draft.priceCurrency,
      priceUnit: draft.priceUnit,
      tags: formatStarterWorkerTags(profile)
    }));
    setProviderForm((previous) => ({
      ...previous,
      providerId: providerDraft.providerId,
      description: providerDraft.description,
      tags: providerDraft.tags,
      toolId: providerDraft.toolId,
      mcpToolName: providerDraft.mcpToolName,
      toolDescription: providerDraft.toolDescription,
      paidPath: providerDraft.paidPath,
      upstreamPath: providerDraft.upstreamPath,
      amountCents: providerDraft.amountCents,
      currency: providerDraft.currency,
      toolClass: providerDraft.toolClass,
      riskLevel: providerDraft.riskLevel,
      capabilityTags: providerDraft.capabilityTags,
      idempotency: providerDraft.idempotency,
      requestBinding: providerDraft.requestBinding,
      phase1ManagedMetadata: providerDraft.phase1ManagedMetadata,
      executionAdapterSummary: providerDraft.executionAdapterSummary,
      ...(previous.baseUrl ? {} : { baseUrl: providerDraft.baseUrl })
    }));
    setStudioMessage(`${profile.title} profile loaded. Adjust the details, then register and publish the worker.`);
    setProviderMessage(`${profile.title} provider template loaded. Run conformance when the hosted base URL is ready.`);
  }

  function buildManualDraft() {
    return {
      agentId: form.agentId,
      displayName: form.displayName,
      description: form.description,
      ownerType: form.ownerType,
      ownerId: form.ownerId,
      capabilities: parseCapabilityList(form.capabilities),
      visibility: form.visibility,
      runtimeName: form.runtimeName,
      endpoint: String(form.endpoint ?? "").trim(),
      priceAmountCents: String(form.priceAmountCents ?? "0"),
      priceCurrency: String(form.priceCurrency ?? "USD").trim().toUpperCase(),
      priceUnit: String(form.priceUnit ?? "task").trim() || "task",
      tags: parseCapabilityList(form.tags),
      metadata: selectedStudioProfile?.metadata ? structuredClone(selectedStudioProfile.metadata) : null
    };
  }

  async function ensureStudioSigner() {
    if (keys.publicKeyPem) return keys;
    const generated = await generateBrowserEd25519KeypairPem();
    startTransition(() => {
      setKeys(generated);
    });
    return generated;
  }

  async function registerAgentIdentity(draft, signer, { allowExisting = false, idempotencyKey } = {}) {
    try {
      const output = await requestJson({
        baseUrl: runtime.baseUrl,
        pathname: "/agents/register",
        method: "POST",
        headers: buildHeaders({ ...runtime, write: true, idempotencyKey }),
        body: {
          agentId: draft.agentId,
          displayName: draft.displayName,
          description: draft.description,
          owner: {
            ownerType: draft.ownerType,
            ownerId: draft.ownerId
          },
          publicKeyPem: signer.publicKeyPem,
          capabilities: draft.capabilities
        }
      });
      return { output, status: "created" };
    } catch (error) {
      if (allowExisting && error.status === 409) {
        return { output: null, status: "exists" };
      }
      throw error;
    }
  }

  async function publishAgentCardDraft(draft, signer, { attachPublishSignature = false, idempotencyKey } = {}) {
    const requestBody = {
      agentId: draft.agentId,
      displayName: draft.displayName,
      description: draft.description,
      capabilities: draft.capabilities,
      visibility: draft.visibility,
      host: {
        runtime: draft.runtimeName,
        ...(draft.endpoint ? { endpoint: draft.endpoint } : {})
      },
      priceHint: {
        amountCents: Number(draft.priceAmountCents || 0) || 0,
        currency: String(draft.priceCurrency || "USD").trim().toUpperCase(),
        unit: draft.priceUnit || "task"
      },
      tags: draft.tags,
      metadata: draft.metadata ?? null
    };

    if (attachPublishSignature && signer.privateKeyPem && signer.keyId) {
      requestBody.publish = await buildAgentCardPublishSignature({
        tenantId: runtime.tenantId,
        requestBody,
        signerKeyId: signer.keyId,
        privateKeyPem: signer.privateKeyPem
      });
    }

    return requestJson({
      baseUrl: runtime.baseUrl,
      pathname: "/agent-cards",
      method: "POST",
      headers: buildHeaders({ ...runtime, write: true, idempotencyKey }),
      body: requestBody
    });
  }

  async function publishStarterSet() {
    if (!runtimeReady) {
      setStudioMessage("Complete onboarding and issue runtime bootstrap before seeding public workers.");
      return;
    }
    setBusyState("seed");
    setStudioMessage(`Publishing ${selectedStarterSet.profileIds.length} starter workers into the public directory...`);
    try {
      const signer = await ensureStudioSigner();
      const tenantId = buyer?.tenantId ?? runtime.tenantId;
      const endpointBaseUrl = form.seedEndpointBaseUrl || form.endpoint;
      const results = [];

      for (const profileId of selectedStarterSet.profileIds) {
        const profile = starterWorkerProfiles.find((entry) => entry.id === profileId);
        if (!profile) continue;
        const draft = deriveStarterWorkerDraft(profile, { tenantId, endpointBaseUrl });
        const registration = await registerAgentIdentity(draft, signer, {
          allowExisting: true,
          idempotencyKey: `starter_register_${draft.agentId}`
        });
        const published = await publishAgentCardDraft(draft, signer, {
          attachPublishSignature: form.attachPublishSignature,
          idempotencyKey: `starter_card_${draft.agentId}`
        });

        results.push({
          profileId: profile.id,
          title: profile.title,
          agentId: draft.agentId,
          registerStatus: registration.status,
          publishStatus: "published",
          endpoint: draft.endpoint || null,
          card: published?.card ?? null
        });
        onAgentRecorded(draft.agentId);
      }

      startTransition(() => {
        setSeedOutput({
          schemaVersion: "StudioStarterSeed.v1",
          setId: selectedStarterSet.id,
          results
        });
      });
      setStudioMessage(`${results.length} starter workers published from ${selectedStarterSet.title}.`);
      const primaryProfile = starterWorkerProfiles.find((entry) => entry.id === selectedStarterSet.profileIds[0]) ?? null;
      await previewDiscovery(primaryProfile?.capabilities?.[0] ?? null);
    } catch (error) {
      setStudioMessage(`Starter set publish failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function generateKeys() {
    setBusyState("keys");
    setStudioMessage("Generating an Ed25519 keypair locally in the browser...");
    try {
      const generated = await generateBrowserEd25519KeypairPem();
      startTransition(() => {
        setKeys(generated);
      });
      setStudioMessage(`Keypair ready. signer ${generated.keyId}.`);
    } catch (error) {
      setStudioMessage(`Key generation failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function registerAgent() {
    if (!runtimeReady) {
      setStudioMessage("Complete onboarding and issue runtime bootstrap before registering a worker.");
      return;
    }
    setBusyState("register");
    setStudioMessage("Registering the agent identity...");
    try {
      const draft = buildManualDraft();
      const signer = await ensureStudioSigner();
      const { output } = await registerAgentIdentity(draft, signer, {
        idempotencyKey: createClientId("agent_register")
      });
      startTransition(() => {
        setRegisterOutput(output);
      });
      onAgentRecorded(draft.agentId);
      setStudioMessage(`Agent ${draft.agentId} registered.`);
    } catch (error) {
      setStudioMessage(`Register failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function publishCard() {
    if (!runtimeReady) {
      setStudioMessage("Complete onboarding and issue runtime bootstrap before publishing a worker.");
      return;
    }
    setBusyState("publish");
    setStudioMessage("Publishing agent card...");
    try {
      const draft = buildManualDraft();
      const signer = await ensureStudioSigner();
      const output = await publishAgentCardDraft(draft, signer, {
        attachPublishSignature: form.attachPublishSignature,
        idempotencyKey: createClientId("agent_card")
      });
      startTransition(() => {
        setPublishOutput(output);
      });
      onAgentRecorded(draft.agentId);
      setStudioMessage(`Agent card for ${draft.agentId} published.`);
      await previewDiscovery(draft.capabilities[0] ?? null);
    } catch (error) {
      setStudioMessage(`Publish failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function previewDiscovery(capabilityOverride = null) {
    if (!runtimeReady) {
      setStudioMessage("Complete onboarding and issue runtime bootstrap before loading discovery.");
      return;
    }
    setBusyState("discover");
    setStudioMessage("Loading public discovery preview...");
    try {
      const primaryCapability = capabilityOverride ?? parseCapabilityList(form.capabilities)[0] ?? "";
      const query = new URLSearchParams({
        capability: primaryCapability,
        visibility: "public",
        status: "active",
        includeReputation: "false",
        limit: "10",
        offset: "0"
      });
      if (form.runtimeName) query.set("runtime", form.runtimeName);
      const output = await requestJson({
        baseUrl: runtime.baseUrl,
        pathname: `/public/agent-cards/discover?${query.toString()}`,
        method: "GET",
        headers: buildHeaders(runtime)
      });
      startTransition(() => {
        setDiscoverOutput(output);
      });
      setStudioMessage("Public discovery preview loaded.");
    } catch (error) {
      setStudioMessage(`Discovery preview failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  function updateProviderForm(field, value) {
    setProviderForm((previous) => ({
      ...previous,
      [field]: value
    }));
  }

  async function refreshProviderRegistry(providerIdOverride = null) {
    if (!runtimeReady) {
      setProviderMessage("Complete onboarding and issue runtime bootstrap before loading publication state.");
      return;
    }
    const resolvedProviderId = String(providerIdOverride ?? providerForm.providerId ?? "").trim();
    setBusyState("provider_registry");
    setProviderRegistryState((previous) => ({
      ...previous,
      loading: true,
      error: ""
    }));
    try {
      const listOut = await fetchMarketplaceProviderPublications(runtime, {
        status: "all",
        providerId: resolvedProviderId,
        limit: 10,
        offset: 0
      });
      let detailOut = null;
      if (resolvedProviderId) {
        try {
          detailOut = await fetchMarketplaceProviderPublication(runtime, resolvedProviderId);
        } catch (error) {
          if (error?.status !== 404) throw error;
        }
      }
      setProviderRegistryState({
        loading: false,
        error: "",
        publications: extractList(listOut, ["publications"]),
        detail: detailOut ?? null
      });
      setProviderMessage(
        resolvedProviderId
          ? `Loaded publication state for ${resolvedProviderId}.`
          : "Loaded execution profile publications."
      );
    } catch (error) {
      setProviderRegistryState({
        loading: false,
        error: error.message,
        publications: [],
        detail: null
      });
      setProviderMessage(`Provider publication lookup failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function runProviderCertification() {
    if (!runtimeReady) {
      setProviderMessage("Complete onboarding and issue runtime bootstrap before running provider conformance.");
      return;
    }
    setBusyState("provider_conformance");
    setProviderMessage("Running provider conformance...");
    try {
      const manifest = buildStudioProviderManifest(providerForm);
      const output = await runMarketplaceProviderConformance(runtime, {
        providerId: providerForm.providerId,
        manifest,
        baseUrl: providerForm.baseUrl,
        toolId: providerForm.toolId,
        providerSigningPublicKeyPem: providerForm.providerSigningPublicKeyPem || keys.publicKeyPem || ""
      });
      startTransition(() => {
        setProviderConformanceOutput(output?.report ?? null);
      });
      setProviderMessage(
        output?.report?.verdict?.ok === true
          ? `Provider ${providerForm.providerId} passed conformance.`
          : `Provider ${providerForm.providerId} failed conformance. Review the report before publishing.`
      );
    } catch (error) {
      setProviderMessage(`Provider conformance failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function publishProvider() {
    if (!runtimeReady) {
      setProviderMessage("Complete onboarding and issue runtime bootstrap before publishing a provider.");
      return;
    }
    setBusyState("provider_publish");
    setProviderMessage("Minting publish proof and publishing provider...");
    try {
      const manifest = buildStudioProviderManifest(providerForm);
      if (!providerForm.publishProofJwksUrl.trim()) {
        throw new Error("Publish proof JWKS URL is required");
      }
      const signerKeyId = keys.keyId || providerJwksState.keyId;
      if (!signerKeyId || !keys.privateKeyPem) {
        throw new Error("Generate or paste a signer before publishing a provider");
      }
      const manifestHash = await sha256HexUtf8(canonicalJsonStringify(manifest));
      const publishProof = await mintProviderPublishProofTokenV1({
        providerId: providerForm.providerId,
        manifestHash,
        signerKeyId,
        publicKeyPem: keys.publicKeyPem || null,
        privateKeyPem: keys.privateKeyPem
      });
      const output = await publishMarketplaceProvider(runtime, {
        providerId: providerForm.providerId,
        manifest,
        baseUrl: providerForm.baseUrl,
        runConformance: true,
        toolId: providerForm.toolId,
        providerSigningPublicKeyPem: providerForm.providerSigningPublicKeyPem || keys.publicKeyPem || "",
        tags: normalizeLowercaseTokenList(providerForm.tags),
        description: providerForm.description,
        contactUrl: providerForm.contactUrl,
        termsUrl: providerForm.termsUrl,
        publishProof: publishProof.token,
        publishProofJwksUrl: providerForm.publishProofJwksUrl
      });
      startTransition(() => {
        setProviderPublicationOutput({
          ...output,
          publishProof
        });
      });
      setProviderMessage(`Provider ${providerForm.providerId} published with status ${output?.publication?.status ?? "unknown"}.`);
      await refreshProviderRegistry(providerForm.providerId);
    } catch (error) {
      setProviderMessage(`Provider publish failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  const publishPath = [
    {
      title: "Runtime ready",
      body: runtimeReady
        ? `Using ${bootstrapBundle?.bootstrap?.apiKey?.keyId ?? "a configured runtime key"} for write actions.`
        : "Finish onboarding and issue runtime bootstrap first.",
      ready: runtimeReady
    },
    {
      title: "Signer ready",
      body: keys.keyId ? `Signer ${keys.keyId} is available for agent identity and optional publish signatures.` : "Generate a local keypair in the browser.",
      ready: Boolean(keys.keyId)
    },
    {
      title: "Identity registered",
      body: registerOutput?.agent?.agentId ?? registerOutput?.agentId ?? "Register the worker identity before publishing the card.",
      ready: Boolean(registerOutput?.agent?.agentId ?? registerOutput?.agentId)
    },
    {
      title: "Card published",
      body: publishOutput?.agentId ?? publishOutput?.card?.agentId ?? "Publish a public card so the worker can appear in discovery.",
      ready: Boolean(publishOutput?.agentId ?? publishOutput?.card?.agentId)
    }
  ];

  const agentCliSnippet = `${bootstrapBundle?.bootstrap?.exportCommands ?? `export NOOTERRA_BASE_URL=${JSON.stringify(runtime.baseUrl)}
export NOOTERRA_TENANT_ID=${JSON.stringify(runtime.tenantId)}
export NOOTERRA_API_KEY=${JSON.stringify(runtime.apiKey || "sk_test_keyid.secret")}`}

agentverse agent init ${form.agentId} --capability ${parseCapabilityList(form.capabilities)[0] || "capability://code.generation"}
agentverse agent run --agent-id ${form.agentId} --base-url ${runtime.baseUrl} --tenant-id ${runtime.tenantId}`;
  const starterSeedSnippet = `${bootstrapBundle?.bootstrap?.exportCommands ?? `export NOOTERRA_BASE_URL=${JSON.stringify(runtime.baseUrl)}
export NOOTERRA_TENANT_ID=${JSON.stringify(runtime.tenantId)}
export NOOTERRA_API_KEY=${JSON.stringify(runtime.apiKey || "sk_test_keyid.secret")}`}
${form.seedEndpointBaseUrl ? `export NOOTERRA_STARTER_ENDPOINT_BASE_URL=${JSON.stringify(form.seedEndpointBaseUrl)}\n` : ""}npm run setup:seed-public-workers -- --profile-set ${selectedStarterSet.id}`;
  const providerConformanceChecks = Array.isArray(providerConformanceOutput?.checks) ? providerConformanceOutput.checks : [];
  const providerPublications = Array.isArray(providerRegistryState.publications) ? providerRegistryState.publications : [];
  const providerDetailPacket = asPlainObject(providerRegistryState.detail);
  const providerDetail = asPlainObject(providerDetailPacket?.publication ?? providerDetailPacket);
  const providerCertificationBadge =
    asPlainObject(providerPublicationOutput?.certificationBadge) ??
    asPlainObject(providerDetailPacket?.certificationBadge) ??
    asPlainObject(providerPublications[0]?.certificationBadge);
  const providerReadyToPublish =
    runtimeReady &&
    Boolean(String(providerForm.publishProofJwksUrl ?? "").trim()) &&
    Boolean(String(keys.privateKeyPem ?? "").trim()) &&
    Boolean(String(keys.keyId ?? providerJwksState.keyId ?? "").trim());
  let providerManifestPreview = null;
  let providerManifestError = "";
  try {
    providerManifestPreview = buildStudioProviderManifest(providerForm);
  } catch (error) {
    providerManifestError = error.message;
  }

  return (
    <div className="product-page">
      <section className="product-page-top">
        <div>
          <p className="product-kicker">Nooterra Studio</p>
          <h1>Turn an agent into a public network worker.</h1>
          <p className="product-lead">
            This is the supply-side flow: local keys, identity registration, agent-card publishing, and discovery preview.
          </p>
        </div>
        <div className="product-page-top-actions">
          <a className="product-button product-button-ghost" href="/onboarding">Workspace onboarding</a>
          <button className="product-button product-button-ghost" disabled={busyState !== ""} onClick={() => void generateKeys()}>
            {busyState === "keys" ? "Generating..." : "Generate Keys"}
          </button>
          <button className="product-button product-button-solid" disabled={busyState !== "" || !runtimeReady} onClick={() => void registerAgent()}>
            {busyState === "register" ? "Registering..." : "Register Agent"}
          </button>
        </div>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Starter Profiles</p>
            <h2>Start from a worker shape that already fits the network.</h2>
          </div>
          <div className="product-option-grid">
            {starterWorkerProfiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={`product-option-card ${selectedProfileId === profile.id ? "active" : ""}`}
                onClick={() => applyStudioProfile(profile)}
              >
                <strong>{profile.title}</strong>
                <span>{profile.body}</span>
              </button>
            ))}
          </div>
          <ManagedCoveragePanel
            metadata={selectedStudioProfile?.metadata ?? null}
            title={`${selectedStudioProfile?.title ?? "Selected worker"} contract`}
            subtitle="Studio starter profiles are managed Phase 1 specialists. Publish them with their declared task families and proof promises intact."
          />
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Starter Sets</p>
            <h2>Seed a believable public directory in one pass.</h2>
          </div>
          <div className="product-option-grid">
            {starterWorkerSetPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`product-option-card ${selectedStarterSetId === preset.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedStarterSetId(preset.id);
                  setStudioMessage(`${preset.title} selected. Publish it to seed richer public supply.`);
                }}
              >
                <strong>{preset.title}</strong>
                <span>{preset.body}</span>
                <span>{preset.profileIds.map((profileId) => starterWorkerProfiles.find((entry) => entry.id === profileId)?.title ?? profileId).join(" · ")}</span>
              </button>
            ))}
          </div>
          <div className="product-actions">
            <button className="product-button product-button-solid" disabled={busyState !== "" || !runtimeReady} onClick={() => void publishStarterSet()}>
              {busyState === "seed" ? "Publishing..." : `Publish ${selectedStarterSet.profileIds.length} Starter Workers`}
            </button>
          </div>
        </article>
      </section>

      <section className="product-section">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Publish Path</p>
            <h2>Make the builder prerequisites visible before you seed or publish.</h2>
          </div>
          <div className="product-step-list">
            {publishPath.map((item) => (
              <div key={item.title} className="product-step-item">
                <div className="product-step-copy">
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </div>
                <span className={`product-status-pill tone-${item.ready ? "good" : "warn"}`}>{item.ready ? "Ready" : "Next"}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Agent Identity</p>
            <h2>Registration inputs</h2>
          </div>
          {bootstrapBundle?.bootstrap?.apiKey?.keyId ? (
            <div className="product-inline-note good">
              Runtime bootstrap {bootstrapBundle.bootstrap.apiKey.keyId} is active.
              {smokeBundle?.smoke?.initialized ? ` MCP smoke is green with ${smokeBundle.smoke.toolsCount ?? 0} tools.` : ""}
            </div>
          ) : (
            <div className="product-inline-note warn">
              Use <a href="/onboarding">Workspace Onboarding</a> first if you want Studio to inherit managed runtime credentials.
            </div>
          )}
          <div className="product-form-grid">
            <label>
              <span>Agent ID</span>
              <input value={form.agentId} onChange={(event) => setForm((previous) => ({ ...previous, agentId: event.target.value }))} />
            </label>
            <label>
              <span>Display name</span>
              <input value={form.displayName} onChange={(event) => setForm((previous) => ({ ...previous, displayName: event.target.value }))} />
            </label>
            <label>
              <span>Owner type</span>
              <select value={form.ownerType} onChange={(event) => setForm((previous) => ({ ...previous, ownerType: event.target.value }))}>
                <option value="service">service</option>
                <option value="business">business</option>
                <option value="human">human</option>
              </select>
            </label>
            <label>
              <span>Owner ID</span>
              <input value={form.ownerId} onChange={(event) => setForm((previous) => ({ ...previous, ownerId: event.target.value }))} />
            </label>
            <label className="wide">
              <span>Description</span>
              <textarea value={form.description} onChange={(event) => setForm((previous) => ({ ...previous, description: event.target.value }))} rows={3} />
            </label>
            <label className="wide">
              <span>Capabilities</span>
              <textarea value={form.capabilities} onChange={(event) => setForm((previous) => ({ ...previous, capabilities: event.target.value }))} rows={4} />
            </label>
          </div>
          <div className="product-inline-note">{studioMessage}</div>
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Browser Key Vault</p>
            <h2>Local signing material for publishable agents.</h2>
          </div>
          <div className="product-key-head">
            <span>{keys.keyId || "No signer generated yet"}</span>
            <label className="product-toggle">
              <input
                type="checkbox"
                checked={form.attachPublishSignature}
                onChange={(event) => setForm((previous) => ({ ...previous, attachPublishSignature: event.target.checked }))}
              />
              <span>Attach publish signature</span>
            </label>
          </div>
          <label className="wide">
            <span>Public key PEM</span>
            <textarea value={keys.publicKeyPem} onChange={(event) => setKeys((previous) => ({ ...previous, publicKeyPem: event.target.value }))} rows={5} />
          </label>
          <label className="wide">
            <span>Private key PEM</span>
            <textarea value={keys.privateKeyPem} onChange={(event) => setKeys((previous) => ({ ...previous, privateKeyPem: event.target.value }))} rows={6} />
          </label>
        </article>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Agent Card</p>
            <h2>Public discovery surface</h2>
          </div>
          <div className="product-form-grid">
            <label>
              <span>Visibility</span>
              <select value={form.visibility} onChange={(event) => setForm((previous) => ({ ...previous, visibility: event.target.value }))}>
                <option value="public">public</option>
                <option value="private">private</option>
              </select>
            </label>
            <label>
              <span>Runtime</span>
              <input value={form.runtimeName} onChange={(event) => setForm((previous) => ({ ...previous, runtimeName: event.target.value }))} />
            </label>
            <label className="wide">
              <span>Host endpoint (optional)</span>
              <input value={form.endpoint} onChange={(event) => setForm((previous) => ({ ...previous, endpoint: event.target.value }))} placeholder="https://worker.nooterra.ai" />
            </label>
            <label className="wide">
              <span>Starter endpoint base (optional)</span>
              <input
                value={form.seedEndpointBaseUrl}
                onChange={(event) => setForm((previous) => ({ ...previous, seedEndpointBaseUrl: event.target.value }))}
                placeholder="https://workers.nooterra.ai/agents"
              />
            </label>
            <label>
              <span>Price (cents)</span>
              <input value={form.priceAmountCents} onChange={(event) => setForm((previous) => ({ ...previous, priceAmountCents: event.target.value }))} />
            </label>
            <label>
              <span>Price currency</span>
              <input value={form.priceCurrency} onChange={(event) => setForm((previous) => ({ ...previous, priceCurrency: event.target.value }))} />
            </label>
            <label>
              <span>Unit</span>
              <input value={form.priceUnit} onChange={(event) => setForm((previous) => ({ ...previous, priceUnit: event.target.value }))} />
            </label>
            <label className="wide">
              <span>Tags</span>
              <input value={form.tags} onChange={(event) => setForm((previous) => ({ ...previous, tags: event.target.value }))} />
            </label>
          </div>
          <div className="product-actions">
            <button className="product-button product-button-ghost" disabled={busyState !== "" || !runtimeReady} onClick={() => void previewDiscovery()}>
              {busyState === "discover" ? "Loading..." : "Preview Discovery"}
            </button>
            <button className="product-button product-button-solid" disabled={busyState !== "" || !runtimeReady} onClick={() => void publishCard()}>
              {busyState === "publish" ? "Publishing..." : "Publish Card"}
            </button>
          </div>
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Publish Status</p>
            <h2>Registration and discovery state</h2>
          </div>
          <div className="product-sidebar-list">
            <div>
              <strong>Identity</strong>
              <span>{registerOutput?.agent?.agentId ?? registerOutput?.agentId ?? "Register an agent to start."}</span>
            </div>
            <div>
              <strong>Published card</strong>
              <span>{publishOutput?.card?.agentId ?? publishOutput?.agentId ?? "Publish a card when you are ready."}</span>
            </div>
            <div>
              <strong>Discovery preview</strong>
              <span>
                {discoveryResults.length
                  ? `${discoveryResults.length} result${discoveryResults.length === 1 ? "" : "s"} loaded.`
                  : "Preview discovery to see how the card appears."}
              </span>
            </div>
            <div>
              <strong>Starter set</strong>
              <span>
                {seedResults.length
                  ? `${seedResults.length} worker${seedResults.length === 1 ? "" : "s"} seeded from ${selectedStarterSet.title}.`
                  : "Use a starter set when you want to seed several public workers at once."}
              </span>
            </div>
          </div>
          {seedResults.length > 0 ? (
            <div className="product-step-list">
              {seedResults.map((row) => (
                <div key={row.agentId} className="product-step-item">
                  <div className="product-step-copy">
                    <strong>{row.title}</strong>
                    <span>{row.agentId} · register {row.registerStatus} · card {row.publishStatus}</span>
                  </div>
                  <a className="product-status-pill tone-accent" href={`/agents/${encodeURIComponent(row.agentId)}`}>Open</a>
                </div>
              ))}
            </div>
          ) : null}
          {discoveryResults.length > 0 ? (
            <div className="product-discovery-list">
              {discoveryResults.slice(0, 4).map((row, index) => (
                <div key={row?.agentCard?.agentId ?? row?.agentCard?.cardHash ?? `discover_${index}`} className="product-discovery-row">
                  <div>
                    <strong>{row?.agentCard?.displayName ?? row?.agentCard?.agentId ?? "Worker"}</strong>
                    <span>{row?.agentCard?.agentId ?? "agent id unavailable"}</span>
                  </div>
                  <div>
                    <span>
                      {row?.agentCard?.priceHint?.amountCents
                        ? formatCurrency(row.agentCard.priceHint.amountCents, row.agentCard.priceHint.currency)
                        : "No public price"}
                    </span>
                    <span>{row?.agentCard?.host?.runtime ?? "runtime n/a"}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {debugMode ? (
            <div className="product-output-stack">
              <details className="product-details" open>
                <summary>AgentIdentity.v1</summary>
                <pre><code>{prettyJson(registerOutput)}</code></pre>
              </details>
              <details className="product-details">
                <summary>AgentCard.v1</summary>
                <pre><code>{prettyJson(publishOutput)}</code></pre>
              </details>
              <details className="product-details">
                <summary>Public discovery preview</summary>
                <pre><code>{prettyJson(discoverOutput)}</code></pre>
              </details>
              <details className="product-details">
                <summary>Starter worker seed</summary>
                <pre><code>{prettyJson(seedOutput)}</code></pre>
              </details>
            </div>
          ) : null}
        </article>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Provider Sandbox</p>
            <h2>Run certification checks against the hosted provider before you publish it.</h2>
          </div>
          <div className="product-form-grid">
            <label>
              <span>Provider ID</span>
              <input value={providerForm.providerId} onChange={(event) => updateProviderForm("providerId", event.target.value)} />
            </label>
            <label>
              <span>Hosted base URL</span>
              <input value={providerForm.baseUrl} onChange={(event) => updateProviderForm("baseUrl", event.target.value)} placeholder="https://worker.nooterra.ai" />
            </label>
            <label className="wide">
              <span>Provider description</span>
              <textarea value={providerForm.description} onChange={(event) => updateProviderForm("description", event.target.value)} rows={3} />
            </label>
            <label className="wide">
              <span>Provider tags</span>
              <input value={providerForm.tags} onChange={(event) => updateProviderForm("tags", event.target.value)} placeholder="support, admin, booking" />
            </label>
            <label>
              <span>Tool ID</span>
              <input value={providerForm.toolId} onChange={(event) => updateProviderForm("toolId", event.target.value)} />
            </label>
            <label>
              <span>MCP tool name</span>
              <input value={providerForm.mcpToolName} onChange={(event) => updateProviderForm("mcpToolName", event.target.value)} />
            </label>
            <label className="wide">
              <span>Tool description</span>
              <textarea value={providerForm.toolDescription} onChange={(event) => updateProviderForm("toolDescription", event.target.value)} rows={3} />
            </label>
            <label>
              <span>HTTP method</span>
              <select value={providerForm.method} onChange={(event) => updateProviderForm("method", event.target.value)}>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
            </label>
            <label>
              <span>Paid path</span>
              <input value={providerForm.paidPath} onChange={(event) => updateProviderForm("paidPath", event.target.value)} placeholder="/paid/tool" />
            </label>
            <label>
              <span>Upstream path</span>
              <input value={providerForm.upstreamPath} onChange={(event) => updateProviderForm("upstreamPath", event.target.value)} placeholder="/invoke" />
            </label>
            <label>
              <span>Price (cents)</span>
              <input value={providerForm.amountCents} onChange={(event) => updateProviderForm("amountCents", event.target.value)} />
            </label>
            <label>
              <span>Currency</span>
              <input value={providerForm.currency} onChange={(event) => updateProviderForm("currency", event.target.value)} />
            </label>
            <label>
              <span>Tool class</span>
              <select value={providerForm.toolClass} onChange={(event) => updateProviderForm("toolClass", event.target.value)}>
                <option value="read">read</option>
                <option value="compute">compute</option>
                <option value="action">action</option>
              </select>
            </label>
            <label>
              <span>Risk level</span>
              <select value={providerForm.riskLevel} onChange={(event) => updateProviderForm("riskLevel", event.target.value)}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label>
              <span>Idempotency</span>
              <select value={providerForm.idempotency} onChange={(event) => updateProviderForm("idempotency", event.target.value)}>
                <option value="idempotent">idempotent</option>
                <option value="non_idempotent">non_idempotent</option>
                <option value="side_effecting">side_effecting</option>
              </select>
            </label>
            <label>
              <span>Signature mode</span>
              <select value={providerForm.signatureMode} onChange={(event) => updateProviderForm("signatureMode", event.target.value)}>
                <option value="required">required</option>
                <option value="optional">optional</option>
              </select>
            </label>
            <label className="wide">
              <span>Capability tags</span>
              <input value={providerForm.capabilityTags} onChange={(event) => updateProviderForm("capabilityTags", event.target.value)} placeholder="booking, support.escalation" />
            </label>
            <label>
              <span>Required signatures</span>
              <input value={providerForm.requiredSignatures} onChange={(event) => updateProviderForm("requiredSignatures", event.target.value)} placeholder="output, quote" />
            </label>
            <label>
              <span>Request binding</span>
              <select value={providerForm.requestBinding} onChange={(event) => updateProviderForm("requestBinding", event.target.value)}>
                <option value="strict">strict</option>
                <option value="recommended">recommended</option>
                <option value="none">none</option>
              </select>
            </label>
          </div>
          {providerManifestError ? <div className="product-inline-note bad">{providerManifestError}</div> : null}
          <div className="product-actions">
            <button className="product-button product-button-ghost" disabled={busyState !== "" || !runtimeReady || Boolean(providerManifestError)} onClick={() => void runProviderCertification()}>
              {busyState === "provider_conformance" ? "Running..." : "Run Conformance"}
            </button>
            <button className="product-button product-button-ghost" disabled={busyState !== "" || !runtimeReady} onClick={() => void refreshProviderRegistry()}>
              {busyState === "provider_registry" ? "Loading..." : "Refresh Registry"}
            </button>
          </div>
          <div className="product-inline-note">{providerMessage}</div>
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Certification State</p>
            <h2>Conformance verdicts, publish readiness, and the live registry state in one place.</h2>
          </div>
          <div className="product-sidebar-list">
            <div>
              <strong>Manifest</strong>
              <span>{providerManifestError ? "Needs fixes" : "Ready for conformance"}</span>
            </div>
            <div>
              <strong>Conformance verdict</strong>
              <span>
                {providerConformanceOutput
                  ? providerConformanceOutput?.verdict?.ok === true
                    ? "Passed"
                    : "Failed"
                  : "Not run yet"}
              </span>
            </div>
            <div>
              <strong>Publish proof</strong>
              <span>{providerReadyToPublish ? "Signer + JWKS URL ready" : "Need signer key and JWKS URL"}</span>
            </div>
            <div>
              <strong>Registry status</strong>
              <span>{providerDetail?.status ?? providerPublications[0]?.status ?? "No publication yet"}</span>
            </div>
            <div>
              <strong>Execution adapter</strong>
              <span>{providerForm.executionAdapterSummary || "Generic paid tool flow"}</span>
            </div>
          </div>
          {providerCertificationBadge ? (
            <div className="product-inline-note good">
              Certification badge: {providerCertificationBadge.status ?? "status unavailable"}
              {providerCertificationBadge.toolCount ? ` · ${providerCertificationBadge.toolCount} tool${providerCertificationBadge.toolCount === 1 ? "" : "s"}` : ""}
            </div>
          ) : null}
          {providerConformanceOutput ? (
            <div className="product-step-list">
              {providerConformanceChecks.slice(0, 6).map((check, index) => (
                <div key={`${check?.id ?? "check"}:${index}`} className="product-step-item">
                  <div className="product-step-copy">
                    <strong>{humanizeLabel(check?.id, "Check")}</strong>
                    <span>{check?.detail?.message ?? check?.message ?? (check?.ok === true ? "Passed" : "Failed")}</span>
                  </div>
                  <StatusPill value={check?.ok === true ? "approved" : "rejected"} />
                </div>
              ))}
            </div>
          ) : (
            <div className="product-empty-state">Run conformance to see the certification checks that will gate publication.</div>
          )}
          {providerRegistryState.error ? <div className="product-inline-note bad">{providerRegistryState.error}</div> : null}
          {providerPublications.length ? (
            <div className="product-step-list">
              {providerPublications.slice(0, 4).map((publication) => (
                <div key={publication?.publicationId ?? publication?.providerId} className="product-step-item">
                  <div className="product-step-copy">
                    <strong>{publication?.providerId ?? "provider"}</strong>
                    <span>{publication?.manifestHash ? abbreviateHash(publication.manifestHash, 18) : "Manifest hash unavailable"}</span>
                  </div>
                  <StatusPill value={publication?.status ?? "unknown"} />
                </div>
              ))}
            </div>
          ) : null}
        </article>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Publish Proof</p>
            <h2>Use the same local signer to generate the JWKS material and publish proof token.</h2>
          </div>
          <div className="product-form-grid">
            <label className="wide">
              <span>JWKS URL</span>
              <input value={providerForm.publishProofJwksUrl} onChange={(event) => updateProviderForm("publishProofJwksUrl", event.target.value)} placeholder="https://worker.nooterra.ai/.well-known/jwks.json" />
            </label>
            <label className="wide">
              <span>Contact URL</span>
              <input value={providerForm.contactUrl} onChange={(event) => updateProviderForm("contactUrl", event.target.value)} placeholder="https://nooterra.ai/contact" />
            </label>
            <label className="wide">
              <span>Terms URL</span>
              <input value={providerForm.termsUrl} onChange={(event) => updateProviderForm("termsUrl", event.target.value)} placeholder="https://nooterra.ai/terms" />
            </label>
            <label className="wide">
              <span>Provider signing public key PEM</span>
              <textarea value={providerForm.providerSigningPublicKeyPem} onChange={(event) => updateProviderForm("providerSigningPublicKeyPem", event.target.value)} rows={5} placeholder="Optional. Defaults to the browser signer public key." />
            </label>
          </div>
          {providerJwksState.error ? <div className="product-inline-note bad">{providerJwksState.error}</div> : null}
          <div className="product-sidebar-list">
            <div>
              <strong>Signer key</strong>
              <span>{keys.keyId || providerJwksState.keyId || "Generate a signer first"}</span>
            </div>
            <div>
              <strong>Provider ref</strong>
              <span>{providerJwksState.providerRef || "Derived after a public key is available"}</span>
            </div>
            <div>
              <strong>JWKS</strong>
              <span>{providerJwksState.jwks ? "Ready to host" : "No public key exported yet"}</span>
            </div>
          </div>
          <div className="product-actions">
            <button className="product-button product-button-solid" disabled={busyState !== "" || !providerReadyToPublish || Boolean(providerManifestError)} onClick={() => void publishProvider()}>
              {busyState === "provider_publish" ? "Publishing..." : "Publish Provider"}
            </button>
          </div>
          <details className="product-details">
            <summary>JWKS preview</summary>
            <pre><code>{prettyJson(providerJwksState.jwks)}</code></pre>
          </details>
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Builder Packet</p>
            <h2>Keep the manifest, conformance report, and publish response inspectable while the workflow hardens.</h2>
          </div>
          {providerPublicationOutput?.publication ? (
            <div className="product-inline-note good">
              Published {providerPublicationOutput.publication.providerId} with status {providerPublicationOutput.publication.status}.
            </div>
          ) : null}
          <div className="product-output-stack">
            <details className="product-details" open>
              <summary>Provider manifest</summary>
              <pre><code>{prettyJson(providerManifestPreview)}</code></pre>
            </details>
            <details className="product-details">
              <summary>Conformance report</summary>
              <pre><code>{prettyJson(providerConformanceOutput)}</code></pre>
            </details>
            <details className="product-details">
              <summary>Publication detail</summary>
              <pre><code>{prettyJson(providerDetail ?? providerPublicationOutput)}</code></pre>
            </details>
          </div>
        </article>
      </section>

      <section className="product-section">
        <div className="product-section-head">
          <p>Builder Loop</p>
          <h2>CLI and ops seeding paths</h2>
        </div>
        <CodeBlock title="Agentverse CLI" code={agentCliSnippet} hint="Scaffold locally, then keep the worker live against the network." />
        <CodeBlock title="Starter Worker Seed" code={starterSeedSnippet} hint="Populate a real tenant from env when you want richer public supply without clicking through Studio." />
      </section>
    </div>
  );
}

function InboxPage({ runtime, onboardingState, lastLaunchId = null }) {
  const [busyState, setBusyState] = useState("loading");
  const [statusMessage, setStatusMessage] = useState("Loading the task inbox...");
  const [pendingItems, setPendingItems] = useState([]);
  const [openDisputes, setOpenDisputes] = useState([]);
  const [recentReceipts, setRecentReceipts] = useState([]);
  const [launchStatus, setLaunchStatus] = useState(null);
  const [notificationSettings, setNotificationSettings] = useState({
    loading: false,
    saving: false,
    testing: false,
    error: "",
    message: "",
    settings: null
  });
  const [notificationForm, setNotificationForm] = useState({
    emails: "",
    deliveryMode: "smtp",
    webhookUrl: ""
  });
  const [notificationPreviewState, setNotificationPreviewState] = useState({
    loading: false,
    error: "",
    preview: null
  });
  const [productEventDeliveryState, setProductEventDeliveryState] = useState({
    loading: false,
    sending: false,
    error: "",
    message: "",
    activeItemId: "",
    preview: null
  });
  const [inboxReadState, setInboxReadState] = useState(() => readInboxReadState());
  const runtimeReady = Boolean(String(runtime?.apiKey ?? "").trim());
  const buyer = onboardingState?.buyer ?? null;

  useEffect(() => {
    function syncReadState(event) {
      if (event?.type === "storage" && event?.key && event.key !== PRODUCT_INBOX_READ_STATE_STORAGE_KEY) return;
      setInboxReadState(readInboxReadState());
    }
    window.addEventListener("storage", syncReadState);
    window.addEventListener(PRODUCT_INBOX_READ_STATE_EVENT, syncReadState);
    return () => {
      window.removeEventListener("storage", syncReadState);
      window.removeEventListener(PRODUCT_INBOX_READ_STATE_EVENT, syncReadState);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!runtimeReady) {
        setPendingItems([]);
        setOpenDisputes([]);
        setRecentReceipts([]);
        setLaunchStatus(null);
        setBusyState("");
        setStatusMessage("Complete onboarding and issue runtime bootstrap before loading the inbox.");
        return;
      }
      setBusyState("loading");
      setStatusMessage("Loading the task inbox...");
      try {
        const [pendingOut, disputesOut, receiptsOut, launchOut] = await Promise.all([
          fetchApprovalInbox(runtime, { status: "pending" }),
          fetchDisputeInbox(runtime, { disputeStatus: "open", limit: 12, offset: 0 }).catch(() => null),
          fetchWorkOrderReceipts(runtime, { limit: 12, offset: 0 }).catch(() => null),
          lastLaunchId ? fetchRouterLaunchStatus(runtime, lastLaunchId).catch(() => null) : Promise.resolve(null)
        ]);
        if (cancelled) return;
        const nextPendingItems = extractList(pendingOut, ["items", "results", "approvalInbox", "approvalRequests", "requests"])
          .map((row) => normalizeApprovalInboxItem(row, "pending"))
          .filter((row) => row.requestId)
          .sort((left, right) => {
            const rightMs = Date.parse(right.requestedAt || "");
            const leftMs = Date.parse(left.requestedAt || "");
            return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
          });
        const nextOpenDisputes = extractList(disputesOut, ["items", "results"])
          .map((row) => normalizeDisputeInboxRecord(row))
          .filter((row) => row.disputeId && row.disputeStatus === "open")
          .sort((left, right) => {
            const rightMs = Date.parse(right.latestCaseUpdatedAt || right.disputeOpenedAt || "");
            const leftMs = Date.parse(left.latestCaseUpdatedAt || left.disputeOpenedAt || "");
            return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
          });
        const nextRecentReceipts = extractList(receiptsOut, ["receipts", "items", "results"])
          .map((row) => normalizeReceiptRecord(row))
          .filter((row) => row.receiptId)
          .sort((left, right) => {
            const rightMs = Date.parse(right.deliveredAt || "");
            const leftMs = Date.parse(left.deliveredAt || "");
            return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
          });
        const nextLaunchStatus = launchOut?.status ? normalizeLaunchStatusRecord(launchOut.status) : null;

        setPendingItems(nextPendingItems);
        setOpenDisputes(nextOpenDisputes);
        setRecentReceipts(nextRecentReceipts);
        setLaunchStatus(nextLaunchStatus);
        setStatusMessage(
          `Loaded ${nextPendingItems.length} approval request${nextPendingItems.length === 1 ? "" : "s"}, ${nextOpenDisputes.length} open dispute${nextOpenDisputes.length === 1 ? "" : "s"}, and ${nextRecentReceipts.length} recent receipt${nextRecentReceipts.length === 1 ? "" : "s"}.`
        );
      } catch (error) {
        if (cancelled) return;
        setStatusMessage(`Task inbox failed to load: ${error.message}`);
      } finally {
        if (!cancelled) setBusyState("");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [lastLaunchId, runtime, runtimeReady]);

  useEffect(() => {
    let cancelled = false;

    async function loadNotificationSettings() {
      if (!runtimeReady || !buyer) {
        setNotificationSettings({
          loading: false,
          saving: false,
          testing: false,
          error: "",
          message: "",
          settings: null
        });
        setNotificationPreviewState({
          loading: false,
          error: "",
          preview: null
        });
        return;
      }
      setNotificationSettings((previous) => ({
        ...previous,
        loading: true,
        error: "",
        message: ""
      }));
      try {
        const out = await fetchTenantSettings(runtime);
        if (cancelled) return;
        const settings = asPlainObject(out?.settings);
        const buyerNotifications = asPlainObject(settings?.buyerNotifications);
        setNotificationSettings({
          loading: false,
          saving: false,
          testing: false,
          error: "",
          message: "",
          settings: out
        });
        setNotificationForm({
          emails: Array.isArray(buyerNotifications?.emails) ? buyerNotifications.emails.join(", ") : "",
          deliveryMode: pickFirstString(buyerNotifications?.deliveryMode, "smtp"),
          webhookUrl: pickFirstString(buyerNotifications?.webhookUrl, "")
        });
      } catch (error) {
        if (cancelled) return;
        setNotificationSettings({
          loading: false,
          saving: false,
          testing: false,
          error: error.message,
          message: "",
          settings: null
        });
      }
    }

    void loadNotificationSettings();
    return () => {
      cancelled = true;
    };
  }, [buyer, runtime, runtimeReady]);

  const launchTasks = Array.isArray(launchStatus?.tasks) ? launchStatus.tasks : [];
  const activeLaunchTasks = launchTasks.filter((task) => isLaunchTaskActive(task));
  const actionItems = buildInboxActionItems({ pendingItems, openDisputes, launchStatus });
  const receiptItems = buildInboxReceiptItems(recentReceipts);
  const unreadActionCount = countUnreadInboxItems(actionItems, inboxReadState);
  const unreadReceiptCount = countUnreadInboxItems(receiptItems, inboxReadState);
  const buyerNotificationSettings = asPlainObject(notificationSettings.settings?.settings?.buyerNotifications);
  const buyerNotificationLatest = asPlainObject(notificationSettings.settings?.buyerNotifications?.latest);

  function persistInboxReadState(nextState) {
    const normalizedNextState = normalizeInboxReadState(nextState);
    writeInboxReadState(normalizedNextState);
    if (buyer) {
      void updateTenantConsumerInboxState(runtime, normalizedNextState).catch(() => null);
    }
  }

  function markInboxItemSeen(itemId) {
    const normalizedItemId = String(itemId ?? "").trim();
    if (!normalizedItemId) return;
    persistInboxReadState({
      version: 1,
      seenAtByItemId: {
        ...(inboxReadState?.seenAtByItemId ?? {}),
        [normalizedItemId]: new Date().toISOString()
      }
    });
  }

  function markAllInboxItemsSeen() {
    const nextSeenAtByItemId = { ...(inboxReadState?.seenAtByItemId ?? {}) };
    for (const item of [...actionItems, ...receiptItems]) {
      if (!item?.id || nextSeenAtByItemId[item.id]) continue;
      nextSeenAtByItemId[item.id] = new Date().toISOString();
    }
    persistInboxReadState({
      version: 1,
      seenAtByItemId: nextSeenAtByItemId
    });
  }

  async function handleNotificationSettingsSubmit(event) {
    event.preventDefault();
    if (!buyer) {
      setNotificationSettings((previous) => ({
        ...previous,
        error: "Sign in with an admin-capable buyer session before updating delivery settings."
      }));
      return;
    }
    if (notificationForm.deliveryMode === "webhook" && !String(notificationForm.webhookUrl ?? "").trim()) {
      setNotificationSettings((previous) => ({
        ...previous,
        error: "Webhook URL is required when buyer notification delivery mode is webhook.",
        message: ""
      }));
      return;
    }
      setNotificationSettings((previous) => ({
        ...previous,
        saving: true,
        testing: false,
        error: "",
        message: "Saving buyer notification delivery settings..."
      }));
    try {
      const patch = {
        buyerNotifications: {
          emails: parseCapabilityList(notificationForm.emails),
          deliveryMode: notificationForm.deliveryMode,
          webhookUrl:
            notificationForm.deliveryMode === "webhook" && String(notificationForm.webhookUrl ?? "").trim()
              ? String(notificationForm.webhookUrl).trim()
              : null
        }
      };
      const out = await updateTenantSettings(runtime, patch);
      const settings = asPlainObject(out?.settings);
      const buyerNotifications = asPlainObject(settings?.buyerNotifications);
      setNotificationSettings({
        loading: false,
        saving: false,
        testing: false,
        error: "",
        message: "Buyer notification delivery settings saved.",
        settings: out
      });
      setNotificationForm({
        emails: Array.isArray(buyerNotifications?.emails) ? buyerNotifications.emails.join(", ") : "",
        deliveryMode: pickFirstString(buyerNotifications?.deliveryMode, "smtp"),
        webhookUrl: pickFirstString(buyerNotifications?.webhookUrl, "")
      });
    } catch (error) {
      setNotificationSettings((previous) => ({
        ...previous,
        saving: false,
        testing: false,
        error: error.message,
        message: ""
      }));
    }
  }

  async function handleNotificationPreviewLoad() {
    if (!buyer) {
      setNotificationPreviewState({
        loading: false,
        error: "Sign in through onboarding before previewing outbound delivery.",
        preview: null
      });
      return;
    }
    setNotificationPreviewState((previous) => ({
      ...previous,
      loading: true,
      error: ""
    }));
    try {
      const out = await fetchTenantBuyerNotificationPreview(runtime);
      setNotificationPreviewState({
        loading: false,
        error: "",
        preview: asPlainObject(out?.preview)
      });
    } catch (error) {
      setNotificationPreviewState({
        loading: false,
        error: error.message,
        preview: null
      });
    }
  }

  async function handleNotificationTestSend() {
    if (!buyer) {
      setNotificationSettings((previous) => ({
        ...previous,
        error: "Sign in through onboarding before sending a delivery test.",
        message: ""
      }));
      return;
    }
    setNotificationSettings((previous) => ({
      ...previous,
      testing: true,
      error: "",
      message: "Sending buyer notification delivery test..."
    }));
    try {
      const out = await sendTenantBuyerNotificationTest(runtime);
      const [refreshed, previewOut] = await Promise.all([
        fetchTenantSettings(runtime),
        fetchTenantBuyerNotificationPreview(runtime).catch(() => null)
      ]);
      setNotificationSettings({
        loading: false,
        saving: false,
        testing: false,
        error: "",
        message: "Buyer notification delivery test sent.",
        settings: refreshed
      });
      setNotificationPreviewState({
        loading: false,
        error: "",
        preview: asPlainObject(previewOut?.preview)
      });
    } catch (error) {
      let refreshed = null;
      try {
        refreshed = await fetchTenantSettings(runtime);
      } catch {
        refreshed = null;
      }
      setNotificationSettings({
        loading: false,
        saving: false,
        testing: false,
        error: error.message,
        message: "",
        settings: refreshed
      });
    }
  }

  async function handleProductEventPreview(item) {
    if (!buyer) {
      setProductEventDeliveryState({
        loading: false,
        sending: false,
        error: "Sign in through onboarding before previewing product event delivery.",
        message: "",
        activeItemId: "",
        preview: null
      });
      return;
    }
    const payload = buildInboxProductNotificationPayload(item);
    if (!payload) {
      setProductEventDeliveryState({
        loading: false,
        sending: false,
        error: "This inbox item does not support outbound product notifications yet.",
        message: "",
        activeItemId: "",
        preview: null
      });
      return;
    }
    setProductEventDeliveryState({
      loading: true,
      sending: false,
      error: "",
      message: "",
      activeItemId: String(item?.id ?? "").trim(),
      preview: null
    });
    try {
      const out = await previewTenantBuyerProductNotification(runtime, payload);
      setProductEventDeliveryState({
        loading: false,
        sending: false,
        error: "",
        message: "",
        activeItemId: String(item?.id ?? "").trim(),
        preview: asPlainObject(out?.preview)
      });
    } catch (error) {
      setProductEventDeliveryState({
        loading: false,
        sending: false,
        error: error.message,
        message: "",
        activeItemId: String(item?.id ?? "").trim(),
        preview: null
      });
    }
  }

  async function handleProductEventSend(item) {
    if (!buyer) {
      setProductEventDeliveryState({
        loading: false,
        sending: false,
        error: "Sign in through onboarding before sending product event delivery.",
        message: "",
        activeItemId: "",
        preview: null
      });
      return;
    }
    const payload = buildInboxProductNotificationPayload(item);
    if (!payload) {
      setProductEventDeliveryState({
        loading: false,
        sending: false,
        error: "This inbox item does not support outbound product notifications yet.",
        message: "",
        activeItemId: "",
        preview: null
      });
      return;
    }
    const activeItemId = String(item?.id ?? "").trim();
    setProductEventDeliveryState({
      loading: false,
      sending: true,
      error: "",
      message: "Sending product event notification...",
      activeItemId,
      preview: null
    });
    try {
      const [previewOut, refreshed] = await Promise.all([
        sendTenantBuyerProductNotification(runtime, payload).then(() =>
          previewTenantBuyerProductNotification(runtime, payload).catch(() => null)
        ),
        fetchTenantSettings(runtime).catch(() => null)
      ]);
      if (refreshed) {
        setNotificationSettings((previous) => ({
          ...previous,
          settings: refreshed
        }));
      }
      setProductEventDeliveryState({
        loading: false,
        sending: false,
        error: "",
        message: `Notification sent for ${payload.title}.`,
        activeItemId,
        preview: asPlainObject(previewOut?.preview)
      });
    } catch (error) {
      setProductEventDeliveryState({
        loading: false,
        sending: false,
        error: error.message,
        message: "",
        activeItemId,
        preview: null
      });
    }
  }

  return (
    <div className="product-page">
      <section className="product-page-top">
        <div>
          <p className="product-kicker">Action Inbox</p>
          <h1>Watch long-running work without hunting through separate screens.</h1>
          <p className="product-lead">
            The inbox turns approvals, action-required follow-ups, dispute state, and recent proof into one async control surface for hosted Action Wallet runs.
          </p>
        </div>
        <div className="product-page-top-actions">
          <a className="product-button product-button-ghost" href="/approvals">Approval center</a>
          <a className="product-button product-button-ghost" href="/receipts">Receipt vault</a>
          <a className="product-button product-button-solid" href="/wallet">Open wallet</a>
        </div>
      </section>

      {!runtimeReady ? (
        <div className="product-inline-note warn">
          Complete <a href="/onboarding">Workspace Onboarding</a> first. The inbox is tenant-scoped and needs a runtime key before it can show live task state.
        </div>
      ) : null}

      <div className={`product-inline-note ${/failed|error/i.test(statusMessage) ? "bad" : "good"}`}>
        {statusMessage}
      </div>

      <section className="product-metric-grid">
        <article className="product-metric-card">
          <span><Bell size={16} /> Action required</span>
          <strong>{actionItems.length}</strong>
          <small>Approvals, action-required host flow states, and active disputes that need attention.</small>
        </article>
        <article className="product-metric-card">
          <span><Bell size={16} /> Unread</span>
          <strong>{unreadActionCount + unreadReceiptCount}</strong>
          <small>Inbox items you have not marked as seen yet, including fresh proof from completed work.</small>
        </article>
        <article className="product-metric-card">
          <span><Clock3 size={16} /> In progress</span>
          <strong>{activeLaunchTasks.length}</strong>
          <small>Tracked tasks that are still sourcing, waiting, or actively executing in the latest monitored host flow.</small>
        </article>
        <article className="product-metric-card">
          <span><CircleCheck size={16} /> Recent proof</span>
          <strong>{recentReceipts.length}</strong>
          <small>Completion receipts captured from finalized runs and ready for replay or support.</small>
        </article>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Action Queue</p>
            <h2>Boundary crossings and unresolved issues appear here first.</h2>
          </div>
          {busyState === "loading" ? <div className="product-inline-note warn">Refreshing action queue…</div> : null}
          {actionItems.length > 0 ? (
            <div className="product-actions">
              <button className="product-button product-button-ghost" type="button" onClick={markAllInboxItemsSeen}>
                Mark all seen
              </button>
            </div>
          ) : null}
          {actionItems.length > 0 ? (
            <div className="product-step-list">
              {actionItems.map((item) => (
                <div key={item.id} className={`product-step-item ${isInboxItemSeen(item.id, inboxReadState) ? "" : "product-step-item-unread"}`}>
                  <div className="product-step-copy">
                    <strong>{item.title}</strong>
                    <span>{item.summary}</span>
                    {item.meta.length ? (
                      <div className="product-approval-step-meta">
                        {item.meta.map((entry) => (
                          <span key={`${item.id}:${entry}`}>{entry}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="product-approval-step-meta">
                    <StatusPill value={item.status} />
                    {buildInboxProductNotificationPayload(item) ? (
                      <button
                        className="product-button product-button-ghost"
                        type="button"
                        onClick={() => void handleProductEventPreview(item)}
                        disabled={productEventDeliveryState.loading && productEventDeliveryState.activeItemId === item.id}
                      >
                        {productEventDeliveryState.loading && productEventDeliveryState.activeItemId === item.id ? "Previewing..." : "Preview email"}
                      </button>
                    ) : null}
                    {buildInboxProductNotificationPayload(item) ? (
                      <button
                        className="product-button product-button-ghost"
                        type="button"
                        onClick={() => void handleProductEventSend(item)}
                        disabled={productEventDeliveryState.sending && productEventDeliveryState.activeItemId === item.id}
                      >
                        {productEventDeliveryState.sending && productEventDeliveryState.activeItemId === item.id ? "Sending..." : "Send email"}
                      </button>
                    ) : null}
                    {!isInboxItemSeen(item.id, inboxReadState) ? (
                      <button className="product-button product-button-ghost" type="button" onClick={() => markInboxItemSeen(item.id)}>
                        Mark seen
                      </button>
                    ) : null}
                    <a className="product-button product-button-ghost" href={item.href}>{item.cta}</a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="product-empty-state">Nothing currently needs action. Approval boundaries are holding and there are no open disputes.</div>
          )}
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Host Flow Watch</p>
            <h2>Stay on top of the latest monitored host flow without reopening separate detail screens.</h2>
          </div>
          {launchStatus ? (
            <>
              <div className="product-detail-meta">
                <div>
                  <strong>Flow</strong>
                  <span>{launchStatus.launchId}</span>
                </div>
                <div>
                  <strong>Open</strong>
                  <span>{launchStatus.summary.openCount}</span>
                </div>
                <div>
                  <strong>Assigned</strong>
                  <span>{launchStatus.summary.assignedCount}</span>
                </div>
                <div>
                  <strong>Closed</strong>
                  <span>{launchStatus.summary.closedCount}</span>
                </div>
                <div>
                  <strong>Disputes</strong>
                  <span>{launchStatus.summary.disputeOpenCount}</span>
                </div>
                <div>
                  <strong>Generated</strong>
                  <span>{launchStatus.generatedAt ? formatDateTime(launchStatus.generatedAt) : "n/a"}</span>
                </div>
              </div>
              {activeLaunchTasks.length > 0 ? (
                <div className="product-step-list">
                  {activeLaunchTasks.slice(0, 6).map((task) => (
                    <div key={`active_launch_${task.taskId}`} className="product-step-item">
                      <div className="product-step-copy">
                        <strong>{task.title}</strong>
                        <span>{describeLaunchTaskState(task)}</span>
                        <div className="product-approval-step-meta">
                          <span>{task.requiredCapability ? humanizeLabel(task.requiredCapability) : "Capability unavailable"}</span>
                          <span>{task.bidCount !== null ? `${task.bidCount} bid${task.bidCount === 1 ? "" : "s"}` : "Bid count unavailable"}</span>
                          {task.runStatus ? <span>Run {titleCaseState(task.runStatus)}</span> : null}
                        </div>
                      </div>
                      <div className="product-approval-step-meta">
                        <StatusPill value={task.runStatus || task.state} />
                        {buildInboxProductNotificationPayload({
                          id: `launch:${launchStatus.launchId}:${task.taskId}`,
                          kind: "launch",
                          title: task.title,
                          summary: describeLaunchTaskState(task),
                          runId: task.runId ?? null
                        }) ? (
                          <button
                            className="product-button product-button-ghost"
                            type="button"
                            onClick={() =>
                              void handleProductEventPreview({
                                id: `launch:${launchStatus.launchId}:${task.taskId}`,
                                kind: "launch",
                                title: task.title,
                                summary: describeLaunchTaskState(task),
                                runId: task.runId ?? null
                              })
                            }
                            disabled={productEventDeliveryState.loading && productEventDeliveryState.activeItemId === `launch:${launchStatus.launchId}:${task.taskId}`}
                          >
                            {productEventDeliveryState.loading && productEventDeliveryState.activeItemId === `launch:${launchStatus.launchId}:${task.taskId}`
                              ? "Previewing..."
                              : "Preview email"}
                          </button>
                        ) : null}
                        {buildInboxProductNotificationPayload({
                          id: `launch:${launchStatus.launchId}:${task.taskId}`,
                          kind: "launch",
                          title: task.title,
                          summary: describeLaunchTaskState(task),
                          runId: task.runId ?? null
                        }) ? (
                          <button
                            className="product-button product-button-ghost"
                            type="button"
                            onClick={() =>
                              void handleProductEventSend({
                                id: `launch:${launchStatus.launchId}:${task.taskId}`,
                                kind: "launch",
                                title: task.title,
                                summary: describeLaunchTaskState(task),
                                runId: task.runId ?? null
                              })
                            }
                            disabled={productEventDeliveryState.sending && productEventDeliveryState.activeItemId === `launch:${launchStatus.launchId}:${task.taskId}`}
                          >
                            {productEventDeliveryState.sending && productEventDeliveryState.activeItemId === `launch:${launchStatus.launchId}:${task.taskId}`
                              ? "Sending..."
                              : "Send email"}
                          </button>
                        ) : null}
                        <a className="product-button product-button-ghost" href={buildLaunchTaskHref(launchStatus.launchId, task)}>
                          {task.runId ? "Open run" : "Review task state"}
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="product-inline-note good">The latest monitored host flow has no active tasks waiting for sourcing, execution, or upstream dependencies.</div>
              )}
            </>
          ) : (
            <div className="product-empty-state">
              {lastLaunchId
                ? "The latest monitored host flow could not be loaded from the live kernel."
                : "Start a supported host action to populate live async execution state here."}
            </div>
          )}
        </article>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Delivery Settings</p>
            <h2>Choose how buyer notifications leave the inbox.</h2>
          </div>
          {!buyer ? (
            <div className="product-empty-state">Sign in through onboarding before configuring outbound delivery.</div>
          ) : notificationSettings.loading ? (
            <div className="product-inline-note warn">Loading buyer notification settings…</div>
          ) : (
            <>
              {notificationSettings.error ? <div className="product-inline-note bad">{notificationSettings.error}</div> : null}
              {notificationSettings.message ? <div className="product-inline-note good">{notificationSettings.message}</div> : null}
              <div className="product-detail-meta">
                <div>
                  <strong>Mode</strong>
                  <span>{buyerNotificationSettings?.deliveryMode ? titleCaseState(buyerNotificationSettings.deliveryMode) : "Not configured"}</span>
                </div>
                <div>
                  <strong>Recipients</strong>
                  <span>{Array.isArray(buyerNotificationSettings?.emails) && buyerNotificationSettings.emails.length ? buyerNotificationSettings.emails.join(", ") : "No email recipients configured"}</span>
                </div>
                <div>
                  <strong>Latest delivery</strong>
                  <span>
                    {buyerNotificationLatest?.token
                      ? buyerNotificationLatest.ok === true
                        ? "Delivered"
                        : "Failed"
                      : "No delivery attempts recorded"}
                  </span>
                </div>
                <div>
                  <strong>Latest updated</strong>
                  <span>{buyerNotificationLatest?.updatedAt ? formatDateTime(buyerNotificationLatest.updatedAt) : "n/a"}</span>
                </div>
              </div>
              <form className="product-form-grid" onSubmit={(event) => void handleNotificationSettingsSubmit(event)}>
                <label className="wide">
                  <span>Buyer notification emails</span>
                  <input
                    value={notificationForm.emails}
                    onChange={(event) => setNotificationForm((previous) => ({ ...previous, emails: event.target.value }))}
                    placeholder="ops@company.com, founder@company.com"
                  />
                </label>
                <label>
                  <span>Delivery mode</span>
                  <select
                    value={notificationForm.deliveryMode}
                    onChange={(event) => setNotificationForm((previous) => ({ ...previous, deliveryMode: event.target.value }))}
                  >
                    <option value="smtp">smtp</option>
                    <option value="record">record</option>
                    <option value="webhook">webhook</option>
                  </select>
                </label>
                <label className={notificationForm.deliveryMode === "webhook" ? "" : "wide"}>
                  <span>Webhook URL</span>
                  <input
                    value={notificationForm.webhookUrl}
                    onChange={(event) => setNotificationForm((previous) => ({ ...previous, webhookUrl: event.target.value }))}
                    placeholder="https://ops.example.com/nooterra/buyer-notifications"
                    disabled={notificationForm.deliveryMode !== "webhook"}
                  />
                </label>
                <div className="product-actions wide">
                  <button className="product-button product-button-solid" type="submit" disabled={notificationSettings.saving}>
                    {notificationSettings.saving ? "Saving..." : "Save delivery settings"}
                  </button>
                  <button
                    className="product-button product-button-ghost"
                    type="button"
                    onClick={() => void handleNotificationPreviewLoad()}
                    disabled={notificationPreviewState.loading}
                  >
                    {notificationPreviewState.loading ? "Loading preview..." : "Preview test message"}
                  </button>
                  <button
                    className="product-button product-button-ghost"
                    type="button"
                    onClick={() => void handleNotificationTestSend()}
                    disabled={notificationSettings.testing}
                  >
                    {notificationSettings.testing ? "Sending test..." : "Send test delivery"}
                  </button>
                </div>
              </form>
              {notificationPreviewState.error ? <div className="product-inline-note bad">{notificationPreviewState.error}</div> : null}
              {notificationPreviewState.preview ? (
                <details className="product-details">
                  <summary>Delivery preview</summary>
                  <div className="product-output-stack">
                    <div className="product-detail-meta">
                      <div>
                        <strong>Event</strong>
                        <span>{pickFirstString(notificationPreviewState.preview.deliveryEvent, "buyer.notification.test")}</span>
                      </div>
                      <div>
                        <strong>Mode</strong>
                        <span>{pickFirstString(notificationPreviewState.preview.deliveryMode, "smtp")}</span>
                      </div>
                      <div>
                        <strong>Subject</strong>
                        <span>{pickFirstString(notificationPreviewState.preview.subject, "n/a")}</span>
                      </div>
                      <div>
                        <strong>Recipients</strong>
                        <span>
                          {Array.isArray(notificationPreviewState.preview.recipients) && notificationPreviewState.preview.recipients.length
                            ? notificationPreviewState.preview.recipients.join(", ")
                            : "No recipients configured"}
                        </span>
                      </div>
                    </div>
                    {notificationPreviewState.preview.summary?.magicLinkUrl ? (
                      <div className="product-inline-note good">
                        Test deliveries deep-link back into the product:{" "}
                        <a href={notificationPreviewState.preview.summary.magicLinkUrl}>
                          {notificationPreviewState.preview.summary.magicLinkUrl}
                        </a>
                      </div>
                    ) : null}
                    <pre><code>{pickFirstString(notificationPreviewState.preview.text, "Preview unavailable.")}</code></pre>
                  </div>
                </details>
              ) : null}
              {productEventDeliveryState.error ? <div className="product-inline-note bad">{productEventDeliveryState.error}</div> : null}
              {productEventDeliveryState.message ? <div className="product-inline-note good">{productEventDeliveryState.message}</div> : null}
              {productEventDeliveryState.preview ? (
                <details className="product-details">
                  <summary>Product event preview</summary>
                  <div className="product-output-stack">
                    <div className="product-detail-meta">
                      <div>
                        <strong>Event</strong>
                        <span>{pickFirstString(productEventDeliveryState.preview.deliveryEvent, "n/a")}</span>
                      </div>
                      <div>
                        <strong>Subject</strong>
                        <span>{pickFirstString(productEventDeliveryState.preview.subject, "n/a")}</span>
                      </div>
                      <div>
                        <strong>Recipients</strong>
                        <span>
                          {Array.isArray(productEventDeliveryState.preview.recipients) && productEventDeliveryState.preview.recipients.length
                            ? productEventDeliveryState.preview.recipients.join(", ")
                            : "No recipients configured"}
                        </span>
                      </div>
                    </div>
                    {productEventDeliveryState.preview.summary?.magicLinkUrl ? (
                      <div className="product-inline-note good">
                        Product event notifications deep-link here:{" "}
                        <a href={productEventDeliveryState.preview.summary.magicLinkUrl}>
                          {productEventDeliveryState.preview.summary.magicLinkUrl}
                        </a>
                      </div>
                    ) : null}
                    <pre><code>{pickFirstString(productEventDeliveryState.preview.text, "Preview unavailable.")}</code></pre>
                  </div>
                </details>
              ) : null}
            </>
          )}
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Recent Receipts</p>
            <h2>Proof returns to the inbox as soon as work completes.</h2>
          </div>
          {recentReceipts.length > 0 ? (
            <div className="product-step-list">
              {receiptItems.slice(0, 8).map((item) => (
                <div key={item.id} className={`product-step-item ${isInboxItemSeen(item.id, inboxReadState) ? "" : "product-step-item-unread"}`}>
                  <div className="product-step-copy">
                    <strong>{item.title}</strong>
                    <span>{item.summary}</span>
                    {item.meta.length ? <div className="product-approval-step-meta">{item.meta.map((entry) => <span key={`${item.id}:${entry}`}>{entry}</span>)}</div> : null}
                  </div>
                  <div className="product-approval-step-meta">
                    <StatusPill value={item.status} />
                    <button
                      className="product-button product-button-ghost"
                      type="button"
                      onClick={() => void handleProductEventPreview(item)}
                      disabled={productEventDeliveryState.loading && productEventDeliveryState.activeItemId === item.id}
                    >
                      {productEventDeliveryState.loading && productEventDeliveryState.activeItemId === item.id ? "Previewing..." : "Preview email"}
                    </button>
                    <button
                      className="product-button product-button-ghost"
                      type="button"
                      onClick={() => void handleProductEventSend(item)}
                      disabled={productEventDeliveryState.sending && productEventDeliveryState.activeItemId === item.id}
                    >
                      {productEventDeliveryState.sending && productEventDeliveryState.activeItemId === item.id ? "Sending..." : "Send email"}
                    </button>
                    {!isInboxItemSeen(item.id, inboxReadState) ? (
                      <button className="product-button product-button-ghost" type="button" onClick={() => markInboxItemSeen(item.id)}>
                        Mark seen
                      </button>
                    ) : null}
                    <a className="product-button product-button-ghost" href={item.href}>{item.cta}</a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="product-empty-state">No recent completion receipts were returned yet. When work finishes, proof will land here automatically.</div>
          )}
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Resolution Watch</p>
            <h2>Dispute state stays visible while support, arbitration, or refund work is still underway.</h2>
          </div>
          {openDisputes.length > 0 ? (
            <div className="product-step-list">
              {openDisputes.slice(0, 8).map((item) => (
                <div key={`open_dispute_${item.disputeId}`} className="product-step-item">
                  <div className="product-step-copy">
                    <strong>{item.disputeContext?.reason ? `Reason: ${item.disputeContext.reason}` : item.disputeId}</strong>
                    <span>
                      {item.runId ? `Run ${item.runId}` : "Run unavailable"} · {item.latestCaseUpdatedAt ? `updated ${formatDateTime(item.latestCaseUpdatedAt)}` : item.disputeOpenedAt ? `opened ${formatDateTime(item.disputeOpenedAt)}` : "time unavailable"}
                    </span>
                    <div className="product-approval-step-meta">
                      {item.counterpartyAgentId ? <span>Counterparty {item.counterpartyAgentId}</span> : null}
                      {item.amountCents !== null && item.amountCents !== undefined ? <span>{formatCurrency(item.amountCents, item.currency)}</span> : null}
                      <span>{item.openCaseCount || item.caseCount || 0} case{(item.openCaseCount || item.caseCount || 0) === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  <div className="product-approval-step-meta">
                    <StatusPill value={item.latestCaseStatus || item.disputeStatus} />
                    <a className="product-button product-button-ghost" href={`/disputes?selectedDisputeId=${encodeURIComponent(item.disputeId)}`}>
                      Open dispute
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="product-empty-state">There are no open disputes right now.</div>
          )}
        </article>
      </section>
    </div>
  );
}

function ApprovalsPage({ runtime, onboardingState }) {
  const [reloadToken, setReloadToken] = useState(0);
  const [busyState, setBusyState] = useState("loading");
  const [statusMessage, setStatusMessage] = useState("Loading approval inbox and policy state...");
  const [pendingItems, setPendingItems] = useState([]);
  const [recentDecisions, setRecentDecisions] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [decisionNotes, setDecisionNotes] = useState({});
  const [policyForm, setPolicyForm] = useState(() => buildApprovalPolicyFormState());
  const [focusedRequestId] = useState(() => getQueryParam("requestId"));
  const buyer = onboardingState?.buyer ?? null;
  const runtimeReady = Boolean(String(runtime?.apiKey ?? "").trim());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setBusyState("loading");
      setStatusMessage("Loading approval inbox and policy state...");
      try {
        const [pendingOut, decidedOut, policiesOut] = await Promise.all([
          fetchApprovalInbox(runtime, { status: "pending" }),
          fetchApprovalInbox(runtime, { status: "decided" }),
          fetchApprovalPolicies(runtime)
        ]);
        if (cancelled) return;

        const nextPending = extractList(pendingOut, ["items", "results", "approvalInbox", "approvalRequests", "requests"])
          .map((row) => normalizeApprovalInboxItem(row, "pending"))
          .filter((row) => row.requestId)
          .sort((left, right) => {
            const leftFocused = focusedRequestId && left.requestId === focusedRequestId ? 1 : 0;
            const rightFocused = focusedRequestId && right.requestId === focusedRequestId ? 1 : 0;
            if (rightFocused !== leftFocused) return rightFocused - leftFocused;
            const leftResume = left?.continuation?.kind === "router_launch" ? 1 : 0;
            const rightResume = right?.continuation?.kind === "router_launch" ? 1 : 0;
            if (rightResume !== leftResume) return rightResume - leftResume;
            const rightMs = Date.parse(right.requestedAt || "");
            const leftMs = Date.parse(left.requestedAt || "");
            return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
          });
        const nextDecided = extractList(decidedOut, [
          "items",
          "results",
          "approvalInbox",
          "approvalRequests",
          "requests",
          "approvalDecisions",
          "decisions"
        ])
          .map((row) => normalizeApprovalInboxItem(row, "decided"))
          .filter((row) => row.requestId)
          .sort((left, right) => {
            const rightMs = Date.parse(right.decidedAt || right.requestedAt || "");
            const leftMs = Date.parse(left.decidedAt || left.requestedAt || "");
            return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
          });
        const nextPolicies = extractList(policiesOut, ["items", "results", "approvalPolicies", "policies"])
          .map((row) => normalizeApprovalPolicyRecord(row))
          .sort((left, right) => {
            const rightMs = Date.parse(right.updatedAt || "");
            const leftMs = Date.parse(left.updatedAt || "");
            return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
          });

        startTransition(() => {
          setPendingItems(nextPending);
          setRecentDecisions(nextDecided);
          setPolicies(nextPolicies);
        });
        setStatusMessage(
          `Loaded ${nextPending.length} pending request${nextPending.length === 1 ? "" : "s"}, ${nextDecided.length} recent decision${nextDecided.length === 1 ? "" : "s"}, and ${nextPolicies.length} standing polic${nextPolicies.length === 1 ? "y" : "ies"}.`
        );
      } catch (error) {
        if (cancelled) return;
        setStatusMessage(`Approval dashboard failed to load: ${error.message}`);
      } finally {
        if (!cancelled) setBusyState("");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [focusedRequestId, reloadToken, runtime]);

  function loadPolicyIntoForm(policy) {
    setPolicyForm(buildApprovalPolicyFormState(policy));
    setStatusMessage(`Policy ${policy.name} loaded into the upsert form.`);
  }

  function resetPolicyForm() {
    setPolicyForm(buildApprovalPolicyFormState());
    setStatusMessage("Policy form reset. Enter a new standing rule or paste an existing policy ID to update.");
  }

  function updateDecisionNote(requestId, value) {
    setDecisionNotes((previous) => ({
      ...previous,
      [requestId]: value
    }));
  }

  async function handleDecision(item, approved) {
    if (!item?.requestId) return;
    const deadlineState = buildDeadlineState(item.deadlineAt);
    if (deadlineState.isExpired) {
      setStatusMessage(`Approval ${item.requestId} is expired. Refresh the inbox before making a decision.`);
      return;
    }
    const note = String(decisionNotes[item.requestId] ?? "").trim();
    const continuation = asPlainObject(item.continuation);
    const shouldResume =
      approved &&
      continuation?.kind === "router_launch" &&
      (continuation?.status === "pending" || continuation?.status === "approved");
    setBusyState(`decision:${item.requestId}`);
    setStatusMessage(
      shouldResume
        ? `Approving ${item.requestId} and resuming the blocked hosted action...`
        : `${approved ? "Approving" : "Denying"} ${item.requestId}...`
    );
    try {
      const decisionOut = await decideApprovalInboxItem(runtime, item.requestId, {
        approved,
        note,
        metadata: {
          source: "dashboard.approvals",
          actorTenantId: runtime.tenantId,
          actorEmail: buyer?.email ?? null
        }
      });
      const serverContinuation = asPlainObject(decisionOut?.approvalContinuation) ?? continuation;
      if (shouldResume) {
        try {
          const resumed = await resumeRouterLaunchFromApproval({
            runtime,
            continuation: serverContinuation,
            approvalDecision: decisionOut?.approvalDecision ?? null
          });
          const resumedLaunchId = resumed?.launchOut?.launch?.launchId ?? null;
          if (resumedLaunchId) {
            writeStoredValue(LAST_LAUNCH_STORAGE_KEY, resumedLaunchId);
            window.location.assign("/inbox");
            return;
          }
          setStatusMessage(`${item.requestId} approved and resumed. Refreshing inbox state...`);
        } catch (error) {
          if (error.code === "HUMAN_APPROVAL_REQUIRED" && error.details?.approvalRequest?.requestId) {
            setStatusMessage(
              `Approval recorded. A downstream boundary now needs approval for ${error.details.approvalRequest.requestId}.`
            );
            window.location.assign(buildRouterLaunchResumeUrl(error.details.approvalRequest.requestId));
            return;
          }
          setStatusMessage(`Approval recorded, but resume failed: ${error.message}`);
          return;
        }
      }
      setDecisionNotes((previous) => {
        if (!Object.prototype.hasOwnProperty.call(previous, item.requestId)) return previous;
        const next = { ...previous };
        delete next[item.requestId];
        return next;
      });
      setStatusMessage(`${item.requestId} ${approved ? "approved" : "denied"}. Refreshing inbox state...`);
      setReloadToken((value) => value + 1);
    } catch (error) {
      setStatusMessage(`${approved ? "Approve" : "Deny"} failed for ${item.requestId}: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function handlePolicySubmit(event) {
    event.preventDefault();
    const generatedPolicyId = policyForm.policyId.trim() || `policy_${toIdSlug(policyForm.name, "approval")}`;
    const maxSpendCents = Number(policyForm.maxSpendCents || "");
    const expiresAfterSeconds = Number(policyForm.expiresAfterSeconds || "");
    const body = {
      policyId: generatedPolicyId,
      principalRef: {
        principalType: policyForm.principalType.trim() || "agent",
        principalId: policyForm.principalId.trim() || runtime.tenantId || "tenant_default"
      },
      displayName: policyForm.name.trim() || humanizeLabel(generatedPolicyId, "Approval policy"),
      description: policyForm.description.trim() || null,
      status: policyForm.status || "active",
      constraints: {
        actorAgentIds: parseCapabilityList(policyForm.actorAgentIds).length ? parseCapabilityList(policyForm.actorAgentIds) : null,
        capabilitiesRequested: parseCapabilityList(policyForm.capabilitiesRequested).length ? parseCapabilityList(policyForm.capabilitiesRequested) : null,
        dataClassesRequested: parseCapabilityList(policyForm.dataClassesRequested).length ? parseCapabilityList(policyForm.dataClassesRequested) : null,
        sideEffectsRequested: parseCapabilityList(policyForm.sideEffectsRequested).length ? parseCapabilityList(policyForm.sideEffectsRequested) : null,
        maxSpendCents: Number.isFinite(maxSpendCents) && maxSpendCents >= 0 ? Math.round(maxSpendCents) : null,
        maxRiskClass: policyForm.maxRiskClass.trim() || null,
        reversibilityClasses: parseCapabilityList(policyForm.reversibilityClasses).length ? parseCapabilityList(policyForm.reversibilityClasses) : null
      },
      decision: {
        effect: policyForm.effect === "deny" ? "deny" : "approve",
        decidedBy: policyForm.decidedBy.trim() || null,
        expiresAfterSeconds: Number.isFinite(expiresAfterSeconds) && expiresAfterSeconds > 0 ? Math.round(expiresAfterSeconds) : null,
        evidenceRefs: parseCapabilityList(policyForm.evidenceRefs),
        metadata: {
          source: "dashboard.approvals",
          updatedBy: buyer?.email ?? runtime.tenantId
        }
      },
    };

    setBusyState("policy");
    setStatusMessage(`${policyForm.policyId.trim() ? "Updating" : "Creating"} policy ${generatedPolicyId}...`);
    try {
      await upsertApprovalPolicy(runtime, body);
      setPolicyForm((previous) => ({ ...previous, policyId: generatedPolicyId }));
      setStatusMessage(`Policy ${generatedPolicyId} saved. Refreshing standing rules...`);
      setReloadToken((value) => value + 1);
    } catch (error) {
      setStatusMessage(`Policy upsert failed: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  const activePolicyCount = policies.filter((policy) => policy.status === "active").length;
  const denyPolicyCount = policies.filter((policy) => policy.effect === "deny").length;
  const boundedSpendCount = policies.filter((policy) => policy.maxSpendCents !== null && policy.maxSpendCents !== undefined).length;
  const statusTone =
    busyState !== ""
      ? "warn"
      : /failed|error/i.test(statusMessage)
        ? "bad"
        : "good";

  return (
    <div className="product-page">
      <section className="product-page-top">
        <div>
          <p className="product-kicker">Approvals</p>
          <h1>Work the human-approval queue without losing policy context.</h1>
          <p className="product-lead">
            Review pending requests, record decisions, and keep standing approval rules visible in one operational surface.
          </p>
        </div>
        <div className="product-page-top-actions">
          <a className="product-button product-button-ghost" href="/inbox">Open inbox</a>
          <button className="product-button product-button-solid" type="button" disabled={busyState !== ""} onClick={() => setReloadToken((value) => value + 1)}>
            {busyState === "loading" ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      {!runtimeReady ? (
        <div className="product-inline-note warn">
          Approval endpoints usually require a bearer key. Use <a href="/onboarding">Workspace Onboarding</a> or the runtime bar in debug mode to configure access.
        </div>
      ) : null}

      <div className={`product-inline-note ${statusTone}`}>{statusMessage}</div>

      <section className="product-metric-grid">
        <article className="product-metric-card">
          <span>Pending Inbox</span>
          <strong>{pendingItems.length}</strong>
          <small>Requests waiting for a human decision.</small>
        </article>
        <article className="product-metric-card">
          <span>Recent Decisions</span>
          <strong>{recentDecisions.length}</strong>
          <small>Latest verdicts returned by the approval feed.</small>
        </article>
        <article className="product-metric-card">
          <span>Standing Policies</span>
          <strong>{activePolicyCount}</strong>
          <small>Active rules loaded from the policy endpoint.</small>
        </article>
        <article className="product-metric-card">
          <span>Deny Rules</span>
          <strong>{denyPolicyCount}</strong>
          <small>Rules that automatically block matched requests.</small>
        </article>
        <article className="product-metric-card">
          <span>Spend Caps</span>
          <strong>{boundedSpendCount}</strong>
          <small>Rules with an explicit spending ceiling.</small>
        </article>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Pending Inbox</p>
            <h2>Requests that still need a human answer.</h2>
          </div>
          {pendingItems.length > 0 ? (
            <div className="product-approval-list">
              {pendingItems.map((item) => {
                const decisionBusy = busyState === `decision:${item.requestId}`;
                const continuation = asPlainObject(item.continuation);
                const deadlineState = buildDeadlineState(item.deadlineAt);
                const resumeReady =
                  continuation?.kind === "router_launch" &&
                  (continuation?.status === "pending" || continuation?.status === "approved");
                const disableDecision = busyState !== "" || deadlineState.isExpired;
                return (
                  <article
                    key={item.requestId}
                    className={`product-task-card product-approval-card ${focusedRequestId === item.requestId ? "product-approval-card-focused" : ""}`}
                  >
                    <div className="product-task-head">
                      <div>
                        <p>{item.policyId ? `Policy ${item.policyId}` : "Pending approval"}</p>
                        <h3>{item.title}</h3>
                      </div>
                      <div className="product-approval-step-meta">
                        <StatusPill value={item.status} />
                        {deadlineState.hasDeadline ? <StatusPill value={deadlineState.isExpired ? "expired" : deadlineState.isUrgent ? "pending" : "active"} /> : null}
                      </div>
                    </div>
                    {item.description ? <p className="product-agent-description">{item.description}</p> : null}
                    <div className="product-approval-meta">
                      <span>{item.requestedBy ? `Requested by ${item.requestedBy}` : "Requester unavailable"}</span>
                      <span>{item.requestedAt ? `Opened ${formatDateTime(item.requestedAt)}` : "Opened time unavailable"}</span>
                      <span>{item.actionId ? `Action ${item.actionId}` : "Action ID unavailable"}</span>
                    </div>
                    <div className="product-approval-fact-grid">
                      <div>
                        <span>Amount</span>
                        <strong>
                          {item.amountCents !== null && item.amountCents !== undefined
                            ? formatCurrency(item.amountCents, item.currency)
                            : "n/a"}
                        </strong>
                      </div>
                      <div>
                        <span>Risk</span>
                        <strong>{item.riskClass ? humanizeLabel(item.riskClass) : "n/a"}</strong>
                      </div>
                      <div>
                        <span>Reversibility</span>
                        <strong>{item.reversibilityClass ? humanizeLabel(item.reversibilityClass) : "n/a"}</strong>
                      </div>
                      <div>
                        <span>Deadline</span>
                        <strong>{item.deadlineAt ? formatDateTime(item.deadlineAt) : "Open-ended"}</strong>
                      </div>
                      <div>
                        <span>Evidence</span>
                        <strong>{item.evidenceRefs.length}</strong>
                      </div>
                      <div>
                        <span>Binding</span>
                        <strong>{item.actionSha256 ? abbreviateHash(item.actionSha256, 16) : abbreviateHash(item.envelopeHash, 16)}</strong>
                      </div>
                    </div>
                    <div className="product-badge-row">
                      {item.policyId ? <span className="product-badge">Policy {item.policyId}</span> : null}
                      {item.riskClass ? <span className="product-badge">Risk {humanizeLabel(item.riskClass)}</span> : null}
                      {item.reversibilityClass ? <span className="product-badge">Reversibility {humanizeLabel(item.reversibilityClass)}</span> : null}
                      {item.dataClassesRequested.slice(0, 2).map((entry) => (
                        <span key={`${item.requestId}:data:${entry}`} className="product-badge">{entry}</span>
                      ))}
                    </div>
                    <label className="product-approval-note">
                      <span>Operator note</span>
                      <input
                        value={decisionNotes[item.requestId] ?? ""}
                        onChange={(event) => updateDecisionNote(item.requestId, event.target.value)}
                        placeholder="Reason, ticket, or evidence handle"
                      />
                    </label>
                    {deadlineState.isExpired ? (
                      <div className="product-inline-note bad">
                        This approval window is closed. Refresh the inbox and reopen the action from the host if it still needs a decision.
                      </div>
                    ) : null}
                    {deadlineState.isUrgent ? (
                      <div className="product-inline-note warn">
                        Approval window is nearly closed: {deadlineState.label.toLowerCase()}.
                      </div>
                    ) : null}
                    {resumeReady ? (
                      <div className="product-inline-note accent">
                        This decision will resume the blocked hosted action automatically.
                      </div>
                    ) : null}
                    <div className="product-approval-card-actions">
                      <button className="product-button product-button-ghost" type="button" disabled={disableDecision} onClick={() => void handleDecision(item, false)}>
                        {decisionBusy ? "Saving..." : "Deny"}
                      </button>
                      <button className="product-button product-button-solid" type="button" disabled={disableDecision} onClick={() => void handleDecision(item, true)}>
                        {decisionBusy ? "Saving..." : resumeReady ? "Approve + Resume" : "Approve"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="product-empty-state">No pending approvals are currently in the inbox.</div>
          )}
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Recent Decisions</p>
            <h2>Keep an operational read on the last verdicts.</h2>
          </div>
          {recentDecisions.length > 0 ? (
            <div className="product-step-list">
              {recentDecisions.slice(0, 10).map((item) => (
                <div key={`${item.requestId}:${item.decisionId || item.decidedAt || item.status}`} className="product-step-item">
                  <div className="product-step-copy">
                    <strong>{item.title}</strong>
                    <span>
                      {item.decidedBy ? `${item.decidedBy} · ` : ""}
                      {item.decidedAt ? formatDateTime(item.decidedAt) : item.requestedAt ? formatDateTime(item.requestedAt) : "Time unavailable"}
                    </span>
                    {item.note ? <span>{item.note}</span> : null}
                  </div>
                  <div className="product-approval-step-meta">
                    <StatusPill value={item.status} />
                    <span>{item.requestId || "request id unavailable"}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="product-empty-state">No recent decisions were returned yet.</div>
          )}
        </article>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Standing Policies</p>
            <h2>Review the rules currently shaping approval gates.</h2>
          </div>
          {policies.length > 0 ? (
            <div className="product-approval-policy-list">
              {policies.map((policy) => (
                <article key={policy.policyId || policy.name} className="product-approval-policy-card">
                  <div className="product-task-head">
                    <div>
                      <p>{policy.principalId ? `${policy.principalType}:${policy.principalId}` : "Standing rule"}</p>
                      <h3>{policy.name}</h3>
                    </div>
                    <StatusPill value={policy.status} />
                  </div>
                  {policy.description ? <p className="product-agent-description">{policy.description}</p> : null}
                  <div className="product-approval-fact-grid">
                    <div>
                      <span>Effect</span>
                      <strong>{humanizeLabel(policy.effect, "Approve")}</strong>
                    </div>
                    <div>
                      <span>Spend cap</span>
                      <strong>
                        {policy.maxSpendCents !== null && policy.maxSpendCents !== undefined
                          ? formatCurrency(policy.maxSpendCents)
                          : "n/a"}
                      </strong>
                    </div>
                    <div>
                      <span>Risk ceiling</span>
                      <strong>{policy.maxRiskClass ? humanizeLabel(policy.maxRiskClass) : "n/a"}</strong>
                    </div>
                    <div>
                      <span>Decision TTL</span>
                      <strong>{policy.expiresAfterSeconds ? `${policy.expiresAfterSeconds}s` : "Persistent"}</strong>
                    </div>
                  </div>
                  {policy.capabilitiesRequested.length > 0 ? (
                    <div className="product-badge-row">
                      {policy.capabilitiesRequested.slice(0, 4).map((entry) => (
                        <span key={`${policy.policyId}:${entry}`} className="product-badge">{entry}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="product-approval-card-actions">
                    <button className="product-button product-button-ghost" type="button" onClick={() => loadPolicyIntoForm(policy)}>
                      Load into form
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="product-empty-state">No standing approval policies were returned.</div>
          )}
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Upsert Policy</p>
            <h2>Create or update a standing approval rule.</h2>
          </div>
          <form className="product-form-grid" onSubmit={(event) => void handlePolicySubmit(event)}>
            <label>
              <span>Policy ID</span>
              <input
                value={policyForm.policyId}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, policyId: event.target.value }))}
                placeholder="policy_finance_s8"
              />
            </label>
            <label>
              <span>Name</span>
              <input
                value={policyForm.name}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, name: event.target.value }))}
                placeholder="Finance S8 approvals"
              />
            </label>
            <label>
              <span>Principal type</span>
              <select
                value={policyForm.principalType}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, principalType: event.target.value }))}
              >
                <option value="agent">agent</option>
                <option value="human">human</option>
                <option value="org">org</option>
                <option value="service">service</option>
              </select>
            </label>
            <label>
              <span>Principal ID</span>
              <input
                value={policyForm.principalId}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, principalId: event.target.value }))}
                placeholder={runtime.tenantId || "agt_requester"}
              />
            </label>
            <label>
              <span>Status</span>
              <select
                value={policyForm.status}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, status: event.target.value }))}
              >
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
            <label>
              <span>Effect</span>
              <select
                value={policyForm.effect}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, effect: event.target.value }))}
              >
                <option value="approve">approve</option>
                <option value="deny">deny</option>
              </select>
            </label>
            <label className="wide">
              <span>Description</span>
              <textarea
                value={policyForm.description}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, description: event.target.value }))}
                rows={3}
                placeholder="When and why this rule should gate work."
              />
            </label>
            <label>
              <span>Spend cap (cents)</span>
              <input
                value={policyForm.maxSpendCents}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, maxSpendCents: event.target.value }))}
                placeholder="50000"
              />
            </label>
            <label>
              <span>Risk ceiling</span>
              <select
                value={policyForm.maxRiskClass}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, maxRiskClass: event.target.value }))}
              >
                <option value="">none</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label>
              <span>Decided by</span>
              <input
                value={policyForm.decidedBy}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, decidedBy: event.target.value }))}
                placeholder="policy:auto"
              />
            </label>
            <label>
              <span>Decision TTL (seconds)</span>
              <input
                value={policyForm.expiresAfterSeconds}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, expiresAfterSeconds: event.target.value }))}
                placeholder="3600"
              />
            </label>
            <label className="wide">
              <span>Actor agent IDs</span>
              <textarea
                value={policyForm.actorAgentIds}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, actorAgentIds: event.target.value }))}
                rows={3}
                placeholder={"agt_requester\nagt_ops"}
              />
            </label>
            <label className="wide">
              <span>Capabilities requested</span>
              <textarea
                value={policyForm.capabilitiesRequested}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, capabilitiesRequested: event.target.value }))}
                rows={3}
                placeholder={"capability://payments.execute\ncapability://code.review"}
              />
            </label>
            <label className="wide">
              <span>Data classes requested</span>
              <textarea
                value={policyForm.dataClassesRequested}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, dataClassesRequested: event.target.value }))}
                rows={3}
                placeholder={"repo_source\nfinancial_records"}
              />
            </label>
            <label className="wide">
              <span>Side effects requested</span>
              <textarea
                value={policyForm.sideEffectsRequested}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, sideEffectsRequested: event.target.value }))}
                rows={3}
                placeholder={"payment.transfer\nemail.send"}
              />
            </label>
            <label className="wide">
              <span>Allowed reversibility classes</span>
              <textarea
                value={policyForm.reversibilityClasses}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, reversibilityClasses: event.target.value }))}
                rows={3}
                placeholder={"reversible\npartially_reversible"}
              />
            </label>
            <label className="wide">
              <span>Evidence refs</span>
              <textarea
                value={policyForm.evidenceRefs}
                onChange={(event) => setPolicyForm((previous) => ({ ...previous, evidenceRefs: event.target.value }))}
                rows={3}
                placeholder={"policy:finance_s8\nkb:approval_rules"}
              />
            </label>
            <div className="product-actions wide">
              <button className="product-button product-button-ghost" type="button" disabled={busyState !== ""} onClick={resetPolicyForm}>
                Clear
              </button>
              <button className="product-button product-button-solid" type="submit" disabled={busyState !== ""}>
                {busyState === "policy" ? "Saving..." : "Upsert policy"}
              </button>
            </div>
          </form>
        </article>
      </section>
    </div>
  );
}

function WalletPage({ runtime, onboardingState, lastLaunchId = null, lastAgentId = null, surface = "wallet" }) {
  const [reloadToken, setReloadToken] = useState(0);
  const [busyState, setBusyState] = useState("loading");
  const [statusMessage, setStatusMessage] = useState("Loading authority wallet state...");
  const [pendingItems, setPendingItems] = useState([]);
  const [recentDecisions, setRecentDecisions] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [walletPolicies, setWalletPolicies] = useState([]);
  const [authorityGrants, setAuthorityGrants] = useState([]);
  const [delegationGrants, setDelegationGrants] = useState([]);
  const [tenantDocuments, setTenantDocuments] = useState([]);
  const [tenantBrowserStates, setTenantBrowserStates] = useState([]);
  const [tenantConsumerConnectors, setTenantConsumerConnectors] = useState([]);
  const [accountSessions, setAccountSessions] = useState([]);
  const [tenantSettingsState, setTenantSettingsState] = useState({
    settings: null,
    error: ""
  });
  const [dataSourceForm, setDataSourceForm] = useState({
    email: { enabled: false, provider: "manual", address: "", label: "", connectedAt: "" },
    calendar: { enabled: false, provider: "manual", address: "", timezone: "", availabilityNotes: "", connectedAt: "" }
  });
  const [dataSourceActionState, setDataSourceActionState] = useState({
    busySource: "",
    error: "",
    message: ""
  });
  const [browserStateForm, setBrowserStateForm] = useState({
    label: "",
    purpose: "purchase_runner",
    storageStateJson: '{\n  "cookies": [],\n  "origins": []\n}'
  });
  const [browserStateActionState, setBrowserStateActionState] = useState({
    busyStateId: "",
    error: "",
    message: ""
  });
  const [connectorForm, setConnectorForm] = useState({
    kind: "email",
    provider: "gmail",
    mode: "oauth",
    accountAddress: "",
    accountLabel: "",
    timezone: "",
    scopesText: ""
  });
  const [connectorActionState, setConnectorActionState] = useState({
    busyConnectorId: "",
    error: "",
    message: ""
  });
  const [accountSessionForm, setAccountSessionForm] = useState({
    providerKey: "amazon",
    providerLabel: "Amazon",
    siteKey: "amazon",
    siteLabel: "Amazon",
    mode: "approval_at_boundary",
    accountHandleMasked: "",
    fundingSourceLabel: "",
    maxSpendCents: "",
    currency: "USD",
    browserStorageStateRef: "",
    browserLoginOrigin: "",
    browserStartUrl: "",
    browserAllowedDomains: "",
    browserReviewMode: "",
    canPurchase: false,
    canUseSavedPaymentMethods: false,
    requiresFinalReview: true
  });
  const [accountSessionActionState, setAccountSessionActionState] = useState({
    busySessionId: "",
    error: "",
    message: ""
  });
  const [integrationState, setIntegrationState] = useState({
    integrations: null,
    error: "",
    message: "",
    busyProvider: ""
  });
  const [grantActionState, setGrantActionState] = useState({
    busyGrantId: "",
    error: "",
    message: ""
  });
  const [selectedWalletRef, setSelectedWalletRef] = useState(() => getQueryParam("wallet") ?? "");
  const [oauthStatus] = useState(() => getQueryParam("oauth") ?? "");
  const [oauthKind] = useState(() => getQueryParam("kind") ?? "");
  const [oauthProvider] = useState(() => getQueryParam("provider") ?? "");
  const [oauthMessage] = useState(() => getQueryParam("message") ?? "");
  const [selectedWalletState, setSelectedWalletState] = useState({
    loading: false,
    walletRef: "",
    policies: [],
    budgets: null,
    ledgerEntries: [],
    ledgerSummary: null,
    error: ""
  });
  const buyer = onboardingState?.buyer ?? null;
  const bootstrapBundle = onboardingState?.bootstrap ?? null;
  const runtimeReady = Boolean(String(runtime?.apiKey ?? "").trim());
  const isIntegrationsSurface = surface === "integrations";

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!runtimeReady) {
        setPendingItems([]);
        setRecentDecisions([]);
        setPolicies([]);
        setWalletPolicies([]);
        setAuthorityGrants([]);
        setDelegationGrants([]);
        setTenantDocuments([]);
        setTenantBrowserStates([]);
        setTenantConsumerConnectors([]);
        setAccountSessions([]);
        setIntegrationState({
          integrations: null,
          error: "",
          message: "",
          busyProvider: ""
        });
        setSelectedWalletRef("");
        setSelectedWalletState({
          loading: false,
          walletRef: "",
          policies: [],
          budgets: null,
          ledgerEntries: [],
          ledgerSummary: null,
          error: ""
        });
        setBusyState("");
        setStatusMessage("Complete onboarding and issue runtime bootstrap before inspecting authority wallet state.");
        return;
      }
      setBusyState("loading");
      setStatusMessage("Loading authority wallet state...");
      try {
        const [pendingOut, decidedOut, policiesOut, walletPoliciesOut, authorityGrantOut, delegationGrantOut, documentsOut, browserStatesOut, connectorsOut, accountSessionsOut, integrationsOut, tenantSettingsOut] = await Promise.all([
          fetchApprovalInbox(runtime, { status: "pending" }),
          fetchApprovalInbox(runtime, { status: "decided" }),
          fetchApprovalPolicies(runtime),
          fetchTenantX402WalletPolicies(runtime, { limit: 200, offset: 0 }).catch(() => ({ policies: [] })),
          fetchAuthorityGrants(runtime, { includeRevoked: false, limit: 200, offset: 0 }).catch(() => ({ grants: [] })),
          fetchDelegationGrants(runtime, { includeRevoked: false, limit: 200, offset: 0 }).catch(() => ({ grants: [] })),
          fetchTenantDocuments(runtime, { includeRevoked: false, limit: 50 }).catch(() => ({ documents: [] })),
          fetchTenantBrowserStates(runtime, { includeRevoked: false, limit: 50 }).catch(() => ({ browserStates: [] })),
          fetchTenantConsumerConnectors(runtime, { includeRevoked: false, limit: 50 }).catch(() => ({ connectors: [] })),
          fetchTenantAccountSessions(runtime, { includeRevoked: false, limit: 50 }).catch(() => ({ sessions: [] })),
          buyer ? fetchTenantIntegrationsState(runtime).catch(() => null) : Promise.resolve(null),
          buyer ? fetchTenantSettings(runtime).catch(() => null) : Promise.resolve(null)
        ]);
        if (cancelled) return;
        const nextPending = extractList(pendingOut, ["items", "results", "approvalInbox", "approvalRequests", "requests"])
          .map((row) => normalizeApprovalInboxItem(row, "pending"))
          .filter((row) => row.requestId);
        const nextDecided = extractList(decidedOut, ["items", "results", "approvalInbox", "approvalRequests", "requests", "approvalDecisions", "decisions"])
          .map((row) => normalizeApprovalInboxItem(row, "decided"))
          .filter((row) => row.requestId);
        const nextPolicies = extractList(policiesOut, ["items", "results", "approvalPolicies", "policies"])
          .map((row) => normalizeApprovalPolicyRecord(row))
          .filter((row) => row.policyId);
        const nextWalletPolicies = extractList(walletPoliciesOut, ["policies", "items", "results"])
          .map((row) => normalizeX402WalletPolicyRecord(row))
          .filter((row) => row.sponsorWalletRef);
        const nextAuthorityGrants = extractList(authorityGrantOut, ["grants", "items", "results"])
          .map((row) => normalizeAuthorityGrantRecord(row))
          .filter((row) => row.grantId);
        const nextDelegationGrants = extractList(delegationGrantOut, ["grants", "items", "results"])
          .map((row) => normalizeDelegationGrantRecord(row))
          .filter((row) => row.grantId);
        const nextDocuments = extractList(documentsOut, ["documents", "items", "results"])
          .map((row) => normalizeTenantDocumentRecord(row))
          .filter((row) => row.documentId);
        const nextBrowserStates = extractList(browserStatesOut, ["browserStates", "states", "items", "results"])
          .map((row) => normalizeTenantBrowserStateRecord(row))
          .filter((row) => row.stateId);
        const nextConnectors = extractList(connectorsOut, ["connectors", "items", "results"])
          .map((row) => normalizeTenantConsumerConnectorRecord(row))
          .filter((row) => row.connectorId);
        const nextAccountSessions = extractList(accountSessionsOut, ["sessions", "items", "results"])
          .map((row) => normalizeTenantAccountSessionRecord(row))
          .filter((row) => row.sessionId);
        const nextIntegrations = integrationsOut && typeof integrationsOut === "object" && !Array.isArray(integrationsOut)
          ? asPlainObject(integrationsOut.integrations)
          : null;
        const nextSettings = asPlainObject(tenantSettingsOut?.settings);
        const nextConsumerDataSources = normalizeConsumerDataSourcesRecord(nextSettings?.consumerDataSources);
        const walletRefs = [...new Set(nextWalletPolicies.map((row) => row.sponsorWalletRef).filter(Boolean))].sort((left, right) =>
          left.localeCompare(right)
        );
        startTransition(() => {
          setPendingItems(nextPending);
          setRecentDecisions(nextDecided);
          setPolicies(nextPolicies);
          setWalletPolicies(nextWalletPolicies);
          setAuthorityGrants(nextAuthorityGrants);
          setDelegationGrants(nextDelegationGrants);
          setTenantDocuments(nextDocuments);
          setTenantBrowserStates(nextBrowserStates);
          setTenantConsumerConnectors(nextConnectors);
          setAccountSessions(nextAccountSessions);
          setTenantSettingsState({
            settings: nextSettings,
            error: ""
          });
          setDataSourceForm({
            email: {
              enabled: nextConsumerDataSources.email.enabled,
              provider: nextConsumerDataSources.email.provider,
              address: nextConsumerDataSources.email.address || "",
              label: nextConsumerDataSources.email.label || "",
              connectedAt: nextConsumerDataSources.email.connectedAt || ""
            },
            calendar: {
              enabled: nextConsumerDataSources.calendar.enabled,
              provider: nextConsumerDataSources.calendar.provider,
              address: nextConsumerDataSources.calendar.address || "",
              timezone: nextConsumerDataSources.calendar.timezone || "",
              availabilityNotes: nextConsumerDataSources.calendar.availabilityNotes || "",
              connectedAt: nextConsumerDataSources.calendar.connectedAt || ""
            }
          });
          setIntegrationState((previous) => ({
            integrations: nextIntegrations,
            error: "",
            message: previous.message,
            busyProvider: ""
          }));
        });
        setSelectedWalletRef((previous) => {
          if (previous && walletRefs.includes(previous)) return previous;
          return walletRefs[0] ?? "";
        });
        const connectedIntegrationsCount = ["slack", "zapier"]
          .map((provider) => asPlainObject(nextIntegrations?.[provider]))
          .filter((row) => row?.connected === true).length;
        const activeSourceCount = [nextConsumerDataSources.email, nextConsumerDataSources.calendar].filter((row) => row.enabled).length;
        setStatusMessage(
          `Loaded ${nextPolicies.length} standing rule${nextPolicies.length === 1 ? "" : "s"}, ${nextPending.length} pending request${nextPending.length === 1 ? "" : "s"}, ${nextDecided.length} decision${nextDecided.length === 1 ? "" : "s"}, ${nextAuthorityGrants.length + nextDelegationGrants.length} active grant${nextAuthorityGrants.length + nextDelegationGrants.length === 1 ? "" : "s"}, ${walletRefs.length} live wallet${walletRefs.length === 1 ? "" : "s"}, ${connectedIntegrationsCount} linked integration${connectedIntegrationsCount === 1 ? "" : "s"}, ${activeSourceCount} source${activeSourceCount === 1 ? "" : "s"}, ${nextConnectors.length} connector${nextConnectors.length === 1 ? "" : "s"}, ${nextBrowserStates.length} browser state${nextBrowserStates.length === 1 ? "" : "s"}, ${nextAccountSessions.length} delegated session${nextAccountSessions.length === 1 ? "" : "s"}, and ${nextDocuments.length} document${nextDocuments.length === 1 ? "" : "s"} in the data wallet.`
        );
      } catch (error) {
        if (cancelled) return;
        setTenantSettingsState({
          settings: null,
          error: error.message
        });
        setStatusMessage(`Authority wallet failed to load: ${error.message}`);
      } finally {
        if (!cancelled) setBusyState("");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, runtime, runtimeReady]);

  useEffect(() => {
    let cancelled = false;

    async function loadWalletDetail() {
      if (!runtimeReady || !selectedWalletRef) {
        setSelectedWalletState({
          loading: false,
          walletRef: selectedWalletRef,
          policies: [],
          budgets: null,
          ledgerEntries: [],
          ledgerSummary: null,
          error: ""
        });
        return;
      }
      setSelectedWalletState((previous) => ({
        ...previous,
        loading: true,
        walletRef: selectedWalletRef,
        error: ""
      }));
      try {
        const [walletPoliciesOut, budgetsOut, ledgerOut] = await Promise.all([
          fetchX402WalletPolicies(runtime, selectedWalletRef, { limit: 20, offset: 0 }),
          fetchX402WalletBudgets(runtime, selectedWalletRef),
          fetchX402WalletLedger(runtime, selectedWalletRef, { limit: 25, offset: 0 })
        ]);
        if (cancelled) return;
        setSelectedWalletState({
          loading: false,
          walletRef: selectedWalletRef,
          policies: extractList(walletPoliciesOut, ["policies", "items", "results"])
            .map((row) => normalizeX402WalletPolicyRecord(row))
            .filter((row) => row.sponsorWalletRef),
          budgets: asPlainObject(budgetsOut?.budgets),
          ledgerEntries: extractList(ledgerOut, ["entries", "items", "results"])
            .map((row) => normalizeX402WalletLedgerEntryRecord(row))
            .filter((row) => row.receiptId || row.runId),
          ledgerSummary: asPlainObject(ledgerOut?.summary),
          error: ""
        });
      } catch (error) {
        if (cancelled) return;
        setSelectedWalletState({
          loading: false,
          walletRef: selectedWalletRef,
          policies: [],
          budgets: null,
          ledgerEntries: [],
          ledgerSummary: null,
          error: error.message
        });
      }
    }

    void loadWalletDetail();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, runtime, runtimeReady, selectedWalletRef]);

  const activePolicies = policies.filter((policy) => policy.status === "active");
  const approvedItems = recentDecisions.filter((item) => item.approved === true || item.status === "approved" || item.status === "resumed");
  const walletRefs = [...new Set(walletPolicies.map((row) => row.sponsorWalletRef).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const selectedWalletPolicies = selectedWalletState.policies.length ? selectedWalletState.policies : walletPolicies.filter((row) => row.sponsorWalletRef === selectedWalletRef);
  const liveWalletBudget = asPlainObject(selectedWalletState.budgets);
  const liveWalletSummary = asPlainObject(selectedWalletState.ledgerSummary);
  const walletProviderIds = Array.from(new Set(selectedWalletPolicies.flatMap((row) => row.allowedProviderIds).filter(Boolean))).sort();
  const walletToolIds = Array.from(new Set(selectedWalletPolicies.flatMap((row) => row.allowedToolIds).filter(Boolean))).sort();
  const walletCurrencies = Array.from(new Set(selectedWalletPolicies.flatMap((row) => row.allowedCurrencies).filter(Boolean))).sort();
  const dataScopes = Array.from(
    new Set([
      ...activePolicies.flatMap((policy) => policy.dataClassesRequested),
      ...approvedItems.flatMap((item) => item.dataClassesRequested)
    ].filter(Boolean))
  ).sort();
  const capabilityScopes = Array.from(
    new Set([
      ...activePolicies.flatMap((policy) => policy.capabilitiesRequested),
      ...approvedItems.flatMap((item) => item.capabilitiesRequested)
    ].filter(Boolean))
  ).sort();
  const sideEffects = Array.from(
    new Set([
      ...activePolicies.flatMap((policy) => policy.sideEffectsRequested),
      ...approvedItems.flatMap((item) => item.sideEffectsRequested)
    ].filter(Boolean))
  ).sort();
  const downstreamRecipients = Array.from(new Set(approvedItems.flatMap((item) => item.downstreamRecipients).filter(Boolean))).sort();
  const spendCaps = Array.from(
    new Set(
      [
        ...activePolicies.map((policy) => policy.maxSpendCents),
        ...approvedItems.map((item) => item.spendLimitCents)
      ].filter((value) => Number.isFinite(Number(value)))
    )
  )
    .map((value) => Number(value))
    .sort((left, right) => left - right);
  const approvalAutoAllowCount = activePolicies.filter((policy) => policy.effect === "approve").length;
  const approvalDenyCount = activePolicies.filter((policy) => policy.effect === "deny").length;
  const relatedAgentIds = Array.from(
    new Set(
      [
        lastAgentId,
        buyer?.tenantId ? `agt_${toIdSlug(buyer.tenantId)}_requester` : null,
        ...pendingItems.map((item) => item.requestedBy),
        ...recentDecisions.map((item) => item.requestedBy),
        ...pendingItems.flatMap((item) => item.downstreamRecipients),
        ...recentDecisions.flatMap((item) => item.downstreamRecipients)
      ]
        .filter((value) => looksLikeAgentId(value))
        .map((value) => String(value).trim())
    )
  ).sort((left, right) => left.localeCompare(right));
  const activeAuthorityGrants = authorityGrants.filter((grant) => grant.status === "active");
  const activeDelegationGrants = delegationGrants.filter((grant) => grant.status === "active");
  const visibleAuthorityGrants = activeAuthorityGrants.filter((grant) => {
    if (buyer?.tenantId && grant.principalId === buyer.tenantId) return true;
    if (runtime.tenantId && grant.principalId === runtime.tenantId) return true;
    if (relatedAgentIds.includes(grant.granteeAgentId)) return true;
    return false;
  });
  const visibleDelegationGrants = activeDelegationGrants.filter(
    (grant) => relatedAgentIds.includes(grant.delegatorAgentId) || relatedAgentIds.includes(grant.delegateeAgentId)
  );
  const integrationMap = asPlainObject(integrationState.integrations);
  const linkedIntegrations = ["slack", "zapier"]
    .map((provider) => asPlainObject(integrationMap?.[provider]))
    .filter(Boolean);
  const connectedIntegrations = linkedIntegrations.filter((integration) => integration.connected === true);
  const activeDocuments = tenantDocuments.filter((document) => !document.revokedAt);
  const activeBrowserStates = tenantBrowserStates.filter((state) => !state.revokedAt);
  const activeConsumerConnectors = tenantConsumerConnectors.filter((connector) => !connector.revokedAt);
  const activeAccountSessions = accountSessions.filter((session) => !session.revokedAt);
  const consumerDataSources = normalizeConsumerDataSourcesRecord(tenantSettingsState.settings?.consumerDataSources);
  const activeDataSources = [consumerDataSources.email, consumerDataSources.calendar].filter((row) => row.enabled);
  const integrationReadinessChecks = [
    {
      id: "identity",
      label: "Workspace identity issued",
      ready: runtimeReady,
      detail: runtimeReady ? "Runtime key and tenant binding are live." : "Finish onboarding and issue a runtime key first."
    },
    {
      id: "sources",
      label: "At least one connected account",
      ready: activeConsumerConnectors.length > 0 || activeDataSources.length > 0,
      detail:
        activeConsumerConnectors.length > 0 || activeDataSources.length > 0
          ? "An email, calendar, or connector record is already available to the host."
          : "Link a connector or enable an email/calendar source before asking a host to act."
    },
    {
      id: "session",
      label: "Delegated session or browser state bound",
      ready: activeAccountSessions.length > 0 || activeBrowserStates.length > 0,
      detail:
        activeAccountSessions.length > 0 || activeBrowserStates.length > 0
          ? "A wallet-owned browser/session handle is available for certified adapters."
          : "Add a delegated session or browser state if the host needs to act inside a consumer account."
    },
    {
      id: "delivery",
      label: "Approval and receipt delivery path visible",
      ready: connectedIntegrations.length > 0,
      detail:
        connectedIntegrations.length > 0
          ? "At least one downstream delivery target is connected for notifications or workflow handoff."
          : "Connect Slack or Zapier if you want approvals and receipts to land outside the hosted pages."
    }
  ];
  const integrationReadyCount = integrationReadinessChecks.filter((check) => check.ready).length;
  const activePolicyTone =
    busyState !== ""
      ? "warn"
      : /failed|error/i.test(statusMessage)
        ? "bad"
        : "good";

  async function handleRevokeGrant(kind, grantId) {
    const normalizedGrantId = String(grantId ?? "").trim();
    if (!normalizedGrantId) return;
    setGrantActionState({
      busyGrantId: normalizedGrantId,
      error: "",
      message: ""
    });
    try {
      if (kind === "authority") {
        await revokeAuthorityGrant(runtime, normalizedGrantId, { revocationReasonCode: "USER_WALLET_REVOKE" });
      } else {
        await revokeDelegationGrant(runtime, normalizedGrantId, { reasonCode: "USER_WALLET_REVOKE" });
      }
      setGrantActionState({
        busyGrantId: "",
        error: "",
        message: `Revoked ${normalizedGrantId}. The wallet will refresh to remove that authority from active execution.`
      });
      setReloadToken((value) => value + 1);
    } catch (error) {
      setGrantActionState({
        busyGrantId: "",
        error: error.message,
        message: ""
      });
    }
  }

  async function handleDisconnectIntegration(provider) {
    const normalizedProvider = String(provider ?? "").trim().toLowerCase();
    if (!normalizedProvider) return;
    setIntegrationState((previous) => ({
      ...previous,
      busyProvider: normalizedProvider,
      error: "",
      message: ""
    }));
    try {
      const out = await disconnectTenantIntegration(runtime, normalizedProvider);
      setIntegrationState({
        integrations: asPlainObject(out?.integrations),
        error: "",
        message: `${humanizeLabel(normalizedProvider)} access was disconnected from this workspace.`,
        busyProvider: ""
      });
      setReloadToken((value) => value + 1);
    } catch (error) {
      setIntegrationState((previous) => ({
        ...previous,
        busyProvider: "",
        error: error.message,
        message: ""
      }));
    }
  }

  async function handleRevokeDocument(documentId) {
    const normalizedDocumentId = String(documentId ?? "").trim();
    if (!normalizedDocumentId) return;
    setIntegrationState((previous) => ({
      ...previous,
      busyProvider: normalizedDocumentId,
      error: "",
      message: ""
    }));
    try {
      await revokeTenantDocument(runtime, normalizedDocumentId, { reason: "USER_WALLET_REVOKE" });
      setIntegrationState((previous) => ({
        ...previous,
        busyProvider: "",
        error: "",
        message: `Revoked ${normalizedDocumentId} from the data wallet.`
      }));
      setReloadToken((value) => value + 1);
    } catch (error) {
      setIntegrationState((previous) => ({
        ...previous,
        busyProvider: "",
        error: error.message,
        message: ""
      }));
    }
  }

  function updateBrowserStateForm(field, value) {
    setBrowserStateForm((previous) => ({
      ...previous,
      [field]: value
    }));
  }

  async function handleCreateBrowserState() {
    let storageState = null;
    try {
      storageState = JSON.parse(String(browserStateForm.storageStateJson ?? "").trim() || "{}");
    } catch {
      setBrowserStateActionState({
        busyStateId: "",
        error: "Browser state must be valid JSON before it can be saved.",
        message: ""
      });
      return;
    }
    setBrowserStateActionState({
      busyStateId: "create",
      error: "",
      message: ""
    });
    try {
      const out = await createTenantBrowserState(runtime, {
        label: String(browserStateForm.label ?? "").trim() || null,
        purpose: String(browserStateForm.purpose ?? "").trim() || null,
        storageState
      });
      const record = normalizeTenantBrowserStateRecord(out?.browserState);
      if (record.stateRef) {
        setAccountSessionForm((previous) => ({
          ...previous,
          browserStorageStateRef: record.stateRef,
          browserAllowedDomains:
            previous.browserAllowedDomains ||
            (record.storageState.origins || [])
              .map((entry) => {
                const origin = pickFirstString(asPlainObject(entry)?.origin);
                try {
                  return origin ? new URL(origin).hostname.toLowerCase() : "";
                } catch {
                  return "";
                }
              })
              .filter(Boolean)
              .join(", ")
        }));
      }
      setBrowserStateActionState({
        busyStateId: "",
        error: "",
        message: `${record.label || record.stateId || "Browser state"} is saved in the wallet and ready for delegated sessions.`
      });
      setReloadToken((value) => value + 1);
    } catch (error) {
      setBrowserStateActionState({
        busyStateId: "",
        error: error.message,
        message: ""
      });
    }
  }

  async function handleRevokeBrowserState(stateId) {
    const normalizedStateId = String(stateId ?? "").trim();
    if (!normalizedStateId) return;
    setBrowserStateActionState({
      busyStateId: normalizedStateId,
      error: "",
      message: ""
    });
    try {
      await revokeTenantBrowserState(runtime, normalizedStateId, { reason: "USER_WALLET_REVOKE_BROWSER_STATE" });
      setBrowserStateActionState({
        busyStateId: "",
        error: "",
        message: `Revoked ${normalizedStateId} from the browser-state vault.`
      });
      setReloadToken((value) => value + 1);
    } catch (error) {
      setBrowserStateActionState({
        busyStateId: "",
        error: error.message,
        message: ""
      });
    }
  }

  function handleUseBrowserStateForSession(stateRef) {
    const normalizedStateRef = String(stateRef ?? "").trim();
    if (!normalizedStateRef) return;
    setAccountSessionForm((previous) => ({
      ...previous,
      browserStorageStateRef: normalizedStateRef
    }));
    setBrowserStateActionState({
      busyStateId: "",
      error: "",
      message: `${normalizedStateRef} is now selected for the delegated session draft below.`
    });
  }

  function updateConnectorForm(field, value) {
    setConnectorForm((previous) => ({
      ...previous,
      [field]: value,
      ...(field === "kind"
        ? {
            provider: value === "calendar" ? "google_calendar" : "gmail",
            timezone: value === "calendar" ? previous.timezone : ""
          }
        : {})
    }));
  }

  async function handleCreateConsumerConnector() {
    if (!String(connectorForm.accountAddress ?? "").trim() && !String(connectorForm.accountLabel ?? "").trim()) {
      setConnectorActionState({
        busyConnectorId: "",
        error: "A connector needs either an account address or a label before it can be saved.",
        message: ""
      });
      return;
    }
    setConnectorActionState({
      busyConnectorId: "create",
      error: "",
      message: ""
    });
    try {
      const scopes = String(connectorForm.scopesText ?? "")
        .split(/[\n,]+/g)
        .map((value) => value.trim())
        .filter(Boolean);
      const out = await createTenantConsumerConnector(runtime, {
        kind: connectorForm.kind,
        provider: connectorForm.provider,
        mode: connectorForm.mode,
        accountAddress: String(connectorForm.accountAddress ?? "").trim() || null,
        accountLabel: String(connectorForm.accountLabel ?? "").trim() || null,
        timezone: connectorForm.kind === "calendar" ? String(connectorForm.timezone ?? "").trim() || null : null,
        scopes
      });
      const connector = normalizeTenantConsumerConnectorRecord(out?.connector);
      if (connector.kind === "email") {
        setDataSourceForm((previous) => ({
          ...previous,
          email: {
            ...previous.email,
            enabled: true,
            provider: connector.provider || previous.email.provider,
            address: connector.accountAddress || previous.email.address,
            label: connector.accountLabel || previous.email.label,
            connectedAt: connector.connectedAt || previous.email.connectedAt
          }
        }));
      } else if (connector.kind === "calendar") {
        setDataSourceForm((previous) => ({
          ...previous,
          calendar: {
            ...previous.calendar,
            enabled: true,
            provider: connector.provider || previous.calendar.provider,
            address: connector.accountAddress || previous.calendar.address,
            timezone: connector.timezone || previous.calendar.timezone,
            connectedAt: connector.connectedAt || previous.calendar.connectedAt
          }
        }));
      }
      setConnectorActionState({
        busyConnectorId: "",
        error: "",
        message: `${connector.accountLabel || connector.accountAddress || connector.connectorId} is now saved as a wallet connector.`
      });
      setReloadToken((value) => value + 1);
    } catch (error) {
      setConnectorActionState({
        busyConnectorId: "",
        error: error.message,
        message: ""
      });
    }
  }

  async function handleRevokeConsumerConnector(connectorId) {
    const normalizedConnectorId = String(connectorId ?? "").trim();
    if (!normalizedConnectorId) return;
    setConnectorActionState({
      busyConnectorId: normalizedConnectorId,
      error: "",
      message: ""
    });
    try {
      await revokeTenantConsumerConnector(runtime, normalizedConnectorId, { reason: "USER_WALLET_REVOKE_CONNECTOR" });
      setConnectorActionState({
        busyConnectorId: "",
        error: "",
        message: `Revoked ${normalizedConnectorId} from the wallet connector registry.`
      });
      setReloadToken((value) => value + 1);
    } catch (error) {
      setConnectorActionState({
        busyConnectorId: "",
        error: error.message,
        message: ""
      });
    }
  }

  function handleStartConnectorOauth(kind, provider) {
    try {
      const returnTo =
        typeof window !== "undefined"
          ? `${window.location.origin}${isIntegrationsSurface ? "/integrations" : "/wallet"}`
          : null;
      const href = buildTenantConsumerConnectorOauthStartUrl(runtime, {
        kind,
        provider,
        returnTo,
        accountAddressHint: connectorForm.kind === kind ? connectorForm.accountAddress : null,
        accountLabelHint: connectorForm.kind === kind ? connectorForm.accountLabel : null,
        timezone: kind === "calendar" ? connectorForm.timezone : null
      });
      if (typeof window !== "undefined") window.location.assign(href);
    } catch (error) {
      setConnectorActionState({
        busyConnectorId: "",
        error: error.message,
        message: ""
      });
    }
  }

  function updateDataSourceForm(kind, field, value) {
    setDataSourceForm((previous) => ({
      ...previous,
      [kind]: {
        ...previous[kind],
        [field]: value
      }
    }));
  }

  async function handleSaveDataSource(kind) {
    const normalizedKind = kind === "calendar" ? "calendar" : "email";
    const draft = asPlainObject(dataSourceForm?.[normalizedKind]) ?? {};
    if (normalizedKind === "email" && Boolean(draft.enabled) && !String(draft.address ?? "").trim()) {
      setDataSourceActionState({
        busySource: "",
        error: "Email source requires an address before it can be enabled.",
        message: ""
      });
      return;
    }
    if (normalizedKind === "calendar" && Boolean(draft.enabled) && !String(draft.timezone ?? "").trim()) {
      setDataSourceActionState({
        busySource: "",
        error: "Calendar source requires a timezone before it can be enabled.",
        message: ""
      });
      return;
    }
    setDataSourceActionState({
      busySource: normalizedKind,
      error: "",
      message: ""
    });
    try {
      const currentSource = consumerDataSources[normalizedKind];
      const patch = {
        consumerDataSources: {
          [normalizedKind]: {
            ...draft,
            connectedAt: draft.enabled ? String(draft.connectedAt || currentSource.connectedAt || new Date().toISOString()) : null
          }
        }
      };
      const out = await updateTenantSettings(runtime, patch);
      const nextSettings = asPlainObject(out?.settings);
      const nextConsumerDataSources = normalizeConsumerDataSourcesRecord(nextSettings?.consumerDataSources);
      setTenantSettingsState({
        settings: nextSettings,
        error: ""
      });
      setDataSourceForm({
        email: {
          enabled: nextConsumerDataSources.email.enabled,
          provider: nextConsumerDataSources.email.provider,
          address: nextConsumerDataSources.email.address || "",
          label: nextConsumerDataSources.email.label || "",
          connectedAt: nextConsumerDataSources.email.connectedAt || ""
        },
        calendar: {
          enabled: nextConsumerDataSources.calendar.enabled,
          provider: nextConsumerDataSources.calendar.provider,
          address: nextConsumerDataSources.calendar.address || "",
          timezone: nextConsumerDataSources.calendar.timezone || "",
          availabilityNotes: nextConsumerDataSources.calendar.availabilityNotes || "",
          connectedAt: nextConsumerDataSources.calendar.connectedAt || ""
        }
      });
      setDataSourceActionState({
        busySource: "",
        error: "",
        message: `${humanizeLabel(normalizedKind)} source ${nextConsumerDataSources[normalizedKind].enabled ? "saved" : "disabled"} in the wallet.`
      });
    } catch (error) {
      setDataSourceActionState({
        busySource: "",
        error: error.message,
        message: ""
      });
    }
  }

  function updateAccountSessionForm(field, value) {
    setAccountSessionForm((previous) => ({
      ...previous,
      [field]: value
    }));
  }

  async function handleCreateAccountSession() {
    if (!String(accountSessionForm.accountHandleMasked ?? "").trim()) {
      setAccountSessionActionState({
        busySessionId: "",
        error: "Account handle is required before a delegated session can be saved.",
        message: ""
      });
      return;
    }
    setAccountSessionActionState({
      busySessionId: "create",
      error: "",
      message: ""
    });
    try {
      const normalizedAllowedDomains = String(accountSessionForm.browserAllowedDomains ?? "")
        .split(/[\n,\s]+/g)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      const browserProfile =
        String(accountSessionForm.browserStorageStateRef ?? "").trim() ||
        String(accountSessionForm.browserLoginOrigin ?? "").trim() ||
        String(accountSessionForm.browserStartUrl ?? "").trim() ||
        normalizedAllowedDomains.length > 0 ||
        String(accountSessionForm.browserReviewMode ?? "").trim()
          ? {
              ...(String(accountSessionForm.browserStorageStateRef ?? "").trim()
                ? { storageStateRef: String(accountSessionForm.browserStorageStateRef).trim() }
                : {}),
              ...(String(accountSessionForm.browserLoginOrigin ?? "").trim()
                ? { loginOrigin: String(accountSessionForm.browserLoginOrigin).trim() }
                : {}),
              ...(String(accountSessionForm.browserStartUrl ?? "").trim()
                ? { startUrl: String(accountSessionForm.browserStartUrl).trim() }
                : {}),
              ...(normalizedAllowedDomains.length > 0 ? { allowedDomains: normalizedAllowedDomains } : {}),
              ...(String(accountSessionForm.browserReviewMode ?? "").trim()
                ? { reviewMode: String(accountSessionForm.browserReviewMode).trim() }
                : {})
            }
          : null;
      await createTenantAccountSession(runtime, {
        providerKey: accountSessionForm.providerKey,
        providerLabel: accountSessionForm.providerLabel,
        siteKey: accountSessionForm.siteKey,
        siteLabel: accountSessionForm.siteLabel,
        mode: accountSessionForm.mode,
        accountHandleMasked: accountSessionForm.accountHandleMasked,
        fundingSourceLabel: String(accountSessionForm.fundingSourceLabel ?? "").trim() || null,
        maxSpendCents: String(accountSessionForm.maxSpendCents ?? "").trim() ? Number.parseInt(String(accountSessionForm.maxSpendCents), 10) : null,
        currency: accountSessionForm.currency,
        permissions: {
          canPurchase: Boolean(accountSessionForm.canPurchase),
          canUseSavedPaymentMethods: Boolean(accountSessionForm.canUseSavedPaymentMethods),
          requiresFinalReview: Boolean(accountSessionForm.requiresFinalReview)
        },
        browserProfile
      });
      setAccountSessionActionState({
        busySessionId: "",
        error: "",
        message: "Delegated account session saved in the wallet."
      });
      setAccountSessionForm((previous) => ({
        ...previous,
        accountHandleMasked: "",
        fundingSourceLabel: "",
        maxSpendCents: "",
        browserStorageStateRef: "",
        browserLoginOrigin: "",
        browserStartUrl: "",
        browserAllowedDomains: "",
        browserReviewMode: ""
      }));
      setReloadToken((value) => value + 1);
    } catch (error) {
      setAccountSessionActionState({
        busySessionId: "",
        error: error.message,
        message: ""
      });
    }
  }

  async function handleRevokeAccountSession(sessionId) {
    const normalizedSessionId = String(sessionId ?? "").trim();
    if (!normalizedSessionId) return;
    setAccountSessionActionState({
      busySessionId: normalizedSessionId,
      error: "",
      message: ""
    });
    try {
      await revokeTenantAccountSession(runtime, normalizedSessionId, { reason: "USER_WALLET_REVOKE" });
      setAccountSessionActionState({
        busySessionId: "",
        error: "",
        message: `Revoked ${normalizedSessionId} from the wallet.`
      });
      setReloadToken((value) => value + 1);
    } catch (error) {
      setAccountSessionActionState({
        busySessionId: "",
        error: error.message,
        message: ""
      });
    }
  }

  useEffect(() => {
    replaceCurrentSearchParams({ wallet: selectedWalletRef || null });
  }, [selectedWalletRef]);

  return (
    <div className="product-page">
      <section className="product-page-top">
        <div>
          <p className="product-kicker">{isIntegrationsSurface ? "Integrations" : "Action Wallet"}</p>
          <h1>
            {isIntegrationsSurface
              ? "Connect the accounts, browser state, and tools your host can safely use."
              : "See the access, policy, evidence, and spend boundaries behind execution."}
          </h1>
          <p className="product-lead">
            {isIntegrationsSurface
              ? "This is the focused control surface for linked systems: email and calendar connectors, browser state, delegated sessions, documents, and outbound integrations that the wallet can revoke."
              : "This is the consumer-facing read model for the Action Wallet: approvals, standing rules, trusted hosts, sessions, and payment guardrails before and after a run."}
          </p>
        </div>
        <div className="product-page-top-actions">
          {isIntegrationsSurface ? <a className="product-button product-button-ghost" href="/wallet">Open wallet</a> : <a className="product-button product-button-ghost" href="/approvals">Open approvals</a>}
          <a className="product-button product-button-ghost" href="/onboarding">{isIntegrationsSurface ? "Manage identity" : "Manage identity"}</a>
          <button className="product-button product-button-solid" type="button" disabled={busyState !== ""} onClick={() => setReloadToken((value) => value + 1)}>
            {busyState === "loading" ? "Refreshing..." : isIntegrationsSurface ? "Refresh integrations" : "Refresh wallet"}
          </button>
        </div>
      </section>

      {!runtimeReady ? (
        <div className="product-inline-note warn">
          Complete <a href="/onboarding">Workspace Onboarding</a> first. This page reads live approval and policy state from the runtime, not local form defaults.
        </div>
      ) : null}

      <div className={`product-inline-note ${activePolicyTone}`}>{statusMessage}</div>

      {isIntegrationsSurface ? (
        <>
          <section className="product-bullet-grid">
            <div className="product-bullet-card">
              <strong>1. Connect accounts</strong>
              <span>Link email, calendar, and outbound systems with revocable connector records instead of hidden runtime state.</span>
            </div>
            <div className="product-bullet-card">
              <strong>2. Bind session state</strong>
              <span>Store browser state and delegated sessions as wallet-owned handles with explicit mode and spend boundaries.</span>
            </div>
            <div className="product-bullet-card">
              <strong>3. Keep delivery observable</strong>
              <span>See downstream integrations, delivery health, retries, and attached documents from the same control surface.</span>
            </div>
          </section>

          <section className="product-card">
            <div className="product-section-head compact">
              <p>Install to first approval</p>
              <h2>Use this checklist to get one host from setup to a governed action without hidden prerequisites.</h2>
            </div>
            <div className="product-detail-meta">
              <div>
                <strong>Ready checks</strong>
                <span>{integrationReadyCount} / {integrationReadinessChecks.length}</span>
              </div>
              <div>
                <strong>Recommended hosts</strong>
                <span>Claude MCP, OpenClaw, Codex, API, CLI</span>
              </div>
              <div>
                <strong>Approval surface</strong>
                <span>Hosted, durable, and tenant-scoped</span>
              </div>
              <div>
                <strong>Receipt + recourse</strong>
                <span>Always routed through Nooterra</span>
              </div>
            </div>
            <div className="product-step-list">
              {integrationReadinessChecks.map((check) => (
                <div key={`integration_readiness:${check.id}`} className="product-step-item">
                  <div className="product-step-copy">
                    <strong>{check.label}</strong>
                    <span>{check.detail}</span>
                  </div>
                  <StatusPill value={check.ready ? "active" : "pending"} />
                </div>
              ))}
            </div>
            <div className="product-actions">
              <a className="product-button product-button-ghost" href="/approvals">Open approvals</a>
              <a className="product-button product-button-ghost" href="/receipts">Open receipts</a>
              <a className="product-button product-button-solid" href={docsLinks.hostQuickstart}>Open host quickstart</a>
            </div>
          </section>

          <section className="product-metric-grid">
            <article className="product-metric-card">
            <span>Linked integrations</span>
            <strong>{connectedIntegrations.length}</strong>
            <small>Workspace integrations connected for outbound delivery or automation hooks.</small>
          </article>
          <article className="product-metric-card">
            <span>Data sources</span>
            <strong>{activeDataSources.length}</strong>
            <small>Email and calendar defaults reusable by approved host actions.</small>
          </article>
          <article className="product-metric-card">
            <span>Connectors</span>
            <strong>{activeConsumerConnectors.length}</strong>
            <small>Revocable linked accounts available to the wallet.</small>
          </article>
          <article className="product-metric-card">
            <span>Browser states</span>
            <strong>{activeBrowserStates.length}</strong>
            <small>Bound browser-state artifacts available to certified adapters.</small>
          </article>
          <article className="product-metric-card">
            <span>Delegated sessions</span>
            <strong>{activeAccountSessions.length}</strong>
            <small>Reusable delegated sessions with explicit mode and spend boundaries.</small>
          </article>
          <article className="product-metric-card">
            <span>Documents</span>
            <strong>{activeDocuments.length}</strong>
            <small>Wallet-owned documents that can be attached to governed actions.</small>
          </article>
          </section>
        </>
      ) : (
        <>
          <section className="product-metric-grid">
            <article className="product-metric-card">
              <span>Standing Rules</span>
              <strong>{activePolicies.length}</strong>
              <small>Active policies shaping approvals and spend.</small>
            </article>
            <article className="product-metric-card">
              <span>Pending Requests</span>
              <strong>{pendingItems.length}</strong>
              <small>Authority boundaries still waiting for a human answer.</small>
            </article>
            <article className="product-metric-card">
              <span>Data Scopes</span>
              <strong>{dataScopes.length}</strong>
              <small>Distinct data classes already represented in policy or approved runs.</small>
            </article>
            <article className="product-metric-card">
              <span>Linked Systems</span>
              <strong>{connectedIntegrations.length + activeDocuments.length + activeDataSources.length + activeAccountSessions.length}</strong>
              <small>Wallet-owned integrations, source records, delegated sessions, and uploaded documents that the user can revoke.</small>
            </article>
            <article className="product-metric-card">
              <span>Spend Caps</span>
              <strong>{spendCaps.length}</strong>
              <small>Distinct max-spend guardrails already configured.</small>
            </article>
            <article className="product-metric-card">
              <span>Live Wallets</span>
              <strong>{walletRefs.length}</strong>
              <small>x402 sponsor wallets visible to the current runtime.</small>
            </article>
            <article className="product-metric-card">
              <span>Execution Grants</span>
              <strong>{visibleAuthorityGrants.length + visibleDelegationGrants.length}</strong>
              <small>Active authority and delegation paths the wallet can still revoke.</small>
            </article>
          </section>

          <section className="product-grid-two">
            <article className="product-card">
              <div className="product-section-head compact">
                <p>Identity</p>
                <h2>Identity, sessions, and runtime access stay linked.</h2>
              </div>
              <div className="product-detail-meta">
                <div>
                  <strong>Principal</strong>
                  <span>{buyer?.email ?? "Guest mode"}</span>
                </div>
                <div>
                  <strong>Tenant</strong>
                  <span>{buyer?.tenantId ?? runtime.tenantId ?? "Not resolved"}</span>
                </div>
                <div>
                  <strong>Role</strong>
                  <span>{buyer?.role ?? "guest"}</span>
                </div>
                <div>
                  <strong>Runtime key</strong>
                  <span>{bootstrapBundle?.bootstrap?.apiKey?.keyId ?? maskToken(runtime.apiKey)}</span>
                </div>
                <div>
                  <strong>Documents</strong>
                  <span>{activeDocuments.length}</span>
                </div>
                <div>
                  <strong>Browser states</strong>
                  <span>{activeBrowserStates.length}</span>
                </div>
                <div>
                  <strong>Connectors</strong>
                  <span>{activeConsumerConnectors.length}</span>
                </div>
              </div>
              <div className="product-sidebar-list">
                <div>
                  <strong>Session status</strong>
                  <span>{buyer ? "Authenticated and bootstrapped for Action Wallet approvals." : "Preview only until you sign in and issue runtime bootstrap."}</span>
                </div>
                <div>
                  <strong>Trusted client</strong>
                  <span>{bootstrapBundle?.bootstrap?.apiKey?.issuedAt ? `Current runtime issued ${formatDateTime(bootstrapBundle.bootstrap.apiKey.issuedAt)}` : "No hosted runtime bootstrap issued yet."}</span>
                </div>
                <div>
                  <strong>Recent host flow</strong>
                  <span>{lastLaunchId ? `Latest tracked host flow is ${lastLaunchId}.` : "No host flow has been recorded in this browser yet."}</span>
                </div>
                <div>
                  <strong>Document vault</strong>
                  <span>{activeDocuments.length ? `${activeDocuments.length} uploaded document${activeDocuments.length === 1 ? "" : "s"} currently sit in the workspace data wallet.` : "No uploaded documents are currently available."}</span>
                </div>
                <div>
                  <strong>Data sources</strong>
                  <span>{activeDataSources.length ? `${activeDataSources.length} wallet-owned source${activeDataSources.length === 1 ? "" : "s"} can be reused by approved runs.` : "No email or calendar sources are enabled yet."}</span>
                </div>
                <div>
                  <strong>Connected accounts</strong>
                  <span>{activeConsumerConnectors.length ? `${activeConsumerConnectors.length} connector${activeConsumerConnectors.length === 1 ? "" : "s"} are active for email and calendar workflows.` : "No consumer connectors are active yet."}</span>
                </div>
                <div>
                  <strong>Delegated sessions</strong>
                  <span>{activeAccountSessions.length ? `${activeAccountSessions.length} consumer site session${activeAccountSessions.length === 1 ? "" : "s"} are available for bounded execution.` : "No delegated consumer sessions are active yet."}</span>
                </div>
                <div>
                  <strong>Browser-state vault</strong>
                  <span>{activeBrowserStates.length ? `${activeBrowserStates.length} revocable browser state${activeBrowserStates.length === 1 ? "" : "s"} are ready for certified adapters.` : "No stored browser states are available yet."}</span>
                </div>
              </div>
            </article>

            <article className="product-card">
              <div className="product-section-head compact">
                <p>Policy Wallet</p>
                <h2>Standing rules are the reusable approval layer.</h2>
              </div>
              <div className="product-detail-meta">
                <div>
                  <strong>Auto-approve rules</strong>
                  <span>{approvalAutoAllowCount}</span>
                </div>
                <div>
                  <strong>Deny rules</strong>
                  <span>{approvalDenyCount}</span>
                </div>
                <div>
                  <strong>Pending boundaries</strong>
                  <span>{pendingItems.length}</span>
                </div>
                <div>
                  <strong>Approved decisions</strong>
                  <span>{approvedItems.length}</span>
                </div>
              </div>
              {activePolicies.length > 0 ? (
                <div className="product-step-list">
                  {activePolicies.slice(0, 6).map((policy) => (
                    <div key={policy.policyId} className="product-step-item">
                      <div className="product-step-copy">
                        <strong>{policy.name}</strong>
                        <span>{policy.description || `${humanizeLabel(policy.effect)} ${policy.capabilitiesRequested.length ? "for selected capabilities" : "for matched requests"}.`}</span>
                      </div>
                      <StatusPill value={policy.effect === "deny" ? "denied" : policy.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="product-empty-state">No standing policies are configured yet.</div>
              )}
            </article>
          </section>
        </>
      )}

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>{isIntegrationsSurface ? "Connection Inventory" : "Data Wallet"}</p>
            <h2>
              {isIntegrationsSurface
                ? "Provision linked systems, reusable inputs, and revocable handles from one inventory."
                : "Keep the granted scope and linked systems readable."}
            </h2>
          </div>
          <div className="product-detail-meta">
            {isIntegrationsSurface ? (
              <>
                <div>
                  <strong>Linked integrations</strong>
                  <span>{connectedIntegrations.length}</span>
                </div>
                <div>
                  <strong>Email / calendar sources</strong>
                  <span>{activeDataSources.length}</span>
                </div>
                <div>
                  <strong>Connectors</strong>
                  <span>{activeConsumerConnectors.length}</span>
                </div>
                <div>
                  <strong>Uploaded documents</strong>
                  <span>{activeDocuments.length}</span>
                </div>
                <div>
                  <strong>Browser states</strong>
                  <span>{activeBrowserStates.length}</span>
                </div>
                <div>
                  <strong>Delegated sessions</strong>
                  <span>{activeAccountSessions.length}</span>
                </div>
                <div>
                  <strong>Downstream recipients</strong>
                  <span>{downstreamRecipients.length}</span>
                </div>
                <div>
                  <strong>Capabilities in scope</strong>
                  <span>{capabilityScopes.length}</span>
                </div>
              </>
            ) : (
              <>
                <div>
                  <strong>Capabilities</strong>
                  <span>{capabilityScopes.length}</span>
                </div>
                <div>
                  <strong>Data classes</strong>
                  <span>{dataScopes.length}</span>
                </div>
                <div>
                  <strong>Side effects</strong>
                  <span>{sideEffects.length}</span>
                </div>
                <div>
                  <strong>Downstream recipients</strong>
                  <span>{downstreamRecipients.length}</span>
                </div>
                <div>
                  <strong>Linked integrations</strong>
                  <span>{connectedIntegrations.length}</span>
                </div>
                <div>
                  <strong>Email / calendar sources</strong>
                  <span>{activeDataSources.length}</span>
                </div>
                <div>
                  <strong>Connectors</strong>
                  <span>{activeConsumerConnectors.length}</span>
                </div>
                <div>
                  <strong>Uploaded documents</strong>
                  <span>{activeDocuments.length}</span>
                </div>
                <div>
                  <strong>Browser states</strong>
                  <span>{activeBrowserStates.length}</span>
                </div>
                <div>
                  <strong>Delegated sessions</strong>
                  <span>{activeAccountSessions.length}</span>
                </div>
              </>
            )}
          </div>
          {integrationState.error ? <div className="product-inline-note bad">{integrationState.error}</div> : null}
          {integrationState.message ? <div className="product-inline-note good">{integrationState.message}</div> : null}
          {tenantSettingsState.error ? <div className="product-inline-note bad">{tenantSettingsState.error}</div> : null}
          {dataSourceActionState.error ? <div className="product-inline-note bad">{dataSourceActionState.error}</div> : null}
          {dataSourceActionState.message ? <div className="product-inline-note good">{dataSourceActionState.message}</div> : null}
          {oauthStatus === "success" ? (
            <div className="product-inline-note good">
              {`Connected ${humanizeLabel(oauthProvider || oauthKind || "account", oauthProvider || oauthKind || "account")} through OAuth.`}
            </div>
          ) : null}
          {oauthStatus === "error" ? (
            <div className="product-inline-note bad">
              {oauthMessage || `OAuth connection failed for ${humanizeLabel(oauthProvider || oauthKind || "account", oauthProvider || oauthKind || "account")}.`}
            </div>
          ) : null}
          {connectorActionState.error ? <div className="product-inline-note bad">{connectorActionState.error}</div> : null}
          {connectorActionState.message ? <div className="product-inline-note good">{connectorActionState.message}</div> : null}
          {browserStateActionState.error ? <div className="product-inline-note bad">{browserStateActionState.error}</div> : null}
          {browserStateActionState.message ? <div className="product-inline-note good">{browserStateActionState.message}</div> : null}
          {accountSessionActionState.error ? <div className="product-inline-note bad">{accountSessionActionState.error}</div> : null}
          {accountSessionActionState.message ? <div className="product-inline-note good">{accountSessionActionState.message}</div> : null}
          {capabilityScopes.length || dataScopes.length || sideEffects.length ? (
            <>
              {capabilityScopes.length ? (
                <div className="product-badge-row">
                  {capabilityScopes.slice(0, 8).map((entry) => (
                    <span key={`cap:${entry}`} className="product-badge">{entry}</span>
                  ))}
                </div>
              ) : null}
              {dataScopes.length ? (
                <div className="product-badge-row">
                  {dataScopes.slice(0, 8).map((entry) => (
                    <span key={`data:${entry}`} className="product-badge">{entry}</span>
                  ))}
                </div>
              ) : null}
              {sideEffects.length ? (
                <div className="product-badge-row">
                  {sideEffects.slice(0, 8).map((entry) => (
                    <span key={`fx:${entry}`} className="product-badge">{humanizeLabel(entry, entry)}</span>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="product-empty-state">
              {isIntegrationsSurface
                ? "No linked systems or granted scopes are visible yet. Start by linking connectors, browser state, or delegated sessions."
                : "No granted scopes are visible yet. Approvals and policies will populate this surface."}
            </div>
          )}
          <div className="product-grid-two">
            <article className="product-card product-card-subtle">
              <div className="product-section-head compact">
                <p>Connected Accounts</p>
                <h2>Store revocable email and calendar connectors separately from reusable source defaults.</h2>
              </div>
              <div className="product-inline-note accent">
                Connectors represent linked accounts. Source records are the lighter-weight defaults the host can reuse during execution.
              </div>
              <div className="product-form-grid">
                <label>
                  <span>Kind</span>
                  <select value={connectorForm.kind} onChange={(event) => updateConnectorForm("kind", event.target.value)}>
                    <option value="email">email</option>
                    <option value="calendar">calendar</option>
                  </select>
                </label>
                <label>
                  <span>Provider</span>
                  <select value={connectorForm.provider} onChange={(event) => updateConnectorForm("provider", event.target.value)}>
                    {connectorForm.kind === "calendar" ? (
                      <>
                        <option value="google_calendar">google calendar</option>
                        <option value="outlook_calendar">outlook calendar</option>
                        <option value="ical">iCal</option>
                        <option value="manual">manual</option>
                      </>
                    ) : (
                      <>
                        <option value="gmail">gmail</option>
                        <option value="outlook">outlook</option>
                        <option value="imap">imap</option>
                        <option value="manual">manual</option>
                      </>
                    )}
                  </select>
                </label>
                <label>
                  <span>Link mode</span>
                  <select value={connectorForm.mode} onChange={(event) => updateConnectorForm("mode", event.target.value)}>
                    <option value="oauth">oauth</option>
                    <option value="device_code">device code</option>
                    <option value="app_password">app password</option>
                    <option value="manual">manual</option>
                  </select>
                </label>
                <label>
                  <span>Account address</span>
                  <input
                    value={connectorForm.accountAddress}
                    onChange={(event) => updateConnectorForm("accountAddress", event.target.value)}
                    placeholder={connectorForm.kind === "calendar" ? "calendar@example.com" : "me@example.com"}
                  />
                </label>
                <label>
                  <span>Label</span>
                  <input value={connectorForm.accountLabel} onChange={(event) => updateConnectorForm("accountLabel", event.target.value)} placeholder="Primary work account" />
                </label>
                {connectorForm.kind === "calendar" ? (
                  <label>
                    <span>Timezone</span>
                    <input value={connectorForm.timezone} onChange={(event) => updateConnectorForm("timezone", event.target.value)} placeholder="America/Los_Angeles" />
                  </label>
                ) : null}
                <label className="wide">
                  <span>Scopes</span>
                  <textarea
                    value={connectorForm.scopesText}
                    onChange={(event) => updateConnectorForm("scopesText", event.target.value)}
                    rows={3}
                    placeholder={connectorForm.kind === "calendar" ? "calendar.readonly, events.write" : "mail.readonly, mail.send"}
                  />
                </label>
              </div>
              <div className="product-actions">
                <button
                  className="product-button product-button-solid"
                  type="button"
                  disabled={connectorActionState.busyConnectorId !== ""}
                  onClick={() => void handleCreateConsumerConnector()}
                >
                  {connectorActionState.busyConnectorId === "create" ? "Saving..." : "Save connector"}
                </button>
                {connectorForm.kind === "email" ? (
                  <>
                    <button className="product-button product-button-ghost" type="button" onClick={() => handleStartConnectorOauth("email", "gmail")}>
                      Connect Gmail
                    </button>
                    <button className="product-button product-button-ghost" type="button" onClick={() => handleStartConnectorOauth("email", "outlook")}>
                      Connect Outlook
                    </button>
                  </>
                ) : (
                  <>
                    <button className="product-button product-button-ghost" type="button" onClick={() => handleStartConnectorOauth("calendar", "google_calendar")}>
                      Connect Google Calendar
                    </button>
                    <button className="product-button product-button-ghost" type="button" onClick={() => handleStartConnectorOauth("calendar", "outlook_calendar")}>
                      Connect Outlook Calendar
                    </button>
                  </>
                )}
              </div>
              {activeConsumerConnectors.length ? (
                <div className="product-step-list">
                  {activeConsumerConnectors.slice(0, 8).map((connector) => (
                    <div key={`consumer_connector:${connector.connectorId}`} className="product-step-item">
                      <div className="product-step-copy">
                        <strong>{connector.accountLabel || connector.accountAddress || connector.connectorId}</strong>
                        <span>{humanizeLabel(connector.kind, connector.kind)} · {humanizeLabel(connector.provider, connector.provider)} · {humanizeLabel(connector.mode, connector.mode)}</span>
                        <span>
                          {connector.accountAddress || "No address"}
                          {connector.timezone ? ` · ${connector.timezone}` : ""}
                          {connector.connectedAt ? ` · ${formatDateTime(connector.connectedAt)}` : ""}
                        </span>
                        {connector.scopes.length ? <span>{connector.scopes.join(", ")}</span> : null}
                        <span>{connector.connectorRef}</span>
                      </div>
                      <div className="product-approval-step-meta">
                        <StatusPill value={connector.status || "active"} />
                      </div>
                      <div className="product-actions">
                        <button
                          className="product-button product-button-ghost"
                          type="button"
                          onClick={() => void handleRevokeConsumerConnector(connector.connectorId)}
                          disabled={connectorActionState.busyConnectorId === connector.connectorId}
                        >
                          {connectorActionState.busyConnectorId === connector.connectorId ? "Revoking..." : "Revoke"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="product-empty-state">No consumer connectors are active yet.</div>
              )}
            </article>
            <article className="product-card product-card-subtle">
              <div className="product-section-head compact">
                <p>Email Source</p>
                <h2>Store the address the host may reference during support and admin workflows.</h2>
              </div>
              <div className="product-form-grid">
                <label>
                  <span>Status</span>
                  <select value={dataSourceForm.email.enabled ? "enabled" : "disabled"} onChange={(event) => updateDataSourceForm("email", "enabled", event.target.value === "enabled")}>
                    <option value="disabled">disabled</option>
                    <option value="enabled">enabled</option>
                  </select>
                </label>
                <label>
                  <span>Provider</span>
                  <select value={dataSourceForm.email.provider} onChange={(event) => updateDataSourceForm("email", "provider", event.target.value)}>
                    <option value="manual">manual</option>
                    <option value="gmail">gmail</option>
                    <option value="outlook">outlook</option>
                    <option value="imap">imap</option>
                  </select>
                </label>
                <label>
                  <span>Email address</span>
                  <input value={dataSourceForm.email.address} onChange={(event) => updateDataSourceForm("email", "address", event.target.value)} placeholder="me@example.com" />
                </label>
                <label>
                  <span>Label</span>
                  <input value={dataSourceForm.email.label} onChange={(event) => updateDataSourceForm("email", "label", event.target.value)} placeholder="Primary support inbox" />
                </label>
              </div>
              <div className="product-detail-meta">
                <div>
                  <strong>Connected</strong>
                  <span>{consumerDataSources.email.connectedAt ? formatDateTime(consumerDataSources.email.connectedAt) : "Not linked yet"}</span>
                </div>
              </div>
              <div className="product-actions">
                <button
                  className="product-button product-button-solid"
                  type="button"
                  disabled={dataSourceActionState.busySource === "calendar"}
                  onClick={() => void handleSaveDataSource("email")}
                >
                  {dataSourceActionState.busySource === "email" ? "Saving..." : consumerDataSources.email.enabled ? "Update email source" : "Save email source"}
                </button>
              </div>
            </article>

            <article className="product-card product-card-subtle">
              <div className="product-section-head compact">
                <p>Calendar Source</p>
                <h2>Keep timezone and availability defaults ready for scheduling runs that pause for more context.</h2>
              </div>
              <div className="product-form-grid">
                <label>
                  <span>Status</span>
                  <select value={dataSourceForm.calendar.enabled ? "enabled" : "disabled"} onChange={(event) => updateDataSourceForm("calendar", "enabled", event.target.value === "enabled")}>
                    <option value="disabled">disabled</option>
                    <option value="enabled">enabled</option>
                  </select>
                </label>
                <label>
                  <span>Provider</span>
                  <select value={dataSourceForm.calendar.provider} onChange={(event) => updateDataSourceForm("calendar", "provider", event.target.value)}>
                    <option value="manual">manual</option>
                    <option value="google_calendar">google calendar</option>
                    <option value="outlook_calendar">outlook calendar</option>
                    <option value="ical">iCal feed</option>
                  </select>
                </label>
                <label>
                  <span>Calendar email</span>
                  <input value={dataSourceForm.calendar.address} onChange={(event) => updateDataSourceForm("calendar", "address", event.target.value)} placeholder="calendar@example.com" />
                </label>
                <label>
                  <span>Timezone</span>
                  <input value={dataSourceForm.calendar.timezone} onChange={(event) => updateDataSourceForm("calendar", "timezone", event.target.value)} placeholder="America/Los_Angeles" />
                </label>
                <label className="wide">
                  <span>Availability notes</span>
                  <textarea
                    value={dataSourceForm.calendar.availabilityNotes}
                    onChange={(event) => updateDataSourceForm("calendar", "availabilityNotes", event.target.value)}
                    rows={3}
                    placeholder="Weekdays after 2pm, avoid Fridays, prefer providers near downtown."
                  />
                </label>
              </div>
              <div className="product-detail-meta">
                <div>
                  <strong>Connected</strong>
                  <span>{consumerDataSources.calendar.connectedAt ? formatDateTime(consumerDataSources.calendar.connectedAt) : "Not linked yet"}</span>
                </div>
              </div>
              <div className="product-actions">
                <button
                  className="product-button product-button-solid"
                  type="button"
                  disabled={dataSourceActionState.busySource === "email"}
                  onClick={() => void handleSaveDataSource("calendar")}
                >
                  {dataSourceActionState.busySource === "calendar" ? "Saving..." : consumerDataSources.calendar.enabled ? "Update calendar source" : "Save calendar source"}
                </button>
              </div>
            </article>
          </div>
          <article className="product-card product-card-subtle">
            <div className="product-section-head compact">
              <p>Browser States</p>
              <h2>Store revocable browser session state for certified adapters.</h2>
            </div>
            <div className="product-inline-note accent">
              Browser states are wallet-owned execution inputs. Save only tightly bounded session state, then attach it to a delegated account session instead of exposing raw credentials.
            </div>
            <div className="product-form-grid">
              <label>
                <span>Label</span>
                <input
                  value={browserStateForm.label}
                  onChange={(event) => updateBrowserStateForm("label", event.target.value)}
                  placeholder="Amazon household browser state"
                />
              </label>
              <label>
                <span>Purpose</span>
                <select value={browserStateForm.purpose} onChange={(event) => updateBrowserStateForm("purpose", event.target.value)}>
                  <option value="purchase_runner">purchase runner</option>
                  <option value="booking_concierge">booking concierge</option>
                  <option value="account_admin">account admin</option>
                  <option value="general">general</option>
                </select>
              </label>
              <label className="wide">
                <span>Storage state JSON</span>
                <textarea
                  value={browserStateForm.storageStateJson}
                  onChange={(event) => updateBrowserStateForm("storageStateJson", event.target.value)}
                  rows={8}
                  placeholder='{\n  "cookies": [],\n  "origins": []\n}'
                />
              </label>
            </div>
            <div className="product-inline-note subtle">
              The wallet stores the canonical state payload and returns a deterministic <code>state://wallet/...</code> ref that certified providers can resolve at execution time.
            </div>
            <div className="product-actions">
              <button
                className="product-button product-button-solid"
                type="button"
                disabled={browserStateActionState.busyStateId !== ""}
                onClick={() => void handleCreateBrowserState()}
              >
                {browserStateActionState.busyStateId === "create" ? "Saving..." : "Save browser state"}
              </button>
            </div>
            {activeBrowserStates.length ? (
              <div className="product-step-list">
                {activeBrowserStates.slice(0, 8).map((state) => (
                  <div key={`browser_state:${state.stateId}`} className="product-step-item">
                    <div className="product-step-copy">
                      <strong>{state.label || state.stateId}</strong>
                      <span>{state.purpose ? humanizeLabel(state.purpose, state.purpose) : "General delegated browser state"}</span>
                      <span>
                        {(state.storageState.cookies?.length ?? 0).toLocaleString()} cookie{state.storageState.cookies?.length === 1 ? "" : "s"}
                        {` · ${(state.storageState.origins?.length ?? 0).toLocaleString()} origin${state.storageState.origins?.length === 1 ? "" : "s"}`}
                        {state.uploadedAt ? ` · ${formatDateTime(state.uploadedAt)}` : ""}
                      </span>
                      {state.sha256 ? <span>{abbreviateHash(state.sha256, { start: 10, end: 8 })}</span> : null}
                      <span>{state.stateRef}</span>
                    </div>
                    <div className="product-approval-step-meta">
                      <StatusPill value="active" />
                    </div>
                    <div className="product-actions">
                      <button className="product-button product-button-ghost" type="button" onClick={() => handleUseBrowserStateForSession(state.stateRef)}>
                        Use for session
                      </button>
                      <button
                        className="product-button product-button-ghost"
                        type="button"
                        onClick={() => void handleRevokeBrowserState(state.stateId)}
                        disabled={browserStateActionState.busyStateId === state.stateId}
                      >
                        {browserStateActionState.busyStateId === state.stateId ? "Revoking..." : "Revoke"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="product-empty-state">No browser states are stored in the wallet yet.</div>
            )}
          </article>
          <article className="product-card product-card-subtle">
            <div className="product-section-head compact">
              <p>Delegated Account Sessions</p>
              <h2>Represent Amazon-style account access as a revocable wallet handle, not raw credentials.</h2>
            </div>
            <div className="product-inline-note accent">
              Agents should use delegated browser/account sessions with explicit mode and spend boundaries. They should not store your password or card number directly.
            </div>
            <div className="product-form-grid">
              <label>
                <span>Provider key</span>
                <input value={accountSessionForm.providerKey} onChange={(event) => updateAccountSessionForm("providerKey", event.target.value)} placeholder="amazon" />
              </label>
              <label>
                <span>Provider label</span>
                <input value={accountSessionForm.providerLabel} onChange={(event) => updateAccountSessionForm("providerLabel", event.target.value)} placeholder="Amazon" />
              </label>
              <label>
                <span>Site key</span>
                <input value={accountSessionForm.siteKey} onChange={(event) => updateAccountSessionForm("siteKey", event.target.value)} placeholder="amazon" />
              </label>
              <label>
                <span>Site label</span>
                <input value={accountSessionForm.siteLabel} onChange={(event) => updateAccountSessionForm("siteLabel", event.target.value)} placeholder="Amazon" />
              </label>
              <label>
                <span>Mode</span>
                <select value={accountSessionForm.mode} onChange={(event) => updateAccountSessionForm("mode", event.target.value)}>
                  <option value="browser_delegated">browser delegated</option>
                  <option value="approval_at_boundary">approval at boundary</option>
                  <option value="operator_supervised">operator supervised</option>
                </select>
              </label>
              <label>
                <span>Account handle</span>
                <input value={accountSessionForm.accountHandleMasked} onChange={(event) => updateAccountSessionForm("accountHandleMasked", event.target.value)} placeholder="a***n@example.com" />
              </label>
              <label>
                <span>Funding source</span>
                <input value={accountSessionForm.fundingSourceLabel} onChange={(event) => updateAccountSessionForm("fundingSourceLabel", event.target.value)} placeholder="Amazon Visa ending in 1001" />
              </label>
              <label>
                <span>Spend cap (cents)</span>
                <input value={accountSessionForm.maxSpendCents} onChange={(event) => updateAccountSessionForm("maxSpendCents", event.target.value)} placeholder="15000" />
              </label>
              <label>
                <span>Currency</span>
                <input value={accountSessionForm.currency} onChange={(event) => updateAccountSessionForm("currency", event.target.value.toUpperCase())} placeholder="USD" />
              </label>
              <label>
                <span>Storage-state ref</span>
                <input
                  value={accountSessionForm.browserStorageStateRef}
                  onChange={(event) => updateAccountSessionForm("browserStorageStateRef", event.target.value)}
                  placeholder="state://wallet/tenant_default/bs_..."
                />
              </label>
              <label>
                <span>Login origin</span>
                <input
                  value={accountSessionForm.browserLoginOrigin}
                  onChange={(event) => updateAccountSessionForm("browserLoginOrigin", event.target.value)}
                  placeholder="https://www.amazon.com"
                />
              </label>
              <label>
                <span>Start URL</span>
                <input
                  value={accountSessionForm.browserStartUrl}
                  onChange={(event) => updateAccountSessionForm("browserStartUrl", event.target.value)}
                  placeholder="https://www.amazon.com/gp/cart/view.html"
                />
              </label>
              <label>
                <span>Allowed domains</span>
                <input
                  value={accountSessionForm.browserAllowedDomains}
                  onChange={(event) => updateAccountSessionForm("browserAllowedDomains", event.target.value)}
                  placeholder="amazon.com, www.amazon.com"
                />
              </label>
              <label>
                <span>Browser review mode</span>
                <select value={accountSessionForm.browserReviewMode} onChange={(event) => updateAccountSessionForm("browserReviewMode", event.target.value)}>
                  <option value="">inherit session mode</option>
                  <option value="browser_delegated">browser delegated</option>
                  <option value="approval_at_boundary">approval at boundary</option>
                  <option value="operator_supervised">operator supervised</option>
                </select>
              </label>
            </div>
            <div className="product-inline-note subtle">
              Browser profile settings control how a certified adapter can attach to this session. Use a storage-state ref plus tightly bounded domains instead of raw credentials.
            </div>
            <div className="product-badge-row">
              <button
                type="button"
                className={`product-badge ${accountSessionForm.canPurchase ? "" : "subtle"}`}
                onClick={() => updateAccountSessionForm("canPurchase", !accountSessionForm.canPurchase)}
              >
                {accountSessionForm.canPurchase ? "Purchase allowed" : "Purchase blocked"}
              </button>
              <button
                type="button"
                className={`product-badge ${accountSessionForm.canUseSavedPaymentMethods ? "" : "subtle"}`}
                onClick={() => updateAccountSessionForm("canUseSavedPaymentMethods", !accountSessionForm.canUseSavedPaymentMethods)}
              >
                {accountSessionForm.canUseSavedPaymentMethods ? "Saved payment methods allowed" : "Saved payment methods blocked"}
              </button>
              <button
                type="button"
                className={`product-badge ${accountSessionForm.requiresFinalReview ? "" : "subtle"}`}
                onClick={() => updateAccountSessionForm("requiresFinalReview", !accountSessionForm.requiresFinalReview)}
              >
                {accountSessionForm.requiresFinalReview ? "Final review required" : "Final review skipped"}
              </button>
            </div>
            <div className="product-actions">
              <button
                className="product-button product-button-solid"
                type="button"
                disabled={accountSessionActionState.busySessionId !== ""}
                onClick={() => void handleCreateAccountSession()}
              >
                {accountSessionActionState.busySessionId === "create" ? "Saving..." : "Save delegated session"}
              </button>
            </div>
            {activeAccountSessions.length ? (
              <div className="product-step-list">
                {activeAccountSessions.slice(0, 8).map((session) => (
                  <div key={`account_session:${session.sessionId}`} className="product-step-item">
                    <div className="product-step-copy">
                      <strong>{session.siteLabel || humanizeLabel(session.siteKey, session.siteKey)}</strong>
                      <span>{session.accountHandleMasked}</span>
                      <span>
                        {humanizeLabel(session.mode, session.mode)}
                        {Number.isFinite(session.maxSpendCents) ? ` · ${formatCurrency(session.maxSpendCents, session.currency)}` : ""}
                        {session.fundingSourceLabel ? ` · ${session.fundingSourceLabel}` : ""}
                      </span>
                      {session.browserProfile.loginOrigin || session.browserProfile.startUrl || session.browserProfile.allowedDomains.length > 0 ? (
                        <span>
                          {session.browserProfile.loginOrigin ? `Login ${session.browserProfile.loginOrigin}` : "Bound browser profile"}
                          {session.browserProfile.startUrl ? ` · Start ${session.browserProfile.startUrl}` : ""}
                          {session.browserProfile.allowedDomains.length > 0
                            ? ` · ${session.browserProfile.allowedDomains.length} allowed domain${session.browserProfile.allowedDomains.length === 1 ? "" : "s"}`
                            : ""}
                          {session.browserProfile.reviewMode ? ` · Review ${humanizeLabel(session.browserProfile.reviewMode, session.browserProfile.reviewMode)}` : ""}
                        </span>
                      ) : null}
                      {session.browserProfile.storageStateRef ? <span>{session.browserProfile.storageStateRef}</span> : null}
                      <span>{session.sessionRef}</span>
                    </div>
                    <div className="product-approval-step-meta">
                      <StatusPill value="active" />
                      <span>{session.linkedAt ? formatDateTime(session.linkedAt) : "Linked now"}</span>
                    </div>
                    <div className="product-actions">
                      <button
                        className="product-button product-button-ghost"
                        type="button"
                        disabled={accountSessionActionState.busySessionId === session.sessionId}
                        onClick={() => void handleRevokeAccountSession(session.sessionId)}
                      >
                        {accountSessionActionState.busySessionId === session.sessionId ? "Revoking..." : "Revoke"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="product-empty-state">No delegated consumer account sessions are active yet.</div>
            )}
          </article>
          <div className="product-section-head compact">
            <p>Outbound Integrations</p>
            <h2>Track connected delivery targets and retry posture from the same inventory.</h2>
          </div>
          {linkedIntegrations.length ? (
            <div className="product-step-list">
              {linkedIntegrations.map((integration) => {
                const provider = String(integration.provider ?? "").trim().toLowerCase();
                const deliveryHealth = asPlainObject(integration.deliveryHealth);
                const retryQueue = asPlainObject(integration.retryQueue);
                return (
                  <div key={`integration:${provider}`} className="product-step-item">
                    <div className="product-step-copy">
                      <strong>{humanizeLabel(provider, provider)}</strong>
                      <span>
                        {integration.connected
                          ? integration.webhookUrlMasked || "Connected to this workspace."
                          : integration.oauthEnabled
                            ? "Available to connect when a workflow needs it."
                            : "Not connected."}
                      </span>
                      <div className="product-approval-step-meta">
                        <span>{Array.isArray(integration.events) ? `${integration.events.length} event${integration.events.length === 1 ? "" : "s"}` : "No events"}</span>
                        <span>{deliveryHealth?.lastAttemptAt ? `last delivery ${formatDateTime(deliveryHealth.lastAttemptAt)}` : "No delivery history"}</span>
                        <span>{Number.isFinite(retryQueue?.pendingCount) ? `${retryQueue.pendingCount} retry job${retryQueue.pendingCount === 1 ? "" : "s"}` : "No retries queued"}</span>
                      </div>
                    </div>
                    <div className="product-approval-step-meta">
                      <StatusPill value={integration.connected ? "active" : "disabled"} />
                    </div>
                    {integration.connected ? (
                      <div className="product-actions">
                        <button
                          className="product-button product-button-ghost"
                          type="button"
                          onClick={() => void handleDisconnectIntegration(provider)}
                          disabled={integrationState.busyProvider === provider}
                        >
                          {integrationState.busyProvider === provider ? "Disconnecting..." : "Disconnect"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="product-empty-state">No linked integrations are visible yet. Connected systems will appear here once the wallet has delegated access to them.</div>
          )}
          <div className="product-section-head compact">
            <p>Documents</p>
            <h2>Keep governed attachments revocable and visible to the wallet.</h2>
          </div>
          {activeDocuments.length ? (
            <div className="product-step-list">
              {activeDocuments.slice(0, 8).map((document) => (
                <div key={`document:${document.documentId}`} className="product-step-item">
                  <div className="product-step-copy">
                    <strong>{document.label || document.filename}</strong>
                    <span>{document.purpose ? humanizeLabel(document.purpose) : humanizeLabel(document.mediaClass)}</span>
                    <span>{document.byteLength ? `${document.byteLength.toLocaleString()} bytes` : "Size unavailable"}{document.uploadedAt ? ` · ${formatDateTime(document.uploadedAt)}` : ""}</span>
                    <span>{document.documentRef}</span>
                  </div>
                  <div className="product-approval-step-meta">
                    <StatusPill value="active" />
                  </div>
                  <div className="product-actions">
                    <button
                      className="product-button product-button-ghost"
                      type="button"
                      onClick={() => void handleRevokeDocument(document.documentId)}
                      disabled={integrationState.busyProvider === document.documentId}
                    >
                      {integrationState.busyProvider === document.documentId ? "Revoking..." : "Revoke"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="product-empty-state">No uploaded documents are in the data wallet yet.</div>
          )}
        </article>

        {!isIntegrationsSurface ? (
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Payment Guardrails</p>
            <h2>Spend stays bounded before execution starts.</h2>
          </div>
          <div className="product-detail-meta">
            <div>
              <strong>Distinct spend caps</strong>
              <span>{spendCaps.length}</span>
            </div>
            <div>
              <strong>Highest cap</strong>
              <span>{spendCaps.length ? formatCurrency(spendCaps[spendCaps.length - 1]) : "n/a"}</span>
            </div>
            <div>
              <strong>Pending spend checks</strong>
              <span>{pendingItems.filter((item) => Number.isFinite(item.amountCents)).length}</span>
            </div>
            <div>
              <strong>Live wallet</strong>
              <span>{selectedWalletRef || (walletRefs.length ? "Select a wallet below" : "No wallet discovered")}</span>
            </div>
          </div>
          {spendCaps.length ? (
            <div className="product-step-list">
              {spendCaps.slice(0, 6).map((amountCents) => (
                <div key={`cap:${amountCents}`} className="product-step-item">
                  <div className="product-step-copy">
                    <strong>{formatCurrency(amountCents)}</strong>
                    <span>Reusable cap surfaced from standing policy or previously approved execution.</span>
                  </div>
                  <StatusPill value="active" />
                </div>
              ))}
            </div>
          ) : (
            <div className="product-empty-state">No spend caps are configured yet.</div>
          )}
        </article>
        ) : null}
      </section>

      {!isIntegrationsSurface ? (
      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Authority Grants</p>
            <h2>See which agents can still act for this workspace.</h2>
          </div>
          <div className="product-detail-meta">
            <div>
              <strong>Active grants</strong>
              <span>{visibleAuthorityGrants.length}</span>
            </div>
            <div>
              <strong>Related agents</strong>
              <span>{relatedAgentIds.length}</span>
            </div>
            <div>
              <strong>Principal filter</strong>
              <span>{buyer?.tenantId || runtime.tenantId || "tenant_default"}</span>
            </div>
            <div>
              <strong>Revoke path</strong>
              <span>Immediate, fail-closed, and auditable.</span>
            </div>
          </div>
          {grantActionState.error ? <div className="product-inline-note bad">{grantActionState.error}</div> : null}
          {grantActionState.message ? <div className="product-inline-note good">{grantActionState.message}</div> : null}
          {visibleAuthorityGrants.length ? (
            <div className="product-step-list">
              {visibleAuthorityGrants.slice(0, 8).map((grant) => (
                <div key={`authority:${grant.grantId}`} className="product-step-item">
                  <div className="product-step-copy">
                    <strong>{grant.granteeAgentId || grant.grantId}</strong>
                    <span>
                      {grant.principalType && grant.principalId
                        ? `${grant.principalType}:${grant.principalId} -> ${grant.granteeAgentId || "agent"}`
                        : "Principal binding unavailable"}
                    </span>
                    <div className="product-badge-row">
                      {grant.allowedRiskClasses.map((entry) => (
                        <span key={`${grant.grantId}:risk:${entry}`} className="product-badge">{entry}</span>
                      ))}
                      {grant.allowedToolIds.slice(0, 4).map((entry) => (
                        <span key={`${grant.grantId}:tool:${entry}`} className="product-badge">{entry}</span>
                      ))}
                      {grant.allowedProviderIds.slice(0, 4).map((entry) => (
                        <span key={`${grant.grantId}:provider:${entry}`} className="product-badge">{entry}</span>
                      ))}
                    </div>
                  </div>
                  <div className="product-approval-step-meta">
                    <strong>
                      {Number.isFinite(grant.maxTotalCents)
                        ? formatCurrency(grant.maxTotalCents, grant.currency)
                        : Number.isFinite(grant.maxPerCallCents)
                          ? formatCurrency(grant.maxPerCallCents, grant.currency)
                          : "No spend limit"}
                    </strong>
                    <span>{grant.expiresAt ? `expires ${formatDateTime(grant.expiresAt)}` : "No expiry"}</span>
                    <StatusPill value={grant.status} />
                  </div>
                  <div className="product-actions">
                    <button
                      className="product-button product-button-ghost"
                      type="button"
                      onClick={() => void handleRevokeGrant("authority", grant.grantId)}
                      disabled={grant.revocable === false || grantActionState.busyGrantId === grant.grantId}
                    >
                      {grantActionState.busyGrantId === grant.grantId ? "Revoking..." : "Revoke"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="product-empty-state">
              No active authority grants are visible for the current principal yet. This wallet will show them as soon as execution moves beyond standing policy alone.
            </div>
          )}
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Delegation Paths</p>
            <h2>Inspect downstream agent-to-agent authority before it spreads.</h2>
          </div>
          <div className="product-detail-meta">
            <div>
              <strong>Active delegations</strong>
              <span>{visibleDelegationGrants.length}</span>
            </div>
            <div>
              <strong>Depth ceiling</strong>
              <span>
                {visibleDelegationGrants.length
                  ? Math.max(...visibleDelegationGrants.map((grant) => Number(grant.maxDelegationDepth ?? 0)))
                  : 0}
              </span>
            </div>
            <div>
              <strong>Financial paths</strong>
              <span>{visibleDelegationGrants.filter((grant) => grant.allowedRiskClasses.includes("financial")).length}</span>
            </div>
            <div>
              <strong>Side effects</strong>
              <span>{visibleDelegationGrants.filter((grant) => grant.sideEffectingAllowed).length}</span>
            </div>
          </div>
          {visibleDelegationGrants.length ? (
            <div className="product-step-list">
                  {visibleDelegationGrants.slice(0, 8).map((grant) => (
                <div key={`delegation:${grant.grantId}`} className="product-step-item">
                  <div className="product-step-copy">
                    <strong>{grant.delegatorAgentId || "delegator"} {"->"} {grant.delegateeAgentId || "delegatee"}</strong>
                    <span>
                      depth {Number.isFinite(grant.depth) ? grant.depth : 0} of{" "}
                      {Number.isFinite(grant.maxDelegationDepth) ? grant.maxDelegationDepth : 0} ·{" "}
                      {grant.expiresAt ? `expires ${formatDateTime(grant.expiresAt)}` : "no expiry"}
                    </span>
                    <div className="product-badge-row">
                      {grant.allowedRiskClasses.map((entry) => (
                        <span key={`${grant.grantId}:delegation-risk:${entry}`} className="product-badge">{entry}</span>
                      ))}
                      {grant.allowedToolIds.slice(0, 4).map((entry) => (
                        <span key={`${grant.grantId}:delegation-tool:${entry}`} className="product-badge">{entry}</span>
                      ))}
                    </div>
                  </div>
                  <div className="product-approval-step-meta">
                    <strong>
                      {Number.isFinite(grant.maxTotalCents)
                        ? formatCurrency(grant.maxTotalCents, grant.currency)
                        : Number.isFinite(grant.maxPerCallCents)
                          ? formatCurrency(grant.maxPerCallCents, grant.currency)
                          : "No spend limit"}
                    </strong>
                    <span>{grant.sideEffectingAllowed ? "side effects allowed" : "read / compute only"}</span>
                    <StatusPill value={grant.status} />
                  </div>
                  <div className="product-actions">
                    <button
                      className="product-button product-button-ghost"
                      type="button"
                      onClick={() => void handleRevokeGrant("delegation", grant.grantId)}
                      disabled={grant.revocable === false || grantActionState.busyGrantId === grant.grantId}
                    >
                      {grantActionState.busyGrantId === grant.grantId ? "Revoking..." : "Revoke"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="product-empty-state">
              No active downstream delegation grants are visible for the current workspace yet.
            </div>
          )}
        </article>
      </section>
      ) : null}

      {!isIntegrationsSurface ? (
      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Live x402 Wallet</p>
            <h2>Read the current wallet policy, budget, and settlement posture.</h2>
          </div>
          {walletRefs.length ? (
            <>
              <div className="product-form-grid">
                <label className="wide">
                  <span>Sponsor wallet</span>
                  <select value={selectedWalletRef} onChange={(event) => setSelectedWalletRef(event.target.value)}>
                    {walletRefs.map((walletRef) => (
                      <option key={walletRef} value={walletRef}>{walletRef}</option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedWalletState.error ? <div className="product-inline-note bad">{selectedWalletState.error}</div> : null}
              <div className="product-detail-meta">
                <div>
                  <strong>Policy versions</strong>
                  <span>{selectedWalletPolicies.length}</span>
                </div>
                <div>
                  <strong>Per-authorization cap</strong>
                  <span>{Number.isFinite(liveWalletBudget?.maxAmountCents) ? formatCurrency(liveWalletBudget.maxAmountCents) : "n/a"}</span>
                </div>
                <div>
                  <strong>Daily remaining</strong>
                  <span>
                    {Number.isFinite(liveWalletBudget?.remainingDailyAuthorizationCents)
                      ? formatCurrency(liveWalletBudget.remainingDailyAuthorizationCents)
                      : "n/a"}
                  </span>
                </div>
                <div>
                  <strong>Net settled</strong>
                  <span>{Number.isFinite(liveWalletSummary?.netSettledCents) ? formatCurrency(liveWalletSummary.netSettledCents) : "n/a"}</span>
                </div>
              </div>
              {selectedWalletState.loading ? (
                <div className="product-inline-note warn">Refreshing live wallet state…</div>
              ) : null}
              {selectedWalletPolicies.length ? (
                <div className="product-step-list">
                  {selectedWalletPolicies.slice(0, 4).map((policy) => (
                    <div key={`${policy.sponsorWalletRef}:${policy.policyRef}:${policy.policyVersion}`} className="product-step-item">
                      <div className="product-step-copy">
                        <strong>{policy.policyRef} v{policy.policyVersion ?? "n/a"}</strong>
                        <span>
                          {policy.description ||
                            `${policy.sponsorRef || "wallet sponsor"} can authorize up to ${
                              Number.isFinite(policy.maxAmountCents) ? formatCurrency(policy.maxAmountCents) : "policy limits"
                            } with ${policy.allowedProviderIds.length} provider rule${policy.allowedProviderIds.length === 1 ? "" : "s"}.`}
                        </span>
                      </div>
                      <StatusPill value={policy.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="product-empty-state">No live x402 wallet policy records matched the selected wallet.</div>
              )}
            </>
          ) : (
            <div className="product-empty-state">
              No live x402 sponsor wallet is visible yet. This shell will keep using standing approval rules until a wallet policy is created for the tenant.
            </div>
          )}
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>Wallet Coverage</p>
            <h2>See where spend is allowed and what has already settled.</h2>
          </div>
          {walletRefs.length ? (
            <>
              <div className="product-detail-meta">
                <div>
                  <strong>Authorized today</strong>
                  <span>{Number.isFinite(liveWalletBudget?.dailyAuthorizedExposureCents) ? formatCurrency(liveWalletBudget.dailyAuthorizedExposureCents) : "n/a"}</span>
                </div>
                <div>
                  <strong>Reserved</strong>
                  <span>{Number.isFinite(liveWalletBudget?.authorizationSummary?.reservedAmountCents) ? formatCurrency(liveWalletBudget.authorizationSummary.reservedAmountCents) : "n/a"}</span>
                </div>
                <div>
                  <strong>Settled</strong>
                  <span>{Number.isFinite(liveWalletBudget?.authorizationSummary?.settledAmountCents) ? formatCurrency(liveWalletBudget.authorizationSummary.settledAmountCents) : "n/a"}</span>
                </div>
                <div>
                  <strong>Ledger entries</strong>
                  <span>{selectedWalletState.ledgerEntries.length}</span>
                </div>
              </div>
              {walletProviderIds.length ? (
                <div className="product-badge-row">
                  {walletProviderIds.slice(0, 8).map((entry) => (
                    <span key={`provider:${entry}`} className="product-badge">{entry}</span>
                  ))}
                </div>
              ) : null}
              {walletToolIds.length ? (
                <div className="product-badge-row">
                  {walletToolIds.slice(0, 8).map((entry) => (
                    <span key={`tool:${entry}`} className="product-badge">{entry}</span>
                  ))}
                </div>
              ) : null}
              {walletCurrencies.length ? (
                <div className="product-badge-row">
                  {walletCurrencies.slice(0, 8).map((entry) => (
                    <span key={`currency:${entry}`} className="product-badge">{entry}</span>
                  ))}
                </div>
              ) : null}
              {selectedWalletState.ledgerEntries.length ? (
                <div className="product-step-list">
                  {selectedWalletState.ledgerEntries.slice(0, 5).map((entry) => (
                    <div key={entry.receiptId || entry.runId} className="product-step-item">
                      <div className="product-step-copy">
                        <strong>{entry.providerId || entry.toolId || entry.runId || "Settled authorization"}</strong>
                        <span>
                          {entry.runId ? `Run ${entry.runId}` : "No run id"} · {entry.settledAt ? `settled ${formatDateTime(entry.settledAt)}` : "settlement time unavailable"}
                        </span>
                      </div>
                      <div className="product-approval-step-meta">
                        <strong>{Number.isFinite(entry.netAmountCents) ? formatCurrency(entry.netAmountCents, entry.currency) : "n/a"}</strong>
                        <span>{humanizeLabel(entry.settlementState, "settlement state")}</span>
                      </div>
                      {entry.runId ? (
                        <div className="product-actions">
                          <a className="product-button product-button-solid" href={`/runs/${encodeURIComponent(entry.runId)}`}>
                            Open execution
                          </a>
                          <a className="product-button product-button-ghost" href={`/disputes?runId=${encodeURIComponent(entry.runId)}`}>
                            Inspect dispute state
                          </a>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="product-empty-state">No settled x402 ledger entries are visible for the selected wallet yet.</div>
              )}
            </>
          ) : (
            <div className="product-empty-state">Live wallet budget and ledger data will appear here once a sponsor wallet is configured.</div>
          )}
        </article>
      </section>
      ) : null}
    </div>
  );
}

function ReceiptsPage({ runtime, onboardingState, lastLaunchId = null }) {
  const initialFilters = {
    receiptId: getQueryParam("receiptId") ?? "",
    workOrderId: getQueryParam("workOrderId") ?? "",
    status: getQueryParam("status") ?? ""
  };
  const [form, setForm] = useState(initialFilters);
  const [activeFilters, setActiveFilters] = useState(initialFilters);
  const [selectedReceiptId, setSelectedReceiptId] = useState(() => getQueryParam("selectedReceiptId") ?? getQueryParam("receiptId") ?? "");
  const [busyState, setBusyState] = useState("loading");
  const [statusMessage, setStatusMessage] = useState("Loading completion receipts...");
  const [receipts, setReceipts] = useState([]);
  const [detailState, setDetailState] = useState({
    loading: false,
    receiptId: "",
    completionReceipt: null,
    detail: null,
    error: ""
  });
  const runtimeReady = Boolean(String(runtime?.apiKey ?? "").trim());
  const buyer = onboardingState?.buyer ?? null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!runtimeReady) {
        setReceipts([]);
        setBusyState("");
        setStatusMessage("Complete onboarding and issue runtime bootstrap before loading receipts.");
        return;
      }
      setBusyState("loading");
      setStatusMessage("Loading completion receipts...");
      try {
        const out = await fetchWorkOrderReceipts(runtime, {
          receiptId: activeFilters.receiptId,
          workOrderId: activeFilters.workOrderId,
          status: activeFilters.status,
          limit: 100
        });
        if (cancelled) return;
        const nextReceipts = extractList(out, ["receipts", "items", "results"])
          .map((row) => normalizeReceiptRecord(row))
          .filter((row) => row.receiptId)
          .sort((left, right) => {
            const rightMs = Date.parse(right.deliveredAt || "");
            const leftMs = Date.parse(left.deliveredAt || "");
            return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
          });
        setReceipts(nextReceipts);
        setStatusMessage(`Loaded ${nextReceipts.length} receipt${nextReceipts.length === 1 ? "" : "s"} for ${buyer?.email ?? runtime.tenantId}.`);
      } catch (error) {
        if (cancelled) return;
        setStatusMessage(`Receipt load failed: ${error.message}`);
      } finally {
        if (!cancelled) setBusyState("");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeFilters, buyer?.email, runtime, runtimeReady]);

  useEffect(() => {
    setSelectedReceiptId((previous) => {
      if (previous && receipts.some((row) => row.receiptId === previous)) return previous;
      return receipts[0]?.receiptId ?? "";
    });
  }, [receipts]);

  useEffect(() => {
    replaceCurrentSearchParams({
      receiptId: activeFilters.receiptId || null,
      workOrderId: activeFilters.workOrderId || null,
      status: activeFilters.status || null,
      selectedReceiptId: selectedReceiptId || null
    });
  }, [activeFilters.receiptId, activeFilters.status, activeFilters.workOrderId, selectedReceiptId]);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      if (!runtimeReady || !selectedReceiptId) {
        setDetailState({
          loading: false,
          receiptId: selectedReceiptId,
          completionReceipt: null,
          detail: null,
          error: ""
        });
        return;
      }
      setDetailState((previous) => ({
        ...previous,
        loading: true,
        receiptId: selectedReceiptId,
        error: ""
      }));
      try {
        const out = await fetchWorkOrderReceiptDetail(runtime, selectedReceiptId);
        if (cancelled) return;
        setDetailState({
          loading: false,
          receiptId: selectedReceiptId,
          completionReceipt: normalizeReceiptRecord(out?.completionReceipt),
          detail: normalizeReceiptDetailRecord(out?.detail),
          error: ""
        });
      } catch (error) {
        if (cancelled) return;
        setDetailState({
          loading: false,
          receiptId: selectedReceiptId,
          completionReceipt: null,
          detail: null,
          error: error.message
        });
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [runtime, runtimeReady, selectedReceiptId]);

  const successCount = receipts.filter((receipt) => receipt.status === "success").length;
  const failedCount = receipts.filter((receipt) => receipt.status === "failed").length;
  const evidenceCount = receipts.reduce((total, receipt) => total + receipt.evidenceRefs.length, 0);
  const totalAmountCents = receipts.reduce((total, receipt) => total + (Number.isFinite(receipt.amountCents) ? receipt.amountCents : 0), 0);
  const selectedReceiptRecord = receipts.find((receipt) => receipt.receiptId === selectedReceiptId) ?? null;
  const selectedCompletionReceipt = detailState.completionReceipt ?? selectedReceiptRecord;
  const selectedReceiptDetail = detailState.detail ?? null;
  const selectedReceiptSettlement = asPlainObject(selectedReceiptDetail?.settlement);
  const selectedIntegrityTone =
    selectedReceiptDetail?.integrityStatus === "verified"
      ? "good"
      : selectedReceiptDetail?.integrityStatus
        ? "warn"
        : "";
  const selectedRecourseState = buildDisputeWindowState({
    disputeId: selectedReceiptSettlement?.disputeId,
    disputeStatus: selectedReceiptSettlement?.disputeStatus,
    disputeWindowEndsAt: selectedReceiptSettlement?.disputeWindowEndsAt,
    settlementStatus: selectedReceiptSettlement?.status
  });
  const selectedReceiptDisputeHref = selectedReceiptDetail?.settlementRunId
    ? `/disputes?runId=${encodeURIComponent(selectedReceiptDetail.settlementRunId)}${
        selectedReceiptSettlement?.disputeId
          ? `&selectedDisputeId=${encodeURIComponent(String(selectedReceiptSettlement.disputeId).trim())}`
          : ""
      }`
    : "/disputes";

  function applyFilters(event) {
    event.preventDefault();
    setActiveFilters({
      receiptId: form.receiptId.trim(),
      workOrderId: form.workOrderId.trim(),
      status: form.status.trim()
    });
  }

  return (
    <div className="product-page">
      <section className="product-page-top">
        <div>
          <p className="product-kicker">Receipts Vault</p>
          <h1>Keep completion proof and settlement references in one place.</h1>
          <p className="product-lead">
            This page reads the finalized receipt objects already emitted for completed runs. It is the consumer-facing vault for proof of what happened after execution completed.
          </p>
        </div>
        <div className="product-page-top-actions">
          <a className="product-button product-button-ghost" href="/inbox">Open inbox</a>
          <a className="product-button product-button-ghost" href="/disputes">Open disputes</a>
          <a className="product-button product-button-solid" href="/wallet">Open wallet</a>
        </div>
      </section>

      {!runtimeReady ? (
        <div className="product-inline-note warn">
          Complete <a href="/onboarding">Workspace Onboarding</a> first. Receipts are tenant-scoped and require a runtime key.
        </div>
      ) : null}

      <form className="product-card" onSubmit={applyFilters}>
        <div className="product-section-head compact">
          <p>Receipt filters</p>
          <h2>Narrow the vault by receipt or work order.</h2>
        </div>
        <div className="product-form-grid">
          <label>
            <span>Receipt ID</span>
            <input value={form.receiptId} onChange={(event) => setForm((previous) => ({ ...previous, receiptId: event.target.value }))} placeholder="worec_..." />
          </label>
          <label>
            <span>Work order ID</span>
            <input value={form.workOrderId} onChange={(event) => setForm((previous) => ({ ...previous, workOrderId: event.target.value }))} placeholder="workord_..." />
          </label>
          <label>
            <span>Status</span>
            <select value={form.status} onChange={(event) => setForm((previous) => ({ ...previous, status: event.target.value }))}>
              <option value="">all</option>
              <option value="success">success</option>
              <option value="failed">failed</option>
            </select>
          </label>
        </div>
        <div className="product-actions">
          <button className="product-button product-button-solid" type="submit" disabled={busyState !== ""}>{busyState === "loading" ? "Loading..." : "Apply filters"}</button>
        </div>
      </form>

      <div className={`product-inline-note ${/failed|error/i.test(statusMessage) ? "bad" : "good"}`}>{statusMessage}</div>

      <section className="product-metric-grid">
        <article className="product-metric-card">
          <span>Total Receipts</span>
          <strong>{receipts.length}</strong>
          <small>Completion proofs currently loaded.</small>
        </article>
        <article className="product-metric-card">
          <span>Successful</span>
          <strong>{successCount}</strong>
          <small>Receipts tied to successful delivery.</small>
        </article>
        <article className="product-metric-card">
          <span>Failed</span>
          <strong>{failedCount}</strong>
          <small>Receipts capturing failed or partial outcomes.</small>
        </article>
        <article className="product-metric-card">
          <span>Quoted Value</span>
          <strong>{receipts.length ? formatCurrency(totalAmountCents) : "$0.00"}</strong>
          <small>Sum of settlement quotes on loaded receipts.</small>
        </article>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Evidence coverage</p>
            <h2>Receipts should arrive with proof, not just a success string.</h2>
          </div>
          <div className="product-detail-meta">
            <div>
              <strong>Evidence refs</strong>
              <span>{evidenceCount}</span>
            </div>
            <div>
              <strong>Runtime</strong>
              <span>{runtime.tenantId}</span>
            </div>
            <div>
              <strong>Principal</strong>
              <span>{buyer?.email ?? "Tenant-scoped runtime"}</span>
            </div>
            <div>
              <strong>Latest host flow</strong>
              <span>{lastLaunchId ?? "No tracked host flow"}</span>
            </div>
          </div>
        </article>
      </section>

      <section className="product-section">
        <div className="product-section-head">
          <p>Loaded receipts</p>
          <h2>Every result should carry enough context for replay, support, and dispute.</h2>
        </div>
        <div className="product-detail-layout">
          <article className="product-card">
            <div className="product-section-head compact">
              <p>Vault index</p>
              <h2>Use the list on the left to inspect one receipt without losing the surrounding context.</h2>
            </div>
            {receipts.length > 0 ? (
              <div className="product-task-grid">
                {receipts.map((receipt) => (
                  <article key={receipt.receiptId} className="product-task-card">
                    <div className="product-task-head">
                      <div>
                        <p>{receipt.workOrderId || "Work order unavailable"}</p>
                        <h3>{receipt.receiptId}</h3>
                      </div>
                      <StatusPill value={receipt.status} />
                    </div>
                    <div className="product-task-meta">
                      <span>{receipt.principalAgentId ? `Principal ${receipt.principalAgentId}` : "Principal unavailable"}</span>
                      <span>{receipt.subAgentId ? `Worker ${receipt.subAgentId}` : "Worker unavailable"}</span>
                      <span>{receipt.deliveredAt ? `Delivered ${formatDateTime(receipt.deliveredAt)}` : "Delivery time unavailable"}</span>
                    </div>
                    <div className="product-task-points">
                      <span>{Number.isFinite(receipt.amountCents) ? formatCurrency(receipt.amountCents, receipt.currency) : "Quote unavailable"}</span>
                      <span>{receipt.evidenceRefs.length} evidence ref{receipt.evidenceRefs.length === 1 ? "" : "s"}</span>
                      {receipt.intentHash ? <span>Intent {abbreviateHash(receipt.intentHash, 16)}</span> : null}
                    </div>
                    {receipt.evidenceRefs.length ? (
                      <div className="product-badge-row">
                        {receipt.evidenceRefs.slice(0, 6).map((entry) => (
                          <span key={`${receipt.receiptId}:${entry}`} className="product-badge">{entry}</span>
                        ))}
                      </div>
                    ) : null}
                    <div className="product-hash-stack">
                      <div>
                        <strong>Receipt hash</strong>
                        <span>{receipt.receiptHash ? abbreviateHash(receipt.receiptHash, 24) : "n/a"}</span>
                      </div>
                      <div>
                        <strong>Trace</strong>
                        <span>{receipt.traceId || "n/a"}</span>
                      </div>
                    </div>
                    <div className="product-actions">
                      <button
                        className="product-button product-button-ghost"
                        type="button"
                        onClick={() => setSelectedReceiptId(receipt.receiptId)}
                        disabled={detailState.loading && selectedReceiptId === receipt.receiptId}
                      >
                        {selectedReceiptId === receipt.receiptId ? "Inspecting" : "Inspect receipt"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="product-empty-state">No receipts matched the current filters.</div>
            )}
          </article>

          <article className="product-card">
            <div className="product-section-head compact">
              <p>Selected receipt</p>
              <h2>Inspect the linked work order, settlement binding, and proof chain from one detail view.</h2>
            </div>
            {detailState.loading ? <div className="product-inline-note warn">Loading receipt detail…</div> : null}
            {detailState.error ? <div className="product-inline-note bad">Receipt detail failed: {detailState.error}</div> : null}
            {selectedCompletionReceipt ? (
              <>
                {selectedReceiptDetail ? (
                  <div className={`product-inline-note ${selectedIntegrityTone}`}>
                    {selectedReceiptDetail.integrityStatus === "verified"
                      ? "The linked receipt, work order, and settlement references are internally consistent."
                      : "This receipt is still readable, but one or more linked integrity checks require attention."}
                  </div>
                ) : null}
                {selectedReceiptDetail ? (
                  <div className={`product-inline-note ${selectedRecourseState.tone}`}>
                    <strong>{selectedRecourseState.label}.</strong> {selectedRecourseState.summary}
                  </div>
                ) : null}
                <div className="product-task-head">
                  <div>
                    <p>{selectedCompletionReceipt.workOrderId || "Work order unavailable"}</p>
                    <h3>{selectedCompletionReceipt.receiptId}</h3>
                  </div>
                  <StatusPill value={selectedCompletionReceipt.status} />
                </div>
                <div className="product-actions">
                  {selectedReceiptDetail?.settlementRunId ? (
                    <a
                      className="product-button product-button-solid"
                      href={`/runs/${encodeURIComponent(selectedReceiptDetail.settlementRunId)}`}
                    >
                      Open execution
                    </a>
                  ) : null}
                  {selectedReceiptDetail?.settlementRunId ? (
                    <a
                      className="product-button product-button-ghost"
                      href={selectedReceiptDisputeHref}
                    >
                      {selectedReceiptSettlement?.disputeId ? "Open dispute state" : "Open recourse"}
                    </a>
                  ) : null}
                  {selectedCompletionReceipt.workOrderId ? (
                    <button
                      className="product-button product-button-ghost"
                      type="button"
                      onClick={() => {
                        const nextWorkOrderId = selectedCompletionReceipt.workOrderId;
                        setForm((previous) => ({ ...previous, workOrderId: nextWorkOrderId }));
                        setActiveFilters((previous) => ({ ...previous, workOrderId: nextWorkOrderId }));
                      }}
                    >
                      Filter by work order
                    </button>
                  ) : null}
                </div>
                <div className="product-detail-meta">
                  <div>
                    <strong>Work order status</strong>
                    <span>{selectedReceiptDetail?.workOrder?.status ?? "Unavailable"}</span>
                  </div>
                  <div>
                    <strong>Settlement</strong>
                    <span>{selectedReceiptDetail?.settlement?.status ?? "Not settled"}</span>
                  </div>
                  <div>
                    <strong>Recourse</strong>
                    <span>{selectedReceiptSettlement?.disputeStatus ? humanizeLabel(selectedReceiptSettlement.disputeStatus, selectedRecourseState.label) : selectedRecourseState.label}</span>
                  </div>
                  <div>
                    <strong>Window</strong>
                    <span>{selectedReceiptSettlement?.disputeWindowEndsAt ? formatDateTime(selectedReceiptSettlement.disputeWindowEndsAt) : "No window reported"}</span>
                  </div>
                  <div>
                    <strong>Settlement run</strong>
                    <span>{selectedReceiptDetail?.settlementRunId ?? "n/a"}</span>
                  </div>
                  <div>
                    <strong>Trace</strong>
                    <span>{selectedReceiptDetail?.traceId ?? selectedCompletionReceipt.traceId ?? "n/a"}</span>
                  </div>
                  <div>
                    <strong>Principal</strong>
                    <span>{selectedCompletionReceipt.principalAgentId || "n/a"}</span>
                  </div>
                  <div>
                    <strong>Worker</strong>
                    <span>{selectedCompletionReceipt.subAgentId || "n/a"}</span>
                  </div>
                </div>
                {selectedReceiptDetail?.issues?.length ? (
                  <div className="product-step-list">
                    {selectedReceiptDetail.issues.map((issue) => (
                      <div key={`${selectedCompletionReceipt.receiptId}:${issue.code}`} className="product-step-item">
                        <div className="product-step-copy">
                          <strong>{humanizeLabel(issue.code, issue.code)}</strong>
                          <span>{issue.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {selectedReceiptDetail?.evidenceRefs?.length ? (
                  <div className="product-badge-row">
                    {selectedReceiptDetail.evidenceRefs.map((entry) => (
                      <span key={`${selectedCompletionReceipt.receiptId}:detail:${entry}`} className="product-badge">{entry}</span>
                    ))}
                  </div>
                ) : null}
                <details className="product-details" open>
                  <summary>Receipt detail payload</summary>
                  <pre><code>{prettyJson({
                    completionReceipt: selectedCompletionReceipt.raw,
                    detail: selectedReceiptDetail?.raw ?? null
                  })}</code></pre>
                </details>
              </>
            ) : (
              <div className="product-empty-state">Choose a receipt from the vault to inspect its linked execution detail.</div>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}

function DisputesPage({ runtime, onboardingState, lastLaunchId = null }) {
  const [runIdInput, setRunIdInput] = useState(() => getQueryParam("runId") ?? "");
  const [selectedDisputeId, setSelectedDisputeId] = useState(
    () => getQueryParam("selectedDisputeId") ?? getQueryParam("disputeId") ?? ""
  );
  const [selectedCaseId, setSelectedCaseId] = useState(() => getQueryParam("caseId") ?? "");
  const [reloadToken, setReloadToken] = useState(0);
  const [busyState, setBusyState] = useState("loading");
  const [statusMessage, setStatusMessage] = useState("Loading disputes...");
  const [queueItems, setQueueItems] = useState([]);
  const [workspaceState, setWorkspaceState] = useState({
    loading: false,
    disputeId: "",
    caseId: "",
    item: null,
    arbitrationCase: null,
    settlement: null,
    timeline: [],
    relatedCases: [],
    evidenceRefs: null,
    error: ""
  });
  const [launchSummary, setLaunchSummary] = useState(null);
  const [runRecords, setRunRecords] = useState([]);
  const [disputeDrafts, setDisputeDrafts] = useState({});
  const [evidenceDrafts, setEvidenceDrafts] = useState({});
  const runtimeReady = Boolean(String(runtime?.apiKey ?? "").trim());
  const buyer = onboardingState?.buyer ?? null;

  useEffect(() => {
    replaceCurrentSearchParams({
      runId: runIdInput.trim() || null,
      disputeId: selectedDisputeId || null,
      selectedDisputeId: null,
      caseId: selectedCaseId || null
    });
  }, [runIdInput, selectedCaseId, selectedDisputeId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!runtimeReady) {
        setQueueItems([]);
        setWorkspaceState({
          loading: false,
          disputeId: "",
          caseId: "",
          item: null,
          arbitrationCase: null,
          settlement: null,
          timeline: [],
          relatedCases: [],
          evidenceRefs: null,
          error: ""
        });
        setLaunchSummary(null);
        setRunRecords([]);
        setBusyState("");
        setStatusMessage("Complete onboarding and issue runtime bootstrap before loading disputes.");
        return;
      }
      setBusyState("loading");
      setStatusMessage("Loading disputes...");
      try {
        const [queueOut, launchOut] = await Promise.all([
          fetchDisputeInbox(runtime, { limit: 100, offset: 0 }),
          lastLaunchId
            ? requestJson({
                baseUrl: runtime.baseUrl,
                pathname: `/router/launches/${encodeURIComponent(lastLaunchId)}/status`,
                method: "GET",
                headers: buildHeaders(runtime)
              }).catch(() => null)
            : Promise.resolve(null)
        ]);
        const nextQueueItems = extractList(queueOut, ["items", "results"])
          .map((row) => normalizeDisputeInboxRecord(row))
          .filter((row) => row.runId || row.disputeId);
        if (!cancelled) {
          setQueueItems(nextQueueItems);
          setSelectedDisputeId((previous) => {
            if (previous && nextQueueItems.some((row) => row.disputeId === previous)) return previous;
            return nextQueueItems.find((row) => row.disputeId)?.disputeId ?? previous;
          });
          setSelectedCaseId((previous) => {
            if (!previous) return "";
            return nextQueueItems.some(
              (row) => row.arbitrationCases.some((caseRow) => String(caseRow?.caseId ?? "") === String(previous))
            )
              ? previous
              : "";
          });
        }
        const candidateRunIds = new Set();
        if (launchOut) {
          for (const task of extractList(launchOut, ["tasks"])) {
            const runId = String(task?.runId ?? "").trim();
            if (runId) candidateRunIds.add(runId);
          }
        }
        const manualRunId = runIdInput.trim();
        if (manualRunId) candidateRunIds.add(manualRunId);
        if (candidateRunIds.size === 0) {
          if (!cancelled) {
            setLaunchSummary(launchOut);
            setRunRecords([]);
            setStatusMessage(
              `Loaded ${nextQueueItems.length} dispute${nextQueueItems.length === 1 ? "" : "s"}. No dispute-ready run IDs are available yet for opening new recourse.`
            );
          }
          return;
        }

        const runDetails = await Promise.all(
          [...candidateRunIds].map(async (runId) => {
            try {
              const [settlementOut, agreementOut, casesOut] = await Promise.all([
                requestJson({
                  baseUrl: runtime.baseUrl,
                  pathname: `/runs/${encodeURIComponent(runId)}/settlement`,
                  method: "GET",
                  headers: buildHeaders(runtime)
                }),
                requestJson({
                  baseUrl: runtime.baseUrl,
                  pathname: `/runs/${encodeURIComponent(runId)}/agreement`,
                  method: "GET",
                  headers: buildHeaders(runtime)
                }).catch(() => null),
                requestJson({
                  baseUrl: runtime.baseUrl,
                  pathname: `/runs/${encodeURIComponent(runId)}/arbitration/cases`,
                  method: "GET",
                  headers: buildHeaders(runtime)
                }).catch(() => null)
              ]);
              const settlement = asPlainObject(settlementOut?.settlement);
              const agreement = asPlainObject(agreementOut?.agreement);
              const settlementReceipt = asPlainObject(settlementOut?.settlementReceipt);
              const disputeContext = asPlainObject(settlement?.disputeContext);
              const disputeResolution = asPlainObject(settlement?.disputeResolution);
              const cases = extractList(casesOut, ["cases", "items", "results"]);
              return {
                runId,
                amountCents: pickFirstNumber(settlement?.amountCents),
                currency: pickFirstString(settlement?.currency, "USD"),
                settlementStatus: pickFirstString(settlement?.status, "locked"),
                disputeStatus: pickFirstString(settlement?.disputeStatus, "none"),
                disputeId: pickFirstString(settlement?.disputeId),
                disputeOpenedAt: pickFirstString(settlement?.disputeOpenedAt),
                disputeWindowEndsAt: pickFirstString(settlement?.disputeWindowEndsAt),
                releasedAmountCents: pickFirstNumber(settlement?.releasedAmountCents, 0),
                refundedAmountCents: pickFirstNumber(settlement?.refundedAmountCents, 0),
                counterpartyAgentId: pickFirstString(settlement?.agentId, agreement?.providerAgentId, agreement?.payeeAgentId),
                payerAgentId: pickFirstString(settlement?.payerAgentId),
                disputeContext,
                disputeResolution,
                caseCount: cases.length,
                settlementReceipt,
                raw: {
                  settlement: settlementOut,
                  agreement: agreementOut,
                  arbitrationCases: casesOut
                }
              };
            } catch (error) {
              return {
                runId,
                settlementStatus: "error",
                disputeStatus: "unknown",
                loadError: error.message,
                raw: null
              };
            }
          })
        );
        if (cancelled) return;
        setLaunchSummary(launchOut);
        setRunRecords(runDetails);
        setStatusMessage(
          `Loaded ${nextQueueItems.length} dispute${nextQueueItems.length === 1 ? "" : "s"} and ${runDetails.length} dispute-ready run${runDetails.length === 1 ? "" : "s"}.`
        );
      } catch (error) {
        if (cancelled) return;
        setStatusMessage(`Dispute surface failed to load: ${error.message}`);
      } finally {
        if (!cancelled) setBusyState("");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [lastLaunchId, reloadToken, runIdInput, runtime, runtimeReady]);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspace() {
      if (!runtimeReady || !selectedDisputeId) {
        setWorkspaceState({
          loading: false,
          disputeId: selectedDisputeId,
          caseId: selectedCaseId,
          item: null,
          arbitrationCase: null,
          settlement: null,
          timeline: [],
          relatedCases: [],
          evidenceRefs: null,
          error: ""
        });
        return;
      }
      setWorkspaceState((previous) => ({
        ...previous,
        loading: true,
        disputeId: selectedDisputeId,
        caseId: selectedCaseId,
        error: ""
      }));
      try {
        const out = await fetchDisputeDetail(runtime, selectedDisputeId, { caseId: selectedCaseId });
        const detail = asPlainObject(out?.detail);
        if (cancelled) return;
        setWorkspaceState({
          loading: false,
          disputeId: selectedDisputeId,
          caseId: pickFirstString(detail?.caseId, selectedCaseId),
          item: asPlainObject(detail?.item),
          arbitrationCase: asPlainObject(detail?.arbitrationCase),
          settlement: asPlainObject(detail?.settlement?.settlement ?? detail?.settlement),
          timeline: extractList(detail, ["timeline", "events"]),
          relatedCases: extractList(detail, ["relatedCases", "cases"]),
          evidenceRefs: asPlainObject(detail?.evidenceRefs),
          error: ""
        });
      } catch (error) {
        if (cancelled) return;
        setWorkspaceState({
          loading: false,
          disputeId: selectedDisputeId,
          caseId: selectedCaseId,
          item: null,
          arbitrationCase: null,
          settlement: null,
          timeline: [],
          relatedCases: [],
          evidenceRefs: null,
          error: error.message
        });
      }
    }

    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, runtime, runtimeReady, selectedCaseId, selectedDisputeId]);

  function updateDisputeDraft(runId, field, value) {
    setDisputeDrafts((previous) => ({
      ...previous,
      [runId]: {
        disputeType: "quality",
        disputePriority: "normal",
        escalationLevel: "l1_counterparty",
        reason: "",
        evidenceRefs: "",
        ...(previous[runId] ?? {}),
        [field]: value
      }
    }));
  }

  function updateEvidenceDraft(runId, field, value) {
    setEvidenceDrafts((previous) => ({
      ...previous,
      [runId]: {
        evidenceRef: "",
        reason: "",
        ...(previous[runId] ?? {}),
        [field]: value
      }
    }));
  }

  async function handleOpenDispute(record) {
    if (!record?.runId) return;
    const draft = disputeDrafts[record.runId] ?? {
      disputeType: "quality",
      disputePriority: "normal",
      escalationLevel: "l1_counterparty",
      reason: "",
      evidenceRefs: ""
    };
    setBusyState(`open:${record.runId}`);
    setStatusMessage(`Opening dispute for ${record.runId}...`);
    try {
      await requestJson({
        baseUrl: runtime.baseUrl,
        pathname: `/runs/${encodeURIComponent(record.runId)}/dispute/open`,
        method: "POST",
        headers: buildHeaders({ ...runtime, write: true, idempotencyKey: createClientId("run_dispute_open") }),
        body: {
          disputeType: draft.disputeType,
          disputePriority: draft.disputePriority,
          disputeChannel: "counterparty",
          escalationLevel: draft.escalationLevel,
          openedByAgentId: runtime.tenantId,
          reason: draft.reason.trim() || null,
          evidenceRefs: normalizeStringArray(draft.evidenceRefs)
        }
      });
      setStatusMessage(`Dispute opened for ${record.runId}. Reloading run state...`);
      setReloadToken((value) => value + 1);
    } catch (error) {
      setStatusMessage(`Open dispute failed for ${record.runId}: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  async function handleSubmitEvidence(record) {
    if (!record?.runId) return;
    const draft = evidenceDrafts[record.runId] ?? { evidenceRef: "", reason: "" };
    const evidenceRef = String(draft.evidenceRef ?? "").trim();
    if (!evidenceRef) {
      setStatusMessage(`Add an evidence reference before updating ${record.runId}.`);
      return;
    }
    setBusyState(`evidence:${record.runId}`);
    setStatusMessage(`Submitting evidence for ${record.runId}...`);
    try {
      await requestJson({
        baseUrl: runtime.baseUrl,
        pathname: `/runs/${encodeURIComponent(record.runId)}/dispute/evidence`,
        method: "POST",
        headers: buildHeaders({ ...runtime, write: true, idempotencyKey: createClientId("run_dispute_evidence") }),
        body: {
          disputeId: record.disputeId || null,
          evidenceRef,
          submittedByAgentId: runtime.tenantId,
          reason: String(draft.reason ?? "").trim() || null
        }
      });
      setStatusMessage(`Evidence added to ${record.runId}. Reloading run state...`);
      setEvidenceDrafts((previous) => ({
        ...previous,
        [record.runId]: { evidenceRef: "", reason: "" }
      }));
      setReloadToken((value) => value + 1);
    } catch (error) {
      setStatusMessage(`Evidence submission failed for ${record.runId}: ${error.message}`);
    } finally {
      setBusyState("");
    }
  }

  const openDisputeCount = queueItems.filter((record) => record.disputeStatus === "open").length;
  const closedDisputeCount = queueItems.filter((record) => record.disputeStatus === "closed").length;
  const openCaseCount = queueItems.reduce(
    (total, record) => total + (Number.isFinite(record.openCaseCount) ? record.openCaseCount : 0),
    0
  );
  const arbitrationBackedCount = queueItems.filter((record) => (record.caseCount ?? 0) > 0).length;
  const refundableAmountCents = runRecords.reduce(
    (total, record) => total + (Number.isFinite(record.refundedAmountCents) ? record.refundedAmountCents : 0),
    0
  );
  const selectedInboxItem = queueItems.find((record) => String(record.disputeId ?? "") === String(selectedDisputeId)) ?? null;
  const selectedDetailItem = asPlainObject(workspaceState.item);
  const selectedSettlement = workspaceState.settlement;
  const selectedArbitrationCase = workspaceState.arbitrationCase;
  const selectedTimeline = Array.isArray(workspaceState.timeline) ? workspaceState.timeline : [];
  const selectedRelatedCases = Array.isArray(workspaceState.relatedCases) ? workspaceState.relatedCases : [];
  const selectedEvidenceRefs = asPlainObject(workspaceState.evidenceRefs);
  const selectedDisputeWindowState = buildDisputeWindowState({
    disputeId: selectedSettlement?.disputeId ?? selectedDetailItem?.disputeId ?? selectedInboxItem?.disputeId,
    disputeStatus: selectedSettlement?.disputeStatus ?? selectedDetailItem?.disputeStatus ?? selectedInboxItem?.disputeStatus,
    disputeWindowEndsAt: selectedSettlement?.disputeWindowEndsAt ?? selectedDetailItem?.disputeWindowEndsAt ?? selectedInboxItem?.disputeWindowEndsAt,
    settlementStatus: selectedSettlement?.status ?? selectedDetailItem?.settlementStatus ?? selectedInboxItem?.settlementStatus
  });
  const selectedReceiptHref = selectedSettlement?.receiptId
    ? `/receipts?selectedReceiptId=${encodeURIComponent(String(selectedSettlement.receiptId).trim())}`
    : null;

  return (
    <div className="product-page">
      <section className="product-page-top">
        <div>
          <p className="product-kicker">Disputes</p>
          <h1>Track every disputed run in one inbox, then open new recourse only when you need it.</h1>
          <p className="product-lead">
            The inbox is backed by live settlement and arbitration records. Inspect the latest case when one exists, and only drop into run-level recourse when you need to open or update a dispute.
          </p>
        </div>
        <div className="product-page-top-actions">
          <a className="product-button product-button-ghost" href="/inbox">Open inbox</a>
          <a className="product-button product-button-ghost" href="/receipts">Open receipts</a>
          <button className="product-button product-button-solid" type="button" disabled={busyState !== ""} onClick={() => setReloadToken((value) => value + 1)}>
            {busyState === "loading" ? "Refreshing..." : "Refresh disputes"}
          </button>
        </div>
      </section>

      {!runtimeReady ? (
        <div className="product-inline-note warn">
          Complete <a href="/onboarding">Workspace Onboarding</a> first. Dispute operations require a runtime key.
        </div>
      ) : null}

      <section className="product-card">
        <div className="product-section-head compact">
          <p>Open new recourse</p>
          <h2>Use the latest monitored host flow or add a run ID when you need to open a fresh dispute.</h2>
        </div>
        <div className="product-form-grid">
          <label className="wide">
            <span>Run ID</span>
            <input value={runIdInput} onChange={(event) => setRunIdInput(event.target.value)} placeholder="run_..." />
          </label>
        </div>
      </section>

      <div className={`product-inline-note ${/failed|error/i.test(statusMessage) ? "bad" : "good"}`}>{statusMessage}</div>

      <section className="product-metric-grid">
        <article className="product-metric-card">
          <span>Inbox Items</span>
          <strong>{queueItems.length}</strong>
          <small>Tenant-level disputes visible without needing the run ID first.</small>
        </article>
        <article className="product-metric-card">
          <span>Open Disputes</span>
          <strong>{openDisputeCount}</strong>
          <small>Runs that still need evidence, review, or resolution.</small>
        </article>
        <article className="product-metric-card">
          <span>Closed Disputes</span>
          <strong>{closedDisputeCount}</strong>
          <small>Disputes that already carry a finished resolution.</small>
        </article>
        <article className="product-metric-card">
          <span>Open Cases</span>
          <strong>{openCaseCount}</strong>
          <small>Arbitration cases currently under review or appeal.</small>
        </article>
        <article className="product-metric-card">
          <span>Case-backed</span>
          <strong>{arbitrationBackedCount}</strong>
          <small>Inbox items that already have at least one arbitration case.</small>
        </article>
      </section>

      <section className="product-metric-grid">
        <article className="product-metric-card">
          <span>Refunded</span>
          <strong>{runRecords.length ? formatCurrency(refundableAmountCents) : "$0.00"}</strong>
          <small>Refunded amount across the dispute-ready runs loaded below.</small>
        </article>
      </section>

      <section className="product-section">
        <div className="product-section-head">
          <p>Dispute inbox</p>
          <h2>Every disputed run stays visible even if you did not keep the run ID or case ID handy.</h2>
        </div>
        {queueItems.length > 0 ? (
          <div className="product-task-grid">
            {queueItems.map((record) => (
              <article key={record.disputeId || record.runId} className="product-task-card">
                <div className="product-task-head">
                  <div>
                    <p>{record.counterpartyAgentId ? `Counterparty ${record.counterpartyAgentId}` : "Dispute"}</p>
                    <h3>{record.disputeId || record.runId || "Dispute item"}</h3>
                  </div>
                  <StatusPill value={record.disputeStatus || "unknown"} />
                </div>
                <div className="product-task-meta">
                  <span>{record.settlementStatus ? `Settlement ${titleCaseState(record.settlementStatus)}` : "Settlement unavailable"}</span>
                  <span>{record.amountCents !== null && record.amountCents !== undefined ? formatCurrency(record.amountCents, record.currency) : "Amount unavailable"}</span>
                  <span>{record.caseCount ? `${record.caseCount} case${record.caseCount === 1 ? "" : "s"}` : "No case yet"}</span>
                </div>
                {record.disputeContext?.reason ? (
                  <div className="product-inline-note accent">Reason: {record.disputeContext.reason}</div>
                ) : null}
                {record.disputeResolution?.summary ? (
                  <div className="product-inline-note good">Resolution: {record.disputeResolution.summary}</div>
                ) : null}
                <div className="product-detail-meta">
                  <div>
                    <strong>Dispute ID</strong>
                    <span>{record.disputeId || "n/a"}</span>
                  </div>
                  <div>
                    <strong>Latest case</strong>
                    <span>{record.latestCaseId || "No case yet"}</span>
                  </div>
                  <div>
                    <strong>Opened</strong>
                    <span>{record.disputeOpenedAt ? formatDateTime(record.disputeOpenedAt) : "n/a"}</span>
                  </div>
                  <div>
                    <strong>Latest update</strong>
                    <span>{record.latestCaseUpdatedAt ? formatDateTime(record.latestCaseUpdatedAt) : "n/a"}</span>
                  </div>
                </div>
                <div className="product-page-top-actions">
                  {record.runId ? (
                    <a className="product-button product-button-ghost" href={`/runs/${encodeURIComponent(record.runId)}`}>
                      Open execution
                    </a>
                  ) : null}
                  <button
                    className="product-button product-button-solid"
                    type="button"
                    onClick={() => {
                      setSelectedDisputeId(record.disputeId || "");
                      setSelectedCaseId(record.latestCaseId || "");
                    }}
                    disabled={!record.disputeId || (workspaceState.loading && selectedDisputeId === record.disputeId)}
                  >
                    {record.disputeId ? (selectedDisputeId === record.disputeId ? "Inspecting" : "Inspect dispute") : "Awaiting dispute"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="product-empty-state">No disputes are open for this tenant right now.</div>
        )}
      </section>

      {selectedDisputeId ? (
        <section className="product-grid-two">
          <article className="product-card">
            <div className="product-section-head compact">
              <p>Selected dispute</p>
              <h2>Inspect the latest dispute detail without dropping into an ops-only workspace.</h2>
            </div>
            {workspaceState.error ? <div className="product-inline-note bad">{workspaceState.error}</div> : null}
            {workspaceState.loading ? <div className="product-inline-note warn">Loading dispute detail…</div> : null}
            {!workspaceState.error ? (
              <>
                <div className="product-detail-meta">
                  <div>
                    <strong>Dispute</strong>
                    <span>{selectedDetailItem?.disputeId ?? selectedInboxItem?.disputeId ?? selectedDisputeId}</span>
                  </div>
                  <div>
                    <strong>Run</strong>
                    <span>{selectedDetailItem?.runId ?? selectedInboxItem?.runId ?? selectedArbitrationCase?.runId ?? "n/a"}</span>
                  </div>
                  <div>
                    <strong>Case</strong>
                    <span>{selectedArbitrationCase?.caseId ?? selectedDetailItem?.caseId ?? "No case yet"}</span>
                  </div>
                  <div>
                    <strong>Status</strong>
                    <span>{humanizeLabel(selectedArbitrationCase?.status ?? selectedDetailItem?.disputeStatus ?? selectedInboxItem?.disputeStatus, "unknown")}</span>
                  </div>
                </div>
                {selectedInboxItem?.disputeContext?.reason ? (
                  <div className="product-inline-note accent">Reason: {selectedInboxItem.disputeContext.reason}</div>
                ) : null}
                {selectedSettlement?.disputeResolution?.summary ? (
                  <div className="product-inline-note good">{selectedSettlement.disputeResolution.summary}</div>
                ) : null}
                <div className={`product-inline-note ${selectedDisputeWindowState.tone}`}>
                  <strong>{selectedDisputeWindowState.label}.</strong> {selectedDisputeWindowState.summary}
                </div>
                <div className="product-sidebar-list">
                  <div>
                    <strong>Refunded</strong>
                    <span>{Number.isFinite(selectedSettlement?.refundedAmountCents) ? formatCurrency(selectedSettlement.refundedAmountCents, selectedSettlement.currency) : "n/a"}</span>
                  </div>
                  <div>
                    <strong>Released</strong>
                    <span>{Number.isFinite(selectedSettlement?.releasedAmountCents) ? formatCurrency(selectedSettlement.releasedAmountCents, selectedSettlement.currency) : "n/a"}</span>
                  </div>
                  <div>
                    <strong>Dispute window</strong>
                    <span>{selectedSettlement?.disputeWindowEndsAt ? formatDateTime(selectedSettlement.disputeWindowEndsAt) : "No window reported"}</span>
                  </div>
                  <div>
                    <strong>Evidence</strong>
                    <span>
                      {selectedEvidenceRefs
                        ? String(Array.isArray(selectedEvidenceRefs.all) ? selectedEvidenceRefs.all.length : 0)
                        : "0"}
                    </span>
                  </div>
                </div>
                {selectedDetailItem?.runId || selectedInboxItem?.runId || selectedArbitrationCase?.runId ? (
                  <div className="product-actions">
                    {selectedReceiptHref ? (
                      <a className="product-button product-button-ghost" href={selectedReceiptHref}>
                        Open receipt
                      </a>
                    ) : null}
                    <a
                      className="product-button product-button-ghost"
                      href={`/runs/${encodeURIComponent(selectedDetailItem?.runId ?? selectedInboxItem?.runId ?? selectedArbitrationCase?.runId ?? "")}`}
                    >
                      Open execution
                    </a>
                  </div>
                ) : null}
              </>
            ) : null}
          </article>

          <article className="product-card">
            <div className="product-section-head compact">
              <p>Dispute timeline</p>
              <h2>Every dispute stays bound to its settlement history.</h2>
            </div>
            {selectedTimeline.length ? (
              <div className="product-step-list">
                {selectedTimeline.map((event, index) => (
                  <div key={`${event?.eventType ?? "event"}:${event?.at ?? index}`} className="product-step-item">
                    <div className="product-step-copy">
                      <strong>{humanizeLabel(event?.eventType, "Event")}</strong>
                      <span>{event?.at ? formatDateTime(event.at) : "Time unavailable"}</span>
                    </div>
                    <StatusPill value={event?.eventType?.includes("closed") ? "closed" : "active"} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="product-empty-state">No dispute timeline is available for the selected case yet.</div>
            )}
            {selectedRelatedCases.length ? (
              <>
                <div className="product-section-head compact" style={{ marginTop: "1rem" }}>
                  <p>Related cases</p>
                  <h2>Appeals and sibling cases remain visible inside the same dispute.</h2>
                </div>
                <div className="product-badge-row">
                  {selectedRelatedCases.slice(0, 8).map((caseRow, index) => (
                    <button
                      key={`${caseRow?.caseId ?? "case"}:${index}`}
                      className="product-badge"
                      type="button"
                      onClick={() => setSelectedCaseId(String(caseRow?.caseId ?? "").trim())}
                      disabled={!caseRow?.caseId || String(caseRow?.caseId ?? "") === String(selectedArbitrationCase?.caseId ?? selectedDetailItem?.caseId ?? "")}
                    >
                      {caseRow?.caseId ?? "case"}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </article>
        </section>
      ) : null}

      <section className="product-section">
        <div className="product-section-head">
          <p>Open new dispute</p>
          <h2>Use run-level recourse only when you need to start or update a dispute.</h2>
        </div>
        {runRecords.length > 0 ? (
          <div className="product-task-grid">
            {runRecords.map((record) => {
              const disputeDraft = disputeDrafts[record.runId] ?? {
                disputeType: "quality",
                disputePriority: "normal",
                escalationLevel: "l1_counterparty",
                reason: "",
                evidenceRefs: ""
              };
              const evidenceDraft = evidenceDrafts[record.runId] ?? { evidenceRef: "", reason: "" };
              const canOpenDispute = record.disputeStatus !== "open" && record.settlementStatus !== "error";
              return (
                <article key={record.runId} className="product-task-card">
                  <div className="product-task-head">
                    <div>
                      <p>{record.counterpartyAgentId ? `Counterparty ${record.counterpartyAgentId}` : "Run dispute"}</p>
                      <h3>{record.runId}</h3>
                    </div>
                    <StatusPill value={record.disputeStatus || record.settlementStatus || "unknown"} />
                  </div>
                  <div className="product-task-meta">
                    <span>{record.amountCents !== null && record.amountCents !== undefined ? formatCurrency(record.amountCents, record.currency) : "Amount unavailable"}</span>
                    <span>{record.settlementStatus ? `Settlement ${titleCaseState(record.settlementStatus)}` : "Settlement unavailable"}</span>
                    <span>{record.disputeWindowEndsAt ? `Window ends ${formatDateTime(record.disputeWindowEndsAt)}` : "No dispute window reported"}</span>
                  </div>
                  {record.loadError ? (
                    <div className="product-inline-note bad">{record.loadError}</div>
                  ) : null}
                  {record.disputeContext?.reason ? (
                    <div className="product-inline-note accent">Current dispute reason: {record.disputeContext.reason}</div>
                  ) : null}
                  {record.disputeResolution?.summary ? (
                    <div className="product-inline-note good">Resolution: {record.disputeResolution.summary}</div>
                  ) : null}
                  <div className="product-detail-meta">
                    <div>
                      <strong>Dispute ID</strong>
                      <span>{record.disputeId || "Not opened"}</span>
                    </div>
                    <div>
                      <strong>Opened</strong>
                      <span>{record.disputeOpenedAt ? formatDateTime(record.disputeOpenedAt) : "n/a"}</span>
                    </div>
                    <div>
                      <strong>Refunded</strong>
                      <span>{Number.isFinite(record.refundedAmountCents) ? formatCurrency(record.refundedAmountCents, record.currency) : "n/a"}</span>
                    </div>
                    <div>
                      <strong>Arbitration cases</strong>
                      <span>{record.caseCount}</span>
                    </div>
                  </div>
                  {canOpenDispute ? (
                    <div className="product-form-grid">
                      <label>
                        <span>Type</span>
                        <select value={disputeDraft.disputeType} onChange={(event) => updateDisputeDraft(record.runId, "disputeType", event.target.value)}>
                          <option value="quality">quality</option>
                          <option value="delivery">delivery</option>
                          <option value="fraud">fraud</option>
                          <option value="policy">policy</option>
                          <option value="payment">payment</option>
                          <option value="other">other</option>
                        </select>
                      </label>
                      <label>
                        <span>Priority</span>
                        <select value={disputeDraft.disputePriority} onChange={(event) => updateDisputeDraft(record.runId, "disputePriority", event.target.value)}>
                          <option value="low">low</option>
                          <option value="normal">normal</option>
                          <option value="high">high</option>
                          <option value="critical">critical</option>
                        </select>
                      </label>
                      <label className="wide">
                        <span>Reason</span>
                        <input value={disputeDraft.reason} onChange={(event) => updateDisputeDraft(record.runId, "reason", event.target.value)} placeholder="Explain what failed or what needs review" />
                      </label>
                      <label className="wide">
                        <span>Evidence refs</span>
                        <input value={disputeDraft.evidenceRefs} onChange={(event) => updateDisputeDraft(record.runId, "evidenceRefs", event.target.value)} placeholder="artifact://..., ticket://..., email://..." />
                      </label>
                    </div>
                  ) : null}
                  {record.disputeStatus === "open" ? (
                    <div className="product-form-grid">
                      <label className="wide">
                        <span>Add evidence ref</span>
                        <input value={evidenceDraft.evidenceRef} onChange={(event) => updateEvidenceDraft(record.runId, "evidenceRef", event.target.value)} placeholder="artifact://follow-up/1" />
                      </label>
                      <label className="wide">
                        <span>Evidence note</span>
                        <input value={evidenceDraft.reason} onChange={(event) => updateEvidenceDraft(record.runId, "reason", event.target.value)} placeholder="Why this evidence matters" />
                      </label>
                    </div>
                  ) : null}
                  <div className="product-actions">
                    <a className="product-button product-button-ghost" href={`/runs/${encodeURIComponent(record.runId)}`}>
                      Open execution
                    </a>
                    {canOpenDispute ? (
                      <button className="product-button product-button-solid" type="button" disabled={busyState !== ""} onClick={() => void handleOpenDispute(record)}>
                        {busyState === `open:${record.runId}` ? "Opening..." : "Open dispute"}
                      </button>
                    ) : null}
                    {record.disputeStatus === "open" ? (
                      <button className="product-button product-button-ghost" type="button" disabled={busyState !== ""} onClick={() => void handleSubmitEvidence(record)}>
                        {busyState === `evidence:${record.runId}` ? "Submitting..." : "Add evidence"}
                      </button>
                    ) : null}
                  </div>
                  <details className="product-details">
                    <summary>Run dispute details</summary>
                    <pre><code>{prettyJson(record.raw)}</code></pre>
                  </details>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="product-empty-state">No runs are ready for dispute review yet. Start from the wallet or paste a run ID above.</div>
        )}
      </section>
    </div>
  );
}

function RunDetailPage({ runtime, onboardingState, runId }) {
  const [detailState, setDetailState] = useState({
    loading: true,
    error: "",
    detail: null
  });
  const [receiptDetailState, setReceiptDetailState] = useState({
    loading: false,
    error: "",
    detail: null
  });
  const [disputeDetailState, setDisputeDetailState] = useState({
    loading: false,
    error: "",
    detail: null
  });
  const [reloadToken, setReloadToken] = useState(0);
  const [actionBusyState, setActionBusyState] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [disputeDraft, setDisputeDraft] = useState({
    disputeType: "quality",
    disputePriority: "normal",
    escalationLevel: "l1_counterparty",
    reason: "",
    evidenceRefs: ""
  });
  const [evidenceDraft, setEvidenceDraft] = useState({
    evidenceRef: "",
    reason: ""
  });
  const [actionRequiredResponseDraft, setActionRequiredResponseDraft] = useState({
    providedFields: {},
    evidenceRefs: "",
    note: ""
  });
  const [actionRequiredUploadState, setActionRequiredUploadState] = useState({
    busy: false,
    error: "",
    message: "",
    lastDocument: null
  });
  const [accountSessionsState, setAccountSessionsState] = useState({
    loading: false,
    error: "",
    sessions: []
  });
  const [consumerConnectorsState, setConsumerConnectorsState] = useState({
    loading: false,
    error: "",
    connectors: []
  });
  const [selectedAccountSessionId, setSelectedAccountSessionId] = useState("");
  const [selectedConsumerConnectorId, setSelectedConsumerConnectorId] = useState("");
  const [tenantSettingsState, setTenantSettingsState] = useState({
    loading: false,
    error: "",
    settings: null
  });
  const runtimeReady = Boolean(String(runtime?.apiKey ?? "").trim());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!runtimeReady) {
        setDetailState({
          loading: false,
          error: "",
          detail: null
        });
        return;
      }
      if (!String(runId ?? "").trim()) {
        setDetailState({
          loading: false,
          error: "Run ID is required.",
          detail: null
        });
        return;
      }
      setDetailState((previous) => ({
        ...previous,
        loading: true,
        error: ""
      }));
      try {
        const out = await fetchRunDetail(runtime, runId);
        if (cancelled) return;
        setDetailState({
          loading: false,
          error: "",
          detail: normalizeRunDetailRecord(out?.detail)
        });
      } catch (error) {
        if (cancelled) return;
        setDetailState({
          loading: false,
          error: error.message,
          detail: null
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, runId, runtime, runtimeReady]);

  useEffect(() => {
    let cancelled = false;

    async function loadAccountSessionsState() {
      if (!runtimeReady || !onboardingState?.buyer) {
        setAccountSessionsState({
          loading: false,
          error: "",
          sessions: []
        });
        return;
      }
      setAccountSessionsState((previous) => ({
        ...previous,
        loading: true,
        error: ""
      }));
      try {
        const out = await fetchTenantAccountSessions(runtime, { includeRevoked: false, limit: 50 });
        if (cancelled) return;
        const sessions = Array.isArray(out?.sessions) ? out.sessions.map((session) => normalizeTenantAccountSessionRecord(session)) : [];
        setAccountSessionsState({
          loading: false,
          error: "",
          sessions
        });
      } catch (error) {
        if (cancelled) return;
        setAccountSessionsState({
          loading: false,
          error: error.message,
          sessions: []
        });
      }
    }

    void loadAccountSessionsState();
    return () => {
      cancelled = true;
    };
  }, [onboardingState?.buyer, reloadToken, runtime, runtimeReady]);

  useEffect(() => {
    let cancelled = false;

    async function loadConsumerConnectorsState() {
      if (!runtimeReady || !onboardingState?.buyer) {
        setConsumerConnectorsState({
          loading: false,
          error: "",
          connectors: []
        });
        return;
      }
      setConsumerConnectorsState((previous) => ({
        ...previous,
        loading: true,
        error: ""
      }));
      try {
        const out = await fetchTenantConsumerConnectors(runtime, { includeRevoked: false, limit: 50 });
        if (cancelled) return;
        const connectors = Array.isArray(out?.connectors)
          ? out.connectors.map((connector) => normalizeTenantConsumerConnectorRecord(connector))
          : [];
        setConsumerConnectorsState({
          loading: false,
          error: "",
          connectors
        });
      } catch (error) {
        if (cancelled) return;
        setConsumerConnectorsState({
          loading: false,
          error: error.message,
          connectors: []
        });
      }
    }

    void loadConsumerConnectorsState();
    return () => {
      cancelled = true;
    };
  }, [onboardingState?.buyer, reloadToken, runtime, runtimeReady]);

  useEffect(() => {
    let cancelled = false;

    async function loadTenantSettingsState() {
      if (!runtimeReady || !onboardingState?.buyer) {
        setTenantSettingsState({
          loading: false,
          error: "",
          settings: null
        });
        return;
      }
      setTenantSettingsState((previous) => ({
        ...previous,
        loading: true,
        error: ""
      }));
      try {
        const out = await fetchTenantSettings(runtime);
        if (cancelled) return;
        setTenantSettingsState({
          loading: false,
          error: "",
          settings: asPlainObject(out?.settings)
        });
      } catch (error) {
        if (cancelled) return;
        setTenantSettingsState({
          loading: false,
          error: error.message,
          settings: null
        });
      }
    }

    void loadTenantSettingsState();
    return () => {
      cancelled = true;
    };
  }, [onboardingState?.buyer, runtime, runtimeReady]);

  const detail = detailState.detail;
  const run = detail?.run ?? null;
  const settlement = detail?.settlementRecord ?? null;
  const settlementReceipt = detail?.settlementReceipt ?? null;
  const agreement = detail?.agreement ?? null;
  const latestUserResponse = detail?.latestUserResponse ?? null;
  const managedExecution = detail?.managedExecution ?? null;
  const taskWallet = detail?.taskWallet ?? null;
  const taskWalletSettlement = asPlainObject(detail?.taskWalletSpendPlan) ?? deriveTaskWalletSettlementScaffold(taskWallet);
  const linkedTask = detail?.linkedTask ?? null;
  const arbitration = detail?.arbitration ?? null;
  const phase1Contract = extractPhase1LaunchContractFromMetadata(linkedTask?.metadata);
  const phase1Issues = Array.isArray(detail?.issues)
    ? detail.issues.filter((issue) => String(issue?.code ?? "").trim().startsWith("PHASE1_"))
    : [];
  const phase1CompletionState = pickFirstString(run?.metrics?.phase1CompletionState, run?.metrics?.phase1?.completionState, run?.metrics?.completionState);
  const runActionRequired = normalizeRunActionRequiredRecord(run);
  const canOpenDispute = settlement && settlement.disputeStatus !== "open";
  const linkedReceiptId = String(settlementReceipt?.receiptId ?? "").trim();
  const linkedDisputeId = String(settlement?.disputeId ?? "").trim();
  const disputeHref = runId
    ? `/disputes?runId=${encodeURIComponent(runId)}${linkedDisputeId ? `&disputeId=${encodeURIComponent(linkedDisputeId)}` : ""}`
    : "/disputes";
  const receiptHref = linkedReceiptId ? `/receipts?selectedReceiptId=${encodeURIComponent(linkedReceiptId)}` : "/receipts";

  useEffect(() => {
    let cancelled = false;

    async function loadLinkedReceipt() {
      if (!runtimeReady || !linkedReceiptId) {
        setReceiptDetailState({
          loading: false,
          error: "",
          detail: null
        });
        return;
      }
      setReceiptDetailState({
        loading: true,
        error: "",
        detail: null
      });
      try {
        const out = await fetchWorkOrderReceiptDetail(runtime, linkedReceiptId);
        if (cancelled) return;
        setReceiptDetailState({
          loading: false,
          error: "",
          detail: normalizeReceiptDetailRecord(out?.detail)
        });
      } catch (error) {
        if (cancelled) return;
        setReceiptDetailState({
          loading: false,
          error: error.message,
          detail: null
        });
      }
    }

    void loadLinkedReceipt();
    return () => {
      cancelled = true;
    };
  }, [linkedReceiptId, reloadToken, runtime, runtimeReady]);

  useEffect(() => {
    let cancelled = false;

    async function loadLinkedDispute() {
      if (!runtimeReady || !linkedDisputeId) {
        setDisputeDetailState({
          loading: false,
          error: "",
          detail: null
        });
        return;
      }
      setDisputeDetailState({
        loading: true,
        error: "",
        detail: null
      });
      try {
        const out = await fetchDisputeDetail(runtime, linkedDisputeId);
        if (cancelled) return;
        setDisputeDetailState({
          loading: false,
          error: "",
          detail: normalizeDisputeDetailRecord(out)
        });
      } catch (error) {
        if (cancelled) return;
        setDisputeDetailState({
          loading: false,
          error: error.message,
          detail: null
        });
      }
    }

    void loadLinkedDispute();
    return () => {
      cancelled = true;
    };
  }, [linkedDisputeId, reloadToken, runtime, runtimeReady]);

  const linkedReceiptDetail = receiptDetailState.detail;
  const linkedReceiptIssues = Array.isArray(linkedReceiptDetail?.issues) ? linkedReceiptDetail.issues : [];
  const linkedReceiptEvidenceRefs = Array.isArray(linkedReceiptDetail?.evidenceRefs) ? linkedReceiptDetail.evidenceRefs : [];
  const linkedDisputeDetail = disputeDetailState.detail;
  const linkedDisputeTimeline = Array.isArray(linkedDisputeDetail?.timeline) ? linkedDisputeDetail.timeline : [];
  const linkedDisputeRelatedCases = Array.isArray(linkedDisputeDetail?.relatedCases) ? linkedDisputeDetail.relatedCases : [];
  const linkedDisputeEvidenceRefs = linkedDisputeDetail?.evidenceRefs ?? null;
  const consumerDataSources = normalizeConsumerDataSourcesRecord(tenantSettingsState.settings?.consumerDataSources);
  const activeAccountSessions = Array.isArray(accountSessionsState.sessions)
    ? accountSessionsState.sessions.filter((session) => !session.revokedAt)
    : [];
  const activeConsumerConnectors = Array.isArray(consumerConnectorsState.connectors)
    ? consumerConnectorsState.connectors.filter((connector) => !connector.revokedAt)
    : [];
  const preferredConsumerConnectorKind = runActionRequired?.code === "needs_calendar_access"
    ? "calendar"
    : runActionRequired?.code === "needs_email_access"
      ? "email"
      : null;
  const matchingConsumerConnectors = preferredConsumerConnectorKind
    ? activeConsumerConnectors.filter((connector) => connector.kind === preferredConsumerConnectorKind)
    : activeConsumerConnectors;
  const selectedAccountSession =
    activeAccountSessions.find((session) => session.sessionId === selectedAccountSessionId) ?? activeAccountSessions[0] ?? null;
  const selectedConsumerConnector =
    matchingConsumerConnectors.find((connector) => connector.connectorId === selectedConsumerConnectorId) ??
    matchingConsumerConnectors[0] ??
    null;
  const actionRequiredSourcePrefill = buildRunActionRequiredPrefillFromConsumerDataSources(runActionRequired, consumerDataSources);
  const actionRequiredAccountSessionPrefill = buildRunActionRequiredPrefillFromAccountSession(runActionRequired, selectedAccountSession);
  const actionRequiredConsumerConnectorPrefill = buildRunActionRequiredPrefillFromConsumerConnector(runActionRequired, selectedConsumerConnector);

  useEffect(() => {
    const requestedFields = Array.isArray(runActionRequired?.requestedFields) ? runActionRequired.requestedFields : [];
    setActionRequiredResponseDraft((previous) => {
      const nextFields = {};
      for (const field of requestedFields) {
        nextFields[field] = typeof previous.providedFields?.[field] === "string" ? previous.providedFields[field] : "";
      }
      return {
        providedFields: nextFields,
        evidenceRefs: previous.evidenceRefs,
        note: previous.note
      };
    });
    setActionRequiredUploadState({
      busy: false,
      error: "",
      message: "",
      lastDocument: null
    });
  }, [runActionRequired?.code, runActionRequired?.requestedAt]);

  useEffect(() => {
    if (runActionRequired?.code !== "needs_account_access") {
      setSelectedAccountSessionId("");
      return;
    }
    if (!activeAccountSessions.length) {
      setSelectedAccountSessionId("");
      return;
    }
    setSelectedAccountSessionId((previous) => {
      if (previous && activeAccountSessions.some((session) => session.sessionId === previous)) return previous;
      return activeAccountSessions[0].sessionId;
    });
  }, [activeAccountSessions, runActionRequired?.code]);

  useEffect(() => {
    if (runActionRequired?.code !== "needs_calendar_access" && runActionRequired?.code !== "needs_email_access") {
      setSelectedConsumerConnectorId("");
      return;
    }
    if (!matchingConsumerConnectors.length) {
      setSelectedConsumerConnectorId("");
      return;
    }
    setSelectedConsumerConnectorId((previous) => {
      if (previous && matchingConsumerConnectors.some((connector) => connector.connectorId === previous)) return previous;
      return matchingConsumerConnectors[0].connectorId;
    });
  }, [matchingConsumerConnectors, runActionRequired?.code]);

  function updateDisputeDraft(field, value) {
    setDisputeDraft((previous) => ({
      ...previous,
      [field]: value
    }));
  }

  function updateEvidenceDraft(field, value) {
    setEvidenceDraft((previous) => ({
      ...previous,
      [field]: value
    }));
  }

  function updateActionRequiredResponseDraftField(field, value) {
    setActionRequiredResponseDraft((previous) => ({
      ...previous,
      providedFields: {
        ...(previous.providedFields && typeof previous.providedFields === "object" ? previous.providedFields : {}),
        [field]: value
      }
    }));
  }

  function updateActionRequiredResponseDraft(field, value) {
    setActionRequiredResponseDraft((previous) => ({
      ...previous,
      [field]: value
    }));
  }

  function handleUseWalletSourceDefaults() {
    if (!actionRequiredSourcePrefill.hasPrefill) {
      setActionStatus("No wallet email or calendar defaults match the requested fields for this run.");
      return;
    }
    setActionRequiredResponseDraft((previous) => ({
      ...previous,
      providedFields: {
        ...(previous.providedFields && typeof previous.providedFields === "object" ? previous.providedFields : {}),
        ...actionRequiredSourcePrefill.providedFields
      }
    }));
    setActionStatus("Applied wallet email/calendar defaults to the requested fields. Review them before resuming the run.");
  }

  function handleUseDelegatedAccountSession() {
    if (!selectedAccountSession || !actionRequiredAccountSessionPrefill.hasPrefill) {
      setActionStatus("No delegated account session matches the requested fields for this run.");
      return;
    }
    setActionRequiredResponseDraft((previous) => ({
      ...previous,
      providedFields: {
        ...(previous.providedFields && typeof previous.providedFields === "object" ? previous.providedFields : {}),
        ...actionRequiredAccountSessionPrefill.providedFields
      }
    }));
    setActionStatus(
      `Applied delegated session ${selectedAccountSession.siteLabel || selectedAccountSession.providerLabel || selectedAccountSession.sessionId} to the requested fields. Review them before resuming the run.`
    );
  }

  function handleUseConsumerConnector() {
    if (!selectedConsumerConnector || !actionRequiredConsumerConnectorPrefill.hasPrefill) {
      setActionStatus("No wallet connector matches the requested fields for this run.");
      return;
    }
    setActionRequiredResponseDraft((previous) => ({
      ...previous,
      providedFields: {
        ...(previous.providedFields && typeof previous.providedFields === "object" ? previous.providedFields : {}),
        ...actionRequiredConsumerConnectorPrefill.providedFields
      }
    }));
    setActionStatus(
      `Applied connector ${selectedConsumerConnector.accountLabel || selectedConsumerConnector.accountAddress || selectedConsumerConnector.connectorId} to the requested fields. Review them before resuming the run.`
    );
  }

  async function handleOpenDispute() {
    if (!runId) return;
    setActionBusyState("open_dispute");
    setActionStatus(`Opening dispute for ${runId}...`);
    try {
      await requestJson({
        baseUrl: runtime.baseUrl,
        pathname: `/runs/${encodeURIComponent(runId)}/dispute/open`,
        method: "POST",
        headers: buildHeaders({ ...runtime, write: true, idempotencyKey: createClientId("run_detail_dispute_open") }),
        body: {
          disputeType: disputeDraft.disputeType,
          disputePriority: disputeDraft.disputePriority,
          disputeChannel: "counterparty",
          escalationLevel: disputeDraft.escalationLevel,
          openedByAgentId: runtime.tenantId,
          reason: String(disputeDraft.reason ?? "").trim() || null,
          evidenceRefs: normalizeStringArray(disputeDraft.evidenceRefs)
        }
      });
      setActionStatus(`Dispute opened for ${runId}. Refreshing execution state...`);
      startTransition(() => setReloadToken((value) => value + 1));
    } catch (error) {
      setActionStatus(`Open dispute failed for ${runId}: ${error.message}`);
    } finally {
      setActionBusyState("");
    }
  }

  async function handleSubmitEvidence() {
    if (!runId) return;
    const evidenceRef = String(evidenceDraft.evidenceRef ?? "").trim();
    if (!evidenceRef) {
      setActionStatus("Add an evidence reference before submitting.");
      return;
    }
    setActionBusyState("add_evidence");
    setActionStatus(`Submitting evidence for ${runId}...`);
    try {
      await requestJson({
        baseUrl: runtime.baseUrl,
        pathname: `/runs/${encodeURIComponent(runId)}/dispute/evidence`,
        method: "POST",
        headers: buildHeaders({ ...runtime, write: true, idempotencyKey: createClientId("run_detail_dispute_evidence") }),
        body: {
          disputeId: settlement?.disputeId ?? null,
          evidenceRef,
          submittedByAgentId: runtime.tenantId,
          reason: String(evidenceDraft.reason ?? "").trim() || null
        }
      });
      setEvidenceDraft({
        evidenceRef: "",
        reason: ""
      });
      setActionStatus(`Evidence added for ${runId}. Refreshing execution state...`);
      startTransition(() => setReloadToken((value) => value + 1));
    } catch (error) {
      setActionStatus(`Evidence submission failed for ${runId}: ${error.message}`);
    } finally {
      setActionBusyState("");
    }
  }

  async function handleRespondToActionRequired() {
    if (!runId || !runActionRequired) return;
    const requestedFields = Array.isArray(runActionRequired.requestedFields) ? runActionRequired.requestedFields : [];
    const missingFields = requestedFields.filter((field) => String(actionRequiredResponseDraft.providedFields?.[field] ?? "").trim() === "");
    if (missingFields.length > 0) {
      setActionStatus(`Add values for ${missingFields.join(", ")} before resuming this run.`);
      return;
    }
    const evidenceRefs = normalizeStringArray(actionRequiredResponseDraft.evidenceRefs);
    if (Array.isArray(runActionRequired.requestedEvidenceKinds) && runActionRequired.requestedEvidenceKinds.length > 0 && evidenceRefs.length === 0) {
      setActionStatus("Add at least one evidence reference before resuming this run.");
      return;
    }
    setActionBusyState("respond_action_required");
    setActionStatus(`Submitting the requested input for ${runId}...`);
    try {
      await respondToRunActionRequired(runtime, runId, {
        providedFields: actionRequiredResponseDraft.providedFields,
        providedEvidenceKinds: runActionRequired.requestedEvidenceKinds,
        evidenceRefs,
        note: actionRequiredResponseDraft.note
      });
      setActionRequiredResponseDraft({
        providedFields: {},
        evidenceRefs: "",
        note: ""
      });
      setActionStatus(`The missing input was attached to ${runId}. Refreshing execution state...`);
      startTransition(() => setReloadToken((value) => value + 1));
    } catch (error) {
      setActionStatus(`User response failed for ${runId}: ${error.message}`);
    } finally {
      setActionBusyState("");
    }
  }

  async function handleUploadActionRequiredDocument(event) {
    const file = event?.target?.files?.[0] ?? null;
    if (!file || !runId || !runActionRequired) return;
    setActionRequiredUploadState({
      busy: true,
      error: "",
      message: `Uploading ${file.name}...`,
      lastDocument: null
    });
    try {
      const uploaded = await uploadTenantDocument(runtime, file, {
        purpose: runActionRequired.code || "run_action_required",
        label: runActionRequired.title || file.name
      });
      const document = normalizeTenantDocumentRecord(uploaded?.document);
      if (!document.documentRef) throw new Error("document upload did not return a documentRef");
      setActionRequiredResponseDraft((previous) => {
        const nextEvidenceRefs = Array.from(
          new Set([
            ...normalizeStringArray(previous.evidenceRefs),
            document.documentRef
          ])
        ).join("\n");
        return {
          ...previous,
          evidenceRefs: nextEvidenceRefs
        };
      });
      setActionRequiredUploadState({
        busy: false,
        error: "",
        message: `${file.name} is attached and ready to send back to the run.`,
        lastDocument: document
      });
    } catch (error) {
      setActionRequiredUploadState({
        busy: false,
        error: error.message,
        message: "",
        lastDocument: null
      });
    } finally {
      if (event?.target) event.target.value = "";
    }
  }

  return (
    <div className="product-page">
      <section className="product-page-top">
        <div>
          <p className="product-kicker">Execution</p>
          <h1>One run, one timeline, one place to inspect what happened.</h1>
          <p className="product-lead">
            Follow execution from run creation through settlement, dispute state, arbitration, and the final receipt without jumping across multiple product surfaces.
          </p>
        </div>
        <div className="product-page-top-actions">
          <a className="product-button product-button-ghost" href="/wallet">Open wallet</a>
          <a className="product-button product-button-ghost" href={receiptHref}>Open receipts</a>
          <button className="product-button product-button-ghost" type="button" disabled={detailState.loading || actionBusyState !== ""} onClick={() => startTransition(() => setReloadToken((value) => value + 1))}>
            {detailState.loading ? "Refreshing..." : "Refresh execution"}
          </button>
          <a className="product-button product-button-solid" href={disputeHref}>Open dispute state</a>
        </div>
      </section>

      {!runtimeReady ? (
        <div className="product-inline-note warn">
          Complete <a href="/onboarding">Workspace Onboarding</a> first. Run detail requires a runtime key.
        </div>
      ) : null}

      {detailState.error ? <div className="product-inline-note bad">{detailState.error}</div> : null}
      {detailState.loading ? <div className="product-inline-note warn">Loading run detail…</div> : null}
      {actionStatus ? (
        <div className={`product-inline-note ${/failed|error/i.test(actionStatus) ? "bad" : "good"}`}>{actionStatus}</div>
      ) : null}
      {!detailState.loading && !detailState.error && detail?.integrityStatus === "attention_required" ? (
        <div className="product-inline-note warn">
          Some linked execution records need attention. Review the integrity notes below before relying on this run as the final source of truth.
        </div>
      ) : null}

      {detail ? (
        <>
          <section className="product-metric-grid">
            <article className="product-metric-card">
              <span>Run Status</span>
              <strong>{titleCaseState(run?.status ?? "unknown")}</strong>
              <small>{run?.taskType ? `Task type ${run.taskType}` : "Execution state from the canonical run record."}</small>
            </article>
            <article className="product-metric-card">
              <span>Verification</span>
              <strong>{titleCaseState(detail?.verification?.verificationStatus ?? "unknown")}</strong>
              <small>Replay-critical verification summary for this run.</small>
            </article>
            <article className="product-metric-card">
              <span>Settlement</span>
              <strong>{titleCaseState(settlement?.status ?? "unavailable")}</strong>
              <small>{Number.isFinite(settlement?.releasedAmountCents) ? formatCurrency(settlement.releasedAmountCents, settlement?.currency) : "No released volume yet."}</small>
            </article>
            <article className="product-metric-card">
              <span>Arbitration</span>
              <strong>{Number.isFinite(arbitration?.caseCount) ? arbitration.caseCount : 0}</strong>
              <small>{Number.isFinite(arbitration?.openCaseCount) ? `${arbitration.openCaseCount} open cases` : "No cases recorded."}</small>
            </article>
          </section>

          <section className="product-detail-layout">
            <article className="product-card">
              <div className="product-section-head compact">
                <p>Timeline</p>
                <h2>Execution, settlement, and dispute state in one chronological flow.</h2>
              </div>
              {detail.timeline.length ? (
                <div className="product-step-list">
                  {detail.timeline.map((entry) => (
                    <div key={entry.eventId} className="product-step-item product-timeline-item">
                      <div className="product-step-copy">
                        <strong>{humanizeLabel(entry.label, entry.label)}</strong>
                        <span>{entry.summary || humanizeLabel(entry.eventType, entry.eventType)}</span>
                        <span>{entry.occurredAt ? formatDateTime(entry.occurredAt) : "Time unavailable"}</span>
                      </div>
                      <div className="product-approval-step-meta">
                        <strong>{humanizeLabel(entry.category, entry.category)}</strong>
                        <span>{entry.status ? titleCaseState(entry.status) : "Recorded"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="product-empty-state">No execution timeline is available for this run yet.</div>
              )}
            </article>

            <article className="product-card">
              <div className="product-section-head compact">
                <p>Execution summary</p>
                <h2>Use this page as the canonical handoff point for any linked receipt or dispute.</h2>
              </div>
              <div className="product-detail-meta">
                <div>
                  <strong>Run ID</strong>
                  <span>{detail.runId}</span>
                </div>
                <div>
                  <strong>Agent</strong>
                  <span>{run?.agentId ?? "n/a"}</span>
                </div>
                <div>
                  <strong>RFQ</strong>
                  <span>{linkedTask?.rfqId ?? agreement?.rfqId ?? "n/a"}</span>
                </div>
                <div>
                  <strong>Agreement</strong>
                  <span>{agreement?.agreementId ?? "n/a"}</span>
                </div>
                <div>
                  <strong>Settlement receipt</strong>
                  <span>{settlementReceipt?.receiptId ?? "n/a"}</span>
                </div>
                <div>
                  <strong>Dispute</strong>
                  <span>{settlement?.disputeId ?? "Not opened"}</span>
                </div>
              </div>
              {detail.issues.length ? (
                <div className="product-step-list">
                  {detail.issues.map((issue) => (
                    <div key={`${detail.runId}:${issue.code}`} className="product-step-item">
                      <div className="product-step-copy">
                        <strong>{humanizeLabel(issue.code, issue.code)}</strong>
                        <span>{issue.message}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="product-actions">
                {settlementReceipt?.receiptId ? (
                  <a className="product-button product-button-ghost" href={receiptHref}>
                    Open receipt detail
                  </a>
                ) : null}
                <a className="product-button product-button-ghost" href={disputeHref}>
                  Open dispute detail
                </a>
              </div>
            </article>

            {phase1Contract ? (
              <article className="product-card">
                <div className="product-section-head compact">
                  <p>Phase 1 Contract</p>
                  <h2>Supported task family and proof contract for this run.</h2>
                </div>
                <div className="product-detail-meta">
                  <div>
                    <strong>Task family</strong>
                    <span>{phase1Contract.categoryLabel || humanizeLabel(phase1Contract.categoryId, "n/a")}</span>
                  </div>
                  <div>
                    <strong>Completion state</strong>
                    <span>{phase1CompletionState ? titleCaseState(phase1CompletionState) : "Missing"}</span>
                  </div>
                  <div>
                    <strong>Verification</strong>
                    <span>{titleCaseState(detail?.verification?.verificationStatus ?? "unknown")}</span>
                  </div>
                  <div>
                    <strong>Proof model</strong>
                    <span>{phase1Contract.completionContract?.proofSummary ?? "No proof summary published."}</span>
                  </div>
                </div>
                {phase1Contract.categorySummary ? <div className="product-inline-note">{phase1Contract.categorySummary}</div> : null}
              {phase1Contract.completionContract?.summary ? (
                  <div className="product-inline-note accent">{phase1Contract.completionContract.summary}</div>
                ) : null}
                {runActionRequired ? (
                  <div className="product-inline-note warn">
                    <strong>{runActionRequired.title || "Action required"}</strong>
                    <span> {describeRunActionRequired({
                      runActionRequiredCode: runActionRequired.code,
                      runActionRequiredDetail: runActionRequired.detail,
                      runActionRequiredFields: runActionRequired.requestedFields,
                      runActionRequiredEvidenceKinds: runActionRequired.requestedEvidenceKinds
                    })}</span>
                  </div>
                ) : null}
                {runActionRequired?.code === "needs_calendar_access" ? (
                  <div className="product-inline-note accent">
                    {consumerDataSources.calendar.enabled
                      ? "Your wallet already has a calendar source. Apply it to the requested fields before resuming this run."
                      : "No calendar source is enabled in the wallet yet. Add one in the authority wallet if you want faster scheduling runs."}{" "}
                    <a href="/wallet">Open wallet</a>
                  </div>
                ) : null}
                {runActionRequired?.code === "needs_calendar_access" || runActionRequired?.code === "needs_email_access" ? (
                  <div className="product-inline-note accent">
                    {matchingConsumerConnectors.length
                      ? "You can also apply a revocable wallet connector here, so the run resumes against a real linked account instead of freeform text."
                      : "No matching wallet connectors are active yet. Connect one in the wallet if you want this run to resume against a linked account."}{" "}
                    <a href="/wallet">Open wallet</a>
                  </div>
                ) : null}
                {runActionRequired?.code === "needs_account_access" ? (
                  <div className="product-inline-note accent">
                    {activeAccountSessions.length
                      ? "Pick a delegated account session from your wallet and apply it to this run. The agent will still operate inside that session's mode, spend cap, and review rules."
                      : "No delegated account sessions are available yet. Add one in the authority wallet before resuming this run."}{" "}
                    <a href="/wallet">Open wallet</a>
                  </div>
                ) : null}
                {runActionRequired ? (
                  <div className="product-form-grid">
                    {runActionRequired.code === "needs_account_access" ? (
                      <>
                        <label className="wide">
                          <span>Delegated account session</span>
                          <select
                            value={selectedAccountSessionId}
                            disabled={accountSessionsState.loading || activeAccountSessions.length === 0}
                            onChange={(event) => setSelectedAccountSessionId(event.target.value)}
                          >
                            {activeAccountSessions.length === 0 ? <option value="">No delegated sessions available</option> : null}
                            {activeAccountSessions.map((session) => (
                              <option key={`run_account_session_${session.sessionId}`} value={session.sessionId}>
                                {[
                                  session.siteLabel || session.providerLabel || session.sessionId,
                                  session.accountHandleMasked || "masked account",
                                  humanizeLabel(session.mode, session.mode)
                                ].join(" · ")}
                              </option>
                            ))}
                          </select>
                        </label>
                        {selectedAccountSession ? (
                          <div className="product-inline-note wide">
                            <strong>{selectedAccountSession.siteLabel || selectedAccountSession.providerLabel || selectedAccountSession.sessionId}</strong>
                            <span>
                              {" "}
                              {selectedAccountSession.accountHandleMasked || "masked account"} · {humanizeLabel(selectedAccountSession.mode, selectedAccountSession.mode)}
                              {Number.isFinite(selectedAccountSession.maxSpendCents)
                                ? ` · cap ${formatCurrency(selectedAccountSession.maxSpendCents, selectedAccountSession.currency)}`
                                : ""}
                            </span>
                          </div>
                        ) : null}
                        {accountSessionsState.error ? <div className="product-inline-note bad wide">{accountSessionsState.error}</div> : null}
                      </>
                    ) : null}
                    {runActionRequired.code === "needs_calendar_access" || runActionRequired.code === "needs_email_access" ? (
                      <>
                        <label className="wide">
                          <span>{runActionRequired.code === "needs_calendar_access" ? "Calendar connector" : "Email connector"}</span>
                          <select
                            value={selectedConsumerConnectorId}
                            disabled={consumerConnectorsState.loading || matchingConsumerConnectors.length === 0}
                            onChange={(event) => setSelectedConsumerConnectorId(event.target.value)}
                          >
                            {matchingConsumerConnectors.length === 0 ? <option value="">No matching connectors available</option> : null}
                            {matchingConsumerConnectors.map((connector) => (
                              <option key={`run_consumer_connector_${connector.connectorId}`} value={connector.connectorId}>
                                {[
                                  connector.accountLabel || connector.accountAddress || connector.connectorId,
                                  humanizeLabel(connector.provider, connector.provider),
                                  humanizeLabel(connector.mode, connector.mode)
                                ].join(" · ")}
                              </option>
                            ))}
                          </select>
                        </label>
                        {selectedConsumerConnector ? (
                          <div className="product-inline-note wide">
                            <strong>{selectedConsumerConnector.accountLabel || selectedConsumerConnector.accountAddress || selectedConsumerConnector.connectorId}</strong>
                            <span>
                              {" "}
                              {humanizeLabel(selectedConsumerConnector.provider, selectedConsumerConnector.provider)} · {humanizeLabel(selectedConsumerConnector.mode, selectedConsumerConnector.mode)}
                              {selectedConsumerConnector.timezone ? ` · ${selectedConsumerConnector.timezone}` : ""}
                            </span>
                          </div>
                        ) : null}
                        {consumerConnectorsState.error ? <div className="product-inline-note bad wide">{consumerConnectorsState.error}</div> : null}
                      </>
                    ) : null}
                    {runActionRequired.requestedFields.map((field) => (
                      <label key={`run_action_required_field_${field}`}>
                        <span>{humanizeLabel(field, field)}</span>
                        <input
                          value={String(actionRequiredResponseDraft.providedFields?.[field] ?? "")}
                          onChange={(event) => updateActionRequiredResponseDraftField(field, event.target.value)}
                          placeholder={`Provide ${humanizeLabel(field, field).toLowerCase()}`}
                        />
                      </label>
                    ))}
                    {runActionRequired.requestedEvidenceKinds.length > 0 ? (
                      <label className="wide">
                        <span>Evidence refs</span>
                        <textarea
                          value={actionRequiredResponseDraft.evidenceRefs}
                          onChange={(event) => updateActionRequiredResponseDraft("evidenceRefs", event.target.value)}
                          rows={3}
                          placeholder="artifact://..., email://..., upload://..."
                        />
                      </label>
                    ) : null}
                    {runActionRequired.requestedEvidenceKinds.length > 0 ? (
                      <label className="wide">
                        <span>Upload document</span>
                        <input
                          type="file"
                          disabled={actionRequiredUploadState.busy || actionBusyState !== ""}
                          onChange={(event) => void handleUploadActionRequiredDocument(event)}
                        />
                      </label>
                    ) : null}
                    <label className="wide">
                      <span>Operator note</span>
                      <textarea
                        value={actionRequiredResponseDraft.note}
                        onChange={(event) => updateActionRequiredResponseDraft("note", event.target.value)}
                        rows={3}
                        placeholder="Optional context to attach with your response"
                      />
                    </label>
                    {runActionRequired.requestedEvidenceKinds.length > 0 ? (
                      <div className="product-badge-row wide">
                        {runActionRequired.requestedEvidenceKinds.map((item) => (
                          <span key={`run_action_required_kind_${item}`} className="product-badge subtle">
                            {humanizeLabel(item)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {actionRequiredUploadState.error ? <div className="product-inline-note bad wide">{actionRequiredUploadState.error}</div> : null}
                    {actionRequiredUploadState.message ? <div className="product-inline-note good wide">{actionRequiredUploadState.message}</div> : null}
                    <div className="product-actions wide">
                      {actionRequiredSourcePrefill.hasPrefill ? (
                        <button
                          className="product-button product-button-ghost"
                          type="button"
                          disabled={actionBusyState !== ""}
                          onClick={handleUseWalletSourceDefaults}
                        >
                          Use wallet defaults
                        </button>
                      ) : null}
                      {runActionRequired.code === "needs_account_access" && activeAccountSessions.length > 0 ? (
                        <button
                          className="product-button product-button-ghost"
                          type="button"
                          disabled={actionBusyState !== ""}
                          onClick={handleUseDelegatedAccountSession}
                        >
                          Use delegated session
                        </button>
                      ) : null}
                      {(runActionRequired.code === "needs_calendar_access" || runActionRequired.code === "needs_email_access") && matchingConsumerConnectors.length > 0 ? (
                        <button
                          className="product-button product-button-ghost"
                          type="button"
                          disabled={actionBusyState !== ""}
                          onClick={handleUseConsumerConnector}
                        >
                          Use wallet connector
                        </button>
                      ) : null}
                      <button
                        className="product-button product-button-solid"
                        type="button"
                        disabled={actionBusyState !== ""}
                        onClick={() => void handleRespondToActionRequired()}
                      >
                        {actionBusyState === "respond_action_required" ? "Resuming..." : "Send input and resume"}
                      </button>
                    </div>
                  </div>
                ) : null}
                {isPhase1UserInputRequiredCompletionState(phase1CompletionState) ? (
                  <div className="product-inline-note warn">{describePhase1UserInputRequiredState({ title: phase1Contract.categoryLabel, phase1CompletionState })}</div>
                ) : null}
                {Array.isArray(phase1Contract.completionContract?.evidenceRequirements) &&
                phase1Contract.completionContract.evidenceRequirements.length > 0 ? (
                  <div className="product-badge-row">
                    {phase1Contract.completionContract.evidenceRequirements.map((item) => (
                      <span key={`phase1_contract_${item}`} className="product-badge subtle">
                        {humanizeLabel(item)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {phase1Issues.length > 0 ? (
                  <div className="product-step-list">
                    {phase1Issues.map((issue) => (
                      <div key={`${detail.runId}:phase1:${issue.code}`} className="product-step-item">
                        <div className="product-step-copy">
                          <strong>{humanizeLabel(issue.code, issue.code)}</strong>
                          <span>{issue.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="product-inline-note good">This run is inside a declared Phase 1 task family and its current proof checks are clean.</div>
                )}
              </article>
            ) : null}
          </section>

          <section className="product-grid-two">
            <article className="product-card">
              <div className="product-section-head compact">
                <p>Settlement</p>
                <h2>Amounts, decision records, and receipt lineage stay bound to the same run.</h2>
              </div>
              <div className="product-detail-meta">
                <div>
                  <strong>Status</strong>
                  <span>{titleCaseState(settlement?.status ?? "unavailable")}</span>
                </div>
                <div>
                  <strong>Released</strong>
                  <span>{Number.isFinite(settlement?.releasedAmountCents) ? formatCurrency(settlement.releasedAmountCents, settlement?.currency) : "n/a"}</span>
                </div>
                <div>
                  <strong>Refunded</strong>
                  <span>{Number.isFinite(settlement?.refundedAmountCents) ? formatCurrency(settlement.refundedAmountCents, settlement?.currency) : "n/a"}</span>
                </div>
                <div>
                  <strong>Kernel bindings</strong>
                  <span>{detail.settlement?.kernelVerification?.valid === true ? "Verified" : "Needs review"}</span>
                </div>
              </div>
              {settlement?.disputeContext?.reason ? (
                <div className="product-inline-note accent">Dispute reason: {settlement.disputeContext.reason}</div>
              ) : null}
              {runActionRequired && !phase1Contract ? (
                <div className="product-inline-note warn">{describeRunActionRequired({
                  runActionRequiredCode: runActionRequired.code,
                  runActionRequiredDetail: runActionRequired.detail,
                  runActionRequiredFields: runActionRequired.requestedFields,
                  runActionRequiredEvidenceKinds: runActionRequired.requestedEvidenceKinds
                })}</div>
              ) : null}
              {runActionRequired?.code === "needs_calendar_access" && !phase1Contract ? (
                <div className="product-inline-note accent">
                  {consumerDataSources.calendar.enabled
                    ? "Apply your saved calendar defaults here, or open the wallet to edit them before resuming."
                    : "This run is waiting on calendar context. Add a wallet calendar source for faster recovery."}{" "}
                  <a href="/wallet">Open wallet</a>
                </div>
              ) : null}
              {(runActionRequired?.code === "needs_calendar_access" || runActionRequired?.code === "needs_email_access") && !phase1Contract ? (
                <div className="product-inline-note accent">
                  {matchingConsumerConnectors.length
                    ? "A linked wallet connector can satisfy this access request directly and keep the run inside a revocable consumer account binding."
                    : "No matching wallet connectors are active yet. Connect one in the wallet if you want to resume with a linked account."}{" "}
                  <a href="/wallet">Open wallet</a>
                </div>
              ) : null}
              {runActionRequired?.code === "needs_account_access" && !phase1Contract ? (
                <div className="product-inline-note accent">
                  {activeAccountSessions.length
                    ? "Apply a delegated account session from the wallet to resume this commerce or account-admin run."
                    : "This run is waiting on account access. Add a delegated account session in the wallet before resuming."}{" "}
                  <a href="/wallet">Open wallet</a>
                </div>
              ) : null}
              {runActionRequired && !phase1Contract ? (
                <div className="product-form-grid">
                  {runActionRequired.code === "needs_account_access" ? (
                    <>
                      <label className="wide">
                        <span>Delegated account session</span>
                        <select
                          value={selectedAccountSessionId}
                          disabled={accountSessionsState.loading || activeAccountSessions.length === 0}
                          onChange={(event) => setSelectedAccountSessionId(event.target.value)}
                        >
                          {activeAccountSessions.length === 0 ? <option value="">No delegated sessions available</option> : null}
                          {activeAccountSessions.map((session) => (
                            <option key={`run_settlement_account_session_${session.sessionId}`} value={session.sessionId}>
                              {[
                                session.siteLabel || session.providerLabel || session.sessionId,
                                session.accountHandleMasked || "masked account",
                                humanizeLabel(session.mode, session.mode)
                              ].join(" · ")}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedAccountSession ? (
                        <div className="product-inline-note wide">
                          <strong>{selectedAccountSession.siteLabel || selectedAccountSession.providerLabel || selectedAccountSession.sessionId}</strong>
                          <span>
                            {" "}
                            {selectedAccountSession.accountHandleMasked || "masked account"} · {humanizeLabel(selectedAccountSession.mode, selectedAccountSession.mode)}
                            {Number.isFinite(selectedAccountSession.maxSpendCents)
                              ? ` · cap ${formatCurrency(selectedAccountSession.maxSpendCents, selectedAccountSession.currency)}`
                              : ""}
                          </span>
                        </div>
                      ) : null}
                      {accountSessionsState.error ? <div className="product-inline-note bad wide">{accountSessionsState.error}</div> : null}
                    </>
                  ) : null}
                  {runActionRequired.code === "needs_calendar_access" || runActionRequired.code === "needs_email_access" ? (
                    <>
                      <label className="wide">
                        <span>{runActionRequired.code === "needs_calendar_access" ? "Calendar connector" : "Email connector"}</span>
                        <select
                          value={selectedConsumerConnectorId}
                          disabled={consumerConnectorsState.loading || matchingConsumerConnectors.length === 0}
                          onChange={(event) => setSelectedConsumerConnectorId(event.target.value)}
                        >
                          {matchingConsumerConnectors.length === 0 ? <option value="">No matching connectors available</option> : null}
                          {matchingConsumerConnectors.map((connector) => (
                            <option key={`run_settlement_consumer_connector_${connector.connectorId}`} value={connector.connectorId}>
                              {[
                                connector.accountLabel || connector.accountAddress || connector.connectorId,
                                humanizeLabel(connector.provider, connector.provider),
                                humanizeLabel(connector.mode, connector.mode)
                              ].join(" · ")}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedConsumerConnector ? (
                        <div className="product-inline-note wide">
                          <strong>{selectedConsumerConnector.accountLabel || selectedConsumerConnector.accountAddress || selectedConsumerConnector.connectorId}</strong>
                          <span>
                            {" "}
                            {humanizeLabel(selectedConsumerConnector.provider, selectedConsumerConnector.provider)} · {humanizeLabel(selectedConsumerConnector.mode, selectedConsumerConnector.mode)}
                            {selectedConsumerConnector.timezone ? ` · ${selectedConsumerConnector.timezone}` : ""}
                          </span>
                        </div>
                      ) : null}
                      {consumerConnectorsState.error ? <div className="product-inline-note bad wide">{consumerConnectorsState.error}</div> : null}
                    </>
                  ) : null}
                  {runActionRequired.requestedFields.map((field) => (
                    <label key={`run_action_required_settlement_field_${field}`}>
                      <span>{humanizeLabel(field, field)}</span>
                      <input
                        value={String(actionRequiredResponseDraft.providedFields?.[field] ?? "")}
                        onChange={(event) => updateActionRequiredResponseDraftField(field, event.target.value)}
                        placeholder={`Provide ${humanizeLabel(field, field).toLowerCase()}`}
                      />
                    </label>
                  ))}
                  {runActionRequired.requestedEvidenceKinds.length > 0 ? (
                    <label className="wide">
                      <span>Evidence refs</span>
                      <textarea
                        value={actionRequiredResponseDraft.evidenceRefs}
                        onChange={(event) => updateActionRequiredResponseDraft("evidenceRefs", event.target.value)}
                        rows={3}
                        placeholder="artifact://..., email://..., upload://..."
                      />
                    </label>
                  ) : null}
                  {runActionRequired.requestedEvidenceKinds.length > 0 ? (
                    <label className="wide">
                      <span>Upload document</span>
                      <input
                        type="file"
                        disabled={actionRequiredUploadState.busy || actionBusyState !== ""}
                        onChange={(event) => void handleUploadActionRequiredDocument(event)}
                      />
                    </label>
                  ) : null}
                  <label className="wide">
                    <span>Operator note</span>
                    <textarea
                      value={actionRequiredResponseDraft.note}
                      onChange={(event) => updateActionRequiredResponseDraft("note", event.target.value)}
                      rows={3}
                      placeholder="Optional context to attach with your response"
                    />
                  </label>
                  {actionRequiredUploadState.error ? <div className="product-inline-note bad wide">{actionRequiredUploadState.error}</div> : null}
                  {actionRequiredUploadState.message ? <div className="product-inline-note good wide">{actionRequiredUploadState.message}</div> : null}
                  <div className="product-actions wide">
                    {actionRequiredSourcePrefill.hasPrefill ? (
                      <button
                        className="product-button product-button-ghost"
                        type="button"
                        disabled={actionBusyState !== ""}
                        onClick={handleUseWalletSourceDefaults}
                      >
                        Use wallet defaults
                      </button>
                    ) : null}
                    {runActionRequired.code === "needs_account_access" && activeAccountSessions.length > 0 ? (
                      <button
                        className="product-button product-button-ghost"
                        type="button"
                        disabled={actionBusyState !== ""}
                        onClick={handleUseDelegatedAccountSession}
                      >
                        Use delegated session
                      </button>
                    ) : null}
                    {(runActionRequired.code === "needs_calendar_access" || runActionRequired.code === "needs_email_access") && matchingConsumerConnectors.length > 0 ? (
                      <button
                        className="product-button product-button-ghost"
                        type="button"
                        disabled={actionBusyState !== ""}
                        onClick={handleUseConsumerConnector}
                      >
                        Use wallet connector
                      </button>
                    ) : null}
                    <button
                      className="product-button product-button-solid"
                      type="button"
                      disabled={actionBusyState !== ""}
                      onClick={() => void handleRespondToActionRequired()}
                    >
                      {actionBusyState === "respond_action_required" ? "Resuming..." : "Send input and resume"}
                    </button>
                  </div>
                </div>
              ) : null}
              {settlement?.disputeResolution?.summary ? (
                <div className="product-inline-note good">Resolution: {settlement.disputeResolution.summary}</div>
              ) : null}
              {settlement ? (
                <>
                  {canOpenDispute ? (
                    <div className="product-form-grid">
                      <label>
                        <span>Type</span>
                        <select value={disputeDraft.disputeType} onChange={(event) => updateDisputeDraft("disputeType", event.target.value)}>
                          <option value="quality">quality</option>
                          <option value="delivery">delivery</option>
                          <option value="fraud">fraud</option>
                          <option value="policy">policy</option>
                          <option value="payment">payment</option>
                          <option value="other">other</option>
                        </select>
                      </label>
                      <label>
                        <span>Priority</span>
                        <select value={disputeDraft.disputePriority} onChange={(event) => updateDisputeDraft("disputePriority", event.target.value)}>
                          <option value="low">low</option>
                          <option value="normal">normal</option>
                          <option value="high">high</option>
                          <option value="critical">critical</option>
                        </select>
                      </label>
                      <label className="wide">
                        <span>Reason</span>
                        <input value={disputeDraft.reason} onChange={(event) => updateDisputeDraft("reason", event.target.value)} placeholder="Explain what failed or what needs review" />
                      </label>
                      <label className="wide">
                        <span>Evidence refs</span>
                        <input value={disputeDraft.evidenceRefs} onChange={(event) => updateDisputeDraft("evidenceRefs", event.target.value)} placeholder="artifact://..., ticket://..., email://..." />
                      </label>
                    </div>
                  ) : null}
                  {settlement.disputeStatus === "open" ? (
                    <div className="product-form-grid">
                      <label className="wide">
                        <span>Add evidence ref</span>
                        <input value={evidenceDraft.evidenceRef} onChange={(event) => updateEvidenceDraft("evidenceRef", event.target.value)} placeholder="artifact://follow-up/1" />
                      </label>
                      <label className="wide">
                        <span>Evidence note</span>
                        <input value={evidenceDraft.reason} onChange={(event) => updateEvidenceDraft("reason", event.target.value)} placeholder="Why this evidence matters" />
                      </label>
                    </div>
                  ) : null}
                  <div className="product-actions">
                    {canOpenDispute ? (
                      <button className="product-button product-button-solid" type="button" disabled={actionBusyState !== ""} onClick={() => void handleOpenDispute()}>
                        {actionBusyState === "open_dispute" ? "Opening..." : "Open dispute from this run"}
                      </button>
                    ) : null}
                    {settlement.disputeStatus === "open" ? (
                      <button className="product-button product-button-ghost" type="button" disabled={actionBusyState !== ""} onClick={() => void handleSubmitEvidence()}>
                        {actionBusyState === "add_evidence" ? "Submitting..." : "Add evidence from this run"}
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </article>

            <article className="product-card">
              <div className="product-section-head compact">
                <p>Legacy routing context</p>
                <h2>Agreement and routing state remain visible when this run came through older routing flows.</h2>
              </div>
              {agreement ? (
                <>
                  <div className="product-detail-meta">
                    <div>
                      <strong>Provider</strong>
                      <span>{agreement?.agreement?.payeeAgentId ?? agreement?.agreement?.providerAgentId ?? "n/a"}</span>
                    </div>
                    <div>
                      <strong>Payer</strong>
                      <span>{agreement?.agreement?.payerAgentId ?? "n/a"}</span>
                    </div>
                    <div>
                      <strong>Accepted</strong>
                      <span>{agreement?.agreement?.acceptedAt ? formatDateTime(agreement.agreement.acceptedAt) : "n/a"}</span>
                    </div>
                    <div>
                      <strong>Policy binding</strong>
                      <span>{agreement?.policyBindingVerification?.ok === true ? "Verified" : "Needs review"}</span>
                    </div>
                  </div>
                  {linkedTask?.acceptedBid?.amountCents ? (
                    <div className="product-inline-note">
                      Accepted bid: {formatCurrency(linkedTask.acceptedBid.amountCents, linkedTask.acceptedBid.currency)} by {linkedTask.acceptedBid.bidderAgentId || "selected worker"}.
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="product-empty-state">This run does not have legacy routing context attached.</div>
              )}
              {Number.isFinite(arbitration?.caseCount) && arbitration.caseCount > 0 ? (
                <div className="product-step-list">
                  {extractList(arbitration, ["cases"]).slice(0, 4).map((caseRow, index) => (
                    <div key={`${caseRow?.caseId ?? "case"}:${index}`} className="product-step-item">
                      <div className="product-step-copy">
                        <strong>{caseRow?.caseId ?? "Arbitration case"}</strong>
                        <span>{caseRow?.openedAt ? formatDateTime(caseRow.openedAt) : "Open time unavailable"}</span>
                      </div>
                      <StatusPill value={caseRow?.status ?? "unknown"} />
                    </div>
                  ))}
                </div>
              ) : null}
              {managedExecution ? (
                <>
                  <div className="product-inline-note accent">
                    This run is currently handed off to a certified adapter.
                  </div>
                  <div className="product-detail-meta">
                    <div>
                      <strong>Assignment mode</strong>
                      <span>{managedExecution.assignmentMode ? humanizeLabel(managedExecution.assignmentMode, managedExecution.assignmentMode) : "n/a"}</span>
                    </div>
                    <div>
                      <strong>Assigned at</strong>
                      <span>{managedExecution.assignedAt ? formatDateTime(managedExecution.assignedAt) : "n/a"}</span>
                    </div>
                    <div>
                      <strong>Managed provider</strong>
                      <span>{managedExecution.providerId || managedExecution.providerRef || "n/a"}</span>
                    </div>
                    <div>
                      <strong>Tool</strong>
                      <span>{managedExecution.toolId || "n/a"}</span>
                    </div>
                    <div>
                      <strong>Handoff status</strong>
                      <span>{managedExecution.handoffReady === true ? "Ready" : humanizeLabel(managedExecution.handoffCode, "Blocked")}</span>
                    </div>
                    <div>
                      <strong>Handed off</strong>
                      <span>{managedExecution.handedOffAt ? formatDateTime(managedExecution.handedOffAt) : "n/a"}</span>
                    </div>
                  </div>
                  {managedExecution.handoffMessage ? (
                    <div className="product-inline-note">{managedExecution.handoffMessage}</div>
                  ) : null}
                  {managedExecution.accountSessionBinding ? (
                    <div className="product-inline-note">
                      Account session: {[managedExecution.accountSessionBinding.siteKey, managedExecution.accountSessionBinding.accountHandleMasked, managedExecution.accountSessionBinding.mode]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  ) : null}
                  {Array.isArray(managedExecution.assignmentHistory) && managedExecution.assignmentHistory.length > 1 ? (
                    <div className="product-step-list">
                      {managedExecution.assignmentHistory.map((entry, index) => (
                        <div
                          key={`${entry?.artifactId ?? entry?.providerId ?? "assignment"}:${index}`}
                          className="product-step-item"
                        >
                          <div className="product-step-copy">
                            <strong>{entry?.providerId || entry?.providerRef || "Managed provider"}</strong>
                            <span>
                              {entry?.toolId || "tool"} ·{" "}
                              {entry?.assignmentMode ? humanizeLabel(entry.assignmentMode, entry.assignmentMode) : "assigned"}
                            </span>
                          </div>
                          <span>{entry?.assignedAt ? formatDateTime(entry.assignedAt) : "time unavailable"}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {latestUserResponse ? (
                    <>
                      <div className="product-detail-meta">
                        <div>
                          <strong>Latest user response</strong>
                          <span>{latestUserResponse.respondedAt ? formatDateTime(latestUserResponse.respondedAt) : "n/a"}</span>
                        </div>
                        <div>
                          <strong>Boundary</strong>
                          <span>{latestUserResponse.actionRequiredCode ? humanizeLabel(latestUserResponse.actionRequiredCode, latestUserResponse.actionRequiredCode) : "n/a"}</span>
                        </div>
                        <div>
                          <strong>Provided fields</strong>
                          <span>{Array.isArray(latestUserResponse.providedFieldKeys) && latestUserResponse.providedFieldKeys.length > 0 ? latestUserResponse.providedFieldKeys.join(", ") : "n/a"}</span>
                        </div>
                        <div>
                          <strong>Evidence</strong>
                          <span>{Number.isFinite(Number(latestUserResponse.evidenceRefCount)) ? String(latestUserResponse.evidenceRefCount) : "0"}</span>
                        </div>
                      </div>
                      {latestUserResponse.consumerConnectorBinding ? (
                        <div className="product-inline-note">
                          Connector: {[latestUserResponse.consumerConnectorBinding.kind, latestUserResponse.consumerConnectorBinding.provider, latestUserResponse.consumerConnectorBinding.accountAddress || latestUserResponse.consumerConnectorBinding.accountLabel]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      ) : null}
                      {!managedExecution.accountSessionBinding && latestUserResponse.accountSessionBinding ? (
                        <div className="product-inline-note">
                          Account session: {[latestUserResponse.accountSessionBinding.siteKey, latestUserResponse.accountSessionBinding.accountHandleMasked, latestUserResponse.accountSessionBinding.mode]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {managedExecution.invocation ? (
                    <>
                      <div className="product-detail-meta">
                        <div>
                          <strong>Invocation status</strong>
                          <span>
                            {Number.isFinite(Number(managedExecution.invocation.responseStatusCode))
                              ? `HTTP ${managedExecution.invocation.responseStatusCode}`
                              : "n/a"}
                          </span>
                        </div>
                        <div>
                          <strong>Invoked at</strong>
                          <span>{managedExecution.invocation.invokedAt ? formatDateTime(managedExecution.invocation.invokedAt) : "n/a"}</span>
                        </div>
                        <div>
                          <strong>Request binding</strong>
                          <span>{managedExecution.invocation.requestBindingSha256 ? "Verified" : "n/a"}</span>
                        </div>
                        <div>
                          <strong>Provider signature</strong>
                          <span>{managedExecution.invocation.providerSignature?.verified === true ? "Verified" : "Attention required"}</span>
                        </div>
                      </div>
                      {managedExecution.invocation.responseSha256 ? (
                        <div className="product-inline-note">
                          Response hash: <code>{managedExecution.invocation.responseSha256}</code>
                        </div>
                      ) : null}
                      {Array.isArray(managedExecution.invocationHistory) && managedExecution.invocationHistory.length > 1 ? (
                        <div className="product-step-list">
                          {managedExecution.invocationHistory.map((entry, index) => (
                            <div
                              key={`${entry?.artifactId ?? entry?.providerId ?? "invocation"}:${index}`}
                              className="product-step-item"
                            >
                              <div className="product-step-copy">
                                <strong>{entry?.providerId || "Managed provider invocation"}</strong>
                                <span>{entry?.toolId || "tool"}</span>
                              </div>
                              <span>
                                {Number.isFinite(Number(entry?.responseStatusCode))
                                  ? `HTTP ${entry.responseStatusCode}`
                                  : entry?.invokedAt
                                    ? formatDateTime(entry.invokedAt)
                                    : "status unavailable"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}
              {taskWallet ? (
                <>
                  <div className="product-inline-note accent">
                    This run is bounded by an Action Wallet approval boundary.
                  </div>
                  <div className="product-detail-meta">
                    <div>
                      <strong>Action Wallet boundary</strong>
                      <span>{taskWallet.walletId || "n/a"}</span>
                    </div>
                    <div>
                      <strong>Spend cap</strong>
                      <span>{Number.isFinite(Number(taskWallet.maxSpendCents)) ? formatCurrency(taskWallet.maxSpendCents, taskWallet.currency) : "No direct spend"}</span>
                    </div>
                    <div>
                      <strong>Review mode</strong>
                      <span>{taskWallet.reviewMode ? humanizeLabel(taskWallet.reviewMode, taskWallet.reviewMode) : "n/a"}</span>
                    </div>
                    <div>
                      <strong>Category</strong>
                      <span>{taskWallet.categoryId ? humanizeLabel(taskWallet.categoryId, taskWallet.categoryId) : "n/a"}</span>
                    </div>
                    <div>
                      <strong>Expires</strong>
                      <span>{taskWallet.expiresAt ? formatDateTime(taskWallet.expiresAt) : "Open until run completion"}</span>
                    </div>
                    <div>
                      <strong>Settlement</strong>
                      <span>{taskWallet.settlementPolicy?.settlementModel ? humanizeLabel(taskWallet.settlementPolicy.settlementModel, taskWallet.settlementPolicy.settlementModel) : "n/a"}</span>
                    </div>
                  </div>
                  {Array.isArray(taskWallet.allowedMerchantScopes) && taskWallet.allowedMerchantScopes.length > 0 ? (
                    <div className="product-inline-note">
                      Merchant scope: {taskWallet.allowedMerchantScopes.join(", ")}
                    </div>
                  ) : null}
                  {Array.isArray(taskWallet.allowedSpecialistProfileIds) && taskWallet.allowedSpecialistProfileIds.length > 0 ? (
                    <div className="product-inline-note">
                      Allowed execution profiles: {taskWallet.allowedSpecialistProfileIds.join(", ")}
                    </div>
                  ) : null}
                  {Array.isArray(taskWallet.evidenceRequirements) && taskWallet.evidenceRequirements.length > 0 ? (
                    <div className="product-inline-note">
                      Required proof: {taskWallet.evidenceRequirements.join(", ")}
                    </div>
                  ) : null}
                  {taskWalletSettlement ? (
                    <div className="product-detail-meta">
                      <div>
                        <strong>Consumer rail</strong>
                        <span>{humanizeLabel(taskWalletSettlement.consumerSpendRail, taskWalletSettlement.consumerSpendRail)}</span>
                      </div>
                      <div>
                        <strong>Platform rail</strong>
                        <span>{humanizeLabel(taskWalletSettlement.platformSettlementRail, taskWalletSettlement.platformSettlementRail)}</span>
                      </div>
                      <div>
                        <strong>Machine rail</strong>
                        <span>{humanizeLabel(taskWalletSettlement.machineSpendRail, taskWalletSettlement.machineSpendRail)}</span>
                      </div>
                      <div>
                        <strong>Finalize rule</strong>
                        <span>{humanizeLabel(taskWalletSettlement.finalizationRule, taskWalletSettlement.finalizationRule)}</span>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
              {!managedExecution && latestUserResponse ? (
                <>
                  <div className="product-inline-note accent">
                    The network has already received the latest user response for this run.
                  </div>
                  <div className="product-detail-meta">
                    <div>
                      <strong>Responded at</strong>
                      <span>{latestUserResponse.respondedAt ? formatDateTime(latestUserResponse.respondedAt) : "n/a"}</span>
                    </div>
                    <div>
                      <strong>Boundary</strong>
                      <span>{latestUserResponse.actionRequiredCode ? humanizeLabel(latestUserResponse.actionRequiredCode, latestUserResponse.actionRequiredCode) : "n/a"}</span>
                    </div>
                    <div>
                      <strong>Provided fields</strong>
                      <span>{Array.isArray(latestUserResponse.providedFieldKeys) && latestUserResponse.providedFieldKeys.length > 0 ? latestUserResponse.providedFieldKeys.join(", ") : "n/a"}</span>
                    </div>
                    <div>
                      <strong>Evidence</strong>
                      <span>{Number.isFinite(Number(latestUserResponse.evidenceRefCount)) ? String(latestUserResponse.evidenceRefCount) : "0"}</span>
                    </div>
                  </div>
                  {latestUserResponse.consumerConnectorBinding ? (
                    <div className="product-inline-note">
                      Connector: {[latestUserResponse.consumerConnectorBinding.kind, latestUserResponse.consumerConnectorBinding.provider, latestUserResponse.consumerConnectorBinding.accountAddress || latestUserResponse.consumerConnectorBinding.accountLabel]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  ) : null}
                  {latestUserResponse.accountSessionBinding ? (
                    <div className="product-inline-note">
                      Account session: {[latestUserResponse.accountSessionBinding.siteKey, latestUserResponse.accountSessionBinding.accountHandleMasked, latestUserResponse.accountSessionBinding.mode]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  ) : null}
                </>
              ) : null}
            </article>
          </section>

          <section className="product-grid-two">
            <article className="product-card">
              <div className="product-section-head compact">
                <p>Linked receipt</p>
                <h2>Proof stays attached to the same execution page instead of living in a separate vault only.</h2>
              </div>
              {receiptDetailState.error ? <div className="product-inline-note bad">{receiptDetailState.error}</div> : null}
              {receiptDetailState.loading ? <div className="product-inline-note warn">Loading linked receipt…</div> : null}
              {linkedReceiptDetail ? (
                <>
                  <div className="product-detail-meta">
                    <div>
                      <strong>Receipt</strong>
                      <span>{linkedReceiptDetail.receiptId || "n/a"}</span>
                    </div>
                    <div>
                      <strong>Work order</strong>
                      <span>{linkedReceiptDetail.workOrderId || "n/a"}</span>
                    </div>
                    <div>
                      <strong>Trace</strong>
                      <span>{linkedReceiptDetail.traceId || "n/a"}</span>
                    </div>
                    <div>
                      <strong>Integrity</strong>
                      <span>{titleCaseState(linkedReceiptDetail.integrityStatus || "unknown")}</span>
                    </div>
                  </div>
                  {linkedReceiptIssues.length ? (
                    <div className="product-step-list">
                      {linkedReceiptIssues.slice(0, 4).map((issue) => (
                        <div key={`${linkedReceiptDetail.receiptId}:${issue.code}`} className="product-step-item">
                          <div className="product-step-copy">
                            <strong>{humanizeLabel(issue.code, issue.code)}</strong>
                            <span>{issue.message}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="product-inline-note good">Receipt integrity is bound and replayable for this execution.</div>
                  )}
                  <div className="product-sidebar-list">
                    <div>
                      <strong>Evidence refs</strong>
                      <span>{linkedReceiptEvidenceRefs.length}</span>
                    </div>
                    <div>
                      <strong>Settlement run</strong>
                      <span>{linkedReceiptDetail.settlementRunId || "n/a"}</span>
                    </div>
                    <div>
                      <strong>Attestation</strong>
                      <span>{linkedReceiptDetail.executionAttestation?.status ?? "not reported"}</span>
                    </div>
                  </div>
                  {linkedReceiptEvidenceRefs.length ? (
                    <div className="product-badge-row">
                      {linkedReceiptEvidenceRefs.slice(0, 6).map((evidenceRef) => (
                        <span key={evidenceRef} className="product-badge">{evidenceRef}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="product-actions">
                    <a className="product-button product-button-ghost" href={receiptHref}>Open receipt vault</a>
                    {linkedDisputeId ? <a className="product-button product-button-ghost" href={disputeHref}>Open linked dispute</a> : null}
                  </div>
                </>
              ) : (
                <div className="product-empty-state">No linked receipt packet is available yet for this run.</div>
              )}
            </article>

            <article className="product-card">
              <div className="product-section-head compact">
                <p>Linked dispute</p>
                <h2>When recourse exists, keep the dispute packet and evidence chain visible on the same page.</h2>
              </div>
              {disputeDetailState.error ? <div className="product-inline-note bad">{disputeDetailState.error}</div> : null}
              {disputeDetailState.loading ? <div className="product-inline-note warn">Loading linked dispute…</div> : null}
              {linkedDisputeDetail ? (
                <>
                  <div className="product-detail-meta">
                    <div>
                      <strong>Dispute</strong>
                      <span>{linkedDisputeDetail.item?.disputeId || linkedDisputeId || "n/a"}</span>
                    </div>
                    <div>
                      <strong>Case</strong>
                      <span>{linkedDisputeDetail.arbitrationCase?.caseId || linkedDisputeDetail.item?.caseId || "No case yet"}</span>
                    </div>
                    <div>
                      <strong>Status</strong>
                      <span>{humanizeLabel(linkedDisputeDetail.arbitrationCase?.status ?? linkedDisputeDetail.item?.disputeStatus, "unknown")}</span>
                    </div>
                    <div>
                      <strong>Evidence</strong>
                      <span>{Array.isArray(linkedDisputeEvidenceRefs?.all) ? linkedDisputeEvidenceRefs.all.length : 0}</span>
                    </div>
                  </div>
                  {linkedDisputeDetail.settlement?.disputeContext?.reason ? (
                    <div className="product-inline-note accent">Reason: {linkedDisputeDetail.settlement.disputeContext.reason}</div>
                  ) : null}
                  {linkedDisputeDetail.settlement?.disputeResolution?.summary ? (
                    <div className="product-inline-note good">{linkedDisputeDetail.settlement.disputeResolution.summary}</div>
                  ) : null}
                  {linkedDisputeTimeline.length ? (
                    <div className="product-step-list">
                      {linkedDisputeTimeline.slice(0, 6).map((event, index) => (
                        <div key={`${event?.eventType ?? "event"}:${event?.at ?? index}`} className="product-step-item">
                          <div className="product-step-copy">
                            <strong>{humanizeLabel(event?.eventType, "Event")}</strong>
                            <span>{event?.at ? formatDateTime(event.at) : "Time unavailable"}</span>
                          </div>
                          <StatusPill value={event?.eventType?.includes("closed") ? "closed" : "active"} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="product-empty-state">No dispute timeline is available yet for this run.</div>
                  )}
                  {linkedDisputeRelatedCases.length ? (
                    <div className="product-badge-row">
                      {linkedDisputeRelatedCases.slice(0, 6).map((caseRow, index) => (
                        <span key={`${caseRow?.caseId ?? "case"}:${index}`} className="product-badge">
                          {caseRow?.caseId ?? "case"}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="product-actions">
                    <a className="product-button product-button-ghost" href={disputeHref}>Open dispute center</a>
                  </div>
                </>
              ) : (
                <div className="product-empty-state">No dispute packet is attached to this run right now.</div>
              )}
            </article>
          </section>

          <section className="product-section">
            <div className="product-section-head">
              <p>Payload</p>
              <h2>The canonical run packet stays inspectable for debugging and audit.</h2>
            </div>
            <details className="product-details" open>
              <summary>Run detail payload</summary>
              <pre><code>{prettyJson(detail.raw)}</code></pre>
            </details>
          </section>
        </>
      ) : null}
    </div>
  );
}

function DeveloperPage({ runtime, onboardingState, lastAgentId }) {
  const bootstrapBundle = onboardingState?.bootstrap ?? null;
  const smokeBundle = onboardingState?.smoke ?? null;
  const agentId = lastAgentId || "host_action_wallet";
  const bootstrapIssued = Boolean(bootstrapBundle?.bootstrap?.apiKey?.keyId);
  const smokeGreen = Boolean(smokeBundle?.smoke?.initialized);
  const developerChecks = [
    {
      id: "bootstrap",
      label: "Runtime bootstrap issued",
      ready: bootstrapIssued,
      detail: bootstrapIssued
        ? `API key ${bootstrapBundle?.bootstrap?.apiKey?.keyId ?? "issued"} is ready for host installs.`
        : "Use workspace onboarding to issue the tenant-scoped API key and MCP bundle first."
    },
    {
      id: "smoke",
      label: "Host runtime smoke is green",
      ready: smokeGreen,
      detail: smokeGreen
        ? `${smokeBundle?.smoke?.toolsCount ?? 0} tools were visible in the last smoke run.`
        : "Run the hosted smoke before packaging Claude MCP or OpenClaw for a design partner."
    },
    {
      id: "approval",
      label: "Hosted approval path is reachable",
      ready: Boolean(String(runtime?.baseUrl ?? "").trim()),
      detail: String(runtime?.baseUrl ?? "").trim()
        ? "Approval, receipt, and dispute pages resolve against the configured runtime."
        : "Set the runtime base URL before wiring the host pack."
    },
    {
      id: "trust",
      label: "Trust surfaces are ready for handoff",
      ready: true,
      detail: "Approvals, receipts, disputes, and wallet controls are exposed as the durable web layer for host actions."
    }
  ];
  const developerReadyCount = developerChecks.filter((check) => check.ready).length;
  const firstActionFlow = [
    "Issue one tenant-scoped runtime bootstrap.",
    "Install Claude MCP, OpenClaw, Codex, CLI, or API against the same runtime.",
    "Create an action intent and route yellow-state decisions to the hosted approval page.",
    "After execution, fetch the receipt and keep dispute/recourse on the same run."
  ];

  return (
    <div className="product-page">
      <section className="product-page-top">
        <div>
          <p className="product-kicker">Developers</p>
          <h1>Install once. Use the same product through CLI, MCP, or API.</h1>
          <p className="product-lead">
            Set up Nooterra once, then run the same Action Wallet contract through Claude MCP, OpenClaw, Codex, CLI, or API without rebuilding approvals, receipts, or disputes per host.
          </p>
        </div>
        <div className="product-page-top-actions">
          <a className="product-button product-button-ghost" href={docsLinks.quickstart}>Quickstart</a>
          <a className="product-button product-button-solid" href={docsLinks.integrations}>Host Integration Guide</a>
        </div>
      </section>

      <section className="product-metric-grid">
        <article className="product-metric-card">
          <span>Launch hosts</span>
          <strong>5</strong>
          <small>Claude MCP, OpenClaw, Codex, CLI, and API all share the same runtime contract.</small>
        </article>
        <article className="product-metric-card">
          <span>Bootstrap</span>
          <strong>{bootstrapIssued ? "Ready" : "Pending"}</strong>
          <small>{bootstrapIssued ? "Tenant-scoped credentials already issued." : "Issue runtime credentials before installing a host."}</small>
        </article>
        <article className="product-metric-card">
          <span>Smoke</span>
          <strong>{smokeGreen ? "Green" : "Pending"}</strong>
          <small>{smokeGreen ? "The current runtime passed the hosted smoke path." : "Use the smoke run before sending the install to a partner."}</small>
        </article>
        <article className="product-metric-card">
          <span>First governed action</span>
          <strong>{developerReadyCount} / {developerChecks.length}</strong>
          <small>Readiness checks for install-to-first-approval across the launch channels.</small>
        </article>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Install readiness</p>
            <h2>Use one runtime, then clear the shortest path to the first hosted approval.</h2>
          </div>
          <div className="product-step-list">
            {developerChecks.map((check) => (
              <div key={`developer_check:${check.id}`} className="product-step-item">
                <div className="product-step-copy">
                  <strong>{check.label}</strong>
                  <span>{check.detail}</span>
                </div>
                <StatusPill value={check.ready ? "active" : "pending"} />
              </div>
            ))}
          </div>
          <div className="product-actions">
            <a className="product-button product-button-ghost" href="/onboarding">Workspace onboarding</a>
            <a className="product-button product-button-ghost" href="/approvals">Hosted approvals</a>
            <a className="product-button product-button-solid" href="/receipts">Receipts vault</a>
          </div>
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>First flow</p>
            <h2>Keep the install story boring: one runtime, one host, one governed action.</h2>
          </div>
          <div className="product-step-list">
            {firstActionFlow.map((step, index) => (
              <div key={`developer_flow:${index + 1}`} className="product-step-item">
                <div className="product-step-copy">
                  <strong>Step {index + 1}</strong>
                  <span>{step}</span>
                </div>
                <StatusPill value={index === 0 && !bootstrapIssued ? "pending" : "active"} />
              </div>
            ))}
          </div>
          <div className="product-sidebar-list">
            <div>
              <strong>Same runtime everywhere</strong>
              <span>Claude MCP and OpenClaw should not get custom approval logic. They should call the same hosted Action Wallet path as Codex, API, and CLI installs.</span>
            </div>
            <div>
              <strong>Hosted trust layer</strong>
              <span>The web product exists for approval, proof, and recourse. Keep day-to-day work inside the host.</span>
            </div>
            <div>
              <strong>Launch discipline</strong>
              <span>Do not widen channels or add extra connector dreams before install-to-first-approval is repeatable.</span>
            </div>
          </div>
        </article>
      </section>

      <section className="product-grid-two">
        <article className="product-card">
          <div className="product-section-head compact">
            <p>Toolkit</p>
            <h2>Use the entry point that matches your team.</h2>
          </div>
          <div className="product-access-grid">
            <div className="product-access-card">
              <div className="product-mini-card-head">
                <BookOpen size={18} />
                <span>Quickstart</span>
              </div>
              <p>Install the CLI and get a working setup without reading internal architecture first.</p>
            </div>
            <div className="product-access-card">
              <div className="product-mini-card-head">
                <Cable size={18} />
                <span>MCP</span>
              </div>
              <p>Connect Claude through MCP and keep hosted approvals in the same host-controlled flow.</p>
            </div>
            <div className="product-access-card">
              <div className="product-mini-card-head">
                <GitBranchPlus size={18} />
                <span>OpenClaw</span>
              </div>
              <p>Package OpenClaw with the same runtime credentials and approval contract as the Claude install.</p>
            </div>
            <div className="product-access-card">
              <div className="product-mini-card-head">
                <SquareTerminal size={18} />
                <span>Codex + API</span>
              </div>
              <p>Use the public host pack to create intents, request approvals, fetch grants, and read receipts from Codex or application code.</p>
            </div>
          </div>
        </article>

        <article className="product-card">
          <div className="product-section-head compact">
            <p>How To Use It</p>
            <h2>Three common ways to start.</h2>
          </div>
          <div className="product-ide-grid">
            {ideModes.map((mode) => (
              <div key={mode.title} className="product-access-card">
                <h3>{mode.title}</h3>
                <p>{mode.body}</p>
              </div>
            ))}
          </div>
          <div className="product-sidebar-list">
            <div>
              <strong>Start with docs</strong>
              <span>Use quickstart first, then go deeper only when you need integrations or hosted workflows.</span>
            </div>
            <div>
              <strong>Use onboarding for hosted config</strong>
              <span>Workspace onboarding issues the credentials and MCP config if you want the hosted path.</span>
            </div>
            <div>
              <strong>Keep launch scope tight</strong>
              <span>Launch certification stays anchored on Claude MCP and OpenClaw. Codex, CLI, and API use the same runtime contract without widening the launch channel boundary.</span>
            </div>
          </div>
        </article>
      </section>

      <section className="product-section">
        <div className="product-section-head">
          <p>Install Paths</p>
          <h2>Pick the setup path that matches your workflow.</h2>
        </div>
        {bootstrapBundle?.bootstrap?.apiKey?.keyId ? (
          <div className="product-inline-note good">
            Workspace bootstrap {bootstrapBundle.bootstrap.apiKey.keyId} is active.
            {smokeBundle?.smoke?.initialized ? ` Smoke test passed with ${smokeBundle.smoke.toolsCount ?? 0} tools.` : ""}
          </div>
        ) : (
          <div className="product-inline-note warn">
            If you want ready-to-use credentials, complete <a href="/onboarding">Workspace Onboarding</a>. Otherwise start with quickstart and install locally.
          </div>
        )}
        <InstallTabs runtime={runtime} onboardingState={onboardingState} agentId={agentId} showResolvedConfig={true} />
      </section>

      <section className="product-home-callout">
        <div>
          <p className="product-kicker">Next</p>
          <h2>Start with the launch channels, then deepen the integration without widening scope.</h2>
        </div>
        <div className="product-home-links">
          <a href={docsLinks.quickstart}>Quickstart</a>
          <a href="/onboarding">Workspace onboarding</a>
          <a href="/wallet">Wallet</a>
          <a href="/receipts">Receipts</a>
          <a href={ossLinks.repo}>GitHub</a>
        </div>
      </section>
    </div>
  );
}

const LEGACY_PROTOTYPE_COMPONENTS = Object.freeze({
  network: NetworkPage,
  studio: StudioPage,
  agents: AgentsPage,
  agentProfile: AgentProfilePage
});

export default function ProductShell({ mode = "home", runId = null, requestedPath = null }) {
  const [runtime, setRuntime] = useState(() => loadRuntimeConfig());
  const [lastLaunchId, setLastLaunchId] = useState(() => readStoredValue(LAST_LAUNCH_STORAGE_KEY));
  const [lastAgentId, setLastAgentId] = useState(() => readStoredValue(LAST_AGENT_STORAGE_KEY));
  const [inboxSummary, setInboxSummary] = useState(() => ({ ...EMPTY_INBOX_SUMMARY }));
  const [inboxReadStateVersion, setInboxReadStateVersion] = useState(0);
  const [onboardingState, setOnboardingState] = useState(() =>
    normalizeOnboardingState(readStoredJson(PRODUCT_ONBOARDING_STORAGE_KEY, EMPTY_ONBOARDING_STATE))
  );

  useEffect(() => {
    writeStoredValue(LAST_LAUNCH_STORAGE_KEY, lastLaunchId);
  }, [lastLaunchId]);

  useEffect(() => {
    writeStoredValue(LAST_AGENT_STORAGE_KEY, lastAgentId);
  }, [lastAgentId]);

  useEffect(() => {
    try {
      localStorage.setItem(PRODUCT_RUNTIME_STORAGE_KEY, JSON.stringify(runtime));
    } catch {
      // ignore
    }
  }, [runtime]);

  useEffect(() => {
    try {
      localStorage.setItem(PRODUCT_ONBOARDING_STORAGE_KEY, JSON.stringify(onboardingState));
    } catch {
      // ignore
    }
  }, [onboardingState]);

  useEffect(() => {
    function syncInboxReadState(event) {
      if (event?.type === "storage" && event?.key && event.key !== PRODUCT_INBOX_READ_STATE_STORAGE_KEY) return;
      setInboxReadStateVersion((previous) => previous + 1);
    }
    window.addEventListener("storage", syncInboxReadState);
    window.addEventListener(PRODUCT_INBOX_READ_STATE_EVENT, syncInboxReadState);
    return () => {
      window.removeEventListener("storage", syncInboxReadState);
      window.removeEventListener(PRODUCT_INBOX_READ_STATE_EVENT, syncInboxReadState);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncRemoteInboxReadState() {
      if (!String(runtime?.tenantId ?? "").trim() || !onboardingState?.buyer) return;
      try {
        const out = await fetchTenantConsumerInboxState(runtime);
        if (cancelled) return;
        const remoteState = normalizeInboxReadState(out?.state);
        const localState = readInboxReadState();
        const mergedState = mergeInboxReadStates(localState, remoteState);
        if (!inboxReadStatesEqual(localState, mergedState)) {
          writeInboxReadState(mergedState);
        }
        if (!inboxReadStatesEqual(remoteState, mergedState)) {
          await updateTenantConsumerInboxState(runtime, mergedState).catch(() => null);
        }
      } catch {
        // ignore remote inbox sync failures; local read state remains the fallback
      }
    }

    void syncRemoteInboxReadState();
    return () => {
      cancelled = true;
    };
  }, [onboardingState?.buyer, runtime]);

  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    async function loadInboxSummary() {
      if (!String(runtime?.apiKey ?? "").trim()) {
        if (!cancelled) setInboxSummary({ ...EMPTY_INBOX_SUMMARY });
        return;
      }
      try {
        const [pendingOut, disputeOut, receiptsOut, launchOut] = await Promise.all([
          fetchApprovalInbox(runtime, { status: "pending" }).catch(() => null),
          fetchDisputeInbox(runtime, { disputeStatus: "open", limit: 100, offset: 0 }).catch(() => null),
          fetchWorkOrderReceipts(runtime, { limit: 12, offset: 0 }).catch(() => null),
          lastLaunchId ? fetchRouterLaunchStatus(runtime, lastLaunchId).catch(() => null) : Promise.resolve(null)
        ]);
        if (cancelled) return;
        const pendingItems = extractList(pendingOut, ["items", "results", "approvalInbox", "approvalRequests", "requests"])
          .map((row) => normalizeApprovalInboxItem(row, "pending"))
          .filter((row) => row.requestId);
        const openDisputes = extractList(disputeOut, ["items", "results"])
          .map((row) => normalizeDisputeInboxRecord(row))
          .filter((row) => row.disputeId && row.disputeStatus === "open");
        const recentReceipts = extractList(receiptsOut, ["receipts", "items", "results"])
          .map((row) => normalizeReceiptRecord(row))
          .filter((row) => row.receiptId);
        const normalizedLaunchStatus = launchOut?.status ? normalizeLaunchStatusRecord(launchOut.status) : null;
        const launchAttentionCount = normalizedLaunchStatus?.tasks?.filter((task) => isLaunchTaskActionRequired(task)).length ?? 0;
        const activeLaunchTaskCount = normalizedLaunchStatus?.tasks?.filter((task) => isLaunchTaskActive(task)).length ?? 0;
        const actionItems = buildInboxActionItems({
          pendingItems,
          openDisputes,
          launchStatus: normalizedLaunchStatus
        });
        const receiptItems = buildInboxReceiptItems(recentReceipts);
        const inboxReadState = readInboxReadState();
        const unreadCount = countUnreadInboxItems(actionItems, inboxReadState) + countUnreadInboxItems(receiptItems, inboxReadState);
        setInboxSummary({
          pendingApprovalCount: pendingItems.length,
          openDisputeCount: openDisputes.length,
          launchAttentionCount,
          activeLaunchTaskCount,
          recentReceiptCount: recentReceipts.length,
          unreadCount,
          actionRequiredCount: actionItems.length
        });
      } catch {
        if (!cancelled) setInboxSummary({ ...EMPTY_INBOX_SUMMARY });
      }
    }

    void loadInboxSummary();
    timerId = window.setInterval(() => {
      void loadInboxSummary();
    }, 30000);

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearInterval(timerId);
    };
  }, [inboxReadStateVersion, lastLaunchId, runtime]);

  const debugMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "1";
  const hasManagedRuntime = Boolean(onboardingState?.buyer) || Boolean(String(runtime?.apiKey ?? "").trim());
  const showRuntimeBar =
    (
      mode === "inbox" ||
      mode === "approvals" ||
      mode === "wallet" ||
      mode === "integrations" ||
      mode === "receipts" ||
      mode === "disputes" ||
      mode === "run"
    ) &&
    debugMode;
  const inboxBadgeCount = inboxSummary.unreadCount > 0 ? inboxSummary.unreadCount : inboxSummary.actionRequiredCount;
  const inboxBadgeLabel =
    inboxSummary.unreadCount > 0
      ? `${inboxBadgeCount} unread inbox item${inboxBadgeCount === 1 ? "" : "s"}`
      : `${inboxBadgeCount} inbox item${inboxBadgeCount === 1 ? "" : "s"} need attention`;

  let page = <HomePage lastAgentId={lastAgentId} onboardingState={onboardingState} />;
  if (mode === "onboarding") {
    page = (
      <OnboardingPage
        runtime={runtime}
        setRuntime={setRuntime}
        onboardingState={onboardingState}
        setOnboardingState={setOnboardingState}
      />
    );
  } else if (mode === "inbox") {
    page = <InboxPage runtime={runtime} onboardingState={onboardingState} lastLaunchId={lastLaunchId} />;
  } else if (mode === "approvals") {
    page = <ApprovalsPage runtime={runtime} onboardingState={onboardingState} />;
  } else if (mode === "wallet") {
    page = <WalletPage runtime={runtime} onboardingState={onboardingState} lastLaunchId={lastLaunchId} lastAgentId={lastAgentId} surface="wallet" />;
  } else if (mode === "integrations") {
    page = <WalletPage runtime={runtime} onboardingState={onboardingState} lastLaunchId={lastLaunchId} lastAgentId={lastAgentId} surface="integrations" />;
  } else if (mode === "receipts") {
    page = <ReceiptsPage runtime={runtime} onboardingState={onboardingState} lastLaunchId={lastLaunchId} />;
  } else if (mode === "disputes") {
    page = <DisputesPage runtime={runtime} onboardingState={onboardingState} lastLaunchId={lastLaunchId} />;
  } else if (mode === "run") {
    page = <RunDetailPage runtime={runtime} onboardingState={onboardingState} runId={runId} />;
  } else if (mode === "legacy") {
    page = <LaunchScopePage requestedPath={requestedPath} onboardingState={onboardingState} />;
  } else if (mode === "developers") {
    page = <DeveloperPage runtime={runtime} onboardingState={onboardingState} lastAgentId={lastAgentId} />;
  }

  return (
    <div className="product-root">
      <div className="product-orb product-orb-a" aria-hidden="true" />
      <div className="product-orb product-orb-b" aria-hidden="true" />
      <div className="product-gridwash" aria-hidden="true" />

      <header className="product-nav-shell">
        <nav className="product-nav" aria-label="Primary">
          <a className="product-brand" href="/">
            <span className="product-brand-mark"><ShieldCheck size={16} /></span>
            <span>
              <strong>Nooterra</strong>
              <small>Agent Control Layer</small>
            </span>
          </a>
          <div className="product-nav-links">
            <a className={linkToneForMode(mode, "/")} href="/">Overview</a>
            {hasManagedRuntime ? (
              <a className={linkToneForMode(mode, "/inbox")} href="/inbox">
                <span className="product-nav-link-label">Inbox</span>
                {inboxBadgeCount > 0 ? (
                  <span className="product-nav-notice" aria-label={inboxBadgeLabel}>
                    {inboxBadgeCount > 9 ? "9+" : inboxBadgeCount}
                  </span>
                ) : null}
              </a>
            ) : null}
            {hasManagedRuntime ? <a className={linkToneForMode(mode, "/approvals")} href="/approvals">Approvals</a> : null}
            {hasManagedRuntime ? <a className={linkToneForMode(mode, "/wallet")} href="/wallet">Wallet</a> : null}
            {hasManagedRuntime ? <a className={linkToneForMode(mode, "/integrations")} href="/integrations">Integrations</a> : null}
            {hasManagedRuntime ? <a className={linkToneForMode(mode, "/receipts")} href="/receipts">Receipts</a> : null}
            {hasManagedRuntime ? <a className={linkToneForMode(mode, "/disputes")} href="/disputes">Disputes</a> : null}
            <a className={linkToneForMode(mode, "/developers")} href="/developers">Developers</a>
            <a href={docsLinks.home}>Docs</a>
          </div>
          <div className="product-nav-actions">
            <a className="product-button product-button-ghost" href={ossLinks.repo}>GitHub</a>
            <a className="product-button product-button-solid" href={onboardingState?.buyer ? "/approvals" : "/onboarding"}>
              {onboardingState?.buyer ? "Open Action Wallet" : "Get started"}
            </a>
          </div>
        </nav>
      </header>

      <main className="product-main">
        {showRuntimeBar ? <RuntimeBar config={runtime} setConfig={setRuntime} onboardingState={onboardingState} /> : null}
        {page}
      </main>

      <footer className="product-footer">
        <div>
          <strong>Nooterra</strong>
          <span>Approvals, scoped authority, receipts, disputes, and recourse for AI actions that matter.</span>
        </div>
        <div className="product-footer-links">
          <a href={docsLinks.quickstart}>Quickstart</a>
          <a href="/approvals">Approvals</a>
          <a href="/developers">Developers</a>
          <a href="/receipts">Receipts</a>
          <a href={docsLinks.home}>Docs</a>
        </div>
      </footer>
    </div>
  );
}
