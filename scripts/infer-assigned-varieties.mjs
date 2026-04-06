#!/usr/bin/env node
/**
 * Variety inference for assigned images.
 *
 * Finds images in NocoDB that ARE assigned to a plant (Plant_Id set) but DON'T have
 * a variety (Variety_Id null). Uses filename + Source_Directory to match against
 * that plant's varieties. Much more precise than Phase 4C since we already know the plant.
 *
 * Output: content/parsed/assigned_variety_inferences.json
 * Usage: node scripts/infer-assigned-varieties.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, basename, extname, dirname } from 'path';

const ROOT = join(import.meta.dirname, '..');
const PARSED = join(ROOT, 'content', 'parsed');
const OUTPUT_FILE = join(PARSED, 'assigned_variety_inferences.json');

// ── Load env ────────────────────────────────────────────────────────────────
try {
  const envText = readFileSync(join(ROOT, 'review-ui', '.env'), 'utf-8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* .env not found */ }

const NOCODB_API_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_API_KEY) { console.error('ERROR: NOCODB_API_KEY not found'); process.exit(1); }

const TABLE_IDS = JSON.parse(readFileSync(join(PARSED, 'nocodb_table_ids.json'), 'utf-8'));
const NOCODB_BASE = 'https://nocodb.djjd.us';

// ── NocoDB helpers ──────────────────────────────────────────────────────────

async function fetchAllRecords(tableName, fields, where) {
  const tableId = TABLE_IDS[tableName];
  if (!tableId) throw new Error(`Table "${tableName}" not found`);
  const all = [];
  let offset = 0;
  const fieldParam = fields ? `&fields=${fields.join(',')}` : '';
  const whereParam = where ? `&where=${encodeURIComponent(where)}` : '';
  while (true) {
    const url = `${NOCODB_BASE}/api/v2/tables/${tableId}/records?limit=200&offset=${offset}${fieldParam}${whereParam}`;
    const res = await fetch(url, { headers: { 'xc-token': NOCODB_API_KEY } });
    if (!res.ok) throw new Error(`NocoDB ${tableName} fetch failed: ${res.status}`);
    const data = await res.json();
    all.push(...data.list);
    if (data.pageInfo.isLastPage || all.length >= data.pageInfo.totalRows) break;
    offset += 200;
  }
  return all;
}

// ── Text normalization ──────────────────────────────────────────────────────

function normalize(name) {
  if (!name) return '';
  let n = name.toLowerCase();
  n = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  n = n.replace(/\.(jpg|jpeg|gif|png|bmp|tiff?|psd)$/i, '');
  n = n.replace(/[-_\.]/g, ' ');
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

/** Strip size/quality suffixes common in HTFG image naming */
function stripSizeSuffixes(name) {
  let n = name;
  // Strip trailing size indicators: lg, sm, med, lrg, sml, tn, thumb
  n = n.replace(/\s*(lg|sm|med|lrg|sml|tn|thumb)$/i, '').trim();
  // Strip dedup suffixes: _1, _2, etc.
  n = n.replace(/\s*_\d+$/, '').trim();
  // Strip trailing shot numbers: " 1", " 2", etc.
  n = n.replace(/\s+\d+$/, '').trim();
  return n;
}

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
      if (b[i - 1] === a[j - 1]) matrix[i][j] = matrix[i - 1][j - 1];
      else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

// ── Matching strategies (scoped to a single plant's varieties) ──────────────

function buildMatchers(varieties) {
  // Build lookup: normalized name → variety record
  const lookup = new Map();
  const allNames = [];
  for (const v of varieties) {
    const norm = normalize(v.Variety_Name);
    if (norm.length >= 3) {
      lookup.set(norm, { variety_id: v.Id, variety_name: v.Variety_Name });
      allNames.push(norm);
    }
  }

  function findExact(term) {
    return lookup.get(term) || null;
  }

  function findSubstring(text) {
    if (text.length < 3) return null;
    let bestMatch = null;
    let bestLen = 0;
    for (const name of allNames) {
      if (name.length < 3) continue;
      // Case A: variety name is a substring of text
      const idx = text.indexOf(name);
      if (idx !== -1 && name.length > bestLen) {
        const before = idx > 0 ? text[idx - 1] : ' ';
        const after = idx + name.length < text.length ? text[idx + name.length] : ' ';
        if ((/[\s]/.test(before) || idx === 0) && (/[\s]/.test(after) || idx + name.length === text.length)) {
          bestLen = name.length;
          bestMatch = { ...lookup.get(name), matched_name: name };
        }
      }
      // Case B: text is a prefix of the variety name
      if (text.length >= 5 && text.length > bestLen && name.startsWith(text)) {
        bestLen = text.length;
        bestMatch = { ...lookup.get(name), matched_name: name };
      }
    }
    return bestMatch;
  }

  function findFuzzy(term, maxDist = 2) {
    if (term.length < 4) return null;
    let bestMatch = null;
    let bestDist = maxDist + 1;
    const effectiveMax = term.length <= 5 ? 1 : maxDist;
    for (const name of allNames) {
      if (Math.abs(name.length - term.length) > effectiveMax || name.length < 4) continue;
      const dist = levenshtein(term, name);
      if (dist > 0 && dist <= effectiveMax && dist < bestDist) {
        if (dist / Math.max(term.length, name.length) > 0.4) continue;
        bestDist = dist;
        bestMatch = { ...lookup.get(name), matched_name: name, distance: dist };
      }
    }
    return bestMatch;
  }

  return { findExact, findSubstring, findFuzzy, size: allNames.length };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching images without varieties from NocoDB...');
  const images = await fetchAllRecords('Images',
    ['Id', 'File_Path', 'Plant_Id', 'Variety_Id', 'Size_Bytes', 'Source_Directory', 'Caption'],
    '(Variety_Id,blank)~and(Plant_Id,isnot,null)~and(Excluded,neq,true)'
  );
  console.log(`  ${images.length} images without variety assignment`);

  console.log('Fetching plants...');
  const plants = await fetchAllRecords('Plants', ['Id', 'Id1', 'Canonical_Name']);
  const plantNameMap = new Map();
  for (const p of plants) plantNameMap.set(p.Id1 || String(p.Id), p.Canonical_Name);

  console.log('Fetching varieties...');
  const varieties = await fetchAllRecords('Varieties', ['Id', 'Variety_Name', 'Plant_Id']);
  console.log(`  ${varieties.length} varieties total`);

  // Group varieties by Plant_Id
  const varietiesByPlant = new Map();
  for (const v of varieties) {
    if (!v.Plant_Id || !v.Variety_Name) continue;
    const list = varietiesByPlant.get(v.Plant_Id) || [];
    list.push(v);
    varietiesByPlant.set(v.Plant_Id, list);
  }

  const matches = [];
  const stats = { total: images.length, matched: 0, by_type: {} };

  for (const img of images) {
    const plantId = img.Plant_Id;
    const plantVarieties = varietiesByPlant.get(plantId);
    if (!plantVarieties || plantVarieties.length === 0) continue;

    const { findExact, findSubstring, findFuzzy } = buildMatchers(plantVarieties);

    const filename = basename(img.File_Path || '');
    const ext = extname(filename);
    const stem = filename.replace(new RegExp(`\\${ext}$`, 'i'), '');
    const normStem = normalize(stem);
    const strippedStem = stripSizeSuffixes(normStem);

    // Also try Source_Directory parts
    const srcDir = img.Source_Directory || '';
    const srcDirParts = srcDir.replace(/\\/g, '/').split('/').filter(p => p.length > 0);
    const lastDir = srcDirParts.length > 0 ? normalize(srcDirParts[srcDirParts.length - 1]) : '';
    const strippedDir = lastDir ? stripSizeSuffixes(lastDir) : '';

    let match = null;
    let matchType = '';
    let signal = '';

    // Strategy 1: Exact match on filename stem
    if (!match && normStem.length >= 3) {
      const m = findExact(normStem);
      if (m) { match = m; matchType = 'filename_exact'; signal = `file:"${normStem}" == variety:"${m.matched_name || m.variety_name}"`; }
    }

    // Strategy 2: Exact match on stripped stem (lg/sm removed)
    if (!match && strippedStem.length >= 3 && strippedStem !== normStem) {
      const m = findExact(strippedStem);
      if (m) { match = m; matchType = 'filename_stripped_exact'; signal = `file:"${normStem}" → stripped:"${strippedStem}" == variety:"${m.matched_name || m.variety_name}"`; }
    }

    // Strategy 3: Substring match on filename stem
    if (!match && normStem.length >= 4) {
      const m = findSubstring(normStem);
      if (m) { match = m; matchType = 'filename_substring'; signal = `file:"${normStem}" contains variety:"${m.matched_name}"`; }
    }

    // Strategy 4: Substring match on stripped stem
    if (!match && strippedStem.length >= 4 && strippedStem !== normStem) {
      const m = findSubstring(strippedStem);
      if (m) { match = m; matchType = 'filename_stripped_substring'; signal = `file:"${strippedStem}" (stripped) contains variety:"${m.matched_name}"`; }
    }

    // Strategy 5: Fuzzy match on filename stem
    if (!match && normStem.length >= 4) {
      const m = findFuzzy(normStem);
      if (m) { match = m; matchType = 'filename_fuzzy'; signal = `file:"${normStem}" ≈ variety:"${m.matched_name}" (dist=${m.distance})`; }
    }

    // Strategy 6: Fuzzy match on stripped stem
    if (!match && strippedStem.length >= 4 && strippedStem !== normStem) {
      const m = findFuzzy(strippedStem);
      if (m) { match = m; matchType = 'filename_stripped_fuzzy'; signal = `file:"${strippedStem}" (stripped) ≈ variety:"${m.matched_name}" (dist=${m.distance})`; }
    }

    // Strategy 7: Word-by-word fuzzy on filename tokens
    if (!match && normStem.length >= 4) {
      const words = normStem.split(/\s+/).filter(w => w.length >= 4);
      for (const word of words) {
        const m = findFuzzy(word, 1);
        if (m) { match = m; matchType = 'filename_word_fuzzy'; signal = `word:"${word}" from file ≈ variety:"${m.matched_name}" (dist=${m.distance})`; break; }
      }
    }

    // Strategy 8: Source directory exact
    if (!match && lastDir.length >= 3) {
      const m = findExact(lastDir);
      if (m) { match = m; matchType = 'directory_exact'; signal = `dir:"${lastDir}" == variety:"${m.matched_name || m.variety_name}"`; }
    }

    // Strategy 9: Source directory stripped exact
    if (!match && strippedDir.length >= 3 && strippedDir !== lastDir) {
      const m = findExact(strippedDir);
      if (m) { match = m; matchType = 'directory_stripped_exact'; signal = `dir:"${strippedDir}" (stripped) == variety:"${m.matched_name || m.variety_name}"`; }
    }

    // Strategy 10: Source directory substring
    if (!match && lastDir.length >= 4) {
      const m = findSubstring(lastDir);
      if (m) { match = m; matchType = 'directory_substring'; signal = `dir:"${lastDir}" contains variety:"${m.matched_name}"`; }
    }

    // Strategy 11: Source directory fuzzy
    if (!match && lastDir.length >= 4) {
      const m = findFuzzy(lastDir);
      if (m) { match = m; matchType = 'directory_fuzzy'; signal = `dir:"${lastDir}" ≈ variety:"${m.matched_name}" (dist=${m.distance})`; }
    }

    // Strategy 12: Caption match
    if (!match && img.Caption) {
      const normCaption = normalize(img.Caption);
      if (normCaption.length >= 4) {
        const m = findExact(normCaption) || findSubstring(normCaption);
        if (m) { match = m; matchType = 'caption_match'; signal = `caption:"${normCaption}" → variety:"${m.matched_name || m.variety_name}"`; }
      }
    }

    if (match) {
      const confidence = matchType.includes('exact') ? 'high'
        : matchType.includes('substring') || matchType.includes('caption') ? 'medium'
        : 'low';

      matches.push({
        image_id: img.Id,
        file_path: img.File_Path,
        filename,
        plant_id: plantId,
        plant_name: plantNameMap.get(plantId) || plantId,
        source_directory: srcDir || null,
        variety_id: match.variety_id,
        variety_name: match.variety_name,
        confidence,
        match_type: matchType,
        signals: [signal],
      });

      stats.matched++;
      stats.by_type[matchType] = (stats.by_type[matchType] || 0) + 1;
    }
  }

  // Sort by plant, then confidence, then filename
  const confOrder = { high: 0, medium: 1, low: 2 };
  matches.sort((a, b) => {
    const pc = a.plant_name.localeCompare(b.plant_name);
    if (pc !== 0) return pc;
    const cc = (confOrder[a.confidence] ?? 3) - (confOrder[b.confidence] ?? 3);
    if (cc !== 0) return cc;
    return a.filename.localeCompare(b.filename);
  });

  const output = {
    generated_at: new Date().toISOString(),
    total_images_checked: stats.total,
    matched: stats.matched,
    unmatched: stats.total - stats.matched,
    by_type: stats.by_type,
    matches,
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nResults:`);
  console.log(`  Total images checked: ${stats.total}`);
  console.log(`  Matched: ${stats.matched} (${(stats.matched / stats.total * 100).toFixed(1)}%)`);
  console.log(`  Unmatched: ${stats.total - stats.matched}`);
  console.log(`  Match types:`);
  for (const [type, count] of Object.entries(stats.by_type).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }
  console.log(`\n  Output: ${OUTPUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
