/**
 * Accept all outstanding Attachment OCR fields and migrate to NocoDB.
 *
 * For every successful OCR record:
 *   1. Mark all fields as 'accepted' in SQLite attachment_ocr_decisions
 *   2. If the plant's Botanical_Name is null/empty → write OCR scientific_name
 *   3. If the plant's Description is null/empty → write OCR description
 *
 * Safe to re-run — skips already-decided fields and only fills empty NocoDB fields.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require(path.join(import.meta.dirname, '..', 'review-ui', 'node_modules', 'better-sqlite3'));

config({ path: path.join(import.meta.dirname, '..', 'review-ui', '.env') });

const ROOT = path.resolve(import.meta.dirname, '..');
const OCR_FILE = path.join(ROOT, 'content', 'parsed', 'attachment_ocr_results.json');
const TABLE_IDS = JSON.parse(readFileSync(path.join(ROOT, 'content', 'parsed', 'nocodb_table_ids.json'), 'utf-8'));

// ── NocoDB client ─────────────────────────────────────────────────────────────
const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
const BASE_ID    = 'pimorqbta2ve966';

if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

async function nocoGet(table, params = {}) {
  const tableId = TABLE_IDS[table];
  const qs = new URLSearchParams(params).toString();
  const url = `${NOCODB_URL}/api/v2/tables/${tableId}/records?${qs}`;
  const res = await fetch(url, { headers: { 'xc-token': NOCODB_KEY } });
  if (!res.ok) throw new Error(`GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function nocoUpdate(table, id, data) {
  const tableId = TABLE_IDS[table];
  const url = `${NOCODB_URL}/api/v2/tables/${tableId}/records`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Id: id, ...data }),
  });
  if (!res.ok) throw new Error(`PATCH ${table} ${id}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── SQLite ────────────────────────────────────────────────────────────────────
const DB_PATH = path.resolve(path.join(import.meta.dirname, '..', 'review-ui'), process.env.DB_PATH || './data/db/review.db');
const db = new Database(DB_PATH);

const insertDecision = db.prepare(
  'INSERT OR IGNORE INTO attachment_ocr_decisions (file_path, field_key, action) VALUES (?, ?, ?)'
);
const markMany = db.transaction((filePath, keys) => {
  for (const key of keys) insertDecision.run(filePath, key, 'accepted');
});

const getDecision = db.prepare(
  'SELECT action FROM attachment_ocr_decisions WHERE file_path = ? AND field_key = ?'
);

function isDecided(filePath, fieldKey) {
  return !!getDecision.get(filePath, fieldKey);
}

// ── Load OCR results ──────────────────────────────────────────────────────────
const results = JSON.parse(readFileSync(OCR_FILE, 'utf-8'));
const successful = results.filter(r => !r.error && r.extraction);
console.log(`Processing ${successful.length} OCR records across ${new Set(successful.map(r => r.plant_id)).size} plants\n`);

// ── Plant cache ───────────────────────────────────────────────────────────────
const plantCache = new Map();
async function fetchPlant(plantId) {
  if (plantCache.has(plantId)) return plantCache.get(plantId);
  const data = await nocoGet('Plants', {
    where: `(Id1,eq,${plantId})`,
    limit: 1,
  });
  const plant = data.list?.[0] ?? null;
  plantCache.set(plantId, plant);
  return plant;
}

// ── Process each record ───────────────────────────────────────────────────────
let totalAccepted = 0;
let sciUpdated = 0, descUpdated = 0;
let sciSkipped = 0, descSkipped = 0;

for (const r of successful) {
  const e = r.extraction;
  const fp = r.file_path;

  // Collect all field keys for this record
  const allKeys = [
    e.scientific_name  && 'scientific_name',
    e.description      && 'description',
    e.origin           && 'origin',
    ...(e.nutrition  || []).map(n => `nutrition:${n.nutrient}`),
    ...(e.varieties  || []).map(v => `variety:${v.name}`),
    ...(e.key_facts  || []).map(f => `fact:${f.field}`),
  ].filter(Boolean);

  // Mark all as accepted in SQLite (INSERT OR IGNORE — won't overwrite existing decisions)
  const newKeys = allKeys.filter(k => !isDecided(fp, k));
  if (newKeys.length > 0) {
    markMany(fp, newKeys);
    totalAccepted += newKeys.length;
  }

  // Migrate scientific_name and description to NocoDB if plant fields are empty
  if (!e.scientific_name && !e.description) continue;

  let plant;
  try {
    plant = await fetchPlant(r.plant_id);
  } catch (err) {
    console.warn(`  [${r.plant_id}] Could not fetch plant: ${err.message}`);
    continue;
  }
  if (!plant) {
    console.warn(`  [${r.plant_id}] Plant not found in NocoDB`);
    continue;
  }

  const updates = {};

  if (e.scientific_name) {
    if (!plant.Botanical_Name || plant.Botanical_Name.trim() === '') {
      updates.Botanical_Name = e.scientific_name;
      sciUpdated++;
    } else {
      sciSkipped++;
    }
  }

  if (e.description) {
    if (!plant.Description || plant.Description.trim() === '') {
      updates.Description = e.description;
      descUpdated++;
    } else {
      descSkipped++;
    }
  }

  if (Object.keys(updates).length > 0) {
    try {
      await nocoUpdate('Plants', plant.Id, updates);
      // Invalidate cache so subsequent records for same plant see updated values
      plantCache.delete(r.plant_id);
      const fields = Object.keys(updates).join(', ');
      console.log(`  [${r.plant_id}] Updated: ${fields}`);
    } catch (err) {
      console.warn(`  [${r.plant_id}] Update failed: ${err.message}`);
    }
  }
}

console.log(`
=== Done ===
SQLite decisions marked accepted: ${totalAccepted}
NocoDB Botanical_Name written:   ${sciUpdated}  (${sciSkipped} already had a value)
NocoDB Description written:       ${descUpdated}  (${descSkipped} already had a value)
`);
