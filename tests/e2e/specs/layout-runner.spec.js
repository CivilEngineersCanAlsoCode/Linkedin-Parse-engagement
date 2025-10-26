// @ts-check
import { test, expect } from '@playwright/test';
import { launchWithExtension } from '../utils/launchExtension.js';

test.describe('Home layout and Runner scroll', () => {
  test('header pinned; payload preview capped and scrollable', async () => {
    const { context, page } = await launchWithExtension();
    await page.goto('https://www.linkedin.com/');

    // Open sidebar and wait for header
    await page.evaluate(() => window.postMessage({ type: 'LR_TEST_OPEN_SIDEBAR' }, '*'));
    await page.waitForSelector('#linkright-sidebar .linkright-sidebar-header');

    const header = page.locator('#linkright-sidebar .linkright-sidebar-header');
    await expect(header).toBeVisible();

    // Ensure countdown panel exists
    await page.waitForSelector('#lr-countdown');

    // Expand payload preview
    await page.locator('#lr-countdown details summary').click();
    const preview = page.locator('#lr-countdown #lr-payload-preview');
    await expect(preview).toBeVisible();

    // Check that preview has a capped height (<= 300px)
    const height = await preview.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeLessThanOrEqual(300);

    // Header should still be at top of the sidebar viewport
    const headerTop = await header.evaluate((el) => el.getBoundingClientRect().top);
    expect(headerTop).toBeGreaterThanOrEqual(0);

    await context.close();
  });
});

