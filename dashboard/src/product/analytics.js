/**
 * Product analytics — PostHog integration.
 *
 * Usage:
 *   import { track, identify, page } from "./analytics.js";
 *   track("worker.created", { model: "gemini-2.5-flash", template: "support" });
 *   identify(tenantId, { plan: "growth", workerCount: 5 });
 *   page("dashboard");
 */

const DEBUG = typeof import.meta !== "undefined"
  ? import.meta.env?.DEV === true
  : false;

let _posthog = null;

/**
 * Initialize PostHog. Call once at app startup.
 * If the key is missing, analytics silently no-ops.
 */
export function initAnalytics() {
  const apiKey = typeof import.meta !== "undefined"
    ? import.meta.env?.VITE_POSTHOG_KEY
    : null;
  const apiHost = typeof import.meta !== "undefined"
    ? import.meta.env?.VITE_POSTHOG_HOST || "https://us.i.posthog.com"
    : "https://us.i.posthog.com";

  if (!apiKey) {
    if (DEBUG) console.log("[analytics] no VITE_POSTHOG_KEY — running in stub mode");
    return;
  }

  import("posthog-js").then(({ default: posthog }) => {
    posthog.init(apiKey, {
      api_host: apiHost,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: true,
      persistence: "localStorage+cookie"
    });
    _posthog = posthog;
    if (DEBUG) console.log("[analytics] PostHog initialized");
  }).catch((err) => {
    if (DEBUG) console.warn("[analytics] PostHog load failed:", err);
  });
}

export function track(event, properties = {}) {
  if (DEBUG) console.log("[analytics]", event, properties);
  _posthog?.capture(event, { ...properties, timestamp: new Date().toISOString() });
}

export function identify(userId, traits = {}) {
  if (DEBUG) console.log("[analytics:identify]", userId, traits);
  _posthog?.identify(userId, traits);
}

export function page(name, properties = {}) {
  if (DEBUG) console.log("[analytics:page]", name, properties);
  _posthog?.capture("$pageview", { $current_url: name, ...properties });
}

export function reset() {
  _posthog?.reset();
}
