import { expect, it } from 'vitest';
import { INSTALL_RECORD_NAME } from './install-record.js';
import { MemoryStore, bundle, install, recordAt, text } from './memory-skill-store.fixture.js';

const AGENTS_DIR = '.agents/skills/discovery';

it('another package cannot take over the same skill even with identical bytes and version', async () => {
  const store = new MemoryStore();
  await install(store);
  const writes = store.writes;
  const result = await install(store, {
    bundle: { ...bundle('1.0.0'), packageName: 'other-package' },
  });
  expect(result.destinations[0]).toMatchObject({
    outcome: 'conflict',
    reason: 'source-package-mismatch',
  });
  expect(store.writes).toBe(writes);
  expect(recordAt(store, AGENTS_DIR).sourcePackage).toBe('fixture-skills');
});

it('legacy records without an owner are adopted only when the entire current bundle matches', async () => {
  for (const modified of [false, true]) {
    const store = new MemoryStore();
    await install(store);
    const legacy = JSON.parse(store.file(AGENTS_DIR, INSTALL_RECORD_NAME) ?? '') as Record<
      string,
      unknown
    >;
    delete legacy.sourcePackage;
    store.tree(AGENTS_DIR).set(INSTALL_RECORD_NAME, text(JSON.stringify(legacy)));
    const writes = store.writes;
    const result = await install(store, {
      bundle: bundle('2.0.0', modified ? '# new upstream\n' : '# discovery v1\n'),
    });
    expect(result.destinations[0].outcome).toBe(modified ? 'conflict' : 'adopted');
    expect(store.writes).toBe(writes + (modified ? 0 : 1));
    expect(recordAt(store, AGENTS_DIR).sourcePackage).toBe(modified ? null : 'fixture-skills');
    expect(store.file(AGENTS_DIR, 'SKILL.md')).toBe('# discovery v1\n');
  }
});
