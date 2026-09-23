// Health checks for every service in the compose SUT. Single source of truth:
// the spec files under profiles/per-test/ and profiles/per-worker/ register this
// suite under their explicit sutIsolation choice.
//
// These probes are read-only, so the suite is safe on a shared stack without
// any reset; it takes no SuiteOptions.
//
// These direct probes overlap with public-api's own boot gate (it refuses to
// start until every downstream /health answers), but they pin down WHICH
// service is unhealthy when one breaks.
//
// Each test.step() becomes a playwright.test.step span in the exported
// OpenTelemetry trace, so the step titles below double as trace labels.
import { expect, test, type SutStack } from '../fixtures.js';

const services = [
  { name: 'public-api', url: (stack: SutStack) => stack.publicApiUrl },
  { name: 'fraud-check', url: (stack: SutStack) => stack.fraudCheckUrl },
  { name: 'order-service', url: (stack: SutStack) => stack.orderServiceUrl },
  { name: 'payment-mock', url: (stack: SutStack) => stack.paymentMockUrl },
] as const;

export function registerHealthSuite(): void {
  test.system({ flowId: 'health' }, 'Health', () => {
    for (const service of services) {
      // Health endpoints are read-only, so there is no Arrange phase.
      test(`${service.name} reports ready on GET /health`, async ({ act, request, sutStack }) => {
        const response = await act(`Act: GET ${service.name} /health`, () =>
          request.get(`${service.url(sutStack)}/health`),
        );

        await test.step('Assert: 200 with status ready', async () => {
          expect(response.status()).toBe(200);
          expect(await response.json()).toEqual({ status: 'ready' });
        });
      });
    }
  });
}
