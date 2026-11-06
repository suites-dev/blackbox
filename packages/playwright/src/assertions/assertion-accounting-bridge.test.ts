import { expect, it, vi } from 'vitest';

import {
  assertionAccountingPlaywrightVersion,
  installAssertionBridge,
  installedPlaywrightVersion,
} from './bridge.js';

it('qualifies the installed pinned version and rejects unsupported versions before changing native hooks', () => {
  expect(installedPlaywrightVersion()).toBe('1.64.1');
  expect(assertionAccountingPlaywrightVersion).toBe('1.64.1');
  const target = { _addStep: vi.fn() };
  const original = target._addStep;
  for (const version of ['1.61.0', '1.64.0', '1.64.2', '2.0.0', '']) {
    expect(() => installAssertionBridge(target, version, () => null)).toThrow(
      expect.objectContaining({ code: 'unsupported' }),
    );
    expect(target._addStep).toBe(original);
  }
  expect(original).not.toHaveBeenCalled();
});

it('rejects missing native hooks without creating an adapter', () => {
  const target = {};
  expect(() => installAssertionBridge(target, '1.64.1', () => null)).toThrow(
    expect.objectContaining({ code: 'unsupported' }),
  );
  expect(Object.hasOwn(target, '_addStep')).toBe(false);
});

it('forwards native completion unchanged, observes it once and restores the exact hook descriptor', () => {
  const complete = vi.fn();
  const step = { complete };
  const original = vi.fn((_data: unknown) => step);
  const target = { _addStep: original };
  const descriptor = Object.getOwnPropertyDescriptor(target, '_addStep');
  const observer = vi.fn();
  const restore = installAssertionBridge(target, '1.64.1', () => observer);
  const data = { category: 'expect' };
  const result = { error: new Error('native soft failure') };
  const returned = target._addStep(data);
  expect(returned).toBe(step);
  returned.complete(result);
  returned.complete(result);
  expect(observer).toHaveBeenCalledExactlyOnceWith(result);
  expect(complete).toHaveBeenCalledTimes(2);
  expect(complete).toHaveBeenLastCalledWith(result);
  expect(original).toHaveBeenCalledExactlyOnceWith(data);
  restore();
  expect(Object.getOwnPropertyDescriptor(target, '_addStep')).toEqual(descriptor);
});

it('restores inherited hooks without leaving an own property', () => {
  const prototype = { _addStep: () => ({ complete: () => undefined }) };
  const target = Object.create(prototype) as typeof prototype;
  const restore = installAssertionBridge(target, '1.64.1', () => null);
  expect(Object.hasOwn(target, '_addStep')).toBe(true);
  restore();
  expect(Object.hasOwn(target, '_addStep')).toBe(false);
  expect(target._addStep).toBe(prototype._addStep);
});

it('still delivers native completion when an accounting observer throws', () => {
  const complete = vi.fn();
  const target = { _addStep: () => ({ complete }) };
  const failure = new Error('observer rejected completion');
  const restore = installAssertionBridge(target, '1.64.1', () => () => {
    throw failure;
  });
  try {
    const step = target._addStep();
    const result = { error: new Error('native failure') };
    expect(() => step.complete(result)).toThrow(failure);
    expect(complete).toHaveBeenCalledExactlyOnceWith(result);
  } finally {
    restore();
  }
});

it('rejects a non-writable completion hook rather than losing native outcomes', () => {
  const step = Object.freeze({ complete: vi.fn() });
  const target = { _addStep: () => step };
  const restore = installAssertionBridge(target, '1.64.1', () => vi.fn());
  try {
    expect(() => target._addStep()).toThrow(expect.objectContaining({ code: 'unsupported' }));
  } finally {
    restore();
  }
});

it('refuses to overwrite another adapter during restoration', () => {
  const target = { _addStep: () => ({ complete: () => undefined }) };
  const restore = installAssertionBridge(target, '1.64.1', () => null);
  const otherAdapter = () => ({ complete: () => undefined });
  target._addStep = otherAdapter;
  expect(restore).toThrow(expect.objectContaining({ code: 'unsupported' }));
  expect(target._addStep).toBe(otherAdapter);
});
