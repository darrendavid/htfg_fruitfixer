/**
 * cleanup-varieties.mjs
 *
 * Extracts variety records from:
 *   1. Varietal demotions in cleanup_alias_map.json
 *   2. Hawaiian Banana Varieties spreadsheet (phase3_spreadsheets.json)
 *   3. Fig taste scale spreadsheet (phase3_spreadsheets.json)
 *   4. Avocado VarietyDatabase spreadsheet (phase3_spreadsheets.json)
 *   5. OCR-detected varieties from cleanup_alias_map.json
 *
 * Deduplicates by normalised (plant_id + variety_name), merges fields.
 * Output: content/parsed/cleanup_varieties.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const parsedDir = path.join(rootDir, 'content', 'parsed');

function readJSON(filename) {
  return JSON.parse(readFileSync(path.join(parsedDir, filename), 'utf8'));
}

// ---------------------------------------------------------------------------
// Normalise a variety name for dedup key
// ---------------------------------------------------------------------------
function normaliseName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(s) {
  if (!s) return s;
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

// Combine non-null, non-empty values with separator
function combine(parts, sep = '; ') {
  return parts
    .map(p => (typeof p === 'string' ? p.trim() : typeof p === 'number' ? String(p) : ''))
    .filter(Boolean)
    .join(sep) || null;
}

// ---------------------------------------------------------------------------
// Load inputs
// ---------------------------------------------------------------------------
console.log('Loading input files...');
const spreadsheets = readJSON('phase3_spreadsheets.json');
const aliasMap = readJSON('cleanup_alias_map.json');
const canonical = readJSON('cleanup_plants_canonical.json');

// Build set of valid plant IDs for validation
const validPlantIds = new Set(canonical.plants.map(p => p.id));

// Accumulator: key = normalised "plant_id|variety_name" → record
const varietyMap = new Map();

function addVariety(record) {
  const key = `${record.plant_id}|${normaliseName(record.variety_name)}`;
  if (varietyMap.has(key)) {
    // Merge: fill in nulls from new record
    const existing = varietyMap.get(key);
    if (!existing.characteristics && record.characteristics) {
      existing.characteristics = record.characteristics;
    }
    if (!existing.tasting_notes && record.tasting_notes) {
      existing.tasting_notes = record.tasting_notes;
    }
    if (!existing.growing_note && record.growing_note) {
      existing.growing_note = record.growing_note;
    }
    // Track all sources
    if (!existing.sources.includes(record.source)) {
      existing.sources.push(record.source);
    }
  } else {
    varietyMap.set(key, {
      plant_id: record.plant_id,
      variety_name: record.variety_name,
      characteristics: record.characteristics || null,
      tasting_notes: record.tasting_notes || null,
      growing_note: record.growing_note || null,
      sources: [record.source],
    });
  }
}

// ---------------------------------------------------------------------------
// 1. Varietal demotions
// ---------------------------------------------------------------------------
console.log('Processing varietal demotions...');
let demotedCount = 0;
for (const [_oldId, info] of Object.entries(aliasMap.varietal_demotions)) {
  if (!validPlantIds.has(info.parent_id)) {
    console.warn(`  WARNING: demoted variety parent_id "${info.parent_id}" not in canonical plants`);
  }
  addVariety({
    plant_id: info.parent_id,
    variety_name: info.variety_name,
    characteristics: null,
    tasting_notes: null,
    growing_note: null,
    source: 'demoted',
  });
  demotedCount++;
}
console.log(`  ${demotedCount} demoted varietals added`);

// ---------------------------------------------------------------------------
// 2. Banana varieties spreadsheet
// ---------------------------------------------------------------------------
console.log('Processing banana varieties spreadsheet...');
const bananaFile = spreadsheets.files.find(f =>
  f.source_file.includes('Hawaiian Banana Varieties')
);
if (!bananaFile) {
  console.error('ERROR: Banana varieties spreadsheet not found');
  process.exit(1);
}

const bananaSheet = bananaFile.sheets.find(s => s.rows && s.rows.length > 0);
let bananaCount = 0;

for (const row of bananaSheet.rows) {
  const name = row['VARIETY'];
  if (!name || typeof name !== 'string') continue;

  // Skip junk rows (phone numbers, emails, person names with no notes)
  if (/^\d|\)/.test(name.trim()) || name.includes('@')) continue;

  const characteristics = combine([row['NOTES'], row['HEIGHT'] != null ? `Height: ${row['HEIGHT']}ft` : '']);
  const growingNote = combine([
    row['SUN OR SHADE'] || '',
    row['GROWING TIPS'] || '',
  ]);

  addVariety({
    plant_id: 'banana',
    variety_name: name.trim(),
    characteristics,
    tasting_notes: null,
    growing_note: growingNote,
    source: 'spreadsheet',
  });
  bananaCount++;
}
console.log(`  ${bananaCount} banana varieties extracted`);

// ---------------------------------------------------------------------------
// 3. Fig taste scale spreadsheet
// ---------------------------------------------------------------------------
console.log('Processing fig taste scale spreadsheet...');
const figFile = spreadsheets.files.find(f =>
  f.source_file.includes('figtastescale')
);
if (!figFile) {
  console.error('ERROR: Fig taste scale spreadsheet not found');
  process.exit(1);
}

const figSheet = figFile.sheets.find(s => s.rows && s.rows.length > 0);
let figCount = 0;

// Column mapping from the actual headers:
// "Fig Name" → variety name
// "1 to 10_1" → taste (1-10)
// "1 to 10_2" → size (1-10)
// "1 to 5_1" → flesh firmness (1-5)
// "1 to 5_2" → skin firmness (1-5)
// "1 to 5_3" → seed crunch (1-5)
// "1 to 5_4" → flavor (water-meat, 1-5)
// "1 to 5_5" → intensity (bland-rich, 1-5)
// "col_8" → Descriptors
// "col_9" → culinary use 1
// "col_10" → culinary use 2

for (const row of figSheet.rows) {
  const name = row['Fig Name'];
  if (!name || typeof name !== 'string') continue;

  // Build tasting notes from ratings and descriptors
  const parts = [];
  if (row['1 to 10_1'] != null) parts.push(`taste: ${row['1 to 10_1']}/10`);
  if (row['1 to 10_2'] != null) parts.push(`size: ${row['1 to 10_2']}/10`);
  if (row['1 to 5_1'] != null) parts.push(`flesh: ${row['1 to 5_1']}/5`);
  if (row['1 to 5_2'] != null) parts.push(`skin: ${row['1 to 5_2']}/5`);
  if (row['1 to 5_3'] != null) parts.push(`seed crunch: ${row['1 to 5_3']}/5`);
  if (row['1 to 5_4'] != null) parts.push(`flavor: ${row['1 to 5_4']}/5`);
  if (row['1 to 5_5'] != null) parts.push(`intensity: ${row['1 to 5_5']}/5`);
  if (row['col_8']) parts.push(`descriptors: ${row['col_8']}`);
  if (row['col_9']) parts.push(`culinary: ${row['col_9']}`);
  if (row['col_10']) parts.push(`culinary2: ${row['col_10']}`);

  const tastingNotes = parts.length > 0 ? parts.join('; ') : null;

  addVariety({
    plant_id: 'fig',
    variety_name: name.trim(),
    characteristics: null,
    tasting_notes: tastingNotes,
    growing_note: null,
    source: 'spreadsheet',
  });
  figCount++;
}
console.log(`  ${figCount} fig varieties extracted`);

// ---------------------------------------------------------------------------
// 4. Avocado variety database spreadsheet
// ---------------------------------------------------------------------------
console.log('Processing avocado variety database spreadsheet...');
const avoFile = spreadsheets.files.find(f =>
  f.source_file.includes('VarietyDatabase03')
);
if (!avoFile) {
  console.error('ERROR: Avocado variety database spreadsheet not found');
  process.exit(1);
}

const avoSheet = avoFile.sheets.find(s => s.rows && s.rows.length > 0);
let avoCount = 0;

for (const row of avoSheet.rows) {
  // Column "m" = variety name, "Description" = characteristics
  const name = row['m'];
  if (!name || typeof name !== 'string') continue;

  const description = row['Description'];

  addVariety({
    plant_id: 'avocado',
    variety_name: name.trim(),
    characteristics: description && typeof description === 'string' ? description.trim() : null,
    tasting_notes: null,
    growing_note: null,
    source: 'spreadsheet',
  });
  avoCount++;
}
console.log(`  ${avoCount} avocado varieties extracted`);

// ---------------------------------------------------------------------------
// 5. OCR-detected varieties from alias map
// ---------------------------------------------------------------------------
console.log('Processing OCR-detected varieties...');
let ocrCount = 0;

for (const [_aliasKey, entry] of Object.entries(aliasMap.aliases)) {
  if (entry.type !== 'variety') continue;

  const parentId = entry.canonical_id;
  if (!validPlantIds.has(parentId)) {
    console.warn(`  WARNING: OCR variety parent "${parentId}" not in canonical plants, skipping`);
    continue;
  }

  // Use the variety_name field if present, otherwise derive from original_name
  const varietyName = entry.variety_name || entry.original_name;
  if (!varietyName) continue;

  addVariety({
    plant_id: parentId,
    variety_name: titleCase(varietyName.trim()),
    characteristics: null,
    tasting_notes: null,
    growing_note: null,
    source: 'ocr',
  });
  ocrCount++;
}
console.log(`  ${ocrCount} OCR varieties extracted`);

// ---------------------------------------------------------------------------
// 6. Assign sequential IDs and build output
// ---------------------------------------------------------------------------
console.log('Deduplicating and assigning IDs...');

// Sort by plant_id then variety_name for stable output
const sorted = [...varietyMap.values()].sort((a, b) => {
  const cmp = a.plant_id.localeCompare(b.plant_id);
  if (cmp !== 0) return cmp;
  return normaliseName(a.variety_name).localeCompare(normaliseName(b.variety_name));
});

const varieties = sorted.map((v, i) => ({
  id: i + 1,
  plant_id: v.plant_id,
  variety_name: v.variety_name,
  characteristics: v.characteristics,
  tasting_notes: v.tasting_notes,
  growing_note: v.growing_note || null,
  source: v.sources.length === 1 ? v.sources[0] : v.sources.join('+'),
}));

// Compute stats
const stats = {
  total: varieties.length,
  banana: varieties.filter(v => v.plant_id === 'banana').length,
  fig: varieties.filter(v => v.plant_id === 'fig').length,
  avocado: varieties.filter(v => v.plant_id === 'avocado').length,
  ocr: varieties.filter(v => v.source.includes('ocr')).length,
  demoted: demotedCount,
  unique_plants: new Set(varieties.map(v => v.plant_id)).size,
};

const output = {
  generated: new Date().toISOString(),
  description: 'Variety records extracted from spreadsheets, demoted varietals, and OCR detection',
  stats,
  varieties,
};

const outPath = path.join(parsedDir, 'cleanup_varieties.json');
writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

console.log(`\nDone! Wrote ${varieties.length} varieties to ${outPath}`);
console.log('Stats:', JSON.stringify(stats, null, 2));
