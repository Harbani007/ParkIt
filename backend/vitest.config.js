import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test' },
    // DB test files share facility 1; running them one at a time avoids races.
    fileParallelism: false,
  },
});
