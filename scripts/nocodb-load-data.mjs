/**
 * NocoDB Data Loader
 *
 * Loads all prepared data files into the NocoDB tables.
 * Uses bulk insert API for efficiency.
 *
 * Usage: node scripts/nocodb-load-data.mjs
 *        node scripts/nocodb-load-data.mjs --table Plants
 *        node scripts/nocodb-load-data.mjs --dry-run
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(import.meta.dirname, '..', '.env') });

const ROOT = join(import.meta.dirname, '..');
const PARSED = join(ROOT, 'content', 'parsed');
const API_KEY = process.env.NOCODB_API_KEY;
const BASE_URL = 'https://nocodb.djjd.us';
const BASE_ID = 'pimorqbta2ve966';

if (!API_KEY) {
  console.error('NOCODB_API_KEY not set');
  process.exit(1);
}

// CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const tableFilter = args.indexOf('--table') >= 0 ? args[args.indexOf('--table') + 1] : null;

// Load table ID mapping
const tableIds = JSON.parse(readFileSync(join(PARSED, 'nocodb_table_ids.json'), 'utf-8'));

// Define which load files map to which tables
const LOAD_MAP = [
  { table: 'Plants', file: 'load_plants.json' },
  { table: 'Varieties', file: 'load_varieties.json' },
  { table: 'Documents', file: 'load_documents.json' },
  { table: 'Recipes', file: 'load_recipes.json' },
  { table: 'OCR_Extractions', file: 'load_ocr_extractions.json' },
  { table: 'Images', file: 'load_images.json' },
];

const BATCH_SIZE = 100; // NocoDB bulk insert limit

async function bulkInsert(tableId, rows) {
  const res = await fetch(`${BASE_URL}/api/v2/tables/${tableId}/records`, {
    method: 'POST',
    headers: {
      'xc-token': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }

  return await res.json();
}

async function loadTable(tableName, fileName) {
  const tableId = tableIds[tableName];
  if (!tableId) {
    console.error(`  ✗ No table ID for "${tableName}"`);
    return 0;
  }

  const filePath = join(PARSED, fileName);
  if (!existsSync(filePath)) {
    console.error(`  ✗ File not found: ${fileName}`);
    return 0;
  }

  const records = JSON.parse(readFileSync(filePath, 'utf-8'));
  console.log(`  Loading ${records.length} records into "${tableName}" (${tableId})...`);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would insert ${records.length} records in ${Math.ceil(records.length / BATCH_SIZE)} batches`);
    return records.length;
  }

  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    try {
      await bulkInsert(tableId, batch);
      inserted += batch.length;
      if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= records.length) {
        process.stdout.write(`\r    ${Math.min(i + BATCH_SIZE, records.length)}/${records.length} inserted`);
      }
    } catch (err) {
      console.error(`\n    Batch error at offset ${i}: ${err.message}`);
      errors += batch.length;
    }
  }

  console.log(`\n  ✓ ${inserted} inserted, ${errors} errors`);
  return inserted;
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log(`NocoDB Data Loader`);
console.log(`  URL: ${BASE_URL}`);
console.log(`  Base: ${BASE_ID}`);
if (DRY_RUN) console.log('  MODE: DRY RUN');
if (tableFilter) console.log(`  Filter: ${tableFilter} only`);
console.log('');

let totalInserted = 0;

for (const { table, file } of LOAD_MAP) {
  if (tableFilter && table !== tableFilter) continue;
  console.log(`[${table}]`);
  const count = await loadTable(table, file);
  totalInserted += count;
  console.log('');
}

console.log(`=== Done: ${totalInserted} total records loaded ===`);
