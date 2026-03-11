import fs from "node:fs";
import path from "node:path";

import { NOOTERRA_PROTOCOL_CURRENT } from "../core/protocol.js";
import { FEDERATION_OPENAPI_ERROR_CODES } from "../federation/error-codes.js";

function readRepoVersion() {
  try {
    const p = path.resolve(process.cwd(), "NOOTERRA_VERSION");
    const raw = fs.readFileSync(p, "utf8");
    const v = String(raw).trim();
    return v || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function buildOpenApiSpec({ baseUrl = null } = {}) {
  const version = readRepoVersion();

  const TenantHeader = {
    name: "x-proxy-tenant-id",
    in: "header",
    required: true,
    schema: { type: "string", example: "tenant_default" },
    description: "Tenant scope for the request."
  };

  const ProtocolHeader = {
    name: "x-nooterra-protocol",
    in: "header",
    required: true,
    schema: { type: "string", example: NOOTERRA_PROTOCOL_CURRENT },
    description: "Client protocol version (major.minor). Required in production."
  };

  const RequestIdHeader = {
    name: "x-request-id",
    in: "header",
    required: false,
    schema: { type: "string" },
    description: "Optional request ID (echoed in responses)."
  };

  const IdempotencyHeader = {
    name: "x-idempotency-key",
    in: "header",
    required: false,
    schema: { type: "string" },
    description: "Optional idempotency key. If reused, request body must match."
  };

  const RequiredIdempotencyHeader = {
    ...IdempotencyHeader,
    required: true,
    description: "Required idempotency key. If reused, request body must match."
  };

  const ExpectedPrevChainHashHeader = {
    name: "x-proxy-expected-prev-chain-hash",
    in: "header",
    required: true,
    schema: { type: "string" },
    description: "Optimistic concurrency precondition for append-style endpoints."
  };

  const ErrorResponse = {
    type: "object",
    additionalProperties: true,
    properties: {
      error: { type: "string" },
      code: { type: "string" },
      details: {}
    }
  };

  const X402ExecutionProofV1 = {
    type: "object",
    additionalProperties: false,
    required: ["protocol", "publicSignals", "proofData"],
    properties: {
      schemaVersion: { type: "string", enum: ["X402ExecutionProof.v1"] },
      protocol: { type: "string", enum: ["groth16", "plonk", "stark"] },
      publicSignals: { type: "array", items: {} },
      proofData: { type: "object", additionalProperties: true },
      verificationKey: { type: "object", nullable: true, additionalProperties: true },
      verificationKeyRef: { type: "string", nullable: true },
      statementHashSha256: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
      inputDigestSha256: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
      outputDigestSha256: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true }
    }
  };

  const X402GateVerifyRequest = {
    type: "object",
    additionalProperties: true,
    required: ["gateId"],
    properties: {
      gateId: { type: "string" },
      proof: { ...X402ExecutionProofV1, nullable: true }
    }
  };

  const X402HumanApprovalDecisionV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "decisionId", "actionId", "actionSha256", "decidedBy", "decidedAt", "approved"],
    properties: {
      schemaVersion: { type: "string", enum: ["NooterraHumanApprovalDecision.v1"] },
      decisionId: { type: "string" },
      actionId: { type: "string" },
      actionSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
      decidedBy: { type: "string" },
      decidedAt: { type: "string", format: "date-time" },
      approved: { type: "boolean" },
      expiresAt: { type: "string", format: "date-time", nullable: true },
      evidenceRefs: { type: "array", items: { type: "string" } },
      binding: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          gateId: { type: "string", nullable: true },
          runId: { type: "string", nullable: true },
          settlementId: { type: "string", nullable: true },
          delegationGrantRef: { type: "string", nullable: true },
          authorityGrantRef: { type: "string", nullable: true },
          policyHashSha256: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
          policyVersion: { type: "integer", minimum: 1, nullable: true }
        }
      }
    }
  };

  const X402HumanApprovalPolicyV1 = {
    type: "object",
    additionalProperties: false,
    properties: {
      highRiskActionTypes: { type: "array", items: { type: "string" } },
      requireApprovalAboveCents: { type: "integer", minimum: 0 },
      strictEvidenceRefs: { type: "boolean" },
      requireContextBinding: { type: "boolean" },
      decisionTimeoutAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const AuthorityEnvelopeV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "envelopeId",
      "actor",
      "principalRef",
      "purpose",
      "capabilitiesRequested",
      "dataClassesRequested",
      "sideEffectsRequested",
      "spendEnvelope",
      "delegationRights",
      "downstreamRecipients",
      "reversibilityClass",
      "riskClass",
      "evidenceRequirements",
      "createdAt",
      "envelopeHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["AuthorityEnvelope.v1"] },
      envelopeId: { type: "string" },
      actor: {
        type: "object",
        additionalProperties: false,
        required: ["agentId"],
        properties: {
          agentId: { type: "string" }
        }
      },
      principalRef: {
        type: "object",
        additionalProperties: false,
        required: ["principalType", "principalId"],
        properties: {
          principalType: { type: "string", enum: ["human", "org", "service", "agent"] },
          principalId: { type: "string" }
        }
      },
      purpose: { type: "string" },
      capabilitiesRequested: { type: "array", items: { type: "string" } },
      dataClassesRequested: { type: "array", items: { type: "string" } },
      sideEffectsRequested: { type: "array", items: { type: "string" } },
      spendEnvelope: {
        type: "object",
        additionalProperties: false,
        required: ["currency", "maxPerCallCents", "maxTotalCents"],
        properties: {
          currency: { type: "string" },
          maxPerCallCents: { type: "integer", minimum: 0 },
          maxTotalCents: { type: "integer", minimum: 0 }
        }
      },
      delegationRights: {
        type: "object",
        additionalProperties: false,
        required: ["mayDelegate", "maxDepth", "allowedDelegateeAgentIds"],
        properties: {
          mayDelegate: { type: "boolean" },
          maxDepth: { type: "integer", minimum: 0 },
          allowedDelegateeAgentIds: { type: "array", items: { type: "string" } }
        }
      },
      duration: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          maxDurationSeconds: { type: "integer", minimum: 1, nullable: true },
          deadlineAt: { type: "string", format: "date-time", nullable: true }
        }
      },
      downstreamRecipients: { type: "array", items: { type: "string" } },
      reversibilityClass: { type: "string", enum: ["reversible", "partially_reversible", "irreversible"] },
      riskClass: { type: "string", enum: ["low", "medium", "high"] },
      evidenceRequirements: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      createdAt: { type: "string", format: "date-time" },
      envelopeHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const ApprovalRequestV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "requestId", "envelopeRef", "requestedBy", "requestedAt", "actionRef", "requestHash"],
    properties: {
      schemaVersion: { type: "string", enum: ["ApprovalRequest.v1"] },
      requestId: { type: "string" },
      envelopeRef: {
        type: "object",
        additionalProperties: false,
        required: ["envelopeId", "envelopeHash"],
        properties: {
          envelopeId: { type: "string" },
          envelopeHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
        }
      },
      requestedBy: { type: "string" },
      requestedAt: { type: "string", format: "date-time" },
      actionRef: {
        type: "object",
        additionalProperties: false,
        required: ["actionId", "sha256"],
        properties: {
          actionId: { type: "string" },
          sha256: { type: "string", pattern: "^[0-9a-f]{64}$" }
        }
      },
      approvalPolicy: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          requireApprovalAboveCents: { type: "integer", minimum: 0 },
          strictEvidenceRefs: { type: "boolean" },
          requireContextBinding: { type: "boolean" },
          decisionTimeoutAt: { type: "string", format: "date-time", nullable: true }
        }
      },
      requestHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const ApprovalDecisionV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "decisionId",
      "requestId",
      "envelopeHash",
      "actionId",
      "actionSha256",
      "decidedBy",
      "decidedAt",
      "approved",
      "evidenceRefs",
      "decisionHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["ApprovalDecision.v1"] },
      decisionId: { type: "string" },
      requestId: { type: "string" },
      envelopeHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      actionId: { type: "string" },
      actionSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
      decidedBy: { type: "string" },
      decidedAt: { type: "string", format: "date-time" },
      approved: { type: "boolean" },
      expiresAt: { type: "string", format: "date-time", nullable: true },
      evidenceRefs: { type: "array", items: { type: "string" } },
      binding: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          gateId: { type: "string", nullable: true },
          runId: { type: "string", nullable: true },
          settlementId: { type: "string", nullable: true },
          delegationGrantRef: { type: "string", nullable: true },
          authorityGrantRef: { type: "string", nullable: true },
          policyHashSha256: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
          policyVersion: { type: "integer", minimum: 1, nullable: true }
        }
      },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      decisionHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const ApprovalStandingPolicyV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "policyId", "principalRef", "displayName", "status", "constraints", "decision", "createdAt", "policyHash"],
    properties: {
      schemaVersion: { type: "string", enum: ["ApprovalStandingPolicy.v1"] },
      policyId: { type: "string" },
      principalRef: {
        type: "object",
        additionalProperties: false,
        required: ["principalType", "principalId"],
        properties: {
          principalType: { type: "string", enum: ["human", "org", "service", "agent"] },
          principalId: { type: "string" }
        }
      },
      displayName: { type: "string" },
      description: { type: "string", nullable: true },
      status: { type: "string", enum: ["active", "disabled"] },
      constraints: {
        type: "object",
        additionalProperties: false,
        required: [
          "actorAgentIds",
          "capabilitiesRequested",
          "dataClassesRequested",
          "sideEffectsRequested",
          "maxSpendCents",
          "maxRiskClass",
          "reversibilityClasses"
        ],
        properties: {
          actorAgentIds: { type: "array", nullable: true, items: { type: "string" } },
          capabilitiesRequested: { type: "array", nullable: true, items: { type: "string" } },
          dataClassesRequested: { type: "array", nullable: true, items: { type: "string" } },
          sideEffectsRequested: { type: "array", nullable: true, items: { type: "string" } },
          maxSpendCents: { type: "integer", minimum: 0, nullable: true },
          maxRiskClass: { type: "string", enum: ["low", "medium", "high"], nullable: true },
          reversibilityClasses: {
            type: "array",
            nullable: true,
            items: { type: "string", enum: ["reversible", "partially_reversible", "irreversible"] }
          }
        }
      },
      decision: {
        type: "object",
        additionalProperties: false,
        required: ["effect", "decidedBy", "expiresAfterSeconds", "evidenceRefs", "metadata"],
        properties: {
          effect: { type: "string", enum: ["approve", "deny"] },
          decidedBy: { type: "string", nullable: true },
          expiresAfterSeconds: { type: "integer", minimum: 1, nullable: true },
          evidenceRefs: { type: "array", items: { type: "string" } },
          metadata: { type: "object", additionalProperties: true, nullable: true }
        }
      },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time", nullable: true },
      policyHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const ApprovalStandingPolicyUpsertRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      approvalStandingPolicy: { ...ApprovalStandingPolicyV1, nullable: true },
      schemaVersion: { type: "string", enum: ["ApprovalStandingPolicy.v1"], nullable: true },
      policyId: { type: "string", nullable: true },
      principalRef: { ...ApprovalStandingPolicyV1.properties.principalRef, nullable: true },
      displayName: { type: "string", nullable: true },
      description: { type: "string", nullable: true },
      status: { type: "string", enum: ["active", "disabled"], nullable: true },
      constraints: { ...ApprovalStandingPolicyV1.properties.constraints, nullable: true },
      decision: { ...ApprovalStandingPolicyV1.properties.decision, nullable: true },
      createdAt: { type: "string", format: "date-time", nullable: true },
      updatedAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const ApprovalContinuationV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "requestId",
      "kind",
      "status",
      "route",
      "authorityEnvelope",
      "approvalRequest",
      "requestBody",
      "resume",
      "createdAt",
      "continuationHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["ApprovalContinuation.v1"] },
      requestId: { type: "string" },
      kind: { type: "string", enum: ["router_launch", "marketplace_rfq", "work_order"] },
      status: { type: "string", enum: ["pending", "approved", "denied", "resumed"] },
      route: {
        type: "object",
        additionalProperties: false,
        required: ["method", "path"],
        properties: {
          method: { type: "string", enum: ["POST"] },
          path: { type: "string", enum: ["/router/launch", "/marketplace/rfqs", "/work-orders"] }
        }
      },
      requestedBy: { type: "string", nullable: true },
      authorityEnvelope: AuthorityEnvelopeV1,
      approvalRequest: ApprovalRequestV1,
      requestBody: { type: "object", additionalProperties: true },
      resume: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "rfqId", "workOrderId", "dispatchNow", "approvalPath"],
        properties: {
          taskId: { type: "string", nullable: true },
          rfqId: { type: "string", nullable: true },
          workOrderId: { type: "string", nullable: true },
          dispatchNow: { type: "boolean" },
          approvalPath: { type: "string", nullable: true }
        }
      },
      decisionRef: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        required: ["decisionId", "decisionHash", "approved", "decidedAt"],
        properties: {
          decisionId: { type: "string" },
          decisionHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          approved: { type: "boolean" },
          decidedAt: { type: "string", format: "date-time" }
        }
      },
      resultRef: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          launchId: { type: "string", nullable: true },
          rfqId: { type: "string", nullable: true },
          workOrderId: { type: "string", nullable: true },
          dispatchId: { type: "string", nullable: true },
          runId: { type: "string", nullable: true }
        }
      },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time", nullable: true },
      resumedAt: { type: "string", format: "date-time", nullable: true },
      continuationHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const ApprovalInboxItemV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "status", "authorityEnvelope", "approvalRequest", "approvalDecision", "approvalContinuation", "standingPolicy"],
    properties: {
      schemaVersion: { type: "string", enum: ["ApprovalInboxItem.v1"] },
      status: { type: "string", enum: ["pending", "decided"] },
      authorityEnvelope: AuthorityEnvelopeV1,
      approvalRequest: ApprovalRequestV1,
      approvalDecision: { ...ApprovalDecisionV1, nullable: true },
      approvalContinuation: { ...ApprovalContinuationV1, nullable: true },
      standingPolicy: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          policyId: { type: "string" },
          policyHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          effect: { type: "string", enum: ["approve", "deny"], nullable: true },
          specificity: { type: "integer", minimum: 0 }
        }
      }
    }
  };

  const ApprovalInboxDecisionRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      approvalDecision: { ...ApprovalDecisionV1, nullable: true },
      humanApprovalDecision: { ...X402HumanApprovalDecisionV1, nullable: true },
      approved: { type: "boolean", nullable: true },
      decisionId: { type: "string", nullable: true },
      decidedBy: { type: "string", nullable: true },
      decidedAt: { type: "string", format: "date-time", nullable: true },
      expiresAt: { type: "string", format: "date-time", nullable: true },
      note: { type: "string", nullable: true },
      rationale: { type: "string", nullable: true },
      evidenceRefs: { type: "array", items: { type: "string" } },
      binding: { ...ApprovalDecisionV1.properties.binding, nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const ApprovalContinuationOptions = {
    type: "object",
    additionalProperties: false,
    properties: {
      dispatchNow: { type: "boolean" }
    }
  };

  const ApprovalChainRefV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "envelopeId", "envelopeHash", "requestId", "requestHash"],
    properties: {
      schemaVersion: { type: "string", enum: ["ApprovalChainRef.v1"] },
      envelopeId: { type: "string" },
      envelopeHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      requestId: { type: "string" },
      requestHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      decisionId: { type: "string", nullable: true },
      decisionHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
      approved: { type: "boolean", nullable: true }
    }
  };

  const X402DelegatedBudgetEnvelopeV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "envelopeId", "currency", "maxTotalCents"],
    properties: {
      schemaVersion: { type: "string", enum: ["X402DelegatedBudgetEnvelope.v1"] },
      envelopeId: { type: "string" },
      teamId: { type: "string", nullable: true },
      policyRef: { type: "string", nullable: true },
      currency: { type: "string" },
      maxTotalCents: { type: "integer", minimum: 1 },
      approvalThresholdCents: { type: "integer", minimum: 0, nullable: true },
      approvalTimeoutAt: { type: "string", format: "date-time", nullable: true },
      emergencyStop: { type: "boolean" },
      requireEvidenceRefs: { type: "boolean" }
    }
  };

  const X402GateAuthorizePaymentRequest = {
    type: "object",
    additionalProperties: true,
    required: ["gateId"],
    properties: {
      gateId: { type: "string" },
      quoteId: { type: "string", nullable: true },
      delegationGrantRef: { type: "string", nullable: true },
      authorityGrantRef: { type: "string", nullable: true },
      delegatedBudgetEnvelope: { ...X402DelegatedBudgetEnvelopeV1, nullable: true },
      budgetEnvelope: { ...X402DelegatedBudgetEnvelopeV1, nullable: true },
      s8ApprovalPolicy: { ...X402HumanApprovalPolicyV1, nullable: true },
      approvalDecision: { ...X402HumanApprovalDecisionV1, nullable: true },
      humanApprovalDecision: { ...X402HumanApprovalDecisionV1, nullable: true },
      s8ApprovalDecision: { ...X402HumanApprovalDecisionV1, nullable: true },
      delegatedApprovalDecision: { ...X402HumanApprovalDecisionV1, nullable: true },
      requestBindingMode: { type: "string", enum: ["strict"], nullable: true },
      requestBindingSha256: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
      walletAuthorizationDecisionToken: { type: "string", nullable: true },
      escalationOverrideToken: { type: "string", nullable: true },
      executionIntent: {
        type: "object",
        nullable: true,
        additionalProperties: true,
        description: "ExecutionIntent.v1 payload bound to authorize-payment preconditions."
      }
    }
  };

  const X402WalletAssignment = {
    type: "object",
    additionalProperties: false,
    required: ["sponsorWalletRef", "policyRef", "policyVersion"],
    properties: {
      sponsorWalletRef: { type: "string" },
      policyRef: { type: "string" },
      policyVersion: { type: "integer", minimum: 1 }
    }
  };

  const X402WalletAssignmentResolveRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      profileRef: { type: "string", nullable: true },
      riskClass: { type: "string", enum: ["read", "compute", "action", "financial"], nullable: true },
      delegationRef: { type: "string", nullable: true },
      delegationDepth: { type: "integer", minimum: 0, nullable: true }
    }
  };

  const X402WalletAssignmentResolveResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "assignment"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      profileRef: { type: "string", nullable: true },
      riskClass: { type: "string", enum: ["read", "compute", "action", "financial"], nullable: true },
      delegationRef: { type: "string", nullable: true },
      delegationDepth: { type: "integer", minimum: 0, nullable: true },
      assignment: { ...X402WalletAssignment, nullable: true }
    }
  };

  const X402AuthorizePaymentTaErrorCodes = Object.freeze([
    "X402_EXECUTION_INTENT_REQUIRED",
    "X402_EXECUTION_INTENT_IDEMPOTENCY_MISMATCH",
    "X402_EXECUTION_INTENT_CONFLICT"
  ]);

  const X402AuthorizePaymentBadRequestKnownErrorCodes = Object.freeze([
    "SCHEMA_INVALID",
    "X402_EXECUTION_INTENT_HASH_MISMATCH"
  ]);

  const X402AuthorizePaymentConflictKnownErrorCodes = Object.freeze([
    ...X402AuthorizePaymentTaErrorCodes,
    "HUMAN_APPROVAL_REQUIRED",
    "HUMAN_APPROVAL_DECISION_INVALID",
    "HUMAN_APPROVAL_BINDING_MISMATCH",
    "HUMAN_APPROVAL_DENIED",
    "HUMAN_APPROVAL_EXPIRED",
    "HUMAN_APPROVAL_EVIDENCE_REQUIRED",
    "HUMAN_APPROVAL_TIMEOUT",
    "HUMAN_APPROVAL_CONTEXT_BINDING_MISMATCH",
    "X402_EXECUTION_INTENT_INVALID",
    "X402_EXECUTION_INTENT_TIME_INVALID",
    "X402_EXECUTION_INTENT_TENANT_MISMATCH",
    "X402_EXECUTION_INTENT_AGENT_MISMATCH",
    "X402_EXECUTION_INTENT_SIDE_EFFECTING_REQUIRED",
    "X402_EXECUTION_INTENT_REQUEST_BINDING_REQUIRED",
    "X402_EXECUTION_INTENT_REQUEST_MISMATCH",
    "X402_EXECUTION_INTENT_SPEND_LIMIT_EXCEEDED",
    "X402_EXECUTION_INTENT_CURRENCY_MISMATCH",
    "X402_EXECUTION_INTENT_RUN_MISMATCH",
    "X402_EXECUTION_INTENT_AGREEMENT_MISMATCH",
    "X402_EXECUTION_INTENT_QUOTE_MISMATCH",
    "X402_EXECUTION_INTENT_POLICY_VERSION_MISMATCH",
    "X402_EXECUTION_INTENT_POLICY_HASH_MISMATCH",
    "X402_EXECUTION_INTENT_EXPIRES_AT_INVALID",
    "X402_EXECUTION_INTENT_EXPIRED"
  ]);

  const X402GateVerifyBadRequestKnownErrorCodes = Object.freeze(["SCHEMA_INVALID"]);

  const X402GateVerifyConflictKnownErrorCodes = Object.freeze([
    "X402_INVALID_VERIFICATION_KEY_REF",
    "X402_MISSING_REQUIRED_PROOF",
    "X402_INVALID_CRYPTOGRAPHIC_PROOF",
    "X402_SPEND_AUTH_POLICY_FINGERPRINT_MISMATCH",
    "X402_REQUEST_BINDING_REQUIRED",
    "X402_REQUEST_BINDING_EVIDENCE_REQUIRED",
    "X402_REQUEST_BINDING_EVIDENCE_MISMATCH"
  ]);

  const X402GateReversalBadRequestKnownErrorCodes = Object.freeze(["SCHEMA_INVALID"]);

  const X402GateReversalConflictKnownErrorCodes = Object.freeze([
    "X402_GATE_INVALID",
    "X402_REVERSAL_RECEIPT_MISSING",
    "X402_REVERSAL_COMMAND_KEY_MISSING",
    "X402_PROVIDER_DECISION_KEY_MISSING",
    "X402_REVERSAL_BINDING_EVIDENCE_REQUIRED",
    "X402_REVERSAL_BINDING_EVIDENCE_MISMATCH",
    "X402_WALLET_POLICY_REFERENCE_INVALID",
    "X402_WALLET_POLICY_DISABLED",
    "X402_WALLET_POLICY_REVERSAL_ACTION_NOT_ALLOWED",
    "X402_REVERSAL_COMMAND_SIGNER_MISMATCH",
    "X402_REVERSAL_COMMAND_INVALID",
    "X402_REVERSAL_COMMAND_REPLAY",
    "X402_REVERSAL_NONCE_REPLAY",
    "X402_REVERSAL_REPLAY_VERIFICATION_REQUIRED",
    "X402_REVERSAL_REPLAY_VERDICT_INVALID",
    "X402_REVERSAL_INVALID_STATE",
    "WALLET_MISSING",
    "INSUFFICIENT_FUNDS",
    "X402_PROVIDER_DECISION_INVALID"
  ]);

  const X402DisputeCloseConflictKnownErrorCodes = Object.freeze([
    "X402_DISPUTE_CLOSE_BINDING_EVIDENCE_REQUIRED",
    "X402_DISPUTE_CLOSE_BINDING_EVIDENCE_MISMATCH"
  ]);

  const X402ArbitrationVerdictConflictKnownErrorCodes = Object.freeze([
    "X402_ARBITRATION_VERDICT_BINDING_EVIDENCE_REQUIRED",
    "X402_ARBITRATION_VERDICT_BINDING_EVIDENCE_MISMATCH"
  ]);

  const X402ArbitrationCloseConflictKnownErrorCodes = Object.freeze([
    "X402_ARBITRATION_CLOSE_BINDING_EVIDENCE_REQUIRED",
    "X402_ARBITRATION_CLOSE_BINDING_EVIDENCE_MISMATCH"
  ]);

  const X402ArbitrationAppealConflictKnownErrorCodes = Object.freeze([
    "X402_ARBITRATION_APPEAL_BINDING_EVIDENCE_REQUIRED",
    "X402_ARBITRATION_APPEAL_BINDING_EVIDENCE_MISMATCH"
  ]);

  const X402ArbitrationOpenConflictKnownErrorCodes = Object.freeze([
    "X402_ARBITRATION_OPEN_BINDING_EVIDENCE_REQUIRED",
    "X402_ARBITRATION_OPEN_BINDING_EVIDENCE_MISMATCH"
  ]);

  const X402ArbitrationAssignConflictKnownErrorCodes = Object.freeze([
    "X402_ARBITRATION_ASSIGN_BINDING_EVIDENCE_REQUIRED",
    "X402_ARBITRATION_ASSIGN_BINDING_EVIDENCE_MISMATCH"
  ]);

  const X402ArbitrationEvidenceConflictKnownErrorCodes = Object.freeze([
    "X402_ARBITRATION_EVIDENCE_BINDING_EVIDENCE_REQUIRED",
    "X402_ARBITRATION_EVIDENCE_BINDING_EVIDENCE_MISMATCH"
  ]);

  const X402DisputeOpenConflictKnownErrorCodes = Object.freeze([
    "X402_DISPUTE_OPEN_BINDING_EVIDENCE_REQUIRED",
    "X402_DISPUTE_OPEN_BINDING_EVIDENCE_MISMATCH"
  ]);

  const X402DisputeEvidenceConflictKnownErrorCodes = Object.freeze([
    "X402_DISPUTE_EVIDENCE_BINDING_EVIDENCE_REQUIRED",
    "X402_DISPUTE_EVIDENCE_BINDING_EVIDENCE_MISMATCH"
  ]);

  const X402DisputeEscalateConflictKnownErrorCodes = Object.freeze([
    "X402_DISPUTE_ESCALATE_BINDING_EVIDENCE_REQUIRED",
    "X402_DISPUTE_ESCALATE_BINDING_EVIDENCE_MISMATCH"
  ]);

  const MarketplaceLifecycleConflictKnownErrorCodes = Object.freeze([
    "EMERGENCY_KILL_SWITCH_ACTIVE",
    "EMERGENCY_QUARANTINE_ACTIVE",
    "EMERGENCY_REVOKE_ACTIVE",
    "EMERGENCY_PAUSE_ACTIVE",
    "X402_AGENT_NOT_ACTIVE",
    "X402_AGENT_LIFECYCLE_INVALID"
  ]);

  const RunSettlementResolveConflictKnownErrorCodes = Object.freeze([
    "IDEMPOTENCY_CONFLICT",
    ...MarketplaceLifecycleConflictKnownErrorCodes,
    "SETTLEMENT_KERNEL_BINDING_INVALID",
    "TRANSITION_ILLEGAL",
    "DISPUTE_OUTCOME_DIRECTIVE_INVALID",
    "DISPUTE_OUTCOME_STATUS_MISMATCH",
    "DISPUTE_OUTCOME_AMOUNT_MISMATCH",
    "X402_SETTLEMENT_RESOLVE_BINDING_EVIDENCE_REQUIRED",
    "X402_SETTLEMENT_RESOLVE_BINDING_EVIDENCE_MISMATCH",
    "INSUFFICIENT_FUNDS"
  ]);

  const ToolCallArbitrationOpenConflictKnownErrorCodes = Object.freeze([
    "IDEMPOTENCY_CONFLICT",
    ...MarketplaceLifecycleConflictKnownErrorCodes,
    "X402_TOOL_CALL_BINDING_SOURCE_REQUIRED",
    "X402_TOOL_CALL_BINDING_SOURCE_AMBIGUOUS",
    "X402_TOOL_CALL_OPEN_BINDING_EVIDENCE_REQUIRED",
    "X402_TOOL_CALL_OPEN_BINDING_EVIDENCE_MISMATCH",
    "HOLD_INVALID",
    "HOLD_NOT_ACTIVE",
    "TOOL_CALL_DISPUTE_BINDING_MISMATCH",
    "DISPUTE_WINDOW_EXPIRED",
    "CASE_ID_NOT_DETERMINISTIC",
    "DISPUTE_ALREADY_OPEN",
    "DISPUTE_INVALID_SIGNER"
  ]);

  const ToolCallArbitrationVerdictConflictKnownErrorCodes = Object.freeze([
    "IDEMPOTENCY_CONFLICT",
    ...MarketplaceLifecycleConflictKnownErrorCodes,
    "X402_TOOL_CALL_BINDING_SOURCE_REQUIRED",
    "X402_TOOL_CALL_BINDING_SOURCE_AMBIGUOUS",
    "X402_TOOL_CALL_VERDICT_BINDING_EVIDENCE_REQUIRED",
    "X402_TOOL_CALL_VERDICT_BINDING_EVIDENCE_MISMATCH",
    "HOLD_INVALID",
    "HOLD_NOT_ACTIVE",
    "TRANSITION_ILLEGAL",
    "TOOL_CALL_VERDICT_NOT_BINARY",
    "ADJUSTMENT_INVALID",
    "DISPUTE_INVALID_SIGNER",
    "INSUFFICIENT_ESCROW_BALANCE",
    "INSUFFICIENT_ESCROW_LOCKED",
    "ESCROW_LEDGER_MISMATCH",
    "ESCROW_OPERATION_REJECTED"
  ]);

  function errorResponseWithKnownCodes(knownCodes) {
    return {
      allOf: [
        ErrorResponse,
        {
          type: "object",
          additionalProperties: true,
          properties: {
            code: {
              anyOf: [{ type: "string", enum: [...knownCodes] }, { type: "string" }],
              description: "Known stable codes are listed in docs/spec/x402-error-codes.v1.txt."
            }
          }
        }
      ]
    };
  }

  const X402ZkVerificationKeyV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "verificationKeyId", "protocol", "verificationKey", "createdAt", "updatedAt"],
    properties: {
      schemaVersion: { type: "string", enum: ["X402ZkVerificationKey.v1"] },
      verificationKeyId: { type: "string" },
      protocol: { type: "string", enum: ["groth16", "plonk", "stark"] },
      verificationKey: { type: "object", additionalProperties: true },
      providerRef: { type: "string", nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const JobCreateRequest = {
    type: "object",
    additionalProperties: false,
    required: ["templateId"],
    properties: {
      templateId: { type: "string" },
      customerId: { type: "string", nullable: true },
      siteId: { type: "string", nullable: true },
      contractId: { type: "string", nullable: true },
      constraints: { type: "object", additionalProperties: true }
    }
  };

  const JobQuoteRequest = {
    type: "object",
    additionalProperties: false,
    required: ["startAt", "endAt", "environmentTier"],
    properties: {
      startAt: { type: "string", format: "date-time" },
      endAt: { type: "string", format: "date-time" },
      environmentTier: { type: "string" },
      requiresOperatorCoverage: { type: "boolean" },
      zoneId: { type: "string" },
      customerId: { type: "string" },
      siteId: { type: "string" },
      contractId: { type: "string" }
    }
  };

  const JobBookRequest = {
    type: "object",
    additionalProperties: false,
    required: ["startAt", "endAt", "environmentTier"],
    properties: {
      paymentHoldId: { type: "string", nullable: true },
      startAt: { type: "string", format: "date-time" },
      endAt: { type: "string", format: "date-time" },
      environmentTier: { type: "string" },
      requiresOperatorCoverage: { type: "boolean" },
      zoneId: { type: "string" },
      customerId: { type: "string" },
      siteId: { type: "string" },
      contractId: { type: "string" }
    }
  };

  const JobEventAppendRequest = {
    type: "object",
    additionalProperties: false,
    required: ["type", "payload"],
    properties: {
      type: { type: "string" },
      at: { type: "string", format: "date-time" },
      actor: { type: "object", additionalProperties: true },
      payload: { type: "object", additionalProperties: true },
      signature: { type: "string" },
      signerKeyId: { type: "string" }
    }
  };

  const AgentIdentityV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "agentId", "tenantId", "displayName", "status", "owner", "keys", "capabilities", "createdAt", "updatedAt"],
    properties: {
      schemaVersion: { type: "string", enum: ["AgentIdentity.v1"] },
      agentId: { type: "string" },
      tenantId: { type: "string" },
      displayName: { type: "string" },
      description: { type: "string", nullable: true },
      status: { type: "string", enum: ["active", "suspended", "revoked"] },
      owner: {
        type: "object",
        additionalProperties: false,
        required: ["ownerType", "ownerId"],
        properties: {
          ownerType: { type: "string", enum: ["human", "business", "service"] },
          ownerId: { type: "string" }
        }
      },
      keys: {
        type: "object",
        additionalProperties: false,
        required: ["keyId", "algorithm", "publicKeyPem"],
        properties: {
          keyId: { type: "string" },
          algorithm: { type: "string", enum: ["ed25519"] },
          publicKeyPem: { type: "string" }
        }
      },
      capabilities: { type: "array", items: { type: "string" } },
      walletPolicy: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          maxPerTransactionCents: { type: "integer", minimum: 0 },
          maxDailyCents: { type: "integer", minimum: 0 },
          requireApprovalAboveCents: { type: "integer", minimum: 0 }
        }
      },
      metadata: { type: "object", nullable: true, additionalProperties: true },
      revision: { type: "integer", minimum: 0 },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const AgentRegisterRequest = {
    type: "object",
    additionalProperties: false,
    required: ["publicKeyPem"],
    properties: {
      agentId: { type: "string" },
      displayName: { type: "string" },
      description: { type: "string" },
      status: { type: "string", enum: ["active", "suspended", "revoked"] },
      ownerType: { type: "string", enum: ["human", "business", "service"] },
      ownerId: { type: "string" },
      owner: {
        type: "object",
        additionalProperties: false,
        properties: {
          ownerType: { type: "string", enum: ["human", "business", "service"] },
          ownerId: { type: "string" }
        }
      },
      publicKeyPem: { type: "string" },
      capabilities: { type: "array", items: { type: "string" } },
      walletPolicy: {
        type: "object",
        additionalProperties: false,
        properties: {
          maxPerTransactionCents: { type: "integer", minimum: 0 },
          maxDailyCents: { type: "integer", minimum: 0 },
          requireApprovalAboveCents: { type: "integer", minimum: 0 }
        }
      },
      metadata: { type: "object", additionalProperties: true }
    }
  };

  const AgentCardHostV1 = {
    type: "object",
    additionalProperties: false,
    nullable: true,
    properties: {
      runtime: { type: "string", nullable: true },
      endpoint: { type: "string", format: "uri", nullable: true },
      protocols: { type: "array", items: { type: "string" } }
    }
  };

  const AgentCardPriceHintV1 = {
    type: "object",
    additionalProperties: false,
    nullable: true,
    properties: {
      amountCents: { type: "integer", minimum: 0 },
      currency: { type: "string" },
      unit: { type: "string" }
    }
  };

  const AgentCardAttestationV1 = {
    type: "object",
    additionalProperties: false,
    required: ["type", "level"],
    properties: {
      type: { type: "string" },
      level: { type: "string" },
      issuer: { type: "string", nullable: true },
      credentialRef: { type: "string", nullable: true },
      proofHash: { type: "string", nullable: true },
      issuedAt: { type: "string", format: "date-time", nullable: true },
      expiresAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const AgentCardPolicyCompatibilityV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "supportsPolicyTemplates", "supportsEvidencePacks"],
    properties: {
      schemaVersion: { type: "string", enum: ["AgentCardPolicyCompatibility.v1"] },
      supportsPolicyTemplates: { type: "array", items: { type: "string" } },
      supportsEvidencePacks: { type: "array", items: { type: "string" } }
    }
  };

  const AgentCardPublishSignatureV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "algorithm", "signerKeyId", "signedAt", "payloadHash", "signature"],
    properties: {
      schemaVersion: { type: "string", enum: ["AgentCardPublish.v1"] },
      algorithm: { type: "string", enum: ["ed25519"] },
      signerKeyId: { type: "string" },
      signedAt: { type: "string", format: "date-time" },
      payloadHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      signature: { type: "string" }
    }
  };

  const ToolDescriptorV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "toolId", "sideEffecting", "requiresEvidenceKinds"],
    properties: {
      schemaVersion: { type: "string", enum: ["ToolDescriptor.v1"] },
      toolId: { type: "string" },
      mcpToolName: { type: "string", nullable: true },
      name: { type: "string", nullable: true },
      description: { type: "string", nullable: true },
      riskClass: { type: "string", enum: ["read", "compute", "action", "financial"], nullable: true },
      sideEffecting: { type: "boolean" },
      pricing: {
        type: "object",
        additionalProperties: false,
        nullable: true,
        properties: {
          amountCents: { type: "integer", minimum: 0 },
          currency: { type: "string" },
          unit: { type: "string" }
        }
      },
      requiresEvidenceKinds: {
        type: "array",
        items: { type: "string", enum: ["artifact", "hash", "verification_report", "execution_attestation"] }
      },
      metadata: { type: "object", nullable: true, additionalProperties: true }
    }
  };

  const AgentCardV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "agentId",
      "tenantId",
      "displayName",
      "status",
      "visibility",
      "capabilities",
      "createdAt",
      "updatedAt",
      "revision"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["AgentCard.v1"] },
      agentId: { type: "string" },
      tenantId: { type: "string" },
      displayName: { type: "string" },
      description: { type: "string", nullable: true },
      status: { type: "string", enum: ["active", "suspended", "revoked"] },
      visibility: { type: "string", enum: ["public", "tenant", "private"] },
      capabilities: { type: "array", items: { type: "string" } },
      host: AgentCardHostV1,
      priceHint: AgentCardPriceHintV1,
      attestations: { type: "array", items: AgentCardAttestationV1 },
      tools: { type: "array", items: ToolDescriptorV1 },
      policyCompatibility: { ...AgentCardPolicyCompatibilityV1, nullable: true },
      publish: { ...AgentCardPublishSignatureV1, nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", nullable: true, additionalProperties: true },
      identityRef: {
        type: "object",
        additionalProperties: false,
        nullable: true,
        properties: {
          schemaVersion: { type: "string", nullable: true },
          keyId: { type: "string", nullable: true }
        }
      },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      revision: { type: "integer", minimum: 0 }
    }
  };

  const AgentCardUpsertRequest = {
    type: "object",
    additionalProperties: false,
    required: ["agentId"],
    properties: {
      agentId: { type: "string" },
      displayName: { type: "string" },
      description: { type: "string" },
      capabilities: { type: "array", items: { type: "string" } },
      visibility: { type: "string", enum: ["public", "tenant", "private"] },
      host: AgentCardHostV1,
      priceHint: AgentCardPriceHintV1,
      attestations: { type: "array", items: AgentCardAttestationV1 },
      tools: { type: "array", items: ToolDescriptorV1 },
      policyCompatibility: { ...AgentCardPolicyCompatibilityV1, nullable: true },
      publish: { ...AgentCardPublishSignatureV1, nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true }
    }
  };

  const AuthorityGrantV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "grantId",
      "tenantId",
      "principalRef",
      "granteeAgentId",
      "scope",
      "spendEnvelope",
      "chainBinding",
      "validity",
      "revocation",
      "createdAt",
      "grantHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["AuthorityGrant.v1"] },
      grantId: { type: "string", minLength: 1, maxLength: 200 },
      tenantId: { type: "string", minLength: 1, maxLength: 200 },
      principalRef: {
        type: "object",
        additionalProperties: false,
        required: ["principalType", "principalId"],
        properties: {
          principalType: { type: "string", enum: ["human", "org", "service", "agent"] },
          principalId: { type: "string", minLength: 1, maxLength: 200 }
        }
      },
      granteeAgentId: { type: "string", minLength: 1, maxLength: 200 },
      scope: {
        type: "object",
        additionalProperties: false,
        required: ["allowedRiskClasses", "sideEffectingAllowed"],
        properties: {
          allowedProviderIds: { type: "array", items: { type: "string", minLength: 1, maxLength: 200 } },
          allowedToolIds: { type: "array", items: { type: "string", minLength: 1, maxLength: 200 } },
          allowedRiskClasses: {
            type: "array",
            minItems: 1,
            items: { type: "string", enum: ["read", "compute", "action", "financial"] }
          },
          sideEffectingAllowed: { type: "boolean" }
        }
      },
      spendEnvelope: {
        type: "object",
        additionalProperties: false,
        required: ["currency", "maxPerCallCents", "maxTotalCents"],
        properties: {
          currency: { type: "string", minLength: 3, maxLength: 12 },
          maxPerCallCents: { type: "integer", minimum: 0 },
          maxTotalCents: { type: "integer", minimum: 0 }
        }
      },
      chainBinding: {
        type: "object",
        additionalProperties: false,
        required: ["rootGrantHash", "parentGrantHash", "depth", "maxDelegationDepth"],
        properties: {
          rootGrantHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          parentGrantHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
          depth: { type: "integer", minimum: 0 },
          maxDelegationDepth: { type: "integer", minimum: 0 }
        }
      },
      validity: {
        type: "object",
        additionalProperties: false,
        required: ["issuedAt", "notBefore", "expiresAt"],
        properties: {
          issuedAt: { type: "string", format: "date-time" },
          notBefore: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time" }
        }
      },
      revocation: {
        type: "object",
        additionalProperties: false,
        required: ["revocable", "revokedAt", "revocationReasonCode"],
        properties: {
          revocable: { type: "boolean" },
          revokedAt: { type: "string", format: "date-time", nullable: true },
          revocationReasonCode: { type: "string", maxLength: 120, nullable: true }
        }
      },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      createdAt: { type: "string", format: "date-time" },
      grantHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const AuthorityGrantIssueRequest = {
    type: "object",
    additionalProperties: false,
    required: ["principalRef", "granteeAgentId"],
    properties: {
      grantId: { type: "string" },
      principalRef: {
        type: "object",
        additionalProperties: false,
        required: ["principalType", "principalId"],
        properties: {
          principalType: { type: "string", enum: ["human", "org", "service", "agent"] },
          principalId: { type: "string" }
        }
      },
      granteeAgentId: { type: "string" },
      scope: {
        type: "object",
        additionalProperties: false,
        properties: {
          allowedProviderIds: { type: "array", items: { type: "string" } },
          allowedToolIds: { type: "array", items: { type: "string" } },
          allowedRiskClasses: { type: "array", items: { type: "string", enum: ["read", "compute", "action", "financial"] } },
          sideEffectingAllowed: { type: "boolean" }
        }
      },
      spendEnvelope: {
        type: "object",
        additionalProperties: false,
        properties: {
          currency: { type: "string" },
          maxPerCallCents: { type: "integer", minimum: 0 },
          maxTotalCents: { type: "integer", minimum: 0 }
        }
      },
      spendLimit: {
        type: "object",
        additionalProperties: false,
        description: "Alias accepted by runtime for spendEnvelope.",
        properties: {
          currency: { type: "string" },
          maxPerCallCents: { type: "integer", minimum: 0 },
          maxTotalCents: { type: "integer", minimum: 0 }
        }
      },
      chainBinding: {
        type: "object",
        additionalProperties: false,
        properties: {
          rootGrantHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          parentGrantHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
          depth: { type: "integer", minimum: 0 },
          maxDelegationDepth: { type: "integer", minimum: 0 }
        }
      },
      validity: {
        type: "object",
        additionalProperties: false,
        properties: {
          issuedAt: { type: "string", format: "date-time" },
          notBefore: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time" }
        }
      },
      revocation: {
        type: "object",
        additionalProperties: false,
        properties: {
          revocable: { type: "boolean" },
          revokedAt: { type: "string", format: "date-time", nullable: true },
          revocationReasonCode: { type: "string", nullable: true }
        }
      },
      metadata: { type: "object", additionalProperties: true }
    }
  };

  const AuthorityGrantRevokeRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      revocationReasonCode: { type: "string" },
      reasonCode: { type: "string", description: "Alias accepted by runtime for revocationReasonCode." }
    }
  };

  const CapabilityAttestationRuntime = {
    type: "object",
    additionalProperties: false,
    required: ["status", "isValid", "reasonCodes"],
    properties: {
      status: { type: "string", enum: ["valid", "expired", "not_active", "revoked", "invalid"] },
      isValid: { type: "boolean" },
      reasonCodes: { type: "array", items: { type: "string" } },
      message: { type: "string", nullable: true }
    }
  };

  const CapabilityAttestationV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "attestationId",
      "tenantId",
      "subjectAgentId",
      "capability",
      "level",
      "validity",
      "signature",
      "evidenceRefs",
      "revocation",
      "createdAt",
      "updatedAt",
      "revision",
      "attestationHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["CapabilityAttestation.v1"] },
      attestationId: { type: "string" },
      tenantId: { type: "string" },
      subjectAgentId: { type: "string" },
      capability: { type: "string" },
      level: { type: "string", enum: ["self_claim", "attested", "certified"] },
      issuerAgentId: { type: "string", nullable: true },
      validity: {
        type: "object",
        additionalProperties: false,
        required: ["issuedAt", "notBefore", "expiresAt"],
        properties: {
          issuedAt: { type: "string", format: "date-time" },
          notBefore: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time" }
        }
      },
      signature: {
        type: "object",
        additionalProperties: false,
        required: ["algorithm", "keyId", "signature"],
        properties: {
          algorithm: { type: "string", enum: ["ed25519"] },
          keyId: { type: "string" },
          signature: { type: "string" }
        }
      },
      verificationMethod: { type: "object", additionalProperties: true, nullable: true },
      evidenceRefs: { type: "array", items: { type: "string" } },
      revocation: {
        type: "object",
        additionalProperties: false,
        required: ["revokedAt", "reasonCode"],
        properties: {
          revokedAt: { type: "string", format: "date-time", nullable: true },
          reasonCode: { type: "string", nullable: true }
        }
      },
      metadata: { type: "object", nullable: true, additionalProperties: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      revision: { type: "integer", minimum: 0 },
      attestationHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const CapabilityAttestationCreateRequest = {
    type: "object",
    additionalProperties: false,
    required: ["subjectAgentId", "capability"],
    properties: {
      attestationId: { type: "string" },
      subjectAgentId: { type: "string" },
      capability: { type: "string" },
      level: { type: "string", enum: ["self_claim", "attested", "certified"] },
      issuerAgentId: { type: "string" },
      validity: {
        type: "object",
        additionalProperties: false,
        properties: {
          issuedAt: { type: "string", format: "date-time" },
          notBefore: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time" }
        }
      },
      signature: {
        type: "object",
        additionalProperties: false,
        required: ["keyId", "signature"],
        properties: {
          algorithm: { type: "string", enum: ["ed25519"] },
          keyId: { type: "string" },
          signature: { type: "string" }
        }
      },
      verificationMethod: { type: "object", additionalProperties: true },
      evidenceRefs: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true }
    }
  };

  const TrustRoutingFactorsV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "strategy", "weights", "factors", "signals"],
    properties: {
      schemaVersion: { type: "string", enum: ["TrustRoutingFactors.v1"] },
      strategy: { type: "string", enum: ["trust_weighted"] },
      weights: {
        type: "object",
        additionalProperties: false,
        required: ["settlementOutcome", "disputes", "capabilityAttestation", "relationshipHistory"],
        properties: {
          settlementOutcome: { type: "integer", minimum: 0, maximum: 100 },
          disputes: { type: "integer", minimum: 0, maximum: 100 },
          capabilityAttestation: { type: "integer", minimum: 0, maximum: 100 },
          relationshipHistory: { type: "integer", minimum: 0, maximum: 100 }
        }
      },
      factors: {
        type: "object",
        additionalProperties: false,
        required: ["settlementOutcomeScore", "disputeScore", "capabilityAttestationScore", "relationshipHistoryScore"],
        properties: {
          settlementOutcomeScore: { type: "integer", minimum: 0, maximum: 100 },
          disputeScore: { type: "integer", minimum: 0, maximum: 100 },
          capabilityAttestationScore: { type: "integer", minimum: 0, maximum: 100 },
          relationshipHistoryScore: { type: "integer", minimum: 0, maximum: 100 }
        }
      },
      signals: { type: "object", additionalProperties: true }
    }
  };

  function buildAgentCardDiscoveryResultV1() {
    return {
      type: "object",
      additionalProperties: false,
      required: ["ok", "schemaVersion", "scope", "reputationVersion", "reputationWindow", "scoreStrategy", "total", "limit", "offset", "results"],
      properties: {
        ok: { type: "boolean" },
        schemaVersion: { type: "string", enum: ["AgentCardDiscoveryResult.v1"] },
        scope: { type: "string", enum: ["tenant", "public"] },
        reputationVersion: { type: "string", enum: ["v1", "v2"] },
        reputationWindow: { type: "string", enum: ["7d", "30d", "allTime"] },
        scoreStrategy: { type: "string", enum: ["balanced", "recent_bias", "trust_weighted"] },
        total: { type: "integer" },
        limit: { type: "integer" },
        offset: { type: "integer" },
        results: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              rank: { type: "integer", minimum: 1 },
              rankingScore: { type: "integer", minimum: 0, maximum: 100 },
              riskTier: { type: "string", enum: ["low", "guarded", "elevated", "high"] },
              agentCard: AgentCardV1,
              reputation: AgentReputationAny,
              capabilityAttestation: { allOf: [CapabilityAttestationV1], nullable: true },
              routingFactors: { allOf: [TrustRoutingFactorsV1], nullable: true }
            }
          }
        },
        excludedAttestationCandidates: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["agentId", "capability", "reasonCode"],
            properties: {
              agentId: { type: "string" },
              capability: { type: "string", nullable: true },
              reasonCode: { type: "string" }
            }
          }
        },
        attestationPolicy: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "source", "minLevel", "issuerAgentId"],
          properties: {
            schemaVersion: { type: "string", enum: ["AgentCardPublicDiscoveryAttestationPolicy.v1"] },
            source: { type: "string", enum: ["public_discovery_policy"] },
            minLevel: { type: "string", enum: ["self_claim", "attested", "certified"], nullable: true },
            issuerAgentId: { type: "string", nullable: true }
          }
        }
      }
    };
  }

  const SubAgentWorkOrderPricingV1 = {
    type: "object",
    additionalProperties: false,
    required: ["model", "amountCents", "currency"],
    properties: {
      model: { type: "string", enum: ["fixed"] },
      amountCents: { type: "integer", minimum: 1 },
      currency: { type: "string" },
      quoteId: { type: "string", nullable: true }
    }
  };

  const SubAgentWorkOrderConstraintsV1 = {
    type: "object",
    additionalProperties: false,
    nullable: true,
    properties: {
      maxDurationSeconds: { type: "integer", minimum: 1, nullable: true },
      maxCostCents: { type: "integer", minimum: 0, nullable: true },
      retryLimit: { type: "integer", minimum: 0, nullable: true },
      deadlineAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const WorkOrderCapabilityAttestationRequirementV1 = {
    type: "object",
    additionalProperties: false,
    nullable: true,
    required: ["schemaVersion", "required", "minLevel", "issuerAgentId"],
    properties: {
      schemaVersion: { type: "string", enum: ["WorkOrderCapabilityAttestationRequirement.v1"] },
      required: { type: "boolean" },
      minLevel: { type: "string", enum: ["self_claim", "attested", "certified"], nullable: true },
      issuerAgentId: { type: "string", nullable: true }
    }
  };

  const WorkOrderSettlementEvidencePolicyRuleV1 = {
    type: "object",
    additionalProperties: false,
    required: ["minEvidenceRefs", "requiredKinds", "requireReceiptHashBinding"],
    properties: {
      minEvidenceRefs: { type: "integer", minimum: 0 },
      requiredKinds: {
        type: "array",
        items: { type: "string", enum: ["artifact", "hash", "verification_report", "execution_attestation"] }
      },
      requireReceiptHashBinding: { type: "boolean" }
    }
  };

  const WorkOrderSettlementEvidencePolicyV1 = {
    type: "object",
    additionalProperties: false,
    nullable: true,
    required: ["schemaVersion", "workOrderType", "release", "refund"],
    properties: {
      schemaVersion: { type: "string", enum: ["WorkOrderSettlementEvidencePolicy.v1"] },
      workOrderType: { type: "string" },
      release: WorkOrderSettlementEvidencePolicyRuleV1,
      refund: WorkOrderSettlementEvidencePolicyRuleV1
    }
  };

  const IntentBindingV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "intentId", "intentHash", "boundAt"],
    properties: {
      schemaVersion: { type: "string", enum: ["IntentBinding.v1"] },
      intentId: { type: "string" },
      intentHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      boundAt: { type: "string", format: "date-time" }
    }
  };

  const IntentContractV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "intentId",
      "tenantId",
      "proposerAgentId",
      "counterpartyAgentId",
      "objective",
      "budgetEnvelope",
      "requiredApprovals",
      "successCriteria",
      "terminationPolicy",
      "status",
      "proposedAt",
      "updatedAt",
      "revision",
      "intentHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["IntentContract.v1"] },
      intentId: { type: "string" },
      tenantId: { type: "string" },
      proposerAgentId: { type: "string" },
      counterpartyAgentId: { type: "string" },
      objective: {},
      constraints: { type: "object", additionalProperties: true, nullable: true },
      budgetEnvelope: {
        type: "object",
        additionalProperties: false,
        required: ["currency", "maxAmountCents", "hardCap"],
        properties: {
          currency: { type: "string" },
          maxAmountCents: { type: "integer", minimum: 0 },
          hardCap: { type: "boolean" }
        }
      },
      requiredApprovals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["approverRole", "minApprovals"],
          properties: {
            approverRole: { type: "string" },
            minApprovals: { type: "integer", minimum: 0 },
            reason: { type: "string", nullable: true }
          }
        }
      },
      successCriteria: { type: "object", additionalProperties: true },
      terminationPolicy: { type: "object", additionalProperties: true },
      counterOfIntentId: { type: "string", nullable: true },
      parentIntentHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
      status: { type: "string", enum: ["proposed", "countered", "accepted"] },
      acceptedByAgentId: { type: "string", nullable: true },
      acceptedAt: { type: "string", format: "date-time", nullable: true },
      proposedAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      revision: { type: "integer", minimum: 0 },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      intentHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const SubAgentWorkOrderProgressEventV1 = {
    type: "object",
    additionalProperties: false,
    required: ["progressId", "eventType", "evidenceRefs", "at"],
    properties: {
      progressId: { type: "string" },
      eventType: { type: "string" },
      message: { type: "string", nullable: true },
      percentComplete: { type: "integer", minimum: 0, maximum: 100, nullable: true },
      evidenceRefs: { type: "array", items: { type: "string" } },
      at: { type: "string", format: "date-time" }
    }
  };

  const SubAgentWorkOrderSettlementV1 = {
    type: "object",
    additionalProperties: false,
    nullable: true,
    required: ["status", "x402GateId", "x402RunId", "x402SettlementStatus", "completionReceiptId", "settledAt"],
    properties: {
      status: { type: "string", enum: ["released", "refunded"] },
      traceId: { type: "string", nullable: true },
      x402GateId: { type: "string" },
      x402RunId: { type: "string" },
      x402SettlementStatus: { type: "string" },
      x402ReceiptId: { type: "string", nullable: true },
      authorityGrantRef: { type: "string", nullable: true },
      completionReceiptId: { type: "string" },
      settledAt: { type: "string", format: "date-time" }
    }
  };

  const SubAgentWorkOrderV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "workOrderId",
      "tenantId",
      "principalAgentId",
      "subAgentId",
      "requiredCapability",
      "specification",
      "pricing",
      "status",
      "progressEvents",
      "createdAt",
      "updatedAt",
      "revision"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["SubAgentWorkOrder.v1"] },
      workOrderId: { type: "string" },
      tenantId: { type: "string" },
      parentTaskId: { type: "string", nullable: true },
      principalAgentId: { type: "string" },
      subAgentId: { type: "string" },
      requiredCapability: { type: "string" },
      traceId: { type: "string", nullable: true },
      x402ToolId: { type: "string", nullable: true },
      x402ProviderId: { type: "string", nullable: true },
      specification: { type: "object", additionalProperties: true },
      pricing: SubAgentWorkOrderPricingV1,
      constraints: SubAgentWorkOrderConstraintsV1,
      evidencePolicy: WorkOrderSettlementEvidencePolicyV1,
      attestationRequirement: WorkOrderCapabilityAttestationRequirementV1,
      delegationGrantRef: { type: "string", nullable: true },
      authorityGrantRef: { type: "string", nullable: true },
      authorityEnvelope: { ...AuthorityEnvelopeV1, nullable: true },
      approvalRequest: { ...ApprovalRequestV1, nullable: true },
      approvalDecision: { ...ApprovalDecisionV1, nullable: true },
      intentBinding: { allOf: [IntentBindingV1], nullable: true },
      status: {
        type: "string",
        enum: ["created", "accepted", "working", "completed", "failed", "settled", "cancelled", "disputed"]
      },
      progressEvents: { type: "array", items: SubAgentWorkOrderProgressEventV1 },
      acceptedByAgentId: { type: "string", nullable: true },
      acceptedAt: { type: "string", format: "date-time", nullable: true },
      completedAt: { type: "string", format: "date-time", nullable: true },
      completionReceiptId: { type: "string", nullable: true },
      settlement: SubAgentWorkOrderSettlementV1,
      metadata: { type: "object", additionalProperties: true, nullable: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      revision: { type: "integer", minimum: 0 }
    }
  };

  const ExecutionAttestationV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "attestationId", "workOrderId", "executionId", "attester", "evidenceHash", "attestedAt", "attestationHash"],
    properties: {
      schemaVersion: { type: "string", enum: ["ExecutionAttestation.v1"] },
      attestationId: { type: "string" },
      workOrderId: { type: "string" },
      executionId: { type: "string" },
      attester: { type: "string" },
      evidenceHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      attestedAt: { type: "string", format: "date-time" },
      runtime: { type: "object", additionalProperties: true, nullable: true },
      signerKeyId: { type: "string", nullable: true },
      signature: { type: "string", nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      attestationHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const SubAgentCompletionReceiptV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "receiptId",
      "tenantId",
      "workOrderId",
      "principalAgentId",
      "subAgentId",
      "status",
      "evidenceRefs",
      "settlementQuote",
      "deliveredAt",
      "receiptHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["SubAgentCompletionReceipt.v1"] },
      receiptId: { type: "string" },
      tenantId: { type: "string" },
      workOrderId: { type: "string" },
      principalAgentId: { type: "string" },
      subAgentId: { type: "string" },
      status: { type: "string", enum: ["success", "failed"] },
      traceId: { type: "string", nullable: true },
      outputs: {
        nullable: true,
        oneOf: [{ type: "object", additionalProperties: true }, { type: "array", items: { type: "object", additionalProperties: true } }]
      },
      metrics: { type: "object", additionalProperties: true, nullable: true },
      evidenceRefs: { type: "array", items: { type: "string" } },
      executionAttestation: { ...ExecutionAttestationV1, nullable: true },
      settlementQuote: {
        type: "object",
        additionalProperties: false,
        required: ["amountCents", "currency"],
        properties: {
          amountCents: { type: "integer", minimum: 0 },
          currency: { type: "string" }
        }
      },
      intentHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
      deliveredAt: { type: "string", format: "date-time" },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      receiptHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const WorkOrderReceiptDetailIssue = {
    type: "object",
    additionalProperties: false,
    required: ["code", "message"],
    properties: {
      code: { type: "string" },
      message: { type: "string" }
    }
  };

  const ActionReceiptOriginatingApprovalV1 = {
    type: "object",
    nullable: true,
    additionalProperties: false,
    properties: {
      approvalRequestRef: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          requestId: { type: "string" },
          requestHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
        }
      },
      approvalDecisionRef: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          decisionId: { type: "string" },
          decisionHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          approved: { type: "boolean" },
          decidedAt: { type: "string", format: "date-time", nullable: true }
        }
      }
    }
  };

  const ActionReceiptExecutionGrantRefV1 = {
    type: "object",
    nullable: true,
    additionalProperties: false,
    properties: {
      executionGrantId: { type: "string" },
      grantHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
      status: { type: "string", enum: ["pending", "approval_requested", "approved", "denied", "materialized"] },
      grantNonce: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
      workOrderId: { type: "string", nullable: true }
    }
  };

  const EvidenceBundleV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "executionGrantId", "evidenceRefs", "submittedAt", "evidenceBundleHash"],
    properties: {
      schemaVersion: { type: "string", enum: ["EvidenceBundle.v1"] },
      executionGrantId: { type: "string" },
      workOrderId: { type: "string", nullable: true },
      progressId: { type: "string", nullable: true },
      eventType: { type: "string", nullable: true },
      message: { type: "string", nullable: true },
      percentComplete: { type: "integer", minimum: 0, maximum: 100, nullable: true },
      evidenceRefs: { type: "array", items: { type: "string" } },
      executionAttestationRef: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          attestationId: { type: "string" },
          attestationHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
        }
      },
      at: { type: "string", format: "date-time", nullable: true },
      submittedAt: { type: "string", format: "date-time" },
      evidenceBundleHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const ActionReceiptEvidenceBundleV1 = {
    type: "object",
    nullable: true,
    additionalProperties: false,
    properties: {
      evidenceRefs: { type: "array", items: { type: "string" } },
      evidenceCount: { type: "integer", minimum: 0 },
      evidenceBundleHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      executionAttestationRef: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          attestationId: { type: "string" },
          attestationHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
        }
      }
    }
  };

  const ActionReceiptSettlementStateV1 = {
    type: "object",
    nullable: true,
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["locked", "released", "refunded"], nullable: true },
      providerStatus: { type: "string", nullable: true },
      runId: { type: "string", nullable: true },
      settlementId: { type: "string", nullable: true },
      receiptId: { type: "string", nullable: true },
      settledAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const ActionReceiptVerifierVerdictV1 = {
    type: "object",
    nullable: true,
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["pass", "fail", "insufficient", "operator_review", "attention_required"] },
      verificationStatus: { type: "string", enum: ["green", "amber", "red"], nullable: true },
      verifierRef: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          verifierId: { type: "string", nullable: true },
          verifierVersion: { type: "string", nullable: true },
          verifierHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
          modality: { type: "string", enum: ["deterministic", "attested", "discretionary"], nullable: true }
        }
      },
      reasonCodes: { type: "array", items: { type: "string" } }
    }
  };

  const ActionReceiptDisputeStateV1 = {
    type: "object",
    nullable: true,
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["none", "open", "closed"] },
      disputeId: { type: "string", nullable: true },
      caseId: { type: "string", nullable: true },
      openedAt: { type: "string", format: "date-time", nullable: true },
      closedAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const WorkOrderReceiptDetailV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "receiptId",
      "workOrderId",
      "traceId",
      "integrityStatus",
      "issues",
      "workOrder",
      "settlement",
      "intentBinding",
      "evidenceRefs",
      "executionAttestation",
      "originatingApproval",
      "executionGrantRef",
      "evidenceBundle",
      "settlementRecord",
      "settlementState",
      "verifierVerdict",
      "disputeState",
      "disputeDetail"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["WorkOrderReceiptDetail.v1"] },
      receiptId: { type: "string", nullable: true },
      workOrderId: { type: "string", nullable: true },
      traceId: { type: "string", nullable: true },
      integrityStatus: { type: "string", enum: ["verified", "attention_required"] },
      issues: { type: "array", items: WorkOrderReceiptDetailIssue },
      workOrder: { ...SubAgentWorkOrderV1, nullable: true },
      settlement: { ...SubAgentWorkOrderSettlementV1, nullable: true },
      intentBinding: { allOf: [IntentBindingV1], nullable: true },
      evidenceRefs: { type: "array", items: { type: "string" } },
      executionAttestation: { ...ExecutionAttestationV1, nullable: true },
      originatingApproval: ActionReceiptOriginatingApprovalV1,
      executionGrantRef: ActionReceiptExecutionGrantRefV1,
      evidenceBundle: ActionReceiptEvidenceBundleV1,
      settlementRecord: { type: "object", nullable: true, additionalProperties: true },
      settlementState: ActionReceiptSettlementStateV1,
      verifierVerdict: ActionReceiptVerifierVerdictV1,
      disputeState: ActionReceiptDisputeStateV1,
      disputeDetail: { type: "object", nullable: true, additionalProperties: true }
    }
  };

  const WorkOrderReceiptDetailResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "completionReceipt", "detail"],
    properties: {
      ok: { type: "boolean" },
      completionReceipt: SubAgentCompletionReceiptV1,
      detail: WorkOrderReceiptDetailV1
    }
  };

  const ActionIntentV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "actionIntentId", "status", "createdAt", "purpose", "principalRef", "actor", "authorityEnvelopeRef"],
    properties: {
      schemaVersion: { type: "string", enum: ["ActionIntent.v1"] },
      actionIntentId: { type: "string" },
      intentHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      status: {
        type: "string",
        enum: [
          "draft",
          "approval_required",
          "approved",
          "executing",
          "evidence_submitted",
          "verifying",
          "completed",
          "failed",
          "disputed",
          "refunded",
          "cancelled"
        ]
      },
      createdAt: { type: "string", format: "date-time", nullable: true },
      purpose: { type: "string" },
      principalRef: AuthorityEnvelopeV1.properties.principalRef,
      actor: AuthorityEnvelopeV1.properties.actor,
      capabilitiesRequested: { type: "array", items: { type: "string" } },
      dataClassesRequested: { type: "array", items: { type: "string" } },
      sideEffectsRequested: { type: "array", items: { type: "string" } },
      spendEnvelope: { ...AuthorityEnvelopeV1.properties.spendEnvelope, nullable: true },
      reversibilityClass: { type: "string", enum: ["reversible", "partially_reversible", "irreversible"], nullable: true },
      riskClass: { type: "string", enum: ["low", "medium", "high"], nullable: true },
      evidenceRequirements: { type: "array", items: { type: "string" } },
      authorityEnvelopeRef: ApprovalRequestV1.properties.envelopeRef,
      approvalRequestRef: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          requestId: { type: "string" },
          requestHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
        }
      },
      approvalUrl: { type: "string", nullable: true },
      host: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          channel: { type: "string", nullable: true },
          runtime: { type: "string", nullable: true },
          source: { type: "string", nullable: true }
        }
      }
    }
  };

  const ActionWalletApprovalStatus = {
    type: "string",
    enum: ["pending", "approved", "denied", "expired", "revoked"]
  };

  const ExecutionGrantV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "executionGrantId", "status"],
    properties: {
      schemaVersion: { type: "string", enum: ["ExecutionGrant.v1"] },
      executionGrantId: { type: "string" },
      grantHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
      status: { type: "string", enum: ["pending", "approval_requested", "approved", "denied", "materialized"] },
      createdAt: { type: "string", format: "date-time", nullable: true },
      principal: { ...AuthorityEnvelopeV1.properties.principalRef, nullable: true },
      actionType: { type: "string", enum: ["buy", "cancel/recover"], nullable: true },
      hostId: { type: "string", nullable: true },
      vendorOrDomainAllowlist: { type: "array", items: { type: "string" }, nullable: true },
      spendCap: { ...AuthorityEnvelopeV1.properties.spendEnvelope, nullable: true },
      expiresAt: { type: "string", format: "date-time", nullable: true },
      grantNonce: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
      delegationLineageRef: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          authorityEnvelopeRef: { ...ApprovalRequestV1.properties.envelopeRef, nullable: false },
          authorityGrantRef: { type: "string", nullable: true },
          delegationGrantRef: { type: "string", nullable: true },
          mayDelegate: { type: "boolean" },
          maxDepth: { type: "integer", minimum: 0 }
        }
      },
      workOrderId: { type: "string", nullable: true },
      requiredCapability: { type: "string", nullable: true },
      spendEnvelope: { ...AuthorityEnvelopeV1.properties.spendEnvelope, nullable: true },
      evidenceRequirements: { type: "array", items: { type: "string" } },
      authorityEnvelopeRef: { ...ApprovalRequestV1.properties.envelopeRef, nullable: true },
      approvalRequestRef: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          requestId: { type: "string" },
          requestHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
        }
      },
      approvalDecisionRef: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          decisionId: { type: "string" },
          decisionHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          approved: { type: "boolean" },
          decidedAt: { type: "string", format: "date-time", nullable: true }
        }
      },
      continuation: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          requestId: { type: "string", nullable: true },
          kind: { type: "string", nullable: true },
          status: { type: "string", nullable: true },
          route: {
            type: "object",
            nullable: true,
            additionalProperties: false,
            properties: {
              method: { type: "string", nullable: true },
              path: { type: "string", nullable: true }
            }
          },
          resume: { type: "object", additionalProperties: true, nullable: true },
          resultRef: { type: "object", additionalProperties: true, nullable: true }
        }
      }
    }
  };

  const ActionReceiptV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "receiptId", "workOrderId", "status", "receiptHash"],
    properties: {
      schemaVersion: { type: "string", enum: ["ActionReceipt.v1"] },
      receiptId: { type: "string" },
      workOrderId: { type: "string" },
      status: { type: "string", enum: ["success", "failed"] },
      deliveredAt: { type: "string", format: "date-time" },
      traceId: { type: "string", nullable: true },
      hostedReceiptUrl: { type: "string", nullable: true },
      hostedDisputeUrl: { type: "string", nullable: true },
      originatingApproval: ActionReceiptOriginatingApprovalV1,
      executionGrantRef: ActionReceiptExecutionGrantRefV1,
      evidenceBundle: ActionReceiptEvidenceBundleV1,
      evidenceRefs: { type: "array", items: { type: "string" } },
      executionAttestation: { ...ExecutionAttestationV1, nullable: true },
      receiptHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      settlementState: ActionReceiptSettlementStateV1,
      verifierVerdict: ActionReceiptVerifierVerdictV1,
      disputeState: ActionReceiptDisputeStateV1,
      settlement: { ...SubAgentWorkOrderSettlementV1, nullable: true },
      integrityStatus: { type: "string", enum: ["verified", "attention_required"], nullable: true },
      issues: { type: "array", items: WorkOrderReceiptDetailIssue }
    }
  };

  const DisputeCaseV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion"],
    properties: {
      schemaVersion: { type: "string", enum: ["DisputeCase.v1"] },
      disputeId: { type: "string", nullable: true },
      caseId: { type: "string", nullable: true },
      hostedDisputeUrl: { type: "string", nullable: true },
      status: {
        type: "string",
        enum: ["opened", "triaged", "awaiting_evidence", "refunded", "denied", "resolved"],
        nullable: true
      },
      openedAt: { type: "string", format: "date-time", nullable: true },
      settlementStatus: { type: "string", nullable: true },
      detail: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const ActionWalletTrustedHostAuthModelV1 = {
    type: "object",
    additionalProperties: false,
    required: ["type", "clientSecretConfigured"],
    properties: {
      type: { type: "string", enum: ["none", "client_secret", "bearer_token"] },
      clientSecretConfigured: { type: "boolean" },
      clientSecretLast4: { type: "string", nullable: true },
      keyId: { type: "string", nullable: true },
      lastIssuedAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const ActionWalletTrustedHostV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "hostId", "hostName", "channel", "runtime", "transport", "status", "approvalMode", "authModel", "createdAt", "updatedAt"],
    properties: {
      schemaVersion: { type: "string", enum: ["TrustedHostRegistryEntry.v1"] },
      hostId: { type: "string" },
      hostName: { type: "string" },
      channel: { type: "string", enum: ["Claude MCP", "OpenClaw"] },
      runtime: { type: "string", enum: ["claude-desktop", "openclaw"] },
      transport: { type: "string", enum: ["mcp"] },
      callbackUrls: { type: "array", items: { type: "string", format: "uri" } },
      environment: { type: "string", nullable: true },
      status: { type: "string", enum: ["active", "revoked"] },
      approvalMode: { type: "string", enum: ["hosted_link"] },
      docsPath: { type: "string", nullable: true },
      installCommand: { type: "string", nullable: true },
      authModel: ActionWalletTrustedHostAuthModelV1,
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const ActionWalletTrustedHostInstallRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      runtime: { type: "string", nullable: true },
      hostId: { type: "string", nullable: true },
      hostName: { type: "string", nullable: true },
      callbackUrls: { type: "array", items: { type: "string", format: "uri" }, nullable: true },
      environment: { type: "string", nullable: true },
      authModel: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["none", "client_secret", "bearer_token"], nullable: true },
          clientSecret: { type: "string", nullable: true, writeOnly: true },
          rotate: { type: "boolean", nullable: true }
        }
      }
    }
  };

  const SubAgentWorkOrderCreateRequest = {
    type: "object",
    additionalProperties: false,
    required: ["principalAgentId", "subAgentId", "requiredCapability", "pricing"],
    properties: {
      workOrderId: { type: "string" },
      parentTaskId: { type: "string" },
      principalAgentId: { type: "string" },
      subAgentId: { type: "string" },
      requiredCapability: { type: "string" },
      traceId: { type: "string", nullable: true },
      x402ToolId: { type: "string", nullable: true },
      x402ProviderId: { type: "string", nullable: true },
      specification: { type: "object", additionalProperties: true },
      pricing: SubAgentWorkOrderPricingV1,
      constraints: SubAgentWorkOrderConstraintsV1,
      evidencePolicy: WorkOrderSettlementEvidencePolicyV1,
      attestationRequirement: WorkOrderCapabilityAttestationRequirementV1,
      requireCapabilityAttestation: { type: "boolean", nullable: true },
      attestationMinLevel: { type: "string", enum: ["self_claim", "attested", "certified"], nullable: true },
      attestationIssuerAgentId: { type: "string", nullable: true },
      approvalMode: { type: "string", enum: ["detect", "require"], nullable: true },
      approvalPolicy: { ...X402HumanApprovalPolicyV1, nullable: true },
      approvalContinuation: { ...ApprovalContinuationOptions, nullable: true },
      authorityEnvelope: { ...AuthorityEnvelopeV1, nullable: true },
      approvalRequest: { ...ApprovalRequestV1, nullable: true },
      approvalDecision: { ...ApprovalDecisionV1, nullable: true },
      humanApprovalDecision: { ...X402HumanApprovalDecisionV1, nullable: true },
      delegationGrantRef: { type: "string" },
      authorityGrantRef: { type: "string" },
      intentBinding: {
        type: "object",
        additionalProperties: false,
        nullable: true,
        properties: {
          intentId: { type: "string" },
          intentHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
          boundAt: { type: "string", format: "date-time", nullable: true }
        }
      },
      metadata: { type: "object", additionalProperties: true }
    }
  };

  const SubAgentWorkOrderAcceptRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      acceptedByAgentId: { type: "string" },
      acceptedAt: { type: "string", format: "date-time" }
    }
  };

  const SubAgentWorkOrderProgressRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      progressId: { type: "string" },
      eventType: { type: "string" },
      message: { type: "string" },
      percentComplete: { type: "integer", minimum: 0, maximum: 100, nullable: true },
      evidenceRefs: { type: "array", items: { type: "string" } },
      at: { type: "string", format: "date-time" }
    }
  };

  const SubAgentWorkOrderCompleteRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      receiptId: { type: "string" },
      status: { type: "string", enum: ["success", "failed"] },
      outputs: { type: "object", additionalProperties: true },
      metrics: { type: "object", additionalProperties: true },
      evidenceRefs: { type: "array", items: { type: "string" } },
      executionAttestation: { ...ExecutionAttestationV1, nullable: true },
      amountCents: { type: "integer", minimum: 0, nullable: true },
      currency: { type: "string", nullable: true },
      intentHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
      traceId: { type: "string", nullable: true },
      deliveredAt: { type: "string", format: "date-time" },
      completedAt: { type: "string", format: "date-time" },
      metadata: { type: "object", additionalProperties: true }
    }
  };

  const SubAgentWorkOrderSettleRequest = {
    type: "object",
    additionalProperties: false,
    required: ["x402GateId", "x402RunId"],
    properties: {
      completionReceiptId: { type: "string" },
      status: { type: "string", enum: ["released", "refunded"] },
      x402GateId: { type: "string" },
      x402RunId: { type: "string" },
      x402SettlementStatus: { type: "string" },
      x402ReceiptId: { type: "string" },
      completionReceiptHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      intentHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      traceId: { type: "string", nullable: true },
      authorityGrantRef: { type: "string" },
      settledAt: { type: "string", format: "date-time" }
    }
  };

  const IntentContractProposeRequest = {
    type: "object",
    additionalProperties: false,
    required: ["proposerAgentId", "counterpartyAgentId", "objective", "budgetEnvelope"],
    properties: {
      intentId: { type: "string" },
      proposerAgentId: { type: "string" },
      counterpartyAgentId: { type: "string" },
      objective: {},
      constraints: { type: "object", additionalProperties: true, nullable: true },
      budgetEnvelope: { type: "object", additionalProperties: true },
      requiredApprovals: { type: "array", items: { type: "object", additionalProperties: true }, nullable: true },
      successCriteria: { type: "object", additionalProperties: true, nullable: true },
      terminationPolicy: { type: "object", additionalProperties: true, nullable: true },
      proposedAt: { type: "string", format: "date-time", nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const IntentContractCounterRequest = {
    type: "object",
    additionalProperties: false,
    required: ["proposerAgentId"],
    properties: {
      intentId: { type: "string", nullable: true },
      proposerAgentId: { type: "string" },
      parentIntentHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
      objective: { nullable: true },
      constraints: { type: "object", additionalProperties: true, nullable: true },
      budgetEnvelope: { type: "object", additionalProperties: true, nullable: true },
      requiredApprovals: { type: "array", items: { type: "object", additionalProperties: true }, nullable: true },
      successCriteria: { type: "object", additionalProperties: true, nullable: true },
      terminationPolicy: { type: "object", additionalProperties: true, nullable: true },
      proposedAt: { type: "string", format: "date-time", nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const IntentContractAcceptRequest = {
    type: "object",
    additionalProperties: false,
    required: ["acceptedByAgentId"],
    properties: {
      acceptedByAgentId: { type: "string" },
      acceptedAt: { type: "string", format: "date-time", nullable: true },
      intentHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true }
    }
  };

  const MeterV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "meterId",
      "workOrderId",
      "meterType",
      "sourceType",
      "quantity",
      "amountCents",
      "occurredAt",
      "recordedAt",
      "meterHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["Meter.v1"] },
      meterId: { type: "string" },
      workOrderId: { type: "string" },
      meterType: { type: "string", enum: ["topup", "usage"] },
      sourceType: { type: "string", enum: ["work_order_meter_topup", "work_order_meter_usage"] },
      eventType: { type: "string", nullable: true },
      sourceEventId: { type: "string", nullable: true },
      quantity: { type: "integer", minimum: 0 },
      amountCents: { type: "integer", minimum: 0 },
      currency: { type: "string", nullable: true },
      occurredAt: { type: "string", format: "date-time" },
      recordedAt: { type: "string", format: "date-time" },
      period: { type: "string", nullable: true },
      eventHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      meterHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const WorkOrderMeteringSnapshotV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "meterSchemaVersion", "workOrderId", "summary", "meterCount", "meterDigest", "meters"],
    properties: {
      schemaVersion: { type: "string", enum: ["WorkOrderMeteringSnapshot.v1"] },
      meterSchemaVersion: { type: "string", enum: ["Meter.v1"] },
      workOrderId: { type: "string" },
      policy: { type: "object", additionalProperties: true, nullable: true },
      summary: {
        type: "object",
        additionalProperties: false,
        required: ["baseAmountCents", "topUpTotalCents", "usageTotalCents", "coveredAmountCents", "maxCostCents", "remainingCents"],
        properties: {
          baseAmountCents: { type: "integer", minimum: 0 },
          topUpTotalCents: { type: "integer", minimum: 0 },
          usageTotalCents: { type: "integer", minimum: 0 },
          coveredAmountCents: { type: "integer", minimum: 0 },
          maxCostCents: { type: "integer", minimum: 0, nullable: true },
          remainingCents: { type: "integer", minimum: 0, nullable: true }
        }
      },
      meterCount: { type: "integer", minimum: 0 },
      meterDigest: { type: "string", pattern: "^[0-9a-f]{64}$" },
      meters: { type: "array", items: MeterV1 }
    }
  };

  const SubAgentWorkOrderTopUpRequest = {
    type: "object",
    additionalProperties: false,
    required: ["topUpId", "amountCents"],
    properties: {
      topUpId: { type: "string" },
      amountCents: { type: "integer", minimum: 1 },
      quantity: { type: "integer", minimum: 1, nullable: true },
      currency: { type: "string", nullable: true },
      eventKey: { type: "string", nullable: true },
      occurredAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const AgentPassportV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "passportId",
      "agentId",
      "tenantId",
      "principalRef",
      "identityAnchors",
      "delegationRoot",
      "policyEnvelope",
      "status",
      "createdAt",
      "updatedAt",
      "sponsorRef",
      "agentKeyId",
      "delegationRef",
      "lineageRequired"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["AgentPassport.v1"] },
      passportId: { type: "string" },
      agentId: { type: "string" },
      tenantId: { type: "string" },
      principalRef: {
        type: "object",
        additionalProperties: false,
        required: ["principalType", "principalId"],
        properties: {
          principalType: { type: "string", enum: ["human", "business", "service", "dao"] },
          principalId: { type: "string" },
          jurisdiction: { type: "string" }
        }
      },
      identityAnchors: {
        type: "object",
        additionalProperties: false,
        required: ["jwksUri", "activeKeyId", "keysetHash"],
        properties: {
          did: { type: "string" },
          jwksUri: { type: "string", format: "uri" },
          activeKeyId: { type: "string" },
          keysetHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
        }
      },
      delegationRoot: {
        type: "object",
        additionalProperties: false,
        required: ["rootGrantId", "rootGrantHash", "issuedAt"],
        properties: {
          rootGrantId: { type: "string" },
          rootGrantHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          issuedAt: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time", nullable: true },
          revokedAt: { type: "string", format: "date-time", nullable: true }
        }
      },
      capabilityCredentials: { type: "array", items: { type: "object", additionalProperties: true } },
      policyEnvelope: {
        type: "object",
        additionalProperties: false,
        required: ["maxPerCallCents", "maxDailyCents", "allowedRiskClasses"],
        properties: {
          maxPerCallCents: { type: "integer", minimum: 0 },
          maxDailyCents: { type: "integer", minimum: 0 },
          allowedRiskClasses: { type: "array", items: { type: "string", enum: ["read", "compute", "action", "financial"] } },
          requireApprovalAboveCents: { type: "integer", minimum: 0, nullable: true },
          allowlistRefs: { type: "array", items: { type: "string" } }
        }
      },
      status: { type: "string", enum: ["active", "suspended", "revoked"] },
      metadata: { type: "object", nullable: true, additionalProperties: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      sponsorRef: { type: "string" },
      sponsorWalletRef: { type: "string" },
      agentKeyId: { type: "string" },
      delegationRef: { type: "string" },
      policyRef: { type: "string" },
      policyVersion: { type: "integer", minimum: 1 },
      delegationDepth: { type: "integer", minimum: 0 },
      maxDelegationDepth: { type: "integer", minimum: 0 },
      expiresAt: { type: "string", format: "date-time" },
      lineageRequired: { type: "boolean" }
    }
  };

  const AgentPassportUpsertRequest = {
    type: "object",
    additionalProperties: false,
    required: ["agentPassport"],
    properties: {
      agentPassport: AgentPassportV1
    }
  };

  const AgentPassportRevokeRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      revokedAt: { type: "string", format: "date-time", nullable: true },
      reasonCode: { type: "string" },
      reason: { type: "string" }
    }
  };

  const ToolCallAgreementV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "toolId",
      "manifestHash",
      "callId",
      "inputHash",
      "acceptanceCriteria",
      "settlementTerms",
      "payerAgentId",
      "payeeAgentId",
      "createdAt",
      "agreementHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["ToolCallAgreement.v1"] },
      toolId: { type: "string" },
      manifestHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      callId: { type: "string" },
      inputHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      acceptanceCriteria: { type: "object", nullable: true, additionalProperties: true },
      settlementTerms: { type: "object", nullable: true, additionalProperties: true },
      payerAgentId: { type: "string", nullable: true },
      payeeAgentId: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      agreementHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const ToolCallEvidenceV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "agreementHash",
      "callId",
      "inputHash",
      "outputHash",
      "outputRef",
      "metrics",
      "startedAt",
      "completedAt",
      "createdAt",
      "evidenceHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["ToolCallEvidence.v1"] },
      agreementHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      callId: { type: "string" },
      inputHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      outputHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      outputRef: { type: "string", nullable: true },
      metrics: { type: "object", nullable: true, additionalProperties: true },
      startedAt: { type: "string", format: "date-time" },
      completedAt: { type: "string", format: "date-time" },
      createdAt: { type: "string", format: "date-time" },
      evidenceHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      signature: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        required: ["algorithm", "signerKeyId", "evidenceHash", "signature"],
        properties: {
          algorithm: { type: "string", enum: ["ed25519"] },
          signerKeyId: { type: "string" },
          evidenceHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          signature: { type: "string" }
        }
      }
    }
  };

  const AgentRunV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "runId", "agentId", "tenantId", "status", "createdAt", "updatedAt"],
    properties: {
      schemaVersion: { type: "string", enum: ["AgentRun.v1"] },
      runId: { type: "string" },
      agentId: { type: "string" },
      tenantId: { type: "string" },
      taskType: { type: "string", nullable: true },
      inputRef: { type: "string", nullable: true },
      status: { type: "string", enum: ["created", "running", "completed", "failed"] },
      evidenceRefs: { type: "array", items: { type: "string" } },
      actionRequired: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          code: { type: "string" },
          title: { type: "string", nullable: true },
          detail: { type: "string", nullable: true },
          requestedFields: { type: "array", items: { type: "string" } },
          requestedEvidenceKinds: { type: "array", items: { type: "string" } },
          requestedAt: { type: "string", format: "date-time" }
        }
      },
      metrics: { type: "object", nullable: true, additionalProperties: true },
      failure: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          code: { type: "string", nullable: true },
          message: { type: "string", nullable: true }
        }
      },
      startedAt: { type: "string", format: "date-time", nullable: true },
      completedAt: { type: "string", format: "date-time", nullable: true },
      failedAt: { type: "string", format: "date-time", nullable: true },
      lastEventId: { type: "string", nullable: true },
      lastChainHash: { type: "string", nullable: true },
      revision: { type: "integer", minimum: 0 },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const AgentEventV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "v", "id", "streamId", "type", "at", "actor", "payload"],
    properties: {
      schemaVersion: { type: "string", enum: ["AgentEvent.v1"] },
      v: { type: "integer", enum: [1] },
      id: { type: "string" },
      streamId: { type: "string" },
      type: {
        type: "string",
        enum: ["RUN_CREATED", "RUN_STARTED", "RUN_ACTION_REQUIRED", "RUN_HEARTBEAT", "EVIDENCE_ADDED", "RUN_COMPLETED", "RUN_FAILED"]
      },
      at: { type: "string", format: "date-time" },
      actor: { type: "object", additionalProperties: true },
      payload: { type: "object", additionalProperties: true },
      payloadHash: { type: "string", nullable: true },
      prevChainHash: { type: "string", nullable: true },
      chainHash: { type: "string", nullable: true },
      signature: { type: "string", nullable: true },
      signerKeyId: { type: "string", nullable: true }
    }
  };

  const AgentRunCreateRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      runId: { type: "string" },
      taskType: { type: "string" },
      inputRef: { type: "string" },
      settlement: {
        type: "object",
        additionalProperties: false,
        required: ["payerAgentId", "amountCents"],
        properties: {
          payerAgentId: { type: "string" },
          amountCents: { type: "integer", minimum: 1 },
          currency: { type: "string" }
        }
      }
    }
  };

  const AgentRunEventAppendRequest = {
    type: "object",
    additionalProperties: false,
    required: ["type", "payload"],
    properties: {
      type: { type: "string", enum: ["RUN_STARTED", "RUN_ACTION_REQUIRED", "RUN_HEARTBEAT", "EVIDENCE_ADDED", "RUN_COMPLETED", "RUN_FAILED"] },
      at: { type: "string", format: "date-time" },
      actor: { type: "object", additionalProperties: true },
      payload: { type: "object", additionalProperties: true }
    }
  };

  const RunActionRequiredResponseArtifactV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "artifactType",
      "artifactId",
      "artifactHash",
      "tenantId",
      "runId",
      "actionRequiredCode",
      "requestedAt",
      "respondedAt",
      "requestedFields",
      "requestedEvidenceKinds",
      "providedFields",
      "providedEvidenceKinds",
      "evidenceRefs"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["RunActionRequiredResponseArtifact.v1"] },
      artifactType: { type: "string", enum: ["RunActionRequiredResponseArtifact.v1"] },
      artifactId: { type: "string" },
      artifactHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      tenantId: { type: "string" },
      runId: { type: "string" },
      agentId: { type: "string", nullable: true },
      actionRequiredCode: { type: "string" },
      requestedAt: { type: "string", format: "date-time" },
      respondedAt: { type: "string", format: "date-time" },
      requestedFields: { type: "array", items: { type: "string" } },
      requestedEvidenceKinds: { type: "array", items: { type: "string" } },
      providedFields: { type: "object", additionalProperties: true },
      providedEvidenceKinds: { type: "array", items: { type: "string" } },
      evidenceRefs: { type: "array", items: { type: "string" } },
      note: { type: "string", nullable: true },
      respondedByPrincipalId: { type: "string", nullable: true }
    }
  };

  const ArtifactRefV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "artifactId", "artifactHash"],
    properties: {
      schemaVersion: { type: "string", enum: ["ArtifactRef.v1"] },
      artifactId: { type: "string" },
      artifactHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      artifactType: { type: "string", nullable: true },
      tenantId: { type: "string", nullable: true },
      metadata: { type: "object", nullable: true, additionalProperties: true }
    }
  };

  const RunActionRequiredRespondRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      providedFields: { type: "object", additionalProperties: true },
      providedEvidenceKinds: { type: "array", items: { type: "string" } },
      evidenceRefs: { type: "array", items: { type: "string" } },
      note: { type: "string" },
      respondedAt: { type: "string", format: "date-time" }
    }
  };

  const RunActionRequiredRespondResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "run", "verification", "events", "responseArtifact", "responseArtifactRef", "responseEvidenceRef"],
    properties: {
      ok: { type: "boolean", enum: [true] },
      run: AgentRunV1,
      verification: { type: "object", additionalProperties: true },
      events: { type: "array", items: AgentEventV1 },
      responseArtifact: RunActionRequiredResponseArtifactV1,
      responseArtifactRef: ArtifactRefV1,
      responseEvidenceRef: { type: "string" }
    }
  };

  const AgentWalletV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "walletId",
      "agentId",
      "tenantId",
      "currency",
      "availableCents",
      "escrowLockedCents",
      "totalDebitedCents",
      "totalCreditedCents",
      "revision",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["AgentWallet.v1"] },
      walletId: { type: "string" },
      agentId: { type: "string" },
      tenantId: { type: "string" },
      currency: { type: "string" },
      availableCents: { type: "integer", minimum: 0 },
      escrowLockedCents: { type: "integer", minimum: 0 },
      totalDebitedCents: { type: "integer", minimum: 0 },
      totalCreditedCents: { type: "integer", minimum: 0 },
      revision: { type: "integer", minimum: 0 },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const AgentRunSettlementV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "settlementId",
      "runId",
      "tenantId",
      "agentId",
      "payerAgentId",
      "amountCents",
      "currency",
      "status",
      "lockedAt",
      "revision",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["AgentRunSettlement.v1"] },
      settlementId: { type: "string" },
      runId: { type: "string" },
      tenantId: { type: "string" },
      agentId: { type: "string" },
      payerAgentId: { type: "string" },
      amountCents: { type: "integer", minimum: 1 },
      currency: { type: "string" },
      status: { type: "string", enum: ["locked", "released", "refunded"] },
      lockedAt: { type: "string", format: "date-time" },
      resolvedAt: { type: "string", format: "date-time", nullable: true },
      resolutionEventId: { type: "string", nullable: true },
      runStatus: { type: "string", nullable: true },
      releasedAmountCents: { type: "integer", minimum: 0 },
      refundedAmountCents: { type: "integer", minimum: 0 },
      releaseRatePct: { type: "integer", minimum: 0, maximum: 100, nullable: true },
      disputeWindowDays: { type: "integer", minimum: 0 },
      disputeWindowEndsAt: { type: "string", format: "date-time", nullable: true },
      disputeStatus: { type: "string", enum: ["none", "open", "closed"], nullable: true },
      disputeId: { type: "string", nullable: true },
      disputeOpenedAt: { type: "string", format: "date-time", nullable: true },
      disputeClosedAt: { type: "string", format: "date-time", nullable: true },
      disputeVerdictId: { type: "string", nullable: true },
      disputeVerdictHash: { type: "string", nullable: true },
      disputeVerdictArtifactId: { type: "string", nullable: true },
      disputeVerdictSignerKeyId: { type: "string", nullable: true },
      disputeVerdictIssuedAt: { type: "string", format: "date-time", nullable: true },
      disputeContext: {
        type: "object",
        additionalProperties: false,
        nullable: true,
        properties: {
          type: { type: "string", enum: ["quality", "delivery", "fraud", "policy", "payment", "other"] },
          priority: { type: "string", enum: ["low", "normal", "high", "critical"] },
          channel: { type: "string", enum: ["counterparty", "policy_engine", "arbiter", "external"] },
          escalationLevel: { type: "string", enum: ["l1_counterparty", "l2_arbiter", "l3_external"] },
          openedByAgentId: { type: "string", nullable: true },
          reason: { type: "string", nullable: true },
          evidenceRefs: { type: "array", items: { type: "string" } }
        }
      },
      disputeResolution: {
        type: "object",
        additionalProperties: false,
        nullable: true,
        properties: {
          outcome: { type: "string", enum: ["accepted", "rejected", "partial", "withdrawn", "unresolved"] },
          escalationLevel: { type: "string", enum: ["l1_counterparty", "l2_arbiter", "l3_external"] },
          closedByAgentId: { type: "string", nullable: true },
          summary: { type: "string", nullable: true },
          closedAt: { type: "string", format: "date-time", nullable: true },
          releaseRatePct: { type: "integer", minimum: 0, maximum: 100, nullable: true },
          evidenceRefs: { type: "array", items: { type: "string" } }
        }
      },
      decisionStatus: {
        type: "string",
        enum: ["pending", "auto_resolved", "manual_review_required", "manual_resolved"],
        nullable: true
      },
      decisionMode: { type: "string", enum: ["automatic", "manual-review"], nullable: true },
      decisionPolicyHash: { type: "string", nullable: true },
      decisionReason: { type: "string", nullable: true },
      decisionTrace: { type: "object", additionalProperties: true, nullable: true },
      decisionUpdatedAt: { type: "string", format: "date-time", nullable: true },
      revision: { type: "integer", minimum: 0 },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const SettlementDecisionRecordV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "decisionId",
      "tenantId",
      "runId",
      "settlementId",
      "decisionStatus",
      "decisionMode",
      "policyRef",
      "verifierRef",
      "workRef",
      "decidedAt",
      "decisionHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["SettlementDecisionRecord.v1"] },
      decisionId: { type: "string" },
      tenantId: { type: "string" },
      runId: { type: "string" },
      settlementId: { type: "string" },
      agreementId: { type: "string", nullable: true },
      decisionStatus: { type: "string", enum: ["pending", "auto_resolved", "manual_review_required", "manual_resolved"] },
      decisionMode: { type: "string", enum: ["automatic", "manual-review"] },
      decisionReason: { type: "string", nullable: true },
      verificationStatus: { type: "string", enum: ["green", "amber", "red"], nullable: true },
      policyRef: {
        type: "object",
        additionalProperties: false,
        required: ["policyHash", "verificationMethodHash"],
        properties: {
          policyHash: { type: "string", nullable: true },
          verificationMethodHash: { type: "string", nullable: true }
        }
      },
      verifierRef: {
        type: "object",
        additionalProperties: false,
        required: ["verifierId", "verifierVersion", "verifierHash", "modality"],
        properties: {
          verifierId: { type: "string", nullable: true },
          verifierVersion: { type: "string", nullable: true },
          verifierHash: { type: "string", nullable: true },
          modality: { type: "string", enum: ["deterministic", "attested", "discretionary"], nullable: true }
        }
      },
      workRef: {
        type: "object",
        additionalProperties: false,
        required: ["runStatus", "runLastEventId", "runLastChainHash", "resolutionEventId"],
        properties: {
          runStatus: { type: "string", nullable: true },
          runLastEventId: { type: "string", nullable: true },
          runLastChainHash: { type: "string", nullable: true },
          resolutionEventId: { type: "string", nullable: true }
        }
      },
      decidedAt: { type: "string", format: "date-time" },
      decisionHash: { type: "string" }
    }
  };

  const SettlementDecisionRecordV2 = {
    ...SettlementDecisionRecordV1,
    required: [...SettlementDecisionRecordV1.required, "policyHashUsed"],
    properties: {
      ...SettlementDecisionRecordV1.properties,
      schemaVersion: { type: "string", enum: ["SettlementDecisionRecord.v2"] },
      policyNormalizationVersion: { type: "string" },
      policyHashUsed: { type: "string" },
      verificationMethodHashUsed: { type: "string" }
    }
  };

  const SettlementDecisionRecordAny = {
    oneOf: [SettlementDecisionRecordV1, SettlementDecisionRecordV2]
  };

  const SettlementReceiptV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "receiptId",
      "tenantId",
      "runId",
      "settlementId",
      "decisionRef",
      "status",
      "amountCents",
      "releasedAmountCents",
      "refundedAmountCents",
      "releaseRatePct",
      "currency",
      "runStatus",
      "resolutionEventId",
      "finalityProvider",
      "finalityState",
      "settledAt",
      "createdAt",
      "receiptHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["SettlementReceipt.v1"] },
      receiptId: { type: "string" },
      tenantId: { type: "string" },
      runId: { type: "string" },
      settlementId: { type: "string" },
      decisionRef: {
        type: "object",
        additionalProperties: false,
        required: ["decisionId", "decisionHash"],
        properties: {
          decisionId: { type: "string" },
          decisionHash: { type: "string" }
        }
      },
      status: { type: "string", enum: ["locked", "released", "refunded"] },
      amountCents: { type: "integer", minimum: 1 },
      releasedAmountCents: { type: "integer", minimum: 0 },
      refundedAmountCents: { type: "integer", minimum: 0 },
      releaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
      currency: { type: "string" },
      runStatus: { type: "string", nullable: true },
      resolutionEventId: { type: "string", nullable: true },
      finalityProvider: { type: "string", enum: ["internal_ledger"] },
      finalityState: { type: "string", enum: ["pending", "final"] },
      settledAt: { type: "string", format: "date-time", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      receiptHash: { type: "string" }
    }
  };

  const SettlementKernelVerification = {
    type: "object",
    additionalProperties: false,
    required: ["valid", "errors"],
    properties: {
      valid: { type: "boolean" },
      errors: { type: "array", items: { type: "string" } },
      decisionRecord: { ...SettlementDecisionRecordAny, nullable: true },
      settlementReceipt: { allOf: [SettlementReceiptV1], nullable: true }
    }
  };

  const RunDetailIssue = {
    type: "object",
    additionalProperties: false,
    required: ["code", "message"],
    properties: {
      code: { type: "string" },
      message: { type: "string" }
    }
  };

  const RunTimelineEntryV1 = {
    type: "object",
    additionalProperties: false,
    required: ["eventId", "eventType", "occurredAt", "label", "category"],
    properties: {
      eventId: { type: "string" },
      eventType: { type: "string" },
      occurredAt: { type: "string", format: "date-time" },
      label: { type: "string" },
      summary: { type: "string", nullable: true },
      status: { type: "string", nullable: true },
      category: { type: "string" },
      refs: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const RunSettlementDetailPacket = {
    type: "object",
    additionalProperties: false,
    required: ["settlement", "decisionRecord", "settlementReceipt", "kernelVerification"],
    properties: {
      settlement: { ...AgentRunSettlementV1, nullable: true },
      decisionRecord: { ...SettlementDecisionRecordAny, nullable: true },
      settlementReceipt: { ...SettlementReceiptV1, nullable: true },
      kernelVerification: { ...SettlementKernelVerification, nullable: true }
    }
  };

  const RunArbitrationSummaryV1 = {
    type: "object",
    additionalProperties: false,
    required: ["caseCount", "openCaseCount", "latestCaseId", "latestCaseStatus", "latestCaseUpdatedAt", "cases"],
    properties: {
      caseCount: { type: "integer", minimum: 0 },
      openCaseCount: { type: "integer", minimum: 0 },
      latestCaseId: { type: "string", nullable: true },
      latestCaseStatus: { type: "string", nullable: true },
      latestCaseUpdatedAt: { type: "string", format: "date-time", nullable: true },
      cases: { type: "array", items: { type: "object", additionalProperties: true } }
    }
  };

  const TaskWalletV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "walletId",
      "tenantId",
      "launchId",
      "taskId",
      "rfqId",
      "ownerAgentId",
      "categoryId",
      "currency",
      "maxSpendCents",
      "allowedMerchantScopes",
      "allowedSpecialistProfileIds",
      "allowedProviderIds",
      "reviewMode",
      "evidenceRequirements",
      "delegationPolicy",
      "settlementPolicy",
      "fundingSourceLabel",
      "expiresAt",
      "createdAt",
      "walletHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["TaskWallet.v1"] },
      walletId: { type: "string" },
      tenantId: { type: "string" },
      launchId: { type: "string" },
      taskId: { type: "string" },
      rfqId: { type: "string" },
      ownerAgentId: { type: "string" },
      categoryId: { type: "string", nullable: true },
      currency: { type: "string" },
      maxSpendCents: { type: "integer", minimum: 1, nullable: true },
      allowedMerchantScopes: { type: "array", items: { type: "string" } },
      allowedSpecialistProfileIds: { type: "array", items: { type: "string" } },
      allowedProviderIds: { type: "array", items: { type: "string" } },
      reviewMode: {
        type: "string",
        enum: ["autonomous_within_envelope", "approval_at_boundary", "human_required", "operator_supervised"]
      },
      evidenceRequirements: { type: "array", items: { type: "string" } },
      delegationPolicy: {
        type: "object",
        additionalProperties: false,
        required: ["allowManagedSpecialists", "allowOpenMarketplace", "maxDepth"],
        properties: {
          allowManagedSpecialists: { type: "boolean" },
          allowOpenMarketplace: { type: "boolean" },
          maxDepth: { type: "integer", minimum: 0 }
        }
      },
      settlementPolicy: {
        type: "object",
        additionalProperties: false,
        required: ["settlementModel", "requireEvidenceBeforeFinalize", "allowRefunds"],
        properties: {
          settlementModel: { type: "string" },
          requireEvidenceBeforeFinalize: { type: "boolean" },
          allowRefunds: { type: "boolean" }
        }
      },
      fundingSourceLabel: { type: "string", nullable: true },
      expiresAt: { type: "string", format: "date-time", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      walletHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const TaskWalletSpendPlanV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "walletId",
      "tenantId",
      "categoryId",
      "consumerSpendRail",
      "platformSettlementRail",
      "machineSpendRail",
      "authorizationPattern",
      "finalizationRule",
      "refundMode",
      "merchantScopeCount",
      "specialistScopeCount",
      "providerScopeCount",
      "maxSpendCents",
      "currency",
      "reviewMode",
      "settlementModel"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["TaskWalletSpendPlan.v1"] },
      walletId: { type: "string" },
      tenantId: { type: "string" },
      categoryId: { type: "string", nullable: true },
      consumerSpendRail: { type: "string", enum: ["stripe_issuing_task_wallet", "no_direct_consumer_spend"] },
      platformSettlementRail: { type: "string", enum: ["stripe_connect_marketplace_split"] },
      machineSpendRail: { type: "string", enum: ["x402_optional_later"] },
      authorizationPattern: {
        type: "string",
        enum: ["task_scoped_virtual_card", "approval_at_boundary", "operator_supervised_checkout", "no_direct_consumer_spend"]
      },
      finalizationRule: { type: "string", enum: ["evidence_required_before_finalize", "platform_finalize_without_evidence"] },
      refundMode: { type: "string", enum: ["platform_refund_and_dispute", "no_refunds"] },
      merchantScopeCount: { type: "integer", minimum: 0 },
      specialistScopeCount: { type: "integer", minimum: 0 },
      providerScopeCount: { type: "integer", minimum: 0 },
      maxSpendCents: { type: "integer", minimum: 1, nullable: true },
      currency: { type: "string", nullable: true },
      reviewMode: { type: "string", nullable: true },
      settlementModel: { type: "string", nullable: true }
    }
  };

  const RunDetailV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "runId",
      "integrityStatus",
      "issues",
      "run",
      "events",
      "verification",
      "linkedTask",
      "agreement",
      "settlement",
      "arbitration",
      "timeline"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["RunDetail.v1"] },
      runId: { type: "string" },
      integrityStatus: { type: "string", enum: ["verified", "attention_required"] },
      issues: { type: "array", items: RunDetailIssue },
      run: AgentRunV1,
      events: { type: "array", items: AgentEventV1 },
      verification: { type: "object", additionalProperties: true, nullable: true },
      taskWallet: { ...TaskWalletV1, nullable: true },
      taskWalletSpendPlan: { ...TaskWalletSpendPlanV1, nullable: true },
      linkedTask: { type: "object", additionalProperties: true, nullable: true },
      agreement: { type: "object", additionalProperties: true, nullable: true },
      managedExecution: { type: "object", additionalProperties: true, nullable: true },
      settlement: RunSettlementDetailPacket,
      arbitration: RunArbitrationSummaryV1,
      timeline: { type: "array", items: RunTimelineEntryV1 }
    }
  };

  const RunDetailResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "detail"],
    properties: {
      ok: { type: "boolean" },
      detail: RunDetailV1
    }
  };

  const RunManagedExecutionHandoffResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "result"],
    properties: {
      ok: { type: "boolean" },
      result: { type: "object", additionalProperties: true }
    }
  };

  const AgentReputationV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "agentId",
      "tenantId",
      "trustScore",
      "riskTier",
      "totalRuns",
      "terminalRuns",
      "createdRuns",
      "runningRuns",
      "completedRuns",
      "failedRuns",
      "runsWithEvidence",
      "totalSettlements",
      "lockedSettlements",
      "releasedSettlements",
      "refundedSettlements",
      "runCompletionRatePct",
      "evidenceCoverageRatePct",
      "settlementReleaseRatePct",
      "avgRunDurationMs",
      "scoreBreakdown",
      "computedAt"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["AgentReputation.v1"] },
      agentId: { type: "string" },
      tenantId: { type: "string" },
      trustScore: { type: "integer", minimum: 0, maximum: 100 },
      riskTier: { type: "string", enum: ["low", "guarded", "elevated", "high"] },
      totalRuns: { type: "integer", minimum: 0 },
      terminalRuns: { type: "integer", minimum: 0 },
      createdRuns: { type: "integer", minimum: 0 },
      runningRuns: { type: "integer", minimum: 0 },
      completedRuns: { type: "integer", minimum: 0 },
      failedRuns: { type: "integer", minimum: 0 },
      runsWithEvidence: { type: "integer", minimum: 0 },
      totalSettlements: { type: "integer", minimum: 0 },
      lockedSettlements: { type: "integer", minimum: 0 },
      releasedSettlements: { type: "integer", minimum: 0 },
      refundedSettlements: { type: "integer", minimum: 0 },
      runCompletionRatePct: { type: "integer", minimum: 0, maximum: 100, nullable: true },
      evidenceCoverageRatePct: { type: "integer", minimum: 0, maximum: 100, nullable: true },
      settlementReleaseRatePct: { type: "integer", minimum: 0, maximum: 100, nullable: true },
      avgRunDurationMs: { type: "integer", minimum: 0, nullable: true },
      scoreBreakdown: {
        type: "object",
        additionalProperties: false,
        required: ["runQuality", "settlementQuality", "evidenceQuality", "activityScore"],
        properties: {
          runQuality: { type: "integer", minimum: 0, maximum: 100 },
          settlementQuality: { type: "integer", minimum: 0, maximum: 100 },
          evidenceQuality: { type: "integer", minimum: 0, maximum: 100 },
          activityScore: { type: "integer", minimum: 0, maximum: 100 }
        }
      },
      computedAt: { type: "string", format: "date-time" }
    }
  };

  const AgentReputationWindowV2 = {
    type: "object",
    additionalProperties: false,
    required: [
      "trustScore",
      "riskTier",
      "totalRuns",
      "terminalRuns",
      "createdRuns",
      "runningRuns",
      "completedRuns",
      "failedRuns",
      "runsWithEvidence",
      "totalSettlements",
      "lockedSettlements",
      "releasedSettlements",
      "refundedSettlements",
      "runCompletionRatePct",
      "evidenceCoverageRatePct",
      "settlementReleaseRatePct",
      "avgRunDurationMs",
      "scoreBreakdown",
      "computedAt"
    ],
    properties: {
      trustScore: { type: "integer", minimum: 0, maximum: 100 },
      riskTier: { type: "string", enum: ["low", "guarded", "elevated", "high"] },
      totalRuns: { type: "integer", minimum: 0 },
      terminalRuns: { type: "integer", minimum: 0 },
      createdRuns: { type: "integer", minimum: 0 },
      runningRuns: { type: "integer", minimum: 0 },
      completedRuns: { type: "integer", minimum: 0 },
      failedRuns: { type: "integer", minimum: 0 },
      runsWithEvidence: { type: "integer", minimum: 0 },
      totalSettlements: { type: "integer", minimum: 0 },
      lockedSettlements: { type: "integer", minimum: 0 },
      releasedSettlements: { type: "integer", minimum: 0 },
      refundedSettlements: { type: "integer", minimum: 0 },
      runCompletionRatePct: { type: "integer", minimum: 0, maximum: 100, nullable: true },
      evidenceCoverageRatePct: { type: "integer", minimum: 0, maximum: 100, nullable: true },
      settlementReleaseRatePct: { type: "integer", minimum: 0, maximum: 100, nullable: true },
      avgRunDurationMs: { type: "integer", minimum: 0, nullable: true },
      scoreBreakdown: AgentReputationV1.properties.scoreBreakdown,
      computedAt: { type: "string", format: "date-time" }
    }
  };

  const AgentReputationV2 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "agentId", "tenantId", "primaryWindow", "trustScore", "riskTier", "windows", "computedAt"],
    properties: {
      schemaVersion: { type: "string", enum: ["AgentReputation.v2"] },
      agentId: { type: "string" },
      tenantId: { type: "string" },
      primaryWindow: { type: "string", enum: ["7d", "30d", "allTime"] },
      trustScore: { type: "integer", minimum: 0, maximum: 100 },
      riskTier: { type: "string", enum: ["low", "guarded", "elevated", "high"] },
      windows: {
        type: "object",
        additionalProperties: false,
        required: ["7d", "30d", "allTime"],
        properties: {
          "7d": AgentReputationWindowV2,
          "30d": AgentReputationWindowV2,
          allTime: AgentReputationWindowV2
        }
      },
      computedAt: { type: "string", format: "date-time" }
    }
  };

  const AgentReputationAny = {
    oneOf: [AgentReputationV1, AgentReputationV2]
  };

  const RelationshipEdgeV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "tenantId",
      "agentId",
      "counterpartyAgentId",
      "visibility",
      "reputationWindow",
      "asOf",
      "eventCount",
      "decisionsTotal",
      "decisionsApproved",
      "workedWithCount",
      "successRate",
      "disputesOpened",
      "disputeRate",
      "releaseRateAvg",
      "settledCents",
      "refundedCents",
      "penalizedCents",
      "autoReleasedCents",
      "adjustmentAppliedCents",
      "lastInteractionAt"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["RelationshipEdge.v1"] },
      tenantId: { type: "string" },
      agentId: { type: "string" },
      counterpartyAgentId: { type: "string" },
      visibility: { type: "string", enum: ["private", "public_summary"] },
      reputationWindow: { type: "string", enum: ["7d", "30d", "allTime"] },
      asOf: { type: "string", format: "date-time" },
      eventCount: { type: "integer", minimum: 0 },
      decisionsTotal: { type: "integer", minimum: 0 },
      decisionsApproved: { type: "integer", minimum: 0 },
      workedWithCount: { type: "integer", minimum: 0 },
      successRate: { type: "number", nullable: true },
      disputesOpened: { type: "integer", minimum: 0 },
      disputeRate: { type: "number", nullable: true },
      releaseRateAvg: { type: "number", nullable: true },
      settledCents: { type: "integer", minimum: 0 },
      refundedCents: { type: "integer", minimum: 0 },
      penalizedCents: { type: "integer", minimum: 0 },
      autoReleasedCents: { type: "integer", minimum: 0 },
      adjustmentAppliedCents: { type: "integer", minimum: 0 },
      lastInteractionAt: { type: "string", format: "date-time", nullable: true },
      minimumEconomicWeightCents: { type: "integer", minimum: 0 },
      economicWeightCents: { type: "integer", minimum: 0 },
      economicWeightQualified: { type: "boolean" },
      microLoopEventCount: { type: "integer", minimum: 0 },
      microLoopRate: { type: "number", nullable: true },
      reciprocalDecisionCount: { type: "integer", minimum: 0 },
      reciprocalEconomicSymmetryDeltaCents: { type: "integer", minimum: 0, nullable: true },
      reciprocalMicroLoopRate: { type: "number", nullable: true },
      collusionSuspected: { type: "boolean" },
      dampened: { type: "boolean" },
      reputationImpactMultiplier: { type: "number", minimum: 0, maximum: 1 },
      antiGamingReasonCodes: { type: "array", items: { type: "string" } }
    }
  };

  const PublicAgentReputationSummaryV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "agentId",
      "reputationVersion",
      "reputationWindow",
      "asOf",
      "trustScore",
      "riskTier",
      "eventCount",
      "decisionsTotal",
      "decisionsApproved",
      "successRate",
      "disputesOpened",
      "disputeRate",
      "lastInteractionAt",
      "relationships"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["PublicAgentReputationSummary.v1"] },
      agentId: { type: "string" },
      reputationVersion: { type: "string", enum: ["v1", "v2"] },
      reputationWindow: { type: "string", enum: ["7d", "30d", "allTime"] },
      asOf: { type: "string", format: "date-time" },
      trustScore: { type: "integer", minimum: 0, maximum: 100 },
      riskTier: { type: "string", enum: ["low", "guarded", "elevated", "high"] },
      eventCount: { type: "integer", minimum: 0 },
      decisionsTotal: { type: "integer", minimum: 0 },
      decisionsApproved: { type: "integer", minimum: 0 },
      successRate: { type: "number", nullable: true },
      disputesOpened: { type: "integer", minimum: 0 },
      disputeRate: { type: "number", nullable: true },
      lastInteractionAt: { type: "string", format: "date-time", nullable: true },
      relationships: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "counterpartyAgentId", "workedWithCount", "successRate", "disputeRate", "lastInteractionAt"],
          properties: {
            schemaVersion: { type: "string", enum: ["RelationshipEdge.v1"] },
            counterpartyAgentId: { type: "string" },
            workedWithCount: { type: "integer", minimum: 0 },
            successRate: { type: "number", nullable: true },
            disputeRate: { type: "number", nullable: true },
            lastInteractionAt: { type: "string", format: "date-time", nullable: true }
          }
        }
      }
    }
  };

  const AgentLocatorV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "agentRef",
      "parsedRef",
      "status",
      "reasonCode",
      "matchCount",
      "resolved",
      "candidates",
      "deterministicHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["AgentLocator.v1"] },
      agentRef: { type: "string" },
      parsedRef: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        required: ["kind", "value"],
        properties: {
          kind: { type: "string", enum: ["agent_id", "did", "url"] },
          value: { type: "string" }
        }
      },
      status: { type: "string", enum: ["resolved", "malformed", "not_found", "ambiguous"] },
      reasonCode: {
        type: "string",
        nullable: true,
        enum: ["AGENT_LOCATOR_MALFORMED_REF", "AGENT_LOCATOR_NOT_FOUND", "AGENT_LOCATOR_AMBIGUOUS", null]
      },
      matchCount: { type: "integer", minimum: 0 },
      resolved: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        required: ["tenantId", "agentId", "displayName", "executionCoordinatorDid", "hostEndpoint"],
        properties: {
          tenantId: { type: "string" },
          agentId: { type: "string" },
          displayName: { type: "string", nullable: true },
          executionCoordinatorDid: { type: "string", nullable: true },
          hostEndpoint: { type: "string", nullable: true }
        }
      },
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "rank",
            "score",
            "tieBreakHash",
            "matchReasons",
            "tenantId",
            "agentId",
            "displayName",
            "executionCoordinatorDid",
            "hostEndpoint"
          ],
          properties: {
            rank: { type: "integer", minimum: 1 },
            score: { type: "integer", minimum: 1 },
            tieBreakHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
            matchReasons: {
              type: "array",
              items: { type: "string", enum: ["AGENT_ID_EXACT", "EXECUTION_COORDINATOR_DID_EXACT", "HOST_ENDPOINT_EXACT"] }
            },
            tenantId: { type: "string" },
            agentId: { type: "string" },
            displayName: { type: "string", nullable: true },
            executionCoordinatorDid: { type: "string", nullable: true },
            hostEndpoint: { type: "string", nullable: true }
          }
        }
      },
      deterministicHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const InteractionGraphSummaryV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "agentId",
      "reputationVersion",
      "reputationWindow",
      "asOf",
      "trustScore",
      "riskTier",
      "eventCount",
      "decisionsTotal",
      "decisionsApproved",
      "successRate",
      "disputesOpened",
      "disputeRate",
      "settledCents",
      "refundedCents",
      "penalizedCents",
      "autoReleasedCents",
      "adjustmentAppliedCents",
      "relationshipCount",
      "economicallyQualifiedRelationshipCount",
      "dampenedRelationshipCount",
      "collusionSuspectedRelationshipCount",
      "lastInteractionAt"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["InteractionGraphSummary.v1"] },
      agentId: { type: "string" },
      reputationVersion: { type: "string", enum: ["v1", "v2"] },
      reputationWindow: { type: "string", enum: ["7d", "30d", "allTime"] },
      asOf: { type: "string", format: "date-time" },
      trustScore: { type: "integer", minimum: 0, maximum: 100 },
      riskTier: { type: "string", enum: ["low", "guarded", "elevated", "high"] },
      eventCount: { type: "integer", minimum: 0 },
      decisionsTotal: { type: "integer", minimum: 0 },
      decisionsApproved: { type: "integer", minimum: 0 },
      successRate: { type: "number", nullable: true },
      disputesOpened: { type: "integer", minimum: 0 },
      disputeRate: { type: "number", nullable: true },
      settledCents: { type: "integer", minimum: 0 },
      refundedCents: { type: "integer", minimum: 0 },
      penalizedCents: { type: "integer", minimum: 0 },
      autoReleasedCents: { type: "integer", minimum: 0 },
      adjustmentAppliedCents: { type: "integer", minimum: 0 },
      relationshipCount: { type: "integer", minimum: 0 },
      economicallyQualifiedRelationshipCount: { type: "integer", minimum: 0 },
      dampenedRelationshipCount: { type: "integer", minimum: 0 },
      collusionSuspectedRelationshipCount: { type: "integer", minimum: 0 },
      lastInteractionAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const InteractionGraphVerificationV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "deterministicOrdering", "antiGamingSignalsPresent", "generatedBy"],
    properties: {
      schemaVersion: { type: "string", enum: ["InteractionGraphVerification.v1"] },
      deterministicOrdering: { type: "boolean" },
      antiGamingSignalsPresent: { type: "boolean" },
      generatedBy: { type: "string" }
    }
  };

  const InteractionGraphPackSignatureV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "algorithm", "keyId", "signedAt", "payloadHash", "signatureBase64"],
    properties: {
      schemaVersion: { type: "string", enum: ["VerifiedInteractionGraphPackSignature.v1"] },
      algorithm: { type: "string", enum: ["ed25519"] },
      keyId: { type: "string" },
      signedAt: { type: "string", format: "date-time" },
      payloadHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      signatureBase64: { type: "string" }
    }
  };

  const VerifiedInteractionGraphPackV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "tenantId",
      "agentId",
      "reputationVersion",
      "reputationWindow",
      "asOf",
      "generatedAt",
      "relationshipCount",
      "relationshipsHash",
      "summaryHash",
      "verification",
      "summary",
      "relationships",
      "packHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["VerifiedInteractionGraphPack.v1"] },
      tenantId: { type: "string" },
      agentId: { type: "string" },
      reputationVersion: { type: "string", enum: ["v1", "v2"] },
      reputationWindow: { type: "string", enum: ["7d", "30d", "allTime"] },
      asOf: { type: "string", format: "date-time" },
      generatedAt: { type: "string", format: "date-time" },
      relationshipCount: { type: "integer", minimum: 0 },
      relationshipsHash: { type: "string" },
      summaryHash: { type: "string" },
      verification: InteractionGraphVerificationV1,
      summary: InteractionGraphSummaryV1,
      relationships: { type: "array", items: RelationshipEdgeV1 },
      packHash: { type: "string" },
      signature: InteractionGraphPackSignatureV1
    }
  };

  const SessionV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "sessionId", "tenantId", "visibility", "participants", "createdAt", "updatedAt", "revision"],
    properties: {
      schemaVersion: { type: "string", enum: ["Session.v1"] },
      sessionId: { type: "string" },
      tenantId: { type: "string" },
      visibility: { type: "string", enum: ["public", "tenant", "private"] },
      participants: { type: "array", items: { type: "string" } },
      policyRef: { type: "string", nullable: true },
      metadata: { type: "object", nullable: true, additionalProperties: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      revision: { type: "integer", minimum: 0 }
    }
  };

  const SessionEventProvenanceV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "label", "derivedFromEventId", "isTainted", "taintDepth", "explicitTaint", "reasonCodes"],
    properties: {
      schemaVersion: { type: "string", enum: ["SessionEventProvenance.v1"] },
      label: { type: "string", enum: ["trusted", "external", "tainted"] },
      derivedFromEventId: { type: "string", nullable: true },
      isTainted: { type: "boolean" },
      taintDepth: { type: "integer", minimum: 0 },
      explicitTaint: { type: "boolean" },
      reasonCodes: { type: "array", items: { type: "string" } }
    }
  };

  const SessionEventPayloadV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "sessionId", "eventType", "payload", "provenance", "traceId", "at"],
    properties: {
      schemaVersion: { type: "string", enum: ["SessionEvent.v1"] },
      sessionId: { type: "string" },
      eventType: {
        type: "string",
        enum: [
          "MESSAGE",
          "TASK_REQUESTED",
          "QUOTE_ISSUED",
          "TASK_ACCEPTED",
          "TASK_PROGRESS",
          "TASK_COMPLETED",
          "SETTLEMENT_LOCKED",
          "SETTLEMENT_RELEASED",
          "SETTLEMENT_REFUNDED",
          "POLICY_CHALLENGED",
          "DISPUTE_OPENED"
        ]
      },
      payload: { nullable: true },
      provenance: { allOf: [SessionEventProvenanceV1], nullable: true },
      traceId: { type: "string", nullable: true },
      at: { type: "string", format: "date-time" }
    }
  };

  const SessionEventEnvelopeV1 = {
    type: "object",
    additionalProperties: false,
    required: ["v", "id", "at", "streamId", "type", "actor", "payload", "payloadHash", "prevChainHash", "chainHash", "signature", "signerKeyId"],
    properties: {
      v: { type: "integer", enum: [1] },
      id: { type: "string" },
      at: { type: "string", format: "date-time" },
      streamId: { type: "string" },
      type: { type: "string" },
      actor: { type: "object", nullable: true, additionalProperties: true },
      payload: SessionEventPayloadV1,
      payloadHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      prevChainHash: { type: "string", nullable: true },
      chainHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      signature: { type: "string", nullable: true },
      signerKeyId: { type: "string", nullable: true }
    }
  };

  const SessionEventInboxRelayCheckpointV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "tenantId", "sessionId", "consumerId", "sinceEventId", "createdAt", "updatedAt", "checkpointHash"],
    properties: {
      schemaVersion: { type: "string", enum: ["SessionEventInboxRelayCheckpoint.v1"] },
      tenantId: { type: "string" },
      sessionId: { type: "string" },
      consumerId: { type: "string" },
      sinceEventId: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      checkpointHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const SessionEventInboxWatermarkV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "eventCount", "sinceEventId", "nextSinceEventId", "headEventId"],
    properties: {
      schemaVersion: { type: "string", enum: ["SessionEventInboxWatermark.v1"] },
      eventCount: { type: "integer", minimum: 0 },
      sinceEventId: { type: "string", nullable: true },
      nextSinceEventId: { type: "string", nullable: true },
      headEventId: { type: "string", nullable: true }
    }
  };

  const SessionReplayPackSignatureV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "algorithm", "keyId", "signedAt", "payloadHash", "signatureBase64"],
    properties: {
      schemaVersion: { type: "string", enum: ["SessionReplayPackSignature.v1"] },
      algorithm: { type: "string", enum: ["ed25519"] },
      keyId: { type: "string" },
      signedAt: { type: "string", format: "date-time" },
      payloadHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      signatureBase64: { type: "string" }
    }
  };

  const SessionReplayPackV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "tenantId",
      "sessionId",
      "generatedAt",
      "sessionHash",
      "eventChainHash",
      "eventCount",
      "headChainHash",
      "verification",
      "session",
      "events",
      "packHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["SessionReplayPack.v1"] },
      tenantId: { type: "string" },
      sessionId: { type: "string" },
      generatedAt: { type: "string", format: "date-time" },
      sessionHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      eventChainHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      eventCount: { type: "integer", minimum: 0 },
      headChainHash: { type: "string", nullable: true },
      verification: { type: "object", additionalProperties: true },
      session: SessionV1,
      events: { type: "array", items: SessionEventEnvelopeV1 },
      packHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      signature: { allOf: [SessionReplayPackSignatureV1], nullable: true }
    }
  };

  const SessionMemoryExportV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "tenantId",
      "sessionId",
      "exportedAt",
      "replayPackHash",
      "replayPackRef",
      "eventCount",
      "continuity"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["SessionMemoryExport.v1"] },
      tenantId: { type: "string" },
      sessionId: { type: "string" },
      exportId: { type: ["string", "null"] },
      exportedAt: { type: "string", format: "date-time" },
      replayPackHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      replayPackRef: { type: "object", additionalProperties: true },
      transcriptHash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" },
      transcriptRef: { type: ["object", "null"], additionalProperties: true },
      eventCount: { type: "integer", minimum: 0 },
      firstEventId: { type: ["string", "null"] },
      lastEventId: { type: ["string", "null"] },
      firstPrevChainHash: { type: ["string", "null"] },
      headChainHash: { type: ["string", "null"] },
      workspace: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["ownerAgentId", "domainId", "host", "revokedAt", "revocationReasonCode"],
        properties: {
          workspaceId: { type: ["string", "null"] },
          ownerAgentId: { type: "string" },
          domainId: { type: "string" },
          host: { type: "string" },
          revokedAt: { type: ["string", "null"], format: "date-time" },
          revocationReasonCode: { type: ["string", "null"] }
        }
      },
      migration: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["migrationId", "sourceHost", "targetHost", "migratedAt"],
        properties: {
          migrationId: { type: "string" },
          sourceHost: { type: "string" },
          targetHost: { type: "string" },
          migratedAt: { type: "string", format: "date-time" }
        }
      },
      continuity: {
        type: "object",
        additionalProperties: false,
        required: ["previousHeadChainHash", "previousPackHash"],
        properties: {
          previousHeadChainHash: { type: ["string", "null"] },
          previousPackHash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" }
        }
      }
    }
  };

  const SessionReplayExportMetadataV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "tenantId",
      "sessionId",
      "replayPackHash",
      "memoryExportHash",
      "memoryExportRefHash",
      "dependencyChecks",
      "exportHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["SessionReplayExportMetadata.v1"] },
      tenantId: { type: ["string", "null"] },
      sessionId: { type: ["string", "null"] },
      replayPackHash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" },
      transcriptHash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" },
      memoryExportHash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" },
      memoryExportRefHash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" },
      dependencyChecks: {
        type: "object",
        additionalProperties: false,
        required: [
          "replayPackPresent",
          "transcriptPresent",
          "memoryExportPresent",
          "memoryExportRefPresent",
          "importVerified",
          "importReasonCode"
        ],
        properties: {
          replayPackPresent: { type: "boolean" },
          transcriptPresent: { type: "boolean" },
          memoryExportPresent: { type: "boolean" },
          memoryExportRefPresent: { type: "boolean" },
          importVerified: { type: "boolean" },
          importReasonCode: { type: ["string", "null"] }
        }
      },
      exportHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const SessionReplayVerificationVerdictV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "ok", "code", "error", "checks", "summary", "verdictHash"],
    properties: {
      schemaVersion: { type: "string", enum: ["SessionReplayVerificationVerdict.v1"] },
      ok: { type: "boolean" },
      code: { type: ["string", "null"] },
      error: { type: ["string", "null"] },
      replayPackHash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" },
      memoryExportHash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" },
      transcriptHash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" },
      policyDecisionHash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" },
      checks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "ok", "code", "error", "details"],
          properties: {
            id: { type: "string" },
            ok: { type: "boolean" },
            code: { type: ["string", "null"] },
            error: { type: ["string", "null"] },
            details: { type: ["object", "null"], additionalProperties: true }
          }
        }
      },
      summary: {
        type: "object",
        additionalProperties: false,
        required: ["checkCount", "failureCount"],
        properties: {
          checkCount: { type: "integer", minimum: 0 },
          failureCount: { type: "integer", minimum: 0 }
        }
      },
      verdictHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const SessionTranscriptSignatureV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "algorithm", "keyId", "signedAt", "payloadHash", "signatureBase64"],
    properties: {
      schemaVersion: { type: "string", enum: ["SessionTranscriptSignature.v1"] },
      algorithm: { type: "string", enum: ["ed25519"] },
      keyId: { type: "string" },
      signedAt: { type: "string", format: "date-time" },
      payloadHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      signatureBase64: { type: "string" }
    }
  };

  const SessionTranscriptDigestV1 = {
    type: "object",
    additionalProperties: false,
    required: ["eventId", "eventType", "at", "chainHash", "prevChainHash", "payloadHash", "signerKeyId", "actor", "traceId", "provenance"],
    properties: {
      eventId: { type: "string" },
      eventType: { type: "string" },
      at: { type: "string", format: "date-time" },
      chainHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      prevChainHash: { type: "string", nullable: true },
      payloadHash: { type: "string", nullable: true },
      signerKeyId: { type: "string", nullable: true },
      actor: { type: "object", nullable: true, additionalProperties: true },
      traceId: { type: "string", nullable: true },
      provenance: { type: "object", nullable: true, additionalProperties: true }
    }
  };

  const SessionTranscriptV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "tenantId",
      "sessionId",
      "generatedAt",
      "sessionHash",
      "transcriptEventDigestHash",
      "eventCount",
      "headChainHash",
      "verification",
      "session",
      "eventDigests",
      "transcriptHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["SessionTranscript.v1"] },
      tenantId: { type: "string" },
      sessionId: { type: "string" },
      generatedAt: { type: "string", format: "date-time" },
      sessionHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      transcriptEventDigestHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      eventCount: { type: "integer", minimum: 0 },
      headChainHash: { type: "string", nullable: true },
      verification: { type: "object", additionalProperties: true },
      session: SessionV1,
      eventDigests: { type: "array", items: SessionTranscriptDigestV1 },
      transcriptHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      signature: { allOf: [SessionTranscriptSignatureV1], nullable: true }
    }
  };

  const InteractionDirectionEntityType = {
    type: "string",
    enum: ["agent", "human", "robot", "machine"]
  };

  const VerificationMethodV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "mode"],
    properties: {
      schemaVersion: { type: "string", enum: ["VerificationMethod.v1"] },
      mode: { type: "string", enum: ["deterministic", "attested", "discretionary"] },
      source: { type: "string", nullable: true },
      attestor: { type: "string", nullable: true },
      notes: { type: "string", nullable: true }
    }
  };

  const SettlementPolicyV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "policyVersion", "mode", "rules", "policyHash"],
    properties: {
      schemaVersion: { type: "string", enum: ["SettlementPolicy.v1"] },
      policyVersion: { type: "integer", minimum: 1 },
      mode: { type: "string", enum: ["automatic", "manual-review"] },
      policyHash: { type: "string" },
      rules: {
        type: "object",
        additionalProperties: false,
        required: [
          "requireDeterministicVerification",
          "autoReleaseOnGreen",
          "autoReleaseOnAmber",
          "autoReleaseOnRed",
          "greenReleaseRatePct",
          "amberReleaseRatePct",
          "redReleaseRatePct"
        ],
        properties: {
          requireDeterministicVerification: { type: "boolean" },
          autoReleaseOnGreen: { type: "boolean" },
          autoReleaseOnAmber: { type: "boolean" },
          autoReleaseOnRed: { type: "boolean" },
          greenReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
          amberReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
          redReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
          maxAutoReleaseAmountCents: { type: "integer", nullable: true, minimum: 1 },
          manualReason: { type: "string", nullable: true }
        }
      }
    }
  };

  const MarketplaceSettlementPolicyRefV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "source", "policyVersion", "policyHash", "verificationMethodHash"],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceSettlementPolicyRef.v1"] },
      source: { type: "string", enum: ["tenant_registry", "inline"] },
      policyId: { type: "string", nullable: true },
      policyVersion: { type: "integer", minimum: 1 },
      policyHash: { type: "string" },
      verificationMethodHash: { type: "string" }
    }
  };

  const TenantSettlementPolicyV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "tenantId",
      "policyId",
      "policyVersion",
      "policyHash",
      "verificationMethodHash",
      "verificationMethod",
      "policy",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["TenantSettlementPolicy.v1"] },
      tenantId: { type: "string" },
      policyId: { type: "string" },
      policyVersion: { type: "integer", minimum: 1 },
      policyHash: { type: "string" },
      verificationMethodHash: { type: "string" },
      verificationMethod: VerificationMethodV1,
      policy: SettlementPolicyV1,
      description: { type: "string", nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const MarketplaceAgreementMilestoneV1 = {
    type: "object",
    additionalProperties: false,
    required: ["milestoneId", "releaseRatePct", "statusGate"],
    properties: {
      milestoneId: { type: "string" },
      label: { type: "string", nullable: true },
      releaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
      statusGate: { type: "string", enum: ["green", "amber", "red", "any"] },
      requiredEvidenceCount: { type: "integer", minimum: 0, nullable: true }
    }
  };

  const MarketplaceAgreementCancellationV1 = {
    type: "object",
    additionalProperties: false,
    required: ["allowCancellationBeforeStart", "killFeeRatePct", "requireEvidenceOnCancellation", "requireCounterpartyAcceptance"],
    properties: {
      allowCancellationBeforeStart: { type: "boolean" },
      killFeeRatePct: { type: "integer", minimum: 0, maximum: 100 },
      requireEvidenceOnCancellation: { type: "boolean" },
      requireCounterpartyAcceptance: { type: "boolean" }
    }
  };

  const MarketplaceAgreementChangeOrderPolicyV1 = {
    type: "object",
    additionalProperties: false,
    required: ["enabled", "maxChangeOrders", "requireCounterpartyAcceptance"],
    properties: {
      enabled: { type: "boolean" },
      maxChangeOrders: { type: "integer", minimum: 0 },
      requireCounterpartyAcceptance: { type: "boolean" }
    }
  };

  const MarketplaceAgreementTermsV1 = {
    type: "object",
    additionalProperties: false,
    required: ["milestones", "cancellation", "changeOrderPolicy", "changeOrders"],
    properties: {
      title: { type: "string", nullable: true },
      capability: { type: "string", nullable: true },
      deadlineAt: { type: "string", format: "date-time", nullable: true },
      etaSeconds: { type: "integer", nullable: true, minimum: 1 },
      milestones: { type: "array", items: MarketplaceAgreementMilestoneV1 },
      cancellation: MarketplaceAgreementCancellationV1,
      changeOrderPolicy: MarketplaceAgreementChangeOrderPolicyV1,
      changeOrders: { type: "array", items: { type: "object", additionalProperties: true } }
    }
  };

  const MarketplaceAgreementTermsInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      milestones: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["milestoneId", "releaseRatePct"],
          properties: {
            milestoneId: { type: "string" },
            label: { type: "string" },
            releaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
            statusGate: { type: "string", enum: ["green", "amber", "red", "any"] },
            requiredEvidenceCount: { type: "integer", minimum: 0 }
          }
        }
      },
      cancellation: {
        type: "object",
        additionalProperties: false,
        properties: {
          allowCancellationBeforeStart: { type: "boolean" },
          killFeeRatePct: { type: "integer", minimum: 0, maximum: 100 },
          requireEvidenceOnCancellation: { type: "boolean" },
          requireCounterpartyAcceptance: { type: "boolean" }
        }
      },
      changeOrderPolicy: {
        type: "object",
        additionalProperties: false,
        properties: {
          enabled: { type: "boolean" },
          maxChangeOrders: { type: "integer", minimum: 0 },
          requireCounterpartyAcceptance: { type: "boolean" }
        }
      }
    }
  };

  const MarketplaceCounterOfferPolicyV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "allowPosterCounterOffers",
      "allowBidderCounterOffers",
      "maxRevisions",
      "timeoutSeconds"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceCounterOfferPolicy.v1"] },
      allowPosterCounterOffers: { type: "boolean" },
      allowBidderCounterOffers: { type: "boolean" },
      maxRevisions: { type: "integer", minimum: 1 },
      timeoutSeconds: { type: "integer", minimum: 1 }
    }
  };

  const MarketplaceBidAcceptanceV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "acceptedAt", "acceptedByAgentId", "acceptedProposalId", "acceptedRevision"],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceBidAcceptance.v1"] },
      acceptedAt: { type: "string", format: "date-time" },
      acceptedByAgentId: { type: "string", nullable: true },
      acceptedProposalId: { type: "string", nullable: true },
      acceptedRevision: { type: "integer", minimum: 1, nullable: true }
    }
  };

  const MarketplaceAgreementAcceptanceV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "acceptedAt",
      "acceptedByAgentId",
      "acceptedProposalId",
      "acceptedRevision",
      "acceptedProposalHash",
      "offerChainHash",
      "proposalCount"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceAgreementAcceptance.v1"] },
      acceptedAt: { type: "string", format: "date-time", nullable: true },
      acceptedByAgentId: { type: "string", nullable: true },
      acceptedProposalId: { type: "string", nullable: true },
      acceptedRevision: { type: "integer", minimum: 1, nullable: true },
      acceptedProposalHash: { type: "string", nullable: true },
      offerChainHash: { type: "string", nullable: true },
      proposalCount: { type: "integer", minimum: 1 }
    }
  };

  const MarketplaceOfferV2 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "offerId",
      "tenantId",
      "rfqId",
      "runId",
      "bidId",
      "revision",
      "amountCents",
      "currency",
      "proposalHash",
      "proposedAt",
      "createdAt",
      "offerHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceOffer.v2"] },
      offerId: { type: "string" },
      tenantId: { type: "string" },
      rfqId: { type: "string" },
      runId: { type: "string", nullable: true },
      bidId: { type: "string" },
      proposalId: { type: "string", nullable: true },
      revision: { type: "integer", minimum: 1 },
      proposerAgentId: { type: "string", nullable: true },
      amountCents: { type: "integer", minimum: 1 },
      currency: { type: "string" },
      etaSeconds: { type: "integer", minimum: 1, nullable: true },
      note: { type: "string", nullable: true },
      verificationMethod: { ...VerificationMethodV1, nullable: true },
      policy: { ...SettlementPolicyV1, nullable: true },
      policyRef: { ...MarketplaceSettlementPolicyRefV1, nullable: true },
      policyRefHash: { type: "string", nullable: true },
      prevProposalHash: { type: "string", nullable: true },
      proposalHash: { type: "string" },
      offerChainHash: { type: "string", nullable: true },
      proposalCount: { type: "integer", minimum: 1, nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      proposedAt: { type: "string", format: "date-time" },
      createdAt: { type: "string", format: "date-time" },
      offerHash: { type: "string" }
    }
  };

  const MarketplaceAcceptanceV2 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "acceptanceId",
      "tenantId",
      "rfqId",
      "runId",
      "bidId",
      "acceptedAt",
      "acceptedByAgentId",
      "acceptedProposalId",
      "acceptedRevision",
      "acceptedProposalHash",
      "offerChainHash",
      "proposalCount",
      "offerRef",
      "createdAt",
      "acceptanceHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceAcceptance.v2"] },
      acceptanceId: { type: "string" },
      tenantId: { type: "string" },
      rfqId: { type: "string" },
      runId: { type: "string" },
      bidId: { type: "string" },
      agreementId: { type: "string", nullable: true },
      acceptedAt: { type: "string", format: "date-time", nullable: true },
      acceptedByAgentId: { type: "string", nullable: true },
      acceptedProposalId: { type: "string", nullable: true },
      acceptedRevision: { type: "integer", minimum: 1, nullable: true },
      acceptedProposalHash: { type: "string", nullable: true },
      offerChainHash: { type: "string", nullable: true },
      proposalCount: { type: "integer", minimum: 1, nullable: true },
      offerRef: {
        type: "object",
        additionalProperties: false,
        required: ["offerId", "offerHash"],
        properties: {
          offerId: { type: "string", nullable: true },
          offerHash: { type: "string", nullable: true }
        }
      },
      createdAt: { type: "string", format: "date-time" },
      acceptanceHash: { type: "string" }
    }
  };

  const AgentDelegationLinkV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "delegationId",
      "tenantId",
      "principalAgentId",
      "delegateAgentId",
      "issuedAt",
      "signerKeyId",
      "delegationHash",
      "signature"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["AgentDelegationLink.v1"] },
      delegationId: { type: "string" },
      tenantId: { type: "string" },
      principalAgentId: { type: "string" },
      delegateAgentId: { type: "string" },
      scope: { type: "string", nullable: true },
      issuedAt: { type: "string", format: "date-time" },
      expiresAt: { type: "string", format: "date-time", nullable: true },
      signerKeyId: { type: "string" },
      delegationHash: { type: "string" },
      signature: { type: "string" }
    }
  };

  const AgentActingOnBehalfOfV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "principalAgentId", "delegationChain"],
    properties: {
      schemaVersion: { type: "string", enum: ["AgentActingOnBehalfOf.v1"] },
      principalAgentId: { type: "string" },
      delegateAgentId: { type: "string", nullable: true },
      delegationChain: { type: "array", minItems: 1, items: AgentDelegationLinkV1 },
      chainHash: { type: "string", nullable: true }
    }
  };

  const DelegationTraceV1 = {
    type: "object",
    additionalProperties: false,
    required: ["chainHash", "tenantId", "runId", "rfqId", "agreementId", "contextType", "delegationChain"],
    properties: {
      chainHash: { type: "string" },
      tenantId: { type: "string" },
      runId: { type: "string" },
      rfqId: { type: "string" },
      agreementId: { type: "string" },
      contextType: { type: "string", enum: ["agreement_acceptance", "change_order_acceptance", "cancellation_acceptance"] },
      contextId: { type: "string", nullable: true },
      signedAt: { type: "string", format: "date-time", nullable: true },
      signerAgentId: { type: "string", nullable: true },
      signerKeyId: { type: "string", nullable: true },
      acceptedByAgentId: { type: "string", nullable: true },
      principalAgentId: { type: "string", nullable: true },
      delegateAgentId: { type: "string", nullable: true },
      delegationChain: { type: "array", minItems: 1, items: AgentDelegationLinkV1 }
    }
  };

  const DelegationTraceListResponse = {
    type: "object",
    additionalProperties: false,
    required: ["traces", "total", "limit", "offset"],
    properties: {
      traces: { type: "array", items: DelegationTraceV1 },
      total: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1 },
      offset: { type: "integer", minimum: 0 }
    }
  };

  const DelegationEmergencyRevokeRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      runId: { type: "string" },
      chainHash: { type: "string" },
      delegationId: { type: "string" },
      signerKeyId: { type: "string" },
      signerAgentId: { type: "string" },
      authKeyId: { type: "string" },
      agentId: { type: "string" },
      includeDelegateAgent: { type: "boolean", default: true },
      includePrincipalAgent: { type: "boolean", default: false },
      includeSignerKey: { type: "boolean", default: true },
      reason: { type: "string" }
    }
  };

  const DelegationEmergencyRevokeResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "affectedTraceCount", "revoked", "missing"],
    properties: {
      ok: { type: "boolean" },
      selectors: { type: "object", additionalProperties: true },
      affectedTraceCount: { type: "integer", minimum: 0 },
      revoked: { type: "object", additionalProperties: true },
      missing: { type: "object", additionalProperties: true }
    }
  };

  const OpsEmergencyControlType = {
    type: "string",
    enum: ["pause", "quarantine", "revoke", "kill-switch"]
  };

  const OpsEmergencyAction = {
    type: "string",
    enum: ["pause", "quarantine", "revoke", "kill-switch", "resume"]
  };

  const OpsEmergencyScope = {
    type: "object",
    additionalProperties: false,
    required: ["type"],
    properties: {
      type: { type: "string", enum: ["tenant", "agent", "adapter", "channel", "action_type"] },
      id: { type: "string", nullable: true }
    }
  };

  const OpsEmergencyRequestedBy = {
    type: "object",
    additionalProperties: false,
    properties: {
      keyId: { type: "string", nullable: true },
      principalId: { type: "string", nullable: true }
    }
  };

  const OpsEmergencyControlEvent = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "eventId", "tenantId", "action", "scope", "requestedBy", "createdAt", "effectiveAt"],
    properties: {
      schemaVersion: { type: "string", enum: ["OpsEmergencyControlEvent.v1"] },
      eventId: { type: "string" },
      tenantId: { type: "string" },
      action: OpsEmergencyAction,
      controlType: { ...OpsEmergencyControlType, nullable: true },
      resumeControlTypes: { type: "array", items: OpsEmergencyControlType },
      scope: OpsEmergencyScope,
      reasonCode: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
      operatorAction: { type: "object", additionalProperties: true, nullable: true },
      secondOperatorAction: { type: "object", additionalProperties: true, nullable: true },
      requestedBy: OpsEmergencyRequestedBy,
      requestId: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      effectiveAt: { type: "string", format: "date-time" }
    }
  };

  const OpsEmergencyControlState = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "tenantId",
      "scopeType",
      "scopeId",
      "controlType",
      "active",
      "activatedAt",
      "resumedAt",
      "updatedAt",
      "lastEventId",
      "lastAction",
      "reasonCode",
      "reason",
      "operatorAction",
      "revision"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["OpsEmergencyControlState.v1"] },
      tenantId: { type: "string" },
      scopeType: { type: "string", enum: ["tenant", "agent", "adapter", "channel", "action_type"] },
      scopeId: { type: "string", nullable: true },
      controlType: OpsEmergencyControlType,
      active: { type: "boolean" },
      activatedAt: { type: "string", format: "date-time" },
      resumedAt: { type: "string", format: "date-time", nullable: true },
      updatedAt: { type: "string", format: "date-time" },
      lastEventId: { type: "string", nullable: true },
      lastAction: { ...OpsEmergencyAction, nullable: true },
      reasonCode: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
      operatorAction: { type: "object", additionalProperties: true, nullable: true },
      revision: { type: "integer", minimum: 0 }
    }
  };

  const OpsEmergencyPauseRequest = {
    type: "object",
    additionalProperties: false,
    required: ["operatorAction"],
    properties: {
      scope: OpsEmergencyScope,
      scopeType: { type: "string", enum: ["tenant", "agent", "adapter", "channel", "action_type"], nullable: true },
      scopeId: { type: "string", nullable: true },
      agentId: { type: "string", nullable: true },
      adapterId: { type: "string", nullable: true },
      providerId: { type: "string", nullable: true },
      reasonCode: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
      operatorAction: { type: "object", additionalProperties: true },
      secondOperatorAction: { type: "object", additionalProperties: true, nullable: true },
      effectiveAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const OpsEmergencyQuarantineRequest = {
    type: "object",
    additionalProperties: false,
    required: ["operatorAction"],
    properties: {
      scope: OpsEmergencyScope,
      scopeType: { type: "string", enum: ["tenant", "agent", "adapter", "channel", "action_type"], nullable: true },
      scopeId: { type: "string", nullable: true },
      agentId: { type: "string", nullable: true },
      adapterId: { type: "string", nullable: true },
      providerId: { type: "string", nullable: true },
      reasonCode: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
      operatorAction: { type: "object", additionalProperties: true },
      secondOperatorAction: { type: "object", additionalProperties: true, nullable: true },
      effectiveAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const OpsEmergencyRevokeRequest = {
    type: "object",
    additionalProperties: false,
    required: ["operatorAction"],
    properties: {
      scope: OpsEmergencyScope,
      scopeType: { type: "string", enum: ["tenant", "agent", "adapter", "channel", "action_type"], nullable: true },
      scopeId: { type: "string", nullable: true },
      agentId: { type: "string", nullable: true },
      adapterId: { type: "string", nullable: true },
      providerId: { type: "string", nullable: true },
      reasonCode: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
      operatorAction: { type: "object", additionalProperties: true },
      secondOperatorAction: { type: "object", additionalProperties: true, nullable: true },
      effectiveAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const OpsEmergencyKillSwitchRequest = {
    type: "object",
    additionalProperties: false,
    required: ["operatorAction"],
    properties: {
      scope: OpsEmergencyScope,
      scopeType: { type: "string", enum: ["tenant", "agent", "adapter", "channel", "action_type"], nullable: true },
      scopeId: { type: "string", nullable: true },
      agentId: { type: "string", nullable: true },
      adapterId: { type: "string", nullable: true },
      providerId: { type: "string", nullable: true },
      reasonCode: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
      operatorAction: { type: "object", additionalProperties: true },
      secondOperatorAction: { type: "object", additionalProperties: true, nullable: true },
      effectiveAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const OpsEmergencyResumeRequest = {
    type: "object",
    additionalProperties: false,
    required: ["operatorAction"],
    properties: {
      scope: OpsEmergencyScope,
      scopeType: { type: "string", enum: ["tenant", "agent", "adapter", "channel", "action_type"], nullable: true },
      scopeId: { type: "string", nullable: true },
      agentId: { type: "string", nullable: true },
      adapterId: { type: "string", nullable: true },
      providerId: { type: "string", nullable: true },
      controlType: OpsEmergencyControlType,
      controlTypes: { type: "array", items: OpsEmergencyControlType },
      resumeControlType: OpsEmergencyControlType,
      resumeControlTypes: { type: "array", items: OpsEmergencyControlType },
      reasonCode: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
      operatorAction: { type: "object", additionalProperties: true },
      secondOperatorAction: { type: "object", additionalProperties: true, nullable: true },
      effectiveAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const OpsEmergencyDualControlStatus = {
    type: "object",
    additionalProperties: false,
    required: ["required", "satisfied"],
    properties: {
      required: { type: "boolean" },
      satisfied: { type: "boolean", nullable: true }
    }
  };

  const OpsEmergencyControlResponse = {
    type: "object",
    additionalProperties: false,
    required: ["tenantId", "applied", "action"],
    properties: {
      tenantId: { type: "string" },
      applied: { type: "boolean" },
      action: OpsEmergencyAction,
      reason: { type: "string", nullable: true },
      event: { ...OpsEmergencyControlEvent, nullable: true },
      scope: { ...OpsEmergencyScope, nullable: true },
      controlType: { ...OpsEmergencyControlType, nullable: true },
      resumeControlTypes: { type: "array", items: OpsEmergencyControlType },
      dualControl: { ...OpsEmergencyDualControlStatus, nullable: true },
      control: { ...OpsEmergencyControlState, nullable: true }
    }
  };

  const AutonomousRoutineStatus = {
    type: "string",
    enum: ["active", "paused"]
  };

  const AutonomousRoutineControlAction = {
    type: "string",
    enum: ["kill-switch", "resume"]
  };

  const AutonomousRoutinePolicyGuardrails = {
    type: "object",
    additionalProperties: false,
    required: ["allowPaidExecution", "requireHumanApproval", "allowExternalNetwork"],
    properties: {
      allowPaidExecution: { type: "boolean" },
      requireHumanApproval: { type: "boolean" },
      allowExternalNetwork: { type: "boolean" }
    }
  };

  const AutonomousRoutineSpendingLimits = {
    type: "object",
    additionalProperties: false,
    required: ["currency", "maxPerExecutionMicros", "maxPerDayMicros"],
    properties: {
      currency: { type: "string", pattern: "^[A-Z]{3}$" },
      maxPerExecutionMicros: { type: "integer", minimum: 0 },
      maxPerDayMicros: { type: "integer", minimum: 0 }
    }
  };

  const AutonomousRoutineKillSwitchState = {
    type: "object",
    additionalProperties: false,
    required: ["active", "revision", "updatedAt", "reasonCode", "reason", "lastIncidentId"],
    properties: {
      active: { type: "boolean" },
      revision: { type: "integer", minimum: 0 },
      updatedAt: { type: "string", format: "date-time", nullable: true },
      reasonCode: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
      lastIncidentId: { type: "string", nullable: true }
    }
  };

  const AutonomousRoutinePolicy = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "routineId",
      "name",
      "description",
      "cadence",
      "taskTemplate",
      "status",
      "policyGuardrails",
      "spendingLimits",
      "killSwitch",
      "metadata",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["AutonomousRoutinePolicy.v1"] },
      routineId: { type: "string" },
      name: { type: "string" },
      description: { type: "string", nullable: true },
      cadence: { type: "string", nullable: true },
      taskTemplate: { type: "string" },
      status: AutonomousRoutineStatus,
      policyGuardrails: AutonomousRoutinePolicyGuardrails,
      spendingLimits: AutonomousRoutineSpendingLimits,
      killSwitch: AutonomousRoutineKillSwitchState,
      metadata: { type: "object", additionalProperties: true, nullable: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const AutonomousRoutineUpsertRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      routine: {
        type: "object",
        additionalProperties: false,
        required: ["routineId", "name", "taskTemplate", "policyGuardrails", "spendingLimits"],
        properties: {
          routineId: { type: "string" },
          name: { type: "string" },
          description: { type: "string", nullable: true },
          cadence: { type: "string", nullable: true },
          taskTemplate: { type: "string" },
          status: AutonomousRoutineStatus,
          policyGuardrails: AutonomousRoutinePolicyGuardrails,
          spendingLimits: AutonomousRoutineSpendingLimits,
          metadata: { type: "object", additionalProperties: true, nullable: true }
        }
      },
      routineId: { type: "string" },
      name: { type: "string" },
      description: { type: "string", nullable: true },
      cadence: { type: "string", nullable: true },
      taskTemplate: { type: "string" },
      status: AutonomousRoutineStatus,
      policyGuardrails: AutonomousRoutinePolicyGuardrails,
      spendingLimits: AutonomousRoutineSpendingLimits,
      metadata: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const AutonomousRoutineControlEvent = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "incidentId", "tenantId", "routineId", "action", "requestedBy", "requestId", "createdAt", "effectiveAt"],
    properties: {
      schemaVersion: { type: "string", enum: ["AutonomousRoutineControlEvent.v1"] },
      incidentId: { type: "string" },
      tenantId: { type: "string" },
      routineId: { type: "string" },
      action: AutonomousRoutineControlAction,
      reasonCode: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
      requestedBy: {
        type: "object",
        additionalProperties: false,
        required: ["keyId", "principalId"],
        properties: {
          keyId: { type: "string", nullable: true },
          principalId: { type: "string", nullable: true }
        }
      },
      requestId: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      effectiveAt: { type: "string", format: "date-time" }
    }
  };

  const AutonomousRoutineControlRequest = {
    type: "object",
    additionalProperties: false,
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["kill-switch", "resume", "enable", "disable"] },
      reasonCode: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
      effectiveAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const AutonomousRoutineControlResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "routineId", "applied", "action"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      routineId: { type: "string" },
      applied: { type: "boolean" },
      action: AutonomousRoutineControlAction,
      reason: { type: "string", nullable: true },
      event: { ...AutonomousRoutineControlEvent, nullable: true }
    }
  };

  const AutonomousRoutineExecutionDecision = {
    type: "object",
    additionalProperties: false,
    required: ["allowed", "code", "message", "details"],
    properties: {
      allowed: { type: "boolean" },
      code: { type: "string", nullable: true },
      message: { type: "string", nullable: true },
      details: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const AutonomousRoutineExecutionReceipt = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "tenantId",
      "routineId",
      "executionId",
      "requestedAt",
      "executedAt",
      "requestedSpendMicros",
      "currency",
      "dailySpendBeforeMicros",
      "dailySpendAfterMicros",
      "policyRef",
      "decision",
      "decisionHash",
      "taskInputHash",
      "context",
      "requestedBy",
      "requestId"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["AutonomousRoutineExecutionReceipt.v1"] },
      tenantId: { type: "string" },
      routineId: { type: "string" },
      executionId: { type: "string" },
      requestedAt: { type: "string", format: "date-time" },
      executedAt: { type: "string", format: "date-time" },
      requestedSpendMicros: { type: "integer", minimum: 0 },
      currency: { type: "string", pattern: "^[A-Z]{3}$" },
      dailySpendBeforeMicros: { type: "integer", minimum: 0 },
      dailySpendAfterMicros: { type: "integer", minimum: 0 },
      policyRef: { type: "object", additionalProperties: false, required: ["schemaVersion", "routineId", "policyRevision", "policyHash"], properties: {
        schemaVersion: { type: "string", enum: ["AutonomousRoutinePolicy.v1"] },
        routineId: { type: "string" },
        policyRevision: { type: "integer", minimum: 0 },
        policyHash: { type: "string" }
      } },
      decision: AutonomousRoutineExecutionDecision,
      decisionHash: { type: "string" },
      taskInputHash: { type: "string", nullable: true },
      context: { type: "object", additionalProperties: true, nullable: true },
      requestedBy: {
        type: "object",
        additionalProperties: false,
        required: ["principalId", "keyId"],
        properties: {
          principalId: { type: "string", nullable: true },
          keyId: { type: "string", nullable: true }
        }
      },
      requestId: { type: "string", nullable: true }
    }
  };

  const AutonomousRoutineExecuteRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      execution: {
        type: "object",
        additionalProperties: false,
        required: ["executionId", "requestedAt", "requestedSpendMicros", "currency"],
        properties: {
          executionId: { type: "string" },
          routineId: { type: "string", nullable: true },
          requestedAt: { type: "string", format: "date-time" },
          requestedSpendMicros: { type: "integer", minimum: 0 },
          currency: { type: "string", pattern: "^[A-Z]{3}$" },
          expectedPolicyRevision: { type: "integer", minimum: 0, nullable: true },
          taskInputHash: { type: "string", nullable: true },
          context: { type: "object", additionalProperties: true, nullable: true }
        }
      },
      executionId: { type: "string" },
      routineId: { type: "string", nullable: true },
      requestedAt: { type: "string", format: "date-time" },
      requestedSpendMicros: { type: "integer", minimum: 0 },
      currency: { type: "string", pattern: "^[A-Z]{3}$" },
      expectedPolicyRevision: { type: "integer", minimum: 0, nullable: true },
      taskInputHash: { type: "string", nullable: true },
      context: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const AutonomousRoutinePolicyResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "routine"],
    properties: {
      ok: { type: "boolean" },
      created: { type: "boolean", nullable: true },
      tenantId: { type: "string" },
      routine: AutonomousRoutinePolicy
    }
  };

  const AutonomousRoutinePolicyListResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "status", "killSwitchActive", "limit", "offset", "routines"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      status: { ...AutonomousRoutineStatus, nullable: true },
      killSwitchActive: { type: "boolean", nullable: true },
      limit: { type: "integer", minimum: 1 },
      offset: { type: "integer", minimum: 0 },
      routines: { type: "array", items: AutonomousRoutinePolicy }
    }
  };

  const AutonomousRoutineExecutionResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "routineId", "execution"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      routineId: { type: "string" },
      code: { type: "string", nullable: true },
      message: { type: "string", nullable: true },
      execution: AutonomousRoutineExecutionReceipt
    }
  };

  const AutonomousRoutineExecutionListResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "routineId", "allowed", "limit", "offset", "executions"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      routineId: { type: "string" },
      allowed: { type: "boolean", nullable: true },
      limit: { type: "integer", minimum: 1 },
      offset: { type: "integer", minimum: 0 },
      executions: { type: "array", items: AutonomousRoutineExecutionReceipt }
    }
  };

  const AutonomousRoutineIncidentListResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "routineId", "action", "limit", "offset", "incidents"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      routineId: { type: "string" },
      action: { ...AutonomousRoutineControlAction, nullable: true },
      limit: { type: "integer", minimum: 1 },
      offset: { type: "integer", minimum: 0 },
      incidents: { type: "array", items: AutonomousRoutineControlEvent }
    }
  };

  const MarketplaceAgreementAcceptanceSignatureV2 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "agreementId",
      "tenantId",
      "rfqId",
      "runId",
      "bidId",
      "acceptedByAgentId",
      "acceptedProposalId",
      "acceptedRevision",
      "acceptedProposalHash",
      "offerChainHash",
      "proposalCount",
      "signerAgentId",
      "signerKeyId",
      "signedAt",
      "acceptanceHash",
      "signature"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceAgreementAcceptanceSignature.v2"] },
      agreementId: { type: "string" },
      tenantId: { type: "string" },
      rfqId: { type: "string" },
      runId: { type: "string" },
      bidId: { type: "string" },
      acceptedByAgentId: { type: "string" },
      acceptedProposalId: { type: "string", nullable: true },
      acceptedRevision: { type: "integer", minimum: 1, nullable: true },
      acceptedProposalHash: { type: "string", nullable: true },
      offerChainHash: { type: "string", nullable: true },
      proposalCount: { type: "integer", minimum: 1, nullable: true },
      actingOnBehalfOfPrincipalAgentId: { type: "string", nullable: true },
      actingOnBehalfOfDelegateAgentId: { type: "string", nullable: true },
      actingOnBehalfOfChainHash: { type: "string", nullable: true },
      signerAgentId: { type: "string" },
      signerKeyId: { type: "string" },
      signedAt: { type: "string", format: "date-time" },
      actingOnBehalfOf: { allOf: [AgentActingOnBehalfOfV1], nullable: true },
      acceptanceHash: { type: "string" },
      signature: { type: "string" }
    }
  };

  const MarketplaceAgreementChangeOrderAcceptanceSignatureV2 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "tenantId",
      "runId",
      "agreementId",
      "rfqId",
      "bidId",
      "changeOrderId",
      "requestedByAgentId",
      "acceptedByAgentId",
      "reason",
      "previousTermsHash",
      "milestonesHash",
      "cancellationHash",
      "signerAgentId",
      "signerKeyId",
      "signedAt",
      "acceptanceHash",
      "signature"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceAgreementChangeOrderAcceptanceSignature.v2"] },
      tenantId: { type: "string" },
      runId: { type: "string" },
      agreementId: { type: "string" },
      rfqId: { type: "string" },
      bidId: { type: "string" },
      changeOrderId: { type: "string" },
      requestedByAgentId: { type: "string" },
      acceptedByAgentId: { type: "string" },
      reason: { type: "string" },
      note: { type: "string", nullable: true },
      previousTermsHash: { type: "string", nullable: true },
      milestonesHash: { type: "string" },
      cancellationHash: { type: "string" },
      actingOnBehalfOfPrincipalAgentId: { type: "string", nullable: true },
      actingOnBehalfOfDelegateAgentId: { type: "string", nullable: true },
      actingOnBehalfOfChainHash: { type: "string", nullable: true },
      signerAgentId: { type: "string" },
      signerKeyId: { type: "string" },
      signedAt: { type: "string", format: "date-time" },
      actingOnBehalfOf: { allOf: [AgentActingOnBehalfOfV1], nullable: true },
      acceptanceHash: { type: "string" },
      signature: { type: "string" }
    }
  };

  const MarketplaceAgreementCancellationAcceptanceSignatureV2 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "tenantId",
      "runId",
      "agreementId",
      "rfqId",
      "bidId",
      "cancellationId",
      "cancelledByAgentId",
      "acceptedByAgentId",
      "reason",
      "termsHash",
      "killFeeRatePct",
      "signerAgentId",
      "signerKeyId",
      "signedAt",
      "acceptanceHash",
      "signature"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceAgreementCancellationAcceptanceSignature.v2"] },
      tenantId: { type: "string" },
      runId: { type: "string" },
      agreementId: { type: "string" },
      rfqId: { type: "string" },
      bidId: { type: "string" },
      cancellationId: { type: "string" },
      cancelledByAgentId: { type: "string" },
      acceptedByAgentId: { type: "string" },
      reason: { type: "string" },
      evidenceRef: { type: "string", nullable: true },
      termsHash: { type: "string" },
      killFeeRatePct: { type: "integer", minimum: 0, maximum: 100 },
      actingOnBehalfOfPrincipalAgentId: { type: "string", nullable: true },
      actingOnBehalfOfDelegateAgentId: { type: "string", nullable: true },
      actingOnBehalfOfChainHash: { type: "string", nullable: true },
      signerAgentId: { type: "string" },
      signerKeyId: { type: "string" },
      signedAt: { type: "string", format: "date-time" },
      actingOnBehalfOf: { allOf: [AgentActingOnBehalfOfV1], nullable: true },
      acceptanceHash: { type: "string" },
      signature: { type: "string" }
    }
  };

  const MarketplaceAgreementAcceptanceSignatureInput = {
    type: "object",
    additionalProperties: false,
    required: ["signerKeyId", "signature"],
    properties: {
      signerAgentId: { type: "string" },
      signerKeyId: { type: "string" },
      signedAt: { type: "string", format: "date-time" },
      actingOnBehalfOf: AgentActingOnBehalfOfV1,
      signature: { type: "string" }
    }
  };

  const MarketplaceAgreementPolicyBindingV2 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "agreementId",
      "tenantId",
      "rfqId",
      "runId",
      "bidId",
      "acceptedAt",
      "acceptedByAgentId",
      "offerChainHash",
      "acceptedProposalId",
      "acceptedRevision",
      "acceptedProposalHash",
      "termsHash",
      "policyHash",
      "verificationMethodHash",
      "policyRefHash",
      "policyRef",
      "signerKeyId",
      "signedAt",
      "bindingHash",
      "signature"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceAgreementPolicyBinding.v2"] },
      agreementId: { type: "string" },
      tenantId: { type: "string" },
      rfqId: { type: "string" },
      runId: { type: "string" },
      bidId: { type: "string" },
      acceptedAt: { type: "string", format: "date-time", nullable: true },
      acceptedByAgentId: { type: "string", nullable: true },
      offerChainHash: { type: "string", nullable: true },
      acceptedProposalId: { type: "string", nullable: true },
      acceptedRevision: { type: "integer", minimum: 1, nullable: true },
      acceptedProposalHash: { type: "string", nullable: true },
      termsHash: { type: "string" },
      policyHash: { type: "string" },
      verificationMethodHash: { type: "string" },
      policyRefHash: { type: "string" },
      policyRef: MarketplaceSettlementPolicyRefV1,
      signerKeyId: { type: "string" },
      signedAt: { type: "string", format: "date-time" },
      bindingHash: { type: "string" },
      signature: { type: "string" }
    }
  };

  const MarketplaceBidNegotiationProposalV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "proposalId",
      "bidId",
      "revision",
      "proposerAgentId",
      "amountCents",
      "currency",
      "verificationMethod",
      "policy",
      "policyRef",
      "proposedAt"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceBidProposal.v1"] },
      proposalId: { type: "string" },
      bidId: { type: "string" },
      revision: { type: "integer", minimum: 1 },
      proposerAgentId: { type: "string" },
      amountCents: { type: "integer", minimum: 1 },
      currency: { type: "string" },
      etaSeconds: { type: "integer", minimum: 1, nullable: true },
      note: { type: "string", nullable: true },
      verificationMethod: VerificationMethodV1,
      policy: SettlementPolicyV1,
      policyRef: MarketplaceSettlementPolicyRefV1,
      policyRefHash: { type: "string" },
      prevProposalHash: { type: "string", nullable: true },
      proposalHash: { type: "string" },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      proposedAt: { type: "string", format: "date-time" }
    }
  };

  const MarketplaceBidNegotiationV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "bidId", "state", "latestRevision", "proposals", "createdAt", "updatedAt"],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceBidNegotiation.v1"] },
      bidId: { type: "string" },
      state: { type: "string", enum: ["open", "accepted", "rejected", "cancelled", "expired"] },
      latestRevision: { type: "integer", minimum: 1 },
      acceptedRevision: { type: "integer", minimum: 1, nullable: true },
      acceptedProposalId: { type: "string", nullable: true },
      acceptedAt: { type: "string", format: "date-time", nullable: true },
      acceptance: { ...MarketplaceBidAcceptanceV1, nullable: true },
      counterOfferPolicy: MarketplaceCounterOfferPolicyV1,
      expiresAt: { type: "string", format: "date-time", nullable: true },
      expiredAt: { type: "string", format: "date-time", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      proposals: {
        type: "array",
        minItems: 1,
        items: MarketplaceBidNegotiationProposalV1
      }
    }
  };

  const MarketplaceAgreementNegotiationV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "state", "latestRevision", "acceptedRevision", "acceptedProposalId", "proposalCount"],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceAgreementNegotiation.v1"] },
      state: { type: "string", enum: ["open", "accepted", "rejected", "cancelled", "expired"] },
      latestRevision: { type: "integer", minimum: 1 },
      acceptedRevision: { type: "integer", minimum: 1, nullable: true },
      acceptedProposalId: { type: "string", nullable: true },
      proposalCount: { type: "integer", minimum: 1 }
    }
  };

  const MarketplaceCapabilityPriceModelV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "mode", "currency"],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceCapabilityPriceModel.v1"] },
      mode: { type: "string", enum: ["fixed", "hourly", "per_unit", "quote"] },
      amountCents: { type: "integer", minimum: 1, nullable: true },
      minAmountCents: { type: "integer", minimum: 1, nullable: true },
      maxAmountCents: { type: "integer", minimum: 1, nullable: true },
      currency: { type: "string" },
      unit: { type: "string", nullable: true }
    }
  };

  const MarketplaceCapabilityAvailabilityV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "timezone", "windows"],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceCapabilityAvailability.v1"] },
      timezone: { type: "string", nullable: true },
      windows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true
        }
      }
    }
  };

  const MarketplaceCapabilityListingV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "listingId",
      "tenantId",
      "capability",
      "title",
      "status",
      "tags",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceCapabilityListing.v1"] },
      listingId: { type: "string" },
      tenantId: { type: "string" },
      capability: { type: "string" },
      title: { type: "string" },
      description: { type: "string", nullable: true },
      category: { type: "string", nullable: true },
      sellerAgentId: { type: "string", nullable: true },
      status: { type: "string", enum: ["active", "paused", "retired"] },
      tags: {
        type: "array",
        items: { type: "string" }
      },
      priceModel: { ...MarketplaceCapabilityPriceModelV1, nullable: true },
      availability: { ...MarketplaceCapabilityAvailabilityV1, nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const MarketplaceCapabilityListingUpsertRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      listingId: { type: "string" },
      capability: { type: "string" },
      title: { type: "string" },
      description: { type: "string", nullable: true },
      category: { type: "string", nullable: true },
      sellerAgentId: { type: "string", nullable: true },
      status: { type: "string", enum: ["active", "paused", "retired"] },
      tags: {
        type: "array",
        items: { type: "string" }
      },
      priceModel: { ...MarketplaceCapabilityPriceModelV1, nullable: true },
      availability: { ...MarketplaceCapabilityAvailabilityV1, nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const ProviderConformanceVerdictV1 = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "requiredChecks", "passedChecks"],
    properties: {
      ok: { type: "boolean" },
      requiredChecks: { type: "integer", minimum: 0 },
      passedChecks: { type: "integer", minimum: 0 }
    }
  };

  const ProviderConformanceSummaryV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "generatedAt", "verdict"],
    properties: {
      schemaVersion: { type: "string" },
      generatedAt: { type: "string", format: "date-time", nullable: true },
      verdict: ProviderConformanceVerdictV1
    }
  };

  const MarketplaceProviderCertificationBadgeV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "providerId",
      "providerRef",
      "publicationId",
      "status",
      "certified",
      "manifestHash",
      "providerSigningKeyId",
      "toolCount",
      "conformance",
      "badgeHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceProviderCertificationBadge.v1"] },
      providerId: { type: "string" },
      providerRef: { type: "string" },
      publicationId: { type: "string" },
      status: { type: "string", enum: ["certified", "conformance_failed", "draft"] },
      certified: { type: "boolean" },
      certifiedAt: { type: "string", format: "date-time", nullable: true },
      updatedAt: { type: "string", format: "date-time", nullable: true },
      manifestHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      providerSigningKeyId: { type: "string", nullable: true },
      toolCount: { type: "integer", minimum: 0 },
      conformance: { ...ProviderConformanceSummaryV1, nullable: true },
      badgeHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const MarketplaceProviderPublicationSummaryV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "publicationId",
      "tenantId",
      "providerId",
      "providerRef",
      "status",
      "certified",
      "baseUrl",
      "tags",
      "toolCount",
      "manifestSchemaVersion",
      "manifestHash",
      "conformance",
      "certificationBadge",
      "publishedAt",
      "certifiedAt",
      "updatedAt"
    ],
    properties: {
      schemaVersion: { type: "string" },
      publicationId: { type: "string" },
      tenantId: { type: "string" },
      providerId: { type: "string" },
      providerRef: { type: "string", nullable: true },
      status: { type: "string", enum: ["certified", "conformance_failed", "draft"] },
      certified: { type: "boolean" },
      baseUrl: { type: "string" },
      description: { type: "string", nullable: true },
      tags: {
        type: "array",
        items: { type: "string" }
      },
      toolCount: { type: "integer", minimum: 0 },
      manifestSchemaVersion: { type: "string" },
      manifestHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      conformance: { ...ProviderConformanceSummaryV1, nullable: true },
      certificationBadge: { ...MarketplaceProviderCertificationBadgeV1, nullable: true },
      publishedAt: { type: "string", format: "date-time", nullable: true },
      certifiedAt: { type: "string", format: "date-time", nullable: true },
      updatedAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const MarketplaceToolListingV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "providerId",
      "providerRef",
      "publicationId",
      "certified",
      "providerStatus",
      "providerTags",
      "manifestSchemaVersion",
      "manifestHash",
      "toolId",
      "pricing",
      "certificationBadge",
      "publishedAt",
      "updatedAt"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceToolListing.v1"] },
      providerId: { type: "string" },
      providerRef: { type: "string", nullable: true },
      publicationId: { type: "string" },
      certified: { type: "boolean" },
      providerStatus: { type: "string", enum: ["certified", "conformance_failed", "draft"] },
      providerDescription: { type: "string", nullable: true },
      providerTags: {
        type: "array",
        items: { type: "string" }
      },
      manifestSchemaVersion: { type: "string", nullable: true },
      manifestHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
      toolId: { type: "string" },
      mcpToolName: { type: "string", nullable: true },
      description: { type: "string", nullable: true },
      method: { type: "string", nullable: true },
      paidPath: { type: "string", nullable: true },
      upstreamPath: { type: "string", nullable: true },
      tags: {
        type: "array",
        items: { type: "string" }
      },
      pricing: {
        type: "object",
        additionalProperties: false,
        required: ["amountCents", "currency"],
        properties: {
          amountCents: { type: "integer", minimum: 1, nullable: true },
          currency: { type: "string", nullable: true }
        }
      },
      idempotency: { type: "string", nullable: true },
      signatureMode: { type: "string", nullable: true },
      authMode: { type: "string", nullable: true },
      certificationBadge: { ...MarketplaceProviderCertificationBadgeV1, nullable: true },
      publishedAt: { type: "string", format: "date-time", nullable: true },
      updatedAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const MarketplaceRfqV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "rfqId", "tenantId", "title", "status", "currency", "createdAt", "updatedAt"],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceRfq.v1"] },
      rfqId: { type: "string" },
      tenantId: { type: "string" },
      title: { type: "string" },
      description: { type: "string", nullable: true },
      capability: { type: "string", nullable: true },
      fromType: InteractionDirectionEntityType,
      toType: InteractionDirectionEntityType,
      posterAgentId: { type: "string", nullable: true },
      status: { type: "string", enum: ["open", "assigned", "cancelled", "closed"] },
      budgetCents: { type: "integer", nullable: true, minimum: 1 },
      currency: { type: "string" },
      deadlineAt: { type: "string", format: "date-time", nullable: true },
      acceptedBidId: { type: "string", nullable: true },
      acceptedBidderAgentId: { type: "string", nullable: true },
      acceptedAt: { type: "string", format: "date-time", nullable: true },
      acceptedByAgentId: { type: "string", nullable: true },
      counterOfferPolicy: { ...MarketplaceCounterOfferPolicyV1, nullable: true },
      approval: { ...ApprovalChainRefV1, nullable: true },
      runId: { type: "string", nullable: true },
      agreementId: { type: "string", nullable: true },
      agreement: {
        type: "object",
        additionalProperties: true,
        nullable: true
      },
      settlementId: { type: "string", nullable: true },
      settlementStatus: { type: "string", enum: ["locked", "released", "refunded"], nullable: true },
      settlementResolvedAt: { type: "string", format: "date-time", nullable: true },
      settlementReleaseRatePct: { type: "integer", minimum: 0, maximum: 100, nullable: true },
      settlementDecisionStatus: {
        type: "string",
        enum: ["pending", "auto_resolved", "manual_review_required", "manual_resolved"],
        nullable: true
      },
      settlementDecisionReason: { type: "string", nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const MarketplaceTaskAgreementV2 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "agreementId",
      "tenantId",
      "rfqId",
      "runId",
      "bidId",
      "payerAgentId",
      "payeeAgentId",
      "fromType",
      "toType",
      "amountCents",
      "currency",
      "acceptedAt",
      "disputeWindowDays",
      "termsHash",
      "verificationMethodHash",
      "policyHash",
      "policyRef"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceTaskAgreement.v2"] },
      agreementId: { type: "string" },
      tenantId: { type: "string" },
      rfqId: { type: "string" },
      runId: { type: "string" },
      bidId: { type: "string" },
      payerAgentId: { type: "string" },
      payeeAgentId: { type: "string" },
      fromType: InteractionDirectionEntityType,
      toType: InteractionDirectionEntityType,
      amountCents: { type: "integer", minimum: 1 },
      currency: { type: "string" },
      acceptedAt: { type: "string", format: "date-time" },
      acceptedByAgentId: { type: "string", nullable: true },
      disputeWindowDays: { type: "integer", minimum: 0 },
      agreementRevision: { type: "integer", minimum: 1, nullable: true },
      updatedAt: { type: "string", format: "date-time", nullable: true },
      offerChainHash: { type: "string", nullable: true },
      acceptedProposalId: { type: "string", nullable: true },
      acceptedRevision: { type: "integer", minimum: 1, nullable: true },
      acceptedProposalHash: { type: "string", nullable: true },
      offer: { ...MarketplaceOfferV2, nullable: true },
      offerHash: { type: "string", nullable: true },
      offerAcceptance: { ...MarketplaceAcceptanceV2, nullable: true },
      offerAcceptanceHash: { type: "string", nullable: true },
      negotiation: { ...MarketplaceAgreementNegotiationV1, nullable: true },
      acceptance: { ...MarketplaceAgreementAcceptanceV1, nullable: true },
      acceptanceSignature: { ...MarketplaceAgreementAcceptanceSignatureV2, nullable: true },
      termsHash: { type: "string" },
      verificationMethodHash: { type: "string" },
      policyHash: { type: "string" },
      policyRef: MarketplaceSettlementPolicyRefV1,
      policyBinding: { ...MarketplaceAgreementPolicyBindingV2, nullable: true },
      verificationMethod: VerificationMethodV1,
      policy: SettlementPolicyV1,
      terms: MarketplaceAgreementTermsV1
    }
  };

  const MarketplaceRfqCreateRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      rfqId: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      capability: { type: "string" },
      fromType: InteractionDirectionEntityType,
      toType: InteractionDirectionEntityType,
      posterAgentId: { type: "string" },
      budgetCents: { type: "integer", minimum: 1 },
      currency: { type: "string" },
      deadlineAt: { type: "string", format: "date-time" },
      counterOfferPolicy: {
        type: "object",
        additionalProperties: false,
        properties: {
          allowPosterCounterOffers: { type: "boolean" },
          allowBidderCounterOffers: { type: "boolean" },
          maxRevisions: { type: "integer", minimum: 1 },
          timeoutSeconds: { type: "integer", minimum: 1 }
        }
      },
      approvalMode: { type: "string", enum: ["detect", "require"], nullable: true },
      approvalPolicy: { ...X402HumanApprovalPolicyV1, nullable: true },
      approvalContinuation: { ...ApprovalContinuationOptions, nullable: true },
      authorityEnvelope: { ...AuthorityEnvelopeV1, nullable: true },
      approvalRequest: { ...ApprovalRequestV1, nullable: true },
      approvalDecision: { ...ApprovalDecisionV1, nullable: true },
      humanApprovalDecision: { ...X402HumanApprovalDecisionV1, nullable: true },
      metadata: { type: "object", additionalProperties: true }
    }
  };

  const MarketplaceRfqBidV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "bidId",
      "rfqId",
      "tenantId",
      "bidderAgentId",
      "amountCents",
      "currency",
      "status",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceBid.v1"] },
      bidId: { type: "string" },
      rfqId: { type: "string" },
      tenantId: { type: "string" },
      fromType: InteractionDirectionEntityType,
      toType: InteractionDirectionEntityType,
      bidderAgentId: { type: "string" },
      amountCents: { type: "integer", minimum: 1 },
      currency: { type: "string" },
      etaSeconds: { type: "integer", nullable: true, minimum: 1 },
      note: { type: "string", nullable: true },
      verificationMethod: VerificationMethodV1,
      policy: SettlementPolicyV1,
      policyRef: { ...MarketplaceSettlementPolicyRefV1, nullable: true },
      status: { type: "string", enum: ["pending", "accepted", "rejected"] },
      acceptedAt: { type: "string", format: "date-time", nullable: true },
      rejectedAt: { type: "string", format: "date-time", nullable: true },
      negotiation: { ...MarketplaceBidNegotiationV1, nullable: true },
      counterOfferPolicy: { ...MarketplaceCounterOfferPolicyV1, nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const MarketplaceBidCreateRequest = {
    type: "object",
    additionalProperties: false,
    required: ["bidderAgentId", "amountCents"],
    properties: {
      bidId: { type: "string" },
      proposalId: { type: "string" },
      fromType: InteractionDirectionEntityType,
      toType: InteractionDirectionEntityType,
      bidderAgentId: { type: "string" },
      amountCents: { type: "integer", minimum: 1 },
      currency: { type: "string" },
      etaSeconds: { type: "integer", minimum: 1 },
      note: { type: "string" },
      verificationMethod: {
        type: "object",
        additionalProperties: false,
        properties: {
          verificationMethodHash: { type: "string" },
          mode: { type: "string", enum: ["deterministic", "attested", "discretionary"] },
          source: { type: "string" },
          attestor: { type: "string" },
          notes: { type: "string" }
        }
      },
      policy: {
        type: "object",
        additionalProperties: false,
        properties: {
          policyHash: { type: "string" },
          policyVersion: { type: "integer", minimum: 1 },
          mode: { type: "string", enum: ["automatic", "manual-review"] },
          rules: {
            type: "object",
            additionalProperties: false,
            properties: {
              requireDeterministicVerification: { type: "boolean" },
              autoReleaseOnGreen: { type: "boolean" },
              autoReleaseOnAmber: { type: "boolean" },
              autoReleaseOnRed: { type: "boolean" },
              greenReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
              amberReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
              redReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
              maxAutoReleaseAmountCents: { type: "integer", minimum: 1 },
              manualReason: { type: "string" }
            }
          }
        }
      },
      policyRef: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: "string", enum: ["tenant_registry", "inline"] },
          policyId: { type: "string" },
          policyVersion: { type: "integer", minimum: 1 },
          policyHash: { type: "string" },
          verificationMethodHash: { type: "string" }
        }
      },
      metadata: { type: "object", additionalProperties: true }
    }
  };

  const MarketplaceBidCounterOfferRequest = {
    type: "object",
    additionalProperties: false,
    required: ["proposerAgentId"],
    properties: {
      proposalId: { type: "string" },
      proposerAgentId: { type: "string" },
      amountCents: { type: "integer", minimum: 1 },
      currency: { type: "string" },
      etaSeconds: { type: "integer", minimum: 1, nullable: true },
      note: { type: "string", nullable: true },
      verificationMethod: {
        type: "object",
        additionalProperties: false,
        properties: {
          verificationMethodHash: { type: "string" },
          mode: { type: "string", enum: ["deterministic", "attested", "discretionary"] },
          source: { type: "string" },
          attestor: { type: "string" },
          notes: { type: "string" }
        }
      },
      policy: {
        type: "object",
        additionalProperties: false,
        properties: {
          policyHash: { type: "string" },
          policyVersion: { type: "integer", minimum: 1 },
          mode: { type: "string", enum: ["automatic", "manual-review"] },
          rules: {
            type: "object",
            additionalProperties: false,
            properties: {
              requireDeterministicVerification: { type: "boolean" },
              autoReleaseOnGreen: { type: "boolean" },
              autoReleaseOnAmber: { type: "boolean" },
              autoReleaseOnRed: { type: "boolean" },
              greenReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
              amberReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
              redReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
              maxAutoReleaseAmountCents: { type: "integer", minimum: 1 },
              manualReason: { type: "string" }
            }
          }
        }
      },
      policyRef: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: "string", enum: ["tenant_registry", "inline"] },
          policyId: { type: "string" },
          policyVersion: { type: "integer", minimum: 1 },
          policyHash: { type: "string" },
          verificationMethodHash: { type: "string" }
        }
      },
      metadata: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const MarketplaceBidAcceptRequest = {
    type: "object",
    additionalProperties: false,
    required: ["bidId"],
    properties: {
      bidId: { type: "string" },
      acceptedByAgentId: { type: "string" },
      runId: { type: "string" },
      taskType: { type: "string" },
      inputRef: { type: "string" },
      payerAgentId: { type: "string" },
      fromType: InteractionDirectionEntityType,
      toType: InteractionDirectionEntityType,
      disputeWindowDays: { type: "integer", minimum: 0 },
      acceptanceSignature: MarketplaceAgreementAcceptanceSignatureInput,
      agreementTerms: MarketplaceAgreementTermsInput,
      verificationMethod: {
        type: "object",
        additionalProperties: false,
        properties: {
          verificationMethodHash: { type: "string" },
          mode: { type: "string", enum: ["deterministic", "attested", "discretionary"] },
          source: { type: "string" },
          attestor: { type: "string" },
          notes: { type: "string" }
        }
      },
      policy: {
        type: "object",
        additionalProperties: false,
        properties: {
          policyHash: { type: "string" },
          policyVersion: { type: "integer", minimum: 1 },
          mode: { type: "string", enum: ["automatic", "manual-review"] },
          rules: {
            type: "object",
            additionalProperties: false,
            properties: {
              requireDeterministicVerification: { type: "boolean" },
              autoReleaseOnGreen: { type: "boolean" },
              autoReleaseOnAmber: { type: "boolean" },
              autoReleaseOnRed: { type: "boolean" },
              greenReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
              amberReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
              redReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
              maxAutoReleaseAmountCents: { type: "integer", minimum: 1 },
              manualReason: { type: "string" }
            }
          }
        }
      },
      policyRef: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: "string", enum: ["tenant_registry", "inline"] },
          policyId: { type: "string" },
          policyVersion: { type: "integer", minimum: 1 },
          policyHash: { type: "string" },
          verificationMethodHash: { type: "string" }
        }
      },
      settlement: {
        type: "object",
        additionalProperties: false,
        properties: {
          payerAgentId: { type: "string" },
          fromType: InteractionDirectionEntityType,
          toType: InteractionDirectionEntityType,
          amountCents: { type: "integer", minimum: 1 },
          currency: { type: "string" },
          disputeWindowDays: { type: "integer", minimum: 0 },
          agreementTerms: MarketplaceAgreementTermsInput,
          verificationMethod: {
            type: "object",
            additionalProperties: false,
            properties: {
              verificationMethodHash: { type: "string" },
              mode: { type: "string", enum: ["deterministic", "attested", "discretionary"] },
              source: { type: "string" },
              attestor: { type: "string" },
              notes: { type: "string" }
            }
          },
          policy: {
            type: "object",
            additionalProperties: false,
            properties: {
              policyHash: { type: "string" },
              policyVersion: { type: "integer", minimum: 1 },
              mode: { type: "string", enum: ["automatic", "manual-review"] },
              rules: {
                type: "object",
                additionalProperties: false,
                properties: {
                  requireDeterministicVerification: { type: "boolean" },
                  autoReleaseOnGreen: { type: "boolean" },
                  autoReleaseOnAmber: { type: "boolean" },
                  autoReleaseOnRed: { type: "boolean" },
                  greenReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
                  amberReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
                  redReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
                  maxAutoReleaseAmountCents: { type: "integer", minimum: 1 },
                  manualReason: { type: "string" }
                }
              }
            }
          },
          policyRef: {
            type: "object",
            additionalProperties: false,
            properties: {
              source: { type: "string", enum: ["tenant_registry", "inline"] },
              policyId: { type: "string" },
              policyVersion: { type: "integer", minimum: 1 },
              policyHash: { type: "string" },
              verificationMethodHash: { type: "string" }
            }
          }
        }
      }
    }
  };

  const MarketplaceBidAutoAcceptRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      acceptedByAgentId: { type: "string" },
      runId: { type: "string" },
      taskType: { type: "string" },
      inputRef: { type: "string" },
      payerAgentId: { type: "string" },
      fromType: InteractionDirectionEntityType,
      toType: InteractionDirectionEntityType,
      disputeWindowDays: { type: "integer", minimum: 0 },
      acceptanceSignature: MarketplaceAgreementAcceptanceSignatureInput,
      agreementTerms: MarketplaceAgreementTermsInput,
      verificationMethod: MarketplaceBidAcceptRequest.properties.verificationMethod,
      policy: MarketplaceBidAcceptRequest.properties.policy,
      policyRef: MarketplaceBidAcceptRequest.properties.policyRef,
      settlement: MarketplaceBidAcceptRequest.properties.settlement,
      selectionStrategy: {
        type: "string",
        enum: ["lowest_amount_then_eta"]
      },
      strategy: {
        type: "string",
        enum: ["lowest_amount_then_eta"]
      },
      allowOverBudget: { type: "boolean" }
    }
  };

  const MarketplaceAutoAwardDecisionCandidate = {
    type: "object",
    additionalProperties: false,
    required: ["rank", "bidId", "amountCents", "currency"],
    properties: {
      rank: { type: "integer", minimum: 1 },
      bidId: { type: "string" },
      bidderAgentId: { type: "string", nullable: true },
      amountCents: { type: "integer", minimum: 1 },
      currency: { type: "string" },
      etaSeconds: { type: "integer", minimum: 1, nullable: true },
      createdAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const MarketplaceAutoAwardDecisionV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "rfqId",
      "strategy",
      "allowOverBudget",
      "decidedAt",
      "outcome",
      "tiedBidIds",
      "consideredBidCount",
      "consideredBids",
      "decisionHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["MarketplaceAutoAwardDecision.v1"] },
      rfqId: { type: "string" },
      strategy: { type: "string", enum: ["lowest_amount_then_eta"] },
      allowOverBudget: { type: "boolean" },
      budgetCents: { type: "integer", minimum: 1, nullable: true },
      decidedAt: { type: "string", format: "date-time" },
      outcome: { type: "string", enum: ["selected", "blocked"] },
      reasonCode: { type: "string", nullable: true },
      selectedBidId: { type: "string", nullable: true },
      tiedBidIds: { type: "array", items: { type: "string" } },
      consideredBidCount: { type: "integer", minimum: 0 },
      consideredBids: { type: "array", items: MarketplaceAutoAwardDecisionCandidate },
      decisionHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const RouterDispatchRequest = {
    type: "object",
    additionalProperties: false,
    required: ["launchId"],
    properties: {
      launchId: { type: "string" },
      dispatchId: { type: "string" },
      taskIds: { type: "array", items: { type: "string" } },
      acceptedByAgentId: { type: "string" },
      payerAgentId: { type: "string" },
      selectionStrategy: { type: "string", enum: ["lowest_amount_then_eta"] },
      strategy: { type: "string", enum: ["lowest_amount_then_eta"] },
      allowOverBudget: { type: "boolean" }
    }
  };

  const RouterMarketplaceDispatchTaskV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "taskId",
      "taskIndex",
      "rfqId",
      "dependsOnTaskIds",
      "state",
      "blockingTaskIds"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["RouterMarketplaceDispatchTask.v1"] },
      taskId: { type: "string" },
      taskIndex: { type: "integer", minimum: 1 },
      rfqId: { type: "string" },
      dependsOnTaskIds: { type: "array", items: { type: "string" } },
      state: {
        type: "string",
        enum: [
          "accepted",
          "already_assigned",
          "already_closed",
          "blocked_dependencies_pending",
          "blocked_dependency_cancelled",
          "blocked_dependency_missing",
          "blocked_no_pending_bids",
          "blocked_ambiguous",
          "blocked_over_budget",
          "blocked_accept_failed",
          "blocked_rfq_cancelled",
          "blocked_rfq_invalid"
        ]
      },
      reasonCode: { type: "string", nullable: true },
      rfqStatus: { type: "string", nullable: true },
      acceptedBidId: { type: "string", nullable: true },
      runId: { type: "string", nullable: true },
      decisionHash: { type: "string", nullable: true },
      blockingTaskIds: { type: "array", items: { type: "string" } }
    }
  };

  const RouterMarketplaceDispatchV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "dispatchId",
      "launchRef",
      "tenantId",
      "posterAgentId",
      "selectionStrategy",
      "allowOverBudget",
      "taskCount",
      "acceptedCount",
      "noopCount",
      "blockedCount",
      "tasks",
      "dispatchedAt",
      "dispatchHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["RouterMarketplaceDispatch.v1"] },
      dispatchId: { type: "string" },
      launchRef: {
        type: "object",
        additionalProperties: false,
        required: ["launchId"],
        properties: {
          launchId: { type: "string" },
          launchHash: { type: "string", nullable: true },
          planId: { type: "string", nullable: true },
          planHash: { type: "string", nullable: true },
          requestTextSha256: { type: "string", nullable: true }
        }
      },
      tenantId: { type: "string" },
      posterAgentId: { type: "string" },
      selectionStrategy: { type: "string", enum: ["lowest_amount_then_eta"] },
      allowOverBudget: { type: "boolean" },
      taskCount: { type: "integer", minimum: 0 },
      acceptedCount: { type: "integer", minimum: 0 },
      noopCount: { type: "integer", minimum: 0 },
      blockedCount: { type: "integer", minimum: 0 },
      tasks: { type: "array", items: RouterMarketplaceDispatchTaskV1 },
      metadata: { type: "object", nullable: true },
      dispatchedAt: { type: "string", format: "date-time" },
      dispatchHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const RouterRequestV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "text", "asOf"],
    properties: {
      schemaVersion: { type: "string", enum: ["RouterRequest.v1"] },
      text: { type: "string" },
      asOf: { type: "string", format: "date-time", nullable: true }
    }
  };

  const RouterIntentV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "intentId", "label", "score"],
    properties: {
      schemaVersion: { type: "string", enum: ["RouterIntent.v1"] },
      intentId: { type: "string" },
      label: { type: "string" },
      score: { type: "number" }
    }
  };

  const RouterPlanCandidateV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "agentId", "tenantId", "displayName", "rank", "rankingScore", "trustScore", "riskTier", "priceHint", "routingFactors"],
    properties: {
      schemaVersion: { type: "string", enum: ["RouterPlanCandidate.v1"] },
      agentId: { type: "string" },
      tenantId: { type: "string" },
      displayName: { type: "string" },
      rank: { type: "integer", minimum: 1, nullable: true },
      rankingScore: { type: "number", nullable: true },
      trustScore: { type: "integer", minimum: 0, maximum: 100, nullable: true },
      riskTier: { type: "string", nullable: true },
      priceHint: {
        type: "object",
        additionalProperties: false,
        nullable: true,
        required: ["amountCents", "currency"],
        properties: {
          amountCents: { type: "integer", minimum: 0 },
          currency: { type: "string", nullable: true }
        }
      },
      routingFactors: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const RouterPlanTaskV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "taskId", "title", "requiredCapability", "dependsOnTaskIds", "candidates"],
    properties: {
      schemaVersion: { type: "string", enum: ["RouterPlanTask.v1"] },
      taskId: { type: "string" },
      title: { type: "string" },
      requiredCapability: { type: "string" },
      dependsOnTaskIds: { type: "array", items: { type: "string" } },
      candidates: { type: "array", items: RouterPlanCandidateV1 }
    }
  };

  const RouterPlanIssueV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "severity", "code", "message", "details"],
    properties: {
      schemaVersion: { type: "string", enum: ["RouterPlanIssue.v1"] },
      severity: { type: "string", enum: ["blocking", "warning"] },
      code: { type: "string" },
      message: { type: "string" },
      details: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const RouterPlanV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "planId", "tenantId", "scope", "generatedAt", "request", "intent", "taskCount", "tasks", "issues", "planHash"],
    properties: {
      schemaVersion: { type: "string", enum: ["RouterPlan.v1"] },
      planId: { type: "string" },
      tenantId: { type: "string" },
      scope: { type: "string", enum: ["tenant", "public"] },
      generatedAt: { type: "string", format: "date-time" },
      request: RouterRequestV1,
      intent: RouterIntentV1,
      taskCount: { type: "integer", minimum: 0 },
      tasks: { type: "array", items: RouterPlanTaskV1 },
      issues: { type: "array", items: RouterPlanIssueV1 },
      planHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const RouterMarketplaceLaunchTaskV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "taskId",
      "title",
      "requiredCapability",
      "rfqId",
      "dependsOnTaskIds",
      "budgetCents",
      "currency",
      "deadlineAt",
      "candidateCount",
      "candidateAgentIds"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["RouterMarketplaceLaunchTask.v1"] },
      taskId: { type: "string" },
      title: { type: "string" },
      requiredCapability: { type: "string" },
      rfqId: { type: "string" },
      dependsOnTaskIds: { type: "array", items: { type: "string" } },
      budgetCents: { type: "integer", minimum: 1, nullable: true },
      currency: { type: "string", nullable: true },
      deadlineAt: { type: "string", format: "date-time", nullable: true },
      candidateCount: { type: "integer", minimum: 0 },
      candidateAgentIds: { type: "array", items: { type: "string" } },
      taskWallet: { ...TaskWalletV1, nullable: true }
    }
  };

  const RouterMarketplaceLaunchV1 = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "launchId", "tenantId", "posterAgentId", "scope", "request", "planRef", "taskCount", "tasks", "metadata", "createdAt", "launchHash"],
    properties: {
      schemaVersion: { type: "string", enum: ["RouterMarketplaceLaunch.v1"] },
      launchId: { type: "string" },
      tenantId: { type: "string" },
      posterAgentId: { type: "string" },
      scope: { type: "string", enum: ["tenant", "public"] },
      request: RouterRequestV1,
      planRef: {
        type: "object",
        additionalProperties: false,
        required: ["planId", "planHash"],
        properties: {
          planId: { type: "string" },
          planHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
        }
      },
      taskCount: { type: "integer", minimum: 0 },
      tasks: { type: "array", items: RouterMarketplaceLaunchTaskV1 },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      createdAt: { type: "string", format: "date-time" },
      launchHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const RouterLaunchTaskOverrideRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      rfqId: { type: "string", nullable: true },
      title: { type: "string", nullable: true },
      description: { type: "string", nullable: true },
      budgetCents: { type: "integer", minimum: 1, nullable: true },
      currency: { type: "string", nullable: true },
      deadlineAt: { type: "string", format: "date-time", nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      approvalMode: { type: "string", enum: ["detect", "require"], nullable: true },
      approvalPolicy: { ...X402HumanApprovalPolicyV1, nullable: true },
      authorityEnvelope: { ...AuthorityEnvelopeV1, nullable: true },
      approvalRequest: { ...ApprovalRequestV1, nullable: true },
      approvalDecision: { ...ApprovalDecisionV1, nullable: true },
      humanApprovalDecision: { ...X402HumanApprovalDecisionV1, nullable: true }
    }
  };

  const RouterLaunchRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      launchId: { type: "string", nullable: true },
      text: { type: "string", nullable: true },
      request: { type: "string", nullable: true },
      scope: { type: "string", enum: ["tenant", "public"], nullable: true },
      posterAgentId: { type: "string" },
      description: { type: "string", nullable: true },
      budgetCents: { type: "integer", minimum: 1, nullable: true },
      currency: { type: "string", nullable: true },
      deadlineAt: { type: "string", format: "date-time", nullable: true },
      approvalMode: { type: "string", enum: ["detect", "require"], nullable: true },
      approvalPolicy: { ...X402HumanApprovalPolicyV1, nullable: true },
      approvalContinuation: { ...ApprovalContinuationOptions, nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      taskOverrides: {
        type: "object",
        additionalProperties: RouterLaunchTaskOverrideRequest,
        nullable: true
      }
    }
  };

  const RouterLaunchStatusTaskV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "taskId",
      "taskIndex",
      "rfqId",
      "title",
      "requiredCapability",
      "dependsOnTaskIds",
      "candidateAgentIds",
      "candidateCount",
      "state",
      "blockedByTaskIds",
      "bidCount",
      "bids"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["RouterLaunchStatusTask.v1"] },
      taskId: { type: "string" },
      taskIndex: { type: "integer", minimum: 1 },
      rfqId: { type: "string" },
      title: { type: "string" },
      requiredCapability: { type: "string" },
      dependsOnTaskIds: { type: "array", items: { type: "string" } },
      candidateAgentIds: { type: "array", items: { type: "string" } },
      candidateCount: { type: "integer", minimum: 0 },
      state: {
        type: "string",
        enum: [
          "open_no_bids",
          "open_ready",
          "blocked_dependencies_pending",
          "blocked_dependency_cancelled",
          "blocked_dependency_missing",
          "assigned",
          "closed",
          "cancelled"
        ]
      },
      blockedByTaskIds: { type: "array", items: { type: "string" } },
      rfqStatus: { type: "string", nullable: true },
      bidCount: { type: "integer", minimum: 0 },
      acceptedBidId: { type: "string", nullable: true },
      runId: { type: "string", nullable: true },
      settlementStatus: { type: "string", nullable: true },
      disputeStatus: { type: "string", nullable: true },
      rfq: { type: "object", nullable: true },
      bids: { type: "array", items: { type: "object" } },
      acceptedBid: { type: "object", nullable: true },
      run: { type: "object", nullable: true },
      settlement: { type: "object", nullable: true }
    }
  };

  const RouterLaunchStatusV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "launchRef",
      "tenantId",
      "posterAgentId",
      "taskCount",
      "summary",
      "tasks",
      "generatedAt",
      "statusHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["RouterLaunchStatus.v1"] },
      launchRef: {
        type: "object",
        additionalProperties: false,
        required: ["launchId"],
        properties: {
          launchId: { type: "string" },
          launchHash: { type: "string", nullable: true },
          planId: { type: "string", nullable: true },
          planHash: { type: "string", nullable: true },
          requestTextSha256: { type: "string", nullable: true }
        }
      },
      tenantId: { type: "string" },
      posterAgentId: { type: "string" },
      taskCount: { type: "integer", minimum: 0 },
      summary: {
        type: "object",
        additionalProperties: false,
        required: [
          "openCount",
          "readyCount",
          "blockedCount",
          "assignedCount",
          "closedCount",
          "cancelledCount",
          "settlementLockedCount",
          "settlementReleasedCount",
          "disputeOpenCount"
        ],
        properties: {
          openCount: { type: "integer", minimum: 0 },
          readyCount: { type: "integer", minimum: 0 },
          blockedCount: { type: "integer", minimum: 0 },
          assignedCount: { type: "integer", minimum: 0 },
          closedCount: { type: "integer", minimum: 0 },
          cancelledCount: { type: "integer", minimum: 0 },
          settlementLockedCount: { type: "integer", minimum: 0 },
          settlementReleasedCount: { type: "integer", minimum: 0 },
          disputeOpenCount: { type: "integer", minimum: 0 }
        }
      },
      tasks: { type: "array", items: RouterLaunchStatusTaskV1 },
      generatedAt: { type: "string", format: "date-time" },
      statusHash: { type: "string", pattern: "^[0-9a-f]{64}$" }
    }
  };

  const RouterMarketplaceDispatchResult = {
    type: "object",
    additionalProperties: false,
    required: ["taskId", "taskIndex", "rfqId", "state", "dependsOnTaskIds", "blockingTaskIds"],
    properties: {
      taskId: { type: "string" },
      taskIndex: { type: "integer", minimum: 1, nullable: true },
      rfqId: { type: "string", nullable: true },
      state: RouterMarketplaceDispatchTaskV1.properties.state,
      reasonCode: { type: "string", nullable: true },
      dependsOnTaskIds: { type: "array", items: { type: "string" } },
      blockingTaskIds: { type: "array", items: { type: "string" } },
      rfqStatus: { type: "string", nullable: true },
      acceptedBidId: { type: "string", nullable: true },
      runId: { type: "string", nullable: true },
      decisionHash: { type: "string", nullable: true },
      decision: { ...MarketplaceAutoAwardDecisionV1, nullable: true },
      rfq: { ...MarketplaceRfqV1, nullable: true },
      acceptedBid: { allOf: [MarketplaceRfqBidV1], nullable: true },
      run: { ...AgentRunV1, nullable: true },
      settlement: { ...AgentRunSettlementV1, nullable: true },
      agreement: { ...MarketplaceTaskAgreementV2, nullable: true },
      offer: { allOf: [MarketplaceOfferV2], nullable: true },
      offerAcceptance: { allOf: [MarketplaceAcceptanceV2], nullable: true },
      decisionRecord: { ...SettlementDecisionRecordAny, nullable: true },
      settlementReceipt: { ...SettlementReceiptV1, nullable: true },
      error: {
        type: "object",
        additionalProperties: false,
        nullable: true,
        properties: {
          message: { type: "string" },
          code: { type: "string", nullable: true },
          details: { type: "object", nullable: true }
        }
      }
    }
  };

  const TenantSettlementPolicyUpsertRequest = {
    type: "object",
    additionalProperties: false,
    required: ["policyId", "policy"],
    properties: {
      policyId: { type: "string" },
      policyVersion: { type: "integer", minimum: 1 },
      verificationMethod: {
        type: "object",
        additionalProperties: false,
        properties: {
          verificationMethodHash: { type: "string" },
          mode: { type: "string", enum: ["deterministic", "attested", "discretionary"] },
          source: { type: "string" },
          attestor: { type: "string" },
          notes: { type: "string" }
        }
      },
      policy: {
        type: "object",
        additionalProperties: false,
        properties: {
          policyHash: { type: "string" },
          policyVersion: { type: "integer", minimum: 1 },
          mode: { type: "string", enum: ["automatic", "manual-review"] },
          rules: {
            type: "object",
            additionalProperties: false,
            properties: {
              requireDeterministicVerification: { type: "boolean" },
              autoReleaseOnGreen: { type: "boolean" },
              autoReleaseOnAmber: { type: "boolean" },
              autoReleaseOnRed: { type: "boolean" },
              greenReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
              amberReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
              redReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
              maxAutoReleaseAmountCents: { type: "integer", minimum: 1 },
              manualReason: { type: "string" }
            }
          }
        }
      },
      description: { type: "string" },
      metadata: { type: "object", additionalProperties: true }
    }
  };

  const AgentWalletCreditRequest = {
    type: "object",
    additionalProperties: false,
    required: ["amountCents"],
    properties: {
      amountCents: { type: "integer", minimum: 1 },
      currency: { type: "string" }
    }
  };

  const RunSettlementResolveRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["released", "refunded"] },
      releaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
      releasedAmountCents: { type: "integer", minimum: 0 },
      refundedAmountCents: { type: "integer", minimum: 0 },
      reason: { type: "string" },
      resolvedByAgentId: { type: "string" },
      resolutionEventId: { type: "string" }
    }
  };

  const RunAgreementChangeOrderRequest = {
    type: "object",
    additionalProperties: false,
    required: ["requestedByAgentId", "reason"],
    properties: {
      changeOrderId: { type: "string" },
      requestedByAgentId: { type: "string" },
      acceptedByAgentId: { type: "string" },
      acceptanceSignature: MarketplaceAgreementAcceptanceSignatureInput,
      reason: { type: "string" },
      note: { type: "string" },
      milestones: MarketplaceAgreementTermsInput.properties.milestones,
      cancellation: MarketplaceAgreementTermsInput.properties.cancellation
    }
  };

  const RunAgreementCancelRequest = {
    type: "object",
    additionalProperties: false,
    required: ["cancelledByAgentId", "reason"],
    properties: {
      cancellationId: { type: "string" },
      cancelledByAgentId: { type: "string" },
      acceptedByAgentId: { type: "string" },
      acceptanceSignature: MarketplaceAgreementAcceptanceSignatureInput,
      reason: { type: "string" },
      evidenceRef: { type: "string" }
    }
  };

  const RunAgreementCancelResponse = {
    type: "object",
    additionalProperties: false,
    properties: {
      runId: { type: "string" },
      rfq: MarketplaceRfqV1,
      run: AgentRunV1,
      settlement: AgentRunSettlementV1,
      agreement: { allOf: [MarketplaceTaskAgreementV2], nullable: true },
      cancellation: { type: "object", additionalProperties: true },
      acceptanceSignatureVerification: { type: "object", additionalProperties: true }
    }
  };

  const DisputeVerdictSignedRequest = {
    type: "object",
    additionalProperties: false,
    required: ["verdictId", "arbiterAgentId", "outcome", "signerKeyId", "signature"],
    properties: {
      verdictId: { type: "string" },
      arbiterAgentId: { type: "string" },
      outcome: { type: "string", enum: ["accepted", "rejected", "partial"] },
      releaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
      rationale: { type: "string" },
      issuedAt: { type: "string", format: "date-time" },
      signerKeyId: { type: "string" },
      signature: { type: "string" }
    }
  };

  const ArbitrationVerdictSignedRequest = {
    type: "object",
    additionalProperties: false,
    required: ["caseId", "verdictId", "arbiterAgentId", "outcome", "releaseRatePct", "rationale", "evidenceRefs", "signerKeyId", "signature"],
    properties: {
      caseId: { type: "string" },
      verdictId: { type: "string" },
      arbiterAgentId: { type: "string" },
      outcome: { type: "string", enum: ["accepted", "rejected", "partial"] },
      releaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
      rationale: { type: "string" },
      evidenceRefs: { type: "array", items: { type: "string" } },
      issuedAt: { type: "string", format: "date-time" },
      appealRef: {
        type: "object",
        additionalProperties: false,
        nullable: true,
        properties: {
          appealCaseId: { type: "string" },
          parentVerdictId: { type: "string" },
          reason: { type: "string", nullable: true }
        }
      },
      signerKeyId: { type: "string" },
      signature: { type: "string" }
    }
  };

  const DisputeOpenEnvelopeSignedRequest = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "artifactType",
      "artifactId",
      "envelopeId",
      "caseId",
      "tenantId",
      "agreementHash",
      "receiptHash",
      "holdHash",
      "openedByAgentId",
      "openedAt",
      "reasonCode",
      "nonce",
      "signerKeyId",
      "envelopeHash",
      "signature"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["DisputeOpenEnvelope.v1"] },
      artifactType: { type: "string", enum: ["DisputeOpenEnvelope.v1"] },
      artifactId: { type: "string" },
      envelopeId: { type: "string" },
      caseId: { type: "string" },
      tenantId: { type: "string" },
      agreementHash: { type: "string" },
      receiptHash: { type: "string" },
      holdHash: { type: "string" },
      openedByAgentId: { type: "string" },
      openedAt: { type: "string", format: "date-time" },
      reasonCode: { type: "string" },
      nonce: { type: "string" },
      signerKeyId: { type: "string" },
      envelopeHash: { type: "string" },
      signature: { type: "string" }
    }
  };

  const ArbitrationCaseV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "caseId",
      "tenantId",
      "runId",
      "settlementId",
      "disputeId",
      "claimantAgentId",
      "respondentAgentId",
      "status",
      "openedAt",
      "evidenceRefs",
      "revision",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["ArbitrationCase.v1"] },
      caseId: { type: "string" },
      tenantId: { type: "string" },
      runId: { type: "string" },
      settlementId: { type: "string" },
      disputeId: { type: "string" },
      claimantAgentId: { type: "string" },
      respondentAgentId: { type: "string" },
      arbiterAgentId: { type: "string", nullable: true },
      status: { type: "string", enum: ["open", "under_review", "verdict_issued", "closed"] },
      openedAt: { type: "string", format: "date-time" },
      closedAt: { type: "string", format: "date-time", nullable: true },
      summary: { type: "string", nullable: true },
      evidenceRefs: { type: "array", items: { type: "string" } },
      verdictId: { type: "string", nullable: true },
      verdictHash: { type: "string", nullable: true },
      appealRef: {
        type: "object",
        additionalProperties: false,
        nullable: true,
        properties: {
          parentCaseId: { type: "string" },
          parentVerdictId: { type: "string" },
          reason: { type: "string", nullable: true }
        }
      },
      metadata: { type: "object", additionalProperties: true, nullable: true },
      revision: { type: "integer", minimum: 0 },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const FundingHoldV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "tenantId",
      "agreementHash",
      "receiptHash",
      "payerAgentId",
      "payeeAgentId",
      "amountCents",
      "heldAmountCents",
      "currency",
      "holdbackBps",
      "challengeWindowMs",
      "createdAt",
      "holdHash",
      "status",
      "revision",
      "updatedAt"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["FundingHold.v1"] },
      tenantId: { type: "string" },
      agreementHash: { type: "string" },
      receiptHash: { type: "string" },
      payerAgentId: { type: "string" },
      payeeAgentId: { type: "string" },
      amountCents: { type: "integer", minimum: 1 },
      heldAmountCents: { type: "integer", minimum: 0 },
      currency: { type: "string" },
      holdbackBps: { type: "integer", minimum: 0, maximum: 10000 },
      challengeWindowMs: { type: "integer", minimum: 0 },
      createdAt: { type: "string", format: "date-time" },
      holdHash: { type: "string" },
      status: { type: "string", enum: ["held", "released", "refunded"] },
      resolvedAt: { type: "string", format: "date-time", nullable: true },
      revision: { type: "integer", minimum: 0 },
      updatedAt: { type: "string", format: "date-time" },
      metadata: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const SettlementAdjustmentV1 = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "adjustmentId",
      "tenantId",
      "agreementHash",
      "receiptHash",
      "holdHash",
      "kind",
      "amountCents",
      "currency",
      "createdAt",
      "adjustmentHash"
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["SettlementAdjustment.v1"] },
      adjustmentId: { type: "string" },
      tenantId: { type: "string" },
      agreementHash: { type: "string" },
      receiptHash: { type: "string" },
      holdHash: { type: "string" },
      kind: { type: "string", enum: ["holdback_release", "holdback_refund"] },
      amountCents: { type: "integer", minimum: 0 },
      currency: { type: "string" },
      verdictRef: {
        type: "object",
        additionalProperties: false,
        nullable: true,
        properties: {
          caseId: { type: "string" },
          verdictHash: { type: "string" }
        }
      },
      createdAt: { type: "string", format: "date-time" },
      adjustmentHash: { type: "string" },
      metadata: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const RunSettlementPolicyReplayResponse = {
    type: "object",
    additionalProperties: false,
    required: ["runId", "runStatus", "verificationStatus", "replay", "settlement", "matchesStoredDecision"],
    properties: {
      runId: { type: "string" },
      agreementId: { type: "string", nullable: true },
      policyVersion: { type: "integer", nullable: true },
      policyHash: { type: "string", nullable: true },
      verificationMethodHash: { type: "string", nullable: true },
      policyRef: { allOf: [MarketplaceSettlementPolicyRefV1], nullable: true },
      policyBinding: { allOf: [MarketplaceAgreementPolicyBindingV2], nullable: true },
      policyBindingVerification: { type: "object", additionalProperties: true },
      acceptanceSignatureVerification: { type: "object", additionalProperties: true },
      runStatus: { type: "string", nullable: true },
      verificationStatus: { type: "string", enum: ["green", "amber", "red"] },
      replay: { type: "object", additionalProperties: true },
      settlement: AgentRunSettlementV1,
      kernelVerification: SettlementKernelVerification,
      matchesStoredDecision: { type: "boolean" }
    }
  };

  const RunSettlementReplayEvaluateResponse = {
    type: "object",
    additionalProperties: false,
    required: ["runId", "runStatus", "verificationStatus", "replay", "stored", "kernelVerification", "comparisons"],
    properties: {
      runId: { type: "string" },
      agreementId: { type: "string", nullable: true },
      policyVersion: { type: "integer", nullable: true },
      policyHash: { type: "string", nullable: true },
      verificationMethodHash: { type: "string", nullable: true },
      policyRef: { allOf: [MarketplaceSettlementPolicyRefV1], nullable: true },
      runStatus: { type: "string", nullable: true },
      verificationStatus: { type: "string", enum: ["green", "amber", "red"] },
      replay: { type: "object", additionalProperties: true },
      stored: { type: "object", additionalProperties: true },
      kernelVerification: SettlementKernelVerification,
      comparisons: { type: "object", additionalProperties: true }
    }
  };

  const RunSettlementExplainabilityResponse = {
    type: "object",
    additionalProperties: false,
    required: ["runId", "explainability", "replay"],
    properties: {
      runId: { type: "string" },
      explainability: { type: "object", additionalProperties: true },
      replay: { type: "object", additionalProperties: true }
    }
  };

  const ToolCallReplayEvaluateResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "agreementHash", "runId", "replay", "stored", "comparisons", "issues"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      agreementHash: { type: "string" },
      runId: { type: "string" },
      replay: { type: "object", additionalProperties: true },
      stored: { type: "object", additionalProperties: true },
      comparisons: { type: "object", additionalProperties: true },
      issues: { type: "array", items: { type: "string" } }
    }
  };

  const ReputationFactsResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "agentId", "window", "asOf", "facts"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      agentId: { type: "string" },
      toolId: { type: "string", nullable: true },
      window: { type: "string", enum: ["7d", "30d", "allTime"] },
      asOf: { type: "string", format: "date-time" },
      windowStartAt: { type: "string", format: "date-time", nullable: true },
      facts: {
        type: "object",
        additionalProperties: false,
        properties: {
          totals: { type: "object", additionalProperties: true },
          latencyMs: {
            type: "object",
            additionalProperties: false,
            properties: {
              count: { type: "integer", minimum: 0 },
              p50: { type: "integer", minimum: 0, nullable: true },
              p95: { type: "integer", minimum: 0, nullable: true }
            }
          }
        }
      },
      events: {
        type: "array",
        nullable: true,
        items: { type: "object", additionalProperties: true }
      }
    }
  };

  const MonthCloseRequest = {
    type: "object",
    additionalProperties: false,
    required: ["month"],
    properties: {
      month: { type: "string", example: "2026-02" },
      basis: { type: "string", example: "settledAt" }
    }
  };

  const AckRequest = {
    type: "object",
    additionalProperties: false,
    required: ["deliveryId"],
    properties: {
      deliveryId: { type: ["string", "integer"] },
      artifactHash: { type: "string" },
      receivedAt: { type: "string", format: "date-time" }
    }
  };

  const ArtifactVerificationSummary = {
    type: "object",
    additionalProperties: true,
    properties: {
      verificationStatus: { type: "string", enum: ["green", "amber", "red"] },
      proofStatus: { type: "string", nullable: true },
      reasonCodes: { type: "array", items: { type: "string" } },
      missingEvidence: { type: "array", items: { type: "string" } },
      evidenceCount: { type: "integer" },
      activeEvidenceCount: { type: "integer" },
      slaCompliancePct: { type: "integer", nullable: true }
    }
  };

  const OpsJobListItem = {
    type: "object",
    additionalProperties: true,
    properties: {
      verificationStatus: { type: "string", enum: ["green", "amber", "red"] },
      evidenceCount: { type: "integer" },
      activeEvidenceCount: { type: "integer" },
      slaCompliancePct: { type: "integer", nullable: true },
      verification: ArtifactVerificationSummary
    }
  };

  const OpsJobsListResponse = {
    type: "object",
    additionalProperties: false,
    required: ["jobs", "total", "offset", "limit"],
    properties: {
      jobs: { type: "array", items: OpsJobListItem },
      total: { type: "integer" },
      offset: { type: "integer" },
      limit: { type: "integer" }
    }
  };

  const CommandCenterReasonCount = {
    type: "object",
    additionalProperties: false,
    required: ["reason", "count"],
    properties: {
      reason: { type: "string" },
      count: { type: "integer", minimum: 0 }
    }
  };

  const CommandCenterDestinationCount = {
    type: "object",
    additionalProperties: false,
    required: ["destinationId", "count"],
    properties: {
      destinationId: { type: "string" },
      count: { type: "integer", minimum: 0 }
    }
  };

  const CommandCenterKernelCodeCount = {
    type: "object",
    additionalProperties: false,
    required: ["code", "count"],
    properties: {
      code: { type: "string" },
      count: { type: "integer", minimum: 0 }
    }
  };

  const OpsNetworkCommandCenterSummary = {
    type: "object",
    additionalProperties: false,
    required: ["generatedAt", "freshness", "reliability", "determinism", "settlement", "disputes", "revenue", "trust"],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      freshness: {
        type: "object",
        additionalProperties: false,
        required: ["maxAgeSeconds", "generatedWithinSla"],
        properties: {
          maxAgeSeconds: { type: "integer", minimum: 0 },
          generatedWithinSla: { type: "boolean" }
        }
      },
      reliability: {
        type: "object",
        additionalProperties: false,
        required: ["httpRequestsTotal", "http4xxTotal", "http5xxTotal", "httpClientErrorRatePct", "httpServerErrorRatePct", "backlog"],
        properties: {
          httpRequestsTotal: { type: "integer", minimum: 0 },
          http4xxTotal: { type: "integer", minimum: 0 },
          http5xxTotal: { type: "integer", minimum: 0 },
          httpClientErrorRatePct: { type: "number", minimum: 0 },
          httpServerErrorRatePct: { type: "number", minimum: 0 },
          backlog: {
            type: "object",
            additionalProperties: false,
            required: ["deliveriesPending", "deliveriesFailed", "ingestRejected", "deliveryDlqTopDestinations"],
            properties: {
              outboxByKind: {
                type: "object",
                nullable: true,
                additionalProperties: { type: "integer", minimum: 0 }
              },
              deliveriesPending: { type: "integer", minimum: 0 },
              deliveriesFailed: { type: "integer", minimum: 0 },
              ingestRejected: { type: "integer", minimum: 0 },
              deliveryDlqTopDestinations: { type: "array", items: CommandCenterDestinationCount }
            }
          }
        }
      },
      determinism: {
        type: "object",
        additionalProperties: false,
        required: ["appendRejectedTopReasons", "ingestRejectedTopReasons", "determinismSensitiveRejects"],
        properties: {
          appendRejectedTopReasons: { type: "array", items: CommandCenterReasonCount },
          ingestRejectedTopReasons: { type: "array", items: CommandCenterReasonCount },
          determinismSensitiveRejects: { type: "integer", minimum: 0 }
        }
      },
      settlement: {
        type: "object",
        additionalProperties: false,
        required: [
          "windowHours",
          "resolvedCount",
          "lockedCount",
          "settlementAmountCents",
          "releasedAmountCents",
          "refundedAmountCents",
          "kernelVerificationErrorCount",
          "kernelVerificationErrorCountsByCode"
        ],
        properties: {
          windowHours: { type: "integer", minimum: 1 },
          resolvedCount: { type: "integer", minimum: 0 },
          lockedCount: { type: "integer", minimum: 0 },
          settlementAmountCents: { type: "integer", minimum: 0 },
          releasedAmountCents: { type: "integer", minimum: 0 },
          refundedAmountCents: { type: "integer", minimum: 0 },
          kernelVerificationErrorCount: { type: "integer", minimum: 0 },
          kernelVerificationErrorCountsByCode: { type: "array", items: CommandCenterKernelCodeCount }
        }
      },
      disputes: {
        type: "object",
        additionalProperties: false,
        required: ["openCount", "openedCountInWindow", "closedCountInWindow", "oldestOpenAgeSeconds", "overSlaCount", "expiredWindowOpenCount"],
        properties: {
          openCount: { type: "integer", minimum: 0 },
          openedCountInWindow: { type: "integer", minimum: 0 },
          closedCountInWindow: { type: "integer", minimum: 0 },
          oldestOpenAgeSeconds: { type: "integer", minimum: 0 },
          overSlaCount: { type: "integer", minimum: 0 },
          expiredWindowOpenCount: { type: "integer", minimum: 0 }
        }
      },
      revenue: {
        type: "object",
        additionalProperties: false,
        required: ["transactionFeeBps", "estimatedTransactionFeesCentsInWindow"],
        properties: {
          transactionFeeBps: { type: "integer", minimum: 0, maximum: 5000 },
          estimatedTransactionFeesCentsInWindow: { type: "integer", minimum: 0 },
          currentPlatformRevenueCents: { type: "integer", nullable: true }
        }
      },
      trust: {
        type: "object",
        additionalProperties: false,
        required: ["totalAgents", "activeAgents", "sampledAgents", "averageTrustScore"],
        properties: {
          totalAgents: { type: "integer", minimum: 0 },
          activeAgents: { type: "integer", minimum: 0 },
          sampledAgents: { type: "integer", minimum: 0 },
          averageTrustScore: { type: "number", minimum: 0, maximum: 100, nullable: true }
        }
      }
    }
  };

  const OpsNetworkCommandCenterResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "commandCenter"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      commandCenter: OpsNetworkCommandCenterSummary,
      alerts: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          evaluatedCount: { type: "integer", minimum: 0 },
          breachCount: { type: "integer", minimum: 0 },
          emittedCount: { type: "integer", minimum: 0 },
          emitted: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                alertType: { type: "string" },
                severity: { type: "string" },
                artifactId: { type: "string" },
                artifactHash: { type: "string" },
                deliveriesCreated: { type: "integer", minimum: 0 }
              }
            }
          }
        }
      }
    }
  };

  const CommandCenterWorkspaceAlert = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "alertType", "severity", "metric", "comparator", "currentValue", "threshold", "message"],
    properties: {
      schemaVersion: { type: "string", enum: ["CommandCenterAlert.v1"] },
      alertType: { type: "string" },
      severity: { type: "string" },
      metric: { type: "string" },
      comparator: { type: "string" },
      currentValue: { type: "number" },
      threshold: { type: "number" },
      message: { type: "string" },
      dimensions: { type: "object", nullable: true, additionalProperties: true }
    }
  };

  const OpsNetworkCommandCenterWorkspace = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "generatedAt", "parameters", "reliability", "safety", "trust", "revenue", "actionability", "links"],
    properties: {
      schemaVersion: { type: "string", enum: ["OpsNetworkCommandCenterWorkspace.v1"] },
      generatedAt: { type: "string", format: "date-time" },
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["transactionFeeBps", "windowHours", "disputeSlaHours"],
        properties: {
          transactionFeeBps: { type: "integer", minimum: 0, maximum: 5000 },
          windowHours: { type: "integer", minimum: 1, maximum: 8760 },
          disputeSlaHours: { type: "integer", minimum: 1, maximum: 8760 }
        }
      },
      reliability: OpsNetworkCommandCenterSummary.properties.reliability,
      safety: {
        type: "object",
        additionalProperties: false,
        required: ["determinism", "settlement", "disputes", "alerts"],
        properties: {
          determinism: OpsNetworkCommandCenterSummary.properties.determinism,
          settlement: OpsNetworkCommandCenterSummary.properties.settlement,
          disputes: OpsNetworkCommandCenterSummary.properties.disputes,
          alerts: {
            type: "object",
            additionalProperties: false,
            required: ["thresholds", "evaluatedCount", "breachCount", "breaches"],
            properties: {
              thresholds: {
                type: "object",
                additionalProperties: false,
                required: [
                  "httpClientErrorRateThresholdPct",
                  "httpServerErrorRateThresholdPct",
                  "deliveryDlqThreshold",
                  "disputeOverSlaThreshold",
                  "determinismRejectThreshold",
                  "kernelVerificationErrorThreshold"
                ],
                properties: {
                  httpClientErrorRateThresholdPct: { type: "number", minimum: 0 },
                  httpServerErrorRateThresholdPct: { type: "number", minimum: 0 },
                  deliveryDlqThreshold: { type: "integer", minimum: 0 },
                  disputeOverSlaThreshold: { type: "integer", minimum: 0 },
                  determinismRejectThreshold: { type: "integer", minimum: 0 },
                  kernelVerificationErrorThreshold: { type: "integer", minimum: 0 }
                }
              },
              evaluatedCount: { type: "integer", minimum: 0 },
              breachCount: { type: "integer", minimum: 0 },
              breaches: { type: "array", items: CommandCenterWorkspaceAlert }
            }
          }
        }
      },
      trust: OpsNetworkCommandCenterSummary.properties.trust,
      revenue: OpsNetworkCommandCenterSummary.properties.revenue,
      actionability: {
        type: "object",
        additionalProperties: false,
        required: ["canPersistAlerts"],
        properties: {
          canPersistAlerts: { type: "boolean" }
        }
      },
      links: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "status"],
        properties: {
          summary: { type: "string" },
          status: { type: "string" }
        }
      }
    }
  };

  const OpsNetworkCommandCenterWorkspaceResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "workspace"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      workspace: OpsNetworkCommandCenterWorkspace
    }
  };

  const OpsFinanceReconcileResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "period", "reportHash", "reconcile", "inputs"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      period: { type: "string", example: "2026-01" },
      reportHash: { type: "string" },
      reconcile: { type: "object", additionalProperties: true },
      inputs: {
        type: "object",
        additionalProperties: false,
        required: ["glBatchArtifactId", "glBatchArtifactHash", "partyStatementArtifactIds", "partyStatementArtifactHashes"],
        properties: {
          glBatchArtifactId: { type: "string" },
          glBatchArtifactHash: { type: "string" },
          partyStatementArtifactIds: { type: "array", items: { type: "string" } },
          partyStatementArtifactHashes: { type: "array", items: { type: "string" } }
        }
      },
      artifact: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          artifactId: { type: "string" },
          artifactHash: { type: "string" },
          deliveriesCreated: { type: "integer", minimum: 0 }
        }
      }
    }
  };

  const OpsRescueQueueItem = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "rescueId", "sourceType", "rescueState", "priority", "title", "openedAt", "updatedAt", "refs", "links"],
    properties: {
      schemaVersion: { type: "string", enum: ["OpsRescueQueueItem.v1"] },
      rescueId: { type: "string" },
      sourceType: { type: "string", enum: ["approval_continuation", "router_launch", "run"] },
      rescueState: { type: "string" },
      priority: { type: "string", enum: ["normal", "high", "critical"] },
      title: { type: "string" },
      summary: { type: "string", nullable: true },
      status: { type: "string", nullable: true },
      openedAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      phase1: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          categoryId: { type: "string", nullable: true },
          categoryLabel: { type: "string", nullable: true },
          verificationStatus: { type: "string", nullable: true },
          completionStateStatus: { type: "string", nullable: true },
          proofSummary: { type: "string", nullable: true }
        }
      },
      triage: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        required: ["schemaVersion", "status"],
        properties: {
          schemaVersion: { type: "string", enum: ["OpsRescueTriage.v1"] },
          rescueId: { type: "string", nullable: true },
          status: { type: "string", enum: ["open", "acknowledged", "in_progress", "resolved", "dismissed"] },
          ownerPrincipalId: { type: "string", nullable: true },
          notes: { type: "string", nullable: true },
          revision: { type: "integer", nullable: true, minimum: 1 },
          updatedAt: { type: "string", format: "date-time", nullable: true },
          resolvedAt: { type: "string", format: "date-time", nullable: true },
          resolvedByPrincipalId: { type: "string", nullable: true }
        }
      },
      refs: {
        type: "object",
        additionalProperties: false,
        required: ["requestId", "launchId", "taskId", "rfqId", "runId", "disputeId", "receiptId"],
        properties: {
          requestId: { type: "string", nullable: true },
          launchId: { type: "string", nullable: true },
          taskId: { type: "string", nullable: true },
          rfqId: { type: "string", nullable: true },
          runId: { type: "string", nullable: true },
          disputeId: { type: "string", nullable: true },
          receiptId: { type: "string", nullable: true }
        }
      },
      links: {
        type: "object",
        additionalProperties: false,
        required: ["approvals", "launch", "run", "dispute"],
        properties: {
          approvals: { type: "string", nullable: true },
          launch: { type: "string", nullable: true },
          run: { type: "string", nullable: true },
          dispute: { type: "string", nullable: true }
        }
      },
      details: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const OpsRescueQueue = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "generatedAt", "filters", "total", "count", "counts", "queue"],
    properties: {
      schemaVersion: { type: "string", enum: ["OpsRescueQueue.v1"] },
      generatedAt: { type: "string", format: "date-time" },
      filters: {
        type: "object",
        additionalProperties: false,
        required: ["sourceType", "priority", "staleRunMinutes", "limit", "offset"],
        properties: {
          sourceType: { type: "string", enum: ["all", "approval_continuation", "router_launch", "run"] },
          priority: { type: "string", enum: ["all", "normal", "high", "critical"] },
          staleRunMinutes: { type: "integer", minimum: 1, maximum: 10080 },
          limit: { type: "integer", minimum: 1, maximum: 500 },
          offset: { type: "integer", minimum: 0 }
        }
      },
      total: { type: "integer", minimum: 0 },
      count: { type: "integer", minimum: 0 },
      counts: {
        type: "object",
        additionalProperties: false,
        required: ["bySourceType", "byPriority", "byState"],
        properties: {
          bySourceType: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
          byPriority: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
          byState: { type: "object", additionalProperties: { type: "integer", minimum: 0 } }
        }
      },
      queue: { type: "array", items: OpsRescueQueueItem }
    }
  };

  const OpsRescueQueueResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "rescueQueue"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      rescueQueue: OpsRescueQueue
    }
  };

  const OpsPhase1MetricsResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "metrics"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      metrics: { type: "object", additionalProperties: true }
    }
  };

  const OpsManagedSpecialistsResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "managedSpecialists"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      managedSpecialists: { type: "object", additionalProperties: true }
    }
  };

  const OpsRescueTriageRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["open", "acknowledged", "in_progress", "resolved", "dismissed"] },
      ownerPrincipalId: { type: "string" },
      notes: { type: "string" },
      note: { type: "string" }
    }
  };

  const OpsRescueTriageResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "changed", "rescueItem", "triage"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      changed: { type: "boolean" },
      rescueItem: { anyOf: [OpsRescueQueueItem, { type: "null" }] },
      triage: { anyOf: [OpsRescueQueueItem.properties.triage, { type: "null" }] }
    }
  };

  const OpsRescueActionRequest = {
    type: "object",
    additionalProperties: false,
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["resume", "dispatch"] },
      ownerPrincipalId: { type: "string" },
      notes: { type: "string" },
      note: { type: "string" },
      acceptedByAgentId: { type: "string" },
      payerAgentId: { type: "string" },
      allowOverBudget: { type: "boolean" }
    }
  };

  const OpsRescueActionResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "rescueItem", "triage", "actionResult"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      rescueItem: { anyOf: [OpsRescueQueueItem, { type: "null" }] },
      triage: { anyOf: [OpsRescueQueueItem.properties.triage, { type: "null" }] },
      actionResult: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const OpsArbitrationQueueItem = {
    type: "object",
    additionalProperties: false,
    properties: {
      caseId: { type: "string", nullable: true },
      runId: { type: "string", nullable: true },
      disputeId: { type: "string", nullable: true },
      settlementId: { type: "string", nullable: true },
      priority: { type: "string", enum: ["low", "normal", "high", "critical"], nullable: true },
      status: { type: "string", enum: ["open", "under_review", "verdict_issued", "closed"], nullable: true },
      arbiterAgentId: { type: "string", nullable: true },
      openedAt: { type: "string", format: "date-time", nullable: true },
      closedAt: { type: "string", format: "date-time", nullable: true },
      ageSeconds: { type: "integer", minimum: 0, nullable: true },
      ageHours: { type: "number", minimum: 0, nullable: true },
      slaHours: { type: "number", minimum: 1, maximum: 8760 },
      dueAt: { type: "string", format: "date-time", nullable: true },
      overSla: { type: "boolean" },
      summary: { type: "string", nullable: true },
      evidenceCount: { type: "integer", minimum: 0 },
      appealRef: { type: "object", additionalProperties: true, nullable: true },
      revision: { type: "integer", minimum: 0, nullable: true },
      updatedAt: { type: "string", format: "date-time", nullable: true }
    }
  };

  const OpsArbitrationQueueResponse = {
    type: "object",
    additionalProperties: false,
    required: ["tenantId", "filters", "count", "limit", "offset", "overSlaCount", "statusCounts", "queue"],
    properties: {
      tenantId: { type: "string" },
      filters: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", nullable: true },
          openedSince: { type: "string", format: "date-time", nullable: true },
          runId: { type: "string", nullable: true },
          caseId: { type: "string", nullable: true },
          priority: { type: "string", enum: ["low", "normal", "high", "critical"], nullable: true },
          assignedArbiter: { type: "boolean", nullable: true },
          slaHours: { type: "number", minimum: 1, maximum: 8760 }
        }
      },
      count: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1 },
      offset: { type: "integer", minimum: 0 },
      overSlaCount: { type: "integer", minimum: 0 },
      statusCounts: {
        type: "object",
        additionalProperties: { type: "integer", minimum: 0 }
      },
      queue: { type: "array", items: OpsArbitrationQueueItem }
    }
  };

  const DisputeInboxArbitrationCaseSummary = {
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { type: "string", enum: ["ArbitrationCaseSummary.v1"] },
      caseId: { type: "string", nullable: true },
      disputeId: { type: "string", nullable: true },
      status: { type: "string", nullable: true },
      arbiterAgentId: { type: "string", nullable: true },
      openedAt: { type: "string", format: "date-time", nullable: true },
      closedAt: { type: "string", format: "date-time", nullable: true },
      updatedAt: { type: "string", format: "date-time", nullable: true },
      summary: { type: "string", nullable: true }
    }
  };

  const DisputeInboxItem = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "runId", "disputeStatus", "arbitration"],
    properties: {
      schemaVersion: { type: "string", enum: ["DisputeInboxItem.v1"] },
      runId: { type: "string" },
      settlementId: { type: "string", nullable: true },
      disputeId: { type: "string", nullable: true },
      settlementStatus: { type: "string", enum: ["locked", "released", "refunded"], nullable: true },
      disputeStatus: { type: "string", enum: ["none", "open", "closed"] },
      payerAgentId: { type: "string", nullable: true },
      counterpartyAgentId: { type: "string", nullable: true },
      amountCents: { type: "integer", nullable: true },
      currency: { type: "string", nullable: true },
      disputeOpenedAt: { type: "string", format: "date-time", nullable: true },
      disputeWindowEndsAt: { type: "string", format: "date-time", nullable: true },
      releasedAmountCents: { type: "integer", minimum: 0 },
      refundedAmountCents: { type: "integer", minimum: 0 },
      disputeContext: { type: "object", additionalProperties: true, nullable: true },
      disputeResolution: { type: "object", additionalProperties: true, nullable: true },
      arbitration: {
        type: "object",
        additionalProperties: false,
        required: ["caseCount", "openCaseCount", "cases"],
        properties: {
          caseCount: { type: "integer", minimum: 0 },
          openCaseCount: { type: "integer", minimum: 0 },
          latestCaseId: { type: "string", nullable: true },
          latestCaseStatus: { type: "string", nullable: true },
          latestCaseUpdatedAt: { type: "string", format: "date-time", nullable: true },
          cases: { type: "array", items: DisputeInboxArbitrationCaseSummary }
        }
      }
    }
  };

  const DisputeInboxResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "filters", "count", "limit", "offset", "items"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      filters: {
        type: "object",
        additionalProperties: false,
        properties: {
          runId: { type: "string", nullable: true },
          disputeId: { type: "string", nullable: true },
          disputeStatus: { type: "string", enum: ["open", "closed"], nullable: true },
          settlementStatus: { type: "string", enum: ["locked", "released", "refunded"], nullable: true }
        }
      },
      count: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      offset: { type: "integer", minimum: 0 },
      items: { type: "array", items: DisputeInboxItem }
    }
  };

  const DisputeEvidenceRefs = {
    type: "object",
    additionalProperties: false,
    required: ["case", "disputeContext", "disputeResolution", "all"],
    properties: {
      case: { type: "array", items: { type: "string" } },
      disputeContext: { type: "array", items: { type: "string" } },
      disputeResolution: { type: "array", items: { type: "string" } },
      all: { type: "array", items: { type: "string" } }
    }
  };

  const DisputeDetail = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "disputeId", "runId", "item", "settlement", "relatedCases", "timeline", "evidenceRefs"],
    properties: {
      schemaVersion: { type: "string", enum: ["DisputeDetail.v1"] },
      disputeId: { type: "string" },
      runId: { type: "string" },
      caseId: { type: "string", nullable: true },
      item: DisputeInboxItem,
      settlement: {
        type: "object",
        additionalProperties: false,
        properties: {
          settlement: AgentRunSettlementV1,
          decisionRecord: { ...SettlementDecisionRecordAny, nullable: true },
          settlementReceipt: { ...SettlementReceiptV1, nullable: true },
          kernelVerification: SettlementKernelVerification
        }
      },
      arbitrationCase: { type: "object", additionalProperties: true, nullable: true },
      relatedCases: { type: "array", items: DisputeInboxArbitrationCaseSummary },
      timeline: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["eventType", "at", "source", "details"],
          properties: {
            eventType: { type: "string" },
            at: { type: "string", format: "date-time" },
            source: { type: "string", nullable: true },
            details: { type: "object", additionalProperties: true, nullable: true }
          }
        }
      },
      evidenceRefs: DisputeEvidenceRefs
    }
  };

  const DisputeDetailResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "tenantId", "detail"],
    properties: {
      ok: { type: "boolean" },
      tenantId: { type: "string" },
      detail: DisputeDetail
    }
  };

  const OpsArbitrationTimelineEvent = {
    type: "object",
    additionalProperties: false,
    required: ["eventType", "at", "source", "details"],
    properties: {
      eventType: { type: "string" },
      at: { type: "string", format: "date-time" },
      source: { type: "string", nullable: true },
      details: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const OpsArbitrationActionability = {
    type: "object",
    additionalProperties: false,
    required: ["canWrite", "canAssignArbiter", "canAddEvidence", "canSubmitVerdict", "canCloseCase", "canOpenAppeal"],
    properties: {
      canWrite: { type: "boolean" },
      canAssignArbiter: { type: "boolean" },
      canAddEvidence: { type: "boolean" },
      canSubmitVerdict: { type: "boolean" },
      canCloseCase: { type: "boolean" },
      canOpenAppeal: { type: "boolean" }
    }
  };

  const OpsArbitrationEvidenceRefs = {
    type: "object",
    additionalProperties: false,
    required: ["case", "disputeContext", "disputeResolution", "all"],
    properties: {
      case: { type: "array", items: { type: "string" } },
      disputeContext: { type: "array", items: { type: "string" } },
      disputeResolution: { type: "array", items: { type: "string" } },
      all: { type: "array", items: { type: "string" } }
    }
  };

  const OpsArbitrationWorkspaceResponse = {
    type: "object",
    additionalProperties: false,
    required: [
      "tenantId",
      "runId",
      "caseId",
      "slaHours",
      "queueItem",
      "arbitrationCase",
      "relatedCases",
      "settlement",
      "run",
      "actionability",
      "timeline",
      "evidenceRefs"
    ],
    properties: {
      tenantId: { type: "string" },
      runId: { type: "string" },
      caseId: { type: "string" },
      slaHours: { type: "number", minimum: 1, maximum: 8760 },
      queueItem: OpsArbitrationQueueItem,
      arbitrationCase: ArbitrationCaseV1,
      relatedCases: { type: "array", items: OpsArbitrationQueueItem },
      settlement: AgentRunSettlementV1,
      run: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        properties: {
          run: AgentRunV1,
          verification: { type: "object", additionalProperties: true, nullable: true },
          recentEvents: { type: "array", items: { type: "object", additionalProperties: true } }
        }
      },
      actionability: OpsArbitrationActionability,
      timeline: { type: "array", items: OpsArbitrationTimelineEvent },
      evidenceRefs: OpsArbitrationEvidenceRefs
    }
  };

  const MagicLinkAnalyticsReportResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "report"],
    properties: {
      ok: { type: "boolean" },
      report: { type: "object", additionalProperties: true }
    }
  };

  const MagicLinkTrustGraphResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "graph"],
    properties: {
      ok: { type: "boolean" },
      graph: { type: "object", additionalProperties: true }
    }
  };

  const MagicLinkTrustGraphSnapshotCreateRequest = {
    type: "object",
    additionalProperties: false,
    properties: {
      month: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}$", example: "2026-02" },
      minRuns: { type: "integer", minimum: 1, maximum: 100000 },
      maxEdges: { type: "integer", minimum: 1, maximum: 2000 }
    }
  };

  const MagicLinkTrustGraphSnapshotListResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "schemaVersion", "tenantId", "generatedAt", "count", "rows"],
    properties: {
      ok: { type: "boolean" },
      schemaVersion: { type: "string", enum: ["MagicLinkTrustGraphSnapshotList.v1"] },
      tenantId: { type: "string" },
      generatedAt: { type: "string", format: "date-time" },
      count: { type: "integer", minimum: 0 },
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            month: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}$" },
            generatedAt: { type: "string", format: "date-time", nullable: true },
            source: { type: "string", nullable: true },
            nodes: { type: "integer", minimum: 0 },
            edges: { type: "integer", minimum: 0 },
            runs: { type: "integer", minimum: 0 }
          }
        }
      }
    }
  };

  const MagicLinkTrustGraphSnapshotCreateResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "snapshot"],
    properties: {
      ok: { type: "boolean" },
      snapshot: { type: "object", additionalProperties: true }
    }
  };

  const MagicLinkTrustGraphDiffResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "diff"],
    properties: {
      ok: { type: "boolean" },
      diff: { type: "object", additionalProperties: true }
    }
  };

  const FederationInvokeBadRequestKnownErrorCodes = FEDERATION_OPENAPI_ERROR_CODES.invoke[400];
  const FederationInvokeForbiddenKnownErrorCodes = FEDERATION_OPENAPI_ERROR_CODES.invoke[403];
  const FederationInvokeConflictKnownErrorCodes = FEDERATION_OPENAPI_ERROR_CODES.invoke[409];
  const FederationInvokeInternalServerErrorKnownErrorCodes = FEDERATION_OPENAPI_ERROR_CODES.invoke[500];
  const FederationInvokeBadGatewayKnownErrorCodes = FEDERATION_OPENAPI_ERROR_CODES.invoke[502];
  const FederationInvokeServiceUnavailableKnownErrorCodes = FEDERATION_OPENAPI_ERROR_CODES.invoke[503];
  const FederationResultBadRequestKnownErrorCodes = FEDERATION_OPENAPI_ERROR_CODES.result[400];
  const FederationResultForbiddenKnownErrorCodes = FEDERATION_OPENAPI_ERROR_CODES.result[403];
  const FederationResultConflictKnownErrorCodes = FEDERATION_OPENAPI_ERROR_CODES.result[409];
  const FederationResultInternalServerErrorKnownErrorCodes = FEDERATION_OPENAPI_ERROR_CODES.result[500];
  const FederationResultBadGatewayKnownErrorCodes = FEDERATION_OPENAPI_ERROR_CODES.result[502];
  const FederationResultServiceUnavailableKnownErrorCodes = FEDERATION_OPENAPI_ERROR_CODES.result[503];

  const FederationSignatureBlock = {
    type: "object",
    additionalProperties: false,
    nullable: true,
    properties: {
      keyId: { type: "string" },
      algorithm: { type: "string" },
      signature: { type: "string" }
    }
  };

  const FederationInvokeRequest = {
    type: "object",
    additionalProperties: false,
    required: ["version", "type", "invocationId", "originDid", "targetDid", "capabilityId", "payload"],
    properties: {
      version: { type: "string", enum: ["1.0"] },
      type: { type: "string", enum: ["coordinatorInvoke"] },
      invocationId: { type: "string" },
      originDid: { type: "string" },
      targetDid: { type: "string" },
      capabilityId: { type: "string" },
      payload: { type: "object", additionalProperties: true },
      trace: {
        type: "object",
        additionalProperties: false,
        nullable: true,
        properties: {
          traceId: { type: "string" },
          spanId: { type: "string" },
          parentSpanId: { type: "string", nullable: true }
        }
      },
      signature: FederationSignatureBlock
    }
  };

  const FederationInvokeResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "invocationId", "status"],
    properties: {
      ok: { type: "boolean" },
      invocationId: { type: "string" },
      status: { type: "string", enum: ["accepted", "queued", "success", "error", "timeout", "denied"] },
      queuedAt: { type: "string", nullable: true },
      result: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const FederationResultRequest = {
    type: "object",
    additionalProperties: false,
    required: ["version", "type", "invocationId", "originDid", "targetDid", "status"],
    properties: {
      version: { type: "string", enum: ["1.0"] },
      type: { type: "string", enum: ["coordinatorResult"] },
      invocationId: { type: "string" },
      originDid: { type: "string" },
      targetDid: { type: "string" },
      status: { type: "string", enum: ["success", "error", "timeout", "denied"] },
      result: { type: "object", additionalProperties: true, nullable: true },
      evidenceRefs: { type: "array", items: { type: "string" } },
      signature: FederationSignatureBlock
    }
  };

  const FederationResultResponse = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "invocationId", "status"],
    properties: {
      ok: { type: "boolean" },
      invocationId: { type: "string" },
      status: { type: "string", enum: ["success", "error", "timeout", "denied"] },
      receiptId: { type: "string", nullable: true },
      acceptedAt: { type: "string", nullable: true },
      result: { type: "object", additionalProperties: true, nullable: true }
    }
  };

  const spec = {
    openapi: "3.0.3",
    info: {
      title: "Nooterra API",
      version,
      description: "Nooterra system-of-record API (protocol-gated).",
      "x-nooterra-protocol": NOOTERRA_PROTOCOL_CURRENT
    },
    servers: baseUrl ? [{ url: baseUrl }] : undefined,
    components: {
      securitySchemes: {
        BearerAuth: { type: "http", scheme: "bearer" },
        ProxyApiKey: { type: "apiKey", in: "header", name: "x-proxy-api-key" }
      },
      schemas: {
        ErrorResponse,
        JobCreateRequest,
        JobQuoteRequest,
        JobBookRequest,
        JobEventAppendRequest,
        AgentIdentityV1,
        AgentRegisterRequest,
        AgentPassportV1,
        AgentPassportUpsertRequest,
        AgentPassportRevokeRequest,
        ToolCallAgreementV1,
        ToolCallEvidenceV1,
        AgentRunV1,
        AgentEventV1,
        AgentRunCreateRequest,
        AgentRunEventAppendRequest,
        AgentWalletV1,
        AgentRunSettlementV1,
        SettlementDecisionRecordV1,
        SettlementDecisionRecordV2,
        SettlementDecisionRecordAny,
        SettlementReceiptV1,
        SettlementKernelVerification,
        AgentReputationV1,
        AgentReputationWindowV2,
        AgentReputationV2,
        AgentReputationAny,
        X402WalletAssignment,
        X402WalletAssignmentResolveRequest,
        X402WalletAssignmentResolveResponse,
        VerificationMethodV1,
        SettlementPolicyV1,
        MarketplaceSettlementPolicyRefV1,
        TenantSettlementPolicyV1,
        MarketplaceAgreementMilestoneV1,
        MarketplaceAgreementCancellationV1,
        MarketplaceAgreementChangeOrderPolicyV1,
        MarketplaceAgreementTermsV1,
        MarketplaceAgreementTermsInput,
        MarketplaceCounterOfferPolicyV1,
        MarketplaceBidAcceptanceV1,
        MarketplaceAgreementAcceptanceV1,
        MarketplaceOfferV2,
        MarketplaceAcceptanceV2,
        AgentDelegationLinkV1,
        AgentActingOnBehalfOfV1,
        DelegationTraceV1,
        DelegationTraceListResponse,
        AuthorityGrantV1,
        AuthorityGrantIssueRequest,
        AuthorityGrantRevokeRequest,
        DelegationEmergencyRevokeRequest,
        DelegationEmergencyRevokeResponse,
        OpsEmergencyPauseRequest,
        OpsEmergencyQuarantineRequest,
        OpsEmergencyRevokeRequest,
        OpsEmergencyKillSwitchRequest,
        OpsEmergencyResumeRequest,
        OpsEmergencyControlResponse,
        AutonomousRoutineUpsertRequest,
        AutonomousRoutineControlRequest,
        AutonomousRoutinePolicy,
        AutonomousRoutinePolicyResponse,
        AutonomousRoutinePolicyListResponse,
        AutonomousRoutineControlEvent,
        AutonomousRoutineControlResponse,
        AutonomousRoutineExecuteRequest,
        AutonomousRoutineExecutionReceipt,
        AutonomousRoutineExecutionResponse,
        AutonomousRoutineExecutionListResponse,
        AutonomousRoutineIncidentListResponse,
        MarketplaceAgreementAcceptanceSignatureV2,
        MarketplaceAgreementChangeOrderAcceptanceSignatureV2,
        MarketplaceAgreementCancellationAcceptanceSignatureV2,
        MarketplaceAgreementAcceptanceSignatureInput,
        MarketplaceAgreementPolicyBindingV2,
        MarketplaceBidNegotiationProposalV1,
        MarketplaceBidNegotiationV1,
        MarketplaceAgreementNegotiationV1,
        MarketplaceCapabilityPriceModelV1,
        MarketplaceCapabilityAvailabilityV1,
        MarketplaceCapabilityListingV1,
        MarketplaceCapabilityListingUpsertRequest,
        ProviderConformanceVerdictV1,
        ProviderConformanceSummaryV1,
        MarketplaceProviderCertificationBadgeV1,
        MarketplaceProviderPublicationSummaryV1,
        MarketplaceToolListingV1,
        MarketplaceRfqV1,
        MarketplaceTaskAgreementV2,
        MarketplaceRfqCreateRequest,
        MarketplaceRfqBidV1,
        MarketplaceBidCreateRequest,
        MarketplaceBidCounterOfferRequest,
        MarketplaceBidAcceptRequest,
        TenantSettlementPolicyUpsertRequest,
        AgentWalletCreditRequest,
        RunSettlementResolveRequest,
        RunAgreementChangeOrderRequest,
        RunAgreementCancelRequest,
        RunAgreementCancelResponse,
        DisputeVerdictSignedRequest,
        ArbitrationVerdictSignedRequest,
        DisputeOpenEnvelopeSignedRequest,
        ArbitrationCaseV1,
        RunSettlementPolicyReplayResponse,
        RunSettlementReplayEvaluateResponse,
        RunSettlementExplainabilityResponse,
        ToolCallReplayEvaluateResponse,
        ReputationFactsResponse,
        MonthCloseRequest,
        AckRequest,
        ArtifactVerificationSummary,
        OpsJobListItem,
        OpsJobsListResponse,
        CommandCenterReasonCount,
        CommandCenterDestinationCount,
        CommandCenterKernelCodeCount,
        OpsRescueQueueItem,
        OpsRescueQueue,
        OpsRescueQueueResponse,
        OpsPhase1MetricsResponse,
        OpsManagedSpecialistsResponse,
        OpsRescueTriageRequest,
        OpsRescueTriageResponse,
        OpsRescueActionRequest,
        OpsRescueActionResponse,
        OpsNetworkCommandCenterSummary,
        OpsNetworkCommandCenterResponse,
        OpsFinanceReconcileResponse,
        MagicLinkAnalyticsReportResponse,
        MagicLinkTrustGraphResponse,
        MagicLinkTrustGraphSnapshotCreateRequest,
        MagicLinkTrustGraphSnapshotListResponse,
        MagicLinkTrustGraphSnapshotCreateResponse,
        MagicLinkTrustGraphDiffResponse,
        FederationInvokeRequest,
        FederationInvokeResponse,
        FederationResultRequest,
        FederationResultResponse,
        ApprovalContinuationV1,
        ApprovalStandingPolicyV1,
        ApprovalStandingPolicyUpsertRequest,
        ApprovalInboxItemV1,
        ApprovalInboxDecisionRequest
      }
    },
    paths: {
      "/health": {
        get: { summary: "Liveness", responses: { 200: { description: "OK" } } }
      },
      "/healthz": {
        get: { summary: "Health with signals", responses: { 200: { description: "OK" } } }
      },
      "/metrics": {
        get: {
          summary: "Metrics",
          responses: { 200: { description: "OK", content: { "text/plain": { schema: { type: "string" } } } } }
        }
      },
      "/capabilities": {
        get: {
          summary: "Server capabilities",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          responses: {
            200: { description: "Capabilities JSON", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }
          }
        }
      },
      "/openapi.json": {
        get: {
          summary: "OpenAPI document",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          responses: {
            200: { description: "OpenAPI JSON", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }
          }
        }
      },
      "/.well-known/agent-locator/{agentId}": {
        get: {
          summary: "Resolve and publish deterministic AgentLocator.v1 by agentId",
          parameters: [
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: AgentLocatorV1 } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/jobs": {
        post: {
          summary: "Create job",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: JobCreateRequest } } },
          responses: {
            201: { description: "Created", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/jobs/{jobId}": {
        get: {
          summary: "Get job",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, { name: "jobId", in: "path", required: true, schema: { type: "string" } }],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/providers": {
        get: {
          summary: "List marketplace provider publications",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["certified", "conformance_failed", "draft", "all"] } },
            { name: "providerId", in: "query", required: false, schema: { type: "string" } },
            { name: "providerRef", in: "query", required: false, schema: { type: "string" } },
            { name: "toolId", in: "query", required: false, schema: { type: "string" } },
            { name: "q", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["publications", "total", "limit", "offset"],
                    properties: {
                      publications: { type: "array", items: MarketplaceProviderPublicationSummaryV1 },
                      total: { type: "integer", minimum: 0 },
                      limit: { type: "integer", minimum: 1 },
                      offset: { type: "integer", minimum: 0 }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/tools": {
        get: {
          summary: "List marketplace tool listings aggregated from provider publications",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["certified", "conformance_failed", "draft", "all"] } },
            { name: "providerId", in: "query", required: false, schema: { type: "string" } },
            { name: "providerRef", in: "query", required: false, schema: { type: "string" } },
            { name: "toolId", in: "query", required: false, schema: { type: "string" } },
            { name: "q", in: "query", required: false, schema: { type: "string" } },
            { name: "tags", in: "query", required: false, schema: { type: "string" }, description: "Comma-separated tag filter" },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["tools", "total", "limit", "offset"],
                    properties: {
                      tools: { type: "array", items: MarketplaceToolListingV1 },
                      total: { type: "integer", minimum: 0 },
                      limit: { type: "integer", minimum: 1 },
                      offset: { type: "integer", minimum: 0 }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/providers/publish": {
        post: {
          summary: "Publish provider manifest and optionally run conformance",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["baseUrl", "manifest", "publishProof", "publishProofJwksUrl"],
                  properties: {
                    providerId: { type: "string", nullable: true },
                    baseUrl: { type: "string" },
                    toolId: { type: "string", nullable: true },
                    providerSigningPublicKeyPem: { type: "string", nullable: true },
                    publishProof: { type: "string" },
                    publishProofJwksUrl: { type: "string" },
                    runConformance: { type: "boolean", nullable: true },
                    description: { type: "string", nullable: true },
                    contactUrl: { type: "string", nullable: true },
                    termsUrl: { type: "string", nullable: true },
                    tags: { type: "array", items: { type: "string" } },
                    manifest: { type: "object", additionalProperties: true }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "Updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["publication"],
                    properties: {
                      publication: { type: "object", additionalProperties: true }
                    }
                  }
                }
              }
            },
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["publication"],
                    properties: {
                      publication: { type: "object", additionalProperties: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            502: { description: "Bad Gateway", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/providers/conformance/run": {
        post: {
          summary: "Run provider conformance checks",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["baseUrl", "manifest"],
                  properties: {
                    providerId: { type: "string", nullable: true },
                    baseUrl: { type: "string" },
                    toolId: { type: "string", nullable: true },
                    providerSigningPublicKeyPem: { type: "string", nullable: true },
                    manifest: { type: "object", additionalProperties: true }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["report"],
                    properties: {
                      report: { type: "object", additionalProperties: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            502: { description: "Bad Gateway", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/providers/{providerId}": {
        get: {
          summary: "Get marketplace provider publication by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "providerId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["publication", "certificationBadge"],
                    properties: {
                      publication: { type: "object", additionalProperties: true },
                      certificationBadge: MarketplaceProviderCertificationBadgeV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/providers/{providerId}/badge": {
        get: {
          summary: "Get provider certification badge payload",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "providerId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["badge"],
                    properties: {
                      badge: MarketplaceProviderCertificationBadgeV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/capability-listings": {
        get: {
          summary: "List marketplace capability listings",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["active", "paused", "retired", "all"] } },
            { name: "capability", in: "query", required: false, schema: { type: "string" } },
            { name: "sellerAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "q", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["listings", "total", "limit", "offset"],
                    properties: {
                      listings: { type: "array", items: MarketplaceCapabilityListingV1 },
                      total: { type: "integer", minimum: 0 },
                      limit: { type: "integer", minimum: 1 },
                      offset: { type: "integer", minimum: 0 }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Create or upsert a marketplace capability listing",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: MarketplaceCapabilityListingUpsertRequest } } },
          responses: {
            200: {
              description: "Updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      listing: MarketplaceCapabilityListingV1
                    }
                  }
                }
              }
            },
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      listing: MarketplaceCapabilityListingV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/capability-listings/{listingId}": {
        get: {
          summary: "Get marketplace capability listing by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "listingId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      listing: MarketplaceCapabilityListingV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Update marketplace capability listing by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "listingId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: MarketplaceCapabilityListingUpsertRequest } } },
          responses: {
            200: {
              description: "Updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      listing: MarketplaceCapabilityListingV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        delete: {
          summary: "Delete marketplace capability listing by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "listingId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "Deleted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      deleted: { type: "boolean" },
                      listingId: { type: "string" },
                      listing: MarketplaceCapabilityListingV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/router/launch": {
        post: {
          summary: "Plan a request and emit marketplace RFQs for the routed tasks",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: RouterLaunchRequest } } },
          responses: {
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "launch", "plan", "rfqs"],
                    properties: {
                      ok: { type: "boolean", enum: [true] },
                      launch: RouterMarketplaceLaunchV1,
                      plan: RouterPlanV1,
                      rfqs: { type: "array", items: MarketplaceRfqV1 }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/router/dispatch": {
        post: {
          summary: "Deterministically auto-award and dispatch eligible RFQs for a router launch",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: RouterDispatchRequest } } },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "dispatch", "results"],
                    properties: {
                      ok: { type: "boolean", enum: [true] },
                      dispatch: RouterMarketplaceDispatchV1,
                      results: { type: "array", items: RouterMarketplaceDispatchResult }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/router/launches/{launchId}/status": {
        get: {
          summary: "Read the reconstructed status graph for a router launch",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "launchId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "status"],
                    properties: {
                      ok: { type: "boolean", enum: [true] },
                      status: RouterLaunchStatusV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/rfqs": {
        get: {
          summary: "List marketplace RFQs",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["open", "assigned", "cancelled", "closed", "all"] } },
            { name: "capability", in: "query", required: false, schema: { type: "string" } },
            { name: "posterAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["rfqs", "total", "limit", "offset"],
                    properties: {
                      rfqs: { type: "array", items: MarketplaceRfqV1 },
                      total: { type: "integer", minimum: 0 },
                      limit: { type: "integer", minimum: 1 },
                      offset: { type: "integer", minimum: 0 }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Create a marketplace RFQ",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: MarketplaceRfqCreateRequest } } },
          responses: {
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      rfq: MarketplaceRfqV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/settlement-policies": {
        get: {
          summary: "List tenant settlement policies",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "policyId", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["policies", "total", "limit", "offset"],
                    properties: {
                      policies: { type: "array", items: TenantSettlementPolicyV1 },
                      total: { type: "integer", minimum: 0 },
                      limit: { type: "integer", minimum: 1 },
                      offset: { type: "integer", minimum: 0 }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Upsert tenant settlement policy version",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: TenantSettlementPolicyUpsertRequest } } },
          responses: {
            200: {
              description: "Updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      policy: TenantSettlementPolicyV1
                    }
                  }
                }
              }
            },
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      policy: TenantSettlementPolicyV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/settlement-policies/{policyId}/{policyVersion}": {
        get: {
          summary: "Get tenant settlement policy version",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "policyId", in: "path", required: true, schema: { type: "string" } },
            { name: "policyVersion", in: "path", required: true, schema: { type: "integer", minimum: 1 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      policy: TenantSettlementPolicyV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/rfqs/{rfqId}/bids": {
        get: {
          summary: "List bids for a marketplace RFQ",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "rfqId", in: "path", required: true, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["pending", "accepted", "rejected", "all"] } },
            { name: "bidderAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["rfqId", "bids", "total", "limit", "offset"],
                    properties: {
                      rfqId: { type: "string" },
                      bids: { type: "array", items: MarketplaceRfqBidV1 },
                      total: { type: "integer", minimum: 0 },
                      limit: { type: "integer", minimum: 1 },
                      offset: { type: "integer", minimum: 0 }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Submit a bid for a marketplace RFQ",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader, { name: "rfqId", in: "path", required: true, schema: { type: "string" } }],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: MarketplaceBidCreateRequest } } },
          responses: {
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      rfq: MarketplaceRfqV1,
                      bid: MarketplaceRfqBidV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/rfqs/{rfqId}/bids/{bidId}/counter-offer": {
        post: {
          summary: "Apply a counter-offer revision to a pending marketplace bid",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "rfqId", in: "path", required: true, schema: { type: "string" } },
            { name: "bidId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: MarketplaceBidCounterOfferRequest } } },
          responses: {
            200: {
              description: "Counter-offer applied",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      rfq: MarketplaceRfqV1,
                      bid: MarketplaceRfqBidV1,
                      negotiation: MarketplaceBidNegotiationV1,
                      proposal: MarketplaceBidNegotiationProposalV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/rfqs/{rfqId}/accept": {
        post: {
          summary: "Accept a bid for a marketplace RFQ",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader, { name: "rfqId", in: "path", required: true, schema: { type: "string" } }],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: MarketplaceBidAcceptRequest } } },
          responses: {
            200: {
              description: "Accepted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      rfq: MarketplaceRfqV1,
                      acceptedBid: { allOf: [MarketplaceRfqBidV1], nullable: true },
                      run: AgentRunV1,
                      settlement: AgentRunSettlementV1,
                      agreement: MarketplaceTaskAgreementV2,
                      offer: { allOf: [MarketplaceOfferV2], nullable: true },
                      offerAcceptance: { allOf: [MarketplaceAcceptanceV2], nullable: true },
                      decisionRecord: { ...SettlementDecisionRecordAny, nullable: true },
                      settlementReceipt: { ...SettlementReceiptV1, nullable: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/rfqs/{rfqId}/auto-accept": {
        post: {
          summary: "Deterministically select and accept a marketplace bid for an RFQ",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader, { name: "rfqId", in: "path", required: true, schema: { type: "string" } }],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: MarketplaceBidAutoAcceptRequest } } },
          responses: {
            200: {
              description: "Accepted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["rfq", "acceptedBid", "run", "settlement", "agreement", "decision"],
                    properties: {
                      rfq: MarketplaceRfqV1,
                      acceptedBid: { allOf: [MarketplaceRfqBidV1], nullable: true },
                      run: AgentRunV1,
                      settlement: AgentRunSettlementV1,
                      agreement: MarketplaceTaskAgreementV2,
                      offer: { allOf: [MarketplaceOfferV2], nullable: true },
                      offerAcceptance: { allOf: [MarketplaceAcceptanceV2], nullable: true },
                      decisionRecord: { ...SettlementDecisionRecordAny, nullable: true },
                      settlementReceipt: { ...SettlementReceiptV1, nullable: true },
                      decision: MarketplaceAutoAwardDecisionV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/runs/{runId}/arbitration/cases": {
        get: {
          summary: "List arbitration cases for a run",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["open", "under_review", "verdict_issued", "closed"] } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      runId: { type: "string" },
                      cases: { type: "array", items: ArbitrationCaseV1 }
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/runs/{runId}/arbitration/cases/{caseId}": {
        get: {
          summary: "Get arbitration case by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } },
            { name: "caseId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      runId: { type: "string" },
                      arbitrationCase: ArbitrationCaseV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/runs/{runId}/arbitration/open": {
        post: {
          summary: "Open an arbitration case for an active dispute",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    caseId: { type: "string" },
                    disputeId: { type: "string" },
                    claimantAgentId: { type: "string" },
                    respondentAgentId: { type: "string" },
                    arbiterAgentId: { type: "string" },
                    panelCandidateAgentIds: { type: "array", items: { type: "string" } },
                    summary: { type: "string" },
                    evidenceRefs: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          },
          responses: {
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      arbitrationCase: ArbitrationCaseV1,
                      arbitrationCaseArtifact: { type: "object", additionalProperties: true, nullable: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...X402ArbitrationOpenConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402ArbitrationOpenConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/runs/{runId}/arbitration/assign": {
        post: {
          summary: "Assign or reassign arbiter for a case",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["caseId"],
                  properties: {
                    caseId: { type: "string" },
                    arbiterAgentId: { type: "string" },
                    panelCandidateAgentIds: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      arbitrationCase: ArbitrationCaseV1,
                      arbitrationCaseArtifact: { type: "object", additionalProperties: true, nullable: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...X402ArbitrationAssignConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402ArbitrationAssignConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/runs/{runId}/arbitration/evidence": {
        post: {
          summary: "Attach evidence to arbitration case",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["caseId", "evidenceRef"],
                  properties: {
                    caseId: { type: "string" },
                    disputeId: { type: "string" },
                    evidenceRef: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      arbitrationCase: ArbitrationCaseV1,
                      arbitrationCaseArtifact: { type: "object", additionalProperties: true, nullable: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...X402ArbitrationEvidenceConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402ArbitrationEvidenceConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/runs/{runId}/arbitration/verdict": {
        post: {
          summary: "Submit signed arbitration verdict for a case",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["caseId", "arbitrationVerdict"],
                  properties: {
                    caseId: { type: "string" },
                    disputeId: { type: "string" },
                    arbitrationVerdict: ArbitrationVerdictSignedRequest
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      arbitrationCase: ArbitrationCaseV1,
                      arbitrationVerdict: { type: "object", additionalProperties: true },
                      arbitrationCaseArtifact: { type: "object", additionalProperties: true, nullable: true },
                      arbitrationVerdictArtifact: { type: "object", additionalProperties: true, nullable: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...X402ArbitrationVerdictConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402ArbitrationVerdictConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/runs/{runId}/arbitration/close": {
        post: {
          summary: "Finalize arbitration case and settlement finality transition",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["caseId"],
                  properties: {
                    caseId: { type: "string" },
                    disputeId: { type: "string" },
                    summary: { type: "string" },
                    resolutionOutcome: { type: "string", enum: ["accepted", "rejected", "partial", "withdrawn", "unresolved"] }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      arbitrationCase: ArbitrationCaseV1,
                      settlement: AgentRunSettlementV1,
                      arbitrationCaseArtifact: { type: "object", additionalProperties: true, nullable: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...X402ArbitrationCloseConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402ArbitrationCloseConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/runs/{runId}/arbitration/appeal": {
        post: {
          summary: "Open appeal arbitration case linked to parent verdict",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["parentCaseId"],
                  properties: {
                    caseId: { type: "string" },
                    disputeId: { type: "string" },
                    parentCaseId: { type: "string" },
                    parentVerdictId: { type: "string" },
                    reason: { type: "string" },
                    summary: { type: "string" },
                    arbiterAgentId: { type: "string" },
                    panelCandidateAgentIds: { type: "array", items: { type: "string" } },
                    evidenceRefs: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          },
          responses: {
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      arbitrationCase: ArbitrationCaseV1,
                      arbitrationCaseArtifact: { type: "object", additionalProperties: true, nullable: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...X402ArbitrationAppealConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402ArbitrationAppealConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/runs/{runId}/dispute/open": {
        post: {
          summary: "Open a run settlement dispute (within dispute window)",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    disputeId: { type: "string" },
                    disputeType: { type: "string", enum: ["quality", "delivery", "fraud", "policy", "payment", "other"] },
                    disputePriority: { type: "string", enum: ["low", "normal", "high", "critical"] },
                    disputeChannel: { type: "string", enum: ["counterparty", "policy_engine", "arbiter", "external"] },
                    escalationLevel: { type: "string", enum: ["l1_counterparty", "l2_arbiter", "l3_external"] },
                    openedByAgentId: { type: "string" },
                    reason: { type: "string" },
                    evidenceRefs: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      settlement: AgentRunSettlementV1,
                      disputeEvidence: { type: "object", additionalProperties: true, nullable: true },
                      disputeEscalation: { type: "object", additionalProperties: true, nullable: true },
                      verdict: { type: "object", additionalProperties: true, nullable: true },
                      verdictArtifact: { type: "object", additionalProperties: true, nullable: true },
                      arbitrationVerdict: { type: "object", additionalProperties: true, nullable: true },
                      arbitrationCaseArtifact: { type: "object", additionalProperties: true, nullable: true },
                      arbitrationVerdictArtifact: { type: "object", additionalProperties: true, nullable: true }
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...X402DisputeOpenConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402DisputeOpenConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/runs/{runId}/dispute/close": {
        post: {
          summary: "Close an open run settlement dispute",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    disputeId: { type: "string" },
                    resolution: {
                      type: "object",
                      additionalProperties: true,
                      nullable: true,
                      properties: {
                        outcome: { type: "string", enum: ["accepted", "rejected", "partial", "withdrawn", "unresolved"] },
                        escalationLevel: { type: "string", enum: ["l1_counterparty", "l2_arbiter", "l3_external"] },
                        closedByAgentId: { type: "string", nullable: true },
                        summary: { type: "string", nullable: true },
                        closedAt: { type: "string", format: "date-time", nullable: true },
                        releaseRatePct: { type: "integer", minimum: 0, maximum: 100, nullable: true },
                        evidenceRefs: { type: "array", items: { type: "string" } }
                      }
                    },
                    resolutionOutcome: { type: "string", enum: ["accepted", "rejected", "partial", "withdrawn", "unresolved"] },
                    resolutionEscalationLevel: { type: "string", enum: ["l1_counterparty", "l2_arbiter", "l3_external"] },
                    resolutionReleaseRatePct: { type: "integer", minimum: 0, maximum: 100 },
                    resolutionSummary: { type: "string" },
                    closedByAgentId: { type: "string" },
                    resolutionEvidenceRefs: { type: "array", items: { type: "string" } },
                    verdict: DisputeVerdictSignedRequest,
                    arbitrationVerdict: ArbitrationVerdictSignedRequest
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      settlement: AgentRunSettlementV1,
                      disputeEvidence: { type: "object", additionalProperties: true, nullable: true },
                      disputeEscalation: { type: "object", additionalProperties: true, nullable: true },
                      verdict: {
                        type: "object",
                        additionalProperties: true,
                        nullable: true
                      },
                      verdictArtifact: {
                        type: "object",
                        additionalProperties: true,
                        nullable: true
                      },
                      arbitrationVerdict: { type: "object", additionalProperties: true, nullable: true },
                      arbitrationCaseArtifact: { type: "object", additionalProperties: true, nullable: true },
                      arbitrationVerdictArtifact: { type: "object", additionalProperties: true, nullable: true }
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...X402DisputeCloseConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402DisputeCloseConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/runs/{runId}/dispute/evidence": {
        post: {
          summary: "Submit dispute evidence to an open run dispute",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["evidenceRef"],
                  properties: {
                    evidenceRef: { type: "string" },
                    submittedByAgentId: { type: "string" },
                    reason: { type: "string" },
                    disputeId: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      settlement: AgentRunSettlementV1,
                      disputeEvidence: { type: "object", additionalProperties: true, nullable: true },
                      disputeEscalation: { type: "object", additionalProperties: true, nullable: true },
                      verdict: { type: "object", additionalProperties: true, nullable: true },
                      verdictArtifact: { type: "object", additionalProperties: true, nullable: true },
                      arbitrationVerdict: { type: "object", additionalProperties: true, nullable: true },
                      arbitrationCaseArtifact: { type: "object", additionalProperties: true, nullable: true },
                      arbitrationVerdictArtifact: { type: "object", additionalProperties: true, nullable: true }
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...X402DisputeEvidenceConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402DisputeEvidenceConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/runs/{runId}/dispute/escalate": {
        post: {
          summary: "Escalate an open run dispute to a higher escalation level",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["escalationLevel"],
                  properties: {
                    disputeId: { type: "string" },
                    escalationLevel: { type: "string", enum: ["l1_counterparty", "l2_arbiter", "l3_external"] },
                    channel: { type: "string", enum: ["counterparty", "policy_engine", "arbiter", "external"] },
                    escalatedByAgentId: { type: "string" },
                    reason: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      settlement: AgentRunSettlementV1,
                      disputeEvidence: { type: "object", additionalProperties: true, nullable: true },
                      disputeEscalation: { type: "object", additionalProperties: true, nullable: true },
                      verdict: { type: "object", additionalProperties: true, nullable: true },
                      verdictArtifact: { type: "object", additionalProperties: true, nullable: true },
                      arbitrationVerdict: { type: "object", additionalProperties: true, nullable: true },
                      arbitrationCaseArtifact: { type: "object", additionalProperties: true, nullable: true },
                      arbitrationVerdictArtifact: { type: "object", additionalProperties: true, nullable: true }
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...X402DisputeEscalateConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402DisputeEscalateConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/authority-envelopes": {
        post: {
          summary: "Persist a canonical authority envelope",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: AuthorityEnvelopeV1 } } },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "authorityEnvelope"],
                    properties: {
                      ok: { type: "boolean" },
                      authorityEnvelope: AuthorityEnvelopeV1
                    }
                  }
                }
              }
            },
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "authorityEnvelope"],
                    properties: {
                      ok: { type: "boolean" },
                      authorityEnvelope: AuthorityEnvelopeV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        get: {
          summary: "List authority envelopes",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "envelopeId", in: "query", required: false, schema: { type: "string" } },
            { name: "envelopeHash", in: "query", required: false, schema: { type: "string" } },
            { name: "actorAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "principalId", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "authorityEnvelopes", "limit", "offset"],
                    properties: {
                      ok: { type: "boolean" },
                      authorityEnvelopes: { type: "array", items: AuthorityEnvelopeV1 },
                      limit: { type: "integer" },
                      offset: { type: "integer" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/authority-envelopes/{envelopeId}": {
        get: {
          summary: "Get authority envelope by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "envelopeId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "authorityEnvelope"],
                    properties: {
                      ok: { type: "boolean" },
                      authorityEnvelope: AuthorityEnvelopeV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/approval-requests": {
        post: {
          summary: "Create a canonical approval request bound to an authority envelope",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    authorityEnvelope: AuthorityEnvelopeV1,
                    envelopeId: { type: "string", nullable: true },
                    envelopeRef: {
                      type: "object",
                      additionalProperties: false,
                      nullable: true,
                      properties: {
                        envelopeId: { type: "string" }
                      }
                    },
                    requestedBy: { type: "string", nullable: true },
                    requestedAt: { type: "string", format: "date-time", nullable: true },
                    actionId: { type: "string", nullable: true },
                    actionSha256: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
                    approvalPolicy: { ...X402HumanApprovalPolicyV1, nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "authorityEnvelope", "approvalRequest"],
                    properties: {
                      ok: { type: "boolean" },
                      authorityEnvelope: AuthorityEnvelopeV1,
                      approvalRequest: ApprovalRequestV1
                    }
                  }
                }
              }
            },
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "authorityEnvelope", "approvalRequest"],
                    properties: {
                      ok: { type: "boolean" },
                      authorityEnvelope: AuthorityEnvelopeV1,
                      approvalRequest: ApprovalRequestV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        get: {
          summary: "List approval requests",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "requestId", in: "query", required: false, schema: { type: "string" } },
            { name: "envelopeId", in: "query", required: false, schema: { type: "string" } },
            { name: "envelopeHash", in: "query", required: false, schema: { type: "string" } },
            { name: "requestedBy", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "approvalRequests", "limit", "offset"],
                    properties: {
                      ok: { type: "boolean" },
                      approvalRequests: { type: "array", items: ApprovalRequestV1 },
                      limit: { type: "integer" },
                      offset: { type: "integer" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/approval-requests/{requestId}": {
        get: {
          summary: "Get approval request by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "requestId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "approvalRequest"],
                    properties: {
                      ok: { type: "boolean" },
                      approvalRequest: ApprovalRequestV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/approval-decisions": {
        post: {
          summary: "Persist an approval decision bound to an approval request",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    requestId: { type: "string" },
                    approvalDecision: { ...ApprovalDecisionV1, nullable: true },
                    humanApprovalDecision: { ...X402HumanApprovalDecisionV1, nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "authorityEnvelope", "approvalRequest", "approvalDecision"],
                    properties: {
                      ok: { type: "boolean" },
                      authorityEnvelope: AuthorityEnvelopeV1,
                      approvalRequest: ApprovalRequestV1,
                      approvalDecision: ApprovalDecisionV1,
                      approvalContinuation: { ...ApprovalContinuationV1, nullable: true }
                    }
                  }
                }
              }
            },
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "authorityEnvelope", "approvalRequest", "approvalDecision"],
                    properties: {
                      ok: { type: "boolean" },
                      authorityEnvelope: AuthorityEnvelopeV1,
                      approvalRequest: ApprovalRequestV1,
                      approvalDecision: ApprovalDecisionV1,
                      approvalContinuation: { ...ApprovalContinuationV1, nullable: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        get: {
          summary: "List approval decisions",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "decisionId", in: "query", required: false, schema: { type: "string" } },
            { name: "requestId", in: "query", required: false, schema: { type: "string" } },
            { name: "decidedBy", in: "query", required: false, schema: { type: "string" } },
            { name: "approved", in: "query", required: false, schema: { type: "boolean" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "approvalDecisions", "limit", "offset"],
                    properties: {
                      ok: { type: "boolean" },
                      approvalDecisions: { type: "array", items: ApprovalDecisionV1 },
                      limit: { type: "integer" },
                      offset: { type: "integer" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/approval-decisions/{decisionId}": {
        get: {
          summary: "Get approval decision by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "decisionId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "approvalDecision"],
                    properties: {
                      ok: { type: "boolean" },
                      approvalDecision: ApprovalDecisionV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/approval-policies": {
        post: {
          summary: "Create or update a standing approval policy",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: ApprovalStandingPolicyUpsertRequest } } },
          responses: {
            200: {
              description: "Updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "approvalStandingPolicy"],
                    properties: {
                      ok: { type: "boolean" },
                      approvalStandingPolicy: ApprovalStandingPolicyV1
                    }
                  }
                }
              }
            },
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "approvalStandingPolicy"],
                    properties: {
                      ok: { type: "boolean" },
                      approvalStandingPolicy: ApprovalStandingPolicyV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        get: {
          summary: "List standing approval policies",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "policyId", in: "query", required: false, schema: { type: "string" } },
            { name: "principalId", in: "query", required: false, schema: { type: "string" } },
            { name: "principalType", in: "query", required: false, schema: { type: "string", enum: ["human", "org", "service", "agent"] } },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["active", "disabled"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "approvalStandingPolicies", "limit", "offset"],
                    properties: {
                      ok: { type: "boolean" },
                      approvalStandingPolicies: { type: "array", items: ApprovalStandingPolicyV1 },
                      limit: { type: "integer" },
                      offset: { type: "integer" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/approval-policies/{policyId}": {
        get: {
          summary: "Get standing approval policy by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "policyId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "approvalStandingPolicy"],
                    properties: {
                      ok: { type: "boolean" },
                      approvalStandingPolicy: ApprovalStandingPolicyV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/approval-policies/{policyId}/revoke": {
        post: {
          summary: "Disable a standing approval policy",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "policyId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  nullable: true,
                  additionalProperties: false,
                  properties: {
                    reasonCode: { type: "string", nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "approvalStandingPolicy"],
                    properties: {
                      ok: { type: "boolean" },
                      approvalStandingPolicy: ApprovalStandingPolicyV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/approval-inbox": {
        get: {
          summary: "List pending or decided approval inbox items",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["pending", "decided", "all"] } },
            { name: "principalId", in: "query", required: false, schema: { type: "string" } },
            { name: "requestedBy", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "items", "limit", "offset"],
                    properties: {
                      ok: { type: "boolean" },
                      items: { type: "array", items: ApprovalInboxItemV1 },
                      limit: { type: "integer" },
                      offset: { type: "integer" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/approval-inbox/{requestId}/decide": {
        post: {
          summary: "Record a human approval decision for a pending inbox request",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "requestId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: ApprovalInboxDecisionRequest } } },
          responses: {
            200: {
              description: "Updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "authorityEnvelope", "approvalRequest", "approvalDecision"],
                    properties: {
                      ok: { type: "boolean" },
                      authorityEnvelope: AuthorityEnvelopeV1,
                      approvalRequest: ApprovalRequestV1,
                      approvalDecision: ApprovalDecisionV1
                    }
                  }
                }
              }
            },
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "authorityEnvelope", "approvalRequest", "approvalDecision"],
                    properties: {
                      ok: { type: "boolean" },
                      authorityEnvelope: AuthorityEnvelopeV1,
                      approvalRequest: ApprovalRequestV1,
                      approvalDecision: ApprovalDecisionV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/action-intents": {
        post: {
          summary: "Create a public ActionIntent.v1 alias over an authority envelope",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    actionIntentId: { type: "string", nullable: true },
                    authorityEnvelope: { ...AuthorityEnvelopeV1, nullable: true },
                    actorAgentId: { type: "string", nullable: true },
                    principalType: { type: "string", enum: ["human", "org", "service", "agent"], nullable: true },
                    principalId: { type: "string", nullable: true },
                    purpose: { type: "string", nullable: true },
                    title: { type: "string", nullable: true },
                    requiredCapability: { type: "string", nullable: true },
                    capabilitiesRequested: { type: "array", items: { type: "string" } },
                    dataClassesRequested: { type: "array", items: { type: "string" } },
                    sideEffectsRequested: { type: "array", items: { type: "string" } },
                    spendEnvelope: { ...AuthorityEnvelopeV1.properties.spendEnvelope, nullable: true },
                    currency: { type: "string", nullable: true },
                    amountCents: { type: "integer", minimum: 0, nullable: true },
                    maxPerCallCents: { type: "integer", minimum: 0, nullable: true },
                    maxTotalCents: { type: "integer", minimum: 0, nullable: true },
                    delegationRights: { ...AuthorityEnvelopeV1.properties.delegationRights, nullable: true },
                    duration: { ...AuthorityEnvelopeV1.properties.duration, nullable: true },
                    downstreamRecipients: { type: "array", items: { type: "string" } },
                    reversibilityClass: { type: "string", enum: ["reversible", "partially_reversible", "irreversible"], nullable: true },
                    riskClass: { type: "string", enum: ["low", "medium", "high"], nullable: true },
                    evidenceRequirements: { type: "array", items: { type: "string" } },
                    metadata: { type: "object", additionalProperties: true, nullable: true },
                    host: { type: "object", additionalProperties: true, nullable: true },
                    createdAt: { type: "string", format: "date-time", nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" }, actionIntent: ActionIntentV1, authorityEnvelope: AuthorityEnvelopeV1 } } } }
            },
            201: {
              description: "Created",
              content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" }, actionIntent: ActionIntentV1, authorityEnvelope: AuthorityEnvelopeV1 } } } }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/action-intents/{actionIntentId}": {
        get: {
          summary: "Get a public ActionIntent.v1 alias by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "actionIntentId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      actionIntent: ActionIntentV1,
                      authorityEnvelope: AuthorityEnvelopeV1,
                      approvalRequest: { ...ApprovalRequestV1, nullable: true },
                      approvalStatus: { ...ActionWalletApprovalStatus, nullable: true },
                      approvalDecision: { ...ApprovalDecisionV1, nullable: true },
                      approvalContinuation: { type: "object", additionalProperties: true, nullable: true },
                      approvalUrl: { type: "string", nullable: true },
                      executionGrant: { ...ExecutionGrantV1, nullable: true }
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/action-intents/{actionIntentId}/approval-requests": {
        post: {
          summary: "Create an approval request for an existing ActionIntent.v1",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "actionIntentId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    authorityEnvelope: { ...AuthorityEnvelopeV1, nullable: true },
                    approvalRequest: { ...ApprovalRequestV1, nullable: true },
                    requestId: { type: "string", nullable: true },
                    requestedBy: { type: "string", nullable: true },
                    requestedAt: { type: "string", format: "date-time", nullable: true },
                    actionId: { type: "string", nullable: true },
                    actionSha256: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
                    approvalPolicy: { ...X402HumanApprovalPolicyV1, nullable: true },
                    host: { type: "object", additionalProperties: true, nullable: true },
                    execution: {
                      type: "object",
                      nullable: true,
                      additionalProperties: false,
                      properties: {
                        kind: { type: "string", enum: ["work_order"], nullable: true },
                        workOrderId: { type: "string", nullable: true },
                        dispatchNow: { type: "boolean", nullable: true },
                        requestBody: { ...SubAgentWorkOrderCreateRequest, nullable: true },
                        createdAt: { type: "string", format: "date-time", nullable: true }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" }, actionIntent: ActionIntentV1, authorityEnvelope: AuthorityEnvelopeV1, approvalRequest: ApprovalRequestV1, approvalStatus: ActionWalletApprovalStatus, approvalContinuation: { type: "object", additionalProperties: true, nullable: true }, approvalUrl: { type: "string", nullable: true }, executionGrant: ExecutionGrantV1 } } } }
            },
            201: {
              description: "Created",
              content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" }, actionIntent: ActionIntentV1, authorityEnvelope: AuthorityEnvelopeV1, approvalRequest: ApprovalRequestV1, approvalStatus: ActionWalletApprovalStatus, approvalContinuation: { type: "object", additionalProperties: true, nullable: true }, approvalUrl: { type: "string", nullable: true }, executionGrant: ExecutionGrantV1 } } } }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/approval-requests/{requestId}": {
        get: {
          summary: "Get public approval request status with action-intent aliases",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "requestId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" }, actionIntent: { ...ActionIntentV1, nullable: true }, authorityEnvelope: { ...AuthorityEnvelopeV1, nullable: true }, approvalRequest: ApprovalRequestV1, approvalStatus: ActionWalletApprovalStatus, approvalDecision: { ...ApprovalDecisionV1, nullable: true }, approvalContinuation: { type: "object", additionalProperties: true, nullable: true }, approvalUrl: { type: "string", nullable: true }, executionGrant: ExecutionGrantV1 } } } }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/approval-requests/{requestId}/decisions": {
        post: {
          summary: "Record an approval decision for a public approval request alias",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "requestId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: ApprovalInboxDecisionRequest } } },
          responses: {
            200: {
              description: "OK",
              content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" }, authorityEnvelope: AuthorityEnvelopeV1, approvalRequest: ApprovalRequestV1, approvalStatus: ActionWalletApprovalStatus, approvalDecision: ApprovalDecisionV1, approvalContinuation: { type: "object", additionalProperties: true, nullable: true }, executionGrant: ExecutionGrantV1 } } } }
            },
            201: {
              description: "Created",
              content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" }, authorityEnvelope: AuthorityEnvelopeV1, approvalRequest: ApprovalRequestV1, approvalStatus: ActionWalletApprovalStatus, approvalDecision: ApprovalDecisionV1, approvalContinuation: { type: "object", additionalProperties: true, nullable: true }, executionGrant: ExecutionGrantV1 } } } }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/authority-grants": {
        post: {
          summary: "Issue authority grant",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: AuthorityGrantIssueRequest
              }
            }
          },
          responses: {
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "authorityGrant"],
                    properties: {
                      ok: { type: "boolean" },
                      authorityGrant: AuthorityGrantV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        get: {
          summary: "List authority grants",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "grantId", in: "query", required: false, schema: { type: "string" } },
            { name: "grantHash", in: "query", required: false, schema: { type: "string" } },
            { name: "principalId", in: "query", required: false, schema: { type: "string" } },
            { name: "granteeAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "includeRevoked", in: "query", required: false, schema: { type: "boolean" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "grants", "limit", "offset"],
                    properties: {
                      ok: { type: "boolean" },
                      grants: { type: "array", items: AuthorityGrantV1 },
                      limit: { type: "integer" },
                      offset: { type: "integer" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/authority-grants/{grantId}": {
        get: {
          summary: "Get authority grant by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "grantId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "authorityGrant"],
                    properties: {
                      ok: { type: "boolean" },
                      authorityGrant: AuthorityGrantV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/authority-grants/{grantId}/revoke": {
        post: {
          summary: "Revoke authority grant",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "grantId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: AuthorityGrantRevokeRequest
              }
            }
          },
          responses: {
            200: {
              description: "Revoked",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "authorityGrant"],
                    properties: {
                      ok: { type: "boolean" },
                      authorityGrant: AuthorityGrantV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": ["X402_AUTHORITY_GRANT_REVOKE_BLOCKED"],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(["X402_AUTHORITY_GRANT_REVOKE_BLOCKED"])
                }
              }
            },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/marketplace/agents/search": {
        get: {
          summary: "Search and rank marketplace agents",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["active", "suspended", "revoked", "all"] } },
            { name: "capability", in: "query", required: false, schema: { type: "string" } },
            { name: "minTrustScore", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 100 } },
            { name: "riskTier", in: "query", required: false, schema: { type: "string", enum: ["low", "guarded", "elevated", "high"] } },
            { name: "includeReputation", in: "query", required: false, schema: { type: "boolean" } },
            { name: "reputationVersion", in: "query", required: false, schema: { type: "string", enum: ["v1", "v2"] } },
            { name: "reputationWindow", in: "query", required: false, schema: { type: "string", enum: ["7d", "30d", "allTime"] } },
            { name: "scoreStrategy", in: "query", required: false, schema: { type: "string", enum: ["balanced", "recent_bias", "trust_weighted"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      reputationVersion: { type: "string", enum: ["v1", "v2"] },
                      reputationWindow: { type: "string", enum: ["7d", "30d", "allTime"] },
                      scoreStrategy: { type: "string", enum: ["balanced", "recent_bias", "trust_weighted"] },
                      total: { type: "integer" },
                      limit: { type: "integer" },
                      offset: { type: "integer" },
                      results: {
                        type: "array",
                        items: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            rank: { type: "integer", minimum: 1 },
                            rankingScore: { type: "integer", minimum: 0, maximum: 100 },
                            riskTier: { type: "string", enum: ["low", "guarded", "elevated", "high"] },
                            agentIdentity: AgentIdentityV1,
                            reputation: AgentReputationAny
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agent-cards": {
        get: {
          summary: "List agent discovery cards",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "query", required: false, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["active", "suspended", "revoked", "all"] } },
            { name: "visibility", in: "query", required: false, schema: { type: "string", enum: ["public", "tenant", "private"] } },
            { name: "capability", in: "query", required: false, schema: { type: "string" } },
            { name: "runtime", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      agentCards: { type: "array", items: AgentCardV1 },
                      limit: { type: "integer" },
                      offset: { type: "integer" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Create or update an agent discovery card",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: AgentCardUpsertRequest } } },
          responses: {
            200: {
              description: "Updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      agentCard: AgentCardV1
                    }
                  }
                }
              }
            },
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      agentCard: AgentCardV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/public/agents/resolve": {
        get: {
          summary: "Resolve a public agent reference into deterministic AgentLocator.v1",
          parameters: [ProtocolHeader, RequestIdHeader, { name: "agent", in: "query", required: true, schema: { type: "string" } }],
          security: [],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      locator: AgentLocatorV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/public/agent-cards/{agentId}": {
        get: {
          summary: "Get a public agent card by agentId",
          parameters: [
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "path", required: true, schema: { type: "string" } },
            { name: "includeReputation", in: "query", required: false, schema: { type: "boolean" } },
            { name: "reputationVersion", in: "query", required: false, schema: { type: "string", enum: ["v1", "v2"] } },
            { name: "reputationWindow", in: "query", required: false, schema: { type: "string", enum: ["7d", "30d", "allTime"] } },
            { name: "asOf", in: "query", required: false, schema: { type: "string", format: "date-time" } }
          ],
          security: [],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "agentCard"],
                    properties: {
                      ok: { type: "boolean" },
                      agentCard: AgentCardV1,
                      reputation: { ...AgentReputationAny, nullable: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/public/agent-cards/discover": {
        get: {
          summary: "Discover public agent cards across tenants",
          parameters: [
            RequestIdHeader,
            { name: "capability", in: "query", required: false, schema: { type: "string" } },
            { name: "executionCoordinatorDid", in: "query", required: false, schema: { type: "string" } },
            { name: "toolId", in: "query", required: false, schema: { type: "string" } },
            { name: "toolMcpName", in: "query", required: false, schema: { type: "string" } },
            { name: "toolRiskClass", in: "query", required: false, schema: { type: "string", enum: ["read", "compute", "action", "financial"] } },
            { name: "toolSideEffecting", in: "query", required: false, schema: { type: "boolean" } },
            { name: "toolMaxPriceCents", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
            {
              name: "toolRequiresEvidenceKind",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["artifact", "hash", "verification_report", "execution_attestation"] }
            },
            { name: "supportsPolicyTemplate", in: "query", required: false, schema: { type: "string" } },
            { name: "supportsEvidencePack", in: "query", required: false, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["active", "suspended", "revoked", "all"] } },
            { name: "visibility", in: "query", required: false, schema: { type: "string", enum: ["public"] } },
            { name: "runtime", in: "query", required: false, schema: { type: "string" } },
            { name: "requireCapabilityAttestation", in: "query", required: false, schema: { type: "boolean" } },
            { name: "attestationMinLevel", in: "query", required: false, schema: { type: "string", enum: ["self_claim", "attested", "certified"] } },
            { name: "attestationIssuerAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "includeAttestationMetadata", in: "query", required: false, schema: { type: "boolean" } },
            { name: "minTrustScore", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 100 } },
            { name: "riskTier", in: "query", required: false, schema: { type: "string", enum: ["low", "guarded", "elevated", "high"] } },
            { name: "includeReputation", in: "query", required: false, schema: { type: "boolean" } },
            { name: "reputationVersion", in: "query", required: false, schema: { type: "string", enum: ["v1", "v2"] } },
            { name: "reputationWindow", in: "query", required: false, schema: { type: "string", enum: ["7d", "30d", "allTime"] } },
            { name: "scoreStrategy", in: "query", required: false, schema: { type: "string", enum: ["balanced", "recent_bias", "trust_weighted"] } },
            { name: "requesterAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "includeRoutingFactors", in: "query", required: false, schema: { type: "boolean" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: buildAgentCardDiscoveryResultV1()
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agent-cards/discover": {
        get: {
          summary: "Discover agent cards by capability/runtime/trust filters",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "capability", in: "query", required: false, schema: { type: "string" } },
            { name: "toolId", in: "query", required: false, schema: { type: "string" } },
            { name: "toolMcpName", in: "query", required: false, schema: { type: "string" } },
            { name: "toolRiskClass", in: "query", required: false, schema: { type: "string", enum: ["read", "compute", "action", "financial"] } },
            { name: "toolSideEffecting", in: "query", required: false, schema: { type: "boolean" } },
            { name: "toolMaxPriceCents", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
            {
              name: "toolRequiresEvidenceKind",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["artifact", "hash", "verification_report", "execution_attestation"] }
            },
            { name: "supportsPolicyTemplate", in: "query", required: false, schema: { type: "string" } },
            { name: "supportsEvidencePack", in: "query", required: false, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["active", "suspended", "revoked", "all"] } },
            { name: "visibility", in: "query", required: false, schema: { type: "string", enum: ["public", "tenant", "private", "all"] } },
            { name: "runtime", in: "query", required: false, schema: { type: "string" } },
            { name: "requireCapabilityAttestation", in: "query", required: false, schema: { type: "boolean" } },
            { name: "attestationMinLevel", in: "query", required: false, schema: { type: "string", enum: ["self_claim", "attested", "certified"] } },
            { name: "attestationIssuerAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "includeAttestationMetadata", in: "query", required: false, schema: { type: "boolean" } },
            { name: "minTrustScore", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 100 } },
            { name: "riskTier", in: "query", required: false, schema: { type: "string", enum: ["low", "guarded", "elevated", "high"] } },
            { name: "includeReputation", in: "query", required: false, schema: { type: "boolean" } },
            { name: "reputationVersion", in: "query", required: false, schema: { type: "string", enum: ["v1", "v2"] } },
            { name: "reputationWindow", in: "query", required: false, schema: { type: "string", enum: ["7d", "30d", "allTime"] } },
            { name: "scoreStrategy", in: "query", required: false, schema: { type: "string", enum: ["balanced", "recent_bias", "trust_weighted"] } },
            { name: "requesterAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "includeRoutingFactors", in: "query", required: false, schema: { type: "boolean" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: buildAgentCardDiscoveryResultV1()
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agent-cards/{agentId}": {
        get: {
          summary: "Get an agent discovery card",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      agentCard: AgentCardV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/capability-attestations": {
        get: {
          summary: "List capability attestation records",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "attestationId", in: "query", required: false, schema: { type: "string" } },
            { name: "subjectAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "issuerAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "capability", in: "query", required: false, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["valid", "expired", "not_active", "revoked", "all"] } },
            { name: "at", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "includeInvalid", in: "query", required: false, schema: { type: "boolean" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      attestations: {
                        type: "array",
                        items: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            capabilityAttestation: CapabilityAttestationV1,
                            runtime: CapabilityAttestationRuntime
                          }
                        }
                      },
                      limit: { type: "integer" },
                      offset: { type: "integer" },
                      total: { type: "integer" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Create a capability attestation record",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: CapabilityAttestationCreateRequest } } },
          responses: {
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      capabilityAttestation: CapabilityAttestationV1,
                      runtime: CapabilityAttestationRuntime
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/capability-attestations/{attestationId}": {
        get: {
          summary: "Get capability attestation by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "attestationId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      capabilityAttestation: CapabilityAttestationV1,
                      runtime: CapabilityAttestationRuntime
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/capability-attestations/{attestationId}/revoke": {
        post: {
          summary: "Revoke a capability attestation record",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "attestationId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    revokedAt: { type: "string", format: "date-time" },
                    reasonCode: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "Revoked",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      capabilityAttestation: CapabilityAttestationV1,
                      runtime: CapabilityAttestationRuntime
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/sessions": {
        get: {
          summary: "List Session.v1 records",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "sessionId", in: "query", required: false, schema: { type: "string" } },
            { name: "participantAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "visibility", in: "query", required: false, schema: { type: "string", enum: ["public", "tenant", "private"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      sessions: { type: "array", items: SessionV1 },
                      limit: { type: "integer" },
                      offset: { type: "integer" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Create Session.v1 record",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["sessionId", "participants"],
                  properties: {
                    sessionId: { type: "string" },
                    visibility: { type: "string", enum: ["public", "tenant", "private"] },
                    participants: { type: "array", items: { type: "string" } },
                    policyRef: { type: "string", nullable: true },
                    metadata: { type: "object", nullable: true, additionalProperties: true },
                    createdAt: { type: "string", format: "date-time", nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      session: SessionV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/sessions/{sessionId}": {
        get: {
          summary: "Get Session.v1 by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      session: SessionV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/sessions/{sessionId}/events": {
        get: {
          summary: "List SessionEvent.v1 envelope records",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
            {
              name: "eventType",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: [
                  "MESSAGE",
                  "TASK_REQUESTED",
                  "QUOTE_ISSUED",
                  "TASK_ACCEPTED",
                  "TASK_PROGRESS",
                  "TASK_COMPLETED",
                  "SETTLEMENT_LOCKED",
                  "SETTLEMENT_RELEASED",
                  "SETTLEMENT_REFUNDED",
                  "POLICY_CHALLENGED",
                  "DISPUTE_OPENED"
                ]
              }
            },
            { name: "sinceEventId", in: "query", required: false, schema: { type: "string" } },
            { name: "checkpointConsumerId", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      sessionId: { type: "string" },
                      events: { type: "array", items: SessionEventEnvelopeV1 },
                      limit: { type: "integer" },
                      offset: { type: "integer" },
                      currentPrevChainHash: { type: "string" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Append SessionEvent.v1 envelope record",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            RequiredIdempotencyHeader,
            ExpectedPrevChainHashHeader,
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["eventType"],
                  properties: {
                    eventType: { type: "string" },
                    payload: { nullable: true },
                    provenance: { allOf: [SessionEventProvenanceV1], nullable: true },
                    traceId: { type: "string", nullable: true },
                    at: { type: "string", format: "date-time", nullable: true },
                    actor: { type: "object", nullable: true, additionalProperties: true }
                  }
                }
              }
            }
          },
          responses: {
            201: {
              description: "Appended",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      session: SessionV1,
                      event: SessionEventEnvelopeV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            428: { description: "Precondition Required", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/sessions/{sessionId}/events/checkpoint": {
        get: {
          summary: "Read SessionEvent inbox relay checkpoint for a session consumer",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
            { name: "checkpointConsumerId", in: "query", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      checkpoint: SessionEventInboxRelayCheckpointV1,
                      inbox: SessionEventInboxWatermarkV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Advance SessionEvent inbox relay checkpoint (ack)",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["checkpointConsumerId"],
                  properties: {
                    checkpointConsumerId: { type: "string" },
                    sinceEventId: { type: "string", nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      checkpoint: SessionEventInboxRelayCheckpointV1,
                      inbox: SessionEventInboxWatermarkV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/sessions/{sessionId}/events/checkpoint/requeue": {
        post: {
          summary: "Requeue SessionEvent inbox relay checkpoint to an earlier cursor",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["checkpointConsumerId"],
                  properties: {
                    checkpointConsumerId: { type: "string" },
                    sinceEventId: { type: "string", nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      checkpoint: SessionEventInboxRelayCheckpointV1,
                      inbox: SessionEventInboxWatermarkV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/sessions/{sessionId}/events/stream": {
        get: {
          summary: "Stream SessionEvent.v1 envelope records via SSE",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
            {
              name: "eventType",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: [
                  "MESSAGE",
                  "TASK_REQUESTED",
                  "QUOTE_ISSUED",
                  "TASK_ACCEPTED",
                  "TASK_PROGRESS",
                  "TASK_COMPLETED",
                  "SETTLEMENT_LOCKED",
                  "SETTLEMENT_RELEASED",
                  "SETTLEMENT_REFUNDED",
                  "POLICY_CHALLENGED",
                  "DISPUTE_OPENED"
                ]
              }
            },
            { name: "sinceEventId", in: "query", required: false, schema: { type: "string" } },
            { name: "checkpointConsumerId", in: "query", required: false, schema: { type: "string" } },
            {
              name: "Last-Event-ID",
              in: "header",
              required: false,
              schema: { type: "string" },
              description: "SSE cursor resume id."
            }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: { description: "text/event-stream response" },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/sessions/{sessionId}/replay-pack": {
        get: {
          summary: "Get SessionReplayPack.v1 export",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
            { name: "sign", in: "query", required: false, schema: { type: "boolean" } },
            { name: "signerKeyId", in: "query", required: false, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      replayPack: SessionReplayPackV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/sessions/{sessionId}/replay-export": {
        get: {
          summary: "Get deterministic replay export bundle with dependency metadata",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
            { name: "sign", in: "query", required: false, schema: { type: "boolean" } },
            { name: "signerKeyId", in: "query", required: false, schema: { type: "string" } },
            { name: "includeTranscript", in: "query", required: false, schema: { type: "boolean", default: true } },
            { name: "memoryScope", in: "query", required: false, schema: { type: "string", enum: ["personal", "team", "delegated"] } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      replayPack: SessionReplayPackV1,
                      transcript: { allOf: [SessionTranscriptV1], nullable: true },
                      memoryExport: SessionMemoryExportV1,
                      memoryExportRef: { type: "object", additionalProperties: true },
                      exportMetadata: SessionReplayExportMetadataV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/sessions/{sessionId}/transcript": {
        get: {
          summary: "Get SessionTranscript.v1 digest export",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
            { name: "sign", in: "query", required: false, schema: { type: "boolean" } },
            { name: "signerKeyId", in: "query", required: false, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      transcript: SessionTranscriptV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/sessions/replay-verify": {
        post: {
          summary: "Verify replay export bundle offline with deterministic verdict output",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true,
                  required: ["memoryExport", "replayPack"],
                  properties: {
                    memoryExport: SessionMemoryExportV1,
                    replayPack: SessionReplayPackV1,
                    transcript: { allOf: [SessionTranscriptV1], nullable: true },
                    memoryExportRef: { type: ["object", "null"], additionalProperties: true },
                    expectedTenantId: { type: ["string", "null"] },
                    expectedSessionId: { type: ["string", "null"] },
                    expectedPreviousHeadChainHash: { type: ["string", "null"] },
                    expectedPreviousPackHash: { type: ["string", "null"] },
                    replayPackPublicKeyPem: { type: ["string", "null"] },
                    transcriptPublicKeyPem: { type: ["string", "null"] },
                    requireReplayPackSignature: { type: "boolean", default: false },
                    requireTranscriptSignature: { type: "boolean", default: false },
                    expectedPolicyDecisionHash: { type: ["string", "null"] },
                    settlement: { type: ["object", "null"], additionalProperties: true },
                    expectedSettlement: { type: ["object", "null"], additionalProperties: true }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "schemaVersion", "verdict"],
                    properties: {
                      ok: { type: "boolean" },
                      schemaVersion: { type: "string", enum: ["SessionReplayVerificationVerdict.v1"] },
                      verdict: SessionReplayVerificationVerdictV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/intents": {
        get: {
          summary: "List IntentContract.v1 records",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "intentId", in: "query", required: false, schema: { type: "string" } },
            { name: "proposerAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "counterpartyAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["proposed", "countered", "accepted"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      intents: { type: "array", items: IntentContractV1 },
                      limit: { type: "integer" },
                      offset: { type: "integer" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/intents/propose": {
        post: {
          summary: "Propose a new IntentContract.v1",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: IntentContractProposeRequest } } },
          responses: {
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      intentContract: IntentContractV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/intents/{intentId}": {
        get: {
          summary: "Get IntentContract.v1 by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "intentId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      intentContract: IntentContractV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/intents/{intentId}/counter": {
        post: {
          summary: "Create a counter IntentContract.v1 from an existing intent",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "intentId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: IntentContractCounterRequest } } },
          responses: {
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      intentContract: IntentContractV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/intents/{intentId}/accept": {
        post: {
          summary: "Accept an IntentContract.v1",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "intentId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: IntentContractAcceptRequest } } },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      intentContract: IntentContractV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/work-orders": {
        get: {
          summary: "List SubAgentWorkOrder.v1 records",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "workOrderId", in: "query", required: false, schema: { type: "string" } },
            { name: "principalAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "subAgentId", in: "query", required: false, schema: { type: "string" } },
            {
              name: "status",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: ["created", "accepted", "working", "completed", "failed", "settled", "cancelled", "disputed"]
              }
            },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      workOrders: { type: "array", items: SubAgentWorkOrderV1 },
                      limit: { type: "integer" },
                      offset: { type: "integer" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Create a SubAgentWorkOrder.v1 record",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: SubAgentWorkOrderCreateRequest } } },
          responses: {
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      workOrder: SubAgentWorkOrderV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/work-orders/{workOrderId}": {
        get: {
          summary: "Get a SubAgentWorkOrder.v1 record",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "workOrderId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      workOrder: SubAgentWorkOrderV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/work-orders/{workOrderId}/accept": {
        post: {
          summary: "Accept a SubAgentWorkOrder.v1",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "workOrderId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: false, content: { "application/json": { schema: SubAgentWorkOrderAcceptRequest } } },
          responses: {
            200: {
              description: "Accepted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      workOrder: SubAgentWorkOrderV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/work-orders/{workOrderId}/progress": {
        post: {
          summary: "Append progress event to SubAgentWorkOrder.v1",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "workOrderId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: false, content: { "application/json": { schema: SubAgentWorkOrderProgressRequest } } },
          responses: {
            200: {
              description: "Updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      workOrder: SubAgentWorkOrderV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/work-orders/{workOrderId}/topup": {
        post: {
          summary: "Append a metering top-up event for SubAgentWorkOrder.v1",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "workOrderId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: SubAgentWorkOrderTopUpRequest } } },
          responses: {
            200: {
              description: "Existing event reused",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      appended: { type: "boolean" },
                      event: { type: "object", additionalProperties: true },
                      metering: { type: "object", additionalProperties: true }
                    }
                  }
                }
              }
            },
            201: {
              description: "Top-up event appended",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      appended: { type: "boolean" },
                      event: { type: "object", additionalProperties: true },
                      metering: { type: "object", additionalProperties: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/work-orders/{workOrderId}/metering": {
        get: {
          summary: "Get WorkOrderMeteringSnapshot.v1 with Meter.v1 events",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "workOrderId", in: "path", required: true, schema: { type: "string" } },
            { name: "includeMeters", in: "query", required: false, schema: { type: "boolean" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      workOrderId: { type: "string" },
                      metering: WorkOrderMeteringSnapshotV1,
                      totalMeters: { type: "integer", minimum: 0 },
                      count: { type: "integer", minimum: 0 },
                      limit: { type: "integer", minimum: 1 },
                      offset: { type: "integer", minimum: 0 }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/work-orders/{workOrderId}/complete": {
        post: {
          summary: "Complete SubAgentWorkOrder.v1 and attach SubAgentCompletionReceipt.v1",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "workOrderId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: false, content: { "application/json": { schema: SubAgentWorkOrderCompleteRequest } } },
          responses: {
            200: {
              description: "Completed",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      workOrder: SubAgentWorkOrderV1,
                      completionReceipt: SubAgentCompletionReceiptV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/work-orders/{workOrderId}/settle": {
        post: {
          summary: "Bind settled x402 evidence to SubAgentWorkOrder.v1",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "workOrderId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: SubAgentWorkOrderSettleRequest } } },
          responses: {
            200: {
              description: "Settled",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      workOrder: SubAgentWorkOrderV1,
                      completionReceipt: SubAgentCompletionReceiptV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/work-orders/receipts": {
        get: {
          summary: "List SubAgentCompletionReceipt.v1 records",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "receiptId", in: "query", required: false, schema: { type: "string" } },
            { name: "workOrderId", in: "query", required: false, schema: { type: "string" } },
            { name: "principalAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "subAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["success", "failed"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      receipts: { type: "array", items: SubAgentCompletionReceiptV1 },
                      limit: { type: "integer" },
                      offset: { type: "integer" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/work-orders/receipts/{receiptId}": {
        get: {
          summary: "Get SubAgentCompletionReceipt.v1 by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "receiptId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: { "application/json": { schema: WorkOrderReceiptDetailResponse } }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/execution-grants/{executionGrantId}": {
        get: {
          summary: "Get an execution-grant alias over approval continuation and work-order state",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "executionGrantId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" }, executionGrant: ExecutionGrantV1, authorityEnvelope: { ...AuthorityEnvelopeV1, nullable: true }, approvalRequest: { ...ApprovalRequestV1, nullable: true }, approvalDecision: { ...ApprovalDecisionV1, nullable: true }, approvalContinuation: { type: "object", additionalProperties: true, nullable: true }, workOrder: { ...SubAgentWorkOrderV1, nullable: true } } } } }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/execution-grants/{executionGrantId}/revoke": {
        post: {
          summary: "Revoke an approved execution grant before execution starts",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "executionGrantId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  nullable: true,
                  additionalProperties: false,
                  properties: {
                    reasonCode: { type: "string", nullable: true },
                    revocationReasonCode: { type: "string", nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      approvalRequest: { ...ApprovalRequestV1, nullable: true },
                      approvalStatus: { type: "string", enum: ["pending", "approved", "denied", "expired", "revoked"] },
                      approvalDecision: { ...ApprovalDecisionV1, nullable: true },
                      approvalContinuation: { type: "object", additionalProperties: true, nullable: true },
                      actionIntent: { ...ActionIntentV1, nullable: true },
                      executionGrant: ExecutionGrantV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/execution-grants/{executionGrantId}/evidence": {
        post: {
          summary: "Append execution evidence once a public execution grant is materialized to a work order",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "executionGrantId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    workOrderId: { type: "string", nullable: true },
                    progressId: { type: "string", nullable: true },
                    eventType: { type: "string", nullable: true },
                    message: { type: "string", nullable: true },
                    percentComplete: { type: "integer", minimum: 0, maximum: 100, nullable: true },
                    evidenceRef: { type: "string", nullable: true },
                    evidenceRefs: { type: "array", items: { type: "string" } },
                    at: { type: "string", format: "date-time", nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      executionGrant: ExecutionGrantV1,
                      evidenceBundle: EvidenceBundleV1,
                      workOrder: SubAgentWorkOrderV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/execution-grants/{executionGrantId}/finalize": {
        post: {
          summary: "Complete and optionally settle a materialized execution grant",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "executionGrantId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    workOrderId: { type: "string", nullable: true },
                    completion: {
                      type: "object",
                      nullable: true,
                      additionalProperties: false,
                      properties: {
                        receiptId: { type: "string", nullable: true },
                        status: { type: "string", enum: ["success", "failed"], nullable: true },
                        outputs: { type: "object", additionalProperties: true, nullable: true },
                        metrics: { type: "object", additionalProperties: true, nullable: true },
                        evidenceRefs: { type: "array", items: { type: "string" } },
                        executionAttestation: { ...ExecutionAttestationV1, nullable: true },
                        amountCents: { type: "integer", minimum: 0, nullable: true },
                        currency: { type: "string", nullable: true },
                        intentHash: { type: "string", pattern: "^[0-9a-f]{64}$", nullable: true },
                        traceId: { type: "string", nullable: true },
                        deliveredAt: { type: "string", format: "date-time", nullable: true },
                        completedAt: { type: "string", format: "date-time", nullable: true },
                        metadata: { type: "object", additionalProperties: true, nullable: true }
                      }
                    },
                    settlement: {
                      type: "object",
                      nullable: true,
                      additionalProperties: false,
                      properties: {
                        status: { type: "string", enum: ["released", "refunded"], nullable: true },
                        traceId: { type: "string", nullable: true },
                        x402GateId: { type: "string" },
                        x402RunId: { type: "string" },
                        x402SettlementStatus: { type: "string" },
                        x402ReceiptId: { type: "string", nullable: true },
                        authorityGrantRef: { type: "string", nullable: true },
                        settledAt: { type: "string", format: "date-time", nullable: true }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" }, executionGrant: ExecutionGrantV1, workOrder: SubAgentWorkOrderV1, completionReceipt: SubAgentCompletionReceiptV1, actionReceipt: ActionReceiptV1 } } } }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/receipts/{receiptId}": {
        get: {
          summary: "Get a public ActionReceipt.v1 alias by receipt id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "receiptId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" }, actionReceipt: ActionReceiptV1, completionReceipt: SubAgentCompletionReceiptV1, detail: WorkOrderReceiptDetailV1 } } } }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agents": {
        get: {
          summary: "List registered agent identities",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["active", "suspended", "revoked"] } },
            { name: "capability", in: "query", required: false, schema: { type: "string" } },
            { name: "minTrustScore", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 100 } },
            { name: "includeReputation", in: "query", required: false, schema: { type: "boolean" } },
            { name: "reputationVersion", in: "query", required: false, schema: { type: "string", enum: ["v1", "v2"] } },
            { name: "reputationWindow", in: "query", required: false, schema: { type: "string", enum: ["7d", "30d", "allTime"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      agents: { type: "array", items: AgentIdentityV1 },
                      reputations: {
                        type: "object",
                        additionalProperties: AgentReputationAny
                      },
                      limit: { type: "integer" },
                      offset: { type: "integer" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agents/register": {
        post: {
          summary: "Register an autonomous agent identity",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: AgentRegisterRequest } } },
          responses: {
            201: {
              description: "Registered",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      agentIdentity: AgentIdentityV1,
                      keyId: { type: "string" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agents/{agentId}": {
        get: {
          summary: "Get a registered agent identity",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      agentIdentity: AgentIdentityV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agents/{agentId}/passport": {
        get: {
          summary: "Get an issued agent passport",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      agentPassport: AgentPassportV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Issue or rotate an agent passport",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader, { name: "agentId", in: "path", required: true, schema: { type: "string" } }],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: AgentPassportUpsertRequest } } },
          responses: {
            200: {
              description: "Updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      agentPassport: AgentPassportV1
                    }
                  }
                }
              }
            },
            201: {
              description: "Issued",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      agentPassport: AgentPassportV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agents/{agentId}/passport/revoke": {
        post: {
          summary: "Revoke an issued agent passport",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader, { name: "agentId", in: "path", required: true, schema: { type: "string" } }],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: false, content: { "application/json": { schema: AgentPassportRevokeRequest } } },
          responses: {
            200: {
              description: "Revoked",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      agentPassport: AgentPassportV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agents/{agentId}/reputation": {
        get: {
          summary: "Get computed reputation for an agent",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "path", required: true, schema: { type: "string" } },
            { name: "reputationVersion", in: "query", required: false, schema: { type: "string", enum: ["v1", "v2"] } },
            { name: "reputationWindow", in: "query", required: false, schema: { type: "string", enum: ["7d", "30d", "allTime"] } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      reputation: AgentReputationAny
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agents/{agentId}/interaction-graph-pack": {
        get: {
          summary: "Export deterministic interaction graph pack for an agent",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "path", required: true, schema: { type: "string" } },
            { name: "reputationVersion", in: "query", required: false, schema: { type: "string", enum: ["v1", "v2"] } },
            { name: "reputationWindow", in: "query", required: false, schema: { type: "string", enum: ["7d", "30d", "allTime"] } },
            { name: "asOf", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "counterpartyAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "visibility", in: "query", required: false, schema: { type: "string", enum: ["all", "private", "public_summary"] } },
            { name: "sign", in: "query", required: false, schema: { type: "boolean" } },
            { name: "signerKeyId", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      graphPack: VerifiedInteractionGraphPackV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/public/agents/{agentId}/reputation-summary": {
        get: {
          summary: "Get public coarse reputation summary for an opted-in public agent",
          parameters: [
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "path", required: true, schema: { type: "string" } },
            { name: "reputationVersion", in: "query", required: false, schema: { type: "string", enum: ["v1", "v2"] } },
            { name: "reputationWindow", in: "query", required: false, schema: { type: "string", enum: ["7d", "30d", "allTime"] } },
            { name: "asOf", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "includeRelationships", in: "query", required: false, schema: { type: "boolean" } },
            { name: "relationshipLimit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } }
          ],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      summary: PublicAgentReputationSummaryV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/relationships": {
        get: {
          summary: "List pairwise relationship edges for an agent (tenant-scoped)",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "query", required: true, schema: { type: "string" } },
            { name: "counterpartyAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "reputationWindow", in: "query", required: false, schema: { type: "string", enum: ["7d", "30d", "allTime"] } },
            { name: "asOf", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "visibility", in: "query", required: false, schema: { type: "string", enum: ["all", "private", "public_summary"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      agentId: { type: "string" },
                      reputationWindow: { type: "string", enum: ["7d", "30d", "allTime"] },
                      asOf: { type: "string", format: "date-time" },
                      total: { type: "integer" },
                      limit: { type: "integer" },
                      offset: { type: "integer" },
                      relationships: { type: "array", items: RelationshipEdgeV1 }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agents/{agentId}/wallet": {
        get: {
          summary: "Get an agent wallet snapshot",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      wallet: AgentWalletV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agents/{agentId}/wallet/credit": {
        post: {
          summary: "Credit an agent wallet",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader, { name: "agentId", in: "path", required: true, schema: { type: "string" } }],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: AgentWalletCreditRequest } } },
          responses: {
            201: {
              description: "Credited",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      wallet: AgentWalletV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agents/{agentId}/runs": {
        get: {
          summary: "List runs for an agent",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "path", required: true, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["created", "running", "completed", "failed"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      runs: { type: "array", items: AgentRunV1 },
                      total: { type: "integer" },
                      limit: { type: "integer" },
                      offset: { type: "integer" }
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Create a run for an agent",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader, { name: "agentId", in: "path", required: true, schema: { type: "string" } }],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: false, content: { "application/json": { schema: AgentRunCreateRequest } } },
          responses: {
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      run: AgentRunV1,
                      event: AgentEventV1,
                      settlement: { ...AgentRunSettlementV1, nullable: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agents/{agentId}/runs/{runId}": {
        get: {
          summary: "Get run snapshot and verification summary",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "path", required: true, schema: { type: "string" } },
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      run: AgentRunV1,
                      verification: { type: "object", additionalProperties: true },
                      settlement: { ...AgentRunSettlementV1, nullable: true }
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/agents/{agentId}/runs/{runId}/events": {
        get: {
          summary: "List events for an agent run",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "path", required: true, schema: { type: "string" } },
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      events: { type: "array", items: AgentEventV1 }
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Append an event to an agent run",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            ExpectedPrevChainHashHeader,
            { name: "agentId", in: "path", required: true, schema: { type: "string" } },
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: AgentRunEventAppendRequest } } },
          responses: {
            201: {
              description: "Appended",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      event: AgentEventV1,
                      run: AgentRunV1,
                      settlement: { ...AgentRunSettlementV1, nullable: true },
                      decisionRecord: { ...SettlementDecisionRecordAny, nullable: true },
                      settlementReceipt: { ...SettlementReceiptV1, nullable: true },
                      kernelVerification: { ...SettlementKernelVerification, nullable: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/runs/{runId}": {
        get: {
          summary: "Get canonical run detail for execution, settlement, and dispute state",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: RunDetailResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/runs/{runId}/action-required/respond": {
        post: {
          summary: "Submit the missing user input for an action-required run and resume it",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: RunActionRequiredRespondRequest } } },
          responses: {
            201: { description: "Responded", content: { "application/json": { schema: RunActionRequiredRespondResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/runs/{runId}/managed-execution/handoff": {
        post: {
          summary: "Hand off a non-terminal run to a certified managed provider",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["targetProfileId"],
                  properties: {
                    targetProfileId: { type: "string" },
                    targetProviderId: { type: "string", nullable: true },
                    targetProviderRef: { type: "string", nullable: true },
                    targetToolId: { type: "string", nullable: true },
                    note: { type: "string", nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: "Handoff executed", content: { "application/json": { schema: RunManagedExecutionHandoffResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/runs/{runId}/verification": {
        get: {
          summary: "Get verification summary for a run",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/disputes": {
        get: {
          summary: "List tenant dispute inbox items",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "runId", in: "query", required: false, schema: { type: "string" } },
            { name: "disputeId", in: "query", required: false, schema: { type: "string" } },
            { name: "disputeStatus", in: "query", required: false, schema: { type: "string", enum: ["open", "closed", "all"] } },
            { name: "settlementStatus", in: "query", required: false, schema: { type: "string", enum: ["locked", "released", "refunded"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200, default: 200 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: DisputeInboxResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/disputes/{disputeId}": {
        get: {
          summary: "Get a tenant dispute detail packet",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "disputeId", in: "path", required: true, schema: { type: "string" } },
            { name: "caseId", in: "query", required: false, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: DisputeDetailResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/disputes": {
        post: {
          summary: "Resolve a public dispute-case alias from existing dispute context",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    runId: { type: "string", nullable: true },
                    disputeId: { type: "string", nullable: true },
                    caseId: { type: "string", nullable: true },
                    reason: { type: "string", nullable: true },
                    evidenceRefs: { type: "array", items: { type: "string" } },
                    disputeType: { type: "string", nullable: true },
                    priority: { type: "string", nullable: true },
                    channel: { type: "string", nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" }, disputeCase: DisputeCaseV1, detail: { type: "object", additionalProperties: true } } } } }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/disputes/{disputeId}": {
        get: {
          summary: "Get a public DisputeCase.v1 alias by dispute id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "disputeId", in: "path", required: true, schema: { type: "string" } },
            { name: "caseId", in: "query", required: false, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      disputeCase: DisputeCaseV1,
                      detail: { type: "object", additionalProperties: true }
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/integrations/install": {
        post: {
          summary: "Resolve installation metadata for a supported integration runtime",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: ActionWalletTrustedHostInstallRequest
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      integration: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          runtime: { type: "string", enum: ["claude-desktop", "openclaw"], nullable: true },
                          transport: { type: "string", enum: ["mcp"], nullable: true },
                          installCommand: { type: "string", nullable: true },
                          docsPath: { type: "string", nullable: true },
                          approvalMode: { type: "string", nullable: true },
                          receipts: { type: "boolean", nullable: true },
                          disputes: { type: "boolean", nullable: true }
                        }
                      },
                      trustedHost: ActionWalletTrustedHostV1,
                      hostCredential: {
                        type: "object",
                        nullable: true,
                        additionalProperties: false,
                        properties: {
                          kind: { type: "string", enum: ["api_key"] },
                          keyId: { type: "string" },
                          secret: { type: "string" },
                          token: { type: "string" },
                          scopes: { type: "array", items: { type: "string" } },
                          issuedAt: { type: "string", format: "date-time" },
                          rotatedFromKeyId: { type: "string", nullable: true }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/v1/integrations/{hostId}/revoke": {
        post: {
          summary: "Revoke a trusted host installation and its scoped host credential",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "hostId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  nullable: true,
                  additionalProperties: false,
                  properties: {
                    reasonCode: { type: "string", nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      trustedHost: ActionWalletTrustedHostV1
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/runs/{runId}/settlement": {
        get: {
          summary: "Get run settlement details",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      settlement: AgentRunSettlementV1,
                      decisionRecord: { ...SettlementDecisionRecordAny, nullable: true },
                      settlementReceipt: { ...SettlementReceiptV1, nullable: true },
                      kernelVerification: SettlementKernelVerification
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/runs/{runId}/agreement": {
        get: {
          summary: "Get run marketplace agreement details",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      runId: { type: "string" },
                      rfqId: { type: "string", nullable: true },
                      agreementId: { type: "string", nullable: true },
                      agreement: MarketplaceTaskAgreementV2,
                      offer: { allOf: [MarketplaceOfferV2], nullable: true },
                      offerAcceptance: { allOf: [MarketplaceAcceptanceV2], nullable: true },
                      policyRef: { allOf: [MarketplaceSettlementPolicyRefV1], nullable: true },
                      policyHash: { type: "string", nullable: true },
                      verificationMethodHash: { type: "string", nullable: true },
                      policyBindingVerification: { type: "object", additionalProperties: true },
                      acceptanceSignatureVerification: { type: "object", additionalProperties: true },
                      settlement: { ...AgentRunSettlementV1, nullable: true },
                      decisionRecord: { ...SettlementDecisionRecordAny, nullable: true },
                      settlementReceipt: { ...SettlementReceiptV1, nullable: true },
                      kernelVerification: { ...SettlementKernelVerification, nullable: true }
                    }
                  }
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/runs/{runId}/agreement/change-order": {
        post: {
          summary: "Apply a change order to a locked marketplace agreement",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: RunAgreementChangeOrderRequest } } },
          responses: {
            200: {
              description: "Change order applied",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      runId: { type: "string" },
                      rfq: MarketplaceRfqV1,
                      agreement: MarketplaceTaskAgreementV2,
                      changeOrder: { type: "object", additionalProperties: true },
                      acceptanceSignatureVerification: { type: "object", additionalProperties: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/runs/{runId}/agreement/cancel": {
        post: {
          summary: "Cancel a locked marketplace agreement before run start",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: RunAgreementCancelRequest } } },
          responses: {
            200: {
              description: "Agreement cancelled",
              content: {
                "application/json": {
                  schema: RunAgreementCancelResponse
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/runs/{runId}/settlement/policy-replay": {
        get: {
          summary: "Replay settlement policy decision for a run",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: RunSettlementPolicyReplayResponse
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/runs/{runId}/settlement/replay-evaluate": {
        get: {
          summary: "Replay settlement evaluation and compare against stored decision trace",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: RunSettlementReplayEvaluateResponse
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/runs/{runId}/settlement/explainability": {
        get: {
          summary: "Build deterministic settlement explainability timeline and support summary export",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: RunSettlementExplainabilityResponse
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": ["RUN_SETTLEMENT_EXPLAINABILITY_LINEAGE_INVALID", "POLICY_REPLAY_FAILED"],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(["RUN_SETTLEMENT_EXPLAINABILITY_LINEAGE_INVALID", "POLICY_REPLAY_FAILED"])
                }
              }
            }
          }
        }
      },
      "/runs/{runId}/settlement/resolve": {
        post: {
          summary: "Manually resolve a locked run settlement",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "runId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: RunSettlementResolveRequest } } },
          responses: {
            200: {
              description: "Resolved",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      settlement: AgentRunSettlementV1
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...RunSettlementResolveConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(RunSettlementResolveConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/artifacts/{artifactId}/status": {
        get: {
          summary: "Get artifact verification status",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "artifactId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read", "audit_read", "finance_read"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/jobs/{jobId}/quote": {
        post: {
          summary: "Quote job (optimistic concurrency)",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            ExpectedPrevChainHashHeader,
            { name: "jobId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: JobQuoteRequest } } },
          responses: {
            201: { description: "Quoted", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/jobs/{jobId}/book": {
        post: {
          summary: "Book job (optimistic concurrency)",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            ExpectedPrevChainHashHeader,
            { name: "jobId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: JobBookRequest } } },
          responses: {
            201: { description: "Booked", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/jobs/{jobId}/events": {
        post: {
          summary: "Append job event",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, { name: "jobId", in: "path", required: true, schema: { type: "string" } }],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: JobEventAppendRequest } } },
          responses: {
            201: { description: "Appended", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Rejected", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/tool-calls/arbitration/cases": {
        get: {
          summary: "List tool-call arbitration cases for an agreement hash",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agreementHash", in: "query", required: true, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["open", "under_review", "verdict_issued", "closed"] } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      agreementHash: { type: "string" },
                      runId: { type: "string" },
                      cases: { type: "array", items: ArbitrationCaseV1 }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/tool-calls/arbitration/cases/{caseId}": {
        get: {
          summary: "Get tool-call arbitration case by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "caseId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: {
              description: "OK",
              content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { caseId: { type: "string" }, arbitrationCase: ArbitrationCaseV1 } } } }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/tool-calls/arbitration/open": {
        post: {
          summary: "Open a tool-call arbitration case (holdback dispute)",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["agreementHash", "receiptHash", "holdHash", "summary"],
                  properties: {
                    agreementHash: { type: "string" },
                    receiptHash: { type: "string" },
                    holdHash: { type: "string" },
                    caseId: { type: "string" },
                    openedByAgentId: { type: "string" },
                    arbiterAgentId: { type: "string" },
                    panelCandidateAgentIds: { type: "array", items: { type: "string" } },
                    summary: { type: "string" },
                    evidenceRefs: { type: "array", items: { type: "string" } },
                    disputeOpenEnvelope: DisputeOpenEnvelopeSignedRequest,
                    adminOverride: { type: "object", additionalProperties: true }
                  }
                }
              }
            }
          },
          responses: {
            201: {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      arbitrationCase: ArbitrationCaseV1,
                      arbitrationCaseArtifact: {
                        type: "object",
                        nullable: true,
                        additionalProperties: false,
                        properties: {
                          artifactId: { type: "string" },
                          artifactHash: { type: "string", nullable: true }
                        }
                      },
                      disputeOpenEnvelopeArtifact: {
                        type: "object",
                        nullable: true,
                        additionalProperties: false,
                        properties: {
                          artifactId: { type: "string" },
                          artifactHash: { type: "string", nullable: true }
                        }
                      },
                      alreadyExisted: { type: "boolean" }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...ToolCallArbitrationOpenConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(ToolCallArbitrationOpenConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/tool-calls/arbitration/verdict": {
        post: {
          summary: "Submit signed arbitration verdict for a tool-call case (binary release/refund)",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["caseId", "arbitrationVerdict"],
                  properties: {
                    caseId: { type: "string" },
                    arbitrationVerdict: ArbitrationVerdictSignedRequest
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      arbitrationCase: ArbitrationCaseV1,
                      arbitrationVerdict: { type: "object", additionalProperties: true, nullable: true },
                      settlementAdjustment: { allOf: [SettlementAdjustmentV1], nullable: true }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...ToolCallArbitrationVerdictConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(ToolCallArbitrationVerdictConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/ops/status": {
        get: {
          summary: "Ops status summary",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } }
        }
      },
      "/artifacts/{artifactId}": {
        get: {
          summary: "Get artifact body",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, { name: "artifactId", in: "path", required: true, schema: { type: "string" } }],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { artifact: { type: "object", additionalProperties: true } } } } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/tool-calls/holds/lock": {
        post: {
          summary: "Ops: lock a tool-call funding hold (holdback escrow)",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["agreementHash", "receiptHash", "payerAgentId", "payeeAgentId", "amountCents", "holdbackBps", "challengeWindowMs"],
                  properties: {
                    agreementHash: { type: "string" },
                    receiptHash: { type: "string" },
                    payerAgentId: { type: "string" },
                    payeeAgentId: { type: "string" },
                    amountCents: { type: "integer", minimum: 1 },
                    currency: { type: "string" },
                    holdbackBps: { type: "integer", minimum: 0, maximum: 10000 },
                    challengeWindowMs: { type: "integer", minimum: 0 },
                    createdAt: { type: "string", format: "date-time" }
                  }
                }
              }
            }
          },
          responses: {
            201: { description: "Created", content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { hold: FundingHoldV1 } } } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/tool-calls/holds": {
        get: {
          summary: "Ops: list tool-call funding holds",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agreementHash", in: "query", required: false, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      ok: { type: "boolean" },
                      tenantId: { type: "string" },
                      agreementHash: { type: "string", nullable: true },
                      status: { type: "string", nullable: true },
                      limit: { type: "integer" },
                      offset: { type: "integer" },
                      holds: { type: "array", items: FundingHoldV1 }
                    }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/tool-calls/replay-evaluate": {
        get: {
          summary: "Ops: replay tool-call holdback/dispute resolution by agreement hash",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agreementHash", in: "query", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: ToolCallReplayEvaluateResponse
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/reputation/facts": {
        get: {
          summary: "Ops: aggregate append-only reputation facts for an agent/tool window",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "agentId", in: "query", required: true, schema: { type: "string" } },
            { name: "toolId", in: "query", required: false, schema: { type: "string" } },
            { name: "window", in: "query", required: false, schema: { type: "string", enum: ["7d", "30d", "allTime"] } },
            { name: "asOf", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "includeEvents", in: "query", required: false, schema: { type: "string", enum: ["1"] } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: ReputationFactsResponse
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/tool-calls/holds/{holdHash}": {
        get: {
          summary: "Ops: get tool-call funding hold",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, { name: "holdHash", in: "path", required: true, schema: { type: "string" } }],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: { ok: { type: "boolean" }, tenantId: { type: "string" }, hold: FundingHoldV1 }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/maintenance/tool-call-holdback/run": {
        post: {
          summary: "Ops: run tool-call holdback maintenance tick",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    dryRun: { type: "boolean" },
                    limit: { type: "integer", minimum: 1, maximum: 5000 }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/jobs": {
        get: {
          summary: "List jobs (ops view) with verification summary",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "status", in: "query", required: false, schema: { type: "string" } },
            { name: "zoneId", in: "query", required: false, schema: { type: "string" } },
            { name: "environmentTier", in: "query", required: false, schema: { type: "string" } },
            { name: "templateId", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
            { name: "offset", in: "query", required: false, schema: { type: "integer" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read", "audit_read"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsJobsListResponse } } }
          }
        }
      },
      "/ops/delegation/chains": {
        get: {
          summary: "List delegation chains used in marketplace acceptance flows",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "runId", in: "query", required: false, schema: { type: "string" } },
            { name: "chainHash", in: "query", required: false, schema: { type: "string" } },
            { name: "delegationId", in: "query", required: false, schema: { type: "string" } },
            { name: "signerKeyId", in: "query", required: false, schema: { type: "string" } },
            { name: "signerAgentId", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: DelegationTraceListResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/delegation/chains/{chainHash}": {
        get: {
          summary: "Get delegation chain traces by chain hash",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "chainHash", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["chainHash", "traces", "total"],
                    properties: {
                      chainHash: { type: "string" },
                      traces: { type: "array", items: DelegationTraceV1 },
                      total: { type: "integer", minimum: 0 }
                    }
                  }
                }
              }
            },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/delegation/emergency-revoke": {
        post: {
          summary: "Emergency revoke delegated marketplace authority",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: { required: true, content: { "application/json": { schema: DelegationEmergencyRevokeRequest } } },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: DelegationEmergencyRevokeResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/emergency/pause": {
        post: {
          summary: "Emergency pause an agent for paid execution paths",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: { required: false, content: { "application/json": { schema: OpsEmergencyPauseRequest } } },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsEmergencyControlResponse } } },
            201: { description: "Created", content: { "application/json": { schema: OpsEmergencyControlResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/emergency/quarantine": {
        post: {
          summary: "Emergency quarantine an agent for paid execution paths",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: { required: false, content: { "application/json": { schema: OpsEmergencyQuarantineRequest } } },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsEmergencyControlResponse } } },
            201: { description: "Created", content: { "application/json": { schema: OpsEmergencyControlResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/emergency/revoke": {
        post: {
          summary: "Emergency revoke delegated authority for paid execution paths",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: { required: false, content: { "application/json": { schema: OpsEmergencyRevokeRequest } } },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsEmergencyControlResponse } } },
            201: { description: "Created", content: { "application/json": { schema: OpsEmergencyControlResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/emergency/kill-switch": {
        post: {
          summary: "Set emergency kill-switch state for high-risk execution",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: { required: false, content: { "application/json": { schema: OpsEmergencyKillSwitchRequest } } },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsEmergencyControlResponse } } },
            201: { description: "Created", content: { "application/json": { schema: OpsEmergencyControlResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/emergency/resume": {
        post: {
          summary: "Resume previously paused or quarantined emergency controls",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: { required: false, content: { "application/json": { schema: OpsEmergencyResumeRequest } } },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsEmergencyControlResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/routines": {
        get: {
          summary: "List autonomous routine policies and kill-switch state",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["active", "paused", "all"] } },
            { name: "killSwitchActive", in: "query", required: false, schema: { type: "string", enum: ["true", "false", "all"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read", "ops_write"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: AutonomousRoutinePolicyListResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Create or update an autonomous routine policy",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: { required: true, content: { "application/json": { schema: AutonomousRoutineUpsertRequest } } },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: AutonomousRoutinePolicyResponse } } },
            201: { description: "Created", content: { "application/json": { schema: AutonomousRoutinePolicyResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/routines/{routineId}": {
        get: {
          summary: "Get an autonomous routine policy by routineId",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "routineId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read", "ops_write"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: AutonomousRoutinePolicyResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/routines/{routineId}/kill-switch": {
        post: {
          summary: "Apply routine-level kill-switch or resume control",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "routineId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: { required: true, content: { "application/json": { schema: AutonomousRoutineControlRequest } } },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: AutonomousRoutineControlResponse } } },
            201: { description: "Created", content: { "application/json": { schema: AutonomousRoutineControlResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/routines/{routineId}/execute": {
        post: {
          summary: "Execute an autonomous routine under policy guardrails",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "routineId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: { required: true, content: { "application/json": { schema: AutonomousRoutineExecuteRequest } } },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: AutonomousRoutineExecutionResponse } } },
            201: { description: "Created", content: { "application/json": { schema: AutonomousRoutineExecutionResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: AutonomousRoutineExecutionResponse } } }
          }
        }
      },
      "/ops/routines/{routineId}/executions": {
        get: {
          summary: "List autonomous routine execution receipts",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "routineId", in: "path", required: true, schema: { type: "string" } },
            { name: "allowed", in: "query", required: false, schema: { type: "string", enum: ["true", "false", "all"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read", "ops_write"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: AutonomousRoutineExecutionListResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/routines/{routineId}/incidents": {
        get: {
          summary: "List autonomous routine control incidents",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "routineId", in: "path", required: true, schema: { type: "string" } },
            { name: "action", in: "query", required: false, schema: { type: "string", enum: ["kill-switch", "resume"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read", "ops_write"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: AutonomousRoutineIncidentListResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/network/command-center": {
        get: {
          summary: "Network command-center summary",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "transactionFeeBps", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 5000, default: 100 } },
            { name: "windowHours", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 8760, default: 24 } },
            { name: "disputeSlaHours", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 8760, default: 24 } },
            { name: "emitAlerts", in: "query", required: false, schema: { type: "boolean", default: false } },
            { name: "persistAlerts", in: "query", required: false, schema: { type: "boolean", default: false } },
            { name: "httpClientErrorRateThresholdPct", in: "query", required: false, schema: { type: "number", minimum: 0 } },
            { name: "httpServerErrorRateThresholdPct", in: "query", required: false, schema: { type: "number", minimum: 0 } },
            { name: "deliveryDlqThreshold", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
            { name: "disputeOverSlaThreshold", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
            { name: "determinismRejectThreshold", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
            { name: "kernelVerificationErrorThreshold", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsNetworkCommandCenterResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/network/rescue-queue": {
        get: {
          summary: "List operator rescue queue items across approvals, launches, and runs",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "sourceType", in: "query", required: false, schema: { type: "string", enum: ["all", "approval_continuation", "router_launch", "run"], default: "all" } },
            { name: "priority", in: "query", required: false, schema: { type: "string", enum: ["all", "normal", "high", "critical"], default: "all" } },
            { name: "staleRunMinutes", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 10080, default: 60 } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500, default: 50 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsRescueQueueResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Dependency unavailable", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/network/phase1-metrics": {
        get: {
          summary: "Read Phase 1 launch metrics across supported consumer task families",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "staleRunMinutes", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 10080, default: 60 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsPhase1MetricsResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            500: { description: "Failed to compute metrics", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/network/managed-specialists": {
        get: {
          summary: "Read managed specialist publication and certification readiness across the launch roster",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsManagedSpecialistsResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            500: { description: "Failed to compute managed specialist status", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/network/rescue-queue/{rescueId}/triage": {
        post: {
          summary: "Update operator triage state for a rescue item",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "rescueId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: { required: true, content: { "application/json": { schema: OpsRescueTriageRequest } } },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsRescueTriageResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Dependency unavailable", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/network/rescue-queue/{rescueId}/actions": {
        post: {
          summary: "Run an operator rescue action for a rescue item",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "rescueId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: { required: true, content: { "application/json": { schema: OpsRescueActionRequest } } },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsRescueActionResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Dependency unavailable", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/network/command-center/workspace": {
        get: {
          summary: "Network command-center reliability and safety workspace",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "transactionFeeBps", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 5000, default: 100 } },
            { name: "windowHours", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 8760, default: 24 } },
            { name: "disputeSlaHours", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 8760, default: 24 } },
            { name: "httpClientErrorRateThresholdPct", in: "query", required: false, schema: { type: "number", minimum: 0 } },
            { name: "httpServerErrorRateThresholdPct", in: "query", required: false, schema: { type: "number", minimum: 0 } },
            { name: "deliveryDlqThreshold", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
            { name: "disputeOverSlaThreshold", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
            { name: "determinismRejectThreshold", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
            { name: "kernelVerificationErrorThreshold", in: "query", required: false, schema: { type: "integer", minimum: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsNetworkCommandCenterWorkspaceResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Dependency unavailable", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/sla-templates": {
        get: {
          summary: "List built-in SLA policy templates",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "vertical", in: "query", required: false, schema: { type: "string", enum: ["delivery", "security"] } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/arbitration/queue": {
        get: {
          summary: "List arbitration case queue for operator workflows",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["open", "under_review", "verdict_issued", "closed"] } },
            { name: "openedSince", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "runId", in: "query", required: false, schema: { type: "string" } },
            { name: "caseId", in: "query", required: false, schema: { type: "string" } },
            { name: "priority", in: "query", required: false, schema: { type: "string", enum: ["low", "normal", "high", "critical"] } },
            { name: "assignedArbiter", in: "query", required: false, schema: { type: "boolean" } },
            { name: "slaHours", in: "query", required: false, schema: { type: "number", minimum: 1, maximum: 8760, default: 24 } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500, default: 50 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_read", "finance_write", "ops_read"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsArbitrationQueueResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/settlement-adjustments/{adjustmentId}": {
        get: {
          summary: "Ops: get settlement adjustment record",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, { name: "adjustmentId", in: "path", required: true, schema: { type: "string" } }],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: { ok: { type: "boolean" }, tenantId: { type: "string" }, adjustment: SettlementAdjustmentV1 }
                  }
                }
              }
            },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not Implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/arbitration/cases/{caseId}/workspace": {
        get: {
          summary: "Get arbitration case workspace packet",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "caseId", in: "path", required: true, schema: { type: "string" } },
            { name: "slaHours", in: "query", required: false, schema: { type: "number", minimum: 1, maximum: 8760, default: 24 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_read", "finance_write", "ops_read"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsArbitrationWorkspaceResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            501: { description: "Not implemented", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/tenants/{tenantId}/analytics": {
        get: {
          summary: "Get tenant analytics report (Magic Link)",
          parameters: [
            RequestIdHeader,
            { name: "tenantId", in: "path", required: true, schema: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,64}$" } },
            { name: "month", in: "query", required: false, schema: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}$", example: "2026-02" } },
            { name: "bucket", in: "query", required: false, schema: { type: "string", enum: ["day", "week", "month"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200 } }
          ],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: MagicLinkAnalyticsReportResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/federation/invoke": {
        post: {
          summary: "Submit a coordinator federation invoke envelope",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_write"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: FederationInvokeRequest
              }
            }
          },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: FederationInvokeResponse } } },
            202: { description: "Accepted", content: { "application/json": { schema: FederationInvokeResponse } } },
            400: {
              description: "Bad Request",
              "x-nooterra-known-error-codes": [...FederationInvokeBadRequestKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(FederationInvokeBadRequestKnownErrorCodes)
                }
              }
            },
            403: {
              description: "Forbidden",
              "x-nooterra-known-error-codes": [...FederationInvokeForbiddenKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(FederationInvokeForbiddenKnownErrorCodes)
                }
              }
            },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...FederationInvokeConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(FederationInvokeConflictKnownErrorCodes)
                }
              }
            },
            500: {
              description: "Internal Server Error",
              "x-nooterra-known-error-codes": [...FederationInvokeInternalServerErrorKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(FederationInvokeInternalServerErrorKnownErrorCodes)
                }
              }
            },
            502: {
              description: "Bad Gateway",
              "x-nooterra-known-error-codes": [...FederationInvokeBadGatewayKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(FederationInvokeBadGatewayKnownErrorCodes)
                }
              }
            },
            503: {
              description: "Service Unavailable",
              "x-nooterra-known-error-codes": [...FederationInvokeServiceUnavailableKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(FederationInvokeServiceUnavailableKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/v1/federation/result": {
        post: {
          summary: "Submit or fetch a coordinator federation result envelope",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read", "ops_write"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: FederationResultRequest
              }
            }
          },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: FederationResultResponse } } },
            400: {
              description: "Bad Request",
              "x-nooterra-known-error-codes": [...FederationResultBadRequestKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(FederationResultBadRequestKnownErrorCodes)
                }
              }
            },
            403: {
              description: "Forbidden",
              "x-nooterra-known-error-codes": [...FederationResultForbiddenKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(FederationResultForbiddenKnownErrorCodes)
                }
              }
            },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...FederationResultConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(FederationResultConflictKnownErrorCodes)
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            500: {
              description: "Internal Server Error",
              "x-nooterra-known-error-codes": [...FederationResultInternalServerErrorKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(FederationResultInternalServerErrorKnownErrorCodes)
                }
              }
            },
            502: {
              description: "Bad Gateway",
              "x-nooterra-known-error-codes": [...FederationResultBadGatewayKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(FederationResultBadGatewayKnownErrorCodes)
                }
              }
            },
            503: {
              description: "Service Unavailable",
              "x-nooterra-known-error-codes": [...FederationResultServiceUnavailableKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(FederationResultServiceUnavailableKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/v1/tenants/{tenantId}/trust-graph": {
        get: {
          summary: "Get tenant trust graph (Magic Link)",
          parameters: [
            RequestIdHeader,
            { name: "tenantId", in: "path", required: true, schema: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,64}$" } },
            { name: "month", in: "query", required: false, schema: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}$", example: "2026-02" } },
            { name: "minRuns", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100000 } },
            { name: "maxEdges", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000 } }
          ],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: MagicLinkTrustGraphResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/tenants/{tenantId}/trust-graph/snapshots": {
        get: {
          summary: "List tenant trust graph snapshots (Magic Link)",
          parameters: [
            RequestIdHeader,
            { name: "tenantId", in: "path", required: true, schema: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,64}$" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500 } }
          ],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: MagicLinkTrustGraphSnapshotListResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        post: {
          summary: "Create tenant trust graph snapshot (Magic Link)",
          parameters: [
            RequestIdHeader,
            { name: "tenantId", in: "path", required: true, schema: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,64}$" } }
          ],
          requestBody: { required: false, content: { "application/json": { schema: MagicLinkTrustGraphSnapshotCreateRequest } } },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: MagicLinkTrustGraphSnapshotCreateResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/v1/tenants/{tenantId}/trust-graph/diff": {
        get: {
          summary: "Get tenant trust graph diff between months (Magic Link)",
          parameters: [
            RequestIdHeader,
            { name: "tenantId", in: "path", required: true, schema: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,64}$" } },
            { name: "baseMonth", in: "query", required: false, schema: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}$", example: "2026-01" } },
            { name: "compareMonth", in: "query", required: false, schema: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}$", example: "2026-02" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500 } },
            { name: "minRuns", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100000 } },
            { name: "maxEdges", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000 } },
            { name: "includeUnchanged", in: "query", required: false, schema: { type: "boolean" } }
          ],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: MagicLinkTrustGraphDiffResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/month-close": {
        post: {
          summary: "Request month close",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_write"],
          requestBody: { required: true, content: { "application/json": { schema: MonthCloseRequest } } },
          responses: { 202: { description: "Accepted", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } }
        },
        get: {
          summary: "Get month close state",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_read"],
          responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } }
        }
      },
      "/ops/party-statements": {
        get: {
          summary: "List party statements",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "period", in: "query", required: true, schema: { type: "string", example: "2026-02" } },
            { name: "partyId", in: "query", required: false, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string", example: "CLOSED" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_read"],
          responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } }
        }
      },
      "/ops/party-statements/{partyId}/{period}": {
        get: {
          summary: "Get party statement",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "partyId", in: "path", required: true, schema: { type: "string" } },
            { name: "period", in: "path", required: true, schema: { type: "string", example: "2026-02" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_read"],
          responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } }
        }
      },
      "/ops/payouts/{partyId}/{period}/enqueue": {
        post: {
          summary: "Enqueue payout instruction for a closed period",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "partyId", in: "path", required: true, schema: { type: "string" } },
            { name: "period", in: "path", required: true, schema: { type: "string", example: "2026-02" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_write"],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    moneyRailProviderId: { type: "string" },
                    counterpartyRef: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            201: { description: "Created", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            404: { description: "Not found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/money-rails/{providerId}/operations/{operationId}": {
        get: {
          summary: "Get money rail operation status",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "providerId", in: "path", required: true, schema: { type: "string" } },
            { name: "operationId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_read"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            404: { description: "Not found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/money-rails/{providerId}/operations/{operationId}/submit": {
        post: {
          summary: "Submit a money rail payout operation to the configured provider",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "providerId", in: "path", required: true, schema: { type: "string" } },
            { name: "operationId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_write"],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    providerRef: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Bad request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            502: { description: "Upstream provider error", content: { "application/json": { schema: ErrorResponse } } },
            503: { description: "Provider circuit open", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/money-rails/{providerId}/events/ingest": {
        post: {
          summary: "Ingest provider event and deterministically map to operation state",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "providerId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_write"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["operationId"],
                  properties: {
                    operationId: { type: "string" },
                    eventType: { type: "string", enum: ["submitted", "confirmed", "failed", "cancelled", "reversed"] },
                    providerStatus: { type: "string" },
                    eventId: { type: "string" },
                    providerRef: { type: "string" },
                    reasonCode: { type: "string" },
                    at: { type: "string", format: "date-time" },
                    payload: { type: "object", additionalProperties: true, nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Bad request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/money-rails/{providerId}/operations/{operationId}/cancel": {
        post: {
          summary: "Cancel a money rail operation",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "providerId", in: "path", required: true, schema: { type: "string" } },
            { name: "operationId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_write"],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    reasonCode: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            404: { description: "Not found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/finance/money-rails/stripe-connect/accounts/sync": {
        post: {
          summary: "Sync Stripe Connect account KYB/capability state from Stripe",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "providerId", in: "query", required: false, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_write"],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    providerId: { type: "string" },
                    dryRun: { type: "boolean", default: false },
                    accountIds: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } },
            502: { description: "Upstream provider error", content: { "application/json": { schema: ErrorResponse } } },
            503: { description: "Provider circuit open", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/finance/account-map": {
        get: {
          summary: "Get finance account map",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["ops_read"],
          responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } }
        },
        put: {
          summary: "Upsert finance account map (audited)",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_write"],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } }
        }
      },
      "/ops/finance/gl-batch": {
        get: {
          summary: "Get latest GLBatch artifact for a period",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "period", in: "query", required: true, schema: { type: "string", example: "2026-02" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_write"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            404: { description: "Not found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/finance/gl-batch.csv": {
        get: {
          summary: "Render deterministic journal CSV for a period",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "period", in: "query", required: true, schema: { type: "string", example: "2026-02" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_write"],
          responses: {
            200: { description: "OK", content: { "text/csv": { schema: { type: "string" } } } },
            409: { description: "Not ready", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/finance/reconcile": {
        get: {
          summary: "Compute deterministic reconciliation report for a period",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "period", in: "query", required: true, schema: { type: "string", example: "2026-02" } },
            { name: "persist", in: "query", required: false, schema: { type: "boolean", default: false } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_read", "finance_write"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: OpsFinanceReconcileResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/finance/money-rails/reconcile": {
        get: {
          summary: "Reconcile payout instructions against money rail operations for a period",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "period", in: "query", required: true, schema: { type: "string", example: "2026-02" } },
            { name: "providerId", in: "query", required: false, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_read", "finance_write"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/finance/net-close": {
        get: {
          summary: "Compute deterministic escrow net-close snapshot for a period",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "period", in: "query", required: true, schema: { type: "string", example: "2026-02" } },
            { name: "persist", in: "query", required: false, schema: { type: "boolean", default: false } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_read", "finance_write"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/ops/finance/net-close/execute": {
        post: {
          summary: "Execute escrow net-close when deterministic preconditions pass",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          "x-nooterra-scopes": ["finance_write"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["period"],
                  properties: {
                    period: { type: "string", example: "2026-02" },
                    dryRun: { type: "boolean", default: false }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Preconditions failed", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/x402/wallet-assignment/resolve": {
        post: {
          summary: "Resolve deterministic x402 wallet assignment",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: X402WalletAssignmentResolveRequest
              }
            }
          },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: X402WalletAssignmentResolveResponse } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/x402/gate/authorize-payment": {
        post: {
          summary: "Authorize payment for an x402 gate",
          description:
            "Uses strict preconditions (including optional ExecutionIntent.v1 binding) before minting or reusing an authorization token.",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: X402GateAuthorizePaymentRequest
              }
            }
          },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: {
              description: "Bad Request",
              "x-nooterra-known-error-codes": [...X402AuthorizePaymentBadRequestKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402AuthorizePaymentBadRequestKnownErrorCodes)
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...X402AuthorizePaymentConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402AuthorizePaymentConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/x402/gate/verify": {
        post: {
          summary: "Verify x402 gated execution and settle escrow",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: X402GateVerifyRequest
              }
            }
          },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: {
              description: "Bad Request",
              "x-nooterra-known-error-codes": [...X402GateVerifyBadRequestKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402GateVerifyBadRequestKnownErrorCodes)
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...X402GateVerifyConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402GateVerifyConflictKnownErrorCodes)
                }
              }
            }
          }
        }
      },
      "/x402/gate/reversal": {
        post: {
          summary: "Apply or resolve x402 settlement reversal commands",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true }
              }
            }
          },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            202: { description: "Accepted", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: {
              description: "Bad Request",
              "x-nooterra-known-error-codes": [...X402GateReversalBadRequestKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402GateReversalBadRequestKnownErrorCodes)
                }
              }
            },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: {
              description: "Conflict",
              "x-nooterra-known-error-codes": [...X402GateReversalConflictKnownErrorCodes],
              content: {
                "application/json": {
                  schema: errorResponseWithKnownCodes(X402GateReversalConflictKnownErrorCodes)
                }
              }
            },
            503: { description: "Service Unavailable", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/x402/zk/verification-keys": {
        post: {
          summary: "Register an immutable x402 zk verification key",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["verificationKey"],
                  properties: {
                    verificationKey: X402ZkVerificationKeyV1
                  }
                }
              }
            }
          },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            201: { description: "Created", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        get: {
          summary: "List x402 zk verification keys",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "protocol", in: "query", required: false, schema: { type: "string", enum: ["groth16", "plonk", "stark"] } },
            { name: "providerRef", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000, default: 200 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 100000, default: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/x402/zk/verification-keys/{verificationKeyId}": {
        get: {
          summary: "Get x402 zk verification key by id",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "verificationKeyId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/x402/webhooks/endpoints": {
        post: {
          summary: "Register an x402 principal webhook endpoint (secret returned once)",
          parameters: [TenantHeader, ProtocolHeader, RequestIdHeader, IdempotencyHeader],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["url", "events"],
                  properties: {
                    url: { type: "string", format: "uri", example: "https://principal.example.com/webhooks/nooterra" },
                    events: {
                      type: "array",
                      minItems: 1,
                      items: {
                        type: "string",
                        enum: ["x402.escalation.created", "x402.escalation.approved", "x402.escalation.denied"]
                      }
                    },
                    description: { type: "string", maxLength: 300 },
                    status: { type: "string", enum: ["active", "disabled"], default: "active" }
                  }
                }
              }
            }
          },
          responses: {
            201: { description: "Created", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        get: {
          summary: "List x402 webhook endpoints",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["active", "disabled", "revoked"] } },
            {
              name: "event",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["x402.escalation.created", "x402.escalation.approved", "x402.escalation.denied"] }
            },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000, default: 200 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 100000, default: 0 } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/x402/webhooks/endpoints/{endpointId}": {
        get: {
          summary: "Get x402 webhook endpoint",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "endpointId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        },
        delete: {
          summary: "Revoke x402 webhook endpoint",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            IdempotencyHeader,
            { name: "endpointId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/x402/webhooks/endpoints/{endpointId}/rotate-secret": {
        post: {
          summary: "Rotate x402 webhook endpoint secret (returns new secret once)",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "endpointId", in: "path", required: true, schema: { type: "string" } }
          ],
          security: [{ BearerAuth: [] }, { ProxyApiKey: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    gracePeriodSeconds: { type: "integer", minimum: 1, maximum: 604800, default: 86400 }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
            400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
            404: { description: "Not Found", content: { "application/json": { schema: ErrorResponse } } },
            409: { description: "Conflict", content: { "application/json": { schema: ErrorResponse } } }
          }
        }
      },
      "/exports/ack": {
        post: {
          summary: "ACK a delivery (destination-signed)",
          parameters: [
            TenantHeader,
            ProtocolHeader,
            RequestIdHeader,
            { name: "x-proxy-destination-id", in: "header", required: true, schema: { type: "string" } },
            { name: "x-proxy-timestamp", in: "header", required: true, schema: { type: "string" } },
            { name: "x-proxy-signature", in: "header", required: true, schema: { type: "string" } }
          ],
          requestBody: { required: true, content: { "application/json": { schema: AckRequest } } },
          responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } }
        }
      }
    }
  };

  // Remove undefined `servers` if not provided (keeps JSON stable).
  if (!spec.servers) delete spec.servers;
  return spec;
}
