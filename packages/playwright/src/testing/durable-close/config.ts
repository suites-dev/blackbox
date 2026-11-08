import { defineConfig } from '@playwright/test';
import assertions from '../assertion-accounting.config.js';

/** The project budget must be shorter than the delayed terminal attachment in this case. */
export default defineConfig(assertions, {
  timeout: 500,
  testMatch: 'durable-close-timeout.spec.ts',
});
