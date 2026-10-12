import { array, record } from './values.js';

// OTLP trace message fields, pinned to opentelemetry-proto
// b3f75588eb23c5fca62264edd05d382de49beb1a. See README's standards profile.
// This projection reader drops unknown fields and null (unset) values. It is
// not a general-purpose Protobuf validator for scalar fields it does not use.
const messageDefinitions = {
  ExportTraceServiceRequest: { resourceSpans: 'ResourceSpans[]' },
  ResourceSpans: { resource: 'Resource', scopeSpans: 'ScopeSpans[]', schemaUrl: 'value' },
  Resource: {
    attributes: 'KeyValue[]',
    droppedAttributesCount: 'value',
    entityRefs: 'EntityRef[]',
  },
  EntityRef: {
    schemaUrl: 'value',
    type: 'value',
    idKeys: 'value',
    descriptionKeys: 'value',
  },
  ScopeSpans: { scope: 'InstrumentationScope', spans: 'Span[]', schemaUrl: 'value' },
  InstrumentationScope: {
    name: 'value',
    version: 'value',
    attributes: 'KeyValue[]',
    droppedAttributesCount: 'value',
  },
  Span: {
    traceId: 'value',
    spanId: 'value',
    traceState: 'value',
    parentSpanId: 'value',
    flags: 'value',
    name: 'value',
    kind: 'enum',
    startTimeUnixNano: 'value',
    endTimeUnixNano: 'value',
    attributes: 'KeyValue[]',
    droppedAttributesCount: 'value',
    events: 'Event[]',
    droppedEventsCount: 'value',
    links: 'Link[]',
    droppedLinksCount: 'value',
    status: 'Status',
  },
  Event: {
    timeUnixNano: 'value',
    name: 'value',
    attributes: 'KeyValue[]',
    droppedAttributesCount: 'value',
  },
  Link: {
    traceId: 'value',
    spanId: 'value',
    traceState: 'value',
    attributes: 'KeyValue[]',
    droppedAttributesCount: 'value',
    flags: 'value',
  },
  Status: { message: 'value', code: 'enum' },
  KeyValue: { key: 'value', value: 'AnyValue' },
  AnyValue: {
    stringValue: 'value',
    boolValue: 'value',
    intValue: 'value',
    doubleValue: 'value',
    arrayValue: 'ArrayValue',
    kvlistValue: 'KeyValueList',
    bytesValue: 'value',
  },
  ArrayValue: { values: 'AnyValue[]' },
  KeyValueList: { values: 'KeyValue[]' },
} satisfies Readonly<Record<string, Readonly<Record<string, string>>>>;
const messages: Readonly<Record<string, Readonly<Record<string, string>>>> = messageDefinitions;

function field(value: unknown, type: string, location: string): unknown {
  if (type === 'value') {
    return value;
  }
  if (type === 'enum') {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < -2147483648 ||
      value > 2147483647
    ) {
      throw new TypeError(`Expected numeric OTLP enum at ${location}`);
    }
    return value;
  }
  if (type.endsWith('[]')) {
    return array(value, location).map((item) => message(item, type.slice(0, -2)));
  }
  return message(value, type);
}

function message(input: unknown, name: string): Readonly<Record<string, unknown>> {
  const source = record(input, name);
  const fields = messages[name];
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key, value]) => Object.hasOwn(fields, key) && value !== null)
      .map(([key, value]) => [key, field(value, fields[key], `${name}.${key}`)]),
  );
}

export function traceRequest(input: unknown): Readonly<Record<string, unknown>> {
  return message(input, 'ExportTraceServiceRequest');
}
