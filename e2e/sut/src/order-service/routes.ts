import {
  HttpError,
  readJsonObject,
  requiredText,
  sendJson,
  type RequestContext,
} from '../lib/http.js';
import type { OrderService } from './orders.js';

export async function handleOrderService(
  context: RequestContext,
  input: { readonly orders: OrderService; ready(): Promise<void> },
): Promise<void> {
  const { request, response, url } = context;
  if (request.method === 'GET' && url.pathname === '/health') {
    await input.ready();
    sendJson(response, 200, { status: 'ready' });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/orders') {
    const body = await readJsonObject(request);
    const result = await input.orders.create(
      requiredText(body, 'userId'),
      requiredText(body, 'subscriptionId'),
    );
    sendJson(response, 201, result);
    return;
  }
  throw new HttpError(404, 'not-found', 'route not found');
}
