/**
 * SandboxService — Python Sandbox Executor
 *
 * Executes Python code in an isolated child process with:
 *   - Authenticated HTTP bridge to backend tools (ToolService)
 *   - Direct access to Qdrant for vector operations
 *   - Direct web access for HTTP/scraping
 *   - Timeout and resource limits
 */

import { execFile } from 'child_process';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { executeTool } from './ToolService.js';
import { generateEmbedding } from './EmbeddingService.js';
import type mysql from 'mysql2/promise';

// ============================================================
// Types
// ============================================================

export interface SandboxResult {
  success: boolean;
  output: string;
  error: string;
  executionTimeMs: number;
  toolCallsCount: number;
  webRequestsCount: number;
}

export interface ToolContext {
  userName: string;
  projectName: string;
  projectId: number;
  userId: number;
}

interface BridgeStats {
  toolCalls: number;
  webRequests: number;
}

// ============================================================
// Configuration
// ============================================================

const SANDBOX_DIR = path.resolve(process.env.SANDBOX_DIR || '/tmp');
const TOOL_BRIDGE_PATH = path.join(process.cwd(), 'sandbox', 'tool_bridge.py');
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_LENGTH = 100_000; // 100KB max stdout
const QDRANT_URL = process.env.QDRANT_URL || 'http://qdrant:6333';

// ============================================================
// Bridge HTTP Server (authenticated per-execution)
// ============================================================

function createBridgeServer(
  context: ToolContext,
  db: mysql.Pool | null,
  stats: BridgeStats,
  bridgeSecret: string
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Authenticate every request with per-execution secret
      if (req.headers['x-bridge-secret'] !== bridgeSecret) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }

      // Parse body
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1_000_000) {
          res.writeHead(413);
          res.end(JSON.stringify({ error: 'Request too large' }));
          return;
        }
      }

      const url = req.url || '';

      try {
        // POST /tool/:name — execute a backend tool
        const toolMatch = url.match(/^\/tool\/(.+)$/);
        if (toolMatch && req.method === 'POST') {
          stats.toolCalls++;
          const toolName = decodeURIComponent(toolMatch[1]);
          const args = body ? JSON.parse(body) : {};
          const result = await executeTool(toolName, args, context);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        }

        // POST /embed — generate embedding vector
        if (url === '/embed' && req.method === 'POST') {
          stats.toolCalls++;
          const { text } = JSON.parse(body);
          if (!text) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing text field' }));
            return;
          }
          if (!db) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Database not available for embedding' }));
            return;
          }
          const embedding = await generateEmbedding(db, text);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ vector: embedding?.embedding || [] }));
          return;
        }

        // Unknown route
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      } catch (err: any) {
        // Sanitize error — don't leak internal details to sandbox
        console.error('[SandboxBridge] Error handling request:', err);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Tool execution failed' }));
      }
    });

    // Listen on random port on localhost only
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error('Failed to bind bridge server'));
      }
    });

    server.on('error', reject);
  });
}

// ============================================================
// Main Execution
// ============================================================

export async function execute(
  code: string,
  context: ToolContext,
  db: mysql.Pool | null = null,
  timeoutMs?: number
): Promise<SandboxResult> {
  const startTime = Date.now();
  const effectiveTimeout = Math.min(timeoutMs || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const sandboxId = crypto.randomBytes(8).toString('hex');
  const bridgeSecret = crypto.randomBytes(16).toString('hex');
  const sandboxDir = path.join(SANDBOX_DIR, `sandbox_${sandboxId}`);

  const stats: BridgeStats = { toolCalls: 0, webRequests: 0 };
  let bridgeServer: Server | null = null;
  let bridgePort = 0;

  try {
    // 1. Create temp directory
    await fs.mkdir(sandboxDir, { recursive: true });

    // 2. Copy tool_bridge.py
    try {
      await fs.copyFile(TOOL_BRIDGE_PATH, path.join(sandboxDir, 'tool_bridge.py'));
    } catch {
      // If sandbox dir doesn't exist in expected location, try alternative
      const altPath = path.join(process.cwd(), 'dist', 'sandbox', 'tool_bridge.py');
      try {
        await fs.copyFile(altPath, path.join(sandboxDir, 'tool_bridge.py'));
      } catch {
        // Last resort: copy from src
        const srcPath = path.join(process.cwd(), 'src', 'sandbox', 'tool_bridge.py');
        await fs.copyFile(srcPath, path.join(sandboxDir, 'tool_bridge.py'));
      }
    }

    // 3. Start bridge HTTP server (authenticated)
    const bridge = await createBridgeServer(context, db, stats, bridgeSecret);
    bridgeServer = bridge.server;
    bridgePort = bridge.port;

    // 4. Write main.py (wraps user code)
    const mainPy = generateMainScript(code);
    await fs.writeFile(path.join(sandboxDir, 'main.py'), mainPy, 'utf8');

    // 5. Execute Python with bridge secret in env
    const result = await runPython(sandboxDir, bridgePort, bridgeSecret, effectiveTimeout);

    return {
      success: result.exitCode === 0,
      output: result.stdout.slice(0, MAX_OUTPUT_LENGTH),
      error: result.stderr.slice(0, 10_000),
      executionTimeMs: Date.now() - startTime,
      toolCallsCount: stats.toolCalls,
      webRequestsCount: stats.webRequests,
    };
  } catch (err: any) {
    return {
      success: false,
      output: '',
      error: err.message || 'Sandbox execution failed',
      executionTimeMs: Date.now() - startTime,
      toolCallsCount: stats.toolCalls,
      webRequestsCount: stats.webRequests,
    };
  } finally {
    // Cleanup: force-close all connections then close server
    if (bridgeServer) {
      if (typeof bridgeServer.closeAllConnections === 'function') {
        bridgeServer.closeAllConnections();
      }
      bridgeServer.close();
    }
    fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ============================================================
// Python Script Generator
// ============================================================

function generateMainScript(userCode: string): string {
  // Indent user code by 4 spaces for the try block
  const indentedCode = userCode
    .split('\n')
    .map(line => '    ' + line)
    .join('\n');

  return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Auto-generated sandbox script."""

import json
import sys

# Ensure sandbox dir is in path for tool_bridge import
sys.path.insert(0, '.')

from tool_bridge import ToolBridge

tool = ToolBridge()

try:
${indentedCode}
except SystemExit:
    pass
except Exception as e:
    print(json.dumps({"error": str(e), "type": type(e).__name__}), file=sys.stderr)
    sys.exit(1)
`;
}

// ============================================================
// Python Process Runner
// ============================================================

function runPython(
  sandboxDir: string,
  bridgePort: number,
  bridgeSecret: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
      BRIDGE_SECRET: bridgeSecret,
      QDRANT_URL: QDRANT_URL,
      PYTHONUNBUFFERED: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      HOME: sandboxDir,
    };

    const child = execFile(
      'python3',
      ['main.py'],
      {
        cwd: sandboxDir,
        env,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_LENGTH * 2,
        killSignal: 'SIGKILL',
      },
      (error, stdout, stderr) => {
        if (error && error.signal === 'SIGKILL') {
          resolve({
            stdout: '',
            stderr: `Execution timed out after ${timeoutMs / 1000}s`,
            exitCode: 137,
          });
          return;
        }

        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: error ? (error as any).code || 1 : 0,
        });
      }
    );

    // Additional safety: force kill after timeout + 2s grace
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, timeoutMs + 2000);

    // 'close' fires even on spawn error (unlike 'exit')
    child.on('close', () => clearTimeout(killTimer));
  });
}
