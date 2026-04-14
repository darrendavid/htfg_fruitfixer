#!/usr/bin/env node
/**
 * Source → Pass01 Audit
 *
 * Hashes every file in content/source/ and every file in content/pass_01/.
 * Files in source/ whose MD5 hash is NOT found anywhere in pass_01/ are
 * copied to content/pass_01/ignored/source-recovery/ (preserving relative
 * path from source/).
 *
 * Hash results are cached in content/source-audit-hash-cache.json so the
 * script can be interrupted and resumed without re-hashing.
 *
 * Modes:
 *   --dry-run    Report missing files, don't copy
 *   --hash-only  Build/update hash caches, don't copy or report
 *   (default)    Hash + copy missing files to pass_01/ignored/source-recovery/
 *
 * Usage:
 *   node scripts/source-to-pass01-audit.mjs --dry-run
 *   node scripts/source-to-pass01-audit.mjs
 */

import { createHash } from 'crypto';
import { createReadStream, readdirSync, statSync, existsSync, mkdirSync, copyFileSync,
         writeFileSync, readFileSync } from 'fs';
import path from 'path';

const ROOT        = path.resolve(import.meta.dirname, '..');
const SOURCE_DIR  = path.join(ROOT, 'content', 'source');
const PASS01_DIR  = path.join(ROOT, 'content', 'pass_01');
const DEST_DIR    = path.join(ROOT, 'content', 'pass_01', 'ignored', 'source-recovery');
const CACHE_FILE  = path.join(ROOT, 'content', 'source-audit-hash-cache.json');
const REPORT_FILE = path.join(ROOT, 'content', 'source-audit-report.json');

const DRY_RUN   = process.argv.includes('--dry-run');
const HASH_ONLY = process.argv.includes('--hash-only');

if (DRY_RUN)   console.log('[DRY RUN] Files will not be copied.\n');
if (HASH_ONLY) console.log('[HASH ONLY] Will build cache only.\n');

// ── MD5 hash a file via streaming ─────────────────────────────────────────────

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ── Walk directory, return flat list of absolute paths ────────────────────────

function walkDir(dir) {
  const results = [];
  function walk(d) {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        // Skip system files
        if (e.name === 'desktop.ini' || e.name === 'Thumbs.db' || e.name === '.DS_Store') continue;
        results.push(full);
      }
    } catch (err) {
      console.warn(`  WARN: cannot read ${d}: ${err.message}`);
    }
  }
  walk(dir);
  return results;
}

// ── Load / save cache ─────────────────────────────────────────────────────────
// Cache format: { "abs/path": "md5hash", ... }

function loadCache() {
  if (existsSync(CACHE_FILE)) {
    try { return JSON.parse(readFileSync(CACHE_FILE, 'utf-8')); } catch {}
  }
  return {};
}

function saveCache(cache) {
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 0));
}

// ── Hash a directory with caching ─────────────────────────────────────────────

async function hashDir(dir, cache, label) {
  const files = walkDir(dir);
  console.log(`${label}: ${files.length} files to process`);

  let hashed = 0, cached = 0, errors = 0;
  const SAVE_INTERVAL = 500;

  for (let i = 0; i < files.length; i++) {
    const abs = files[i];
    if (cache[abs]) { cached++; continue; }
    try {
      const st = statSync(abs);
      // Skip zero-byte files
      if (st.size === 0) { cache[abs] = 'EMPTY'; hashed++; continue; }
      cache[abs] = await hashFile(abs);
      hashed++;
    } catch (err) {
      console.warn(`\n  WARN hash error: ${path.relative(ROOT, abs)}: ${err.message}`);
      cache[abs] = 'ERROR';
      errors++;
    }
    if ((hashed + errors) % SAVE_INTERVAL === 0) {
      saveCache(cache);
      process.stdout.write(`  ${i + 1}/${files.length} (${cached} cached, ${hashed} hashed, ${errors} errors)\r`);
    }
  }
  saveCache(cache);
  console.log(`  Done: ${cached} from cache, ${hashed} newly hashed, ${errors} errors       `);
  return files;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Load persistent hash cache
  const cache = loadCache();
  const cacheSize = Object.keys(cache).length;
  if (cacheSize > 0) console.log(`Loaded hash cache: ${cacheSize} entries\n`);

  // 1. Hash pass_01/ (build lookup set)
  console.log('── Step 1: Hash pass_01/ ──────────────────────────────');
  await hashDir(PASS01_DIR, cache, 'pass_01');

  // Build hash set for pass_01 (exclude errors/empty)
  const pass01Hashes = new Set();
  for (const [abs, hash] of Object.entries(cache)) {
    if (abs.startsWith(PASS01_DIR) && hash !== 'ERROR' && hash !== 'EMPTY') {
      pass01Hashes.add(hash);
    }
  }
  console.log(`  pass_01 unique hashes: ${pass01Hashes.size}\n`);

  // 2. Hash source/
  console.log('── Step 2: Hash source/ ───────────────────────────────');
  const sourceFiles = await hashDir(SOURCE_DIR, cache, 'source');

  if (HASH_ONLY) {
    console.log('\n[HASH ONLY] Cache saved. Re-run without --hash-only to proceed.');
    return;
  }

  // 3. Find source files not in pass_01
  console.log('\n── Step 3: Find source files not in pass_01/ ──────────');

  const missing = [];
  const found = [];
  const errored = [];

  for (const abs of sourceFiles) {
    const hash = cache[abs];
    if (!hash || hash === 'ERROR') { errored.push(abs); continue; }
    if (hash === 'EMPTY') { continue; } // skip zero-byte files
    if (pass01Hashes.has(hash)) {
      found.push(abs);
    } else {
      missing.push(abs);
    }
  }

  console.log(`  In source/: ${sourceFiles.length} files`);
  console.log(`  Found in pass_01 (by hash): ${found.length}`);
  console.log(`  NOT in pass_01: ${missing.length}`);
  console.log(`  Hash errors: ${errored.length}`);

  // Show breakdown of missing by subdirectory
  const bySubdir = {};
  for (const abs of missing) {
    const rel = path.relative(SOURCE_DIR, abs);
    const top = rel.split(path.sep)[0];
    bySubdir[top] = (bySubdir[top] || 0) + 1;
  }
  console.log('\n  Missing by top-level source dir:');
  Object.entries(bySubdir).sort((a, b) => b[1] - a[1]).forEach(([d, n]) =>
    console.log(`    ${d}: ${n}`)
  );

  // 4. Copy missing files → pass_01/ignored/source-recovery/
  if (!DRY_RUN && missing.length > 0) {
    console.log(`\n── Step 4: Copy ${missing.length} missing files → ignored/source-recovery/ ──`);
    mkdirSync(DEST_DIR, { recursive: true });
    let copied = 0, copyErrors = 0;

    for (const abs of missing) {
      const rel = path.relative(SOURCE_DIR, abs);
      const dest = path.join(DEST_DIR, rel);
      try {
        mkdirSync(path.dirname(dest), { recursive: true });
        copyFileSync(abs, dest);
        copied++;
        if (copied % 100 === 0) process.stdout.write(`  ${copied}/${missing.length} copied\r`);
      } catch (err) {
        console.warn(`\n  WARN copy failed: ${rel}: ${err.message}`);
        copyErrors++;
      }
    }
    console.log(`  ✓ ${copied} files copied, ${copyErrors} errors       `);
  } else if (DRY_RUN && missing.length > 0) {
    console.log('\n[DRY RUN] First 20 missing files:');
    missing.slice(0, 20).forEach(abs =>
      console.log('  ' + path.relative(SOURCE_DIR, abs))
    );
    if (missing.length > 20) console.log(`  ... and ${missing.length - 20} more`);
  }

  // 5. Write report
  const report = {
    generated: new Date().toISOString(),
    source_total: sourceFiles.length,
    found_in_pass01: found.length,
    not_in_pass01: missing.length,
    hash_errors: errored.length,
    missing_by_subdir: bySubdir,
    missing_files: missing.map(abs => path.relative(SOURCE_DIR, abs).split(path.sep).join('/')),
    errored_files: errored.map(abs => path.relative(SOURCE_DIR, abs).split(path.sep).join('/')),
  };
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`\nReport saved: content/source-audit-report.json`);

  if (DRY_RUN) console.log('\nRe-run without --dry-run to copy missing files.');
  else if (missing.length === 0) console.log('\n✓ All source files accounted for in pass_01.');
  else console.log(`\n✓ ${missing.length} files copied to pass_01/ignored/source-recovery/`);
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });
