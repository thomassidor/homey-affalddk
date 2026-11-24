import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // live tests hit the real provider APIs: npm run test:live
    exclude: ['test/live/**', 'node_modules/**'],
  },
});
