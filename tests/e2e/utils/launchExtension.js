// @ts-check
import path from 'path';
import fs from 'fs';
import { chromium } from '@playwright/test';

/**
 * Launch Chromium with the unpacked extension loaded.
 * Returns { context, page, extensionId }
 */
export async function launchWithExtension() {
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  const extensionDir = repoRoot; // manifest.json is at repo root
  const userDataDir = path.join(process.cwd(), '.pw-user-data');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });

  // Find the background page to read the extension id from service worker logs or chrome://extensions
  const background = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  // Derive extension id by inspecting background url chrome-extension://<id>/_generated_background_page.html (MV2)
  // MV3 has service worker; we read from targets
  let extensionId = '';
  for (const page of context.pages()) {
    const url = page.url();
    if (url.startsWith('chrome-extension://')) {
      extensionId = url.split('/')[2];
      break;
    }
  }

  const page = await context.newPage();
  return { context, page, extensionId };
}

