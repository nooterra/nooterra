import agentConfig from "./agent.config.mjs";
import { startAgentServer } from "@nooterra/agent-sdk";

startAgentServer(agentConfig).then(() => {
  console.log(`🌐 Genesis Browser Agent running on port ${agentConfig.port}`);
  console.log(`   DID: ${agentConfig.did}`);
  console.log(`   Endpoint: ${agentConfig.endpoint}`);
  console.log(`   Capabilities:`);
  agentConfig.capabilities.forEach((cap) => {
    console.log(`     - ${cap.id}: ${cap.description}`);
  });
});
