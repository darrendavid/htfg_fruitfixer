#!/usr/bin/env node
/**
 * Resolve cross-plant duplicate decisions from cross-plant-decisions.json.
 *
 * For each duplicate group, deletes filesystem files and NocoDB records for
 * the "loser" plant. Handles variety assignments and hiding for special cases.
 *
 * Usage:
 *   node scripts/resolve-cross-plant-dupes.mjs --dry-run
 *   node scripts/resolve-cross-plant-dupes.mjs
 */

import { readFileSync, existsSync, unlinkSync, mkdirSync, renameSync } from 'fs';
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
const IMAGES_TABLE = TABLE_IDS['Images'];
const VARIETIES_TABLE = TABLE_IDS['Varieties'];

if (!API_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }
if (DRY_RUN) console.log('[DRY RUN] No changes will be made.\n');

const PASS01_DIR = path.join(ROOT, 'content', 'pass_01');
const HIDDEN_DIR = path.join(PASS01_DIR, 'hidden');

// ── Load input data ───────────────────────────────────────────────────────────

const DECISIONS = JSON.parse(readFileSync(path.join(PASS01_DIR, 'cross-plant-decisions.json'), 'utf-8'));
const REPORT = JSON.parse(readFileSync(path.join(ROOT, 'content', 'pass01-duplicates-report.json'), 'utf-8'));

// Build hash → group map from report (assigned/ paths only)
const hashToGroup = new Map();
for (const g of REPORT.groups) {
  const assigned = g.paths.filter(p => p.startsWith('assigned/'));
  if (assigned.length > 0) hashToGroup.set(g.hash, assigned);
}

// ── NocoDB helpers ────────────────────────────────────────────────────────────

async function queryByFilePath(filePath) {
  // filePath in DB is like: content/pass_01/assigned/...
  const where = `(File_Path,eq,${filePath})`;
  const qs = new URLSearchParams({ where, fields: 'Id,File_Path,Plant_Id', limit: '10' });
  const res = await fetch(`${BASE_URL}/api/v2/tables/${IMAGES_TABLE}/records?${qs}`, {
    headers: { 'xc-token': API_KEY },
  });
  if (!res.ok) throw new Error(`Query failed ${res.status}: ${filePath}`);
  const d = await res.json();
  return d.list ?? [];
}

async function deleteRecord(id) {
  const res = await fetch(`${BASE_URL}/api/v2/tables/${IMAGES_TABLE}/records`, {
    method: 'DELETE',
    headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Id: id }),
  });
  if (!res.ok) throw new Error(`DELETE id=${id} failed: ${res.status}`);
}

async function patchRecord(id, fields) {
  const res = await fetch(`${BASE_URL}/api/v2/tables/${IMAGES_TABLE}/records`, {
    method: 'PATCH',
    headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Id: id, ...fields }),
  });
  if (!res.ok) throw new Error(`PATCH id=${id} failed: ${res.status}`);
}

async function lookupVarietyId(plantId, varietyName) {
  const where = `(Plant_Id,eq,${plantId})~and(Variety_Name,like,${varietyName}%)`;
  const qs = new URLSearchParams({ where, fields: 'Id,Variety_Name', limit: '5' });
  const res = await fetch(`${BASE_URL}/api/v2/tables/${VARIETIES_TABLE}/records?${qs}`, {
    headers: { 'xc-token': API_KEY },
  });
  if (!res.ok) throw new Error(`Variety query failed: ${res.status}`);
  const d = await res.json();
  return d.list?.[0] ?? null;
}

async function createVariety(plantId, varietyName) {
  const res = await fetch(`${BASE_URL}/api/v2/tables/${VARIETIES_TABLE}/records`, {
    method: 'POST',
    headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Plant_Id: plantId, Variety_Name: varietyName }),
  });
  if (!res.ok) throw new Error(`Create variety failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Core helpers ──────────────────────────────────────────────────────────────

function toDbPath(relFromPass01) {
  // relFromPass01: e.g. "assigned/banana/images/foo.jpg"
  return 'content/pass_01/' + relFromPass01;
}

function toAbsPath(relFromPass01) {
  return path.join(PASS01_DIR, relFromPass01.replace(/\//g, path.sep));
}

let totalDeleted = 0, totalDbDeleted = 0, totalPatched = 0, totalErrors = 0;

async function deleteFileAndRecord(relFromPass01, context) {
  const absPath = toAbsPath(relFromPass01);
  const dbPath = toDbPath(relFromPass01);

  // Delete from filesystem
  if (!DRY_RUN) {
    if (existsSync(absPath)) {
      try { unlinkSync(absPath); } catch (e) { console.warn(`  WARN unlink: ${e.message}`); totalErrors++; return; }
    } else {
      console.log(`  SKIP (not on disk): ${relFromPass01}`);
      return;
    }
  }
  totalDeleted++;

  // Find and delete DB record
  const records = await queryByFilePath(dbPath);
  if (records.length === 0) {
    if (DRY_RUN) console.log(`  [no DB record] ${relFromPass01}`);
    return;
  }
  for (const rec of records) {
    if (!DRY_RUN) await deleteRecord(rec.Id);
    totalDbDeleted++;
  }
}

async function hideFileAndRecord(relFromPass01) {
  const absPath = toAbsPath(relFromPass01);
  const dbPath = toDbPath(relFromPass01);
  const plant = relFromPass01.split('/')[1];
  const fname = path.basename(absPath);
  const destDir = path.join(HIDDEN_DIR, plant, 'images');
  const destAbs = path.join(destDir, fname);

  if (!DRY_RUN) {
    if (!existsSync(absPath)) { console.log(`  SKIP (not on disk): ${relFromPass01}`); return; }
    mkdirSync(destDir, { recursive: true });
    renameSync(absPath, destAbs);
  }
  totalDeleted++; // counting as "removed from assigned"

  // Delete DB record (file moved to hidden, no longer assigned to plant)
  const records = await queryByFilePath(dbPath);
  for (const rec of records) {
    if (!DRY_RUN) await deleteRecord(rec.Id);
    totalDbDeleted++;
  }
}

// ── Get cross-plant duplicate groups for a pair ───────────────────────────────

function getGroupsForPair(decision) {
  const [plantA, plantB] = decision.plants;
  const groups = [];
  for (const [hash, paths] of hashToGroup) {
    const a = paths.filter(p => p.split('/')[1] === plantA);
    const b = paths.filter(p => p.split('/')[1] === plantB);
    if (a.length > 0 && b.length > 0) {
      groups.push({ hash, a, b });
    }
  }
  return groups;
}

// ── Process each decision ─────────────────────────────────────────────────────

async function processDecision(decision) {
  const [plantA, plantB] = decision.plants;
  const groups = getGroupsForPair(decision);
  console.log(`\n── ${decision.pair} (${groups.length} groups, decision: ${decision.decision}) ──`);

  if (decision.decision === 'keep_a') {
    // Delete all plantB copies
    for (const g of groups) {
      for (const p of g.b) {
        if (DRY_RUN) console.log(`  DELETE ${p}`);
        else await deleteFileAndRecord(p);
      }
    }
    console.log(`  Removed ${groups.reduce((s, g) => s + g.b.length, 0)} files from ${plantB}`);

  } else if (decision.decision === 'keep_b') {
    // Delete all plantA copies
    for (const g of groups) {
      for (const p of g.a) {
        if (DRY_RUN) console.log(`  DELETE ${p}`);
        else await deleteFileAndRecord(p);
      }
    }
    console.log(`  Removed ${groups.reduce((s, g) => s + g.a.length, 0)} files from ${plantA}`);

  } else if (decision.decision === 'other') {
    await handleOther(decision, groups, plantA, plantB);
  }
}

async function handleOther(decision, groups, plantA, plantB) {
  const note = decision.note || '';

  // ── tangelo|ugli: Keep in tangelo, assign Ugli variety ───────────────────
  if (decision.pair === 'tangelo|ugli') {
    // Look up or create "Ugli" variety under tangelo
    let variety = await lookupVarietyId('tangelo', 'Ugli');
    if (!variety && !DRY_RUN) {
      variety = await createVariety('tangelo', 'Ugli');
      console.log(`  Created variety: Ugli (id=${variety.Id}) under tangelo`);
    }
    const varietyId = variety?.Id ?? null;

    // Delete ugli copies; update tangelo records with Variety_Id
    for (const g of groups) {
      // Delete ugli (plantB) copies
      for (const p of g.b) {
        if (DRY_RUN) console.log(`  DELETE ${p}`);
        else await deleteFileAndRecord(p);
      }
      // Update tangelo (plantA) records with variety
      if (varietyId) {
        for (const p of g.a) {
          const records = await queryByFilePath(toDbPath(p));
          for (const rec of records) {
            if (DRY_RUN) console.log(`  PATCH id=${rec.Id} Variety_Id=${varietyId}`);
            else { await patchRecord(rec.Id, { Variety_Id: varietyId }); totalPatched++; }
          }
        }
      }
    }
    const deletedCount = groups.reduce((s, g) => s + g.b.length, 0);
    console.log(`  Removed ${deletedCount} files from ugli, updated tangelo records with Ugli variety`);

  // ── guava|strawberry-guava: Keep in Guava, assign Strawberry variety ─────
  } else if (decision.pair === 'guava|strawberry-guava') {
    let variety = await lookupVarietyId('guava', 'Strawberry');
    if (!variety && !DRY_RUN) {
      variety = await createVariety('guava', 'Strawberry');
      console.log(`  Created variety: Strawberry (id=${variety.Id}) under guava`);
    }
    const varietyId = variety?.Id ?? null;

    // Delete strawberry-guava (plantB) copies; update guava records with variety
    for (const g of groups) {
      for (const p of g.b) {
        if (DRY_RUN) console.log(`  DELETE ${p}`);
        else await deleteFileAndRecord(p);
      }
      if (varietyId) {
        for (const p of g.a) {
          const records = await queryByFilePath(toDbPath(p));
          for (const rec of records) {
            if (DRY_RUN) console.log(`  PATCH id=${rec.Id} Variety_Id=${varietyId}`);
            else { await patchRecord(rec.Id, { Variety_Id: varietyId }); totalPatched++; }
          }
        }
      }
    }
    const deletedCount = groups.reduce((s, g) => s + g.b.length, 0);
    console.log(`  Removed ${deletedCount} files from strawberry-guava, updated guava records with Strawberry variety`);

  // ── avocado|longan: Keep Avocado, delete Longan, assign Kahaluu variety ──
  } else if (decision.pair === 'avocado|longan') {
    let variety = await lookupVarietyId('avocado', 'Kahaluu');
    if (!variety) {
      if (DRY_RUN) console.log(`  [DRY RUN] Would create variety: Kahaluu under avocado`);
      else {
        variety = await createVariety('avocado', 'Kahaluu');
        console.log(`  Created variety: Kahaluu (id=${variety.Id}) under avocado`);
      }
    } else {
      console.log(`  Found variety: Kahaluu (id=${variety.Id})`);
    }
    const varietyId = variety?.Id ?? null;

    for (const g of groups) {
      // Delete longan (plantB) copies
      for (const p of g.b) {
        if (DRY_RUN) console.log(`  DELETE ${p}`);
        else await deleteFileAndRecord(p);
      }
      // Update avocado (plantA) records with Kahaluu variety
      if (varietyId) {
        for (const p of g.a) {
          const records = await queryByFilePath(toDbPath(p));
          for (const rec of records) {
            if (DRY_RUN) console.log(`  PATCH id=${rec.Id} Variety_Id=${varietyId}`);
            else { await patchRecord(rec.Id, { Variety_Id: varietyId }); totalPatched++; }
          }
        }
      }
    }
    const deletedCount = groups.reduce((s, g) => s + g.b.length, 0);
    console.log(`  Removed ${deletedCount} files from longan, updated avocado records with Kahaluu variety`);

  // ── kumquat|trifoliate-orange: Mark all as hidden, remove from both ───────
  } else if (decision.pair === 'kumquat|trifoliate-orange') {
    for (const g of groups) {
      for (const p of [...g.a, ...g.b]) {
        if (DRY_RUN) console.log(`  HIDE ${p}`);
        else await hideFileAndRecord(p);
      }
    }
    const total = groups.reduce((s, g) => s + g.a.length + g.b.length, 0);
    console.log(`  Moved ${total} files to hidden/, deleted DB records for both plants`);

  } else {
    console.log(`  WARN: No handler for pair=${decision.pair}, note="${note}"`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Processing ${DECISIONS.length} decisions...\n`);

  for (const decision of DECISIONS) {
    await processDecision(decision);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`Files removed/moved: ${totalDeleted}`);
  console.log(`DB records deleted:  ${totalDbDeleted}`);
  console.log(`DB records patched:  ${totalPatched}`);
  console.log(`Errors:              ${totalErrors}`);
  if (DRY_RUN) console.log('\n[DRY RUN] Re-run without --dry-run to apply.');
  else console.log('\nDone.');
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });
