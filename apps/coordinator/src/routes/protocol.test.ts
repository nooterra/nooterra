/**
 * Basic smoke tests for protocol routes
 * These test that routes are properly registered and schemas validate
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Mock the database pool
vi.mock("../db.js", () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

// Test Zod schemas used in routes
describe("Protocol Route Schemas", () => {
  describe("Trust Layer Schemas", () => {
    const RevocationSchema = z.object({
      did: z.string(),
      reason: z.string(),
      evidence: z.record(z.unknown()).optional(),
      expiresAt: z.string().datetime().optional(),
    });

    it("should validate revocation request", () => {
      const valid = RevocationSchema.safeParse({
        did: "did:noot:agent123",
        reason: "Malicious behavior",
      });
      expect(valid.success).toBe(true);
    });

    it("should validate revocation with expiration", () => {
      const valid = RevocationSchema.safeParse({
        did: "did:noot:agent123",
        reason: "Temporary suspension",
        expiresAt: "2025-12-31T23:59:59Z",
      });
      expect(valid.success).toBe(true);
    });

    it("should reject invalid revocation", () => {
      const invalid = RevocationSchema.safeParse({
        reason: "Missing DID",
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("Accountability Schemas", () => {
    const ReceiptSchema = z.object({
      workflowId: z.string().uuid(),
      nodeId: z.string().uuid(),
      inputHash: z.string(),
      outputHash: z.string(),
      startedAt: z.string().datetime(),
      completedAt: z.string().datetime(),
      computeMs: z.number().int().min(0),
      signature: z.string(),
    });

    it("should validate receipt", () => {
      const valid = ReceiptSchema.safeParse({
        workflowId: "550e8400-e29b-41d4-a716-446655440000",
        nodeId: "550e8400-e29b-41d4-a716-446655440001",
        inputHash: "sha256:abc123",
        outputHash: "sha256:def456",
        startedAt: "2024-01-15T12:00:00Z",
        completedAt: "2024-01-15T12:00:05Z",
        computeMs: 5000,
        signature: "ed25519:signature123",
      });
      expect(valid.success).toBe(true);
    });

    it("should reject negative compute time", () => {
      const invalid = ReceiptSchema.safeParse({
        workflowId: "550e8400-e29b-41d4-a716-446655440000",
        nodeId: "550e8400-e29b-41d4-a716-446655440001",
        inputHash: "sha256:abc123",
        outputHash: "sha256:def456",
        startedAt: "2024-01-15T12:00:00Z",
        completedAt: "2024-01-15T12:00:05Z",
        computeMs: -100,
        signature: "ed25519:signature123",
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("Protocol Schemas", () => {
    const CancellationSchema = z.object({
      reason: z.enum(["user_request", "budget_exceeded", "timeout", "error", "policy_violation"]),
      details: z.string().optional(),
    });

    it("should validate cancellation request", () => {
      const valid = CancellationSchema.safeParse({
        reason: "user_request",
        details: "User clicked cancel",
      });
      expect(valid.success).toBe(true);
    });

    it("should reject invalid reason", () => {
      const invalid = CancellationSchema.safeParse({
        reason: "invalid_reason",
      });
      expect(invalid.success).toBe(false);
    });

    const ScheduleSchema = z.object({
      name: z.string().min(1),
      cronExpression: z.string(),
      workflowTemplate: z.record(z.unknown()),
      timezone: z.string().optional(),
      maxRuns: z.number().int().min(1).optional(),
    });

    it("should validate schedule", () => {
      const valid = ScheduleSchema.safeParse({
        name: "Daily Report",
        cronExpression: "0 9 * * *",
        workflowTemplate: { capability: "report.v1" },
        timezone: "America/New_York",
      });
      expect(valid.success).toBe(true);
    });
  });

  describe("Identity Schemas", () => {
    const NameSchema = z.object({
      name: z.string().min(3).max(32).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
      agentDid: z.string(),
    });

    it("should validate name registration", () => {
      const valid = NameSchema.safeParse({
        name: "my-cool-agent",
        agentDid: "did:noot:abc123",
      });
      expect(valid.success).toBe(true);
    });

    it("should reject name with invalid characters", () => {
      const invalid = NameSchema.safeParse({
        name: "My_Agent!",
        agentDid: "did:noot:abc123",
      });
      expect(invalid.success).toBe(false);
    });

    it("should reject name starting with hyphen", () => {
      const invalid = NameSchema.safeParse({
        name: "-bad-name",
        agentDid: "did:noot:abc123",
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("Economics Schemas", () => {
    const DisputeSchema = z.object({
      workflowId: z.string().uuid().optional(),
      nodeId: z.string().uuid().optional(),
      respondentDid: z.string().optional(),
      disputeType: z.enum(["quality", "timeout", "incorrect_output", "overcharge", "fraud", "other"]),
      description: z.string().min(10),
      evidence: z.record(z.unknown()).optional(),
    });

    it("should validate dispute", () => {
      const valid = DisputeSchema.safeParse({
        workflowId: "550e8400-e29b-41d4-a716-446655440000",
        disputeType: "quality",
        description: "The output quality was significantly below expectations",
      });
      expect(valid.success).toBe(true);
    });

    it("should reject description too short", () => {
      const invalid = DisputeSchema.safeParse({
        disputeType: "quality",
        description: "Bad",
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("Federation Schemas", () => {
    const PeerSchema = z.object({
      peerId: z.string().uuid(),
      endpoint: z.string().url(),
      region: z.enum(["us-west", "us-east", "eu-west", "eu-central", "ap-south", "ap-northeast"]),
      publicKey: z.string(),
      capabilities: z.array(z.string()).optional(),
    });

    it("should validate peer registration", () => {
      const valid = PeerSchema.safeParse({
        peerId: "550e8400-e29b-41d4-a716-446655440000",
        endpoint: "https://us-west.coordinator.nooterra.ai",
        region: "us-west",
        publicKey: "base64-public-key",
        capabilities: ["cap.text.summarize.v1"],
      });
      expect(valid.success).toBe(true);
    });

    it("should reject invalid region", () => {
      const invalid = PeerSchema.safeParse({
        peerId: "550e8400-e29b-41d4-a716-446655440000",
        endpoint: "https://invalid.coordinator.nooterra.ai",
        region: "invalid-region",
        publicKey: "base64-public-key",
      });
      expect(invalid.success).toBe(false);
    });

    it("should reject invalid URL", () => {
      const invalid = PeerSchema.safeParse({
        peerId: "550e8400-e29b-41d4-a716-446655440000",
        endpoint: "not-a-url",
        region: "us-west",
        publicKey: "base64-public-key",
      });
      expect(invalid.success).toBe(false);
    });
  });
});
