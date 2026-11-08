import { test, expect } from '@suites/blackbox-playwright';

interface Subscription { id: string; status: string }

test.describe('Rule: accepted subscriptions are retained as active', () => {
  test('Scenario: Alice subscribes with a valid payment method', async ({
    clients,
    state,
    stimulus,
  }) => {
    const subscriptions = state.observe('subscriptions', {
      rows: async () => {
        const { rows } = await clients.postgres.query<Subscription>(
          'SELECT id, status FROM subscriptions ORDER BY id',
        );
        return rows;
      },
    });

    const { result: response, evidence, verify } = await stimulus(
      'When Alice subscribes with her payment method',
      ({ request, headers }) =>
        request.post('/subscriptions', {
          headers,
          data: {
            userId: 'alice',
            paymentMethodId: 'pm_alice_primary',
          },
        }),
      {
        precondition: {
          name: 'Given no subscriptions exist',
          check: ({ initial }) => {
            expect(initial(subscriptions).rows).toEqual([]);
          },
        },
      },
    );

    const subscription = await verify(
      'Then an active subscription is returned',
      async () => {
        expect(response.status()).toBe(201);

        const body = await response.json() as {
          subscription: Subscription;
        };

        expect(body.subscription).toEqual({
          id: expect.any(String),
          status: 'active',
        });

        return body.subscription;
      },
    );

    const { final, diff } = evidence.state(subscriptions);

    await verify('And exactly that subscription is retained', () => {
      expect(diff.rows.added).toEqual([subscription]);
      expect(final.rows).toEqual([subscription]);
    });

    await verify('And retained state matches the reviewed baseline', () => {
      expect(JSON.stringify(final.rows, null, 2) + '\n')
        .toMatchSnapshot('subscription-state.txt');
    });
  });
});
