import { describe, expect, it } from 'vitest';

import { digestBytes } from '../envelope/index.js';
import { finalizeAttempt, newAttemptProduct } from './finalize.js';

const envelope = digestBytes('envelope');

describe('finalizing an attempt', () => {
  it('records the envelope after a clean teardown, capturing only after cleanup finished', async () => {
    const order: string[] = [];
    const product = newAttemptProduct();
    await finalizeAttempt(product, {
      cleanup: () => {
        order.push('cleanup');
        return Promise.resolve();
      },
      capture: () => {
        order.push('capture');
        return Promise.resolve(envelope);
      },
    });
    expect(order).toEqual(['cleanup', 'capture']);
    expect(product.envelope).toBe(envelope);
  });

  it('keeps the envelope and still reports the failure when cleanup throws', async () => {
    const product = newAttemptProduct();
    await expect(
      finalizeAttempt(product, {
        cleanup: () => Promise.reject(new Error('cleanup did not settle')),
        capture: () => Promise.resolve(envelope),
      }),
    ).rejects.toThrow('cleanup did not settle');
    expect(product.envelope).toBe(envelope);
  });

  it('leaves no envelope when the capture produced none', async () => {
    const product = newAttemptProduct();
    await finalizeAttempt(product, {
      cleanup: () => Promise.resolve(),
      capture: () => Promise.resolve(null),
    });
    expect(product.envelope).toBeNull();
  });

  it('preserves both cleanup and capture failures and a previously attached envelope', async () => {
    const product = newAttemptProduct();
    const cleanupError = new Error('cleanup failure');
    const captureError = new Error('capture failure');
    let failure: unknown;
    try {
      await finalizeAttempt(product, {
        cleanup: () => Promise.reject(cleanupError),
        capture: () => { product.envelope = envelope; return Promise.reject(captureError); },
      });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([cleanupError, captureError]);
    expect(product.cleanupFailed).toBe(true);
    expect(product.envelope).toBe(envelope);
  });
});
