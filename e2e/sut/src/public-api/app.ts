import type { RequestHandler } from '../lib/http.js';
import { requireFixtureControl } from '../fixture-control-auth.js';
import { handlePublicApi, type PublicApiRoutes } from './routes.js';

export function createPublicApi(routes: PublicApiRoutes): RequestHandler {
  return async (context) => {
    if (context.url.pathname.startsWith('/fixture/')) {
      requireFixtureControl(context.request.headers.authorization, routes.fixtureToken);
    }
    await handlePublicApi(context, routes);
  };
}
