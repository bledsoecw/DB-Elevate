import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // Unit and integration tests only. The browser tests run separately
    // through tsx (npm run test:e2e) because they need a running server.
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
  },
  resolve: {
    /**
     * `server-only` is a marker package: its default export throws, and only
     * the `react-server` export condition resolves to the no-op. Tests run
     * server modules deliberately, so declare the condition rather than
     * stripping the import — the marker is what stops those modules being
     * pulled into a client bundle, and that guard should stay.
     *
     * The same reason `npm run jobs:run` passes --conditions=react-server.
     */
    conditions: ['react-server', 'node', 'import', 'default'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '~': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
