/**
 * Metrics Routes
 * 
 * Exposes observability metrics for monitoring.
 * 
 * Routes:
 * - GET /v1/metrics - JSON format metrics
 * - GET /v1/metrics/prometheus - Prometheus text format
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getMetricsJson, getMetricsPrometheus } from "../services/metrics.js";

export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/metrics - Get metrics in JSON format
   */
  app.get("/v1/metrics", async (request: FastifyRequest, reply: FastifyReply) => {
    const metrics = getMetricsJson();
    return reply.send(metrics);
  });

  /**
   * GET /v1/metrics/prometheus - Get metrics in Prometheus text format
   */
  app.get("/v1/metrics/prometheus", async (request: FastifyRequest, reply: FastifyReply) => {
    const metrics = getMetricsPrometheus();
    return reply
      .header("Content-Type", "text/plain; charset=utf-8")
      .send(metrics);
  });

  app.log.info("Metrics routes registered");
}
