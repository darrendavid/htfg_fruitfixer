/**
 * Copy source images NOT in pass_01 to pass_01/ignored/
 * Retains original directory structure from source/
 */

import { join, basename, dirname, relative } from 'path';
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs';

const SOURCE_DIR = join(import.meta.dirname, '..', 'content', 'source');
const PASS01_DIR = join(import.meta.dirname, '..', 'content', 'pass_01');
const IGNORED_DIR = join(PASS01_DIR, 'ignored');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.webp', '.psd']);

// Build set of basenames already in pass_01 (assigned + hidden + unassigned)
function collectBasenames(dir, set) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip the ignored dir itself to avoid self-reference
      if (full === IGNORED_DIR) continue;
      collectBasenames(full, set);
    } else {
      set.add(entry.name.toLowerCase());
    }
  }
}

// Recursively walk source and copy files not in pass_01
function walkAndCopy(dir, knownBasenames) {
  let copied = 0, skipped = 0, errors = 0;

  if (!existsSync(dir)) return { copied, skipped, errors };

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = walkAndCopy(full, knownBasenames);
      copied += sub.copied;
      skipped += sub.skipped;
      errors += sub.errors;
    } else {
      const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) { skipped++; continue; }

      if (knownBasenames.has(entry.name.toLowerCase())) {
        skipped++;
        continue;
      }

      // Copy to ignored/ with original directory structure
      const relPath = relative(SOURCE_DIR, full);
      const dest = join(IGNORED_DIR, relPath);

      try {
        const destDir = dirname(dest);
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

        if (!existsSync(dest)) {
          copyFileSync(full, dest);
          copied++;
        } else {
          skipped++;
        }
      } catch (err) {
        errors++;
      }

      if ((copied + skipped) % 1000 === 0 && copied > 0) {
        console.log(`  Progress: ${copied} copied, ${skipped} skipped...`);
      }
    }
  }
  return { copied, skipped, errors };
}

console.log('Building pass_01 basename index...');
const knownBasenames = new Set();
collectBasenames(PASS01_DIR, knownBasenames);
console.log(`  Known basenames: ${knownBasenames.size}`);

console.log(`\nCopying ignored files from source/ to pass_01/ignored/...`);
mkdirSync(IGNORED_DIR, { recursive: true });
const result = walkAndCopy(SOURCE_DIR, knownBasenames);

console.log(`\n=== DONE ===`);
console.log(`  Copied:  ${result.copied}`);
console.log(`  Skipped: ${result.skipped} (already in pass_01 or non-image)`);
console.log(`  Errors:  ${result.errors}`);
