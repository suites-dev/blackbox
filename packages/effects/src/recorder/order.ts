import { verifyBefore } from '../verification/before.js';
import { reachability } from '../verification/graph.js';
import type { ObservedEffect } from '../graph/model.js';
import type { VerificationFinding } from '../verification/model.js';
import { assessment, complete, predicateResult, unavailable } from './assessment.js';
import type { EffectEmissionPredicate, EffectRecorder, EffectRecorderAssessment } from './model.js';
import { recorderState } from './ownership.js';

/** Every selected left emission must causally precede every selected right emission. */
export function assessEffectRecorderBefore(
  first: EffectRecorder,
  second: EffectRecorder,
): EffectRecorderAssessment {
  const left = recorderState(first);
  const right = recorderState(second);
  if (left.capture !== right.capture) {
    throw new TypeError('Emission ordering requires recorders from the same immutable capture');
  }
  const graph = left.capture.graph;
  if (graph === null) {
    return unavailable(first);
  }
  const closed = complete(first);
  return assessment(
    first,
    verifyBefore(
      {
        graph,
        closure: reachability(graph),
        closed,
        fullOrder: closed && graph.quality.orderCoverage === 'complete',
      },
      { a: first.selector, b: second.selector },
    ),
    [
      ...new Set(
        [...left.selection.possible, ...right.selection.possible].map((effect) => effect.id),
      ),
    ],
    graph.relations.filter((relation) => relation.type === 'happensBefore'),
  );
}

function uniqueOrdinal(
  emissions: readonly ObservedEffect[],
  closure: ReadonlyMap<string, ReadonlySet<string>>,
  ordinal: number,
): ObservedEffect | undefined {
  return emissions.find((candidate) => {
    let predecessors = 0;
    let successors = 0;
    for (const emission of emissions) {
      if ((closure.get(emission.id) ?? new Set()).has(candidate.id)) {
        predecessors++;
      }
      if ((closure.get(candidate.id) ?? new Set()).has(emission.id)) {
        successors++;
      }
    }
    return predecessors === ordinal - 1 && successors === emissions.length - ordinal;
  });
}

/** Ordinals require a complete selected set and causal witnesses, never collector arrival order. */
export function assessNthEffectEmission(
  recorder: EffectRecorder,
  ordinal: number,
  predicate: EffectEmissionPredicate,
): EffectRecorderAssessment {
  const state = recorderState(recorder);
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new TypeError('An emission ordinal must be a positive safe integer');
  }
  if (state.capture.graph === null) {
    return unavailable(recorder);
  }
  const possible = state.selection.possible.map((effect) => effect.id);
  const evidence = state.selection.definite.map((effect) => effect.id);
  const relations = state.capture.graph.relations.filter(
    (relation) => relation.type === 'happensBefore',
  );
  const decide = (finding: VerificationFinding, possibleEvidence: readonly string[] = []) =>
    assessment(recorder, finding, possibleEvidence, relations);
  if (!complete(recorder) || possible.length > 0) {
    return decide(
      {
        status: 'inconclusive',
        reason: 'An emission ordinal requires a complete, resolved selection',
        evidence,
      },
      possible,
    );
  }
  if (ordinal > state.selection.definite.length) {
    return decide({
      status: 'fail',
      reason: `Emission ${ordinal} does not exist in the complete selection`,
      evidence,
    });
  }
  const candidate = uniqueOrdinal(
    state.selection.definite,
    reachability(state.capture.graph),
    ordinal,
  );
  if (candidate === undefined) {
    return decide({
      status: 'inconclusive',
      reason: `A unique causal emission ${ordinal} is not established`,
      evidence,
    });
  }
  const match = predicateResult(predicate, candidate);
  return decide(
    {
      status: match === null ? 'inconclusive' : match ? 'pass' : 'fail',
      reason: `Causal emission ${ordinal}: ${match === null ? 'payload unknown' : match ? 'matched' : 'did not match'}`,
      evidence,
    },
    match === null ? [candidate.id] : [],
  );
}
