import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import { z } from "zod";
import { pool, migrate } from "./db.js";
import { embed } from "./embeddings.js";
import { ensureCollection, upsertCapability, searchCapabilities, deleteByAgent, qdrant } from "./qdrant.js";
import { randomUUID } from "crypto";
import pino from "pino";
import { normalizeEndpoint, verifyACARD, ACARD } from "./acard.js";
import * as Sentry from "@sentry/node";
import { filterAndVerifyVcs, parseIssuerKeyMap } from "./services/vc.js";
import { recordReputationEvent, getReputation } from "./services/reputation.js";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import bs58 from "bs58";
import nacl from "tweetnacl";

dotenv.config();

const API_KEY = process.env.REGISTRY_API_KEY;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 60);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const SIM_WEIGHT = Number(process.env.SEARCH_WEIGHT_SIM || 0.7);
const REP_WEIGHT = Number(process.env.SEARCH_WEIGHT_REP || 0.25);
const AVAIL_WEIGHT = Number(process.env.SEARCH_WEIGHT_AVAIL || 0.2);
const HEARTBEAT_TTL_MS = Number(process.env.HEARTBEAT_TTL_MS || 60_000);
const MIN_REP_DISCOVER = Number(process.env.MIN_REP_DISCOVER || 0);
const REGION_ENUM = ["us-west", "us-east", "eu-west", "eu-central", "ap-south", "ap-northeast"] as const;
const VC_ISSUERS = (process.env.VC_ISSUERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const VC_ISSUER_KEY_MAP = parseIssuerKeyMap(process.env.VC_ISSUER_KEYS);
const REGISTRY_DID = process.env.REGISTRY_DID || "";
const REGISTRY_PRIVATE_KEY_B58 = process.env.REGISTRY_PRIVATE_KEY_B58 || "";

// =========================
// Sentry (env-gated)
// =========================
const SENTRY_DSN = process.env.SENTRY_DSN;
const SENTRY_ENV = process.env.SENTRY_ENV || process.env.NODE_ENV || "development";
const SENTRY_TRACES_SAMPLE_RATE = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0);
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENV,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    integrations: [],
  });
}
function captureError(err: unknown, context: Record<string, any> = {}) {
  if (!SENTRY_DSN) return;
  Sentry.captureException(err, {
    tags: { service: "registry" },
    extra: context,
  });
}

// =========================
// OpenTelemetry (env-gated)
// =========================
const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const OTEL_HEADERS_RAW = process.env.OTEL_EXPORTER_OTLP_HEADERS;
const OTEL_ENV = process.env.NODE_ENV || "development";
const OTEL_SERVICE_VERSION = process.env.npm_package_version || "0.1.0";
let telemetrySdk: NodeSDK | null = null;

function parseOtelHeaders(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const [k, v] = pair.split("=").map((s) => s.trim());
      if (k && v) acc[k] = v;
      return acc;
    }, {});
}

async function initOtel() {
  if (!OTEL_ENDPOINT) return;
  const traceExporter = new OTLPTraceExporter({
    url: OTEL_ENDPOINT,
    headers: parseOtelHeaders(OTEL_HEADERS_RAW),
  });
  telemetrySdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: "registry",
      [SemanticResourceAttributes.SERVICE_VERSION]: OTEL_SERVICE_VERSION,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: OTEL_ENV,
    }),
    traceExporter,
  });
  try {
    await telemetrySdk.start();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("OTel start failed", err);
  }
}

async function shutdownOtel() {
  if (!telemetrySdk) return;
  try {
    await telemetrySdk.shutdown();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("OTel shutdown failed", err);
  }
}

void initOtel();

function stableStringify(obj: any): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map((v) => stableStringify(v)).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function signVc(payload: any): any {
  if (!REGISTRY_DID || !REGISTRY_PRIVATE_KEY_B58) return null;
  try {
    const secretKey = bs58.decode(REGISTRY_PRIVATE_KEY_B58); // 64-byte ed25519 secret key
    const msg = Buffer.from(JSON.stringify(payload));
    const sig = nacl.sign.detached(new Uint8Array(msg), new Uint8Array(secretKey));
    return {
      ...payload,
      proof: {
        type: "Ed25519Signature2020",
        created: new Date().toISOString(),
        creator: REGISTRY_DID,
        signatureValue: Buffer.from(sig).toString("base64"),
      },
    };
  } catch {
    return null;
  }
}

async function bumpRegistryState() {
  await pool.query(`update registry_state set state_version = state_version + 1, updated_at = now() where id = 1`);
}

async function getRegistryStateVersion(): Promise<number> {
  const res = await pool.query(`select state_version from registry_state where id = 1`);
  return res.rows?.[0]?.state_version ?? 0;
}

function capabilityText(capabilityId: string, description?: string | null, outputSchema?: any, tags?: string[]) {
  const schemaStr =
    outputSchema && typeof outputSchema === "object" ? JSON.stringify(outputSchema) : String(outputSchema || "");
  const tagsStr = Array.isArray(tags) ? tags.join(" ") : "";
  return `${capabilityId} ${description || ""} ${schemaStr} ${tagsStr}`.trim();
}

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
});

const app = Fastify({
  logger,
  bodyLimit: 512 * 1024, // 512kb
});
await app.register(cors, { origin: process.env.CORS_ORIGIN || "*" });

await migrate();
await ensureCollection();

// request/trace id propagation
app.addHook("onRequest", async (request, reply) => {
  const rid =
    (request.headers["x-request-id"] as string | undefined) ||
    (request.headers["x-correlation-id"] as string | undefined) ||
    randomUUID();
  request.headers["x-request-id"] = rid;
  reply.header("x-request-id", rid);
  (request as any).startTime = Date.now();
});

app.addHook("onResponse", async (request, reply) => {
  const rid = (request.headers as any)["x-request-id"];
  const duration = (Date.now() - ((request as any).startTime || Date.now()));
  app.log.info({
    request_id: rid,
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    duration_ms: duration,
  });
  if (SENTRY_DSN) {
    Sentry.setContext("request", {
      request_id: rid,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration_ms: duration,
    });
  }
});

const capabilitySchema = z.object({
  capabilityId: z.string().optional(),
  capability_id: z.string().optional(),
  description: z.string().min(1).max(500),
  tags: z.array(z.string().max(64)).max(10).optional(),
  input_schema: z.any().optional(),
  output_schema: z.any().optional(),
  price_cents: z.number().int().positive().max(1_000_000).optional(),
  pricingCents: z.number().int().positive().max(1_000_000).optional(),
  priceCredits: z.number().min(0).max(1_000_000).optional(),
  price_model: z.string().max(64).optional(),
  safety_class: z.string().max(64).optional(),
  region: z.string().max(64).optional(),
  sla_hints: z.record(z.any()).optional(),
  certs: z.array(z.any()).optional(),
  tool_schema: z.any().optional(),
});

const acardCapabilitySchema = z.object({
  id: z.string(),
  description: z.string(),
  inputSchema: z.any().optional(),
  outputSchema: z.any().optional(),
  embeddingDim: z.number().optional().nullable(),
  pricingCents: z.number().int().positive().max(1_000_000).optional().nullable(),
  tags: z.array(z.string().max(64)).max(10).optional(),
  priceModel: z.string().max(64).optional(),
  safetyClass: z.string().max(64).optional(),
  region: z.string().max(64).optional(),
  slaHints: z.record(z.any()).optional(),
  certs: z.array(z.any()).optional(),
});

const profileSchema = z.object({
  profile: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  version: z.string().min(1),
  certified: z.boolean().optional(),
  certificationUrl: z.string().url().optional(),
});

const economicsSchema = z.object({
  acceptsEscrow: z.boolean(),
  minBidCents: z.number().int().nonnegative().optional(),
  maxBidCents: z.number().int().positive().optional(),
  supportedCurrencies: z.array(z.string()).optional(),
  settlementMethods: z
    .array(z.enum(["instant", "batched", "l2"]))
    .optional(),
});

const acardSchema = z.object({
  did: z.string(),
  endpoint: z.string(),
  publicKey: z.string(),
  version: z.number(),
  lineage: z.string().nullable().optional(),
  capabilities: z.array(acardCapabilitySchema).min(1),
  metadata: z.record(z.any()).nullable().optional(),
  profiles: z.array(profileSchema).max(10).optional(),
  economics: economicsSchema.optional(),
  a2aVersion: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  supportsStreaming: z.boolean().optional(),
  supportsPushNotifications: z.boolean().optional(),
  vcs: z.array(z.any()).optional(),
  did_method: z.string().optional(),
  pqc_public_key: z.string().optional(),
});

const federationPeerSchema = z.object({
  peerId: z.string().uuid(),
  endpoint: z.string().url(),
  region: z.enum(REGION_ENUM),
  publicKey: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
});

const federationSyncSchema = z.object({
  peerId: z.string().uuid().optional(),
});

const registerSchema = z.object({
  did: z.string(),
  name: z.string().optional(),
  endpoint: z.string().optional(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(), // Agent's wallet for receiving payments
  capabilities: z.array(capabilitySchema).min(1).max(25),
  acard: acardSchema.optional(),
  acard_signature: z.string().optional(),
});

const reputationSchema = z.object({
  did: z.string(),
  reputation: z.number().min(0).max(1),
});

const availabilitySchema = z.object({
  did: z.string(),
  availability: z.number().min(0).max(1),
  last_seen: z.string().datetime().optional(),
});

const reputationEventSchema = z.object({
  did: z.string(),
  outcome: z.enum(["success", "failure"]),
  latencyMs: z.number().int().positive().optional(),
  dispute: z.boolean().optional(),
});

const apiGuard = async (request: any, reply: any) => {
  // Enforce API key on write routes when set
  const method = request.method?.toUpperCase() || "";
  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  if (!API_KEY && !isWrite) return;
  if (isWrite) {
    const provided = request.headers["x-api-key"];
    // Allow playground key always, or match configured API key if set
    if (provided === "playground-free-tier") return;
    if (API_KEY && provided === API_KEY) return;
    if (!API_KEY) return; // no key configured -> allow writes
    return reply.status(401).send({ error: "Unauthorized" });
  }
};

const rateBucket = new Map<string, { count: number; resetAt: number }>();
const rateLimitGuard = async (request: any, reply: any) => {
  const ip =
    (request.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    request.ip ||
    "unknown";
  const now = Date.now();
  const bucket = rateBucket.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBucket.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    const retry = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));
    reply.header("Retry-After", retry);
    return reply.status(429).send({ error: "Rate limit exceeded", retryAfterSeconds: retry });
  }
  bucket.count += 1;
};

app.post("/v1/agent/register", { preHandler: [rateLimitGuard, apiGuard] }, async (request, reply) => {
  const parse = registerSchema.safeParse(request.body);
  if (!parse.success) {
    return reply
      .status(400)
      .send({ error: parse.error.flatten(), message: "Invalid register payload" });
  }
  const { did, name, endpoint, walletAddress, capabilities, acard, acard_signature } = parse.data;

  // Normalize capability ids and schemas
  const normalizedCaps = capabilities.map((cap) => {
    const priceCredits = (cap as any).priceCredits;
    let priceCents =
      (cap as any).price_cents ??
      (cap as any).pricingCents ??
      null;
    if (priceCents == null && priceCredits != null) {
      // 1 credit = $0.001 = 0.1 cents
      priceCents = Math.round(Number(priceCredits) * 0.1);
    }

    return {
      capabilityId: cap.capabilityId || (cap as any).capability_id || randomUUID(),
      description: cap.description,
      tags: cap.tags || [],
      input_schema: cap.input_schema,
      output_schema: cap.output_schema,
      tool_schema: (cap as any).tool_schema || (cap as any).toolSchema,
      price_cents: priceCents ?? undefined,
      price_model: (cap as any).price_model || undefined,
      safety_class: (cap as any).safety_class || undefined,
      region: (cap as any).region || undefined,
      sla_hints: (cap as any).sla_hints || undefined,
      certs: (cap as any).certs || undefined,
    };
  });

  // ACARD validation (optional but must verify if provided)
  let endpointToPersist = normalizeEndpoint(endpoint);
  let publicKey: string | null = null;
  let acardVersion: number | null = null;
  let acardLineage: string | null = null;
  let acardSignature: string | null = null;
  let acardRaw: ACARD | null = null;
  let didMethod: string | null = null;
  let pqcPublicKey: string | null = null;
  let validatedVcs: any[] | null = null;

  if (acard || acard_signature) {
    if (!acard || !acard_signature) {
      return reply.status(400).send({ error: "acard and acard_signature must both be provided" });
    }
    const acardCleaned: ACARD = {
      ...acard,
      capabilities: acard.capabilities.map((c) => ({
        ...c,
        pricingCents: typeof c.pricingCents === "number" ? c.pricingCents : undefined,
        inputSchema: c.inputSchema ?? undefined,
        outputSchema: c.outputSchema ?? undefined,
        embeddingDim: typeof c.embeddingDim === "number" ? c.embeddingDim : undefined,
        tags: Array.isArray((c as any).tags) ? (c as any).tags : undefined,
      })),
    };
    const acardEndpoint = normalizeEndpoint(acard.endpoint);
    endpointToPersist = endpointToPersist || acardEndpoint;
    if (!endpointToPersist) {
      return reply.status(400).send({ error: "endpoint is required when using ACARD" });
    }
    if (acard.did !== did) {
      return reply.status(400).send({ error: "ACARD did mismatch" });
    }
    if (acardEndpoint !== endpointToPersist) {
      return reply.status(400).send({ error: "ACARD endpoint mismatch" });
    }
    const ok = verifyACARD(acardCleaned, acard_signature);
    if (!ok) {
      return reply.status(401).send({ error: "Invalid ACARD signature" });
    }
    // ensure capabilities match the signed card
    const acardCapIds = new Set(acardCleaned.capabilities.map((c) => c.id));
    const acardPrices = new Map(acardCleaned.capabilities.map((c) => [c.id, c.pricingCents]));
    for (const cap of normalizedCaps) {
      if (!acardCapIds.has(cap.capabilityId)) {
        return reply.status(400).send({
          error: `Capability ${cap.capabilityId} not present in ACARD`,
        });
      }
      // If ACARD declares pricing, prefer it
      const p = acardPrices.get(cap.capabilityId);
      if (p != null) {
        cap.price_cents = p;
      }
    }
    publicKey = acardCleaned.publicKey;
    acardVersion = acardCleaned.version;
    acardLineage = acardCleaned.lineage ?? null;
    acardSignature = acard_signature;
    // filter & verify VCs
    const vcs = Array.isArray((acard as any).vcs) ? (acard as any).vcs : [];
    validatedVcs = filterAndVerifyVcs(vcs, VC_ISSUERS, VC_ISSUER_KEY_MAP);
    acardRaw = {
      ...acardCleaned,
      vcs: validatedVcs || [],
    } as any;
    didMethod = (acard as any).did_method || null;
    pqcPublicKey = (acard as any).pqc_public_key || null;
  } else {
    if (!endpointToPersist) {
      return reply.status(400).send({ error: "endpoint is required" });
    }
  }

  try {
    await pool.query(
      `insert into agents (did, name, endpoint, public_key, wallet_address, acard_version, acard_lineage, acard_signature, acard_raw, did_method, pqc_public_key, updated_at, is_conflicted, source_peer)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), false, null)
     on conflict (did) do update set
       name = excluded.name,
       endpoint = excluded.endpoint,
       public_key = excluded.public_key,
       wallet_address = coalesce(excluded.wallet_address, agents.wallet_address),
       acard_version = excluded.acard_version,
       acard_lineage = excluded.acard_lineage,
       acard_signature = excluded.acard_signature,
       acard_raw = excluded.acard_raw,
       did_method = excluded.did_method,
       pqc_public_key = excluded.pqc_public_key,
       is_conflicted = false,
       updated_at = now()`,
      [
        did,
        name || null,
        endpointToPersist,
        publicKey,
        walletAddress?.toLowerCase() || null,
        acardVersion,
        acardLineage,
        acardSignature,
        acardRaw,
        didMethod,
        pqcPublicKey,
      ]
    );

    // replace capabilities for this agent
    await pool.query(`delete from capabilities where agent_did = $1`, [did]);
    await deleteByAgent(did);

    for (const cap of normalizedCaps) {
      const vector = await embed(
        capabilityText(cap.capabilityId, cap.description, cap.output_schema, cap.tags)
      );
      await upsertCapability({
        id: randomUUID(),
        agentDid: did,
        capabilityId: cap.capabilityId,
        description: cap.description,
        tags: cap.tags,
        priceCents: cap.price_cents ?? null,
        priceModel: cap.price_model || null,
        safetyClass: cap.safety_class || null,
        region: cap.region || null,
        slaHints: cap.sla_hints || null,
        certs: cap.certs || null,
        vector,
      });
      await pool.query(
        `insert into capabilities (agent_did, capability_id, description, tags, output_schema, price_cents, price_model, safety_class, region, sla_hints, certs)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          did,
          cap.capabilityId,
          cap.description,
          cap.tags || [],
          cap.output_schema || null,
          cap.price_cents ?? null,
          cap.price_model || null,
          cap.safety_class || null,
          cap.region || null,
          cap.sla_hints || null,
          cap.certs || null,
        ]
      );

      if (cap.tool_schema) {
        await pool.query(
          `insert into tool_schemas (capability_id, agent_did, schema, version)
           values ($1, $2, $3, 1)
           on conflict (capability_id, agent_did)
           do update set schema = excluded.schema, version = tool_schemas.version + 1, updated_at = now()`,
          [cap.capabilityId, did, cap.tool_schema]
        );
      }
    }
    await bumpRegistryState();
    let issuedVc: any | null = null;
    if (REGISTRY_DID && REGISTRY_PRIVATE_KEY_B58) {
      const vcPayload = {
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        id: `urn:vc:registered-agent:${did}:${Date.now()}`,
        type: ["VerifiableCredential", "RegisteredAgent"],
        issuer: REGISTRY_DID,
        issuanceDate: new Date().toISOString(),
        credentialSubject: {
          id: did,
          endpoint: endpointToPersist,
          capabilities: normalizedCaps.map((c) => ({
            capabilityId: c.capabilityId,
            description: c.description,
            price_model: c.price_model || null,
            safety_class: c.safety_class || null,
            region: c.region || null,
            sla_hints: c.sla_hints || null,
            certs: c.certs || null,
          })),
        },
      };
      issuedVc = signVc(vcPayload);
    }
    return reply.send({ ok: true, registered: normalizedCaps.length, vc: issuedVc });
  } catch (err: any) {
    app.log.error({ err }, "register error");
    return reply.status(500).send({
      error: err.message || "Internal error",
      statusCode: 500,
      details: err?.response?.data ?? err?.stack ?? err,
    });
  }
});

const searchSchema = z.object({
  query: z.string(),
  limit: z.number().int().positive().max(50).optional(),
  minReputation: z.number().min(0).max(1).optional(),
  safetyClass: z.string().optional(),
  priceModel: z.string().optional(),
  region: z.string().optional(),
  cert: z.string().optional(),
  maxPriceCents: z.number().int().positive().optional(),
});

app.post(
  "/v1/agent/reputation",
  { preHandler: [rateLimitGuard, apiGuard] },
  async (request, reply) => {
    const parse = reputationSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.flatten(), message: "Invalid payload" });
    }
    const { did, reputation } = parse.data;
    const clamped = Math.max(0, Math.min(1, reputation));
    await pool.query(
      `update agents set reputation = $1 where did = $2`,
      [clamped, did]
    );
    return reply.send({ ok: true, did, reputation: clamped });
  }
);

app.post(
  "/v1/agent/availability",
  { preHandler: [rateLimitGuard, apiGuard] },
  async (request, reply) => {
    const parse = availabilitySchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.flatten(), message: "Invalid payload" });
    }
    const { did, availability, last_seen } = parse.data;
    await pool.query(
      `update agents set availability_score = $1, last_seen = coalesce($2, now()) where did = $3`,
      [availability, last_seen ? new Date(last_seen) : new Date(), did]
    );
    return reply.send({ ok: true, did, availability });
  }
);

app.post("/v1/reputation/event", { preHandler: [rateLimitGuard, apiGuard] }, async (request, reply) => {
  const parse = reputationEventSchema.safeParse(request.body);
  if (!parse.success) {
    return reply.status(400).send({ error: parse.error.flatten(), message: "Invalid payload" });
  }
  const { did, outcome, latencyMs, dispute } = parse.data;
  try {
    const stats = await recordReputationEvent({ agentDid: did, outcome, latencyMs, dispute });
    return reply.send({ ok: true, stats });
  } catch (err: any) {
    app.log.error({ err, did }, "reputation event failed");
    return reply.status(500).send({ error: "reputation_event_failed" });
  }
});

app.get("/v1/agents/:did/reputation", async (request, reply) => {
  const did = (request.params as any).did;
  const stats = await getReputation(did);
  if (!stats) return reply.status(404).send({ error: "not_found" });
  return reply.send({ reputation: stats });
});

app.get("/v1/capability/:id/schema", async (request, reply) => {
  const capId = (request.params as any).id;
  const res = await pool.query(
    `select output_schema from capabilities where capability_id = $1 limit 1`,
    [capId]
  );
  if (!res.rowCount) {
    return reply.status(404).send({ error: "Not found" });
  }
  return reply.send(res.rows[0].output_schema || {});
});

app.get("/v1/capability/:id/tool-schema", async (request, reply) => {
  const capId = (request.params as any).id;
  const agentDid = (request.query as any)?.agentDid || null;
  const res = await pool.query(
    `select schema, version, updated_at
       from tool_schemas
      where capability_id = $1
        and ($2::text is null or agent_did = $2)
      order by updated_at desc
      limit 1`,
    [capId, agentDid]
  );
  if (!res.rowCount) {
    return reply.status(404).send({ error: "Not found" });
  }
  return reply.send({ schema: res.rows[0].schema, version: res.rows[0].version, updatedAt: res.rows[0].updated_at });
});

app.post("/v1/tool-schemas", { preHandler: [rateLimitGuard, apiGuard] }, async (request, reply) => {
  const body = request.body as any;
  const { capabilityId, agentDid, schema, version } = body || {};
  if (!capabilityId || !agentDid || !schema) {
    return reply.status(400).send({ error: "capabilityId, agentDid, and schema are required" });
  }
  await pool.query(
    `insert into tool_schemas (capability_id, agent_did, schema, version)
     values ($1, $2, $3, $4)
     on conflict (capability_id, agent_did)
     do update set schema = excluded.schema,
                   version = greatest(excluded.version, tool_schemas.version + 1),
                   updated_at = now()`,
    [capabilityId, agentDid, schema, version || 1]
  );
  await bumpRegistryState();
  return reply.send({ ok: true });
});

app.post("/v1/agent/discovery", { preHandler: [rateLimitGuard, apiGuard] }, async (request, reply) => {
  const parse = searchSchema.safeParse(request.body);
  if (!parse.success) {
    return reply.status(400).send({ error: parse.error.flatten(), message: "Invalid search payload" });
  }
  const {
    query,
    limit = 5,
    minReputation = MIN_REP_DISCOVER,
    safetyClass,
    priceModel,
    region,
    cert,
    maxPriceCents,
  } = parse.data;

  const matchesFilters = (payload: any) => {
    if (safetyClass && (payload?.safetyClass || payload?.safety_class) !== safetyClass) return false;
    if (priceModel && (payload?.priceModel || payload?.price_model) !== priceModel) return false;
    if (region && (payload?.region || "") !== region) return false;
    if (typeof maxPriceCents === "number") {
      const priceVal =
        typeof payload?.priceCents === "number"
          ? payload.priceCents
          : typeof payload?.price_cents === "number"
          ? payload.price_cents
          : null;
      if (priceVal !== null && priceVal > maxPriceCents) return false;
    }
    if (cert) {
      const certsArr = Array.isArray(payload?.certs) ? payload.certs : [];
      if (!certsArr.some((c: any) => (typeof c === "string" ? c === cert : c?.id === cert))) return false;
    }
    return true;
  };

  let hits: any[] = [];
  try {
    const vector = await embed(query);
    hits = await searchCapabilities(vector, limit);
    hits = hits.filter((h: any) => matchesFilters(h.payload || {}));
  } catch (err) {
    app.log.warn({ err }, "vector search failed, falling back to DB search");
  }

  // Always add keyword fallback for recall, then merge/dedupe.
  const keywordRes = await pool.query(
    `select c.capability_id as "capabilityId",
            c.description,
            c.tags,
            c.output_schema,
            c.price_cents,
            c.price_model,
            c.safety_class,
            c.region,
            c.sla_hints,
            c.certs,
            c.agent_did as "agentDid",
            a.reputation,
            a.availability_score,
            a.last_seen
     from capabilities c
     join agents a on a.did = c.agent_did
     where (c.capability_id ilike $1 or c.description ilike $1)`,
    [`%${query}%`]
  );
  const keywordHits = keywordRes.rows.map((row) => ({
    score: 0.45,
    payload: {
      agentDid: row.agentDid,
      capabilityId: row.capabilityId,
      description: row.description,
      tags: row.tags,
      priceCents: row.price_cents,
      priceModel: row.price_model,
      safetyClass: row.safety_class,
      region: row.region,
      slaHints: row.sla_hints,
      certs: row.certs,
      reputation: row.reputation,
      availability_score: row.availability_score,
      last_seen: row.last_seen,
    },
  })).filter((h) => matchesFilters(h.payload || {}));
  hits = [...hits, ...keywordHits];

  const agents: Record<
    string,
    {
      did: string;
      name: string | null;
      endpoint: string | null;
      reputation: number | null;
      availability_score: number | null;
      last_seen: Date | null;
      profiles?: any[] | null;
      is_conflicted?: boolean;
    }
  > = {};
  if (hits.length) {
    const dids = hits
      .map((h: any) => h.payload?.agentDid)
      .filter((v: unknown): v is string => typeof v === "string");
    if (dids.length) {
      const rows = await pool.query<{
        did: string;
        name: string | null;
        endpoint: string | null;
        reputation: number | null;
        availability_score: number | null;
        last_seen: Date | null;
        acard_raw: any | null;
        is_conflicted: boolean | null;
      }>(
        `select did, name, endpoint, reputation, availability_score, last_seen, acard_raw, is_conflicted from agents where did = any($1::text[])`,
        [dids]
      );
      rows.rows.forEach((row) => {
        agents[row.did] = {
          did: row.did,
          name: row.name,
          endpoint: row.endpoint ?? null,
          reputation: row.reputation ?? null,
          availability_score: row.availability_score ?? null,
          last_seen: row.last_seen ?? null,
          is_conflicted: !!row.is_conflicted,
          profiles: Array.isArray((row.acard_raw as any)?.profiles)
            ? (row.acard_raw as any).profiles
            : null,
        };
      });
    }
  }

  const now = Date.now();

  // dedupe by agent+cap
  const seenKey = new Set<string>();
  const results = hits
    .map((hit: any) => {
      const agentDid = typeof hit.payload?.agentDid === "string" ? hit.payload.agentDid : undefined;
      const capabilityId =
        typeof hit.payload?.capabilityId === "string" ? hit.payload.capabilityId : undefined;
      const description =
        typeof hit.payload?.description === "string" ? hit.payload.description : undefined;
    const tags = Array.isArray(hit.payload?.tags) ? hit.payload.tags : undefined;
    const reputation =
      typeof hit.payload?.reputation === "number"
        ? hit.payload.reputation
        : hit.payload?.rep || (agentDid ? agents[agentDid]?.reputation ?? null : null);

    const repScore = Math.max(0, Math.min(1, Number(reputation ?? 0)));
    const vectorScore = typeof hit.score === "number" ? hit.score : 0;
      const availabilityScore =
        typeof agents[agentDid || ""]?.last_seen !== "undefined"
          ? (() => {
              const lastSeen = agents[agentDid || ""]?.last_seen as any;
              const ts = lastSeen ? new Date(lastSeen).getTime() : 0;
            const stale = now - ts > HEARTBEAT_TTL_MS * 2;
            return stale ? 0 : Math.max(0, Math.min(1, Number(agents[agentDid || ""]?.availability_score || 0)));
          })()
        : null;

    const combinedScore =
      SIM_WEIGHT * vectorScore +
      REP_WEIGHT * repScore +
      AVAIL_WEIGHT * (availabilityScore ?? 0);

    const key = `${agentDid || ""}|${capabilityId || ""}`;
    if (seenKey.has(key)) return null;
    seenKey.add(key);

    if (agentDid && agents[agentDid]?.is_conflicted) {
      return null;
    }

    return {
      score: combinedScore,
      vectorScore,
      reputationScore: repScore,
      availabilityScore: availabilityScore ?? null,
      agentDid,
      capabilityId,
      description,
      tags,
      reputation: reputation ?? null,
      agent: agentDid ? agents[agentDid] || null : null,
      profiles: agentDid ? agents[agentDid]?.profiles || null : null,
    };
  })
    .filter((r: any) => r && (r.availabilityScore ?? 0) > 0 && (r.reputationScore ?? 0) >= minReputation)
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));

  return reply.send({ results });
});

// ============================================================
// FEDERATION (REGISTRY SYNC)
// ============================================================

app.post("/v1/federation/peers", { preHandler: apiGuard }, async (request, reply) => {
  const parse = federationPeerSchema.safeParse(request.body);
  if (!parse.success) {
    return reply.status(400).send({ error: parse.error.flatten(), message: "Invalid peer payload" });
  }
  const body = parse.data;
  const res = await pool.query(
    `insert into federation_peers (id, endpoint, region, public_key, status, capabilities, last_seen_at, updated_at)
     values ($1, $2, $3, $4, 'active', $5, now(), now())
     on conflict (id) do update set
       endpoint = excluded.endpoint,
       region = excluded.region,
       public_key = excluded.public_key,
       capabilities = excluded.capabilities,
       status = 'active',
       last_seen_at = now(),
       updated_at = now()
     returning *`,
    [body.peerId, body.endpoint, body.region, body.publicKey, JSON.stringify(body.capabilities || [])]
  );
  return reply.send(res.rows[0]);
});

app.get("/v1/federation/peers", async (_req, reply) => {
  const res = await pool.query(`select * from federation_peers order by region, last_seen_at desc nulls last`);
  return reply.send({ peers: res.rows });
});

app.get("/v1/federation/conflicts", async (_req, reply) => {
  const res = await pool.query(
    `select * from federation_conflicts where resolved = false order by created_at desc limit 200`
  );
  return reply.send({ conflicts: res.rows });
});

app.get("/v1/federation/export", async (request, reply) => {
  const since = Number((request.query as any)?.since ?? 0);
  const stateVersion = await getRegistryStateVersion();
  // For MVP we return full set; future: filter by updated_at > since marker.
  const agentRows = await pool.query(
    `select did, name, endpoint, public_key, acard_version, acard_lineage, acard_signature, acard_raw, did_method, pqc_public_key, wallet_address, updated_at
     from agents
     where is_conflicted = false`
  );
  const capsRows = await pool.query(
    `select agent_did, capability_id, description, tags, output_schema, price_cents from capabilities`
  );
  const capsByAgent: Record<string, any[]> = {};
  for (const row of capsRows.rows) {
    capsByAgent[row.agent_did] = capsByAgent[row.agent_did] || [];
    capsByAgent[row.agent_did].push({
      capability_id: row.capability_id,
      description: row.description,
      tags: row.tags,
      output_schema: row.output_schema,
      price_cents: row.price_cents,
    });
  }
  const agents = agentRows.rows.map((row) => ({
    did: row.did,
    name: row.name,
    endpoint: row.endpoint,
    public_key: row.public_key,
    acard_version: row.acard_version,
    acard_lineage: row.acard_lineage,
    acard_signature: row.acard_signature,
    acard_raw: row.acard_raw,
    did_method: (row as any).did_method,
    pqc_public_key: (row as any).pqc_public_key,
    wallet_address: row.wallet_address,
    updated_at: row.updated_at,
    capabilities: capsByAgent[row.did] || [],
  }));
  return reply.send({ stateVersion, since, agents });
});

async function upsertPeerAgent(agent: any, peerId: string, log: any) {
  const did = agent.did;
  if (!did) return { action: "skip" };
  const incomingVersion = agent.acard_version ?? 0;
  const endpoint = normalizeEndpoint(agent.endpoint);
  const local = await pool.query(
    `select did, acard_version, acard_raw from agents where did = $1 limit 1`,
    [did]
  );
  const hasLocal = (local?.rowCount || 0) > 0;
  const localVersion = hasLocal ? Number(local.rows[0].acard_version || 0) : -1;
  const localHash = hasLocal ? stableStringify(local.rows[0].acard_raw || {}) : null;
  const incomingHash = stableStringify(agent.acard_raw || {});

  if (!hasLocal || incomingVersion > localVersion) {
    // Replace or insert
    await pool.query(
      `insert into agents (did, name, endpoint, public_key, wallet_address, acard_version, acard_lineage, acard_signature, acard_raw, did_method, pqc_public_key, source_peer, is_conflicted, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, now())
       on conflict (did) do update set
         name = excluded.name,
         endpoint = excluded.endpoint,
         public_key = excluded.public_key,
         wallet_address = coalesce(excluded.wallet_address, agents.wallet_address),
         acard_version = excluded.acard_version,
         acard_lineage = excluded.acard_lineage,
         acard_signature = excluded.acard_signature,
         acard_raw = excluded.acard_raw,
         did_method = excluded.did_method,
         pqc_public_key = excluded.pqc_public_key,
         source_peer = excluded.source_peer,
         is_conflicted = false,
         updated_at = now()`,
      [
        did,
        agent.name || null,
        endpoint,
        agent.public_key || agent.publicKey || null,
        agent.wallet_address || null,
        incomingVersion,
        agent.acard_lineage || null,
        agent.acard_signature || null,
        agent.acard_raw || null,
        (agent as any).did_method || null,
        (agent as any).pqc_public_key || null,
        peerId,
      ]
    );
    await pool.query(`delete from capabilities where agent_did = $1`, [did]);
    await deleteByAgent(did);
    const caps: any[] = Array.isArray(agent.capabilities) ? agent.capabilities : [];
    for (const cap of caps) {
      const capId = cap.capability_id || cap.capabilityId;
      if (!capId) continue;
      await pool.query(
        `insert into capabilities (agent_did, capability_id, description, tags, output_schema, price_cents, price_model, safety_class, region, sla_hints, certs)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          did,
          capId,
          cap.description || "",
          cap.tags || [],
          cap.output_schema || null,
          typeof cap.price_cents === "number" ? cap.price_cents : null,
          (cap as any).price_model || null,
          (cap as any).safety_class || null,
          (cap as any).region || null,
          (cap as any).sla_hints || null,
          (cap as any).certs || null,
        ]
      );
      try {
        const vector = await embed(
          capabilityText(capId, cap.description, cap.output_schema, cap.tags)
        );
        await upsertCapability({
          id: randomUUID(),
          agentDid: did,
          capabilityId: capId,
          description: cap.description || "",
          tags: cap.tags || [],
          priceModel: (cap as any).price_model || null,
          safetyClass: (cap as any).safety_class || null,
          region: (cap as any).region || null,
          slaHints: (cap as any).sla_hints || null,
          certs: (cap as any).certs || null,
          vector,
        });
      } catch (err) {
        log?.warn?.({ err }, "failed to embed capability from peer");
      }
    }
    await bumpRegistryState();
    return { action: hasLocal ? "updated" : "inserted", did };
  }

  if (incomingVersion === localVersion && localHash !== incomingHash) {
    await pool.query(
      `update agents set is_conflicted = true, updated_at = now() where did = $1`,
      [did]
    );
    await pool.query(
      `insert into federation_conflicts (did, peer_id, local_version, peer_version, reason, diff)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        did,
        peerId,
        localVersion,
        incomingVersion,
        "version_equal_payload_mismatch",
        { localHash, incomingHash },
      ]
    );
    return { action: "conflict", did };
  }

  return { action: "skipped", did };
}

app.post("/v1/federation/sync", { preHandler: apiGuard }, async (request, reply) => {
  const parse = federationSyncSchema.safeParse(request.body || {});
  if (!parse.success) {
    return reply.status(400).send({ error: parse.error.flatten(), message: "Invalid sync payload" });
  }
  const { peerId } = parse.data;
  const peers = await pool.query(
    `select * from federation_peers where status = 'active' ${peerId ? "and id = $1" : ""}`,
    peerId ? [peerId] : []
  );
  if (!peers.rowCount) {
    return reply.status(404).send({ error: "No active peers found" });
  }

  const summary: any[] = [];
  for (const peer of peers.rows) {
    const since = Number(peer.state_version || 0);
    const url = `${peer.endpoint.replace(/\/+$/, "")}/v1/federation/export?since=${since}`;
    try {
      const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`peer responded ${res.status}`);
      const payload = await res.json();
      const agents = Array.isArray(payload.agents) ? payload.agents : [];
      let inserted = 0;
      let updated = 0;
      let conflicted = 0;
      let skipped = 0;
      for (const agent of agents) {
        const result = await upsertPeerAgent(agent, peer.id, app.log);
        if (result.action === "inserted") inserted++;
        else if (result.action === "updated") updated++;
        else if (result.action === "conflict") conflicted++;
        else skipped++;
      }
      const newVersion = typeof payload.stateVersion === "number" ? payload.stateVersion : since;
      await pool.query(
        `update federation_peers set state_version = $1, last_sync_at = now(), updated_at = now(), status = 'active' where id = $2`,
        [newVersion, peer.id]
      );
      summary.push({ peer: peer.id, inserted, updated, conflicted, skipped, stateVersion: newVersion });
    } catch (err: any) {
      app.log.warn({ err: err?.message || err, peer: peer.id }, "peer sync failed");
      await pool.query(
        `update federation_peers set status = 'degraded', last_sync_at = now(), updated_at = now() where id = $1`,
        [peer.id]
      );
      summary.push({ peer: peer.id, error: err?.message || "sync failed" });
    }
  }

  return reply.send({ summary });
});

app.setErrorHandler((err, _req, reply) => {
  // Log full error and return structured JSON
  const rid = (_req as any)?.headers?.["x-request-id"];
  app.log.error({ err, request_id: rid });
  captureError(err, { request_id: rid });
  const status = (err as any).statusCode || 500;
  return reply.status(status).send({
    error: err.message,
    statusCode: status,
    validation: (err as any).validation,
    details: (err as any).stack || err,
  });
});

// Admin: reindex capabilities into Qdrant (protected by API key)
app.post("/admin/reindex", { preHandler: apiGuard }, async (_req, reply) => {
  try {
    await ensureCollection();
    const caps = await pool.query(
      `select c.capability_id, c.description, c.tags, c.output_schema, a.did as agent_did
       from capabilities c
       join agents a on a.did = c.agent_did`
    );
    for (const row of caps.rows) {
      const vector = await embed(
        capabilityText(row.capability_id, row.description, row.output_schema, row.tags)
      );
      await upsertCapability({
        id: randomUUID(),
        agentDid: row.agent_did,
        capabilityId: row.capability_id,
        description: row.description,
        tags: row.tags,
        vector,
      });
    }
    return reply.send({ ok: true, upserted: caps.rowCount });
  } catch (err: any) {
    app.log.error({ err }, "reindex failed");
    return reply.status(500).send({ error: err?.message || "reindex failed" });
  }
});

// Health check endpoint for Railway/k8s probes
app.get("/health", async (_req, reply) => {
  const health: Record<string, any> = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "registry",
    version: process.env.npm_package_version || "0.1.0",
  };

  // Check database
  try {
    const dbStart = Date.now();
    await pool.query("SELECT 1");
    health.database = {
      status: "connected",
      latencyMs: Date.now() - dbStart,
    };
  } catch (err: any) {
    health.status = "unhealthy";
    health.database = { status: "disconnected", error: err.message };
  }

  // Check Qdrant
  try {
    const qdrantStart = Date.now();
    await qdrant.getCollections();
    health.qdrant = {
      status: "connected",
      latencyMs: Date.now() - qdrantStart,
    };
  } catch (err: any) {
    health.status = "unhealthy";
    health.qdrant = { status: "disconnected", error: err.message };
  }

  // Memory usage
  const mem = process.memoryUsage();
  health.memory = {
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    rssMB: Math.round(mem.rss / 1024 / 1024),
  };

  health.uptime = Math.round(process.uptime());

  const statusCode = health.status === "healthy" ? 200 : 503;
  return reply.status(statusCode).send(health);
});

const port = Number(process.env.PORT || 3001);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`Registry running on ${port}`);
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Received shutdown signal, closing connections...");
  try {
    await app.close();
    await pool.end();
    await shutdownOtel();
    app.log.info("Registry shutdown complete");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "Error during shutdown");
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
