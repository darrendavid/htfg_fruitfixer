/**
 * rollback-to-pass01.mjs
 *
 * Rolls NocoDB back to the pre-migration snapshot (2026-04-12T07:35).
 *
 *   1. Deletes all current Images records from NocoDB (51,071)
 *   2. Deletes all current BinaryDocuments records from NocoDB (6,921)
 *   3. Re-inserts Images from snapshot (10,967 records)
 *   4. Does NOT touch: Plants, Varieties, Attachments, Documents, Recipes,
 *      OCR_Extractions, Nutritional_Info — these were not modified by the migration
 *
 * File system changes (IMAGE_MOUNT_PATH, pass_02 deletion) are done separately.
 *
 * Run: node scripts/rollback-to-pass01.mjs
 */

import { readFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: 'review-ui/.env' });

const NOCODB_URL = 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const IDS  = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const H    = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };
const SNAP = 'content/backups/nocodb-2026-04-12-07-35-05';

// ── Helpers ────────────────────────────────────────────────────────────────────

async function fetchAllIds(tableId) {
  const ids = [];
  let offset = 0;
  while (true) {
    const r = await fetch(
      `${NOCODB_URL}/api/v2/tables/${tableId}/records?limit=200&offset=${offset}&fields=Id`,
      { headers: H }
    );
    if (!r.ok) throw new Error(`fetchAllIds failed: ${r.status} ${await r.text()}`);
    const d = await r.json();
    ids.push(...(d.list ?? []).map(rec => rec.Id));
    if (d.pageInfo?.isLastPage) break;
    offset += 200;
    if (offset % 10000 === 0) process.stderr.write(` ${offset}`);
  }
  process.stderr.write('\n');
  return ids;
}

async function bulkDelete(tableId, ids, label) {
  let deleted = 0;
  let errors  = 0;
  const BATCH = 100;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH).map(id => ({ Id: id }));
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${tableId}/records`, {
      method: 'DELETE',
      headers: H,
      body: JSON.stringify(batch),
    });
    if (!r.ok) {
      console.error(`  DELETE batch ${i}–${i + BATCH} failed: ${r.status}`);
      errors += batch.length;
    } else {
      deleted += batch.length;
    }
    if ((i + BATCH) % 5000 === 0) process.stderr.write(` ${i + BATCH}`);
  }
  process.stderr.write('\n');
  console.log(`  ${label}: ${deleted} deleted, ${errors} errors`);
}

async function bulkCreate(tableId, records, label) {
  let created = 0;
  let errors  = 0;
  const BATCH = 100;
  // Strip NocoDB-managed fields before inserting
  const STRIP = new Set(['Id', 'CreatedAt', 'UpdatedAt']);
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH).map(r => {
      const clean = {};
      for (const [k, v] of Object.entries(r)) {
        if (!STRIP.has(k)) clean[k] = v;
      }
      return clean;
    });
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${tableId}/records`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(batch),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error(`  POST batch ${i}–${i + BATCH} failed: ${r.status} ${txt.slice(0, 200)}`);
      errors += batch.length;
    } else {
      created += batch.length;
    }
    if ((i + BATCH) % 2000 === 0) process.stderr.write(` ${i + BATCH}`);
  }
  process.stderr.write('\n');
  console.log(`  ${label}: ${created} created, ${errors} errors`);
}

// ── Step 1: Delete all current Images ─────────────────────────────────────────

console.log('\n── Step 1: Delete current Images records ─────────────────────────────────────');
console.log('Fetching all Image IDs...');
const imageIds = await fetchAllIds(IDS.Images);
console.log(`  ${imageIds.length} records to delete`);
await bulkDelete(IDS.Images, imageIds, 'Images');

// ── Step 2: Delete all current BinaryDocuments ────────────────────────────────

console.log('\n── Step 2: Delete current BinaryDocuments records ────────────────────────────');
console.log('Fetching all BinaryDocument IDs...');
const docIds = await fetchAllIds(IDS.BinaryDocuments);
console.log(`  ${docIds.length} records to delete`);
await bulkDelete(IDS.BinaryDocuments, docIds, 'BinaryDocuments');

// ── Step 3: Re-insert Images from snapshot ────────────────────────────────────

console.log('\n── Step 3: Restore Images from snapshot ──────────────────────────────────────');
const snapImages = JSON.parse(readFileSync(`${SNAP}/Images.json`, 'utf-8'));
console.log(`  ${snapImages.length} records to insert`);
await bulkCreate(IDS.Images, snapImages, 'Images');

// ── Done ───────────────────────────────────────────────────────────────────────

console.log('\n── Complete ───────────────────────────────────────────────────────────────────');
console.log('NocoDB restored to 2026-04-12T07:35 snapshot.');
console.log('Next steps (manual):');
console.log('  1. Update review-ui/.env  IMAGE_MOUNT_PATH → content/pass_01/assigned');
console.log('  2. Update review-ui/.env  PASS02_ROOT → (remove or leave)');
console.log('  3. Delete content/pass_02/ from disk');
console.log('  4. Restart the server');
