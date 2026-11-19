import { writeFile } from 'node:fs/promises';

function descendants(step) {
  return (step.steps ?? []).flatMap((child) => [child, ...descendants(child)]);
}

function observed(step) {
  return {
    title: step.title,
    ...(step.subtitle ? { subtitle: step.subtitle } : {}),
    failed: Boolean(step.error),
    ...(step.error ? { error: step.error.message ?? String(step.error) } : {}),
  };
}

/** Capture completed business descendants; readiness assertions outside these steps do not count. */
export default class FeatureSteps {
  constructor(options) {
    this.outputFile = options.outputFile;
    this.attempts = new Map();
  }

  onTestBegin(test, result) {
    this.attempts.set(result, {
      testId: test.id,
      title: test.title,
      retry: result.retry,
      steps: [],
    });
  }

  onStepEnd(_test, result, step) {
    if (step.category === 'test.step' && /^(Given|When|Then|And|But|\*) /u.test(step.title)) {
      const children = descendants(step);
      this.attempts.get(result).steps.push({
        ...observed(step),
        assertions: children.filter((child) => child.category === 'expect').map(observed),
        requests: children.filter((child) => child.category === 'pw:api').map(observed),
      });
    }
  }

  onTestEnd(_test, result) {
    this.attempts.get(result).status = result.status;
  }

  async onEnd() {
    await writeFile(this.outputFile, JSON.stringify([...this.attempts.values()], null, 2));
  }
}
