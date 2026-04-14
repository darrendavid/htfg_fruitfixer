#!/usr/bin/env node
/**
 * Deduplicate assigned images that share the same Original_Filepath.
 *
 * For each group of records with the same Original_Filepath:
 * 1. Pick the keeper: lowest Id
 * 2. Merge metadata from all records into the keeper (Variety_Id, Rotation, Caption, etc.)
 * 3. Update the keeper's File_Path if needed (ensure it points to an existing disk file)
 * 4. Delete excess NocoDB records
 * 5. Delete excess disk files from pass_01/ (NEVER from source/)
 * 6. Update hero_images SQLite table if a deleted file was the hero
 *
 * Usage: node scripts/dedup-assigned-images.mjs [--dry-run]
 */

import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join, basename } from 'path';

const ROOT = join(import.meta.dirname, '..');
const PARSED = join(ROOT, 'content', 'parsed');
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

// SQLite for hero_images
import { createRequire } from 'module';
const require = createRequire(join(ROOT, 'review-ui', 'package.json'));
const Database = require('better-sqlite3');
const db = new Database(join(ROOT, 'review-ui', 'data', 'db', 'review.db'));

async function fetchAllRecords(fields) {
  const tableId = TABLE_IDS.Images;
  const all = [];
  let offset = 0;
  while (true) {
    const url = `${NOCODB_BASE}/api/v2/tables/${tableId}/records?limit=200&offset=${offset}&fields=${fields.join(',')}`;
    const res = await fetch(url, { headers: { 'xc-token': NOCODB_API_KEY } });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const data = await res.json();
    all.push(...data.list);
    if (data.pageInfo.isLastPage || all.length >= data.pageInfo.totalRows) break;
    offset += 200;
  }
  return all;
}

async function bulkUpdate(records) {
  const tableId = TABLE_IDS.Images;
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

async function deleteRecords(ids) {
  const tableId = TABLE_IDS.Images;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100).map(id => ({ Id: id }));
    const res = await fetch(`${NOCODB_BASE}/api/v2/tables/${tableId}/records`, {
      method: 'DELETE',
      headers: { 'xc-token': NOCODB_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) console.warn(`  delete batch ${i} failed: ${res.status}`);
  }
}

// Mergeable fields — first non-null/non-empty value wins, except for text where we prefer longer
const MERGE_FIELDS = [
  'Plant_Id', 'Status', 'Variety_Id', 'Rotation', 'Caption', 'Perceptual_Hash',
  'Attribution', 'License', 'Source_Directory',
];

function mergeMetadata(keeper, others) {
  const updates = {};
  for (const field of MERGE_FIELDS) {
    const keeperVal = keeper[field];
    for (const other of others) {
      const otherVal = other[field];
      if (otherVal == null || otherVal === '' || otherVal === 0) continue;
      if (keeperVal == null || keeperVal === '' || keeperVal === 0) {
        // Keeper is empty, take from other
        updates[field] = otherVal;
        break;
      }
      // Both have values — for Caption, prefer longer
      if (field === 'Caption' && typeof otherVal === 'string' && typeof keeperVal === 'string') {
        if (otherVal.length > keeperVal.length) {
          updates[field] = otherVal;
        }
      }
      break; // keeper already has a value for non-caption fields
    }
  }
  return updates;
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  console.log('Fetching all image records...');
  const images = await fetchAllRecords([
    'Id', 'File_Path', 'Plant_Id', 'Original_Filepath', 'Size_Bytes',
    'Variety_Id', 'Rotation', 'Caption', 'Perceptual_Hash',
    'Attribution', 'License', 'Source_Directory', 'Status', 'Excluded',
  ]);
  console.log(`  ${images.length} total records`);

  // Group by Original_Filepath
  const byOriginal = new Map();
  for (const img of images) {
    const orig = img.Original_Filepath;
    if (!orig) continue;
    if (!byOriginal.has(orig)) byOriginal.set(orig, []);
    byOriginal.get(orig).push(img);
  }

  const dupeGroups = [...byOriginal.entries()].filter(([_, imgs]) => imgs.length > 1);
  console.log(`  ${dupeGroups.length} duplicate groups`);

  // Load hero_images for reference
  const heroes = db.prepare('SELECT plant_id, image_id, file_path FROM hero_images').all();
  const heroByImageId = new Map(heroes.map(h => [h.image_id, h]));
  const heroByPath = new Map(heroes.map(h => [h.file_path, h]));

  const stats = { groups: 0, merged: 0, deleted_records: 0, deleted_files: 0, hero_updates: 0, errors: 0 };
  const keeperUpdates = [];   // NocoDB updates for keepers
  const toDeleteIds = [];     // NocoDB record IDs to delete
  const toDeleteFiles = [];   // Disk files to delete (only in pass_01/)

  for (const [origPath, groupRecords] of dupeGroups) {
    stats.groups++;

    // Pick keeper: prefer assigned+has-plant > assigned > others, then lowest Id as tiebreaker
    groupRecords.sort((a, b) => {
      const aScore = (a.Plant_Id ? 2 : 0) + (a.Status === 'assigned' ? 1 : 0);
      const bScore = (b.Plant_Id ? 2 : 0) + (b.Status === 'assigned' ? 1 : 0);
      if (bScore !== aScore) return bScore - aScore; // higher score first
      return a.Id - b.Id; // then lowest Id
    });
    const keeper = groupRecords[0];
    const others = groupRecords.slice(1);

    // Merge metadata into keeper
    const updates = mergeMetadata(keeper, others);

    // Ensure keeper's File_Path points to an existing disk file
    let keeperPath = keeper.File_Path;
    if (!existsSync(join(ROOT, keeperPath))) {
      // Keeper's file doesn't exist — find one that does
      for (const other of others) {
        if (existsSync(join(ROOT, other.File_Path))) {
          keeperPath = other.File_Path;
          break;
        }
      }
    }
    if (keeperPath !== keeper.File_Path) {
      updates.File_Path = keeperPath;
    }

    if (Object.keys(updates).length > 0) {
      keeperUpdates.push({ Id: keeper.Id, ...updates });
      stats.merged++;
    }

    // Check if any deleted record is a hero image
    for (const other of others) {
      const heroEntry = heroByImageId.get(other.Id) || heroByPath.get(other.File_Path);
      if (heroEntry) {
        // Update hero to point to keeper
        if (!DRY_RUN) {
          db.prepare('UPDATE hero_images SET image_id = ?, file_path = ? WHERE plant_id = ?')
            .run(keeper.Id, keeperPath, heroEntry.plant_id);
        }
        stats.hero_updates++;
      }

      toDeleteIds.push(other.Id);
      stats.deleted_records++;

      // Delete disk file if it's in pass_01 and different from keeper's file
      const otherDiskPath = join(ROOT, other.File_Path);
      const keeperDiskPath = join(ROOT, keeperPath);
      if (other.File_Path !== keeperPath &&
          existsSync(otherDiskPath) &&
          other.File_Path.includes('pass_01/')) {
        toDeleteFiles.push(otherDiskPath);
        stats.deleted_files++;
      }
    }
  }

  console.log(`\nResults:`);
  console.log(`  Groups processed: ${stats.groups}`);
  console.log(`  Keepers with merged metadata: ${stats.merged}`);
  console.log(`  Records to delete: ${stats.deleted_records}`);
  console.log(`  Disk files to delete: ${stats.deleted_files}`);
  console.log(`  Hero image updates: ${stats.hero_updates}`);

  if (!DRY_RUN) {
    if (keeperUpdates.length > 0) {
      console.log(`\nUpdating ${keeperUpdates.length} keeper records in NocoDB...`);
      await bulkUpdate(keeperUpdates);
    }

    if (toDeleteIds.length > 0) {
      console.log(`Deleting ${toDeleteIds.length} duplicate NocoDB records...`);
      await deleteRecords(toDeleteIds);
    }

    if (toDeleteFiles.length > 0) {
      console.log(`Deleting ${toDeleteFiles.length} duplicate disk files...`);
      let deleted = 0, errors = 0;
      for (const fp of toDeleteFiles) {
        try { unlinkSync(fp); deleted++; } catch { errors++; }
      }
      console.log(`  Deleted: ${deleted}, Errors: ${errors}`);
    }

    console.log('Done.');
  } else {
    console.log(`\n(dry run — no changes made)`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
