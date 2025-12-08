import { describe, it, expect } from "vitest";
import { buildInvocation } from "./invocation.js";

describe("buildInvocation", () => {
  it("builds an invocation with constraints and context", () => {
    const invocation = buildInvocation({
      workflowId: "wf-1",
      nodeName: "node-1",
      capabilityId: "cap.text.generate.v1",
      input: { prompt: "Hello" },
      traceId: "trace-123",
      payerDid: "did:noot:payer",
      projectId: "proj-1",
      maxPriceCents: 100,
      budgetCapCents: 1000,
      timeoutMs: 5000,
      targetAgentId: "did:noot:agent",
      deadlineAt: "2025-01-01T00:00:00.000Z",
      policyIds: ["policy.safe.text"],
      regionsAllow: ["us-west"],
      regionsDeny: ["cn-north"],
    });

    expect(invocation.capabilityId).toBe("cap.text.generate.v1");
    expect(invocation.input).toEqual({ prompt: "Hello" });
    expect(invocation.traceId).toBe("trace-123");
    expect(invocation.agentDid).toBe("did:noot:agent");
    expect(invocation.context?.workflowId).toBe("wf-1");
    expect(invocation.context?.nodeName).toBe("node-1");
    expect(invocation.context?.payerDid).toBe("did:noot:payer");
    expect(invocation.context?.projectId).toBe("proj-1");
    expect(invocation.constraints?.maxPriceCents).toBe(100);
    expect(invocation.constraints?.budgetCapCents).toBe(1000);
    expect(invocation.constraints?.timeoutMs).toBe(5000);
    expect(invocation.constraints?.policyIds).toContain("policy.safe.text");
    expect(invocation.constraints?.regionsAllow).toContain("us-west");
    expect(invocation.constraints?.regionsDeny).toContain("cn-north");
  });
});

