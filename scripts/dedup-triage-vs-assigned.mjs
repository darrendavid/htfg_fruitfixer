/**
 * dedup-triage-vs-assigned.mjs
 *
 * Compares all triage images against all assigned images using:
 *   1. Exact duplicate detection: filename + Size_Bytes match → MD5 hash verify
 *   2. Perceptual similarity: Hamming distance on Perceptual_Hash (dHash) ≤ 10
 *
 * Reports duplicates and near-duplicates. Does NOT make any changes.
 *
 * Run: node scripts/dedup-triage-vs-assigned.mjs
 */

import { readFileSync, existsSync, openSync, readSync, closeSync } from 'fs';
import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: 'review-ui/.env' });

const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const IDS       = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const H         = { 'xc-token': NOCODB_KEY };
const PROJ_ROOT = process.cwd();       // htfg_fruitfixer root
const PHASH_THRESHOLD = 10;            // Hamming distance ≤ 10 → similar

const norm = p => p?.replace(/\\/g, '/') || '';

// ── NocoDB fetch ───────────────────────────────────────────────────────────────

async function fetchAll(where, fields) {
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      limit: '200', offset: String(offset),
      where, fields: fields.join(','),
    });
    const r = await fetch(
      `${NOCODB_URL}/api/v2/tables/${IDS.Images}/records?${params}`,
      { headers: H },
    );
    if (!r.ok) throw new Error(`NocoDB ${r.status}: ${await r.text()}`);
    const d = await r.json();
    all.push(...(d.list ?? []));
    if (d.pageInfo?.isLastPage) break;
    offset += 200;
    if (offset % 5000 === 0) process.stderr.write(String(offset) + '…');
  }
  process.stderr.write('\n');
  return all;
}

// ── File helpers ───────────────────────────────────────────────────────────────

function absPath(fp) {
  const rel = norm(fp).replace(/^content\//, '');
  return path.join(PROJ_ROOT, 'content', rel);
}

function md5File(filePath) {
  try {
    const buf = readFileSync(filePath);
    return crypto.createHash('md5').update(buf).digest('hex');
  } catch { return null; }
}

// ── Perceptual hash Hamming distance ──────────────────────────────────────────

function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let dist = 0;
  // stored as hex string (16 chars = 64-bit dHash)
  for (let i = 0; i < a.length; i += 2) {
    const byteA = parseInt(a.slice(i, i + 2), 16);
    const byteB = parseInt(b.slice(i, i + 2), 16);
    let xor = byteA ^ byteB;
    while (xor) { dist += xor & 1; xor >>= 1; }
  }
  return dist;
}

// ── Main ───────────────────────────────────────────────────────────────────────

console.log('\n=== triage vs assigned dedup audit ===\n');

console.log('Fetching triage images…');
const triageImages = await fetchAll(
  '(Status,eq,triage)',
  ['Id', 'File_Path', 'Plant_Id', 'Size_Bytes', 'Perceptual_Hash', 'Caption', 'Variety_Id'],
);
console.log(`  ${triageImages.length} triage images\n`);

console.log('Fetching assigned images…');
const assignedImages = await fetchAll(
  '(Status,eq,assigned)',
  ['Id', 'File_Path', 'Plant_Id', 'Size_Bytes', 'Perceptual_Hash', 'Caption', 'Variety_Id'],
);
console.log(`  ${assignedImages.length} assigned images\n`);

// Build assigned indices
console.log('Building indices…');

// filename + size → [assigned records]  (for exact dup detection)
const assignedByFilenameSize = new Map();
for (const r of assignedImages) {
  const fname = path.basename(norm(r.File_Path || '')).toLowerCase();
  const key   = `${fname}|||${r.Size_Bytes ?? ''}`;
  if (!assignedByFilenameSize.has(key)) assignedByFilenameSize.set(key, []);
  assignedByFilenameSize.get(key).push(r);
}

// phash → [assigned records]  (for similarity detection)
// Group by phash prefix buckets for speed (first 2 hex chars = first byte)
const assignedWithHash = assignedImages.filter(r => r.Perceptual_Hash);
console.log(`  ${assignedImages.length} assigned indexed, ${assignedWithHash.length} have phash\n`);

// ── Scan triage images ────────────────────────────────────────────────────────

const exactDups      = [];   // {triage, assigned[], md5}
const exactCandidates = [];  // {triage, assigned[]} — size+name match but no MD5 yet
const similarImages  = [];   // {triage, matches: [{assigned, distance}]}
const triageNoPHash  = [];

let progress = 0;

for (const t of triageImages) {
  progress++;
  if (progress % 100 === 0) process.stderr.write(`${progress}/${triageImages.length}…`);

  const fname  = path.basename(norm(t.File_Path || '')).toLowerCase();
  const fsize  = t.Size_Bytes ?? '';
  const key    = `${fname}|||${fsize}`;

  // ── Exact dup check (filename + size) ─────────────────────────────────
  const sizeMatches = assignedByFilenameSize.get(key) || [];
  if (sizeMatches.length > 0 && fsize !== '') {
    // Verify with MD5
    const triagePath = absPath(t.File_Path || '');
    if (existsSync(triagePath)) {
      const triageMd5 = md5File(triagePath);
      const confirmedDups = [];
      for (const a of sizeMatches) {
        const assignedPath = absPath(a.File_Path || '');
        if (existsSync(assignedPath)) {
          const assignedMd5 = md5File(assignedPath);
          if (triageMd5 && assignedMd5 && triageMd5 === assignedMd5) {
            confirmedDups.push({ ...a, md5: assignedMd5 });
          }
        }
      }
      if (confirmedDups.length > 0) {
        exactDups.push({ triage: t, assigned: confirmedDups, md5: confirmedDups[0].md5 });
      } else if (sizeMatches.length > 0) {
        exactCandidates.push({ triage: t, assigned: sizeMatches, reason: 'name+size match, MD5 mismatch or file missing' });
      }
    } else {
      exactCandidates.push({ triage: t, assigned: sizeMatches, reason: 'triage file missing on disk' });
    }
  }

  // ── Perceptual similarity check ────────────────────────────────────────
  if (!t.Perceptual_Hash) { triageNoPHash.push(t.Id); continue; }

  const similar = [];
  for (const a of assignedWithHash) {
    const dist = hammingDistance(t.Perceptual_Hash, a.Perceptual_Hash);
    if (dist <= PHASH_THRESHOLD) {
      similar.push({ assigned: a, distance: dist });
    }
  }
  if (similar.length > 0) {
    similar.sort((a, b) => a.distance - b.distance);
    similarImages.push({ triage: t, matches: similar });
  }
}
process.stderr.write('\n');

// ── Summary ───────────────────────────────────────────────────────────────────

const triageWithPHash  = triageImages.length - triageNoPHash.length;
const exactDupCount    = exactDups.length;
const candidateCount   = exactCandidates.length;
const similarOnlyCount = similarImages.filter(s =>
  !exactDups.find(e => e.triage.Id === s.triage.Id)
).length;

console.log('\n=== RESULTS ===\n');
console.log(`Triage images:               ${triageImages.length}`);
console.log(`  with perceptual hash:      ${triageWithPHash}`);
console.log(`  without hash:              ${triageNoPHash.length}`);
console.log('');
console.log(`Exact duplicates (MD5):      ${exactDupCount}`);
console.log(`  (name+size match, no file) ${candidateCount}`);
console.log(`Similar (phash ≤ ${PHASH_THRESHOLD}):        ${similarImages.length} triage images`);
console.log(`  similar only (not exact):  ${similarOnlyCount}`);

if (exactDups.length > 0) {
  console.log('\n── Exact duplicates (sample, first 20) ──');
  for (const { triage: t, assigned: aa, md5 } of exactDups.slice(0, 20)) {
    const tPath = norm(t.File_Path || '').split('/').slice(-3).join('/');
    const aPath = norm(aa[0].File_Path || '').split('/').slice(-3).join('/');
    console.log(`  [T] ${tPath}`);
    console.log(`  [A] ${aPath}  plant=${aa[0].Plant_Id}${aa[0].Variety_Id ? ' variety=' + aa[0].Variety_Id : ''}`);
    console.log(`      MD5: ${md5}`);
    console.log('');
  }
}

if (similarImages.length > 0) {
  console.log('\n── Similar images (phash, sample first 20, closest first) ──');
  const sorted = [...similarImages].sort((a, b) => a.matches[0].distance - b.matches[0].distance);
  for (const { triage: t, matches } of sorted.slice(0, 20)) {
    const tPath = norm(t.File_Path || '').split('/').slice(-3).join('/');
    const best  = matches[0];
    const aPath = norm(best.assigned.File_Path || '').split('/').slice(-3).join('/');
    console.log(`  dist=${best.distance}  [T] ${tPath}`);
    console.log(`          [A] ${aPath}  plant=${best.assigned.Plant_Id}`);
    if (matches.length > 1) console.log(`          (+${matches.length - 1} more similar assigned)`);
    console.log('');
  }
}

// ── Write JSON report ─────────────────────────────────────────────────────────

const reportPath = `content/backups/triage-dedup-${Date.now()}.json`;
const report = {
  generated_at: new Date().toISOString(),
  phash_threshold: PHASH_THRESHOLD,
  totals: {
    triage: triageImages.length,
    triage_with_phash: triageWithPHash,
    exact_md5_duplicates: exactDupCount,
    name_size_candidates: candidateCount,
    similar_phash: similarImages.length,
  },
  exact_duplicates: exactDups.map(({ triage: t, assigned: aa, md5 }) => ({
    triage_id: t.Id,
    triage_path: t.File_Path,
    md5,
    assigned: aa.map(a => ({ id: a.Id, path: a.File_Path, plant_id: a.Plant_Id, variety_id: a.Variety_Id })),
  })),
  candidates: exactCandidates.map(({ triage: t, assigned: aa, reason }) => ({
    triage_id: t.Id,
    triage_path: t.File_Path,
    reason,
    assigned: aa.map(a => ({ id: a.Id, path: a.File_Path, plant_id: a.Plant_Id })),
  })),
  similar: similarImages.map(({ triage: t, matches }) => ({
    triage_id: t.Id,
    triage_path: t.File_Path,
    triage_plant: t.Plant_Id,
    triage_phash: t.Perceptual_Hash,
    best_distance: matches[0].distance,
    matches: matches.slice(0, 5).map(m => ({
      distance: m.distance,
      assigned_id: m.assigned.Id,
      assigned_path: m.assigned.File_Path,
      assigned_plant: m.assigned.Plant_Id,
      assigned_variety: m.assigned.Variety_Id,
    })),
  })),
};

import { writeFileSync } from 'fs';
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nFull report: ${reportPath}`);
