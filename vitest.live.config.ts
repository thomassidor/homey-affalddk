import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/live/**/*.live.test.ts'],
    testTimeout: 180_000,
    // be polite to the municipal APIs
    maxConcurrency: 4,
    retry: 1,
  },
});
