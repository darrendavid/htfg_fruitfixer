/**
 * cleanup-generate-schema.mjs
 *
 * Creates all NocoDB tables for the HTFG fruit database via the v2 REST API.
 * Tables are created sequentially. If a table already exists the error is
 * logged and the script continues (idempotent).
 *
 * Usage:  node scripts/cleanup-generate-schema.mjs
 *
 * Requires NOCODB_API_KEY in ../.env
 */

import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { config } from 'dotenv';

config({ path: join(import.meta.dirname, '..', '.env') });

// ── Config ──────────────────────────────────────────────────────────────────

const NOCODB_URL = 'https://nocodb.djjd.us';
const BASE_ID   = 'pimorqbta2ve966';
const SOURCE_ID = 'b7tq6lj3cr6zhzz';
const API_KEY   = process.env.NOCODB_API_KEY;

if (!API_KEY) {
  console.error('ERROR: NOCODB_API_KEY not found in .env');
  process.exit(1);
}

const OUTPUT_PATH = join(import.meta.dirname, '..', 'content', 'parsed', 'nocodb_table_ids.json');

// ── Table definitions ───────────────────────────────────────────────────────

const TABLES = [
  {
    title: 'Plants',
    columns: [
      { title: 'Id',              uidt: 'SingleLineText', pv: true },
      { title: 'Canonical_Name',  uidt: 'SingleLineText' },
      { title: 'Botanical_Name',  uidt: 'SingleLineText' },
      { title: 'Family',          uidt: 'SingleLineText' },
      { title: 'Category',        uidt: 'SingleLineText' },
      { title: 'Aliases',         uidt: 'LongText' },
      { title: 'Description',     uidt: 'LongText' },
      { title: 'Harvest_Months',  uidt: 'LongText' },
      { title: 'Tasting_Notes',   uidt: 'LongText' },
      { title: 'At_Kona_Station', uidt: 'Checkbox' },
      { title: 'Source_Count',    uidt: 'Number' },
      { title: 'Image_Count',     uidt: 'Number' },
    ],
  },
  {
    title: 'Varieties',
    columns: [
      { title: 'Variety_Name',    uidt: 'SingleLineText', pv: true },
      { title: 'Plant_Id',        uidt: 'SingleLineText' },
      { title: 'Characteristics', uidt: 'LongText' },
      { title: 'Tasting_Notes',   uidt: 'LongText' },
      { title: 'Source',          uidt: 'SingleLineText' },
    ],
  },
  {
    title: 'Geographies',
    columns: [
      { title: 'Id',              uidt: 'SingleLineText', pv: true },
      { title: 'Island',          uidt: 'SingleLineText' },
      { title: 'District',        uidt: 'SingleLineText' },
      { title: 'Moku',            uidt: 'SingleLineText' },
      { title: 'Subregion',       uidt: 'SingleLineText' },
      { title: 'Elevation_Zone',  uidt: 'SingleLineText' },
      { title: 'Rainfall_Zone',   uidt: 'SingleLineText' },
      { title: 'Notes',           uidt: 'LongText' },
    ],
  },
  {
    title: 'Images',
    columns: [
      { title: 'File_Path',         uidt: 'SingleLineText', pv: true },
      { title: 'Plant_Id',          uidt: 'SingleLineText' },
      { title: 'Caption',           uidt: 'SingleLineText' },
      { title: 'Source_Directory',   uidt: 'SingleLineText' },
      { title: 'Size_Bytes',        uidt: 'Number' },
      { title: 'Confidence',        uidt: 'SingleLineText' },
      { title: 'Excluded',          uidt: 'Checkbox' },
      { title: 'Needs_Review',      uidt: 'Checkbox' },
    ],
  },
  {
    title: 'Documents',
    columns: [
      { title: 'Title',              uidt: 'SingleLineText', pv: true },
      { title: 'Doc_Type',           uidt: 'SingleLineText' },
      { title: 'Content_Text',       uidt: 'LongText' },
      { title: 'Content_Preview',    uidt: 'LongText' },
      { title: 'Plant_Ids',          uidt: 'LongText' },
      { title: 'Original_File_Path', uidt: 'SingleLineText' },
      { title: 'Is_Plant_Related',   uidt: 'Checkbox' },
    ],
  },
  {
    title: 'Recipes',
    columns: [
      { title: 'Title',        uidt: 'SingleLineText', pv: true },
      { title: 'Ingredients',  uidt: 'LongText' },
      { title: 'Method',       uidt: 'LongText' },
      { title: 'Plant_Ids',    uidt: 'LongText' },
      { title: 'Source_File',  uidt: 'SingleLineText' },
      { title: 'Needs_Review', uidt: 'Checkbox' },
    ],
  },
  {
    title: 'OCR_Extractions',
    columns: [
      { title: 'Title',                  uidt: 'SingleLineText', pv: true },
      { title: 'Image_Path',             uidt: 'SingleLineText' },
      { title: 'Content_Type',           uidt: 'SingleLineText' },
      { title: 'Extracted_Text',         uidt: 'LongText' },
      { title: 'Plant_Ids',              uidt: 'LongText' },
      { title: 'Key_Facts',              uidt: 'LongText' },
      { title: 'Source_Context',         uidt: 'SingleLineText' },
      { title: 'Raw_Plant_Associations', uidt: 'LongText' },
    ],
  },
  {
    title: 'Nutritional_Info',
    columns: [
      { title: 'Nutrient_Name', uidt: 'SingleLineText', pv: true },
      { title: 'Plant_Id',     uidt: 'SingleLineText' },
      { title: 'Value',        uidt: 'SingleLineText' },
      { title: 'Unit',         uidt: 'SingleLineText' },
      { title: 'Per_Serving',  uidt: 'SingleLineText' },
      { title: 'Source',       uidt: 'SingleLineText' },
    ],
  },
  {
    title: 'Growing_Notes',
    columns: [
      { title: 'Plant_Id',      uidt: 'SingleLineText', pv: true },
      { title: 'Geography_Id',  uidt: 'SingleLineText' },
      { title: 'Climate_Zone',  uidt: 'SingleLineText' },
      { title: 'Soil_Type',     uidt: 'SingleLineText' },
      { title: 'Spacing',       uidt: 'SingleLineText' },
      { title: 'Irrigation',    uidt: 'SingleLineText' },
      { title: 'Notes',         uidt: 'LongText' },
      { title: 'Source',        uidt: 'SingleLineText' },
    ],
  },
  {
    title: 'Pests',
    columns: [
      { title: 'Common_Name',          uidt: 'SingleLineText', pv: true },
      { title: 'Scientific_Name',      uidt: 'SingleLineText' },
      { title: 'Description',          uidt: 'LongText' },
      { title: 'Signs_On_Plant',       uidt: 'LongText' },
      { title: 'Treatments',           uidt: 'LongText' },
      { title: 'Geographic_Locations', uidt: 'LongText' },
    ],
  },
  {
    title: 'Diseases',
    columns: [
      { title: 'Common_Name',          uidt: 'SingleLineText', pv: true },
      { title: 'Pathogen_Type',        uidt: 'SingleLineText' },
      { title: 'Description',          uidt: 'LongText' },
      { title: 'Symptoms',             uidt: 'LongText' },
      { title: 'Treatments',           uidt: 'LongText' },
      { title: 'Geographic_Locations', uidt: 'LongText' },
    ],
  },
  {
    title: 'FAQ',
    columns: [
      { title: 'Question', uidt: 'SingleLineText', pv: true },
      { title: 'Answer',   uidt: 'LongText' },
      { title: 'Plant_Id', uidt: 'SingleLineText' },
      { title: 'Source',   uidt: 'SingleLineText' },
    ],
  },
  {
    title: 'Tags',
    columns: [
      { title: 'Name',     uidt: 'SingleLineText', pv: true },
      { title: 'Category', uidt: 'SingleLineText' },
    ],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

async function createTable(tableDef) {
  const url = `${NOCODB_URL}/api/v2/meta/bases/${BASE_ID}/tables`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xc-token':     API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title:   tableDef.title,
      columns: tableDef.columns,
    }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    // 409 or duplicate-name error — treat as "already exists"
    const msg = body?.msg || body?.message || JSON.stringify(body);
    if (res.status === 409 || /already\s+exist|duplicate/i.test(msg)) {
      console.log(`  ⏭  Table "${tableDef.title}" already exists — skipping`);
      return { title: tableDef.title, id: null, skipped: true };
    }
    throw new Error(`Failed to create "${tableDef.title}" (${res.status}): ${msg}`);
  }

  const tableId = body.id;
  console.log(`  ✓  Created "${tableDef.title}" → ${tableId}`);
  return { title: tableDef.title, id: tableId, skipped: false };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`NocoDB schema generator`);
  console.log(`  URL:     ${NOCODB_URL}`);
  console.log(`  Base:    ${BASE_ID}`);
  console.log(`  Source:  ${SOURCE_ID}`);
  console.log(`  Tables:  ${TABLES.length}\n`);

  const tableMap = {};
  let created = 0;
  let skipped = 0;
  let failed  = 0;

  for (const tableDef of TABLES) {
    try {
      const result = await createTable(tableDef);
      if (result.skipped) {
        skipped++;
      } else {
        tableMap[result.title] = result.id;
        created++;
      }
    } catch (err) {
      console.error(`  ✗  ${err.message}`);
      failed++;
    }
  }

  // Save the mapping file
  await writeFile(OUTPUT_PATH, JSON.stringify(tableMap, null, 2), 'utf-8');
  console.log(`\nDone: ${created} created, ${skipped} skipped, ${failed} failed`);
  console.log(`Table ID mapping saved to: ${OUTPUT_PATH}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
