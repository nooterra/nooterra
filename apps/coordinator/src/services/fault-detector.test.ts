/**
 * Fault Detector Tests
 * 
 * Tests objective fault detection for timeout, error, and schema violations.
 * Uses the public detectFault API with NodeExecutionContext objects.
 */

import { describe, it, expect } from "vitest";
import {
  detectFault,
  FaultType,
  NodeExecutionContext,
} from "../services/fault-detector.js";

// Helper to create a base context
function createContext(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  return {
    workflowId: "test-workflow",
    nodeName: "test-node",
    agentDid: "did:test:agent",
    capabilityId: "test-capability",
    startedAt: new Date("2024-01-01T00:00:00Z"),
    deadlineAt: new Date("2024-01-01T00:00:30Z"), // 30 second deadline
    ...overrides,
  };
}

describe("Fault Detector", () => {
  describe("Timeout Detection", () => {
    it("should detect timeout when duration exceeds deadline", () => {
      const ctx = createContext({
        startedAt: new Date("2024-01-01T00:00:00Z"),
        finishedAt: new Date("2024-01-01T00:01:00Z"), // 60 seconds later
        deadlineAt: new Date("2024-01-01T00:00:30Z"), // 30 second deadline
      });
      
      const result = detectFault(ctx);
      
      expect(result.hasFault).toBe(true);
      expect(result.faultType).toBe("timeout");
      expect(result.evidence).toHaveProperty("overageMs");
    });

    it("should not detect timeout when within deadline", () => {
      const ctx = createContext({
        startedAt: new Date("2024-01-01T00:00:00Z"),
        finishedAt: new Date("2024-01-01T00:00:20Z"), // 20 seconds later
        deadlineAt: new Date("2024-01-01T00:00:30Z"), // 30 second deadline
      });
      
      const result = detectFault(ctx);
      
      expect(result.hasFault).toBe(false);
      expect(result.faultType).toBe("none");
    });
  });

  describe("Error Detection", () => {
    it("should detect HTTP 500 as error", () => {
      const ctx = createContext({
        finishedAt: new Date("2024-01-01T00:00:10Z"),
        httpStatus: 500,
      });
      
      const result = detectFault(ctx);
      
      expect(result.hasFault).toBe(true);
      expect(result.faultType).toBe("error");
      expect(result.evidence).toHaveProperty("httpStatus", 500);
    });

    it("should detect HTTP 502 as error", () => {
      const ctx = createContext({
        finishedAt: new Date("2024-01-01T00:00:10Z"),
        httpStatus: 502,
      });
      
      const result = detectFault(ctx);
      
      expect(result.hasFault).toBe(true);
      expect(result.faultType).toBe("error");
    });

    it("should detect error status in response", () => {
      const ctx = createContext({
        finishedAt: new Date("2024-01-01T00:00:10Z"),
        httpStatus: 200,
        responseStatus: "error",
        error: "Something failed",
      });
      
      const result = detectFault(ctx);
      
      expect(result.hasFault).toBe(true);
      expect(result.faultType).toBe("error");
      expect(result.evidence).toHaveProperty("responseStatus", "error");
    });

    it("should not detect error for successful response", () => {
      const ctx = createContext({
        finishedAt: new Date("2024-01-01T00:00:10Z"),
        httpStatus: 200,
        responseStatus: "success",
      });
      
      const result = detectFault(ctx);
      
      expect(result.hasFault).toBe(false);
      expect(result.faultType).toBe("none");
    });

    it("should not detect error for HTTP 200 without status field", () => {
      const ctx = createContext({
        finishedAt: new Date("2024-01-01T00:00:10Z"),
        httpStatus: 200,
      });
      
      const result = detectFault(ctx);
      
      expect(result.hasFault).toBe(false);
      expect(result.faultType).toBe("none");
    });
  });

  describe("Schema Validation", () => {
    it("should detect schema violation for missing required field", () => {
      const ctx = createContext({
        finishedAt: new Date("2024-01-01T00:00:10Z"),
        httpStatus: 200,
        output: { name: "test" }, // missing "value" field
        outputSchema: {
          type: "object",
          required: ["name", "value"],
          properties: {
            name: { type: "string" },
            value: { type: "number" },
          },
        },
      });
      
      const result = detectFault(ctx);
      
      expect(result.hasFault).toBe(true);
      expect(result.faultType).toBe("schema_violation");
      expect(result.evidence).toHaveProperty("schemaErrors");
    });

    it("should detect schema violation for wrong type", () => {
      const ctx = createContext({
        finishedAt: new Date("2024-01-01T00:00:10Z"),
        httpStatus: 200,
        output: { name: "test", value: "not a number" },
        outputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            value: { type: "number" },
          },
        },
      });
      
      const result = detectFault(ctx);
      
      expect(result.hasFault).toBe(true);
      expect(result.faultType).toBe("schema_violation");
    });

    it("should pass for valid output", () => {
      const ctx = createContext({
        finishedAt: new Date("2024-01-01T00:00:10Z"),
        httpStatus: 200,
        output: { name: "test", value: 42 },
        outputSchema: {
          type: "object",
          required: ["name", "value"],
          properties: {
            name: { type: "string" },
            value: { type: "number" },
          },
        },
      });
      
      const result = detectFault(ctx);
      
      expect(result.hasFault).toBe(false);
      expect(result.faultType).toBe("none");
    });

    it("should pass when no schema provided", () => {
      const ctx = createContext({
        finishedAt: new Date("2024-01-01T00:00:10Z"),
        httpStatus: 200,
        output: { anything: "goes" },
      });
      
      const result = detectFault(ctx);
      
      expect(result.hasFault).toBe(false);
      expect(result.faultType).toBe("none");
    });
  });

  describe("detectFault (combined)", () => {
    it("should detect timeout first (priority)", () => {
      const context: NodeExecutionContext = {
        workflowId: "wf-1",
        nodeName: "node-1",
        agentDid: "did:noot:agent1",
        capabilityId: "cap.test.v1",
        startedAt: new Date("2024-01-01T00:00:00Z"),
        finishedAt: new Date("2024-01-01T00:02:00Z"), // 2 minutes
        deadlineAt: new Date("2024-01-01T00:01:00Z"), // 1 minute deadline
        httpStatus: 200,
        output: { result: "ok" },
      };
      
      const result = detectFault(context);
      
      expect(result.hasFault).toBe(true);
      expect(result.faultType).toBe("timeout");
      expect(result.shouldRefund).toBe(true);
    });

    it("should detect error when no timeout", () => {
      const context: NodeExecutionContext = {
        workflowId: "wf-1",
        nodeName: "node-1",
        agentDid: "did:noot:agent1",
        capabilityId: "cap.test.v1",
        startedAt: new Date("2024-01-01T00:00:00Z"),
        finishedAt: new Date("2024-01-01T00:00:30Z"),
        deadlineAt: new Date("2024-01-01T00:01:00Z"),
        httpStatus: 500,
      };
      
      const result = detectFault(context);
      
      expect(result.hasFault).toBe(true);
      expect(result.faultType).toBe("error");
      expect(result.shouldRefund).toBe(true);
    });

    it("should return no fault for successful execution", () => {
      const context: NodeExecutionContext = {
        workflowId: "wf-1",
        nodeName: "node-1",
        agentDid: "did:noot:agent1",
        capabilityId: "cap.test.v1",
        startedAt: new Date("2024-01-01T00:00:00Z"),
        finishedAt: new Date("2024-01-01T00:00:30Z"),
        deadlineAt: new Date("2024-01-01T00:01:00Z"),
        httpStatus: 200,
        output: { result: "success" },
      };
      
      const result = detectFault(context);
      
      expect(result.hasFault).toBe(false);
      expect(result.faultType).toBe("none");
      expect(result.shouldRefund).toBe(false);
    });
  });
});
