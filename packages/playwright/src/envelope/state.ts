import { digestOf, type Digest } from './canonical.js';
import type { StateRecord, StateSection } from './types.js';

export const stateAnnotation = 'bb:state';

const subjectName = /^[a-z][a-z0-9.-]{0,63}$/u;
const limits = { source: 128, identities: 1000, identity: 256 };

export function stateRecordDigest(record: {
  readonly subject: string;
  readonly identities: readonly Digest[];
  readonly count: number;
}): Digest {
  return digestOf({ subject: record.subject, identities: record.identities, count: record.count });
}

function parse(description: string): StateRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(description);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const subject: unknown = 'subject' in value ? value.subject : undefined;
  const source: unknown = 'source' in value ? value.source : undefined;
  const identities: unknown = 'identities' in value ? value.identities : undefined;
  if (
    typeof subject !== 'string' ||
    !subjectName.test(subject) ||
    typeof source !== 'string' ||
    source.length > limits.source ||
    !Array.isArray(identities) ||
    identities.length > limits.identities ||
    !identities.every((id) => typeof id === 'string' && id.length <= limits.identity)
  ) {
    return null;
  }
  const hashed: Digest[] = [
    ...new Set((identities as string[]).map((id) => digestOf({ subject, id }))),
  ].sort();
  return {
    subject,
    source,
    count: identities.length,
    distinct: hashed.length,
    identities: hashed,
    digest: stateRecordDigest({ subject, identities: hashed, count: identities.length }),
  };
}

/**
 * Authoritative state is reported by the test, as `bb:state` annotations whose description is JSON
 * `{subject, source, identities}`. Identities are reduced to digests; the first record per subject wins and
 * anything malformed or repeated is counted, never guessed at.
 */
export function stateSection(
  annotations: readonly { type: string; description: string }[],
): StateSection {
  const records = new Map<string, StateRecord>();
  let rejected = 0;
  for (const annotation of annotations.filter(({ type }) => type === stateAnnotation)) {
    const record = parse(annotation.description);
    if (record === null || records.has(record.subject)) {
      rejected++;
    } else {
      records.set(record.subject, record);
    }
  }
  return {
    records: [...records.values()].sort((a, b) => (a.subject < b.subject ? -1 : 1)),
    rejected,
  };
}
