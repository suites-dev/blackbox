import { afterEach, expect, it, vi } from 'vitest';

import { awaitReadiness } from './readiness.js';
import type { BlackboxEntrypoint } from '../types.js';

const entrypoint = {
  url: 'http://127.0.0.1:41001',
  host: '127.0.0.1',
  port: 41_001,
  protocol: 'http',
} satisfies BlackboxEntrypoint;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(['http://127.0.0.1:41002/health', '//127.0.0.1:41002/health'])(
  'rejects a readiness path outside the sandbox origin: %s',
  async (path) => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchRequest);

    await expect(awaitReadiness({ entrypoint, path, timeoutMs: 100 })).rejects.toThrow(
      'Readiness path must resolve to the sandbox entrypoint origin',
    );
    expect(fetchRequest).not.toHaveBeenCalled();
  },
);

it('rejects a delimiter-injected readiness protocol before constructing its URL', async () => {
  const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchRequest);
  const poisonedEntrypoint = {
    ...entrypoint,
    protocol: 'http://169.254.169.254/latest?x',
    url: 'http://169.254.169.254/latest?x://127.0.0.1:41001',
  } satisfies BlackboxEntrypoint;

  await expect(
    awaitReadiness({ entrypoint: poisonedEntrypoint, path: '/health', timeoutMs: 100 }),
  ).rejects.toThrow('Readiness protocol must be http or https');
  expect(fetchRequest).not.toHaveBeenCalled();
});

it('allows an absolute readiness URL on the sandbox origin', async () => {
  const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchRequest);

  await expect(
    awaitReadiness({
      entrypoint,
      path: 'http://127.0.0.1:41001/health',
      timeoutMs: 100,
    }),
  ).resolves.toBeUndefined();
  expect(fetchRequest).toHaveBeenCalledOnce();
  expect(fetchRequest.mock.calls[0][0]).toEqual(new URL('http://127.0.0.1:41001/health'));
});

it('does not follow a readiness redirect outside the sandbox origin', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const contactedOrigins: string[] = [];
  const fetchRequest = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
    if (init === undefined || init.redirect !== 'manual') {
      contactedOrigins.push('http://127.0.0.1:41002');
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:41002/health' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchRequest);

  let outcome: unknown;
  const readiness = awaitReadiness({ entrypoint, path: '/health', timeoutMs: 50 }).catch(
    (error: unknown) => {
      outcome = error;
    },
  );
  await vi.advanceTimersByTimeAsync(50);
  await readiness;

  expect(contactedOrigins).toEqual([]);
  expect(fetchRequest).toHaveBeenCalledWith(
    new URL('http://127.0.0.1:41001/health'),
    expect.objectContaining({ redirect: 'manual' }),
  );
  expect(outcome).toMatchObject({
    message: 'Readiness did not succeed within 50ms',
    cause: { message: 'Readiness returned HTTP 302' },
  });
});

it('caps the probe and retry delay at the remaining readiness budget', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetchRequest);

  let outcome: unknown;
  const readiness = awaitReadiness({ entrypoint, path: '/health', timeoutMs: 50 }).catch(
    (error: unknown) => {
      outcome = error;
    },
  );

  await vi.advanceTimersByTimeAsync(50);
  const settledAtDeadline = outcome instanceof Error;
  await vi.advanceTimersByTimeAsync(150);
  await readiness;

  expect(timeout).toHaveBeenCalledWith(50);
  expect(settledAtDeadline).toBe(true);
  expect(outcome).toMatchObject({
    message: 'Readiness did not succeed within 50ms',
    cause: { message: 'Readiness returned HTTP 503' },
  });
  expect(fetchRequest).toHaveBeenCalledTimes(1);
});
