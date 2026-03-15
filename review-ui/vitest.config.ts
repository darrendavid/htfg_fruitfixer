import { defineConfig } from 'vitest/config';

// Server-side test configuration.
// Scoped to server/__tests__ only — frontend component tests live in
// src/__tests__ and are run via vitest.config.frontend.ts.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [],
    include: ['server/__tests__/**/*.test.{ts,tsx}'],
    // Each test file gets its own module registry to prevent singleton bleed-over
    isolate: true,
    pool: 'forks',
  },
});
