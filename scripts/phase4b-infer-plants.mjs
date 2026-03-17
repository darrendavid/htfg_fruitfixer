#!/usr/bin/env node
/**
 * Phase 4B: Fuzzy Plant Inference for Unclassified Images
 *
 * Attempts to infer plant associations for images that Phase 4 left unclassified,
 * using fuzzy matching against the plant registry and a tropical fruits CSV reference.
 *
 * Every inference is logged with reasoning for Phase 5 human review.
 *
 * Usage: node scripts/phase4b-infer-plants.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const PARSED = join(ROOT, 'content', 'parsed');

// ─── Load triage decisions as authoritative overrides ─────────────────────────
// Dirs with human-confirmed plant_id take priority over all fuzzy matching.
// Dirs with action:'reject' are skipped entirely.

const TRIAGE_FILE = join(PARSED, 'triage_decisions.json');
const triageDecisions = existsSync(TRIAGE_FILE)
  ? JSON.parse(readFileSync(TRIAGE_FILE, 'utf-8'))
  : {};

// Build normalized dir name → { plant_id, note, action } map from confirmed decisions
const triageOverrides = new Map();
for (const [dirName, dec] of Object.entries(triageDecisions)) {
  if (!dec.confirmed && dec.auto) continue; // skip unconfirmed auto-decisions
  const normDir = dirName.toLowerCase().trim();
  triageOverrides.set(normDir, {
    plant_id: dec.plant_id || null,
    note: dec.note || null,
    action: dec.action,
  });
}

console.log(`Triage overrides loaded: ${triageOverrides.size} dirs (${
  [...triageOverrides.values()].filter(v => v.action === 'reject').length
} rejects, ${
  [...triageOverrides.values()].filter(v => v.plant_id).length
} with plant_id)`);

// ─── Hardcoded DIR_OVERRIDES for known mismatches ────────────────────────────
// These correct specific cases where the fuzzy matcher gets the wrong answer,
// based on human triage review. Takes effect before lookup dictionary is built.
// Keys are normalized (lowercase, trimmed) directory names from unclassified paths.

const DIR_OVERRIDES = new Map([
  // mysore = Mysore raspberry (Rubus niveus), NOT Mysore banana variety
  ['mysore',         { plant_id: 'mysore-raspberry', note: 'Mysore raspberry (Rubus niveus), not banana' }],
  // poha bush = Poha berry (Physalis peruviana) — "bush" was causing no match
  ['poha bush',      { plant_id: 'poha',             note: 'Poha berry (Physalis peruviana)' }],
  ['pohabush',       { plant_id: 'poha',             note: 'Poha berry (Physalis peruviana)' }],
  // strawg = strawberry guava abbreviation
  ['strawg',         { plant_id: 'strawberry-guava', note: 'Abbreviation for strawberry guava (Psidium cattleianum)' }],
  // surinam = surinam cherry (without the "cherry" part)
  ['surinam',        { plant_id: 'surinam-cherry',   note: 'Surinam cherry (Eugenia uniflora)' }],
  // Pome/zakuo — zakuro = pomegranate in Japanese; compound dir
  ['zakuo',          { plant_id: 'pomegranate',      note: 'Zakuro = pomegranate (Japanese)' }],
  ['zakuro',         { plant_id: 'pomegranate',      note: 'Zakuro = pomegranate (Japanese)' }],
]);

// ─── Name normalization ───────────────────────────────────────────────────────

/**
 * Normalize a search term (filename, directory name being looked up).
 * Strips trailing numbers so "fig5" → "fig", "mango2" → "mango".
 */
function normalize(name) {
  if (!name) return '';
  let n = name.toLowerCase();
  // Remove diacritics
  n = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Remove file extensions
  n = n.replace(/\.(jpg|jpeg|gif|png|bmp|tiff?|psd|htm|html|pdf|doc|xls|ppt)$/i, '');
  // Replace hyphens, underscores, dots with spaces
  n = n.replace(/[-_\.]/g, ' ');
  // Collapse multiple spaces
  n = n.replace(/\s+/g, ' ').trim();
  // Strip common suffixes
  n = n.replace(/\b(files|pix|copy|folder|photos?|pics?|images?|thumbnails?)\b/g, '').trim();
  // Strip trailing numbers (e.g., "mango2" → "mango", "fig5" → "fig")
  n = n.replace(/\s*\d+$/, '').trim();
  // Strip leading "new" or "more"
  n = n.replace(/^(new|more)\s+/i, '').trim();
  // Collapse spaces again
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

/**
 * Normalize a lookup dictionary entry (plant/variety name from registry or CSV).
 * Does NOT strip trailing numbers — "CF2", "DV2", "Fairchild 3" must stay distinct
 * so they don't collide with short 2-letter directory names like "cf" or "dv".
 */
function normalizeLookup(name) {
  if (!name) return '';
  let n = name.toLowerCase();
  n = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  n = n.replace(/\.(jpg|jpeg|gif|png|bmp|tiff?|psd|htm|html|pdf|doc|xls|ppt)$/i, '');
  n = n.replace(/[-_\.]/g, ' ');
  n = n.replace(/\s+/g, ' ').trim();
  n = n.replace(/\b(files|pix|copy|folder|photos?|pics?|images?|thumbnails?)\b/g, '').trim();
  // NO trailing-number strip here — preserves "CF2" as "cf2", "DV2" as "dv2", etc.
  n = n.replace(/^(new|more)\s+/i, '').trim();
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

// ─── Levenshtein distance ─────────────────────────────────────────────────────

function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Skip if lengths differ by more than our max threshold (optimization)
  if (Math.abs(a.length - b.length) > 3) return 99;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// ─── Step 1: Build lookup dictionary ──────────────────────────────────────────

console.log('Step 1: Building lookup dictionary...');

// Load plant registry
const registry = JSON.parse(readFileSync(join(PARSED, 'plant_registry.json'), 'utf-8'));
const plants = registry.plants;

// Map: normalized name → { plant_id, source, original_name }
const nameLookup = new Map();

// Generic terms that should not be in the lookup dictionary (too ambiguous)
const genericLookupTerms = new Set([
  'round', 'purple', 'golden', 'violet', 'sweet', 'sour', 'bitter',
  'wild', 'giant', 'dwarf', 'royal', 'king', 'queen', 'prince',
  'page', 'bower', 'tasty', 'hardy', 'early', 'late',
  // Botanical family/category words — not specific plants
  'pome',   // apple-family (pome fruit = apples, pears); too generic
  'drupe',  // stone fruit category
  'berry',  // too generic
]);

function addLookup(normalizedName, plantId, source, originalName) {
  if (!normalizedName || normalizedName.length < 2) return;
  // Skip generic terms that would cause false matches
  if (genericLookupTerms.has(normalizedName)) return;
  // Don't overwrite registry entries with CSV entries
  if (nameLookup.has(normalizedName)) {
    const existing = nameLookup.get(normalizedName);
    if (existing.source === 'registry' && source === 'csv') return;
  }
  nameLookup.set(normalizedName, { plant_id: plantId, source, original_name: originalName });
}

// Add registry plants — use normalizeLookup (no trailing-number strip) for dictionary keys
for (const p of plants) {
  addLookup(normalizeLookup(p.common_name), p.id, 'registry', p.common_name);
  for (const alias of (p.aliases || [])) {
    addLookup(normalizeLookup(alias), p.id, 'registry', alias);
  }
  for (const bn of (p.botanical_names || [])) {
    addLookup(normalizeLookup(bn), p.id, 'registry', bn);
  }
  // Add directory names too (these are what files are organized under)
  for (const d of (p.hwfn_directories || [])) {
    addLookup(normalizeLookup(d), p.id, 'registry', d);
  }
  for (const d of (p.original_directories || [])) {
    addLookup(normalizeLookup(d), p.id, 'registry', d);
  }
}

console.log(`  Registry: ${nameLookup.size} name variants from ${plants.length} plants`);

// Load CSV reference
const csvText = readFileSync(join(ROOT, 'docs', 'reference', 'tropical_fruits_v10.csv'), 'utf-8');
const csvLines = csvText.split('\n').filter(l => l.trim());
// csvLines[0] is the header row — skip it (index starts at 1 below)

// Track CSV fruit types and their plant_id mapping
const csvFruitTypes = new Map(); // fruit_type → plant_id

let csvAdded = 0;
const newPlants = []; // CSV entries not in registry

for (let i = 1; i < csvLines.length; i++) {
  // Parse CSV line (handle quoted fields with commas)
  const fields = parseCSVLine(csvLines[i]);
  if (fields.length < 2) continue;

  const fruitType = fields[0].trim();
  const commonNameVariety = fields[1].trim();
  const scientificName = (fields[2] || '').trim();
  const genus = (fields[3] || '').trim();
  const altNames = (fields[4] || '').trim();

  // Determine plant_id: try to match fruit type to existing registry
  let plantId;
  const normalizedFruitType = normalizeLookup(fruitType);

  if (csvFruitTypes.has(fruitType)) {
    plantId = csvFruitTypes.get(fruitType);
  } else {
    // Try exact match against registry
    const registryMatch = nameLookup.get(normalizedFruitType);
    if (registryMatch && registryMatch.source === 'registry') {
      plantId = registryMatch.plant_id;
    } else {
      // Create provisional ID from fruit type
      plantId = normalizedFruitType.replace(/\s+/g, '-');
      newPlants.push({
        provisional_id: plantId,
        fruit_type: fruitType,
        scientific_name: scientificName,
        genus: genus,
        sample_varieties: []
      });
    }
    csvFruitTypes.set(fruitType, plantId);
  }

  // Track varieties for new plants
  if (!nameLookup.has(normalizedFruitType) || nameLookup.get(normalizedFruitType).source !== 'registry') {
    const np = newPlants.find(p => p.provisional_id === plantId);
    if (np && np.sample_varieties.length < 5) {
      np.sample_varieties.push(commonNameVariety);
    }
  }

  // Add fruit type itself — use normalizeLookup so "CF2" stays "cf2" not "cf"
  addLookup(normalizedFruitType, plantId, 'csv', fruitType);

  // Add the common name/variety
  addLookup(normalizeLookup(commonNameVariety), plantId, 'csv', commonNameVariety);

  // Add scientific name
  if (scientificName) {
    addLookup(normalizeLookup(scientificName), plantId, 'csv', scientificName);
  }

  // Add alternative names (comma-separated within the quoted field)
  if (altNames) {
    for (const alt of altNames.split(',')) {
      const trimmed = alt.trim();
      if (trimmed) {
        addLookup(normalizeLookup(trimmed), plantId, 'csv', trimmed);
        csvAdded++;
      }
    }
  }
  csvAdded++;
}

console.log(`  CSV: added ${csvAdded} more name variants`);
console.log(`  Total lookup entries: ${nameLookup.size}`);
console.log(`  New plants (CSV only): ${newPlants.length}`);

// Build an array of all normalized names for fuzzy matching
const allNames = Array.from(nameLookup.keys());

// ─── Step 2: Load unclassified images ─────────────────────────────────────────

console.log('\nStep 2: Loading unclassified images...');

const inventory = JSON.parse(readFileSync(join(PARSED, 'file_inventory.json'), 'utf-8'));
const unclassified = inventory.files.filter(f => f.type === 'image' && !f.plant_id);

console.log(`  Found ${unclassified.length} unclassified images`);

// ─── Step 3: Match each image ─────────────────────────────────────────────────

console.log('\nStep 3: Matching images...');

const inferences = [];
const stillUnclassified = [];

// Gallery/generic directory names to skip (look at grandparent instead)
const genericDirs = new Set([
  'images', 'thumbnails', 'thumbnail', 'image', 'pages', 'page',
  'photos', 'pics', 'pix', 'picture', 'pictures'
]);

// Directories that are clearly not plant names
const skipDirs = new Set([
  'hwfn', 'hawaiifruit. net', 'hawaiifruit.net', 'original', 'content',
  'source', 'fruit pix', 'done', 'misc', 'old', 'new', 'temp', 'tmp',
  'backup', 'copy', 'web', 'site', 'www'
]);

// Stop words: common terms that should never fuzzy-match to plant names
const stopWords = new Set([
  // Web/UI terms
  'japan', 'image', 'home', 'page', 'round', 'small', 'large',
  'main', 'index', 'link', 'back', 'next', 'prev', 'menu', 'logo',
  'icon', 'banner', 'header', 'footer', 'title', 'blank', 'button',
  'arrow', 'line', 'border', 'background', 'frame', 'slide', 'text',
  'file', 'data', 'info', 'view', 'list', 'item', 'part', 'type',
  // Botany/garden generic
  'name', 'farm', 'tree', 'leaf', 'seed', 'root', 'bark', 'stem',
  'flower', 'whole', 'dried', 'fresh', 'taste', 'tasty',
  // Food/market
  'shop', 'store', 'market', 'stand', 'booth', 'table', 'sign',
  'box', 'bag', 'tray', 'bowl', 'plate', 'glass', 'cup', 'jar',
  'color', 'fruit', 'plant', 'food', 'cook', 'chef', 'lunch',
  'millet', 'sweet', 'purple', 'golden', 'violet',
  // Colors and adjectives
  'green', 'red', 'white', 'black', 'yellow', 'blue', 'pink',
  'brown', 'dark', 'light', 'bright', 'deep',
  // Geography/nationalities — prevent "australia.jpg" → "Australian" variety, etc.
  // Only block terms that are clearly just location names with no plant-specific meaning.
  // (Leave 'spain' out — Spain is a real cherimoya production region in the dataset.)
  'persia', 'persian', 'serbia', 'serbian', 'china', 'chinese', 'india',
  'indian', 'brazil', 'brazilian', 'hawaii', 'hawaiian', 'kona', 'maui',
  'australia', 'australian', 'columbia', 'colombian', 'colombia',
  'africa', 'african', 'europe', 'european', 'asia', 'asian',
  'america', 'american', 'mexico', 'mexican', 'thailand', 'thai',
  'vietnam', 'vietnamese', 'japan', 'japanese', 'florida', 'california',
  'italy', 'italian', 'france', 'french',
  'portugal', 'portuguese', 'taiwan', 'korea', 'korean',
  'philippines', 'philippine', 'indonesia', 'indonesian',
  // Common misspellings of geographic terms
  'brazillian', 'brazilan', 'brzillian', 'columbian',
  // Chinese provinces/regions often used as variety prefixes
  'fujian', 'guangdong', 'yunnan', 'sichuan', 'hainan',
  // Japanese geographic terms that show up in travel photos
  'fujisan', 'fuji',
  // Architecture/structure terms that fuzzy-match brand names (dome ↔ dole)
  'dome',
  // Gallery structure
  'roundbl', 'roundbr', 'roundtl', 'roundtr', 'spacer', 'bgtile',
]);

let matched = 0;
let total = unclassified.length;
let lastPct = 0;

for (let idx = 0; idx < unclassified.length; idx++) {
  const f = unclassified[idx];
  const pct = Math.floor((idx / total) * 100);
  if (pct >= lastPct + 10) {
    process.stdout.write(`  ${pct}%...`);
    lastPct = pct;
  }

  const parts = f.path.split(/[/\\]/);
  const fileName = parts[parts.length - 1];
  const fileBase = normalize(fileName);

  // Collect candidate directory names (walk up the tree)
  const candidateDirs = [];
  for (let i = parts.length - 2; i >= 0; i--) {
    const dirName = parts[i];
    const normalizedDir = normalize(dirName);
    if (normalizedDir && !genericDirs.has(normalizedDir) && !skipDirs.has(normalizedDir)) {
      candidateDirs.push({ raw: dirName, normalized: normalizedDir, depth: parts.length - 2 - i });
    }
  }

  let inference = null;

  // Priority 0a: Triage human override — authoritative, confirmed by human reviewer
  const topDir = parts.find(p => p && p !== 'HawaiiFruit. Net' && p !== 'original' && p !== 'content' && p !== 'source');
  if (!inference && topDir) {
    const normTop = topDir.toLowerCase().trim();
    const triageEntry = triageOverrides.get(normTop);
    if (triageEntry) {
      if (triageEntry.action === 'reject') {
        // Skip this dir entirely — human marked it non-fruit
        stillUnclassified.push({ path: f.path, directories: candidateDirs.map(d => d.raw), filename: fileName, skip_reason: 'triage_rejected' });
        continue;
      }
      if (triageEntry.plant_id) {
        inference = {
          path: f.path,
          inferred_plant_id: triageEntry.plant_id,
          confidence: 'high',
          match_type: 'triage_override',
          matched_term: topDir,
          matched_against: `triage_decisions.json (human confirmed)`,
          reasoning: `Directory '${topDir}' has human-confirmed plant_id '${triageEntry.plant_id}'` +
            (triageEntry.note ? ` — note: ${triageEntry.note}` : ''),
        };
      }
    }
  }

  // Priority 0b: Hardcoded DIR_OVERRIDES for known fuzzy-matcher failures
  if (!inference) {
    for (const dir of candidateDirs) {
      const override = DIR_OVERRIDES.get(dir.normalized) || DIR_OVERRIDES.get(dir.raw.toLowerCase().trim());
      if (override) {
        inference = {
          path: f.path,
          inferred_plant_id: override.plant_id,
          confidence: 'high',
          match_type: 'dir_override',
          matched_term: dir.raw,
          matched_against: 'hardcoded DIR_OVERRIDES',
          reasoning: override.note || `Hardcoded override for '${dir.raw}'`,
        };
        break;
      }
    }
  }

  // Priority 1: Directory name exact match (require ≥ 4 chars to avoid 2-letter
  // abbreviations like "cf" or "dv" matching variety codes like "CF2"/"DV2")
  for (const dir of candidateDirs) {
    if (dir.normalized.length < 4) continue;
    const match = nameLookup.get(dir.normalized);
    if (match) {
      inference = {
        path: f.path,
        inferred_plant_id: match.plant_id,
        confidence: dir.depth === 0 ? 'high' : 'medium',
        match_type: 'directory_exact',
        matched_term: dir.raw,
        matched_against: `${match.original_name} (${match.source})`,
        reasoning: `Directory '${dir.raw}' exactly matches ${match.source} entry '${match.original_name}'`
      };
      break;
    }
  }

  // Priority 1.5: Directory name contains a known plant name as substring
  if (!inference) {
    for (const dir of candidateDirs) {
      if (dir.normalized.length < 5) continue;
      const substringMatch = findSubstringMatch(dir.normalized);
      if (substringMatch) {
        inference = {
          path: f.path,
          inferred_plant_id: substringMatch.plant_id,
          confidence: dir.depth === 0 ? 'high' : 'medium',
          match_type: 'directory_substring',
          matched_term: dir.raw,
          matched_against: `${substringMatch.original_name} (${substringMatch.source})`,
          reasoning: `Directory '${dir.raw}' contains plant name '${substringMatch.matched_name}'`
        };
        break;
      }
    }
  }

  // Priority 2: Directory name fuzzy match (Levenshtein ≤ 2)
  if (!inference) {
    for (const dir of candidateDirs) {
      if (dir.normalized.length < 3) continue; // Skip very short names
      const fuzzyMatch = findFuzzyMatch(dir.normalized, 2);
      if (fuzzyMatch) {
        inference = {
          path: f.path,
          inferred_plant_id: fuzzyMatch.plant_id,
          confidence: 'medium',
          match_type: 'directory_fuzzy',
          matched_term: dir.raw,
          matched_against: `${fuzzyMatch.original_name} (${fuzzyMatch.source})`,
          reasoning: `Directory '${dir.raw}' fuzzy-matches '${fuzzyMatch.matched_name}' (distance ${fuzzyMatch.distance})`
        };
        break;
      }
    }
  }

  // Priority 2.5: Filename exact lookup (handles short plant names like "fig", "ume")
  if (!inference && fileBase.length >= 3) {
    const match = nameLookup.get(fileBase);
    if (match) {
      inference = {
        path: f.path,
        inferred_plant_id: match.plant_id,
        confidence: 'high',
        match_type: 'filename_exact',
        matched_term: fileName,
        matched_against: `${match.original_name} (${match.source})`,
        reasoning: `Filename '${fileName}' normalizes to '${fileBase}' which exactly matches '${match.original_name}'`
      };
    }
  }

  // Priority 3: Filename exact substring match
  if (!inference && fileBase.length >= 3) {
    const match = findSubstringMatch(fileBase);
    if (match) {
      inference = {
        path: f.path,
        inferred_plant_id: match.plant_id,
        confidence: 'medium',
        match_type: 'filename_substring',
        matched_term: fileName,
        matched_against: `${match.original_name} (${match.source})`,
        reasoning: `Filename '${fileName}' contains '${match.matched_name}'`
      };
    }
  }

  // Priority 4: Filename word fuzzy match (Levenshtein ≤ 2)
  if (!inference && fileBase.length >= 4) {
    const words = fileBase.split(/\s+/).filter(w => w.length >= 4 && !stopWords.has(w));
    for (const word of words) {
      const fuzzyMatch = findFuzzyMatch(word, 2);
      if (fuzzyMatch) {
        inference = {
          path: f.path,
          inferred_plant_id: fuzzyMatch.plant_id,
          confidence: 'low',
          match_type: 'filename_fuzzy',
          matched_term: fileName,
          matched_against: `${fuzzyMatch.original_name} (${fuzzyMatch.source})`,
          reasoning: `Filename word '${word}' fuzzy-matches '${fuzzyMatch.matched_name}' (distance ${fuzzyMatch.distance})`
        };
        break;
      }
    }
  }

  // Priority 5: Compound directory split (try splitting on &, and, +, commas)
  if (!inference) {
    for (const dir of candidateDirs) {
      const subNames = dir.normalized.split(/\s*[&+,]\s*|\s+and\s+/).filter(s => s.length >= 3);
      if (subNames.length > 1) {
        for (const sub of subNames) {
          const match = nameLookup.get(sub.trim());
          if (match) {
            inference = {
              path: f.path,
              inferred_plant_id: match.plant_id,
              confidence: 'low',
              match_type: 'compound_directory',
              matched_term: dir.raw,
              matched_against: `${match.original_name} (${match.source})`,
              reasoning: `Split directory '${dir.raw}' → part '${sub.trim()}' matches '${match.original_name}'`
            };
            break;
          }
        }
        if (inference) break;
      }
    }
  }

  if (inference) {
    inferences.push(inference);
    matched++;
  } else {
    stillUnclassified.push({
      path: f.path,
      directories: candidateDirs.map(d => d.raw),
      filename: fileName
    });
  }
}

console.log('\n');

// ─── Step 4: Write outputs ────────────────────────────────────────────────────

console.log('Step 4: Writing outputs...');

// Confidence breakdown
const confBreakdown = { high: 0, medium: 0, low: 0 };
const matchTypeBreakdown = {};
const plantInferenceCounts = {};

for (const inf of inferences) {
  confBreakdown[inf.confidence] = (confBreakdown[inf.confidence] || 0) + 1;
  matchTypeBreakdown[inf.match_type] = (matchTypeBreakdown[inf.match_type] || 0) + 1;
  plantInferenceCounts[inf.inferred_plant_id] = (plantInferenceCounts[inf.inferred_plant_id] || 0) + 1;
}

const topInferred = Object.entries(plantInferenceCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30);

const summary = {
  total_unclassified_input: unclassified.length,
  matched: inferences.length,
  still_unclassified: stillUnclassified.length,
  match_rate_pct: parseFloat(((inferences.length / unclassified.length) * 100).toFixed(1)),
  confidence_breakdown: confBreakdown,
  match_type_breakdown: matchTypeBreakdown,
  unique_plants_inferred: Object.keys(plantInferenceCounts).length,
  new_plants_from_csv: newPlants.length,
  top_inferred_plants: Object.fromEntries(topInferred),
  lookup_dictionary_size: nameLookup.size,
};

// Write summary
writeFileSync(join(PARSED, 'phase4b_summary.json'), JSON.stringify({
  generated: new Date().toISOString(),
  summary
}, null, 2));

// Write inferences
writeFileSync(join(PARSED, 'phase4b_inferences.json'), JSON.stringify({
  generated: new Date().toISOString(),
  total: inferences.length,
  inferences
}, null, 2));

// Write new plants
writeFileSync(join(PARSED, 'phase4b_new_plants.json'), JSON.stringify({
  generated: new Date().toISOString(),
  description: 'Plants found in CSV reference but not in the Phase 1 registry. Candidates for addition.',
  total: newPlants.length,
  plants: newPlants
}, null, 2));

// Write still unclassified
writeFileSync(join(PARSED, 'phase4b_still_unclassified.json'), JSON.stringify({
  generated: new Date().toISOString(),
  total: stillUnclassified.length,
  files: stillUnclassified
}, null, 2));

// ─── Print summary ───────────────────────────────────────────────────────────

console.log(`\n=== Phase 4B: Fuzzy Plant Inference Complete ===`);
console.log(`Input: ${unclassified.length} unclassified images`);
console.log(`Matched: ${inferences.length} (${summary.match_rate_pct}%)`);
console.log(`Still unclassified: ${stillUnclassified.length}`);
console.log(`\nConfidence breakdown:`);
console.log(`  High:   ${confBreakdown.high}`);
console.log(`  Medium: ${confBreakdown.medium}`);
console.log(`  Low:    ${confBreakdown.low}`);
console.log(`\nMatch type breakdown:`);
for (const [t, c] of Object.entries(matchTypeBreakdown).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t}: ${c}`);
}
console.log(`\nUnique plants inferred: ${Object.keys(plantInferenceCounts).length}`);
console.log(`New plants (CSV only): ${newPlants.length}`);
console.log(`\nTop 15 inferred plants:`);
for (const [p, c] of topInferred.slice(0, 15)) {
  console.log(`  ${c}\t${p}`);
}
console.log(`\nOutputs written to content/parsed/:`);
console.log(`  phase4b_summary.json`);
console.log(`  phase4b_inferences.json`);
console.log(`  phase4b_new_plants.json`);
console.log(`  phase4b_still_unclassified.json`);


// ─── Helper functions ─────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function findFuzzyMatch(term, maxDist) {
  // Skip stop words entirely
  if (stopWords.has(term)) return null;
  // Require minimum length for fuzzy matching
  if (term.length < 4) return null;

  let bestMatch = null;
  let bestDist = maxDist + 1;

  // Dynamic threshold: shorter words need closer matches
  const effectiveMax = term.length <= 5 ? 1 : maxDist;

  for (const name of allNames) {
    // Skip very different lengths (optimization)
    if (Math.abs(name.length - term.length) > effectiveMax) continue;
    // Skip very short names to avoid false positives
    if (name.length < 4) continue;

    const dist = levenshtein(term, name);
    if (dist > 0 && dist <= effectiveMax && dist < bestDist) {
      // Guard: term and name must share at least 60% of characters
      if (dist / Math.max(term.length, name.length) > 0.4) continue;
      bestDist = dist;
      const entry = nameLookup.get(name);
      bestMatch = { ...entry, matched_name: name, distance: dist };
    }
  }
  return bestMatch;
}

function findSubstringMatch(text) {
  // Look for plant names contained within the text
  // Only match names of 5+ chars to avoid false positives like "round", "page"
  let bestMatch = null;
  let bestLen = 0;

  for (const name of allNames) {
    if (name.length < 5) continue;
    if (name.length <= bestLen) continue; // Prefer longer matches
    // Skip if name is a stop word
    if (stopWords.has(name)) continue;

    // Check if the plant name appears as a word/substring in the text
    const idx = text.indexOf(name);
    if (idx !== -1) {
      // Verify it's at a reasonable word boundary (not mid-word)
      const before = idx > 0 ? text[idx - 1] : ' ';
      const after = idx + name.length < text.length ? text[idx + name.length] : ' ';
      const atStart = /[\s\-_.,]/.test(before) || idx === 0;
      const atEnd = /[\s\-_.,]/.test(after) || (idx + name.length === text.length);
      if (atStart && atEnd) {
        bestLen = name.length;
        const entry = nameLookup.get(name);
        bestMatch = { ...entry, matched_name: name };
      }
    }
  }
  return bestMatch;
}
