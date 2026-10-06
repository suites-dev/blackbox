import { describe, expect, it } from 'vitest';

import { planFeature } from '../../compiler/planning/plan.js';
import { testCatalog } from '../../compiler/testing/context.js';
import { library } from '../index.js';
import { WORKED_EXAMPLE_PROFILE } from '../testing/worked-examples.js';

// Requirement (benchmark finding F14): a feature that uses a planned step
// whose capability this runtime does not offer fails to compile naming that
// capability, not as an undefined step. The feature is the benchmark's G2,
// selecting the test catalog's system instead of train-ticket's.

describe('gated steps (benchmark F14)', () => {
  it('fails the benchmark G2 feature at the effects claim, naming the capability', () => {
    const source = [
      '@system:subscription-system @sandbox:default',
      '@requirement:REQ-205',
      'Feature: G2 a search touches the expected services',
      '  Expected gap: telemetry claims ("the effects satisfy:") are not in step library v1 (#26).',
      '',
      '  Scenario: a search reaches the price service once',
      '    When the client sends POST "/api/v1/travelservice/trips/left" with JSON:',
      '      """json',
      '      {"startingPlace": "Shang Hai", "endPlace": "Su Zhou", "departureTime": "2099-01-01"}',
      '      """',
      '    Then the flow is sealed by the terminal response',
      '    And the response status is 200',
      '    And the effects satisfy:',
      '      | participant      | effect                                                |',
      '      | ts-price-service | GET /api/v1/priceservice/prices/{routeId}/{trainType} |',
      '',
    ].join('\n');
    expect(() =>
      planFeature(source, 'features/search-telemetry.feature', {
        catalog: testCatalog,
        sandboxProfiles: { default: WORKED_EXAMPLE_PROFILE },
        library,
      }),
    ).toThrow(
      'features/search-telemetry.feature:13:5: step "And the effects satisfy:" needs capability "effects-claims", which this Blackbox runtime does not offer',
    );
  });
});
