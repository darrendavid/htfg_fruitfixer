#!/usr/bin/env node
/**
 * Image Reconciliation Audit
 *
 * For every record in the NocoDB Images table, determines:
 *   OK_PASS01    — File_Path already points to pass_01, file exists on disk
 *   OK_PARSED    — File_Path points to parsed/, but same file found in pass_01 (size match) → path needs update
 *   PARSED_ONLY  — File_Path points to parsed/, file exists there but NOT in pass_01 → needs migration
 *   MISSING      — File_Path resolves to no existing file anywhere
 *   AMBIGUOUS    — Normalized pass_01 file exists but different size (collision-renamed copy)
 *
 * For every file in pass_01/assigned/ NOT covered by any DB record:
 *   ORPHAN       — file on disk with no DB record (invisible in browser)
 *
 * Outputs: audit-reconciliation-report.json + summary to console
 *
 * Usage: node scripts/audit-image-reconciliation.mjs
 */

import { statSync, existsSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { readFileSync } from 'fs';

const ROOT = path.resolve(import.meta.dirname, '..');

// Load review-ui/.env
const envPath = path.join(ROOT, 'review-ui', '.env');
for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const API_KEY = process.env.NOCODB_API_KEY;
const BASE_URL = 'https://nocodb.djjd.us';
const TABLE_IDS = JSON.parse(readFileSync(path.join(ROOT, 'content/parsed/nocodb_table_ids.json'), 'utf-8'));
const IMAGES_TABLE = TABLE_IDS['Images'];

const CONTENT_DIR = path.join(ROOT, 'content');
const ASSIGNED_DIR = path.join(ROOT, 'content/pass_01/assigned');
const PARSED_PLANTS_DIR = path.join(ROOT, 'content/parsed/plants');

if (!API_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

// ── NocoDB fetch all images ───────────────────────────────────────────────────

async function nocoListAll(tableId, fields) {
  const all = [];
  let offset = 0;
  while (true) {
    const qs = new URLSearchParams({ limit: '1000', offset: String(offset), fields });
    const res = await fetch(`${BASE_URL}/api/v2/tables/${tableId}/records?${qs}`, {
      headers: { 'xc-token': API_KEY },
    });
    if (!res.ok) throw new Error(`NocoDB error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    all.push(...data.list);
    if (data.pageInfo?.isLastPage) break;
    offset += data.list.length;
    process.stdout.write(`  fetched ${all.length} records...\r`);
  }
  return all;
}

// ── Filesystem index of pass_01/assigned/ ────────────────────────────────────

function walkDir(dir) {
  const results = [];
  const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff']);
  function walk(d) {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (IMAGE_EXTS.has(path.extname(e.name).toLowerCase())) {
          const st = statSync(full);
          results.push({ abs: full, size: st.size });
        }
      }
    } catch { /* skip */ }
  }
  walk(dir);
  return results;
}

/**
 * Strip known prefixes to get the slug-relative path: slug/images/file.ext
 * Used for cross-format matching (parsed vs pass_01).
 */
function normalize(p) {
  return p
    .replace(/\\/g, '/')
    .replace(/^content\/pass_01\/assigned\//, '')
    .replace(/^content\/parsed\/plants\//, '')
    .replace(/^content\/parsed\//, '')
    .replace(/^content\//, '')
    .replace(/^pass_01\/assigned\//, '')
    .replace(/^assigned\//, '')
    .replace(/^plants\//, '')
    .toLowerCase();
}

/** Resolve a DB File_Path to an absolute path on disk */
function resolveDbPath(filePath) {
  return path.join(ROOT, filePath.replace(/\//g, path.sep));
}

/** Convert absolute path → pass_01-based File_Path */
function toPass01FilePath(abs) {
  return 'content/' + path.relative(CONTENT_DIR, abs).split(path.sep).join('/');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Fetch all DB records
  console.log('Fetching all Images records from NocoDB...');
  const dbRecords = await nocoListAll(IMAGES_TABLE, 'Id,File_Path,Plant_Id,Caption,Rotation,Variety_Id,Status,Excluded');
  console.log(`\n  Total DB records: ${dbRecords.length}\n`);

  // 2. Build pass_01 index: normalizedPath → { abs, size }
  console.log('Scanning pass_01/assigned/...');
  const pass01Files = walkDir(ASSIGNED_DIR);
  console.log(`  ${pass01Files.length} files on disk\n`);

  // normPath → [{ abs, size }] (could be multiple due to _1 suffixes)
  const pass01ByNorm = new Map();
  // abs → true (for orphan detection)
  const pass01AbsUsed = new Set();

  for (const f of pass01Files) {
    const norm = normalize(toPass01FilePath(f.abs));
    if (!pass01ByNorm.has(norm)) pass01ByNorm.set(norm, []);
    pass01ByNorm.get(norm).push(f);
  }

  // 3. Classify each DB record
  const results = {
    OK_PASS01: [],    // already at pass_01 path, file exists
    OK_PARSED: [],    // parsed path in DB but matched in pass_01 by name+size
    PARSED_ONLY: [],  // parsed path, exists in parsed/ but not in pass_01
    MISSING: [],      // file not found anywhere
    AMBIGUOUS: [],    // normalized match in pass_01 but size differs
  };

  for (const rec of dbRecords) {
    const fp = rec.File_Path || '';
    const norm = normalize(fp);
    const absDb = resolveDbPath(fp);
    const existsAtDb = existsSync(absDb);

    // Check if it's already a pass_01 path
    const isPass01Path = fp.includes('pass_01');

    if (isPass01Path) {
      if (existsAtDb) {
        results.OK_PASS01.push({ ...rec, _norm: norm });
        pass01AbsUsed.add(absDb);
      } else {
        // pass_01 path but file missing — check if it's in parsed/
        const parsedAlt = fp.replace('pass_01/assigned', 'parsed/plants');
        const absAlt = resolveDbPath(parsedAlt);
        if (existsSync(absAlt)) {
          const sizeParsed = statSync(absAlt).size;
          results.PARSED_ONLY.push({ ...rec, _norm: norm, _parsed_abs: absAlt, _size: sizeParsed });
        } else {
          results.MISSING.push({ ...rec, _norm: norm });
        }
      }
      continue;
    }

    // Parsed path in DB — look for file in pass_01 by normalized name
    const pass01Candidates = pass01ByNorm.get(norm) || [];

    if (existsAtDb) {
      // File still exists at parsed/ path too — check pass_01
      const dbSize = statSync(absDb).size;
      if (pass01Candidates.length > 0) {
        const sizeMatch = pass01Candidates.find(c => c.size === dbSize);
        if (sizeMatch) {
          results.OK_PARSED.push({ ...rec, _norm: norm, _pass01_abs: sizeMatch.abs, _size: dbSize });
          pass01AbsUsed.add(sizeMatch.abs);
        } else {
          // Same name, different size → different photo
          results.AMBIGUOUS.push({ ...rec, _norm: norm, _db_size: dbSize, _pass01_sizes: pass01Candidates.map(c => c.size) });
        }
      } else {
        // Exists in parsed/, not in pass_01
        results.PARSED_ONLY.push({ ...rec, _norm: norm, _parsed_abs: absDb, _size: statSync(absDb).size });
      }
    } else {
      // Not in parsed/ — look in pass_01
      if (pass01Candidates.length === 1) {
        results.OK_PARSED.push({ ...rec, _norm: norm, _pass01_abs: pass01Candidates[0].abs, _size: pass01Candidates[0].size });
        pass01AbsUsed.add(pass01Candidates[0].abs);
      } else if (pass01Candidates.length > 1) {
        // Multiple candidates — ambiguous
        results.AMBIGUOUS.push({ ...rec, _norm: norm, _db_size: null, _pass01_sizes: pass01Candidates.map(c => c.size) });
      } else {
        results.MISSING.push({ ...rec, _norm: norm });
      }
    }
  }

  // 4. Find orphans — pass_01 files with no DB record
  const orphans = pass01Files.filter(f => !pass01AbsUsed.has(f.abs));

  // 5. Summary
  console.log('══════════════════════════════════════════════════════');
  console.log('RECONCILIATION SUMMARY');
  console.log('══════════════════════════════════════════════════════');
  console.log(`OK_PASS01    (pass_01 path, file exists):             ${results.OK_PASS01.length}`);
  console.log(`OK_PARSED    (parsed path, file found in pass_01):    ${results.OK_PARSED.length}`);
  console.log(`PARSED_ONLY  (parsed path, NOT in pass_01):           ${results.PARSED_ONLY.length}`);
  console.log(`AMBIGUOUS    (name matches but size differs):          ${results.AMBIGUOUS.length}`);
  console.log(`MISSING      (file not found anywhere):               ${results.MISSING.length}`);
  console.log(`ORPHAN       (in pass_01 but no DB record):           ${orphans.length}`);
  console.log('──────────────────────────────────────────────────────');
  const total = Object.values(results).reduce((s, a) => s + a.length, 0);
  console.log(`Total DB records classified:                          ${total}`);
  console.log(`Total pass_01 files:                                  ${pass01Files.length}`);

  // 6. Action plan
  console.log('\nACTION PLAN:');
  if (results.OK_PASS01.length) console.log(`  ✓ ${results.OK_PASS01.length} records already correct — no action needed`);
  if (results.OK_PARSED.length) console.log(`  → ${results.OK_PARSED.length} records need File_Path updated to pass_01 path`);
  if (results.PARSED_ONLY.length) console.log(`  → ${results.PARSED_ONLY.length} records: file only in parsed/ — copy to pass_01 + update DB path`);
  if (results.AMBIGUOUS.length) console.log(`  ⚠ ${results.AMBIGUOUS.length} records: same filename, different size — NEEDS HUMAN REVIEW`);
  if (results.MISSING.length) console.log(`  ✗ ${results.MISSING.length} records: file not found on disk — investigate`);
  if (orphans.length) console.log(`  + ${orphans.length} orphan files in pass_01 have no DB record — import needed`);

  // 7. Write full report
  const report = {
    generated: new Date().toISOString(),
    summary: {
      OK_PASS01: results.OK_PASS01.length,
      OK_PARSED: results.OK_PARSED.length,
      PARSED_ONLY: results.PARSED_ONLY.length,
      AMBIGUOUS: results.AMBIGUOUS.length,
      MISSING: results.MISSING.length,
      ORPHAN: orphans.length,
    },
    records: {
      OK_PASS01: results.OK_PASS01.map(r => ({ id: r.Id, file_path: r.File_Path, plant: r.Plant_Id })),
      OK_PARSED: results.OK_PARSED.map(r => ({ id: r.Id, old_path: r.File_Path, new_path: toPass01FilePath(r._pass01_abs), plant: r.Plant_Id, size: r._size })),
      PARSED_ONLY: results.PARSED_ONLY.map(r => ({ id: r.Id, file_path: r.File_Path, plant: r.Plant_Id, parsed_abs: r._parsed_abs, size: r._size })),
      AMBIGUOUS: results.AMBIGUOUS.map(r => ({ id: r.Id, file_path: r.File_Path, plant: r.Plant_Id, db_size: r._db_size, pass01_sizes: r._pass01_sizes, caption: r.Caption })),
      MISSING: results.MISSING.map(r => ({ id: r.Id, file_path: r.File_Path, plant: r.Plant_Id, caption: r.Caption, rotation: r.Rotation, variety_id: r.Variety_Id })),
      ORPHAN: orphans.map(f => ({ abs: f.abs, pass01_path: toPass01FilePath(f.abs), size: f.size })),
    },
  };

  const outPath = path.join(ROOT, 'content/audit-reconciliation-report.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report written to: ${path.relative(ROOT, outPath)}`);
  console.log('Review AMBIGUOUS and MISSING entries before taking any action.');
}

main().catch(e => { console.error(e); process.exit(1); });
