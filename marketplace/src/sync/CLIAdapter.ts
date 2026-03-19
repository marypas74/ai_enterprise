import { execFileSync } from 'node:child_process';

export interface SourceAdapter {
  fetchComponents(type: string): unknown[];
}

export class CLIAdapter implements SourceAdapter {
  fetchComponents(type: string): unknown[] {
    let output: string;
    try {
      output = execFileSync(
        'claude-code-templates',
        ['list', '--type', type, '--format', 'json'],
        { encoding: 'utf-8', timeout: 30000 },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch components of type "${type}": ${message}`);
    }

    try {
      const parsed: unknown = JSON.parse(output);
      return parsed as unknown[];
    } catch {
      throw new Error(
        `Failed to parse CLI output for type "${type}": output is not valid JSON`,
      );
    }
  }
}
