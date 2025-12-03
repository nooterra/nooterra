/**
 * Bittensor Adapter
 * 
 * Connects to Bittensor subnet endpoints for decentralized AI inference.
 * Supports multiple subnets:
 * - SN1: Text Generation (Prompting)
 * - SN19: Vision
 * - SN21: Storage
 * - SN24: Omega (multi-modal)
 * 
 * Bittensor endpoints typically use the validator API format.
 */

import fetch from "node-fetch";

export interface BittensorRequest {
  endpoint: string;
  subnet: number;
  inputs: {
    query?: string;
    prompt?: string;
    messages?: Array<{ role: string; content: string }>;
    images?: string[];
    model?: string;
    max_tokens?: number;
    temperature?: number;
    [key: string]: any;
  };
  config?: {
    api_key?: string;
    timeout_ms?: number;
    top_n?: number; // Number of miners to query
  };
}

export interface BittensorResponse {
  success: boolean;
  result?: any;
  error?: string;
  latency_ms: number;
  miner_uid?: number;
  miner_hotkey?: string;
}

// Known Bittensor subnet API patterns
const SUBNET_CONFIGS: Record<number, {
  name: string;
  defaultEndpoint?: string;
  format: "chat" | "completion" | "raw";
}> = {
  1: { name: "Text Prompting", format: "completion" },
  3: { name: "Data Universe", format: "raw" },
  4: { name: "Multi-Modality", format: "raw" },
  19: { name: "Vision", format: "raw" },
  21: { name: "FileTAO (Storage)", format: "raw" },
  22: { name: "Meta Search", format: "raw" },
  24: { name: "Omega", format: "chat" },
  25: { name: "Protein Folding", format: "raw" },
};

/**
 * Detect if endpoint is a Bittensor validator
 */
export function isBittensorEndpoint(endpoint: string): boolean {
  return (
    endpoint.includes("bittensor") ||
    endpoint.includes("taostats") ||
    endpoint.includes("opentensor") ||
    endpoint.includes("sn1.") ||
    endpoint.includes("sn19.") ||
    endpoint.includes("sn21.") ||
    endpoint.includes("sn24.") ||
    endpoint.match(/sn\d+\./) !== null
  );
}

/**
 * Extract subnet number from endpoint if present
 */
export function extractSubnet(endpoint: string): number | null {
  const match = endpoint.match(/sn(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

/**
 * Call Bittensor SN1 (Text Prompting)
 */
async function callSN1Prompting(req: BittensorRequest): Promise<BittensorResponse> {
  const startTime = Date.now();
  
  try {
    const prompt = req.inputs.prompt || req.inputs.query || 
      (req.inputs.messages ? req.inputs.messages.map(m => `${m.role}: ${m.content}`).join("\n") : "");
    
    const response = await fetch(req.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.config?.api_key ? { Authorization: `Bearer ${req.config.api_key}` } : {}),
      },
      body: JSON.stringify({
        prompt,
        max_tokens: req.inputs.max_tokens || 1000,
        temperature: req.inputs.temperature || 0.7,
        top_n: req.config?.top_n || 1,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        error: `Bittensor SN1 error: ${response.status} - ${error}`,
        latency_ms: Date.now() - startTime,
      };
    }

    const data = await response.json() as any;
    
    return {
      success: true,
      result: {
        response: data.completion || data.response || data.text || data,
        raw: data,
      },
      latency_ms: Date.now() - startTime,
      miner_uid: data.miner_uid,
      miner_hotkey: data.miner_hotkey,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message,
      latency_ms: Date.now() - startTime,
    };
  }
}

/**
 * Call Bittensor SN24 (Omega - Chat format)
 */
async function callSN24Omega(req: BittensorRequest): Promise<BittensorResponse> {
  const startTime = Date.now();
  
  try {
    // SN24 uses OpenAI-compatible chat format
    const messages = req.inputs.messages || [
      { role: "user", content: req.inputs.prompt || req.inputs.query || "" }
    ];

    const response = await fetch(req.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.config?.api_key ? { Authorization: `Bearer ${req.config.api_key}` } : {}),
      },
      body: JSON.stringify({
        messages,
        model: req.inputs.model || "omega",
        max_tokens: req.inputs.max_tokens || 1000,
        temperature: req.inputs.temperature || 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        error: `Bittensor SN24 error: ${response.status} - ${error}`,
        latency_ms: Date.now() - startTime,
      };
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || data.response;
    
    return {
      success: true,
      result: {
        response: content,
        raw: data,
      },
      latency_ms: Date.now() - startTime,
      miner_uid: data.miner_uid,
      miner_hotkey: data.miner_hotkey,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message,
      latency_ms: Date.now() - startTime,
    };
  }
}

/**
 * Call Bittensor SN19 (Vision)
 */
async function callSN19Vision(req: BittensorRequest): Promise<BittensorResponse> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(req.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.config?.api_key ? { Authorization: `Bearer ${req.config.api_key}` } : {}),
      },
      body: JSON.stringify({
        prompt: req.inputs.prompt || req.inputs.query,
        images: req.inputs.images || [],
        task: req.inputs.task || "describe",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        error: `Bittensor SN19 error: ${response.status} - ${error}`,
        latency_ms: Date.now() - startTime,
      };
    }

    const data = await response.json() as any;
    
    return {
      success: true,
      result: data,
      latency_ms: Date.now() - startTime,
      miner_uid: data.miner_uid,
      miner_hotkey: data.miner_hotkey,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message,
      latency_ms: Date.now() - startTime,
    };
  }
}

/**
 * Generic Bittensor subnet call
 */
async function callGenericSubnet(req: BittensorRequest): Promise<BittensorResponse> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(req.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.config?.api_key ? { Authorization: `Bearer ${req.config.api_key}` } : {}),
      },
      body: JSON.stringify(req.inputs),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        error: `Bittensor error: ${response.status} - ${error}`,
        latency_ms: Date.now() - startTime,
      };
    }

    const data = await response.json() as any;
    
    return {
      success: true,
      result: data,
      latency_ms: Date.now() - startTime,
      miner_uid: data.miner_uid,
      miner_hotkey: data.miner_hotkey,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message,
      latency_ms: Date.now() - startTime,
    };
  }
}

/**
 * Main Bittensor adapter - routes to the appropriate subnet handler
 */
export async function callBittensor(req: BittensorRequest): Promise<BittensorResponse> {
  const subnet = req.subnet || extractSubnet(req.endpoint) || 1;
  
  switch (subnet) {
    case 1:
      return callSN1Prompting(req);
    case 19:
      return callSN19Vision(req);
    case 24:
      return callSN24Omega(req);
    default:
      return callGenericSubnet(req);
  }
}

/**
 * Get information about a Bittensor subnet
 */
export function getSubnetInfo(subnet: number): { name: string; format: string } | null {
  const config = SUBNET_CONFIGS[subnet];
  return config ? { name: config.name, format: config.format } : null;
}

/**
 * List supported subnets
 */
export function listSupportedSubnets(): Array<{ subnet: number; name: string; format: string }> {
  return Object.entries(SUBNET_CONFIGS).map(([subnet, config]) => ({
    subnet: parseInt(subnet),
    name: config.name,
    format: config.format,
  }));
}
