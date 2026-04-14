#!/usr/bin/env node
/**
 * Deduplicate same-plant collision copies (_1, _2 suffix files).
 *
 * For each hash group where all assigned/ copies are in the same plant:
 *   - Fetch DB records for all paths in the group
 *   - Choose ONE keeper: prefer the DB-referenced canonical (no-suffix) path
 *   - For all other copies:
 *       if they have a DB record → delete the record (content still in keeper's record)
 *       delete the file
 *
 * Safe: never deletes a file that is the sole DB-referenced copy.
 * Warns if non-keeper records have non-default metadata (caption, rotation, variety).
 *
 * Usage:
 *   node scripts/dedup-same-plant.mjs --dry-run
 *   node scripts/dedup-same-plant.mjs
 */

import { readFileSync, existsSync, unlinkSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
for (const line of readFileSync(path.join(ROOT, 'review-ui', '.env'), 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const DRY_RUN = process.argv.includes('--dry-run');
const API_KEY = process.env.NOCODB_API_KEY;
const BASE_URL = 'https://nocodb.djjd.us';
const TABLE_IDS = JSON.parse(readFileSync(path.join(ROOT, 'content/parsed/nocodb_table_ids.json'), 'utf-8'));
const IMAGES_TABLE = TABLE_IDS['Images'];

if (!API_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }
if (DRY_RUN) console.log('[DRY RUN] No changes will be made.\n');

const PASS01_DIR = path.join(ROOT, 'content', 'pass_01');

// ── Build same-plant groups from duplicate report ─────────────────────────────

const REPORT = JSON.parse(readFileSync(path.join(ROOT, 'content', 'pass01-duplicates-report.json'), 'utf-8'));

const samePlantGroups = [];
for (const g of REPORT.groups) {
  const assigned = g.paths.filter(p => p.startsWith('assigned/'));
  if (assigned.length < 2) continue;
  const plants = [...new Set(assigned.map(p => p.split('/')[1]))];
  if (plants.length === 1) {
    samePlantGroups.push({ hash: g.hash, plant: plants[0], paths: assigned });
  }
}
console.log(`Same-plant duplicate groups: ${samePlantGroups.length}`);
console.log(`Extra copies to resolve:     ${samePlantGroups.reduce((s, g) => s + g.paths.length - 1, 0)}\n`);

// ── Fetch all DB records upfront ──────────────────────────────────────────────
// Build map: "content/pass_01/..." → record

console.log('Fetching all Images records from NocoDB...');
const dbByPath = new Map(); // dbPath → record
let page = 1;
const LIMIT = 1000;
while (true) {
  const qs = new URLSearchParams({
    fields: 'Id,File_Path,Caption,Rotation,Variety_Id,Attribution,Status',
    limit: String(LIMIT),
    offset: String((page - 1) * LIMIT),
    where: '(File_Path,like,content/pass_01/assigned/%)',
  });
  const res = await fetch(`${BASE_URL}/api/v2/tables/${IMAGES_TABLE}/records?${qs}`, {
    headers: { 'xc-token': API_KEY },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const d = await res.json();
  for (const rec of (d.list ?? [])) {
    if (rec.File_Path) dbByPath.set(rec.File_Path, rec);
  }
  if (!d.pageInfo?.isLastPage) { page++; } else { break; }
  process.stdout.write(`  Fetched ${dbByPath.size} records (page ${page - 1})...\r`);
}
console.log(`\nLoaded ${dbByPath.size} DB records\n`);

// ── Canonicality scoring (lower = more canonical) ────────────────────────────
// "foo.jpg" → 0, "foo_1.jpg" → 1, "foo_2.jpg" → 2, "foo_1_1.jpg" → 101, etc.

function canonScore(relPath) {
  const fname = relPath.split('/').pop();
  const ext = path.extname(fname);
  const base = fname.slice(0, fname.length - ext.length);
  // Count and sum _N suffix chains
  let score = 0, multiplier = 1;
  let b = base;
  while (true) {
    const m = b.match(/_(\d+)$/);
    if (!m) break;
    score += parseInt(m[1]) * multiplier;
    multiplier *= 100;
    b = b.slice(0, b.length - m[0].length);
  }
  return score;
}

function toDbPath(relFromPass01) {
  return 'content/pass_01/' + relFromPass01;
}

function toAbsPath(relFromPass01) {
  return path.join(PASS01_DIR, relFromPass01.replace(/\//g, path.sep));
}

// ── Process groups ────────────────────────────────────────────────────────────

let filesDeleted = 0, dbDeleted = 0, metaTransfers = 0, skipped = 0;

const deleteIds = [];   // batch NocoDB deletes
const deleteFiles = []; // filesystem paths to delete
const patchQueue = [];  // { id, fields } to apply to keeper records

const BATCH_SIZE = 100;

async function flushDeletes() {
  // Apply metadata patches to keepers first
  for (const { id, fields } of patchQueue) {
    if (DRY_RUN) {
      console.log(`  PATCH keeper id=${id} ${JSON.stringify(fields)}`);
    } else {
      const res = await fetch(`${BASE_URL}/api/v2/tables/${IMAGES_TABLE}/records`, {
        method: 'PATCH',
        headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Id: id, ...fields }),
      });
      if (!res.ok) throw new Error(`PATCH id=${id} failed: ${res.status}`);
    }
    metaTransfers++;
  }
  patchQueue.length = 0;

  if (!deleteIds.length) return;
  if (!DRY_RUN) {
    for (let i = 0; i < deleteIds.length; i += BATCH_SIZE) {
      const batch = deleteIds.slice(i, i + BATCH_SIZE);
      const res = await fetch(`${BASE_URL}/api/v2/tables/${IMAGES_TABLE}/records`, {
        method: 'DELETE',
        headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch.map(id => ({ Id: id }))),
      });
      if (!res.ok) throw new Error(`Bulk DELETE failed: ${res.status} ${await res.text()}`);
    }
  }
  dbDeleted += deleteIds.length;
  deleteIds.length = 0;

  if (!DRY_RUN) {
    for (const absPath of deleteFiles) {
      if (existsSync(absPath)) {
        try { unlinkSync(absPath); filesDeleted++; }
        catch (e) { console.warn(`  WARN unlink: ${e.message}`); }
      }
    }
  } else {
    filesDeleted += deleteFiles.length;
  }
  deleteFiles.length = 0;
}

function hasNonDefaultMeta(rec) {
  // Only flag rotation and variety — attribution is a default env value, safe to ignore
  if (rec.Rotation && rec.Rotation !== 0) return true;
  if (rec.Variety_Id) return true;
  return false;
}

let processed = 0;
for (const group of samePlantGroups) {
  // Sort by canonicality
  const sorted = [...group.paths].sort((a, b) => canonScore(a) - canonScore(b));

  // Find which paths have DB records
  const withRecord = sorted.filter(p => dbByPath.has(toDbPath(p)));
  const noRecord = sorted.filter(p => !dbByPath.has(toDbPath(p)));

  // Choose keeper: first DB-recorded canonical, or fallback to most canonical
  const keeper = withRecord[0] ?? sorted[0];

  // Non-keepers with DB records
  const toDeleteFromDb = withRecord.filter(p => p !== keeper);

  // For non-keeper records with rotation/variety: transfer to keeper before deleting
  const keeperRec = withRecord[0] ? dbByPath.get(toDbPath(keeper)) : null;
  const metaPatch = {};

  for (const p of toDeleteFromDb) {
    const rec = dbByPath.get(toDbPath(p));
    if (!rec) continue;
    if (hasNonDefaultMeta(rec)) {
      // Transfer metadata to keeper (only if keeper doesn't already have it)
      if (keeperRec) {
        if (rec.Rotation && (!keeperRec.Rotation || keeperRec.Rotation === 0)) metaPatch.Rotation = rec.Rotation;
        if (rec.Variety_Id && !keeperRec.Variety_Id) metaPatch.Variety_Id = rec.Variety_Id;
        console.log(`  TRANSFER id=${rec.Id}→${keeperRec.Id} rot=${rec.Rotation} var=${rec.Variety_Id} (${p})`);
      } else {
        console.warn(`  WARN metadata loss (no keeper record): id=${rec.Id} ${p} rot=${rec.Rotation} var=${rec.Variety_Id}`);
      }
    }
  }
  if (keeperRec && Object.keys(metaPatch).length > 0) {
    patchQueue.push({ id: keeperRec.Id, fields: metaPatch });
  }

  // Queue DB deletes for non-keeper records
  for (const p of toDeleteFromDb) {
    const rec = dbByPath.get(toDbPath(p));
    if (rec) deleteIds.push(rec.Id);
  }

  // Queue file deletes for all non-keepers (whether or not they had DB records)
  for (const p of sorted) {
    if (p === keeper) continue;
    // Verify keeper file exists on disk before deleting others
    if (!existsSync(toAbsPath(keeper))) {
      console.warn(`  WARN keeper not on disk, skipping group: ${keeper}`);
      skipped++;
      break;
    }
    deleteFiles.push(toAbsPath(p));
  }

  processed++;
  if (processed % 500 === 0 || processed === samePlantGroups.length) {
    process.stdout.write(`  Processing group ${processed}/${samePlantGroups.length}...\r`);
    await flushDeletes();
  }
}

await flushDeletes(); // final flush

console.log(`\n\n══════════════════════════════════════════════════`);
console.log(`Groups processed:    ${processed}`);
console.log(`Files deleted:       ${filesDeleted}`);
console.log(`DB records deleted:  ${dbDeleted}`);
console.log(`Metadata transfers:  ${metaTransfers}`);
console.log(`Groups skipped:      ${skipped}`);
if (DRY_RUN) console.log('\n[DRY RUN] Re-run without --dry-run to apply.');
else console.log('\nDone.');
