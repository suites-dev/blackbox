import type { TestType } from '@playwright/test';

import type { BlackboxTestOptions } from '../types.js';

export type InternalTest<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
> = TestType<TestArgs & BlackboxTestOptions & InternalArgs, WorkerArgs>;
