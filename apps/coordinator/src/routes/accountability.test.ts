import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import { registerAccountabilityRoutes } from "./accountability.js";
import { pool } from "../db.js";
import { storeReceipt } from "../services/receipt.js";
import { migrate } from "../db.js";

/**
 * Integration tests for receipts endpoints.
 * Uses real DB connection defined by POSTGRES_URL (test db recommended).
 */

describe("receipts integration", () => {
  const app = Fastify();

  beforeAll(async () => {
    await migrate();
    await registerAccountabilityRoutes(app as any);
    await app.ready();
    (pool.query as any) = vi.fn(pool.query.bind(pool));
    // Minimal fixture: workflow + node + receipt
    await pool.query(`insert into workflows (id, task_id, status) values ('wf-test', gen_random_uuid(), 'success') on conflict do nothing`);
    await pool.query(
      `insert into task_nodes (id, workflow_id, name, capability_id, status, depends_on, payload, max_attempts, requires_verification)
       values ('node-test', 'wf-test', 'main', 'cap.test.v1', 'success', '{}', '{}', 3, false)
       on conflict do nothing`
    );
  });

  afterAll(async () => {
    await app.close();
    await pool.query(`delete from task_receipts where workflow_id = 'wf-test'`);
    await pool.query(`delete from task_nodes where workflow_id = 'wf-test'`);
    await pool.query(`delete from workflows where id = 'wf-test'`);
  });

  it("verifies a valid receipt envelope", async () => {
    // Store a signed receipt (will be unsigned if COORDINATOR_PRIVATE_KEY_B58 is not set)
    await storeReceipt({
      workflowId: "wf-test",
      nodeName: "main",
      agentDid: "did:noot:test-agent",
      capabilityId: "cap.test.v1",
      output: { ok: true },
      input: { hello: "world" },
      creditsEarned: 10,
      profile: 3,
    });

    const receiptRow = await pool.query(
      `select receipt_cose, receipt_kid from task_receipts where workflow_id = 'wf-test' limit 1`
    );
    if (!receiptRow?.rowCount) {
      return;
    }

    const envelope = receiptRow.rows[0].receipt_cose ? JSON.parse(receiptRow.rows[0].receipt_cose) : null;
    const pub = process.env.COORDINATOR_PUBLIC_KEY_B58 || null;

    if (envelope && pub) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/receipts/verify",
        payload: { envelope, publicKey: pub },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as any;
      expect(body.valid).toBe(true);
      expect(body.claims?.cap).toBe("cap.test.v1");
    }
  });

  it("aggregates trace context including invocations", async () => {
    const traceId = "trace-test";
    (pool.query as any).mockReset();
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ id: "wf1", trace_id: traceId }] }) // workflows
      .mockResolvedValueOnce({ rows: [{ id: "node1", trace_id: traceId }] }) // task_nodes
      .mockResolvedValueOnce({ rows: [{ id: "rcpt1", trace_id: traceId }] }) // receipts
      .mockResolvedValueOnce({ rows: [{ id: "ledger1", trace_id: traceId }] }) // ledger
      .mockResolvedValueOnce({ rows: [{ invocation_id: "inv1", trace_id: traceId }] }); // invocations

    const res = await app.inject({
      method: "GET",
      url: `/internal/trace/${traceId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.traceId).toBe(traceId);
    expect(body.workflows[0].id).toBe("wf1");
    expect(body.taskNodes[0].id).toBe("node1");
    expect(body.receipts[0].id).toBe("rcpt1");
    expect(body.ledgerEvents[0].id).toBe("ledger1");
    expect(body.invocations[0].invocation_id).toBe("inv1");
  });
});
