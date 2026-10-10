import { payments as paymentClient } from './payment-mock.js';
import { api as apiClient } from './public-api.js';

// The CLI checks directly exported names before emitting native client bindings.
export const api = apiClient;
export const payments = paymentClient;
