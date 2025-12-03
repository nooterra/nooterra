#!/usr/bin/env node
/**
 * Nooterra MCP Bridge
 * 
 * Exposes the Nooterra AI agent network as MCP tools.
 * Claude and other AI assistants can use any Nooterra agent as a tool!
 * 
 * Usage:
 *   1. Add to Claude Desktop config:
 *      {
 *        "mcpServers": {
 *          "nooterra": {
 *            "command": "npx",
 *            "args": ["@nooterra/mcp-bridge"],
 *            "env": {
 *              "NOOTERRA_API_KEY": "your-api-key"
 *            }
 *          }
 *        }
 *      }
 *   
 *   2. Claude can now use Nooterra agents:
 *      "Use the weather agent to get the forecast for NYC"
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const COORDINATOR_URL = process.env.NOOTERRA_COORDINATOR_URL || 'https://coord.nooterra.ai';
const REGISTRY_URL = process.env.NOOTERRA_REGISTRY_URL || 'https://registry.nooterra.ai';
const API_KEY = process.env.NOOTERRA_API_KEY || '';

interface Capability {
  agentDid: string;
  capabilityId: string;
  description: string;
  endpoint: string;
  reputation: number;
}

// Cache discovered capabilities
let capabilitiesCache: Capability[] = [];
let lastCacheTime = 0;
const CACHE_TTL = 60000; // 1 minute

async function discoverCapabilities(): Promise<Capability[]> {
  if (Date.now() - lastCacheTime < CACHE_TTL && capabilitiesCache.length > 0) {
    return capabilitiesCache;
  }

  try {
    const res = await fetch(`${COORDINATOR_URL}/v1/discover?limit=50`);
    if (!res.ok) {
      console.error('Failed to discover capabilities:', await res.text());
      return capabilitiesCache;
    }
    
    const data = await res.json() as any;
    capabilitiesCache = (data.results || []).map((r: any) => ({
      agentDid: r.did,
      capabilityId: r.capabilityId,
      description: r.description || r.capabilityId,
      endpoint: r.endpoint,
      reputation: r.reputation || 0,
    }));
    lastCacheTime = Date.now();
    
    return capabilitiesCache;
  } catch (err) {
    console.error('Error discovering capabilities:', err);
    return capabilitiesCache;
  }
}

function capabilityToTool(cap: Capability): Tool {
  // Convert capability ID to a valid tool name
  const name = cap.capabilityId
    .replace(/\./g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 64);
  
  return {
    name,
    description: `${cap.description}\n\nAgent: ${cap.agentDid}\nReputation: ${(cap.reputation * 100).toFixed(0)}%`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The input/query for this capability',
        },
        data: {
          type: 'object',
          description: 'Additional structured data to pass to the agent',
        },
      },
      required: ['query'],
    },
  };
}

async function callCapability(capabilityId: string, inputs: any): Promise<any> {
  // Create a workflow with a single node
  const res = await fetch(`${COORDINATOR_URL}/v1/workflows/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
    },
    body: JSON.stringify({
      intent: `MCP call: ${capabilityId}`,
      maxCents: 100, // Budget limit
      nodes: {
        main: {
          capabilityId,
          payload: inputs,
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Workflow failed: ${err}`);
  }

  const { workflowId } = await res.json() as any;
  
  // Poll for result (with timeout)
  const startTime = Date.now();
  const timeout = 60000; // 60 seconds
  
  while (Date.now() - startTime < timeout) {
    await new Promise(r => setTimeout(r, 1000));
    
    const statusRes = await fetch(`${COORDINATOR_URL}/v1/workflows/${workflowId}`, {
      headers: API_KEY ? { 'x-api-key': API_KEY } : {},
    });
    
    if (!statusRes.ok) continue;
    
    const status = await statusRes.json() as any;
    
    if (status.workflow?.status === 'success') {
      const mainNode = status.nodes?.find((n: any) => n.name === 'main');
      return mainNode?.result_payload || { message: 'Completed' };
    }
    
    if (status.workflow?.status === 'failed') {
      const mainNode = status.nodes?.find((n: any) => n.name === 'main');
      throw new Error(mainNode?.result_payload?.error || 'Workflow failed');
    }
  }
  
  throw new Error('Workflow timed out');
}

// Create MCP Server
const server = new Server(
  {
    name: 'nooterra',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools (Nooterra capabilities)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const capabilities = await discoverCapabilities();
  
  // Add meta tools
  const tools: Tool[] = [
    {
      name: 'nooterra_search',
      description: 'Search for AI agents on the Nooterra network by capability or description',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What capability are you looking for?',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'nooterra_call',
      description: 'Call any Nooterra agent by capability ID',
      inputSchema: {
        type: 'object',
        properties: {
          capabilityId: {
            type: 'string',
            description: 'The capability ID to call (e.g., cap.weather.forecast.v1)',
          },
          inputs: {
            type: 'object',
            description: 'Inputs to pass to the agent',
          },
        },
        required: ['capabilityId'],
      },
    },
    // Add discovered capabilities as individual tools
    ...capabilities.slice(0, 20).map(capabilityToTool),
  ];
  
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    // Meta: Search for agents
    if (name === 'nooterra_search') {
      const query = (args as any)?.query || '';
      const res = await fetch(`${REGISTRY_URL}/v1/agent/discovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 10 }),
      });
      
      if (!res.ok) {
        return {
          content: [{ type: 'text', text: 'Search failed. Try again later.' }],
        };
      }
      
      const data = await res.json() as any;
      const results = (data.results || [])
        .map((r: any) => `• ${r.capabilityId}: ${r.description} (rep: ${(r.reputation * 100).toFixed(0)}%)`)
        .join('\n');
      
      return {
        content: [{
          type: 'text',
          text: results || 'No agents found for that query.',
        }],
      };
    }
    
    // Meta: Call any capability
    if (name === 'nooterra_call') {
      const { capabilityId, inputs } = args as any;
      const result = await callCapability(capabilityId, inputs || {});
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
    
    // Direct capability call (tool name is converted capability ID)
    const capabilityId = name.replace(/_/g, '.'); // Convert back to capability ID format
    const capabilities = await discoverCapabilities();
    const cap = capabilities.find(c => 
      c.capabilityId.replace(/\./g, '_').replace(/[^a-zA-Z0-9_]/g, '') === name
    );
    
    if (!cap) {
      return {
        content: [{
          type: 'text',
          text: `Unknown tool: ${name}. Use nooterra_search to find available agents.`,
        }],
        isError: true,
      };
    }
    
    const inputs = {
      query: (args as any)?.query,
      ...(args as any)?.data,
    };
    
    const result = await callCapability(cap.capabilityId, inputs);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
    
  } catch (err: any) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${err.message}`,
      }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Nooterra MCP Bridge started');
}

main().catch(console.error);

