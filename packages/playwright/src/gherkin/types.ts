import type { APIRequestContext } from '@playwright/test';

import type { BlackboxTestFixtures } from '../fixture-types/index.js';
import type { BlackboxStimulusScope } from '../steps/types.js';

type MaybePromise = void | Promise<void>;
export type GherkinRow = Readonly<Record<string, string>>;
export type GherkinFixtures<Args extends object> = BlackboxTestFixtures & {
  readonly request: APIRequestContext;
  readonly clients: Args extends { readonly clients: infer Clients }
    ? Clients
    : Readonly<Record<string, unknown>>;
};
type Context<Args extends object, Row extends object> = GherkinFixtures<Args> & Row;
type Assertion<Args extends object, Row extends object> = (
  title: string,
  body: (context: Context<Args, Row>) => MaybePromise,
) => Promise<void>;
export type GherkinWhen<Args extends object, Row extends object> = (
  title: string,
  body: (
    context: Context<Args, Row> & {
      readonly stimulus: <Result>(
        body: (scope: BlackboxStimulusScope) => Result | Promise<Result>,
      ) => Promise<Result>;
      readonly Then: Assertion<Args, Row>;
      readonly And: Assertion<Args, Row>;
      readonly But: Assertion<Args, Row>;
    },
  ) => MaybePromise,
) => Promise<void>;
export type GherkinGiven<Args extends object, Row extends object> = (
  title: string,
  body: (context: Context<Args, Row> & { readonly When: GherkinWhen<Args, Row> }) => MaybePromise,
) => Promise<void>;
export interface GherkinScenarioScope<Args extends object> {
  readonly Given: GherkinGiven<Args, object>;
}
export interface GherkinBackgroundScope<Args extends object> {
  readonly Given: (title: string, body: (context: GherkinFixtures<Args>) => MaybePromise) => void;
}
export interface GherkinOutlineScope<Args extends object> {
  readonly Scenarios: (title: string, rows: readonly GherkinRow[]) => void;
  readonly Given: (
    title: string,
    body: Parameters<GherkinGiven<Args, { readonly row: GherkinRow }>>[1],
  ) => void;
  readonly Examples: (title: string, rows: readonly GherkinRow[]) => void;
}
export interface GherkinRuleScope<Args extends object> {
  readonly Example: GherkinRuleScope<Args>['Scenario'];
  readonly ScenarioTemplate: GherkinRuleScope<Args>['ScenarioOutline'];
  readonly Background: (title: string, body: (scope: GherkinBackgroundScope<Args>) => void) => void;
  readonly Scenario: (
    title: string,
    body: (scope: GherkinScenarioScope<Args>) => MaybePromise,
  ) => void;
  readonly ScenarioOutline: (
    title: string,
    body: (scope: GherkinOutlineScope<Args>) => void,
  ) => void;
}
export interface GherkinFeatureScope<Args extends object> extends GherkinRuleScope<Args> {
  readonly Rule: (title: string, body: (scope: GherkinRuleScope<Args>) => void) => void;
}
export type GherkinFeature<Args extends object> = (
  title: string,
  body: (scope: GherkinFeatureScope<Args>) => void,
) => void;
