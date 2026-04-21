#!/usr/bin/env node
/**
 * Merge emitted .d.ts files into a single dist/address-widget.d.ts so
 * consumers get one entry-point types declaration alongside the UMD
 * and ESM bundles.
 *
 * Minimal implementation: re-exports everything from the emitted
 * types/index.d.ts via a stub file. tsc's declaration output already
 * resolves cross-file references correctly, so the stub just needs to
 * point to the right entry.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const typesEntry = resolve(root, 'dist/types/index.d.ts');
const target = resolve(root, 'dist/address-widget.d.ts');

if (!existsSync(typesEntry)) {
  console.error(`[flatten-types] expected ${typesEntry} to exist after tsc run`);
  process.exit(1);
}

const content = readFileSync(typesEntry, 'utf8');
writeFileSync(target, `// Auto-generated. See dist/types/ for the full tree.\n${content}`, 'utf8');
console.log(`[flatten-types] wrote ${target}`);

// Copy the production demo HTML next to the built bundle so `dist/` is a
// self-contained static web root: index.html + address-widget.umd.js.
const demoSrc = resolve(root, 'demo/prod.html');
const demoDst = resolve(root, 'dist/index.html');
if (existsSync(demoSrc)) {
  copyFileSync(demoSrc, demoDst);
  console.log(`[flatten-types] copied ${demoSrc} -> ${demoDst}`);
}

// Also copy the npm/CDN comparison page so `dist/npm.html` lives next to
// the production demo when dist/ is served as a static web root.
const npmDemoSrc = resolve(root, 'demo/npm.html');
const npmDemoDst = resolve(root, 'dist/npm.html');
if (existsSync(npmDemoSrc)) {
  copyFileSync(npmDemoSrc, npmDemoDst);
  console.log(`[flatten-types] copied ${npmDemoSrc} -> ${npmDemoDst}`);
}

// Also copy defaults.local.js if the developer has one locally. The file is
// gitignored so CI/CD builds won't include it, but local previews will.
const defaultsSrc = resolve(root, 'demo/defaults.local.js');
const defaultsDst = resolve(root, 'dist/defaults.local.js');
if (existsSync(defaultsSrc)) {
  copyFileSync(defaultsSrc, defaultsDst);
  console.log(`[flatten-types] copied ${defaultsSrc} -> ${defaultsDst}`);
}
