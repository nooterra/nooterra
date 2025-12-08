import { describe, it, expect, vi, beforeEach } from "vitest";
import { pool } from "../db.js";
import { getAgentRoutingProfile } from "./agent-card.js";

vi.mock("../db.js", () => {
  return {
    pool: {
      query: vi.fn(),
    },
  };
});

describe("AgentCard service", () => {
const mockQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("builds routing profile from agent_card", async () => {
    // First call: getAgentRoutingProfile (agent_card)
    mockQuery
      .mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          agent_card: {
            agentId: "did:noot:test-agent",
            version: "1.0.0",
            displayName: "Test Agent",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            endpoints: { primaryUrl: "https://agent.example.com" },
            keys: { signingPublicKey: "pk", didUri: "did:noot:test-agent" },
            capabilities: [
              { id: "cap.text.generate.v1", name: "Text Gen" },
              { id: "cap.verify.generic.v1", name: "Verifier" },
            ],
            policyProfile: {
              acceptedPolicyIds: ["policy.safe.text"],
              jurisdictions: ["us-west", "eu-central"],
            },
            economics: {
              defaultPriceCents: 10,
              defaultCurrency: "usd",
            },
            reputation: {
              score: 0.9,
              stakedAmount: 1000,
            },
          },
        },
      ],
    })
      // Second call: getAgentModelHint (agent_card + acard_raw->>'model')
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            agent_card: null,
            model: "meta-llama/Llama-3.1-8B-Instruct",
          },
        ],
      });

    const profile = await getAgentRoutingProfile("did:noot:test-agent");
    expect(profile).not.toBeNull();
    expect(profile?.did).toBe("did:noot:test-agent");
    expect(profile?.endpoint).toBe("https://agent.example.com");
    expect(profile?.capabilityIds).toContain("cap.text.generate.v1");
    expect(profile?.capabilityIds).toContain("cap.verify.generic.v1");
    expect(profile?.acceptedPolicyIds).toContain("policy.safe.text");
    expect(profile?.regionsAllow).toContain("us-west");
    expect(profile?.defaultPriceCents).toBe(10);
    expect(profile?.defaultCurrency).toBe("usd");
    expect(profile?.reputationScore).toBe(0.9);
    expect(profile?.stakedAmount).toBe(1000);
    expect(profile?.supportsVerification).toBe(true);
  });
});
