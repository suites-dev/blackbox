export type EffectScalar = string | number | boolean;
export type EffectKind = 'http' | 'rpc' | 'db' | 'cache' | 'message' | 'business' | 'internal';

interface BaseEffectSelectorFields {
  readonly operation: string;
  readonly target: string;
  readonly actor: string;
  readonly outcome: string;
  readonly where: Readonly<Record<string, EffectScalar>>;
}

export type EffectSelectorFields = Readonly<Partial<BaseEffectSelectorFields>>;
export type HttpEffectSelectorFields = Readonly<
  Partial<BaseEffectSelectorFields & { readonly method: string; readonly route: string }>
>;
export type RpcEffectSelectorFields = Readonly<
  Partial<BaseEffectSelectorFields & { readonly service: string }>
>;
export type DatabaseEffectSelectorFields = Readonly<
  Partial<BaseEffectSelectorFields & { readonly table: string }>
>;
export type CacheEffectSelectorFields = Readonly<
  Partial<BaseEffectSelectorFields & { readonly keyspace: string }>
>;
export type MessageEffectSelectorFields = Readonly<
  Partial<BaseEffectSelectorFields & { readonly destination: string }>
>;

export type EffectSelector = Readonly<
  { readonly node: 'selector' } & Partial<{ readonly kind: EffectKind } & BaseEffectSelectorFields>
>;

export type EffectCountOperator = 'exactly' | 'atLeast' | 'atMost';

export interface EffectCountConstraint {
  readonly node: 'constraint';
  readonly operator: EffectCountOperator;
  readonly count: number;
  readonly selector: EffectSelector;
}

export interface EffectOrderConstraint {
  readonly node: 'constraint';
  readonly operator: 'before';
  readonly first: EffectSelector;
  readonly second: EffectSelector;
}

export type EffectConstraint = EffectCountConstraint | EffectOrderConstraint;

export interface EffectContract {
  readonly schemaVersion: 1;
  readonly constraints: readonly EffectConstraint[];
}

export interface EffectContractBuilderApi {
  http(fields?: HttpEffectSelectorFields): EffectSelector;
  rpc(fields?: RpcEffectSelectorFields): EffectSelector;
  db(fields?: DatabaseEffectSelectorFields): EffectSelector;
  cache(fields?: CacheEffectSelectorFields): EffectSelector;
  message(fields?: MessageEffectSelectorFields): EffectSelector;
  business(fields?: EffectSelectorFields): EffectSelector;
  internal(fields?: EffectSelectorFields): EffectSelector;
  span(fields?: EffectSelectorFields): EffectSelector;
  exists(selector: EffectSelector): EffectCountConstraint;
  absent(selector: EffectSelector): EffectCountConstraint;
  exactly(count: number, selector: EffectSelector): EffectCountConstraint;
  atLeast(count: number, selector: EffectSelector): EffectCountConstraint;
  atMost(count: number, selector: EffectSelector): EffectCountConstraint;
  before(first: EffectSelector, second: EffectSelector): EffectOrderConstraint;
  after(second: EffectSelector, first: EffectSelector): EffectOrderConstraint;
}

export type EffectContractBuilder = (
  effects: EffectContractBuilderApi,
) => readonly EffectConstraint[];

const aliases = {
  http: { method: 'operation', route: 'target' },
  rpc: { service: 'target' },
  db: { table: 'target' },
  cache: { keyspace: 'target' },
  message: { destination: 'target' },
  business: {},
  internal: {},
} as const;

const selectorFields = new Set('node kind operation target actor outcome where'.split(' '));
const countConstraintFields = new Set(['node', 'operator', 'count', 'selector']);
const orderConstraintFields = new Set(['node', 'operator', 'first', 'second']);

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) {
      freeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function assertText(field: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function snapshotRecord(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(message);
  }
  return Object.fromEntries(Object.entries(value));
}

function snapshotWhere(value: unknown): Readonly<Record<string, EffectScalar>> {
  const source = snapshotRecord(value, 'where must contain finite JSON scalar values');
  const entries: [string, EffectScalar][] = [];
  for (const [field, scalar] of Object.entries(source)) {
    if (typeof scalar === 'string' || typeof scalar === 'boolean') {
      entries.push([field, scalar]);
    } else if (typeof scalar === 'number' && Number.isFinite(scalar)) {
      entries.push([field, scalar]);
    } else {
      throw new TypeError('where must contain finite JSON scalar values');
    }
  }
  return Object.fromEntries(entries);
}

function assertKnownFields(
  context: string,
  record: Readonly<Record<string, unknown>>,
  supported: ReadonlySet<string>,
): void {
  const unknownField = Object.keys(record).find((field) => !supported.has(field));
  if (unknownField !== undefined) {
    throw new TypeError(`Unknown ${context} field: ${unknownField}`);
  }
}

function assertCount(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Effect count must be a nonnegative safe integer');
  }
}

function selector(kind: EffectKind | undefined, input: unknown = {}): EffectSelector {
  const inputRecord = snapshotRecord(input, 'Effect selector must be an object');
  const kindAliases: Readonly<Record<string, string>> = kind === undefined ? {} : aliases[kind];
  const canonicalFields: Record<string, unknown> = {};
  const supported = new Set(['operation', 'target', 'actor', 'outcome', 'where']);
  for (const [field, value] of Object.entries(inputRecord)) {
    const canonical = kindAliases[field] ?? field;
    if (!supported.has(canonical)) {
      throw new TypeError(`Unknown selector field: ${field}`);
    }
    if (
      canonical !== field &&
      Object.hasOwn(inputRecord, canonical) &&
      inputRecord[canonical] !== value
    ) {
      throw new TypeError(`Conflicting selector fields: ${field} and ${canonical}`);
    }
    canonicalFields[canonical] = value;
  }
  for (const [field, value] of Object.entries(canonicalFields)) {
    if (field === 'where') {
      canonicalFields[field] = snapshotWhere(value);
    } else {
      assertText(field, value);
    }
  }
  const selected: EffectSelector =
    kind === undefined
      ? { node: 'selector', ...canonicalFields }
      : { node: 'selector', kind, ...canonicalFields };
  return freeze(selected);
}

function count(
  operator: EffectCountOperator,
  value: number,
  selected: unknown,
): EffectCountConstraint {
  assertCount(value);
  const normalized = normalizeSelector(selected, `${operator}.selector`);
  return freeze({ node: 'constraint', operator, count: value, selector: normalized });
}

function before(first: unknown, second: unknown): EffectOrderConstraint {
  return freeze({
    node: 'constraint',
    operator: 'before',
    first: normalizeSelector(first, 'before.first'),
    second: normalizeSelector(second, 'before.second'),
  });
}

function normalizeSelector(value: unknown, context: string): EffectSelector {
  const record = snapshotRecord(value, `${context} must be an effect selector`);
  if (record.node !== 'selector') {
    throw new TypeError(`${context} must be an effect selector`);
  }
  assertKnownFields('effect selector', record, selectorFields);
  const normalized: Record<string, unknown> = Object.fromEntries([['node', 'selector']]);
  if (Object.hasOwn(record, 'kind')) {
    if (typeof record.kind !== 'string' || !Object.hasOwn(aliases, record.kind)) {
      throw new TypeError(`${context}.kind must be a supported effect kind`);
    }
    normalized.kind = record.kind;
  }
  for (const field of ['operation', 'target', 'actor', 'outcome']) {
    if (Object.hasOwn(record, field)) {
      assertText(`${context}.${field}`, record[field]);
      normalized[field] = record[field];
    }
  }
  if (Object.hasOwn(record, 'where')) {
    normalized.where = snapshotWhere(record.where);
  }
  return normalized as EffectSelector;
}

function normalizeConstraint(value: unknown): EffectConstraint {
  const message = 'The effects callback must return constraints, not selectors';
  const record = snapshotRecord(value, message);
  if (record.node !== 'constraint') {
    throw new TypeError(message);
  }
  if (typeof record.operator !== 'string') {
    throw new TypeError('Effect constraint operator must be exactly, atLeast, atMost, or before');
  }
  if (['exactly', 'atLeast', 'atMost'].includes(record.operator)) {
    assertKnownFields('effect count constraint', record, countConstraintFields);
    assertCount(record.count);
    return count(record.operator as EffectCountOperator, record.count, record.selector);
  }
  if (record.operator === 'before') {
    assertKnownFields('effect order constraint', record, orderConstraintFields);
    return before(record.first, record.second);
  }
  throw new TypeError('Effect constraint operator must be exactly, atLeast, atMost, or before');
}

export const effectContractBuilder = freeze({
  http: (fields?: HttpEffectSelectorFields) => selector('http', fields),
  rpc: (fields?: RpcEffectSelectorFields) => selector('rpc', fields),
  db: (fields?: DatabaseEffectSelectorFields) => selector('db', fields),
  cache: (fields?: CacheEffectSelectorFields) => selector('cache', fields),
  message: (fields?: MessageEffectSelectorFields) => selector('message', fields),
  business: (fields?: EffectSelectorFields) => selector('business', fields),
  internal: (fields?: EffectSelectorFields) => selector('internal', fields),
  span: (fields?: EffectSelectorFields) => selector(undefined, fields),
  exists: (selected: EffectSelector) => count('atLeast', 1, selected),
  absent: (selected: EffectSelector) => count('exactly', 0, selected),
  exactly: (value: number, selected: EffectSelector) => count('exactly', value, selected),
  atLeast: (value: number, selected: EffectSelector) => count('atLeast', value, selected),
  atMost: (value: number, selected: EffectSelector) => count('atMost', value, selected),
  before,
  after: (second: EffectSelector, first: EffectSelector) => before(first, second),
}) satisfies EffectContractBuilderApi;

export function compileEffectContract(builder: EffectContractBuilder): EffectContract {
  if (typeof builder !== 'function') {
    throw new TypeError('Use toSatisfy((effects) => [...])');
  }
  const candidate: unknown = builder(effectContractBuilder);
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new TypeError('The effects callback must return a non-empty constraint array');
  }
  const constraints = Array.from(candidate, (constraint, index) =>
    normalizeConstraint(Object.hasOwn(candidate, index) ? constraint : undefined),
  );
  return freeze({ schemaVersion: 1, constraints });
}
