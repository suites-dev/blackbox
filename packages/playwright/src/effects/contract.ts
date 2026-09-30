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

function assertWhere(value: unknown): asserts value is Readonly<Record<string, EffectScalar>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('where must contain finite JSON scalar values');
  }
  for (const scalar of Object.values(value)) {
    if (
      !['string', 'number', 'boolean'].includes(typeof scalar) ||
      (typeof scalar === 'number' && !Number.isFinite(scalar))
    ) {
      throw new TypeError('where must contain finite JSON scalar values');
    }
  }
}

function selector(kind: EffectKind | undefined, input: unknown = {}): EffectSelector {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Effect selector must be an object');
  }
  const inputRecord = input as Readonly<Record<string, unknown>>;
  const kindAliases: Readonly<Record<string, string>> = kind === undefined ? {} : aliases[kind];
  const canonicalFields: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(inputRecord)) {
    const canonical = kindAliases[field] ?? field;
    if (
      canonical !== field &&
      Object.hasOwn(inputRecord, canonical) &&
      inputRecord[canonical] !== value
    ) {
      throw new TypeError(`Conflicting selector fields: ${field} and ${canonical}`);
    }
    canonicalFields[canonical] = value;
  }
  const supported = new Set(['operation', 'target', 'actor', 'outcome', 'where']);
  for (const [field, value] of Object.entries(canonicalFields)) {
    if (!supported.has(field)) {
      throw new TypeError(`Unknown selector field: ${field}`);
    }
    if (field === 'where') {
      assertWhere(value);
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
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Effect count must be a nonnegative safe integer');
  }
  assertSelector(selected);
  return freeze({ node: 'constraint', operator, count: value, selector: selected });
}

function before(first: unknown, second: unknown): EffectOrderConstraint {
  assertSelector(first);
  assertSelector(second);
  return freeze({ node: 'constraint', operator: 'before', first, second });
}

function assertSelector(value: unknown): asserts value is EffectSelector {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected an effect selector');
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (record.node !== 'selector') {
    throw new TypeError('Expected an effect selector');
  }
}

function assertConstraint(value: unknown): asserts value is EffectConstraint {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('The effects callback must return constraints, not selectors');
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (record.node !== 'constraint') {
    throw new TypeError('The effects callback must return constraints, not selectors');
  }
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
  const build: (effects: EffectContractBuilderApi) => unknown = builder;
  const candidate = build(effectContractBuilder);
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new TypeError('The effects callback must return a non-empty constraint array');
  }
  const constraints: EffectConstraint[] = [];
  for (const constraint of candidate as readonly unknown[]) {
    assertConstraint(constraint);
    constraints.push(constraint);
  }
  return freeze({ schemaVersion: 1, constraints: [...constraints] });
}
