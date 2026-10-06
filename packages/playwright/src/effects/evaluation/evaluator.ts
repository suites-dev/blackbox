import { evaluateEffects, projectEffects, type EffectAssessment } from '@suites/blackbox-effects';

import {
  retainEffectEvidence,
  type EffectContractEvaluator,
  type EffectEvaluation,
} from '../runtime.js';
import { createEffectEvidenceArtifact } from './artifact.js';
import type { EffectObservationSource } from './source.js';

function evaluation(assessment: EffectAssessment, reasons: readonly string[]): EffectEvaluation {
  if (assessment.status === 'pass') {
    return { kind: 'satisfied' };
  }
  const findings = assessment.findings.map(
    (finding) =>
      `[${finding.index}] ${finding.status}: ${finding.reason}; evidence=${finding.evidence.join(',')}`,
  );
  return {
    kind: assessment.status === 'fail' ? 'unsatisfied' : 'inconclusive',
    message: [`Scope ${assessment.scope}: ${assessment.status}`, ...findings, ...reasons].join(
      '\n',
    ),
  };
}

export function createEffectContractEvaluator(
  source: EffectObservationSource,
): EffectContractEvaluator {
  return {
    async evaluate(contract) {
      const read = await source.read();
      if (read.kind !== 'admitted') {
        return { kind: 'inconclusive', message: read.message };
      }
      try {
        const graph = projectEffects({
          format: 'otlp-json',
          scopeId: read.scopeId,
          payloads: read.payloads,
        });
        const reasons = [...new Set([...read.diagnostics, ...graph.quality.reasons])];
        const result = evaluateEffects(graph, contract);
        return retainEffectEvidence(
          evaluation(result, reasons),
          createEffectEvidenceArtifact({ read, graph, assessment: result }),
        );
      } catch (error) {
        if (!(error instanceof TypeError)) {
          throw error;
        }
        return {
          kind: 'inconclusive',
          message: `Scope ${read.scopeId}: observation rejected: ${error.message}`,
        };
      }
    },
  };
}
