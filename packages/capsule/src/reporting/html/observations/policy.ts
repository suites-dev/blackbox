// Runs inside the Capsule client view, sharing its safe DOM helpers.
export const capsuleObservationPolicyScript = `
function policyCard(d) {
  const card = summaryCard('Observation policy');
  const policy = d.observationPolicy;
  if (!policy || policy.kind !== 'recorded') {
    add(card, badge('not recorded'), p('No observation policy was recorded for this capsule.', 'muted'));
    return card;
  }
  add(card, badge(policy.policyId), p('Terminal observation window ' + policy.terminalObservationWindowMs + 'ms'));
  for (const boundary of policy.boundaries) {
    add(card, p(boundary.id + ' · ' + boundary.kind + ' · ' +
      (boundary.required ? 'required' : 'optional') + ' · ' + boundary.status.replace('-', ' ')));
  }
  add(card, p('Capsule records observations; it does not evaluate whether a boundary was satisfied.', 'muted'));
  return card;
}
`;
