import type { Audit, Stage } from '../model/audit.js';
import { problem, type Diagnostic } from './result.js';

function passed(stage: Stage): boolean {
  return stage.kind === 'passed';
}

function behaviorPassed(audit: Audit): boolean {
  const stages = audit.stages;
  return [stages.catalog, stages.acquisition, stages.readiness, stages.stimulus, stages.terminal].every(passed)
    && (passed(stages.setup) || stages.setup.kind === 'not-required');
}

function claimChecks(audit: Audit): ReadonlyArray<Diagnostic> {
  if (audit.task.kind !== 'exercise') {
    return [];
  }
  const errors: Diagnostic[] = [];
  const claim = audit.task.claim;
  if (audit.boundary.kind === 'selected') {
    const boundary = audit.boundary;
    const replacements = new Map(boundary.substitutions.map((item) => [item.original, item.replacement]));
    const required = [...claim.entryIds, ...claim.terminalIds, ...claim.requiredObservationIds];
    if (required.some((id) => !boundary.nodeIds.includes(replacements.get(id) ?? id))) {
      errors.push(problem('claim.outside-boundary', '$.task.claim', 'Claim inputs, exits and observation nodes must be inside the effective boundary.'));
    }
  } else if (audit.execution.kind === 'capsule') {
    errors.push(problem('claim.no-boundary', '$.boundary', 'An exercised claim needs a selected boundary.'));
  }
  if (audit.operability.kind === 'operable' && audit.operability.claimId !== claim.id) {
    errors.push(problem('claim.identity', '$.operability', 'Operability must identify the accepted claim.'));
  }
  return errors;
}

export function outcomeChecks(audit: Audit): ReadonlyArray<Diagnostic> {
  const errors = [...claimChecks(audit)];
  if (audit.execution.kind === 'not-run'
    && [audit.stages.acquisition, audit.stages.readiness, audit.stages.setup, audit.stages.stimulus,
      audit.stages.terminal, audit.stages.observation, audit.stages.cleanup].some(passed)) {
    errors.push(problem('execution.missing', '$.execution', 'Runtime success requires a recorded Capsule identity.'));
  }
  if (audit.operability.kind === 'operable'
    && (audit.task.kind !== 'exercise' || audit.execution.kind !== 'capsule' || !behaviorPassed(audit))) {
    errors.push(problem('operability.unsupported', '$.operability', 'Operability requires the accepted behavior and terminal check to have run successfully.'));
  }
  if (audit.outcome.kind === 'complete' && audit.task.kind === 'exercise'
    && (!behaviorPassed(audit) || !passed(audit.stages.observation) || !passed(audit.stages.cleanup)
      || audit.operability.kind !== 'operable')) {
    errors.push(problem('outcome.incomplete', '$.outcome', 'A complete live setup includes behavior, required observation and cleanup.'));
  }
  if (audit.outcome.kind === 'complete' && audit.task.kind === 'preflight'
    && (!passed(audit.stages.catalog) || audit.execution.kind !== 'not-run')) {
    errors.push(problem('preflight.invalid', '$.outcome', 'A completed static preflight requires catalog validation without a live Capsule.'));
  }
  if (passed(audit.stages.catalog) && audit.catalog.kind !== 'selected') {
    errors.push(problem('catalog.missing', '$.catalog', 'Catalog validity must identify the selected catalog and its digest.'));
  }
  return errors;
}
