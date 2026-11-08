import { randomUUID } from 'node:crypto';
import { createEffectCapture, type EffectCapture, type EffectGraph } from '@suites/blackbox-effects';
import { ownEffectCapture } from '../../ownership.js';
import type { EmissionAssertionReport } from '../../types.js';
import { lazyEffectCapture } from '../selection.js';

export function providerFixture(readGraph: (read: number, timeoutMs: number) => EffectGraph | Promise<EffectGraph>) {
  let reads = 0;
  let active = true;
  const reports: EmissionAssertionReport[] = [];
  const retained: EffectCapture[] = [];
  const observed: EffectCapture[] = [];
  const budgets: number[] = [];
  const check = () => { if (!active) { throw new Error('Attempt ended'); } };
  const facade = lazyEffectCapture({
    check,
    run: (operation) => operation(),
    async read(timeoutMs) {
      budgets.push(timeoutMs);
      const graph = await readGraph(++reads, timeoutMs);
      const cut = ownEffectCapture(createEffectCapture({ graph, identity: {
        sessionId: 'session', executionId: 'attempt', scopeId: graph.scope.id,
        activityIds: ['activity'], captureId: randomUUID(),
      } }), {
        unavailable: () => active ? null : 'Attempt ended', evidence: null,
        describe: (text) => text, redactSnapshot: (text) => text,
        report: (report) => { check(); retained.push(cut); reports.push(report); return Promise.resolve(); },
      });
      observed.push(cut);
      return cut;
    },
    retain: (cut) => { check(); retained.push(cut); return Promise.resolve(); },
  });
  return { facade, reports, retained, observed, budgets, reads: () => reads, close: () => { active = false; } };
}
