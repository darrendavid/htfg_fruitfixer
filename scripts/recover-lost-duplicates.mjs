#!/usr/bin/env node
/**
 * Recover lost duplicate images.
 *
 * When multiple NocoDB records point to the same File_Path (e.g. banana/images/DSCN0005.JPG),
 * only one physical file exists on disk. The others represent different source photos that
 * were overwritten during import.
 *
 * This script:
 * 1. Finds all duplicate File_Path groups in NocoDB
 * 2. Hashes the disk file and each record's Original_Filepath source
 * 3. The record matching the disk file keeps its current path
 * 4. Others: copies the ORIGINAL source file to assigned/ with a unique suffix
 * 5. Updates File_Path in NocoDB
 * 6. Outputs a report JSON for the "Lost Image Mapping" UI tab
 *
 * Usage: node scripts/recover-lost-duplicates.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, statSync, createReadStream } from 'fs';
import { join, basename, extname, dirname } from 'path';
import { createHash } from 'crypto';

const ROOT = join(import.meta.dirname, '..');
const PARSED = join(ROOT, 'content', 'parsed');
const ASSIGNED_ROOT = join(ROOT, 'content', 'pass_01', 'assigned');
const OUTPUT_FILE = join(PARSED, 'lost_image_recovery.json');
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

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchAllRecords(tableName, fields) {
  const tableId = TABLE_IDS[tableName];
  const all = [];
  let offset = 0;
  const fieldParam = fields ? `&fields=${fields.join(',')}` : '';
  while (true) {
    const url = `${NOCODB_BASE}/api/v2/tables/${tableId}/records?limit=200&offset=${offset}${fieldParam}`;
    const res = await fetch(url, { headers: { 'xc-token': NOCODB_API_KEY } });
    if (!res.ok) throw new Error(`NocoDB fetch failed: ${res.status}`);
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

function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
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

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  console.log('Fetching all image records...');
  const images = await fetchAllRecords('Images',
    ['Id', 'File_Path', 'Size_Bytes', 'Plant_Id', 'Variety_Id', 'Original_Filepath', 'Source_Directory', 'Caption', 'Status']
  );
  console.log(`  ${images.length} total records`);

  // Group by File_Path
  const byPath = new Map();
  for (const img of images) {
    const p = img.File_Path;
    if (!p) continue;
    if (!byPath.has(p)) byPath.set(p, []);
    byPath.get(p).push(img);
  }

  const dupeGroups = [...byPath.entries()].filter(([_, imgs]) => imgs.length > 1);
  console.log(`  ${dupeGroups.length} duplicate File_Path groups (${dupeGroups.reduce((s, [_, g]) => s + g.length, 0)} records)`);

  const stats = {
    groups: dupeGroups.length,
    records_checked: 0,
    disk_match_found: 0,
    recovered_from_source: 0,
    source_not_found: 0,
    true_duplicates_deleted: 0,
    errors: 0,
  };

  const updates = [];     // NocoDB File_Path updates
  const toDelete = [];    // NocoDB record IDs to delete (true dupes)
  const lostImages = [];  // Report for UI tab

  let groupIdx = 0;
  for (const [filePath, groupRecords] of dupeGroups) {
    groupIdx++;
    if (groupIdx % 50 === 0) process.stdout.write(`  ${groupIdx}/${dupeGroups.length}...\r`);

    const diskPath = join(ROOT, filePath);
    let diskHash = null;
    let diskExists = existsSync(diskPath);

    if (diskExists) {
      try { diskHash = await md5File(diskPath); } catch { diskExists = false; }
    }

    // For each record in the group, determine what to do
    let diskOwner = null; // The record that matches the current disk file

    // First pass: find which record owns the disk file
    if (diskExists && diskHash) {
      for (const rec of groupRecords) {
        if (rec.Original_Filepath) {
          const srcPath = join(ROOT, rec.Original_Filepath);
          if (existsSync(srcPath)) {
            try {
              const srcHash = await md5File(srcPath);
              if (srcHash === diskHash) {
                diskOwner = rec;
                break;
              }
            } catch { continue; }
          }
        }
      }
      // If no Original_Filepath matched, just assign first record as owner
      if (!diskOwner) diskOwner = groupRecords[0];
      stats.disk_match_found++;
    }

    // Second pass: handle each non-owner record
    for (const rec of groupRecords) {
      stats.records_checked++;
      if (rec === diskOwner) continue;

      const plantId = rec.Plant_Id;
      if (!plantId) { stats.source_not_found++; continue; }

      // The Original_Filepath may be WRONG for duplicate records (mapped from shared disk file).
      // Use Source_Directory to find the TRUE source file instead.
      const srcDir = (rec.Source_Directory || '').replace(/\\/g, '/');
      const filename = basename(filePath);

      // Strategy: find the actual source file using Source_Directory + filename
      let sourcePath = null;
      const candidatePaths = [];

      // Try Source_Directory as relative to content/source/
      if (srcDir) {
        candidatePaths.push(
          join(ROOT, 'content', 'source', srcDir, filename),
          join(ROOT, 'content', 'source', srcDir, filename.toLowerCase()),
          join(ROOT, 'content', 'source', srcDir, filename.toUpperCase()),
        );
        // Also try with 'original/' prefix if not present
        if (!srcDir.startsWith('original/') && !srcDir.startsWith('content/')) {
          candidatePaths.push(join(ROOT, 'content', 'source', 'original', srcDir, filename));
        }
      }

      // Also try Original_Filepath if Source_Directory fails
      if (rec.Original_Filepath) {
        candidatePaths.push(join(ROOT, rec.Original_Filepath));
      }

      for (const cp of candidatePaths) {
        if (existsSync(cp)) {
          // Verify it's a different file from the disk file
          try {
            const cpHash = await md5File(cp);
            if (cpHash !== diskHash) {
              sourcePath = cp;
              break;
            } else {
              // Same content — this source IS the disk file, try next
              continue;
            }
          } catch { continue; }
        }
      }

      if (sourcePath) {
        // Found the real source — recover it
        const destDir = join(ASSIGNED_ROOT, plantId, 'images');
        const origFilename = basename(sourcePath);
        const safeFilename = resolveDestFilename(destDir, origFilename);
        const destAbs = join(destDir, safeFilename);
        const newFilePath = `content/pass_01/assigned/${plantId}/images/${safeFilename}`;

        if (DRY_RUN) {
          const relSrc = sourcePath.replace(ROOT + '/', '').replace(ROOT + '\\', '').replace(/\\/g, '/');
          console.log(`  RECOVER: ${relSrc} → ${newFilePath}`);
        } else {
          try {
            mkdirSync(destDir, { recursive: true });
            copyFileSync(sourcePath, destAbs);
            const relSrc = sourcePath.replace(ROOT + '/', '').replace(ROOT + '\\', '').replace(/\\/g, '/');
            updates.push({ Id: rec.Id, File_Path: newFilePath, Original_Filepath: relSrc });
          } catch (err) {
            console.warn(`  ERROR recovering ${rec.Id}: ${err.message}`);
            stats.errors++;
            continue;
          }
        }

        lostImages.push({
          image_id: rec.Id,
          plant_id: plantId,
          plant_name: plantId,
          original_filepath: sourcePath.replace(ROOT + '/', '').replace(ROOT + '\\', '').replace(/\\/g, '/'),
          source_directory: srcDir,
          old_file_path: filePath,
          new_file_path: DRY_RUN ? `(would be) ${newFilePath}` : newFilePath,
          variety_id: rec.Variety_Id || null,
          status: 'recovered',
        });
        stats.recovered_from_source++;

      } else {
        // Check if the record's Original_Filepath hash matches disk (true dupe)
        let isTrueDupe = false;
        if (rec.Original_Filepath) {
          const opPath = join(ROOT, rec.Original_Filepath);
          if (existsSync(opPath)) {
            try {
              const opHash = await md5File(opPath);
              if (opHash === diskHash) isTrueDupe = true;
            } catch {}
          }
        }

        if (isTrueDupe) {
          if (!DRY_RUN) toDelete.push(rec.Id);
          stats.true_duplicates_deleted++;
        } else {
          lostImages.push({
            image_id: rec.Id,
            plant_id: plantId,
            plant_name: plantId,
            original_filepath: rec.Original_Filepath || null,
            source_directory: srcDir,
            old_file_path: filePath,
            new_file_path: null,
            variety_id: rec.Variety_Id || null,
            status: 'source_missing',
          });
          stats.source_not_found++;
        }
      }
    }
  }

  console.log(`\nResults:`);
  console.log(`  Groups processed: ${stats.groups}`);
  console.log(`  Records checked: ${stats.records_checked}`);
  console.log(`  Disk owner found: ${stats.disk_match_found}`);
  console.log(`  Recovered from source: ${stats.recovered_from_source}`);
  console.log(`  True duplicates (deleted): ${stats.true_duplicates_deleted}`);
  console.log(`  Source not found: ${stats.source_not_found}`);
  console.log(`  Errors: ${stats.errors}`);

  if (!DRY_RUN) {
    if (updates.length > 0) {
      console.log(`\nUpdating ${updates.length} File_Path records in NocoDB...`);
      await bulkUpdate(updates);
      console.log('  Done.');
    }
    if (toDelete.length > 0) {
      console.log(`Deleting ${toDelete.length} true duplicate records...`);
      await deleteRecords(toDelete);
      console.log('  Done.');
    }
  }

  // Enrich plant names
  try {
    const plants = await fetchAllRecords('Plants', ['Id1', 'Canonical_Name']);
    const nameMap = new Map(plants.map(p => [p.Id1, p.Canonical_Name]));
    for (const item of lostImages) {
      item.plant_name = nameMap.get(item.plant_id) || item.plant_id;
    }
  } catch {}

  writeFileSync(OUTPUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    stats,
    lost_images: lostImages,
  }, null, 2));
  console.log(`\nReport: ${OUTPUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
