/**
 * Attachment OCR Extraction via Claude Vision API
 *
 * Sends attachment images (field signs, posters, info graphics) to Claude Vision
 * for structured extraction. We know the plant for each image from the directory
 * path, so the prompt provides plant context for accurate extraction.
 *
 * Processes ALL attachment images not yet in attachment_ocr_results.json.
 * Resume-safe: re-running skips already-processed files.
 *
 * Output: content/parsed/attachment_ocr_results.json
 *
 * Usage:
 *   node scripts/attachment-ocr-extract.mjs
 *   node scripts/attachment-ocr-extract.mjs --dry-run
 *   node scripts/attachment-ocr-extract.mjs --plant banana
 *   node scripts/attachment-ocr-extract.mjs --concurrency 3
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { config } from 'dotenv';

// Load .env from project root
config({ path: path.join(import.meta.dirname, '..', '.env') });
// Also try review-ui/.env
config({ path: path.join(import.meta.dirname, '..', 'review-ui', '.env') });

import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.resolve(import.meta.dirname, '..');
const ASSIGNED_DIR = path.join(ROOT, 'content', 'pass_01', 'assigned');
const OUT_FILE = path.join(ROOT, 'content', 'parsed', 'attachment_ocr_results.json');

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CONCURRENCY = parseInt(args[args.indexOf('--concurrency') + 1] || '3', 10);
const PLANT_FILTER = args.includes('--plant') ? args[args.indexOf('--plant') + 1] : null;

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff']);

// ── Walk a directory recursively ─────────────────────────────────────────────
function walk(dir, results = []) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, results);
      else results.push(full);
    }
  } catch { /* skip unreadable */ }
  return results;
}

// ── Collect ALL attachment images ────────────────────────────────────────────
const candidates = [];

for (const plant of readdirSync(ASSIGNED_DIR)) {
  if (PLANT_FILTER && plant !== PLANT_FILTER) continue;
  const attDir = path.join(ASSIGNED_DIR, plant, 'attachments');
  if (!existsSync(attDir)) continue;

  for (const file of walk(attDir)) {
    const ext = path.extname(file).toLowerCase();
    if (!IMG_EXTS.has(ext)) continue;
    candidates.push({ plant_id: plant, file_path: file, basename: path.basename(file) });
  }
}

console.log(`\nFound ${candidates.length} attachment images on disk`);

// ── Load existing results for resume support ─────────────────────────────────
// Skip any candidate whose file_path OR basename has already been processed.
// This prevents re-processing "fig.jpg" if it appears under multiple plants.
let existingResults = [];
if (existsSync(OUT_FILE)) {
  try {
    existingResults = JSON.parse(readFileSync(OUT_FILE, 'utf-8'));
    if (!Array.isArray(existingResults)) existingResults = [];
  } catch { existingResults = []; }
}
const doneByPath = new Set(existingResults.filter(r => !r.error).map(r => r.file_path));
const doneByBasename = new Set(
  existingResults.filter(r => !r.error).map(r => path.basename(r.file_path).toLowerCase())
);
if (existingResults.length > 0) {
  console.log(`\nResuming: ${existingResults.length} already processed (${doneByBasename.size} unique filenames)`);
}

const pending = candidates.filter(c =>
  !doneByPath.has(c.file_path) &&
  !doneByBasename.has(c.basename.toLowerCase())
);
console.log(`Total attachment images: ${candidates.length}`);
console.log(`Already processed:       ${candidates.length - pending.length}`);
console.log(`Pending:                 ${pending.length}\n`);

if (DRY_RUN) {
  if (pending.length > 0) {
    console.log('--- Would process ---');
    for (const c of pending) console.log(`  [${c.plant_id}] ${c.basename}`);
  }
  console.log('\n(--dry-run: stopping here)');
  process.exit(0);
}

if (pending.length === 0) {
  console.log('All candidates already processed.');
  process.exit(0);
}

// ── API key check ────────────────────────────────────────────────────────────
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('\nError: ANTHROPIC_API_KEY not set.');
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey });

// ── Claude Vision prompt ──────────────────────────────────────────────────────
function buildPrompt(plantId) {
  const plantName = plantId.replace(/-/g, ' ');
  return `You are analyzing an image from the Hawaii Tropical Fruit Growers (HTFG) archive.
This image is an attachment associated with the plant: "${plantName}" (slug: ${plantId}).
It is likely a field sign, poster, data sheet, or informational graphic about this specific fruit.

Extract all readable text and structured information from the image. Return a JSON object with EXACTLY these fields:

{
  "title": "Brief descriptive title",
  "content_type": "field-sign|poster|data-sheet|label|other",
  "extracted_text": "Full readable text transcribed from the image, preserving structure",
  "scientific_name": "Botanical/scientific name if visible (null if not found)",
  "description": "Plant/fruit description extracted from the image (null if not found)",
  "origin": "Geographic origin if mentioned (null if not found)",
  "nutrition": [
    {"nutrient": "nutrient name", "value": "value with units"}
  ],
  "varieties": [
    {"name": "variety name", "notes": "any notes about this variety"}
  ],
  "key_facts": [
    {"field": "field name", "value": "value"}
  ],
  "source_context": "Organization, university, event, or year if visible (null if not found)"
}

Guidelines:
- varieties: list any variety names mentioned on the sign/poster
- key_facts: capture measurable data like Brix, yield, weight, elevation, pH, harvest months, spacing
- nutrition: capture any nutrition facts (protein, calories, vitamins, etc.)
- If a field has no data, use null for strings or [] for arrays

Return ONLY the JSON object, no markdown fencing.`;
}

// ── Image processing ──────────────────────────────────────────────────────────
function getMediaType(filePath) {
  const ext = filePath.toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

const MAX_BYTES = 5 * 1024 * 1024;
const API_TIMEOUT_MS = 90_000; // 90s per image

async function processOne(candidate) {
  let imageData = readFileSync(candidate.file_path);
  let mediaType = getMediaType(candidate.file_path);
  let resized = false;

  // GIF files: convert to JPEG since Claude handles them better
  if (mediaType === 'image/gif' || imageData.length > MAX_BYTES) {
    try {
      const { default: sharp } = await import('sharp');
      imageData = await sharp(imageData)
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      mediaType = 'image/jpeg';
      resized = true;
    } catch (sharpErr) {
      return {
        plant_id: candidate.plant_id,
        file_path: candidate.file_path,
        basename: candidate.basename,
        extraction: null,
        error: `sharp conversion failed: ${sharpErr.message}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageData.toString('base64') },
          },
          { type: 'text', text: buildPrompt(candidate.plant_id) },
        ],
      }],
    }, { timeout: API_TIMEOUT_MS });

    const rawText = response.content[0]?.text || '';
    let parsed = null;
    try {
      const cleaned = rawText.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {
        title: 'Parse error',
        content_type: 'other',
        extracted_text: rawText,
        scientific_name: null,
        description: null,
        origin: null,
        nutrition: [],
        varieties: [],
        key_facts: [],
        source_context: null,
        _parse_error: true,
      };
    }

    return {
      plant_id: candidate.plant_id,
      file_path: candidate.file_path,
      basename: candidate.basename,
      resized,
      extraction: parsed,
      input_tokens: response.usage?.input_tokens || 0,
      output_tokens: response.usage?.output_tokens || 0,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      plant_id: candidate.plant_id,
      file_path: candidate.file_path,
      basename: candidate.basename,
      extraction: null,
      error: err.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// ── Parallel batch processing ─────────────────────────────────────────────────
const results = [...existingResults.filter(r => !r.error)];
let done = 0;

console.log(`Processing ${pending.length} images with concurrency ${CONCURRENCY}...`);

for (let i = 0; i < pending.length; i += CONCURRENCY) {
  const batch = pending.slice(i, i + CONCURRENCY);
  const batchResults = await Promise.all(batch.map(processOne));

  for (const r of batchResults) {
    results.push(r);
    done++;
    const status = r.error ? `ERROR: ${r.error}` : `OK (${r.input_tokens}in/${r.output_tokens}out tokens)`;
    console.log(`  [${done}/${pending.length}] [${r.plant_id}] ${r.basename} — ${status}`);
  }

  // Save after each batch
  writeFileSync(OUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
}

const successful = results.filter(r => !r.error);
const errors = results.filter(r => r.error);
const totalIn = results.reduce((s, r) => s + (r.input_tokens || 0), 0);
const totalOut = results.reduce((s, r) => s + (r.output_tokens || 0), 0);

console.log(`\n=== Attachment OCR Complete ===`);
console.log(`Successful: ${successful.length}  Errors: ${errors.length}`);
console.log(`Tokens:     ${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out`);
console.log(`Output:     ${OUT_FILE}`);
