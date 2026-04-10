import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: 'backend-restart-verification.spec.ts',
    fullyParallel: false,
    forbidOnly: false,
    retries: 0,
    workers: 1,
    reporter: [
        ['html', { outputFolder: '/tmp/e2e-verification/playwright-report', open: 'never' }],
        ['list'],
    ],
    use: {
        baseURL: 'https://plane.lushlolli.com',
        trace: 'on-first-retry',
        screenshot: 'on',
        video: 'retain-on-failure',
        ignoreHTTPSErrors: true,
        actionTimeout: 30000,
        navigationTimeout: 60000,
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1280, height: 900 },
            },
        },
    ],
    timeout: 300000,
    outputDir: '/tmp/e2e-verification/test-results',
});
