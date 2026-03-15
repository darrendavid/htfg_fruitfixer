#!/usr/bin/env node
/**
 * Generates phase2-batches.json by scanning the source directories
 * and splitting them into parallel batches for inventory-worker.mjs.
 *
 * Usage: node scripts/phase2-generate-batches.mjs
 */

import { readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const SOURCE_DIR = join(ROOT, 'content', 'source');
const HWFN_DIR = join(SOURCE_DIR, 'HawaiiFruit. Net');
const ORIG_DIR = join(SOURCE_DIR, 'original');

function getSubdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  } catch (err) {
    console.error(`Error reading ${dir}: ${err.message}`);
    return [];
  }
}

function splitArray(arr, chunks) {
  const result = [];
  const size = Math.ceil(arr.length / chunks);
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// Get subdirectories
const hwfnDirs = getSubdirs(HWFN_DIR);
const origDirs = getSubdirs(ORIG_DIR);

console.log(`HawaiiFruit. Net: ${hwfnDirs.length} subdirectories`);
console.log(`original: ${origDirs.length} subdirectories`);

// Split into batches:
// - HWFN subdirs: 4 batches
// - HWFN root loose files: 1 batch
// - Original subdirs: 3 batches
// Total: 8 parallel batches

const hwfnBatches = splitArray(hwfnDirs, 4);
const origBatches = splitArray(origDirs, 3);

const batches = [];
let batchId = 1;

// HWFN subdirectory batches
for (let i = 0; i < hwfnBatches.length; i++) {
  const dirs = hwfnBatches[i];
  batches.push({
    id: batchId++,
    label: `HawaiiFruit.Net subdirs (${dirs[0]} - ${dirs[dirs.length - 1]})`,
    paths: dirs.map(d => ({
      path: `HawaiiFruit. Net/${d}`,
      glob: '**/*',
    })),
  });
}

// HWFN root loose files batch
batches.push({
  id: batchId++,
  label: 'HawaiiFruit.Net root files',
  paths: [{
    path: 'HawaiiFruit. Net',
    glob: '*',  // Only top-level files, not subdirs
  }],
});

// Original subdirectory batches
for (let i = 0; i < origBatches.length; i++) {
  const dirs = origBatches[i];
  batches.push({
    id: batchId++,
    label: `original subdirs (${dirs[0]} - ${dirs[dirs.length - 1]})`,
    paths: dirs.map(d => ({
      path: `original/${d}`,
      glob: '**/*',
    })),
  });
}

const config = {
  generated: new Date().toISOString(),
  total_batches: batches.length,
  batches,
};

const outPath = join(ROOT, 'scripts', 'phase2-batches.json');
writeFileSync(outPath, JSON.stringify(config, null, 2));
console.log(`\nWrote ${batches.length} batches to ${outPath}`);
for (const b of batches) {
  console.log(`  Batch ${b.id}: ${b.label} (${b.paths.length} paths)`);
}
