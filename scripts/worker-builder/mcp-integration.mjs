/**
 * MCP Integration
 * 
 * Connects to Model Context Protocol (MCP) servers for capabilities.
 * Supports both stdio-based and HTTP-based MCP servers.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';

const CONFIG_DIR = path.join(os.homedir(), '.nooterra', 'mcp');
const CONNECTIONS_FILE = path.join(CONFIG_DIR, 'connections.json');

/**
 * MCP connection types
 */
export const CONNECTION_TYPES = {
  STDIO: 'stdio',     // Spawn process and communicate via stdin/stdout
  HTTP: 'http',       // Connect to HTTP endpoint
  SSE: 'sse'          // Server-sent events
};

/**
 * Well-known MCP server packages
 */
export const KNOWN_SERVERS = {
  // File system operations
  filesystem: {
    name: 'Filesystem',
    package: '@modelcontextprotocol/server-filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    capabilities: ['read_file', 'write_file', 'list_directory']
  },
  
  // Browser automation
  browser: {
    name: 'Browser (Playwright)',
    package: '@anthropics/mcp-server-playwright',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-playwright'],
    capabilities: ['navigate', 'click', 'type', 'screenshot', 'scrape']
  },
  
  // GitHub
  github: {
    name: 'GitHub',
    package: '@modelcontextprotocol/server-github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: ['GITHUB_TOKEN'],
    capabilities: ['create_issue', 'create_pr', 'list_repos', 'search_code']
  },
  
  // Slack
  slack: {
    name: 'Slack',
    package: '@modelcontextprotocol/server-slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: ['SLACK_BOT_TOKEN'],
    capabilities: ['send_message', 'list_channels', 'search_messages']
  },
  
  // Postgres database
  postgres: {
    name: 'PostgreSQL',
    package: '@modelcontextprotocol/server-postgres',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: ['DATABASE_URL'],
    capabilities: ['query', 'schema']
  },
  
  // Google Drive
  'google-drive': {
    name: 'Google Drive',
    package: '@modelcontextprotocol/server-gdrive',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gdrive'],
    capabilities: ['list_files', 'read_file', 'write_file', 'search']
  },
  
  // Brave search
  'brave-search': {
    name: 'Brave Search',
    package: '@modelcontextprotocol/server-brave-search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: ['BRAVE_API_KEY'],
    capabilities: ['web_search', 'local_search']
  },
  
  // Fetch (HTTP requests)
  fetch: {
    name: 'Fetch (HTTP)',
    package: '@modelcontextprotocol/server-fetch',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    capabilities: ['fetch_url', 'fetch_api']
  },
  
  // Memory (persistent context)
  memory: {
    name: 'Memory',
    package: '@modelcontextprotocol/server-memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    capabilities: ['store', 'retrieve', 'search']
  },
  
  // Sequential thinking
  thinking: {
    name: 'Sequential Thinking',
    package: '@modelcontextprotocol/server-sequential-thinking',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    capabilities: ['reason', 'plan', 'reflect']
  }
};

/**
 * Active MCP connections
 */
class MCPConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map();
    this.config = loadConfig();
  }

  /**
   * Connect to an MCP server
   */
  async connect(serverId, options = {}) {
    // Check if already connected
    if (this.connections.has(serverId)) {
      return { success: true, message: 'Already connected' };
    }

    // Get server config
    const serverConfig = KNOWN_SERVERS[serverId] || options.config;
    if (!serverConfig) {
      return { success: false, error: `Unknown server: ${serverId}` };
    }

    // Check required environment variables
    if (serverConfig.env) {
      const missing = serverConfig.env.filter(e => !process.env[e] && !options.env?.[e]);
      if (missing.length > 0) {
        return { 
          success: false, 
          error: `Missing environment variables: ${missing.join(', ')}`,
          missing
        };
      }
    }

    try {
      // Build environment
      const env = { ...process.env, ...options.env };

      // Spawn the server process
      const proc = spawn(serverConfig.command, serverConfig.args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Track connection
      const connection = {
        id: serverId,
        name: serverConfig.name,
        process: proc,
        type: CONNECTION_TYPES.STDIO,
        capabilities: serverConfig.capabilities,
        connected: true,
        startedAt: new Date().toISOString()
      };

      // Handle process events
      proc.on('error', (err) => {
        this.emit('error', { serverId, error: err.message });
        this.connections.delete(serverId);
      });

      proc.on('exit', (code) => {
        this.emit('disconnected', { serverId, code });
        this.connections.delete(serverId);
      });

      // Set up message handling
      this.setupMessageHandler(serverId, proc);

      this.connections.set(serverId, connection);
      this.emit('connected', { serverId, name: serverConfig.name });

      // Initialize with handshake
      await this.sendMessage(serverId, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'nooterra',
            version: '0.4.0'
          }
        }
      });

      // Send initialized notification (required by MCP spec before tool calls)
      await this.sendMessage(serverId, {
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      });

      // Save connection config
      this.saveConnection(serverId, serverConfig, options.env);

      return { success: true, connection };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Set up message handler for stdio connection.
   * MCP uses Content-Length framed JSON-RPC messages.
   * Falls back to newline-delimited JSON if no Content-Length header detected.
   */
  setupMessageHandler(serverId, proc) {
    let buffer = Buffer.alloc(0);
    let contentLength = -1;
    let useContentLength = null; // null = auto-detect, true/false after first message

    proc.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

      while (buffer.length > 0) {
        // Auto-detect: if first bytes look like "Content-Length:", use framed mode
        if (useContentLength === null) {
          const start = buffer.toString('utf8', 0, Math.min(buffer.length, 20));
          if (start.startsWith('Content-Length:')) {
            useContentLength = true;
          } else if (start.startsWith('{')) {
            useContentLength = false;
          }
          // If we can't tell yet, wait for more data
          if (useContentLength === null && buffer.length < 20) break;
          if (useContentLength === null) useContentLength = false;
        }

        if (useContentLength) {
          // Content-Length framed protocol
          if (contentLength === -1) {
            const headerEnd = buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) break; // Haven't received full header yet

            const header = buffer.toString('utf8', 0, headerEnd);
            const match = header.match(/Content-Length:\s*(\d+)/i);
            if (!match) {
              // Skip malformed header
              buffer = buffer.subarray(headerEnd + 4);
              continue;
            }
            contentLength = parseInt(match[1], 10);
            buffer = buffer.subarray(headerEnd + 4);
          }

          if (buffer.length < contentLength) break; // Haven't received full body yet

          const body = buffer.toString('utf8', 0, contentLength);
          buffer = buffer.subarray(contentLength);
          contentLength = -1;

          try {
            const message = JSON.parse(body);
            this.emit('message', { serverId, message });
          } catch {
            // Malformed JSON, skip
          }
        } else {
          // Newline-delimited JSON fallback
          const str = buffer.toString('utf8');
          const newlineIdx = str.indexOf('\n');
          if (newlineIdx === -1) break;

          const line = str.slice(0, newlineIdx).trim();
          buffer = Buffer.from(str.slice(newlineIdx + 1));

          if (line) {
            try {
              const message = JSON.parse(line);
              this.emit('message', { serverId, message });
            } catch {
              // Not valid JSON, skip
            }
          }
        }
      }
    });

    proc.stderr.on('data', (data) => {
      this.emit('stderr', { serverId, data: data.toString() });
    });
  }

  /**
   * Send message to MCP server using Content-Length framing.
   */
  async sendMessage(serverId, message) {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`Not connected to ${serverId}`);
    }

    return new Promise((resolve, reject) => {
      const json = JSON.stringify(message);
      const contentLength = Buffer.byteLength(json, 'utf8');
      const framed = `Content-Length: ${contentLength}\r\n\r\n${json}`;

      // Set up response handler (only for requests with an id)
      if (message.id !== undefined) {
        const handler = ({ serverId: sid, message: response }) => {
          if (sid === serverId && response.id === message.id) {
            this.off('message', handler);
            clearTimeout(timer);
            if (response.error) {
              reject(new Error(response.error.message || JSON.stringify(response.error)));
            } else {
              resolve(response.result);
            }
          }
        };

        this.on('message', handler);

        // Timeout after 30 seconds
        const timer = setTimeout(() => {
          this.off('message', handler);
          reject(new Error(`MCP request timed out (${message.method})`));
        }, 30000);
      }

      // Send message
      connection.process.stdin.write(framed, (err) => {
        if (err) {
          reject(err);
        } else if (message.id === undefined) {
          // Notifications (no id) resolve immediately
          resolve(undefined);
        }
      });
    });
  }

  /**
   * Call a tool on an MCP server
   */
  async callTool(serverId, toolName, args = {}) {
    return this.sendMessage(serverId, {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    });
  }

  /**
   * List available tools on an MCP server
   */
  async listTools(serverId) {
    return this.sendMessage(serverId, {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/list',
      params: {}
    });
  }

  /**
   * Disconnect from an MCP server
   */
  disconnect(serverId) {
    const connection = this.connections.get(serverId);
    if (connection && connection.process) {
      connection.process.kill();
    }
    this.connections.delete(serverId);
    this.emit('disconnected', { serverId });
  }

  /**
   * Disconnect all servers
   */
  disconnectAll() {
    for (const serverId of this.connections.keys()) {
      this.disconnect(serverId);
    }
  }

  /**
   * Get connection status
   */
  getStatus(serverId) {
    const connection = this.connections.get(serverId);
    if (!connection) {
      return { connected: false };
    }
    return {
      connected: true,
      name: connection.name,
      capabilities: connection.capabilities,
      startedAt: connection.startedAt
    };
  }

  /**
   * Get all connections
   */
  getAllConnections() {
    const result = {};
    for (const [id, conn] of this.connections) {
      result[id] = {
        name: conn.name,
        connected: conn.connected,
        capabilities: conn.capabilities,
        startedAt: conn.startedAt
      };
    }
    return result;
  }

  /**
   * Save connection config
   */
  saveConnection(serverId, config, env) {
    this.config.connections = this.config.connections || {};
    this.config.connections[serverId] = {
      ...config,
      env: Object.keys(env || {})  // Only save env var names, not values
    };
    saveConfig(this.config);
  }

  /**
   * Reconnect saved connections
   */
  async reconnectAll() {
    const connections = this.config.connections || {};
    for (const [serverId, config] of Object.entries(connections)) {
      try {
        await this.connect(serverId, { config });
      } catch (err) {
        this.emit('error', { serverId, error: err.message });
      }
    }
  }
}

/**
 * Load configuration
 */
function loadConfig() {
  ensureDir();
  if (fs.existsSync(CONNECTIONS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

/**
 * Save configuration
 */
function saveConfig(config) {
  ensureDir();
  fs.writeFileSync(CONNECTIONS_FILE, JSON.stringify(config, null, 2));
}

/**
 * Ensure config directory exists
 */
function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * List available MCP servers
 */
export function listAvailableServers() {
  return Object.entries(KNOWN_SERVERS).map(([id, config]) => ({
    id,
    name: config.name,
    package: config.package,
    capabilities: config.capabilities,
    requiresEnv: config.env || []
  }));
}

/**
 * Check if a server package is installed
 */
export async function checkServerInstalled(serverId) {
  const config = KNOWN_SERVERS[serverId];
  if (!config) return false;

  return new Promise((resolve) => {
    const proc = spawn('npm', ['list', config.package, '-g'], { shell: true });
    proc.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

/**
 * Install a server package
 */
export function installServer(serverId) {
  const config = KNOWN_SERVERS[serverId];
  if (!config) {
    return Promise.reject(new Error(`Unknown server: ${serverId}`));
  }

  return new Promise((resolve, reject) => {
    console.log(`Installing ${config.package}...`);
    const proc = spawn('npm', ['install', '-g', config.package], { shell: true, stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        reject(new Error(`Installation failed with code ${code}`));
      }
    });
  });
}

// Singleton instance
let manager = null;

/**
 * Get the connection manager instance
 */
export function getConnectionManager() {
  if (!manager) {
    manager = new MCPConnectionManager();
  }
  return manager;
}

/**
 * Quick connect helper
 */
export async function quickConnect(serverId, env = {}) {
  const mgr = getConnectionManager();
  return mgr.connect(serverId, { env });
}

/**
 * Quick disconnect helper
 */
export function quickDisconnect(serverId) {
  const mgr = getConnectionManager();
  mgr.disconnect(serverId);
}

/**
 * Call tool helper
 */
export async function callTool(serverId, toolName, args = {}) {
  const mgr = getConnectionManager();
  return mgr.callTool(serverId, toolName, args);
}

export default {
  CONNECTION_TYPES,
  KNOWN_SERVERS,
  listAvailableServers,
  checkServerInstalled,
  installServer,
  getConnectionManager,
  quickConnect,
  quickDisconnect,
  callTool
};
