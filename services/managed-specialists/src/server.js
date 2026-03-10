import fs from "node:fs";
import http from "node:http";
import { createPublicKey } from "node:crypto";

import {
  createNooterraAuthDelegatedSessionRuntimeResolver,
  createNooterraPaidNodeHttpHandler,
  createPlaywrightDelegatedAccountRuntime
} from "../../../packages/provider-kit/src/index.js";
import { keyIdFromPublicKeyPem } from "../../../src/core/crypto.js";
import { buildNooterraPayKeysetV1 } from "../../../src/core/nooterra-keys.js";
import { starterWorkerProfiles } from "../../../src/product/starter-worker-catalog.js";
import {
  buildStarterProviderManifest,
  deriveStarterProviderDraft,
  resolvePublishProofKeyMaterial
} from "../../../src/product/starter-provider-catalog.js";
import { buildTaskWalletSpendPlanV1 } from "../../../src/core/task-wallet-spend-plan.js";

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function readPem({ inlineName, fileName }) {
  const inlineRaw = process.env[inlineName];
  if (typeof inlineRaw === "string" && inlineRaw.trim() !== "") {
    return inlineRaw.replaceAll("\\n", "\n");
  }
  const fileRaw = process.env[fileName];
  if (typeof fileRaw === "string" && fileRaw.trim() !== "") {
    return fs.readFileSync(fileRaw.trim(), "utf8");
  }
  throw new Error(`Missing ${inlineName} or ${fileName}`);
}

function toAbsoluteBaseUrl(value, { port, host = "127.0.0.1" } = {}) {
  const raw = String(value ?? "").trim();
  if (raw) {
    const parsed = new URL(raw);
    return parsed.toString().replace(/\/+$/, "");
  }
  return `http://${host}:${port}`;
}

function normalizeProfileIds(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return ["purchase_runner", "booking_concierge", "account_admin"];
  return Array.from(new Set(raw.split(",").map((entry) => entry.trim()).filter(Boolean)));
}

function selectProfiles(profileIds) {
  const profileMap = new Map(starterWorkerProfiles.map((profile) => [profile.id, profile]));
  return profileIds.map((profileId) => {
    const profile = profileMap.get(profileId);
    if (!profile) throw new Error(`Unknown managed specialist profile: ${profileId}`);
    return profile;
  });
}

function summarizeDelegatedAccountSession(binding) {
  if (!binding || typeof binding !== "object") return null;
  return {
    sessionId: binding.sessionId ?? null,
    sessionRef: binding.sessionRef ?? null,
    providerKey: binding.providerKey ?? null,
    siteKey: binding.siteKey ?? null,
    mode: binding.mode ?? null,
    accountHandleMasked: binding.accountHandleMasked ?? null,
    maxSpendCents: Number.isSafeInteger(Number(binding.maxSpendCents)) ? Number(binding.maxSpendCents) : null,
    currency: typeof binding.currency === "string" ? binding.currency : null
  };
}

function summarizeDelegatedRuntime(runtime) {
  if (!runtime || typeof runtime !== "object") return null;
  return {
    kind: runtime.kind ?? null,
    allowedDomains: Array.isArray(runtime.config?.allowedDomains) ? runtime.config.allowedDomains : [],
    loginOrigin: runtime.config?.loginOrigin ?? null,
    startUrl: runtime.config?.startUrl ?? null,
    storageStateRef: runtime.config?.storageStateRef ?? null
  };
}

function summarizeTaskWallet(taskWallet) {
  if (!taskWallet || typeof taskWallet !== "object") return null;
  return {
    walletId: taskWallet.walletId ?? null,
    categoryId: taskWallet.categoryId ?? null,
    reviewMode: taskWallet.reviewMode ?? null,
    maxSpendCents: Number.isSafeInteger(Number(taskWallet.maxSpendCents)) ? Number(taskWallet.maxSpendCents) : null,
    currency: typeof taskWallet.currency === "string" ? taskWallet.currency : null,
    allowedMerchantScopes: Array.isArray(taskWallet.allowedMerchantScopes) ? taskWallet.allowedMerchantScopes : [],
    allowedSpecialistProfileIds: Array.isArray(taskWallet.allowedSpecialistProfileIds) ? taskWallet.allowedSpecialistProfileIds : [],
    allowedProviderIds: Array.isArray(taskWallet.allowedProviderIds) ? taskWallet.allowedProviderIds : []
  };
}

function enforceTaskWalletForManagedSpecialist({ taskWallet, profile, providerDraft } = {}) {
  if (!taskWallet || typeof taskWallet !== "object") {
    const err = new Error("task wallet binding is required for managed specialist execution");
    err.code = "TASK_WALLET_REQUIRED";
    throw err;
  }
  const specialistProfileId = String(profile?.id ?? "").trim();
  const providerId = String(providerDraft?.providerId ?? "").trim();
  const executionAdapter = providerDraft?.phase1ManagedMetadata?.executionAdapter ?? null;
  const amountCents = Number(providerDraft?.amountCents ?? 0);
  if (
    Array.isArray(taskWallet.allowedSpecialistProfileIds) &&
    taskWallet.allowedSpecialistProfileIds.length > 0 &&
    !taskWallet.allowedSpecialistProfileIds.includes(specialistProfileId)
  ) {
    const err = new Error("task wallet does not authorize this managed specialist");
    err.code = "TASK_WALLET_SPECIALIST_BLOCKED";
    throw err;
  }
  if (Array.isArray(taskWallet.allowedProviderIds) && taskWallet.allowedProviderIds.length > 0 && !taskWallet.allowedProviderIds.includes(providerId)) {
    const err = new Error("task wallet does not authorize this managed provider");
    err.code = "TASK_WALLET_PROVIDER_BLOCKED";
    throw err;
  }
  if (
    executionAdapter?.merchantScope &&
    Array.isArray(taskWallet.allowedMerchantScopes) &&
    taskWallet.allowedMerchantScopes.length > 0 &&
    !taskWallet.allowedMerchantScopes.includes(String(executionAdapter.merchantScope).trim())
  ) {
    const err = new Error("task wallet does not authorize the merchant scope required by this specialist");
    err.code = "TASK_WALLET_SCOPE_BLOCKED";
    throw err;
  }
  if (Number.isSafeInteger(Number(taskWallet.maxSpendCents)) && Number(taskWallet.maxSpendCents) > 0 && Number.isSafeInteger(amountCents) && amountCents > Number(taskWallet.maxSpendCents)) {
    const err = new Error("task wallet spend cap is below the managed specialist price");
    err.code = "TASK_WALLET_SPEND_CAP_EXCEEDED";
    throw err;
  }
}

async function executeManagedSpecialist({
  profile,
  providerDraft,
  delegatedAccountSession,
  delegatedAccountRuntime,
  taskWallet,
  browserProbeEnabled
} = {}) {
  const phase1ManagedNetwork = providerDraft?.phase1ManagedMetadata ?? null;
  enforceTaskWalletForManagedSpecialist({ taskWallet, profile, providerDraft });
  const baseBody = {
    ok: true,
    schemaVersion: "ManagedSpecialistExecution.v1",
    profileId: profile?.id ?? null,
    displayName: profile?.displayName ?? null,
    providerId: providerDraft?.providerId ?? null,
    toolId: providerDraft?.toolId ?? null,
    managedSpecialist: true,
    executionAdapter: phase1ManagedNetwork?.executionAdapter ?? null,
    taskWallet: summarizeTaskWallet(taskWallet),
    taskWalletSpendPlan: buildTaskWalletSpendPlanV1(taskWallet),
    delegatedAccountSession: summarizeDelegatedAccountSession(delegatedAccountSession),
    delegatedRuntime: summarizeDelegatedRuntime(delegatedAccountRuntime)
  };

  if (!delegatedAccountRuntime || browserProbeEnabled !== true) {
    return {
      body: {
        ...baseBody,
        executionMode: delegatedAccountRuntime ? "delegated_session_bound" : "stateless_preview"
      }
    };
  }

  const probe = await delegatedAccountRuntime.withBrowserSession({
    expectedProviderKey: phase1ManagedNetwork?.executionAdapter?.merchantScope
      ? String(delegatedAccountSession?.providerKey ?? "")
      : null,
    expectedSiteKey: delegatedAccountSession?.siteKey ?? null,
    allowedModes: Array.isArray(phase1ManagedNetwork?.executionAdapter?.supportedSessionModes)
      ? phase1ManagedNetwork.executionAdapter.supportedSessionModes
      : ["browser_delegated", "approval_at_boundary", "operator_supervised"],
    action: async ({ page }) => ({
      currentUrl: typeof page?.url === "function" ? page.url() : null,
      title: page && typeof page.title === "function" ? await page.title().catch(() => null) : null
    })
  });

  return {
    body: {
      ...baseBody,
      executionMode: "browser_probe",
      browserProbe: probe
    }
  };
}

function buildManagedSpecialistCatalog({
  tenantId,
  baseUrl,
  publishProofJwksUrl,
  profiles
} = {}) {
  return {
    schemaVersion: "ManagedSpecialistCatalog.v1",
    tenantId,
    baseUrl,
    specialists: profiles.map((profile) => {
      const providerDraft = deriveStarterProviderDraft(profile, { tenantId, baseUrl });
      const manifest = buildStarterProviderManifest({
        profile,
        providerDraft,
        publishProofJwksUrl
      });
      return {
        profileId: profile.id,
        displayName: profile.displayName,
        providerId: providerDraft.providerId,
        toolId: providerDraft.toolId,
        paidPath: providerDraft.paidPath,
        providerDraft,
        manifest
      };
    })
  };
}

export function createManagedSpecialistServer({
  port = 9781,
  host = "127.0.0.1",
  tenantId = "tenant_default",
  publicBaseUrl = null,
  profiles = selectProfiles(["purchase_runner", "booking_concierge", "account_admin"]),
  providerPublicKeyPem,
  providerPrivateKeyPem,
  publishProofPublicKeyPem,
  payKeysetUrl = "http://127.0.0.1:3000/.well-known/nooterra-keys.json",
  authBaseUrl = null,
  opsToken = null,
  browserProbeEnabled = false
} = {}) {
  const normalizedPort = Number(port);
  if (!Number.isSafeInteger(normalizedPort) || normalizedPort <= 0) throw new TypeError("port must be a positive integer");
  const normalizedHost = assertNonEmptyString(host, "host");
  const providerPublic = assertNonEmptyString(providerPublicKeyPem, "providerPublicKeyPem");
  const providerPrivate = assertNonEmptyString(providerPrivateKeyPem, "providerPrivateKeyPem");
  const providerKeyId = keyIdFromPublicKeyPem(providerPublic);
  const normalizedPublicBaseUrl = toAbsoluteBaseUrl(publicBaseUrl, { port: normalizedPort, host: normalizedHost });
  const normalizedPublishProofPublicKeyPem = assertNonEmptyString(publishProofPublicKeyPem, "publishProofPublicKeyPem");
  const publishProofKeyId = keyIdFromPublicKeyPem(normalizedPublishProofPublicKeyPem);
  const publishProofJwks = buildNooterraPayKeysetV1({
    activeKey: {
      keyId: publishProofKeyId,
      publicKeyPem: normalizedPublishProofPublicKeyPem
    }
  });
  const publishProofJwksUrl = `${normalizedPublicBaseUrl}/.well-known/provider-publish-jwks.json`;
  const catalog = buildManagedSpecialistCatalog({
    tenantId,
    baseUrl: normalizedPublicBaseUrl,
    publishProofJwksUrl,
    profiles
  });

  const delegatedAccountRuntime =
    authBaseUrl && opsToken
      ? createPlaywrightDelegatedAccountRuntime({
          resolveSessionRuntime: createNooterraAuthDelegatedSessionRuntimeResolver({
            authBaseUrl,
            opsToken
          })
        })
      : null;

  const handlersByPath = new Map();
  for (const specialist of catalog.specialists) {
    const profile = profiles.find((entry) => entry.id === specialist.profileId);
    const paidHandler = createNooterraPaidNodeHttpHandler({
      providerId: specialist.providerId,
      providerPublicKeyPem: providerPublic,
      providerPrivateKeyPem: providerPrivate,
      paymentAddress: "nooterra:managed-specialist",
      paymentNetwork: "nooterra",
      nooterraPay: {
        keysetUrl: payKeysetUrl,
        requireTaskWallet: true,
        requireDelegatedAccountSession: Boolean(specialist.providerDraft?.phase1ManagedMetadata?.executionAdapter?.requiresDelegatedAccountSession),
        ...(delegatedAccountRuntime ? { delegatedAccountRuntime } : {})
      },
      priceFor: () => ({
        amountCents: Number(specialist.providerDraft?.amountCents ?? 500),
        currency: String(specialist.providerDraft?.currency ?? "USD").toUpperCase(),
        providerId: specialist.providerId,
        toolId: specialist.toolId
      }),
      execute: async ({ delegatedAccountSession, delegatedAccountRuntime: runtime, taskWallet }) =>
        executeManagedSpecialist({
          profile,
          providerDraft: specialist.providerDraft,
          delegatedAccountSession,
          delegatedAccountRuntime: runtime,
          taskWallet,
          browserProbeEnabled
        })
    });
    handlersByPath.set(specialist.paidPath, paidHandler);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", normalizedPublicBaseUrl);
    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "managed-specialists", specialistCount: catalog.specialists.length }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/nooterra/provider-key") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, algorithm: "ed25519", keyId: providerKeyId, publicKeyPem: providerPublic }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/.well-known/provider-publish-jwks.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" });
      res.end(JSON.stringify(publishProofJwks));
      return;
    }
    if (req.method === "GET" && url.pathname === "/.well-known/managed-specialists.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=30" });
      res.end(JSON.stringify(catalog));
      return;
    }
    const paidHandler = handlersByPath.get(url.pathname);
    if (paidHandler) {
      paidHandler(req, res).catch((err) => {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "managed_specialist_error", message: err?.message ?? String(err ?? "") }));
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

  return {
    server,
    catalog,
    providerKeyId,
    publishProofKeyId
  };
}

function loadRuntimeConfigFromEnv() {
  const port = Number(process.env.PORT ?? 9781);
  const host = String(process.env.HOST ?? "0.0.0.0").trim() || "0.0.0.0";
  const tenantId = String(process.env.NOOTERRA_TENANT_ID ?? "tenant_default").trim() || "tenant_default";
  const publicBaseUrl = process.env.NOOTERRA_MANAGED_SPECIALIST_PUBLIC_BASE_URL ?? null;
  const profileIds = normalizeProfileIds(process.env.NOOTERRA_MANAGED_SPECIALIST_PROFILES);
  const profiles = selectProfiles(profileIds);
  const providerPublicKeyPem = readPem({
    inlineName: "PROVIDER_PUBLIC_KEY_PEM",
    fileName: "PROVIDER_PUBLIC_KEY_PEM_FILE"
  });
  const providerPrivateKeyPem = readPem({
    inlineName: "PROVIDER_PRIVATE_KEY_PEM",
    fileName: "PROVIDER_PRIVATE_KEY_PEM_FILE"
  });
  const publishProofKeyMaterial = resolvePublishProofKeyMaterial({
    privateKeyPem: process.env.NOOTERRA_PROVIDER_PUBLISH_PROOF_KEY_PEM ?? null,
    privateKeyFile: process.env.NOOTERRA_PROVIDER_PUBLISH_PROOF_KEY_FILE ?? null
  });
  if (!publishProofKeyMaterial?.publicKeyPem) {
    throw new Error("NOOTERRA_PROVIDER_PUBLISH_PROOF_KEY_PEM or NOOTERRA_PROVIDER_PUBLISH_PROOF_KEY_FILE is required");
  }
  return {
    port,
    host,
    tenantId,
    publicBaseUrl,
    profiles,
    providerPublicKeyPem,
    providerPrivateKeyPem,
    publishProofPublicKeyPem: createPublicKey(publishProofKeyMaterial.privateKeyPem).export({ format: "pem", type: "spki" }).toString(),
    payKeysetUrl: assertNonEmptyString(process.env.NOOTERRA_PAY_KEYSET_URL ?? "", "NOOTERRA_PAY_KEYSET_URL"),
    authBaseUrl: String(process.env.NOOTERRA_AUTH_BASE_URL ?? "").trim() || null,
    opsToken: String(process.env.NOOTERRA_OPS_TOKEN ?? "").trim() || null,
    browserProbeEnabled: String(process.env.NOOTERRA_MANAGED_SPECIALIST_BROWSER_PROBE ?? "").trim() === "1"
  };
}

if (import.meta.url === new URL(process.argv[1], "file:").toString()) {
  const config = loadRuntimeConfigFromEnv();
  const { server, catalog } = createManagedSpecialistServer(config);
  server.listen(config.port, config.host, () => {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        service: "managed-specialists",
        port: config.port,
        host: config.host,
        specialistCount: catalog.specialists.length
      })}\n`
    );
  });
}
