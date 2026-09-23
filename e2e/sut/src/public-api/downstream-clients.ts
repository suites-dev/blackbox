import { fetchJson } from '../lib/http.js';

export interface DownstreamClients {
  ready(): Promise<void>;
  assessFraud(userId: string): Promise<{ readonly hintProfile: string }>;
  createPayment(userId: string, paymentMethodId: string): Promise<{ readonly id: string }>;
  createOrder(userId: string, subscriptionId: string): Promise<{ readonly orderId: string }>;
  resetPayment(): Promise<void>;
  inspectPayment(): Promise<Record<string, unknown>>;
}

export function createDownstreamClients(input: {
  readonly fixtureToken: string;
  readonly fraudUrl: string;
  readonly orderUrl: string;
  readonly paymentUrl: string;
}): DownstreamClients {
  return {
    async ready() {
      await Promise.all([
        fetchJson(`${input.fraudUrl}/health`),
        fetchJson(`${input.orderUrl}/health`),
        fetchJson(`${input.paymentUrl}/health`),
      ]);
    },
    async assessFraud(userId) {
      const result = await postJson(`${input.fraudUrl}/assess`, { userId });
      return { hintProfile: requiredText(result, 'hintProfile') };
    },
    async createPayment(userId, paymentMethodId) {
      const result = await postJson(`${input.paymentUrl}/v1/payment_intents`, {
        paymentMethodId,
        userId,
      });
      return { id: requiredText(result, 'id') };
    },
    async createOrder(userId, subscriptionId) {
      const result = await postJson(`${input.orderUrl}/orders`, { subscriptionId, userId });
      return { orderId: requiredText(result, 'orderId') };
    },
    async resetPayment() {
      await postJson(`${input.paymentUrl}/fixture/reset`, {}, input.fixtureToken);
    },
    inspectPayment() {
      return fetchJson(`${input.paymentUrl}/fixture/state`, {
        headers: { authorization: `Bearer ${input.fixtureToken}` },
      });
    },
  };
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  fixtureToken?: string,
): Promise<Record<string, unknown>> {
  return fetchJson(url, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(fixtureToken === undefined ? {} : { authorization: `Bearer ${fixtureToken}` }),
    },
    method: 'POST',
  });
}

function requiredText(body: Readonly<Record<string, unknown>>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`downstream response field ${field} is missing`);
  }
  return value;
}
