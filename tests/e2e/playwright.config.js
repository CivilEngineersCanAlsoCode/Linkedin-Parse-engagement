// @ts-check
import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

/**
 * Resolve path to extension root
 */
function extensionPath() {
  // repo root is two levels up from /tests/e2e
  return path.resolve(__dirname, '..', '..');
}

export default defineConfig({
  testDir: path.resolve(__dirname, 'specs'),
  timeout: 120000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'https://www.linkedin.com/',
    headless: false,
    viewport: { width: 1280, height: 800 },
    // Persistent context is launched per-test in helper; keep default here
  },
  projects: [
    {
      name: 'chromium-extension',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});

