#!/usr/bin/env node
/**
 * Verify that ALL files in content/parsed/plants/ and content/parsed/unclassified/
 * have been migrated to content/pass_01/. Reports any missing files.
 */
import { readdirSync, statSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

function walkAll(dir) {
  const results = [];
  function walk(d) {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        const st = statSync(full);
        results.push({
          name: e.name,
          nameLower: e.name.toLowerCase(),
          size: st.size,
          abs: full,
          rel: path.relative(ROOT, full).split(path.sep).join('/'),
        });
      }
    } catch { /* skip unreadable */ }
  }
  walk(dir);
  return results;
}

console.log('Scanning parsed/plants/...');
const parsedPlants = walkAll(path.join(ROOT, 'content/parsed/plants'));
console.log(`  Files: ${parsedPlants.length}`);

console.log('Scanning parsed/unclassified/...');
const parsedUncl = walkAll(path.join(ROOT, 'content/parsed/unclassified'));
console.log(`  Files: ${parsedUncl.length}`);

console.log('Scanning pass_01/ (all subdirs)...');
const pass01 = walkAll(path.join(ROOT, 'content/pass_01'));
console.log(`  Files: ${pass01.length}`);

// Build pass_01 index: name_lower|size -> [paths]
const pass01Index = new Map();
for (const f of pass01) {
  const key = f.nameLower + '|' + f.size;
  if (!pass01Index.has(key)) pass01Index.set(key, []);
  pass01Index.get(key).push(f.rel);
}

function checkFiles(files, label) {
  let found = 0, missing = 0;
  const missingFiles = [];
  const ext_counts = {};
  for (const f of files) {
    const key = f.nameLower + '|' + f.size;
    if (pass01Index.has(key)) {
      found++;
    } else {
      missing++;
      const ext = path.extname(f.name).toLowerCase() || '(none)';
      ext_counts[ext] = (ext_counts[ext] || 0) + 1;
      missingFiles.push({ name: f.name, size: f.size, path: f.rel });
    }
  }
  console.log(`\n${label}: ${found} found in pass_01, ${missing} MISSING`);
  if (missing > 0) {
    console.log('  Missing by extension:', JSON.stringify(ext_counts));
    console.log('  Missing files (first 50):');
    missingFiles.slice(0, 50).forEach(f => console.log(`    ${f.path}  (${f.size} bytes)`));
    if (missingFiles.length > 50) console.log(`    ... and ${missingFiles.length - 50} more`);
  }
  return { found, missing, missingFiles };
}

const r1 = checkFiles(parsedPlants, 'parsed/plants');
const r2 = checkFiles(parsedUncl, 'parsed/unclassified');

console.log('\n═══ SUMMARY ═══');
console.log(`parsed/plants:        ${parsedPlants.length} total, ${r1.found} in pass_01, ${r1.missing} MISSING`);
console.log(`parsed/unclassified:  ${parsedUncl.length} total, ${r2.found} in pass_01, ${r2.missing} MISSING`);
console.log(`Total missing:        ${r1.missing + r2.missing}`);

if (r1.missing + r2.missing === 0) {
  console.log('\n✓ ALL files accounted for in pass_01/');
} else {
  console.log('\n✗ Some files are NOT in pass_01 — investigate before deleting parsed/');
}
