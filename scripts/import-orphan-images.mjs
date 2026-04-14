#!/usr/bin/env node
/**
 * Import orphan images from pass_01/assigned/ into NocoDB Images table.
 *
 * Orphans = files in pass_01/assigned/ with no existing DB record.
 * Uses the audit-reconciliation-report.json orphan list as the source.
 *
 * Directory → Plant_Id remaps handle mismatched slugs, renamed plants,
 * and newly-created plants. One special case (strawberry-guava) also
 * sets a Variety_Id.
 *
 * NocoDB auto-sets CreatedAt on insert, so records will sort as newest.
 *
 * Usage:
 *   node scripts/import-orphan-images.mjs --dry-run
 *   node scripts/import-orphan-images.mjs
 *   node scripts/import-orphan-images.mjs --plant=banana   # single plant
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
for (const line of readFileSync(path.join(ROOT, 'review-ui', '.env'), 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const DRY_RUN = process.argv.includes('--dry-run');
const PLANT_FILTER = (process.argv.find(a => a.startsWith('--plant=')) || '').split('=')[1] || null;

const API_KEY = process.env.NOCODB_API_KEY;
const BASE_URL = 'https://nocodb.djjd.us';
const TABLE_IDS = JSON.parse(readFileSync(path.join(ROOT, 'content/parsed/nocodb_table_ids.json'), 'utf-8'));
const IMAGES_TABLE = TABLE_IDS['Images'];
const VARIETIES_TABLE = TABLE_IDS['Varieties'];

if (!API_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }
if (DRY_RUN) console.log('[DRY RUN] No records will be created.\n');

// ── Directory slug → Plant_Id remaps ─────────────────────────────────────────
// Key: directory name in pass_01/assigned/
// Value: { plantId, varietyName? }
const DIR_REMAPS = {
  // Typo / rename
  'atamoya':            { plantId: 'atemoya' },
  'bael':               { plantId: 'bael-fruit' },
  'breadfruit':         { plantId: 'bread-fruit-ulu' },
  'cacao-fruit':        { plantId: 'cacao' },
  'Midyim Berry':       { plantId: 'midyim' },
  'pome':               { plantId: 'pomegranate' },
  'rangpur':            { plantId: 'rangpur-lime' },
  // Citrus subcategory → specific plant
  'citrus-(grapefruit)':{ plantId: 'grapefruit' },
  'citrus-(lemon)':     { plantId: 'lemon' },
  'citrus-(lime)':      { plantId: 'lime' },
  'citrus-(mandarin)':  { plantId: 'tangerine-mandarin' },
  'citrus-(orange)':    { plantId: 'orange' },
  // Botanical / spelling variants
  'dovyalis':           { plantId: 'tropical-apricot' },
  'carambola':          { plantId: 'star-fruit' },
  'longan':             { plantId: 'longon' },
  'ackee':              { plantId: 'akee' },
  // Variety assignment
  'strawberry-guava':   { plantId: 'guava', varietyName: 'Strawberry' },
  // New plants (slugs match, listed for clarity)
  'achacha':            { plantId: 'achacha' },
  'button-mangosteen':  { plantId: 'button-mangosteen' },
  'canistel':           { plantId: 'canistel' },
  'chuo-ume-plum':      { plantId: 'chuo-ume-plum' },
  'Chuo Ume Plum':      { plantId: 'chuo-ume-plum' },
  'jiringa':            { plantId: 'jiringa' },
  'jujube':             { plantId: 'jujube' },
  'lemon-drop-mangosteen': { plantId: 'lemon-drop-mangosteen' },
  'mamoncillo':         { plantId: 'mamoncillo' },
  'naranjilla':         { plantId: 'naranjilla' },
  'peanut-butter-fruit':{ plantId: 'peanut-butter-fruit' },
  'peach-palm':         { plantId: 'peach-palm' },
  'pepino':             { plantId: 'pepino' },
  'pulasan':            { plantId: 'pulasan' },
  'snake-fruit':        { plantId: 'snake-fruit' },
  'wax-jambu':          { plantId: 'wax-jambu' },
  'yuzu':               { plantId: 'yuzu' },
};

// ── NocoDB helpers ────────────────────────────────────────────────────────────

async function nocoFind(tableId, where, fields = 'Id') {
  const qs = new URLSearchParams({ where, fields, limit: '1' });
  const res = await fetch(`${BASE_URL}/api/v2/tables/${tableId}/records?${qs}`, {
    headers: { 'xc-token': API_KEY },
  });
  if (!res.ok) throw new Error(`Query failed: ${res.status}`);
  const d = await res.json();
  return d.list?.[0] ?? null;
}

async function nocoBulkCreate(tableId, rows) {
  const res = await fetch(`${BASE_URL}/api/v2/tables/${tableId}/records`, {
    method: 'POST',
    headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Bulk create failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Variety lookup cache ──────────────────────────────────────────────────────
const varietyCache = new Map(); // "plantId:varietyName" → varietyId

async function lookupVarietyId(plantId, varietyName) {
  const key = `${plantId}:${varietyName}`;
  if (varietyCache.has(key)) return varietyCache.get(key);
  const rec = await nocoFind(
    VARIETIES_TABLE,
    `(Plant_Id,eq,${plantId})~and(Variety_Name,eq,${varietyName})`,
    'Id'
  );
  const id = rec?.Id ?? null;
  varietyCache.set(key, id);
  return id;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function captionFromPath(filePath) {
  return filePath.split('/').pop().replace(/\.\w+$/, '').replace(/[_-]/g, ' ');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const report = JSON.parse(readFileSync(path.join(ROOT, 'content/audit-reconciliation-report.json'), 'utf-8'));
  let orphans = report.records.ORPHAN;

  if (PLANT_FILTER) {
    orphans = orphans.filter(o => o.pass01_path.split('/')[3] === PLANT_FILTER);
    console.log(`Filtered to plant "${PLANT_FILTER}": ${orphans.length} orphans\n`);
  } else {
    console.log(`Total orphans to import: ${orphans.length}\n`);
  }

  // Group by directory slug
  const byDir = new Map();
  for (const o of orphans) {
    const dir = o.pass01_path.split('/')[3];
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(o);
  }

  let totalCreated = 0, totalSkipped = 0, totalMissing = 0;
  const unknownDirs = [];

  for (const [dir, files] of [...byDir.entries()].sort()) {
    const remap = DIR_REMAPS[dir];
    const plantId = remap?.plantId ?? dir; // default: use dir as-is (already a valid slug)
    const varietyName = remap?.varietyName ?? null;

    // Resolve variety ID if needed
    let varietyId = null;
    if (varietyName) {
      varietyId = await lookupVarietyId(plantId, varietyName);
      if (!varietyId) {
        console.warn(`  ⚠ Variety "${varietyName}" not found for plant "${plantId}" — importing without variety`);
      }
    }

    // Filter to files that actually exist on disk
    const existing = files.filter(f => existsSync(path.join(ROOT, f.pass01_path.replace(/\//g, path.sep))));
    const notOnDisk = files.length - existing.length;
    if (notOnDisk > 0) totalMissing += notOnDisk;

    if (!existing.length) continue;

    console.log(`${dir} → ${plantId}${varietyName ? ' [variety: ' + varietyName + ']' : ''} (${existing.length} files)`);

    const records = existing.map(f => ({
      File_Path: f.pass01_path,
      Plant_Id: plantId,
      Caption: captionFromPath(f.pass01_path),
      Source_Directory: f.pass01_path.split('/').slice(0, -1).join('/'),
      Size_Bytes: f.size,
      Status: 'assigned',
      Excluded: false,
      Needs_Review: false,
      Variety_Id: varietyId ?? null,
      Attribution: null,
    }));

    if (!DRY_RUN) {
      const BATCH = 100;
      for (let i = 0; i < records.length; i += BATCH) {
        await nocoBulkCreate(IMAGES_TABLE, records.slice(i, i + BATCH));
        process.stdout.write(`  inserted ${Math.min(i + BATCH, records.length)}/${records.length}\r`);
      }
      console.log(`  ✓ ${records.length} records created`);
    } else {
      console.log(`  [DRY RUN] would create ${records.length} records`);
    }

    totalCreated += records.length;
    totalSkipped += files.length - existing.length;
  }

  console.log('\n══════════════════════════════════════');
  console.log(`Records created:    ${totalCreated}`);
  console.log(`Not on disk:        ${totalMissing}`);
  if (unknownDirs.length) console.log(`Unknown dirs:       ${unknownDirs.join(', ')}`);
  if (DRY_RUN) console.log('\n[DRY RUN] Re-run without --dry-run to apply.');
  else console.log('\nDone. NocoDB CreatedAt auto-set to now — sort by Newest to see imports.');
}

main().catch(e => { console.error(e); process.exit(1); });
