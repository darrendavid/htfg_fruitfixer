/**
 * Phase 6: OCR Extraction via Claude Vision API
 *
 * Sends 605 flagged OCR candidate images to Claude's vision API for
 * structured content extraction (titles, text, plant associations, key facts).
 *
 * Input:  content/parsed/ocr_candidates.json  (from ocr-scan.mjs)
 * Output: content/parsed/phase6_ocr_raw.json        — all raw Claude responses
 *         content/parsed/phase6_ocr_extractions.json — cleaned structured results
 *
 * Usage:
 *   node scripts/phase6-ocr-extract.mjs
 *   node scripts/phase6-ocr-extract.mjs --concurrency 3 --limit 10
 *   node scripts/phase6-ocr-extract.mjs --dry-run
 *
 * Incremental: if phase6_ocr_raw.json exists, already-processed images are skipped.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { config } from 'dotenv';

// Load .env from project root
config({ path: join(import.meta.dirname, '..', '.env') });

import Anthropic from '@anthropic-ai/sdk';

const ROOT       = join(import.meta.dirname, '..');
const PARSED     = join(ROOT, 'content', 'parsed');
const INPUT_FILE = join(PARSED, 'ocr_candidates.json');
const RAW_FILE   = join(PARSED, 'phase6_ocr_raw.json');
const OUT_FILE   = join(PARSED, 'phase6_ocr_extractions.json');

// ── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function argVal(name, defaultVal) {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : defaultVal;
}

const CONCURRENCY = parseInt(argVal('--concurrency', '5'), 10);
const LIMIT       = args.includes('--limit') ? parseInt(argVal('--limit', '0'), 10) : 0;
const DRY_RUN     = args.includes('--dry-run');

// ── Load candidates ─────────────────────────────────────────────────────────

if (!existsSync(INPUT_FILE)) {
  console.error(`Missing input: ${INPUT_FILE}`);
  console.error('Run "node scripts/ocr-scan.mjs" first.');
  process.exit(1);
}

const input = JSON.parse(readFileSync(INPUT_FILE, 'utf-8'));
const candidates = input.candidates;
console.log(`Loaded ${candidates.length} OCR candidates from ocr_candidates.json`);

// ── Deduplication ───────────────────────────────────────────────────────────
// Group by plant_id, then within each group detect near-duplicates:
//   same plant + similar filename (Levenshtein <= 3) + similar file size (within 10%)
// Keep the largest file from each duplicate cluster.

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function deduplicateCandidates(candidates) {
  // Group by plant_id (null plant_id grouped together as "__none__")
  const groups = new Map();
  for (const c of candidates) {
    const key = c.plant_id || '__none__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const kept = [];
  const skipped = [];

  for (const [plantId, items] of groups) {
    if (plantId === '__none__' || items.length <= 1) {
      // No plant association or single item — keep all
      kept.push(...items);
      continue;
    }

    // Find near-duplicate clusters within this plant group
    const used = new Set();

    for (let i = 0; i < items.length; i++) {
      if (used.has(i)) continue;

      const cluster = [i];
      const nameI = basename(items[i].path).toLowerCase().replace(/\.[^.]+$/, '');

      for (let j = i + 1; j < items.length; j++) {
        if (used.has(j)) continue;

        const nameJ = basename(items[j].path).toLowerCase().replace(/\.[^.]+$/, '');
        const dist = levenshtein(nameI, nameJ);

        // Similar filename (Levenshtein <= 3) AND similar file size (within 10%)
        if (dist <= 3) {
          const sizeRatio = Math.min(items[i].size_kb, items[j].size_kb) /
                            Math.max(items[i].size_kb, items[j].size_kb);
          if (sizeRatio >= 0.9) {
            cluster.push(j);
            used.add(j);
          }
        }
      }

      // Pick the largest from the cluster
      let best = cluster[0];
      for (const idx of cluster) {
        if (items[idx].size_kb > items[best].size_kb) best = idx;
      }
      kept.push(items[best]);
      for (const idx of cluster) {
        if (idx !== best) skipped.push(items[idx]);
      }
      used.add(best);
    }
  }

  return { kept, skipped };
}

const { kept: dedupedCandidates, skipped: dupSkipped } = deduplicateCandidates(candidates);
console.log(`Deduplication: ${candidates.length} candidates -> ${dedupedCandidates.length} unique (${dupSkipped.length} near-duplicates skipped)`);

if (dupSkipped.length > 0) {
  console.log('  Skipped duplicates:');
  for (const s of dupSkipped.slice(0, 10)) {
    console.log(`    ${basename(s.path)} (${s.plant_id}, ${s.size_kb}KB)`);
  }
  if (dupSkipped.length > 10) console.log(`    ... and ${dupSkipped.length - 10} more`);
}

// ── Apply --limit ───────────────────────────────────────────────────────────

let toProcess = dedupedCandidates;
if (LIMIT > 0) {
  toProcess = toProcess.slice(0, LIMIT);
  console.log(`--limit ${LIMIT}: will process ${toProcess.length} images`);
}

// ── Resume support ──────────────────────────────────────────────────────────

let rawResults = [];
const doneSet = new Set();

if (existsSync(RAW_FILE)) {
  try {
    rawResults = JSON.parse(readFileSync(RAW_FILE, 'utf-8'));
    if (!Array.isArray(rawResults)) rawResults = [];
    for (const r of rawResults) doneSet.add(r.source_path);
    console.log(`Resuming: ${doneSet.size} already processed`);
  } catch {
    rawResults = [];
  }
}

const pending = toProcess.filter(c => !doneSet.has(c.path));
console.log(`Pending: ${pending.length} images to process`);

// ── Dry run ─────────────────────────────────────────────────────────────────

if (DRY_RUN) {
  console.log('\n=== DRY RUN ===');
  console.log(`Would process ${pending.length} images with concurrency ${CONCURRENCY}`);
  console.log(`Already done: ${doneSet.size}`);
  console.log(`Duplicates skipped: ${dupSkipped.length}`);
  console.log('\nFirst 20 images that would be processed:');
  for (const c of pending.slice(0, 20)) {
    console.log(`  [${c.plant_id || 'no-plant'}] ${basename(c.path)} (${c.size_kb}KB, ${c.word_count} words)`);
  }
  if (pending.length > 20) console.log(`  ... and ${pending.length - 20} more`);
  process.exit(0);
}

if (pending.length === 0) {
  console.log('Nothing to process — all images already done.');
  buildExtractions();
  process.exit(0);
}

// ── Claude API client ───────────────────────────────────────────────────────

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable not set.');
  process.exit(1);
}

const anthropic = new Anthropic();

const EXTRACTION_PROMPT = `You are analyzing an image from the Hawaii Tropical Fruit Growers (HTFG) archive. This image was flagged as likely containing useful agronomic text — it may be a poster, data sheet, variety label, research sign, table, or informational graphic about tropical fruit.

Extract all readable text and structured information from the image. Return a JSON object with these fields:

{
  "title": "Brief descriptive title for this image content",
  "content_type": "poster|data-sheet|label|sign|table|other",
  "extracted_text": "Full readable text transcribed from the image, preserving paragraph structure",
  "plant_associations": ["List of plant/fruit names mentioned or depicted"],
  "key_facts": [
    {"field": "field name", "value": "value"},
    ...
  ],
  "source_context": "Conference name, research station, university, organization, or year if visible"
}

Guidelines for key_facts: extract measurable or notable data points such as Brix levels, yield data, fruit weight, harvest season, variety names, rootstock info, spacing recommendations, elevation requirements, pH, temperature ranges, etc.

If the image is not actually a data-rich document (e.g., it is just a photo of fruit with a small label), still extract what you can but set content_type to "other".

Return ONLY the JSON object, no markdown fencing, no explanation.`;

// ── Image processing ────────────────────────────────────────────────────────

function getMediaType(filePath) {
  const ext = filePath.toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg'; // jpg, jpeg
}

const MAX_BASE64_BYTES = 5 * 1024 * 1024; // Claude's 5MB limit for base64 images

async function processImage(candidate) {
  // Use rel path joined with ROOT to handle old absolute paths from different machines
  const imagePath = candidate.rel ? join(ROOT, candidate.rel) : candidate.path;
  let imageData = readFileSync(imagePath);
  let resized = false;

  // If image exceeds 5MB, re-encode as JPEG at reduced quality
  if (imageData.length > MAX_BASE64_BYTES) {
    const { default: sharp } = await import('sharp');
    imageData = await sharp(imageData)
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    resized = true;
  }

  const base64 = imageData.toString('base64');
  const mediaType = resized ? 'image/jpeg' : getMediaType(imagePath);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64,
              },
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    });

    const rawText = response.content[0]?.text || '';

    // Parse the JSON response from Claude
    let parsed = null;
    try {
      // Strip any markdown fencing if present
      const cleaned = rawText.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {
        title: 'Parse error',
        content_type: 'other',
        extracted_text: rawText,
        plant_associations: [],
        key_facts: [],
        source_context: '',
        _parse_error: true,
      };
    }

    return {
      source_path: candidate.path,
      rel_path: candidate.rel,
      plant_id: candidate.plant_id,
      size_kb: candidate.size_kb,
      ocr_word_count: candidate.word_count,
      ocr_confidence: candidate.confidence,
      ocr_data_words: candidate.data_words,
      extraction: parsed,
      input_tokens: response.usage?.input_tokens || 0,
      output_tokens: response.usage?.output_tokens || 0,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      source_path: candidate.path,
      rel_path: candidate.rel,
      plant_id: candidate.plant_id,
      size_kb: candidate.size_kb,
      ocr_word_count: candidate.word_count,
      ocr_confidence: candidate.confidence,
      ocr_data_words: candidate.data_words,
      extraction: null,
      error: err.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// ── Parallel batch processing ───────────────────────────────────────────────

function saveRawProgress() {
  writeFileSync(RAW_FILE, JSON.stringify(rawResults, null, 2), 'utf-8');
}

function printProgress(total, done, startTime) {
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = done / elapsed;
  const remaining = total - done;
  const etaSeconds = rate > 0 ? Math.round(remaining / rate) : 0;
  const etaMin = Math.floor(etaSeconds / 60);
  const etaSec = etaSeconds % 60;
  const pct = Math.round((done / total) * 100);
  const tokensUsed = rawResults.reduce((sum, r) => sum + (r.input_tokens || 0) + (r.output_tokens || 0), 0);
  process.stdout.write(
    `\r  ${done}/${total} (${pct}%) | ${rate.toFixed(2)}/s | ETA ${etaMin}m${String(etaSec).padStart(2, '0')}s | ${tokensUsed.toLocaleString()} tokens    `
  );
}

console.log(`\nProcessing ${pending.length} images with concurrency ${CONCURRENCY}...`);
console.log(`Model: claude-sonnet-4-20250514\n`);

const startTime = Date.now();
let done = 0;
let saveCounter = 0;

// Process in batches of CONCURRENCY
for (let i = 0; i < pending.length; i += CONCURRENCY) {
  const batch = pending.slice(i, i + CONCURRENCY);
  const batchResults = await Promise.all(batch.map(c => processImage(c)));

  rawResults.push(...batchResults);
  done += batchResults.length;
  saveCounter += batchResults.length;

  printProgress(pending.length, done, startTime);

  // Save progress every 10 images
  if (saveCounter >= 10) {
    saveRawProgress();
    saveCounter = 0;
  }
}

// Final save
saveRawProgress();
const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
console.log(`\n\nAPI processing complete in ${elapsed} min`);

// ── Build structured extractions output ─────────────────────────────────────

buildExtractions();

function buildExtractions() {
  const raw = JSON.parse(readFileSync(RAW_FILE, 'utf-8'));

  const successful = raw.filter(r => r.extraction && !r.error);
  const errors = raw.filter(r => r.error);

  // Build cleaned extractions
  const extractions = successful.map(r => ({
    source_path: r.source_path,
    rel_path: r.rel_path,
    plant_id: r.plant_id,
    size_kb: r.size_kb,
    title: r.extraction.title || '',
    content_type: r.extraction.content_type || 'other',
    extracted_text: r.extraction.extracted_text || '',
    plant_associations: r.extraction.plant_associations || [],
    key_facts: r.extraction.key_facts || [],
    source_context: r.extraction.source_context || '',
    had_parse_error: !!r.extraction._parse_error,
  }));

  // Compute stats
  const contentTypes = {};
  const plantSet = new Set();
  let totalFacts = 0;

  for (const e of extractions) {
    const ct = e.content_type || 'other';
    contentTypes[ct] = (contentTypes[ct] || 0) + 1;
    for (const p of e.plant_associations) plantSet.add(p.toLowerCase());
    totalFacts += (e.key_facts || []).length;
  }

  const totalInputTokens = raw.reduce((s, r) => s + (r.input_tokens || 0), 0);
  const totalOutputTokens = raw.reduce((s, r) => s + (r.output_tokens || 0), 0);

  const stats = {
    total_candidates: candidates.length,
    duplicates_skipped: dupSkipped.length,
    total_processed: raw.length,
    successful: successful.length,
    errors: errors.length,
    parse_errors: extractions.filter(e => e.had_parse_error).length,
    content_types: contentTypes,
    unique_plants_found: plantSet.size,
    plant_names: [...plantSet].sort(),
    total_key_facts: totalFacts,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
  };

  const output = {
    generated: new Date().toISOString(),
    stats,
    extractions,
  };

  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf-8');

  console.log('\n=== Phase 6 OCR Extraction Complete ===');
  console.log(`Total candidates:       ${stats.total_candidates}`);
  console.log(`Duplicates skipped:     ${stats.duplicates_skipped}`);
  console.log(`Total processed:        ${stats.total_processed}`);
  console.log(`Successful:             ${stats.successful}`);
  console.log(`Errors:                 ${stats.errors}`);
  console.log(`Parse errors:           ${stats.parse_errors}`);
  console.log(`Unique plants found:    ${stats.unique_plants_found}`);
  console.log(`Total key facts:        ${stats.total_key_facts}`);
  console.log(`Tokens used:            ${stats.total_input_tokens.toLocaleString()} in / ${stats.total_output_tokens.toLocaleString()} out`);
  console.log('\nContent type breakdown:');
  for (const [type, count] of Object.entries(stats.content_types).sort(([,a],[,b]) => b - a)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log(`\nOutputs saved to:`);
  console.log(`  ${RAW_FILE}`);
  console.log(`  ${OUT_FILE}`);
}
