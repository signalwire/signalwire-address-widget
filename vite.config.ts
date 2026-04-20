import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Dual-output build:
//   - dist/address-widget.umd.js  → single-file CDN bundle, global SignalWireAddressWidget
//   - dist/address-widget.mjs     → ESM for <script type="module"> and bundlers
// Both bundle every dependency (SDK, web-components, Lit, DOMPurify, markdown, highlight)
// so hosting is a single <script src="..."> with no resolution hops.
export default defineConfig(({ command }) => ({
  root: command === 'serve' ? resolve(__dirname, 'demo') : __dirname,
  publicDir: command === 'serve' ? resolve(__dirname, 'demo/public') : false,
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2020',
    minify: 'esbuild',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'SignalWireAddressWidget',
      formats: ['umd', 'es'],
      fileName: (format) => (format === 'umd' ? 'address-widget.umd.js' : 'address-widget.mjs')
    },
    rollupOptions: {
      // No externals: everything is bundled so the UMD drop-in works standalone on any URL.
      external: [],
      output: {
        exports: 'named',
        globals: {}
      }
    }
  },
  server: {
    port: 5173,
    host: true
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.ts']
  }
}));
