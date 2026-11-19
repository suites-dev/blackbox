import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sutSource = join(dirname(dirname(fileURLToPath(import.meta.url))), 'sut');
const mutations = [
  ['readonly #refunds: Refund[] = [];',
    'readonly #refunds: Refund[] = [];\n  readonly #refundedIntents = new Set<string>();'],
  ['this.#refunds.some((refund) => refund.paymentIntentId === paymentIntentId)',
    'this.#refundedIntents.has(paymentIntentId)'],
  ['this.#refunds.push(refund);',
    'this.#refundedIntents.add(paymentIntentId); // Fault: idempotency retained; refund write lost.'],
  ['this.#refunds.length = 0;', 'this.#refunds.length = 0;\n    this.#refundedIntents.clear();'],
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function replaceOnce(source, original, replacement, label) {
  assert.equal(source.split(original).length, 2, `${label} must occur exactly once`);
  return source.replace(original, replacement);
}

async function copyFaultSut(project) {
  const directory = join(project, 'fault-sut');
  await mkdir(directory);
  for (const name of ['src', 'package.json', 'package-lock.json', 'tsconfig.json', '.dockerignore']) {
    await cp(join(sutSource, name), join(directory, name), { recursive: true, errorOnExist: true });
  }
  const sourceFile = join(directory, 'src/payment-mock/state.ts');
  const original = await readFile(sourceFile, 'utf8');
  let fault = original;
  for (const [before, after] of mutations) {
    fault = replaceOnce(fault, before, after, 'Refund persistence control');
  }
  assert.equal(fault.slice(fault.indexOf('  inspect():')), original.slice(original.indexOf('  inspect():')),
    'Fault must preserve inspection projection');
  await writeFile(sourceFile, fault);
  const faultDiff = join(project, 'refund-persistence-fault.diff');
  const originalLines = original.trimEnd().split('\n');
  const faultLines = fault.trimEnd().split('\n');
  await writeFile(faultDiff, [
    '--- original/src/payment-mock/state.ts', '+++ fault/src/payment-mock/state.ts',
    `@@ -1,${originalLines.length} +1,${faultLines.length} @@`,
    ...originalLines.map((line) => `-${line}`), ...faultLines.map((line) => `+${line}`), '',
  ].join('\n'));
  assert.equal(await readFile(join(sutSource, 'src/payment-mock/state.ts'), 'utf8'), original,
    'Original SUT changed while preparing fault');
  return { directory, sourceFile, faultDiff, originalSha256: sha256(original), faultSha256: sha256(fault) };
}

/**
 * A lost refund write with an independently retained idempotency marker:
 * POST 201 and duplicate POST 409 remain intact; actual refund storage stays empty.
 * The unchanged generated scenario must reach and fail its final GET state claim.
 * Caller owns the disposable project and removal of the returned unique image.
 */
export async function prepareRefundPersistenceFault(projectDirectory) {
  const project = await realpath(projectDirectory);
  assert.equal(dirname(project), await realpath('/tmp'), 'Fault project must be a temporary consumer');
  assert.match(basename(project), /^bbf-[A-Za-z0-9]+$/u, 'Fault project must be an owned bbf consumer');
  const sut = await copyFaultSut(project);
  const image = `blackbox-feature-refund-persistence-fault:${randomBytes(8).toString('hex')}`;
  const originalCompose = join(project, '.blackbox/catalog/payment-mock-image.yml');
  const composeFile = join(project, '.blackbox/catalog/payment-refund-persistence-fault.yml');
  let compose = await readFile(originalCompose, 'utf8');
  compose = replaceOnce(compose, 'image: sut-payment-mock:local', `image: ${image}`, 'Payment image');
  const contexts = compose.match(/^\s+context: .+$/gmu) ?? [];
  assert.equal(contexts.length, 1, 'Payment Compose must contain one build context');
  compose = replaceOnce(compose, contexts[0], `      context: ${JSON.stringify(sut.directory)}`,
    'Payment build context');
  await writeFile(composeFile, compose, { flag: 'wx' });
  const catalog = await readFile(join(project, 'blackbox.config.yaml'), 'utf8');
  const faultCatalog = replaceOnce(catalog, '.blackbox/catalog/payment-mock-image.yml',
    '.blackbox/catalog/payment-refund-persistence-fault.yml', 'Payment Catalog acquisition');
  await writeFile(join(project, 'fault-blackbox.config.yaml'), faultCatalog, { flag: 'wx' });
  return {
    kind: 'refund-persistence-omitted',
    configFile: './fault-blackbox.config.yaml', sutDirectory: sut.directory, composeFile, image,
    sourceFile: sut.sourceFile, faultDiff: sut.faultDiff, originalSha256: sut.originalSha256, faultSha256: sut.faultSha256,
    mutation: { replacements: mutations.map(([before, after]) => ({ before, after })) },
  };
}
