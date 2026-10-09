import { chromium } from '@playwright/test';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  throw new Error('PLAYWRIGHT_BROWSERS_PATH is required for the prepared browser cache');
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<main data-preflight="ready">browser preflight</main>');
  const marker = await page.locator('main').getAttribute('data-preflight');
  if (marker !== 'ready') throw new Error('Chromium did not evaluate the preflight page');
  process.stdout.write(
    `${JSON.stringify(
      {
        kind: 'playwright-browser-preflight',
        browser: 'chromium',
        version: browser.version(),
        headless: true,
        evaluatedPage: true,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser.close();
}
