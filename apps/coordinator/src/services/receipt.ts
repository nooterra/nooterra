import { createHash, randomUUID } from "crypto";
import pkg from "cbor";
import base64url from "base64url";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { pool } from "../db.js";
import { ReceiptClaims } from "@nooterra/types";

const { encode: cborEncode, decode: cborDecode } = pkg as {
  encode: (value: unknown) => Uint8Array;
  decode: (input: Uint8Array | Buffer) => unknown;
};

const DISPUTE_WINDOW_SECONDS = Number(process.env.DISPUTE_WINDOW_SECONDS || 86_400); // 24h default

export interface ReceiptEnvelope {
  protected: string; // base64url(cbor headers)
  payload: string; // base64url(cbor claims)
  signature: string; // base64url(ed25519 sig)
}

function kidFromPublicKey(pub58: string): string {
  const raw = bs58.decode(pub58);
  const hash = createHash("sha256").update(raw).digest("base64url");
  return hash.slice(0, 16);
}

function hashJson(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj || {})).digest("base64url");
}

function buildSigStructure(protectedBytes: Uint8Array, payloadBytes: Uint8Array): Uint8Array {
  // COSE Sig_structure = ["Signature1", protected, external_aad, payload]
  return cborEncode(["Signature1", protectedBytes, Buffer.alloc(0), payloadBytes]);
}

export function signReceipt(claims: ReceiptClaims, secretKey: Uint8Array, kid?: string): ReceiptEnvelope {
  const payloadBytes = cborEncode(claims);
  const protectedHeaders = {
    1: -8, // alg = EdDSA
    3: "application/nooterra-receipt+cbor",
    ...(kid ? { 4: Buffer.from(kid, "utf-8") } : {}),
  };
  const protectedBytes = cborEncode(protectedHeaders);
  const toSign = buildSigStructure(protectedBytes, payloadBytes);
  const sig = nacl.sign.detached(new Uint8Array(toSign), secretKey);
  return {
    protected: base64url(Buffer.from(protectedBytes)),
    payload: base64url(Buffer.from(payloadBytes)),
    signature: base64url(Buffer.from(sig)),
  };
}

export function verifyReceipt(envelope: ReceiptEnvelope, publicKey58: string): { valid: boolean; claims?: ReceiptClaims } {
  try {
    const protectedBytes = Buffer.from(envelope.protected, "base64url");
    const payloadBytes = Buffer.from(envelope.payload, "base64url");
    const sigBytes = Buffer.from(envelope.signature, "base64url");
    const toVerify = buildSigStructure(protectedBytes, payloadBytes);
    const ok = nacl.sign.detached.verify(new Uint8Array(toVerify), new Uint8Array(sigBytes), bs58.decode(publicKey58));
    return {
      valid: ok,
      claims: ok ? (cborDecode as any)(payloadBytes) : undefined,
    };
  } catch {
    return { valid: false };
  }
}

/**
 * Insert or update a receipt entry for a completed node.
 * If COORDINATOR_PRIVATE_KEY_B58 is set, signs and stores a COSE envelope.
 */
export async function storeReceipt(params: {
  workflowId: string;
  nodeName: string;
  agentDid: string;
  capabilityId: string;
  output: unknown;
  input: unknown;
  creditsEarned?: number;
  profile?: number;
  traceId?: string;
  invocationId?: string | null;
  resultEnvelope?: unknown;
  mandateId?: string | null;
  envelopeSignatureValid?: boolean | null;
}): Promise<void> {
  // Fetch node info
  let nodeId: string | null = null;
  let startedAt = new Date();
  let completedAt = new Date();
  try {
    const nodeRes = await pool.query(
      `select id, started_at, finished_at from task_nodes where workflow_id = $1 and name = $2 limit 1`,
      [params.workflowId, params.nodeName]
    );
    if (nodeRes?.rowCount) {
      nodeId = nodeRes.rows[0].id;
      startedAt = nodeRes.rows[0].started_at || startedAt;
      completedAt = nodeRes.rows[0].finished_at || completedAt;
    }
  } catch (err) {
    return;
  }
  if (!nodeId) return;

  // Price lookup
  const priceRes = await pool.query(
    `select price_cents from capabilities where capability_id = $1 limit 1`,
    [params.capabilityId]
  );
  const creditsEarned = params.creditsEarned ?? (priceRes.rowCount ? Number(priceRes.rows[0].price_cents || 0) : 0);

  // Insert base receipt row (without COSE). Use a placeholder signature when coordinator key is absent.
  const unsignedSignature = "unsigned";
  await pool.query(
    `INSERT INTO task_receipts 
     (task_id, node_id, workflow_id, agent_did, capability_id, input_hash, output_hash, started_at, completed_at, latency_ms, credits_earned, coordinator_signature, dispute_window_seconds, invocation_id, trace_id, result_envelope, mandate_id, envelope_signature_valid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (workflow_id, node_id) DO UPDATE SET
       input_hash = EXCLUDED.input_hash,
       output_hash = EXCLUDED.output_hash,
       latency_ms = EXCLUDED.latency_ms,
       credits_earned = EXCLUDED.credits_earned,
       dispute_window_seconds = EXCLUDED.dispute_window_seconds,
       invocation_id = coalesce(EXCLUDED.invocation_id, task_receipts.invocation_id),
       trace_id = coalesce(EXCLUDED.trace_id, task_receipts.trace_id),
       result_envelope = coalesce(EXCLUDED.result_envelope, task_receipts.result_envelope),
       mandate_id = coalesce(EXCLUDED.mandate_id, task_receipts.mandate_id),
       envelope_signature_valid = coalesce(EXCLUDED.envelope_signature_valid, task_receipts.envelope_signature_valid)`,
    [
      nodeId,
      nodeId,
      params.workflowId,
      params.agentDid,
      params.capabilityId,
      hashJson(params.input),
      hashJson(params.output),
      startedAt,
      completedAt,
      completedAt.getTime() - startedAt.getTime(),
      creditsEarned,
      unsignedSignature,
      DISPUTE_WINDOW_SECONDS,
      params.invocationId || null,
      params.traceId || null,
      params.resultEnvelope ?? null,
      params.mandateId || null,
      typeof params.envelopeSignatureValid === "boolean"
        ? params.envelopeSignatureValid
        : null
    ]
  );

  // Optionally sign with coordinator key
  const coordPrivB58 = process.env.COORDINATOR_PRIVATE_KEY_B58;
  const coordDid = process.env.COORDINATOR_DID || "did:noot:coordinator";
  if (!coordPrivB58) return;

  const secretKey = bs58.decode(coordPrivB58);
  const pubKey = bs58.encode(secretKey.slice(32));
  const kid = kidFromPublicKey(pubKey);

  const claims: ReceiptClaims = {
    rid: randomUUID(),
    rtype: "task",
    iat: Math.floor(Date.now() / 1000),
    iss: params.agentDid,
    sub: params.workflowId,
    rh: hashJson(params.output),
    ih: hashJson(params.input),
    wid: params.workflowId,
    node: params.nodeName,
    cap: params.capabilityId,
    credits: creditsEarned,
    dur: completedAt.getTime() - startedAt.getTime(),
    coord: coordDid,
    profile: params.profile,
  };

  const envelope = signReceipt(claims, secretKey, kid);

  await pool.query(
    `UPDATE task_receipts
     SET receipt_cose = $1, receipt_kid = $2, receipt_profile = $3
     WHERE workflow_id = $4 AND node_id = $5`,
    [JSON.stringify(envelope), kid, params.profile ?? null, params.workflowId, nodeId]
  );
}
