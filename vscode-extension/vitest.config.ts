import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'test/__mocks__/vscode.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      include: ['src/core/**/*.ts', 'src/modules/**/*.ts'],
      exclude: ['**/*.d.ts', 'src/core/types.ts'],
      thresholds: {
        'src/core/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/modules/**': {
          statements: 60,
          branches: 60,
          functions: 60,
          lines: 60,
        },
      },
    },
  },
});
