import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./__tests__/setup.ts'],
    css: false,
    exclude: ['e2e/**', 'node_modules/**'],
    // Coverage is a report while the demo skeleton grows. It becomes a gate
    // (with thresholds) when the first demo features land; see docs/adr.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        '**/node_modules/**',
        '**/coverage/**',
        '**/.next/**',
        '**/__tests__/**',
        '**/*.{test,spec}.{ts,tsx}',
        '**/*.d.ts',
        '**/{next,vitest,postcss,eslint,prettier}.config.*',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
