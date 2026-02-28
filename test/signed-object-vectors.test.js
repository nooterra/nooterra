import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import {
  keyIdFromPublicKeyPem,
  sha256Hex,
  signHashHexEd25519,
  verifyHashHexEd25519
} from "../src/core/crypto.js";
import { buildAgentCardV1 } from "../src/core/agent-card.js";
import { buildAgentCardPublishSignatureV1 } from "../src/core/agent-card-publish.js";
import { buildDelegationGrantV1 } from "../src/core/delegation-grant.js";
import {
  SUB_AGENT_WORK_ORDER_EVIDENCE_POLICY_SCHEMA_VERSION,
  buildSubAgentCompletionReceiptV1,
  buildSubAgentWorkOrderV1
} from "../src/core/subagent-work-order.js";
import { CAPABILITY_ATTESTATION_LEVEL, buildCapabilityAttestationV1 } from "../src/core/capability-attestation.js";

const FIXTURE_DIR = path.resolve(process.cwd(), "test/fixtures/signed-object-vectors");
const FIXTURE_PATH = path.resolve(FIXTURE_DIR, "v1.json");
const CONFORMANCE_DIR = path.resolve(process.cwd(), "conformance/v1/signed-object-vectors");
const CONFORMANCE_PATH = path.resolve(CONFORMANCE_DIR, "v1.json");

async function loadSigner() {
  const raw = await fs.readFile(path.resolve(process.cwd(), "test/fixtures/keys/ed25519_test_keypair.json"), "utf8");
  const parsed = JSON.parse(raw);
  return {
    privateKeyPem: parsed.privateKeyPem,
    publicKeyPem: parsed.publicKeyPem,
    keyId: keyIdFromPublicKeyPem(parsed.publicKeyPem)
  };
}

function buildSignedCase({ id, object }) {
  const canonicalJson = canonicalJsonStringify(object);
  const sha256 = sha256Hex(canonicalJson);
  return { id, schemaVersion: object.schemaVersion, canonicalJson, sha256 };
}

async function buildSignedObjectVectorsV1() {
  const tenantId = "tenant_vectors";
  const signer = await loadSigner();
  const nowAt = "2026-02-01T00:00:00.000Z";

  const agentCardPublishInput = {
    agentId: "agt_vectors_card_1",
    displayName: "Vector Agent Card",
    description: "Deterministic signed AgentCard vector",
    capabilities: ["travel.booking"],
    visibility: "public",
    host: {
      runtime: "openclaw",
      endpoint: "https://vectors.example/agent-card",
      protocols: ["mcp", "http"]
    },
    priceHint: {
      amountCents: 125,
      currency: "USD",
      unit: "task"
    },
    tags: ["vectors", "travel"],
    metadata: { stage: "vectors" }
  };
  const agentCardPublish = buildAgentCardPublishSignatureV1({
    tenantId,
    requestBody: agentCardPublishInput,
    signerKeyId: signer.keyId,
    signedAt: nowAt,
    privateKeyPem: signer.privateKeyPem
  });
  const agentCard = buildAgentCardV1({
    tenantId,
    nowAt,
    agentIdentity: {
      schemaVersion: "AgentIdentity.v1",
      agentId: "agt_vectors_card_1",
      displayName: "Vector Agent Card",
      status: "active",
      capabilities: ["travel.booking", "travel.search"],
      keys: {
        keyId: signer.keyId,
        publicKeyPem: signer.publicKeyPem
      }
    },
    cardInput: {
      ...agentCardPublishInput,
      publish: agentCardPublish,
      attestations: [
        {
          type: "capability",
          level: "attested",
          issuer: "agt_vectors_issuer_1",
          issuedAt: "2026-01-15T00:00:00.000Z",
          expiresAt: "2026-12-31T00:00:00.000Z"
        }
      ]
    }
  });

  const delegationGrant = buildDelegationGrantV1({
    grantId: "dgrant_vectors_1",
    tenantId,
    delegatorAgentId: "agt_vectors_principal_1",
    delegateeAgentId: "agt_vectors_worker_1",
    scope: {
      allowedRiskClasses: ["compute", "financial"],
      sideEffectingAllowed: true,
      allowedProviderIds: ["provider_vectors_1"],
      allowedToolIds: ["tool_vectors_1"]
    },
    spendLimit: {
      currency: "USD",
      maxPerCallCents: 500,
      maxTotalCents: 5000
    },
    chainBinding: {
      depth: 0,
      parentGrantHash: null,
      maxDelegationDepth: 3
    },
    validity: {
      issuedAt: nowAt,
      notBefore: nowAt,
      expiresAt: "2026-03-01T00:00:00.000Z"
    },
    revocation: {
      revocable: true,
      revokedAt: null,
      revocationReasonCode: null
    },
    metadata: {
      stage: "vectors"
    },
    createdAt: nowAt
  });

  const workOrder = buildSubAgentWorkOrderV1({
    workOrderId: "wo_vectors_1",
    tenantId,
    parentTaskId: "task_vectors_1",
    principalAgentId: "agt_vectors_principal_1",
    subAgentId: "agt_vectors_worker_1",
    requiredCapability: "travel.booking",
    traceId: "trace_vectors_1",
    x402ToolId: "tool_vectors_1",
    x402ProviderId: "provider_vectors_1",
    specification: {
      task: "book_flight",
      input: { origin: "SFO", destination: "LAX", date: "2026-03-10" }
    },
    pricing: {
      model: "fixed",
      amountCents: 2500,
      currency: "USD",
      quoteId: "quote_vectors_1"
    },
    constraints: {
      maxDurationSeconds: 3600,
      maxCostCents: 3000,
      retryLimit: 1,
      deadlineAt: "2026-02-02T00:00:00.000Z"
    },
    evidencePolicy: {
      schemaVersion: SUB_AGENT_WORK_ORDER_EVIDENCE_POLICY_SCHEMA_VERSION,
      workOrderType: "travel_booking",
      release: {
        minEvidenceRefs: 1,
        requiredKinds: ["artifact"],
        requireReceiptHashBinding: true
      },
      refund: {
        minEvidenceRefs: 0,
        requiredKinds: [],
        requireReceiptHashBinding: false
      }
    },
    delegationGrantRef: "dgrant_vectors_1",
    authorityGrantRef: "agrant_vectors_1",
    metadata: { stage: "vectors" },
    createdAt: nowAt
  });

  const completionReceipt = buildSubAgentCompletionReceiptV1({
    receiptId: "rcpt_vectors_1",
    tenantId,
    workOrder,
    status: "success",
    outputs: {
      confirmationId: "CONFIRM-123",
      bookedAt: "2026-03-10T09:00:00.000Z"
    },
    metrics: {
      latencyMs: 1240
    },
    evidenceRefs: ["artifact://vectors/work-order/wo_vectors_1.json", `sha256:${"a".repeat(64)}`],
    amountCents: 2500,
    currency: "USD",
    traceId: "trace_vectors_1",
    deliveredAt: "2026-02-01T00:10:00.000Z",
    metadata: { stage: "vectors" }
  });

  const attestationSignature = signHashHexEd25519(
    sha256Hex("capability_attestation_vectors_v1"),
    signer.privateKeyPem
  );
  const capabilityAttestation = buildCapabilityAttestationV1({
    attestationId: "att_vectors_1",
    tenantId,
    subjectAgentId: "agt_vectors_worker_1",
    capability: "travel.booking",
    level: CAPABILITY_ATTESTATION_LEVEL.CERTIFIED,
    issuerAgentId: "agt_vectors_issuer_1",
    validity: {
      issuedAt: nowAt,
      notBefore: nowAt,
      expiresAt: "2026-04-01T00:00:00.000Z"
    },
    signature: {
      algorithm: "ed25519",
      keyId: signer.keyId,
      signature: attestationSignature
    },
    verificationMethod: {
      mode: "deterministic",
      verifier: "nooterra.vectors"
    },
    evidenceRefs: ["artifact://vectors/capability/att_vectors_1.json"],
    metadata: {
      stage: "vectors"
    },
    createdAt: nowAt
  });

  const unsignedCases = [
    buildSignedCase({ id: "agent_card_v1", object: agentCard }),
    buildSignedCase({ id: "delegation_grant_v1", object: delegationGrant }),
    buildSignedCase({ id: "subagent_work_order_v1", object: workOrder }),
    buildSignedCase({ id: "subagent_completion_receipt_v1", object: completionReceipt }),
    buildSignedCase({ id: "capability_attestation_v1", object: capabilityAttestation })
  ];

  const cases = unsignedCases.map((row) => {
    const signature = signHashHexEd25519(row.sha256, signer.privateKeyPem);
    const signatureVerified = verifyHashHexEd25519({
      hashHex: row.sha256,
      signatureBase64: signature,
      publicKeyPem: signer.publicKeyPem
    });
    return {
      ...row,
      signatureAlgorithm: "ed25519",
      signatureKeyId: signer.keyId,
      signature,
      signatureVerified
    };
  });

  return {
    schemaVersion: "SignedObjectVectors.v1",
    vectorsVersion: "1.0.0",
    generatedAt: nowAt,
    signer: {
      keyId: signer.keyId
    },
    cases
  };
}

function assertSignedObjectVectorsFailClosed(vectors, { publicKeyPem }) {
  if (vectors?.schemaVersion !== "SignedObjectVectors.v1") {
    throw new Error("SIGNED_OBJECT_VECTORS_SCHEMA_MISMATCH");
  }
  if (!Array.isArray(vectors.cases) || vectors.cases.length === 0) {
    throw new Error("SIGNED_OBJECT_VECTORS_CASES_MISSING");
  }
  for (const row of vectors.cases) {
    if (typeof row.id !== "string" || row.id.trim() === "") throw new Error("SIGNED_OBJECT_VECTOR_ID_MISSING");
    if (typeof row.schemaVersion !== "string" || row.schemaVersion.trim() === "") {
      throw new Error("SIGNED_OBJECT_VECTOR_SCHEMA_VERSION_MISSING");
    }
    if (typeof row.canonicalJson !== "string" || row.canonicalJson.trim() === "") {
      throw new Error("SIGNED_OBJECT_VECTOR_CANONICAL_JSON_MISSING");
    }
    if (typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.sha256)) {
      throw new Error("SIGNED_OBJECT_VECTOR_SHA256_INVALID");
    }
    if (row.sha256 !== sha256Hex(row.canonicalJson)) {
      throw new Error("SIGNED_OBJECT_VECTOR_SHA256_MISMATCH");
    }
    if (row.signatureAlgorithm !== "ed25519") {
      throw new Error("SIGNED_OBJECT_VECTOR_SIGNATURE_ALGORITHM_INVALID");
    }
    if (typeof row.signature !== "string" || row.signature.trim() === "") {
      throw new Error("SIGNED_OBJECT_VECTOR_SIGNATURE_MISSING");
    }
    const verified = verifyHashHexEd25519({
      hashHex: row.sha256,
      signatureBase64: row.signature,
      publicKeyPem
    });
    if (!verified) throw new Error("SIGNED_OBJECT_VECTOR_SIGNATURE_INVALID");
    if (row.signatureVerified !== true) throw new Error("SIGNED_OBJECT_VECTOR_SIGNATURE_VERDICT_MISMATCH");
  }
}

test("signed object vectors (v1) stay stable and signature-verified", async () => {
  const shouldWrite = process.env.WRITE_SIGNED_OBJECT_VECTORS === "1";
  const actual = await buildSignedObjectVectorsV1();
  if (shouldWrite) {
    await fs.mkdir(FIXTURE_DIR, { recursive: true });
    await fs.mkdir(CONFORMANCE_DIR, { recursive: true });
    const raw = `${JSON.stringify(actual, null, 2)}\n`;
    await fs.writeFile(FIXTURE_PATH, raw, "utf8");
    await fs.writeFile(CONFORMANCE_PATH, raw, "utf8");
  }

  const expected = JSON.parse(await fs.readFile(FIXTURE_PATH, "utf8"));
  assert.deepEqual(actual, expected);
  const signer = await loadSigner();
  assert.doesNotThrow(() => assertSignedObjectVectorsFailClosed(actual, { publicKeyPem: signer.publicKeyPem }));
});

test("signed object vectors (v1) are deterministic across runs", async () => {
  const a = await buildSignedObjectVectorsV1();
  const b = await buildSignedObjectVectorsV1();
  assert.deepEqual(a, b);
});

test("signed object vectors fail closed on tampered signatures", async () => {
  const vectors = await buildSignedObjectVectorsV1();
  const signer = await loadSigner();
  const tampered = structuredClone(vectors);
  tampered.cases[0].sha256 = `${tampered.cases[0].sha256.slice(0, 63)}0`;
  assert.throws(
    () => assertSignedObjectVectorsFailClosed(tampered, { publicKeyPem: signer.publicKeyPem }),
    /SIGNED_OBJECT_VECTOR_SIGNATURE_INVALID|SIGNED_OBJECT_VECTOR_SHA256_MISMATCH/
  );
});

test("conformance signed-object-vectors artifact mirrors fixture", async () => {
  const fixtureRaw = await fs.readFile(FIXTURE_PATH, "utf8");
  const conformanceRaw = await fs.readFile(CONFORMANCE_PATH, "utf8");
  assert.equal(conformanceRaw, fixtureRaw);
});
