// @ts-check
import { test, expect } from '@playwright/test';
import { launchWithExtension } from '../utils/launchExtension.js';

test('Settings edits do not scroll to top; sticky actions present', async () => {
  const { context, page } = await launchWithExtension();
  await page.goto('https://www.linkedin.com/');

  await page.evaluate(() => window.postMessage({ type: 'LR_TEST_OPEN_SIDEBAR' }, '*'));
  await page.waitForSelector('#linkright-sidebar');
  await page.evaluate(() => window.postMessage({ type: 'LR_TEST_OPEN_SETTINGS' }, '*'));

  const content = page.locator('#linkright-sidebar .linkright-sidebar-content');
  await content.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const before = await content.evaluate((el) => el.scrollTop);

  // Change a field deep in the page
  const privacy = page.locator('#setting-privacy');
  await privacy.fill('https://example.com/privacy');
  await page.waitForTimeout(100);

  const after = await content.evaluate((el) => el.scrollTop);
  expect(after).toBeGreaterThan(0);
  expect(Math.abs(after - before)).toBeLessThan(50);

  // Sticky actions visible
  await expect(page.locator('.linkright-sticky-actions .linkright-btn-primary')).toBeVisible();

  await context.close();
});

