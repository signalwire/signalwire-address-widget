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
  // Mirrors vite.config.ts. Without it any test that reaches _buildMetadata
  // dies on an undefined global rather than on anything it meant to assert.
  define: {
    __WIDGET_VERSION__: JSON.stringify('0.0.0-test')
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.ts']
  }
});
