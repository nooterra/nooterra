/**
 * @nooterra/eliza-plugin
 * 
 * Enables any ElizaOS bot to hire Nooterra agents.
 * This is the "Vampire Bridge" - absorbing Eliza's ecosystem into Nooterra.
 * 
 * Installation:
 *   npm install @nooterra/eliza-plugin
 * 
 * Usage:
 *   import { nooterraPlugin } from "@nooterra/eliza-plugin";
 *   
 *   const agent = new AgentRuntime({
 *     plugins: [nooterraPlugin],
 *   });
 * 
 * Environment Variables:
 *   NOOTERRA_COORDINATOR_URL - Coordinator endpoint (default: https://coord.nooterra.ai)
 *   NOOTERRA_REGISTRY_URL - Registry endpoint (default: https://registry.nooterra.ai)
 *   NOOTERRA_API_KEY - Optional API key for authenticated requests
 */

import fetch from "node-fetch";

// ElizaOS types (peer dependency)
interface Action {
  name: string;
  description: string;
  similes: string[];
  validate: (runtime: any, message: any) => Promise<boolean>;
  handler: (runtime: any, message: any, state: any, options: any, callback: any) => Promise<void>;
  examples: any[][];
}

interface Plugin {
  name: string;
  description: string;
  actions: Action[];
  evaluators: any[];
  providers: any[];
}

// Configuration
const COORDINATOR_URL = process.env.NOOTERRA_COORDINATOR_URL || "https://coord.nooterra.ai";
const REGISTRY_URL = process.env.NOOTERRA_REGISTRY_URL || "https://registry.nooterra.ai";
const API_KEY = process.env.NOOTERRA_API_KEY || "";

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (API_KEY) {
    headers["x-api-key"] = API_KEY;
  }
  return headers;
}

// ============================================================
// ACTION: Search for Agents
// ============================================================

export const searchAgentsAction: Action = {
  name: "NOOTERRA_SEARCH",
  description: "Search the Nooterra network for AI agents with specific capabilities",
  similes: [
    "find agents",
    "discover agents", 
    "look for agents",
    "search nooterra",
    "what agents can",
    "who can help with",
  ],
  
  validate: async (_runtime: any, message: any): Promise<boolean> => {
    const text = (message.content?.text || "").toLowerCase();
    return (
      text.includes("find agent") ||
      text.includes("search agent") ||
      text.includes("discover agent") ||
      text.includes("nooterra") ||
      text.includes("what agent") ||
      text.includes("who can")
    );
  },
  
  handler: async (
    _runtime: any,
    message: any,
    _state: any,
    _options: any,
    callback: (response: { text: string }) => void
  ): Promise<void> => {
    const query = message.content?.text || "";
    
    try {
      const res = await fetch(`${REGISTRY_URL}/v1/agent/discovery`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ query, limit: 5 }),
      });
      
      if (!res.ok) {
        callback({ text: "❌ Failed to search the Nooterra network. Please try again later." });
        return;
      }
      
      const data = await res.json() as any;
      const results = (data.results || []);
      
      if (results.length === 0) {
        callback({ text: "No agents found for that query. Try a different search term." });
        return;
      }
      
      const formatted = results
        .map((r: any) => {
          const rep = ((r.reputation || 0) * 100).toFixed(0);
          const cost = r.price_cents ? `${r.price_cents} NCR` : "Free";
          return `• **${r.capabilityId}**\n  ${r.description}\n  _Reputation: ${rep}% | Cost: ${cost}_`;
        })
        .join("\n\n");
      
      callback({ 
        text: `🔍 Found ${results.length} agents on Nooterra:\n\n${formatted}\n\n_Use "hire [capability]" to use an agent._`
      });
    } catch (err) {
      console.error("Nooterra search error:", err);
      callback({ text: "❌ Error connecting to Nooterra network." });
    }
  },
  
  examples: [
    [
      { user: "user", content: { text: "Find agents that can summarize text" } },
      { user: "assistant", content: { text: "🔍 Found 3 agents on Nooterra:\n\n• **cap.text.summarize.v1**\n  Summarize documents into bullet points\n  _Reputation: 94% | Cost: 10 NCR_" } },
    ],
    [
      { user: "user", content: { text: "What Nooterra agents can help with images?" } },
      { user: "assistant", content: { text: "🔍 Found 2 agents on Nooterra:\n\n• **cap.image.generate.v1**\n  Generate images from text\n  _Reputation: 88% | Cost: 50 NCR_" } },
    ],
  ],
};

// ============================================================
// ACTION: Hire an Agent
// ============================================================

export const hireAgentAction: Action = {
  name: "NOOTERRA_HIRE",
  description: "Hire a Nooterra agent to perform a task",
  similes: [
    "hire agent",
    "use nooterra",
    "run workflow",
    "execute task",
    "call agent",
    "invoke capability",
  ],
  
  validate: async (_runtime: any, message: any): Promise<boolean> => {
    const text = (message.content?.text || "").toLowerCase();
    return (
      text.includes("hire") ||
      text.includes("use agent") ||
      text.includes("run ") ||
      text.includes("execute") ||
      text.includes("invoke")
    );
  },
  
  handler: async (
    _runtime: any,
    message: any,
    _state: any,
    options: any,
    callback: (response: { text: string }) => void
  ): Promise<void> => {
    // Extract capability and inputs from options or message
    const capability = options?.capability || extractCapability(message.content?.text || "");
    const inputs = options?.inputs || { text: message.content?.text };
    
    if (!capability) {
      callback({ 
        text: "Please specify which capability to use.\n\nExample: _hire cap.text.summarize.v1 to summarize: [your text]_" 
      });
      return;
    }
    
    callback({ text: `⏳ Hiring agent for **${capability}**...` });
    
    try {
      // Create single-node workflow
      const res = await fetch(`${COORDINATOR_URL}/v1/workflows/publish`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          intent: `Eliza request: ${capability}`,
          maxCents: 100, // Default budget
          nodes: {
            main: { 
              capabilityId: capability, 
              payload: inputs 
            },
          },
        }),
      });
      
      if (!res.ok) {
        const err = await res.text();
        callback({ text: `❌ Failed to submit task: ${err}` });
        return;
      }
      
      const { workflowId } = await res.json() as any;
      
      // Poll for result (max 60s)
      const startTime = Date.now();
      const timeout = 60000;
      
      while (Date.now() - startTime < timeout) {
        await sleep(2000);
        
        const statusRes = await fetch(`${COORDINATOR_URL}/v1/workflows/${workflowId}`, {
          headers: getHeaders(),
        });
        
        if (!statusRes.ok) continue;
        
        const status = await statusRes.json() as any;
        
        if (status.workflow?.status === "success") {
          const mainNode = status.nodes?.find((n: any) => n.name === "main");
          const result = mainNode?.result_payload;
          
          callback({ 
            text: `✅ **Task completed!**\n\n${formatResult(result)}` 
          });
          return;
        }
        
        if (status.workflow?.status === "failed") {
          const mainNode = status.nodes?.find((n: any) => n.name === "main");
          const error = mainNode?.result_payload?.error || "Unknown error";
          callback({ text: `❌ Task failed: ${error}` });
          return;
        }
      }
      
      callback({ 
        text: `⏱️ Task is still running (workflow: ${workflowId}).\n\nIt may complete soon - check back later.` 
      });
    } catch (err) {
      console.error("Nooterra hire error:", err);
      callback({ text: "❌ Error executing task on Nooterra." });
    }
  },
  
  examples: [
    [
      { user: "user", content: { text: "Hire an agent to summarize: The quick brown fox jumps over the lazy dog." } },
      { user: "assistant", content: { text: "✅ **Task completed!**\n\nA fox jumps over a dog." } },
    ],
    [
      { user: "user", content: { text: "Use cap.browser.screenshot.v1 to screenshot https://example.com" } },
      { user: "assistant", content: { text: "✅ **Task completed!**\n\n[Screenshot captured successfully]" } },
    ],
  ],
};

// ============================================================
// ACTION: Check Network Status
// ============================================================

export const networkStatusAction: Action = {
  name: "NOOTERRA_STATUS",
  description: "Check the status of the Nooterra network",
  similes: [
    "nooterra status",
    "network status",
    "is nooterra online",
    "check network",
  ],
  
  validate: async (_runtime: any, message: any): Promise<boolean> => {
    const text = (message.content?.text || "").toLowerCase();
    return text.includes("status") && text.includes("nooterra");
  },
  
  handler: async (
    _runtime: any,
    _message: any,
    _state: any,
    _options: any,
    callback: (response: { text: string }) => void
  ): Promise<void> => {
    try {
      const [coordRes, regRes] = await Promise.all([
        fetch(`${COORDINATOR_URL}/health`).catch(() => null),
        fetch(`${REGISTRY_URL}/health`).catch(() => null),
      ]);
      
      const coordOk = coordRes?.ok ? "✅ Online" : "❌ Offline";
      const regOk = regRes?.ok ? "✅ Online" : "❌ Offline";
      
      callback({
        text: `🌐 **Nooterra Network Status**\n\n• Coordinator: ${coordOk}\n• Registry: ${regOk}`
      });
    } catch (err) {
      callback({ text: "❌ Could not check network status." });
    }
  },
  
  examples: [
    [
      { user: "user", content: { text: "What's the Nooterra status?" } },
      { user: "assistant", content: { text: "🌐 **Nooterra Network Status**\n\n• Coordinator: ✅ Online\n• Registry: ✅ Online" } },
    ],
  ],
};

// ============================================================
// HELPERS
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractCapability(text: string): string | null {
  // Look for cap.xxx.xxx.vN pattern
  const match = text.match(/cap\.[a-z]+\.[a-z]+\.v\d+/i);
  return match ? match[0].toLowerCase() : null;
}

function formatResult(result: any): string {
  if (!result) return "_No result returned_";
  
  if (typeof result === "string") return result;
  
  // Try to extract common result fields
  if (result.summary) return result.summary;
  if (result.text) return result.text;
  if (result.output) return result.output;
  if (result.result) return formatResult(result.result);
  
  // Fallback to JSON
  return "```json\n" + JSON.stringify(result, null, 2) + "\n```";
}

// ============================================================
// PLUGIN EXPORT
// ============================================================

export const nooterraPlugin: Plugin = {
  name: "nooterra",
  description: "Connect to the Nooterra AI agent network - hire any agent from your Eliza bot",
  actions: [
    searchAgentsAction,
    hireAgentAction,
    networkStatusAction,
  ],
  evaluators: [],
  providers: [],
};

export default nooterraPlugin;
