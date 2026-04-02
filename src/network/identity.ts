/**
 * Agent Identity — verifiable identity for cross-company interactions.
 *
 * Every agent gets: public key, capabilities, SLO history, authority chain,
 * certification tier. Third-party agents can be registered and governed.
 */

import { createHash, generateKeyPairSync } from 'node:crypto';
import { ulid } from 'ulid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentIdentity {
  id: string;
  tenantId: string;
  agentName: string;

  /** Ed25519 public key (base64) */
  publicKey: string;

  /** What this agent can do */
  capabilities: AgentCapability[];

  /** Performance history */
  sloHistory: SLORecord;

  /** Certification level */
  certificationTier: 'unverified' | 'basic' | 'verified' | 'certified';

  /** When this identity was registered */
  registeredAt: Date;

  /** Whether this is a first-party or third-party agent */
  origin: 'first_party' | 'third_party';
}

export interface AgentCapability {
  actionClass: string;
  objectTypes: string[];
  maxValueCents?: number;
  autonomyLevel: string;
  evidenceStrength: number;
}

export interface SLORecord {
  totalExecutions: number;
  successRate: number;
  avgResponseMs: number;
  p99ResponseMs: number;
  incidentCount: number;
  uptimePercent: number;
  lastUpdated: Date;
}

// ---------------------------------------------------------------------------
// Identity creation
// ---------------------------------------------------------------------------

/**
 * Create a new agent identity with a fresh key pair.
 */
export function createAgentIdentity(
  tenantId: string,
  agentName: string,
  capabilities: AgentCapability[],
  origin: 'first_party' | 'third_party' = 'first_party',
): { identity: AgentIdentity; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const identity: AgentIdentity = {
    id: ulid(),
    tenantId,
    agentName,
    publicKey,
    capabilities,
    sloHistory: {
      totalExecutions: 0,
      successRate: 1.0,
      avgResponseMs: 0,
      p99ResponseMs: 0,
      incidentCount: 0,
      uptimePercent: 100,
      lastUpdated: new Date(),
    },
    certificationTier: origin === 'first_party' ? 'basic' : 'unverified',
    registeredAt: new Date(),
    origin,
  };

  return { identity, privateKey };
}

/**
 * Sign a message with an agent's private key (for cross-company auth).
 */
export function signMessage(privateKeyPem: string, message: string): string {
  const { createSign } = require('node:crypto');
  const sign = createSign('Ed25519');
  sign.update(message);
  return sign.sign(privateKeyPem, 'base64');
}

/**
 * Verify a signed message against an agent's public key.
 */
export function verifySignature(publicKeyPem: string, message: string, signature: string): boolean {
  try {
    const { createVerify } = require('node:crypto');
    const verify = createVerify('Ed25519');
    verify.update(message);
    return verify.verify(publicKeyPem, signature, 'base64');
  } catch {
    return false;
  }
}

/**
 * Compute a fingerprint of an agent identity (for quick lookup).
 */
export function identityFingerprint(identity: AgentIdentity): string {
  return createHash('sha256')
    .update(`${identity.id}:${identity.publicKey}`)
    .digest('hex')
    .slice(0, 16);
}
