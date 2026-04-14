#!/usr/bin/env node
/**
 * dedup-unclassified-phash.mjs
 *
 * 1. Walk unclassified/ and compute dHash for every image.
 * 2. Group images that are perceptually similar (Hamming distance ≤ 8).
 * 3. Within each duplicate group keep the highest-resolution image.
 *    Tiebreak: prefer no suffix > _1 > _2 (lower suffix wins).
 * 4. Delete the losers (move to unassigned/ignored/).
 *
 * Usage:
 *   node scripts/dedup-unclassified-phash.mjs --dry-run
 *   node scripts/dedup-unclassified-phash.mjs
 */

import { createRequire } from 'module';
import { readdirSync, statSync, existsSync, mkdirSync, renameSync, copyFileSync, unlinkSync } from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const sharp = require(path.join(path.resolve(import.meta.dirname, '..'), 'review-ui/node_modules/sharp'));

const ROOT           = path.resolve(import.meta.dirname, '..');
const UNCLASSIFIED   = path.join(ROOT, 'content/pass_01/unassigned/unclassified');
const IGNORED_DIR    = path.join(ROOT, 'content/pass_01/unassigned/ignored');
const DRY_RUN        = process.argv.includes('--dry-run');
const HAMMING_THRESH = 8;
const CONCURRENCY    = 12;

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.pct', '.psd', '.nef', '.heic']);

if (DRY_RUN) console.log('[DRY RUN]\n');

// ── Collect images ────────────────────────────────────────────────────────────
function walkImages(dir, results) {
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walkImages(full, results); continue; }
      if (IMG_EXTS.has(path.extname(e.name).toLowerCase())) results.push(full);
    }
  } catch { /* skip */ }
}

const files = [];
walkImages(UNCLASSIFIED, files);
console.log(`Found ${files.length} images. Computing perceptual hashes...\n`);

// ── dHash ─────────────────────────────────────────────────────────────────────
async function computeDHash(absPath) {
  const { data } = await sharp(absPath)
    .grayscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = 0n;
  let bit = 63;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (data[row * 9 + col] > data[row * 9 + col + 1]) hash |= 1n << BigInt(bit);
      bit--;
    }
  }
  return hash.toString(16).padStart(16, '0');
}

// ── Hamming distance ──────────────────────────────────────────────────────────
function hammingDistance(a, b) {
  let dist = 0;
  for (let i = 0; i < 16; i++) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (xor) { dist += xor & 1; xor >>= 1; }
  }
  return dist;
}

// ── Hash all images with bounded concurrency ──────────────────────────────────
const hashes = new Array(files.length).fill(null); // null = failed
let done = 0;
let hashErrors = 0;

async function hashWorker(queue) {
  while (queue.length) {
    const { idx, abs } = queue.pop();
    try {
      hashes[idx] = await computeDHash(abs);
    } catch {
      hashErrors++;
    }
    done++;
    if (done % 100 === 0 || done === files.length) {
      process.stdout.write(`  Hashed ${done}/${files.length} (${hashErrors} errors)\r`);
    }
  }
}

const queue = files.map((abs, idx) => ({ idx, abs }));
const workers = [];
for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) workers.push(hashWorker(queue));
await Promise.all(workers);
console.log(`\n\nHashing complete. ${hashErrors} images skipped (unreadable).\n`);

// ── Union-Find grouping ───────────────────────────────────────────────────────
const parent = Array.from({ length: files.length }, (_, i) => i);
function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
function union(x, y) { parent[find(x)] = find(y); }

const validIndices = files.map((_, i) => i).filter(i => hashes[i] !== null);

console.log(`Comparing ${validIndices.length} hashes for duplicates...`);
let pairCount = 0;
for (let a = 0; a < validIndices.length; a++) {
  for (let b = a + 1; b < validIndices.length; b++) {
    const i = validIndices[a], j = validIndices[b];
    if (hammingDistance(hashes[i], hashes[j]) <= HAMMING_THRESH) {
      union(i, j);
      pairCount++;
    }
  }
}
console.log(`Found ${pairCount} similar pairs.\n`);

// ── Build groups (only those with >1 member) ──────────────────────────────────
const groupMap = new Map();
for (const i of validIndices) {
  const root = find(i);
  if (!groupMap.has(root)) groupMap.set(root, []);
  groupMap.get(root).push(i);
}
const dupGroups = [...groupMap.values()].filter(g => g.length > 1);
console.log(`Duplicate groups: ${dupGroups.length} (${dupGroups.reduce((n, g) => n + g.length, 0)} images total)`);

if (dupGroups.length === 0) {
  console.log('\nNo duplicates found. Nothing to do.');
  process.exit(0);
}

// ── Suffix score: lower = more "canonical" ────────────────────────────────────
// foo.jpg → 0, foo_1.jpg → 1, foo_2.jpg → 2, foo_1_1.jpg → 101, etc.
function canonScore(absPath) {
  const name = path.basename(absPath, path.extname(absPath));
  const m = name.match(/(_\d+)+$/);
  if (!m) return 0;
  const suffixes = m[0].match(/_(\d+)/g).map(s => parseInt(s.slice(1), 10));
  return suffixes.reduce((acc, n, i) => acc + n * Math.pow(100, suffixes.length - 1 - i), 0);
}

// ── Resolve keeper for each group ─────────────────────────────────────────────
function moveFile(src, dest) {
  try { renameSync(src, dest); }
  catch { copyFileSync(src, dest); unlinkSync(src); }
}

function safeDestPath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  for (let i = 1; existsSync(candidate); i++) candidate = path.join(dir, `${base}_${i}${ext}`);
  return candidate;
}

let deleted = 0;
let kept = 0;

for (const group of dupGroups) {
  // Fetch pixel dimensions for each member
  const members = await Promise.all(group.map(async (idx) => {
    const abs = files[idx];
    let pixels = 0;
    try {
      const meta = await sharp(abs).metadata();
      pixels = (meta.width ?? 0) * (meta.height ?? 0);
    } catch { /* leave at 0 */ }
    return { idx, abs, pixels, score: canonScore(abs) };
  }));

  // Sort: highest pixels first, then lowest canon score (fewest suffixes)
  members.sort((a, b) => b.pixels - a.pixels || a.score - b.score);

  const keeper = members[0];
  const losers = members.slice(1);

  kept++;

  for (const loser of losers) {
    const rel = path.relative(UNCLASSIFIED, loser.abs);
    const dest = safeDestPath(IGNORED_DIR, path.basename(loser.abs));
    if (DRY_RUN) {
      console.log(`  DELETE ${rel}  (${loser.pixels}px, score=${loser.score})`);
      console.log(`  KEEP   ${path.relative(UNCLASSIFIED, keeper.abs)}  (${keeper.pixels}px, score=${keeper.score})`);
      console.log();
    } else {
      try {
        mkdirSync(IGNORED_DIR, { recursive: true });
        moveFile(loser.abs, dest);
        deleted++;
      } catch (err) {
        console.warn(`  WARN: could not move ${rel}: ${err.message}`);
      }
    }
    if (DRY_RUN) deleted++;
  }
}

console.log(`\n══════════════════════════════════`);
console.log(`Groups found:   ${dupGroups.length}`);
console.log(`Kept:           ${kept}`);
console.log(`Deleted/moved:  ${deleted}`);
if (DRY_RUN) console.log('\n[DRY RUN] Re-run without --dry-run to apply.');
else console.log('\nDone.');
