#!/usr/bin/env node
/**
 * Sync assigned image files on disk with NocoDB Plant_Id assignments.
 *
 * For each image in NocoDB:
 * - If File_Path says plant A but Plant_Id says plant B → move file to B's folder,
 *   update File_Path in NocoDB
 * - Does NOT touch Original_Filepath
 *
 * Usage: node scripts/sync-assigned-folders.mjs [--dry-run]
 */

import { readFileSync, existsSync, mkdirSync, copyFileSync, unlinkSync, renameSync, readdirSync } from 'fs';
import { join, basename, extname, dirname } from 'path';

const ROOT = join(import.meta.dirname, '..');
const PARSED = join(ROOT, 'content', 'parsed');
const ASSIGNED_ROOT = join(ROOT, 'content', 'pass_01', 'assigned');
const DRY_RUN = process.argv.includes('--dry-run');

// Load env
try {
  const envText = readFileSync(join(ROOT, 'review-ui', '.env'), 'utf-8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const NOCODB_API_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_API_KEY) { console.error('ERROR: NOCODB_API_KEY not found'); process.exit(1); }

const TABLE_IDS = JSON.parse(readFileSync(join(PARSED, 'nocodb_table_ids.json'), 'utf-8'));
const NOCODB_BASE = 'https://nocodb.djjd.us';

async function fetchAllRecords(tableName, fields, where) {
  const tableId = TABLE_IDS[tableName];
  const all = [];
  let offset = 0;
  const fieldParam = fields ? `&fields=${fields.join(',')}` : '';
  const whereParam = where ? `&where=${encodeURIComponent(where)}` : '';
  while (true) {
    const url = `${NOCODB_BASE}/api/v2/tables/${tableId}/records?limit=200&offset=${offset}${fieldParam}${whereParam}`;
    const res = await fetch(url, { headers: { 'xc-token': NOCODB_API_KEY } });
    if (!res.ok) throw new Error(`NocoDB ${tableName} fetch failed: ${res.status}`);
    const data = await res.json();
    all.push(...data.list);
    if (data.pageInfo.isLastPage || all.length >= data.pageInfo.totalRows) break;
    offset += 200;
  }
  return all;
}

async function bulkUpdate(tableName, records) {
  const tableId = TABLE_IDS[tableName];
  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100);
    const res = await fetch(`${NOCODB_BASE}/api/v2/tables/${tableId}/records`, {
      method: 'PATCH',
      headers: { 'xc-token': NOCODB_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) console.warn(`  bulkUpdate batch ${i} failed: ${res.status}`);
  }
}

function resolveDestFilename(dir, filename) {
  const ext = extname(filename);
  const stem = basename(filename, ext);
  let candidate = filename;
  let counter = 1;
  while (existsSync(join(dir, candidate))) {
    candidate = `${stem}_${counter}${ext}`;
    counter++;
  }
  return candidate;
}

function moveFile(src, dest) {
  try {
    renameSync(src, dest);
  } catch {
    copyFileSync(src, dest);
    unlinkSync(src);
  }
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  console.log('Fetching all image records...');
  const images = await fetchAllRecords('Images',
    ['Id', 'File_Path', 'Plant_Id', 'Status'],
    '(Plant_Id,isnot,null)~and(Excluded,neq,true)'
  );
  console.log(`  ${images.length} images with Plant_Id`);

  let moved = 0, alreadyCorrect = 0, missing = 0, errors = 0;
  const updates = [];

  for (const img of images) {
    const filePath = (img.File_Path || '').replace(/\\/g, '/');
    const plantId = img.Plant_Id;
    const filename = basename(filePath);

    // Extract current plant from file path
    // Pattern: content/pass_01/assigned/{plant}/images/{file}
    const pathMatch = filePath.match(/content\/pass_01\/assigned\/([^/]+)\/images\//);
    if (!pathMatch) {
      // Not in assigned structure — skip
      continue;
    }

    const currentPlant = pathMatch[1];
    if (currentPlant === plantId) {
      alreadyCorrect++;
      continue;
    }

    // File is in wrong plant folder — needs moving
    const srcAbs = join(ROOT, filePath);
    if (!existsSync(srcAbs)) {
      missing++;
      continue;
    }

    const destDir = join(ASSIGNED_ROOT, plantId, 'images');
    const safeFilename = resolveDestFilename(destDir, filename);
    const destAbs = join(destDir, safeFilename);
    const newFilePath = `content/pass_01/assigned/${plantId}/images/${safeFilename}`;

    if (DRY_RUN) {
      console.log(`  MOVE: ${filePath} → ${newFilePath}`);
    } else {
      try {
        mkdirSync(destDir, { recursive: true });
        moveFile(srcAbs, destAbs);
        updates.push({ Id: img.Id, File_Path: newFilePath });
      } catch (err) {
        console.warn(`  ERROR moving ${filePath}: ${err.message}`);
        errors++;
        continue;
      }
    }
    moved++;
  }

  console.log(`\nResults:`);
  console.log(`  Already correct: ${alreadyCorrect}`);
  console.log(`  Moved: ${moved}`);
  console.log(`  Missing on disk: ${missing}`);
  console.log(`  Errors: ${errors}`);

  if (!DRY_RUN && updates.length > 0) {
    console.log(`\nUpdating File_Path in NocoDB for ${updates.length} records...`);
    await bulkUpdate('Images', updates);
    console.log('  Done.');
  } else if (DRY_RUN && moved > 0) {
    console.log(`\n  (dry run — ${moved} files would be moved, re-run without --dry-run to apply)`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
