/**
 * DRY RUN: Reorganize pass_01 → pass_02 using NocoDB as source of truth.
 *
 * pass_02 structure:
 *   plants/<slug>/images/          ← Status=assigned, Plant_Id set
 *   plants/<slug>/images/hidden/   ← Status=hidden, Plant_Id set
 *   plants/<slug>/attachments/     ← Attachments table, Plant_Ids includes slug
 *   triage/                        ← Status=triage (or unassigned/unclassified), Plant_Id null
 *   ignored/                       ← Status=hidden, Plant_Id null
 *
 * Dry run: reports what WOULD be copied and lists pass_01 files that
 * would NOT be copied (data integrity issues).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { config } from 'dotenv';

config({ path: path.join(import.meta.dirname, '..', 'review-ui', '.env') });

const ROOT       = path.resolve(import.meta.dirname, '..');
const PASS01     = path.join(ROOT, 'content', 'pass_01');
const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
const IDS        = JSON.parse(readFileSync(path.join(ROOT, 'content', 'parsed', 'nocodb_table_ids.json'), 'utf-8'));
const h          = { 'xc-token': NOCODB_KEY };

if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

// ── Fetch all records from NocoDB ─────────────────────────────────────────────
async function fetchAll(table, fields = null) {
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({ limit: '1000', offset: String(offset) });
    if (fields) params.set('fields', fields);
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS[table]}/records?${params}`, { headers: h });
    if (!r.ok) throw new Error(`GET ${table}: ${r.status} ${await r.text()}`);
    const d = await r.json();
    all.push(...(d.list ?? []));
    if (d.pageInfo?.isLastPage || d.list?.length < 1000) break;
    offset += 1000;
  }
  return all;
}

// ── Walk pass_01 and collect all files ────────────────────────────────────────
async function walkDir(dir, files = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return files; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) await walkDir(abs, files);
    else files.push(abs);
  }
  return files;
}

console.log('Fetching NocoDB Images…');
const images = await fetchAll('Images', 'Id,File_Path,Plant_Id,Status,Variety_Id');
console.log(`  ${images.length} image records`);

console.log('Fetching NocoDB Attachments…');
const attachments = await fetchAll('Attachments', 'Id,File_Path,Plant_Ids');
console.log(`  ${attachments.length} attachment records`);

console.log('Walking pass_01…');
const allPass01Files = await walkDir(PASS01);
console.log(`  ${allPass01Files.length} files on disk\n`);

// ── Build the planned copy map (src → dest in pass_02) ────────────────────────
const IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.tif','.tiff','.bmp','.svg']);

const copyPlan = [];            // { src, dest, record_id, table, status }
const noFile   = [];            // NocoDB records whose File_Path doesn't exist on disk
const noPath   = [];            // NocoDB records with null/empty File_Path
const notPass01 = [];           // NocoDB records referencing files outside pass_01
const destCollisions = new Map(); // dest → [record_ids] — duplicate destination paths

// Normalise a NocoDB File_Path to an absolute disk path
function toAbs(fp) {
  if (!fp) return null;
  const norm = fp.replace(/\\/g, '/');
  // Paths are relative to ROOT: "content/pass_01/..." or absolute
  if (path.isAbsolute(norm)) return norm;
  return path.join(ROOT, norm);
}

// Determine pass_02 destination for an image record
function imageDestPath(img) {
  const status = (img.Status || '').toLowerCase();
  const plantId = img.Plant_Id;
  const fp = img.File_Path?.replace(/\\/g, '/') || '';
  const filename = fp.split('/').pop() || `image_${img.Id}`;

  if (plantId) {
    if (status === 'hidden') return `plants/${plantId}/images/hidden/${filename}`;
    // assigned, or anything else with a plant
    return `plants/${plantId}/images/${filename}`;
  } else {
    if (status === 'hidden') return `ignored/${filename}`;
    // triage, unassigned, unclassified, etc.
    return `triage/${filename}`;
  }
}

// Determine pass_02 destination for an attachment record
function attachmentDestPath(att) {
  const fp = att.File_Path?.replace(/\\/g, '/') || '';
  const filename = fp.split('/').pop() || `attachment_${att.Id}`;
  let plantIds = [];
  try { plantIds = JSON.parse(att.Plant_Ids || '[]'); } catch {}
  const slug = plantIds[0] || '_unassigned';
  return `plants/${slug}/attachments/${filename}`;
}

// Process images
for (const img of images) {
  if (!img.File_Path) { noPath.push({ table: 'Images', id: img.Id, plant: img.Plant_Id, status: img.Status }); continue; }
  const fp = img.File_Path.replace(/\\/g, '/');
  const absPath = toAbs(fp);

  if (!fp.includes('pass_01/')) { notPass01.push({ table: 'Images', id: img.Id, file_path: fp, plant: img.Plant_Id, status: img.Status }); continue; }

  const dest = imageDestPath(img);
  const entry = { src: absPath, dest, record_id: img.Id, table: 'Images', status: img.Status, plant: img.Plant_Id };

  if (!existsSync(absPath)) { noFile.push(entry); continue; }

  copyPlan.push(entry);
  if (!destCollisions.has(dest)) destCollisions.set(dest, []);
  destCollisions.get(dest).push(img.Id);
}

// Process attachments (only image-type files)
for (const att of attachments) {
  if (!att.File_Path) { noPath.push({ table: 'Attachments', id: att.Id }); continue; }
  const fp = att.File_Path.replace(/\\/g, '/');
  const ext = path.extname(fp).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) continue; // Skip PDFs, PPTs, etc.

  const absPath = toAbs(fp);
  if (!fp.includes('pass_01/')) { notPass01.push({ table: 'Attachments', id: att.Id, file_path: fp }); continue; }

  const dest = attachmentDestPath(att);
  const entry = { src: absPath, dest, record_id: att.Id, table: 'Attachments', plant: JSON.parse(att.Plant_Ids || '[]')[0] };

  if (!existsSync(absPath)) { noFile.push(entry); continue; }

  copyPlan.push(entry);
  if (!destCollisions.has(dest)) destCollisions.set(dest, []);
  destCollisions.get(dest).push(att.Id);
}

// ── Find pass_01 files NOT in copy plan ───────────────────────────────────────
const plannedSrcs = new Set(copyPlan.map(e => e.src.replace(/\\/g, '/')));
const uncoveredFiles = allPass01Files
  .map(f => f.replace(/\\/g, '/'))
  .filter(f => !plannedSrcs.has(f));

// Categorise uncovered files
const uncoveredByDir = {};
for (const f of uncoveredFiles) {
  const rel = f.replace(PASS01.replace(/\\/g, '/') + '/', '');
  const topDir = rel.split('/')[0];
  if (!uncoveredByDir[topDir]) uncoveredByDir[topDir] = [];
  uncoveredByDir[topDir].push(rel);
}

// Duplicate destinations
const realCollisions = [...destCollisions.entries()].filter(([, ids]) => ids.length > 1);

// ── Print report ─────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════════');
console.log('DRY RUN REPORT: pass_01 → pass_02');
console.log('═══════════════════════════════════════════════════════════════════\n');

console.log(`Files in copy plan (would be copied):  ${copyPlan.length}`);
console.log(`Files in pass_01 NOT in copy plan:     ${uncoveredFiles.length}`);
console.log(`NocoDB records with no File_Path:      ${noPath.length}`);
console.log(`NocoDB records — file missing on disk: ${noFile.length}`);
console.log(`NocoDB records outside pass_01:        ${notPass01.length}`);
console.log(`Destination path collisions:           ${realCollisions.length}\n`);

// Copy plan breakdown by destination category
const cats = { plants: 0, hidden: 0, attachments: 0, triage: 0, ignored: 0 };
for (const e of copyPlan) {
  if (e.dest.includes('/images/hidden/')) cats.hidden++;
  else if (e.dest.startsWith('plants/') && e.dest.includes('/images/')) cats.plants++;
  else if (e.dest.includes('/attachments/')) cats.attachments++;
  else if (e.dest.startsWith('triage/')) cats.triage++;
  else if (e.dest.startsWith('ignored/')) cats.ignored++;
}
console.log('Copy plan breakdown:');
console.log(`  plants/<slug>/images/        ${cats.plants}`);
console.log(`  plants/<slug>/images/hidden/ ${cats.hidden}`);
console.log(`  plants/<slug>/attachments/   ${cats.attachments}`);
console.log(`  triage/                      ${cats.triage}`);
console.log(`  ignored/                     ${cats.ignored}`);

if (noPath.length) {
  console.log(`\n── Records with no File_Path (${noPath.length}) ──`);
  noPath.forEach(r => console.log(`  [${r.table}] Id=${r.id} plant=${r.plant || '—'} status=${r.status || '—'}`));
}

if (noFile.length) {
  console.log(`\n── NocoDB records whose file is missing on disk (${noFile.length}) ──`);
  noFile.forEach(r => console.log(`  [${r.table}] Id=${r.record_id} ${r.src}`));
}

if (notPass01.length) {
  console.log(`\n── NocoDB records referencing files outside pass_01 (${notPass01.length}) ──`);
  notPass01.slice(0, 30).forEach(r => console.log(`  [${r.table}] Id=${r.record_id || r.id} ${r.file_path} plant=${r.plant || '—'} status=${r.status || '—'}`));
  if (notPass01.length > 30) console.log(`  … and ${notPass01.length - 30} more`);
}

if (realCollisions.length) {
  console.log(`\n── Destination path collisions (${realCollisions.length}) — two records map to same file ──`);
  realCollisions.slice(0, 20).forEach(([dest, ids]) => console.log(`  ${dest} ← Ids: ${ids.join(', ')}`));
}

console.log(`\n── pass_01 files NOT covered by NocoDB (${uncoveredFiles.length}) ──`);
const topDirs = Object.keys(uncoveredByDir).sort();
for (const dir of topDirs) {
  const files = uncoveredByDir[dir];
  console.log(`  [${dir}] ${files.length} file(s)`);
  files.slice(0, 5).forEach(f => console.log(`    ${f}`));
  if (files.length > 5) console.log(`    … and ${files.length - 5} more`);
}

// Write full detail to file for review
const reportPath = path.join(ROOT, 'content', 'backups', 'pass02-dry-run-report.json');
writeFileSync(reportPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  summary: { copyPlan: copyPlan.length, uncovered: uncoveredFiles.length, noPath: noPath.length, noFile: noFile.length, notPass01: notPass01.length, collisions: realCollisions.length },
  copyPlanByCategory: cats,
  noPath,
  noFile,
  notPass01,
  collisions: realCollisions.map(([dest, ids]) => ({ dest, ids })),
  uncoveredByDirectory: uncoveredByDir,
}, null, 2));
console.log(`\nFull detail written to: ${reportPath}`);
