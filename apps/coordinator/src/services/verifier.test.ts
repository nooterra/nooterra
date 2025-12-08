import { describe, it, expect, vi, beforeEach } from "vitest";
import { pool } from "../db.js";
import { getAgentRoutingProfile } from "./agent-card.js";
import { verifyInvocationCompliance } from "./verifier.js";

vi.mock("../db.js", () => {
  return {
    pool: {
      query: vi.fn(),
    },
  };
});

vi.mock("./agent-card.js", async () => {
  const actual = await vi.importActual<typeof import("./agent-card.js")>(
    "./agent-card.js"
  );
  return {
    ...actual,
    getAgentRoutingProfile: vi.fn(),
  };
});

describe("Verifier service", () => {
  const mockQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
  const mockGetProfile = getAgentRoutingProfile as unknown as ReturnType<
    typeof vi.fn
  >;

  beforeEach(() => {
    mockQuery.mockReset();
    mockGetProfile.mockReset();
  });

  it("returns null when invocation does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const result = await verifyInvocationCompliance("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  it("marks invocation non-compliant when no receipts exist", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            invocation_id: "inv-1",
            trace_id: "trace-1",
            workflow_id: "wf-1",
            node_name: "node-1",
            capability_id: "cap.test.v1",
            agent_did: "did:noot:agent1",
            constraints: null,
            mandate_id: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 0,
        rows: [],
      });

    const result = await verifyInvocationCompliance("inv-1");
    expect(result).not.toBeNull();
    expect(result?.compliant).toBe(false);
    expect(result?.issues.some((i) => i.code === "no_receipt")).toBe(true);
  });

  it("detects policy and signature violations", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            invocation_id: "inv-1",
            trace_id: "trace-1",
            workflow_id: "wf-1",
            node_name: "node-1",
            capability_id: "cap.test.v1",
            agent_did: "did:noot:agent1",
            constraints: {
              policyIds: ["policy.strict"],
              regionsAllow: ["us-west"],
              regionsDeny: [],
            },
            mandate_id: "mandate-1",
          },
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            agent_did: "did:noot:agent1",
            capability_id: "cap.test.v1",
            mandate_id: "mandate-1",
            envelope_signature_valid: false,
          },
        ],
      });

    mockGetProfile.mockResolvedValueOnce({
      did: "did:noot:agent1",
      endpoint: "https://agent.example.com",
      capabilityIds: ["cap.test.v1"],
      acceptedPolicyIds: ["policy.loose"],
      regionsAllow: ["eu-central"],
      regionsDeny: [],
      modelHint: null,
      defaultPriceCents: null,
      defaultCurrency: null,
      reputationScore: null,
      stakedAmount: null,
      supportsVerification: false,
    });

    const result = await verifyInvocationCompliance("inv-1");
    expect(result).not.toBeNull();
    expect(result?.compliant).toBe(false);

    const codes = (result?.issues || []).map((i) => i.code);
    expect(codes).toContain("signature_invalid");
    expect(codes).toContain("policy_mismatch");
    expect(codes).toContain("region_not_allowed");
  });
});

