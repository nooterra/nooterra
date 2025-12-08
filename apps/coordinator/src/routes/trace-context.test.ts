import { describe, it, expect, beforeAll, vi } from "vitest";
import Fastify from "fastify";
import { registerAccountabilityRoutes } from "./accountability.js";
import { pool } from "../db.js";

describe("trace context aggregation (internal)", () => {
  const app = Fastify();
  const traceId = "trace-test";

  beforeAll(async () => {
    await registerAccountabilityRoutes(app as any);
    await app.ready();
  });

  it("returns aggregated context for a trace", async () => {
    (pool.query as any).mockReset();
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ id: "wf1", trace_id: traceId }] }) // workflows
      .mockResolvedValueOnce({ rows: [{ id: "node1", trace_id: traceId }] }) // task_nodes
      .mockResolvedValueOnce({ rows: [{ id: "rcpt1", trace_id: traceId }] }) // receipts
      .mockResolvedValueOnce({ rows: [{ id: "ledger1", trace_id: traceId }] }); // ledger

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
  });
});
