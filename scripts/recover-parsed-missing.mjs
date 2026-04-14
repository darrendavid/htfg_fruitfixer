#!/usr/bin/env node
/**
 * Recover 1,904 files from content/parsed/ that are NOT yet in pass_01/.
 *
 * Task 1A: content/parsed/plants/{slug}/images/* → pass_01/assigned/{slug}/images/
 * Task 1B: content/parsed/unclassified/images/**  → pass_01/unassigned/unclassified/ (preserve subdirs)
 *
 * Collision handling: if filename exists in dest, append _1, _2, ... before extension.
 * Dry-run mode: pass --dry-run to preview without copying.
 */

import { readdirSync, statSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT = path.resolve(import.meta.dirname, '..');

if (DRY_RUN) console.log('[DRY RUN] No files will be copied.\n');

// ── helpers ──────────────────────────────────────────────────────────────────

function walkImages(dir) {
  const results = [];
  function walk(d) {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        const st = statSync(full);
        results.push({ name: e.name, nameLower: e.name.toLowerCase(), size: st.size, abs: full });
      }
    } catch { /* skip unreadable */ }
  }
  walk(dir);
  return results;
}

function buildIndex(dir) {
  // key: name_lower|size → true
  const idx = new Set();
  function walk(d) {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        const st = statSync(full);
        idx.add(e.name.toLowerCase() + '|' + st.size);
      }
    } catch { /* skip */ }
  }
  walk(dir);
  return idx;
}

/** Returns a non-colliding dest path, adding _1/_2/... suffix if needed. */
function safeDestPath(destDir, filename) {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  let candidate = path.join(destDir, filename);
  if (!existsSync(candidate)) return candidate;
  for (let i = 1; i < 1000; i++) {
    candidate = path.join(destDir, `${base}_${i}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not find a free slot for ${filename} in ${destDir}`);
}

function ensureDir(d) {
  if (!DRY_RUN) mkdirSync(d, { recursive: true });
}

function copy(src, dest) {
  ensureDir(path.dirname(dest));
  if (!DRY_RUN) copyFileSync(src, dest);
  console.log(`  COPY ${path.relative(ROOT, src)}\n    → ${path.relative(ROOT, dest)}`);
}

// ── Build pass_01 index (name+size) to detect already-present files ──────────

const PASS01 = path.join(ROOT, 'content/pass_01');
console.log('Building pass_01 index...');
const pass01Idx = buildIndex(PASS01);
console.log(`  ${pass01Idx.size} entries\n`);

// ── Task 1A: parsed/plants/{slug}/images/* → assigned/{slug}/images/ ─────────

console.log('═══ Task 1A: Plant-associated images → assigned/ ═══');

const PARSED_PLANTS = path.join(ROOT, 'content/parsed/plants');
const ASSIGNED = path.join(PASS01, 'assigned');

let countA = 0, skippedA = 0;

let slugDirs;
try {
  slugDirs = readdirSync(PARSED_PLANTS, { withFileTypes: true }).filter(e => e.isDirectory());
} catch {
  console.log('  parsed/plants/ not found — skipping 1A');
  slugDirs = [];
}

for (const slugDir of slugDirs) {
  const slug = slugDir.name;
  const imagesDir = path.join(PARSED_PLANTS, slug, 'images');
  if (!existsSync(imagesDir)) continue;

  const files = walkImages(imagesDir);
  const destBase = path.join(ASSIGNED, slug, 'images');

  for (const f of files) {
    const key = f.nameLower + '|' + f.size;
    if (pass01Idx.has(key)) {
      skippedA++;
      continue; // already in pass_01 somewhere
    }
    const dest = safeDestPath(destBase, f.name);
    copy(f.abs, dest);
    countA++;
  }
}

console.log(`\n1A complete: ${countA} copied, ${skippedA} already in pass_01\n`);

// ── Task 1B: parsed/unclassified/images/**/* → unassigned/unclassified/ ──────

console.log('═══ Task 1B: Unclassified images → unassigned/unclassified/ ═══');

const PARSED_UNCL_IMAGES = path.join(ROOT, 'content/parsed/unclassified/images');
const DEST_UNCL = path.join(PASS01, 'unassigned/unclassified');

let countB = 0, skippedB = 0;

if (!existsSync(PARSED_UNCL_IMAGES)) {
  console.log('  parsed/unclassified/images/ not found — skipping 1B');
} else {
  function walkAndCopy(srcDir, destDir) {
    let entries;
    try { entries = readdirSync(srcDir, { withFileTypes: true }); } catch { return; }

    for (const e of entries) {
      const srcFull = path.join(srcDir, e.name);
      if (e.isDirectory()) {
        walkAndCopy(srcFull, path.join(destDir, e.name));
        continue;
      }
      const st = statSync(srcFull);
      const key = e.name.toLowerCase() + '|' + st.size;
      if (pass01Idx.has(key)) {
        skippedB++;
        continue;
      }
      // preserve subdir structure but handle filename collisions
      const dest = safeDestPath(destDir, e.name);
      copy(srcFull, dest);
      countB++;
    }
  }

  walkAndCopy(PARSED_UNCL_IMAGES, DEST_UNCL);
}

console.log(`\n1B complete: ${countB} copied, ${skippedB} already in pass_01`);

// ── Final summary ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(`Total copied: ${countA + countB}`);
console.log(`Total skipped (already present): ${skippedA + skippedB}`);
if (DRY_RUN) console.log('\n[DRY RUN] Re-run without --dry-run to actually copy files.');
else console.log('\nDone. Run `node scripts/verify-parsed-migration.mjs` to confirm 0 missing.');
