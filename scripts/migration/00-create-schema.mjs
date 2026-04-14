/**
 * 00-create-schema.mjs
 *
 * Creates all tables and columns in the new "HTFG Fruit v2" NocoDB base.
 * Safe to re-run — skips tables that already exist.
 *
 * New base ID: pez3lthxrtg5yu0
 *
 * Schema changes vs v1:
 *   - Images:         + Content_Hash (MD5, dedup key)
 *   - BinaryDocuments:+ Content_Hash (MD5, dedup key)
 *                     + Original_Filepath renamed from Original_File_Path (consistency)
 *   - Attachments:    + Content_Hash, + Original_Filepath, + Plant_Id (single slug)
 *
 * Run: node scripts/migration/00-create-schema.mjs
 */

import dotenv from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
dotenv.config({ path: 'review-ui/.env' });

const URL  = 'https://nocodb.djjd.us';
const KEY  = process.env.NOCODB_API_KEY;
const H    = { 'xc-token': KEY, 'Content-Type': 'application/json' };
const BASE = 'pez3lthxrtg5yu0';

async function api(method, path_, body) {
  const r = await fetch(`${URL}${path_}`, {
    method, headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`${method} ${path_} → ${r.status}: ${txt.slice(0, 300)}`);
  }
  return r.json();
}

// ── Column type helpers ────────────────────────────────────────────────────────

const text   = (title, opts = {}) => ({ title, uidt: 'SingleLineText', ...opts });
const long   = (title, opts = {}) => ({ title, uidt: 'LongText',       ...opts });
const num    = (title, opts = {}) => ({ title, uidt: 'Number',          ...opts });
const check  = (title, opts = {}) => ({ title, uidt: 'Checkbox',        ...opts });

// ── Table definitions ──────────────────────────────────────────────────────────

const TABLES = [
  {
    name: 'Plants',
    columns: [
      text('Plant_Id'),            // slug — primary identifier
      text('Canonical_Name'),
      text('Botanical_Name'),
      text('Family'),
      text('Category'),
      long('Aliases'),
      long('Description'),
      long('Harvest_Months'),
      long('Tasting_Notes'),
      check('At_Kona_Station'),
      num ('Source_Count'),
      num ('Image_Count'),
      long('Alternative_Names'),
      text('Origin'),
      text('Flower_Colors'),
      text('Elevation_Range'),
      long('Distribution'),
      text('Culinary_Regions'),
      long('Primary_Use'),
      text('Total_Varieties'),
      long('Classification_Methods'),
      long('Parent_Species'),
      long('Chromosome_Groups'),
      long('Genetic_Contribution'),
      text('Hero_Image_Path'),
      num ('Hero_Image_Rotation'),
    ],
  },
  {
    name: 'Varieties',
    columns: [
      text('Variety_Name'),
      text('Plant_Id'),
      long('Characteristics'),
      long('Tasting_Notes'),
      text('Source'),
      text('Genome_Group'),
      long('Description'),
      text('Alternative_Names'),
    ],
  },
  {
    name: 'Images',
    columns: [
      text('File_Path'),           // canonical path in pass_02
      text('Original_Filepath'),   // path in content/source/original/
      text('Content_Hash'),        // MD5 of file — dedup key ★ NEW
      text('Plant_Id'),
      num ('Variety_Id'),          // FK → Varieties.Id (NocoDB row Id)
      text('Status'),              // assigned | hidden | triage
      check('Excluded'),
      check('Needs_Review'),
      text('Caption'),
      text('Attribution'),
      text('License'),
      text('Source_Directory'),
      num ('Size_Bytes'),
      num ('Rotation'),
      text('Perceptual_Hash'),     // dHash 64-bit hex
      text('Confidence'),
    ],
  },
  {
    name: 'Attachments',
    columns: [
      text('File_Path'),           // canonical path in pass_02
      text('Original_Filepath'),   // path in content/source/original/ ★ NEW
      text('Content_Hash'),        // MD5 of file — dedup key ★ NEW
      text('Plant_Id'),            // primary plant slug ★ NEW (was only Plant_Ids array)
      long('Plant_Ids'),           // JSON array for multi-plant items
      text('Title'),
      text('File_Name'),
      text('File_Type'),
      num ('File_Size'),
      long('Description'),
      text('Status'),              // assigned | hidden | triage ★ NEW (align with Images)
    ],
  },
  {
    name: 'BinaryDocuments',
    columns: [
      text('File_Path'),           // canonical path in pass_02
      text('Original_Filepath'),   // ★ standardized from Original_File_Path
      text('Content_Hash'),        // MD5 of file — dedup key ★ NEW
      text('Plant_Id'),
      num ('Variety_Id'),
      text('Title'),
      text('File_Name'),
      text('File_Type'),
      num ('Size_Bytes'),
      text('Status'),              // assigned | hidden | triage
      check('Excluded'),
      text('Thumbnail_Path'),
      long('Description'),
      text('Attribution'),
    ],
  },
  {
    name: 'Documents',
    columns: [
      text('Title'),
      text('Doc_Type'),
      long('Content_Text'),
      long('Content_Preview'),
      long('Plant_Ids'),
      text('Original_File_Path'),
      check('Is_Plant_Related'),
    ],
  },
  {
    name: 'Recipes',
    columns: [
      text('Title'),
      long('Ingredients'),
      long('Method'),
      long('Plant_Ids'),
      text('Source_File'),
      check('Needs_Review'),
    ],
  },
  {
    name: 'OCR_Extractions',
    columns: [
      text('Title'),
      text('Image_Path'),
      text('Content_Type'),
      long('Extracted_Text'),
      long('Plant_Ids'),
      long('Key_Facts'),
      text('Source_Context'),
      long('Raw_Plant_Associations'),
    ],
  },
  {
    name: 'Nutritional_Info',
    columns: [
      text('Nutrient_Name'),
      text('Plant_Id'),
      text('Value'),
      text('Unit'),
      text('Per_Serving'),
      text('Source'),
    ],
  },
  {
    name: 'Growing_Notes',
    columns: [
      text('Plant_Id'),
      text('Geography_Id'),
      text('Climate_Zone'),
      text('Soil_Type'),
      text('Spacing'),
      text('Irrigation'),
      long('Notes'),
      text('Source'),
    ],
  },
  {
    name: 'Pests',
    columns: [
      text('Common_Name'),
      text('Scientific_Name'),
      long('Description'),
      long('Signs_On_Plant'),
      long('Treatments'),
      long('Geographic_Locations'),
    ],
  },
  {
    name: 'Diseases',
    columns: [
      text('Common_Name'),
      text('Pathogen_Type'),
      long('Description'),
      long('Symptoms'),
      long('Treatments'),
      long('Geographic_Locations'),
    ],
  },
  {
    name: 'FAQ',
    columns: [
      text('Question'),
      long('Answer'),
      text('Plant_Id'),
      text('Source'),
    ],
  },
  {
    name: 'Tags',
    columns: [
      text('Name'),
      text('Category'),
    ],
  },
  {
    name: 'Geographies',
    columns: [
      text('Geography_Id'),
      text('Island'),
      text('District'),
      text('Moku'),
      text('Subregion'),
      text('Elevation_Zone'),
      text('Rainfall_Zone'),
      long('Notes'),
    ],
  },
];

// ── Main ───────────────────────────────────────────────────────────────────────

// Get existing tables in new base
const existing = await api('GET', `/api/v2/meta/bases/${BASE}/tables`);
const existingNames = new Set((existing.list ?? []).map(t => t.title));
console.log(`Existing tables in v2 base: ${[...existingNames].join(', ') || '(none except default)'}`);

const tableIds = {};

// Delete the default "HTFG Fruit v2" table NocoDB created if it only has Title column
const defaultTable = (existing.list ?? []).find(t => t.title === 'HTFG Fruit v2');
if (defaultTable) {
  console.log(`Removing default placeholder table "${defaultTable.title}"…`);
  await api('DELETE', `/api/v2/meta/tables/${defaultTable.id}`);
  existingNames.delete('HTFG Fruit v2');
}

for (const table of TABLES) {
  if (existingNames.has(table.name)) {
    console.log(`  SKIP  ${table.name} (already exists)`);
    // Fetch its ID
    const t = (existing.list ?? []).find(t => t.title === table.name);
    if (t) tableIds[table.name] = t.id;
    continue;
  }

  process.stdout.write(`  CREATE ${table.name}… `);
  const created = await api('POST', `/api/v2/meta/bases/${BASE}/tables`, {
    title: table.name,
    columns: table.columns,
  });
  tableIds[table.name] = created.id;
  console.log(`✓ (${created.id})`);
}

// Save table IDs
mkdirSync('content/migration', { recursive: true });
const tableIdsPath = 'content/migration/nocodb-v2-table-ids.json';
writeFileSync(tableIdsPath, JSON.stringify({ base_id: BASE, ...tableIds }, null, 2));
console.log(`\nTable IDs saved → ${tableIdsPath}`);
console.log('\nSchema complete. Verify in NocoDB UI before proceeding to Phase 1.');
