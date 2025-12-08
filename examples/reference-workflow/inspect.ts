#!/usr/bin/env tsx
import fetch from "node-fetch";

const COORD_URL = process.env.COORD_URL || "http://localhost:3002";
const API_KEY = process.env.COORDINATOR_API_KEY || "";

async function main() {
  const traceId = process.argv[2];
  if (!traceId) {
    console.error("Usage: pnpm demo:inspect <traceId>");
    process.exit(1);
  }

  const res = await fetch(`${COORD_URL}/internal/trace/${traceId}`, {
    headers: {
      ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("❌ trace lookup failed:", res.status, text);
    process.exit(1);
  }

  const body = (await res.json()) as any;
  console.log(`Trace ${body.traceId}`);

  console.log("\nWorkflows:");
  for (const wf of body.workflows || []) {
    console.log(`  - ${wf.id} status=${wf.status ?? "unknown"}`);
  }

  console.log("\nNodes:");
  for (const node of body.taskNodes || []) {
    console.log(
      `  - ${node.name || node.node_name} cap=${node.capability_id} agent=${node.agent_did} status=${node.status}`
    );
  }

  console.log("\nReceipts:");
  for (const rcpt of body.receipts || []) {
    console.log(
      `  - node=${rcpt.node_name} agent=${rcpt.agent_did} cap=${rcpt.capability_id} mandate=${rcpt.mandate_id} env_sig_valid=${rcpt.envelope_signature_valid}`
    );
  }

  console.log("\nInvocations:");
  for (const inv of body.invocations || []) {
    console.log(
      `  - ${inv.invocation_id} wf=${inv.workflow_id} node=${inv.node_name} cap=${inv.capability_id} agent=${inv.agent_did} mandate=${inv.mandate_id}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

