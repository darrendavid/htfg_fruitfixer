/**
 * hash-triage-images.mjs
 *
 * Computes dHash (64-bit perceptual hash) + pixel dimensions for all triage
 * images that currently have no Perceptual_Hash in NocoDB.
 * Updates NocoDB Images records with: Perceptual_Hash, Size_Bytes (from disk).
 * Writes a sidecar JSON with Id → { hash, width, height, size } for use by
 * the swap-candidates comparison script.
 *
 * Run: node scripts/hash-triage-images.mjs
 */

import { readFileSync, writeFileSync, statSync, existsSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: 'review-ui/.env' });

const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const IDS  = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const H    = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };
const ROOT = process.cwd();

const norm   = p => p?.replace(/\\/g, '/') || '';
const absImg = fp => path.join(ROOT, norm(fp).replace(/^content\//, 'content/'));

// ── Sharp dHash ────────────────────────────────────────────────────────────────
// Resize to 9×8, grayscale → compare adjacent columns per row → 64-bit hex

import sharp from 'sharp';

async function computeDHash(filePath) {
  try {
    const { data, info } = await sharp(filePath)
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let bits = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const idx = row * 9 + col;
        bits += data[idx] < data[idx + 1] ? '1' : '0';
      }
    }
    // Convert 64 bits → 16 hex chars
    let hex = '';
    for (let i = 0; i < 64; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch { return null; }
}

async function getDimensions(filePath) {
  try {
    const meta = await sharp(filePath).metadata();
    return { width: meta.width || 0, height: meta.height || 0 };
  } catch { return { width: 0, height: 0 }; }
}

// ── NocoDB helpers ─────────────────────────────────────────────────────────────

async function fetchAll(where, fields) {
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      limit: '200', offset: String(offset),
      where, fields: fields.join(','),
    });
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS.Images}/records?${params}`, { headers: H });
    if (!r.ok) throw new Error(`fetch failed ${r.status}`);
    const d = await r.json();
    all.push(...(d.list ?? []));
    if (d.pageInfo?.isLastPage) break;
    offset += 200;
  }
  return all;
}

async function bulkUpdate(records) {
  const BATCH = 100;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS.Images}/records`, {
      method: 'PATCH', headers: H, body: JSON.stringify(batch),
    });
    if (!r.ok) console.error(`bulkUpdate batch ${i}: ${await r.text()}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

console.log('\n=== hash triage images ===\n');

// Fetch ALL triage images (with and without hash) so we can build complete sidecar
console.log('Fetching triage images…');
const allTriage = await fetchAll(
  '(Status,eq,triage)',
  ['Id', 'File_Path', 'Size_Bytes', 'Perceptual_Hash', 'Plant_Id', 'Variety_Id'],
);
console.log(`  ${allTriage.length} total triage images`);

const needHash  = allTriage.filter(r => !r.Perceptual_Hash);
const hasHash   = allTriage.filter(r =>  r.Perceptual_Hash);
console.log(`  ${needHash.length} need hashing, ${hasHash.length} already hashed\n`);

// Process unhashed images
const updates  = [];
const sidecar  = {};   // Id → { hash, width, height, size, file_path, plant_id, variety_id }

// Seed sidecar with already-hashed records (no dimensions available for those)
for (const r of hasHash) {
  const fp  = norm(r.File_Path || '');
  let size  = r.Size_Bytes;
  const abs = absImg(fp);
  try { if (existsSync(abs)) size = statSync(abs).size; } catch {}
  sidecar[r.Id] = {
    hash: r.Perceptual_Hash,
    width: null, height: null,   // unknown — not reading assigned images
    size,
    file_path: fp,
    plant_id: r.Plant_Id,
    variety_id: r.Variety_Id,
  };
}

let done = 0, errors = 0;
process.stdout.write(`Hashing ${needHash.length} images`);

for (const rec of needHash) {
  const fp  = norm(rec.File_Path || '');
  const abs = absImg(fp);

  if (!existsSync(abs)) {
    errors++;
    sidecar[rec.Id] = { hash: null, width: 0, height: 0, size: 0, file_path: fp, plant_id: rec.Plant_Id, variety_id: rec.Variety_Id };
    continue;
  }

  const [hash, dims] = await Promise.all([computeDHash(abs), getDimensions(abs)]);
  let size = rec.Size_Bytes;
  try { size = statSync(abs).size; } catch {}

  sidecar[rec.Id] = {
    hash,
    width:  dims.width,
    height: dims.height,
    pixels: dims.width * dims.height,
    size,
    file_path: fp,
    plant_id: rec.Plant_Id,
    variety_id: rec.Variety_Id,
  };

  if (hash) {
    updates.push({ Id: rec.Id, Perceptual_Hash: hash, Size_Bytes: size });
  }

  done++;
  if (done % 50 === 0) process.stdout.write(` ${done}`);
}
process.stdout.write('\n');

console.log(`  Hashed: ${done - errors}, Errors: ${errors}`);

// Write sidecar for comparison script
const sidecarPath = 'content/backups/triage-hashes.json';
writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));
console.log(`  Sidecar written: ${sidecarPath}`);

// Bulk-update NocoDB
console.log(`\nUpdating ${updates.length} NocoDB records…`);
await bulkUpdate(updates);
console.log('  done');

console.log('\n=== SUMMARY ===');
console.log(`  Newly hashed:      ${updates.length}`);
console.log(`  Already had hash:  ${hasHash.length}`);
console.log(`  File not found:    ${errors}`);
console.log(`  Sidecar:           ${sidecarPath}`);
