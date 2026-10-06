import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkPackagedSkills,
  checkSkills,
  loadCommands,
  loadSchemaFields,
} from './check-skill-commands.mjs';

const commands = await loadCommands();
const fields = await loadSchemaFields();

const CATALOG = 'packages/catalog/skills/catalog/SKILL.md';
const CAPSULE = 'packages/capsule/skills/capsule/references/example.md';

function check(text, path = CAPSULE) {
  return checkSkills({ files: [{ path, text }], commands, fields });
}

const messages = (problems) => problems.map(({ line, message }) => `${line}: ${message}`);

test('the packaged skills match the installed command registries and catalog schema', async () => {
  const { files, problems } = await checkPackagedSkills();
  assert.ok(files > 40, `expected to scan the packaged skills, found ${files} files`);
  assert.deepEqual(
    problems.map(({ file, line, message }) => `${file}:${line}: ${message}`),
    [],
  );
});

test('registries expose the commands the skills rely on', () => {
  for (const id of ['capsule:up', 'capsule:run', 'capsule:show', 'capsule:report:export']) {
    assert.ok(commands.has(id), id);
  }
  assert.equal(commands.get('observations')?.hidden, true);
  assert.ok(commands.get('capsule:run').flags.has('session'));
  assert.ok(!commands.get('capsule:report').flags.has('session'));
  assert.deepEqual([...fields.topLevel].sort(), ['activations', 'catalog', 'schemaVersion']);
  assert.ok(fields.entryLevel.has('acquisition'));
  assert.ok(!fields.known.has('isolation'));
});

test('negative control: an unknown command fails, and restoring it passes', () => {
  const good = 'Run it with `blackbox capsule run --session <id> -- curl --fail`.';
  const bad = 'Run it with `blackbox capsule exec --session <id> -- curl --fail`.';
  assert.deepEqual(check(good), []);
  assert.deepEqual(messages(check(bad)), [
    '1: unknown command: blackbox capsule exec --session <id> -- curl --fail',
  ]);
  assert.deepEqual(check(good), []);
});

test('negative control: an unknown flag fails, and restoring it passes', () => {
  const good = '```sh\nblackbox capsule report export --session "$ID" --format json\n```';
  const bad = '```sh\nblackbox capsule report --session "$ID"\n```';
  assert.deepEqual(check(good), []);
  assert.deepEqual(messages(check(bad)), [
    '2: unknown flag --session: blackbox capsule report --session "$ID"',
  ]);
  assert.deepEqual(check(good), []);
});

test('negative control: an unknown catalog field fails, and restoring it passes', () => {
  const good = 'Map the boundary to ordered `acquisition` files and `participants`.';
  const bad = 'Map the boundary to ordered `acquisition` files, `isolation` and `participants`.';
  assert.deepEqual(check(good, CATALOG), []);
  assert.deepEqual(messages(check(bad, CATALOG)), [
    '1: catalog field or term `isolation` is not in the catalog schema',
  ]);
  assert.deepEqual(check(good, CATALOG), []);
});

test('negative control: unknown fields in a yaml block fail at the right level', () => {
  const yaml = (extra) =>
    `\`\`\`yaml\nschemaVersion: 1\ncatalog:\n  entries:\n    shop:\n      kind: system\n${extra}\`\`\``;
  assert.deepEqual(check(yaml('      observation: {}\n')), []);
  assert.deepEqual(messages(check(yaml('      isolation: shared\n'))), [
    '7: unknown catalog entry field isolation',
  ]);
  assert.deepEqual(messages(check('```yaml\nisolation: shared\n```')), [
    '2: unknown top-level catalog field isolation',
  ]);
});

test('a hidden command is not an available command', () => {
  assert.deepEqual(messages(check('`blackbox observations --session <id>`')), [
    '1: hidden command: blackbox observations --session <id>',
  ]);
  assert.deepEqual(messages(check('Use `observations --session <id>` to query.')), [
    '1: hidden command: blackbox observations --session <id>',
  ]);
});

test('commands are found behind package-manager runners and line continuations', () => {
  assert.deepEqual(check('`pnpm exec blackbox capsule show <id> --spans`'), []);
  assert.deepEqual(check('`npm exec -- blackbox --help`'), []);
  assert.deepEqual(
    messages(check('```sh\nid=$(blackbox capsule up shop \\\n  --json \\\n  --reuse)\n```')),
    ['2: unknown flag --reuse: blackbox capsule up shop --json --reuse'],
  );
});

test('flags after a literal -- belong to the child command', () => {
  assert.deepEqual(
    check('```sh\nblackbox capsule run --session "$ID" -- curl --fail --silent\n```'),
    [],
  );
});

test('the marker allows an illustrative command that does not exist', () => {
  assert.deepEqual(
    check('<!-- skill-lint: not-available -->\nThere is no `blackbox capsule exec`.'),
    [],
  );
  assert.deepEqual(check('There is no `blackbox test`. <!-- skill-lint: not-available -->'), []);
  assert.deepEqual(messages(check('There is no `blackbox test`.')), [
    '1: unknown command: blackbox test',
  ]);
});

test('the marker fails on a command that exists, and covers only its own line', () => {
  assert.deepEqual(
    messages(check('<!-- skill-lint: not-available -->\nUse `blackbox capsule run -- true`.')),
    ['2: not-available marker on a command that exists: blackbox capsule run -- true'],
  );
  assert.deepEqual(
    messages(
      check(
        '<!-- skill-lint: not-available -->\nNo `blackbox capsule exec`.\nStill `blackbox capsule exec`.',
      ),
    ),
    ['3: unknown command: blackbox capsule exec'],
  );
});
