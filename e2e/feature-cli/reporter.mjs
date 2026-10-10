import { writeFile } from 'node:fs/promises';

/** Playwright's JSON report omits hook steps; capture their completed live events too. */
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
      this.attempts.get(result).steps.push({ title: step.title, failed: Boolean(step.error) });
    }
  }

  onTestEnd(_test, result) {
    this.attempts.get(result).status = result.status;
  }

  async onEnd() {
    await writeFile(this.outputFile, JSON.stringify([...this.attempts.values()], null, 2));
  }
}
