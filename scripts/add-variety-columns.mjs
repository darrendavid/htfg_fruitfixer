#!/usr/bin/env node
/**
 * Add Description (LongText) and Alternative_Names (SingleLineText) columns
 * to the Varieties table in NocoDB.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');

// Load env from review-ui/.env
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

const TABLE_IDS = JSON.parse(readFileSync(join(ROOT, 'content/parsed/nocodb_table_ids.json'), 'utf-8'));
const NOCODB_BASE = 'https://nocodb.djjd.us';
const VARIETIES_TABLE_ID = TABLE_IDS.Varieties;

if (!VARIETIES_TABLE_ID) {
  console.error('ERROR: Varieties table ID not found in nocodb_table_ids.json');
  process.exit(1);
}

async function createColumn(title, uidt) {
  const url = `${NOCODB_BASE}/api/v2/meta/tables/${VARIETIES_TABLE_ID}/columns`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xc-token': NOCODB_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, column_name: title, uidt }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create ${title}: ${res.status} ${body}`);
  }
  console.log(`  ✓ Created column "${title}" (${uidt})`);
}

async function main() {
  // Check existing columns first
  const listUrl = `${NOCODB_BASE}/api/v2/meta/tables/${VARIETIES_TABLE_ID}`;
  const listRes = await fetch(listUrl, { headers: { 'xc-token': NOCODB_API_KEY } });
  if (!listRes.ok) throw new Error(`Failed to read Varieties table meta: ${listRes.status}`);
  const meta = await listRes.json();
  const existing = new Set((meta.columns || []).map(c => c.title));

  console.log(`Varieties table has ${existing.size} columns.`);

  const toAdd = [
    { title: 'Description', uidt: 'LongText' },
    { title: 'Alternative_Names', uidt: 'SingleLineText' },
  ];

  for (const col of toAdd) {
    if (existing.has(col.title)) {
      console.log(`  ~ Column "${col.title}" already exists, skipping`);
    } else {
      await createColumn(col.title, col.uidt);
    }
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
