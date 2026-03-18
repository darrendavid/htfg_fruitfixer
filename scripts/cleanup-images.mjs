import fs from 'node:fs';
import path from 'node:path';

const parsedDir = path.join(import.meta.dirname, '..', 'content', 'parsed');

function loadJSON(filename) {
  const filePath = path.join(parsedDir, filename);
  console.log(`Loading ${filename}...`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return data;
}

function titleCase(str) {
  return str
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function captionFromFilename(filename) {
  const name = path.parse(filename).name;
  return titleCase(name);
}

// Extract the first directory-level segment from a source path that could match triage keys.
// Triage keys are typically the first meaningful directory name (e.g. "04foodex", "05bonnenkai").
function getTriageDirs(sourcePath) {
  const parts = sourcePath.split('/');
  const dirs = [];
  for (const part of parts) {
    // Skip the root source prefixes and filename
    if (part === 'HawaiiFruit. Net' || part === 'original' || part === '') continue;
    dirs.push(part);
  }
  // Remove the filename (last element if it has an extension)
  if (dirs.length > 0 && path.extname(dirs[dirs.length - 1])) {
    dirs.pop();
  }
  return dirs;
}

// ---- Load all input files ----

const manifest = loadJSON('phase4_image_manifest.json');
const inferences = loadJSON('phase4b_inferences.json');
const unclassified = loadJSON('phase4b_still_unclassified.json');
const triageRaw = loadJSON('triage_decisions.json');
const aliasData = loadJSON('cleanup_alias_map.json');

// Build alias lookup: lowercase key -> canonical_id
const aliasMap = new Map();
for (const [key, value] of Object.entries(aliasData.aliases)) {
  aliasMap.set(key.toLowerCase(), value.canonical_id);
}

// Also handle varietal demotions — map old plant_id to parent_id
const demotions = new Map();
if (aliasData.varietal_demotions) {
  for (const [oldId, info] of Object.entries(aliasData.varietal_demotions)) {
    demotions.set(oldId, info.parent_id);
  }
}

// Build triage lookup by directory name
const triageDecisions = new Map();
for (const [dirName, decision] of Object.entries(triageRaw)) {
  triageDecisions.set(dirName.trim(), decision);
}

// Build inference lookup by source path
const inferenceMap = new Map();
for (const inf of inferences.inferences) {
  inferenceMap.set(inf.path, inf);
}

// Build set of still-unclassified paths
const stillUnclassifiedSet = new Set();
for (const f of unclassified.files) {
  stillUnclassifiedSet.add(f.path);
}

console.log(`\nManifest: ${manifest.files.length} images`);
console.log(`Inferences: ${inferences.inferences.length}`);
console.log(`Still unclassified: ${unclassified.files.length}`);
console.log(`Triage decisions: ${triageDecisions.size}`);
console.log(`Alias entries: ${aliasMap.size}`);
console.log(`Varietal demotions: ${demotions.size}\n`);

// ---- Process each image ----

const images = [];
let statsWithPlant = 0;
let statsExcluded = 0;
let statsNeedsReview = 0;
let statsFromPhase4bHighMed = 0;

for (let i = 0; i < manifest.files.length; i++) {
  const entry = manifest.files[i];
  if (i > 0 && i % 5000 === 0) {
    console.log(`Processing image ${i} / ${manifest.files.length}...`);
  }

  const sourcePath = entry.source;
  const destPath = entry.dest;
  let plantId = entry.plant_id || null;
  const sizeBytes = entry.size || 0;
  let excluded = false;
  let needsReview = false;
  let confidence = null;

  // Step 2: Apply Phase 4B inferences (high/medium only)
  const inference = inferenceMap.get(sourcePath);
  if (inference) {
    if (inference.confidence === 'high' || inference.confidence === 'medium') {
      plantId = inference.inferred_plant_id;
      confidence = inference.confidence;
      statsFromPhase4bHighMed++;
    } else if (inference.confidence === 'low') {
      // Low confidence — flag for review, don't override plant_id
      confidence = 'low';
      needsReview = true;
    }
  }

  // Step 3: Apply triage decisions
  const triageDirs = getTriageDirs(sourcePath);
  for (const dirName of triageDirs) {
    const decision = triageDecisions.get(dirName);
    if (!decision) continue;

    if (decision.action === 'reject') {
      excluded = true;
    }
    if (decision.plant_id) {
      plantId = decision.plant_id;
    }
    break; // Use the first matching triage decision
  }

  // Step 4: Re-validate plant_id through alias map and demotions
  if (plantId) {
    // Check demotions first (e.g. guava-strawberry -> guava)
    if (demotions.has(plantId)) {
      plantId = demotions.get(plantId);
    }
    // Check alias map for remapping
    const aliasLookup = aliasMap.get(plantId.toLowerCase());
    if (aliasLookup && aliasLookup !== plantId) {
      plantId = aliasLookup;
    }
  }

  // Step 5: Generate caption from filename
  const filename = path.basename(sourcePath);
  const caption = captionFromFilename(filename);

  // Step 6: Flag needs_review for unclassified without plant_id
  if (!plantId && !excluded) {
    needsReview = true;
  }
  // Low confidence already flagged above

  // Extract source directory from source path
  const sourceDirectory = path.dirname(sourcePath).replace(/\\/g, '/');

  // Track stats
  if (plantId && !excluded) statsWithPlant++;
  if (excluded) statsExcluded++;
  if (needsReview) statsNeedsReview++;

  images.push({
    id: 0, // assigned after
    file_path: destPath,
    plant_id: plantId,
    caption,
    source_directory: sourceDirectory,
    size_bytes: sizeBytes,
    confidence,
    excluded,
    needs_review: needsReview
  });
}

// Step 7: Assign sequential IDs
for (let i = 0; i < images.length; i++) {
  images[i].id = i + 1;
}

const output = {
  generated: new Date().toISOString(),
  stats: {
    total: images.length,
    with_plant_id: statsWithPlant,
    excluded: statsExcluded,
    needs_review: statsNeedsReview,
    from_phase4b_high_med: statsFromPhase4bHighMed
  },
  images
};

const outputPath = path.join(parsedDir, 'cleanup_images.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`\nDone! Wrote ${outputPath}`);
console.log(`  Total images: ${output.stats.total}`);
console.log(`  With plant_id: ${output.stats.with_plant_id}`);
console.log(`  Excluded: ${output.stats.excluded}`);
console.log(`  Needs review: ${output.stats.needs_review}`);
console.log(`  From Phase 4B (high/med): ${output.stats.from_phase4b_high_med}`);
