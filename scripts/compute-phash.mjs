/**
 * compute-phash.mjs — Compute perceptual hashes (dHash) for images in NocoDB
 *
 * Usage:
 *   node scripts/compute-phash.mjs [--concurrency N] [--limit N] [--dry-run]
 */

import { config } from 'dotenv';
import { join } from 'path';
import sharp from 'sharp';

config({ path: join(import.meta.dirname, '..', '.env') });

const BASE_DIR = join(import.meta.dirname, '..');
const NOCODB_URL = 'https://nocodb.djjd.us';
const TABLE_ID = 'mtc4c91lrkg83zy';
const API_KEY = process.env.NOCODB_API_KEY;
const BATCH_SAVE_SIZE = 50;
const PAGE_SIZE = 200;

if (!API_KEY) {
  console.error('ERROR: NOCODB_API_KEY not set in .env');
  process.exit(1);
}

// --------------- CLI args ---------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { concurrency: 10, limit: Infinity, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--concurrency' && args[i + 1]) {
      opts.concurrency = parseInt(args[++i], 10);
    } else if (args[i] === '--limit' && args[i + 1]) {
      opts.limit = parseInt(args[++i], 10);
    } else if (args[i] === '--dry-run') {
      opts.dryRun = true;
    }
  }
  return opts;
}

// --------------- NocoDB helpers ---------------

const headers = {
  'xc-token': API_KEY,
  'Content-Type': 'application/json',
};

async function nocoFetch(path, options = {}) {
  const url = `${NOCODB_URL}${path}`;
  const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`NocoDB ${res.status}: ${body}`);
  }
  return res.json();
}

async function ensureColumn() {
  console.log('Ensuring Perceptual_Hash column exists...');
  try {
    await nocoFetch(`/api/v2/meta/tables/${TABLE_ID}/columns`, {
      method: 'POST',
      body: JSON.stringify({ title: 'Perceptual_Hash', uidt: 'SingleLineText' }),
    });
    console.log('  Created Perceptual_Hash column.');
  } catch (err) {
    if (err.message.includes('422') || err.message.toLowerCase().includes('duplicate')) {
      console.log('  Column already exists.');
    } else {
      throw err;
    }
  }
}

async function fetchAllRecords(limit) {
  const records = [];
  let offset = 0;
  const whereClause = '(Excluded,eq,0)~and(Perceptual_Hash,is,null)';
  const fields = 'Id,File_Path,Perceptual_Hash';

  while (records.length < limit) {
    const pageLimit = Math.min(PAGE_SIZE, limit - records.length);
    const params = new URLSearchParams({
      where: whereClause,
      limit: String(pageLimit),
      offset: String(offset),
      fields,
    });
    const data = await nocoFetch(`/api/v2/tables/${TABLE_ID}/records?${params}`);
    const list = data.list || [];
    if (list.length === 0) break;
    records.push(...list);
    offset += list.length;
    if (list.length < pageLimit) break;
    process.stdout.write(`  Fetched ${records.length} records...\r`);
  }
  console.log(`  Fetched ${records.length} records to process.`);
  return records;
}

async function bulkUpdate(updates) {
  if (updates.length === 0) return;
  await nocoFetch(`/api/v2/tables/${TABLE_ID}/records`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

// --------------- dHash ---------------

async function computeDHash(imagePath) {
  // Resize to 9x8 grayscale, get raw pixel buffer
  const { data } = await sharp(imagePath)
    .grayscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Compare each pixel to its right neighbor: 8 cols x 8 rows = 64 bits
  let hash = 0n;
  let bit = 63;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = data[row * 9 + col];
      const right = data[row * 9 + col + 1];
      if (left > right) {
        hash |= 1n << BigInt(bit);
      }
      bit--;
    }
  }

  return hash.toString(16).padStart(16, '0');
}

// --------------- Main ---------------

async function main() {
  const opts = parseArgs();
  console.log(`compute-phash — concurrency=${opts.concurrency}, limit=${opts.limit === Infinity ? 'all' : opts.limit}, dryRun=${opts.dryRun}`);

  await ensureColumn();

  console.log('Fetching image records without Perceptual_Hash...');
  const records = await fetchAllRecords(opts.limit);

  if (records.length === 0) {
    console.log('All images already have hashes. Nothing to do.');
    return;
  }

  if (opts.dryRun) {
    console.log(`Dry run: ${records.length} images would be processed.`);
    return;
  }

  const total = records.length;
  let completed = 0;
  let errors = 0;
  const startTime = Date.now();
  const pendingUpdates = [];

  async function flush() {
    if (pendingUpdates.length === 0) return;
    const batch = pendingUpdates.splice(0, pendingUpdates.length);
    try {
      await bulkUpdate(batch);
    } catch (err) {
      console.error(`\nERROR saving batch of ${batch.length}: ${err.message}`);
    }
  }

  async function processRecord(record) {
    const filePath = record.File_Path;
    if (!filePath) {
      errors++;
      return;
    }
    const absPath = join(BASE_DIR, filePath);
    try {
      const hash = await computeDHash(absPath);
      pendingUpdates.push({ Id: record.Id, Perceptual_Hash: hash });
    } catch (err) {
      errors++;
      console.error(`\n  FAIL [${record.Id}] ${filePath}: ${err.message}`);
    }
    completed++;

    // Progress
    if (completed % 10 === 0 || completed === total) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = completed / elapsed;
      const remaining = (total - completed) / rate;
      const mins = Math.floor(remaining / 60);
      const secs = Math.floor(remaining % 60);
      process.stdout.write(
        `  ${completed}/${total} (${errors} errors) — ${rate.toFixed(1)}/s — ETA ${mins}m${secs}s   \r`
      );
    }

    // Incremental save every BATCH_SAVE_SIZE
    if (pendingUpdates.length >= BATCH_SAVE_SIZE) {
      await flush();
    }
  }

  // Process with bounded concurrency
  let idx = 0;
  async function worker() {
    while (idx < records.length) {
      const record = records[idx++];
      await processRecord(record);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(opts.concurrency, records.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // Flush remaining
  await flush();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone: ${completed} processed, ${errors} errors, ${elapsed}s elapsed.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
