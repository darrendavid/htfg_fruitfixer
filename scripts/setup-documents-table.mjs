/**
 * Setup NocoDB Documents table for binary non-image files.
 *
 * What this script does:
 *  1. Creates a new "Documents" table with proper schema (Status, Plant_Id, Variety_Id,
 *     Excluded, Thumbnail_Path — mirrors Images table semantics)
 *  2. Renames the old text-content "Documents" table to "Articles" in table_ids.json
 *  3. Migrates all existing Attachments records → new Documents table
 *     (both binary files AND image-type files — per decision: signs/posters are Documents)
 *  4. Updates nocodb_table_ids.json with new table IDs
 *
 * Run ONCE: node scripts/setup-documents-table.mjs
 * Idempotent: checks if table already exists before creating.
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { config } from 'dotenv';

config({ path: path.join(import.meta.dirname, '..', 'review-ui', '.env') });

const ROOT         = path.resolve(import.meta.dirname, '..');
const IDS_FILE     = path.join(ROOT, 'content', 'parsed', 'nocodb_table_ids.json');
const NOCODB_URL   = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY   = process.env.NOCODB_API_KEY;
const BASE_ID      = 'pimorqbta2ve966';

if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const h = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };

const IDS = JSON.parse(readFileSync(IDS_FILE, 'utf-8'));

// ── API helpers ────────────────────────────────────────────────────────────────
async function api(method, url, body) {
  const r = await fetch(`${NOCODB_URL}${url}`, {
    method, headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${method} ${url} → ${r.status}: ${text}`);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('application/json') ? r.json() : r.text();
}

async function fetchAll(tableId, fields = null) {
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({ limit: '1000', offset: String(offset) });
    if (fields) params.set('fields', fields);
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${tableId}/records?${params}`, { headers: h });
    const d = await r.json();
    all.push(...(d.list ?? []));
    if (d.pageInfo?.isLastPage || d.list?.length < 1000) break;
    offset += 1000;
  }
  return all;
}

// ── Step 1: Check if Documents table already exists ───────────────────────────
console.log('Checking existing tables...');
const tablesResp = await api('GET', `/api/v1/db/meta/projects/${BASE_ID}/tables?limit=50`);
const existingTables = tablesResp.list || [];

const existingDocuments = existingTables.find(t => t.title === 'Documents');
const existingArticles  = existingTables.find(t => t.title === 'Articles');
const existingAttachments = existingTables.find(t => t.title === 'Attachments');

console.log('Existing tables:', existingTables.map(t => `${t.title}(${t.id})`).join(', '));

// ── Step 2: Create Articles alias for old Documents table ──────────────────────
// The old "Documents" table contains HTML article text (from Phase 3 extraction)
// We keep it but access it under the "Articles" key in table_ids.json
if (!existingArticles && IDS.Documents) {
  console.log('\nAdding Articles alias for old Documents table (text content)...');
  IDS.Articles = IDS.Documents;
  console.log(`  Articles → ${IDS.Articles} (old Documents/articles table)`);
} else if (existingArticles) {
  console.log('\nArticles table already exists in NocoDB, updating IDs file...');
  IDS.Articles = existingArticles.id;
}

// ── Step 3: Create new Documents table (binary files) ─────────────────────────
let documentsTableId = IDS.BinaryDocuments || IDS.DocumentFiles;

// Check if we already ran this script (Documents table might already be the new one)
const newDocsTable = existingTables.find(t => t.title === 'BinaryDocuments');
if (newDocsTable) {
  console.log(`\nBinaryDocuments table already exists: ${newDocsTable.id}`);
  documentsTableId = newDocsTable.id;
} else {
  console.log('\nCreating BinaryDocuments table...');
  const created = await api('POST', `/api/v1/db/meta/projects/${BASE_ID}/tables`, {
    title: 'BinaryDocuments',
    table_name: 'binary_documents',
    columns: [
      { title: 'Title',             uidt: 'SingleLineText' },
      { title: 'File_Path',         uidt: 'SingleLineText' },
      { title: 'File_Name',         uidt: 'SingleLineText' },
      { title: 'File_Type',         uidt: 'SingleLineText' },  // pdf, ppt, doc, jpg, psd, etc.
      { title: 'Size_Bytes',        uidt: 'Number' },
      { title: 'Plant_Id',          uidt: 'SingleLineText' },  // nullable — single plant slug
      { title: 'Variety_Id',        uidt: 'Number' },          // nullable FK to Varieties
      { title: 'Status',            uidt: 'SingleLineText' },  // assigned | triage | hidden
      { title: 'Excluded',          uidt: 'Checkbox' },
      { title: 'Thumbnail_Path',    uidt: 'SingleLineText' },  // path to thumb jpg (PDF only)
      { title: 'Description',       uidt: 'LongText' },
      { title: 'Original_File_Path',uidt: 'SingleLineText' },  // provenance from source/
      { title: 'Attribution',       uidt: 'SingleLineText' },
    ],
  });
  documentsTableId = created.id;
  console.log(`  Created BinaryDocuments table: ${documentsTableId}`);
}

IDS.BinaryDocuments = documentsTableId;

// Save IDs now (before migration, in case it fails)
writeFileSync(IDS_FILE, JSON.stringify(IDS, null, 2));
console.log('\nUpdated nocodb_table_ids.json with Articles + BinaryDocuments IDs');

// ── Step 4: Migrate Attachments → BinaryDocuments ─────────────────────────────
console.log('\nFetching all Attachments records...');
const attTableId = IDS.Attachments;
const attachments = await fetchAll(attTableId);
console.log(`  ${attachments.length} Attachment records to migrate`);

// Check how many are already migrated
const existingDocs = await fetchAll(documentsTableId, 'Id,Original_File_Path,File_Path');
const migratedPaths = new Set(existingDocs.map(d => d.Original_File_Path || d.File_Path).filter(Boolean));
console.log(`  ${migratedPaths.size} already migrated`);

let migrated = 0, skipped = 0, failed = 0;

for (const att of attachments) {
  // Check if already migrated by File_Path
  const fpKey = att.File_Path || '';
  if (migratedPaths.has(fpKey)) { skipped++; continue; }

  // Determine file type from extension
  const ext = (att.File_Path || att.File_Name || '').split('.').pop()?.toLowerCase() || '';

  // Parse Plant_Ids JSON array → single Plant_Id (take first)
  let plantId = null;
  try {
    const ids = JSON.parse(att.Plant_Ids || '[]');
    plantId = ids[0] || null;
  } catch { /* ignore */ }

  // Status: treat existing attachments as 'assigned' if they have a plant, else 'triage'
  const status = plantId ? 'assigned' : 'triage';

  try {
    await fetch(`${NOCODB_URL}/api/v2/tables/${documentsTableId}/records`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        Title: att.Title || att.File_Name || att.File_Path?.split('/').pop() || `doc_${att.Id}`,
        File_Path: att.File_Path || null,
        File_Name: att.File_Name || att.File_Path?.split('/').pop() || null,
        File_Type: ext,
        Size_Bytes: att.File_Size || null,
        Plant_Id: plantId,
        Status: status,
        Excluded: status === 'hidden',
        Description: att.Description || null,
        Original_File_Path: att.File_Path || null,
      }),
    });
    migrated++;
    if (migrated % 50 === 0) console.log(`  Migrated ${migrated}/${attachments.length}...`);
  } catch (err) {
    console.error(`  FAILED att ${att.Id}: ${err.message}`);
    failed++;
  }
}

console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped, ${failed} failed`);

// ── Step 5: Final ID summary ───────────────────────────────────────────────────
console.log('\n── Final nocodb_table_ids.json ──');
console.log(`  Articles (old text Documents): ${IDS.Articles}`);
console.log(`  BinaryDocuments (new binary):  ${IDS.BinaryDocuments}`);
console.log(`  Attachments (legacy):          ${IDS.Attachments}`);
console.log(`  Documents (kept as articles):  ${IDS.Documents}`);

console.log('\nDone. Next steps:');
console.log('  1. Update review-ui code to use "BinaryDocuments" for binary files');
console.log('  2. Run: node scripts/migrate-to-pass02.mjs');
