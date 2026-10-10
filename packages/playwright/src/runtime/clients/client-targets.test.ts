import { expect, it } from 'vitest';
import { resolveCatalogEntry } from '@suites/blackbox-catalog';
import { catalog } from '../../testing/catalog-fixture.js';
import { clientPlan } from './client-targets.js';

it('rejects client participants absent from the catalog acquisition plan', () => {
  const plan = resolveCatalogEntry({
    catalog: catalog(),
    selection: { kind: 'explicit-entry', entryId: 'orders' },
  });
  expect(() => clientPlan(plan, [{ participant: 'unknown', containerPort: 3000 }])).toThrow(
    'Unknown client participant "unknown"',
  );
});
