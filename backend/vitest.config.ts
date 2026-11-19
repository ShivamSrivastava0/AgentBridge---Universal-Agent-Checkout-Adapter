import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    env: { NODE_ENV: 'test', PGLITE_DATA_DIR: 'memory://', SEED_DEMO_DATA: 'false' },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
