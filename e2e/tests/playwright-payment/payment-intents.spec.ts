import { expect, test } from '@suites/blackbox-playwright';

interface PaymentIntent {
  id: string;
  status: string;
}

test.describe('Rule: accepted payments are retained as succeeded intents', () => {
  test('Scenario: Alice submits a valid payment method', async ({ clients, state, stimulus }) => {
    const payments = state.observe('payments', {
      rows: async () =>
        (
          await clients.postgres.query<PaymentIntent>(
            'SELECT id, status FROM payment_intent ORDER BY id',
          )
        ).rows,
      cachedIntent: () => clients.redis.get('payment-intent:alice'),
    });

    const { result, evidence, verify } = await stimulus(
      'When Alice submits her payment method',
      ({ request, headers }) =>
        request.post('/v1/payment_intents', {
          headers,
          data: { userId: 'alice', paymentMethodId: 'pm_alice_primary' },
        }),
      {
        precondition: {
          name: 'Given no payment intents exist',
          check: ({ initial }) => {
            expect(initial(payments).rows).toEqual([]);
          },
        },
      },
    );
    const intent = await verify('Then a succeeded intent is returned', async () => {
      expect(result.status()).toBe(201);
      const body = (await result.json()) as PaymentIntent;
      expect(body).toEqual({ id: expect.stringMatching(/^pi_[\da-f-]+$/u), status: 'succeeded' });
      return body;
    });
    const { final, diff } = evidence.state(payments);
    await verify('And exactly that payment is persisted', () => {
      expect(diff.rows.added).toEqual([intent]);
      expect(final.rows).toEqual([intent]);
    });
    await verify('And retained state matches the reviewed baseline', () => {
      const normalized = final.rows.map((row) => ({
        ...row,
        id: row.id === intent.id ? '<created-intent>' : row.id,
      }));
      expect(JSON.stringify(normalized, null, 2) + '\n').toMatchSnapshot('payment-state.txt');
    });
    const effects = evidence.effects;
    if (effects === undefined) { throw new Error('Stimulus effects are unavailable'); }
    await verify('And the payment request is observed at runtime', async () => {
      await expect(effects.http({ actor: 'payment-api', method: 'POST' })).toHaveEmitted();
    });
  });
});
