import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        global: { statements: 80, branches: 70, functions: 80, lines: 80 }
      },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'dist/**']
    },
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    setupFiles: ['./test/setup.ts']
  }
});
