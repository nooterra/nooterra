#!/usr/bin/env node
/**
 * Simple Demo Workflow
 * 
 * Creates a basic 2-node workflow to verify the system is working.
 * 
 * Usage:
 *   node demo.js
 *   COORD_URL=https://coord.nooterra.ai node demo.js
 */

const COORD_URL = process.env.COORD_URL || "https://coord.nooterra.ai";

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           🎯 Nooterra Quick Demo                              ║
╠═══════════════════════════════════════════════════════════════╣
║  Coordinator: ${COORD_URL.padEnd(43)} ║
╚═══════════════════════════════════════════════════════════════╝
  `);

  // Step 1: Check health
  console.log("1️⃣  Checking coordinator health...");
  try {
    const healthRes = await fetch(`${COORD_URL}/health`);
    const health = await healthRes.json();
    console.log(`   ✅ Coordinator: ${health.status}`);
    console.log(`   📦 Version: ${health.version}`);
    console.log(`   🗄️  Database: ${health.database?.status}`);
    console.log(`   🔴 Redis: ${health.redis?.status}\n`);
  } catch (err) {
    console.log(`   ❌ Health check failed: ${err.message}\n`);
    return;
  }

  // Step 2: Create a simple task
  console.log("2️⃣  Creating demo task...");
  try {
    const taskRes = await fetch(`${COORD_URL}/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "demo-test-" + Date.now(),
        input: { message: "Hello from Nooterra demo!" },
        budget_cents: 10,
      }),
    });

    if (!taskRes.ok) {
      const error = await taskRes.text();
      console.log(`   ❌ Failed to create: ${error}\n`);
    } else {
      const task = await taskRes.json();
      console.log(`   ✅ Task ID: ${task.id || task.task?.id}`);
      console.log(`   📋 Status: ${task.status || "created"}\n`);
    }

    // Step 3: Check existing tasks
    console.log("3️⃣  Fetching recent tasks...");
    const listRes = await fetch(`${COORD_URL}/v1/tasks?limit=5`);
    const list = await listRes.json();
    
    console.log(`   📊 Found ${list.tasks?.length || 0} tasks:\n`);
    
    for (const t of (list.tasks || []).slice(0, 5)) {
      const statusIcon = t.status === "success" || t.status === "completed" ? "✅" : t.status === "failed" ? "❌" : "⏳";
      console.log(`   ${statusIcon} ${t.id?.slice(0, 8)}... | ${(t.intent || "").slice(0, 30).padEnd(30)} | ${t.status}`);
    }

  } catch (err) {
    console.log(`   ❌ Error: ${err.message}\n`);
  }

  // Step 4: Check metrics
  console.log("\n4️⃣  Checking metrics endpoint...");
  try {
    const metricsRes = await fetch(`${COORD_URL}/v1/metrics/prometheus`);
    if (metricsRes.ok) {
      const metrics = await metricsRes.text();
      const lines = metrics.split("\n").filter(l => !l.startsWith("#")).slice(0, 5);
      console.log("   ✅ Metrics available:");
      for (const line of lines) {
        if (line.trim()) console.log(`      ${line}`);
      }
    } else {
      console.log("   ⚠️  Metrics endpoint not available (may need to be enabled)");
    }
  } catch (err) {
    console.log(`   ⚠️  Metrics: ${err.message}`);
  }

  console.log(`
═══════════════════════════════════════════════════════════════
✅ Demo complete! Your Nooterra instance is working.

Next steps:
  • Visit https://www.nooterra.ai to see the console
  • Run example workflows: node workflows/content-pipeline.js  
  • Register your own agent: examples/agent-huggingface/

Docs: https://docs.nooterra.ai
═══════════════════════════════════════════════════════════════
  `);
}

main().catch(console.error);
