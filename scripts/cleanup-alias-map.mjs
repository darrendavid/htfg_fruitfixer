/**
 * Step 1.1: Build Master Alias Map
 *
 * Creates a comprehensive mapping from every plant name variant encountered
 * across all sources to a canonical plant ID from the registry.
 *
 * Output: content/parsed/cleanup_alias_map.json
 *
 * Usage: node scripts/cleanup-alias-map.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const PARSED = join(ROOT, 'content', 'parsed');

// ── Load all data sources ────────────────────────────────────────────────────

console.log('Loading data sources...');

const registry = JSON.parse(readFileSync(join(PARSED, 'plant_registry.json'), 'utf-8'));
const harvestCal = JSON.parse(readFileSync(join(PARSED, 'phase3_harvest_calendar.json'), 'utf-8'));
const fruitData = JSON.parse(readFileSync(join(PARSED, 'phase3_fruit_data.json'), 'utf-8'));
const articles = JSON.parse(readFileSync(join(PARSED, 'phase3_articles.json'), 'utf-8'));
const recipes = JSON.parse(readFileSync(join(PARSED, 'phase3_recipes.json'), 'utf-8'));
const newPlants = JSON.parse(readFileSync(join(PARSED, 'phase4b_new_plants.json'), 'utf-8'));
const evidence = JSON.parse(readFileSync(join(PARSED, 'plant_evidence_report.json'), 'utf-8'));

const ocrFile = join(PARSED, 'phase6_ocr_extractions.json');
const ocrData = existsSync(ocrFile)
  ? JSON.parse(readFileSync(ocrFile, 'utf-8'))
  : { extractions: [] };

const csvFile = join(ROOT, 'docs', 'reference', 'tropical_fruits_v10.csv');
const csvText = existsSync(csvFile) ? readFileSync(csvFile, 'utf-8') : '';

console.log(`  Registry: ${registry.plants.length} plants`);
console.log(`  Harvest calendar: ${harvestCal.records.length} records`);
console.log(`  Fruit data: ${fruitData.records.length} records`);
console.log(`  OCR extractions: ${ocrData.extractions.length} records`);

// ── Normalization ────────────────────────────────────────────────────────────

function normalize(name) {
  if (!name) return '';
  let n = name.toLowerCase().trim();
  // Remove diacritics
  n = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Remove content in parentheses (botanical names, group names)
  n = n.replace(/\s*\([^)]*\)/g, '');
  // Replace hyphens, underscores with spaces
  n = n.replace(/[-_]/g, ' ');
  // Remove leading/trailing punctuation
  n = n.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  // Collapse whitespace
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

// ── Known manual corrections ─────────────────────────────────────────────────
// Format: normalized_name → canonical registry ID
// These handle common alternate spellings, abbreviations, and Japanese names

const MANUAL_ALIASES = {
  // Alternate spellings / common names
  'biwa': 'loquat-biwa',
  'eggfruit': 'canistel',
  'egg fruit': 'canistel',
  'canistel eggfruit': 'canistel',
  'starfruit': 'carambola',
  'star fruit': 'carambola',
  'lilikoi': 'passionfruit',
  'liliko i': 'passionfruit',
  'passion fruit': 'passionfruit',
  'passionfruit lilikoi': 'passionfruit',
  'buddhashand': 'buddhas-hand',
  'buddha s hand': 'buddhas-hand',
  'buddhas hand': 'buddhas-hand',
  'buddhas hand citron': 'buddhas-hand',
  'dragon fruit': 'dragon-fruit-pitaya',
  'dragonfruit': 'dragon-fruit-pitaya',
  'pitaya': 'dragon-fruit-pitaya',
  'pitahaya': 'dragon-fruit-pitaya',
  'mtn apple': 'mountain-apple',
  'mountain apple': 'mountain-apple',
  'malay apple': 'mountain-apple',
  'pummelo': 'pumelo',
  'pomelo': 'pumelo',
  'sugarapple': 'sugar-apple',
  'sugar apple': 'sugar-apple',
  'sweetsop': 'sugar-apple',
  'custard apple': 'sugar-apple',
  'surinam cherry': 'surinam-cherry',
  'tamarillo': 'tree-tomato',
  'tree tomato': 'tree-tomato',
  'tomatillo': 'tomatillo',
  'ulu': 'breadfruit',
  'breadfruit': 'breadfruit',
  'atamoya': 'atemoya',
  'atemoya': 'atemoya',
  'wi': 'wi-ambarella',
  'ambarella': 'wi-ambarella',
  'kaki': 'persimmon',
  'japanese persimmon': 'persimmon',
  'ohelo': 'ohelo-berry',
  'ohelo berry': 'ohelo-berry',
  'ume': 'ume-plum',
  'ume plum': 'ume-plum',
  'japanese plum': 'ume-plum',
  'mabolo': 'mabolo',
  'velvet apple': 'mabolo',
  'gov plum': 'governor-s-plum',
  'governors plum': 'governor-s-plum',
  'green sapote': 'green-sapote',
  'cashew': 'cashew',
  'kola': 'kola-nut',
  'kola nut': 'kola-nut',
  'pili': 'pili-nut',
  'pili nut': 'pili-nut',
  'miracle fruit': 'miracle-fruit',
  'rangpur': 'lime',
  'rangpur lime': 'lime',
  'otaheite': 'otaheite-apple',
  'otaheite apple': 'otaheite-apple',
  'panama': 'panama-berry',
  'panama berry': 'panama-berry',
  'arrayan guava': 'guava',
  'strawberry guava': 'guava',
  'malabar': 'malabar-chestnut',
  'mombin sign': 'red-mombin-jacote',
  'rheedias': 'rheedia-brazilensis',
  'pulasan': 'pulasan',
  'tangelo': 'tangerine',
  'thimbleberry': 'mysore-raspberry',
  'tropical apricot': 'tropcial-apricot',
  // Japanese names
  'yuzu': 'yuzu',
  'sudachi': 'sudachi',
  'kabosu': 'kabosu',
  // Grouped citrus references
  'mandarin': 'tangerine',
  'mandarin orange': 'tangerine',
  'satsuma': 'tangerine',
  'clementine': 'tangerine',
  'tangerine': 'tangerine',
  'grapefruit': 'grapefruit',
  'orange': 'orange',
  'lemon': 'lemon',
  'lime': 'lime',
  'kumquat': 'kumquat',
  // Common references
  'avocado': 'avocado',
  'mango': 'mango',
  'banana': 'banana',
  'papaya': 'papaya',
  'fig': 'fig',
  'guava': 'guava',
  'coconut': 'coconut',
  'cacao': 'cacao',
  'coffee': 'coffee',
  'macadamia': 'macadamia',
  'jackfruit': 'jackfruit',
  'durian': 'durian',
  'lychee': 'lychee',
  'litchi': 'lychee',
  'longan': 'longan',
  'rambutan': 'rambutan',
  'soursop': 'soursop',
  'cherimoya': 'cherimoya',
  'jaboticaba': 'jaboticaba',
  'jabotecaba': 'jaboticaba',
  'sapodilla': 'sapodilla',
  'tamarind': 'tamarind',
  'pomegranate': 'pomegranate',
  'jujube': 'jujube',
  'mulberry': 'mulberry',
  'white mulberry': 'white-mulberry',
  'rollinia': 'rollinia',
  'grumichama': 'grumichama',
  'poha': 'poha',
  'cape gooseberry': 'poha',
  'loquat': 'loquat-biwa',
  'mamey sapote': 'mamey-sapote',
  'mammy': 'mamey-sapote',
  'wampee': 'wampee',
  'wampi': 'wampee',
  'black sapote': 'black-sapote',
  'chocolate pudding fruit': 'black-sapote',
  'white sapote': 'white-sapote',
  'abiu': 'abiu',
  'acerola': 'acerola',
  'akee': 'ackee',
  'ackee': 'ackee',
  'alupag': 'alupag',
  'alpay': 'alupag',
  'vanilla': 'vanilla',
  'star apple': 'star-apple',
  'caimito': 'star-apple',
  'noni': 'noni',
  'ice cream bean': 'ice-cream-bean',
  'inga': 'ice-cream-bean',
  'cabeludinha': 'cabeludinha',
  'jabotecaba paulista': 'jaboticaba',
  'yellow jaboticaba': 'jaboticaba',
};

// ── Known varietals to demote from registry ──────────────────────────────────
// These are registry IDs that should become varieties, not standalone plants

const VARIETAL_DEMOTIONS = {
  'guava-strawberry':    { parent_id: 'guava',      variety_name: 'Strawberry Guava' },
  'lime-rangpur':        { parent_id: 'lime',        variety_name: 'Rangpur' },
  'jaboticaba-paulista': { parent_id: 'jaboticaba',  variety_name: 'Paulista' },
  'yellow-jaboticaba':   { parent_id: 'jaboticaba',  variety_name: 'Yellow' },
};

// ── Generic terms that are NOT plant names ───────────────────────────────────

const GENERIC_TERMS = new Set([
  'fruit', 'fruits', 'tree', 'trees', 'plant', 'plants', 'tropical',
  'tropical fruit', 'tropical fruits', 'tropical fruit tree', 'tropical fruit trees',
  'tropical plants', 'tropical leafy plants', 'tropical red raspberry',
  'unknown tropical fruit species', 'unidentified black berry fruit',
  'tomato plants', 'fruit tree', 'fruit trees', 'mixed fruits',
  'various', 'other', 'misc', 'unknown', 'none', 'n a', 'na',
  'hawaii', 'hawaiian', 'kona', 'big island',
  '#9', 'aa 14l', // OCR artifacts
]);

// ── Step 1: Seed alias map from registry ─────────────────────────────────────

console.log('\nStep 1: Seeding alias map from registry...');

// alias_map: normalized_name → { canonical_id, type, source, original_name }
// type: 'species' (canonical plant), 'alias' (alternate name for same plant),
//       'variety' (variety of a plant), 'botanical' (scientific name)
const aliasMap = new Map();

// Track canonical plants (after demotions)
const canonicalPlants = new Map(); // id → plant object

for (const p of registry.plants) {
  // Skip demoted varietals
  if (VARIETAL_DEMOTIONS[p.id]) continue;

  canonicalPlants.set(p.id, p);

  // Add canonical name
  const normName = normalize(p.common_name);
  if (normName) {
    aliasMap.set(normName, {
      canonical_id: p.id,
      type: 'species',
      source: 'registry',
      original_name: p.common_name,
    });
  }

  // Add aliases
  for (const alias of (p.aliases || [])) {
    const normAlias = normalize(alias);
    if (normAlias && !aliasMap.has(normAlias)) {
      aliasMap.set(normAlias, {
        canonical_id: p.id,
        type: 'alias',
        source: 'registry_alias',
        original_name: alias,
      });
    }
  }

  // Add botanical names
  for (const bn of (p.botanical_names || [])) {
    const normBn = normalize(bn);
    if (normBn && !aliasMap.has(normBn)) {
      aliasMap.set(normBn, {
        canonical_id: p.id,
        type: 'botanical',
        source: 'registry_botanical',
        original_name: bn,
      });
    }
  }

  // Add directory names
  for (const d of [...(p.hwfn_directories || []), ...(p.original_directories || [])]) {
    const normD = normalize(d);
    if (normD && normD.length >= 3 && !aliasMap.has(normD)) {
      aliasMap.set(normD, {
        canonical_id: p.id,
        type: 'alias',
        source: 'registry_directory',
        original_name: d,
      });
    }
  }
}

console.log(`  Canonical plants: ${canonicalPlants.size} (${Object.keys(VARIETAL_DEMOTIONS).length} demoted to varieties)`);
console.log(`  Alias map entries: ${aliasMap.size}`);

// ── Step 2: Add manual aliases ───────────────────────────────────────────────

console.log('\nStep 2: Adding manual aliases...');
let manualAdded = 0;

for (const [name, canonicalId] of Object.entries(MANUAL_ALIASES)) {
  const norm = normalize(name);
  if (norm && !aliasMap.has(norm)) {
    aliasMap.set(norm, {
      canonical_id: canonicalId,
      type: 'alias',
      source: 'manual',
      original_name: name,
    });
    manualAdded++;
  }
}

console.log(`  Added ${manualAdded} manual aliases`);

// ── Step 3: Match harvest calendar names ─────────────────────────────────────

console.log('\nStep 3: Matching harvest calendar names...');
let hcMatched = 0, hcNew = 0;

for (const r of harvestCal.records) {
  const normName = normalize(r.common_name);
  if (!normName) continue;

  if (aliasMap.has(normName)) {
    hcMatched++;
  } else {
    // Try to find close match
    const found = findCloseMatch(normName);
    if (found) {
      aliasMap.set(normName, {
        canonical_id: found.canonical_id,
        type: 'alias',
        source: 'harvest_calendar',
        original_name: r.common_name,
      });
      hcMatched++;
    } else {
      hcNew++;
    }
  }

  // Also add botanical name
  if (r.botanical_name) {
    const normBn = normalize(r.botanical_name);
    if (normBn && !aliasMap.has(normBn)) {
      const match = aliasMap.get(normName);
      if (match) {
        aliasMap.set(normBn, {
          canonical_id: match.canonical_id,
          type: 'botanical',
          source: 'harvest_calendar',
          original_name: r.botanical_name,
        });
      }
    }
  }
}

console.log(`  Matched: ${hcMatched}, Unmatched: ${hcNew}`);

// ── Step 4: Match fruit data page names ──────────────────────────────────────

console.log('\nStep 4: Matching fruit data page names...');
let fdMatched = 0, fdNew = 0;
const fdUnmatched = [];

for (const r of fruitData.records) {
  const normName = normalize(r.common_name);
  if (!normName) continue;

  if (aliasMap.has(normName)) {
    fdMatched++;
  } else {
    const found = findCloseMatch(normName);
    if (found) {
      aliasMap.set(normName, {
        canonical_id: found.canonical_id,
        type: 'alias',
        source: 'fruit_data',
        original_name: r.common_name,
      });
      fdMatched++;
    } else {
      fdUnmatched.push({ name: r.common_name, normalized: normName, source: 'fruit_data' });
      fdNew++;
    }
  }
}

console.log(`  Matched: ${fdMatched}, Unmatched: ${fdNew}`);
if (fdUnmatched.length > 0) {
  console.log('  Unmatched fruit data names:');
  fdUnmatched.forEach(u => console.log(`    "${u.name}" (${u.normalized})`));
}

// ── Step 5: Process OCR plant associations ───────────────────────────────────

console.log('\nStep 5: Processing OCR plant associations...');

// Collect all unique OCR plant names
const ocrNames = new Set();
for (const e of ocrData.extractions) {
  if (e.plant_associations) {
    for (const p of e.plant_associations) {
      const norm = normalize(p);
      if (norm && norm.length >= 2 && !GENERIC_TERMS.has(norm)) {
        ocrNames.add(norm);
      }
    }
  }
}

let ocrMatched = 0, ocrVariety = 0, ocrUnresolved = 0;
const ocrUnmatchedNames = [];
const varietyEntries = [];

for (const norm of ocrNames) {
  if (aliasMap.has(norm)) {
    ocrMatched++;
    continue;
  }

  // Try close match
  const found = findCloseMatch(norm);
  if (found) {
    aliasMap.set(norm, {
      canonical_id: found.canonical_id,
      type: 'alias',
      source: 'ocr',
      original_name: norm,
    });
    ocrMatched++;
    continue;
  }

  // Check if it might be a variety name (contains a known plant name as prefix/suffix)
  const parentPlant = findParentPlant(norm);
  if (parentPlant) {
    const varietyName = norm.replace(normalize(parentPlant.common_name), '').trim();
    if (varietyName.length >= 2) {
      aliasMap.set(norm, {
        canonical_id: parentPlant.id,
        type: 'variety',
        source: 'ocr_variety',
        original_name: norm,
        variety_name: varietyName,
      });
      varietyEntries.push({
        plant_id: parentPlant.id,
        variety_name: varietyName,
        source: 'ocr',
      });
      ocrVariety++;
      continue;
    }
  }

  // Truly unresolved
  ocrUnmatchedNames.push(norm);
  ocrUnresolved++;
}

console.log(`  Total unique OCR names: ${ocrNames.size}`);
console.log(`  Matched to plants: ${ocrMatched}`);
console.log(`  Classified as varieties: ${ocrVariety}`);
console.log(`  Unresolved: ${ocrUnresolved}`);

// ── Step 6: Process Phase 4B new plants (CSV) ────────────────────────────────

console.log('\nStep 6: Processing Phase 4B CSV plants...');
let csvMapped = 0, csvNew = 0;
const csvNewPlants = [];

const newPlantsData = newPlants.plants || newPlants;

for (const np of newPlantsData) {
  const normType = normalize(np.fruit_type || np.provisional_id);
  if (!normType) continue;

  if (aliasMap.has(normType)) {
    csvMapped++;
    continue;
  }

  const found = findCloseMatch(normType);
  if (found) {
    aliasMap.set(normType, {
      canonical_id: found.canonical_id,
      type: 'alias',
      source: 'csv_mapped',
      original_name: np.fruit_type || np.provisional_id,
    });
    csvMapped++;
  } else {
    csvNewPlants.push({
      name: np.fruit_type || np.provisional_id,
      normalized: normType,
      scientific_name: np.scientific_name,
      sample_varieties: np.sample_varieties,
    });
    csvNew++;
  }
}

console.log(`  Mapped to existing: ${csvMapped}, Genuinely new: ${csvNew}`);

// ── Step 7: Cross-reference evidence report ──────────────────────────────────

console.log('\nStep 7: Cross-referencing evidence report...');
let evidenceMatched = 0, evidenceNew = 0;
const evidenceUnmatched = [];

for (const ep of evidence.plants) {
  const norm = normalize(ep.name);
  if (!norm) continue;

  if (aliasMap.has(norm)) {
    evidenceMatched++;
  } else if (ep.registry_id && canonicalPlants.has(ep.registry_id)) {
    // Has a registry_id but normalized name wasn't in map yet
    aliasMap.set(norm, {
      canonical_id: ep.registry_id,
      type: 'alias',
      source: 'evidence_report',
      original_name: ep.name,
    });
    evidenceMatched++;
  } else {
    evidenceUnmatched.push({
      name: ep.name,
      normalized: norm,
      source_count: ep.source_count,
      image_count: ep.image_count,
      sources: ep.sources,
    });
    evidenceNew++;
  }
}

console.log(`  Matched: ${evidenceMatched}, Unmatched: ${evidenceNew}`);

// ── Build output ─────────────────────────────────────────────────────────────

console.log('\n=== Building output ===');

// Convert map to plain object
const aliases = {};
for (const [name, entry] of aliasMap) {
  aliases[name] = entry;
}

// Compile unresolved items for manual review
const unresolved = [
  ...fdUnmatched.map(u => ({ ...u, priority: 'high' })),
  ...evidenceUnmatched.filter(u => u.source_count >= 2 || u.image_count >= 10)
    .map(u => ({ ...u, source: 'evidence_report', priority: 'high' })),
  ...csvNewPlants.map(u => ({ ...u, source: 'csv', priority: 'medium' })),
  ...ocrUnmatchedNames.slice(0, 100).map(n => ({ name: n, normalized: n, source: 'ocr', priority: 'low' })),
];

// Stats
const stats = {
  total_alias_entries: aliasMap.size,
  by_source: {},
  by_type: {},
  canonical_plants: canonicalPlants.size,
  demoted_varietals: Object.keys(VARIETAL_DEMOTIONS).length,
  varieties_from_ocr: ocrVariety,
  unresolved_total: unresolved.length,
  unresolved_high: unresolved.filter(u => u.priority === 'high').length,
  unresolved_medium: unresolved.filter(u => u.priority === 'medium').length,
  unresolved_low: unresolved.filter(u => u.priority === 'low').length,
};

for (const entry of aliasMap.values()) {
  stats.by_source[entry.source] = (stats.by_source[entry.source] || 0) + 1;
  stats.by_type[entry.type] = (stats.by_type[entry.type] || 0) + 1;
}

const output = {
  generated: new Date().toISOString(),
  description: 'Master alias map: every plant name variant → canonical plant ID',
  stats,
  varietal_demotions: VARIETAL_DEMOTIONS,
  aliases,
  unresolved,
};

const outFile = join(PARSED, 'cleanup_alias_map.json');
writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf-8');

console.log(`\nAlias map entries: ${stats.total_alias_entries}`);
console.log('By source:', JSON.stringify(stats.by_source, null, 2));
console.log('By type:', JSON.stringify(stats.by_type, null, 2));
console.log(`Unresolved: ${stats.unresolved_total} (${stats.unresolved_high} high, ${stats.unresolved_medium} medium, ${stats.unresolved_low} low)`);
console.log(`\nSaved to ${outFile}`);


// ── Helper functions ─────────────────────────────────────────────────────────

function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 99;

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

/**
 * Find a close match in the existing alias map using fuzzy matching.
 * Only matches with Levenshtein distance <= 1 for short names, <= 2 for longer.
 */
function findCloseMatch(normalizedName) {
  if (normalizedName.length < 3) return null;

  const maxDist = normalizedName.length <= 5 ? 1 : 2;

  let bestMatch = null;
  let bestDist = maxDist + 1;

  for (const [mapName, entry] of aliasMap) {
    if (entry.type === 'variety') continue; // Don't fuzzy match against variety names
    if (Math.abs(mapName.length - normalizedName.length) > maxDist) continue;
    if (mapName.length < 3) continue;

    const dist = levenshtein(normalizedName, mapName);
    if (dist > 0 && dist <= maxDist && dist < bestDist) {
      // Guard: must share at least 60% of characters
      if (dist / Math.max(normalizedName.length, mapName.length) > 0.4) continue;
      bestDist = dist;
      bestMatch = entry;
    }
  }

  return bestMatch;
}

/**
 * Check if a name contains a known plant name, suggesting it's a variety.
 * e.g., "alphonso mango" → parent is mango, variety is "alphonso"
 */
function findParentPlant(normalizedName) {
  const words = normalizedName.split(' ');
  if (words.length < 2) return null;

  // Check last word first (most common pattern: "variety plant")
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i];
    if (word.length < 3) continue;
    const match = aliasMap.get(word);
    if (match && (match.type === 'species' || match.type === 'alias')) {
      const plant = canonicalPlants.get(match.canonical_id);
      if (plant) return plant;
    }
  }

  // Check multi-word plant names
  for (const [mapName, entry] of aliasMap) {
    if (entry.type !== 'species' && entry.type !== 'alias') continue;
    if (mapName.length < 4) continue;
    if (normalizedName.includes(mapName) && normalizedName !== mapName) {
      const plant = canonicalPlants.get(entry.canonical_id);
      if (plant) return plant;
    }
  }

  return null;
}
