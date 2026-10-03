import type { CapsuleReportSpan } from '../../reporting/telemetry-types.js';

export const TRACE = 'abcdefabcdefabcdefabcdefabcdef01';
/** The activity's context span, exported by the Capsule manager as the trace root. */
export const ACTIVITY_SPAN = 'ac71717171717171';

type Attribute = CapsuleReportSpan['attributes'][number];

interface SpanInput {
  readonly id: string;
  readonly parent: string | null;
  readonly start: string | null;
  readonly end: string | null;
  readonly name: string;
  readonly service: string;
  readonly statusCode: number | null;
  readonly attributes: Record<string, Attribute['value']>;
  readonly traceId: string;
}

/** A projected span; every field but `id` has a plain default. */
export function span(input: Pick<SpanInput, 'id'> & Partial<SpanInput>): CapsuleReportSpan {
  return {
    traceId: input.traceId ?? TRACE,
    spanId: input.id,
    parentSpanId: input.parent ?? null,
    spanKind: 'internal',
    operation: input.name ?? `op-${input.id}`,
    service: input.service ?? 'svc',
    startTimeUnixNano: input.start === undefined ? '1000' : input.start,
    endTimeUnixNano: input.end ?? null,
    statusCode: input.statusCode ?? null,
    statusMessage: null,
    exceptions: [],
    attributes: Object.entries(input.attributes ?? {}).map(([key, value]) => ({ key, value })),
    links: [],
  };
}

/** A compact, readable shape of a tree: `id` or `id!mark` with nested children. */
export type Shape = readonly (string | readonly [string, Shape])[];

export function shape(
  nodes: readonly {
    readonly span: CapsuleReportSpan;
    readonly orphan: string | null;
    readonly children: readonly unknown[];
  }[],
): Shape {
  return nodes.map((node) => {
    const label = node.orphan === null ? node.span.spanId : `${node.span.spanId}!${node.orphan}`;
    const children = node.children as typeof nodes;
    return children.length === 0 ? label : ([label, shape(children)] as const);
  });
}
