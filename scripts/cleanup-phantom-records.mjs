/**
 * Delete phantom NocoDB records created by multiple migration runs.
 * - Images: delete all with Id > 25724 (pre-migration max)
 * - BinaryDocuments: delete all uncovered-file records (keep only Attachment-migrated ones)
 */
import { readFileSync } from 'fs';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(import.meta.dirname, '..', 'review-ui', '.env') });

const NOCODB_URL = 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
const IDS = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'content', 'parsed', 'nocodb_table_ids.json'), 'utf-8'));
const h = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };

const PRE_MIGRATION_MAX_IMAGE_ID = 25724;

async function fetchIds(table, where, fields = 'Id') {
  const tid = IDS[table];
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({ limit: '1000', offset: String(offset), fields });
    if (where) params.set('where', where);
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${tid}/records?${params}`, { headers: h });
    const d = await r.json();
    all.push(...(d.list ?? []).map(x => x.Id));
    if (d.pageInfo?.isLastPage || d.list?.length < 1000) break;
    offset += 1000;
    if (offset % 10000 === 0) console.log(`  Fetched ${all.length} Ids so far...`);
  }
  return all;
}

async function bulkDelete(table, ids) {
  const tid = IDS[table];
  const CHUNK = 100;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK).map(id => ({ Id: id }));
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${tid}/records`, {
      method: 'DELETE', headers: h, body: JSON.stringify(chunk),
    });
    if (!r.ok) {
      console.error(`  Delete error batch ${i}: ${r.status} ${await r.text()}`);
    } else {
      deleted += chunk.length;
    }
    if ((i + CHUNK) % 5000 === 0) console.log(`  Deleted ${i + CHUNK}/${ids.length}...`);
  }
  return deleted;
}

// ── Delete phantom Images (Id > pre-migration max) ────────────────────────────
console.log(`\nFetching phantom Images (Id > ${PRE_MIGRATION_MAX_IMAGE_ID})...`);
const phantomImageIds = await fetchIds('Images', `(Id,gt,${PRE_MIGRATION_MAX_IMAGE_ID})`);
console.log(`  Found ${phantomImageIds.length} phantom Image records`);

if (phantomImageIds.length > 0) {
  console.log('  Deleting...');
  const deleted = await bulkDelete('Images', phantomImageIds);
  console.log(`  Deleted ${deleted} records.`);
}

// ── Delete uncovered BinaryDocuments (keep only Attachment-migrated ones) ─────
// The setup script migrated 513 Attachments → BinaryDocuments.
// These have the lowest Ids. The migration runs then added uncovered doc files.
// Find the max Id from the original 513 records by looking at what has
// Original_File_Path set (the Attachment migration set this field).
console.log('\nFetching BinaryDocuments to identify originals vs phantoms...');
const allBDocs = [];
let bdOffset = 0;
const bdTid = IDS.BinaryDocuments;
while (true) {
  const params = new URLSearchParams({ limit: '1000', offset: String(bdOffset), fields: 'Id,Original_File_Path,File_Path' });
  const r = await fetch(`${NOCODB_URL}/api/v2/tables/${bdTid}/records?${params}`, { headers: h });
  const d = await r.json();
  allBDocs.push(...(d.list ?? []));
  if (d.pageInfo?.isLastPage || d.list?.length < 1000) break;
  bdOffset += 1000;
}
console.log(`  ${allBDocs.length} BinaryDocuments total`);

// Original records: those migrated from Attachments have Original_File_Path set
const originalBDocs = allBDocs.filter(r => r.Original_File_Path);
const phantomBDocs = allBDocs.filter(r => !r.Original_File_Path);
console.log(`  With Original_File_Path (Attachment-migrated): ${originalBDocs.length}`);
console.log(`  Without Original_File_Path (migration-created, to delete): ${phantomBDocs.length}`);

if (phantomBDocs.length > 0) {
  const phantomBDocIds = phantomBDocs.map(r => r.Id);
  console.log('  Deleting phantom BinaryDocuments...');
  const deleted = await bulkDelete('BinaryDocuments', phantomBDocIds);
  console.log(`  Deleted ${deleted} records.`);
}

// ── Final count ───────────────────────────────────────────────────────────────
const { pageInfo: imgInfo } = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS.Images}/records?limit=1`, { headers: h }).then(r => r.json());
const { pageInfo: bdInfo } = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS.BinaryDocuments}/records?limit=1`, { headers: h }).then(r => r.json());
console.log(`\nFinal counts:`);
console.log(`  Images: ${imgInfo?.totalRows}`);
console.log(`  BinaryDocuments: ${bdInfo?.totalRows}`);
console.log('\nDone. Now fix and re-run the migration Phase 3+4.');
