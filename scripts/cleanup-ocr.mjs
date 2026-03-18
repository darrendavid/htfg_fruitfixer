import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const parsedDir = path.join(import.meta.dirname, '..', 'content', 'parsed');

// Load input files
console.log('Loading input files...');
const ocrData = JSON.parse(readFileSync(path.join(parsedDir, 'phase6_ocr_extractions.json'), 'utf-8'));
const aliasMap = JSON.parse(readFileSync(path.join(parsedDir, 'cleanup_alias_map.json'), 'utf-8'));
const imagesData = JSON.parse(readFileSync(path.join(parsedDir, 'cleanup_images.json'), 'utf-8'));

const extractions = ocrData.extractions;
const aliases = aliasMap.aliases;
const images = imagesData.images;

console.log(`  OCR extractions: ${extractions.length}`);
console.log(`  Alias entries: ${Object.keys(aliases).length}`);
console.log(`  Image records: ${images.length}`);

// Build image lookup index by basename for matching OCR rel_path to image records
// Multiple images can share the same basename, so index as arrays
console.log('Building image lookup index...');
const imagesByBasename = new Map();
for (const img of images) {
  const basename = path.basename(img.file_path).toLowerCase();
  if (!imagesByBasename.has(basename)) {
    imagesByBasename.set(basename, []);
  }
  imagesByBasename.get(basename).push(img);
}
console.log(`  Unique basenames: ${imagesByBasename.size}`);

/**
 * Normalize a plant name for alias lookup.
 * Lowercase, trim, collapse whitespace.
 */
function normalizeName(name) {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Resolve a plant association name through the alias map.
 * Returns { canonical_id, type } or null if unresolved.
 */
function resolveAlias(name) {
  const key = normalizeName(name);
  const entry = aliases[key];
  if (!entry) return null;
  return { canonical_id: entry.canonical_id, type: entry.type };
}

/**
 * Find the best matching image record for an OCR extraction.
 * Matches by basename from rel_path against cleanup_images file_path basenames.
 * If multiple matches, prefer one whose plant_id overlaps with resolved plant IDs,
 * or whose path shares directory components with the OCR rel_path.
 */
function findImageMatch(ext, resolvedPlantIds) {
  // Normalize rel_path: replace backslashes with forward slashes
  const relPath = ext.rel_path.replace(/\\/g, '/');
  const basename = path.basename(relPath).toLowerCase();

  const candidates = imagesByBasename.get(basename);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Multiple candidates — try to disambiguate

  // Prefer candidates whose plant_id is in our resolved plant IDs
  if (resolvedPlantIds.length > 0) {
    const plantMatches = candidates.filter(c => c.plant_id && resolvedPlantIds.includes(c.plant_id));
    if (plantMatches.length === 1) return plantMatches[0];
    if (plantMatches.length > 1) {
      // Further narrow by path similarity
      const relParts = relPath.toLowerCase().split('/');
      let best = plantMatches[0];
      let bestScore = 0;
      for (const c of plantMatches) {
        const cParts = c.file_path.toLowerCase().split('/');
        const score = relParts.filter(p => cParts.includes(p)).length;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      return best;
    }
  }

  // Fall back to path similarity scoring
  const relParts = relPath.toLowerCase().split('/');
  let best = candidates[0];
  let bestScore = 0;
  for (const c of candidates) {
    const cParts = c.file_path.toLowerCase().split('/');
    const score = relParts.filter(p => cParts.includes(p)).length;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// Process extractions
console.log('Processing extractions...');
const results = [];
let withPlantIds = 0;
let totalKeyFacts = 0;
let linkedToImages = 0;
const contentTypes = {};
const varietyLog = []; // track variety resolutions for debugging

for (let i = 0; i < extractions.length; i++) {
  const ext = extractions[i];

  if ((i + 1) % 100 === 0 || i === extractions.length - 1) {
    console.log(`  Processing ${i + 1}/${extractions.length}...`);
  }

  // Resolve plant associations through alias map
  const rawAssociations = ext.plant_associations || [];
  const resolvedPlantIds = new Set();
  const varietyNames = [];

  for (const name of rawAssociations) {
    const resolved = resolveAlias(name);
    if (resolved) {
      if (resolved.type === 'variety') {
        // Varieties resolve to their parent canonical_id
        resolvedPlantIds.add(resolved.canonical_id);
        varietyNames.push({ name, canonical_id: resolved.canonical_id, type: 'variety' });
      } else {
        // species, alias, botanical all resolve to canonical_id
        resolvedPlantIds.add(resolved.canonical_id);
      }
    }
    // Unresolved names are kept in raw_plant_associations but don't add to plant_ids
  }

  const plantIds = [...resolvedPlantIds].sort();

  // Find matching image record
  const imageMatch = findImageMatch(ext, plantIds);

  // Count stats
  if (plantIds.length > 0) withPlantIds++;
  totalKeyFacts += (ext.key_facts || []).length;
  if (imageMatch) linkedToImages++;

  const ct = ext.content_type || 'unknown';
  contentTypes[ct] = (contentTypes[ct] || 0) + 1;

  // Normalize rel_path for output (forward slashes)
  const imagePath = ext.rel_path.replace(/\\/g, '/');

  results.push({
    id: i + 1,
    image_id: imageMatch ? imageMatch.id : null,
    image_path: imagePath,
    plant_ids: plantIds,
    title: ext.title || null,
    content_type: ext.content_type || null,
    extracted_text: ext.extracted_text || '',
    key_facts: ext.key_facts || [],
    source_context: ext.source_context || null,
    raw_plant_associations: rawAssociations
  });
}

// Build output
const output = {
  generated: new Date().toISOString(),
  stats: {
    total: results.length,
    with_plant_ids: withPlantIds,
    total_key_facts: totalKeyFacts,
    linked_to_images: linkedToImages,
    content_types: contentTypes
  },
  extractions: results
};

const outPath = path.join(parsedDir, 'cleanup_ocr_extractions.json');
writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

console.log('\nDone!');
console.log(`  Output: ${outPath}`);
console.log(`  Total extractions: ${output.stats.total}`);
console.log(`  With plant IDs: ${output.stats.with_plant_ids}`);
console.log(`  Total key facts: ${output.stats.total_key_facts}`);
console.log(`  Linked to images: ${output.stats.linked_to_images}`);
console.log(`  Content types:`, output.stats.content_types);
