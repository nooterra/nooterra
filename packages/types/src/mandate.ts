/**
 * Mandate (v0.1)
 *
 * Minimal authority/constraint object binding a payer/org to
 * a set of policy, region, and budget constraints.
 *
 * This is intentionally small and can be extended later with
 * signatures and credential bindings (AP2-style).
 */

export interface Mandate {
  mandateId: string;           // UUID
  payerDid: string;
  projectId?: string | null;

  // Economic bounds
  budgetCapCents?: number | null;
  maxPriceCents?: number | null;

  // Policy and region constraints
  policyIds?: string[];
  regionsAllow?: string[];
  regionsDeny?: string[];

  // Time bounds (ISO8601)
  notBefore?: string | null;
  notAfter?: string | null;

  // Optional signature (not enforced yet)
  signature?: string;
  signatureAlgorithm?: string;
}

