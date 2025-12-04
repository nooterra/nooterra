/**
 * Metrics Service Tests
 * 
 * Tests the observability metrics collection and export.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  incCounter,
  observeHistogram,
  getMetricsJson,
  getMetricsPrometheus,
  resetMetrics,
  recordBudgetReserved,
  recordBudgetConsumed,
  recordFault,
  recordRecoveryAttempt,
  recordPaymentSuccess,
  recordDispatchLatency,
} from "../services/metrics.js";

describe("Metrics Service", () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe("Counter Operations", () => {
    it("should increment counter", () => {
      incCounter("faults", { type: "timeout", blamed: "agent" });
      incCounter("faults", { type: "timeout", blamed: "agent" });
      incCounter("faults", { type: "error", blamed: "agent" });

      const metrics = getMetricsJson();
      const faults = (metrics.counters as any).faults;

      expect(faults.values['blamed="agent",type="timeout"']).toBe(2);
      expect(faults.values['blamed="agent",type="error"']).toBe(1);
    });

    it("should increment by custom value", () => {
      incCounter("budget_reserved", { workflow_status: "active" }, 500);
      incCounter("budget_reserved", { workflow_status: "active" }, 300);

      const metrics = getMetricsJson();
      const reserved = (metrics.counters as any).budget_reserved;

      expect(reserved.values['workflow_status="active"']).toBe(800);
    });
  });

  describe("Histogram Operations", () => {
    it("should observe values", () => {
      observeHistogram("dispatch_latency", { capability: "test", status: "success" }, 0.5);
      observeHistogram("dispatch_latency", { capability: "test", status: "success" }, 1.2);
      observeHistogram("dispatch_latency", { capability: "test", status: "success" }, 0.8);

      const metrics = getMetricsJson();
      const latency = (metrics.histograms as any).dispatch_latency;
      const summary = latency.summaries['capability="test",status="success"'];

      expect(summary.count).toBe(3);
      expect(summary.avg).toBeCloseTo(0.833, 2);
    });
  });

  describe("Convenience Functions", () => {
    it("recordBudgetReserved should increment budget_reserved counter", () => {
      recordBudgetReserved(1000);

      const metrics = getMetricsJson();
      const reserved = (metrics.counters as any).budget_reserved;

      expect(reserved.values['workflow_status="active"']).toBe(1000);
    });

    it("recordBudgetConsumed should track by capability", () => {
      recordBudgetConsumed("cap.text.v1", 500);
      recordBudgetConsumed("cap.code.v1", 300);

      const metrics = getMetricsJson();
      const consumed = (metrics.counters as any).budget_consumed;

      expect(consumed.values['capability="cap.text.v1"']).toBe(500);
      expect(consumed.values['capability="cap.code.v1"']).toBe(300);
    });

    it("recordFault should track by type and blamed", () => {
      recordFault("timeout", "did:noot:agent1");
      recordFault("error", null);

      const metrics = getMetricsJson();
      const faults = (metrics.counters as any).faults;

      expect(faults.values['blamed="agent",type="timeout"']).toBe(1);
      expect(faults.values['blamed="unknown",type="error"']).toBe(1);
    });

    it("recordRecoveryAttempt should track outcomes", () => {
      recordRecoveryAttempt("success");
      recordRecoveryAttempt("success");
      recordRecoveryAttempt("failed");

      const metrics = getMetricsJson();
      const recovery = (metrics.counters as any).recovery_attempts;

      expect(recovery.values['outcome="success"']).toBe(2);
      expect(recovery.values['outcome="failed"']).toBe(1);
    });

    it("recordPaymentSuccess should track by capability", () => {
      recordPaymentSuccess("cap.weather.v1");

      const metrics = getMetricsJson();
      const payments = (metrics.counters as any).payments_success;

      expect(payments.values['capability="cap.weather.v1"']).toBe(1);
    });

    it("recordDispatchLatency should observe histogram", () => {
      recordDispatchLatency("cap.test.v1", "success", 1.5);
      recordDispatchLatency("cap.test.v1", "error", 5.0);

      const metrics = getMetricsJson();
      const latency = (metrics.histograms as any).dispatch_latency;

      expect(latency.summaries['capability="cap.test.v1",status="success"'].count).toBe(1);
      expect(latency.summaries['capability="cap.test.v1",status="error"'].count).toBe(1);
    });
  });

  describe("Prometheus Export", () => {
    it("should export counters in Prometheus format", () => {
      incCounter("faults", { type: "timeout", blamed: "agent" }, 5);

      const prometheus = getMetricsPrometheus();

      expect(prometheus).toContain("# HELP noot_faults_total");
      expect(prometheus).toContain("# TYPE noot_faults_total counter");
      expect(prometheus).toContain('noot_faults_total{blamed="agent",type="timeout"} 5');
    });

    it("should export histograms with buckets", () => {
      observeHistogram("dispatch_latency", { capability: "test", status: "success" }, 0.5);
      observeHistogram("dispatch_latency", { capability: "test", status: "success" }, 2.0);

      const prometheus = getMetricsPrometheus();

      expect(prometheus).toContain("# HELP noot_dispatch_latency_seconds");
      expect(prometheus).toContain("# TYPE noot_dispatch_latency_seconds histogram");
      expect(prometheus).toContain("_bucket{");
      expect(prometheus).toContain("_sum{");
      expect(prometheus).toContain("_count{");
    });
  });

  describe("Reset", () => {
    it("should clear all metrics", () => {
      incCounter("faults", { type: "timeout", blamed: "agent" }, 10);
      observeHistogram("dispatch_latency", { capability: "test", status: "success" }, 1.0);

      resetMetrics();

      const metrics = getMetricsJson();
      const faults = (metrics.counters as any).faults;
      const latency = (metrics.histograms as any).dispatch_latency;

      expect(Object.keys(faults.values).length).toBe(0);
      expect(Object.keys(latency.summaries).length).toBe(0);
    });
  });
});
