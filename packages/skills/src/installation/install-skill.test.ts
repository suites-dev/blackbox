import { expect, it } from 'vitest';

import { INSTALL_RECORD_NAME } from './install-record.js';
import { SkillStoreError, installSucceeded } from './install-skill.js';
import { MemoryStore, bundle, install, recordAt, text } from './memory-skill-store.fixture.js';

const AGENTS_DIR = '.agents/skills/discovery';
const CLAUDE_DIR = '.claude/skills/discovery';

it('fresh install writes the whole tree plus a provenance record per destination', async () => {
  const store = new MemoryStore();
  const result = await install(store, { agents: ['cursor', 'codex', 'claude'] });
  expect(
    result.destinations.map(({ path, agents, outcome, version, from }) => ({
      path,
      agents,
      outcome,
      version,
      from,
    })),
  ).toEqual([
    {
      path: AGENTS_DIR,
      agents: ['codex', 'cursor'],
      outcome: 'installed',
      version: '1.0.0',
      from: null,
    },
    { path: CLAUDE_DIR, agents: ['claude'], outcome: 'installed', version: '1.0.0', from: null },
  ]);
  expect(installSucceeded(result)).toBe(true);
  for (const path of [AGENTS_DIR, CLAUDE_DIR]) {
    expect(store.file(path, 'SKILL.md')).toBe('# discovery v1\n');
    expect(store.file(path, 'references/ci.md')).toBe('ci\n');
    const record = recordAt(store, path);
    expect(record.version).toBe('1.0.0');
    expect(record.sourcePackage).toBe('fixture-skills');
    expect(Object.keys(record.files)).toEqual(['SKILL.md', 'references/ci.md']);
  }
  // Both copies are byte-identical, so whichever one Cursor picks carries the same text.
  expect(store.directories.get(AGENTS_DIR)).toEqual(store.directories.get(CLAUDE_DIR));
});

it('agents that share a skills directory get one destination', async () => {
  for (const agents of [['codex', 'cursor'], ['claude']] as const) {
    const result = await install(new MemoryStore(), { agents: [...agents] });
    expect(result.destinations, agents.join(',')).toHaveLength(1);
  }
});

it('an unchanged repeat writes nothing', async () => {
  const store = new MemoryStore();
  await install(store);
  const writes = store.writes;
  const result = await install(store);
  expect(result.destinations[0].outcome).toBe('unchanged');
  expect(result.destinations[0].from).toBeNull();
  expect(store.writes).toBe(writes);
});

it('a newer version updates a clean installation and reports the previous version', async () => {
  const store = new MemoryStore();
  await install(store, { bundle: bundle('1.0.0') });
  const result = await install(store, { bundle: bundle('1.1.0', '# discovery v2\n') });
  expect(result.destinations[0]).toMatchObject({
    outcome: 'updated',
    from: '1.0.0',
    version: '1.1.0',
  });
  expect(store.file(AGENTS_DIR, 'SKILL.md')).toBe('# discovery v2\n');
});

it('a new version with identical content still updates the recorded version', async () => {
  const store = new MemoryStore();
  await install(store, { bundle: bundle('1.0.0') });
  const result = await install(store, { bundle: bundle('1.1.0') });
  expect(result.destinations[0]).toMatchObject({ outcome: 'updated', from: '1.0.0' });
  expect(recordAt(store, AGENTS_DIR).version).toBe('1.1.0');
});

it('changed content under the same version still updates', async () => {
  const store = new MemoryStore();
  await install(store);
  const result = await install(store, { bundle: bundle('1.0.0', '# rebuilt\n') });
  expect(result.destinations[0].outcome).toBe('updated');
  expect(store.file(AGENTS_DIR, 'SKILL.md')).toBe('# rebuilt\n');
});

it('local edits, additions and removals are a conflict and are preserved', async () => {
  const store = new MemoryStore();
  await install(store);
  const files = store.tree(AGENTS_DIR);
  files.set('SKILL.md', text('# my edits\n'));
  files.set('notes.md', text('mine\n'));
  files.delete('references/ci.md');
  const writes = store.writes;
  const result = await install(store, { bundle: bundle('2.0.0', '# discovery v2\n') });
  const [destination] = result.destinations;
  expect(destination).toMatchObject({
    outcome: 'conflict',
    reason: 'locally-modified',
    version: '1.0.0',
  });
  expect(destination.message).toMatch(/move or remove it, then rerun/u);
  expect(destination.changes).toEqual([
    { path: 'SKILL.md', change: 'modified' },
    { path: 'notes.md', change: 'added' },
    { path: 'references/ci.md', change: 'removed' },
  ]);
  expect(installSucceeded(result)).toBe(false);
  expect(store.writes).toBe(writes);
  expect(store.file(AGENTS_DIR, 'SKILL.md')).toBe('# my edits\n');
  expect(store.file(AGENTS_DIR, 'notes.md')).toBe('mine\n');
});

it('a CRLF checkout of an unchanged installation is not a local edit', async () => {
  const store = new MemoryStore();
  await install(store, { bundle: bundle('1.0.0', '# a\nb\n') });
  store.tree(AGENTS_DIR).set('SKILL.md', text('# a\r\nb\r\n'));
  const result = await install(store, { bundle: bundle('1.0.0', '# a\nb\n') });
  expect(result.destinations[0].outcome).toBe('unchanged');
});

it('an edited or foreign provenance record is not trusted', async () => {
  const store = new MemoryStore();
  await install(store);
  store.tree(AGENTS_DIR).set(INSTALL_RECORD_NAME, text('{"not":"ours"}'));
  const edited = await install(store);
  expect(edited.destinations[0]).toMatchObject({
    outcome: 'conflict',
    reason: 'locally-modified',
  });
  expect(edited.destinations[0].changes).toEqual([
    { path: INSTALL_RECORD_NAME, change: 'modified' },
  ]);

  const other = new MemoryStore();
  await install(other, { bundle: { ...bundle('1.0.0'), name: 'other' } });
  other.directories.set(AGENTS_DIR, other.tree('.agents/skills/other'));
  const foreign = await install(other);
  expect(foreign.destinations[0].reason).toBe('not-installed-by-blackbox');
});

it('an unrelated existing destination is a conflict and is left untouched', async () => {
  const store = new MemoryStore();
  store.directories.set(CLAUDE_DIR, new Map([['SKILL.md', text('someone else\n')]]));
  store.others.add(AGENTS_DIR);
  const result = await install(store, { agents: ['codex', 'claude'] });
  expect(result.destinations.map(({ outcome, reason }) => ({ outcome, reason }))).toEqual([
    { outcome: 'conflict', reason: 'not-installed-by-blackbox' },
    { outcome: 'conflict', reason: 'not-installed-by-blackbox' },
  ]);
  expect(result.destinations[1].message).toMatch(/move or remove it, then rerun/u);
  expect(store.writes).toBe(0);
  expect(store.file(CLAUDE_DIR, 'SKILL.md')).toBe('someone else\n');
});

it('a manual copy that matches the bundle is adopted byte for byte with a record', async () => {
  const store = new MemoryStore();
  // A CRLF manual copy still matches: hashes are line-ending normalized.
  store.directories.set(
    AGENTS_DIR,
    new Map([
      ['SKILL.md', text('# discovery v1\r\n')],
      ['references/ci.md', text('ci\n')],
    ]),
  );
  const result = await install(store);
  expect(result.destinations[0]).toMatchObject({
    outcome: 'adopted',
    version: '1.0.0',
    from: null,
  });
  expect(installSucceeded(result)).toBe(true);
  expect(store.writes).toBe(1);
  expect(store.file(AGENTS_DIR, 'SKILL.md')).toBe('# discovery v1\r\n');
  expect(recordAt(store, AGENTS_DIR).version).toBe('1.0.0');
  const repeat = await install(store);
  expect(repeat.destinations[0].outcome).toBe('unchanged');
});

it('a manual copy that differs from the bundle is a conflict, not adopted', async () => {
  for (const files of [
    [
      ['SKILL.md', '# discovery v1\n'],
      ['references/ci.md', 'ci\n'],
      ['extra.md', 'x\n'],
    ],
    [
      ['SKILL.md', '# discovery v0\n'],
      ['references/ci.md', 'ci\n'],
    ],
    [['SKILL.md', '# discovery v1\n']],
  ] as const) {
    const store = new MemoryStore();
    store.directories.set(
      AGENTS_DIR,
      new Map(files.map(([path, content]) => [path, text(content)])),
    );
    const result = await install(store);
    expect(result.destinations[0]).toMatchObject({
      outcome: 'conflict',
      reason: 'not-installed-by-blackbox',
    });
    expect(store.writes).toBe(0);
  }
});

it('an empty directory added to an installation is a local change', async () => {
  const store = new MemoryStore();
  await install(store);
  store.tree(AGENTS_DIR).set('notes/', new Uint8Array());
  const result = await install(store, { bundle: bundle('2.0.0') });
  expect(result.destinations[0]).toMatchObject({ outcome: 'conflict', reason: 'locally-modified' });
  expect(result.destinations[0].changes).toEqual([{ path: 'notes/', change: 'added' }]);
});

it('unreadable, unwritable and unsafe destinations fail without stopping the others', async () => {
  const store = new MemoryStore();
  store.failures.set(AGENTS_DIR, {
    operation: 'replace',
    error: new SkillStoreError('permission-denied', 'EACCES: .agents'),
  });
  store.failures.set(CLAUDE_DIR, {
    operation: 'read',
    error: new SkillStoreError('unsafe-path', 'Refusing symlinked skill directory'),
  });
  const failed = await install(store, { agents: ['codex', 'claude'] });
  expect(
    failed.destinations.map(({ outcome, reason, version }) => ({ outcome, reason, version })),
  ).toEqual([
    { outcome: 'failed', reason: 'permission-denied', version: null },
    { outcome: 'failed', reason: 'unsafe-path', version: null },
  ]);
  expect(installSucceeded(failed)).toBe(false);

  const partial = new MemoryStore();
  partial.failures.set(CLAUDE_DIR, { operation: 'replace', error: new Error('disk full') });
  const result = await install(partial, { agents: ['codex', 'claude'] });
  expect(result.destinations.map(({ outcome }) => outcome)).toEqual(['installed', 'failed']);
  expect(result.destinations[1].reason).toBe('io-error');
  expect(partial.directories.has(CLAUDE_DIR)).toBe(false);
});
