import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Self-hosted tests use a pristine data directory per run; workers inherit these values.
process.env.E2E_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'respdeck-e2e-'));
process.env.E2E_SERVER_LOG ??= join(process.env.E2E_DATA_DIR, 'server.log');

const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } };
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // Static demo build (VITE_DEMO_ONLY): synthetic workspace, no API.
      name: 'demo',
      testMatch: ['workspace.spec.ts', 'accessibility.spec.ts'],
      use: { ...desktop, baseURL: 'http://127.0.0.1:5174' },
    },
    {
      // Real API + web with an empty data directory and no administrator credentials.
      name: 'self-hosted',
      testMatch: ['first-run.spec.ts', 'real-redis.spec.ts'],
      use: { ...desktop, baseURL: 'http://127.0.0.1:5173' },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @respdeck/web exec vite --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 30000,
      env: { VITE_DEMO_ONLY: 'true' },
    },
    {
      command: 'node tests/e2e/support/serve.mjs',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 30000,
      env: {
        DATA_DIR: process.env.E2E_DATA_DIR,
        E2E_SERVER_LOG: process.env.E2E_SERVER_LOG,
        RESPDECK_ORIGIN: 'http://127.0.0.1:5173',
      },
    },
  ],
});
