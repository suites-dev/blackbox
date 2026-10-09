import type { TestStepInfo, TestType } from '@playwright/test';

export type BlackboxStepOptions = Parameters<TestType<object, object>['step']>[2];

export type BlackboxStep = <T>(
  title: string,
  body: (step: TestStepInfo) => T | Promise<T>,
  options?: BlackboxStepOptions,
) => Promise<T>;
