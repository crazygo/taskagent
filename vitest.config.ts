
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: ['default', ['junit', { outputFile: 'artifacts/junit.xml' }]],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    bail: false,
    globals: true,
  },
});
