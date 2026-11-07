import {
  assertionScope,
  expect,
  serializeEffectSnapshot,
  test,
  type EffectContractBuilder,
} from '@suites/blackbox-playwright';
import { effectsGolden, json } from '../support.js';

test.describe('real dependencies', () => {
  test.use({ blackbox: { system: 'effects-acceptance' } });
  test.afterEach(({ sandbox: _sandbox }, info) => {
    effectsGolden(info);
  });
  test('PostgreSQL activity is observed while its operation remains unknown', async ({
    step,
    effects,
    request,
    sandbox,
  }) => {
    const response = await step.stimulus('insert record 101', ({ headers }) =>
      request.post(new URL('/records/101', sandbox.entrypoint.url).href, {
        data: { value: 'persisted-101' },
        headers,
      }),
    );
    expect(await json<{ row: { id: number; value: string } }>(response, 201)).toEqual({
      row: { id: 101, value: 'persisted-101' },
    });
    await expect(effects).toSatisfy((e) => [e.exists(e.db({}))]);
    const insertion: EffectContractBuilder = (e) => [e.exists(e.db({ operation: 'INSERT' }))];
    await expect(expect(effects).toSatisfy(insertion)).rejects.toThrow(/Scope .*: inconclusive/);
    await expect(expect(effects).not.toSatisfy(insertion)).rejects.toThrow(
      /Scope .*: inconclusive/,
    );

    const captured = await effects.capture();
    const database = captured.db({});
    const emissionIds = database.emissions.map(({ id }) => id);
    const { accounting } = await assertionScope(async () => {
      await expect(database).toHaveEmitted();
      await expect(database).toHaveEmittedWith({ kind: 'db', actor: expect.any(String) });
    });
    expect(accounting).toEqual({ total: 2, passed: 2, failed: 0, pending: 0, unconsumed: 0 });
    await expect(expect(database).not.toHaveEmitted()).rejects.toThrow();
    await expect(expect(captured.db({ operation: 'INSERT' })).toHaveEmitted()).rejects.toThrow(
      /inconclusive/i,
    );
    await expect(expect(captured.db({ operation: 'INSERT' })).not.toHaveEmitted()).rejects.toThrow(
      /inconclusive/i,
    );

    const inspection = await step('read record 101 independently', () =>
      request.get(new URL('/records/101', sandbox.entrypoint.url).href),
    );
    expect(await json(inspection, 200)).toEqual({
      row: { id: 101, value: 'persisted-101' },
    });

    const later = await step.stimulus('publish after the immutable capture', ({ headers }) =>
      request.post(new URL('/publish/beta', sandbox.entrypoint.url).href, { headers }),
    );
    expect(later.status()).toBe(202);
    await expect
      .poll(
        async () =>
          (await effects.capture()).message({ destination: 'acceptance.beta' }).emissions.length,
      )
      .toBeGreaterThan(0);
    expect(database.emissions.map(({ id }) => id)).toEqual(emissionIds);
    expect(captured.identity.activityIds).toHaveLength(1);
    expect((await effects.capture()).identity.activityIds).toHaveLength(2);
    await expect(
      expect(captured.message({ destination: 'acceptance.beta' })).toHaveEmitted(),
    ).rejects.toThrow(/inconclusive/i);
  });
});

test.describe('real dependencies', () => {
  test.use({ blackbox: { system: 'effects-acceptance' } });
  test.afterEach(({ sandbox: _sandbox }, info) => {
    effectsGolden(info);
  });
  test('forbidden database activity produces a definite matcher failure', async ({
    step,
    effects,
    request,
    sandbox,
  }, info) => {
    const response = await step.stimulus('insert forbidden record', ({ headers }) =>
      request.post(new URL('/records/201', sandbox.entrypoint.url).href, { headers }),
    );
    expect(response.status()).toBe(201);
    await expect(expect(effects).toSatisfy((e) => [e.absent(e.db({}))])).rejects.toThrow(
      /Scope .*: fail[\s\S]*observed lower=[1-9]/,
    );
    const captured = await effects.capture();
    const database = captured.db({});
    await expect(database).toHaveEmitted();
    await expect(expect(database).toHaveEmittedTimes(0)).rejects.toThrow();
    await expect(expect(database).not.toHaveEmitted()).rejects.toThrow();
    await expect(expect(database).toHaveEmittedTimes(database.emissions.length)).rejects.toThrow(
      /inconclusive/i,
    );
    await expect(
      expect(database).not.toHaveEmittedTimes(database.emissions.length),
    ).rejects.toThrow(/inconclusive/i);
    const observations = serializeEffectSnapshot(captured.http({ actor: 'app', method: 'POST' }), {
      project: ({ kind, actor, operation, target, outcome }) => ({
        kind,
        actor,
        operation,
        target,
        outcome,
      }),
    });
    await info.attach('blackbox-observed-effects.yaml', {
      body: observations,
      contentType: 'application/yaml',
    });
    // This baseline describes the observed cut, including its incomplete coverage.
    expect(observations).toMatchSnapshot('request-observations.yaml');
  });
});
