import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const expectedEffects = [
  'PostgreSQL activity is observed while its operation remains unknown',
  'forbidden database activity produces a definite matcher failure',
  'database activity remains observable after rollback while state is absent',
  'RabbitMQ activity is observed while send remains unknown',
  '@isolation alpha attempt cannot use the other destination',
  '@isolation beta attempt cannot use the other destination',
  'inspection database activity cannot satisfy a stimulus database contract',
  '@withheld successful action stays inconclusive under positive and negated matchers',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function specsIn(suite) {
  return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specsIn)];
}

export function proveEffects(report, discovery, goldens) {
  const specs = (report.suites ?? []).flatMap(specsIn);
  assert(
    JSON.stringify(specs.map(({ title }) => title).sort()) ===
      JSON.stringify([...expectedEffects].sort()),
    'Effects case discovery changed',
  );
  assert(
    expectedEffects.every((title) => discovery.includes(title)),
    'Effects list discovery omitted an acceptance case',
  );
  assert(
    report.stats.expected === 8 &&
      report.stats.unexpected === 0 &&
      report.stats.flaky === 0 &&
      report.stats.skipped === 0,
    'Effects acceptance did not pass cleanly',
  );
  for (const spec of specs) {
    assert(spec.tests.length === 1, `Unexpected projects for ${spec.title}`);
    const test = spec.tests[0];
    assert(
      test.expectedStatus === 'passed' && test.results.length === 1,
      `Effects case skipped or retried: ${spec.title}`,
    );
    const result = test.results[0];
    assert(
      result.status === 'passed' && result.retry === 0,
      `Effects attempt did not pass once: ${spec.title}`,
    );
    const effects = result.attachments.filter(({ name }) => name === 'blackbox-effects');
    assert(effects.length > 0, `Effects semantic evidence missing: ${spec.title}`);
    const assertions = [];
    for (const attachment of effects) {
      assert(typeof attachment.body === 'string', 'Effects assertion omitted its report body');
      const value = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
      assert(value.evidence.kind === 'admitted', 'Effects evidence was not admitted');
      const { contract, evaluation, negated, outcome } = value.assertion;
      assertions.push({ contract, evaluation, negated, outcome });
    }
    const expected = goldens[spec.title].map(({ contract, evaluation, negated, outcome }) => ({
      contract,
      evaluation,
      negated,
      outcome,
    }));
    assert(
      JSON.stringify(assertions) === JSON.stringify(expected),
      `Effects semantic verdicts changed: ${spec.title}`,
    );
    // The spec's snapshot compares contracts, verdicts and distinct witnesses.
    // Its awaited assertions also independently inspect HTTP and database state.
  }
  return { kind: 'playwright-effects-proof', specs: expectedEffects, attempts: 8 };
}

async function verifyEffects() {
  const consumer = fileURLToPath(new URL('.', import.meta.url));
  const root = join(consumer, 'test-results', 'effects');
  const goldens = Object.fromEntries(
    await Promise.all(
      expectedEffects.map(async (title) => [
        title,
        JSON.parse(
          await readFile(
            join(
              consumer,
              'effects-acceptance',
              'tests',
              'goldens',
              `${title.replaceAll(/[^\w-]+/g, '-')}.txt`,
            ),
            'utf8',
          ),
        ),
      ]),
    ),
  );
  const proof = proveEffects(
    JSON.parse(await readFile(join(root, 'results.json'), 'utf8')),
    await readFile(join(consumer, 'test-results', 'effects-discovery.txt'), 'utf8'),
    goldens,
  );
  const records = [];
  for (const file of await readdir(root, { recursive: true })) {
    if (!file.endsWith('.json')) continue;
    let record;
    try {
      record = JSON.parse(await readFile(join(root, file), 'utf8'));
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
    if (
      record.schemaVersion === 1 &&
      typeof record.sandboxId === 'string' &&
      typeof record.projectName === 'string' &&
      Array.isArray(record.composeFiles)
    )
      records.push(record);
  }
  assert(records.length === 8, `Expected eight effects Sandbox records, found ${records.length}`);
  for (const key of ['sandboxId', 'projectName']) {
    assert(new Set(records.map((record) => record[key])).size === 8, `Effects ${key} reused`);
  }
  for (const record of records) {
    assert(
      record.state === 'completed' &&
        record.cleanup === 'complete' &&
        record.stopReason === 'completed',
      `Effects Sandbox cleanup incomplete: ${record.sandboxId}`,
    );
    for (const command of [
      ['ps', '--all'],
      ['network', 'ls'],
      ['volume', 'ls'],
    ]) {
      const resources = execFileSync(
        'docker',
        [
          ...command,
          '--quiet',
          '--filter',
          `label=com.docker.compose.project=${record.projectName}`,
        ],
        { encoding: 'utf8' },
      );
      assert(resources.trim() === '', `Effects Compose resources remain: ${record.projectName}`);
    }
  }
  return {
    ...proof,
    sandboxes: records.map(({ sandboxId, projectName, cleanup }) => ({
      sandboxId,
      projectName,
      cleanup,
    })),
  };
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.stdout.write(`${JSON.stringify(await verifyEffects(), null, 2)}\n`);
}
