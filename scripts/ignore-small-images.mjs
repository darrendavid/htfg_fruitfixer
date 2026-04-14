#!/usr/bin/env node
/**
 * Move images smaller than 100px on either dimension from
 * pass_01/unassigned/unclassified/ to pass_01/unassigned/ignored/.
 *
 * Usage:
 *   node scripts/ignore-small-images.mjs --dry-run
 *   node scripts/ignore-small-images.mjs
 */

import { createRequire } from 'module';
import { readdirSync, statSync, existsSync, mkdirSync, renameSync, copyFileSync, unlinkSync } from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const sharp = require(path.join(
  path.resolve(import.meta.dirname, '..'),
  'review-ui/node_modules/sharp'
));

const ROOT          = path.resolve(import.meta.dirname, '..');
const UNCLASSIFIED  = path.join(ROOT, 'content/pass_01/unassigned/unclassified');
const IGNORED_DIR   = path.join(ROOT, 'content/pass_01/unassigned/ignored');
const DRY_RUN       = process.argv.includes('--dry-run');
const MIN_DIM       = 100;

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.pct', '.psd', '.nef', '.heic']);

if (DRY_RUN) console.log('[DRY RUN]\n');

function walkImages(dir, results) {
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walkImages(full, results); continue; }
      if (IMG_EXTS.has(path.extname(e.name).toLowerCase())) results.push(full);
    }
  } catch { /* skip */ }
}

function moveFile(src, dest) {
  try {
    renameSync(src, dest);
  } catch {
    copyFileSync(src, dest);
    unlinkSync(src);
  }
}

function safeDestPath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  for (let i = 1; existsSync(candidate); i++) candidate = path.join(dir, `${base}_${i}${ext}`);
  return candidate;
}

const files = [];
walkImages(UNCLASSIFIED, files);
console.log(`Scanning ${files.length} images in unclassified/...\n`);

let moved = 0, skipped = 0, errors = 0;

for (let i = 0; i < files.length; i++) {
  const abs = files[i];
  const rel = path.relative(UNCLASSIFIED, abs);

  try {
    const meta = await sharp(abs).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;

    if (w < MIN_DIM || h < MIN_DIM) {
      const dest = safeDestPath(IGNORED_DIR, path.basename(abs));
      if (DRY_RUN) {
        console.log(`  IGNORE ${rel} (${w}×${h})`);
      } else {
        mkdirSync(IGNORED_DIR, { recursive: true });
        moveFile(abs, dest);
      }
      moved++;
    } else {
      skipped++;
    }
  } catch {
    // Can't read dimensions — leave it for manual review
    skipped++;
  }

  if ((i + 1) % 100 === 0) process.stdout.write(`  ${i + 1}/${files.length} checked...\r`);
}

console.log(`\n\n══════════════════════════════════`);
console.log(`Ignored (too small): ${moved}`);
console.log(`Kept:                ${skipped}`);
console.log(`Errors:              ${errors}`);
if (DRY_RUN) console.log('\n[DRY RUN] Re-run without --dry-run to apply.');
else console.log('\nDone.');
