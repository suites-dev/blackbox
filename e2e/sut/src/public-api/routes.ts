import {
  HttpError,
  readJsonObject,
  requiredText,
  sendJson,
  type RequestContext,
} from '../lib/http.js';
import type { FixtureControl, ResetProfile } from './fixture-control.js';
import {
  SubscriptionWriteError,
  type SubscriptionResult,
  type SubscriptionService,
} from './subscriptions.js';

export interface PublicApiRoutes {
  readonly subscriptions: SubscriptionService;
  readonly fixture: FixtureControl;
  readonly fixtureToken: string;
  ready(): Promise<void>;
}

export async function handlePublicApi(
  context: RequestContext,
  routes: PublicApiRoutes,
): Promise<void> {
  const { request, response, url } = context;
  if (request.method === 'GET' && url.pathname === '/health') {
    await routes.ready();
    sendJson(response, 200, { status: 'ready' });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/subscriptions') {
    const requestBody = await readJsonObject(request);
    let result: SubscriptionResult;
    try {
      result = await routes.subscriptions.subscribe(
        requiredText(requestBody, 'userId'),
        requiredText(requestBody, 'paymentMethodId'),
      );
    } catch (error) {
      if (!(error instanceof SubscriptionWriteError)) {
        throw error;
      }
      sendJson(response, 500, { code: error.code, error: error.message });
      return;
    }
    if (result.kind === 'unknown-user') {
      sendJson(response, 404, { outcome: 'unknown-user', userId: result.userId });
      return;
    }
    if (result.kind === 'duplicate-subscription') {
      sendJson(response, 409, { outcome: 'duplicate-subscription', userId: result.userId });
      return;
    }
    const { kind: _, ...responseBody } = result;
    sendJson(response, 201, responseBody);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/fixture/reset') {
    const body = await readJsonObject(request);
    const profile = parseProfile(body.profile ?? 'fresh');
    await routes.fixture.reset(profile);
    sendJson(response, 200, await routes.fixture.inspect());
    return;
  }
  if (request.method === 'GET' && url.pathname === '/fixture/state') {
    sendJson(response, 200, await routes.fixture.inspect());
    return;
  }
  if (request.method === 'POST' && url.pathname === '/fixture/queue/drain') {
    sendJson(response, 200, { messages: await routes.fixture.drain() });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/fixture/group-cleanup') {
    await routes.fixture.reset('fresh');
    sendJson(response, 200, await routes.fixture.inspect());
    return;
  }
  const proofPrefix = '/fixture/shared-state-proof/';
  if (request.method === 'POST' && url.pathname.startsWith(proofPrefix)) {
    const proofId = decodeURIComponent(url.pathname.slice(proofPrefix.length));
    if (proofId.trim().length === 0) {
      throw new HttpError(400, 'invalid-proof-id', 'proof ID must be non-empty');
    }
    sendJson(response, 202, { kind: 'shared-state-proof-observed', proofId });
    return;
  }
  throw new HttpError(404, 'not-found', 'route not found');
}

function parseProfile(value: unknown): ResetProfile {
  if (value === 'fresh' || value === 'comparison-absent' || value === 'comparison-returning') {
    return value;
  }
  throw new HttpError(
    400,
    'invalid-profile',
    'profile must be fresh, comparison-absent, or comparison-returning',
  );
}
