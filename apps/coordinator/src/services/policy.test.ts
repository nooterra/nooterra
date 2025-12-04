/**
 * Policy Enforcement Tests
 * 
 * Tests agent eligibility checks and policy rules.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { pool } from "../db.js";

import {
  checkAgentEligibility,
  filterEligibleAgents,
  checkWorkflowCreation,
  getMaxRetriesForWorkflow,
  PolicyRules,
} from "../services/policy.js";

// Get typed mock reference
const mockQuery = vi.mocked(pool.query);

describe("Policy Enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkAgentEligibility", () => {
    it("should allow any agent when no policy exists", async () => {
      // No DB call needed when policy is null
      const result = await checkAgentEligibility(
        "did:noot:agent1",
        "cap.test.v1",
        null
      );

      expect(result.eligible).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it("should block agent on blocklist", async () => {
      const policy: PolicyRules = {
        blockedAgents: ["did:noot:badagent"],
      };

      // Blocklist check happens before DB call
      const result = await checkAgentEligibility(
        "did:noot:badagent",
        "cap.test.v1",
        policy
      );

      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain("Agent is on blocklist");
    });

    it("should require agent on allowlist when set", async () => {
      const policy: PolicyRules = {
        allowedAgents: ["did:noot:agent1", "did:noot:agent2"],
      };

      // Allowlist check happens before DB call
      const result = await checkAgentEligibility(
        "did:noot:agent3",
        "cap.test.v1",
        policy
      );

      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain("Agent not on allowlist");
    });

    it("should check minimum reputation", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ reputation: 0.3, health_score: 1.0, success_rate: 0.5 }],
        rowCount: 1,
      } as any);

      const policy: PolicyRules = {
        minReputation: 0.5,
      };

      const result = await checkAgentEligibility(
        "did:noot:lowrep",
        "cap.test.v1",
        policy
      );

      expect(result.eligible).toBe(false);
      expect(result.reasons[0]).toContain("Reputation");
      expect(result.reasons[0]).toContain("below minimum");
    });

    it("should check minimum health score", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ reputation: 0.8, health_score: 0.3, success_rate: 0.9 }],
        rowCount: 1,
      } as any);

      const policy: PolicyRules = {
        minHealthScore: 0.5,
      };

      const result = await checkAgentEligibility(
        "did:noot:unhealthy",
        "cap.test.v1",
        policy
      );

      expect(result.eligible).toBe(false);
      expect(result.reasons[0]).toContain("Health score");
    });

    it("should check capability-specific rules", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ reputation: 0.6, health_score: 1.0, success_rate: 0.8 }],
        rowCount: 1,
      } as any);

      const policy: PolicyRules = {
        capabilityRules: {
          "cap.code.v1": {
            minReputation: 0.8, // Higher than agent's 0.6
          },
        },
      };

      const result = await checkAgentEligibility(
        "did:noot:agent1",
        "cap.code.v1",
        policy
      );

      expect(result.eligible).toBe(false);
      expect(result.reasons[0]).toContain("capability minimum");
    });

    it("should block capability when explicitly blocked", async () => {
      // DB call happens after capability check
      mockQuery.mockResolvedValueOnce({
        rows: [{ reputation: 0.8, health_score: 1.0, success_rate: 0.9 }],
        rowCount: 1,
      } as any);

      const policy: PolicyRules = {
        capabilityRules: {
          "cap.dangerous.v1": {
            blocked: true,
          },
        },
      };

      const result = await checkAgentEligibility(
        "did:noot:agent1",
        "cap.dangerous.v1",
        policy
      );

      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain("Capability blocked by policy");
    });

    it("should allow eligible agent", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ reputation: 0.8, health_score: 1.0, success_rate: 0.9 }],
        rowCount: 1,
      } as any);

      const policy: PolicyRules = {
        minReputation: 0.5,
        minHealthScore: 0.5,
      };

      const result = await checkAgentEligibility(
        "did:noot:goodagent",
        "cap.test.v1",
        policy
      );

      expect(result.eligible).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });
  });

  describe("filterEligibleAgents", () => {
    it("should filter out ineligible agents", async () => {
      const agents = [
        { did: "did:noot:agent1", name: "Agent 1" },
        { did: "did:noot:blocked", name: "Blocked Agent" },
        { did: "did:noot:agent2", name: "Agent 2" },
      ];

      const policy: PolicyRules = {
        blockedAgents: ["did:noot:blocked"],
      };

      // Mock for agent1 - eligible (no DB call for non-blocked agents with no other rules)
      // Mock for agent2 - eligible
      
      const result = await filterEligibleAgents(agents, "cap.test.v1", policy);

      expect(result).toHaveLength(2);
      expect(result.map(a => a.did)).not.toContain("did:noot:blocked");
    });

    it("should return all agents when no policy", async () => {
      const agents = [
        { did: "did:noot:agent1" },
        { did: "did:noot:agent2" },
      ];

      const result = await filterEligibleAgents(agents, "cap.test.v1", null);

      expect(result).toHaveLength(2);
    });
  });

  describe("checkWorkflowCreation", () => {
    it("should allow workflow when no policy exists", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      const result = await checkWorkflowCreation("project-1", 1000);

      expect(result.allowed).toBe(true);
    });

    it("should deny workflow exceeding budget limit", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ rules: { maxBudgetCents: 500 } }],
        rowCount: 1,
      } as any);

      const result = await checkWorkflowCreation("project-1", 1000);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("exceeds policy limit");
    });

    it("should allow workflow within budget limit", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ rules: { maxBudgetCents: 2000 } }],
        rowCount: 1,
      } as any);

      const result = await checkWorkflowCreation("project-1", 1000);

      expect(result.allowed).toBe(true);
    });
  });

  describe("getMaxRetriesForWorkflow", () => {
    it("should return default when no policy", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      const result = await getMaxRetriesForWorkflow("wf-1");

      expect(result).toBe(3); // Default
    });

    it("should return policy-defined max retries", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ rules: { maxRetries: 5 } }],
        rowCount: 1,
      } as any);

      const result = await getMaxRetriesForWorkflow("wf-1");

      expect(result).toBe(5);
    });
  });
});
