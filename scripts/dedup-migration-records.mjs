/**
 * Deduplicate NocoDB Images and BinaryDocuments records created by multiple
 * migration runs. For each File_Path, keep the record with the lowest Id
 * and delete all others.
 */
import { readFileSync } from 'fs';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(import.meta.dirname, '..', 'review-ui', '.env') });

const NOCODB_URL = 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
const IDS = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'content', 'parsed', 'nocodb_table_ids.json'), 'utf-8'));
const h = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };

const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) console.log('[DRY RUN]');

async function fetchAll(table, fields) {
  const tid = IDS[table];
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({ limit: '1000', offset: String(offset) });
    if (fields) params.set('fields', fields);
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${tid}/records?${params}`, { headers: h });
    const d = await r.json();
    all.push(...(d.list ?? []));
    if (d.pageInfo?.isLastPage || d.list?.length < 1000) break;
    offset += 1000;
    if (offset % 10000 === 0) console.log(`  Fetched ${offset} records...`);
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
    if (!r.ok) console.error(`Delete error: ${r.status} ${await r.text()}`);
    else deleted += chunk.length;
    if ((i + CHUNK) % 5000 === 0) console.log(`  Deleted ${i + CHUNK}/${ids.length}...`);
  }
  return deleted;
}

async function dedup(table) {
  console.log(`\nFetching all ${table} records...`);
  const records = await fetchAll(table, 'Id,File_Path');
  console.log(`  ${records.length} records total`);

  // Group by File_Path
  const byPath = new Map();
  let nullPath = 0;
  for (const rec of records) {
    if (!rec.File_Path) { nullPath++; continue; }
    const fp = rec.File_Path.replace(/\\/g, '/');
    if (!byPath.has(fp)) byPath.set(fp, []);
    byPath.get(fp).push(rec.Id);
  }

  const dupeGroups = [...byPath.values()].filter(ids => ids.length > 1);
  const toDelete = [];
  for (const ids of dupeGroups) {
    const sorted = ids.slice().sort((a, b) => a - b);
    toDelete.push(...sorted.slice(1)); // delete all but lowest Id
  }

  console.log(`  Unique paths: ${byPath.size}`);
  console.log(`  Null paths: ${nullPath}`);
  console.log(`  Duplicate groups: ${dupeGroups.length}`);
  console.log(`  Records to delete: ${toDelete.length}`);

  if (!toDelete.length) { console.log('  Nothing to delete.'); return; }

  if (!DRY_RUN) {
    console.log(`  Deleting ${toDelete.length} duplicate records...`);
    const deleted = await bulkDelete(table, toDelete);
    console.log(`  Deleted ${deleted} records.`);
  } else {
    console.log(`  [dry-run] Would delete ${toDelete.length} records.`);
  }
}

await dedup('Images');
await dedup('BinaryDocuments');
console.log('\nDone.');
