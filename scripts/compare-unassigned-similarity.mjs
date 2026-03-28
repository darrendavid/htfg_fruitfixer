/**
 * Compare unassigned images against assigned/hidden using perceptual hashing.
 * - Finds visual duplicates across folders
 * - Tracks cases where unassigned has higher resolution than assigned
 * - Moves unassigned images to hidden if they match hidden images at lower resolution
 */

import { join, basename, relative } from 'path';
import { existsSync, readdirSync, statSync, renameSync, mkdirSync, writeFileSync } from 'fs';
import sharp from 'sharp';

const PASS01 = join(import.meta.dirname, '..', 'content', 'pass_01');
const ASSIGNED_DIR = join(PASS01, 'assigned');
const HIDDEN_DIR = join(PASS01, 'hidden');
const UNASSIGNED_DIR = join(PASS01, 'unassigned');
const HAMMING_THRESHOLD = parseInt(process.argv.find(a => a.startsWith('--threshold='))?.split('=')[1] ?? '8');
const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] ?? '10');

const IMAGE_EXTS = /\.(jpe?g|png|gif|bmp|webp)$/i;

/** Compute 64-bit dHash as 16-char hex string */
async function computeHash(filePath) {
  try {
    const { data } = await sharp(filePath)
      .resize(9, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let hash = 0n;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left = data[row * 9 + col];
        const right = data[row * 9 + col + 1];
        if (left > right) {
          hash |= 1n << BigInt(row * 8 + col);
        }
      }
    }
    return hash.toString(16).padStart(16, '0');
  } catch {
    return null;
  }
}

/** Get image dimensions */
async function getDimensions(filePath) {
  try {
    const meta = await sharp(filePath).metadata();
    return { width: meta.width ?? 0, height: meta.height ?? 0, pixels: (meta.width ?? 0) * (meta.height ?? 0) };
  } catch {
    return { width: 0, height: 0, pixels: 0 };
  }
}

/** Hamming distance between two hex hash strings */
function hammingDistance(h1, h2) {
  if (!h1 || !h2 || h1.length !== h2.length) return 64;
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    const xor = parseInt(h1[i], 16) ^ parseInt(h2[i], 16);
    dist += ((xor >> 3) & 1) + ((xor >> 2) & 1) + ((xor >> 1) & 1) + (xor & 1);
  }
  return dist;
}

/** Recursively collect image files */
function collectImages(dir, baseDir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectImages(full, baseDir));
    } else if (IMAGE_EXTS.test(entry.name)) {
      files.push({ path: full, rel: relative(baseDir, full) });
    }
  }
  return files;
}

/** Process files with concurrency limit */
async function processWithConcurrency(items, fn, concurrency) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function run() {
  console.log(`Similarity comparison (threshold=${HAMMING_THRESHOLD}, concurrency=${CONCURRENCY}${DRY_RUN ? ', DRY RUN' : ''})`);

  // Collect files
  console.log('\nCollecting files...');
  const assignedFiles = collectImages(ASSIGNED_DIR, PASS01);
  const hiddenFiles = collectImages(HIDDEN_DIR, PASS01);
  const unassignedFiles = collectImages(UNASSIGNED_DIR, PASS01);
  console.log(`  Assigned: ${assignedFiles.length}, Hidden: ${hiddenFiles.length}, Unassigned: ${unassignedFiles.length}`);

  // Hash assigned + hidden (the reference set)
  console.log('\nHashing assigned + hidden images...');
  const refFiles = [...assignedFiles.map(f => ({ ...f, source: 'assigned' })), ...hiddenFiles.map(f => ({ ...f, source: 'hidden' }))];
  let refHashed = 0;
  const refHashes = await processWithConcurrency(refFiles, async (file, i) => {
    const hash = await computeHash(file.path);
    refHashed++;
    if (refHashed % 1000 === 0) console.log(`  Ref hashed: ${refHashed}/${refFiles.length}`);
    return { ...file, hash };
  }, CONCURRENCY);
  const validRefs = refHashes.filter(r => r.hash);
  console.log(`  Hashed: ${validRefs.length} (${refFiles.length - validRefs.length} errors)`);

  // Hash unassigned
  console.log('\nHashing unassigned images...');
  let unHashed = 0;
  const unHashes = await processWithConcurrency(unassignedFiles, async (file, i) => {
    const hash = await computeHash(file.path);
    unHashed++;
    if (unHashed % 500 === 0) console.log(`  Unassigned hashed: ${unHashed}/${unassignedFiles.length}`);
    return { ...file, hash };
  }, CONCURRENCY);
  const validUn = unHashes.filter(r => r.hash);
  console.log(`  Hashed: ${validUn.length} (${unassignedFiles.length - validUn.length} errors)`);

  // Compare each unassigned against all refs
  console.log('\nComparing unassigned against assigned+hidden...');
  const matches = [];
  const movedToHidden = [];
  const higherResUpgrades = [];
  let compared = 0;

  for (const un of validUn) {
    let bestMatch = null;
    let bestDist = HAMMING_THRESHOLD + 1;

    for (const ref of validRefs) {
      const dist = hammingDistance(un.hash, ref.hash);
      if (dist <= HAMMING_THRESHOLD && dist < bestDist) {
        bestDist = dist;
        bestMatch = ref;
      }
    }

    if (bestMatch) {
      // Get dimensions for both
      const unDim = await getDimensions(un.path);
      const refDim = await getDimensions(bestMatch.path);

      const match = {
        unassigned: un.rel,
        matched_to: bestMatch.rel,
        matched_source: bestMatch.source,
        distance: bestDist,
        unassigned_res: `${unDim.width}x${unDim.height}`,
        matched_res: `${refDim.width}x${refDim.height}`,
        unassigned_pixels: unDim.pixels,
        matched_pixels: refDim.pixels,
        unassigned_higher_res: unDim.pixels > refDim.pixels,
      };
      matches.push(match);

      if (bestMatch.source === 'hidden' && unDim.pixels <= refDim.pixels) {
        // Move unassigned to hidden (lower or equal res, matched to hidden)
        if (!DRY_RUN) {
          const destName = basename(un.path);
          let dest = join(HIDDEN_DIR, destName);
          let counter = 1;
          while (existsSync(dest)) {
            const ext = destName.slice(destName.lastIndexOf('.'));
            dest = join(HIDDEN_DIR, destName.slice(0, -ext.length) + `_${counter}` + ext);
            counter++;
          }
          try {
            const { copyFileSync } = await import('fs');
            copyFileSync(un.path, dest);
            movedToHidden.push(match);
          } catch {}
        } else {
          movedToHidden.push(match);
        }
      }

      if (bestMatch.source === 'assigned' && unDim.pixels > refDim.pixels) {
        higherResUpgrades.push(match);
      }
    }

    compared++;
    if (compared % 500 === 0) console.log(`  Compared: ${compared}/${validUn.length}, matches: ${matches.length}`);
  }

  // Report
  console.log('\n' + '='.repeat(60));
  console.log('SIMILARITY COMPARISON REPORT');
  console.log('='.repeat(60));
  console.log(`Total unassigned compared: ${validUn.length}`);
  console.log(`Matches found: ${matches.length}`);
  console.log(`  vs assigned: ${matches.filter(m => m.matched_source === 'assigned').length}`);
  console.log(`  vs hidden: ${matches.filter(m => m.matched_source === 'hidden').length}`);
  console.log(`Moved to hidden (lower res match): ${movedToHidden.length}`);
  console.log(`Higher-res upgrades available: ${higherResUpgrades.length}`);

  if (higherResUpgrades.length > 0) {
    console.log('\nTop higher-res upgrades:');
    higherResUpgrades.slice(0, 10).forEach(m => {
      console.log(`  ${m.unassigned} (${m.unassigned_res}) > ${m.matched_to} (${m.matched_res}) dist=${m.distance}`);
    });
  }

  // Save mapping file
  const report = {
    generated: new Date().toISOString(),
    threshold: HAMMING_THRESHOLD,
    summary: {
      unassigned_compared: validUn.length,
      total_matches: matches.length,
      matched_to_assigned: matches.filter(m => m.matched_source === 'assigned').length,
      matched_to_hidden: matches.filter(m => m.matched_source === 'hidden').length,
      moved_to_hidden: movedToHidden.length,
      higher_res_upgrades: higherResUpgrades.length,
    },
    higher_res_upgrades: higherResUpgrades,
    moved_to_hidden: movedToHidden,
    all_matches: matches,
  };

  const reportPath = join(PASS01, 'similarity_mapping.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nMapping saved to: ${reportPath}`);
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
