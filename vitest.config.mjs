import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    reporters: process.env.GITHUB_ACTIONS
      ? ['default', 'junit']
      : ['default'],
    outputFile: process.env.GITHUB_ACTIONS
      ? { junit: 'test-results/vitest-report.xml' }
      : undefined,
  },
});
