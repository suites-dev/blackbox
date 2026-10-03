import { snapshotContract } from './boundary/contract.js';
import { snapshotGraph } from './boundary/graph.js';
import { freezeOwned } from './boundary/ownership.js';
import type { EffectContract } from './contract.js';
import { adaptContract } from './evaluation/contract-adapter.js';
import type { EffectGraph, VerificationAssessment } from './verification/model.js';
import { verify } from './verification/verify.js';

/** Evaluate snapshotted facts; completeness remains the graph author's claim. */
export function evaluateEffects(
  graph: EffectGraph,
  contract: EffectContract,
): VerificationAssessment {
  const ownedGraph = snapshotGraph(graph);
  const ownedContract = snapshotContract(contract);
  return freezeOwned(verify(ownedGraph, adaptContract(ownedContract)));
}
