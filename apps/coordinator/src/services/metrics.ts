/**
 * Observability Metrics Service
 * 
 * Provides structured metrics for monitoring the coordinator.
 * Exposes counters and histograms for key protocol operations.
 * 
 * Metrics are exposed via:
 * - GET /v1/metrics - JSON format for easy consumption
 * - GET /v1/metrics/prometheus - Prometheus text format
 * 
 * Key metrics:
 * - noot_budget_reserved_total - Budget reservations
 * - noot_budget_consumed_total - Budget consumed
 * - noot_budget_released_total - Budget released (refunds)
 * - noot_faults_total - Faults by type (timeout, error, schema_violation)
 * - noot_recovery_attempts_total - Recovery attempts by outcome
 * - noot_auctions_total - Auctions by outcome
 * - noot_dispatch_latency_seconds - Dispatch latency histogram
 */

// Counter storage
interface Counter {
  name: string;
  help: string;
  labels: string[];
  values: Map<string, number>;
}

// Histogram storage (using fixed buckets)
interface Histogram {
  name: string;
  help: string;
  labels: string[];
  buckets: number[];
  observations: Map<string, number[]>;
}

// Define all counters
const counters: Record<string, Counter> = {
  budget_reserved: {
    name: "noot_budget_reserved_total",
    help: "Total budget reserved for workflows in cents",
    labels: ["workflow_status"],
    values: new Map(),
  },
  budget_consumed: {
    name: "noot_budget_consumed_total",
    help: "Total budget consumed (confirmed) in cents",
    labels: ["capability"],
    values: new Map(),
  },
  budget_released: {
    name: "noot_budget_released_total",
    help: "Total budget released (refunded) in cents",
    labels: ["reason"],
    values: new Map(),
  },
  faults: {
    name: "noot_faults_total",
    help: "Total number of faults detected",
    labels: ["type", "blamed"],
    values: new Map(),
  },
  recovery_attempts: {
    name: "noot_recovery_attempts_total",
    help: "Total recovery attempts",
    labels: ["outcome"],
    values: new Map(),
  },
  recovery_success: {
    name: "noot_recovery_success_total",
    help: "Successful recovery attempts",
    labels: ["attempt_number"],
    values: new Map(),
  },
  auctions_created: {
    name: "noot_auctions_created_total",
    help: "Total auctions created",
    labels: ["capability"],
    values: new Map(),
  },
  auctions_resolved: {
    name: "noot_auctions_resolved_total",
    help: "Total auctions resolved",
    labels: ["outcome", "strategy"],
    values: new Map(),
  },
  bids_placed: {
    name: "noot_bids_placed_total",
    help: "Total bids placed in auctions",
    labels: ["capability"],
    values: new Map(),
  },
  payments_success: {
    name: "noot_payments_success_total",
    help: "Successful payments to agents",
    labels: ["capability"],
    values: new Map(),
  },
  payments_failed: {
    name: "noot_payments_failed_total",
    help: "Failed payments (slashed)",
    labels: ["reason"],
    values: new Map(),
  },
  circuit_breaker_trips: {
    name: "noot_circuit_breaker_trips_total",
    help: "Circuit breaker trips",
    labels: ["agent_did"],
    values: new Map(),
  },
  health_checks: {
    name: "noot_health_checks_total",
    help: "Health checks performed",
    labels: ["result"],
    values: new Map(),
  },
};

// Define histograms
const histograms: Record<string, Histogram> = {
  dispatch_latency: {
    name: "noot_dispatch_latency_seconds",
    help: "Time from enqueue to dispatch completion",
    labels: ["capability", "status"],
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    observations: new Map(),
  },
  auction_duration: {
    name: "noot_auction_duration_seconds",
    help: "Time from auction creation to resolution",
    labels: ["strategy"],
    buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
    observations: new Map(),
  },
  recovery_duration: {
    name: "noot_recovery_duration_seconds",
    help: "Time spent in recovery attempts",
    labels: ["outcome"],
    buckets: [1, 5, 10, 30, 60, 120, 300],
    observations: new Map(),
  },
};

/**
 * Make a label key from label values
 */
function makeLabelKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
}

/**
 * Increment a counter
 */
export function incCounter(
  name: keyof typeof counters,
  labels: Record<string, string>,
  value: number = 1
): void {
  const counter = counters[name];
  if (!counter) return;
  
  const key = makeLabelKey(labels);
  const current = counter.values.get(key) || 0;
  counter.values.set(key, current + value);
}

/**
 * Observe a value in a histogram
 */
export function observeHistogram(
  name: keyof typeof histograms,
  labels: Record<string, string>,
  value: number
): void {
  const histogram = histograms[name];
  if (!histogram) return;
  
  const key = makeLabelKey(labels);
  const observations = histogram.observations.get(key) || [];
  observations.push(value);
  histogram.observations.set(key, observations);
}

/**
 * Get all metrics as JSON
 */
export function getMetricsJson(): Record<string, unknown> {
  const result: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    counters: {} as Record<string, unknown>,
    histograms: {} as Record<string, unknown>,
  };
  
  // Export counters
  for (const [key, counter] of Object.entries(counters)) {
    const values: Record<string, number> = {};
    for (const [labelKey, value] of counter.values) {
      values[labelKey || "total"] = value;
    }
    (result.counters as Record<string, unknown>)[key] = {
      name: counter.name,
      help: counter.help,
      values,
    };
  }
  
  // Export histograms (compute percentiles)
  for (const [key, histogram] of Object.entries(histograms)) {
    const summaries: Record<string, unknown> = {};
    
    for (const [labelKey, observations] of histogram.observations) {
      if (observations.length === 0) continue;
      
      const sorted = [...observations].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      
      summaries[labelKey || "total"] = {
        count: observations.length,
        sum,
        avg: sum / observations.length,
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
      };
    }
    
    (result.histograms as Record<string, unknown>)[key] = {
      name: histogram.name,
      help: histogram.help,
      buckets: histogram.buckets,
      summaries,
    };
  }
  
  return result;
}

/**
 * Get metrics in Prometheus text format
 */
export function getMetricsPrometheus(): string {
  const lines: string[] = [];
  
  // Export counters
  for (const counter of Object.values(counters)) {
    lines.push(`# HELP ${counter.name} ${counter.help}`);
    lines.push(`# TYPE ${counter.name} counter`);
    
    for (const [labelKey, value] of counter.values) {
      if (labelKey) {
        lines.push(`${counter.name}{${labelKey}} ${value}`);
      } else {
        lines.push(`${counter.name} ${value}`);
      }
    }
    lines.push("");
  }
  
  // Export histograms
  for (const histogram of Object.values(histograms)) {
    lines.push(`# HELP ${histogram.name} ${histogram.help}`);
    lines.push(`# TYPE ${histogram.name} histogram`);
    
    for (const [labelKey, observations] of histogram.observations) {
      if (observations.length === 0) continue;
      
      const sorted = [...observations].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      const count = observations.length;
      
      // Emit bucket counts
      for (const bucket of histogram.buckets) {
        const bucketCount = sorted.filter(v => v <= bucket).length;
        if (labelKey) {
          lines.push(`${histogram.name}_bucket{${labelKey},le="${bucket}"} ${bucketCount}`);
        } else {
          lines.push(`${histogram.name}_bucket{le="${bucket}"} ${bucketCount}`);
        }
      }
      
      // +Inf bucket
      if (labelKey) {
        lines.push(`${histogram.name}_bucket{${labelKey},le="+Inf"} ${count}`);
        lines.push(`${histogram.name}_sum{${labelKey}} ${sum}`);
        lines.push(`${histogram.name}_count{${labelKey}} ${count}`);
      } else {
        lines.push(`${histogram.name}_bucket{le="+Inf"} ${count}`);
        lines.push(`${histogram.name}_sum ${sum}`);
        lines.push(`${histogram.name}_count ${count}`);
      }
    }
    lines.push("");
  }
  
  return lines.join("\n");
}

/**
 * Reset all metrics (for testing)
 */
export function resetMetrics(): void {
  for (const counter of Object.values(counters)) {
    counter.values.clear();
  }
  for (const histogram of Object.values(histograms)) {
    histogram.observations.clear();
  }
}

// Convenience functions for common operations

export function recordBudgetReserved(amountCents: number): void {
  incCounter("budget_reserved", { workflow_status: "active" }, amountCents);
}

export function recordBudgetConsumed(capability: string, amountCents: number): void {
  incCounter("budget_consumed", { capability }, amountCents);
}

export function recordBudgetReleased(reason: "refund" | "timeout" | "recovery", amountCents: number): void {
  incCounter("budget_released", { reason }, amountCents);
}

export function recordFault(faultType: string, blamed: string | null): void {
  incCounter("faults", { type: faultType, blamed: blamed ? "agent" : "unknown" });
}

export function recordRecoveryAttempt(outcome: "success" | "failed" | "exhausted"): void {
  incCounter("recovery_attempts", { outcome });
}

export function recordRecoverySuccess(attemptNumber: number): void {
  incCounter("recovery_success", { attempt_number: String(attemptNumber) });
}

export function recordAuctionCreated(capability: string): void {
  incCounter("auctions_created", { capability });
}

export function recordAuctionResolved(outcome: "winner" | "no_bids" | "timeout", strategy: string): void {
  incCounter("auctions_resolved", { outcome, strategy });
}

export function recordBidPlaced(capability: string): void {
  incCounter("bids_placed", { capability });
}

export function recordPaymentSuccess(capability: string): void {
  incCounter("payments_success", { capability });
}

export function recordPaymentFailed(reason: string): void {
  incCounter("payments_failed", { reason });
}

export function recordCircuitBreakerTrip(agentDid: string): void {
  // Truncate DID for cardinality control
  const truncatedDid = agentDid.slice(0, 32);
  incCounter("circuit_breaker_trips", { agent_did: truncatedDid });
}

export function recordHealthCheck(result: "healthy" | "degraded" | "unhealthy"): void {
  incCounter("health_checks", { result });
}

export function recordDispatchLatency(capability: string, status: "success" | "error", durationSeconds: number): void {
  observeHistogram("dispatch_latency", { capability, status }, durationSeconds);
}

export function recordAuctionDuration(strategy: string, durationSeconds: number): void {
  observeHistogram("auction_duration", { strategy }, durationSeconds);
}

export function recordRecoveryDuration(outcome: "success" | "failed", durationSeconds: number): void {
  observeHistogram("recovery_duration", { outcome }, durationSeconds);
}
