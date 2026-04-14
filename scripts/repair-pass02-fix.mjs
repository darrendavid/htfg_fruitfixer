/**
 * repair-pass02-fix.mjs
 *
 * Applies all repair actions to bring pass_02 + NocoDB to a consistent state:
 *   - Restores misplaced plant images to the correct plants/<slug>/images/ locations
 *   - Creates NocoDB records for every orphaned file (image → Images, docs/PSDs → BinaryDocuments)
 *   - Resolves ambiguous filename conflicts using 4 ordered rules
 *   - Fixes metadata drift (Caption, Attribution, Excluded, Variety_Id, Status, Rotation)
 *   - Deletes collision-rename duplicates safely
 *
 * Run with:  node scripts/repair-pass02-fix.mjs
 * Dry-run:   node scripts/repair-pass02-fix.mjs --dry-run
 */

import {
  readFileSync, existsSync, readdirSync,
  mkdirSync, renameSync, copyFileSync, unlinkSync, writeFileSync,
} from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: 'review-ui/.env' });

const DRY_RUN    = process.argv.includes('--dry-run');
const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const IDS        = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const H          = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };
const PASS01     = 'content/pass_01';
const PASS02     = 'content/pass_02';
const BACKUP_DIR = 'content/backups/nocodb-2026-04-12-07-35-05';

const IMG_EXTS   = new Set(['jpg','jpeg','png','gif','webp','bmp','tiff','tif']);
const DOC_EXTS   = new Set(['pdf','doc','docx','ppt','pptx','xls','xlsx','txt','psd','ai','eps']);

const REPORT_PATH = `content/backups/pass02-fix-report-${Date.now()}.json`;

// ── NocoDB helpers ─────────────────────────────────────────────────────────────

async function fetchAll(table, fields) {
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({ limit: '200', offset: String(offset) });
    if (fields) params.set('fields', fields);
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS[table]}/records?${params}`, { headers: H });
    const d = await r.json();
    all.push(...(d.list ?? []));
    if (d.pageInfo?.isLastPage) break;
    offset += 200;
  }
  return all;
}

async function bulkCreate(table, records) {
  if (!records.length) return [];
  if (DRY_RUN) return records.map((_, i) => ({ Id: -(i + 1) }));
  const BATCH = 100;
  const created = [];
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS[table]}/records`, {
      method: 'POST', headers: H, body: JSON.stringify(batch),
    });
    if (!r.ok) {
      console.error(`bulkCreate ${table} batch ${i}-${i+BATCH} failed: ${await r.text()}`);
      continue;
    }
    const result = await r.json();
    created.push(...(Array.isArray(result) ? result : [result]));
  }
  return created;
}

async function bulkUpdate(table, records) {
  if (!records.length) return;
  if (DRY_RUN) return;
  const BATCH = 100;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS[table]}/records`, {
      method: 'PATCH', headers: H, body: JSON.stringify(batch),
    });
    if (!r.ok) console.error(`bulkUpdate ${table} batch failed: ${await r.text()}`);
  }
}

// ── File helpers ───────────────────────────────────────────────────────────────

const norm     = p => p?.replace(/\\/g, '/') || '';
const relC     = p => { const n = norm(p); const i = n.indexOf('content/'); return i >= 0 ? n.slice(i) : n; };
const extOf    = fname => fname.split('.').pop().toLowerCase();
const isImage  = fname => IMG_EXTS.has(extOf(fname));
const isDoc    = fname => DOC_EXTS.has(extOf(fname));

function walkDir(dir, result = []) {
  if (!existsSync(dir)) return result;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(full, result);
    else result.push(norm(full));
  }
  return result;
}

// Resolve a dest filename that doesn't collide with existing files
function resolveDestPath(destDir, fname) {
  let candidate = path.join(destDir, fname);
  if (!existsSync(candidate)) return candidate;
  const ext  = path.extname(fname);
  const base = path.basename(fname, ext);
  let n = 1;
  while (existsSync(candidate)) { candidate = path.join(destDir, `${base}_${n}${ext}`); n++; }
  return candidate;
}

function doMove(src, destAbs) {
  if (DRY_RUN) return destAbs;
  const dir = path.dirname(destAbs);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try { renameSync(src, destAbs); }
  catch (e) {
    if (e.code === 'EXDEV') { copyFileSync(src, destAbs); unlinkSync(src); }
    else throw e;
  }
  return destAbs;
}

function doDelete(absPath) {
  if (!DRY_RUN && existsSync(absPath)) unlinkSync(absPath);
}

const stripSuffix = fname => fname.replace(/_\d+(\.[^.]+)$/, '$1');

// ── Plant inference helpers ────────────────────────────────────────────────────

function buildPlantTerms(plants) {
  const terms = new Map(); // slug → [term strings]
  for (const p of plants) {
    const t = [];
    if (p.Id1) t.push(p.Id1.replace(/-/g, ' '));
    if (p.Canonical_Name) t.push(...p.Canonical_Name.toLowerCase().split(/[\s,/()-]+/).filter(s => s.length > 4));
    if (p.Alternative_Names) t.push(...p.Alternative_Names.toLowerCase().split(/[\s,/();-]+/).filter(s => s.length > 4));
    terms.set(p.Id1, t);
  }
  return terms;
}

function inferPlant(fname, srcPaths, plantTerms) {
  const combined = (fname.toLowerCase().replace(/[_\-.]/g, ' ') + ' ' + srcPaths.join(' ').toLowerCase());
  const matches = [];
  for (const [slug, terms] of plantTerms) {
    if (combined.includes(slug.replace(/-/g, ' '))) { matches.push(slug); continue; }
    for (const term of terms) {
      if (term.length > 4 && combined.includes(term)) { matches.push(slug); break; }
    }
  }
  return matches;
}

// ── Ambiguity resolution (4 rules) ────────────────────────────────────────────

function resolveAmbiguous(matches, bakById, plantTerms, fname) {
  // Rule 0: all hidden → treat as hidden, use first
  if (matches.every(m => m.status === 'hidden')) {
    return { chosen: matches[0], reason: 'all_hidden', action: 'restore_to_plant_hidden' };
  }

  const full = matches.map(m => ({ ...m, rec: bakById.get(m.backup_id) }));

  // Rule 1: variety assignment in exactly one
  const withVariety = full.filter(m => m.rec?.Variety_Id);
  if (withVariety.length === 1) {
    const chosen = withVariety[0];
    return {
      chosen,
      reason: 'variety_assignment',
      action: chosen.status === 'assigned' ? 'restore_to_plant_assigned' : 'restore_to_plant_hidden',
    };
  }

  // Rule 2: different NocoDB timestamps → keep newer
  const withTime = full.filter(m => m.rec?.UpdatedAt || m.rec?.CreatedAt);
  if (withTime.length > 1) {
    const sorted = [...withTime].sort((a, b) => {
      const ta = new Date(a.rec?.UpdatedAt || a.rec?.CreatedAt || 0).getTime();
      const tb = new Date(b.rec?.UpdatedAt || b.rec?.CreatedAt || 0).getTime();
      return tb - ta;
    });
    const ta = new Date(sorted[0].rec?.UpdatedAt || sorted[0].rec?.CreatedAt || 0).getTime();
    const tb = new Date(sorted[1].rec?.UpdatedAt || sorted[1].rec?.CreatedAt || 0).getTime();
    if (ta !== tb) {
      const chosen = sorted[0];
      return {
        chosen,
        reason: 'newer_timestamp',
        action: chosen.status === 'assigned' ? 'restore_to_plant_assigned' : 'restore_to_plant_hidden',
      };
    }
  }

  // Rule 3: filename/path inference
  const srcPaths = full.map(m => m.rec?.Source_Directory || m.rec?.File_Path || '').filter(Boolean);
  const inferred = inferPlant(fname, srcPaths, plantTerms);
  const slugsInContest = matches.map(m => m.plant_id);
  const matchedSlugs = inferred.filter(s => slugsInContest.includes(s));
  if (matchedSlugs.length === 1) {
    const chosen = full.find(m => m.plant_id === matchedSlugs[0]);
    return {
      chosen,
      reason: 'filename_inference',
      action: chosen.status === 'assigned' ? 'restore_to_plant_assigned' : 'restore_to_plant_hidden',
    };
  }

  // Rule 4: triage
  return { chosen: null, reason: 'unresolvable', action: 'triage' };
}

// ── Main ───────────────────────────────────────────────────────────────────────

console.log(`\n=== pass_02 repair fix (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) ===\n`);

// Load data
console.log('Loading backup data…');
const backupImages   = JSON.parse(readFileSync(`${BACKUP_DIR}/Images.json`, 'utf-8'));
const backupPlants   = JSON.parse(readFileSync(`${BACKUP_DIR}/Plants.json`, 'utf-8'));
const plantTerms     = buildPlantTerms(backupPlants);

console.log('Fetching current NocoDB Images…');
const currentImages  = await fetchAll('Images');
console.log(`  ${currentImages.length} image records`);

console.log('Fetching current NocoDB BinaryDocuments…');
const currentDocs    = await fetchAll('BinaryDocuments');
console.log(`  ${currentDocs.length} document records`);

// Build indices
console.log('\nBuilding indices…');
const curByPath     = new Map();
const curByFilename = new Map();
const curById       = new Map();
for (const r of currentImages) {
  const fp = relC(norm(r.File_Path || ''));
  curById.set(r.Id, r);
  if (fp) curByPath.set(fp, r);
  const fname = path.basename(fp);
  if (fname) { if (!curByFilename.has(fname)) curByFilename.set(fname, []); curByFilename.get(fname).push(r); }
}

const docByPath     = new Map();
const docByFilename = new Map();
for (const r of currentDocs) {
  const fp = relC(norm(r.File_Path || ''));
  if (fp) docByPath.set(fp, r);
  const fname = path.basename(fp);
  if (fname) { if (!docByFilename.has(fname)) docByFilename.set(fname, []); docByFilename.get(fname).push(r); }
}

const bakById       = new Map(backupImages.map(r => [r.Id, r]));
const bakByFilename = new Map();
for (const r of backupImages) {
  const fname = r.File_Path ? path.basename(norm(r.File_Path)) : null;
  if (!fname) continue;
  if (!bakByFilename.has(fname)) bakByFilename.set(fname, []);
  bakByFilename.get(fname).push(r);
}

// pass_01 index
console.log('Indexing pass_01…');
const PASS01_DIRS = [
  ['assigned',                path.join(PASS01, 'assigned')],
  ['hidden',                  path.join(PASS01, 'hidden')],
  ['ignored',                 path.join(PASS01, 'ignored')],
  ['unassigned/ignored',      path.join(PASS01, 'unassigned', 'ignored')],
  ['unassigned/_to_triage',   path.join(PASS01, 'unassigned', '_to_triage')],
  ['unassigned/unclassified', path.join(PASS01, 'unassigned', 'unclassified')],
];
const pass01Index = new Map();
for (const [label, dir] of PASS01_DIRS) {
  for (const abs of walkDir(dir)) {
    const fname = path.basename(abs);
    if (!pass01Index.has(fname)) pass01Index.set(fname, []);
    pass01Index.get(fname).push({ label, absPath: norm(abs) });
  }
}
console.log(`  ${pass01Index.size} unique filenames in pass_01`);

// Walk pass_02
console.log('\nWalking pass_02…');
const allPass02 = walkDir(PASS02);
console.log(`  ${allPass02.length} files on disk\n`);

// ── Categorise every file ──────────────────────────────────────────────────────

const META_FIELDS = ['Rotation', 'Caption', 'Variety_Id', 'Excluded', 'Status', 'Attribution'];

const toDelete         = [];   // [absPath]
const imgMovesCreate   = [];   // [{src, destDir, fname, meta, bakId}] → move + Images create
const imgCreateInPlace = [];   // [{fp, meta}] → Images create, no move
const docCreate        = [];   // [{fp, meta}] → BinaryDocuments create
const metaUpdates      = [];   // [{id, fields}] → Images PATCH

let covered = 0, skipped = 0;

console.log('Analysing…');

for (const absFile of allPass02) {
  const fp    = relC(absFile);
  const fname = path.basename(fp);
  const ext   = extOf(fname);
  const inDocDir = fp.includes('/documents/');

  // Already has an Images record?
  if (curByPath.has(fp)) {
    covered++;
    // Check metadata drift vs backup
    const cur = curByPath.get(fp);
    let bakRec = bakById.get(cur.Id);
    if (!bakRec) {
      const baks = bakByFilename.get(fname) || [];
      bakRec = baks.length === 1 ? baks[0] : baks.find(b => b.Plant_Id === cur.Plant_Id);
    }
    if (bakRec) {
      const updates = {};
      for (const field of META_FIELDS) {
        const c = cur[field], b = bakRec[field];
        if (b != null && b !== '' && b !== false && b !== 0 && c !== b) updates[field] = b;
      }
      if (Object.keys(updates).length) metaUpdates.push({ Id: cur.Id, ...updates });
    }
    continue;
  }

  // Already has a BinaryDocuments record?
  if (docByPath.has(fp)) { skipped++; continue; }

  // ── Orphan: decide action ──────────────────────────────────────────────────

  // Files in plants/*/documents/ → BinaryDocuments territory
  if (inDocDir || isDoc(fname)) {
    const bakRecs = bakByFilename.get(fname) || [];
    const bak     = bakRecs.length === 1 ? bakRecs[0] : null;
    docCreate.push({
      fp,
      meta: {
        File_Path:   fp,
        File_Name:   fname,
        File_Type:   ext,
        Plant_Id:    bak?.Plant_Id   || null,
        Status:      bak?.Status === 'assigned' ? 'assigned' : 'hidden',
        Excluded:    true,
        Size_Bytes:  bak?.Size_Bytes || null,
        Description: null,
      },
    });
    continue;
  }

  // Image orphan
  const bakRecs = bakByFilename.get(fname) || [];

  if (bakRecs.length === 0) {
    // Not in backup
    const baseFname = stripSuffix(fname);
    const isCollision = baseFname !== fname && curByFilename.has(baseFname);
    if (isCollision) {
      toDelete.push(absFile);
      continue;
    }
    // Create in-place record based on inferred status
    const origins = pass01Index.get(fname) || [];
    const labels  = origins.map(o => o.label);
    const excluded = labels.some(l => l === 'ignored' || l.includes('unassigned') || l === 'hidden');
    imgCreateInPlace.push({
      fp,
      meta: {
        File_Path:  fp,
        Plant_Id:   null,
        Status:     excluded ? 'hidden' : 'triage',
        Excluded:   excluded,
        Rotation:   0,
        Variety_Id: null,
        Source_Directory: origins[0]?.label || null,
      },
    });

  } else if (bakRecs.length === 1) {
    const bak = bakRecs[0];
    const meta = {
      Plant_Id:          bak.Plant_Id          || null,
      Status:            bak.Status            || 'triage',
      Excluded:          bak.Excluded          ?? false,
      Variety_Id:        bak.Variety_Id        || null,
      Caption:           bak.Caption           || null,
      Rotation:          bak.Rotation          || 0,
      Attribution:       bak.Attribution       || null,
      License:           bak.License           || null,
      Perceptual_Hash:   bak.Perceptual_Hash   || null,
      Source_Directory:  bak.Source_Directory  || null,
      Size_Bytes:        bak.Size_Bytes        || null,
      Original_Filepath: bak.Original_Filepath || null,
    };

    if (bak.Plant_Id && bak.Status === 'assigned') {
      imgMovesCreate.push({ src: absFile, destDir: `${PASS02}/plants/${bak.Plant_Id}/images`, fname, meta, bakId: bak.Id });
    } else if (bak.Plant_Id) {
      meta.Status = 'hidden'; meta.Excluded = true;
      imgMovesCreate.push({ src: absFile, destDir: `${PASS02}/plants/${bak.Plant_Id}/images/hidden`, fname, meta, bakId: bak.Id });
    } else if (bak.Status === 'hidden') {
      imgCreateInPlace.push({ fp, meta: { ...meta, File_Path: fp } });
    } else {
      const destFp = `${PASS02}/triage/${fname}`;
      imgMovesCreate.push({ src: absFile, destDir: `${PASS02}/triage`, fname, meta: { ...meta, Status: 'triage', Excluded: false, File_Path: destFp }, bakId: bak.Id });
    }

  } else {
    // Ambiguous — apply 4-rule resolution
    const resolution = resolveAmbiguous(
      bakRecs.map(b => ({ backup_id: b.Id, plant_id: b.Plant_Id, status: b.Status })),
      bakById, plantTerms, fname,
    );

    if (resolution.action === 'triage') {
      imgCreateInPlace.push({
        fp,
        meta: { File_Path: fp, Plant_Id: null, Status: 'triage', Excluded: false, Rotation: 0, Variety_Id: null },
      });
    } else {
      const bak = bakById.get(resolution.chosen.backup_id);
      const meta = {
        Plant_Id:          bak?.Plant_Id          || null,
        Status:            resolution.action === 'restore_to_plant_hidden' ? 'hidden' : 'assigned',
        Excluded:          resolution.action === 'restore_to_plant_hidden',
        Variety_Id:        bak?.Variety_Id        || null,
        Caption:           bak?.Caption           || null,
        Rotation:          bak?.Rotation          || 0,
        Attribution:       bak?.Attribution       || null,
        License:           bak?.License           || null,
        Perceptual_Hash:   bak?.Perceptual_Hash   || null,
        Source_Directory:  bak?.Source_Directory  || null,
        Size_Bytes:        bak?.Size_Bytes        || null,
        Original_Filepath: bak?.Original_Filepath || null,
      };
      const slug    = resolution.chosen.plant_id;
      const subDir  = resolution.action === 'restore_to_plant_hidden' ? 'images/hidden' : 'images';
      imgMovesCreate.push({ src: absFile, destDir: `${PASS02}/plants/${slug}/${subDir}`, fname, meta, bakId: bak?.Id });
    }
  }
}

// ── Execute ────────────────────────────────────────────────────────────────────

const report = {
  generated_at: new Date().toISOString(), dry_run: DRY_RUN,
  deleted: 0, moved: 0, images_created: 0, docs_created: 0, metadata_updated: 0, errors: [],
};

// 1. Delete collision duplicates
console.log(`\nDeleting ${toDelete.length} collision duplicates…`);
for (const f of toDelete) {
  try { doDelete(f); report.deleted++; }
  catch (e) { report.errors.push(`delete ${f}: ${e.message}`); }
}
console.log(`  done (${report.deleted})`);

// 2. Move + prepare NocoDB creates for plant restores
console.log(`\nMoving ${imgMovesCreate.length} images to correct plant locations…`);
const imgCreates = [];
for (const { src, destDir, fname, meta, bakId } of imgMovesCreate) {
  try {
    const destAbs = resolveDestPath(destDir, fname);
    const destRel = relC(norm(destAbs));
    doMove(src, destAbs);
    report.moved++;
    imgCreates.push({ ...meta, File_Path: destRel });
  } catch (e) {
    report.errors.push(`move ${src} → ${destDir}: ${e.message}`);
  }
}
console.log(`  moved ${report.moved}`);

// 3. In-place Image creates
for (const { fp, meta } of imgCreateInPlace) imgCreates.push({ ...meta, File_Path: fp });

// 4. Bulk create Images
console.log(`\nCreating ${imgCreates.length} NocoDB Image records…`);
const created = await bulkCreate('Images', imgCreates);
report.images_created = imgCreates.length;
console.log(`  done`);

// 5. BinaryDocuments creates
console.log(`\nCreating ${docCreate.length} NocoDB BinaryDocument records…`);
const docPayloads = docCreate.map(({ fp, meta }) => ({ ...meta, File_Path: fp }));
await bulkCreate('BinaryDocuments', docPayloads);
report.docs_created = docCreate.length;
console.log(`  done`);

// 6. Metadata updates
console.log(`\nPatching ${metaUpdates.length} metadata mismatches…`);
await bulkUpdate('Images', metaUpdates);
report.metadata_updated = metaUpdates.length;
console.log(`  done`);

// ── Summary ────────────────────────────────────────────────────────────────────

report.summary = {
  pass02_files_scanned:    allPass02.length,
  already_covered:         covered,
  collision_dupes_deleted: report.deleted,
  files_moved:             report.moved,
  images_nocodb_created:   report.images_created,
  docs_nocodb_created:     report.docs_created,
  metadata_patched:        report.metadata_updated,
  errors:                  report.errors.length,
};

writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

console.log('\n=== SUMMARY ===');
for (const [k, v] of Object.entries(report.summary)) {
  console.log(`  ${k}: ${v}`);
}
if (report.errors.length) {
  console.log('\nErrors:');
  report.errors.slice(0, 10).forEach(e => console.log('  ' + e));
}
console.log(`\nReport: ${REPORT_PATH}`);
if (DRY_RUN) console.log('\n[DRY RUN] No changes made.');
