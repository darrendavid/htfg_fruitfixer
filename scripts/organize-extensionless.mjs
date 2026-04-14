/**
 * organize-extensionless.mjs
 *
 * Renames the pass_02/extensionless/ subdirectories from inferred-type names
 * (ole, text, jpeg, binary, empty) to proper extension names (doc, txt, jpg, bin, empty),
 * and updates all corresponding BinaryDocuments.File_Path in NocoDB.
 *
 * Run:      node scripts/organize-extensionless.mjs
 * Dry-run:  node scripts/organize-extensionless.mjs --dry-run
 */

import { existsSync, mkdirSync, renameSync, copyFileSync, unlinkSync } from 'fs';
import path from 'path';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: 'review-ui/.env' });

const DRY_RUN    = process.argv.includes('--dry-run');
const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const IDS = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const H   = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };

const norm = p => p?.replace(/\\/g, '/') || '';

// type-dir → extension-dir mapping
const TYPE_TO_EXT = {
  ole:    'doc',
  text:   'txt',
  jpeg:   'jpg',
  binary: 'bin',
  psd:    'psd',    // same
  empty:  'empty',  // same
};

// ── NocoDB helpers ─────────────────────────────────────────────────────────────

async function fetchAll(table, fields) {
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({ limit: '200', offset: String(offset) });
    if (fields) params.set('fields', fields);
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS[table]}/records?${params}`, { headers: H });
    const d = await r.json();
    all.push(...(d.list ?? []));
    if (d.pageInfo?.isLastPage) break;
    offset += 200;
  }
  return all;
}

async function bulkUpdate(table, records) {
  if (!records.length) return;
  if (DRY_RUN) return;
  const BATCH = 100;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS[table]}/records`, {
      method: 'PATCH', headers: H, body: JSON.stringify(batch),
    });
    if (!r.ok) console.error(`bulkUpdate ${table} batch ${i} failed: ${await r.text()}`);
  }
}

// ── File move helper ───────────────────────────────────────────────────────────

function doMove(src, dest) {
  if (DRY_RUN) return;
  const dir = path.dirname(dest);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    renameSync(src, dest);
  } catch (e) {
    if (e.code === 'EXDEV') { copyFileSync(src, dest); unlinkSync(src); }
    else throw e;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

console.log(`\n=== organize extensionless files (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) ===\n`);

console.log('Fetching BinaryDocuments from NocoDB…');
const allDocs = await fetchAll('BinaryDocuments', 'Id,File_Path,File_Name,File_Type');
const extDocs = allDocs.filter(r => norm(r.File_Path || '').includes('pass_02/extensionless/'));
console.log(`  ${extDocs.length} extensionless records found\n`);

const moves   = [];
const updates = [];
const skipped = [];

for (const rec of extDocs) {
  const oldPath = norm(rec.File_Path || '');

  // Extract the type segment: content/pass_02/extensionless/{type}/rest...
  const match = oldPath.match(/^(.*pass_02\/extensionless\/)([^/]+)\/(.+)$/);
  if (!match) { skipped.push({ id: rec.Id, path: oldPath, reason: 'no type segment' }); continue; }

  const [, prefix, typeDir, rest] = match;
  const extDir = TYPE_TO_EXT[typeDir];

  if (!extDir) { skipped.push({ id: rec.Id, path: oldPath, reason: `unknown type dir: ${typeDir}` }); continue; }

  // If already using the ext dir name, nothing to do
  if (typeDir === extDir) { skipped.push({ id: rec.Id, path: oldPath, reason: 'already correct' }); continue; }

  const newPath = `${prefix}${extDir}/${rest}`;

  moves.push({ id: rec.Id, oldPath, newPath, extDir });
  updates.push({ Id: rec.Id, File_Path: newPath, File_Type: extDir === 'empty' ? 'empty' : extDir });
}

// Count by extension
const byExt = {};
for (const m of moves) byExt[m.extDir] = (byExt[m.extDir] || 0) + 1;

console.log('Files to reorganize:');
for (const [ext, n] of Object.entries(byExt).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${ext.padEnd(8)} ${n}`);
}
console.log(`  Already correct / skipped: ${skipped.filter(s => s.reason === 'already correct').length}`);
console.log(`  Other skipped: ${skipped.filter(s => s.reason !== 'already correct').length}`);
console.log(`  Total to move: ${moves.length}\n`);

// Move files on disk
console.log('Moving files…');
let moved = 0, errors = 0;
for (const { oldPath, newPath } of moves) {
  try {
    doMove(oldPath, newPath);
    moved++;
  } catch (e) {
    console.error(`  FAILED: ${oldPath} → ${newPath}: ${e.message}`);
    errors++;
  }
}
console.log(`  Moved: ${moved}, Errors: ${errors}`);

// Update NocoDB
console.log(`\nUpdating ${updates.length} NocoDB BinaryDocuments records…`);
await bulkUpdate('BinaryDocuments', updates);
console.log('  done');

console.log('\n=== SUMMARY ===');
console.log(`  Records processed:  ${extDocs.length}`);
console.log(`  Files moved:        ${moved}`);
console.log(`  NocoDB updated:     ${DRY_RUN ? 0 : updates.length}`);
console.log(`  Errors:             ${errors}`);
if (DRY_RUN) console.log('\n[DRY RUN] No files moved or NocoDB records updated.');
