/**
 * Integration OAuth & Tool Execution
 *
 * Handles OAuth flows for external services (Gmail, Google Calendar, etc.)
 * and provides tool executors that workers can call during agentic loops.
 *
 * OAuth flow:
 *   1. Frontend calls GET /v1/integrations/:service/authorize?tenantId=...
 *   2. Redirects to provider's consent screen
 *   3. Provider redirects back to /v1/integrations/:service/callback
 *   4. We exchange code for tokens, encrypt, store in tenant_integrations
 *   5. Redirect to frontend success page
 *
 * Tool execution:
 *   Workers call tools like gmail.read, gmail.send, calendar.list
 *   Tool executor loads encrypted credentials from DB, calls the API
 */

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_BASE = process.env.INTEGRATION_REDIRECT_BASE || 'https://nooterra.ai/__nooterra';
const FRONTEND_SUCCESS_URL = process.env.FRONTEND_URL || 'https://nooterra.ai/dashboard';
const ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.DATABASE_URL?.slice(0, 32) || 'nooterra-default-key-change-me!!';

// Google OAuth endpoints
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Scopes per service
const SERVICE_SCOPES = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
  ],
  google_calendar: [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ],
};

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, component: 'integrations', msg });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

function generateId(prefix = 'integ') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// Token encryption (AES-256-GCM)
// ---------------------------------------------------------------------------

function getEncryptionKey() {
  return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
}

function encryptTokens(data) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decryptTokens(encrypted) {
  const [ivHex, tagHex, data] = encrypted.split(':');
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

// ---------------------------------------------------------------------------
// OAuth Flow Handlers
// ---------------------------------------------------------------------------

/**
 * Step 1: Generate authorization URL and redirect user to Google consent screen.
 */
export function handleAuthorize(req, res, service) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const tenantId = url.searchParams.get('tenantId');

  if (!tenantId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing tenantId parameter' }));
    return;
  }

  if (!GOOGLE_CLIENT_ID) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID.' }));
    return;
  }

  const scopes = SERVICE_SCOPES[service];
  if (!scopes) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unknown service: ${service}` }));
    return;
  }

  // State parameter encodes tenantId + CSRF nonce
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = Buffer.from(JSON.stringify({ tenantId, nonce, service })).toString('base64url');

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${REDIRECT_BASE}/v1/integrations/callback`,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;
  log('info', `OAuth authorize: tenant=${tenantId} service=${service}`);

  res.writeHead(302, { Location: authUrl });
  res.end();
}

/**
 * Step 2: Handle Google OAuth callback — exchange code for tokens, store them.
 */
export async function handleCallback(req, res, pool) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    log('error', `OAuth callback error: ${error}`);
    res.writeHead(302, { Location: `${FRONTEND_SUCCESS_URL}?connections=error&reason=${error}` });
    res.end();
    return;
  }

  if (!code || !stateParam) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing code or state' }));
    return;
  }

  let state;
  try {
    state = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid state parameter' }));
    return;
  }

  const { tenantId, service } = state;
  if (!tenantId || !service) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid state: missing tenantId or service' }));
    return;
  }

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${REDIRECT_BASE}/v1/integrations/callback`,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`Token exchange failed: ${tokenRes.status} ${text.slice(0, 200)}`);
    }

    const tokens = await tokenRes.json();

    // Encrypt and store
    const encrypted = encryptTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
      token_type: tokens.token_type || 'Bearer',
    });

    const scopes = SERVICE_SCOPES[service]?.join(' ') || tokens.scope || '';

    await pool.query(`
      INSERT INTO tenant_integrations (id, tenant_id, service, status, credentials_encrypted, scopes, metadata, connected_at, updated_at)
      VALUES ($1, $2, $3, 'connected', $4, $5, $6, now(), now())
      ON CONFLICT (tenant_id, service) DO UPDATE SET
        credentials_encrypted = $4,
        scopes = $5,
        status = 'connected',
        updated_at = now()
    `, [
      generateId(),
      tenantId,
      service,
      encrypted,
      scopes,
      JSON.stringify({ email: tokens.email || null }),
    ]);

    log('info', `OAuth connected: tenant=${tenantId} service=${service}`);

    // Redirect back to dashboard with success
    res.writeHead(302, { Location: `${FRONTEND_SUCCESS_URL}?connections=success&service=${service}` });
    res.end();
  } catch (err) {
    log('error', `OAuth callback failed: ${err.message}`);
    res.writeHead(302, { Location: `${FRONTEND_SUCCESS_URL}?connections=error&reason=${encodeURIComponent(err.message)}` });
    res.end();
  }
}

/**
 * Get integration status for a tenant (which services are connected).
 */
export async function handleStatus(req, res, pool) {
  const tenantId = req.headers['x-tenant-id'];
  if (!tenantId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing x-tenant-id header' }));
    return;
  }

  try {
    const { rows } = await pool.query(
      `SELECT service, status, scopes, metadata, connected_at, updated_at
       FROM tenant_integrations WHERE tenant_id = $1`,
      [tenantId]
    );

    const integrations = {};
    for (const row of rows) {
      integrations[row.service] = {
        connected: row.status === 'connected',
        status: row.status,
        scopes: row.scopes,
        connectedAt: row.connected_at,
      };
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ integrations, googleOAuthConfigured: !!GOOGLE_CLIENT_ID }));
  } catch (err) {
    log('error', `Integration status error: ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// ---------------------------------------------------------------------------
// Token Management (for tool execution)
// ---------------------------------------------------------------------------

/**
 * Load and decrypt credentials for a service. Auto-refreshes expired tokens.
 */
export async function getServiceCredentials(pool, tenantId, service) {
  const { rows } = await pool.query(
    `SELECT credentials_encrypted FROM tenant_integrations
     WHERE tenant_id = $1 AND service = $2 AND status = 'connected'`,
    [tenantId, service]
  );

  if (rows.length === 0) return null;

  const creds = decryptTokens(rows[0].credentials_encrypted);

  // Check if token is expired (with 5min buffer)
  if (creds.expires_at && Date.now() > creds.expires_at - 300000) {
    if (!creds.refresh_token) {
      // Mark as expired
      await pool.query(
        `UPDATE tenant_integrations SET status = 'expired', updated_at = now()
         WHERE tenant_id = $1 AND service = $2`,
        [tenantId, service]
      );
      return null;
    }

    // Refresh the token
    try {
      const refreshRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: creds.refresh_token,
          grant_type: 'refresh_token',
        }).toString(),
      });

      if (!refreshRes.ok) throw new Error(`Refresh failed: ${refreshRes.status}`);

      const newTokens = await refreshRes.json();
      const updatedCreds = {
        access_token: newTokens.access_token,
        refresh_token: creds.refresh_token, // Google doesn't always return a new one
        expires_at: Date.now() + (newTokens.expires_in || 3600) * 1000,
        token_type: newTokens.token_type || 'Bearer',
      };

      const encrypted = encryptTokens(updatedCreds);
      await pool.query(
        `UPDATE tenant_integrations SET credentials_encrypted = $1, updated_at = now()
         WHERE tenant_id = $2 AND service = $3`,
        [encrypted, tenantId, service]
      );

      log('info', `Refreshed ${service} token for tenant ${tenantId}`);
      return updatedCreds;
    } catch (err) {
      log('error', `Token refresh failed for ${service}: ${err.message}`);
      await pool.query(
        `UPDATE tenant_integrations SET status = 'expired', updated_at = now()
         WHERE tenant_id = $1 AND service = $2`,
        [tenantId, service]
      );
      return null;
    }
  }

  return creds;
}

// ---------------------------------------------------------------------------
// Gmail Tool Executors
// ---------------------------------------------------------------------------

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function gmailFetch(creds, endpoint, options = {}) {
  const res = await fetch(`${GMAIL_API}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${creds.access_token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gmail API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Read recent emails from inbox.
 */
async function gmailReadInbox(creds, args) {
  const maxResults = Math.min(args.maxResults || 10, 20);
  const query = args.query || 'in:inbox';
  const list = await gmailFetch(creds, `/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`);

  if (!list.messages || list.messages.length === 0) {
    return { emails: [], count: 0 };
  }

  // Fetch message details (headers only for speed)
  const emails = await Promise.all(
    list.messages.slice(0, maxResults).map(async (msg) => {
      const detail = await gmailFetch(creds, `/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
      const headers = {};
      for (const h of detail.payload?.headers || []) {
        headers[h.name.toLowerCase()] = h.value;
      }
      return {
        id: msg.id,
        threadId: detail.threadId,
        from: headers.from || '',
        to: headers.to || '',
        subject: headers.subject || '(no subject)',
        date: headers.date || '',
        snippet: detail.snippet || '',
        labels: detail.labelIds || [],
      };
    })
  );

  return { emails, count: emails.length };
}

/**
 * Read a specific email's full content.
 */
async function gmailReadMessage(creds, args) {
  if (!args.messageId) throw new Error('messageId is required');
  const detail = await gmailFetch(creds, `/messages/${args.messageId}?format=full`);

  const headers = {};
  for (const h of detail.payload?.headers || []) {
    headers[h.name.toLowerCase()] = h.value;
  }

  // Extract body text
  let body = '';
  function extractText(part) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body += Buffer.from(part.body.data, 'base64url').toString('utf8');
    }
    if (part.parts) part.parts.forEach(extractText);
  }
  if (detail.payload) extractText(detail.payload);

  return {
    id: detail.id,
    threadId: detail.threadId,
    from: headers.from || '',
    to: headers.to || '',
    subject: headers.subject || '',
    date: headers.date || '',
    body: body.slice(0, 10000), // Cap at 10K chars
    labels: detail.labelIds || [],
  };
}

/**
 * Send an email.
 */
async function gmailSend(creds, args) {
  if (!args.to) throw new Error('to is required');
  if (!args.subject) throw new Error('subject is required');
  if (!args.body) throw new Error('body is required');

  const email = [
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    '',
    args.body,
  ].join('\r\n');

  const encoded = Buffer.from(email).toString('base64url');
  const result = await gmailFetch(creds, '/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw: encoded }),
  });

  return { sent: true, messageId: result.id, threadId: result.threadId };
}

/**
 * Reply to an email thread.
 */
async function gmailReply(creds, args) {
  if (!args.threadId) throw new Error('threadId is required');
  if (!args.to) throw new Error('to is required');
  if (!args.body) throw new Error('body is required');

  const subject = args.subject || '';
  const email = [
    `To: ${args.to}`,
    `Subject: ${subject.startsWith('Re:') ? subject : `Re: ${subject}`}`,
    `In-Reply-To: ${args.messageId || ''}`,
    `References: ${args.messageId || ''}`,
    `Content-Type: text/plain; charset=utf-8`,
    '',
    args.body,
  ].join('\r\n');

  const encoded = Buffer.from(email).toString('base64url');
  const result = await gmailFetch(creds, '/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw: encoded, threadId: args.threadId }),
  });

  return { sent: true, messageId: result.id, threadId: result.threadId };
}

// ---------------------------------------------------------------------------
// Google Calendar Tool Executors
// ---------------------------------------------------------------------------

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

async function calendarFetch(creds, endpoint, options = {}) {
  const res = await fetch(`${CALENDAR_API}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${creds.access_token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Calendar API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function calendarListEvents(creds, args) {
  const timeMin = args.timeMin || new Date().toISOString();
  const timeMax = args.timeMax || new Date(Date.now() + 7 * 86400000).toISOString();
  const maxResults = Math.min(args.maxResults || 20, 50);

  const params = new URLSearchParams({
    timeMin, timeMax, maxResults: String(maxResults),
    singleEvents: 'true', orderBy: 'startTime',
  });

  const result = await calendarFetch(creds, `/calendars/primary/events?${params}`);

  return {
    events: (result.items || []).map(e => ({
      id: e.id,
      summary: e.summary || '(no title)',
      start: e.start?.dateTime || e.start?.date || '',
      end: e.end?.dateTime || e.end?.date || '',
      location: e.location || '',
      description: (e.description || '').slice(0, 500),
      attendees: (e.attendees || []).map(a => a.email),
    })),
    count: (result.items || []).length,
  };
}

async function calendarCreateEvent(creds, args) {
  if (!args.summary) throw new Error('summary is required');
  if (!args.start) throw new Error('start is required');
  if (!args.end) throw new Error('end is required');

  const event = {
    summary: args.summary,
    description: args.description || '',
    location: args.location || '',
    start: { dateTime: args.start, timeZone: args.timeZone || 'America/Los_Angeles' },
    end: { dateTime: args.end, timeZone: args.timeZone || 'America/Los_Angeles' },
    attendees: (args.attendees || []).map(email => ({ email })),
  };

  const result = await calendarFetch(creds, '/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify(event),
  });

  return { created: true, eventId: result.id, link: result.htmlLink };
}

// ---------------------------------------------------------------------------
// Tool Registry — maps tool names to executors
// ---------------------------------------------------------------------------

const TOOL_REGISTRY = {
  'gmail.read_inbox': { service: 'gmail', executor: gmailReadInbox, description: 'Read recent emails from inbox' },
  'gmail.read_message': { service: 'gmail', executor: gmailReadMessage, description: 'Read a specific email by ID' },
  'gmail.send': { service: 'gmail', executor: gmailSend, description: 'Send a new email' },
  'gmail.reply': { service: 'gmail', executor: gmailReply, description: 'Reply to an email thread' },
  'calendar.list_events': { service: 'google_calendar', executor: calendarListEvents, description: 'List upcoming calendar events' },
  'calendar.create_event': { service: 'google_calendar', executor: calendarCreateEvent, description: 'Create a calendar event' },
};

/**
 * Execute a tool call. Loads credentials, runs the executor, returns result.
 *
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @param {string} toolName - e.g. "gmail.read_inbox"
 * @param {object} args - tool arguments
 * @returns {Promise<{success: boolean, result?: any, error?: string}>}
 */
export async function executeTool(pool, tenantId, toolName, args) {
  const tool = TOOL_REGISTRY[toolName];
  if (!tool) {
    return { success: false, error: `Unknown tool: ${toolName}` };
  }

  const creds = await getServiceCredentials(pool, tenantId, tool.service);
  if (!creds) {
    return { success: false, error: `${tool.service} not connected. Ask the owner to connect it.` };
  }

  try {
    const result = await tool.executor(creds, args || {});
    return { success: true, result };
  } catch (err) {
    log('error', `Tool ${toolName} failed for tenant ${tenantId}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Get tool definitions for LLM function calling.
 * Only returns tools for services the tenant has connected.
 */
export async function getAvailableTools(pool, tenantId) {
  const { rows } = await pool.query(
    `SELECT service FROM tenant_integrations WHERE tenant_id = $1 AND status = 'connected'`,
    [tenantId]
  );
  const connectedServices = new Set(rows.map(r => r.service));

  const tools = [];
  for (const [name, tool] of Object.entries(TOOL_REGISTRY)) {
    if (!connectedServices.has(tool.service)) continue;
    tools.push(getToolDefinition(name));
  }
  return tools;
}

/**
 * Get OpenAI-compatible tool definition for a specific tool.
 */
function getToolDefinition(toolName) {
  const definitions = {
    'gmail.read_inbox': {
      type: 'function',
      function: {
        name: 'gmail.read_inbox',
        description: 'Read recent emails from the inbox. Returns sender, subject, snippet, date.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Gmail search query (e.g. "from:customer@example.com", "is:unread")' },
            maxResults: { type: 'number', description: 'Maximum emails to return (1-20, default 10)' },
          },
        },
      },
    },
    'gmail.read_message': {
      type: 'function',
      function: {
        name: 'gmail.read_message',
        description: 'Read the full content of a specific email by its message ID.',
        parameters: {
          type: 'object',
          properties: {
            messageId: { type: 'string', description: 'The Gmail message ID to read' },
          },
          required: ['messageId'],
        },
      },
    },
    'gmail.send': {
      type: 'function',
      function: {
        name: 'gmail.send',
        description: 'Send a new email.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject line' },
            body: { type: 'string', description: 'Email body (plain text)' },
          },
          required: ['to', 'subject', 'body'],
        },
      },
    },
    'gmail.reply': {
      type: 'function',
      function: {
        name: 'gmail.reply',
        description: 'Reply to an existing email thread.',
        parameters: {
          type: 'object',
          properties: {
            threadId: { type: 'string', description: 'Gmail thread ID to reply to' },
            messageId: { type: 'string', description: 'Original message ID (for threading)' },
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Subject line (will be prefixed with Re:)' },
            body: { type: 'string', description: 'Reply body (plain text)' },
          },
          required: ['threadId', 'to', 'body'],
        },
      },
    },
    'calendar.list_events': {
      type: 'function',
      function: {
        name: 'calendar.list_events',
        description: 'List upcoming calendar events within a date range.',
        parameters: {
          type: 'object',
          properties: {
            timeMin: { type: 'string', description: 'Start of range (ISO 8601). Defaults to now.' },
            timeMax: { type: 'string', description: 'End of range (ISO 8601). Defaults to 7 days from now.' },
            maxResults: { type: 'number', description: 'Max events to return (1-50, default 20)' },
          },
        },
      },
    },
    'calendar.create_event': {
      type: 'function',
      function: {
        name: 'calendar.create_event',
        description: 'Create a new calendar event.',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Event title' },
            start: { type: 'string', description: 'Start time (ISO 8601)' },
            end: { type: 'string', description: 'End time (ISO 8601)' },
            description: { type: 'string', description: 'Event description' },
            location: { type: 'string', description: 'Event location' },
            attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses' },
            timeZone: { type: 'string', description: 'Time zone (default: America/Los_Angeles)' },
          },
          required: ['summary', 'start', 'end'],
        },
      },
    },
  };

  return definitions[toolName] || null;
}

export default {
  handleAuthorize,
  handleCallback,
  handleStatus,
  executeTool,
  getAvailableTools,
  getServiceCredentials,
  TOOL_REGISTRY,
};
