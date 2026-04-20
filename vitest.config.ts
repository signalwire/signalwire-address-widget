import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Keep vitest rooted at the project root (vite.config.ts flips to demo/ in
// `serve` mode for the dev server; tests shouldn't inherit that).
export default defineConfig({
  root: resolve(__dirname, '.'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.ts']
  }
});
