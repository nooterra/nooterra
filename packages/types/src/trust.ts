/**
 * @nooterra/types - Trust Layer Types
 *
 * Types for revocation, key rotation, and signed results.
 */

/**
 * Revoked DID entry - blocked/banned agent
 */
export interface RevokedDid {
  id: number;
  did: string;
  reason: string;
  revokedBy?: string;
  evidence?: Record<string, unknown>;
  createdAt: Date;
  expiresAt?: Date;
}

/**
 * Key rotation record
 */
export interface KeyRotation {
  id: number;
  agentDid: string;
  oldPublicKey: string;
  newPublicKey: string;
  rotationProof?: string;
  createdAt: Date;
}

/**
 * Signed result with cryptographic proof
 */
export interface SignedResult {
  id: string;
  nodeId: string;
  workflowId: string;
  agentDid: string;
  resultHash: string;
  signature: string;
  publicKey: string;
  createdAt: Date;
}

/**
 * Request to revoke a DID
 */
export interface RevocationRequest {
  did: string;
  reason: string;
  evidence?: Record<string, unknown>;
  expiresAt?: Date;
}

/**
 * Request to rotate an agent's key
 */
export interface KeyRotationRequest {
  agentDid: string;
  newPublicKey: string;
  /** Signature proving ownership of old key */
  rotationProof: string;
}

/**
 * Result signing payload
 */
export interface SignResultPayload {
  nodeId: string;
  workflowId: string;
  resultHash: string;
  timestamp: number;
}
