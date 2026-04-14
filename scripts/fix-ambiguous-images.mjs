#!/usr/bin/env node
/**
 * Fix the 66 AMBIGUOUS image records identified by audit-image-reconciliation.mjs
 *
 * Group 1 — 25 thumbnails (db_size < 100KB):
 *   Update DB File_Path to pass_01 full-res version. No new record needed.
 *
 * Group 2+3 — 41 full-res pairs (both >= 100KB, different files):
 *   Update DB File_Path to pass_01 version (matches what server currently serves).
 *   Create new DB record for the parsed/ version (different photo, worth keeping).
 *
 * Usage:
 *   node scripts/fix-ambiguous-images.mjs --dry-run
 *   node scripts/fix-ambiguous-images.mjs
 */

import { existsSync, statSync, readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

// Load env
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

// ── NocoDB helpers ────────────────────────────────────────────────────────────

async function nocoGet(tableId, id) {
  const res = await fetch(`${BASE_URL}/api/v2/tables/${tableId}/records/${id}`, {
    headers: { 'xc-token': API_KEY },
  });
  if (!res.ok) throw new Error(`GET ${id} failed: ${res.status}`);
  return res.json();
}

async function nocoUpdate(tableId, id, fields) {
  const res = await fetch(`${BASE_URL}/api/v2/tables/${tableId}/records`, {
    method: 'PATCH',
    headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Id: id, ...fields }),
  });
  if (!res.ok) throw new Error(`PATCH ${id} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function nocoCreate(tableId, fields) {
  const res = await fetch(`${BASE_URL}/api/v2/tables/${tableId}/records`, {
    method: 'POST',
    headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`POST failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CONTENT_DIR = path.join(ROOT, 'content');
const ASSIGNED_DIR = path.join(ROOT, 'content/pass_01/assigned');

function resolveAbs(filePath) {
  return path.join(ROOT, filePath.replace(/\//g, path.sep));
}

function toFilePath(abs) {
  return 'content/' + path.relative(CONTENT_DIR, abs).split(path.sep).join('/');
}

/** Find the pass_01 counterpart of a parsed/ File_Path */
function findPass01File(parsedFilePath) {
  // e.g. content/parsed/plants/banana/images/balbisiana1.jpg
  //   → content/pass_01/assigned/banana/images/balbisiana1.jpg
  const rel = parsedFilePath
    .replace(/^content\/parsed\/plants\//, '')
    .replace(/^content\/parsed\//, '');
  const abs = path.join(ASSIGNED_DIR, rel);
  if (existsSync(abs)) return abs;
  return null;
}

function captionFromPath(filePath) {
  const name = filePath.split('/').pop() || '';
  return name.replace(/\.\w+$/, '').replace(/[_-]/g, ' ');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const report = JSON.parse(readFileSync(path.join(ROOT, 'content/audit-reconciliation-report.json'), 'utf-8'));
  const ambiguous = report.records.AMBIGUOUS;

  console.log(`Processing ${ambiguous.length} ambiguous records...\n`);

  let updatedCount = 0;
  let createdCount = 0;
  let errorCount = 0;

  for (const rec of ambiguous) {
    const dbSize = rec.db_size;
    const pass01Size = rec.pass01_sizes[0];
    const isThumbInDb = dbSize !== null && dbSize < 100_000;

    // Find pass_01 counterpart
    const pass01Abs = findPass01File(rec.file_path);
    if (!pass01Abs) {
      console.error(`  ✗ SKIP ${rec.file_path} — pass_01 file not found`);
      errorCount++;
      continue;
    }
    const pass01FilePath = toFilePath(pass01Abs);

    if (isThumbInDb) {
      // ── Group 1: thumbnail in DB, full-res in pass_01 ──────────────────────
      // Just update DB record to point to the full-res pass_01 version.
      console.log(`  THUMB  id=${rec.id} ${rec.plant}/${path.basename(rec.file_path)}`);
      console.log(`         db: ${(dbSize/1024).toFixed(0)}KB → pass_01: ${(pass01Size/1024).toFixed(0)}KB`);
      console.log(`         update File_Path → ${pass01FilePath}`);

      if (!DRY_RUN) {
        await nocoUpdate(IMAGES_TABLE, rec.id, { File_Path: pass01FilePath });
      }
      updatedCount++;

    } else {
      // ── Group 2+3: both full-res, different photos ──────────────────────────
      // Update DB record to pass_01 path (matches what server serves today).
      // Create new record for the parsed/ version.
      const parsedAbs = resolveAbs(rec.file_path);
      const parsedExists = existsSync(parsedAbs);

      console.log(`  PAIR   id=${rec.id} ${rec.plant}/${path.basename(rec.file_path)}`);
      console.log(`         db(parsed): ${(dbSize/1024).toFixed(0)}KB  pass_01: ${(pass01Size/1024).toFixed(0)}KB`);
      console.log(`         update id=${rec.id} File_Path → ${pass01FilePath}`);

      if (!DRY_RUN) {
        await nocoUpdate(IMAGES_TABLE, rec.id, { File_Path: pass01FilePath });
      }
      updatedCount++;

      if (parsedExists) {
        // Fetch the full record to copy relevant metadata fields
        const fullRec = DRY_RUN ? { Caption: rec.caption, Plant_Id: rec.plant } : await nocoGet(IMAGES_TABLE, rec.id);
        const parsedSize = statSync(parsedAbs).size;
        const newRecord = {
          File_Path: rec.file_path, // original parsed/ path
          Plant_Id: rec.plant,
          Caption: (fullRec.Caption || captionFromPath(rec.file_path)) + ' (original)',
          Source_Directory: rec.file_path.split('/').slice(0, -1).join('/'),
          Size_Bytes: parsedSize,
          Status: 'assigned',
          Excluded: false,
          Needs_Review: false,
          // Don't copy Variety_Id or Rotation — generic DSCN/DSC captions have none
          Variety_Id: null,
          Attribution: null,
        };
        console.log(`         create new record for parsed/ version (${(parsedSize/1024).toFixed(0)}KB)`);

        if (!DRY_RUN) {
          await nocoCreate(IMAGES_TABLE, newRecord);
        }
        createdCount++;
      } else {
        console.log(`         parsed/ file no longer on disk — skip create`);
      }
    }
    console.log();
  }

  console.log('══════════════════════════════════════');
  console.log(`DB records updated:  ${updatedCount}`);
  console.log(`New records created: ${createdCount}`);
  console.log(`Errors/skipped:      ${errorCount}`);
  if (DRY_RUN) console.log('\n[DRY RUN] Re-run without --dry-run to apply.');
  else console.log('\nDone. Re-run audit to confirm 0 AMBIGUOUS remain.');
}

main().catch(e => { console.error(e); process.exit(1); });
