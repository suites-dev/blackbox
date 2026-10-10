import { request } from '@playwright/test';
import { defineClient, expect } from '@suites/blackbox-playwright';

export const api = defineClient(request, {
  target: { participant: 'public-api', containerPort: 3000 },
  env: ['FIXTURE_CONTROL_TOKEN'] as const,
  create: (sdk, { endpoint, env }) =>
    sdk.newContext({
      baseURL: endpoint.url,
      extraHTTPHeaders: { authorization: `Bearer ${env.FIXTURE_CONTROL_TOKEN}` },
    }),
  ready: async (client) => {
    const response = await client.get('/fixture/state');
    expect(response.status()).toBe(200);
  },
  dispose: (client) => client.dispose(),
});
