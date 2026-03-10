import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId = "agt_runs_demo" } = {}) {
  const { publicKeyPem } = createEd25519Keypair();
  const created = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `agent_register_${agentId}` },
    body: {
      agentId,
      displayName: "Runs Agent",
      owner: { ownerType: "service", ownerId: "svc_runs" },
      publicKeyPem
    }
  });
  assert.equal(created.statusCode, 201);
  return { agentId, keyId: created.json?.keyId };
}

test("API e2e: agent runs lifecycle and verification", async () => {
  const api = createApi();
  const { agentId } = await registerAgent(api, { agentId: "agt_runs_lifecycle" });

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs`,
    headers: { "x-idempotency-key": "run_create_1" },
    body: {
      runId: "run_demo_1",
      taskType: "translation",
      inputRef: "urn:input:doc_1"
    }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json?.run?.status, "created");
  assert.equal(created.json?.event?.schemaVersion, "AgentEvent.v1");
  let prev = created.json?.run?.lastChainHash;
  assert.ok(prev);

  const started = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_demo_1/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": "run_event_started_1"
    },
    body: {
      type: "RUN_STARTED",
      payload: { startedBy: "scheduler" }
    }
  });
  assert.equal(started.statusCode, 201);
  assert.equal(started.json?.run?.status, "running");
  assert.equal(started.json?.event?.schemaVersion, "AgentEvent.v1");
  prev = started.json?.run?.lastChainHash;
  assert.ok(prev);

  const evidenceAdded = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_demo_1/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": "run_event_evidence_1"
    },
    body: {
      type: "EVIDENCE_ADDED",
      payload: { evidenceRef: "evidence://run_demo_1/output.json" }
    }
  });
  assert.equal(evidenceAdded.statusCode, 201);
  assert.equal(evidenceAdded.json?.run?.status, "running");
  assert.equal(evidenceAdded.json?.event?.schemaVersion, "AgentEvent.v1");
  assert.equal(evidenceAdded.json?.run?.evidenceRefs?.length, 1);
  prev = evidenceAdded.json?.run?.lastChainHash;
  assert.ok(prev);

  const completed = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_demo_1/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": "run_event_completed_1"
    },
    body: {
      type: "RUN_COMPLETED",
      payload: {
        outputRef: "evidence://run_demo_1/output.json",
        metrics: { latencyMs: 900 }
      }
    }
  });
  assert.equal(completed.statusCode, 201);
  assert.equal(completed.json?.run?.status, "completed");
  assert.equal(completed.json?.event?.schemaVersion, "AgentEvent.v1");

  const getRun = await request(api, { method: "GET", path: `/agents/${encodeURIComponent(agentId)}/runs/run_demo_1` });
  assert.equal(getRun.statusCode, 200);
  assert.equal(getRun.json?.run?.status, "completed");
  assert.equal(getRun.json?.verification?.verificationStatus, "green");
  assert.equal(getRun.json?.verification?.evidenceCount, 1);

  const list = await request(api, { method: "GET", path: `/agents/${encodeURIComponent(agentId)}/runs?status=completed` });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json?.total, 1);
  assert.equal(list.json?.runs?.[0]?.runId, "run_demo_1");

  const events = await request(api, { method: "GET", path: `/agents/${encodeURIComponent(agentId)}/runs/run_demo_1/events` });
  assert.equal(events.statusCode, 200);
  assert.equal(events.json?.events?.length, 4);
  assert.ok(events.json?.events?.every((event) => event?.schemaVersion === "AgentEvent.v1"));

  const verification = await request(api, { method: "GET", path: "/runs/run_demo_1/verification" });
  assert.equal(verification.statusCode, 200);
  assert.equal(verification.json?.verification?.verificationStatus, "green");
  assert.equal(verification.json?.runStatus, "completed");
});

test("API e2e: failed run yields red verification", async () => {
  const api = createApi();
  const { agentId } = await registerAgent(api, { agentId: "agt_runs_failure" });

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs`,
    body: { runId: "run_demo_fail_1", taskType: "classification" }
  });
  assert.equal(created.statusCode, 201);
  const prev = created.json?.run?.lastChainHash;
  assert.ok(prev);

  const failed = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_demo_fail_1/events`,
    headers: { "x-proxy-expected-prev-chain-hash": prev },
    body: {
      type: "RUN_FAILED",
      payload: {
        code: "MODEL_TIMEOUT",
        message: "worker timed out"
      }
    }
  });
  assert.equal(failed.statusCode, 201);
  assert.equal(failed.json?.run?.status, "failed");
  assert.equal(failed.json?.event?.schemaVersion, "AgentEvent.v1");

  const verification = await request(api, { method: "GET", path: "/runs/run_demo_fail_1/verification" });
  assert.equal(verification.statusCode, 200);
  assert.equal(verification.json?.verification?.verificationStatus, "red");
  assert.ok(Array.isArray(verification.json?.verification?.reasonCodes));
  assert.ok(verification.json.verification.reasonCodes.includes("RUN_FAILED"));
});

test("API e2e: run action-required response persists evidence and resumes the run", async () => {
  const api = createApi();
  const { agentId } = await registerAgent(api, { agentId: "agt_runs_action_required" });

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs`,
    headers: { "x-idempotency-key": "run_action_required_create_1" },
    body: {
      runId: "run_action_required_1",
      taskType: "support_followup"
    }
  });
  assert.equal(created.statusCode, 201);
  let prev = created.json?.run?.lastChainHash;

  const actionRequired = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_action_required_1/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": "run_action_required_event_1"
    },
    body: {
      type: "RUN_ACTION_REQUIRED",
      payload: {
        code: "needs_user_document",
        title: "Upload a bill copy",
        detail: "The refund follow-up needs a copy of the original invoice before the network can continue.",
        requestedFields: ["invoice_number"],
        requestedEvidenceKinds: ["invoice_pdf"]
      }
    }
  });
  assert.equal(actionRequired.statusCode, 201);
  assert.equal(actionRequired.json?.run?.status, "running");
  assert.equal(actionRequired.json?.run?.actionRequired?.code, "needs_user_document");
  assert.deepEqual(actionRequired.json?.run?.actionRequired?.requestedFields, ["invoice_number"]);
  assert.deepEqual(actionRequired.json?.run?.actionRequired?.requestedEvidenceKinds, ["invoice_pdf"]);
  prev = actionRequired.json?.run?.lastChainHash;

  const duringPause = await request(api, { method: "GET", path: `/agents/${encodeURIComponent(agentId)}/runs/run_action_required_1` });
  assert.equal(duringPause.statusCode, 200);
  assert.equal(duringPause.json?.run?.actionRequired?.code, "needs_user_document");
  assert.ok(duringPause.json?.verification?.reasonCodes?.includes("RUN_ACTION_REQUIRED"));

  const resumed = await request(api, {
    method: "POST",
    path: "/runs/run_action_required_1/action-required/respond",
    headers: {
      "x-idempotency-key": "run_action_required_resume_1"
    },
    body: {
      providedFields: {
        invoice_number: "INV-1001"
      },
      providedEvidenceKinds: ["invoice_pdf"],
      evidenceRefs: ["artifact://uploads/invoice_1001.pdf"],
      note: "Attached the invoice copy the network requested."
    }
  });
  assert.equal(resumed.statusCode, 201);
  assert.equal(resumed.json?.ok, true);
  assert.equal(resumed.json?.run?.status, "running");
  assert.equal(resumed.json?.run?.actionRequired, null);
  assert.equal(resumed.json?.verification?.verificationStatus, "amber");
  assert.equal(resumed.json?.events?.length, 3);
  assert.equal(resumed.json?.events?.[0]?.type, "EVIDENCE_ADDED");
  assert.equal(resumed.json?.events?.[1]?.type, "EVIDENCE_ADDED");
  assert.equal(resumed.json?.events?.[2]?.type, "RUN_HEARTBEAT");
  assert.match(String(resumed.json?.responseEvidenceRef ?? ""), /^artifact:\/\/runs\/run_action_required_1\/responses\//);
  assert.equal(resumed.json?.responseArtifact?.schemaVersion, "RunActionRequiredResponseArtifact.v1");
  assert.equal(resumed.json?.responseArtifact?.providedFields?.invoice_number, "INV-1001");
  assert.deepEqual(resumed.json?.responseArtifact?.providedEvidenceKinds, ["invoice_pdf"]);
  assert.deepEqual(resumed.json?.responseArtifact?.evidenceRefs, ["artifact://uploads/invoice_1001.pdf"]);

  const storedArtifact = await api.store.getArtifact({
    tenantId: "tenant_default",
    artifactId: resumed.json?.responseArtifact?.artifactId
  });
  assert.equal(storedArtifact?.artifactHash, resumed.json?.responseArtifact?.artifactHash);

  const afterResume = await request(api, { method: "GET", path: `/agents/${encodeURIComponent(agentId)}/runs/run_action_required_1` });
  assert.equal(afterResume.statusCode, 200);
  assert.equal(afterResume.json?.run?.actionRequired, null);
  assert.ok(afterResume.json?.run?.evidenceRefs?.includes("artifact://uploads/invoice_1001.pdf"));
  assert.ok(afterResume.json?.run?.evidenceRefs?.includes(resumed.json?.responseEvidenceRef));
});

test("API e2e: run action-required response fails closed when required inputs are missing", async () => {
  const api = createApi();
  const { agentId } = await registerAgent(api, { agentId: "agt_runs_action_required_fail_closed" });

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs`,
    headers: { "x-idempotency-key": "run_action_required_fail_closed_create_1" },
    body: {
      runId: "run_action_required_fail_closed_1",
      taskType: "support_followup"
    }
  });
  assert.equal(created.statusCode, 201);
  const prev = created.json?.run?.lastChainHash;

  const actionRequired = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_action_required_fail_closed_1/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": "run_action_required_fail_closed_event_1"
    },
    body: {
      type: "RUN_ACTION_REQUIRED",
      payload: {
        code: "needs_user_document",
        requestedFields: ["invoice_number"],
        requestedEvidenceKinds: ["invoice_pdf"]
      }
    }
  });
  assert.equal(actionRequired.statusCode, 201);

  const missingField = await request(api, {
    method: "POST",
    path: "/runs/run_action_required_fail_closed_1/action-required/respond",
    headers: {
      "x-idempotency-key": "run_action_required_fail_closed_missing_field_1"
    },
    body: {
      providedFields: {},
      providedEvidenceKinds: ["invoice_pdf"],
      evidenceRefs: ["artifact://uploads/invoice_missing.pdf"]
    }
  });
  assert.equal(missingField.statusCode, 409);
  assert.equal(missingField.json?.code, "RUN_ACTION_REQUIRED_FIELDS_MISSING");
  assert.deepEqual(missingField.json?.details?.missingFields, ["invoice_number"]);

  const missingEvidenceRefs = await request(api, {
    method: "POST",
    path: "/runs/run_action_required_fail_closed_1/action-required/respond",
    headers: {
      "x-idempotency-key": "run_action_required_fail_closed_missing_evidence_1"
    },
    body: {
      providedFields: {
        invoice_number: "INV-1002"
      },
      providedEvidenceKinds: ["invoice_pdf"],
      evidenceRefs: []
    }
  });
  assert.equal(missingEvidenceRefs.statusCode, 409);
  assert.equal(missingEvidenceRefs.json?.code, "RUN_ACTION_REQUIRED_EVIDENCE_REFS_REQUIRED");

  const afterFailure = await request(api, { method: "GET", path: `/agents/${encodeURIComponent(agentId)}/runs/run_action_required_fail_closed_1` });
  assert.equal(afterFailure.statusCode, 200);
  assert.equal(afterFailure.json?.run?.actionRequired?.code, "needs_user_document");
});

test("API e2e: run action-required response validates delegated account session bindings for account access", async () => {
  const upstreamCalls = [];
  const api = createApi({
    opsToken: "ops_token_runs",
    onboardingProxyBaseUrl: "https://auth.nooterra.local",
    fetchFn: async (url, options = {}) => {
      upstreamCalls.push({
        url: String(url),
        method: String(options.method ?? "GET"),
        headers: options.headers ?? {}
      });
      return new Response(
        JSON.stringify({
          ok: true,
          tenantId: "tenant_default",
          session: {
            schemaVersion: "ConsumerAccountSession.v1",
            tenantId: "tenant_default",
            sessionId: "cas_amazon_demo",
            sessionRef: "accountsession://tenants/tenant_default/cas_amazon_demo",
            providerKey: "amazon",
            providerLabel: "Amazon",
            siteKey: "amazon",
            siteLabel: "Amazon",
            mode: "approval_at_boundary",
            accountHandleMasked: "a***n@example.com",
            fundingSourceLabel: "Amazon Visa ending in 1001",
            maxSpendCents: 15000,
            currency: "USD",
            permissions: {
              canPurchase: true,
              canUseSavedPaymentMethods: false,
              requiresFinalReview: true
            },
            browserProfile: {
              storageStateRef: "state://wallet/tenant_default/bs_amazon_demo",
              loginOrigin: "https://www.amazon.com/",
              startUrl: "https://www.amazon.com/gp/cart/view.html",
              allowedDomains: ["amazon.com", "www.amazon.com"],
              reviewMode: "approval_at_boundary"
            },
            linkedAt: "2026-03-07T00:00:00.000Z",
            revokedAt: null,
            revokedReason: null
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });
  const { agentId } = await registerAgent(api, { agentId: "agt_runs_action_required_account_access" });

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs`,
    headers: { "x-idempotency-key": "run_action_required_account_access_create_1" },
    body: {
      runId: "run_action_required_account_access_1",
      taskType: "purchase_runner"
    }
  });
  assert.equal(created.statusCode, 201);
  const prev = created.json?.run?.lastChainHash;

  const actionRequired = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_action_required_account_access_1/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": "run_action_required_account_access_event_1"
    },
    body: {
      type: "RUN_ACTION_REQUIRED",
      payload: {
        code: "needs_account_access",
        requestedFields: ["account_session_ref", "provider_key", "site_key", "account_handle_masked", "execution_mode"],
        requestedEvidenceKinds: []
      }
    }
  });
  assert.equal(actionRequired.statusCode, 201);

  const resumed = await request(api, {
    method: "POST",
    path: "/runs/run_action_required_account_access_1/action-required/respond",
    headers: {
      "x-idempotency-key": "run_action_required_account_access_resume_1"
    },
    body: {
      providedFields: {
        account_session_ref: "accountsession://tenants/tenant_default/cas_amazon_demo",
        provider_key: "amazon",
        site_key: "amazon",
        account_handle_masked: "a***n@example.com",
        execution_mode: "approval_at_boundary"
      },
      providedEvidenceKinds: [],
      evidenceRefs: [],
      note: "Use my delegated Amazon session for this checkout."
    }
  });
  assert.equal(resumed.statusCode, 201);
  assert.equal(resumed.json?.ok, true);
  assert.equal(resumed.json?.responseArtifact?.accountSessionBinding?.sessionRef, "accountsession://tenants/tenant_default/cas_amazon_demo");
  assert.equal(resumed.json?.responseArtifact?.accountSessionBinding?.providerKey, "amazon");
  assert.equal(resumed.json?.responseArtifact?.accountSessionBinding?.browserProfile?.storageStateRef, "state://wallet/tenant_default/bs_amazon_demo");
  assert.deepEqual(resumed.json?.responseArtifact?.accountSessionBinding?.browserProfile?.allowedDomains, ["amazon.com", "www.amazon.com"]);
  const accountSessionValidationCall = upstreamCalls.find(
    (row) => row.url === "https://auth.nooterra.local/v1/tenants/tenant_default/account-sessions/cas_amazon_demo"
  );
  assert.ok(accountSessionValidationCall);
  assert.equal(String(accountSessionValidationCall.headers["x-proxy-tenant-id"] ?? ""), "tenant_default");
  assert.equal(String(accountSessionValidationCall.headers["x-proxy-ops-token"] ?? ""), "ops_token_runs");
});

test("API e2e: run action-required response fails closed on delegated account session mismatch", async () => {
  const api = createApi({
    opsToken: "ops_token_runs",
    onboardingProxyBaseUrl: "https://auth.nooterra.local",
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          tenantId: "tenant_default",
          session: {
            schemaVersion: "ConsumerAccountSession.v1",
            tenantId: "tenant_default",
            sessionId: "cas_amazon_demo",
            sessionRef: "accountsession://tenants/tenant_default/cas_amazon_demo",
            providerKey: "amazon",
            providerLabel: "Amazon",
            siteKey: "amazon",
            siteLabel: "Amazon",
            mode: "approval_at_boundary",
            accountHandleMasked: "a***n@example.com",
            fundingSourceLabel: "Amazon Visa ending in 1001",
            maxSpendCents: 15000,
            currency: "USD",
            permissions: {
              canPurchase: true,
              canUseSavedPaymentMethods: false,
              requiresFinalReview: true
            },
            browserProfile: {
              storageStateRef: "state://wallet/tenant_default/bs_amazon_demo",
              loginOrigin: "https://www.amazon.com/",
              startUrl: "https://www.amazon.com/gp/cart/view.html",
              allowedDomains: ["amazon.com", "www.amazon.com"],
              reviewMode: "approval_at_boundary"
            },
            linkedAt: "2026-03-07T00:00:00.000Z",
            revokedAt: null,
            revokedReason: null
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
  });
  const { agentId } = await registerAgent(api, { agentId: "agt_runs_action_required_account_access_fail_closed" });

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs`,
    headers: { "x-idempotency-key": "run_action_required_account_access_fail_closed_create_1" },
    body: {
      runId: "run_action_required_account_access_fail_closed_1",
      taskType: "purchase_runner"
    }
  });
  assert.equal(created.statusCode, 201);
  const prev = created.json?.run?.lastChainHash;

  const actionRequired = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_action_required_account_access_fail_closed_1/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": "run_action_required_account_access_fail_closed_event_1"
    },
    body: {
      type: "RUN_ACTION_REQUIRED",
      payload: {
        code: "needs_account_access",
        requestedFields: ["account_session_ref", "provider_key"],
        requestedEvidenceKinds: []
      }
    }
  });
  assert.equal(actionRequired.statusCode, 201);

  const mismatch = await request(api, {
    method: "POST",
    path: "/runs/run_action_required_account_access_fail_closed_1/action-required/respond",
    headers: {
      "x-idempotency-key": "run_action_required_account_access_fail_closed_resume_1"
    },
    body: {
      providedFields: {
        account_session_ref: "accountsession://tenants/tenant_default/cas_amazon_demo",
        provider_key: "ebay"
      },
      providedEvidenceKinds: [],
      evidenceRefs: []
    }
  });
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.json?.code, "RUN_ACTION_REQUIRED_ACCOUNT_SESSION_FIELD_MISMATCH");

  const afterFailure = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_action_required_account_access_fail_closed_1`
  });
  assert.equal(afterFailure.statusCode, 200);
  assert.equal(afterFailure.json?.run?.actionRequired?.code, "needs_account_access");
});

test("API e2e: run action-required response validates wallet consumer connector bindings", async () => {
  const upstreamCalls = [];
  const api = createApi({
    opsToken: "ops_token_runs",
    onboardingProxyBaseUrl: "https://auth.nooterra.local",
    fetchFn: async (url, options = {}) => {
      upstreamCalls.push({
        url: String(url),
        method: String(options.method ?? "GET"),
        headers: options.headers ?? {}
      });
      return new Response(
        JSON.stringify({
          ok: true,
          tenantId: "tenant_default",
          connector: {
            schemaVersion: "ConsumerDataConnector.v1",
            tenantId: "tenant_default",
            connectorId: "cc_calendar_demo",
            connectorRef: "connector://tenants/tenant_default/cc_calendar_demo",
            kind: "calendar",
            provider: "google_calendar",
            mode: "oauth",
            status: "connected",
            accountAddress: "calendar@example.com",
            accountLabel: "Primary calendar",
            timezone: "America/Los_Angeles",
            scopes: ["calendar.readonly"],
            connectedAt: "2026-03-07T00:00:00.000Z",
            createdBy: "buyer@example.com",
            revokedAt: null,
            revokedReason: null
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });
  const { agentId } = await registerAgent(api, { agentId: "agt_runs_action_required_calendar_connector" });

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs`,
    headers: { "x-idempotency-key": "run_action_required_calendar_connector_create_1" },
    body: {
      runId: "run_action_required_calendar_connector_1",
      taskType: "booking_concierge"
    }
  });
  assert.equal(created.statusCode, 201);
  const prev = created.json?.run?.lastChainHash;

  const actionRequired = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_action_required_calendar_connector_1/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": "run_action_required_calendar_connector_event_1"
    },
    body: {
      type: "RUN_ACTION_REQUIRED",
      payload: {
        code: "needs_calendar_access",
        requestedFields: ["calendar_connector_ref", "calendar_provider", "calendar_email", "timezone"],
        requestedEvidenceKinds: []
      }
    }
  });
  assert.equal(actionRequired.statusCode, 201);

  const resumed = await request(api, {
    method: "POST",
    path: "/runs/run_action_required_calendar_connector_1/action-required/respond",
    headers: {
      "x-idempotency-key": "run_action_required_calendar_connector_resume_1"
    },
    body: {
      providedFields: {
        calendar_connector_ref: "connector://tenants/tenant_default/cc_calendar_demo",
        calendar_provider: "google_calendar",
        calendar_email: "calendar@example.com",
        timezone: "America/Los_Angeles"
      },
      providedEvidenceKinds: [],
      evidenceRefs: [],
      note: "Use my linked calendar."
    }
  });
  assert.equal(resumed.statusCode, 201);
  assert.equal(resumed.json?.ok, true);
  assert.equal(
    resumed.json?.responseArtifact?.consumerConnectorBinding?.connectorRef,
    "connector://tenants/tenant_default/cc_calendar_demo"
  );
  assert.equal(resumed.json?.responseArtifact?.consumerConnectorBinding?.kind, "calendar");
  assert.equal(resumed.json?.responseArtifact?.consumerConnectorBinding?.provider, "google_calendar");
  assert.equal(resumed.json?.responseArtifact?.consumerConnectorBinding?.timezone, "America/Los_Angeles");
  const connectorValidationCall = upstreamCalls.find(
    (row) => row.url === "https://auth.nooterra.local/v1/tenants/tenant_default/consumer-connectors/cc_calendar_demo"
  );
  assert.ok(connectorValidationCall);
  assert.equal(String(connectorValidationCall.headers["x-proxy-tenant-id"] ?? ""), "tenant_default");
  assert.equal(String(connectorValidationCall.headers["x-proxy-ops-token"] ?? ""), "ops_token_runs");
});

test("API e2e: run action-required response fails closed on consumer connector mismatch", async () => {
  const api = createApi({
    opsToken: "ops_token_runs",
    onboardingProxyBaseUrl: "https://auth.nooterra.local",
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          tenantId: "tenant_default",
          connector: {
            schemaVersion: "ConsumerDataConnector.v1",
            tenantId: "tenant_default",
            connectorId: "cc_calendar_demo",
            connectorRef: "connector://tenants/tenant_default/cc_calendar_demo",
            kind: "calendar",
            provider: "google_calendar",
            mode: "oauth",
            status: "connected",
            accountAddress: "calendar@example.com",
            accountLabel: "Primary calendar",
            timezone: "America/Los_Angeles",
            scopes: ["calendar.readonly"],
            connectedAt: "2026-03-07T00:00:00.000Z",
            createdBy: "buyer@example.com",
            revokedAt: null,
            revokedReason: null
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
  });
  const { agentId } = await registerAgent(api, { agentId: "agt_runs_action_required_calendar_connector_fail_closed" });

  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs`,
    headers: { "x-idempotency-key": "run_action_required_calendar_connector_fail_closed_create_1" },
    body: {
      runId: "run_action_required_calendar_connector_fail_closed_1",
      taskType: "booking_concierge"
    }
  });
  assert.equal(created.statusCode, 201);
  const prev = created.json?.run?.lastChainHash;

  const actionRequired = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_action_required_calendar_connector_fail_closed_1/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": prev,
      "x-idempotency-key": "run_action_required_calendar_connector_fail_closed_event_1"
    },
    body: {
      type: "RUN_ACTION_REQUIRED",
      payload: {
        code: "needs_calendar_access",
        requestedFields: ["calendar_connector_ref", "calendar_provider"],
        requestedEvidenceKinds: []
      }
    }
  });
  assert.equal(actionRequired.statusCode, 201);

  const mismatch = await request(api, {
    method: "POST",
    path: "/runs/run_action_required_calendar_connector_fail_closed_1/action-required/respond",
    headers: {
      "x-idempotency-key": "run_action_required_calendar_connector_fail_closed_resume_1"
    },
    body: {
      providedFields: {
        calendar_connector_ref: "connector://tenants/tenant_default/cc_calendar_demo",
        calendar_provider: "outlook_calendar"
      },
      providedEvidenceKinds: [],
      evidenceRefs: []
    }
  });
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.json?.code, "RUN_ACTION_REQUIRED_CONSUMER_CONNECTOR_FIELD_MISMATCH");

  const afterFailure = await request(api, {
    method: "GET",
    path: `/agents/${encodeURIComponent(agentId)}/runs/run_action_required_calendar_connector_fail_closed_1`
  });
  assert.equal(afterFailure.statusCode, 200);
  assert.equal(afterFailure.json?.run?.actionRequired?.code, "needs_calendar_access");
});
