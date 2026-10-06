import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 20000,
    pool: 'forks',
    maxWorkers: 1,
  },
});
