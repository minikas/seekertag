import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  reporter: [['list'], ['html', { outputFolder: '../../artifacts/qa-report', open: 'never' }]],
  outputDir: '../../artifacts/qa-results',
  use: {
    actionTimeout: 20_000,
    baseURL: process.env.WEB_URL || 'http://localhost:8081',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 960 },
    // Traces include request bodies and bearer credentials. Keep them off.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
});
