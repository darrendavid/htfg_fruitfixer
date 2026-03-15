#!/usr/bin/env node
/**
 * Phase 2 File Inventory Worker
 *
 * Walks a batch of directories under content/source/ and catalogs every file.
 * Designed to be run in parallel by multiple agents on different batches.
 *
 * Usage: node scripts/inventory-worker.mjs <batch-number>
 *   Reads batch config from scripts/phase2-batches.json
 *   Outputs to content/parsed/phase2_inventory_batch_<N>.json
 */

import { readFileSync, writeFileSync, statSync } from 'fs';
import { join, extname, relative, basename, dirname } from 'path';
import fg from 'fast-glob';

const ROOT = join(import.meta.dirname, '..');
const SOURCE_DIR = join(ROOT, 'content', 'source');
const PARSED_DIR = join(ROOT, 'content', 'parsed');

// --- Config ---
const batchNum = parseInt(process.argv[2], 10);
if (isNaN(batchNum)) {
  console.error('Usage: node scripts/inventory-worker.mjs <batch-number>');
  process.exit(1);
}

const batchConfig = JSON.parse(readFileSync(join(ROOT, 'scripts', 'phase2-batches.json'), 'utf-8'));
const batch = batchConfig.batches.find(b => b.id === batchNum);
if (!batch) {
  console.error(`Batch ${batchNum} not found in phase2-batches.json`);
  process.exit(1);
}

// --- Load plant registry for association ---
const registry = JSON.parse(readFileSync(join(PARSED_DIR, 'plant_registry.json'), 'utf-8'));

// Build lookup maps for plant association
// Map directory names (lowercased) -> plant id
const dirToPlant = new Map();
for (const plant of registry.plants) {
  // hwfn_directories
  for (const d of (plant.hwfn_directories || [])) {
    dirToPlant.set(d.toLowerCase(), plant.id);
  }
  // original_directories
  for (const d of (plant.original_directories || [])) {
    dirToPlant.set(d.toLowerCase(), plant.id);
  }
  // Also map the plant id itself and common name
  dirToPlant.set(plant.id.toLowerCase(), plant.id);
  dirToPlant.set(plant.common_name.toLowerCase(), plant.id);
  // Aliases
  for (const alias of (plant.aliases || [])) {
    dirToPlant.set(alias.toLowerCase(), plant.id);
  }
}

// --- File type classification ---
const TYPE_MAP = {
  // Images
  '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.png': 'image',
  '.bmp': 'image', '.tif': 'image', '.tiff': 'image', '.webp': 'image', '.ico': 'image',
  // Design
  '.psd': 'design', '.ai': 'design', '.svg': 'design',
  // Documents
  '.doc': 'document', '.docx': 'document', '.pdf': 'document',
  '.ppt': 'document', '.pptx': 'document', '.pps': 'document',
  '.xls': 'spreadsheet', '.xlsx': 'spreadsheet', '.csv': 'spreadsheet',
  // Web content
  '.html': 'web', '.htm': 'web',
  // Code/config (skip candidates)
  '.css': 'style', '.js': 'script',
  '.xml': 'data', '.json': 'data',
  // Text
  '.txt': 'text', '.eml': 'email', '.rtf': 'text',
  // Metadata (skip candidates)
  '.ini': 'metadata', '.db': 'metadata', '.dat': 'metadata',
  // Video/Audio
  '.mp4': 'video', '.avi': 'video', '.mov': 'video', '.wmv': 'video',
  '.mp3': 'audio', '.wav': 'audio',
  // Archives
  '.zip': 'archive', '.rar': 'archive', '.7z': 'archive',
};

function classifyFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath).toLowerCase();

  // Special metadata files
  if (name === 'desktop.ini' || name === 'thumbs.db' || name === '.ds_store') return 'metadata';
  if (name === 'userselections.txt') return 'metadata';

  return TYPE_MAP[ext] || 'other';
}

// --- Plant association logic ---
function associatePlant(relPath) {
  // Walk up the directory path trying to match against known plant directories
  const parts = relPath.split('/');

  // parts[0] is 'HawaiiFruit. Net' or 'original'
  // parts[1] would be the first subdirectory - most likely match
  // Try each directory level
  for (let i = parts.length - 2; i >= 1; i--) {
    const dirName = parts[i].toLowerCase();
    if (dirToPlant.has(dirName)) {
      return { plant_id: dirToPlant.get(dirName), confidence: i === 1 ? 'high' : 'medium', matched_dir: parts[i] };
    }
  }

  // Try filename-based matching (weaker signal)
  const fileName = basename(relPath, extname(relPath)).toLowerCase();
  for (const [key, plantId] of dirToPlant) {
    if (key.length > 3 && fileName.includes(key)) {
      return { plant_id: plantId, confidence: 'low', matched_dir: null };
    }
  }

  return { plant_id: null, confidence: null, matched_dir: null };
}

// --- Main ---
async function run() {
  console.log(`\n=== Phase 2 Inventory Worker - Batch ${batchNum}: ${batch.label} ===`);
  console.log(`Processing ${batch.paths.length} path(s)...`);

  const results = [];
  let totalSize = 0;
  let errorCount = 0;

  for (const pathSpec of batch.paths) {
    const fullDir = join(SOURCE_DIR, pathSpec.path);
    const globPattern = pathSpec.glob || '**/*';

    console.log(`  Scanning: ${pathSpec.path} (${globPattern})`);

    let files;
    try {
      // fast-glob needs forward slashes
      const searchPath = join(fullDir, globPattern).replace(/\\/g, '/');
      files = await fg(searchPath, {
        dot: true,
        onlyFiles: true,
        suppressErrors: true,
        stats: true,
      });
    } catch (err) {
      console.error(`  ERROR scanning ${pathSpec.path}: ${err.message}`);
      errorCount++;
      continue;
    }

    console.log(`  Found ${files.length} files`);

    for (const entry of files) {
      const filePath = entry.path;
      const relPath = relative(SOURCE_DIR, filePath).replace(/\\/g, '/');
      const size = entry.stats?.size ?? 0;
      const type = classifyFile(filePath);
      const assoc = associatePlant(relPath);

      totalSize += size;

      results.push({
        path: relPath,
        type,
        ext: extname(filePath).toLowerCase() || null,
        size,
        plant_id: assoc.plant_id,
        confidence: assoc.confidence,
        matched_dir: assoc.matched_dir,
        needs_review: assoc.plant_id === null && type !== 'metadata',
      });
    }
  }

  // Write batch output
  const outputPath = join(PARSED_DIR, `phase2_inventory_batch_${batchNum}.json`);
  const output = {
    batch_id: batchNum,
    label: batch.label,
    generated: new Date().toISOString(),
    file_count: results.length,
    total_size_bytes: totalSize,
    error_count: errorCount,
    files: results,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2));

  // Print summary
  const typeCounts = {};
  const plantHits = results.filter(r => r.plant_id).length;
  for (const r of results) {
    typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;
  }

  console.log(`\n--- Batch ${batchNum} Summary ---`);
  console.log(`Total files: ${results.length}`);
  console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Plant associations: ${plantHits} (${((plantHits / results.length) * 100).toFixed(1)}%)`);
  console.log(`Needs review: ${results.filter(r => r.needs_review).length}`);
  console.log(`By type:`, typeCounts);
  console.log(`Errors: ${errorCount}`);
  console.log(`Output: ${outputPath}`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
