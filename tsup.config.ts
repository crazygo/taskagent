import { defineConfig } from 'tsup';
import path from 'node:path';

export default defineConfig({
  entry: [
    'packages/**/*.ts',
    'packages/**/*.tsx',
  ],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  dts: false,
  sourcemap: false,
  splitting: true,
  clean: true,
  skipNodeModulesBundle: true,
  treeshake: false,
  esbuildOptions(options) {
    // Preserve repo folder structure under dist/, i.e. dist/packages/**
    options.outbase = path.resolve(__dirname);
  },
});