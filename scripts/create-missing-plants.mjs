#!/usr/bin/env node
/**
 * Create 15 missing plants in NocoDB Plants table.
 * Slug (Id1) is auto-derived from Canonical_Name.
 *
 * Usage:
 *   node scripts/create-missing-plants.mjs --dry-run
 *   node scripts/create-missing-plants.mjs
 */

import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
for (const line of readFileSync(path.join(ROOT, 'review-ui', '.env'), 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const DRY_RUN = process.argv.includes('--dry-run');
const API_KEY = process.env.NOCODB_API_KEY;
const BASE_URL = 'https://nocodb.djjd.us';
const TABLE_IDS = JSON.parse(readFileSync(path.join(ROOT, 'content/parsed/nocodb_table_ids.json'), 'utf-8'));
const PLANTS_TABLE = TABLE_IDS['Plants'];

if (!API_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }
if (DRY_RUN) console.log('[DRY RUN]\n');

// Canonical names in Title Case → slug auto-derived by same logic as create-plant route:
// Canonical_Name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const NEW_PLANTS = [
  'Achacha',
  'Button Mangosteen',
  'Canistel',
  'Chuo Ume Plum',
  'Jiringa',
  'Jujube',
  'Lemon Drop Mangosteen',
  'Mamoncillo',
  'Naranjilla',
  'Peanut Butter Fruit',
  'Pepino',
  'Pulasan',
  'Snake Fruit',
  'Wax Jambu',
  'Yuzu',
];

function toSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function getExistingSlugs() {
  const all = [];
  let offset = 0;
  while (true) {
    const qs = new URLSearchParams({ limit: '500', offset: String(offset), fields: 'Id1' });
    const res = await fetch(`${BASE_URL}/api/v2/tables/${PLANTS_TABLE}/records?${qs}`, {
      headers: { 'xc-token': API_KEY },
    });
    const d = await res.json();
    all.push(...d.list.map(p => p.Id1));
    if (d.pageInfo?.isLastPage) break;
    offset += d.list.length;
  }
  return new Set(all);
}

async function createPlant(canonical, slug) {
  const res = await fetch(`${BASE_URL}/api/v2/tables/${PLANTS_TABLE}/records`, {
    method: 'POST',
    headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Id1: slug, Canonical_Name: canonical }),
  });
  if (!res.ok) throw new Error(`Create failed for "${canonical}": ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log('Checking existing plant slugs...');
  const existing = await getExistingSlugs();
  console.log(`${existing.size} plants already in DB\n`);

  let created = 0, skipped = 0;

  for (const name of NEW_PLANTS) {
    const slug = toSlug(name);
    if (existing.has(slug)) {
      console.log(`  SKIP  ${slug} — already exists`);
      skipped++;
      continue;
    }
    console.log(`  CREATE  ${slug}  (${name})`);
    if (!DRY_RUN) {
      const rec = await createPlant(name, slug);
      console.log(`          → id=${rec.Id}`);
    }
    created++;
  }

  console.log(`\nCreated: ${created}  Skipped: ${skipped}`);
  if (DRY_RUN) console.log('[DRY RUN] Re-run without --dry-run to apply.');
}

main().catch(e => { console.error(e); process.exit(1); });
