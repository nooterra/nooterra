// Nooterra AgentCard and A2A AgentCard types

export type AgentId = string & { readonly __brand: "AgentId" };
export type CapabilityId = string & { readonly __brand: "CapabilityId" };
export type PolicyId = string & { readonly __brand: "PolicyId" };
export type IsoTimestamp = string;
export type UrlString = string;
export type JsonObject = Record<string, unknown>;
export type JsonSchemaLike = JsonObject;

// ---------- Internal Nooterra AgentCard ----------

export interface NooterraCapabilityDescriptor {
  id: CapabilityId;
  name: string;
  description?: string;

  inputSchema?: JsonSchemaLike;
  outputSchema?: JsonSchemaLike;

  // Economics
  priceCents?: number;
  currency?: string;
  pricingModel?: "free" | "fixed" | "tiered" | "dynamic" | string;

  tags?: string[];
  policyIds?: PolicyId[];
  regionAllow?: string[];
  regionDeny?: string[];
}

export interface NooterraAgentEndpoints {
  primaryUrl: UrlString;
  a2aUrl?: UrlString;
  mcpUrl?: UrlString;
  internalUrl?: UrlString;
}

export interface NooterraAgentKeys {
  signingPublicKey: string;
  encryptionPublicKey?: string;
  didUri?: string;
}

export interface NooterraAgentEconomics {
  pricingModel?: "free" | "pay_per_request" | "subscription" | "tiered" | string;
  defaultPriceCents?: number;
  defaultCurrency?: string;

  payoutRail?:
    | "stripe_connect"
    | "x402"
    | "bank_transfer"
    | "internal_ledger"
    | string;
  payoutDestination?: string;
}

export interface NooterraAgentReputation {
  score?: number;
  stakedAmount?: number;
  slashedAmount?: number;
  successfulTasks?: number;
  disputedTasks?: number;
}

export interface NooterraAgentPolicyProfile {
  acceptedPolicyIds?: PolicyId[];
  defaultPolicyIds?: PolicyId[];
  jurisdictions?: string[];
  dataHandling?: {
    storesPII?: boolean;
    storesContent?: boolean;
    retentionDays?: number | null;
  };
}

export interface NooterraAgentContact {
  email?: string;
  website?: UrlString;
  docsUrl?: UrlString;
  supportUrl?: UrlString;
}

export interface NooterraAgentCard {
  agentId: AgentId;
  version: string;
  displayName: string;
  description?: string;

  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;

  endpoints: NooterraAgentEndpoints;
  keys: NooterraAgentKeys;
  capabilities: NooterraCapabilityDescriptor[];

  economics?: NooterraAgentEconomics;
  reputation?: NooterraAgentReputation;
  policyProfile?: NooterraAgentPolicyProfile;

  tags?: string[];
  logoUrl?: UrlString;
  contact?: NooterraAgentContact;

  signature?: string;
  signatureAlgorithm?: string;

  metadata?: JsonObject;
}

// ---------- External A2A AgentCard ----------

export type A2AAuthType =
  | "none"
  | "apiKey"
  | "oauth2"
  | "jwt"
  | string;

export interface A2AAuthConfig {
  type: A2AAuthType;
  instructions?: string;
  [key: string]: unknown;
}

export interface A2AApiDescriptor {
  type: "a2a";
  url: UrlString;
  version?: string;
}

export interface A2AAgentCapability {
  id: string;
  name: string;
  description?: string;
  inputSchema?: JsonSchemaLike;
  outputSchema?: JsonSchemaLike;
  tags?: string[];
}

export interface A2AAgentPricing {
  model: "free" | "pay_per_request" | "subscription" | "tiered" | string;
  currency?: string;
  unitAmount?: number;
  detailsUrl?: UrlString;
}

export interface A2AAgentContact {
  email?: string;
  url?: UrlString;
}

export interface A2AAgentCard {
  name: string;
  description: string;
  version: string;
  api: A2AApiDescriptor;
  auth: A2AAuthConfig;

  capabilities?: A2AAgentCapability[];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  supportsAuthenticatedExtendedCard?: boolean;
  pricing?: A2AAgentPricing;
  contact?: A2AAgentContact;

  nooterra?: {
    agentId: AgentId;
    capabilityIds: CapabilityId[];
    stake?: number;
    reputationScore?: number;
    policies?: PolicyId[];
  };

  [extension: string]: unknown;
}

export interface ToA2AAgentCardOptions {
  a2aUrl?: UrlString;
  auth: A2AAuthConfig;
  publicName?: string;
  publicDescription?: string;
  publicVersion?: string;
  selectCapabilities?: (
    caps: NooterraCapabilityDescriptor[]
  ) => NooterraCapabilityDescriptor[];
}

export function toA2AAgentCard(
  card: NooterraAgentCard,
  options: ToA2AAgentCardOptions
): A2AAgentCard {
  const {
    a2aUrl,
    auth,
    publicName,
    publicDescription,
    publicVersion,
    selectCapabilities,
  } = options;

  const endpointUrl =
    a2aUrl ?? card.endpoints.a2aUrl ?? card.endpoints.primaryUrl;

  const selectedCaps = selectCapabilities
    ? selectCapabilities(card.capabilities)
    : card.capabilities;

  const capabilities: A2AAgentCapability[] = selectedCaps.map((cap) => ({
    id: cap.id as unknown as string,
    name: cap.name,
    description: cap.description,
    inputSchema: cap.inputSchema,
    outputSchema: cap.outputSchema,
    tags: cap.tags,
  }));

  const pricing: A2AAgentPricing | undefined =
    card.economics?.pricingModel
      ? {
          model: card.economics.pricingModel,
          currency: card.economics.defaultCurrency,
          unitAmount: card.economics.defaultPriceCents,
          detailsUrl: card.contact?.docsUrl,
        }
      : undefined;

  const nooterraExtension: A2AAgentCard["nooterra"] = {
    agentId: card.agentId,
    capabilityIds: card.capabilities.map((c) => c.id),
    stake: card.reputation?.stakedAmount,
    reputationScore: card.reputation?.score,
    policies: card.policyProfile?.acceptedPolicyIds,
  };

  const contact: A2AAgentContact | undefined =
    card.contact?.email || card.contact?.website
      ? {
          email: card.contact.email,
          url: card.contact.website ?? card.contact.docsUrl,
        }
      : undefined;

  return {
    name: publicName ?? card.displayName,
    description: publicDescription ?? card.description ?? "",
    version: publicVersion ?? card.version,
    api: {
      type: "a2a",
      url: endpointUrl,
    },
    auth,
    capabilities,
    pricing,
    contact,
    nooterra: nooterraExtension,
  };
}

