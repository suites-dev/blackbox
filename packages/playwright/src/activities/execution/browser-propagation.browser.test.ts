import { chromium, type Browser, type LaunchOptions } from '@playwright/test';
import { expect, it } from 'vitest';

import {
  startBrowserPropagationFixture,
  type BrowserPropagationFixture,
} from './browser-propagation.fixture.js';
import { runBrowserActivity } from './browser-propagation.js';

const canonicalHeaders = Object.freeze({
  traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
});

async function launchChromium(): Promise<Browser> {
  const configured = process.env.BLACKBOX_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const options =
    configured === undefined
      ? ({ headless: true } satisfies LaunchOptions)
      : ({ executablePath: configured, headless: true } satisfies LaunchOptions);
  try {
    return await chromium.launch(options);
  } catch (error) {
    throw new Error(
      'Chromium is required for browser propagation tests. Install it or set PLAYWRIGHT_BROWSERS_PATH.',
      { cause: error },
    );
  }
}

function traceAt(
  requests: ReadonlyMap<string, { readonly traceparent: string }>,
  path: string,
): string {
  const request = requests.get(path);
  if (request === undefined) {
    throw new Error(`Loopback fixture did not observe ${path}.`);
  }
  return request.traceparent;
}

async function exerciseRedirectBoundaries(
  fixture: BrowserPropagationFixture,
  browser: Browser,
): Promise<void> {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await runBrowserActivity({
      page,
      origin: fixture.origin,
      headers: canonicalHeaders,
      action: (scopedPage) => scopedPage.goto(`${fixture.origin}/direct`),
    });
    await page.goto(`${fixture.origin}/outside`);
    await expect(
      runBrowserActivity({
        page,
        origin: fixture.origin,
        headers: canonicalHeaders,
        action: (scopedPage) => scopedPage.goto(`${fixture.origin}/same-start`),
      }),
    ).rejects.toThrow('cannot follow redirects safely');
    await expect(
      runBrowserActivity({
        page,
        origin: fixture.origin,
        headers: canonicalHeaders,
        action: (scopedPage) => scopedPage.goto(`${fixture.origin}/cross-start`),
      }),
    ).rejects.toThrow('cannot follow redirects safely');

    const byPath = new Map(fixture.originRequests.map((request) => [request.path, request]));
    expect(traceAt(byPath, '/direct')).toBe(canonicalHeaders.traceparent);
    expect(traceAt(byPath, '/outside')).toBe('');
    expect(traceAt(byPath, '/same-start')).toBe(canonicalHeaders.traceparent);
    expect(byPath.has('/same-final')).toBe(false);
    expect(traceAt(byPath, '/cross-start')).toBe(canonicalHeaders.traceparent);
    expect(fixture.foreignRequests).toEqual([]);
  } finally {
    await context.close();
  }
}

it('rejects redirects before scoped propagation can lose or cross its origin in Chromium', async () => {
  const browser = await launchChromium();
  try {
    const fixture = await startBrowserPropagationFixture();
    try {
      await exerciseRedirectBoundaries(fixture, browser);
    } finally {
      await fixture.close();
    }
  } finally {
    await browser.close();
  }
});
