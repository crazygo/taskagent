
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@agents': path.resolve(__dirname, './packages/agents'),
      '@shared/logger': path.resolve(__dirname, './packages/shared/logger.ts'),
      '@shared/task-logger': path.resolve(__dirname, './packages/shared/task-logger.ts'),
      '@shared/env': path.resolve(__dirname, './packages/shared/env.ts'),
      '@shared/types': path.resolve(__dirname, './packages/shared/types.ts'),
      '@shared/task-manager': path.resolve(__dirname, './packages/shared/task-manager.ts'),
      '@core/event-bus': path.resolve(__dirname, './packages/core/event-bus'),
      '@core': path.resolve(__dirname, './packages/core'),
      '@execution': path.resolve(__dirname, './packages/execution'),
      '@tabs': path.resolve(__dirname, './packages/tabs'),
      '@presets': path.resolve(__dirname, './packages/presets'),
    },
  },
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
