#!/usr/bin/env node

/**
 * Nooterra MCP Server
 *
 * Exposes Nooterra worker capabilities over the Model Context Protocol (STDIO transport).
 * Add this server to Claude Code, Codex, Cursor, or any MCP client and say
 * "create a nooterra worker that monitors competitor prices" — it just works.
 *
 * Protocol: JSON-RPC 2.0 over stdin/stdout.
 * All diagnostic output goes to stderr to avoid corrupting the wire protocol.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

import { instantCreate, WORKER_TEMPLATES } from './worker-builder-core.mjs';
import {
  createWorker,
  listWorkers,
  loadWorker,
  findWorkerByName,
  getWorkerSummary,
  getAllWorkerSummaries
} from './worker-persistence.mjs';
import { buildCharterFromContext } from './charter-compiler.mjs';
import { runWorkerExecution, WorkerDaemon } from './worker-daemon.mjs';
import { getToolStatus } from './built-in-tools.mjs';
import { listAvailableTools, getInstalledTools } from './tool-installer.mjs';
import { loadApiKey, loadProviderCredential } from './provider-auth.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_NAME = 'nooterra';
const SERVER_VERSION = '0.4.0';
const PROTOCOL_VERSION = '2024-11-05';
const RUN_HISTORY_DIR = path.join(os.homedir(), '.nooterra', 'runs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(...args) {
  process.stderr.write(`[nooterra-mcp] ${args.join(' ')}\n`);
}

function resolveWorker(nameOrId) {
  // Try direct ID load first
  let worker = loadWorker(nameOrId);
  if (worker) return worker;

  // Try name lookup
  worker = findWorkerByName(nameOrId);
  if (worker) return worker;

  return null;
}

function getRunHistory(workerId, limit = 20) {
  if (!fs.existsSync(RUN_HISTORY_DIR)) return [];

  const files = fs.readdirSync(RUN_HISTORY_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  const runs = [];
  for (const file of files) {
    if (runs.length >= limit) break;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RUN_HISTORY_DIR, file), 'utf8'));
      if (data.workerId === workerId) {
        runs.push({
          taskId: data.taskId,
          success: data.success,
          duration: data.duration,
          completedAt: data.completedAt,
          toolCallCount: data.toolCalls ? data.toolCalls.length : 0
        });
      }
    } catch {
      // skip corrupt files
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'nooterra_create_worker',
    description: 'Create a Nooterra worker from a natural language description. Describe what you want the worker to do and it will be created with the right capabilities, schedule, and charter.',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Natural language description of what the worker should do, e.g. "monitor competitor prices every hour and alert me on Slack"'
        }
      },
      required: ['description']
    }
  },
  {
    name: 'nooterra_create_from_template',
    description: 'Create a worker from a pre-built template. Templates include: price-monitor, inbox-triage, standup-summarizer, competitor-watcher, pr-reviewer, social-monitor.',
    inputSchema: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          description: 'Template ID: price-monitor, inbox-triage, standup-summarizer, competitor-watcher, pr-reviewer, social-monitor',
          enum: ['price-monitor', 'inbox-triage', 'standup-summarizer', 'competitor-watcher', 'pr-reviewer', 'social-monitor']
        }
      },
      required: ['template']
    }
  },
  {
    name: 'nooterra_list_workers',
    description: 'List all Nooterra workers with their current status, provider, capabilities, and run stats.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'nooterra_run_worker',
    description: 'Execute a worker right now and return its output. This calls the AI provider and runs the worker\'s tools. May take 10-30 seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        worker: {
          type: 'string',
          description: 'Worker name or ID'
        }
      },
      required: ['worker']
    }
  },
  {
    name: 'nooterra_worker_logs',
    description: 'Get execution history for a worker — past runs with success/failure, duration, and tool call counts.',
    inputSchema: {
      type: 'object',
      properties: {
        worker: {
          type: 'string',
          description: 'Worker name or ID'
        },
        limit: {
          type: 'number',
          description: 'Max number of log entries to return (default 20)'
        }
      },
      required: ['worker']
    }
  },
  {
    name: 'nooterra_worker_status',
    description: 'Get detailed status for a specific worker including its charter, provider, run history, and next scheduled run.',
    inputSchema: {
      type: 'object',
      properties: {
        worker: {
          type: 'string',
          description: 'Worker name or ID'
        }
      },
      required: ['worker']
    }
  },
  {
    name: 'nooterra_add_tool',
    description: 'Connect a tool/integration to Nooterra (e.g. slack, github, email). Returns what credentials are needed and how to set them up.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: {
          type: 'string',
          description: 'Tool ID: browser, slack, github, email, filesystem, search'
        }
      },
      required: ['tool']
    }
  },
  {
    name: 'nooterra_list_tools',
    description: 'List all available tools/integrations and whether they are connected and ready to use.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'nooterra_daemon_status',
    description: 'Check if the Nooterra background daemon is running. The daemon executes scheduled workers automatically.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'nooterra_templates',
    description: 'List all available worker templates with descriptions.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

// ---------------------------------------------------------------------------
// Tool Handlers
// ---------------------------------------------------------------------------

async function handleCreateWorker({ description }) {
  if (!description) throw new Error('description is required');

  const context = await instantCreate(description);
  const charter = buildCharterFromContext(context);
  const worker = createWorker(charter, {
    provider: null,
    triggers: context.schedule ? [{ type: 'schedule', schedule: context.schedule }] : []
  });

  return {
    workerId: worker.id,
    name: charter.name,
    capabilities: (charter.capabilities || []).map(c => c.name || c.id),
    schedule: charter.schedule,
    charterSummary: {
      purpose: charter.purpose,
      canDo: charter.canDo,
      askFirst: charter.askFirst,
      neverDo: charter.neverDo
    }
  };
}

async function handleCreateFromTemplate({ template }) {
  if (!template) throw new Error('template is required');

  const tmpl = WORKER_TEMPLATES.find(t => t.id === template);
  if (!tmpl) {
    const available = WORKER_TEMPLATES.map(t => t.id).join(', ');
    throw new Error(`Unknown template: "${template}". Available: ${available}`);
  }

  const charter = buildCharterFromContext(tmpl.context);
  const worker = createWorker(charter, {
    provider: null,
    triggers: tmpl.context.schedule ? [{ type: 'schedule', schedule: tmpl.context.schedule }] : []
  });

  return {
    workerId: worker.id,
    name: charter.name,
    charterSummary: {
      purpose: charter.purpose,
      canDo: charter.canDo,
      askFirst: charter.askFirst,
      neverDo: charter.neverDo
    }
  };
}

async function handleListWorkers() {
  const summaries = getAllWorkerSummaries();
  return summaries.map(s => ({
    id: s.id,
    name: s.name,
    status: s.status,
    provider: s.provider,
    capabilities: s.capabilities,
    lastRun: s.lastRun,
    totalRuns: s.stats?.totalRuns || 0
  }));
}

async function handleRunWorker({ worker: nameOrId }) {
  if (!nameOrId) throw new Error('worker name or ID is required');

  const worker = resolveWorker(nameOrId);
  if (!worker) throw new Error(`Worker not found: "${nameOrId}"`);

  // Load API key for the worker's provider
  const provider = worker.provider || 'openai';
  let apiKey;
  try {
    apiKey = await loadProviderCredential(provider);
  } catch {
    apiKey = loadApiKey(provider);
  }
  if (!apiKey) {
    throw new Error(`No API key configured for provider "${provider}". Run the nooterra CLI to set up a provider.`);
  }

  // Run execution — mcpManager and notificationBus can be null for standalone runs
  const result = await runWorkerExecution(worker, null, null, apiKey);

  return {
    success: result.success,
    taskId: result.taskId,
    duration: result.duration,
    toolCalls: result.toolCalls || [],
    response: result.response || result.finalResponse || null
  };
}

async function handleWorkerLogs({ worker: nameOrId, limit }) {
  if (!nameOrId) throw new Error('worker name or ID is required');

  const worker = resolveWorker(nameOrId);
  if (!worker) throw new Error(`Worker not found: "${nameOrId}"`);

  return getRunHistory(worker.id, limit || 20);
}

async function handleWorkerStatus({ worker: nameOrId }) {
  if (!nameOrId) throw new Error('worker name or ID is required');

  const worker = resolveWorker(nameOrId);
  if (!worker) throw new Error(`Worker not found: "${nameOrId}"`);

  return {
    id: worker.id,
    name: worker.charter.name,
    status: worker.status,
    charter: {
      purpose: worker.charter.purpose,
      canDo: worker.charter.canDo,
      askFirst: worker.charter.askFirst,
      neverDo: worker.charter.neverDo,
      capabilities: (worker.charter.capabilities || []).map(c => c.name || c.id),
      schedule: worker.charter.schedule
    },
    provider: worker.provider,
    model: worker.model,
    lastRun: worker.lastRun,
    totalRuns: worker.stats?.totalRuns || 0,
    nextScheduledRun: worker.nextRun || null
  };
}

async function handleAddTool({ tool }) {
  if (!tool) throw new Error('tool is required');

  const allTools = await listAvailableTools();
  const entry = allTools.find(t => t.id === tool);
  if (!entry) {
    const available = allTools.map(t => t.id).join(', ');
    throw new Error(`Unknown tool: "${tool}". Available: ${available}`);
  }

  if (entry.builtIn || entry.installed) {
    return {
      status: 'ready',
      needsAuth: false,
      instructions: `${entry.name} is already connected and ready to use.`
    };
  }

  return {
    status: 'needs_setup',
    needsAuth: true,
    instructions: entry.tokenHint
      ? `${entry.name} requires authentication.\n\nHint: ${entry.tokenHint}\n\nRun in your terminal: node scripts/worker-builder/tool-installer.mjs add ${tool}`
      : `${entry.name} requires setup. Run: node scripts/worker-builder/tool-installer.mjs add ${tool}`
  };
}

async function handleListTools() {
  const allTools = await listAvailableTools();
  return allTools.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    ready: !!(t.builtIn || t.installed),
    needsAuth: !!(t.needsAuth && !t.installed)
  }));
}

async function handleDaemonStatus() {
  const status = WorkerDaemon.getStatus();

  if (!status.running) {
    return {
      running: false,
      pid: null,
      uptime: null,
      workers: 0,
      nextScheduledRun: null
    };
  }

  return {
    running: true,
    pid: status.pid || null,
    uptime: status.startedAt ? Math.floor((Date.now() - new Date(status.startedAt).getTime()) / 1000) : null,
    workers: status.workers || 0,
    nextScheduledRun: status.nextRun || null
  };
}

async function handleTemplates() {
  return WORKER_TEMPLATES.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon
  }));
}

// ---------------------------------------------------------------------------
// Tool Dispatch
// ---------------------------------------------------------------------------

const TOOL_HANDLERS = {
  nooterra_create_worker: handleCreateWorker,
  nooterra_create_from_template: handleCreateFromTemplate,
  nooterra_list_workers: handleListWorkers,
  nooterra_run_worker: handleRunWorker,
  nooterra_worker_logs: handleWorkerLogs,
  nooterra_worker_status: handleWorkerStatus,
  nooterra_add_tool: handleAddTool,
  nooterra_list_tools: handleListTools,
  nooterra_daemon_status: handleDaemonStatus,
  nooterra_templates: handleTemplates
};

// ---------------------------------------------------------------------------
// JSON-RPC Helpers
// ---------------------------------------------------------------------------

function jsonRpcResponse(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonRpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return JSON.stringify({ jsonrpc: '2.0', id, error: err });
}

// Standard JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

// ---------------------------------------------------------------------------
// MCP Request Handlers
// ---------------------------------------------------------------------------

async function handleRequest(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      return jsonRpcResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION
        }
      });

    case 'notifications/initialized':
      // Client acknowledgment — no response needed for notifications
      return null;

    case 'tools/list':
      return jsonRpcResponse(id, { tools: TOOLS });

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      const handler = TOOL_HANDLERS[toolName];
      if (!handler) {
        return jsonRpcError(id, INVALID_PARAMS, `Unknown tool: ${toolName}`);
      }

      try {
        const result = await handler(toolArgs);
        return jsonRpcResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        });
      } catch (err) {
        log(`Tool error [${toolName}]:`, err.message);
        return jsonRpcResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: err.message }, null, 2)
            }
          ],
          isError: true
        });
      }
    }

    default:
      // Unknown methods return method-not-found per JSON-RPC spec
      if (id !== undefined) {
        return jsonRpcError(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
      }
      // Notifications (no id) for unknown methods are silently ignored
      return null;
  }
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function printManifest() {
  const manifest = {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    description: 'Create and manage AI workers that run on autopilot. Monitor prices, triage inboxes, review PRs, and more.',
    transport: 'stdio',
    command: 'node',
    args: [path.resolve(new URL(import.meta.url).pathname)],
    tools: TOOLS.map(t => ({ name: t.name, description: t.description }))
  };
  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// STDIO Transport
// ---------------------------------------------------------------------------

function startServer() {
  log('Starting MCP server on stdio...');

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      const response = jsonRpcError(null, PARSE_ERROR, 'Parse error: invalid JSON');
      process.stdout.write(response + '\n');
      return;
    }

    if (!msg.jsonrpc || msg.jsonrpc !== '2.0') {
      const response = jsonRpcError(msg.id ?? null, INVALID_REQUEST, 'Invalid JSON-RPC: missing or wrong jsonrpc field');
      process.stdout.write(response + '\n');
      return;
    }

    if (!msg.method) {
      const response = jsonRpcError(msg.id ?? null, INVALID_REQUEST, 'Invalid JSON-RPC: missing method');
      process.stdout.write(response + '\n');
      return;
    }

    try {
      const response = await handleRequest(msg);
      if (response !== null) {
        process.stdout.write(response + '\n');
      }
    } catch (err) {
      log('Unhandled error:', err.message);
      const response = jsonRpcError(msg.id ?? null, INTERNAL_ERROR, `Internal error: ${err.message}`);
      process.stdout.write(response + '\n');
    }
  });

  rl.on('close', () => {
    log('stdin closed, shutting down.');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('SIGINT received, shutting down.');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('SIGTERM received, shutting down.');
    process.exit(0);
  });

  log('MCP server ready.');
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes('--manifest')) {
  printManifest();
} else {
  startServer();
}
