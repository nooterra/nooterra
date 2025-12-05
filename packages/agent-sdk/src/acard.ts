import nacl from "tweetnacl";
import bs58 from "bs58";

/**
 * Nooterra capability declaration
 */
export interface ACARDCapability {
  id: string;
  description: string;
  inputSchema?: any;
  outputSchema?: any;
  embeddingDim?: number;
  /** Pricing in NCR cents per call */
  pricingCents?: number;
}

/**
 * Profile declaration indicating compliance level
 * @see NIP-0001 Section 7 for profile definitions
 */
export interface ProfileDeclaration {
  /** Profile level (0-6) */
  profile: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Version of profile spec */
  version: string;
  /** Whether officially certified */
  certified?: boolean;
  /** URL to certification proof */
  certificationUrl?: string;
}

/**
 * Economic configuration for the agent
 */
export interface EconomicsConfig {
  /** Whether agent accepts escrow-backed tasks */
  acceptsEscrow: boolean;
  /** Minimum bid in cents */
  minBidCents?: number;
  /** Maximum bid in cents */
  maxBidCents?: number;
  /** Supported currencies */
  supportedCurrencies?: string[];
  /** Settlement methods: instant, batched, or L2 */
  settlementMethods?: ("instant" | "batched" | "l2")[];
}

/**
 * Agent Card - the identity and capability manifest for a Nooterra agent
 * Extends A2A AgentCard with Nooterra-specific fields
 * @see NIP-0001 for full specification
 */
export interface ACARD {
  /** Agent's decentralized identifier */
  did: string;
  /** Agent's HTTP endpoint */
  endpoint: string;
  /** Base58-encoded Ed25519 public key */
  publicKey: string;
  /** ACARD schema version */
  version: number;
  /** Hash of previous ACARD for lineage tracking */
  lineage?: string;
  /** Declared capabilities */
  capabilities: ACARDCapability[];
  /** Optional metadata */
  metadata?: Record<string, any>;
  
  // === Nooterra v0.4 Extensions ===
  
  /** 
   * Supported Nooterra profiles (Profile 0-6)
   * @see NIP-0001 Section 7
   */
  profiles?: ProfileDeclaration[];
  
  /** 
   * Economic configuration 
   * Required for Profile 2+
   */
  economics?: EconomicsConfig;
  
  /**
   * A2A protocol version supported
   * @example "0.3.0"
   */
  a2aVersion?: string;
  
  /**
   * Agent's human-readable name (A2A compat)
   */
  name?: string;
  
  /**
   * Agent's description (A2A compat)
   */
  description?: string;
  
  /**
   * Whether agent supports streaming responses
   */
  supportsStreaming?: boolean;
  
  /**
   * Whether agent supports push notifications/webhooks
   */
  supportsPushNotifications?: boolean;
}

export interface SignedACARD {
  card: ACARD;
  signature: string; // base58-encoded signature over canonical JSON
}

function canonicalize(card: ACARD): string {
  // Minimal canonical JSON: stable sort keys shallowly
  // Order matters for consistent hashing
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

export function hashACARD(card: ACARD): Uint8Array {
  const data = new TextEncoder().encode(canonicalize(card));
  return nacl.hash(data);
}

export function signACARD(card: ACARD, secretKey: Uint8Array): SignedACARD {
  const payload = new TextEncoder().encode(canonicalize(card));
  const sig = nacl.sign.detached(payload, secretKey);
  return {
    card,
    signature: bs58.encode(sig),
  };
}

export function verifyACARD(signed: SignedACARD): boolean {
  try {
    const payload = new TextEncoder().encode(canonicalize(signed.card));
    const pub = bs58.decode(signed.card.publicKey);
    const sig = bs58.decode(signed.signature);
    return nacl.sign.detached.verify(payload, sig, pub);
  } catch {
    return false;
  }
}

// ============================================================================
// Profile Validation Helpers (NIP-0001 Section 7)
// ============================================================================

export type ProfileLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const PROFILE_NAMES: Record<ProfileLevel, string> = {
  0: "A2A Core",
  1: "Rich Content",
  2: "Economic Execution",
  3: "Verified Execution",
  4: "Federated",
  5: "Planetary/P2P",
  6: "High-Value/Attested",
};

/**
 * Check if an ACARD declares support for a given profile level
 */
export function supportsProfile(card: ACARD, level: ProfileLevel): boolean {
  if (!card.profiles) return false;
  return card.profiles.some((p) => p.profile >= level);
}

/**
 * Get the highest profile level declared by an ACARD
 */
export function getMaxProfile(card: ACARD): ProfileLevel | null {
  if (!card.profiles || card.profiles.length === 0) return null;
  return Math.max(...card.profiles.map((p) => p.profile)) as ProfileLevel;
}

/**
 * Validation result for profile compliance
 */
export interface ProfileValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate that an ACARD meets the requirements for a given profile level
 * @see NIP-0001 Section 7 for profile requirements
 */
export function validateProfile(
  card: ACARD,
  level: ProfileLevel
): ProfileValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Profile 0: A2A Core - basic requirements
  if (level >= 0) {
    if (!card.did) errors.push("Missing 'did' field");
    if (!card.endpoint) errors.push("Missing 'endpoint' field");
    if (!card.publicKey) errors.push("Missing 'publicKey' field");
    if (!card.capabilities || card.capabilities.length === 0) {
      errors.push("At least one capability required");
    }
  }

  // Profile 1: Rich Content
  if (level >= 1) {
    if (card.supportsStreaming === undefined) {
      warnings.push("Profile 1 recommends declaring 'supportsStreaming'");
    }
  }

  // Profile 2: Economic Execution
  if (level >= 2) {
    if (!card.economics) {
      errors.push("Profile 2 requires 'economics' configuration");
    } else {
      if (card.economics.acceptsEscrow === undefined) {
        errors.push("Profile 2 requires 'economics.acceptsEscrow'");
      }
    }
  }

  // Profile 3: Verified Execution - requires signing capability
  if (level >= 3) {
    if (!card.publicKey) {
      errors.push("Profile 3 requires 'publicKey' for result signing");
    }
  }

  // Profile 4: Federated - requires push notifications
  if (level >= 4) {
    if (!card.supportsPushNotifications) {
      warnings.push("Profile 4 recommends 'supportsPushNotifications'");
    }
  }

  // Profile 5: Planetary/P2P - DID required
  if (level >= 5) {
    if (!card.did.startsWith("did:")) {
      errors.push("Profile 5 requires valid DID format");
    }
  }

  // Profile 6: High-Value/Attested - hardware attestation
  if (level >= 6) {
    warnings.push("Profile 6 requires hardware attestation (not yet implemented)");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Create a minimal A2A-compatible agent card (Profile 0)
 */
export function createMinimalACARD(options: {
  did: string;
  endpoint: string;
  publicKey: string;
  name: string;
  description: string;
  capabilities: ACARDCapability[];
}): ACARD {
  return {
    did: options.did,
    endpoint: options.endpoint,
    publicKey: options.publicKey,
    version: 1,
    name: options.name,
    description: options.description,
    capabilities: options.capabilities,
    a2aVersion: "0.3.0",
    profiles: [{ profile: 0, version: "1.0.0" }],
  };
}

/**
 * Create a full Nooterra agent card with economic capabilities (Profile 2)
 */
export function createEconomicACARD(options: {
  did: string;
  endpoint: string;
  publicKey: string;
  name: string;
  description: string;
  capabilities: ACARDCapability[];
  economics: EconomicsConfig;
}): ACARD {
  return {
    did: options.did,
    endpoint: options.endpoint,
    publicKey: options.publicKey,
    version: 1,
    name: options.name,
    description: options.description,
    capabilities: options.capabilities,
    a2aVersion: "0.3.0",
    economics: options.economics,
    supportsStreaming: true,
    profiles: [
      { profile: 0, version: "1.0.0" },
      { profile: 1, version: "1.0.0" },
      { profile: 2, version: "1.0.0" },
    ],
  };
}
