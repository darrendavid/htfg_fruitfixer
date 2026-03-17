/**
 * OCR Scanner
 *
 * Runs Tesseract.js over plant images from two sources:
 *   1. content/parsed/plants/{plant}/images/   — already plant-classified
 *   2. content/source/original/**        — high-res originals
 *
 * Filters output to images that likely contain useful agronomic text
 * (posters, data sheets, variety labels) rather than vacation photos.
 *
 * Output: content/parsed/ocr_candidates.json
 *         content/parsed/ocr_raw.json        (full log, for debugging)
 *
 * Usage:  node scripts/ocr-scan.mjs
 *         node scripts/ocr-scan.mjs --workers 4 --min-words 6
 *
 * Incremental: if ocr_raw.json exists, already-scanned paths are skipped.
 */

import { createRequire } from 'module';
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, extname, relative, dirname } from 'path';

const require = createRequire(import.meta.url);
const { createScheduler, createWorker } = require('tesseract.js');

const ROOT       = join(import.meta.dirname, '..');
const PARSED     = join(ROOT, 'content', 'parsed');
const PLANTS_DIR = join(PARSED, 'plants');
const ORIG_DIR   = join(ROOT, 'content', 'source', 'original');
const RAW_FILE   = join(PARSED, 'ocr_raw.json');
const OUT_FILE   = join(PARSED, 'ocr_candidates.json');

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const NUM_WORKERS  = parseInt(args[args.indexOf('--workers') + 1]  || '4', 10);
const MIN_WORDS    = parseInt(args[args.indexOf('--min-words') + 1] || '6', 10);
const MIN_SIZE_KB  = 40;   // skip files below this — thumbnails / icons

// --dir <path>  scan a single directory instead of the default two sources
const dirArgIdx = args.indexOf('--dir');
const SINGLE_DIR = dirArgIdx >= 0 ? args[dirArgIdx + 1] : null;

// ── Data indicator words that mark agronomically useful images ────────────────
// A matching image has at least one of these words in its OCR output.

const DATA_WORDS = new Set([
  // Cultivation / agronomy
  'variety', 'varietal', 'varieties', 'cultivar', 'rootstock', 'grafting',
  'pruning', 'harvest', 'growing', 'cultivation', 'planting', 'soil',
  'fertilizer', 'irrigation', 'spacing', 'yield', 'production', 'orchard',
  'seedling', 'propagation', 'pollination', 'dormancy', 'deciduous',
  // Fruit quality / post-harvest
  'brix', 'sugar', 'acid', 'flavor', 'texture', 'aroma', 'flesh',
  'weight', 'diameter', 'ripening', 'maturity', 'shelf',
  // Taxonomy / science
  'botanical', 'genus', 'species', 'family', 'origin', 'native',
  'tropical', 'subtropical', 'perennial',
  // Pest / disease management
  'pest', 'disease', 'fungus', 'bacteria', 'virus', 'spray', 'control',
  'treatment', 'resistant', 'tolerance', 'infection', 'pathogen',
  // Units / measurements (suggest data-dense content)
  'kg', 'lbs', 'grams', 'days', 'weeks', 'months', 'temperature',
  'rainfall', 'humidity', 'elevation', 'altitude', 'inches', 'feet',
  // Research / extension
  'trial', 'study', 'results', 'comparison', 'evaluation', 'research',
  'university', 'extension', 'usda', 'ctahr', 'htfg',
  // Common fruit data sheet terms
  'season', 'seedless', 'seeded', 'dwarf', 'standard', 'semi-dwarf',
  'blooms', 'flowering', 'pollinator', 'cross',
]);

// ── Image file discovery ──────────────────────────────────────────────────────

function collectImages(rootDir, sourceLabel) {
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(jpe?g|png)$/i.test(e.name)) continue;
      try {
        const size = statSync(p).size;
        if (size < MIN_SIZE_KB * 1024) continue;
        // Derive plant_id from path if possible
        let plant_id = null;
        if (sourceLabel === 'plants') {
          const rel = relative(PLANTS_DIR, p);
          plant_id = rel.split(/[/\\]/)[0] || null;
        }
        results.push({ path: p, rel: relative(ROOT, p), source: sourceLabel, plant_id, size_kb: Math.round(size / 1024) });
      } catch { /* skip */ }
    }
  }
  walk(rootDir);
  return results;
}

console.log('Collecting image paths...');
let allImages;
if (SINGLE_DIR) {
  const absDir = SINGLE_DIR.startsWith('/') || /^[A-Za-z]:/.test(SINGLE_DIR)
    ? SINGLE_DIR
    : join(ROOT, SINGLE_DIR);
  allImages = collectImages(absDir, 'custom');
  console.log(`  Dir:   ${SINGLE_DIR}  (${allImages.length} images >= ${MIN_SIZE_KB}KB)`);
} else {
  const plantImages = collectImages(PLANTS_DIR, 'plants');
  const origImages  = collectImages(ORIG_DIR,   'original');
  allImages = [...plantImages, ...origImages];
  console.log(`  Plants:   ${plantImages.length} images >= ${MIN_SIZE_KB}KB`);
  console.log(`  Original: ${origImages.length} images >= ${MIN_SIZE_KB}KB`);
}
console.log(`  Total:    ${allImages.length}`);

// ── Load existing scan results (incremental) ──────────────────────────────────

let rawResults = [];
const doneSet = new Set();

if (existsSync(RAW_FILE)) {
  try {
    rawResults = JSON.parse(readFileSync(RAW_FILE, 'utf-8'));
    for (const r of rawResults) doneSet.add(r.path);
    console.log(`  Resuming: ${doneSet.size} already scanned, ${allImages.length - doneSet.size} remaining`);
  } catch { rawResults = []; }
}

const pending = allImages.filter(img => !doneSet.has(img.path));
console.log(`\nScanning ${pending.length} images with ${NUM_WORKERS} workers...\n`);

if (pending.length === 0) {
  console.log('Nothing to scan — all images already processed.');
  buildCandidates();
  process.exit(0);
}

// ── OCR with Tesseract scheduler ──────────────────────────────────────────────

const scheduler = createScheduler();
const workers = [];

console.log(`Initializing ${NUM_WORKERS} Tesseract workers...`);
for (let i = 0; i < NUM_WORKERS; i++) {
  const w = await createWorker('eng', 1, {
    logger: () => {},          // suppress per-image progress noise
    errorHandler: () => {},
  });
  scheduler.addWorker(w);
  workers.push(w);
}
console.log('Workers ready.\n');

let done = 0;
let saveCounter = 0;
const startTime = Date.now();

async function scanImage(img) {
  try {
    const { data } = await scheduler.addJob('recognize', img.path);
    const text = data.text || '';
    const wordCount = text.split(/\s+/).filter(w => w.length >= 2).length;
    const confidence = Math.round(data.confidence || 0);

    // Check for data indicator words
    const lowerText = text.toLowerCase();
    const foundDataWords = [...DATA_WORDS].filter(w => lowerText.includes(w));

    return {
      path: img.path,
      rel: img.rel,
      source: img.source,
      plant_id: img.plant_id,
      size_kb: img.size_kb,
      word_count: wordCount,
      confidence,
      data_words: foundDataWords,
      has_data: foundDataWords.length > 0 && wordCount >= MIN_WORDS,
      text: text.trim().slice(0, 2000), // cap storage at 2KB
    };
  } catch (err) {
    return {
      path: img.path,
      rel: img.rel,
      source: img.source,
      plant_id: img.plant_id,
      size_kb: img.size_kb,
      word_count: 0,
      confidence: 0,
      data_words: [],
      has_data: false,
      text: '',
      error: err.message,
    };
  }
}

function saveProgress() {
  writeFileSync(RAW_FILE, JSON.stringify(rawResults, null, 2), 'utf-8');
}

function printProgress(total, done, startTime) {
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = done / elapsed;
  const remaining = total - done;
  const etaSeconds = rate > 0 ? Math.round(remaining / rate) : 0;
  const etaMin = Math.floor(etaSeconds / 60);
  const etaSec = etaSeconds % 60;
  const pct = Math.round(done / total * 100);
  process.stdout.write(`\r  ${done}/${total} (${pct}%) · ${rate.toFixed(1)}/s · ETA ${etaMin}m${etaSec}s    `);
}

// Process in parallel using scheduler (it dispatches to idle workers automatically)
const BATCH = 50;
for (let i = 0; i < pending.length; i += BATCH) {
  const batch = pending.slice(i, i + BATCH);
  const batchResults = await Promise.all(batch.map(img => scanImage(img)));
  rawResults.push(...batchResults);
  done += batchResults.length;
  saveCounter += batchResults.length;

  printProgress(pending.length, done, startTime);

  if (saveCounter >= 50) {
    saveProgress();
    saveCounter = 0;
  }
}

saveProgress();
console.log('\n');

await scheduler.terminate();

// ── Build filtered candidates output ─────────────────────────────────────────

buildCandidates();

function buildCandidates() {
  const raw = JSON.parse(readFileSync(RAW_FILE, 'utf-8'));

  const candidates = raw
    .filter(r => r.has_data && r.word_count >= MIN_WORDS && !r.error)
    .sort((a, b) => b.data_words.length - a.data_words.length || b.word_count - a.word_count);

  const stats = {
    total_scanned: raw.length,
    errors: raw.filter(r => r.error).length,
    with_any_text: raw.filter(r => r.word_count >= MIN_WORDS).length,
    candidates: candidates.length,
    by_source: {
      plants:   candidates.filter(r => r.source === 'plants').length,
      original: candidates.filter(r => r.source === 'original').length,
    },
    by_plant: {},
  };

  for (const c of candidates) {
    if (c.plant_id) {
      stats.by_plant[c.plant_id] = (stats.by_plant[c.plant_id] || 0) + 1;
    }
  }

  const output = {
    generated: new Date().toISOString(),
    stats,
    candidates,
  };

  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf-8');

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`=== OCR Scan Complete ===`);
  console.log(`Elapsed: ${elapsed} min`);
  console.log(`Total scanned:    ${stats.total_scanned}`);
  console.log(`With any text:    ${stats.with_any_text}`);
  console.log(`Candidates:       ${stats.candidates}  (saved to ocr_candidates.json)`);
  console.log(`  From plants/:   ${stats.by_source.plants}`);
  console.log(`  From original/: ${stats.by_source.original}`);
  if (Object.keys(stats.by_plant).length > 0) {
    console.log(`\nTop plants with text:`);
    Object.entries(stats.by_plant)
      .sort(([,a],[,b]) => b - a).slice(0, 15)
      .forEach(([k,v]) => console.log(`  ${k}: ${v}`));
  }
}
