import type { RequestHandler } from '../lib/http.js';
import type { FraudAssessmentService } from './assessment.js';
import { handleFraudCheck } from './routes.js';

export function createFraudCheck(input: {
  readonly assessment: FraudAssessmentService;
  ready(): Promise<void>;
}): RequestHandler {
  return (context) => handleFraudCheck(context, input);
}
