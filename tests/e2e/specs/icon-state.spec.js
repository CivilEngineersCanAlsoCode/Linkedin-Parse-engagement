// @ts-check
import { test, expect } from '@playwright/test';
import { launchWithExtension } from '../utils/launchExtension.js';

test.describe('Toolbar icon state lifecycle', () => {
  test('install → open → sticky → closed', async () => {
    const { context, page } = await launchWithExtension();
    await page.goto('https://www.linkedin.com/');

    // Initially grayscale: storage flag should be false
    await expect.poll(async () => {
      return await page.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['linkright.iconActive'], r => resolve(!!r['linkright.iconActive']))));
    }).toBeFalsy();

    // Click the action by simulating the message to content (content listens to OPEN_SIDEBAR_FROM_EXTENSION)
    await page.evaluate(() => window.postMessage({ type: 'LR_TEST_OPEN_SIDEBAR' }, '*'));

    // Wait for sidebar element
    await page.waitForSelector('#linkright-sidebar');

    // Icon should be colored now
    await expect.poll(async () => {
      return await page.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['linkright.iconActive'], r => resolve(!!r['linkright.iconActive']))));
    }).toBeTruthy();

    // Close to sticky by clicking header close
    const closeBtn = page.locator('#linkright-sidebar [data-action="close"]');
    await closeBtn.click();

    // Sticky exists; icon remains colored
    await page.waitForSelector('#linkright-mini-icon');
    await expect.poll(async () => {
      return await page.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['linkright.iconActive'], r => resolve(!!r['linkright.iconActive']))));
    }).toBeTruthy();

    // Close sticky X → icon should go grayscale
    const stickyClose = page.locator('#linkright-mini-icon .linkright-mini-close-btn');
    await stickyClose.click();

    await expect.poll(async () => {
      return await page.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['linkright.iconActive'], r => resolve(!!r['linkright.iconActive']))));
    }).toBeFalsy();

    await context.close();
  });
});

