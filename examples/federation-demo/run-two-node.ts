#!/usr/bin/env tsx
/**
 * Federation demo harness.
 *
 * This script wires two running coordinators together as federation peers and
 * prints guidance for running the reference workflow across them.
 *
 * It does NOT start the coordinators itself – you should run them separately, e.g.:
 *
 *   COORDINATOR_DID=did:noot:coord:A PORT=3002 pnpm dev:coordinator
 *   COORDINATOR_DID=did:noot:coord:B PORT=4002 pnpm dev:coordinator
 *
 * Environment variables:
 *   A_COORD_URL   (default: http://localhost:3002)
 *   B_COORD_URL   (default: http://localhost:4002)
 *   A_COORD_DID   (default: did:noot:coord:A)
 *   B_COORD_DID   (default: did:noot:coord:B)
 *
 * This script will:
 *   - register each coordinator as a peer of the other via /v1/federation/peers
 *   - print instructions for:
 *       - registering reference agents
 *       - ensuring the verify agent is executed on coordinator B
 *       - running the reference workflow on coordinator A
 *       - inspecting traces in the console
 */

import fetch from "node-fetch";

const A_COORD_URL = process.env.A_COORD_URL || "http://localhost:3002";
const B_COORD_URL = process.env.B_COORD_URL || "http://localhost:4002";
const A_COORD_DID = process.env.A_COORD_DID || "did:noot:coord:A";
const B_COORD_DID = process.env.B_COORD_DID || "did:noot:coord:B";

async function registerPeer(
  coordUrl: string,
  peerId: string,
  endpoint: string,
  region: string,
  publicKey: string
) {
  const payload = {
    peerId,
    endpoint,
    region,
    publicKey,
    capabilities: [],
  };

  const res = await fetch(`${coordUrl.replace(/\/$/, "")}/v1/federation/peers`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(
      `❌ Failed to register peer on ${coordUrl} (peerId=${peerId}):`,
      res.status,
      text
    );
    return false;
  }

  console.log(
    `✅ Registered peer on ${coordUrl} (peerId=${peerId}, endpoint=${endpoint}, region=${region})`
  );
  return true;
}

async function main() {
  console.log("🌐 Nooterra Federation Demo – Two Coordinator Setup");
  console.log("");
  console.log("Coordinator A:");
  console.log(`  DID : ${A_COORD_DID}`);
  console.log(`  URL : ${A_COORD_URL}`);
  console.log("");
  console.log("Coordinator B:");
  console.log(`  DID : ${B_COORD_DID}`);
  console.log(`  URL : ${B_COORD_URL}`);
  console.log("");

  console.log("🔗 Registering federation peers (A <-> B)...");

  // NOTE: publicKey is currently not enforced for coordinator-level signatures.
  // We pass a placeholder so the schema is satisfied.
  const placeholderKey = "coord-public-key-placeholder";

  const okA = await registerPeer(A_COORD_URL, B_COORD_DID, B_COORD_URL, "us-west", placeholderKey);
  const okB = await registerPeer(B_COORD_URL, A_COORD_DID, A_COORD_URL, "us-west", placeholderKey);

  if (!okA || !okB) {
    console.error("❌ Federation peer registration failed; aborting demo wiring.");
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("✅ Federation peers wired.");
  console.log("");
  console.log("Next steps:");
  console.log("");
  console.log("1) Ensure both coordinators are running with FEDERATION_TRUST_ALL=true, e.g.:");
  console.log(
    "   FEDERATION_TRUST_ALL=true COORDINATOR_DID=did:noot:coord:A PORT=3002 pnpm dev:coordinator"
  );
  console.log(
    "   FEDERATION_TRUST_ALL=true COORDINATOR_DID=did:noot:coord:B PORT=4002 pnpm dev:coordinator"
  );
  console.log("");
  console.log("2) Start the reference agents against the appropriate coordinator endpoints, e.g.:");
  console.log("   - fetch/summarize agents reachable from coordinator A");
  console.log("   - verify agent reachable from coordinator B");
  console.log("");
  console.log(
    "3) Make sure the verify agent's AgentCard marks coordinator B as its execution coordinator."
  );
  console.log(
    "   In practice this means its canonical card (or metadata) should include:"
  );
  console.log(
    `     executionCoordinatorDid = "${B_COORD_DID}"`
  );
  console.log(
    "   so that coordinator A will route verify calls via /v1/federation/invoke instead of direct HTTP."
  );
  console.log("");
  console.log(
    "4) From coordinator A's perspective, run the reference workflow as usual (COORD_URL pointing to A):"
  );
  console.log("   COORD_URL=http://localhost:3002 pnpm demo:reference-workflow");
  console.log("");
  console.log(
    "   The verify node (cap.verify.mandate.envelope.v1) should be dispatched via federation to coordinator B."
  );
  console.log("");
  console.log(
    "5) Use the console Trace Explorer on coordinator A to inspect the run (look for routingChannel=\"federation\")."
  );
  console.log("");
  console.log(
    "This harness only wires the peers and prints instructions – it does not modify AgentCards or start processes."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

