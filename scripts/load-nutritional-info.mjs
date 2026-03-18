/**
 * Extract nutritional data from OCR key_facts and load into NocoDB Nutritional_Info table.
 *
 * Normalizes the wide variety of field names (calories_per_100g, Calories per 100g,
 * calorie content, etc.) into canonical nutrient names, parses values and units.
 *
 * Usage: node scripts/load-nutritional-info.mjs
 *        node scripts/load-nutritional-info.mjs --dry-run
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(import.meta.dirname, '..', '.env') });

const ROOT = join(import.meta.dirname, '..');
const PARSED = join(ROOT, 'content', 'parsed');
const API_KEY = process.env.NOCODB_API_KEY;
const BASE_URL = 'https://nocodb.djjd.us';
const DRY_RUN = process.argv.includes('--dry-run');

// Load data
const ocr = JSON.parse(readFileSync(join(PARSED, 'phase6_ocr_extractions.json'), 'utf-8'));
const aliasMap = JSON.parse(readFileSync(join(PARSED, 'cleanup_alias_map.json'), 'utf-8'));
const tableIds = JSON.parse(readFileSync(join(PARSED, 'nocodb_table_ids.json'), 'utf-8'));

const NUTRITIONAL_TABLE_ID = tableIds['Nutritional_Info'];
if (!NUTRITIONAL_TABLE_ID) {
  console.error('Nutritional_Info table ID not found in nocodb_table_ids.json');
  process.exit(1);
}

// ── Nutrient field normalization ─────────────────────────────────────────────
// Map messy OCR field names → canonical nutrient name

const NUTRIENT_PATTERNS = [
  // Macronutrients
  { pattern: /^calories|^food.energy|^energy/i, nutrient: 'Calories', unit: 'kcal' },
  { pattern: /^protein/i, nutrient: 'Protein', unit: 'g' },
  { pattern: /^(total.)?fat|^lipid/i, nutrient: 'Fat', unit: 'g' },
  { pattern: /^(total.)?carbohydrate|^carbs/i, nutrient: 'Carbohydrates', unit: 'g' },
  { pattern: /^(dietary.)?fiber|^crude.fiber/i, nutrient: 'Fiber', unit: 'g' },
  { pattern: /^(total.)?sugar|^reducing.sugar/i, nutrient: 'Sugar', unit: 'g' },
  { pattern: /^moisture|^water.content/i, nutrient: 'Moisture', unit: '%' },
  { pattern: /^ash/i, nutrient: 'Ash', unit: 'g' },

  // Minerals
  { pattern: /^calcium/i, nutrient: 'Calcium', unit: 'mg' },
  { pattern: /^iron/i, nutrient: 'Iron', unit: 'mg' },
  { pattern: /^phosphor/i, nutrient: 'Phosphorus', unit: 'mg' },
  { pattern: /^potassium/i, nutrient: 'Potassium', unit: 'mg' },
  { pattern: /^sodium/i, nutrient: 'Sodium', unit: 'mg' },
  { pattern: /^magnesium/i, nutrient: 'Magnesium', unit: 'mg' },

  // Vitamins
  { pattern: /^ascorbic.acid|^vitamin.c/i, nutrient: 'Vitamin C', unit: 'mg' },
  { pattern: /^(vitamin.a|carotene|ß.carotene|beta.carotene)/i, nutrient: 'Vitamin A', unit: 'IU' },
  { pattern: /^thiamin|^vitamin.b1/i, nutrient: 'Thiamine (B1)', unit: 'mg' },
  { pattern: /^riboflavin|^vitamin.b2/i, nutrient: 'Riboflavin (B2)', unit: 'mg' },
  { pattern: /^niacin|^vitamin.b3/i, nutrient: 'Niacin (B3)', unit: 'mg' },

  // Brix (sugar content measurement for fruits)
  { pattern: /brix$/i, nutrient: 'Brix', unit: '°Bx' },
];

// Fields to skip — not nutritional data
const SKIP_PATTERNS = [
  /^(main.)?ingredients/i, /^preparation/i, /^flavor/i, /^storage/i,
  /^usage/i, /^traditional/i, /^medicinal/i, /^growing/i, /^location/i,
  /^introduction/i, /^chemical.compound/i, /^product/i, /^beverage/i,
  /^final.appearance/i, /^additional/i, /^primary/i, /^water.require/i,
  /^nutritional.claim/i, /^nutritional.content$/i, /^vitamin.content$/i,
  /^chemical.content/i, /^essential.fatty/i,
];

function normalizeField(fieldName) {
  const clean = fieldName.toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s*per\s*100\s*g\s*(pulp|juice|seeds?)?/i, '')
    .replace(/\s*(content|amount)\s*/i, '')
    .replace(/\s*(pulp|seeds?|juice|dried|fresh)\s*/i, '')
    .trim();

  for (const skip of SKIP_PATTERNS) {
    if (skip.test(clean)) return null;
  }

  for (const { pattern, nutrient, unit } of NUTRIENT_PATTERNS) {
    if (pattern.test(clean)) {
      return { nutrient, defaultUnit: unit };
    }
  }

  return null;
}

function parseValue(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return { value: rawValue, unit: null, per_serving: 'per 100g' };

  let value = rawValue.trim();
  let unit = null;
  let per_serving = 'per 100g';

  // Check for "per 100g" or similar
  if (/per\s*\d+\s*g/i.test(value)) {
    const match = value.match(/per\s*(\d+)\s*g/i);
    if (match) per_serving = `per ${match[1]}g`;
  }
  if (/per\s*kg/i.test(value)) per_serving = 'per kg';

  // Extract unit from value string
  const unitMatch = value.match(/(\d[\d.,\-\s]*)\s*(mg|g|kcal|cal|%|i\.?u\.?|iu|mcg|µg|°bx)/i);
  if (unitMatch) {
    value = unitMatch[1].trim();
    unit = unitMatch[2].replace(/\./g, '').toUpperCase();
    if (unit === 'IU' || unit === 'I U') unit = 'IU';
    if (unit === 'G') unit = 'g';
    if (unit === 'MG') unit = 'mg';
    if (unit === 'MCG' || unit === 'ΜG') unit = 'mcg';
    if (unit === 'KCAL' || unit === 'CAL') unit = 'kcal';
  }

  // Clean up value — remove trailing text
  value = value.replace(/\s*(per|g$|mg$)/gi, '').trim();

  return { value, unit, per_serving };
}

function resolvePlantId(plantAssociations) {
  if (!plantAssociations || plantAssociations.length === 0) return null;

  for (const name of plantAssociations) {
    const norm = name.toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[-_]/g, ' ')
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const entry = aliasMap.aliases[norm];
    if (entry && (entry.type === 'species' || entry.type === 'alias' || entry.type === 'botanical')) {
      return entry.canonical_id;
    }
  }

  return null;
}

// ── Extract nutritional records ──────────────────────────────────────────────

console.log('Extracting nutritional data from OCR key_facts...');

const records = []; // { Plant_Id, Nutrient_Name, Value, Unit, Per_Serving, Source }
const seen = new Set(); // dedup key: plant_id|nutrient

let extractionsWithNutrition = 0;

for (const ext of ocr.extractions) {
  if (!ext.key_facts || ext.key_facts.length === 0) continue;

  const plantId = resolvePlantId(ext.plant_associations);

  let hasNutrition = false;

  for (const fact of ext.key_facts) {
    const normalized = normalizeField(fact.field || '');
    if (!normalized) continue;

    const { value, unit, per_serving } = parseValue(fact.value);
    const finalUnit = unit || normalized.defaultUnit;

    // Dedup: keep first occurrence per plant+nutrient
    const key = `${plantId || 'unknown'}|${normalized.nutrient}`;
    if (seen.has(key)) continue;
    seen.add(key);

    records.push({
      Nutrient_Name: normalized.nutrient,
      Plant_Id: plantId || 'unknown',
      Value: value,
      Unit: finalUnit,
      Per_Serving: per_serving,
      Source: `OCR: ${ext.title || ext.image_path || 'unknown'}`,
    });

    hasNutrition = true;
  }

  if (hasNutrition) extractionsWithNutrition++;
}

// Remove records with plant_id 'unknown'
const validRecords = records.filter(r => r.Plant_Id !== 'unknown');
const unknownRecords = records.filter(r => r.Plant_Id === 'unknown');

console.log(`\nResults:`);
console.log(`  OCR extractions with nutrition: ${extractionsWithNutrition}`);
console.log(`  Total nutrient records: ${records.length}`);
console.log(`  With resolved plant_id: ${validRecords.length}`);
console.log(`  Without plant_id (skipped): ${unknownRecords.length}`);

// Show nutrient distribution
const nutrientCounts = {};
for (const r of validRecords) {
  nutrientCounts[r.Nutrient_Name] = (nutrientCounts[r.Nutrient_Name] || 0) + 1;
}
console.log(`\nNutrient distribution:`);
Object.entries(nutrientCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  console.log(`  ${k}: ${v}`);
});

// Show plant coverage
const plantCounts = {};
for (const r of validRecords) {
  plantCounts[r.Plant_Id] = (plantCounts[r.Plant_Id] || 0) + 1;
}
console.log(`\nPlants with nutritional data: ${Object.keys(plantCounts).length}`);
console.log('Top 10:');
Object.entries(plantCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([k, v]) => {
  console.log(`  ${k}: ${v} nutrients`);
});

// Save for reference
writeFileSync(join(PARSED, 'load_nutritional_info.json'), JSON.stringify(validRecords, null, 2));
console.log(`\nSaved ${validRecords.length} records to load_nutritional_info.json`);

// ── Load into NocoDB ─────────────────────────────────────────────────────────

if (DRY_RUN) {
  console.log(`\n[DRY RUN] Would insert ${validRecords.length} records into Nutritional_Info`);
  process.exit(0);
}

console.log(`\nLoading ${validRecords.length} records into NocoDB...`);

const BATCH_SIZE = 100;
let inserted = 0;
let errors = 0;

for (let i = 0; i < validRecords.length; i += BATCH_SIZE) {
  const batch = validRecords.slice(i, i + BATCH_SIZE);
  try {
    const res = await fetch(`${BASE_URL}/api/v2/tables/${NUTRITIONAL_TABLE_ID}/records`, {
      method: 'POST',
      headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text.slice(0, 200)}`);
    }
    inserted += batch.length;
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, validRecords.length)}/${validRecords.length} inserted`);
  } catch (err) {
    console.error(`\n  Batch error at offset ${i}: ${err.message}`);
    errors += batch.length;
  }
}

console.log(`\n\nDone: ${inserted} inserted, ${errors} errors`);
