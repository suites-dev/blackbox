import { defineClient } from '@suites/blackbox-client';

export default defineClient({
  kind: 'entrypoint',
  name: 'create-subscription',
  async run({ args, target }) {
    const userId = args[0] ?? 'alice';
    const response = await fetch(new URL('/subscriptions', target.endpoint.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, paymentMethodId: `pm_capsule_${userId}` }),
    });
    if (!response.ok) {
      throw new Error(`Subscription request returned HTTP ${response.status}`);
    }
    return { kind: 'json', value: await response.json() };
  },
});
