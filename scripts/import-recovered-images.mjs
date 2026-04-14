#!/usr/bin/env node
/**
 * Import recovered images into NocoDB.
 *
 * Scans pass_01/assigned/{slug}/images/ for all files,
 * fetches existing DB file paths for each plant,
 * and creates records for any file NOT already in the database.
 *
 * Usage:
 *   node scripts/import-recovered-images.mjs              # live run
 *   node scripts/import-recovered-images.mjs --dry-run    # preview only
 *   node scripts/import-recovered-images.mjs --plant=avocado  # single plant
 */

import { readdirSync, statSync, readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

// Load review-ui/.env manually (no dotenv dependency)
const envPath = path.join(ROOT, 'review-ui', '.env');
for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const DRY_RUN = process.argv.includes('--dry-run');
const PLANT_FILTER = (() => {
  const arg = process.argv.find(a => a.startsWith('--plant='));
  return arg ? arg.split('=')[1] : null;
})();

const API_KEY = process.env.NOCODB_API_KEY;
const BASE_URL = 'https://nocodb.djjd.us';
const TABLE_IDS = JSON.parse(readFileSync(path.join(ROOT, 'content/parsed/nocodb_table_ids.json'), 'utf-8'));
const IMAGES_TABLE = TABLE_IDS['Images'];
const ASSIGNED_DIR = path.join(ROOT, 'content/pass_01/assigned');
// content/ is one level down from ROOT, so File_Path prefix is "content/pass_01/assigned/..."
const CONTENT_ROOT = path.join(ROOT); // File_Path = path relative to this but prefixed with "content/"

if (!API_KEY) { console.error('NOCODB_API_KEY not set in review-ui/.env'); process.exit(1); }
if (DRY_RUN) console.log('[DRY RUN] No records will be created.\n');

// ── NocoDB helpers ────────────────────────────────────────────────────────────

async function nocoList(tableId, params = {}) {
  const qs = new URLSearchParams();
  if (params.where) qs.set('where', params.where);
  if (params.fields) qs.set('fields', params.fields);
  qs.set('limit', String(params.limit ?? 1000));
  qs.set('offset', String(params.offset ?? 0));
  const res = await fetch(`${BASE_URL}/api/v2/tables/${tableId}/records?${qs}`, {
    headers: { 'xc-token': API_KEY },
  });
  if (!res.ok) throw new Error(`NocoDB list failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function nocoListAll(tableId, params = {}) {
  const all = [];
  let offset = 0;
  while (true) {
    const data = await nocoList(tableId, { ...params, offset });
    all.push(...data.list);
    if (!data.pageInfo?.isLastPage) { offset += data.list.length; } else break;
  }
  return all;
}

async function nocoBulkCreate(tableId, rows) {
  const res = await fetch(`${BASE_URL}/api/v2/tables/${tableId}/records`, {
    method: 'POST',
    headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`NocoDB bulk create failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── File helpers ──────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff']);

function walkImages(dir) {
  const results = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { results.push(...walkImages(full)); continue; }
      if (IMAGE_EXTS.has(path.extname(e.name).toLowerCase())) {
        const st = statSync(full);
        results.push({ abs: full, size: st.size });
      }
    }
  } catch { /* skip */ }
  return results;
}

/** Convert absolute path to the File_Path format stored in DB: "content/pass_01/assigned/..." */
function toFilePath(abs) {
  return 'content/' + path.relative(path.join(ROOT, 'content'), abs).split(path.sep).join('/');
}

/**
 * Normalize a File_Path to its slug-relative form for dedup comparison.
 * Strips all known prefixes so both old (parsed/) and new (pass_01/) paths
 * compare equal when they refer to the same file.
 * e.g. "content/parsed/plants/avocado/images/foo.jpg" → "avocado/images/foo.jpg"
 *      "content/pass_01/assigned/avocado/images/foo.jpg" → "avocado/images/foo.jpg"
 */
function normalizeImagePath(p) {
  return p
    .replace(/^content\/pass_01\/assigned\//, '')
    .replace(/^content\/parsed\/plants\//, '')
    .replace(/^content\/parsed\//, '')
    .replace(/^content\//, '')
    .replace(/^pass_01\/assigned\//, '')
    .replace(/^assigned\//, '')
    .replace(/^plants\//, '')
    .toLowerCase();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Get list of plant slug directories
  let slugDirs;
  try {
    slugDirs = readdirSync(ASSIGNED_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch (e) {
    console.error('Cannot read assigned dir:', e.message);
    process.exit(1);
  }

  if (PLANT_FILTER) {
    slugDirs = slugDirs.filter(s => s === PLANT_FILTER);
    if (!slugDirs.length) { console.error(`Plant "${PLANT_FILTER}" not found`); process.exit(1); }
  }

  console.log(`Scanning ${slugDirs.length} plant directories...\n`);

  let totalNew = 0, totalSkipped = 0, totalPlants = 0;

  for (const slug of slugDirs) {
    const imagesDir = path.join(ASSIGNED_DIR, slug, 'images');
    const diskFiles = walkImages(imagesDir);
    if (!diskFiles.length) continue;

    // Fetch existing DB file paths for this plant (only File_Path field)
    const existing = await nocoListAll(IMAGES_TABLE, {
      where: `(Plant_Id,eq,${slug})`,
      fields: 'File_Path',
    });
    // Normalize DB paths so old parsed/ and new pass_01/ paths compare equal
    const existingNorm = new Set(existing.map(r => normalizeImagePath(r.File_Path)));

    // Find files on disk not in DB (using normalized path comparison)
    const newFiles = diskFiles.filter(f => !existingNorm.has(normalizeImagePath(toFilePath(f.abs))));

    if (!newFiles.length) {
      totalSkipped += diskFiles.length;
      continue;
    }

    totalPlants++;
    console.log(`${slug}: ${diskFiles.length} on disk, ${existing.length} in DB → ${newFiles.length} new`);

    const records = newFiles.map(f => {
      const filePath = toFilePath(f.abs);
      const filename = path.basename(f.abs);
      const relDir = 'pass_01/' + path.relative(path.join(ROOT, 'content/pass_01'), path.dirname(f.abs)).split(path.sep).join('/');
      const caption = filename.replace(/\.\w+$/, '').replace(/[_-]/g, ' ');
      return {
        File_Path: filePath,
        Plant_Id: slug,
        Caption: caption,
        Source_Directory: relDir,
        Size_Bytes: f.size,
        Status: 'assigned',
        Excluded: false,
        Needs_Review: false,
        Variety_Id: null,
        Attribution: null,
      };
    });

    if (!DRY_RUN) {
      // Batch insert in groups of 100
      const BATCH = 100;
      for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH);
        await nocoBulkCreate(IMAGES_TABLE, batch);
        process.stdout.write(`  inserted ${Math.min(i + BATCH, records.length)}/${records.length}\r`);
      }
      console.log(`  ✓ inserted ${records.length} records`);
    } else {
      console.log(`  [DRY RUN] would insert ${records.length} records`);
      records.slice(0, 3).forEach(r => console.log(`    ${r.File_Path}`));
      if (records.length > 3) console.log(`    ... and ${records.length - 3} more`);
    }

    totalNew += newFiles.length;
    totalSkipped += diskFiles.length - newFiles.length;
  }

  console.log('\n══════════════════════════════════════');
  console.log(`Plants with new images: ${totalPlants}`);
  console.log(`New records created:    ${totalNew}`);
  console.log(`Already in DB:          ${totalSkipped}`);
  if (DRY_RUN) console.log('\n[DRY RUN] Re-run without --dry-run to create records.');
  else console.log('\nDone. Restart the server and check the plant browser.');
}

main().catch(e => { console.error(e); process.exit(1); });
