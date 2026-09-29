import { canonicalDigest, sha256Label } from '../canonical/digest.js';
import type { InputDigest, SpanKindName } from '../model/effect-set.js';
import { InvalidEffectInputError } from '../model/errors.js';
import type { EffectSource, OtlpJsonFragment } from '../model/input.js';
import {
  type Attribute,
  decodeAttributes,
  isRecord,
  optionalArray,
  optionalRecord,
  requireRecord,
  stringAttribute,
} from './otlp-values.js';

/** OpenTelemetry's resource default when a process sets no `service.name`. */
export const UNKNOWN_SERVICE = 'unknown_service';

/** One span as delivered in one fragment. */
export interface SpanRow {
  readonly sequence: number;
  readonly service: string;
  readonly scope: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly kind: SpanKindName;
  readonly name: string;
  readonly attributes: readonly Attribute[];
  /** Digest of the delivered content, used only to detect conflicting duplicates. */
  readonly content: string;
}

const SPAN_KINDS = [
  'unspecified',
  'internal',
  'server',
  'client',
  'producer',
  'consumer',
] as const satisfies readonly SpanKindName[];

function hexId(value: unknown, length: number, path: string): string {
  if (typeof value !== 'string' || !new RegExp(`^[\\da-f]{${length}}$`, 'iu').test(value)) {
    throw new InvalidEffectInputError(`${path} must be ${length} hexadecimal characters.`);
  }
  return value.toLowerCase();
}

function spanKind(value: unknown, path: string): SpanKindName {
  if (value === undefined || value === null) {
    return 'unspecified';
  }
  const index = typeof value === 'string' ? SPAN_KINDS.indexOf(spanKindName(value)) : Number(value);
  const kind = Number.isInteger(index) ? SPAN_KINDS[index] : undefined;
  if (kind === undefined) {
    throw new InvalidEffectInputError(`${path}.kind is not an OTLP span kind.`);
  }
  return kind;
}

function spanKindName(value: string): SpanKindName {
  return value.replace(/^SPAN_KIND_/u, '').toLowerCase() as SpanKindName;
}

function events(value: unknown, path: string): unknown {
  return optionalArray(value, path).map((event, index) => {
    const item = requireRecord(event, `${path}[${index}]`);
    return {
      name: typeof item.name === 'string' ? item.name : '',
      time: typeof item.timeUnixNano === 'string' ? item.timeUnixNano : String(item.timeUnixNano),
      attributes: decodeAttributes(item.attributes, `${path}[${index}].attributes`),
    };
  });
}

function spanRow(input: {
  readonly span: unknown;
  readonly path: string;
  readonly sequence: number;
  readonly resource: readonly Attribute[];
  readonly scope: string;
  readonly scopeVersion: unknown;
}): SpanRow {
  const { span, path } = input;
  if (!isRecord(span) || typeof span.name !== 'string') {
    throw new InvalidEffectInputError(`${path} must be a span with a string name.`);
  }
  const parent = span.parentSpanId;
  const row = {
    sequence: input.sequence,
    service: stringAttribute(input.resource, 'service.name') ?? UNKNOWN_SERVICE,
    scope: input.scope,
    traceId: hexId(span.traceId, 32, `${path}.traceId`),
    spanId: hexId(span.spanId, 16, `${path}.spanId`),
    parentSpanId:
      parent === undefined || parent === null || parent === ''
        ? null
        : hexId(parent, 16, `${path}.parentSpanId`),
    kind: spanKind(span.kind, path),
    name: span.name,
    attributes: decodeAttributes(span.attributes, `${path}.attributes`),
  };
  const content = canonicalDigest({
    ...row,
    sequence: null,
    resource: input.resource,
    scopeVersion: typeof input.scopeVersion === 'string' ? input.scopeVersion : null,
    start: String(span.startTimeUnixNano),
    end: String(span.endTimeUnixNano),
    status: isRecord(span.status)
      ? { code: String(span.status.code), message: String(span.status.message) }
      : null,
    events: events(span.events, `${path}.events`),
    links: optionalArray(span.links, `${path}.links`).map((link, index) => {
      const item = requireRecord(link, `${path}.links[${index}]`);
      return {
        traceId: hexId(item.traceId, 32, `${path}.links[${index}].traceId`),
        spanId: hexId(item.spanId, 16, `${path}.links[${index}].spanId`),
      };
    }),
  });
  return { ...row, content };
}

function fragmentRows(fragment: OtlpJsonFragment): readonly SpanRow[] {
  const path = `fragment ${fragment.sequence}`;
  let request: unknown;
  try {
    request = JSON.parse(fragment.rawJson) as unknown;
  } catch {
    throw new InvalidEffectInputError(`${path} is not valid JSON.`);
  }
  if (!isRecord(request)) {
    throw new InvalidEffectInputError(`${path} must be an OTLP trace request object.`);
  }
  const rows: SpanRow[] = [];
  optionalArray(request.resourceSpans, `${path}.resourceSpans`).forEach((resourceSpan, r) => {
    const resourcePath = `${path}.resourceSpans[${r}]`;
    const record = requireRecord(resourceSpan, resourcePath);
    const resourceRecord = optionalRecord(record.resource, `${resourcePath}.resource`);
    const resource = decodeAttributes(resourceRecord.attributes, `${resourcePath}.resource`);
    optionalArray(record.scopeSpans, `${resourcePath}.scopeSpans`).forEach((scopeSpans, s) => {
      const scopePath = `${resourcePath}.scopeSpans[${s}]`;
      const scopeRecord = requireRecord(scopeSpans, scopePath);
      const scope = optionalRecord(scopeRecord.scope, `${scopePath}.scope`);
      optionalArray(scopeRecord.spans, `${scopePath}.spans`).forEach((span, index) => {
        rows.push(
          spanRow({
            span,
            path: `${scopePath}.spans[${index}]`,
            sequence: fragment.sequence,
            resource,
            scope: typeof scope.name === 'string' ? scope.name : '',
            scopeVersion: scope.version,
          }),
        );
      });
    });
  });
  return rows;
}

function orderedFragments(sources: readonly EffectSource[]): readonly OtlpJsonFragment[] {
  const fragments = sources.flatMap((source) => source.fragments);
  const sequences = new Set<number>();
  for (const fragment of fragments) {
    if (!Number.isSafeInteger(fragment.sequence) || fragment.sequence < 1) {
      throw new InvalidEffectInputError('Fragment sequences must be positive integers.');
    }
    if (sequences.has(fragment.sequence)) {
      throw new InvalidEffectInputError(`Fragment sequence ${fragment.sequence} is duplicated.`);
    }
    sequences.add(fragment.sequence);
  }
  return [...fragments].sort((left, right) => left.sequence - right.sequence);
}

/**
 * Flatten every `resourceSpans -> scopeSpans -> spans` entry into one row per
 * delivered span, in fragment sequence order, and digest each fragment's raw
 * text exactly as retained.
 */
export function extractRows(sources: readonly EffectSource[]): {
  readonly rows: readonly SpanRow[];
  readonly inputs: readonly InputDigest[];
} {
  const fragments = orderedFragments(sources);
  return {
    rows: fragments.flatMap(fragmentRows),
    inputs: fragments.map((fragment) => ({
      kind: 'otlp-json-fragment',
      sequence: fragment.sequence,
      sha256: sha256Label(fragment.rawJson),
    })),
  };
}
