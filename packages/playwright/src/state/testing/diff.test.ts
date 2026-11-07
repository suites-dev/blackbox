import { expect, it } from 'vitest';
import { createStateRegistry } from '../registry.js';

it('compares exact Unicode keys independently of insertion order without hiding real changes', async () => {
  const registry = createStateRegistry();
  let value = { '\u00e9': 1, 'e\u0301': 2 };
  const observer = registry.state.observe('unicode', {
    scalar: () => value,
    rows: () => [{ id: 'one', ...value }],
  });
  const selection = registry.select();
  const first = await selection.capture();
  value = { 'e\u0301': 2, '\u00e9': 1 };
  const reordered = await selection.capture();
  expect(selection.between(first.checkpoint, reordered.checkpoint, observer).diff).toEqual({
    scalar: { before: value, after: value, changed: false },
    rows: { added: [], removed: [], changed: [] },
  });
  value = { 'e\u0301': 3, '\u00e9': 1 };
  const changed = await selection.capture();
  expect(selection.between(reordered.checkpoint, changed.checkpoint, observer).diff).toEqual({
    scalar: { before: { '\u00e9': 1, 'e\u0301': 2 }, after: value, changed: true },
    rows: {
      added: [],
      removed: [],
      changed: [
        {
          before: { id: 'one', '\u00e9': 1, 'e\u0301': 2 },
          after: { id: 'one', ...value },
        },
      ],
    },
  });
});
