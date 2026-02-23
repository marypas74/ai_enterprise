#!/usr/bin/env node
/**
 * MCP Bridge for Memory System
 * Standalone stdio MCP server that exposes memory tools via JSON-RPC.
 * Run: node dist/modules/memory/mcpBridge.js
 *
 * Requires env vars: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME
 */

import mysql from 'mysql2/promise';
import { MemoryService } from './service.js';
import * as readline from 'readline';

// MCP Protocol version
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name: 'enterprise-memory',
  version: '1.0.0'
};

// Tool definitions
const TOOLS = [
  {
    name: 'memory_search',
    description: 'Search through stored memory observations using full-text search',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: { type: 'string', enum: ['insight', 'decision', 'pattern', 'error', 'preference', 'fact', 'manual'], description: 'Filter by observation type' },
        limit: { type: 'number', description: 'Max results (default 10)', default: 10 }
      },
      required: ['query']
    }
  },
  {
    name: 'memory_timeline',
    description: 'Get recent memory observations in chronological order',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of observations (default 20)', default: 20 },
        min_importance: { type: 'number', description: 'Minimum importance level (1-10)', default: 1 }
      }
    }
  },
  {
    name: 'memory_get',
    description: 'Get a single memory observation by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Observation ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'memory_save',
    description: 'Save a new memory observation',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Observation content' },
        type: { type: 'string', enum: ['insight', 'decision', 'pattern', 'error', 'preference', 'fact', 'manual'], default: 'manual' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        importance: { type: 'number', description: 'Importance level 1-10', default: 5 }
      },
      required: ['content']
    }
  },
  {
    name: 'memory_stats',
    description: 'Get memory usage statistics',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

let db: mysql.Pool;
let memoryService: MemoryService;

// Default user ID for MCP bridge (admin user = 1)
const MCP_USER_ID = parseInt(process.env.MCP_USER_ID || '1');

async function initDatabase(): Promise<void> {
  db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'enterprise_ai',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'enterprise_ai_chat',
    waitForConnections: true,
    connectionLimit: 3
  });
  memoryService = new MemoryService(db);
}

function sendResponse(id: number | string, result: any): void {
  const response = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(response + '\n');
}

function sendError(id: number | string | null, code: number, message: string): void {
  const response = JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message }
  });
  process.stdout.write(response + '\n');
}

async function handleToolCall(name: string, args: any): Promise<{ content: Array<{ type: string; text: string }> }> {
  const userId = MCP_USER_ID;

  switch (name) {
    case 'memory_search': {
      const results = await memoryService.searchMemories(userId, args.query, {
        observation_type: args.type,
        is_archived: false,
        limit: args.limit || 10
      });
      const text = results.length === 0
        ? 'No observations found.'
        : results.map(o => `[${o.id}] (${o.observation_type}, imp:${o.importance}) ${o.content}`).join('\n');
      return { content: [{ type: 'text', text }] };
    }

    case 'memory_timeline': {
      const observations = await memoryService.getRecentObservations(userId, args.limit || 20, args.min_importance || 1);
      const text = observations.length === 0
        ? 'No observations found.'
        : observations.map(o => `[${o.id}] ${o.created_at} (${o.observation_type}) ${o.content}`).join('\n');
      return { content: [{ type: 'text', text }] };
    }

    case 'memory_get': {
      const obs = await memoryService.getObservation(userId, args.id);
      if (!obs) return { content: [{ type: 'text', text: `Observation ${args.id} not found.` }] };
      const text = `ID: ${obs.id}\nType: ${obs.observation_type}\nImportance: ${obs.importance}\nCreated: ${obs.created_at}\nTags: ${obs.tags ? JSON.stringify(obs.tags) : 'none'}\nContent: ${obs.content}`;
      return { content: [{ type: 'text', text }] };
    }

    case 'memory_save': {
      const id = await memoryService.captureObservation(
        userId,
        args.content,
        args.type || 'manual',
        undefined,
        undefined,
        args.tags,
        args.importance || 5
      );
      return { content: [{ type: 'text', text: `Observation saved with ID: ${id}` }] };
    }

    case 'memory_stats': {
      const stats = await memoryService.getStats(userId);
      const text = `Total: ${stats.total}\nArchived: ${stats.archived}\nSummaries: ${stats.summaries}\nAvg Importance: ${stats.avg_importance}\nLast 7 days: ${stats.recent_7d}\nBy type: ${JSON.stringify(stats.by_type)}`;
      return { content: [{ type: 'text', text }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMessage(msg: any): Promise<void> {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      sendResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      });
      break;

    case 'notifications/initialized':
      // No response needed for notifications
      break;

    case 'tools/list':
      sendResponse(id, { tools: TOOLS });
      break;

    case 'tools/call': {
      try {
        const result = await handleToolCall(params.name, params.arguments || {});
        sendResponse(id, result);
      } catch (err: any) {
        sendResponse(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true
        });
      }
      break;
    }

    default:
      if (id) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
  }
}

async function main(): Promise<void> {
  await initDatabase();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', async (line: string) => {
    try {
      const msg = JSON.parse(line);
      await handleMessage(msg);
    } catch (err: any) {
      sendError(null, -32700, `Parse error: ${err.message}`);
    }
  });

  rl.on('close', async () => {
    if (db) await db.end();
    process.exit(0);
  });
}

main().catch(err => {
  process.stderr.write(`MCP Bridge startup error: ${err.message}\n`);
  process.exit(1);
});
