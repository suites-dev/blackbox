import type { Audit, Stage, Stages } from '../model/audit.js';
import type { Receipt, ReceiptBundle } from '../model/receipts.js';
import { problem, type Diagnostic } from './result.js';

type StageName = keyof Stages;

function scopeMatches(audit: Audit, receipt: Receipt): boolean {
  if (
    receipt.scope.revision !== audit.project.revision ||
    audit.catalog.kind !== 'selected' ||
    receipt.scope.catalogDigest !== audit.catalog.digest
  ) {
    return false;
  }
  if (receipt.scope.kind === 'project') {
    return receipt.kind === 'command' && receipt.phase === 'catalog';
  }
  return (
    audit.execution.kind === 'capsule' &&
    receipt.scope.capsuleId === audit.execution.capsuleId &&
    receipt.scope.attemptId === audit.execution.attemptId
  );
}

function receiptPassed(receipt: Receipt, phase: StageName): boolean {
  switch (receipt.kind) {
    case 'command':
      return (
        receipt.phase === phase && receipt.result.kind === 'exited' && receipt.result.code === 0
      );
    case 'terminal':
      return phase === 'terminal' && receipt.result === 'observed';
    case 'observation':
      return phase === 'observation' && receipt.result === 'captured';
    case 'cleanup':
      return (
        phase === 'cleanup' &&
        receipt.result === 'released' &&
        receipt.remainingOwnedIds.length === 0
      );
  }
}

function phaseChecks(
  audit: Audit,
  phase: StageName,
  stage: Stage,
  receipts: ReadonlyMap<string, Receipt>,
): readonly Diagnostic[] {
  if (stage.kind !== 'passed' && stage.kind !== 'failed') {
    return [];
  }
  const errors: Diagnostic[] = [];
  for (const id of stage.receiptIds) {
    const receipt = receipts.get(id);
    if (receipt === undefined) {
      errors.push(
        problem('receipt.missing', `$.stages.${phase}`, 'A referenced receipt is missing.'),
      );
      continue;
    }
    if (!scopeMatches(audit, receipt)) {
      errors.push(
        problem(
          'receipt.scope',
          `$.stages.${phase}`,
          'Receipt revision, catalog or physical attempt does not match.',
        ),
      );
    }
    if (stage.kind === 'passed' && !receiptPassed(receipt, phase)) {
      errors.push(
        problem(
          'receipt.outcome',
          `$.stages.${phase}`,
          'The receipt does not support success for this stage.',
        ),
      );
    }
    if (
      (phase === 'stimulus' || phase === 'terminal') &&
      stage.kind === 'passed' &&
      receipt.activity.kind !== 'recorded'
    ) {
      errors.push(
        problem(
          'receipt.activity',
          `$.stages.${phase}`,
          'Stimulus and terminal inspection require recorded activities.',
        ),
      );
    }
    if (
      receipt.activity.kind === 'recorded' &&
      (audit.execution.kind !== 'capsule' ||
        !audit.execution.activityIds.includes(receipt.activity.id))
    ) {
      errors.push(
        problem(
          'receipt.activity',
          `$.stages.${phase}`,
          'Activity is not part of the recorded attempt.',
        ),
      );
    }
  }
  return errors;
}

function witnessChecks(
  audit: Audit,
  receipts: ReadonlyMap<string, Receipt>,
): readonly Diagnostic[] {
  if (audit.task.kind !== 'exercise') {
    return [];
  }
  const errors: Diagnostic[] = [];
  const claim = audit.task.claim;
  const terminal = audit.stages.terminal;
  if (terminal.kind === 'passed') {
    const witnessed = new Set<string>();
    for (const id of terminal.receiptIds) {
      const receipt = receipts.get(id);
      if (
        receipt !== undefined &&
        receipt.kind === 'terminal' &&
        receipt.result === 'observed' &&
        receipt.claimId === claim.id &&
        receipt.businessId === claim.businessId
      ) {
        witnessed.add(receipt.nodeId);
      } else {
        errors.push(
          problem(
            'witness.mismatch',
            '$.stages.terminal',
            'A witness must match the claim and the unique business identifier.',
          ),
        );
      }
    }
    if (claim.terminalIds.some((id) => !witnessed.has(id))) {
      errors.push(
        problem(
          'witness.missing',
          '$.stages.terminal',
          'Every required terminal node needs a witness.',
        ),
      );
    }
  }
  const observation = audit.stages.observation;
  if (observation.kind === 'passed') {
    const observed = new Set(
      observation.receiptIds.flatMap((id) => {
        const receipt = receipts.get(id);
        return receipt !== undefined && receipt.kind === 'observation' ? receipt.nodeIds : [];
      }),
    );
    if (claim.requiredObservationIds.some((id) => !observed.has(id))) {
      errors.push(
        problem(
          'observation.missing',
          '$.stages.observation',
          'Required observation nodes are not covered by the supplied receipts.',
        ),
      );
    }
  }
  return errors;
}

export function receiptChecks(audit: Audit, bundle: ReceiptBundle): readonly Diagnostic[] {
  const receipts = new Map(bundle.receipts.map((receipt) => [receipt.id, receipt]));
  const errors: Diagnostic[] = [];
  if (receipts.size !== bundle.receipts.length) {
    errors.push(problem('receipt.duplicate', '$.receipts', 'Receipt identities must be unique.'));
  }
  const phases = [
    'catalog',
    'acquisition',
    'readiness',
    'setup',
    'stimulus',
    'terminal',
    'observation',
    'cleanup',
  ] satisfies readonly StageName[];
  for (const phase of phases) {
    errors.push(...phaseChecks(audit, phase, audit.stages[phase], receipts));
  }
  for (const evidence of audit.evidence) {
    if (evidence.kind !== 'runtime') {
      continue;
    }
    const receipt = receipts.get(evidence.receiptId);
    if (receipt === undefined || !scopeMatches(audit, receipt)) {
      errors.push(
        problem(
          'evidence.receipt',
          '$.evidence',
          'Runtime evidence must resolve to a receipt for this exact scope.',
        ),
      );
    }
  }
  return [...errors, ...witnessChecks(audit, receipts)];
}
