import { stepDefinitions } from '../../step-runtime/registry.js';

// Planned steps whose runtime capability does not exist yet (report section
// 6.2). They are part of the vocabulary so that a feature using one fails to
// compile with the capability it needs, not as an undefined step. Their
// bodies never run while the capability is not offered; if it were offered
// before a body exists, the step would fail, never pass.

const notImplemented = (expression: string) => () =>
  Promise.reject(
    new Error(`"${expression}" has no body in this step library; it waits for its capability`),
  );

export const gatedSteps = stepDefinitions([
  {
    // Qualified telemetry verdicts: #26.
    expression: 'the effects satisfy:',
    kind: 'effects-claim',
    argument: 'data-table',
    fixtures: ['effects', 'world'],
    requires: 'effects-claims',
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the effects satisfy:',
    check: null,
    run: notImplemented('the effects satisfy:'),
  },
  {
    // Participant exec and drivers: #119 PW-5 and #39.
    expression: 'the {string} participant runs SQL:',
    kind: 'setup',
    argument: 'doc-string',
    fixtures: ['sandbox'],
    requires: 'participant-exec',
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the "postgres" participant runs SQL:',
    check: null,
    run: notImplemented('the {string} participant runs SQL:'),
  },
]);
