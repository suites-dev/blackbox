import type { StepDefinition } from '../../runtime/step-types.js';

export type VocabularyEntry = Pick<
  StepDefinition,
  'expression' | 'kind' | 'argument' | 'fixtures' | 'credentialParameter' | 'deadlineParameter'
> & { readonly sample: string };

const http = ['request', 'sandbox'] as const;
const inspection = ['credentials', ...http] as const;
const plain = { credentialParameter: null, deadlineParameter: null } as const;
const STATE = 'the state at {string} as {string}';

export const V1 = [
  {
    sample: 'the client has sent POST "/subscriptions" with JSON and received 201:',
    expression: 'the client has sent {word} {string} with JSON and received {int}:',
    kind: 'setup',
    argument: 'doc-string',
    fixtures: http,
    ...plain,
  },
  {
    sample: 'the client sends GET "/health"',
    expression: 'the client sends GET {string}',
    kind: 'stimulus',
    argument: 'none',
    fixtures: [...http, 'world'],
    ...plain,
  },
  {
    sample: 'the client sends POST "/subscriptions" with JSON:',
    expression: 'the client sends {word} {string} with JSON:',
    kind: 'stimulus',
    argument: 'doc-string',
    fixtures: [...http, 'world'],
    ...plain,
  },
  {
    sample: 'the client sends these requests concurrently:',
    expression: 'the client sends these requests concurrently:',
    kind: 'stimulus',
    argument: 'data-table',
    fixtures: [...http, 'world'],
    ...plain,
  },
  {
    sample: 'the flow is sealed by the terminal responses',
    expression: 'the flow is sealed by the terminal response(s)',
    kind: 'barrier',
    argument: 'none',
    fixtures: ['world'],
    ...plain,
  },
  {
    sample:
      'the flow is sealed within 5 seconds when the state at "/s" as "c" has "/orders" equal to:',
    expression: `the flow is sealed within {int} second(s) when ${STATE} has {string} equal to:`,
    kind: 'barrier',
    argument: 'doc-string',
    fixtures: inspection,
    credentialParameter: 2,
    deadlineParameter: 0,
  },
  {
    sample:
      'the flow is sealed within 1 second when the state at "/s" as "c" has 1 item at "/orders"',
    expression: `the flow is sealed within {int} second(s) when ${STATE} has {int} item(s) at {string}`,
    kind: 'barrier',
    argument: 'none',
    fixtures: inspection,
    credentialParameter: 2,
    deadlineParameter: 0,
  },
  {
    sample: 'the response status is 201',
    expression: 'the response status is {int}',
    kind: 'response-claim',
    argument: 'none',
    fixtures: ['world'],
    ...plain,
  },
  {
    sample: 'the response statuses are "201, 409"',
    expression: 'the response statuses are {string}',
    kind: 'response-claim',
    argument: 'none',
    fixtures: ['world'],
    ...plain,
  },
  {
    sample: 'the response JSON equals:',
    expression: 'the response JSON equals:',
    kind: 'response-claim',
    argument: 'doc-string',
    fixtures: ['world'],
    ...plain,
  },
  {
    sample: 'the response has "/data/token" equal to:',
    expression: 'the response has {string} equal to:',
    kind: 'response-claim',
    argument: 'doc-string',
    fixtures: ['world'],
    ...plain,
  },
  {
    sample: 'the response has 1 item at "/data"',
    expression: 'the response has {int} item(s) at {string}',
    kind: 'response-claim',
    argument: 'none',
    fixtures: ['world'],
    ...plain,
  },
  {
    sample: 'the response has a value at "/data/token"',
    expression: 'the response has a value at {string}',
    kind: 'response-claim',
    argument: 'none',
    fixtures: ['world'],
    ...plain,
  },
  {
    sample: 'the state at "/s" as "c" equals:',
    expression: `${STATE} equals:`,
    kind: 'state-claim',
    argument: 'doc-string',
    fixtures: inspection,
    credentialParameter: 1,
    deadlineParameter: null,
  },
  {
    sample: 'the state at "/s" as "c" has "/a" equal to:',
    expression: `${STATE} has {string} equal to:`,
    kind: 'state-claim',
    argument: 'doc-string',
    fixtures: inspection,
    credentialParameter: 1,
    deadlineParameter: null,
  },
  {
    sample: 'the state at "/s" as "c" has 2 items at "/a"',
    expression: `${STATE} has {int} item(s) at {string}`,
    kind: 'state-claim',
    argument: 'none',
    fixtures: inspection,
    credentialParameter: 1,
    deadlineParameter: null,
  },
] satisfies readonly VocabularyEntry[];

export const GATED = [
  {
    sample: 'the effects satisfy:',
    expression: 'the effects satisfy:',
    kind: 'effects-claim',
    argument: 'data-table',
    fixtures: ['effects', 'world'],
    requires: 'effects-claims',
    ...plain,
  },
  {
    sample: 'the "postgres" participant runs SQL:',
    expression: 'the {string} participant runs SQL:',
    kind: 'setup',
    argument: 'doc-string',
    fixtures: ['sandbox'],
    requires: 'participant-exec',
    ...plain,
  },
] satisfies readonly (VocabularyEntry & Pick<StepDefinition, 'requires'>)[];
