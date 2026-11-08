import type { AttemptReport } from '../../reporting/attempt.js';
import type { ExecutionEvent, ExecutionJournal } from './journal.js';

export function durableEvents(journal: ExecutionJournal, report: AttemptReport,
  artifacts: ReadonlyMap<string, { output: unknown; effects: string | null }>): unknown[] {
  const begins = new Map<string, Extract<ExecutionEvent, { kind: 'begin' }>>();
  return journal.events().map((event) => {
    if (event.kind === 'begin') {
      begins.set(event.executionId, event);
      return { kind: event.kind, executionId: event.executionId, title: event.title,
        initial: event.selection.serialize(event.initial.checkpoint, (text) => report.redact(text)) };
    }
    if (event.kind === 'final') {
      const begin = begins.get(event.executionId);
      if (begin === undefined) { throw new Error('Execution checkpoint has no initial capture'); }
      return { kind: event.kind, executionId: event.executionId,
        final: begin.selection.serialize(event.final.checkpoint, (text) => report.redact(text)),
        diff: begin.selection.serializeBetween(begin.initial.checkpoint, event.final.checkpoint, (text) => report.redact(text)) };
    }
    if (event.kind === 'action') {
      const { output: _output, error, ...rest } = event;
      return { ...rest, ...(error === undefined ? {} : { error: report.describe(error) }),
        ...(artifacts.has(event.executionId) ? { captured: artifacts.get(event.executionId) } : {}) };
    }
    if (event.kind === 'claim') {
      const { error, ...rest } = event;
      return { ...rest, ...(error === undefined ? {} : { error: report.describe(error) }), evidence: report.evidenceForClaim(event.claimId) };
    }
    if ('error' in event) { return { ...event, error: report.describe(event.error) }; }
    return event;
  });
}
