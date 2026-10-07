import type { FeatureOutline } from '../outline.js';

// A feature outline as the command plugin would pass it: two scenarios against
// the library's subscription stub, one all library steps, one ending in a step
// the library does not have.

export const READY = 'the public API reports ready';
export const SUBSCRIBE = 'an eligible user subscribes';

/** The runner variable the profile reads the fixture-control token from. */
export const TOKEN_VARIABLE = 'BLACKBOX_SUITE_FIXTURE_TOKEN';

export const FEATURE = {
  file: 'features/subscription.feature',
  system: 'subscription-system',
  sandbox: 'default',
  profile: {
    environment: { FIXTURE_CONTROL_TOKEN: { fromEnv: TOKEN_VARIABLE } },
    credentials: { 'fixture-control': { scheme: 'bearer', fromEnv: TOKEN_VARIABLE } },
  },
  scenarios: [
    {
      title: READY,
      line: 4,
      steps: [
        {
          keyword: 'When',
          text: 'the client sends GET "/health"',
          argument: { kind: 'none' },
          line: 5,
        },
        {
          keyword: 'Then',
          text: 'the response status is 200',
          argument: { kind: 'none' },
          line: 6,
        },
        {
          keyword: 'And',
          text: 'the response has "/status" equal to:',
          argument: { kind: 'doc-string', content: '"ready"', mediaType: 'json' },
          line: 7,
        },
      ],
    },
    {
      title: SUBSCRIBE,
      line: 12,
      steps: [
        {
          keyword: 'When',
          text: 'the client sends POST "/subscriptions" with JSON:',
          argument: { kind: 'doc-string', content: '{"userId": "alice"}', mediaType: null },
          line: 13,
        },
        {
          keyword: 'Then',
          text: 'the response status is 201',
          argument: { kind: 'none' },
          line: 17,
        },
        {
          keyword: 'And',
          text: 'the state at "/fixture/state" as "fixture-control" has 1 item at "/subscriptions"',
          argument: { kind: 'none' },
          line: 18,
        },
        {
          keyword: 'And',
          text: "the user's welcome email is sent",
          argument: { kind: 'none' },
          line: 19,
        },
      ],
    },
  ],
} as const satisfies FeatureOutline;
