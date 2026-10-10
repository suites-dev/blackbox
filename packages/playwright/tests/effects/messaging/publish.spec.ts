import { setTimeout as delay } from 'node:timers/promises';
import { expect, test, type EffectContractBuilder } from '@suites/blackbox-playwright';
import { effectsGolden, json } from '../support.js';

test.system('effects-acceptance', (system) => {
  system.sandbox('real dependencies', (sandbox) => {
    sandbox.afterEach(({ sandbox: _sandbox }, info) => {
      // The destination is the claim. A consumer process span may arrive after
      // the assertion and is not evidence that the publish was a traced send.
      effectsGolden(info, { includeWitnessOperation: false });
    });
    sandbox.test(
      'RabbitMQ activity is observed while send remains unknown',
      async ({ step, effects, request, sandbox }) => {
        const response = await step.stimulus(
          'publish alpha message',
          ({ headers }) =>
            request.post(new URL('/publish/alpha', sandbox.entrypoint.url).href, {
              data: { value: 'rabbit-accepted' },
              headers,
            }),
        );
        const published = await json<{
          brokerConfirmed: boolean;
          destination: string;
          messageId: string;
        }>(response, 202);
        expect(published).toMatchObject({
          brokerConfirmed: true,
          destination: 'acceptance.alpha',
        });
        await expect(effects).toSatisfy((e) => [
          e.exists(e.message({ destination: 'acceptance.alpha' })),
        ]);
        const sending: EffectContractBuilder = (e) => [
          e.exists(e.message({ operation: 'send', destination: 'acceptance.alpha' })),
        ];
        await expect(expect(effects).toSatisfy(sending)).rejects.toThrow(/Scope .*: inconclusive/);
        await expect(expect(effects).not.toSatisfy(sending)).rejects.toThrow(
          /Scope .*: inconclusive/,
        );

        const delivery = await step(
          'read alpha delivery independently',
          async () => {
            const url = new URL(
              `/deliveries/${encodeURIComponent(published.messageId)}`,
              sandbox.entrypoint.url,
            ).href;
            for (let attempt = 0; attempt < 20; attempt += 1) {
              const candidate = await request.get(url);
              const body = (await candidate.json()) as { delivery: unknown };
              if (body.delivery) {
                return body;
              }
              await delay(25);
            }
            return { delivery: null };
          },
        );
        expect(delivery).toEqual({
          delivery: {
            destination: 'acceptance.alpha',
            payload: { value: 'rabbit-accepted' },
          },
        });
      },
    );
  });
});
