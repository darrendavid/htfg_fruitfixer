/**
 * audit-original-coverage.mjs
 *
 * Walks content/source/original/ and checks how many files are accounted
 * for in NocoDB (Images + BinaryDocuments) and/or in content/pass_02/.
 *
 * Match strategy (in order):
 *   1. Original_Filepath column in Images exactly matches the source path
 *   2. Filename match in NocoDB Images by filename
 *   3. Filename match in NocoDB BinaryDocuments by filename
 *   4. Filename exists in pass_02/ (on disk)
 *
 * Run: node scripts/audit-original-coverage.mjs
 */

import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: 'review-ui/.env' });

const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const IDS    = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const H      = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };
const ORIG   = 'content/source/original';
const PASS02 = 'content/pass_02';

const SKIP_NAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);
const IMG_EXTS   = new Set(['jpg','jpeg','png','gif','webp','bmp','tiff','tif']);
const DOC_EXTS   = new Set(['pdf','doc','docx','ppt','pptx','xls','xlsx','txt','psd','ai','eps']);

const norm   = p => p?.replace(/\\/g, '/') || '';
const extOf  = f => f.split('.').pop().toLowerCase();
const relC   = p => { const n = norm(p); const i = n.indexOf('content/'); return i >= 0 ? n.slice(i) : n; };

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function walkDir(dir, result = []) {
  if (!existsSync(dir)) return result;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(full, result);
    else {
      const lname = e.name.toLowerCase();
      if (!SKIP_NAMES.has(lname)) result.push(norm(full));
    }
  }
  return result;
}

// ── Load NocoDB ────────────────────────────────────────────────────────────────

console.log('\n=== original/ coverage audit ===\n');
console.log('Fetching NocoDB Images…');
const images = await fetchAll('Images', 'Id,File_Path,Plant_Id,Status,Original_Filepath');
console.log(`  ${images.length} records`);

console.log('Fetching NocoDB BinaryDocuments…');
const docs = await fetchAll('BinaryDocuments', 'Id,File_Path,File_Name,Plant_Id,Status');
console.log(`  ${docs.length} records`);

// ── Build indices ──────────────────────────────────────────────────────────────

console.log('\nBuilding indices…');

// Original_Filepath → image record
const byOrigPath = new Map();
for (const r of images) {
  if (r.Original_Filepath) {
    const n = norm(r.Original_Filepath);
    byOrigPath.set(n, r);
    // Also index the base filename from Original_Filepath
    const rel = n.includes('original/') ? n.slice(n.indexOf('original/')) : n;
    byOrigPath.set(rel, r);
  }
}

// Filename → image records
const imgByFilename = new Map();
for (const r of images) {
  const fp = norm(r.File_Path || '');
  const fname = path.basename(fp).toLowerCase();
  if (fname) {
    if (!imgByFilename.has(fname)) imgByFilename.set(fname, []);
    imgByFilename.get(fname).push(r);
  }
}

// Filename → doc records
const docByFilename = new Map();
for (const r of docs) {
  const fp = norm(r.File_Path || '');
  const fname = (path.basename(fp) || r.File_Name || '').toLowerCase();
  if (fname) {
    if (!docByFilename.has(fname)) docByFilename.set(fname, []);
    docByFilename.get(fname).push(r);
  }
}

// pass_02 filename index (on disk)
console.log('Indexing pass_02 filenames on disk…');
const pass02Filenames = new Set();
for (const abs of walkDir(PASS02)) {
  pass02Filenames.add(path.basename(abs).toLowerCase());
}
console.log(`  ${pass02Filenames.size} unique filenames in pass_02`);

// ── Walk original/ ─────────────────────────────────────────────────────────────

console.log('\nWalking original/…');
const allOriginal = walkDir(ORIG);
console.log(`  ${allOriginal.length} files found\n`);

// ── Categorise ────────────────────────────────────────────────────────────────

const covered_by_orig_filepath = [];
const covered_by_filename_img  = [];
const covered_by_filename_doc  = [];
const covered_by_pass02_disk   = [];
const not_covered              = [];

const byExt = {};

for (const absFile of allOriginal) {
  const fp    = relC(absFile);
  const fname = path.basename(fp);
  const fnamelc = fname.toLowerCase();
  const ext   = extOf(fname);

  // Track ext
  byExt[ext] = (byExt[ext] || 0) + 1;

  // Check 1: Original_Filepath match
  const origRel = fp.includes('original/') ? fp.slice(fp.indexOf('original/')) : fp;
  if (byOrigPath.has(norm(fp)) || byOrigPath.has(origRel)) {
    covered_by_orig_filepath.push(fp);
    continue;
  }

  // Check 2: filename match in Images
  if (imgByFilename.has(fnamelc)) {
    covered_by_filename_img.push(fp);
    continue;
  }

  // Check 3: filename match in BinaryDocuments
  if (docByFilename.has(fnamelc)) {
    covered_by_filename_doc.push(fp);
    continue;
  }

  // Check 4: filename exists in pass_02 on disk
  if (pass02Filenames.has(fnamelc)) {
    covered_by_pass02_disk.push(fp);
    continue;
  }

  not_covered.push({ path: fp, ext });
}

// ── Extension breakdown of uncovered ─────────────────────────────────────────

const uncovByExt = {};
for (const { ext } of not_covered) uncovByExt[ext] = (uncovByExt[ext] || 0) + 1;

const sortedExt = Object.entries(uncovByExt).sort((a, b) => b[1] - a[1]);

// ── Sample uncovered images ──────────────────────────────────────────────────

const uncovImages  = not_covered.filter(f => IMG_EXTS.has(f.ext));
const uncovDocs    = not_covered.filter(f => DOC_EXTS.has(f.ext));
const uncovOther   = not_covered.filter(f => !IMG_EXTS.has(f.ext) && !DOC_EXTS.has(f.ext));

// ── Output ────────────────────────────────────────────────────────────────────

const total   = allOriginal.length;
const covered = covered_by_orig_filepath.length + covered_by_filename_img.length +
                covered_by_filename_doc.length + covered_by_pass02_disk.length;

console.log('=== COVERAGE REPORT ===');
console.log(`  Total files in original/:          ${total}`);
console.log(`  Covered (any method):              ${covered}  (${((covered/total)*100).toFixed(1)}%)`);
console.log(`    via Original_Filepath match:     ${covered_by_orig_filepath.length}`);
console.log(`    via NocoDB Images filename:      ${covered_by_filename_img.length}`);
console.log(`    via NocoDB BinaryDocs filename:  ${covered_by_filename_doc.length}`);
console.log(`    via pass_02 disk filename:       ${covered_by_pass02_disk.length}`);
console.log(`  NOT covered:                       ${not_covered.length}  (${((not_covered.length/total)*100).toFixed(1)}%)`);
console.log(`    images:                          ${uncovImages.length}`);
console.log(`    documents/PSDs:                  ${uncovDocs.length}`);
console.log(`    other:                           ${uncovOther.length}`);

console.log('\n  Extension breakdown of ALL files:');
for (const [ext, n] of Object.entries(byExt).sort((a,b)=>b[1]-a[1]).slice(0,20)) {
  console.log(`    .${ext.padEnd(10)} ${n}`);
}

console.log('\n  Extension breakdown of UNCOVERED files:');
for (const [ext, n] of sortedExt.slice(0, 20)) {
  console.log(`    .${ext.padEnd(10)} ${n}`);
}

if (uncovImages.length > 0) {
  console.log('\n  Sample uncovered IMAGE paths (first 20):');
  for (const f of uncovImages.slice(0, 20)) console.log(`    ${f.path}`);
}

if (uncovDocs.length > 0) {
  console.log('\n  Sample uncovered DOC/PSD paths (first 10):');
  for (const f of uncovDocs.slice(0, 10)) console.log(`    ${f.path}`);
}

if (uncovOther.length > 0) {
  console.log('\n  Sample uncovered OTHER paths (first 10):');
  for (const f of uncovOther.slice(0, 10)) console.log(`    ${f.path}`);
}

// ── Write full report ─────────────────────────────────────────────────────────

const reportPath = `content/backups/original-coverage-${Date.now()}.json`;
writeFileSync(reportPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  totals: { total, covered, not_covered: not_covered.length },
  coverage_by_method: {
    orig_filepath: covered_by_orig_filepath.length,
    nocodb_images_filename: covered_by_filename_img.length,
    nocodb_docs_filename: covered_by_filename_doc.length,
    pass02_disk_filename: covered_by_pass02_disk.length,
  },
  uncovered_by_ext: uncovByExt,
  uncovered_files: not_covered,
}, null, 2));
console.log(`\nFull report: ${reportPath}`);
