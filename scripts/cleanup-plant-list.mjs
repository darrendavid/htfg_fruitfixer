/**
 * cleanup-plant-list.mjs
 *
 * Produces the canonical plant list for the NocoDB Plants table.
 *
 * Input files (all in content/parsed/):
 *   - plant_registry.json          — 140 plants from Phase 1
 *   - cleanup_alias_map.json       — alias map with varietal_demotions
 *   - phase3_harvest_calendar.json — 100 records with botanical names + months
 *   - phase3_fruit_data.json       — 77 records with descriptions
 *   - plant_evidence_report.json   — 181 plants with source/image counts
 *
 * Output: content/parsed/cleanup_plants_canonical.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const parsedDir = path.join(import.meta.dirname, '..', 'content', 'parsed');

// ── Load input files ────────────────────────────────────────────────────────

console.log('Loading input files...');

const registry = JSON.parse(readFileSync(path.join(parsedDir, 'plant_registry.json'), 'utf-8'));
const aliasMap = JSON.parse(readFileSync(path.join(parsedDir, 'cleanup_alias_map.json'), 'utf-8'));
const harvestCal = JSON.parse(readFileSync(path.join(parsedDir, 'phase3_harvest_calendar.json'), 'utf-8'));
const fruitData = JSON.parse(readFileSync(path.join(parsedDir, 'phase3_fruit_data.json'), 'utf-8'));
const evidenceReport = JSON.parse(readFileSync(path.join(parsedDir, 'plant_evidence_report.json'), 'utf-8'));

console.log(`  Registry: ${registry.plants.length} plants`);
console.log(`  Harvest calendar: ${harvestCal.records.length} records`);
console.log(`  Fruit data: ${fruitData.records.length} records`);
console.log(`  Evidence report: ${evidenceReport.plants.length} plants`);
console.log(`  Demotions: ${Object.keys(aliasMap.varietal_demotions).length} varietals`);

// ── Month name → number mapping ─────────────────────────────────────────────

const MONTH_MAP = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function monthNamesToNumbers(monthNames) {
  if (!monthNames || !Array.isArray(monthNames)) return [];
  return monthNames
    .map(m => MONTH_MAP[m.toLowerCase().trim()])
    .filter(n => n !== undefined)
    .sort((a, b) => a - b);
}

// ── Step 1: Remove demoted varietals ────────────────────────────────────────

const demotedIds = new Set(Object.keys(aliasMap.varietal_demotions));
const plants = registry.plants.filter(p => !demotedIds.has(p.id));

console.log(`\nStep 1: Removed ${registry.plants.length - plants.length} demoted varietals`);
console.log(`  Remaining: ${plants.length} plants`);

// ── Build lookup indices for enrichment sources ─────────────────────────────

// Harvest calendar: index by lowercase common_name
const calByName = new Map();
for (const rec of harvestCal.records) {
  calByName.set(rec.common_name.toLowerCase().trim(), rec);
}

// Fruit data: index by lowercase common_name
const fruitDataByName = new Map();
for (const rec of fruitData.records) {
  if (rec.common_name) fruitDataByName.set(rec.common_name.toLowerCase().trim(), rec);
}

// Evidence report: index by registry_id (when available) and lowercase name
const evidenceById = new Map();
const evidenceByName = new Map();
for (const rec of evidenceReport.plants) {
  if (rec.registry_id) {
    evidenceById.set(rec.registry_id, rec);
  }
  evidenceByName.set(rec.name.toLowerCase().trim(), rec);
}

// ── Step 2: Enrich registry plants ──────────────────────────────────────────

console.log('\nStep 2: Enriching registry plants...');

const navPattern = /^(next|previous|return)/i;
let enrichedBotanical = 0;
let enrichedHarvest = 0;
let enrichedDescription = 0;
let enrichedEvidence = 0;

const canonicalPlants = plants.map(plant => {
  // Start with base fields
  const entry = {
    id: plant.id,
    canonical_name: plant.common_name,
    botanical_name: (plant.botanical_names && plant.botanical_names.length > 0)
      ? plant.botanical_names[0]
      : null,
    family: null,
    category: plant.category || 'fruit',
    aliases: plant.aliases || [],
    description: null,
    harvest_months: (plant.harvest_months && plant.harvest_months.length > 0)
      ? plant.harvest_months
      : [],
    at_kona_station: plant.at_kona_station || false,
    source_count: 0,
    image_count: 0,
  };

  // Try to match harvest calendar by common_name
  const calRec = calByName.get(plant.common_name.toLowerCase().trim());

  // Enrich botanical_name from harvest calendar if registry is empty
  if (!entry.botanical_name && calRec && calRec.botanical_name) {
    entry.botanical_name = calRec.botanical_name;
    enrichedBotanical++;
  }

  // Enrich harvest_months from harvest calendar if empty
  if (entry.harvest_months.length === 0 && calRec && calRec.months) {
    const nums = monthNamesToNumbers(calRec.months);
    if (nums.length > 0) {
      entry.harvest_months = nums;
      enrichedHarvest++;
    }
  }

  // Enrich description from fruit data (only if >50 chars and not nav text)
  const fdRec = fruitDataByName.get(plant.common_name.toLowerCase().trim());
  if (fdRec && fdRec.description) {
    const desc = fdRec.description.trim();
    if (desc.length > 50 && !navPattern.test(desc)) {
      entry.description = desc;
      enrichedDescription++;
    }
  }

  // Enrich source_count and image_count from evidence report
  const evRec = evidenceById.get(plant.id) || evidenceByName.get(plant.common_name.toLowerCase().trim());
  if (evRec) {
    entry.source_count = evRec.source_count || 0;
    entry.image_count = evRec.image_count || 0;
    enrichedEvidence++;
  }

  return entry;
});

console.log(`  Botanical names enriched: ${enrichedBotanical}`);
console.log(`  Harvest months enriched: ${enrichedHarvest}`);
console.log(`  Descriptions enriched: ${enrichedDescription}`);
console.log(`  Evidence stats enriched: ${enrichedEvidence}`);

// ── Step 3: Add well-evidenced plants not in registry ───────────────────────

console.log('\nStep 3: Checking evidence report for new well-evidenced plants...');

const existingIds = new Set(canonicalPlants.map(p => p.id));

let newAdditions = 0;
for (const evPlant of evidenceReport.plants) {
  // Skip plants already in registry (by registry_id)
  if (evPlant.registry_id && existingIds.has(evPlant.registry_id)) {
    continue;
  }

  // Skip plants already added by name match
  const nameKey = evPlant.name.toLowerCase().trim();
  if ([...existingIds].some(id => id === nameKey)) {
    continue;
  }

  // Only add well-evidenced plants: source_count >= 2 AND image_count >= 10
  if ((evPlant.source_count || 0) < 2 || (evPlant.image_count || 0) < 10) {
    continue;
  }

  // Generate an id from the name
  const newId = evPlant.name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // Skip if this id already exists
  if (existingIds.has(newId)) {
    continue;
  }

  // Try to get botanical name from harvest calendar
  const calRec = calByName.get(nameKey);
  const botanicalName = calRec ? calRec.botanical_name : null;

  // Try to get harvest months from harvest calendar
  let harvestMonths = [];
  if (calRec && calRec.months) {
    harvestMonths = monthNamesToNumbers(calRec.months);
  }

  // Try to get description from fruit data
  let description = null;
  const fdRec = fruitDataByName.get(nameKey);
  if (fdRec && fdRec.description) {
    const desc = fdRec.description.trim();
    if (desc.length > 50 && !navPattern.test(desc)) {
      description = desc;
    }
  }

  const newEntry = {
    id: newId,
    canonical_name: evPlant.name,
    botanical_name: botanicalName || null,
    family: null,
    category: 'fruit',
    aliases: [],
    description,
    harvest_months: harvestMonths,
    at_kona_station: false,
    source_count: evPlant.source_count || 0,
    image_count: evPlant.image_count || 0,
  };

  canonicalPlants.push(newEntry);
  existingIds.add(newId);
  newAdditions++;
  console.log(`  + Added "${evPlant.name}" (sources: ${evPlant.source_count}, images: ${evPlant.image_count})`);
}

console.log(`  New additions from evidence report: ${newAdditions}`);

// ── Sort by canonical_name ──────────────────────────────────────────────────

canonicalPlants.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name, 'en', { sensitivity: 'base' }));

// ── Compute stats ───────────────────────────────────────────────────────────

const stats = {
  total_plants: canonicalPlants.length,
  from_registry: plants.length,
  demoted_varietals: Object.keys(aliasMap.varietal_demotions).length,
  new_from_evidence: newAdditions,
  with_botanical_name: canonicalPlants.filter(p => p.botanical_name).length,
  with_harvest_months: canonicalPlants.filter(p => p.harvest_months.length > 0).length,
  with_description: canonicalPlants.filter(p => p.description).length,
  with_images: canonicalPlants.filter(p => p.image_count > 0).length,
  total_images: canonicalPlants.reduce((sum, p) => sum + p.image_count, 0),
  enrichment: {
    botanical_from_calendar: enrichedBotanical,
    harvest_from_calendar: enrichedHarvest,
    descriptions_added: enrichedDescription,
    evidence_stats_added: enrichedEvidence,
  },
};

// ── Write output ────────────────────────────────────────────────────────────

const output = {
  generated: new Date().toISOString(),
  description: 'Canonical plant list for NocoDB Plants table — enriched and deduplicated',
  stats,
  plants: canonicalPlants,
};

const outputPath = path.join(parsedDir, 'cleanup_plants_canonical.json');
writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

console.log('\n── Summary ─────────────────────────────────────────');
console.log(`  Total canonical plants: ${stats.total_plants}`);
console.log(`  From registry (after demotions): ${stats.from_registry}`);
console.log(`  New from evidence report: ${stats.new_from_evidence}`);
console.log(`  With botanical name: ${stats.with_botanical_name}`);
console.log(`  With harvest months: ${stats.with_harvest_months}`);
console.log(`  With description: ${stats.with_description}`);
console.log(`  With images: ${stats.with_images}`);
console.log(`  Total images across all plants: ${stats.total_images}`);
console.log(`\nOutput written to: ${outputPath}`);
