import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
