/**
 * find-phash-swap-candidates.mjs
 *
 * Compares all triage images against all assigned images using a TIGHT
 * perceptual hash threshold (Hamming distance ≤ 2).
 *
 * For each match, compares file size (Size_Bytes) to flag cases where the
 * triage version is larger (higher resolution) than the assigned copy.
 *
 * Also gets pixel dimensions for triage images (from sidecar) and assigned
 * images (via Sharp, only for images that have a match — avoids reading 10K+).
 *
 * Outputs: content/backups/phash-swap-candidates.json
 *
 * Run: node scripts/find-phash-swap-candidates.mjs
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import dotenv from 'dotenv';

dotenv.config({ path: 'review-ui/.env' });

const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const IDS       = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const H         = { 'xc-token': NOCODB_KEY };
const ROOT      = process.cwd();
const THRESHOLD = 2;   // Hamming distance ≤ 2 only — high confidence

const norm   = p => p?.replace(/\\/g, '/') || '';
const absImg = fp => path.join(ROOT, norm(fp).replace(/^content\//, 'content/'));

// ── Hamming distance ───────────────────────────────────────────────────────────

function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) { d += x & 1; x >>>= 1; }
  }
  return d;
}

// ── Dimensions via Sharp ───────────────────────────────────────────────────────

async function getPixels(filePath) {
  try {
    const m = await sharp(filePath).metadata();
    return (m.width || 0) * (m.height || 0);
  } catch { return 0; }
}

// ── NocoDB fetch ───────────────────────────────────────────────────────────────

async function fetchAll(where, fields) {
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      limit: '200', offset: String(offset),
      where, fields: fields.join(','),
    });
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS.Images}/records?${params}`, { headers: H });
    if (!r.ok) throw new Error(`fetch failed ${r.status}: ${await r.text()}`);
    const d = await r.json();
    all.push(...(d.list ?? []));
    if (d.pageInfo?.isLastPage) break;
    offset += 200;
    if (offset % 5000 === 0) process.stderr.write(`${offset}…`);
  }
  process.stderr.write('\n');
  return all;
}

// ── Main ───────────────────────────────────────────────────────────────────────

console.log(`\n=== phash swap-candidate finder (threshold ≤ ${THRESHOLD}) ===\n`);

// Load triage sidecar (has dimensions for newly-hashed images)
const sidecarPath = 'content/backups/triage-hashes.json';
const triageSidecar = existsSync(sidecarPath)
  ? JSON.parse(readFileSync(sidecarPath, 'utf-8'))
  : {};

console.log('Fetching triage images from NocoDB…');
const triageImages = await fetchAll(
  '(Status,eq,triage)',
  ['Id', 'File_Path', 'Plant_Id', 'Variety_Id', 'Size_Bytes', 'Perceptual_Hash', 'Caption'],
);
const triageWithHash = triageImages.filter(r => r.Perceptual_Hash);
console.log(`  ${triageImages.length} triage (${triageWithHash.length} have hash)\n`);

console.log('Fetching assigned images from NocoDB…');
const assignedImages = await fetchAll(
  '(Status,eq,assigned)',
  ['Id', 'File_Path', 'Plant_Id', 'Variety_Id', 'Size_Bytes', 'Perceptual_Hash', 'Caption'],
);
const assignedWithHash = assignedImages.filter(r => r.Perceptual_Hash);
console.log(`  ${assignedImages.length} assigned (${assignedWithHash.length} have hash)\n`);

// ── Compare ────────────────────────────────────────────────────────────────────

console.log('Comparing perceptual hashes…');

// We need assigned pixel dimensions only for matched records — collect them after
const candidateGroups = []; // {triage, matches: [{assigned, distance}]}

let compared = 0;
for (const t of triageWithHash) {
  const matches = [];
  for (const a of assignedWithHash) {
    const d = hamming(t.Perceptual_Hash, a.Perceptual_Hash);
    if (d <= THRESHOLD) matches.push({ assigned: a, distance: d });
  }
  if (matches.length) {
    matches.sort((x, y) => x.distance - y.distance);
    candidateGroups.push({ triage: t, matches });
  }
  compared++;
  if (compared % 200 === 0) process.stderr.write(`${compared}/${triageWithHash.length}…`);
}
process.stderr.write('\n');
console.log(`  ${candidateGroups.length} triage images have ≥1 match\n`);

// ── Get pixel dimensions for matched assigned images ───────────────────────────

console.log('Getting pixel dimensions for matched assigned images…');
const assignedIds = new Set(candidateGroups.flatMap(g => g.matches.map(m => m.assigned.Id)));
const assignedPixels = new Map(); // Id → pixels

let dimDone = 0;
for (const [id, rec] of [...assignedIds].map(id => [id, assignedImages.find(a => a.Id === id)])) {
  if (!rec) continue;
  const abs = absImg(rec.File_Path || '');
  if (existsSync(abs)) {
    const px = await getPixels(abs);
    assignedPixels.set(id, px);
  } else {
    assignedPixels.set(id, 0);
  }
  dimDone++;
  if (dimDone % 20 === 0) process.stderr.write(`${dimDone}…`);
}
process.stderr.write('\n');

// ── Build output ───────────────────────────────────────────────────────────────

const candidates = [];
let higherResTriage = 0, lowerResTriage = 0, sameRes = 0;

for (const { triage: t, matches } of candidateGroups) {
  const sc        = triageSidecar[t.Id] || {};
  const triagePx  = sc.pixels || 0;
  const triageSize = sc.size || t.Size_Bytes || 0;

  // Best match (lowest distance, then largest assigned)
  const best = matches[0];
  const aId  = best.assigned.Id;
  const assignedPx   = assignedPixels.get(aId) || 0;
  const assignedSize = best.assigned.Size_Bytes || 0;

  // Resolution comparison
  // Prefer pixels if both available; fall back to Size_Bytes
  let resComparison;
  if (triagePx && assignedPx) {
    const ratio = triagePx / assignedPx;
    if (ratio > 1.1)       resComparison = 'triage_higher';
    else if (ratio < 0.9)  resComparison = 'assigned_higher';
    else                   resComparison = 'similar';
  } else {
    // Fall back to file size
    const ratio = triageSize && assignedSize ? triageSize / assignedSize : 1;
    if (ratio > 1.15)      resComparison = 'triage_higher';
    else if (ratio < 0.85) resComparison = 'assigned_higher';
    else                   resComparison = 'similar';
  }

  if      (resComparison === 'triage_higher')   higherResTriage++;
  else if (resComparison === 'assigned_higher')  lowerResTriage++;
  else                                           sameRes++;

  // Determine confidence label
  const confidence = best.distance === 0 ? 'certain'
                   : best.distance === 1 ? 'very_high'
                   :                        'high';

  candidates.push({
    triage: {
      id:         t.Id,
      file_path:  t.File_Path,
      plant_id:   t.Plant_Id,
      variety_id: t.Variety_Id,
      caption:    t.Caption,
      size_bytes: triageSize,
      pixels:     triagePx || null,
      phash:      t.Perceptual_Hash,
    },
    best_match: {
      distance:   best.distance,
      confidence,
      assigned: {
        id:         aId,
        file_path:  best.assigned.File_Path,
        plant_id:   best.assigned.Plant_Id,
        variety_id: best.assigned.Variety_Id,
        caption:    best.assigned.Caption,
        size_bytes: assignedSize,
        pixels:     assignedPx || null,
      },
    },
    resolution: resComparison,
    all_matches: matches.map(m => ({
      distance:    m.distance,
      assigned_id: m.assigned.Id,
      plant_id:    m.assigned.Plant_Id,
      variety_id:  m.assigned.Variety_Id,
      file_path:   m.assigned.File_Path,
      pixels:      assignedPixels.get(m.assigned.Id) || null,
    })),
  });
}

// Sort: swap candidates (triage_higher) first, then by distance
candidates.sort((a, b) => {
  if (a.resolution === 'triage_higher' && b.resolution !== 'triage_higher') return -1;
  if (b.resolution === 'triage_higher' && a.resolution !== 'triage_higher') return  1;
  return a.best_match.distance - b.best_match.distance;
});

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n=== RESULTS ===\n');
console.log(`Triage images with hash:       ${triageWithHash.length}`);
console.log(`Matches at dist ≤ ${THRESHOLD}:         ${candidateGroups.length}`);
console.log('');
console.log(`  triage HIGHER resolution:    ${higherResTriage}  ← swap candidates`);
console.log(`  assigned higher resolution:  ${lowerResTriage}  ← triage is inferior copy`);
console.log(`  similar resolution:          ${sameRes}`);
console.log('');

const byDist = {};
for (const c of candidates) byDist[c.best_match.distance] = (byDist[c.best_match.distance]||0)+1;
console.log('By distance:');
for (const [d, n] of Object.entries(byDist).sort((a,b)=>Number(a[0])-Number(b[0]))) {
  console.log(`  dist=${d}: ${n}`);
}

console.log('\nSample swap candidates (triage higher res):');
for (const c of candidates.filter(x => x.resolution === 'triage_higher').slice(0, 10)) {
  const t = c.triage, a = c.best_match.assigned;
  const tName = t.file_path?.split('/').pop();
  const aName = a.file_path?.split('/').pop();
  const tRes  = t.pixels ? `${t.pixels.toLocaleString()}px` : `${(t.size_bytes/1024).toFixed(0)}KB`;
  const aRes  = a.pixels ? `${a.pixels.toLocaleString()}px` : `${(a.size_bytes/1024).toFixed(0)}KB`;
  console.log(`  d=${c.best_match.distance} [T]${tName} (${tRes}) > [A]${aName} (${aRes}) plant=${a.plant_id}`);
}

// ── Write output ───────────────────────────────────────────────────────────────

const out = {
  generated_at: new Date().toISOString(),
  threshold: THRESHOLD,
  totals: {
    triage_compared: triageWithHash.length,
    matched: candidateGroups.length,
    triage_higher_res: higherResTriage,
    assigned_higher_res: lowerResTriage,
    similar_res: sameRes,
  },
  candidates,
};

const outPath = 'content/backups/phash-swap-candidates.json';
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\nOutput: ${outPath}  (${candidates.length} candidates)`);
