/**
 * Sample TypeScript file used as a fixture for E2E code action tests.
 * This file is opened in the VS Code test instance to verify
 * code action commands work with selected text.
 */

export function calculateSum(a: number, b: number): number {
  return a + b;
}

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export class UserService {
  private readonly users: Map<string, { name: string; email: string }> = new Map();

  addUser(id: string, name: string, email: string): void {
    this.users.set(id, { name, email });
  }

  getUser(id: string): { name: string; email: string } | undefined {
    return this.users.get(id);
  }

  removeUser(id: string): boolean {
    return this.users.delete(id);
  }
}
