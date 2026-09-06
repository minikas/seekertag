import { defineConfig, devices } from '@playwright/test';

const externalServer = Boolean(process.env.WEB_URL);
const origin = process.env.WEB_URL || `http://127.0.0.1:${process.env.E2E_PORT || 4329}`;
process.env.WEB_URL = origin;
process.env.API_URL ||= `${origin}/api`;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../artifacts/cross-browser-report', open: 'never' }],
    ['json', { outputFile: '../../artifacts/cross-browser-results.json' }],
  ],
  outputDir: '../../artifacts/cross-browser-qa',
  webServer: externalServer ? undefined : {
    command: 'node ../../scripts/e2e-server.mjs',
    url: `${origin}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    actionTimeout: 20_000,
    baseURL: origin,
    colorScheme: 'dark',
    // Traces include request bodies and bearer credentials. Keep them off.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'api-contract', testMatch: 'security.spec.ts' },
    {
      name: 'chromium-desktop', testIgnore: 'security.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } },
    },
    {
      name: 'webkit-desktop', testIgnore: 'security.spec.ts',
      grepInvert: /compact viewport/,
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 960 } },
    },
    {
      // Browser emulation only: this is not an iOS native or physical iPhone test.
      name: 'webkit-iphone', testIgnore: 'security.spec.ts',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
