import type { TestStepInfo, TestType } from '@playwright/test';

export type BlackboxStepOptions = Parameters<TestType<object, object>['step']>[2];

export interface BlackboxStimulusScope {
  readonly activityId: string;
  /** Pass these W3C headers to the request that enters the instrumented system. */
  readonly headers: Readonly<Record<string, string>>;
}

export type BlackboxNativeStep = <T>(
    title: string,
    body: (step: TestStepInfo) => T | Promise<T>,
    options?: BlackboxStepOptions,
  ) => Promise<T>;

export interface BlackboxStep extends BlackboxNativeStep {
  stimulus<T>(
    title: string,
    body: (scope: BlackboxStimulusScope, step: TestStepInfo) => T | Promise<T>,
    options?: BlackboxStepOptions,
  ): Promise<T>;
}
