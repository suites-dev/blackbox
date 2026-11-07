import { expect, it, vi } from 'vitest';
import { createCaptureOperations } from './operations.js';

it('closes an empty or successfully drained boundary and rejects new admission', async () => {
  for (const populated of [false, true]) {
    const operations = createCaptureOperations({ timeoutMs: 20 });
    if (populated) { expect(await operations.run(() => Promise.resolve([]))).toEqual([]); }
    const closed = operations.close();
    expect(operations.close()).toBe(closed);
    await expect(closed).resolves.toBeUndefined();
    expect(() => { operations.check(); }).toThrow('closed');
    const read = vi.fn(() => Promise.resolve());
    expect(() => operations.run(read)).toThrow('closed');
    expect(read).not.toHaveBeenCalled();
  }
});

it('retains a rejected capture when its caller has already caught the error', async () => {
  const operations = createCaptureOperations({ timeoutMs: 20 });
  const failure = new Error('collector read failed');
  await expect(operations.run(() => Promise.reject(failure))).rejects.toBe(failure);
  await expect(operations.close()).rejects.toMatchObject({ errors: [failure] });
});

it('bounds shutdown, revokes a delayed read, and leaves no timer or late write', async () => {
  vi.useFakeTimers();
  try {
    const operations = createCaptureOperations({ timeoutMs: 20 });
    let release!: () => void;
    const read = new Promise<void>((resolve) => { release = resolve; });
    const write = vi.fn();
    const pending = operations.run(async (lease) => { await read; lease.check(); write(); }, { timeoutMs: 1000 });
    const interrupted = expect(pending).rejects.toThrow('interrupted');
    await vi.advanceTimersByTimeAsync(0);
    const closing = expect(operations.close()).rejects.toMatchObject({ errors: [
      expect.objectContaining({ message: 'Blackbox capture interrupted during shutdown' }),
      expect.objectContaining({ message: 'Blackbox capture shutdown timed out' }),
    ] });
    await vi.advanceTimersByTimeAsync(20);
    await Promise.all([interrupted, closing]);
    expect(vi.getTimerCount()).toBe(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('uses a per-read deadline and retains that failure after its read eventually settles', async () => {
  vi.useFakeTimers();
  try {
    const operations = createCaptureOperations({ timeoutMs: 100 });
    let release!: () => void;
    const read = new Promise<void>((resolve) => { release = resolve; });
    const write = vi.fn();
    const pending = operations.run(async (lease) => { await read; lease.check(); write(); }, { timeoutMs: 10 });
    const failure = expect(pending).rejects.toThrow('operation timed out');
    await vi.advanceTimersByTimeAsync(10);
    await failure;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(write).not.toHaveBeenCalled();
    await expect(operations.close()).rejects.toMatchObject({ errors: [expect.objectContaining({ message: 'Blackbox capture operation timed out' })] });
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
