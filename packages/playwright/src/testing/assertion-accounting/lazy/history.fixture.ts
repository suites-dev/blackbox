import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { JSONReportSpec } from '@playwright/test/reporter';
import type { EffectCaptureIdentity, EffectGraph } from '@suites/blackbox-effects';
import { BehaviorHistory } from '../../../history/history.js';
import { ingestPlaywrightResults } from '../../../history/ingestion/playwright-results.js';
import { ObjectStore } from '../../../history/storage/store.js';
import { digestBytes, type Digest } from '../../../envelope/index.js';
import type { AssertionAccounting } from '../../../assertions/types.js';

interface CaptureDocument {
  readonly kind: 'stimulus-effects'; readonly executionId: string;
  readonly identity: EffectCaptureIdentity; readonly graph: EffectGraph;
}
interface EmissionDocument {
  readonly captureReference: Digest;
  readonly assessment: { readonly identity: EffectCaptureIdentity };
  readonly assertion: { readonly outcome: 'passed' | 'failed' | 'inconclusive' };
  readonly witnesses: readonly { readonly source: readonly { readonly traceId: string; readonly spanId: string }[] }[];
}
interface ExecutionDocument {
  readonly events: readonly ({ readonly kind: string; readonly executionId: string } &
    Readonly<Partial<{ title: string; status: string; evidence: readonly Digest[] }>>)[];
  readonly artifacts: readonly { readonly executionId: string; readonly effects: Digest | null;
    readonly effectCaptures: readonly { readonly captureId: string; readonly reference: Digest; readonly purpose: string }[] }[];
}
export interface DelayedProof {
  readonly accounting: AssertionAccounting;
  readonly explicitCaptureId: string; readonly matcherCaptureIds: readonly string[];
  readonly activityIds: readonly string[]; readonly executionId: string; readonly traceId: string; readonly spanId: string;
  readonly exported: number; readonly status: number;
}
export interface IsolationProof {
  readonly firstCaptureIds: readonly string[]; readonly firstActivityIds: readonly string[];
  readonly traceIds: readonly string[]; readonly executionId: string; readonly exported: number; readonly foreignReads: number;
}
async function attachment(value: JSONReportSpec['tests'][number]['results'][number]['attachments'][number]) {
  let bytes: Buffer;
  if (value.body !== undefined) { bytes = Buffer.from(value.body, 'base64'); }
  else if (value.path !== undefined) { bytes = await readFile(value.path); }
  else { throw new Error('Attachment has no bytes or path'); }
  return { id: digestBytes(bytes), bytes, document: JSON.parse(bytes.toString('utf8')) as unknown };
}
async function documents(spec: JSONReportSpec) {
  const attachments = spec.tests[0].results[0].attachments;
  const execution = attachments.find(({ name }) => name === 'blackbox-execution');
  if (execution === undefined) { throw new Error('Missing native execution evidence'); }
  const executionValue = await attachment(execution);
  const captures = await Promise.all(attachments.filter(({ name }) => name === 'effects.json').map(attachment));
  const emissions = await Promise.all(attachments.filter(({ name }) => name === 'blackbox-emissions').map(attachment));
  return {
    execution: { ...executionValue, document: executionValue.document as ExecutionDocument },
    captures: captures.map((value) => ({ ...value, document: value.document as CaptureDocument })),
    emissions: emissions.map((value) => ({ ...value, document: value.document as EmissionDocument })),
  };
}
export async function reopenHistory(directory: string, expectedExecutions: number) {
  const root = join(directory, 'lazy-history');
  const history = await BehaviorHistory.open(root);
  expect(await ingestPlaywrightResults(history, join(directory, 'results.json'))).toMatchObject({ envelopes: expectedExecutions, rejected: [] });
  const reopened = await BehaviorHistory.open(root);
  expect((await reopened.index()).executions).toHaveLength(expectedExecutions);
  expect(await reopened.verifyStore()).toMatchObject({ corrupt: [], interruptedWrites: [] });
  return reopened;
}
async function checkStored(history: BehaviorHistory, spec: JSONReportSpec, values: Awaited<ReturnType<typeof documents>>) {
  const entries = (await history.index()).executions;
  const details = await Promise.all(entries.map(({ envelopeId }) => history.execution(envelopeId)));
  const detail = details.find((value) => value !== null && value.envelope.provenance.test.titlePath.includes(spec.title));
  if (detail === null || detail === undefined) { throw new Error('Missing reopened execution'); }
  expect(detail.finalStatus).toBe('passed');
  const store = new ObjectStore(history.root);
  for (const value of [values.execution, ...values.captures, ...values.emissions]) {
    expect(detail.evidence).toContainEqual(expect.objectContaining({ id: value.id, status: 'stored' }));
    const stored = await store.get('blob', value.id);
    if (stored === null) { throw new Error('Retained evidence blob is missing after reopening history'); }
    expect(stored).toEqual(value.bytes);
    expect(digestBytes(stored)).toBe(value.id);
  }
}
function linkedCut(values: Awaited<ReturnType<typeof documents>>, index: number, claimTitle: string) {
  const emission = values.emissions[index];
  expect(emission.document.captureReference).toMatch(/^sha256:[a-f0-9]{64}$/u);
  const cut = values.captures.find(({ id }) => id === emission.document.captureReference);
  if (cut === undefined) { throw new Error('Assertion does not reference a retained immutable cut'); }
  expect(cut.document.identity).toEqual(emission.document.assessment.identity);
  const claim = values.execution.document.events.find((event) => event.kind === 'claim' && event.title === claimTitle);
  if (claim === undefined || claim.evidence === undefined) { throw new Error('Missing execution-bound claim links'); }
  expect(claim).toMatchObject({ executionId: cut.document.executionId, status: emission.document.assertion.outcome });
  expect([...claim.evidence].sort()).toEqual([cut.id, emission.id].sort());
  const artifact = values.execution.document.artifacts.find(({ executionId }) => executionId === cut.document.executionId);
  if (artifact === undefined) { throw new Error('Missing stimulus artifact references'); }
  expect(artifact.effectCaptures).toContainEqual({ captureId: cut.document.identity.captureId, reference: cut.id, purpose: 'assertion' });
  const initial = values.captures.find(({ id }) => id === artifact.effects);
  if (initial === undefined) { throw new Error('Missing original stimulus cut'); }
  expect(initial.document.graph.effects).toEqual([]);
  expect(artifact.effectCaptures).toContainEqual({ captureId: initial.document.identity.captureId, reference: initial.id, purpose: 'initial' });
  return { cut, artifact, emission };
}
export async function checkDelayedHistory(history: BehaviorHistory, spec: JSONReportSpec, proof: DelayedProof) {
  const values = await documents(spec);
  expect(values.captures).toHaveLength(3);
  expect(values.emissions).toHaveLength(1);
  const { cut, artifact, emission } = linkedCut(values, 0, 'Then delayed payment telemetry is observed');
  expect(artifact.effectCaptures).toHaveLength(3);
  expect(emission.document.assertion.outcome).toBe('passed');
  expect(cut.document.identity).toMatchObject({ executionId: proof.executionId, activityIds: proof.activityIds, captureId: proof.matcherCaptureIds.at(-1) });
  expect(cut.document.graph.effects).toEqual([expect.objectContaining({ kind: 'http', operation: 'POST', target: '/payments', source: [{ traceId: proof.traceId, spanId: proof.spanId }] })]);
  const frozen = values.captures.find(({ document }) => document.identity.captureId === proof.explicitCaptureId);
  if (frozen === undefined) { throw new Error('Missing explicit frozen capture'); }
  expect(frozen.document.graph.effects).toEqual([]);
  expect(artifact.effectCaptures).toContainEqual({ captureId: proof.explicitCaptureId, reference: frozen.id, purpose: 'explicit' });
  const retainedIds = values.captures.map(({ document }) => document.identity.captureId);
  for (const id of proof.matcherCaptureIds.slice(0, -1)) { expect(retainedIds).not.toContain(id); }
  await checkStored(history, spec, values);
}
export async function checkIsolationHistory(history: BehaviorHistory, spec: JSONReportSpec, proof: IsolationProof) {
  const values = await documents(spec);
  expect(values.captures).toHaveLength(4);
  expect(values.emissions).toHaveLength(2);
  const first = linkedCut(values, 0, 'Then a different stimulus remains inconclusive');
  const second = linkedCut(values, 1, 'Then the second stimulus owns its emitted payment');
  expect(first.emission.document.assertion.outcome).toBe('inconclusive');
  expect(first.cut.document.identity).toMatchObject({ executionId: proof.executionId, activityIds: proof.firstActivityIds, captureId: proof.firstCaptureIds.at(-1) });
  expect(first.cut.document.graph.effects).toEqual([]);
  expect(second.emission.document.assertion.outcome).toBe('passed');
  expect(second.cut.document.graph.effects).toEqual([expect.objectContaining({ source: [expect.objectContaining({ traceId: proof.traceIds[1] })] })]);
  expect(first.cut.document.identity.activityIds).toHaveLength(1);
  expect(second.cut.document.identity.activityIds).toHaveLength(1);
  expect(first.cut.document.identity.activityIds).not.toEqual(second.cut.document.identity.activityIds);
  expect(first.cut.document.executionId).not.toBe(second.cut.document.executionId);
  const retainedIds = values.captures.map(({ document }) => document.identity.captureId);
  for (const id of proof.firstCaptureIds.slice(0, -1)) { expect(retainedIds).not.toContain(id); }
  await checkStored(history, spec, values);
}
