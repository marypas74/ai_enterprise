/**
 * MCPClientManager — Model Context Protocol client manager
 * Spawns and manages MCP server connections (stdio, SSE, WebSocket transports).
 * Discovers tools from registered servers and executes them.
 */
import { spawn, type ChildProcess } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { findMany } from '../database/index.js';
import type mysql from 'mysql2/promise';

// Read version from package.json at module load
let APP_VERSION = '1.9.1';
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));
  APP_VERSION = pkg.version || APP_VERSION;
} catch {
  // Fallback to hardcoded version
}

interface MCPServerConfig {
  id: number;
  name: string;
  transport: 'stdio' | 'sse' | 'websocket';
  command: string;  // For stdio: executable; For SSE/WS: URL
  args: string[];
  env: Record<string, string>;
  isEnabled: boolean;
}

interface MCPTool {
  serverId: number;
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

interface MCPConnection {
  config: MCPServerConfig;
  process: ChildProcess | null;
  tools: MCPTool[];
  connected: boolean;
  lastError: string | null;
}

export class MCPClientManager {
  private connections = new Map<number, MCPConnection>();
  private static instance: MCPClientManager | null = null;

  static getInstance(): MCPClientManager {
    if (!MCPClientManager.instance) {
      MCPClientManager.instance = new MCPClientManager();
    }
    return MCPClientManager.instance;
  }

  /**
   * Load MCP server configs from database and connect enabled ones
   */
  async initialize(db: mysql.Pool): Promise<void> {
    try {
      const servers = await findMany<any>(db,
        `SELECT id, name, transport_type as transport, command, env_vars, is_enabled
         FROM mcp_servers WHERE is_enabled = TRUE`
      );

      for (const server of servers) {
        // Parse command string — first token is executable, rest are args
        const cmdParts = (server.command || '').trim().split(/\s+/);
        const config: MCPServerConfig = {
          id: server.id,
          name: server.name,
          transport: server.transport || 'stdio',
          command: cmdParts[0] || '',
          args: cmdParts.slice(1),
          env: this.parseJsonSafe(server.env_vars, {}),
          isEnabled: server.is_enabled,
        };

        if (config.command && config.transport === 'stdio') {
          await this.connectServer(config);
        } else if (config.command && (config.transport === 'sse' || config.transport === 'websocket')) {
          await this.connectSSE(config);
        }
      }

      console.log(`[MCPClient] Initialized ${this.connections.size} MCP servers`);
    } catch (error: any) {
      console.error(`[MCPClient] Initialization failed: ${error.message}`);
    }
  }

  /**
   * Connect to a stdio MCP server
   */
  async connectServer(config: MCPServerConfig): Promise<boolean> {
    if (this.connections.has(config.id)) {
      await this.disconnectServer(config.id);
    }

    const connection: MCPConnection = {
      config,
      process: null,
      tools: [],
      connected: false,
      lastError: null,
    };

    try {
      const child = spawn(config.command, config.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...config.env },
      });

      connection.process = child;

      // Send initialize request
      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'enterprise-ai-chat', version: APP_VERSION },
        },
      };

      const initResponse = await this.sendRequest(child, initRequest, 10000);
      if (!initResponse) {
        throw new Error('No response to initialize');
      }

      // Send initialized notification
      this.sendNotification(child, { jsonrpc: '2.0', method: 'notifications/initialized' });

      // Discover tools
      const toolsResponse = await this.sendRequest(child, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }, 5000);

      if (toolsResponse?.result?.tools) {
        connection.tools = toolsResponse.result.tools.map((t: any) => ({
          serverId: config.id,
          serverName: config.name,
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema || {},
        }));
      }

      connection.connected = true;
      this.connections.set(config.id, connection);

      child.on('exit', (code) => {
        console.log(`[MCPClient] Server "${config.name}" exited with code ${code}`);
        connection.connected = false;
      });

      child.stderr?.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) console.warn(`[MCPClient:${config.name}] ${msg}`);
      });

      console.log(`[MCPClient] Connected to "${config.name}" (${connection.tools.length} tools)`);
      return true;
    } catch (error: any) {
      connection.lastError = error.message;
      this.connections.set(config.id, connection);
      console.error(`[MCPClient] Failed to connect to "${config.name}": ${error.message}`);
      return false;
    }
  }

  /**
   * Connect to an SSE/WebSocket MCP server (HTTP-based JSON-RPC)
   * The 'command' field holds the server URL (e.g. http://localhost:8080/mcp)
   */
  async connectSSE(config: MCPServerConfig): Promise<boolean> {
    if (this.connections.has(config.id)) {
      await this.disconnectServer(config.id);
    }

    const connection: MCPConnection = {
      config,
      process: null,
      tools: [],
      connected: false,
      lastError: null,
    };

    const baseUrl = config.command; // For SSE/WS, command holds the URL

    try {
      // Send initialize via HTTP POST
      const initResponse = await this.httpJsonRpc(baseUrl, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'enterprise-ai-chat', version: APP_VERSION },
        },
      }, 10000);

      if (!initResponse) {
        throw new Error('No response to initialize');
      }

      // Send initialized notification
      await this.httpJsonRpc(baseUrl, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }, 5000).catch(() => {}); // Notifications may not return a response

      // Discover tools
      const toolsResponse = await this.httpJsonRpc(baseUrl, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }, 5000);

      if (toolsResponse?.result?.tools) {
        connection.tools = toolsResponse.result.tools.map((t: any) => ({
          serverId: config.id,
          serverName: config.name,
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema || {},
        }));
      }

      connection.connected = true;
      this.connections.set(config.id, connection);
      console.log(`[MCPClient] Connected to "${config.name}" via ${config.transport} (${connection.tools.length} tools)`);
      return true;
    } catch (error: any) {
      connection.lastError = error.message;
      this.connections.set(config.id, connection);
      console.error(`[MCPClient] Failed to connect to "${config.name}" via ${config.transport}: ${error.message}`);
      return false;
    }
  }

  /**
   * Disconnect a server
   */
  async disconnectServer(serverId: number): Promise<void> {
    const conn = this.connections.get(serverId);
    if (conn?.process) {
      conn.process.kill('SIGTERM');
      conn.connected = false;
    }
    this.connections.delete(serverId);
  }

  /**
   * Disconnect all servers
   */
  async disconnectAll(): Promise<void> {
    for (const [id] of this.connections) {
      await this.disconnectServer(id);
    }
  }

  /**
   * Get all available tools from all connected servers
   */
  getAllTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const conn of this.connections.values()) {
      if (conn.connected) {
        tools.push(...conn.tools);
      }
    }
    return tools;
  }

  /**
   * Get tools available to a specific user
   */
  async getUserTools(db: mysql.Pool, userId: number): Promise<MCPTool[]> {
    try {
      const permissions = await findMany<any>(db,
        `SELECT mcp_server_id FROM user_mcp_permissions WHERE user_id = ? AND is_enabled = TRUE`,
        [userId],
      );
      const allowedServerIds = new Set(permissions.map((p: any) => p.mcp_server_id));

      return this.getAllTools().filter(t => allowedServerIds.has(t.serverId));
    } catch {
      return this.getAllTools(); // Fallback: return all if permissions query fails
    }
  }

  /**
   * Call a tool on an MCP server
   */
  async callTool(
    serverId: number,
    toolName: string,
    args: Record<string, any>,
  ): Promise<{ success: boolean; result: any; error?: string }> {
    const conn = this.connections.get(serverId);
    if (!conn?.connected) {
      return { success: false, result: null, error: `Server ${serverId} not connected` };
    }

    try {
      let response: any;
      const request = {
        jsonrpc: '2.0' as const,
        id: Date.now(),
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      };

      if (conn.config.transport === 'sse' || conn.config.transport === 'websocket') {
        // HTTP-based transport
        response = await this.httpJsonRpc(conn.config.command, request, 30000);
      } else if (conn.process) {
        // stdio transport
        response = await this.sendRequest(conn.process, request, 30000);
      } else {
        return { success: false, result: null, error: `Server ${serverId} has no active connection` };
      }

      if (response?.error) {
        return { success: false, result: null, error: response.error.message };
      }

      // Extract text content from MCP response
      const content = response?.result?.content;
      if (Array.isArray(content)) {
        const textParts = content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text);
        return { success: true, result: textParts.join('\n') };
      }

      return { success: true, result: response?.result || null };
    } catch (error: any) {
      return { success: false, result: null, error: error.message };
    }
  }

  /**
   * Get connection status for all servers
   */
  getStatus(): { id: number; name: string; connected: boolean; tools: number; error: string | null }[] {
    return Array.from(this.connections.values()).map(conn => ({
      id: conn.config.id,
      name: conn.config.name,
      connected: conn.connected,
      tools: conn.tools.length,
      error: conn.lastError,
    }));
  }

  // ---- Internal helpers ----

  private sendNotification(child: ChildProcess, message: any): void {
    if (child.stdin?.writable) {
      child.stdin.write(JSON.stringify(message) + '\n');
    }
  }

  private sendRequest(child: ChildProcess, request: any, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`MCP request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      let buffer = '';

      const onData = (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.id === request.id) {
              cleanup();
              resolve(parsed);
              return;
            }
          } catch {
            // Not valid JSON yet, keep buffering
          }
        }
        // Keep the last incomplete line in buffer
        buffer = lines[lines.length - 1] || '';
      };

      const cleanup = () => {
        clearTimeout(timeout);
        child.stdout?.removeListener('data', onData);
      };

      child.stdout?.on('data', onData);

      if (child.stdin?.writable) {
        child.stdin.write(JSON.stringify(request) + '\n');
      } else {
        cleanup();
        reject(new Error('stdin not writable'));
      }
    });
  }

  private async httpJsonRpc(baseUrl: string, request: any, timeoutMs: number): Promise<any> {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Notifications (no id) may return empty body
    if (!request.id) return null;

    const text = await response.text();
    if (!text.trim()) return null;
    return JSON.parse(text);
  }

  private parseJsonSafe<T>(value: any, fallback: T): T {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
}
