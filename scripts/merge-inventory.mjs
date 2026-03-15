#!/usr/bin/env node
/**
 * Phase 2 Inventory Merge
 *
 * Merges all phase2_inventory_batch_*.json files into a single file_inventory.json.
 * Also detects duplicate files by grouping on file size and comparing names.
 *
 * Usage: node scripts/merge-inventory.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const ROOT = join(import.meta.dirname, '..');
const PARSED_DIR = join(ROOT, 'content', 'parsed');

// Find all batch files
const batchFiles = readdirSync(PARSED_DIR)
  .filter(f => f.startsWith('phase2_inventory_batch_') && f.endsWith('.json'))
  .sort();

if (batchFiles.length === 0) {
  console.error('No batch files found in content/parsed/');
  process.exit(1);
}

console.log(`Found ${batchFiles.length} batch files`);

// Merge all files
const allFiles = [];
let totalSize = 0;
let totalErrors = 0;

for (const bf of batchFiles) {
  const batch = JSON.parse(readFileSync(join(PARSED_DIR, bf), 'utf-8'));
  console.log(`  ${bf}: ${batch.file_count} files, ${(batch.total_size_bytes / 1024 / 1024).toFixed(1)} MB`);
  allFiles.push(...batch.files);
  totalSize += batch.total_size_bytes;
  totalErrors += batch.error_count;
}

console.log(`\nTotal files: ${allFiles.length}`);
console.log(`Total size: ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);

// --- Duplicate detection ---
// Group by file size + basename as candidate duplicates
const sizeNameGroups = new Map();
for (let i = 0; i < allFiles.length; i++) {
  const f = allFiles[i];
  const key = `${f.size}:${basename(f.path).toLowerCase()}`;
  if (!sizeNameGroups.has(key)) {
    sizeNameGroups.set(key, []);
  }
  sizeNameGroups.get(key).push(i);
}

// Mark duplicates (groups with >1 file of same size+name)
const duplicateGroups = [];
let dupGroupId = 0;
for (const [key, indices] of sizeNameGroups) {
  if (indices.length > 1) {
    dupGroupId++;
    for (const idx of indices) {
      allFiles[idx].duplicate_group = dupGroupId;
    }
    duplicateGroups.push({
      group_id: dupGroupId,
      size: allFiles[indices[0]].size,
      name: basename(allFiles[indices[0]].path),
      count: indices.length,
      paths: indices.map(i => allFiles[i].path),
    });
  }
}

// --- Statistics ---
const typeCounts = {};
const plantCounts = {};
let plantHits = 0;
let needsReview = 0;

for (const f of allFiles) {
  typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
  if (f.plant_id) {
    plantHits++;
    plantCounts[f.plant_id] = (plantCounts[f.plant_id] || 0) + 1;
  }
  if (f.needs_review) needsReview++;
}

// Sort plants by file count
const topPlants = Object.entries(plantCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);

// Extension breakdown
const extCounts = {};
for (const f of allFiles) {
  const ext = f.ext || '(none)';
  extCounts[ext] = (extCounts[ext] || 0) + 1;
}
const topExts = Object.entries(extCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);

const summary = {
  total_files: allFiles.length,
  total_size_bytes: totalSize,
  total_size_gb: parseFloat((totalSize / 1024 / 1024 / 1024).toFixed(2)),
  plant_associated: plantHits,
  plant_associated_pct: parseFloat(((plantHits / allFiles.length) * 100).toFixed(1)),
  needs_review: needsReview,
  duplicate_groups: duplicateGroups.length,
  duplicate_files: duplicateGroups.reduce((s, g) => s + g.count, 0),
  errors: totalErrors,
  by_type: typeCounts,
  top_extensions: Object.fromEntries(topExts),
  top_plants_by_files: Object.fromEntries(topPlants),
};

// Write outputs
const inventoryPath = join(PARSED_DIR, 'file_inventory.json');
writeFileSync(inventoryPath, JSON.stringify({
  generated: new Date().toISOString(),
  summary,
  files: allFiles,
}, null, 2));

if (duplicateGroups.length > 0) {
  const dupsPath = join(PARSED_DIR, 'phase2_duplicates.json');
  writeFileSync(dupsPath, JSON.stringify({
    generated: new Date().toISOString(),
    total_groups: duplicateGroups.length,
    total_files: duplicateGroups.reduce((s, g) => s + g.count, 0),
    groups: duplicateGroups,
  }, null, 2));
  console.log(`\nDuplicate groups: ${duplicateGroups.length} (${duplicateGroups.reduce((s, g) => s + g.count, 0)} files)`);
  console.log(`Wrote: ${dupsPath}`);
}

// Write needs-review list
const reviewFiles = allFiles.filter(f => f.needs_review);
if (reviewFiles.length > 0) {
  const reviewPath = join(PARSED_DIR, 'phase2_needs_review.json');
  writeFileSync(reviewPath, JSON.stringify({
    generated: new Date().toISOString(),
    total: reviewFiles.length,
    files: reviewFiles,
  }, null, 2));
  console.log(`Needs review: ${reviewFiles.length} files`);
  console.log(`Wrote: ${reviewPath}`);
}

console.log(`\n=== Phase 2 Inventory Complete ===`);
console.log(`Total files: ${allFiles.length}`);
console.log(`Total size: ${summary.total_size_gb} GB`);
console.log(`Plant associated: ${plantHits} (${summary.plant_associated_pct}%)`);
console.log(`Needs review: ${needsReview}`);
console.log(`By type:`, typeCounts);
console.log(`Top extensions:`, Object.fromEntries(topExts));
console.log(`Top plants:`, Object.fromEntries(topPlants.slice(0, 10)));
console.log(`\nWrote: ${inventoryPath}`);
