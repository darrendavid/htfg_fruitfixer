/**
 * Export all NocoDB tables to JSON files in content/backups/nocodb-{date}/
 * Handles pagination — fetches all records regardless of table size.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { config } from 'dotenv';

config({ path: path.join(import.meta.dirname, '..', 'review-ui', '.env') });

const ROOT       = path.resolve(import.meta.dirname, '..');
const TABLE_IDS  = JSON.parse(readFileSync(path.join(ROOT, 'content', 'parsed', 'nocodb_table_ids.json'), 'utf-8'));
const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;

if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const DATE_TAG = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
const OUT_DIR  = path.join(ROOT, 'content', 'backups', `nocodb-${DATE_TAG}`);
mkdirSync(OUT_DIR, { recursive: true });

async function fetchAllRecords(tableName, tableId) {
  const PAGE_SIZE = 1000;
  const records   = [];
  let offset      = 0;

  while (true) {
    const url = `${NOCODB_URL}/api/v2/tables/${tableId}/records?limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, { headers: { 'xc-token': NOCODB_KEY } });
    if (!res.ok) throw new Error(`GET ${tableName} offset=${offset}: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const page = data.list ?? [];
    records.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return records;
}

const summary = {};

for (const [name, id] of Object.entries(TABLE_IDS)) {
  process.stdout.write(`  ${name.padEnd(20)} …`);
  try {
    const records = await fetchAllRecords(name, id);
    const outFile = path.join(OUT_DIR, `${name}.json`);
    writeFileSync(outFile, JSON.stringify(records, null, 2));
    summary[name] = records.length;
    console.log(` ${records.length} records`);
  } catch (err) {
    console.log(` FAILED: ${err.message}`);
    summary[name] = `ERROR: ${err.message}`;
  }
}

writeFileSync(path.join(OUT_DIR, '_summary.json'), JSON.stringify({ exported_at: new Date().toISOString(), tables: summary }, null, 2));

const total = Object.values(summary).filter(v => typeof v === 'number').reduce((a, b) => a + b, 0);
console.log(`\nBackup complete → ${OUT_DIR}`);
console.log(`Total records: ${total}`);
