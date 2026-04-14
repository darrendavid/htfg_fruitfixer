/**
 * import-orphan-originals.mjs
 *
 * Imports unmatched images and PSD files from content/source/original/
 * into NocoDB and copies them into pass_02.
 *
 *   Images → pass_02/triage/{basename}           → Images table, Status=triage
 *   PSDs   → pass_02/documents/psd/{basename}    → BinaryDocuments table, Status=triage
 *
 * Original_Filepath is set on every record.
 * Handles filename collisions with _1, _2 suffixes.
 *
 * Run: node scripts/import-orphan-originals.mjs
 */

import { readFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import dotenv from 'dotenv';
dotenv.config({ path: 'review-ui/.env' });

const NOCODB_URL = 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const IDS  = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const H    = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };
const ROOT = process.cwd();

const TRIAGE_DIR = path.join(ROOT, 'content/pass_02/triage');
const PSD_DIR    = path.join(ROOT, 'content/pass_02/documents/psd');

// Load reconciliation report (most recent)
import { readdirSync } from 'fs';
const reportsDir = path.join(ROOT, 'content/backups');
const reportFile = readdirSync(reportsDir)
  .filter(f => f.startsWith('original-nocodb-reconciliation-') && f.endsWith('.json'))
  .sort().pop();
if (!reportFile) { console.error('No reconciliation report found — run audit-original-vs-nocodb.mjs first'); process.exit(1); }
console.log(`Using report: ${reportFile}`);
const report = JSON.parse(readFileSync(path.join(reportsDir, reportFile), 'utf-8'));

const unmatched = report.unmatched_files;

const IMG_EXTS = new Set(['jpg','jpeg','png','gif','webp','bmp','tiff','tif']);
const images   = unmatched.filter(f => IMG_EXTS.has(f.ext?.toLowerCase()));
const psds     = unmatched.filter(f => f.ext?.toLowerCase().startsWith('psd'));

console.log(`Unmatched images: ${images.length}`);
console.log(`Unmatched PSDs:   ${psds.length}`);

// ── Helpers ────────────────────────────────────────────────────────────────────

function norm(p) { return p?.replace(/\\/g, '/') || ''; }

function safeDestPath(dir, basename) {
  // Handle collisions with _1, _2, … suffixes
  let dest = path.join(dir, basename);
  if (!existsSync(dest)) return dest;
  const ext   = path.extname(basename);
  const stem  = path.basename(basename, ext);
  let i = 1;
  while (existsSync(path.join(dir, `${stem}_${i}${ext}`))) i++;
  return path.join(dir, `${stem}_${i}${ext}`);
}

async function getImageMeta(absPath) {
  try {
    const m = await sharp(absPath).metadata();
    const w = m.width || 0, h = m.height || 0;
    return { width: w, height: h, pixels: w * h };
  } catch {
    return { width: 0, height: 0, pixels: 0 };
  }
}

// ── Ensure dirs ────────────────────────────────────────────────────────────────

mkdirSync(TRIAGE_DIR, { recursive: true });
mkdirSync(PSD_DIR, { recursive: true });

// ── Process images ─────────────────────────────────────────────────────────────

console.log('\n── Importing images ──────────────────────────────────────────────────────────');

const imageRecords = [];
const imageCopyMap = []; // { src, dest, origRelPath }

for (const f of images) {
  const absOrig = path.join(ROOT, norm(f.original));
  if (!existsSync(absOrig)) { console.warn(`  MISSING: ${f.original}`); continue; }

  const basename  = path.basename(absOrig);
  const destAbs   = safeDestPath(TRIAGE_DIR, basename);
  const destRel   = norm(path.relative(ROOT, destAbs));

  copyFileSync(absOrig, destAbs);

  const sz   = statSync(absOrig).size;
  const meta = await getImageMeta(absOrig);

  imageCopyMap.push({ src: f.original, dest: destRel });

  imageRecords.push({
    File_Path:          destRel,
    Original_Filepath:  norm(f.original),
    Status:             'triage',
    Size_Bytes:         sz,
    Pixels:             meta.pixels || null,
  });
}

console.log(`  Copied ${imageCopyMap.length} images → triage/`);

// ── Process PSDs ───────────────────────────────────────────────────────────────

console.log('\n── Importing PSDs ────────────────────────────────────────────────────────────');

const psdRecords  = [];
const psdCopyMap  = [];

for (const f of psds) {
  const absOrig = path.join(ROOT, norm(f.original));
  if (!existsSync(absOrig)) { console.warn(`  MISSING: ${f.original}`); continue; }

  // Normalise extension: strip trailing spaces/variants → always .psd
  const origBasename = path.basename(absOrig);
  const cleanName    = origBasename.trim().replace(/\.psd.*$/i, '.psd');
  const destAbs      = safeDestPath(PSD_DIR, cleanName);
  const destRel      = norm(path.relative(ROOT, destAbs));

  copyFileSync(absOrig, destAbs);

  const sz = statSync(absOrig).size;
  psdCopyMap.push({ src: f.original, dest: destRel });

  psdRecords.push({
    File_Path:          destRel,
    Original_File_Path: norm(f.original),
    File_Type:          'psd',
    Status:             'triage',
    Size_Bytes:         sz,
  });
}

console.log(`  Copied ${psdCopyMap.length} PSDs → documents/psd/`);

// ── Write to NocoDB ────────────────────────────────────────────────────────────

async function bulkCreate(tableId, records, label) {
  let created = 0, errors = 0;
  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100);
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${tableId}/records`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(batch),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error(`  ${label} batch ${i} failed: ${r.status} ${txt.slice(0, 200)}`);
      errors += batch.length;
    } else {
      created += batch.length;
    }
  }
  return { created, errors };
}

console.log('\n── Writing to NocoDB ─────────────────────────────────────────────────────────');

if (imageRecords.length) {
  const { created, errors } = await bulkCreate(IDS.Images, imageRecords, 'Images');
  console.log(`  Images: ${created} created, ${errors} errors`);
}

if (psdRecords.length) {
  const { created, errors } = await bulkCreate(IDS.BinaryDocuments, psdRecords, 'BinaryDocuments');
  console.log(`  BinaryDocuments (PSDs): ${created} created, ${errors} errors`);
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n── Summary ───────────────────────────────────────────────────────────────────');
console.log(`  Images imported:  ${imageCopyMap.length}`);
console.log(`  PSDs imported:    ${psdCopyMap.length}`);

if (imageCopyMap.length) {
  console.log('\n  Image copies:');
  for (const m of imageCopyMap) console.log(`    ${path.basename(m.src).padEnd(35)} → ${m.dest}`);
}
if (psdCopyMap.length) {
  console.log('\n  PSD copies:');
  for (const m of psdCopyMap) console.log(`    ${path.basename(m.src).padEnd(35)} → ${m.dest}`);
}
