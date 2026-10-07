import type { SuiteOutline } from '../outline.js';
import { READY, SUBSCRIBE } from './feature.js';

// The outline the command plugin would read back from the suite rendered for
// FEATURE, written out by hand: library calls for the known sentences, the
// TODO for the welcome email step. Lines are those of the rendered file.

export const SUITE_FILE = 'tests/subscription.spec.ts';

export const SUITE = {
  file: SUITE_FILE,
  feature: 'features/subscription.feature',
  system: 'subscription-system',
  sandbox: 'default',
  scenarios: [
    {
      title: READY,
      line: 10,
      steps: [
        {
          keyword: 'When',
          text: 'the client sends GET "/health"',
          line: 12,
          body: {
            kind: 'library',
            expression: 'the client sends GET {string}',
            values: ['/health'],
            argument: { kind: 'none' },
          },
        },
        {
          keyword: 'Then',
          text: 'the response status is 200',
          line: 15,
          body: {
            kind: 'library',
            expression: 'the response status is {int}',
            values: [200],
            argument: { kind: 'none' },
          },
        },
        {
          keyword: 'And',
          text: 'the response has "/status" equal to:',
          line: 18,
          body: {
            kind: 'library',
            expression: 'the response has {string} equal to:',
            values: ['/status'],
            argument: { kind: 'doc-string', content: '"ready"', mediaType: 'json' },
          },
        },
      ],
    },
    {
      title: SUBSCRIBE,
      line: 23,
      steps: [
        {
          keyword: 'When',
          text: 'the client sends POST "/subscriptions" with JSON:',
          line: 25,
          body: {
            kind: 'library',
            expression: 'the client sends {word} {string} with JSON:',
            values: ['POST', '/subscriptions'],
            argument: { kind: 'doc-string', content: '{"userId": "alice"}', mediaType: null },
          },
        },
        {
          keyword: 'Then',
          text: 'the response status is 201',
          line: 28,
          body: {
            kind: 'library',
            expression: 'the response status is {int}',
            values: [201],
            argument: { kind: 'none' },
          },
        },
        {
          keyword: 'And',
          text: 'the state at "/fixture/state" as "fixture-control" has 1 item at "/subscriptions"',
          line: 31,
          body: {
            kind: 'library',
            expression: 'the state at {string} as {string} has {int} item(s) at {string}',
            values: ['/fixture/state', 'fixture-control', 1, '/subscriptions'],
            argument: { kind: 'none' },
          },
        },
        {
          keyword: 'And',
          text: "the user's welcome email is sent",
          line: 34,
          body: { kind: 'todo' },
        },
      ],
    },
  ],
} as const satisfies SuiteOutline;
