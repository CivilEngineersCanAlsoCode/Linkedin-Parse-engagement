// @ts-check
import { test, expect } from '@playwright/test';
import { launchWithExtension } from '../utils/launchExtension.js';

async function seedCountdown(page, secondsRemaining) {
  const total = 180;
  const startTime = Date.now() - (total - secondsRemaining) * 1000;
  await page.evaluate(({ startTime, total }) => {
    window.postMessage({ type: 'LR_TEST_SET_STORAGE', key: 'linkright.countdownState', value: { isActive: true, startTime, totalSeconds: total, isScanOnly: false } }, '*');
  }, { startTime, total });
}

test('Resume countdown at T-170s and T-5s or reset if elapsed', async () => {
  const { context, page } = await launchWithExtension();
  await page.goto('https://www.linkedin.com/');
  await page.evaluate(() => window.postMessage({ type: 'LR_TEST_OPEN_SIDEBAR' }, '*'));
  await page.waitForSelector('#lr-countdown');

  // Seed at T-170 s remaining
  await seedCountdown(page, 170);
  await page.reload();
  await page.evaluate(() => window.postMessage({ type: 'LR_TEST_OPEN_SIDEBAR' }, '*'));
  await page.waitForSelector('#lr-countdown');
  const startBtnText1 = await page.locator('#lr-start-countdown').textContent();
  expect(startBtnText1).toMatch(/Starting \(2:/);

  // Seed at T-5 s remaining → after short wait it should complete and reset
  await seedCountdown(page, 5);
  await page.reload();
  await page.evaluate(() => window.postMessage({ type: 'LR_TEST_OPEN_SIDEBAR' }, '*'));
  await page.waitForSelector('#lr-countdown');
  await page.waitForTimeout(6000);
  const startBtnText2 = await page.locator('#lr-start-countdown').textContent();
  expect(startBtnText2).toContain('Start (3:00)');

  await context.close();
});

