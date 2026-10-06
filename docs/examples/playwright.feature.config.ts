// Requires the incoming #165 Gherkin verification integration and reporter guardrails.
import { defineGherkinConfig } from '@suites/blackbox-gherkin/config';

export default defineGherkinConfig({
  gherkinConfigFile: new URL('./blackbox.feature.yaml', import.meta.url),
  workers: 1,
  timeout: 180_000,
});
