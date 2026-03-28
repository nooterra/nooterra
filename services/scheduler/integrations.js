/**
 * Integration Layer — powered by Composio
 *
 * Handles all OAuth connections and tool execution for 250+ apps
 * through Composio's SDK. No per-service OAuth code needed.
 *
 * How it works:
 *   1. User clicks "Connect Gmail" → we call Composio → redirect to Google consent
 *   2. Composio stores tokens, handles refresh, forever
 *   3. Worker executes → LLM gets tool definitions from Composio
 *   4. LLM calls gmail.send → we execute via Composio → real email sent
 *
 * Composio user_id = our tenant_id (1:1 mapping)
 */

import { Composio } from '@composio/core';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://nooterra.ai';
const CALLBACK_URL = `${FRONTEND_URL}/dashboard?view=connections`;

let composio = null;

function getClient() {
  if (!composio && COMPOSIO_API_KEY) {
    composio = new Composio({ apiKey: COMPOSIO_API_KEY });
  }
  return composio;
}

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, component: 'integrations', msg });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

// ---------------------------------------------------------------------------
// Toolkit → Auth Config mapping
//
// Each toolkit (gmail, slack, etc.) needs an "auth config" ID from your
// Composio dashboard. Set these as env vars or configure in dashboard.
// ---------------------------------------------------------------------------

function getAuthConfigId(toolkit) {
  // Check for toolkit-specific env var first, then fall back to Composio's default
  const envKey = `COMPOSIO_AUTH_${toolkit.toUpperCase()}`;
  return process.env[envKey] || null;
}

// ---------------------------------------------------------------------------
// OAuth Flow Handlers
// ---------------------------------------------------------------------------

/**
 * GET /v1/integrations/:toolkit/authorize?tenantId=...
 * Redirects user to the OAuth consent screen for this toolkit.
 *
 * Uses Composio's session-based auth: create(userId) → session.authorize(toolkit)
 * No manual auth config setup needed — Composio has built-in OAuth for popular apps.
 */
export async function handleAuthorize(req, res, toolkit) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const tenantId = url.searchParams.get('tenantId');

  if (!tenantId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing tenantId parameter' }));
    return;
  }

  const client = getClient();
  if (!client) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Composio not configured. Set COMPOSIO_API_KEY.' }));
    return;
  }

  try {
    // Normalize toolkit name (e.g. "google-calendar" → "googlecalendar")
    const normalizedToolkit = toolkit.replace(/-/g, '');

    // Create a session for this tenant and authorize the toolkit
    const session = await client.create(tenantId, {
      toolkits: [normalizedToolkit],
    });
    const connRequest = await session.authorize(normalizedToolkit, {
      callbackUrl: CALLBACK_URL,
    });

    log('info', `OAuth initiated: tenant=${tenantId} toolkit=${normalizedToolkit}`);

    // Redirect to the OAuth consent screen
    res.writeHead(302, { Location: connRequest.redirectUrl });
    res.end();
  } catch (err) {
    log('error', `OAuth initiate failed for ${toolkit}: ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * GET /v1/integrations/status
 * Returns which toolkits are connected for this tenant.
 */
export async function handleStatus(req, res) {
  const tenantId = req.headers['x-tenant-id'];
  if (!tenantId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing x-tenant-id header' }));
    return;
  }

  const client = getClient();
  if (!client) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ integrations: {}, configured: false }));
    return;
  }

  try {
    const connections = await client.connectedAccounts.list({
      userIds: [tenantId],
      statuses: ['ACTIVE'],
    });

    const integrations = {};
    for (const conn of (connections.items || [])) {
      const toolkit = conn.appName || conn.toolkitSlug || conn.authConfigId || 'unknown';
      integrations[toolkit] = {
        connected: true,
        connectionId: conn.id,
        status: conn.status,
        connectedAt: conn.createdAt,
      };
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ integrations, configured: true }));
  } catch (err) {
    log('error', `Status check failed: ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * POST /v1/integrations/:toolkit/disconnect
 * Disconnect a toolkit for a tenant.
 */
export async function handleDisconnect(req, res, toolkit) {
  let body = '';
  for await (const chunk of req) body += chunk;

  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = {}; }

  const tenantId = req.headers['x-tenant-id'] || parsed.tenantId;
  if (!tenantId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing tenantId' }));
    return;
  }

  const client = getClient();
  if (!client) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Composio not configured' }));
    return;
  }

  try {
    const connections = await client.connectedAccounts.list({
      userIds: [tenantId],
      statuses: ['ACTIVE'],
    });

    const conn = (connections.items || []).find(c =>
      (c.appName || c.toolkitSlug || '').toLowerCase() === toolkit.toLowerCase()
    );

    if (conn) {
      await client.connectedAccounts.delete(conn.id);
      log('info', `Disconnected ${toolkit} for tenant ${tenantId}`);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ disconnected: true }));
  } catch (err) {
    log('error', `Disconnect failed: ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// ---------------------------------------------------------------------------
// Tool Execution — for the agentic loop
// ---------------------------------------------------------------------------

/**
 * Get available tools for a tenant in OpenAI function-calling format.
 * Only returns tools for services the tenant has connected.
 *
 * @param {string} tenantId
 * @param {string[]} [toolkits] - Optional filter (e.g. ['gmail', 'googlecalendar'])
 * @returns {Promise<Array>} OpenAI-compatible tool definitions
 */
export async function getAvailableTools(tenantId, toolkits) {
  const client = getClient();
  if (!client) return [];

  try {
    const opts = {};
    if (toolkits && toolkits.length > 0) {
      opts.toolkits = toolkits;
    }

    const tools = await client.tools.get(tenantId, opts);
    return tools || [];
  } catch (err) {
    log('error', `Failed to get tools for tenant ${tenantId}: ${err.message}`);
    return [];
  }
}

/**
 * Execute a tool call on behalf of a tenant.
 *
 * @param {string} tenantId
 * @param {string} toolName - e.g. "GMAIL_SEND_EMAIL"
 * @param {object} args - tool arguments from LLM
 * @returns {Promise<{success: boolean, result?: any, error?: string}>}
 */
export async function executeTool(tenantId, toolName, args) {
  const client = getClient();
  if (!client) {
    return { success: false, error: 'Composio not configured' };
  }

  try {
    const result = await client.tools.execute(toolName, {
      userId: tenantId,
      arguments: args || {},
    });

    log('info', `Tool executed: ${toolName} for tenant ${tenantId}`);
    return { success: true, result };
  } catch (err) {
    log('error', `Tool ${toolName} failed for tenant ${tenantId}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export default {
  handleAuthorize,
  handleStatus,
  handleDisconnect,
  executeTool,
  getAvailableTools,
};
