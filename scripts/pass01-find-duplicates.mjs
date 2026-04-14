#!/usr/bin/env node
/**
 * Step 1 of source audit: hash all files in pass_01/, build a reusable cache,
 * and report internal duplicates (same MD5 hash, multiple files).
 *
 * Cache saved to: content/source-audit-hash-cache.json
 * Report saved to: content/pass01-duplicates-report.json
 *
 * Usage:
 *   node scripts/pass01-find-duplicates.mjs
 */

import { createHash } from 'crypto';
import { createReadStream, readdirSync, statSync, existsSync,
         writeFileSync, readFileSync } from 'fs';
import path from 'path';

const ROOT       = path.resolve(import.meta.dirname, '..');
const PASS01_DIR = path.join(ROOT, 'content', 'pass_01');
const CACHE_FILE = path.join(ROOT, 'content', 'source-audit-hash-cache.json');
const REPORT_FILE= path.join(ROOT, 'content', 'pass01-duplicates-report.json');

const SKIP_NAMES = new Set(['desktop.ini', 'Thumbs.db', '.DS_Store']);

// ── Hash a file via streaming ─────────────────────────────────────────────────

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end',  () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ── Walk directory ────────────────────────────────────────────────────────────

function walkDir(dir) {
  const results = [];
  function walk(d) {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (SKIP_NAMES.has(e.name)) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        const st = statSync(full);
        results.push({ abs: full, size: st.size });
      }
    } catch (err) {
      console.warn(`  WARN cannot read ${path.relative(ROOT, d)}: ${err.message}`);
    }
  }
  walk(dir);
  return results;
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function loadCache() {
  if (existsSync(CACHE_FILE)) {
    try { return JSON.parse(readFileSync(CACHE_FILE, 'utf-8')); } catch {}
  }
  return {};
}

function saveCache(cache) {
  writeFileSync(CACHE_FILE, JSON.stringify(cache));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const cache = loadCache();
  console.log(`Cache loaded: ${Object.keys(cache).length} existing entries\n`);

  console.log('Scanning pass_01/...');
  const files = walkDir(PASS01_DIR);
  console.log(`  ${files.length} files found\n`);

  // Hash all files, using cache where available
  console.log('Hashing files (cached entries skipped)...');
  let hashed = 0, fromCache = 0, errors = 0;
  const SAVE_EVERY = 500;

  for (let i = 0; i < files.length; i++) {
    const { abs, size } = files[i];
    if (cache[abs]) { fromCache++; continue; }
    if (size === 0)  { cache[abs] = 'EMPTY'; hashed++; continue; }
    try {
      cache[abs] = await hashFile(abs);
      hashed++;
    } catch (err) {
      console.warn(`\n  WARN ${path.relative(ROOT, abs)}: ${err.message}`);
      cache[abs] = 'ERROR';
      errors++;
    }
    if ((hashed + errors) % SAVE_EVERY === 0) {
      saveCache(cache);
      const pct = ((i + 1) / files.length * 100).toFixed(1);
      process.stdout.write(`  ${i + 1}/${files.length} (${pct}%)  ${hashed} hashed, ${fromCache} cached\r`);
    }
  }
  saveCache(cache);
  console.log(`\n  Done: ${fromCache} from cache, ${hashed} newly hashed, ${errors} errors\n`);

  // ── Find duplicates ───────────────────────────────────────────────────────

  // hash → [relative paths]
  const hashMap = new Map();
  for (const { abs } of files) {
    const h = cache[abs];
    if (!h || h === 'ERROR' || h === 'EMPTY') continue;
    const rel = path.relative(PASS01_DIR, abs).split(path.sep).join('/');
    if (!hashMap.has(h)) hashMap.set(h, []);
    hashMap.get(h).push(rel);
  }

  const dupeGroups = [...hashMap.entries()]
    .filter(([, paths]) => paths.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  const totalDupeFiles  = dupeGroups.reduce((s, [, p]) => s + p.length, 0);
  const totalExtraCopies = dupeGroups.reduce((s, [, p]) => s + p.length - 1, 0);
  const uniqueFiles = hashMap.size;

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log('══════════════════════════════════════════════════════');
  console.log('PASS_01 DUPLICATE REPORT');
  console.log('══════════════════════════════════════════════════════');
  console.log(`Total files scanned:     ${files.length}`);
  console.log(`Unique content (hashes): ${uniqueFiles}`);
  console.log(`Duplicate groups:        ${dupeGroups.length}`);
  console.log(`Files in dupe groups:    ${totalDupeFiles}`);
  console.log(`Extra copies (bloat):    ${totalExtraCopies}`);
  console.log(`  → pass_01 would shrink to ${files.length - totalExtraCopies} files if deduped`);

  // Break down duplicates by folder pairing
  const pairCounts = {};
  for (const [, paths] of dupeGroups) {
    // Get top-level pass_01 subfolder for each copy
    const folders = [...new Set(paths.map(p => p.split('/')[0]))].sort().join(' ↔ ');
    pairCounts[folders] = (pairCounts[folders] || 0) + (paths.length - 1);
  }
  console.log('\nExtra copies by folder pair:');
  Object.entries(pairCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([pair, n]) => console.log(`  ${n.toString().padStart(5)}  ${pair}`));

  // Show top 10 most-duplicated files
  console.log('\nTop 10 most-duplicated files:');
  dupeGroups.slice(0, 10).forEach(([hash, paths]) => {
    console.log(`  [${paths.length} copies]  ${paths[0]}`);
    paths.slice(1, 3).forEach(p => console.log(`    + ${p}`));
    if (paths.length > 3) console.log(`    ... and ${paths.length - 3} more`);
  });

  // ── Write report ──────────────────────────────────────────────────────────

  const report = {
    generated: new Date().toISOString(),
    total_files: files.length,
    unique_hashes: uniqueFiles,
    duplicate_groups: dupeGroups.length,
    total_in_dupe_groups: totalDupeFiles,
    extra_copies: totalExtraCopies,
    extra_copies_by_folder_pair: pairCounts,
    groups: dupeGroups.map(([hash, paths]) => ({ hash, copies: paths.length, paths })),
  };
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`\nFull report: content/pass01-duplicates-report.json`);
  console.log('Hash cache: content/source-audit-hash-cache.json (reused in source audit)');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
