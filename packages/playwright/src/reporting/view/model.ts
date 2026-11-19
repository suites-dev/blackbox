import type { TestCase, TestResult } from '@playwright/test/reporter';

import { digestBytes } from '../../envelope/index.js';
import { reportText } from '../text.js';
import type { ArtifactView, AttemptView, EffectsView, ExecutionView, Json, StepView } from './types.js';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function items(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : []; }
function str(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function json(value: unknown): Json | null { return value === undefined ? null : value as Json; }

function parseAttachment(body: Buffer, name: string, problems: string[]): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body.toString('utf8'));
    const parsed = record(value);
    if (parsed !== null) { return parsed; }
  } catch { /* The diagnostic below is deliberately stable and does not leak attachment content. */ }
  problems.push(`${name} is not a JSON object`);
  return null;
}

interface ParsedAttachment { readonly name: string; readonly body: Buffer; readonly data: Record<string, unknown> }

function step(event: Record<string, unknown>): StepView {
  return {
    kind: str(event.kind) ?? 'unknown',
    title: str(event.title) ?? str(event.phase) ?? str(event.kind) ?? 'Unknown step',
    status: str(event.status) ?? 'recorded',
    error: str(event.error),
    evidence: items(event.evidence).filter((value): value is string => typeof value === 'string'),
    snapshots: json(event.snapshots),
  };
}

function effectGraph(data: Record<string, unknown>): Record<string, unknown> | null {
  return record(data.graph);
}

function effectsFor(
  executionId: string,
  artifact: Record<string, unknown> | null,
  byDigest: ReadonlyMap<string, ParsedAttachment>,
  problems: string[],
): EffectsView {
  const digest = artifact === null ? null : str(artifact.effects);
  const captures = artifact === null ? [] : items(artifact.effectCaptures).map(json).filter((value): value is Json => value !== null);
  if (digest === null) {
    return { status: 'missing', digest: null, coverage: null, effects: [], relations: [], omitted: null, captures };
  }
  const match = byDigest.get(digest);
  if (match === undefined || match.name !== 'effects.json') {
    problems.push(`Effects artifact ${digest} is unavailable`);
    return { status: 'unavailable', digest, coverage: null, effects: [], relations: [], omitted: null, captures };
  }
  const graph = effectGraph(match.data);
  if (match.data.kind !== 'stimulus-effects' || match.data.executionId !== executionId ||
    graph === null || !Array.isArray(graph.effects) || !Array.isArray(graph.relations) ||
    record(match.data.coverage) === null) {
    problems.push(`Effects artifact ${digest} has an unsupported shape`);
    return { status: 'unavailable', digest, coverage: null, effects: [], relations: [], omitted: null, captures };
  }
  return {
    status: 'captured', digest, coverage: json(match.data.coverage),
    effects: items(graph.effects).map(json),
    relations: items(graph.relations).map(json),
    omitted: json(match.data.omitted), captures,
  };
}

function buildExecutions(
  documents: readonly ParsedAttachment[],
  byDigest: ReadonlyMap<string, ParsedAttachment>,
  problems: string[],
): ExecutionView[] {
  const executions: ExecutionView[] = [];
  for (const { data } of documents) {
    if (data.kind !== 'stimulus-executions' || data.schemaVersion !== 1 || !Array.isArray(data.events)) {
      problems.push('blackbox-execution has an unsupported shape');
      continue;
    }
    const events = data.events.map(record).filter((value): value is Record<string, unknown> => value !== null);
    if (events.length !== data.events.length) { problems.push('blackbox-execution has malformed events'); }
    const artifacts = items(data.artifacts).map(record).filter((value): value is Record<string, unknown> => value !== null);
    const ids = [...new Set(events.map((event) => str(event.executionId)).filter((id): id is string => id !== null))];
    for (const executionId of ids) {
      const ownEvents = events.filter((event) => event.executionId === executionId);
      const begin = ownEvents.find((event) => event.kind === 'begin');
      const final = ownEvents.find((event) => event.kind === 'final');
      const artifact = artifacts.find((item) => item.executionId === executionId) ?? null;
      const ranked = ownEvents.filter((event) => event.kind !== 'begin').map((event, index) => ({ event, index }));
      const rank = (kind: unknown): number => kind === 'precondition' ? 0 : kind === 'action' ? 1 : kind === 'final' ? 2 : kind === 'claim' ? 3 : 4;
      ranked.sort((left, right) => rank(left.event.kind) - rank(right.event.kind) || left.index - right.index);
      const captureFailures = ownEvents.filter((event) => event.kind === 'capture-failure').map(step);
      executions.push({
        executionId, title: begin === undefined ? 'Unnamed stimulus' : str(begin.title) ?? 'Unnamed stimulus',
        steps: ranked.map(({ event }) => step(event)),
        output: artifact === null ? null : json(artifact.output),
        initial: begin === undefined ? null : json(begin.initial),
        final: final === undefined ? null : json(final.final),
        diff: final === undefined ? null : json(final.diff),
        effects: effectsFor(executionId, artifact, byDigest, problems), captureFailures,
      });
    }
  }
  return executions;
}

type Attachment = TestResult['attachments'][number];

function artifactOf(attachment: Attachment): ArtifactView {
  const { body, path } = attachment;
  return { name: attachment.name, contentType: attachment.contentType,
    bytes: body === undefined ? null : body.byteLength,
    digest: body === undefined ? null : digestBytes(body),
    source: body === undefined ? path === undefined ? 'missing' : 'path' : 'body', path: path ?? null };
}

function parsedOf(attachment: Attachment, problems: string[]): ParsedAttachment | null {
  if (attachment.name !== 'blackbox-execution' && attachment.name !== 'effects.json' && attachment.name !== 'blackbox-capture-health') { return null; }
  if (attachment.body === undefined) {
    if (attachment.name !== 'effects.json') { problems.push(`${attachment.name} is not available as attachment bytes`); }
    return null;
  }
  const data = parseAttachment(attachment.body, attachment.name, problems);
  return data === null ? null : { name: attachment.name, body: attachment.body, data };
}

function collectAttachments(result: TestResult, problems: string[]) {
  const parsed: ParsedAttachment[] = [];
  const artifacts: ArtifactView[] = [];
  const byDigest = new Map<string, ParsedAttachment>();
  for (const attachment of result.attachments) {
    if (!attachment.name.startsWith('blackbox-') && attachment.name !== 'effects.json') { continue; }
    const artifact = artifactOf(attachment);
    artifacts.push(artifact);
    const entry = parsedOf(attachment, problems);
    if (entry === null) { continue; }
    parsed.push(entry);
    if (artifact.digest !== null) { byDigest.set(artifact.digest, entry); }
  }
  return { parsed, artifacts, byDigest };
}

function captureHealthOf(parsed: readonly ParsedAttachment[], executions: readonly ExecutionView[], problems: string[]): AttemptView['evidence']['captureHealth'] {
  const health = parsed.filter(({ name }) => name === 'blackbox-capture-health').at(-1);
  if (health === undefined) {
    if (executions.length > 0) { problems.push('No blackbox-capture-health attachment was retained'); }
    return { status: 'unavailable', record: null };
  }
  const status = health.data.status;
  if (health.data.schemaVersion !== 1 || health.data.kind !== 'capture-health' ||
    (status !== 'captured' && status !== 'failed' && status !== 'not-configured')) {
    problems.push('blackbox-capture-health has an unsupported shape');
    return { status: 'unavailable', record: json(health.data) };
  }
  if (status === 'failed') { problems.push('Blackbox capture health reports a failed operation'); }
  return { status, record: json(health.data) };
}

function verificationOf(executions: readonly ExecutionView[], problems: readonly string[]): AttemptView['verification'] {
  const claims = executions.flatMap(({ steps }) => steps.filter(({ kind }) => kind === 'claim'));
  const counts = {
    passed: claims.filter(({ status }) => status === 'passed').length,
    failed: claims.filter(({ status }) => status === 'failed').length,
    inconclusive: claims.filter(({ status }) => status === 'inconclusive').length,
    interrupted: claims.filter(({ status }) => status === 'interrupted').length,
  };
  const status = problems.length > 0 || executions.length === 0 ? 'unavailable'
    : counts.failed > 0 ? 'failed' : counts.inconclusive > 0 || counts.interrupted > 0 ? 'inconclusive'
      : counts.passed > 0 ? 'verified' : 'not-evaluated';
  return { status, ...counts };
}

/** Adapt the exact Playwright attempt attachments; never infer a claim from an unasserted observation. */
export function buildAttemptView(test: TestCase, result: TestResult): AttemptView {
  const problems: string[] = [];
  const { parsed, artifacts, byDigest } = collectAttachments(result, problems);
  const executions = buildExecutions(parsed.filter(({ name }) => name === 'blackbox-execution'), byDigest, problems);
  if (!artifacts.some(({ name }) => name === 'blackbox-execution')) {
    problems.push('No blackbox-execution attachment was retained');
  }
  const captureHealth = captureHealthOf(parsed, executions, problems);
  const location = test.location;
  const project = test.parent.project();
  const errors = result.errors.map((error) => reportText(error.message ?? error.value ?? 'Unknown Playwright error'));
  return {
    schemaVersion: 1, kind: 'blackbox-attempt-view',
    test: { id: test.id, titlePath: test.titlePath(), project: project === undefined ? null : project.name,
      file: location.file, line: location.line },
    attempt: { retry: result.retry, workerIndex: result.workerIndex, parallelIndex: result.parallelIndex,
      nativeStatus: result.status, expectedStatus: test.expectedStatus, durationMs: result.duration, errors },
    verification: verificationOf(executions, problems),
    evidence: { status: executions.length === 0 ? 'unavailable' : problems.length === 0 ? 'available' : 'partial',
      problems, artifacts, captureHealth }, executions,
  };
}
