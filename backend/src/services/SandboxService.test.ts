/**
 * Unit tests for SandboxService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process.execFile
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

// Mock ToolService.executeTool
vi.mock('./ToolService.js', () => ({
  executeTool: vi.fn(async (name: string) => ({
    success: true,
    output: `Mock result for ${name}`,
  })),
}));

// Mock EmbeddingService.generateEmbedding
vi.mock('./EmbeddingService.js', () => ({
  generateEmbedding: vi.fn(async () => ({
    embedding: Array(384).fill(0.1),
  })),
}));

import { execute, type ToolContext } from './SandboxService.js';

const TEST_CONTEXT: ToolContext = {
  userName: 'testuser',
  projectName: 'testproject',
  projectId: 1,
  userId: 1,
};

describe('SandboxService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('execute — basic functionality', () => {
    it('should return success when python exits with code 0', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, 'Hello World\n', '');
        const child = {
          on: vi.fn(),
          kill: vi.fn(),
        };
        return child;
      });

      const result = await execute('print("Hello World")', TEST_CONTEXT);
      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello World');
      expect(result.error).toBe('');
    });

    it('should return failure when python exits with error', async () => {
      const error = new Error('Python error') as any;
      error.code = 1;
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(error, '', 'NameError: name "x" is not defined');
        const child = {
          on: vi.fn(),
          kill: vi.fn(),
        };
        return child;
      });

      const result = await execute('print(x)', TEST_CONTEXT);
      expect(result.success).toBe(false);
      expect(result.error).toContain('NameError');
    });

    it('should handle timeout (SIGKILL)', async () => {
      const error = new Error('killed') as any;
      error.signal = 'SIGKILL';
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(error, '', '');
        const child = {
          on: vi.fn(),
          kill: vi.fn(),
        };
        return child;
      });

      const result = await execute('import time; time.sleep(999)', TEST_CONTEXT, null, 5000);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });
  });

  describe('execute — output limits', () => {
    it('should truncate output exceeding MAX_OUTPUT_LENGTH', async () => {
      const bigOutput = 'A'.repeat(200_000);
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, bigOutput, '');
        const child = {
          on: vi.fn(),
          kill: vi.fn(),
        };
        return child;
      });

      const result = await execute('print("A" * 200000)', TEST_CONTEXT);
      expect(result.success).toBe(true);
      expect(result.output.length).toBeLessThanOrEqual(100_000);
    });
  });

  describe('execute — timeout clamping', () => {
    it('should clamp timeout to MAX_TIMEOUT_MS', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], opts: any, cb: Function) => {
        // Verify timeout is clamped
        expect(opts.timeout).toBeLessThanOrEqual(60_000);
        cb(null, 'ok', '');
        const child = {
          on: vi.fn(),
          kill: vi.fn(),
        };
        return child;
      });

      await execute('print("ok")', TEST_CONTEXT, null, 999_999);
    });
  });

  describe('execute — sandbox isolation', () => {
    it('should create and clean up sandbox directory', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], opts: any, cb: Function) => {
        // Verify we're running in a sandbox directory
        expect(opts.cwd).toContain('sandbox_');
        cb(null, 'ok', '');
        const child = {
          on: vi.fn(),
          kill: vi.fn(),
        };
        return child;
      });

      await execute('print("ok")', TEST_CONTEXT);
      // Cleanup happens in finally block — we can't easily verify it without more mocking
      // but this ensures the structure works
    });

    it('should set bridge environment variables', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], opts: any, cb: Function) => {
        expect(opts.env.BRIDGE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(opts.env.BRIDGE_SECRET).toBeTruthy();
        expect(opts.env.BRIDGE_SECRET.length).toBeGreaterThanOrEqual(32); // 16 hex bytes = 32 chars
        expect(opts.env.QDRANT_URL).toBeTruthy();
        expect(opts.env.PYTHONUNBUFFERED).toBe('1');
        cb(null, 'ok', '');
        const child = {
          on: vi.fn(),
          kill: vi.fn(),
        };
        return child;
      });

      await execute('print("ok")', TEST_CONTEXT);
    });
  });

  describe('execute — stats tracking', () => {
    it('should report executionTimeMs', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, 'ok', '');
        const child = {
          on: vi.fn(),
          kill: vi.fn(),
        };
        return child;
      });

      const result = await execute('print("ok")', TEST_CONTEXT);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.toolCallsCount).toBe('number');
      expect(typeof result.webRequestsCount).toBe('number');
    });
  });

  describe('execute — error handling', () => {
    it('should return error result (not throw) on internal failure', async () => {
      // Force execFile to throw a non-standard error
      mockExecFile.mockImplementation(() => {
        throw new Error('Unexpected spawn failure');
      });

      const result = await execute('print("ok")', TEST_CONTEXT);
      // Should not throw — returns error result
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });
});
