// @ts-check
import { test, expect } from '@playwright/test';
import { launchWithExtension } from '../utils/launchExtension.js';

test('Unpin/close behavior removes sticky and sets grayscale icon', async () => {
  const { context, page } = await launchWithExtension();
  await page.goto('https://www.linkedin.com/');
  await page.evaluate(() => window.postMessage({ type: 'LR_TEST_OPEN_SIDEBAR' }, '*'));
  await page.waitForSelector('#linkright-sidebar');

  // Close to sticky
  await page.locator('#linkright-sidebar [data-action="close"]').click();
  await page.waitForSelector('#linkright-mini-icon');

  // Programmatically close sticky via bridge
  await page.evaluate(() => window.postMessage({ type: 'LR_TEST_CLOSE_STICKY' }, '*'));

  await expect(page.locator('#linkright-mini-icon')).toHaveCount(0);
  await expect.poll(async () => {
    return await page.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['linkright.iconActive'], r => resolve(!!r['linkright.iconActive']))));
  }).toBeFalsy();

  await context.close();
});

