import {
  HttpError,
  readJsonObject,
  requiredText,
  sendJson,
  type RequestContext,
} from '../lib/http.js';
import type { FraudAssessmentService } from './assessment.js';

export async function handleFraudCheck(
  context: RequestContext,
  input: { readonly assessment: FraudAssessmentService; ready(): Promise<void> },
): Promise<void> {
  const { request, response, url } = context;
  if (request.method === 'GET' && url.pathname === '/health') {
    await input.ready();
    sendJson(response, 200, { status: 'ready' });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/assess') {
    const body = await readJsonObject(request);
    sendJson(response, 200, await input.assessment.assess(requiredText(body, 'userId')));
    return;
  }
  throw new HttpError(404, 'not-found', 'route not found');
}
