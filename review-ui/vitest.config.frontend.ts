/**
 * Frontend component test configuration.
 *
 * Runs tests in src/__tests__/ using the node environment.
 *
 * NOTE: @testing-library/react and jsdom are not currently installed.
 * The tests in src/__tests__/ call React component functions directly
 * (as plain functions) and inspect the returned JSX element tree without
 * a DOM. This works for all functional components under test.
 *
 * To upgrade to full RTL tests in the future:
 *   npm install -D @testing-library/react @testing-library/user-event jsdom
 * Then change `environment` below to 'jsdom' and add a setupFiles entry
 * that imports '@testing-library/jest-dom/vitest'.
 *
 * Run frontend tests with:
 *   npx vitest run --config vitest.config.frontend.ts
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the @/ alias from vite.config.ts so imports resolve correctly
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // 'node' works for direct function-call component tests.
    // Change to 'jsdom' when @testing-library/react is installed.
    environment: 'node',
    globals: true,
    setupFiles: [],
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    // Isolate each test file to prevent module-mock bleed-over between files
    isolate: true,
    pool: 'forks',
  },
});
