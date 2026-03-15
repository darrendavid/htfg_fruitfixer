#!/usr/bin/env node
/**
 * Phase 4: Image Organization
 *
 * Reads file_inventory.json and copies images into organized structure:
 *   content/parsed/plants/{plant-id}/images/  — plant-associated images
 *   content/parsed/unclassified/images/       — images with no plant match
 *
 * Skips duplicates (keeps first occurrence per duplicate_group).
 * Builds an image manifest for each batch.
 *
 * Usage: node scripts/phase4-organize-images.mjs <batch> <total-batches>
 *   batch: 1-based batch number
 *   total-batches: how many batches to split into
 *
 * Or: node scripts/phase4-organize-images.mjs all
 *   Process everything in one go
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { join, dirname, basename, extname } from 'path';

const ROOT = join(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'content', 'source');
const PARSED = join(ROOT, 'content', 'parsed');

// --- Config ---
const arg1 = process.argv[2];
if (!arg1) {
  console.error('Usage: node scripts/phase4-organize-images.mjs <batch> <total> | all');
  process.exit(1);
}

const isAll = arg1 === 'all';
const batchNum = isAll ? 1 : parseInt(arg1, 10);
const totalBatches = isAll ? 1 : parseInt(process.argv[3] || '8', 10);

// --- Load inventory ---
const inventory = JSON.parse(readFileSync(join(PARSED, 'file_inventory.json'), 'utf-8'));
const allImages = inventory.files.filter(f => f.type === 'image');

console.log(`Total images in inventory: ${allImages.length}`);

// --- Deduplicate: track which duplicate_groups we've already copied ---
// For duplicate groups, only copy the first occurrence (smallest index in array)
const dupGroupSeen = new Set();
const imagesToProcess = [];

for (const img of allImages) {
  if (img.duplicate_group) {
    if (dupGroupSeen.has(img.duplicate_group)) {
      continue; // skip duplicate
    }
    dupGroupSeen.add(img.duplicate_group);
  }
  imagesToProcess.push(img);
}

console.log(`After dedup: ${imagesToProcess.length} unique images (skipped ${allImages.length - imagesToProcess.length} duplicates)`);

// --- Split into batch ---
const batchSize = Math.ceil(imagesToProcess.length / totalBatches);
const startIdx = (batchNum - 1) * batchSize;
const endIdx = Math.min(startIdx + batchSize, imagesToProcess.length);
const batch = imagesToProcess.slice(startIdx, endIdx);

console.log(`\n=== Batch ${batchNum}/${totalBatches}: images ${startIdx + 1}-${endIdx} (${batch.length} files) ===\n`);

// --- Process ---
const manifest = [];
let copied = 0;
let skipped = 0;
let errors = 0;
let totalBytes = 0;

for (let i = 0; i < batch.length; i++) {
  const img = batch[i];
  const srcPath = join(SOURCE, img.path);

  // Determine destination
  let destDir;
  if (img.plant_id) {
    destDir = join(PARSED, 'plants', img.plant_id, 'images');
  } else {
    // Unclassified — preserve source subdirectory structure
    const parts = img.path.split('/');
    const subPath = parts.slice(1, -1).join('/'); // strip source tree prefix, keep subdirs
    destDir = join(PARSED, 'unclassified', 'images', subPath);
  }

  const destFile = join(destDir, basename(img.path));

  // Skip if already exists
  if (existsSync(destFile)) {
    skipped++;
    manifest.push({
      source: img.path,
      dest: destFile.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/') + '/', ''),
      plant_id: img.plant_id,
      size: img.size,
      status: 'already_exists',
    });
    continue;
  }

  // Create directory and copy
  try {
    mkdirSync(destDir, { recursive: true });
    copyFileSync(srcPath, destFile);
    copied++;
    totalBytes += img.size;

    manifest.push({
      source: img.path,
      dest: destFile.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/') + '/', ''),
      plant_id: img.plant_id,
      size: img.size,
      status: 'copied',
    });

    if (copied % 500 === 0) {
      console.log(`  Progress: ${copied} copied, ${skipped} skipped, ${errors} errors (${(totalBytes / 1024 / 1024).toFixed(0)} MB)`);
    }
  } catch (err) {
    errors++;
    manifest.push({
      source: img.path,
      dest: null,
      plant_id: img.plant_id,
      size: img.size,
      status: 'error',
      error: err.message,
    });
  }
}

// --- Write manifest ---
const manifestPath = join(PARSED, `phase4_manifest_batch_${batchNum}.json`);
const output = {
  batch: batchNum,
  total_batches: totalBatches,
  generated: new Date().toISOString(),
  summary: {
    total: batch.length,
    copied,
    skipped,
    errors,
    total_bytes_copied: totalBytes,
    total_mb_copied: parseFloat((totalBytes / 1024 / 1024).toFixed(1)),
    plant_associated: manifest.filter(m => m.plant_id).length,
    unclassified: manifest.filter(m => !m.plant_id).length,
  },
  files: manifest,
};

writeFileSync(manifestPath, JSON.stringify(output, null, 2));

console.log(`\n--- Batch ${batchNum} Complete ---`);
console.log(`Copied: ${copied} files (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
console.log(`Skipped (existing): ${skipped}`);
console.log(`Errors: ${errors}`);
console.log(`Plant-associated: ${manifest.filter(m => m.plant_id).length}`);
console.log(`Unclassified: ${manifest.filter(m => !m.plant_id).length}`);
console.log(`Manifest: ${manifestPath}`);
