#!/usr/bin/env tsx
/**
 * Demo Health Check Script
 * 
 * Verifies the coordinator is healthy and runs a simple workflow
 * to exercise the Coordination Graph router.
 */
import fetch from "node-fetch";

const COORD_URL = process.env.COORD_URL || "https://coord.nooterra.ai";
const API_KEY = process.env.COORDINATOR_API_KEY || "playground-free-tier";

interface HealthResponse {
  status: string;
  database: { status: string };
  redis: { status: string };
}

interface RouterMetrics {
  totalComparisons: number;
  totalAgreements: number;
  totalDivergences: number;
  agreementRate: number;
  agreementRatePercent: string;
}

interface WorkflowResponse {
  workflowId: string;
  taskId: string;
  nodes: string[];
}

interface WorkflowStatus {
  workflow: { status: string };
  nodes: Array<{
    name: string;
    status: string;
    agent_did: string | null;
    result_payload?: any;
  }>;
}

async function main() {
  console.log("🔍 Nooterra Demo Health Check\n");
  console.log(`   Coordinator: ${COORD_URL}`);
  console.log(`   API Key: ${API_KEY.slice(0, 10)}...`);
  console.log("");

  // 1. Check coordinator health
  console.log("1️⃣  Checking coordinator health...");
  const healthRes = await fetch(`${COORD_URL}/health`);
  if (!healthRes.ok) {
    console.error("❌ Coordinator unhealthy:", healthRes.status);
    process.exit(1);
  }
  const health = (await healthRes.json()) as HealthResponse;
  console.log(`   ✅ Status: ${health.status}`);
  console.log(`   ✅ Database: ${health.database.status}`);
  console.log(`   ✅ Redis: ${health.redis.status}`);
  console.log("");

  // 2. Check router metrics
  console.log("2️⃣  Checking router metrics...");
  const metricsRes = await fetch(`${COORD_URL}/internal/router-metrics`);
  if (!metricsRes.ok) {
    console.warn("⚠️  Router metrics unavailable");
  } else {
    const metrics = (await metricsRes.json()) as RouterMetrics;
    console.log(`   📊 Total comparisons: ${metrics.totalComparisons}`);
    console.log(`   📊 Agreement rate: ${metrics.agreementRatePercent}`);
    console.log(`   📊 Divergences: ${metrics.totalDivergences}`);
  }
  console.log("");

  // 3. Run a simple workflow
  console.log("3️⃣  Running test workflow...");
  const publishRes = await fetch(`${COORD_URL}/v1/workflows/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      intent: "Health check test workflow",
      nodes: {
        generate: {
          capabilityId: "cap.text.generate.v1",
          payload: { prompt: "Say 'Hello from Nooterra!' in one sentence." },
        },
      },
    }),
  });

  if (!publishRes.ok) {
    const text = await publishRes.text();
    console.error("❌ Failed to publish workflow:", publishRes.status, text);
    process.exit(1);
  }

  const published = (await publishRes.json()) as WorkflowResponse;
  console.log(`   📦 Workflow published: ${published.workflowId}`);

  // 4. Wait for completion
  console.log("   ⏳ Waiting for completion...");
  const timeout = Date.now() + 60_000;
  let status: WorkflowStatus | null = null;

  while (Date.now() < timeout) {
    const statusRes = await fetch(`${COORD_URL}/v1/workflows/${published.workflowId}`, {
      headers: { "x-api-key": API_KEY },
    });
    
    if (statusRes.ok) {
      status = (await statusRes.json()) as WorkflowStatus;
      if (status.workflow.status === "success" || status.workflow.status === "failed") {
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!status) {
    console.error("❌ Timeout waiting for workflow");
    process.exit(1);
  }

  console.log(`   📊 Status: ${status.workflow.status}`);
  
  const node = status.nodes[0];
  if (node) {
    console.log(`   🤖 Agent: ${node.agent_did || "none"}`);
    if (node.result_payload?.response) {
      console.log(`   💬 Response: "${node.result_payload.response.slice(0, 100)}..."`);
    }
  }
  console.log("");

  // 5. Check updated metrics
  console.log("4️⃣  Updated router metrics...");
  const newMetricsRes = await fetch(`${COORD_URL}/internal/router-metrics`);
  if (newMetricsRes.ok) {
    const newMetrics = (await newMetricsRes.json()) as RouterMetrics;
    console.log(`   📊 Total comparisons: ${newMetrics.totalComparisons}`);
    console.log(`   📊 Agreement rate: ${newMetrics.agreementRatePercent}`);
  }
  console.log("");

  if (status.workflow.status === "success") {
    console.log("✅ Demo health check passed!");
  } else {
    console.log("❌ Demo health check failed");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
