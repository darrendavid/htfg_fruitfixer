/**
 * Recover images from a plant folder whose NocoDB records were deleted.
 * Re-imports each image as Status='triage', Plant_Id=null, ready for reassignment.
 *
 * Usage: node scripts/recover-unassigned-images.mjs <plant-slug>
 *   e.g. node scripts/recover-unassigned-images.mjs bread-fruit-ulu
 */

import { readdirSync, statSync } from 'fs';
import path from 'path';
import { config } from 'dotenv';

config({ path: path.join(import.meta.dirname, '..', 'review-ui', '.env') });

const ROOT         = path.resolve(import.meta.dirname, '..');
const PASS01_ROOT  = path.join(ROOT, 'content', 'pass_01');
const NOCODB_URL   = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY   = process.env.NOCODB_API_KEY;
const TABLE_IDS    = JSON.parse(await import('fs').then(f => f.promises.readFile(
  path.join(ROOT, 'content', 'parsed', 'nocodb_table_ids.json'), 'utf-8'
)));

if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const slug = process.argv[2];
if (!slug) { console.error('Usage: node recover-unassigned-images.mjs <plant-slug>'); process.exit(1); }

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tif', '.tiff', '.bmp']);

// ── Find image files in the plant's assigned folder ──────────────────────────
const assignedDir = path.join(PASS01_ROOT, 'assigned', slug, 'images');
let files;
try {
  files = readdirSync(assignedDir);
} catch {
  console.error(`Directory not found: ${assignedDir}`);
  process.exit(1);
}

const imageFiles = files.filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()));
console.log(`Found ${imageFiles.length} image files in ${assignedDir}\n`);
if (imageFiles.length === 0) process.exit(0);

// ── Check which are already in NocoDB ────────────────────────────────────────
const tableId = TABLE_IDS['Images'];

async function nocoGet(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${NOCODB_URL}/api/v2/tables/${tableId}/records?${qs}`;
  const res = await fetch(url, { headers: { 'xc-token': NOCODB_KEY } });
  if (!res.ok) throw new Error(`GET Images: ${res.status} ${await res.text()}`);
  return res.json();
}

async function nocoCreate(records) {
  const url = `${NOCODB_URL}/api/v2/tables/${tableId}/records`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(records),
  });
  if (!res.ok) throw new Error(`POST Images: ${res.status} ${await res.text()}`);
  return res.json();
}

// Check existing records by File_Path
const existing = new Set();
for (const filename of imageFiles) {
  const relPath = `content/pass_01/assigned/${slug}/images/${filename}`.replace(/\\/g, '/');
  const check = await nocoGet({ where: `(File_Path,eq,${relPath})`, fields: 'Id', limit: 1 });
  if (check.list?.length > 0) existing.add(filename);
}

const toCreate = imageFiles.filter(f => !existing.has(f));
console.log(`Already in NocoDB: ${existing.size}`);
console.log(`To recover: ${toCreate.length}\n`);

if (toCreate.length === 0) {
  console.log('Nothing to recover.');
  process.exit(0);
}

// ── Re-import missing images ──────────────────────────────────────────────────
const BATCH = 25;
let created = 0;

for (let i = 0; i < toCreate.length; i += BATCH) {
  const batch = toCreate.slice(i, i + BATCH);
  const records = batch.map(filename => {
    const abs = path.join(assignedDir, filename);
    const size = statSync(abs).size;
    const relPath = `content/pass_01/assigned/${slug}/images/${filename}`.replace(/\\/g, '/');
    return {
      File_Path: relPath,
      Plant_Id: null,
      Variety_Id: null,
      Status: 'triage',
      Size_Bytes: size,
      Excluded: false,
    };
  });

  try {
    await nocoCreate(records);
    created += records.length;
    for (const r of records) console.log(`  Created: ${r.File_Path}`);
  } catch (err) {
    console.error(`  Batch failed: ${err.message}`);
  }
}

console.log(`\nDone. Recovered ${created} image(s) as Status='triage', Plant_Id=null.`);
console.log(`They will appear in the Triage tab on /classify.`);
