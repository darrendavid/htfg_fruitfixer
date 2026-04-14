#!/usr/bin/env node
/**
 * Fix DB records that still reference content/parsed/ paths.
 *
 * OK_PARSED (760):  File already exists in pass_01/assigned/ — just update File_Path in DB.
 * PARSED_ONLY (4809): File only in parsed/ — copy to pass_01/assigned/ then update DB.
 *
 * Usage:
 *   node scripts/fix-parsed-paths.mjs --dry-run
 *   node scripts/fix-parsed-paths.mjs
 */

import { readFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'fs';
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
const CONTENT_DIR = path.join(ROOT, 'content');
const ASSIGNED_DIR = path.join(ROOT, 'content/pass_01/assigned');

if (!API_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }
if (DRY_RUN) console.log('[DRY RUN] No changes will be made.\n');

// ── NocoDB ────────────────────────────────────────────────────────────────────

async function nocoBulkUpdate(tableId, rows) {
  // NocoDB bulk PATCH: array of { Id, ...fields }
  const res = await fetch(`${BASE_URL}/api/v2/tables/${tableId}/records`, {
    method: 'PATCH',
    headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Bulk PATCH failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toFilePath(abs) {
  return 'content/' + path.relative(CONTENT_DIR, abs).split(path.sep).join('/');
}

function safeDestPath(destDir, filename) {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  let candidate = path.join(destDir, filename);
  if (!existsSync(candidate)) return candidate;
  for (let i = 1; i < 1000; i++) {
    candidate = path.join(destDir, `${base}_${i}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`No free slot for ${filename} in ${destDir}`);
}

const BATCH = 100;

async function flushUpdates(updates) {
  if (!updates.length) return;
  if (!DRY_RUN) {
    for (let i = 0; i < updates.length; i += BATCH) {
      await nocoBulkUpdate(IMAGES_TABLE, updates.slice(i, i + BATCH));
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const report = JSON.parse(readFileSync(path.join(ROOT, 'content/audit-reconciliation-report.json'), 'utf-8'));

  // ── Step 1: OK_PARSED — update stale File_Path (file already in pass_01) ───
  console.log(`══ Step 1: OK_PARSED — update ${report.records.OK_PARSED.length} stale paths ══\n`);

  const okUpdates = [];
  let okSkipped = 0;

  for (const rec of report.records.OK_PARSED) {
    if (!rec.new_path) { okSkipped++; continue; }
    okUpdates.push({ Id: rec.id, File_Path: rec.new_path });
    if (DRY_RUN && okUpdates.length <= 5) {
      console.log(`  id=${rec.id}  ${rec.old_path.split('/').slice(-3).join('/')}`);
      console.log(`        → ${rec.new_path.split('/').slice(-3).join('/')}`);
    }
  }

  if (DRY_RUN) {
    if (okUpdates.length > 5) console.log(`  ... and ${okUpdates.length - 5} more`);
    console.log(`\n  [DRY RUN] would update ${okUpdates.length} records`);
  } else {
    await flushUpdates(okUpdates);
    console.log(`  ✓ Updated ${okUpdates.length} File_Path values`);
  }
  if (okSkipped) console.log(`  Skipped ${okSkipped} (no new_path in report)`);

  // ── Step 2: PARSED_ONLY — copy file then update DB ─────────────────────────
  console.log(`\n══ Step 2: PARSED_ONLY — copy + update ${report.records.PARSED_ONLY.length} records ══\n`);

  let copied = 0, copySkipped = 0, dbUpdates = [];

  for (const rec of report.records.PARSED_ONLY) {
    const srcAbs = rec.parsed_abs
      ? rec.parsed_abs.replace(/\//g, path.sep)
      : path.join(ROOT, rec.file_path.replace(/\//g, path.sep));

    if (!rec.plant) {
      console.warn(`  SKIP (no Plant_Id) id=${rec.id}  ${rec.file_path}`);
      copySkipped++;
      continue;
    }

    if (!existsSync(srcAbs)) {
      console.warn(`  SKIP (not on disk) id=${rec.id}  ${rec.file_path}`);
      copySkipped++;
      continue;
    }

    // Destination: pass_01/assigned/{plant}/images/{filename}
    const filename = path.basename(srcAbs);
    const destDir = path.join(ASSIGNED_DIR, rec.plant, 'images');
    const destAbs = safeDestPath(destDir, filename);
    const newFilePath = toFilePath(destAbs);

    if (!DRY_RUN) {
      mkdirSync(destDir, { recursive: true });
      copyFileSync(srcAbs, destAbs);
    }
    copied++;
    dbUpdates.push({ Id: rec.id, File_Path: newFilePath });

    // Flush DB in batches
    if (dbUpdates.length >= BATCH) {
      if (!DRY_RUN) await nocoBulkUpdate(IMAGES_TABLE, dbUpdates);
      process.stdout.write(`  ${copied} copied, ${dbUpdates.length} DB updates flushed...\r`);
      dbUpdates = [];
    }
  }

  // Final flush
  if (dbUpdates.length) {
    if (!DRY_RUN) await nocoBulkUpdate(IMAGES_TABLE, dbUpdates);
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] would copy ${copied} files and update ${copied} DB records`);
    console.log(`  Skipped (not on disk): ${copySkipped}`);
  } else {
    console.log(`\n  ✓ Copied ${copied} files to pass_01/assigned/`);
    console.log(`  ✓ Updated ${copied} File_Path values in DB`);
    console.log(`  Skipped (not on disk): ${copySkipped}`);
  }

  console.log('\n══════════════════════════════════════');
  console.log(`Step 1 (path updates):  ${okUpdates.length}`);
  console.log(`Step 2 (copy + update): ${copied}`);
  console.log(`Total not on disk:      ${okSkipped + copySkipped}`);
  if (DRY_RUN) console.log('\n[DRY RUN] Re-run without --dry-run to apply.');
  else console.log('\nDone. All DB records now reference pass_01/ paths.');
}

main().catch(e => { console.error(e); process.exit(1); });
