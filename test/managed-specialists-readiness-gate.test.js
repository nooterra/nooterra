import test from "node:test";
import assert from "node:assert/strict";

import {
  parseArgs,
  runManagedSpecialistsReadinessGate
} from "../scripts/ci/run-managed-specialists-readiness-gate.mjs";

test("managed specialists readiness gate: parseArgs allows bootstrap-local without managed url", () => {
  const args = parseArgs(["--bootstrap-local", "--tenant-id", "tenant_gate_test"], {}, process.cwd());
  assert.equal(args.bootstrapLocal, true);
  assert.equal(args.tenantId, "tenant_gate_test");
  assert.equal(args.managedUrl, "");
  assert.equal(args.apiUrl, "http://127.0.0.1:3000");
});

test("managed specialists readiness gate: parseArgs requires ops token when verify-api-status is enabled", () => {
  assert.throws(
    () => parseArgs(["--bootstrap-local", "--verify-api-status"], {}, process.cwd()),
    /--ops-token is required when --verify-api-status is used/
  );
});

test("managed specialists readiness gate: bootstrap-local reports a healthy managed roster", async () => {
  const args = parseArgs(
    ["--bootstrap-local", "--tenant-id", "tenant_gate_test", "--api-url", "http://127.0.0.1:3000"],
    {},
    process.cwd()
  );
  const { report } = await runManagedSpecialistsReadinessGate(args);
  assert.equal(report.schemaVersion, "ManagedSpecialistsReadinessGate.v1");
  assert.equal(report.ok, true);
  assert.equal(report.bootstrap?.host, "127.0.0.1");
  assert.equal(report.bootstrap?.port > 0, true);
  const checkIds = report.checks.map((check) => check.id);
  assert.ok(checkIds.includes("managed_specialist_healthz"));
  assert.ok(checkIds.includes("managed_specialist_provider_key"));
  assert.ok(checkIds.includes("managed_specialist_catalog"));
  assert.ok(checkIds.includes("managed_specialist_publish_dry_run"));
  assert.ok(checkIds.includes("managed_specialist_profile_purchase_runner"));
});

test("managed specialists readiness gate: fail-closed when publish dry run fails", async () => {
  const args = parseArgs(
    ["--managed-url", "http://127.0.0.1:9781", "--tenant-id", "tenant_gate_test", "--api-url", "http://127.0.0.1:3000"],
    {},
    process.cwd()
  );
  const okJson = (body) => Promise.resolve({ ok: true, statusCode: 200, body });
  const requestJsonFn = async (url) => {
    if (url.endsWith("/healthz")) return okJson({ ok: true, specialistCount: 3 });
    if (url.endsWith("/nooterra/provider-key")) return okJson({ ok: true, algorithm: "ed25519", keyId: "key_test" });
    if (url.endsWith("/.well-known/provider-publish-jwks.json")) return okJson({ keys: [{ kid: "key_test" }] });
    if (url.endsWith("/.well-known/managed-specialists.json")) {
      return okJson({
        schemaVersion: "ManagedSpecialistCatalog.v1",
        specialists: [
          {
            profileId: "purchase_runner",
            providerId: "provider_purchase_runner",
            toolId: "tool_purchase_runner",
            paidPath: "/paid/purchase_runner",
            providerDraft: {
              delegatedBrowserRuntime: { runtime: "playwright_delegated_browser_session" }
            },
            manifest: {
              publishProofJwksUrl: "http://127.0.0.1:9781/.well-known/provider-publish-jwks.json",
              manifestHash: "a".repeat(64),
              tools: [
                {
                  security: { requestBinding: "strict" },
                  metadata: {
                    phase1ManagedNetwork: {
                      executionAdapter: {
                        delegatedBrowserRuntime: { runtime: "playwright_delegated_browser_session" }
                      }
                    }
                  }
                }
              ]
            }
          },
          {
            profileId: "booking_concierge",
            providerId: "provider_booking_concierge",
            toolId: "tool_booking_concierge",
            paidPath: "/paid/booking_concierge",
            providerDraft: {
              delegatedBrowserRuntime: { runtime: "playwright_delegated_browser_session" }
            },
            manifest: {
              publishProofJwksUrl: "http://127.0.0.1:9781/.well-known/provider-publish-jwks.json",
              manifestHash: "b".repeat(64),
              tools: [
                {
                  security: { requestBinding: "strict" },
                  metadata: {
                    phase1ManagedNetwork: {
                      executionAdapter: {
                        delegatedBrowserRuntime: { runtime: "playwright_delegated_browser_session" }
                      }
                    }
                  }
                }
              ]
            }
          },
          {
            profileId: "account_admin",
            providerId: "provider_account_admin",
            toolId: "tool_account_admin",
            paidPath: "/paid/account_admin",
            providerDraft: {
              delegatedBrowserRuntime: { runtime: "playwright_delegated_browser_session" }
            },
            manifest: {
              publishProofJwksUrl: "http://127.0.0.1:9781/.well-known/provider-publish-jwks.json",
              manifestHash: "c".repeat(64),
              tools: [
                {
                  security: { requestBinding: "strict" },
                  metadata: {
                    phase1ManagedNetwork: {
                      executionAdapter: {
                        delegatedBrowserRuntime: { runtime: "playwright_delegated_browser_session" }
                      }
                    }
                  }
                }
              ]
            }
          }
        ]
      });
    }
    throw new Error(`unexpected url ${url}`);
  };
  const runNodeFn = async () => ({ code: 1, stdout: "", stderr: "dry run failed" });
  const { report } = await runManagedSpecialistsReadinessGate(args, { requestJsonFn, runNodeFn });
  assert.equal(report.ok, false);
  assert.ok(report.blockingIssues.some((issue) => issue.code === "MANAGED_SPECIALIST_PUBLISH_DRY_RUN_FAILED"));
  const publishCheck = report.checks.find((check) => check.id === "managed_specialist_publish_dry_run");
  assert.equal(publishCheck?.ok, false);
  assert.equal(publishCheck?.exitCode, 1);
});

test("managed specialists readiness gate: verifies ops managed-specialists status when requested", async () => {
  const args = parseArgs(
    [
      "--managed-url",
      "http://127.0.0.1:9781",
      "--tenant-id",
      "tenant_gate_test",
      "--api-url",
      "http://127.0.0.1:3000",
      "--ops-token",
      "tok_ops_gate",
      "--verify-api-status"
    ],
    {},
    process.cwd()
  );

  const okJson = (body) => Promise.resolve({ ok: true, statusCode: 200, body });
  const requestJsonFn = async (url, init = {}) => {
    if (url.endsWith("/healthz")) return okJson({ ok: true, specialistCount: 3 });
    if (url.endsWith("/nooterra/provider-key")) return okJson({ ok: true, algorithm: "ed25519", keyId: "key_test" });
    if (url.endsWith("/.well-known/provider-publish-jwks.json")) return okJson({ keys: [{ kid: "key_test" }] });
    if (url.endsWith("/.well-known/managed-specialists.json")) {
      return okJson({
        schemaVersion: "ManagedSpecialistCatalog.v1",
        specialists: [
          {
            profileId: "purchase_runner",
            providerId: "provider_purchase_runner",
            toolId: "tool_purchase_runner",
            paidPath: "/paid/purchase_runner",
            providerDraft: { delegatedBrowserRuntime: { runtime: "playwright_delegated_browser_session" } },
            manifest: {
              publishProofJwksUrl: "http://127.0.0.1:9781/.well-known/provider-publish-jwks.json",
              tools: [{ security: { requestBinding: "strict" }, metadata: { phase1ManagedNetwork: { executionAdapter: { delegatedBrowserRuntime: { runtime: "playwright_delegated_browser_session" } } } } }]
            }
          },
          {
            profileId: "booking_concierge",
            providerId: "provider_booking_concierge",
            toolId: "tool_booking_concierge",
            paidPath: "/paid/booking_concierge",
            providerDraft: { delegatedBrowserRuntime: { runtime: "playwright_delegated_browser_session" } },
            manifest: {
              publishProofJwksUrl: "http://127.0.0.1:9781/.well-known/provider-publish-jwks.json",
              tools: [{ security: { requestBinding: "strict" }, metadata: { phase1ManagedNetwork: { executionAdapter: { delegatedBrowserRuntime: { runtime: "playwright_delegated_browser_session" } } } } }]
            }
          },
          {
            profileId: "account_admin",
            providerId: "provider_account_admin",
            toolId: "tool_account_admin",
            paidPath: "/paid/account_admin",
            providerDraft: { delegatedBrowserRuntime: { runtime: "playwright_delegated_browser_session" } },
            manifest: {
              publishProofJwksUrl: "http://127.0.0.1:9781/.well-known/provider-publish-jwks.json",
              tools: [{ security: { requestBinding: "strict" }, metadata: { phase1ManagedNetwork: { executionAdapter: { delegatedBrowserRuntime: { runtime: "playwright_delegated_browser_session" } } } } }]
            }
          }
        ]
      });
    }
    if (url.endsWith("/ops/network/managed-specialists")) {
      assert.equal(init.headers.authorization, "Bearer tok_ops_gate");
      assert.equal(init.headers["x-proxy-tenant-id"], "tenant_gate_test");
      return okJson({
        ok: true,
        tenantId: "tenant_gate_test",
        managedSpecialists: {
          schemaVersion: "OpsManagedSpecialistsStatus.v1",
          summary: {
            totalProfiles: 3,
            invocationReadyCount: 3
          },
          specialists: [
            { profileId: "purchase_runner", readiness: { invocationReady: true, gaps: [] } },
            { profileId: "booking_concierge", readiness: { invocationReady: true, gaps: [] } },
            { profileId: "account_admin", readiness: { invocationReady: true, gaps: [] } }
          ]
        }
      });
    }
    throw new Error(`unexpected url ${url}`);
  };
  const runNodeFn = async () => ({
    code: 0,
    stdout: JSON.stringify({ schemaVersion: "ManagedSpecialistPublishResult.v1", dryRun: true, specialists: [{}, {}, {}] }),
    stderr: ""
  });
  const { report } = await runManagedSpecialistsReadinessGate(args, { requestJsonFn, runNodeFn });
  assert.equal(report.ok, true);
  const opsStatusCheck = report.checks.find((check) => check.id === "managed_specialist_ops_status");
  assert.equal(opsStatusCheck?.ok, true);
  assert.equal(opsStatusCheck?.summary?.invocationReadyCount, 3);
});
