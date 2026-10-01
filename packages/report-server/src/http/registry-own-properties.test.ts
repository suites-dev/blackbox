import { expect, test } from 'vitest';

import { fixtureProvider } from '../test-fixtures/provider.js';
import { listRegistry, providerFailure } from './registry.js';

test('audit M4: rejects required registry fields inherited from provider prototypes', async () => {
  const { provider } = fixtureProvider();
  const inheritedSummary = Object.create({
    kind: 'report-summary',
    id: 'inherited-summary',
    type: 'inherited-summary',
    title: 'Inherited summary',
    description: { kind: 'unavailable' },
    state: 'stopped',
    createdAt: '2026-09-25T10:00:00Z',
  });
  const inheritedDescription = Object.create({ kind: 'unavailable' });
  const ownSummaryWithInheritedDescription = {
    kind: 'report-summary',
    id: 'inherited-description',
    type: 'inherited-description',
    title: 'Inherited description',
    description: inheritedDescription,
    state: 'stopped',
    createdAt: '2026-09-25T10:00:00Z',
  };
  const inheritedFailure = Object.create({
    kind: 'report-failure',
    code: 'provider-error',
    message: 'Inherited failure',
  });
  const result = await listRegistry({
    providers: [
      {
        ...provider,
        type: 'inherited-summary',
        list() {
          return Promise.resolve({ kind: 'report-list', reports: [inheritedSummary] });
        },
      },
      {
        ...provider,
        type: 'inherited-description',
        list() {
          return Promise.resolve({
            kind: 'report-list',
            reports: [ownSummaryWithInheritedDescription],
          });
        },
      },
      {
        ...provider,
        type: 'inherited-failure',
        list() {
          return Promise.resolve(inheritedFailure);
        },
      },
    ],
  });

  expect(result.reports).toEqual([]);
  expect(result.failures).toEqual([
    { type: 'inherited-summary', failure: providerFailure() },
    { type: 'inherited-description', failure: providerFailure() },
    { type: 'inherited-failure', failure: providerFailure() },
  ]);
});
