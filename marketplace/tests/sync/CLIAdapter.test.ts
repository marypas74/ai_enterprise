import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { CLIAdapter } from '../../src/sync/CLIAdapter.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

describe('CLIAdapter', () => {
  let adapter: CLIAdapter;

  beforeEach(() => {
    adapter = new CLIAdapter();
    vi.clearAllMocks();
  });

  describe('fetchComponents', () => {
    it('should return parsed array when CLI outputs valid JSON', () => {
      const expected = [
        { name: 'code-review', category: 'development-tools' },
        { name: 'security-scan', category: 'security' },
      ];
      mockedExecFileSync.mockReturnValue(JSON.stringify(expected));

      const result = adapter.fetchComponents('skill');

      expect(result).toEqual(expected);
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        'claude-code-templates',
        ['list', '--type', 'skill', '--format', 'json'],
        { encoding: 'utf-8', timeout: 30000 },
      );
    });

    it('should throw descriptive error when CLI fails with non-zero exit', () => {
      mockedExecFileSync.mockImplementation(() => {
        throw new Error('Command failed with exit code 1');
      });

      expect(() => adapter.fetchComponents('agent')).toThrow(
        /Failed to fetch components of type "agent"/,
      );
    });

    it('should throw descriptive error when CLI outputs invalid JSON', () => {
      mockedExecFileSync.mockReturnValue('not valid json {{{');

      expect(() => adapter.fetchComponents('mcp')).toThrow(
        /Failed to parse CLI output for type "mcp"/,
      );
    });

    it('should pass the type argument to the CLI command', () => {
      mockedExecFileSync.mockReturnValue('[]');

      adapter.fetchComponents('hook');

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        'claude-code-templates',
        ['list', '--type', 'hook', '--format', 'json'],
        { encoding: 'utf-8', timeout: 30000 },
      );
    });
  });
});
