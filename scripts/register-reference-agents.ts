#!/usr/bin/env tsx
import fetch from "node-fetch";

const REGISTRY_URL = process.env.REGISTRY_URL || "https://api.nooterra.ai";
const REGISTRY_API_KEY = process.env.REGISTRY_API_KEY || "";

interface ReferenceAgent {
  did: string;
  name: string;
  endpoint: string;
  capabilities: {
    capabilityId: string;
    description: string;
    tags?: string[];
  }[];
}

const REFERENCE_AGENTS: ReferenceAgent[] = [
  {
    did: "did:noot:agent:fetch-http",
    name: "Reference HTTP Fetch Agent",
    endpoint: process.env.REF_FETCH_ENDPOINT || "http://localhost:4201/nooterra/node",
    capabilities: [
      {
        capabilityId: "cap.fetch.http.v1",
        description: "Fetch JSON or text from a public HTTP endpoint",
        tags: ["http", "fetch", "reference"],
      },
    ],
  },
  {
    did: "did:noot:agent:summarize",
    name: "Reference Summarizer Agent",
    endpoint: process.env.REF_SUMMARIZE_ENDPOINT || "http://localhost:4202/nooterra/node",
    capabilities: [
      {
        capabilityId: "cap.text.summarize.v1",
        description: "Summarize text using an LLM rail",
        tags: ["llm", "summarize", "reference"],
      },
    ],
  },
  {
    did: "did:noot:agent:verify-mandate",
    name: "Reference Mandate/Envelope Verifier Agent",
    endpoint: process.env.REF_VERIFY_ENDPOINT || "http://localhost:4200/nooterra/node",
    capabilities: [
      {
        capabilityId: "cap.verify.mandate.envelope.v1",
        description:
          "Verify Mandate, AgentCard, and envelope signature compliance for an invocation",
        tags: ["verify", "mandate", "envelope", "reference"],
      },
    ],
  },
];

async function registerAgent(agent: ReferenceAgent): Promise<boolean> {
  console.log(`\n🔗 Registering reference agent ${agent.name} (${agent.did})`);

  const payload = {
    did: agent.did,
    name: agent.name,
    endpoint: agent.endpoint,
    capabilities: agent.capabilities.map((c) => ({
      capabilityId: c.capabilityId,
      description: c.description,
      tags: c.tags,
    })),
  };

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (REGISTRY_API_KEY) {
    headers["x-api-key"] = REGISTRY_API_KEY;
  }

  const res = await fetch(`${REGISTRY_URL}/v1/agent/register`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`   ❌ Failed: ${res.status} ${text}`);
    return false;
  }
  console.log(`   ✅ Registered: ${text.trim()}`);
  return true;
}

async function main() {
  console.log("🚀 Registering reference agents");
  console.log(`Registry: ${REGISTRY_URL}`);

  let ok = 0;
  let fail = 0;
  for (const agent of REFERENCE_AGENTS) {
    const res = await registerAgent(agent);
    if (res) ok++;
    else fail++;
  }

  console.log("\nSummary:");
  console.log(`  ✅ Registered: ${ok}`);
  console.log(`  ❌ Failed    : ${fail}`);

  if (fail > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

