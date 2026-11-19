import { retainedTextForRedaction } from '../../execution/output-retention.js';
import type { CapsuleOutputRetention } from '../../model/execution/process-outcome.js';
import { redactText, type RedactionContext } from './text.js';

/** Retain only the kind of each rewrite. Locations are assigned at the current report position. */
export function redactCapturedStream(
  text: string, retention: CapsuleOutputRetention, location: string, context: RedactionContext,
) {
  const entries: RedactionContext['entries'] = [];
  const local = { ...context, entries };
  const bounded = 'redactions' in retention ? text : retainedTextForRedaction(text, retention);
  const value = redactText(bounded, location, local);
  const kinds = 'redactions' in retention ? [...retention.redactions] : [];
  if (bounded !== text) {
    kinds.push('sensitive-output');
  }
  if (value !== bounded) {
    for (const { kind } of entries) {
      if (kind !== 'sensitive-argument') {
        kinds.push(kind);
      }
    }
  }
  for (const kind of kinds) {
    context.entries.push({ kind, location });
  }
  return { value, retention: kinds.length === 0 ? retention : { ...retention, redactions: kinds } };
}
