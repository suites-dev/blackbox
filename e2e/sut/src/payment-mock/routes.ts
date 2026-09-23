import {
  HttpError,
  readJsonObject,
  requiredText,
  sendJson,
  type RequestContext,
} from '../lib/http.js';
import { PaymentStateError, type PaymentState } from './state.js';

export async function handlePaymentMock(
  context: RequestContext,
  state: PaymentState,
): Promise<void> {
  const { request, response, url } = context;
  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { status: 'ready' });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/v1/payment_intents') {
    const body = await readJsonObject(request);
    sendJson(
      response,
      201,
      state.createPaymentIntent(
        requiredText(body, 'userId'),
        requiredText(body, 'paymentMethodId'),
      ),
    );
    return;
  }
  if (request.method === 'POST' && url.pathname === '/v1/refunds') {
    const body = await readJsonObject(request);
    try {
      sendJson(response, 201, state.createRefund(requiredText(body, 'paymentIntentId')));
    } catch (error) {
      if (!(error instanceof PaymentStateError)) {
        throw error;
      }
      sendJson(response, error.code === 'payment-intent-not-found' ? 404 : 409, {
        code: error.code,
        error: error.message,
      });
    }
    return;
  }
  if (request.method === 'POST' && url.pathname === '/fixture/reset') {
    await readJsonObject(request);
    state.reset();
    sendJson(response, 200, state.inspect());
    return;
  }
  if (request.method === 'GET' && url.pathname === '/fixture/state') {
    sendJson(response, 200, state.inspect());
    return;
  }
  throw new HttpError(404, 'not-found', 'route not found');
}
