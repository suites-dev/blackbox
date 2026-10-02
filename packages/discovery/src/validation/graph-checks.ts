import type { Audit } from '../model/audit.js';
import type { Boundary } from '../model/graph.js';
import { problem, type Diagnostic } from './result.js';

function duplicateIds(
  items: readonly Readonly<{ id: string }>[],
  path: string,
): readonly Diagnostic[] {
  return new Set(items.map((item) => item.id)).size === items.length
    ? []
    : [problem('identity.duplicate', path, 'Identities must be unique within this collection.')];
}

function inferenceCycles(audit: Audit): boolean {
  const items = new Map(audit.evidence.map((item) => [item.id, item]));
  const completed = new Set<string>();
  const active = new Set<string>();
  function visit(id: string, depth: number): boolean {
    if (depth > 64 || active.has(id)) {
      return true;
    }
    if (completed.has(id)) {
      return false;
    }
    active.add(id);
    const item = items.get(id);
    if (
      item !== undefined &&
      item.kind === 'inference' &&
      item.basedOn.some((parent) => visit(parent, depth + 1))
    ) {
      return true;
    }
    active.delete(id);
    completed.add(id);
    return false;
  }
  return audit.evidence.some((item) => visit(item.id, 0));
}

export function graphChecks(audit: Audit): readonly Diagnostic[] {
  const errors = [
    ...duplicateIds(audit.graph.nodes, '$.graph.nodes'),
    ...duplicateIds(audit.graph.edges, '$.graph.edges'),
    ...duplicateIds(audit.evidence, '$.evidence'),
    ...duplicateIds(audit.approvals, '$.approvals'),
  ];
  const nodes = new Set(audit.graph.nodes.map((node) => node.id));
  const evidence = new Set(audit.evidence.map((item) => item.id));
  const references = [
    ...audit.graph.nodes.flatMap((node) => node.evidenceIds),
    ...audit.graph.edges.flatMap((edge) => edge.evidenceIds),
    ...audit.environment.flatMap((input) => input.evidenceIds),
    ...(audit.boundary.kind === 'selected' ? audit.boundary.confidence.evidenceIds : []),
    ...audit.evidence.flatMap((item) => (item.kind === 'inference' ? item.basedOn : [])),
  ];
  if (references.some((id) => !evidence.has(id))) {
    errors.push(
      problem('evidence.missing', '$.evidence', 'An evidence reference does not resolve.'),
    );
  }
  if (
    audit.graph.edges.some((edge) => !nodes.has(edge.from) || !nodes.has(edge.to)) ||
    audit.environment.some((input) => input.consumers.some((id) => !nodes.has(id)))
  ) {
    errors.push(problem('graph.dangling', '$.graph', 'A node reference does not resolve.'));
  }
  if (inferenceCycles(audit)) {
    errors.push(
      problem(
        'evidence.circular',
        '$.evidence',
        'Inference provenance is cyclic or exceeds 64 levels.',
      ),
    );
  }
  for (const item of audit.evidence) {
    if (
      item.kind === 'source' &&
      item.repository === audit.project.repository &&
      item.revision !== audit.project.revision
    ) {
      errors.push(
        problem(
          'evidence.stale',
          '$.evidence',
          'Local source evidence must match the inspected project revision.',
        ),
      );
    }
    if (
      item.kind === 'source' &&
      item.repository !== audit.project.repository &&
      !audit.approvals.some(
        (approval) =>
          approval.kind === 'approved' &&
          approval.action === 'read-repository' &&
          approval.scope === item.repository,
      )
    ) {
      errors.push(
        problem(
          'approval.repository',
          '$.evidence',
          'Cross-repository source evidence needs an explicit read approval.',
        ),
      );
    }
  }
  return errors;
}

function confidenceChecks(boundary: Extract<Boundary, { kind: 'selected' }>): Diagnostic[] {
  if (boundary.confidence.kind !== 'high') {
    return [];
  }
  const errors: Diagnostic[] = [];
  if (boundary.confidence.evidenceIds.length === 0) {
    errors.push(
      problem(
        'boundary.unsupported-confidence',
        '$.boundary.confidence',
        'High confidence requires identified supporting evidence.',
      ),
    );
  }
  if (boundary.unresolvedRequiredIds.length > 0) {
    errors.push(
      problem(
        'boundary.uncertain',
        '$.boundary.confidence',
        'Required unresolved dependencies prevent high confidence.',
      ),
    );
  }
  return errors;
}

// eslint-disable-next-line complexity -- each boundary substitution must satisfy all of its approval conditions in one predicate so a single diagnostic names the rule
export function boundaryChecks(audit: Audit): readonly Diagnostic[] {
  const boundary = audit.boundary;
  if (boundary.kind === 'unselected') {
    return [];
  }
  const errors = confidenceChecks(boundary);
  const selected = new Set(boundary.nodeIds);
  const known = new Set(audit.graph.nodes.map((node) => node.id));
  const substitutions = new Map(
    boundary.substitutions.map((item) => [item.original, item.replacement]),
  );
  for (const item of boundary.substitutions) {
    const approval = audit.approvals.find((candidate) => candidate.id === item.approvalId);
    if (
      !known.has(item.original) ||
      !selected.has(item.replacement) ||
      selected.has(item.original) ||
      substitutions.has(item.replacement) ||
      approval === undefined ||
      approval.kind !== 'approved' ||
      approval.action !== 'substitute-dependency' ||
      approval.scope !== item.original
    ) {
      errors.push(
        problem(
          'boundary.substitution',
          '$.boundary.substitutions',
          'Substitution must be explicit, approved, non-chained and selected.',
        ),
      );
    }
  }
  if (
    substitutions.size !== boundary.substitutions.length ||
    boundary.nodeIds.some((id) => !known.has(id)) ||
    boundary.excluded.some((item) => !known.has(item.nodeId) || selected.has(item.nodeId))
  ) {
    errors.push(
      problem(
        'boundary.identity',
        '$.boundary',
        'Selected, excluded or substitution identities conflict.',
      ),
    );
  }
  for (const edge of audit.graph.edges) {
    if (edge.kind !== 'requires' || !selected.has(edge.from)) {
      continue;
    }
    const target = substitutions.get(edge.to);
    if (!selected.has(target ?? edge.to)) {
      errors.push(
        problem(
          'boundary.open',
          '$.boundary',
          'The boundary is not closed over its declared prerequisites.',
        ),
      );
    }
    if (edge.necessity !== 'mandatory' && boundary.confidence.kind === 'high') {
      errors.push(
        problem(
          'boundary.uncertain',
          '$.boundary.confidence',
          'Unresolved conditional prerequisites prevent high confidence.',
        ),
      );
    }
  }
  return errors;
}
