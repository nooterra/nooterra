/**
 * Built-in Tools
 *
 * Real, working tools that workers can use with ZERO configuration.
 * No MCP servers, no npm installs, no JSON config. Just works.
 *
 * Every tool uses only Node.js built-ins: fetch, fs, path, os, net, child_process.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { execSync } from 'child_process';

const HOME = os.homedir();
const NOOTERRA_DIR = path.join(HOME, '.nooterra');
const CREDENTIALS_DIR = path.join(NOOTERRA_DIR, 'credentials');
const WORKSPACE_DIR = path.join(NOOTERRA_DIR, 'workspace');
const NOTIFICATIONS_DIR = path.join(NOOTERRA_DIR, 'notifications');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readCredential(filename) {
  const fp = path.join(CREDENTIALS_DIR, filename);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, 'utf-8').trim();
}

function stripHtml(html) {
  // Remove script/style blocks entirely
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // Replace common block elements with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode common entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function extractLinks(html) {
  const links = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    const text = stripHtml(m[2]).trim();
    if (url && !url.startsWith('#') && !url.startsWith('javascript:')) {
      links.push({ url, text: text || url });
    }
  }
  return links;
}

function isPathSafe(p) {
  const resolved = path.resolve(p);
  const cwd = process.cwd();
  return resolved.startsWith(NOOTERRA_DIR) || resolved.startsWith(cwd);
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const BUILT_IN_TOOLS = {

  // =========================================================================
  // 1. web_fetch
  // =========================================================================
  web_fetch: {
    name: 'web_fetch',
    description: 'Fetch a webpage or API endpoint. Returns clean text by default, or raw HTML/JSON/links.',
    parameters: {
      type: 'object',
      properties: {
        url:     { type: 'string', description: 'The URL to fetch' },
        method:  { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method (default GET)' },
        headers: { type: 'object', description: 'Custom request headers' },
        body:    { type: 'string', description: 'Request body (for POST/PUT)' },
        extract: { type: 'string', enum: ['text', 'html', 'json', 'links'], description: 'Extraction mode (default text)' }
      },
      required: ['url']
    },
    requiresAuth: false,
    execute: async (args) => {
      const { url, method = 'GET', headers = {}, body, extract = 'text' } = args;
      if (!url) throw new Error('url is required');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      try {
        const opts = {
          method,
          headers: {
            'User-Agent': 'Nooterra-Worker/1.0 (https://nooterra.com)',
            'Accept': 'text/html,application/json,*/*',
            ...headers
          },
          redirect: 'follow',
          signal: controller.signal
        };
        if (body && (method === 'POST' || method === 'PUT')) {
          opts.body = body;
          if (!opts.headers['Content-Type']) {
            opts.headers['Content-Type'] = 'application/json';
          }
        }

        const response = await fetch(url, opts);
        const contentType = response.headers.get('content-type') || '';

        if (extract === 'json' || contentType.includes('application/json')) {
          const json = await response.json();
          return JSON.stringify(json, null, 2);
        }

        const html = await response.text();

        switch (extract) {
          case 'html':
            return html;
          case 'links': {
            const links = extractLinks(html);
            return JSON.stringify(links, null, 2);
          }
          case 'json': {
            // already handled above, but if content-type lied
            try { return JSON.stringify(JSON.parse(html), null, 2); }
            catch { return html; }
          }
          case 'text':
          default:
            return stripHtml(html);
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  },

  // =========================================================================
  // 2. web_search
  // =========================================================================
  web_search: {
    name: 'web_search',
    description: 'Search the web. Uses Brave Search API (if key available), DuckDuckGo, or Google as fallback. Returns top results with title, URL, and snippet.',
    parameters: {
      type: 'object',
      properties: {
        query:       { type: 'string', description: 'Search query' },
        num_results: { type: 'number', description: 'Max results to return (default 8)' }
      },
      required: ['query']
    },
    requiresAuth: false,
    execute: async (args) => {
      const { query, num_results = 8 } = args;
      if (!query) throw new Error('query is required');

      const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
      const errors = [];

      // -----------------------------------------------------------------
      // Strategy 1: Brave Search API (most reliable, needs key)
      // -----------------------------------------------------------------
      async function searchBrave() {
        const braveKey = readCredential('brave-search-token.txt') || process.env.BRAVE_API_KEY;
        if (!braveKey) return null; // no key, skip silently

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
          const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${num_results}`;
          const response = await fetch(url, {
            headers: {
              'Accept': 'application/json',
              'Accept-Encoding': 'gzip',
              'X-Subscription-Token': braveKey
            },
            signal: controller.signal
          });

          if (!response.ok) {
            throw new Error(`Brave API ${response.status}: ${await response.text()}`);
          }

          const data = await response.json();
          const webResults = data.web?.results || [];
          return webResults.slice(0, num_results).map(r => ({
            title: r.title || '',
            url: r.url || '',
            snippet: r.description || ''
          }));
        } finally {
          clearTimeout(timeout);
        }
      }

      // -----------------------------------------------------------------
      // Strategy 2: DuckDuckGo HTML scrape (free, no key)
      // -----------------------------------------------------------------
      async function searchDuckDuckGo() {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
          // Use lite.duckduckgo.com — simpler HTML, less likely to CAPTCHA
          const url = `https://lite.duckduckgo.com/lite/`;
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'User-Agent': BROWSER_UA,
              'Accept': 'text/html',
              'Accept-Language': 'en-US,en;q=0.9',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `q=${encodeURIComponent(query)}`,
            redirect: 'follow',
            signal: controller.signal
          });

          const html = await response.text();
          const results = [];

          // Lite version: extract all external https links with their text
          const linkMatches = [...html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];

          for (const match of linkMatches) {
            if (results.length >= num_results) break;
            const resultUrl = match[1];
            const title = stripHtml(match[2]).trim();

            // Skip DuckDuckGo internal links and empty titles
            if (!title || title.length < 3) continue;
            if (resultUrl.includes('duckduckgo.com')) continue;
            if (resultUrl.includes('duck.co')) continue;

            // Try to get a snippet — look for text after this link
            const afterLink = html.slice(html.indexOf(match[0]) + match[0].length, html.indexOf(match[0]) + match[0].length + 500);
            const snippetMatch = afterLink.match(/<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/);
            const snippet = snippetMatch ? stripHtml(snippetMatch[1]).trim() : '';

            results.push({ title, url: resultUrl, snippet });
          }

          return results.length > 0 ? results : null;
        } finally {
          clearTimeout(timeout);
        }
      }

      // -----------------------------------------------------------------
      // Strategy 3: Google HTML scrape (fallback)
      // -----------------------------------------------------------------
      async function searchGoogle() {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
          const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${num_results}&hl=en`;
          const response = await fetch(url, {
            headers: {
              'User-Agent': BROWSER_UA,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              'Referer': 'https://www.google.com/'
            },
            redirect: 'follow',
            signal: controller.signal
          });

          const html = await response.text();
          const results = [];

          // Google results are in <div class="g"> blocks
          // Each contains an <a href="URL"> and <h3> for the title
          const gBlocks = html.split(/<div class="g"/);

          for (let i = 1; i < gBlocks.length && results.length < num_results; i++) {
            const block = gBlocks[i];

            // Extract the first <a href="..."> that points to an external URL
            const linkMatch = block.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>/);
            if (!linkMatch) continue;
            const resultUrl = linkMatch[1];

            // Skip Google's own links
            if (resultUrl.includes('google.com/search') || resultUrl.includes('accounts.google.com')) continue;

            // Extract title from <h3>
            const h3Match = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
            const title = h3Match ? stripHtml(h3Match[1]).trim() : '';

            // Extract snippet — Google uses various containers, look for common patterns
            let snippet = '';
            // Try data-sncf attribute spans (common in modern Google)
            const snipMatch = block.match(/<span[^>]*class="[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<\/div>\s*<\/div>/);
            if (snipMatch) {
              snippet = stripHtml(snipMatch[1]).trim();
            }
            // Fallback: grab text after the URL display line
            if (!snippet) {
              const emMatch = block.match(/<em>([\s\S]*?)<\/em>/);
              if (emMatch) snippet = stripHtml(emMatch[1]).trim();
            }

            if (title && resultUrl) {
              results.push({ title, url: resultUrl, snippet });
            }
          }

          return results.length > 0 ? results : null;
        } finally {
          clearTimeout(timeout);
        }
      }

      // -----------------------------------------------------------------
      // Execute the search chain: Brave -> DuckDuckGo -> Google
      // -----------------------------------------------------------------
      const strategies = [
        { name: 'Brave Search API', fn: searchBrave },
        { name: 'DuckDuckGo', fn: searchDuckDuckGo },
        { name: 'Google', fn: searchGoogle }
      ];

      for (const strategy of strategies) {
        try {
          const results = await strategy.fn();
          if (results && results.length > 0) {
            return JSON.stringify({ query, source: strategy.name, results }, null, 2);
          }
          // null or empty means this strategy had no results, try next
        } catch (err) {
          errors.push(`${strategy.name}: ${err.message}`);
        }
      }

      // All strategies failed or returned empty
      return JSON.stringify({
        query,
        results: [],
        error: 'All search engines failed or returned no results.',
        details: errors.length > 0 ? errors : ['DuckDuckGo and Google returned 0 results. Try a more specific query.'],
        hint: 'For reliable results, add a Brave Search API key: save it to ~/.nooterra/credentials/brave-search-token.txt or set BRAVE_API_KEY env. Free tier at https://brave.com/search/api/'
      }, null, 2);
    }
  },

  // =========================================================================
  // 3. read_file
  // =========================================================================
  read_file: {
    name: 'read_file',
    description: 'Read a file from the filesystem. Limited to ~/.nooterra/ and current working directory for safety.',
    parameters: {
      type: 'object',
      properties: {
        path:     { type: 'string', description: 'File path to read' },
        encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Encoding (default utf8)' }
      },
      required: ['path']
    },
    requiresAuth: false,
    execute: async (args) => {
      const filePath = args.path;
      if (!filePath) throw new Error('path is required');

      const resolved = path.resolve(filePath.replace(/^~/, HOME));
      if (!isPathSafe(resolved)) {
        throw new Error(`Access denied: path must be under ~/.nooterra/ or current working directory. Got: ${resolved}`);
      }
      if (!fs.existsSync(resolved)) {
        throw new Error(`File not found: ${resolved}`);
      }

      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(resolved);
        return `Directory listing for ${resolved}:\n${entries.join('\n')}`;
      }

      const encoding = args.encoding === 'base64' ? 'base64' : 'utf-8';
      const content = fs.readFileSync(resolved, encoding);

      // Truncate very large files
      if (content.length > 500_000) {
        return content.slice(0, 500_000) + `\n\n[truncated — file is ${stat.size} bytes]`;
      }
      return content;
    }
  },

  // =========================================================================
  // 4. write_file
  // =========================================================================
  write_file: {
    name: 'write_file',
    description: 'Write a file to ~/.nooterra/workspace/. Creates directories as needed.',
    parameters: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'File path relative to ~/.nooterra/workspace/' },
        content: { type: 'string', description: 'File content to write' }
      },
      required: ['path', 'content']
    },
    requiresAuth: false,
    execute: async (args) => {
      const { content } = args;
      let filePath = args.path;
      if (!filePath) throw new Error('path is required');
      if (content === undefined || content === null) throw new Error('content is required');

      // Force all writes into workspace
      if (path.isAbsolute(filePath)) {
        filePath = path.basename(filePath);
      }
      // Strip leading ../ traversal attempts
      filePath = filePath.replace(/^(\.\.[\\/])+/, '');

      const fullPath = path.join(WORKSPACE_DIR, filePath);
      ensureDir(path.dirname(fullPath));
      fs.writeFileSync(fullPath, content, 'utf-8');
      return `Written ${content.length} bytes to ${fullPath}`;
    }
  },

  // =========================================================================
  // 5. run_command
  // =========================================================================
  run_command: {
    name: 'run_command',
    description: 'Execute a whitelisted shell command and return stdout/stderr. 30s timeout.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' }
      },
      required: ['command']
    },
    requiresAuth: false,
    execute: async (args) => {
      const { command } = args;
      if (!command) throw new Error('command is required');

      const ALLOWED = new Set([
        'curl', 'wget', 'node', 'python3', 'echo', 'date',
        'ls', 'cat', 'head', 'tail', 'wc', 'sort', 'uniq', 'jq', 'grep'
      ]);

      // Extract the base command (first token, ignoring env vars)
      const tokens = command.trim().split(/\s+/);
      let baseCmd = tokens[0];
      // Skip env var assignments like FOO=bar
      for (const tok of tokens) {
        if (tok.includes('=') && !tok.startsWith('-')) continue;
        baseCmd = tok;
        break;
      }
      // Resolve to basename in case of /usr/bin/curl etc
      baseCmd = path.basename(baseCmd);

      if (!ALLOWED.has(baseCmd)) {
        throw new Error(`Command not allowed: "${baseCmd}". Allowed: ${[...ALLOWED].join(', ')}`);
      }

      try {
        const stdout = execSync(command, {
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        return stdout || '(no output)';
      } catch (err) {
        const output = (err.stdout || '') + (err.stderr || '');
        if (err.killed) {
          throw new Error(`Command timed out (30s): ${command}\n${output}`);
        }
        throw new Error(`Command failed (exit ${err.status}): ${command}\n${output}`);
      }
    }
  },

  // =========================================================================
  // 6. send_notification
  // =========================================================================
  send_notification: {
    name: 'send_notification',
    description: 'Send a notification. Logs to console and saves to ~/.nooterra/notifications/.',
    parameters: {
      type: 'object',
      properties: {
        title:   { type: 'string', description: 'Notification title' },
        message: { type: 'string', description: 'Notification body' },
        urgency: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Urgency level (default medium)' }
      },
      required: ['title', 'message']
    },
    requiresAuth: false,
    execute: async (args) => {
      const { title, message, urgency = 'medium' } = args;
      if (!title) throw new Error('title is required');
      if (!message) throw new Error('message is required');

      const notification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title,
        message,
        urgency,
        timestamp: new Date().toISOString(),
        read: false
      };

      // Log to console
      const prefix = urgency === 'high' ? '[!!!]' : urgency === 'medium' ? '[!]' : '[i]';
      console.log(`${prefix} ${title}: ${message}`);

      // Persist to disk
      ensureDir(NOTIFICATIONS_DIR);
      const logFile = path.join(NOTIFICATIONS_DIR, 'notifications.json');
      let existing = [];
      try {
        if (fs.existsSync(logFile)) {
          existing = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
        }
      } catch { /* ignore corrupt file */ }
      existing.unshift(notification);
      // Keep last 200
      if (existing.length > 200) existing = existing.slice(0, 200);
      fs.writeFileSync(logFile, JSON.stringify(existing, null, 2));

      return `Notification sent: ${title}`;
    }
  },

  // =========================================================================
  // 7. slack_send (auth required)
  // =========================================================================
  slack_send: {
    name: 'slack_send',
    description: 'Send a message to a Slack channel. Requires a Slack bot token in ~/.nooterra/credentials/slack-token.txt.',
    parameters: {
      type: 'object',
      properties: {
        channel:   { type: 'string', description: 'Slack channel name or ID (e.g. #general or C01234ABC)' },
        text:      { type: 'string', description: 'Message text' },
        thread_ts: { type: 'string', description: 'Thread timestamp to reply in a thread' }
      },
      required: ['channel', 'text']
    },
    requiresAuth: true,
    authHint: 'Run: /connect slack <your-bot-token>',
    execute: async (args) => {
      const { channel, text, thread_ts } = args;
      if (!channel) throw new Error('channel is required');
      if (!text) throw new Error('text is required');

      const token = readCredential('slack-token.txt');
      if (!token) {
        throw new Error('Slack not connected. Save your bot token to ~/.nooterra/credentials/slack-token.txt or run /connect slack <token>');
      }

      const payload = { channel, text };
      if (thread_ts) payload.thread_ts = thread_ts;

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!result.ok) {
        throw new Error(`Slack API error: ${result.error}`);
      }

      return `Message sent to ${channel} (ts: ${result.ts})`;
    }
  },

  // =========================================================================
  // 8. slack_read (auth required)
  // =========================================================================
  slack_read: {
    name: 'slack_read',
    description: 'Read recent messages from a Slack channel. Requires a Slack bot token.',
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Slack channel ID (e.g. C01234ABC)' },
        limit:   { type: 'number', description: 'Number of messages to fetch (default 20, max 100)' }
      },
      required: ['channel']
    },
    requiresAuth: true,
    authHint: 'Run: /connect slack <your-bot-token>',
    execute: async (args) => {
      const { channel } = args;
      let limit = args.limit || 20;
      if (limit > 100) limit = 100;
      if (!channel) throw new Error('channel is required');

      const token = readCredential('slack-token.txt');
      if (!token) {
        throw new Error('Slack not connected. Save your bot token to ~/.nooterra/credentials/slack-token.txt or run /connect slack <token>');
      }

      const url = `https://slack.com/api/conversations.history?channel=${encodeURIComponent(channel)}&limit=${limit}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const result = await response.json();
      if (!result.ok) {
        throw new Error(`Slack API error: ${result.error}`);
      }

      const messages = (result.messages || []).map(msg => ({
        user: msg.user || msg.bot_id || 'unknown',
        text: msg.text,
        ts: msg.ts,
        thread_ts: msg.thread_ts || null
      }));

      return JSON.stringify(messages, null, 2);
    }
  },

  // =========================================================================
  // 9. github_api (auth required)
  // =========================================================================
  github_api: {
    name: 'github_api',
    description: 'Make authenticated GitHub API calls. Reads token from ~/.nooterra/credentials/github-token.txt or GITHUB_TOKEN env.',
    parameters: {
      type: 'object',
      properties: {
        endpoint: { type: 'string', description: 'API endpoint path, e.g. /repos/owner/repo/issues' },
        method:   { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method (default GET)' },
        body:     { type: 'object', description: 'Request body (for POST/PUT/PATCH)' }
      },
      required: ['endpoint']
    },
    requiresAuth: true,
    authHint: 'Run: /connect github <your-personal-access-token> or set GITHUB_TOKEN env var',
    execute: async (args) => {
      const { endpoint, method = 'GET', body } = args;
      if (!endpoint) throw new Error('endpoint is required');

      const token = readCredential('github-token.txt') || process.env.GITHUB_TOKEN;
      if (!token) {
        throw new Error('GitHub not connected. Save your token to ~/.nooterra/credentials/github-token.txt, set GITHUB_TOKEN, or run /connect github <token>');
      }

      // Normalize endpoint
      const apiUrl = endpoint.startsWith('https://')
        ? endpoint
        : `https://api.github.com${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

      const opts = {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Nooterra-Worker/1.0',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      };

      if (body && method !== 'GET') {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }

      const response = await fetch(apiUrl, opts);
      const text = await response.text();

      if (!response.ok) {
        throw new Error(`GitHub API ${response.status}: ${text}`);
      }

      // Pretty-print JSON responses
      try {
        return JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        return text || '(empty response)';
      }
    }
  },

  // =========================================================================
  // 10. send_email (auth required)
  // =========================================================================
  send_email: {
    name: 'send_email',
    description: 'Send email via raw SMTP. Reads config from ~/.nooterra/credentials/email-config.json.',
    parameters: {
      type: 'object',
      properties: {
        to:      { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body:    { type: 'string', description: 'Email body (plain text)' },
        from:    { type: 'string', description: 'Sender email (overrides config default)' }
      },
      required: ['to', 'subject', 'body']
    },
    requiresAuth: true,
    authHint: 'Create ~/.nooterra/credentials/email-config.json with { host, port, user, pass, from }',
    execute: async (args) => {
      const { to, subject, body } = args;
      if (!to) throw new Error('to is required');
      if (!subject) throw new Error('subject is required');
      if (!body) throw new Error('body is required');

      const configRaw = readCredential('email-config.json');
      if (!configRaw) {
        throw new Error(
          'Email not configured. Create ~/.nooterra/credentials/email-config.json with:\n' +
          '{ "host": "smtp.gmail.com", "port": 587, "user": "you@gmail.com", "pass": "app-password", "from": "you@gmail.com" }'
        );
      }

      let config;
      try {
        config = JSON.parse(configRaw);
      } catch {
        throw new Error('Invalid email-config.json — must be valid JSON');
      }

      const from = args.from || config.from || config.user;
      const host = config.host;
      const port = config.port || 587;
      const user = config.user;
      const pass = config.pass;

      if (!host || !user || !pass) {
        throw new Error('email-config.json must have host, user, and pass fields');
      }

      // Raw SMTP conversation using Node.js net/tls
      return new Promise((resolve, reject) => {
        const tls = require('tls');
        let socket;
        let buffer = '';
        let step = 0;
        const timer = setTimeout(() => {
          if (socket) socket.destroy();
          reject(new Error('SMTP timeout (30s)'));
        }, 30_000);

        const commands = [
          null, // wait for greeting
          `EHLO nooterra.local\r\n`,
          `STARTTLS\r\n`,
          null, // upgrade happens here
          `EHLO nooterra.local\r\n`,
          `AUTH LOGIN\r\n`,
          Buffer.from(user).toString('base64') + '\r\n',
          Buffer.from(pass).toString('base64') + '\r\n',
          `MAIL FROM:<${from}>\r\n`,
          `RCPT TO:<${to}>\r\n`,
          'DATA\r\n',
          `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\nDate: ${new Date().toUTCString()}\r\n\r\n${body.split('\n').map(line => line.startsWith('.') ? '.' + line : line).join('\n')}\r\n.\r\n`,
          'QUIT\r\n'
        ];

        function advance(data) {
          buffer += data.toString();
          const lines = buffer.split('\r\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line) continue;
            const code = parseInt(line.slice(0, 3), 10);

            // Multi-line responses (e.g. 250-SIZE ... 250 OK)
            if (line[3] === '-') continue;

            if (code >= 400) {
              clearTimeout(timer);
              if (socket) socket.destroy();
              reject(new Error(`SMTP error: ${line}`));
              return;
            }

            step++;
            if (step === 3) {
              // STARTTLS accepted, upgrade to TLS
              const tlsSocket = tls.connect({ socket, servername: host }, () => {
                socket = tlsSocket;
                socket.on('data', advance);
                // After TLS upgrade, send next EHLO
                step++;
                socket.write(commands[step]);
              });
              tlsSocket.on('error', (err) => {
                clearTimeout(timer);
                reject(new Error(`TLS error: ${err.message}`));
              });
              return;
            }

            if (step < commands.length && commands[step]) {
              socket.write(commands[step]);
            }

            if (step >= commands.length) {
              clearTimeout(timer);
              if (socket) socket.destroy();
              resolve(`Email sent to ${to}: "${subject}"`);
              return;
            }
          }
        }

        socket = net.createConnection({ host, port }, () => {
          socket.on('data', advance);
        });

        socket.on('error', (err) => {
          clearTimeout(timer);
          reject(new Error(`SMTP connection error: ${err.message}`));
        });
      });
    }
  }
};

// ---------------------------------------------------------------------------
// Capability-to-tools mapping
// ---------------------------------------------------------------------------

const CAPABILITY_TOOL_MAP = {
  browser:     ['web_fetch', 'web_search'],
  slack:       ['slack_send', 'slack_read'],
  github:      ['github_api'],
  email:       ['send_email'],
  filesystem:  ['read_file', 'write_file'],
  terminal:    ['run_command']
};

// These are always available regardless of capabilities
const FREE_TOOLS = ['web_fetch', 'web_search', 'send_notification'];

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Get tool definitions for a worker based on its declared capabilities.
 * Always includes free tools (web_fetch, web_search, send_notification).
 *
 * @param {string[]} workerCapabilities - Array of capability IDs (e.g. ["browser", "slack", "github"])
 * @returns {Object[]} Tool definitions (name, description, parameters) suitable for LLM function calling
 */
export function getAvailableTools(workerCapabilities = []) {
  const toolNames = new Set(FREE_TOOLS);

  for (const cap of workerCapabilities) {
    const mapped = CAPABILITY_TOOL_MAP[cap];
    if (mapped) {
      for (const t of mapped) toolNames.add(t);
    }
  }

  return [...toolNames]
    .map(name => BUILT_IN_TOOLS[name])
    .filter(Boolean)
    .map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      requiresAuth: tool.requiresAuth
    }));
}

/**
 * Execute a tool by name with the given arguments.
 *
 * @param {string} toolName
 * @param {Object} args
 * @returns {Promise<string>} The tool result as a string
 */
export async function executeTool(toolName, args) {
  const tool = BUILT_IN_TOOLS[toolName];
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}. Available: ${Object.keys(BUILT_IN_TOOLS).join(', ')}`);
  }
  try {
    return await tool.execute(args);
  } catch (err) {
    throw new Error(`Tool "${toolName}" failed: ${err.message}`);
  }
}

/**
 * Get the status of all tools — which are available and which need auth.
 *
 * @returns {Object} Map of tool names to { available: boolean, needsAuth: boolean, authHint?: string }
 */
export function getToolStatus() {
  const status = {};
  for (const [name, tool] of Object.entries(BUILT_IN_TOOLS)) {
    if (!tool.requiresAuth) {
      status[name] = { available: true, needsAuth: false };
      continue;
    }

    // Check if credentials exist
    let hasCredentials = false;
    switch (name) {
      case 'slack_send':
      case 'slack_read':
        hasCredentials = !!readCredential('slack-token.txt');
        break;
      case 'github_api':
        hasCredentials = !!(readCredential('github-token.txt') || process.env.GITHUB_TOKEN);
        break;
      case 'send_email':
        hasCredentials = !!readCredential('email-config.json');
        break;
    }

    status[name] = {
      available: hasCredentials,
      needsAuth: !hasCredentials,
      authHint: hasCredentials ? undefined : tool.authHint
    };
  }
  return status;
}

export { BUILT_IN_TOOLS };

export default {
  BUILT_IN_TOOLS,
  getAvailableTools,
  executeTool,
  getToolStatus
};
