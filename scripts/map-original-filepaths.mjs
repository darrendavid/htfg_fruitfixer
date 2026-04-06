#!/usr/bin/env node
/**
 * Map each NocoDB image record back to its original location in content/source/.
 *
 * Strategy:
 * 1. Build filename→[{path, size}] index of all image files in content/source/
 * 2. For each NocoDB image record, read the ACTUAL file on disk to get real size
 * 3. Match by filename + actual disk size against source index
 * 4. Verify matches with MD5 hash for bit-for-bit equality
 * 5. Batch-update NocoDB with Original_Filepath field
 *
 * Usage: node scripts/map-original-filepaths.mjs [--force]
 *   --force: rebuild source index even if cache exists
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, createReadStream } from 'fs';
import { join, extname, basename, relative } from 'path';
import { createHash } from 'crypto';

const ROOT = join(import.meta.dirname, '..');
const PARSED = join(ROOT, 'content', 'parsed');
const SOURCE_ROOT = join(ROOT, 'content', 'source');
const ASSIGNED_ROOT = join(ROOT, 'content', 'pass_01', 'assigned');
const INDEX_CACHE = join(PARSED, 'source_file_index.json');
const OUTPUT_FILE = join(PARSED, 'original_filepath_mapping.json');

const FORCE = process.argv.includes('--force');

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

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.psd']);

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ── Build source file index ─────────────────────────────────────────────────

function walkSource(dir, results) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkSource(full, results);
      } else {
        const ext = extname(entry.name).toLowerCase();
        if (IMG_EXTS.has(ext)) {
          try {
            const st = statSync(full);
            results.push({
              filename: entry.name,
              size: st.size,
              path: relative(ROOT, full).replace(/\\/g, '/'),
            });
          } catch { /* skip unreadable */ }
        }
      }
    }
  } catch { /* skip unreadable dirs */ }
}

function buildSourceIndex() {
  // Check cache (unless --force)
  if (!FORCE && existsSync(INDEX_CACHE)) {
    try {
      const cached = JSON.parse(readFileSync(INDEX_CACHE, 'utf-8'));
      const cacheAge = Date.now() - new Date(cached.built_at).getTime();
      if (cacheAge < 24 * 60 * 60 * 1000) {
        console.log(`  Using cached source index (${cached.total} files, ${(cacheAge / 3600000).toFixed(1)}h old)`);
        return buildMapFromEntries(cached.files);
      }
    } catch { /* rebuild */ }
  }

  console.log('  Walking content/source/ tree (this may take a few minutes)...');
  const results = [];
  walkSource(SOURCE_ROOT, results);
  console.log(`  Found ${results.length} image files in source/`);

  writeFileSync(INDEX_CACHE, JSON.stringify({ built_at: new Date().toISOString(), total: results.length, files: results }));
  return buildMapFromEntries(results);
}

function buildMapFromEntries(entries) {
  // Map: lowercase filename → Map<size, entries[]>
  const map = new Map();
  for (const entry of entries) {
    const key = entry.filename.toLowerCase();
    if (!map.has(key)) map.set(key, new Map());
    const sizeMap = map.get(key);
    if (!sizeMap.has(entry.size)) sizeMap.set(entry.size, []);
    sizeMap.get(entry.size).push(entry);
  }
  return map;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Building source file index...');
  const sourceIndex = buildSourceIndex();
  console.log(`  Index has ${sourceIndex.size} unique filenames`);

  console.log('Fetching image records from NocoDB...');
  const images = await fetchAllRecords('Images',
    ['Id', 'File_Path', 'Size_Bytes', 'Source_Directory', 'Original_Filepath']
  );
  console.log(`  ${images.length} total images`);

  const stats = {
    total: images.length,
    hash_verified: 0,
    size_only: 0,
    filename_only: 0,
    hash_mismatch: 0,
    ambiguous: 0,
    unmatched: 0,
    no_disk_file: 0,
    already_set: 0,
  };
  const updates = [];
  const mismatches = [];
  const ambiguousList = [];

  let processed = 0;
  for (const img of images) {
    processed++;
    if (processed % 500 === 0) process.stdout.write(`  ${processed}/${images.length}...\r`);

    const filePath = img.File_Path || '';

    // Resolve actual file on disk
    const diskPath = join(ROOT, filePath.replace(/\//g, '/'));
    const diskPathNorm = diskPath.replace(/\//g, '\\'); // Windows
    let actualSize;
    try {
      actualSize = statSync(diskPath).size;
    } catch {
      // File not on disk — can't verify
      stats.no_disk_file++;
      continue;
    }

    const filename = basename(filePath);
    const filenameLower = filename.toLowerCase();

    // Try exact filename lookup in source index
    let sizeMap = sourceIndex.get(filenameLower);

    // If no match and filename has dedup suffix (_1, _2), try base name
    if (!sizeMap || sizeMap.size === 0) {
      const ext = extname(filename);
      const stem = basename(filename, ext);
      const baseStem = stem.replace(/_\d+$/, '');
      if (baseStem !== stem) {
        sizeMap = sourceIndex.get((baseStem + ext).toLowerCase());
      }
    }

    if (!sizeMap || sizeMap.size === 0) {
      stats.unmatched++;
      continue;
    }

    // Find candidates with matching ACTUAL disk size
    const sizeCandidates = sizeMap.get(actualSize) || [];

    if (sizeCandidates.length === 0) {
      // No size match — try filename-only (all sizes)
      const allCandidates = [...sizeMap.values()].flat();
      if (allCandidates.length === 1) {
        // Only one source file with this name — low confidence
        updates.push({ Id: img.Id, Original_Filepath: allCandidates[0].path });
        stats.filename_only++;
      } else {
        stats.unmatched++;
      }
      continue;
    }

    if (sizeCandidates.length === 1) {
      // Single candidate with matching size — verify with hash
      const candidate = sizeCandidates[0];
      const sourceAbsPath = join(ROOT, candidate.path);
      try {
        const [diskHash, sourceHash] = await Promise.all([
          md5File(diskPath),
          md5File(sourceAbsPath),
        ]);
        if (diskHash === sourceHash) {
          updates.push({ Id: img.Id, Original_Filepath: candidate.path });
          stats.hash_verified++;
        } else {
          // Same name, same size, different hash — suspicious
          mismatches.push({
            image_id: img.Id,
            file_path: filePath,
            candidate: candidate.path,
            disk_size: actualSize,
            source_size: candidate.size,
            reason: 'hash_mismatch',
          });
          stats.hash_mismatch++;
        }
      } catch {
        // Hash failed (file unreadable) — accept size match
        updates.push({ Id: img.Id, Original_Filepath: candidate.path });
        stats.size_only++;
      }
      continue;
    }

    // Multiple candidates with same filename+size
    // Try Source_Directory as tiebreaker
    const srcDir = (img.Source_Directory || '').replace(/\\/g, '/').toLowerCase();
    let picked = null;

    if (srcDir) {
      // Find candidate whose path contains the source directory
      for (const c of sizeCandidates) {
        const cLower = c.path.toLowerCase();
        // Check if the last 2+ components of Source_Directory are in the path
        const srcParts = srcDir.split('/').filter(Boolean);
        const lastTwo = srcParts.slice(-2).join('/');
        if (lastTwo && cLower.includes(lastTwo)) {
          picked = c;
          break;
        }
      }
      // Fallback: just last component
      if (!picked) {
        const lastPart = srcDir.split('/').filter(Boolean).pop();
        if (lastPart) {
          picked = sizeCandidates.find(c => c.path.toLowerCase().includes(lastPart));
        }
      }
    }

    if (picked) {
      // Verify with hash
      try {
        const [diskHash, sourceHash] = await Promise.all([
          md5File(diskPath),
          md5File(join(ROOT, picked.path)),
        ]);
        if (diskHash === sourceHash) {
          updates.push({ Id: img.Id, Original_Filepath: picked.path });
          stats.hash_verified++;
        } else {
          mismatches.push({
            image_id: img.Id, file_path: filePath, candidate: picked.path,
            disk_size: actualSize, source_size: picked.size, reason: 'hash_mismatch_ambiguous',
          });
          stats.hash_mismatch++;
        }
      } catch {
        updates.push({ Id: img.Id, Original_Filepath: picked.path });
        stats.size_only++;
      }
    } else {
      // Can't disambiguate — try hashing against all candidates
      let hashMatched = false;
      try {
        const diskHash = await md5File(diskPath);
        for (const c of sizeCandidates) {
          try {
            const srcHash = await md5File(join(ROOT, c.path));
            if (diskHash === srcHash) {
              updates.push({ Id: img.Id, Original_Filepath: c.path });
              stats.hash_verified++;
              hashMatched = true;
              break;
            }
          } catch { continue; }
        }
      } catch { /* can't read disk file */ }

      if (!hashMatched) {
        ambiguousList.push({ image_id: img.Id, file_path: filePath, candidates: sizeCandidates.length });
        stats.ambiguous++;
      }
    }
  }

  console.log(`\nMatch results:`);
  console.log(`  Hash verified (bit-for-bit): ${stats.hash_verified}`);
  console.log(`  Size-only (hash unavailable): ${stats.size_only}`);
  console.log(`  Filename-only (no size match): ${stats.filename_only}`);
  console.log(`  Hash mismatch (same name+size, diff content): ${stats.hash_mismatch}`);
  console.log(`  Ambiguous (couldn't pick): ${stats.ambiguous}`);
  console.log(`  Unmatched: ${stats.unmatched}`);
  console.log(`  No disk file: ${stats.no_disk_file}`);
  console.log(`  Total updates to write: ${updates.length}`);

  if (mismatches.length > 0) {
    console.log(`\n  ⚠ ${mismatches.length} hash mismatches (same name+size but different content):`);
    for (const m of mismatches.slice(0, 5)) {
      console.log(`    ${m.file_path} vs ${m.candidate}`);
    }
    if (mismatches.length > 5) console.log(`    ... and ${mismatches.length - 5} more`);
  }

  // First clear ALL Original_Filepath values, then set the verified ones
  console.log('\nClearing all existing Original_Filepath values...');
  const toClear = images.filter(i => i.Original_Filepath).map(i => ({ Id: i.Id, Original_Filepath: null }));
  if (toClear.length > 0) {
    await bulkUpdate('Images', toClear);
    console.log(`  Cleared ${toClear.length} records.`);
  }

  if (updates.length > 0) {
    console.log(`Writing ${updates.length} verified matches to NocoDB...`);
    await bulkUpdate('Images', updates);
    console.log('  Done.');
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    stats,
    mismatches,
    ambiguous: ambiguousList,
  }, null, 2));
  console.log(`\nReport: ${OUTPUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
