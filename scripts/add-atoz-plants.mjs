#!/usr/bin/env node
/**
 * add-atoz-plants.mjs
 *
 * Reads atoz_slide_text.json, identifies fruits not in NocoDB Plants,
 * and adds them as new plant records.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const SLIDE_TEXT = join(ROOT, 'content', 'parsed', 'atoz_slide_text.json');
const TABLE_IDS_FILE = join(ROOT, 'content', 'parsed', 'nocodb_table_ids.json');

// Load env
try {
  const env = readFileSync(join(ROOT, 'review-ui', '.env'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const API_KEY = process.env.NOCODB_API_KEY;
const NOCODB  = 'https://nocodb.djjd.us';
const TABLE_IDS = JSON.parse(readFileSync(TABLE_IDS_FILE, 'utf-8'));
const PLANTS_TABLE = TABLE_IDS['Plants'];

async function nocoGet(path) {
  const r = await fetch(`${NOCODB}${path}`, { headers: { 'xc-token': API_KEY } });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}
async function nocoPost(path, body) {
  const r = await fetch(`${NOCODB}${path}`, {
    method: 'POST',
    headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`POST ${path} → ${r.status}: ${t}`); }
  return r.json();
}

// Fetch all existing plants
async function fetchAllPlants() {
  const all = [];
  let offset = 0;
  while (true) {
    const d = await nocoGet(`/api/v2/tables/${PLANTS_TABLE}/records?limit=200&offset=${offset}&fields=Id1,Canonical_Name,Botanical_Name`);
    all.push(...d.list);
    if (d.pageInfo.isLastPage) break;
    offset += 200;
  }
  return all;
}

function slugify(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── Slide-by-slide fruit candidates ──────────────────────────────────────────
// Each slide has a primary fruit name (first meaningful text), botanical name, and aliases
const SLIDE_FRUITS = [
  { slide: 2,  name: 'Alupag',              botanical: 'Litchi chinensis subsp. philippinensis', aliases: ['Philippine Lychee'] },
  { slide: 3,  name: 'Loquat',              botanical: 'Eriobotrya japonica',                    aliases: ['Biwa'] },
  { slide: 4,  name: 'Bilimbi',             botanical: 'Averrhoa bilimbi',                        aliases: [] },
  { slide: 4,  name: "Buddha's Hand",       botanical: 'Citrus medica var. sarcodactylus',        aliases: ['Fingered Citron'] },
  { slide: 5,  name: 'Ceylon Gooseberry',   botanical: 'Dovyalis hebecarpa',                      aliases: ['Ketembilla'] },
  { slide: 6,  name: 'Cowa',               botanical: 'Garcinia cowa',                           aliases: [] },
  { slide: 7,  name: 'Durian',             botanical: 'Durio zibethinus',                        aliases: [] },
  { slide: 8,  name: 'Eggfruit',           botanical: 'Pouteria campechiana',                    aliases: ['Canistel'] },
  { slide: 9,  name: 'Finger Lime',        botanical: 'Citrus australasica',                     aliases: ['Caviar Lime'] },
  { slide: 10, name: 'Green Sapote',        botanical: 'Pouteria viride',                         aliases: [] },
  { slide: 11, name: 'Grumichama',          botanical: 'Eugenia brasiliensis',                    aliases: [] },
  { slide: 12, name: 'Persimmon',           botanical: 'Diospyros kaki',                          aliases: ['Hachiya', 'Lama', 'Diospyros sandwicensis'] },
  { slide: 14, name: 'Ice Cream Bean',      botanical: 'Inga edulis',                             aliases: ['Pacay'] },
  { slide: 16, name: 'Kokum',              botanical: 'Garcinia indica',                         aliases: [] },
  { slide: 17, name: 'Lulo',              botanical: 'Solanum quitoense',                       aliases: ['Naranjilla'] },
  { slide: 18, name: 'Midyim Berry',       botanical: 'Austromyrtus dulcis',                    aliases: ['Midgen Berry'] },
  { slide: 20, name: 'Ohelo',             botanical: 'Vaccinium reticulatum',                   aliases: [] },
  { slide: 21, name: 'Ooray',             botanical: 'Davidsonia pruriens',                     aliases: ['Davidson Plum'] },
  { slide: 22, name: 'Pulasan',           botanical: 'Nephelium mutabile',                      aliases: [] },
  { slide: 23, name: 'Quenepa',           botanical: 'Melicoccus bijugatus',                    aliases: ['Mamoncillo', 'Spanish Lime'] },
  { slide: 24, name: 'Rollinia',          botanical: 'Rollinia mucosa',                         aliases: ['Biriba'] },
  { slide: 27, name: 'Tropical Apricot',   botanical: 'Dovyalis abyssinica x ketembilla',        aliases: [] },
  { slide: 28, name: 'Ume',              botanical: 'Prunus mume',                             aliases: ['Japanese Apricot', 'Japanese Plum'] },
  { slide: 29, name: 'Voavanga',          botanical: 'Vangueria madagascariensis',              aliases: ['Voavonga', 'Spanish Tamarind'] },
  { slide: 30, name: 'Wampi',            botanical: 'Clausena lansium',                        aliases: [] },
  { slide: 31, name: 'Water Apple',       botanical: 'Syzygium aqueum',                         aliases: ['Watery Rose Apple'] },
  { slide: 33, name: 'Yuzu',             botanical: 'Citrus junos',                            aliases: [] },
  { slide: 34, name: 'Jujube',           botanical: 'Ziziphus mauritiana',                     aliases: ['Ziziphus', 'Indian Jujube'] },
];

async function main() {
  console.log('Fetching existing plants from NocoDB...');
  const existing = await fetchAllPlants();
  console.log(`  ${existing.length} plants in database`);

  // Build lookup sets — by normalized canonical name, botanical name, and slug
  const existingNames = new Set(existing.map(p => normalize(p.Canonical_Name || '')));
  const existingBotanical = new Set(existing.map(p => normalize(p.Botanical_Name || '')).filter(Boolean));
  const existingSlugs = new Set(existing.map(p => (p.Id1 || '').toLowerCase()));

  const toAdd = [];
  const alreadyPresent = [];

  for (const fruit of SLIDE_FRUITS) {
    const normName = normalize(fruit.name);
    const normBot  = normalize(fruit.botanical || '');
    const slug     = slugify(fruit.name);

    // Check slug both ways: generated slug AND existing Id1 values
    if (existingNames.has(normName) || existingSlugs.has(slug) || existingSlugs.has(normalize(slug)) || (normBot && existingBotanical.has(normBot))) {
      alreadyPresent.push(fruit.name);
    } else {
      toAdd.push(fruit);
    }
  }

  console.log(`\nAlready in DB (${alreadyPresent.length}): ${alreadyPresent.join(', ')}`);
  console.log(`\nNew plants to add (${toAdd.length}):`);
  for (const f of toAdd) console.log(`  [slide ${f.slide}] ${f.name} — ${f.botanical}`);

  if (toAdd.length === 0) {
    console.log('\nNothing to add.');
    return;
  }

  console.log('\nAdding new plants...');
  for (const f of toAdd) {
    const slug = slugify(f.name);
    const record = {
      Id1: slug,
      Canonical_Name: f.name,
      Botanical_Name: f.botanical || null,
      Category: 'Tropical Fruit',
      Source: 'atoz-2020-pptx',
    };
    if (f.aliases?.length) record.Aliases = JSON.stringify(f.aliases);
    try {
      await nocoPost(`/api/v2/tables/${PLANTS_TABLE}/records`, record);
      console.log(`  ✓ Added: ${f.name} (${slug})`);
    } catch (err) {
      console.error(`  ✗ Failed: ${f.name} — ${err.message}`);
    }
  }

  console.log('\nDone.');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
