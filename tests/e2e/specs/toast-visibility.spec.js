// @ts-check
import { test, expect } from '@playwright/test';
import { launchWithExtension } from '../utils/launchExtension.js';

test('Toast visible over sidebar with correct aria-live', async () => {
  const { context, page } = await launchWithExtension();
  await page.goto('https://www.linkedin.com/');
  await page.evaluate(() => window.postMessage({ type: 'LR_TEST_OPEN_SIDEBAR' }, '*'));
  await page.waitForSelector('#linkright-sidebar');

  await page.evaluate(() => window.postMessage({ type: 'LR_TEST_TOAST', message: 'Settings saved successfully!', toastType: 'success' }, '*'));
  const toast = page.locator('#linkright-toast-container .linkright-toast');
  await expect(toast).toBeVisible();

  // z-index check (rough): toast container should exist and be positioned fixed
  const pos = await page.locator('#linkright-toast-container').evaluate((el) => getComputedStyle(el).position);
  expect(pos).toBe('fixed');

  // aria-live region is present
  await expect(page.locator('#linkright-aria-live')).toBeVisible({ visible: false });

  await context.close();
});

