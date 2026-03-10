import { generateKeyPairSync } from "node:crypto";

import {
  deriveStarterWorkerDraft,
  starterWorkerProfiles,
  starterWorkerSetPresets
} from "../../src/product/starter-worker-catalog.js";
import {
  buildStarterProviderManifest,
  deriveStarterProviderDraft,
  mintStarterProviderPublishProof,
  resolvePublishProofKeyMaterial
} from "../../src/product/starter-provider-catalog.js";

function readArg(name) {
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === name) return argv[index + 1] ?? null;
    if (value.startsWith(`${name}=`)) return value.slice(name.length + 1);
  }
  return null;
}

function parseRepeatedArg(name) {
  const out = [];
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === name) {
      if (argv[index + 1]) out.push(argv[index + 1]);
      continue;
    }
    if (value.startsWith(`${name}=`)) out.push(value.slice(name.length + 1));
  }
  return out.flatMap((value) => String(value).split(",")).map((value) => value.trim()).filter(Boolean);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`${name} is required`);
  }
  return String(value).trim();
}

function buildHeaders({ tenantId, apiKey, idempotencyKey = null } = {}) {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    "x-proxy-tenant-id": tenantId,
    "x-nooterra-protocol": "1.0"
  };
  if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
  return headers;
}

async function requestJson(baseUrl, pathname, { method = "GET", headers, body = null } = {}) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${pathname}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const error = new Error(
      parsed && typeof parsed === "object"
        ? String(parsed.message ?? parsed.error ?? `HTTP ${response.status}`)
        : String(parsed ?? `HTTP ${response.status}`)
    );
    error.status = response.status;
    error.code = parsed && typeof parsed === "object" ? parsed.code ?? null : null;
    error.details = parsed && typeof parsed === "object" ? parsed.details ?? null : null;
    throw error;
  }
  return parsed;
}

function readAbsoluteUrl(value, name) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

function generatePublicKeyPem() {
  const { publicKey } = generateKeyPairSync("ed25519");
  return publicKey.export({ type: "spki", format: "pem" }).toString();
}

function resolveProfiles() {
  const profileMap = new Map(starterWorkerProfiles.map((profile) => [profile.id, profile]));
  const requestedProfileIds = parseRepeatedArg("--profile");
  const requestedSetId = readArg("--profile-set") ?? "launch_supply";

  if (requestedProfileIds.length > 0) {
    return requestedProfileIds.map((profileId) => {
      const profile = profileMap.get(profileId);
      if (!profile) throw new Error(`unknown starter profile: ${profileId}`);
      return profile;
    });
  }

  const preset = starterWorkerSetPresets.find((entry) => entry.id === requestedSetId);
  if (!preset) throw new Error(`unknown starter profile set: ${requestedSetId}`);
  return preset.profileIds.map((profileId) => profileMap.get(profileId));
}

async function main() {
  const baseUrl = requireEnv("NOOTERRA_BASE_URL");
  const apiKey = requireEnv("NOOTERRA_API_KEY");
  const tenantId = requireEnv("NOOTERRA_TENANT_ID");
  const endpointBaseUrl = String(process.env.NOOTERRA_STARTER_ENDPOINT_BASE_URL ?? readArg("--endpoint-base") ?? "").trim();
  const includeProviders = process.argv.includes("--include-providers") || String(process.env.NOOTERRA_INCLUDE_STARTER_PROVIDERS ?? "").trim() === "1";
  const providerBaseUrl = readAbsoluteUrl(
    process.env.NOOTERRA_STARTER_PROVIDER_BASE_URL ?? readArg("--provider-base") ?? endpointBaseUrl,
    "provider base URL"
  );
  const publishProofJwksUrl = readAbsoluteUrl(
    process.env.NOOTERRA_PROVIDER_PUBLISH_PROOF_JWKS_URL ?? readArg("--publish-proof-jwks-url") ?? "",
    "publish proof JWKS URL"
  );
  const providerContactUrl = readAbsoluteUrl(process.env.NOOTERRA_STARTER_PROVIDER_CONTACT_URL ?? readArg("--contact-url") ?? "", "contact URL");
  const providerTermsUrl = readAbsoluteUrl(process.env.NOOTERRA_STARTER_PROVIDER_TERMS_URL ?? readArg("--terms-url") ?? "", "terms URL");
  const publishProofKeyMaterial = includeProviders
    ? resolvePublishProofKeyMaterial({
        privateKeyPem: process.env.NOOTERRA_PROVIDER_PUBLISH_PROOF_KEY_PEM ?? readArg("--publish-proof-key-pem") ?? null,
        privateKeyFile: process.env.NOOTERRA_PROVIDER_PUBLISH_PROOF_KEY_FILE ?? readArg("--publish-proof-key-file") ?? null
      })
    : null;
  const dryRun = process.argv.includes("--dry-run");
  const profiles = resolveProfiles();

  if (dryRun) {
    const plannedResults = profiles.map((profile) => {
      const draft = deriveStarterWorkerDraft(profile, { tenantId, endpointBaseUrl });
      const providerDraft = includeProviders ? deriveStarterProviderDraft(profile, { tenantId, baseUrl: providerBaseUrl }) : null;
      const providerManifest =
        includeProviders && providerDraft && publishProofJwksUrl
          ? buildStarterProviderManifest({
              profile,
              providerDraft,
              publishProofJwksUrl,
              contactUrl: providerContactUrl || null,
              termsUrl: providerTermsUrl || null
            })
          : null;
      return {
        profileId: profile.id,
        agentId: draft.agentId,
        endpoint: draft.endpoint || null,
        capabilities: draft.capabilities,
        tags: draft.tags,
        metadata: draft.metadata ?? null,
        provider: providerDraft
          ? {
              providerId: providerDraft.providerId,
              baseUrl: providerDraft.baseUrl || null,
              toolId: providerDraft.toolId,
              executionAdapterSummary: providerDraft.executionAdapterSummary || null,
              manifest: providerManifest
            }
          : null
      };
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: "StarterWorkerSeedResult.v1",
          tenantId,
          baseUrl,
          dryRun: true,
          seededCount: plannedResults.length,
          results: plannedResults
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const results = [];
  for (const profile of profiles) {
    const draft = deriveStarterWorkerDraft(profile, { tenantId, endpointBaseUrl });
    const result = {
      profileId: profile.id,
      agentId: draft.agentId,
      registerStatus: "pending",
      publishStatus: "pending"
    };

    try {
      await requestJson(baseUrl, "/agents/register", {
        method: "POST",
        headers: buildHeaders({ tenantId, apiKey, idempotencyKey: `starter_register_${draft.agentId}` }),
        body: {
          agentId: draft.agentId,
          displayName: draft.displayName,
          description: draft.description,
          owner: {
            ownerType: draft.ownerType,
            ownerId: draft.ownerId
          },
          publicKeyPem: generatePublicKeyPem(),
          capabilities: draft.capabilities
        }
      });
      result.registerStatus = "created";
    } catch (error) {
      if (error.status === 409) {
        result.registerStatus = "exists";
      } else {
        throw error;
      }
    }

    await requestJson(baseUrl, "/agent-cards", {
      method: "POST",
      headers: buildHeaders({ tenantId, apiKey, idempotencyKey: `starter_card_${draft.agentId}` }),
      body: {
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
          amountCents: Number(draft.priceAmountCents),
          currency: draft.priceCurrency,
          unit: draft.priceUnit
        },
        tags: draft.tags,
        metadata: draft.metadata
      }
    });
    result.publishStatus = "published";
    result.metadata = draft.metadata ?? null;

    if (includeProviders) {
      if (!providerBaseUrl) throw new Error("provider base URL is required when --include-providers is used");
      if (!publishProofJwksUrl) throw new Error("publish proof JWKS URL is required when --include-providers is used");
      if (!publishProofKeyMaterial) throw new Error("publish proof key material is required when --include-providers is used");
      const providerDraft = deriveStarterProviderDraft(profile, { tenantId, baseUrl: providerBaseUrl });
      const manifest = buildStarterProviderManifest({
        profile,
        providerDraft,
        publishProofJwksUrl,
        contactUrl: providerContactUrl || null,
        termsUrl: providerTermsUrl || null
      });
      const publishProof = mintStarterProviderPublishProof({
        manifest,
        providerId: providerDraft.providerId,
        privateKeyPem: publishProofKeyMaterial.privateKeyPem,
        publicKeyPem: publishProofKeyMaterial.publicKeyPem,
        keyId: publishProofKeyMaterial.keyId
      }).token;
      const publication = await requestJson(baseUrl, "/marketplace/providers/publish", {
        method: "POST",
        headers: buildHeaders({ tenantId, apiKey, idempotencyKey: `starter_provider_${providerDraft.providerId}` }),
        body: {
          providerId: providerDraft.providerId,
          baseUrl: providerDraft.baseUrl,
          manifest,
          publishProof,
          publishProofJwksUrl,
          description: providerDraft.description,
          tags: String(providerDraft.tags ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          contactUrl: providerContactUrl || null,
          termsUrl: providerTermsUrl || null
        }
      });
      result.provider = {
        providerId: providerDraft.providerId,
        toolId: providerDraft.toolId,
        status: publication?.publication?.status ?? null,
        certified: publication?.publication?.certified === true,
        providerRef: publication?.publication?.providerRef ?? null,
        manifestHash: publication?.publication?.manifestHash ?? null
      };
    }
    results.push(result);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "StarterWorkerSeedResult.v1",
        tenantId,
        baseUrl,
        seededCount: results.length,
        results
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
