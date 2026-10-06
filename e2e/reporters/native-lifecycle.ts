import type { TestResult, TestStep } from '@playwright/test/reporter';

export type NativeLifecycleTitle = 'Start sandbox' | 'Clean up sandbox';

export interface NativeLifecycleStep {
  readonly title: NativeLifecycleTitle;
  readonly sequence: number;
  readonly startedAt: string;
  readonly startedAtMonotonic: number;
  completedAtMonotonic: number | null;
  duration: number | null;
  status: 'started' | 'completed' | 'failed';
  error: string | null;
}

export interface NativeLifecycleState {
  readonly acquisitionStartedAt: number | null;
  readonly acquisitionCompletedAt: number | null;
  readonly lifecycleSteps: NativeLifecycleStep[];
  businessSteps: number;
  readonly errors: string[];
}

const lifecycleTitles = new Set<NativeLifecycleTitle>(['Start sandbox', 'Clean up sandbox']);

function lifecycleTitle(step: TestStep): NativeLifecycleTitle | undefined {
  if (step.category !== 'test.step' || !lifecycleTitles.has(step.title as NativeLifecycleTitle)) {
    return undefined;
  }
  let ancestor = step.parent;
  while (ancestor !== undefined) {
    if (ancestor.category === 'fixture' && ancestor.title === 'Fixture "Blackbox sandbox"') {
      return step.title as NativeLifecycleTitle;
    }
    ancestor = ancestor.parent;
  }
  return undefined;
}

function lifecycleError(step: TestStep): string | null {
  if (step.error === undefined) {
    return null;
  }
  return (step.error.message ?? step.error.value ?? 'Playwright reported a lifecycle error').slice(
    0,
    1_000,
  );
}

export class NativeLifecycleObserver {
  private readonly activeBusinessSteps = new WeakSet<TestStep>();
  private readonly activeBusinessStepCounts = new WeakMap<TestResult, number>();
  private readonly activeLifecycleSteps = new WeakMap<TestStep, NativeLifecycleStep>();
  private readonly sequences = new WeakMap<TestResult, number>();

  beginAttempt(result: TestResult): void {
    this.activeBusinessStepCounts.set(result, 0);
    this.sequences.set(result, 0);
  }

  beginStep(result: TestResult, step: TestStep, state: NativeLifecycleState): 'business' | 'other' {
    const title = lifecycleTitle(step);
    if (title !== undefined) {
      const sequence = this.sequences.get(result) ?? 0;
      const lifecycle = {
        title,
        sequence,
        startedAt: step.startTime.toISOString(),
        startedAtMonotonic: performance.now(),
        completedAtMonotonic: null,
        duration: null,
        status: 'started',
        error: null,
      } satisfies NativeLifecycleStep;
      state.lifecycleSteps.push(lifecycle);
      this.activeLifecycleSteps.set(step, lifecycle);
      this.sequences.set(result, sequence + 1);
      if (title === 'Clean up sandbox' && (this.activeBusinessStepCounts.get(result) ?? 0) > 0) {
        state.errors.push('Native Clean up sandbox started before business steps completed');
      }
      return 'other';
    }
    if (step.category !== 'test.step') {
      return 'other';
    }
    state.businessSteps++;
    this.activeBusinessSteps.add(step);
    this.activeBusinessStepCounts.set(result, (this.activeBusinessStepCounts.get(result) ?? 0) + 1);
    if (
      !state.lifecycleSteps.some(
        ({ title: candidate, status }) => candidate === 'Start sandbox' && status === 'completed',
      )
    ) {
      state.errors.push('Business step started before native Start sandbox completed');
    }
    return 'business';
  }

  endStep(result: TestResult, step: TestStep): void {
    const lifecycle = this.activeLifecycleSteps.get(step);
    if (lifecycle !== undefined) {
      lifecycle.completedAtMonotonic = performance.now();
      lifecycle.duration = step.duration;
      lifecycle.status = step.error === undefined ? 'completed' : 'failed';
      lifecycle.error = lifecycleError(step);
      this.activeLifecycleSteps.delete(step);
    }
    if (this.activeBusinessSteps.has(step)) {
      this.activeBusinessStepCounts.set(
        result,
        (this.activeBusinessStepCounts.get(result) ?? 1) - 1,
      );
      this.activeBusinessSteps.delete(step);
    }
  }

  validate(state: NativeLifecycleState): void {
    const starts = state.lifecycleSteps.filter(({ title }) => title === 'Start sandbox');
    const cleanups = state.lifecycleSteps.filter(({ title }) => title === 'Clean up sandbox');
    if (starts.length !== 1 || cleanups.length !== 1) {
      state.errors.push('Expected exactly one native Start sandbox and Clean up sandbox step');
      return;
    }
    const [start] = starts;
    const [cleanup] = cleanups;
    validateCompletedSteps(state, start, cleanup);
  }
}

function validateCompletedSteps(
  state: NativeLifecycleState,
  start: NativeLifecycleStep,
  cleanup: NativeLifecycleStep,
): void {
  if (
    start.status !== 'completed' ||
    cleanup.status !== 'completed' ||
    start.error !== null ||
    cleanup.error !== null
  ) {
    state.errors.push('Native sandbox lifecycle step failed or did not complete');
  }
  if (![start, cleanup].every(validTiming)) {
    state.errors.push('Native sandbox lifecycle step timings are incomplete');
  }
  if (
    start.sequence >= cleanup.sequence ||
    start.completedAtMonotonic === null ||
    start.completedAtMonotonic > cleanup.startedAtMonotonic
  ) {
    state.errors.push('Native sandbox lifecycle steps are out of order');
  }
  if (
    state.acquisitionStartedAt !== null &&
    state.acquisitionCompletedAt !== null &&
    (state.acquisitionStartedAt < start.startedAtMonotonic ||
      start.completedAtMonotonic === null ||
      state.acquisitionCompletedAt > start.completedAtMonotonic)
  ) {
    state.errors.push('Acquisition timings fall outside the native Start sandbox step');
  }
}

function validTiming(step: NativeLifecycleStep): boolean {
  return (
    typeof step.duration === 'number' &&
    Number.isFinite(step.duration) &&
    step.duration >= 0 &&
    step.completedAtMonotonic !== null &&
    step.completedAtMonotonic >= step.startedAtMonotonic
  );
}
