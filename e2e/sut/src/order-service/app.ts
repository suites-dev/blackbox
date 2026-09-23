import type { RequestHandler } from '../lib/http.js';
import type { OrderService } from './orders.js';
import { handleOrderService } from './routes.js';

export function createOrderService(input: {
  readonly orders: OrderService;
  ready(): Promise<void>;
}): RequestHandler {
  return (context) => handleOrderService(context, input);
}
