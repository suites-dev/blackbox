import type { RequestHandler } from '../lib/http.js';
import { requireFixtureControl } from '../fixture-control-auth.js';
import { handlePaymentMock } from './routes.js';
import { PaymentState } from './state.js';

export function createPaymentMock(
  fixtureToken: string,
  state = new PaymentState(),
): RequestHandler {
  return async (context) => {
    if (context.url.pathname.startsWith('/fixture/')) {
      requireFixtureControl(context.request.headers.authorization, fixtureToken);
    }
    await handlePaymentMock(context, state);
  };
}
