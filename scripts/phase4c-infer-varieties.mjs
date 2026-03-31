#!/usr/bin/env node
/**
 * Phase 4C: Variety-Aware Plant Inference for Unclassified Images
 *
 * Extends Phase 4B by:
 * 1. Fetching Plants + Varieties from NocoDB (not CSV/registry files)
 * 2. Matching variety names in addition to plant names
 * 3. If a variety matches, auto-infers the parent plant from Variety.Plant_Id
 *
 * Usage: node scripts/phase4c-infer-varieties.mjs
 * Requires: NOCODB_API_KEY in review-ui/.env
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname, basename, relative } from 'path';

const ROOT = join(import.meta.dirname, '..');
const PARSED = join(ROOT, 'content', 'parsed');
const UNCLASSIFIED_ROOT = join(ROOT, 'content', 'pass_01', 'unassigned', 'unclassified');
const OUTPUT_FILE = join(PARSED, 'phase4c_inferences.json');

// Load env from review-ui/.env (no dotenv dependency)
try {
  const envText = readFileSync(join(ROOT, 'review-ui', '.env'), 'utf-8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* .env not found */ }

const NOCODB_API_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_API_KEY) {
  console.error('ERROR: NOCODB_API_KEY not found in review-ui/.env');
  process.exit(1);
}

const TABLE_IDS = JSON.parse(readFileSync(join(PARSED, 'nocodb_table_ids.json'), 'utf-8'));
const NOCODB_BASE = 'https://nocodb.djjd.us';

// ─── NocoDB fetch helpers ────────────────────────────────────────────────────

async function fetchAllRecords(tableName, fields) {
  const tableId = TABLE_IDS[tableName];
  if (!tableId) throw new Error(`Table "${tableName}" not found in nocodb_table_ids.json`);

  const all = [];
  let offset = 0;
  const fieldParam = fields ? `&fields=${fields.join(',')}` : '';
  while (true) {
    const url = `${NOCODB_BASE}/api/v2/tables/${tableId}/records?limit=200&offset=${offset}${fieldParam}`;
    const res = await fetch(url, { headers: { 'xc-token': NOCODB_API_KEY } });
    if (!res.ok) throw new Error(`NocoDB ${tableName} fetch failed: ${res.status}`);
    const data = await res.json();
    all.push(...data.list);
    if (data.pageInfo.isLastPage || all.length >= data.pageInfo.totalRows) break;
    offset += 200;
  }
  return all;
}

// ─── Name normalization (ported from Phase 4B) ──────────────────────────────

/** Normalize a search term (filename, directory name being looked up). */
function normalize(name) {
  if (!name) return '';
  let n = name.toLowerCase();
  n = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  n = n.replace(/\.(jpg|jpeg|gif|png|bmp|tiff?|psd|htm|html|pdf|doc|xls|ppt)$/i, '');
  n = n.replace(/[-_\.]/g, ' ');
  n = n.replace(/\s+/g, ' ').trim();
  n = n.replace(/\b(files|pix|copy|folder|photos?|pics?|images?|thumbnails?)\b/g, '').trim();
  n = n.replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim(); // strip all standalone numbers (dates, IDs)
  n = n.replace(/^(new|more)\s+/i, '').trim();
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

/** Normalize a lookup dictionary entry (plant/variety name from DB). */
function normalizeLookup(name) {
  if (!name) return '';
  let n = name.toLowerCase();
  n = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  n = n.replace(/\.(jpg|jpeg|gif|png|bmp|tiff?|psd|htm|html|pdf|doc|xls|ppt)$/i, '');
  n = n.replace(/[-_\.]/g, ' ');
  n = n.replace(/\s+/g, ' ').trim();
  n = n.replace(/\b(files|pix|copy|folder|photos?|pics?|images?|thumbnails?)\b/g, '').trim();
  n = n.replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim(); // strip standalone numbers
  n = n.replace(/^(new|more)\s+/i, '').trim();
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

// ─── Levenshtein distance ────────────────────────────────────────────────────

function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > 3) return 99;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
  }
  return matrix[b.length][a.length];
}

// ─── Stop words and generic terms (from Phase 4B) ───────────────────────────

const genericLookupTerms = new Set([
  'round', 'purple', 'golden', 'violet', 'sweet', 'sour', 'bitter',
  'wild', 'giant', 'dwarf', 'royal', 'king', 'queen', 'prince',
  'page', 'bower', 'tasty', 'hardy', 'early', 'late',
  'pome', 'drupe', 'berry',
]);

const genericDirs = new Set([
  'images', 'thumbnails', 'thumbnail', 'image', 'pages', 'page',
  'photos', 'pics', 'pix', 'picture', 'pictures',
]);

const skipDirs = new Set([
  'hwfn', 'hawaiifruit. net', 'hawaiifruit.net', 'original', 'content',
  'source', 'fruit pix', 'done', 'misc', 'old', 'new', 'temp', 'tmp',
  'backup', 'copy', 'web', 'site', 'www', 'unclassified',
]);

const stopWords = new Set([
  'japan', 'image', 'home', 'page', 'round', 'small', 'large',
  'main', 'index', 'link', 'back', 'next', 'prev', 'menu', 'logo',
  'icon', 'banner', 'header', 'footer', 'title', 'blank', 'button',
  'arrow', 'line', 'border', 'background', 'frame', 'slide', 'text',
  'file', 'data', 'info', 'view', 'list', 'item', 'part', 'type',
  'name', 'farm', 'tree', 'leaf', 'seed', 'root', 'bark', 'stem',
  'flower', 'whole', 'dried', 'fresh', 'taste', 'tasty',
  'shop', 'store', 'market', 'stand', 'booth', 'table', 'sign',
  'box', 'bag', 'tray', 'bowl', 'plate', 'glass', 'cup', 'jar',
  'color', 'fruit', 'plant', 'food', 'cook', 'chef', 'lunch',
  'millet', 'sweet', 'purple', 'golden', 'violet',
  'green', 'red', 'white', 'black', 'yellow', 'blue', 'pink',
  'brown', 'dark', 'light', 'bright', 'deep',
  'persia', 'persian', 'serbia', 'serbian', 'china', 'chinese', 'india',
  'indian', 'brazil', 'brazilian', 'hawaii', 'hawaiian', 'kona', 'maui',
  'australia', 'australian', 'columbia', 'colombian', 'colombia',
  'africa', 'african', 'europe', 'european', 'asia', 'asian',
  'america', 'american', 'mexico', 'mexican', 'thailand', 'thai',
  'vietnam', 'vietnamese', 'japan', 'japanese', 'florida', 'california',
  'italy', 'italian', 'france', 'french',
  'portugal', 'portuguese', 'taiwan', 'korea', 'korean',
  'philippines', 'philippine', 'indonesia', 'indonesian',
  'brazillian', 'brazilan', 'brzillian', 'columbian',
  'fujian', 'guangdong', 'yunnan', 'sichuan', 'hainan',
  'fujisan', 'fuji',
  'dome', 'roundbl', 'roundbr', 'roundtl', 'roundtr', 'spacer', 'bgtile',
  // Fruit shoot / 12 trees project generic terms
  'fruit', 'shoot', 'fruitshoot', 'trees', '12trees',
  // Plural fruit names used as folder labels (not variety names)
  'bananas', 'mangoes', 'papayas', 'guavas', 'avocados', 'figs', 'oranges', 'limes', 'lemons',
  // Common person names that match short variety names
  'james', 'hall', 'carter', 'baker', 'blair', 'blake', 'brooks',
  'butler', 'campbell', 'carmen', 'cecil', 'chance', 'chase',
  'dale', 'dean', 'duke', 'earl', 'grace', 'grant', 'lance', 'ross',
  // Common food/event terms that match variety names
  'lunch', 'dinner', 'party', 'picnic',
]);

// ─── Hardcoded overrides for known mismatches (from Phase 4B) ───────────────

const DIR_OVERRIDES = new Map([
  ['mysore',    { plant_id: 'mysore-raspberry', note: 'Mysore raspberry (Rubus niveus), not banana' }],
  ['poha bush', { plant_id: 'poha', note: 'Poha berry (Physalis peruviana)' }],
  ['pohabush',  { plant_id: 'poha', note: 'Poha berry (Physalis peruviana)' }],
  ['strawg',    { plant_id: 'strawberry-guava', note: 'Abbreviation for strawberry guava' }],
  ['surinam',   { plant_id: 'surinam-cherry', note: 'Surinam cherry (Eugenia uniflora)' }],
  ['zakuo',     { plant_id: 'pomegranate', note: 'Zakuro = pomegranate (Japanese)' }],
  ['zakuro',    { plant_id: 'pomegranate', note: 'Zakuro = pomegranate (Japanese)' }],
  ['banangar',   { plant_id: 'banana',     note: 'banangar = banana subgroup directory' }],
  ['ume',        { plant_id: 'ume',        note: 'Ume (Japanese apricot/plum) — short name bypasses length guard' }],
  ['ohelo',      { plant_id: 'ohelo',      note: 'Ohelo — matched via override due to potential lookup gap' }],
  ['watermelon', { plant_id: 'watermelon', note: 'Watermelon' }],
]);

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // ── Step 1: Fetch Plants from NocoDB ──────────────────────────────────────
  console.log('Step 1: Fetching plants from NocoDB...');
  const plants = await fetchAllRecords('Plants', ['Id1', 'Canonical_Name', 'Botanical_Name', 'Aliases', 'Category']);
  console.log(`  Fetched ${plants.length} plants`);

  // Build plant lookup: normalized name → { plant_id, plant_name, source }
  const plantLookup = new Map();

  function addPlantLookup(normalizedName, plantId, plantName, source) {
    if (!normalizedName || normalizedName.length < 2) return;
    if (genericLookupTerms.has(normalizedName)) return;
    if (plantLookup.has(normalizedName)) return; // first entry wins
    plantLookup.set(normalizedName, { plant_id: plantId, plant_name: plantName, source });
  }

  for (const p of plants) {
    const slug = p.Id1;
    const name = p.Canonical_Name;
    if (!slug || !name) continue;

    // Add canonical name
    addPlantLookup(normalizeLookup(name), slug, name, 'plant_name');
    // Add slug itself
    addPlantLookup(normalizeLookup(slug.replace(/-/g, ' ')), slug, name, 'plant_slug');

    // Add botanical name
    if (p.Botanical_Name) {
      addPlantLookup(normalizeLookup(p.Botanical_Name), slug, name, 'botanical');
    }

    // Add aliases (stored as comma-separated or JSON)
    if (p.Aliases) {
      let aliases = [];
      try { aliases = JSON.parse(p.Aliases); } catch { aliases = p.Aliases.split(','); }
      for (const alias of aliases) {
        const trimmed = (typeof alias === 'string' ? alias : '').trim();
        if (trimmed) addPlantLookup(normalizeLookup(trimmed), slug, name, 'alias');
      }
    }
  }

  console.log(`  Plant lookup: ${plantLookup.size} entries`);

  // ── Step 2: Fetch Varieties from NocoDB ───────────────────────────────────
  console.log('Step 2: Fetching varieties from NocoDB...');
  const varieties = await fetchAllRecords('Varieties', ['Id', 'Variety_Name', 'Plant_Id']);
  console.log(`  Fetched ${varieties.length} varieties`);

  // Build variety lookup: normalized name → { variety_id, variety_name, plant_id }
  const varietyLookup = new Map();
  // Also build list of all normalized variety names for fuzzy matching
  const allVarietyNames = [];

  for (const v of varieties) {
    if (!v.Variety_Name || !v.Plant_Id) continue;
    const norm = normalizeLookup(v.Variety_Name);
    if (!norm || norm.length < 3) continue;
    if (genericLookupTerms.has(norm) || stopWords.has(norm)) continue;

    if (!varietyLookup.has(norm)) {
      varietyLookup.set(norm, { variety_id: v.Id, variety_name: v.Variety_Name, plant_id: v.Plant_Id });
      allVarietyNames.push(norm);
    }
  }

  console.log(`  Variety lookup: ${varietyLookup.size} entries`);

  // Build array of all plant names for fuzzy matching
  const allPlantNames = Array.from(plantLookup.keys());

  // Build plant slug → canonical name map for display
  const plantNameMap = new Map();
  for (const p of plants) {
    if (p.Id1 && p.Canonical_Name) plantNameMap.set(p.Id1, p.Canonical_Name);
  }

  // ── Step 3: Walk unclassified images ──────────────────────────────────────
  console.log('Step 3: Scanning unclassified images...');

  const imageExtensions = new Set(['.jpg', '.jpeg', '.gif', '.png']);
  const imageFiles = [];

  function walkDir(dir, depth = 0) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try { stat = statSync(fullPath); } catch { continue; }
      if (stat.isDirectory()) {
        walkDir(fullPath, depth + 1);
      } else if (stat.isFile() && imageExtensions.has(extname(entry).toLowerCase())) {
        const relPath = relative(ROOT, fullPath).split('\\').join('/');
        const parentDir = basename(join(fullPath, '..'));
        const grandparentDir = basename(join(fullPath, '..', '..'));
        imageFiles.push({
          file_path: relPath,
          filename: entry,
          parent_dir: parentDir,
          grandparent_dir: grandparentDir,
          file_size: stat.size,
        });
      }
    }
  }

  walkDir(UNCLASSIFIED_ROOT);
  console.log(`  Found ${imageFiles.length} image files`);

  // ── Matching helper functions ─────────────────────────────────────────────

  function findPlantSubstring(text) {
    let bestMatch = null;
    let bestLen = 0;
    for (const name of allPlantNames) {
      if (name.length < 5) continue;
      if (stopWords.has(name)) continue;

      // Case A: plant name is a substring of the directory text
      const idx = text.indexOf(name);
      if (idx !== -1 && name.length > bestLen) {
        const before = idx > 0 ? text[idx - 1] : ' ';
        const after = idx + name.length < text.length ? text[idx + name.length] : ' ';
        if ((/[\s\-_.,]/.test(before) || idx === 0) && (/[\s\-_.,]/.test(after) || idx + name.length === text.length)) {
          bestLen = name.length;
          bestMatch = { ...plantLookup.get(name), matched_name: name };
          continue;
        }
      }

      // Case B: directory text is a prefix of the plant name
      // e.g. dir="surinam" → plant="surinam cherry"
      if (text.length >= 5 && text.length > bestLen && name.startsWith(text)) {
        bestLen = text.length;
        bestMatch = { ...plantLookup.get(name), matched_name: name };
      }
    }
    return bestMatch;
  }

  function findPlantFuzzy(term, maxDist) {
    if (stopWords.has(term) || term.length < 4) return null;
    let bestMatch = null;
    let bestDist = maxDist + 1;
    const effectiveMax = term.length <= 5 ? 1 : maxDist;
    for (const name of allPlantNames) {
      if (Math.abs(name.length - term.length) > effectiveMax || name.length < 4) continue;
      const dist = levenshtein(term, name);
      if (dist > 0 && dist <= effectiveMax && dist < bestDist) {
        if (dist / Math.max(term.length, name.length) > 0.4) continue;
        bestDist = dist;
        bestMatch = { ...plantLookup.get(name), matched_name: name, distance: dist };
      }
    }
    return bestMatch;
  }

  function findVarietyExact(term) {
    return varietyLookup.get(term) || null;
  }

  function findVarietySubstring(text) {
    let bestMatch = null;
    let bestLen = 0;
    for (const name of allVarietyNames) {
      if (name.length < 5) continue;
      if (stopWords.has(name)) continue;

      // Case A: variety name is a substring of the directory text
      const idx = text.indexOf(name);
      if (idx !== -1 && name.length > bestLen) {
        const before = idx > 0 ? text[idx - 1] : ' ';
        const after = idx + name.length < text.length ? text[idx + name.length] : ' ';
        if ((/[\s\-_.,]/.test(before) || idx === 0) && (/[\s\-_.,]/.test(after) || idx + name.length === text.length)) {
          bestLen = name.length;
          bestMatch = { ...varietyLookup.get(name), matched_name: name };
          continue;
        }
      }

      // Case B: directory text is a prefix of the variety name
      // e.g. dir="maoli hai" → variety="maoli haikea"
      if (text.length >= 5 && text.length > bestLen && name.startsWith(text)) {
        bestLen = text.length;
        bestMatch = { ...varietyLookup.get(name), matched_name: name };
      }
    }
    return bestMatch;
  }

  function findVarietyFuzzy(term, maxDist) {
    if (stopWords.has(term) || term.length < 4) return null;
    let bestMatch = null;
    let bestDist = maxDist + 1;
    const effectiveMax = term.length <= 5 ? 1 : maxDist;
    for (const name of allVarietyNames) {
      if (Math.abs(name.length - term.length) > effectiveMax || name.length < 4) continue;
      const dist = levenshtein(term, name);
      if (dist > 0 && dist <= effectiveMax && dist < bestDist) {
        if (dist / Math.max(term.length, name.length) > 0.4) continue;
        bestDist = dist;
        bestMatch = { ...varietyLookup.get(name), matched_name: name, distance: dist };
      }
    }
    return bestMatch;
  }

  // ── Step 4: Match each image ──────────────────────────────────────────────
  console.log('Step 4: Matching images...');

  const matches = [];
  const unmatchedFiles = [];
  let lastPct = 0;

  for (let idx = 0; idx < imageFiles.length; idx++) {
    const f = imageFiles[idx];
    const pct = Math.floor((idx / imageFiles.length) * 100);
    if (pct >= lastPct + 10) { process.stdout.write(`  ${pct}%...`); lastPct = pct; }

    const fileBase = normalize(f.filename);

    // Collect candidate directory names (parent, grandparent)
    const candidateDirs = [];
    for (const dirName of [f.parent_dir, f.grandparent_dir]) {
      const norm = normalize(dirName);
      if (norm && !genericDirs.has(norm) && !skipDirs.has(norm)) {
        candidateDirs.push({ raw: dirName, normalized: norm });
      }
    }

    let inference = null;

    // ── Priority 0: Hardcoded DIR_OVERRIDES ─────────────────────────────────
    for (const dir of candidateDirs) {
      const override = DIR_OVERRIDES.get(dir.normalized) || DIR_OVERRIDES.get(dir.raw.toLowerCase().trim());
      if (override) {
        inference = {
          plant_id: override.plant_id,
          plant_name: plantNameMap.get(override.plant_id) || override.plant_id,
          variety_id: null, variety_name: null,
          confidence: 'high', match_type: 'dir_override',
          signals: [`dir:${dir.raw} → override:${override.note}`],
        };
        break;
      }
    }

    // ── Priority 1: Variety exact match on directory ────────────────────────
    if (!inference) {
      for (const dir of candidateDirs) {
        if (dir.normalized.length < 3) continue;
        const vm = findVarietyExact(dir.normalized);
        if (vm) {
          inference = {
            plant_id: vm.plant_id,
            plant_name: plantNameMap.get(vm.plant_id) || vm.plant_id,
            variety_id: vm.variety_id, variety_name: vm.variety_name,
            confidence: 'high', match_type: 'variety_directory_exact',
            signals: [`dir:${dir.raw} → variety:"${vm.variety_name}" (${vm.plant_id})`],
          };
          break;
        }
      }
    }

    // ── Priority 2: Variety exact match on filename ─────────────────────────
    if (!inference && fileBase.length >= 3) {
      const vm = findVarietyExact(fileBase);
      if (vm) {
        inference = {
          plant_id: vm.plant_id,
          plant_name: plantNameMap.get(vm.plant_id) || vm.plant_id,
          variety_id: vm.variety_id, variety_name: vm.variety_name,
          confidence: 'high', match_type: 'variety_filename_exact',
          signals: [`file:${f.filename} → variety:"${vm.variety_name}" (${vm.plant_id})`],
        };
      }
    }

    // ── Priority 3: Variety substring match on directory ────────────────────
    if (!inference) {
      for (const dir of candidateDirs) {
        if (dir.normalized.length < 5) continue;
        const vm = findVarietySubstring(dir.normalized);
        if (vm) {
          inference = {
            plant_id: vm.plant_id,
            plant_name: plantNameMap.get(vm.plant_id) || vm.plant_id,
            variety_id: vm.variety_id, variety_name: vm.variety_name,
            confidence: 'medium', match_type: 'variety_directory_substring',
            signals: [`dir:${dir.raw} contains variety:"${vm.matched_name}" → "${vm.variety_name}" (${vm.plant_id})`],
          };
          break;
        }
      }
    }

    // ── Priority 4: Variety substring match on filename ─────────────────────
    if (!inference && fileBase.length >= 5) {
      const vm = findVarietySubstring(fileBase);
      if (vm) {
        inference = {
          plant_id: vm.plant_id,
          plant_name: plantNameMap.get(vm.plant_id) || vm.plant_id,
          variety_id: vm.variety_id, variety_name: vm.variety_name,
          confidence: 'medium', match_type: 'variety_filename_substring',
          signals: [`file:${f.filename} contains variety:"${vm.matched_name}" → "${vm.variety_name}" (${vm.plant_id})`],
        };
      }
    }

    // ── Priority 5: Variety fuzzy match on directory ────────────────────────
    if (!inference) {
      for (const dir of candidateDirs) {
        if (dir.normalized.length < 4) continue;
        const vm = findVarietyFuzzy(dir.normalized, 2);
        if (vm) {
          inference = {
            plant_id: vm.plant_id,
            plant_name: plantNameMap.get(vm.plant_id) || vm.plant_id,
            variety_id: vm.variety_id, variety_name: vm.variety_name,
            confidence: 'medium', match_type: 'variety_directory_fuzzy',
            signals: [`dir:${dir.raw} ≈ variety:"${vm.matched_name}" (dist=${vm.distance}) → "${vm.variety_name}" (${vm.plant_id})`],
          };
          break;
        }
      }
    }

    // ── Priority 6: Plant exact match on directory ──────────────────────────
    if (!inference) {
      for (const dir of candidateDirs) {
        if (dir.normalized.length < 4) continue;
        const pm = plantLookup.get(dir.normalized);
        if (pm) {
          inference = {
            plant_id: pm.plant_id,
            plant_name: pm.plant_name,
            variety_id: null, variety_name: null,
            confidence: 'high', match_type: 'plant_directory_exact',
            signals: [`dir:${dir.raw} → plant:"${pm.plant_name}" via ${pm.source}`],
          };
          break;
        }
      }
    }

    // ── Priority 7: Plant exact match on filename ───────────────────────────
    if (!inference && fileBase.length >= 3) {
      const pm = plantLookup.get(fileBase);
      if (pm) {
        inference = {
          plant_id: pm.plant_id,
          plant_name: pm.plant_name,
          variety_id: null, variety_name: null,
          confidence: 'high', match_type: 'plant_filename_exact',
          signals: [`file:${f.filename} → plant:"${pm.plant_name}" via ${pm.source}`],
        };
      }
    }

    // ── Priority 8: Plant substring match on directory ──────────────────────
    if (!inference) {
      for (const dir of candidateDirs) {
        if (dir.normalized.length < 5) continue;
        const pm = findPlantSubstring(dir.normalized);
        if (pm) {
          inference = {
            plant_id: pm.plant_id,
            plant_name: pm.plant_name,
            variety_id: null, variety_name: null,
            confidence: 'medium', match_type: 'plant_directory_substring',
            signals: [`dir:${dir.raw} contains plant:"${pm.matched_name}" → "${pm.plant_name}"`],
          };
          break;
        }
      }
    }

    // ── Priority 9: Plant substring match on filename ───────────────────────
    if (!inference && fileBase.length >= 5) {
      const pm = findPlantSubstring(fileBase);
      if (pm) {
        inference = {
          plant_id: pm.plant_id,
          plant_name: pm.plant_name,
          variety_id: null, variety_name: null,
          confidence: 'medium', match_type: 'plant_filename_substring',
          signals: [`file:${f.filename} contains plant:"${pm.matched_name}" → "${pm.plant_name}"`],
        };
      }
    }

    // ── Priority 10: Plant fuzzy match on directory (whole string, then words) ─
    if (!inference) {
      for (const dir of candidateDirs) {
        if (dir.normalized.length < 4) continue;
        // Try whole string first
        let pm = findPlantFuzzy(dir.normalized, 2);
        if (!pm) {
          // Try each word in the directory name (catches "papya leaf & rain" → papya ≈ papaya)
          const words = dir.normalized.split(/[\s&+,]+/).filter(w => w.length >= 4 && !stopWords.has(w));
          for (const word of words) {
            pm = findPlantFuzzy(word, 2);
            if (pm) break;
          }
        }
        if (pm) {
          inference = {
            plant_id: pm.plant_id,
            plant_name: pm.plant_name,
            variety_id: null, variety_name: null,
            confidence: 'low', match_type: 'plant_directory_fuzzy',
            signals: [`dir:${dir.raw} ≈ plant:"${pm.matched_name}" (dist=${pm.distance}) → "${pm.plant_name}"`],
          };
          break;
        }
      }
    }

    // ── Priority 11: Plant fuzzy match on filename words ────────────────────
    if (!inference && fileBase.length >= 4) {
      const words = fileBase.split(/\s+/).filter(w => w.length >= 4 && !stopWords.has(w));
      for (const word of words) {
        const pm = findPlantFuzzy(word, 2);
        if (pm) {
          inference = {
            plant_id: pm.plant_id,
            plant_name: pm.plant_name,
            variety_id: null, variety_name: null,
            confidence: 'low', match_type: 'plant_filename_fuzzy',
            signals: [`file word:"${word}" ≈ plant:"${pm.matched_name}" (dist=${pm.distance}) → "${pm.plant_name}"`],
          };
          break;
        }
      }
    }

    // ── Priority 12: Compound directory split ───────────────────────────────
    if (!inference) {
      for (const dir of candidateDirs) {
        const subNames = dir.normalized.split(/\s*[&+,]\s*|\s+and\s+/).filter(s => s.length >= 3);
        if (subNames.length > 1) {
          for (const sub of subNames) {
            const pm = plantLookup.get(sub.trim());
            if (pm) {
              inference = {
                plant_id: pm.plant_id,
                plant_name: pm.plant_name,
                variety_id: null, variety_name: null,
                confidence: 'low', match_type: 'compound_directory',
                signals: [`dir:${dir.raw} split → "${sub.trim()}" → plant:"${pm.plant_name}"`],
              };
              break;
            }
          }
          if (inference) break;
        }
      }
    }

    if (inference) {
      matches.push({
        file_path: f.file_path,
        filename: f.filename,
        parent_dir: f.parent_dir,
        grandparent_dir: f.grandparent_dir,
        file_size: f.file_size,
        ...inference,
      });
    } else {
      unmatchedFiles.push(f.file_path);
    }
  }

  console.log('\n');

  // ── Step 5: Write output ──────────────────────────────────────────────────
  console.log('Step 5: Writing output...');

  // Stats
  const confBreakdown = { high: 0, medium: 0, low: 0 };
  const matchTypeBreakdown = {};
  for (const m of matches) {
    confBreakdown[m.confidence]++;
    matchTypeBreakdown[m.match_type] = (matchTypeBreakdown[m.match_type] || 0) + 1;
  }

  const varietyMatches = matches.filter(m => m.variety_id !== null).length;
  const plantOnlyMatches = matches.filter(m => m.variety_id === null).length;

  const output = {
    generated_at: new Date().toISOString(),
    source_dir: 'content/pass_01/unassigned/unclassified/images',
    total_scanned: imageFiles.length,
    matched: matches.length,
    unmatched: unmatchedFiles.length,
    variety_matches: varietyMatches,
    plant_only_matches: plantOnlyMatches,
    confidence_breakdown: confBreakdown,
    match_type_breakdown: matchTypeBreakdown,
    matches,
    unmatched_files: unmatchedFiles,
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\n═══ Phase 4C Results ═══`);
  console.log(`  Total scanned: ${imageFiles.length}`);
  console.log(`  Matched: ${matches.length} (${(matches.length / imageFiles.length * 100).toFixed(1)}%)`);
  console.log(`    Variety matches: ${varietyMatches}`);
  console.log(`    Plant-only matches: ${plantOnlyMatches}`);
  console.log(`  Unmatched: ${unmatchedFiles.length}`);
  console.log(`  Confidence: high=${confBreakdown.high} medium=${confBreakdown.medium} low=${confBreakdown.low}`);
  console.log(`  Match types:`);
  for (const [type, count] of Object.entries(matchTypeBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }
  console.log(`\n  Output: ${OUTPUT_FILE}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
