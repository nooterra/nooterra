#!/usr/bin/env tsx
import fetch from "node-fetch";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

const COORD_URL = process.env.COORD_URL || "http://localhost:3002";
const API_KEY = process.env.COORDINATOR_API_KEY || "";

async function main() {
  const wfPath = path.join(
    process.cwd(),
    "examples",
    "reference-workflow",
    "workflow.json"
  );
  const raw = fs.readFileSync(wfPath, "utf-8");
  const manifest = JSON.parse(raw);

  // Transform workflow.json format to API format
  // workflow.json uses: { capability, inputMapping, dependsOn }
  // API expects: { capabilityId, payload, dependsOn }
  const transformedNodes: Record<string, any> = {};
  for (const [nodeName, nodeSpec] of Object.entries(manifest.nodes as Record<string, any>)) {
    transformedNodes[nodeName] = {
      capabilityId: nodeSpec.capability,
      dependsOn: nodeSpec.dependsOn || [],
      payload: {
        ...nodeSpec.inputMapping,
        // Include workflow-level inputs for the first node
        ...((!nodeSpec.dependsOn || nodeSpec.dependsOn.length === 0) ? manifest.inputs : {}),
      },
    };
  }

  console.log("📦 Publishing reference workflow...");

  const publishRes = await fetch(`${COORD_URL}/v1/workflows/publish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    },
    body: JSON.stringify({
      intent: manifest.description || manifest.name,
      nodes: transformedNodes,
    }),
  });

  if (!publishRes.ok) {
    const text = await publishRes.text();
    console.error("❌ publish failed:", publishRes.status, text);
    process.exit(1);
  }

  const publishBody = (await publishRes.json()) as any;
  const workflowId = publishBody.workflowId as string;
  console.log("✅ Workflow published:", workflowId);

  // Note: Mandate endpoint not yet implemented, skipping
  // console.log("📝 Attaching mandate...");

  console.log("⏳ Waiting for workflow completion...");

  let status = "pending";
  let traceId: string | null = null;
  const timeoutAt = Date.now() + 5 * 60_000;

  while (Date.now() < timeoutAt) {
    const res = await fetch(`${COORD_URL}/v1/workflows/${workflowId}`, {
      headers: {
        ...(API_KEY ? { "x-api-key": API_KEY } : {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("❌ status failed:", res.status, text);
      process.exit(1);
    }
    const body = (await res.json()) as any;
    status = body.status;
    traceId = body.manifest?.traceId || body.traceId || traceId;

    if (status === "success" || status === "failed") {
      break;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }

  console.log("📊 Final status:", status);
  if (traceId) {
    console.log("🔍 Trace ID:", traceId);
  } else {
    console.log(
      "⚠️ No traceId found; you can still use workflowId to inspect receipts."
    );
  }

  if (status !== "success") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

