import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// A loopback stand-in for the demo subscription system, used to qualify the
// step library. Mode `correct` behaves as the native E2E spec asserts. Mode
// `no-row` is spike E's negative control: it answers 201 but never persists
// the subscription row, and so never enqueues the order either. It is not
// evidence about the real application, only about whether a step tells the two
// apart. Mode `not-ready` is correct except that GET /health answers 503
// `{"status": "starting"}`, the stated wrong case for the health check.

export type StubMode = 'correct' | 'no-row' | 'not-ready';

export const STUB_TOKEN = 'stub-fixture-control-token';

interface Subscription {
  readonly id: string;
  readonly userId: string;
  readonly tier: string;
  readonly status: 'active';
}

export interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
  readonly contentType: string | null;
  readonly authorization: string | null;
  readonly body: string;
}

export interface StubSystem {
  readonly url: string;
  readonly received: readonly ReceivedRequest[];
  /** The most requests that were being handled at the same moment. */
  readonly maxInFlight: () => number;
  readonly close: () => Promise<void>;
}

// Pro users take the full path: their order is enqueued asynchronously, after
// the response, which is what a polling barrier waits for. Basic users are
// local-only and never get an order.
const TIERS = new Map<string, string>([
  ['alice', 'pro'],
  ['bob', 'pro'],
  ['carol', 'basic'],
  ['dora', 'basic'],
]);
const RESPONSE_DELAY_MS = 40;
const ORDER_DELAY_MS = 1000;

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

function createState(mode: StubMode) {
  const subscriptions: Subscription[] = [];
  const orders: { readonly id: string; readonly userId: string }[] = [];
  // Check and insert are one synchronous step, so concurrent requests cannot both win.
  const subscribe = (userId: string): { status: number; body: unknown } => {
    const tier = TIERS.get(userId);
    if (tier === undefined) {
      return { status: 404, body: { outcome: 'unknown-user', userId } };
    }
    if (subscriptions.some((row) => row.userId === userId)) {
      return { status: 409, body: { outcome: 'already-subscribed', userId } };
    }
    const row = { id: `subscription_${userId}`, userId, tier, status: 'active' } as const;
    if (mode !== 'no-row') {
      subscriptions.push(row);
      if (tier === 'pro') {
        setTimeout(() => orders.push({ id: `order_${userId}`, userId }), ORDER_DELAY_MS).unref();
      }
    }
    return { status: 201, body: { userId, tier, subscription: { id: row.id, status: row.status } } };
  };
  return { subscribe, snapshot: () => ({ subscriptions: [...subscriptions], orders: [...orders] }) };
}

/** The read-only routes: inspection, health, a redirect and not found. */
function sendRead(request: IncomingMessage, response: ServerResponse, mode: StubMode, snapshot: () => unknown): void {
  const path = request.url ?? '/';
  if (request.method === 'GET' && path === '/fixture/state') {
    const authorized = request.headers.authorization === `Bearer ${STUB_TOKEN}`;
    send(response, authorized ? 200 : 401, authorized ? snapshot() : { error: 'unauthorized' });
  } else if (request.method === 'GET' && path === '/health') {
    const ready = mode !== 'not-ready';
    send(response, ready ? 200 : 503, { status: ready ? 'ready' : 'starting' });
  } else if (path === '/fixture/moved') {
    send(response, 302, {}, { location: '/fixture/state' });
  } else {
    send(response, 404, { error: 'not-found' });
  }
}

export async function startStubSystem(mode: StubMode): Promise<StubSystem> {
  const state = createState(mode);
  const received: ReceivedRequest[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const body = await readBody(request);
    const path = request.url ?? '/';
    received.push({
      method: request.method ?? '',
      path,
      contentType: request.headers['content-type'] ?? null,
      authorization: request.headers.authorization ?? null,
      body,
    });
    if (request.method === 'POST' && path === '/subscriptions') {
      const { userId } = JSON.parse(body) as { readonly userId: string };
      const result = state.subscribe(userId);
      await delay(RESPONSE_DELAY_MS);
      send(response, result.status, result.body);
    } else {
      sendRead(request, response, mode, state.snapshot);
    }
  };
  const server: Server = createServer((request, response) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    void handle(request, response).finally(() => {
      inFlight -= 1;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    maxInFlight: () => maxInFlight,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  };
}
