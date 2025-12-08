import { defineAgent, startAgentServer } from "@nooterra/agent-sdk";
import fetch from "node-fetch";

const webhookSecret = process.env.WEBHOOK_SECRET || "";
const agentDid = process.env.DID || "did:noot:verify";
const port = Number(process.env.PORT || 4200);

const coordUrl = process.env.RAILWAY_ENVIRONMENT
  ? process.env.INTERNAL_COORD_URL || "http://nooterra-coordinator.railway.internal:3002"
  : process.env.COORD_URL || "https://coord.nooterra.ai";

const agentConfig = defineAgent({
  did: agentDid,
  registryUrl: process.env.REGISTRY_URL || "https://api.nooterra.ai",
  coordinatorUrl: coordUrl,
  endpoint: process.env.AGENT_ENDPOINT || "https://agent-verify-production.up.railway.app",
  webhookSecret,
  publicKey: process.env.PUBLIC_KEY || "",
  privateKey: process.env.PRIVATE_KEY || "",
  port,
  capabilities: [
    {
      id: "cap.verify.generic.v1",
      description: "Generic verification agent (approves with simple check)",
      handler: async ({ parents }) => {
        return { result: { verified: true, parents }, metrics: { latency_ms: 120 } };
      },
    },
    {
      id: "cap.verify.mandate.envelope.v1",
      description:
        "Verify Mandate, AgentCard, and envelope signature compliance for an invocation",
      handler: async ({ inputs }) => {
        const invocationId =
          (inputs && (inputs.invocationId || inputs.invocation_id)) || null;
        if (!invocationId) {
          return {
            result: {
              compliant: false,
              issues: [
                {
                  code: "missing_invocation_id",
                  message: "inputs.invocationId is required",
                },
              ],
            },
            metrics: { latency_ms: 0 },
          };
        }

        const started = Date.now();
        try {
          const res = await fetch(`${coordUrl}/internal/verify/invocation/${invocationId}`);
          const body = await res.json().catch(() => null);

          if (!res.ok) {
            return {
              result: {
                compliant: false,
                issues: [
                  {
                    code: "verify_http_error",
                    message: `Coordinator returned ${res.status}`,
                  },
                ],
                raw: body,
              },
              metrics: { latency_ms: Date.now() - started },
            };
          }

          return {
            result: body,
            metrics: { latency_ms: Date.now() - started },
          };
        } catch (err) {
          return {
            result: {
              compliant: false,
              issues: [
                {
                  code: "verify_exception",
                  message: err?.message || "verification call failed",
                },
              ],
            },
            metrics: { latency_ms: Date.now() - started },
          };
        }
      },
    },
  ],
});

startAgentServer(agentConfig).then(() => {
  console.log(`Verify agent listening on ${port} as ${agentDid}`);
});
