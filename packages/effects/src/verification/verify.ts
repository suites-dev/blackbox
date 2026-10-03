import { verifyBefore } from './before.js';
import { verifyCount } from './counts.js';
import { reachability, validateGraph } from './graph.js';
import type {
  EffectGraph,
  VerificationAssessment,
  VerificationContract,
  VerificationStatus,
} from './model.js';

function combine(statuses: readonly VerificationStatus[]): VerificationStatus {
  if (statuses.includes('fail')) {
    return 'fail';
  }
  return statuses.includes('inconclusive') ? 'inconclusive' : 'pass';
}

export function verify(graph: EffectGraph, contract: VerificationContract): VerificationAssessment {
  validateGraph(graph);
  if (contract.constraints.length === 0) {
    throw new TypeError('Invalid empty contract');
  }
  const closed = graph.scope.closed && graph.quality.coverage === 'complete';
  const context = {
    graph,
    closure: reachability(graph),
    closed,
    fullOrder: closed && graph.quality.orderCoverage === 'complete',
  };
  const findings = contract.constraints.map((constraint, index) => ({
    index,
    ...(constraint.op === 'before'
      ? verifyBefore(context, constraint)
      : verifyCount(context, constraint)),
  }));
  return {
    status: combine(findings.map((finding) => finding.status)),
    findings,
    scope: graph.scope.id,
    semanticsVersion: '0.1.0',
  };
}
