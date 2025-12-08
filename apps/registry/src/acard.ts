import nacl from "tweetnacl";
import bs58 from "bs58";
import type {
  NooterraAgentCard,
  NooterraCapabilityDescriptor,
  NooterraAgentEndpoints,
  NooterraAgentKeys,
  NooterraAgentEconomics,
  NooterraAgentPolicyProfile,
  NooterraAgentReputation,
  NooterraAgentContact,
  AgentId,
  CapabilityId,
} from "@nooterra/types";

export interface ACARDCapability {
  id: string;
  description: string;
  inputSchema?: any;
  outputSchema?: any;
  embeddingDim?: number | null;
  pricingCents?: number;
  // optional extensions we already accept via Zod schema
  tags?: string[];
}

/**
 * Profile declaration indicating compliance level (NIP-0001)
 */
export interface ProfileDeclaration {
  profile: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  version: string;
  certified?: boolean;
  certificationUrl?: string;
}

/**
 * Economic configuration for the agent
 */
export interface EconomicsConfig {
  acceptsEscrow: boolean;
  minBidCents?: number;
  maxBidCents?: number;
  supportedCurrencies?: string[];
  settlementMethods?: ("instant" | "batched" | "l2")[];
}

export interface ACARD {
  did: string;
  endpoint: string;
  publicKey: string; // base58-encoded ed25519
  version: number;
  lineage?: string | null;
  capabilities: ACARDCapability[];
  metadata?: Record<string, any> | null;
  
  // v0.4 extensions
  profiles?: ProfileDeclaration[];
  economics?: EconomicsConfig;
  a2aVersion?: string;
  name?: string;
  description?: string;
  supportsStreaming?: boolean;
  supportsPushNotifications?: boolean;
}

function canonicalize(card: ACARD): string {
  // Stable order to ensure signature validity.
  const ordered: any = {
    did: card.did,
    endpoint: card.endpoint,
    publicKey: card.publicKey,
    version: card.version,
    lineage: card.lineage ?? null,
    capabilities: card.capabilities.map((c) => ({
      id: c.id,
      description: c.description,
      inputSchema: c.inputSchema ?? null,
      outputSchema: c.outputSchema ?? null,
      embeddingDim: c.embeddingDim ?? null,
      pricingCents: c.pricingCents ?? null,
    })),
    metadata: card.metadata ?? null,
    // v0.4 extensions (sorted alphabetically)
    a2aVersion: card.a2aVersion ?? null,
    description: card.description ?? null,
    economics: card.economics ?? null,
    name: card.name ?? null,
    profiles: card.profiles ?? null,
    supportsPushNotifications: card.supportsPushNotifications ?? null,
    supportsStreaming: card.supportsStreaming ?? null,
  };
  return JSON.stringify(ordered);
}

export function verifyACARD(card: ACARD, signature: string): boolean {
  try {
    const payload = new TextEncoder().encode(canonicalize(card));
    const pub = bs58.decode(card.publicKey);
    const sig = bs58.decode(signature);
    return nacl.sign.detached.verify(payload, sig, pub);
  } catch {
    return false;
  }
}

export function normalizeEndpoint(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

// Map legacy ACARD into the richer NooterraAgentCard for internal canonical use
export function acardToNooterraAgentCard(acard: ACARD): NooterraAgentCard {
  const nowIso = new Date().toISOString();

  const endpoints: NooterraAgentEndpoints = {
    primaryUrl: normalizeEndpoint(acard.endpoint) || "",
  };

  const keys: NooterraAgentKeys = {
    signingPublicKey: acard.publicKey,
    didUri: acard.did,
  };

  const capabilities: NooterraCapabilityDescriptor[] = (acard.capabilities || []).map((c) => ({
    id: c.id as CapabilityId,
    name: c.id,
    description: c.description,
    inputSchema: c.inputSchema ?? undefined,
    outputSchema: c.outputSchema ?? undefined,
    priceCents: typeof c.pricingCents === "number" ? c.pricingCents : undefined,
    tags: Array.isArray(c.tags) ? c.tags : undefined,
  }));

  let economics: NooterraAgentEconomics | undefined;
  if (acard.economics) {
    economics = {
      pricingModel: "pay_per_request",
      defaultCurrency:
        acard.economics.supportedCurrencies &&
        acard.economics.supportedCurrencies.length > 0
          ? acard.economics.supportedCurrencies[0]
          : undefined,
      payoutRail: "internal_ledger",
    };
  }

  const policyProfile: NooterraAgentPolicyProfile | undefined = undefined;
  const reputation: NooterraAgentReputation | undefined = undefined;

  const contact: NooterraAgentContact = {
    email: (acard.metadata as any)?.contact_email || undefined,
    website: (acard.metadata as any)?.homepage || undefined,
    docsUrl: (acard.metadata as any)?.docsUrl || undefined,
  };

  const card: NooterraAgentCard = {
    agentId: acard.did as AgentId,
    version: String(acard.version),
    displayName:
      acard.name ||
      (acard.metadata && (acard.metadata as any).name) ||
      acard.did,
    description:
      acard.description ||
      (acard.metadata && (acard.metadata as any).description) ||
      undefined,
    createdAt: nowIso,
    updatedAt: nowIso,
    endpoints,
    keys,
    capabilities,
    economics,
    reputation,
    policyProfile,
    tags: Array.isArray((acard.metadata as any)?.tags)
      ? ((acard.metadata as any).tags as string[])
      : undefined,
    logoUrl: (acard.metadata as any)?.logoUrl || undefined,
    contact,
    signature: undefined,
    signatureAlgorithm: "ed25519",
    metadata: acard.metadata ?? undefined,
  };

  return card;
}
