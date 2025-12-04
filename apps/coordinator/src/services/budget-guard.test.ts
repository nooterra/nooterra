/**
 * Budget Guard Tests
 * 
 * Tests budget reservation and enforcement logic.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { pool } from "../db.js";

// Import after mocking
import {
  checkBudget,
  reserveBudget,
  releaseBudget,
  confirmBudget,
  getBudgetSummary,
} from "../services/budget-guard.js";

// Get typed mock references
const mockQuery = vi.mocked(pool.query);
const mockConnect = vi.mocked(pool.connect);

describe("Budget Guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkBudget", () => {
    it("should allow dispatch when budget is available", async () => {
      // First query: get workflow budget info
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ max_cents: 1000, spent_cents: 200, status: "running" }],
          rowCount: 1,
        } as any)
        // Second query: get capability price
        .mockResolvedValueOnce({
          rows: [{ price_cents: 50 }],
          rowCount: 1,
        } as any);

      const result = await checkBudget("wf-1", "node-1", "cap.test.v1");

      expect(result.allowed).toBe(true);
      expect(result.availableBudget).toBe(800);
    });

    it("should deny dispatch when budget is exceeded", async () => {
      // max=1000, spent=950, available=50, price=100 -> exceed
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ max_cents: 1000, spent_cents: 950, status: "running" }],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [{ price_cents: 100 }],
          rowCount: 1,
        } as any);

      const result = await checkBudget("wf-1", "node-1", "cap.test.v1");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("budget");
    });

    it("should allow any budget when max_cents is null (unlimited)", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ max_cents: null, spent_cents: 5000, status: "running" }],
          rowCount: 1,
        } as any);
      // No second query needed - returns early when no limit

      const result = await checkBudget("wf-1", "node-1", "cap.test.v1");

      expect(result.allowed).toBe(true);
    });

    it("should use bid amount when provided", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ max_cents: 1000, spent_cents: 800, status: "running" }],
          rowCount: 1,
        } as any);
      // No capability query when bid amount provided

      const result = await checkBudget("wf-1", "node-1", "cap.test.v1", 150);

      expect(result.allowed).toBe(true);
      expect(result.requiredBudget).toBe(150);
    });
  });

  describe("reserveBudget", () => {
    it("should reserve budget atomically", async () => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ max_cents: 1000, spent_cents: 100 }], rowCount: 1 }) // SELECT FOR UPDATE
          .mockResolvedValueOnce({}) // UPDATE workflows
          .mockResolvedValueOnce({}), // INSERT budget_reservations (will COMMIT after this)
        release: vi.fn(),
      };
      
      // Make COMMIT resolve properly
      mockClient.query.mockResolvedValueOnce({});
      
      mockConnect.mockResolvedValue(mockClient as any);

      const result = await reserveBudget("wf-1", "node-1", 100);

      expect(result).toBe(true);
      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("should rollback on error", async () => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockRejectedValueOnce(new Error("DB error")), // SELECT fails
        release: vi.fn(),
      };
      mockConnect.mockResolvedValue(mockClient as any);

      const result = await reserveBudget("wf-1", "node-1", 100);

      expect(result).toBe(false);
      expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe("releaseBudget", () => {
    it("should release reserved budget", async () => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ amount_cents: 100 }], rowCount: 1 }) // SELECT
          .mockResolvedValueOnce({}) // UPDATE workflows
          .mockResolvedValueOnce({}) // UPDATE reservations
          .mockResolvedValueOnce({}), // COMMIT
        release: vi.fn(),
      };
      mockConnect.mockResolvedValue(mockClient as any);

      const result = await releaseBudget("wf-1", "node-1");

      expect(result).toBe(true);
    });

    it("should return false if no reservation found", async () => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // SELECT - no reservation
          .mockResolvedValueOnce({}), // ROLLBACK
        release: vi.fn(),
      };
      mockConnect.mockResolvedValue(mockClient as any);

      const result = await releaseBudget("wf-1", "node-1");

      expect(result).toBe(false); // Changed from true - no reservation = false
    });
  });

  describe("confirmBudget", () => {
    it("should mark reservation as consumed", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ amount_cents: 100 }], rowCount: 1 } as any)
        .mockResolvedValueOnce({ rowCount: 1 } as any);

      await confirmBudget("wf-1", "node-1", "cap.test.v1");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE budget_reservations"),
        expect.arrayContaining(["wf-1", "node-1"])
      );
    });
  });

  describe("getBudgetSummary", () => {
    it("should return budget summary", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ max_cents: 1000, spent_cents: 300 }],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [{ reserved: 100 }],
          rowCount: 1,
        } as any);

      const result = await getBudgetSummary("wf-1");

      expect(result).toEqual({
        maxCents: 1000,
        spentCents: 300,
        availableCents: 700,
        reservedCents: 100,
      });
    });

    it("should return null for non-existent workflow", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      const result = await getBudgetSummary("wf-nonexistent");

      expect(result).toBeNull();
    });
  });
});
