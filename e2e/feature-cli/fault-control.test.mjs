import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import { prepareRefundPersistenceFault } from './fault-control.mjs';

const originalPath = new URL('../sut/src/payment-mock/state.ts', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function stateClass(source) {
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports }, { timeout: 1000 });
  return exports.PaymentState;
}

async function preparedProject(context) {
  const project = await realpath(await mkdtemp('/tmp/bbf-'));
  context.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(join(project, '.blackbox/catalog'), { recursive: true });
  await cp(
    new URL('../blackbox.config.yaml', import.meta.url),
    join(project, 'blackbox.config.yaml'),
  );
  await cp(
    new URL('../.blackbox/catalog/payment-mock-image.yml', import.meta.url),
    join(project, '.blackbox/catalog/payment-mock-image.yml'),
  );
  return project;
}

test('fault removes the refund write while preserving success, duplicate rejection, reset and inspection', async (context) => {
  const project = await preparedProject(context);
  const original = await readFile(originalPath, 'utf8');
  const fault = await prepareRefundPersistenceFault(project);
  const mutated = await readFile(fault.sourceFile, 'utf8');
  assert.equal(fault.originalSha256, hash(original));
  assert.equal(fault.faultSha256, hash(mutated));
  assert.notEqual(fault.originalSha256, fault.faultSha256);
  assert.equal(
    mutated.slice(mutated.indexOf('  inspect():')),
    original.slice(original.indexOf('  inspect():')),
  );
  const Original = await stateClass(original);
  const Mutant = await stateClass(mutated);
  for (const [State, retained] of [
    [Original, 1],
    [Mutant, 0],
  ]) {
    const state = new State();
    const payment = state.createPaymentIntent('alice', 'pm_alice_refundable');
    assert.deepEqual(JSON.parse(JSON.stringify(state.createRefund(payment.id))), {
      id: 'refund_1',
      paymentIntentId: 'pi_alice1',
      status: 'succeeded',
    });
    assert.throws(() => state.createRefund(payment.id), { code: 'refund-already-exists' });
    assert.equal(state.inspect().refunds.length, retained);
    assert.equal(state.inspect().paymentIntents.length, 1);
    state.reset();
    const next = state.createPaymentIntent('alice', 'pm_alice_refundable');
    assert.equal(state.createRefund(next.id).id, 'refund_1');
  }
  assert.equal(await readFile(originalPath, 'utf8'), original);
  const compose = await readFile(fault.composeFile, 'utf8');
  assert.ok(compose.includes(fault.image));
  assert.ok(compose.includes(fault.sutDirectory));
  assert.match(await readFile(fault.faultDiff, 'utf8'), /refunds.push/u);
  assert.match(
    await readFile(join(project, 'fault-blackbox.config.yaml'), 'utf8'),
    /payment-refund-persistence-fault.yml/u,
  );
  assert.doesNotMatch(
    await readFile(join(project, 'blackbox.config.yaml'), 'utf8'),
    /payment-refund-persistence-fault/u,
  );
});

test('fault helper refuses a directory outside its disposable consumer ownership', async (context) => {
  const directory = await mkdtemp('/tmp/not-a-feature-consumer-');
  context.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(prepareRefundPersistenceFault(directory), /owned bbf consumer/u);
});
