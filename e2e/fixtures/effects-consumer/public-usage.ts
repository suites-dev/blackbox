import {
  compileEffectContract,
  evaluateEffects,
  projectEffects,
  type EffectAssessment,
  type EffectContract,
  type EffectGraph,
} from '@suites/blackbox-effects';

const graph: EffectGraph = projectEffects({
  format: 'otlp-json',
  scopeId: 'typescript-consumer',
  payloads: [],
});
const contract: EffectContract = compileEffectContract((e) => [
  e.exists(e.db({ operation: 'SELECT' })),
  e.absent(e.message({ operation: 'send', destination: 'unexpected' })),
]);
const assessment: EffectAssessment = evaluateEffects(graph, contract);
const status: 'pass' | 'fail' | 'inconclusive' = assessment.status;
void status;

// @ts-expect-error Public graphs are immutable.
graph.scope.id = 'changed';
// @ts-expect-error Public contracts are immutable.
contract.constraints = [];
// @ts-expect-error Selector fields reject unknown domain metadata.
compileEffectContract((e) => [e.exists(e.db({ inventedOperation: 'SELECT' }))]);
