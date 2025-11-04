
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: ['default', ['junit', { outputFile: 'artifacts/junit.xml' }]],
    outputFile: 'artifacts/junit.json',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    bail: false,
    globals: true,
    // Use threads pool to avoid PTY exhaustion and kill EPERM issues
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true, // Run tests sequentially to avoid resource conflicts
      },
    },
  },
});
