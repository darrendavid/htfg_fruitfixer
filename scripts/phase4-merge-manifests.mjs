#!/usr/bin/env node
/**
 * Merges all phase4_manifest_batch_*.json into a single phase4_image_manifest.json
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PARSED = join(import.meta.dirname, '..', 'content', 'parsed');

const batchFiles = readdirSync(PARSED)
  .filter(f => f.startsWith('phase4_manifest_batch_') && f.endsWith('.json'))
  .sort();

if (batchFiles.length === 0) {
  console.error('No batch manifest files found');
  process.exit(1);
}

console.log(`Merging ${batchFiles.length} batch manifests...`);

const allFiles = [];
let totalCopied = 0, totalSkipped = 0, totalErrors = 0, totalBytes = 0;

for (const bf of batchFiles) {
  const batch = JSON.parse(readFileSync(join(PARSED, bf), 'utf-8'));
  console.log(`  ${bf}: ${batch.summary.total} files, ${batch.summary.total_mb_copied} MB copied`);
  allFiles.push(...batch.files);
  totalCopied += batch.summary.copied;
  totalSkipped += batch.summary.skipped;
  totalErrors += batch.summary.errors;
  totalBytes += batch.summary.total_bytes_copied;
}

// Plant breakdown
const plantCounts = {};
for (const f of allFiles) {
  if (f.plant_id) {
    plantCounts[f.plant_id] = (plantCounts[f.plant_id] || 0) + 1;
  }
}

const topPlants = Object.entries(plantCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);

const summary = {
  total_images: allFiles.length,
  copied: totalCopied,
  skipped: totalSkipped,
  errors: totalErrors,
  total_bytes: totalBytes,
  total_gb: parseFloat((totalBytes / 1024 / 1024 / 1024).toFixed(2)),
  plant_associated: allFiles.filter(f => f.plant_id).length,
  unclassified: allFiles.filter(f => !f.plant_id).length,
  unique_plants: Object.keys(plantCounts).length,
  top_plants: Object.fromEntries(topPlants),
};

writeFileSync(join(PARSED, 'phase4_image_manifest.json'), JSON.stringify({
  generated: new Date().toISOString(),
  summary,
  files: allFiles,
}, null, 2));

console.log(`\n=== Phase 4 Image Organization Complete ===`);
console.log(`Total images: ${allFiles.length}`);
console.log(`Copied: ${totalCopied} (${summary.total_gb} GB)`);
console.log(`Skipped: ${totalSkipped}`);
console.log(`Errors: ${totalErrors}`);
console.log(`Plant-associated: ${summary.plant_associated} across ${summary.unique_plants} plants`);
console.log(`Unclassified: ${summary.unclassified}`);
console.log(`Top plants:`, Object.fromEntries(topPlants.slice(0, 10)));
console.log(`\nWrote: phase4_image_manifest.json`);
