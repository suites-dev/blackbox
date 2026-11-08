import { expect as nativeExpect } from '@playwright/test';
import { expect } from '../../../index.js';
import { record } from '../evidence.fixture.js';
import { test, fixtureFor, useProject } from './runtime.fixture.js';

test.describe('native lazy persistence failure', () => {
  useProject();
  test('caught terminal capture attachment failure still fails the attempt', async ({ stimulus, sandbox }, info) => {
    const fixture = fixtureFor(sandbox.executionId);
    const outcome = await stimulus('When a payment succeeds before its lazy capture', ({ request, headers }) => request.post(`${fixture.url}/payments`, { headers }));
    nativeExpect(outcome.result.status()).toBe(201);
    nativeExpect(fixture.exported()).toBe(0);
    const initialAttachments = info.attachments.filter(({ name }) => name === 'effects.json').length;
    nativeExpect(initialAttachments).toBe(1);
    const effects = outcome.evidence.effects;
    if (effects === undefined) { throw new Error('Missing stimulus effects'); }
    await fixture.exportRequest(0);
    const attach = info.attach.bind(info);
    let rejections = 0;
    info.attach = async (name, options) => {
      if (name === 'effects.json' && rejections === 0) {
        rejections++;
        throw new Error('lazy terminal attachment intentionally rejected');
      }
      await attach(name, options);
    };
    try {
      await nativeExpect(outcome.verify('Then failed lazy persistence is caught by the test', async () => {
        await expect(effects.http({ route: '/payments' })).toHaveEmitted();
      })).rejects.toThrow(/lazy terminal attachment intentionally rejected/);
    } finally { info.attach = attach; }
    nativeExpect(rejections).toBe(1);
    record('lazy-persistence-body', { executionId: sandbox.executionId, initialAttachments, rejections, exported: fixture.exported() });
  });
});
