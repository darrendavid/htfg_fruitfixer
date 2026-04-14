/**
 * backfill-extensionless-orig-path.mjs
 *
 * BinaryDocuments records for extensionless files were created without
 * Original_File_Path set.  This script reconstructs it from the File_Path:
 *
 *   content/pass_02/extensionless/{type}/sub/path/filename.ext
 *   → content/source/original/sub/path/filename   (strip added extension)
 *
 * Run: node scripts/backfill-extensionless-orig-path.mjs
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: 'review-ui/.env' });

const NOCODB_URL = 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const IDS = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const H   = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };

const EXTLESS_PREFIX = 'content/pass_02/extensionless/';
const ORIG_PREFIX    = 'content/source/original/';

// ── Fetch all extensionless BinaryDocuments ────────────────────────────────────

async function fetchAll() {
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      limit: '200', offset: String(offset),
      where: `(File_Path,like,${EXTLESS_PREFIX}%)`,
      fields: 'Id,File_Path,Original_File_Path',
    });
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS.BinaryDocuments}/records?${params}`, { headers: H });
    if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
    const d = await r.json();
    all.push(...(d.list ?? []));
    if (d.pageInfo?.isLastPage) break;
    offset += 200;
  }
  return all;
}

// ── Reconstruct original path ──────────────────────────────────────────────────

function origPathFor(filePath) {
  // filePath: content/pass_02/extensionless/{type}/sub/path/file.ext
  const withoutPrefix = filePath.slice(EXTLESS_PREFIX.length); // "{type}/sub/path/file.ext"
  const slashIdx = withoutPrefix.indexOf('/');
  if (slashIdx < 0) return null; // no subpath — shouldn't happen
  const subpath = withoutPrefix.slice(slashIdx + 1); // "sub/path/file.ext"
  // Strip the added extension (last segment's extension)
  const extIdx = subpath.lastIndexOf('.');
  const basename = subpath.lastIndexOf('/');
  // Only strip if the dot is in the last path component
  let stripped;
  if (extIdx > basename) {
    stripped = subpath.slice(0, extIdx); // "sub/path/file"
  } else {
    stripped = subpath; // no extension to strip
  }
  return ORIG_PREFIX + stripped;
}

// ── Main ───────────────────────────────────────────────────────────────────────

console.log('Fetching extensionless BinaryDocuments…');
const records = await fetchAll();
console.log(`  ${records.length} records`);

const toUpdate = [];
let alreadySet = 0;
let noSource   = 0;

for (const rec of records) {
  if (rec.Original_File_Path) { alreadySet++; continue; }
  const origPath = origPathFor(rec.File_Path);
  if (!origPath) { console.warn(`  Could not derive orig path for: ${rec.File_Path}`); continue; }
  // Verify source file exists
  if (!existsSync(origPath)) {
    // Try without verifying — the source might be there but path format differs
    noSource++;
  }
  toUpdate.push({ Id: rec.Id, Original_File_Path: origPath });
}

console.log(`  Already set: ${alreadySet}`);
console.log(`  Source file not found on disk: ${noSource} (will patch anyway)`);
console.log(`  To patch: ${toUpdate.length}`);

if (toUpdate.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

// Bulk PATCH in batches of 100
let patched = 0;
let errors  = 0;
for (let i = 0; i < toUpdate.length; i += 100) {
  const batch = toUpdate.slice(i, i + 100);
  const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS.BinaryDocuments}/records`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify(batch),
  });
  if (!r.ok) {
    const txt = await r.text();
    console.error(`  PATCH batch ${i}–${i + batch.length} failed: ${r.status} ${txt.slice(0, 200)}`);
    errors += batch.length;
  } else {
    patched += batch.length;
  }
  if ((i + 100) % 500 === 0) process.stdout.write(` ${i + 100}`);
}
process.stdout.write('\n');

console.log(`\nDone — ${patched} patched, ${errors} errors.`);

// Quick spot-check
console.log('\nSpot-check (first 3 updated):');
for (const rec of toUpdate.slice(0, 3)) {
  console.log(`  Id=${rec.Id}`);
  console.log(`    File_Path:          ${records.find(r => r.Id === rec.Id)?.File_Path}`);
  console.log(`    Original_File_Path: ${rec.Original_File_Path}`);
}
