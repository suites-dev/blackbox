import { readFile } from 'node:fs/promises';

import type { BehaviorHistory } from './history.js';

export interface IngestSummary {
  readonly attempts: number;
  readonly envelopes: number;
  readonly newEnvelopes: number;
  readonly receipts: number;
  readonly newReceipts: number;
  readonly snapshots: number;
  readonly assertionBodies: number;
  readonly withoutEnvelope: number;
  readonly rejected: readonly string[];
}

interface Attachment {
  readonly name: string;
  readonly body: Buffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The attachments of every result in a Playwright JSON report; each keeps its exact bytes. */
function* attempts(suites: readonly unknown[]): Generator<readonly Attachment[]> {
  for (const suite of suites.filter(isRecord)) {
    for (const spec of list(suite.specs).filter(isRecord)) {
      for (const test of list(spec.tests).filter(isRecord)) {
        for (const result of list(test.results).filter(isRecord)) {
          yield list(result.attachments)
            .filter(isRecord)
            .flatMap((item) =>
              typeof item.name === 'string' && typeof item.body === 'string'
                ? [{ name: item.name, body: Buffer.from(item.body, 'base64') }]
                : [],
            );
        }
      }
    }
    yield* attempts(list(suite.suites));
  }
}

const last = (attachments: readonly Attachment[], name: string): Attachment | null =>
  attachments.filter((item) => item.name === name).at(-1) ?? null;

const failure = (kind: string, error: unknown): string =>
  `${kind}: ${error instanceof Error ? error.message : String(error)}`;

/**
 * Reads a Playwright JSON results file and stores what each attempt produced: its envelope, final snapshot,
 * assertion evidence bodies and receipt. Anything that fails verification is reported and left out; nothing is
 * repaired. The bodies are the exact bytes Playwright attached, because the envelope's digests cover those bytes.
 */
export async function ingestPlaywrightResults(
  history: BehaviorHistory,
  resultsPath: string,
): Promise<IngestSummary> {
  const document: unknown = JSON.parse(await readFile(resultsPath, 'utf8'));
  const tally = {
    attempts: 0,
    envelopes: 0,
    newEnvelopes: 0,
    receipts: 0,
    newReceipts: 0,
    snapshots: 0,
    assertionBodies: 0,
    withoutEnvelope: 0,
  };
  const rejected: string[] = [];
  for (const attachments of attempts(isRecord(document) ? list(document.suites) : [])) {
    tally.attempts += 1;
    for (const body of attachments.filter(({ name }) => name === 'blackbox-effects')) {
      await history.ingestBlob(body.body);
      tally.assertionBodies += 1;
    }
    const envelope = last(attachments, 'blackbox-envelope');
    const snapshot = last(attachments, 'blackbox-effects-final');
    if (envelope === null) {
      tally.withoutEnvelope += 1;
    } else {
      try {
        const stored = await history.ingestEnvelope(
          JSON.parse(envelope.body.toString('utf8')),
          snapshot === null ? null : snapshot.body.toString('utf8'),
        );
        tally.envelopes += 1;
        tally.newEnvelopes += stored.created ? 1 : 0;
        tally.snapshots += snapshot === null ? 0 : 1;
      } catch (error) {
        rejected.push(failure('envelope', error));
      }
    }
    for (const receipt of attachments.filter(({ name }) => name === 'blackbox-receipt')) {
      try {
        const stored = await history.ingestReceipt(JSON.parse(receipt.body.toString('utf8')));
        tally.receipts += 1;
        tally.newReceipts += stored.created ? 1 : 0;
      } catch (error) {
        rejected.push(failure('receipt', error));
      }
    }
  }
  return { ...tally, rejected };
}
