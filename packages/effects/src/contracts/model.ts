export type EffectScalar = string | number | boolean;
export type EffectKind = 'http' | 'rpc' | 'db' | 'cache' | 'message' | 'business' | 'internal';

interface BaseEffectSelectorFields {
  readonly operation: string;
  readonly target: string;
  readonly actor: string;
  readonly outcome: string;
  readonly where: Readonly<Record<string, EffectScalar>>;
}

type SelectorFields<Extra extends object = object> = Readonly<
  Partial<BaseEffectSelectorFields & Extra>
>;
export type EffectSelectorFields = SelectorFields;
export type HttpEffectSelectorFields = SelectorFields<{ method: string; route: string }>;
export type RpcEffectSelectorFields = SelectorFields<{ service: string }>;
export type DatabaseEffectSelectorFields = SelectorFields<{ table: string }>;
export type CacheEffectSelectorFields = SelectorFields<{ keyspace: string }>;
export type MessageEffectSelectorFields = SelectorFields<{ destination: string }>;

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
