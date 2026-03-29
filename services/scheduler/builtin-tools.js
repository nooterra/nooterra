/**
 * Built-in Tools — zero-dependency tools that work without Composio
 *
 * Provides web search, webpage browsing, document reading, SMS/voice,
 * and transactional email capabilities using only native Node.js fetch.
 * No external packages required.
 *
 * Tools:
 *   web_search      — Brave Search API (with DuckDuckGo fallback)
 *   browse_webpage  — Fetch and extract readable text from any URL
 *   read_document   — Read PDF, TXT, CSV, JSON, Markdown from a URL
 *   send_sms        — Send SMS via Twilio
 *   make_phone_call — Initiate a TTS phone call via Twilio
 *   send_email      — Send transactional email via Resend
 */

const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY;

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'workers@nooterra.ai';

const BUILTIN_TOOL_NAMES = new Set([
  'web_search', 'browse_webpage', 'read_document',
  'send_sms', 'make_phone_call', 'send_email',
]);

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, component: 'builtin-tools', msg });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

// ---------------------------------------------------------------------------
// Tool Definitions (OpenAI function-calling format)
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information. Returns titles, URLs, and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'integer', description: 'Number of results (max 10)', default: 5 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browse_webpage',
      description: 'Fetch a webpage and extract its text content. For reading articles, docs, or any URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          selector: { type: 'string', description: 'Optional CSS selector to extract specific content' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_document',
      description: 'Read content from a document URL (PDF, TXT, CSV, JSON, Markdown).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the document' },
          format: { type: 'string', description: 'Document format hint', enum: ['auto', 'pdf', 'txt', 'csv', 'json', 'md'] },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_sms',
      description: 'Send an SMS text message via Twilio.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Phone number to send to (E.164 format, e.g. +1234567890)' },
          body: { type: 'string', description: 'Message text (max 1600 chars)' },
        },
        required: ['to', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'make_phone_call',
      description: 'Initiate a phone call via Twilio. The call plays a text-to-speech message.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Phone number to call (E.164 format)' },
          message: { type: 'string', description: 'Message to speak (text-to-speech)' },
          voice: { type: 'string', description: 'Voice to use', enum: ['alice', 'man', 'woman'], default: 'alice' },
        },
        required: ['to', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Send a transactional email.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject line' },
          body: { type: 'string', description: 'Email body (plain text or HTML)' },
          html: { type: 'boolean', description: 'Whether body is HTML', default: false },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// HTML Helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags, scripts, styles → readable text */
function stripHtml(html) {
  return html
    // Remove script/style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    // Replace common block elements with newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extract <title> from HTML */
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]).trim() : '';
}

// ---------------------------------------------------------------------------
// Tool Implementations
// ---------------------------------------------------------------------------

async function webSearch({ query, count = 5 }) {
  count = Math.min(Math.max(count, 1), 10);

  if (BRAVE_SEARCH_API_KEY) {
    return webSearchBrave(query, count);
  }
  return webSearchDuckDuckGo(query, count);
}

async function webSearchBrave(query, count) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const resp = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': BRAVE_SEARCH_API_KEY,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    throw new Error(`Brave Search API returned ${resp.status}: ${resp.statusText}`);
  }

  const data = await resp.json();
  const results = (data.web?.results || []).slice(0, count).map(r => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.description || '',
  }));

  return { results };
}

async function webSearchDuckDuckGo(query, count) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    throw new Error(`DuckDuckGo returned ${resp.status}: ${resp.statusText}`);
  }

  const html = await resp.text();
  const results = [];

  // Parse DuckDuckGo HTML results — each result is in a .result class div
  // Links are in <a class="result__a"> and snippets in <a class="result__snippet">
  const resultBlocks = html.split(/class="result\s/);
  for (let i = 1; i < resultBlocks.length && results.length < count; i++) {
    const block = resultBlocks[i];

    // Extract URL from result__a href
    const linkMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;

    let resultUrl = linkMatch[1] || '';
    // DuckDuckGo wraps URLs in a redirect; extract the actual URL
    const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) resultUrl = decodeURIComponent(uddgMatch[1]);

    const title = stripHtml(linkMatch[2]);

    // Extract snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';

    if (resultUrl && title) {
      results.push({ title, url: resultUrl, snippet });
    }
  }

  return { results };
}

async function browseWebpage({ url, selector }) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
  }

  const html = await resp.text();
  const title = extractTitle(html);

  let content;
  if (selector) {
    // Simple CSS selector extraction — handles basic id/class/tag selectors
    const selectorPattern = buildSelectorPattern(selector);
    if (selectorPattern) {
      const match = html.match(selectorPattern);
      content = match ? stripHtml(match[0]) : stripHtml(html);
    } else {
      content = stripHtml(html);
    }
  } else {
    // Try to extract <main> or <article> first for cleaner content
    const mainMatch = html.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i);
    content = mainMatch ? stripHtml(mainMatch[2]) : stripHtml(html);
  }

  // Truncate to 15KB for LLM context friendliness
  const MAX_LENGTH = 15000;
  if (content.length > MAX_LENGTH) {
    content = content.slice(0, MAX_LENGTH) + '\n\n[Content truncated at 15KB]';
  }

  return { url, title, content, length: content.length };
}

/** Build a rough regex for simple CSS selectors */
function buildSelectorPattern(selector) {
  if (selector.startsWith('#')) {
    const id = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`<[^>]+id=["']${id}["'][^>]*>[\\s\\S]*?<\\/[^>]+>`, 'i');
  }
  if (selector.startsWith('.')) {
    const cls = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`<[^>]+class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\/[^>]+>`, 'i');
  }
  // Plain tag name
  const tag = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'i');
}

async function readDocument({ url, format = 'auto' }) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
  }

  // Detect format from Content-Type header or URL extension
  const contentType = resp.headers.get('content-type') || '';
  if (format === 'auto') {
    format = detectFormat(url, contentType);
  }

  const MAX_LENGTH = 20000;

  if (format === 'pdf') {
    // Read as raw bytes and do rough text extraction
    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const content = extractPdfText(bytes).slice(0, MAX_LENGTH);
    return {
      url,
      format: 'pdf',
      content: content || '[Could not extract text from PDF — may be image-based or encrypted]',
      length: content.length,
    };
  }

  // For all text-based formats, just read as text
  let content = await resp.text();
  if (content.length > MAX_LENGTH) {
    content = content.slice(0, MAX_LENGTH) + '\n\n[Content truncated at 20KB]';
  }

  return { url, format, content, length: content.length };
}

function detectFormat(url, contentType) {
  if (contentType.includes('application/pdf')) return 'pdf';
  if (contentType.includes('text/csv')) return 'csv';
  if (contentType.includes('application/json')) return 'json';
  if (contentType.includes('text/markdown')) return 'md';
  if (contentType.includes('text/plain')) return 'txt';

  // Fall back to URL extension
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv') return 'csv';
  if (ext === 'json') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'md';
  return 'txt';
}

/**
 * Rough PDF text extraction — pulls text from between BT/ET markers.
 * Works for simple text-based PDFs. Image-based PDFs will return little/nothing.
 */
function extractPdfText(bytes) {
  // Convert bytes to a latin1 string (preserves byte values)
  let raw = '';
  for (let i = 0; i < bytes.length; i++) {
    raw += String.fromCharCode(bytes[i]);
  }

  const textChunks = [];

  // Strategy 1: Extract text between BT (Begin Text) and ET (End Text) operators
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(raw)) !== null) {
    const block = match[1];

    // Extract text from Tj operator: (text) Tj
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      textChunks.push(tjMatch[1]);
    }

    // Extract text from TJ operator: [(text) kerning (text)] TJ
    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let tjArr;
    while ((tjArr = tjArrayRegex.exec(block)) !== null) {
      const inner = tjArr[1];
      const parts = /\(([^)]*)\)/g;
      let part;
      while ((part = parts.exec(inner)) !== null) {
        textChunks.push(part[1]);
      }
    }
  }

  // Strategy 2: If BT/ET extraction yielded nothing, try stream objects
  if (textChunks.length === 0) {
    const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
    while ((match = streamRegex.exec(raw)) !== null) {
      const stream = match[1];
      // Look for readable ASCII sequences
      const readable = stream.replace(/[^\x20-\x7e\n\r]/g, ' ').replace(/\s{3,}/g, ' ').trim();
      if (readable.length > 20) {
        textChunks.push(readable);
      }
    }
  }

  // Clean up extracted text
  return textChunks
    .join(' ')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Twilio Helpers
// ---------------------------------------------------------------------------

function twilioConfigured() {
  return TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER;
}

function twilioAuthHeader() {
  const creds = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  return `Basic ${creds}`;
}

/** Escape special XML characters for TwiML */
function xmlEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function sendSms({ to, body }) {
  if (!twilioConfigured()) {
    return { error: 'Twilio not configured' };
  }

  body = String(body).slice(0, 1600);

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const formBody = new URLSearchParams({ To: to, From: TWILIO_PHONE_NUMBER, Body: body });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': twilioAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody.toString(),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Twilio SMS failed (${resp.status}): ${err}`);
  }

  const message = await resp.json();
  return { ok: true, sid: message.sid, to, status: message.status };
}

async function makePhoneCall({ to, message, voice = 'alice' }) {
  if (!twilioConfigured()) {
    return { error: 'Twilio not configured' };
  }

  const twiml = `<Response><Say voice="${xmlEscape(voice)}">${xmlEscape(message)}</Say></Response>`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`;
  const formBody = new URLSearchParams({ To: to, From: TWILIO_PHONE_NUMBER, Twiml: twiml });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': twilioAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody.toString(),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Twilio Call failed (${resp.status}): ${err}`);
  }

  const call = await resp.json();
  return { ok: true, sid: call.sid, to, status: call.status };
}

// ---------------------------------------------------------------------------
// Email (Resend)
// ---------------------------------------------------------------------------

async function sendEmail({ to, subject, body, html = false }) {
  if (!RESEND_API_KEY) {
    return { error: 'Email not configured — set RESEND_API_KEY' };
  }

  const payload = {
    from: RESEND_FROM,
    to,
    subject,
  };

  if (html) {
    payload.html = body;
  } else {
    payload.text = body;
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Resend email failed (${resp.status}): ${err}`);
  }

  const data = await resp.json();
  return { ok: true, id: data.id, to, subject };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns array of tool definitions in OpenAI function-calling format */
export function getBuiltinTools() {
  return [...TOOL_DEFINITIONS];
}

/** Check if a tool name is a builtin tool */
export function isBuiltinTool(name) {
  return BUILTIN_TOOL_NAMES.has(name);
}

/**
 * Execute a builtin tool by name.
 * @param {string} toolName
 * @param {object} args
 * @returns {Promise<{success: boolean, result?: any, error?: string}>}
 */
export async function executeBuiltinTool(toolName, args) {
  try {
    let result;
    switch (toolName) {
      case 'web_search':
        result = await webSearch(args);
        break;
      case 'browse_webpage':
        result = await browseWebpage(args);
        break;
      case 'read_document':
        result = await readDocument(args);
        break;
      case 'send_sms':
        result = await sendSms(args);
        break;
      case 'make_phone_call':
        result = await makePhoneCall(args);
        break;
      case 'send_email':
        result = await sendEmail(args);
        break;
      default:
        return { success: false, error: `Unknown builtin tool: ${toolName}` };
    }

    log('info', `Builtin tool executed: ${toolName}`);
    return { success: true, result };
  } catch (err) {
    log('error', `Builtin tool ${toolName} failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export default { getBuiltinTools, isBuiltinTool, executeBuiltinTool };
