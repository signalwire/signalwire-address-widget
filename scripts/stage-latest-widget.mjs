#!/usr/bin/env node
/**
 * Stage a CDN-ready copy of dist/ as dist/latest_widget/ and zip it.
 *
 *   1. Copy everything in dist/ to dist/latest_widget/
 *   2. Delete files that don't belong on a public CDN:
 *        - defaults.local.js  (local SAT; gitignored for a reason)
 *        - index.html         (the demo page)
 *        - *.d.ts             (TypeScript declarations)
 *        - types/             (TS declaration tree)
 *        - latest_widget/     (the stage dir itself, if a prior run left one)
 *        - latest_widget.zip  (a prior zip)
 *   3. Zip dist/latest_widget/ into dist/latest_widget.zip
 *
 * Run after `npm run build`. Output lives entirely inside dist/, which is
 * gitignored, so nothing new lands in the tree. Invoke with:
 *
 *   node scripts/stage-latest-widget.mjs
 */

import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');
const stage = resolve(dist, 'latest_widget');
const zipPath = resolve(dist, 'latest_widget.zip');

if (!existsSync(dist)) {
  console.error(`[stage-latest-widget] ${dist} does not exist — run 'npm run build' first.`);
  process.exit(1);
}

// Clean any prior staging artifacts.
rmSync(stage, { recursive: true, force: true });
rmSync(zipPath, { force: true });

// Step 1: copy every top-level entry in dist/ into dist/latest_widget/,
// skipping the stage dir itself and any prior zip. cpSync can't copy a
// directory into a subdirectory of itself, so we iterate entries.
mkdirSync(stage, { recursive: true });
for (const entry of readdirSync(dist)) {
  const src = join(dist, entry);
  if (src === stage || src === zipPath) continue;
  cpSync(src, join(stage, entry), { recursive: true });
}

// Step 2: delete files and folders that don't belong on a public CDN.
const removeIfExists = (p) => {
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    console.log(`[stage-latest-widget] pruned ${p.slice(stage.length + 1)}`);
  }
};

removeIfExists(join(stage, 'defaults.local.js'));
removeIfExists(join(stage, 'index.html'));
removeIfExists(join(stage, 'types'));

// Strip every .d.ts at the stage root.
for (const entry of readdirSync(stage)) {
  const full = join(stage, entry);
  if (entry.endsWith('.d.ts') && statSync(full).isFile()) {
    removeIfExists(full);
  }
}

// Step 3: zip it. `zip` CLI is standard on Linux/macOS.
try {
  execSync('zip -rq latest_widget.zip latest_widget', { cwd: dist, stdio: 'inherit' });
} catch (err) {
  console.error(
    `[stage-latest-widget] 'zip' failed (is the zip CLI installed?): ${err instanceof Error ? err.message : err}`
  );
  process.exit(1);
}

console.log(`[stage-latest-widget] staged dir: ${stage}`);
console.log(`[stage-latest-widget] wrote zip:  ${zipPath}`);
