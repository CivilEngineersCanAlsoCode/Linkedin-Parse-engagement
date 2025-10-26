// @ts-check
import { test, expect } from '@playwright/test';
import { launchWithExtension } from '../utils/launchExtension.js';

test('Fresh install → open existing LinkedIn tab → sidebar opens without refresh', async () => {
  const { context, page } = await launchWithExtension();
  await page.goto('https://www.linkedin.com/');

  // Sidebar should open when test triggers the open message (simulating action click path)
  await page.evaluate(() => window.postMessage({ type: 'LR_TEST_OPEN_SIDEBAR' }, '*'));
  await page.waitForSelector('#linkright-sidebar');

  // Header should be visible and pinned
  await expect(page.locator('#linkright-sidebar .linkright-sidebar-header')).toBeVisible();

  await context.close();
});

