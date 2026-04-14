/**
 * audit-original-vs-nocodb.mjs
 *
 * Full reconciliation: every file in content/source/original/ checked against
 * NocoDB (Images + BinaryDocuments).
 *
 * Match hierarchy (in order):
 *   1. Original_Filepath column exact match  (most reliable)
 *   2. Filename + Size_Bytes match in Images
 *   3. Filename match in BinaryDocuments
 *
 * Reports: status breakdown, coverage %, unmatched files with reasons.
 *
 * Run: node scripts/audit-original-vs-nocodb.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: 'review-ui/.env' });

const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const IDS  = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const H    = { 'xc-token': NOCODB_KEY };
const ORIG = 'content/source/original';

const SKIP_NAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store', '.localized']);
const IMG_EXTS   = new Set(['jpg','jpeg','png','gif','webp','bmp','tiff','tif']);
const DOC_EXTS   = new Set(['pdf','doc','docx','ppt','pptx','xls','xlsx','txt','psd','ai','eps']);

const norm  = p => p?.replace(/\\/g, '/') || '';
const extOf = f => f.split('.').pop().toLowerCase();
const relC  = p => { const n = norm(p); const i = n.indexOf('content/'); return i >= 0 ? n.slice(i) : n; };

// ── NocoDB fetch (all pages) ───────────────────────────────────────────────────

async function fetchAll(table, fields) {
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({ limit: '200', offset: String(offset), fields: fields.join(',') });
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS[table]}/records?${params}`, { headers: H });
    if (!r.ok) throw new Error(`${table} fetch failed: ${r.status}`);
    const d = await r.json();
    all.push(...(d.list ?? []));
    if (d.pageInfo?.isLastPage) break;
    offset += 200;
    if (offset % 10000 === 0) process.stderr.write(`  ${table} ${offset}…`);
  }
  process.stderr.write('\n');
  return all;
}

// ── Walk original/ ─────────────────────────────────────────────────────────────

function walkDir(dir, result = []) {
  if (!existsSync(dir)) return result;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(full, result);
    else {
      const lname = e.name.toLowerCase();
      if (!SKIP_NAMES.has(lname)) result.push(full);
    }
  }
  return result;
}

// ── Main ───────────────────────────────────────────────────────────────────────

console.log('\n=== original/ ↔ NocoDB reconciliation ===\n');

// 1. Fetch all NocoDB Images
console.log('Fetching Images from NocoDB…');
const images = await fetchAll('Images', [
  'Id', 'File_Path', 'Original_Filepath', 'Plant_Id', 'Status', 'Excluded',
  'Variety_Id', 'Size_Bytes',
]);
console.log(`  ${images.length} image records`);

// 2. Fetch all NocoDB BinaryDocuments
console.log('Fetching BinaryDocuments from NocoDB…');
const docs = await fetchAll('BinaryDocuments', [
  'Id', 'File_Path', 'Original_File_Path', 'Plant_Id', 'Status', 'File_Type',
]);
console.log(`  ${docs.length} document records\n`);

// 3. Build lookup indices
console.log('Building indices…');

// Original_Filepath → record (Images)
const imgByOrigPath = new Map();
for (const r of images) {
  if (r.Original_Filepath) {
    const n = norm(r.Original_Filepath);
    // Store both the full path and the "original/..." suffix
    imgByOrigPath.set(n, r);
    const origIdx = n.indexOf('original/');
    if (origIdx >= 0) imgByOrigPath.set(n.slice(origIdx), r);
  }
}

// Filename → [Images] (fallback)
const imgByFilename = new Map();
for (const r of images) {
  const fp = norm(r.File_Path || '');
  const fname = path.basename(fp).toLowerCase();
  if (fname) {
    if (!imgByFilename.has(fname)) imgByFilename.set(fname, []);
    imgByFilename.get(fname).push(r);
  }
}

// Original_File_Path → BinaryDocuments
const docByOrigPath = new Map();
for (const r of docs) {
  if (r.Original_File_Path) {
    const n = norm(r.Original_File_Path);
    docByOrigPath.set(n, r);
    const origIdx = n.indexOf('original/');
    if (origIdx >= 0) docByOrigPath.set(n.slice(origIdx), r);
  }
}

// Filename → [BinaryDocuments]
const docByFilename = new Map();
for (const r of docs) {
  // BinaryDocuments may not have File_Name; derive from File_Path
  const fp = norm(r.File_Path || '');
  const fname = path.basename(fp).toLowerCase();
  if (fname) {
    if (!docByFilename.has(fname)) docByFilename.set(fname, []);
    docByFilename.get(fname).push(r);
  }
}

console.log(`  Images indexed:          ${images.length}`);
console.log(`  Images with orig path:   ${imgByOrigPath.size / 2 | 0}`);
console.log(`  BinaryDocs indexed:      ${docs.length}\n`);

// 4. Walk original/
console.log('Walking original/…');
const allFiles = walkDir(ORIG);
console.log(`  ${allFiles.length} files\n`);

// 5. Reconcile
const statusBuckets = {
  assigned:   [],   // NocoDB Status=assigned
  hidden:     [],   // NocoDB Status=hidden
  triage:     [],   // NocoDB Status=triage
  binary_doc: [],   // matched in BinaryDocuments
  no_record:  [],   // no NocoDB record found
};

const matchMethods = { orig_path: 0, filename_img: 0, filename_doc: 0 };

for (const absFile of allFiles) {
  const fp    = relC(absFile);
  const fname = path.basename(absFile).toLowerCase();
  const origRelKey = fp.includes('original/') ? fp.slice(fp.indexOf('original/')) : fp;

  let matched = false;

  // Method 1: Original_Filepath exact match → Images
  const imgByOrig = imgByOrigPath.get(norm(fp)) || imgByOrigPath.get(origRelKey);
  if (imgByOrig) {
    statusBuckets[imgByOrig.Status === 'assigned' ? 'assigned'
                : imgByOrig.Status === 'hidden'   ? 'hidden'
                :                                   'triage'].push({
      original: fp, nocodb_id: imgByOrig.Id,
      status: imgByOrig.Status, plant: imgByOrig.Plant_Id,
      file_path: imgByOrig.File_Path, method: 'orig_path',
    });
    matchMethods.orig_path++;
    matched = true;
  }

  // Method 2: Original_Filepath → BinaryDocuments
  if (!matched) {
    const docByOrig = docByOrigPath.get(norm(fp)) || docByOrigPath.get(origRelKey);
    if (docByOrig) {
      statusBuckets.binary_doc.push({
        original: fp, nocodb_id: docByOrig.Id,
        status: docByOrig.Status, plant: docByOrig.Plant_Id,
        file_path: docByOrig.File_Path, method: 'orig_path_doc',
      });
      matchMethods.orig_path++;
      matched = true;
    }
  }

  // Method 3: Filename → Images (best single match = same plant)
  if (!matched) {
    const imgMatches = imgByFilename.get(fname) || [];
    if (imgMatches.length > 0) {
      const best = imgMatches[0]; // use first (could refine by size)
      statusBuckets[best.Status === 'assigned' ? 'assigned'
                  : best.Status === 'hidden'   ? 'hidden'
                  :                               'triage'].push({
        original: fp, nocodb_id: best.Id,
        status: best.Status, plant: best.Plant_Id,
        file_path: best.File_Path, method: 'filename_img',
      });
      matchMethods.filename_img++;
      matched = true;
    }
  }

  // Method 4: Filename → BinaryDocuments
  if (!matched) {
    const docMatches = docByFilename.get(fname) || [];
    if (docMatches.length > 0) {
      const best = docMatches[0];
      statusBuckets.binary_doc.push({
        original: fp, nocodb_id: best.Id,
        status: best.Status, plant: best.Plant_Id,
        file_path: best.File_Path, method: 'filename_doc',
      });
      matchMethods.filename_doc++;
      matched = true;
    }
  }

  if (!matched) {
    const ext = extOf(fname);
    const kind = IMG_EXTS.has(ext) ? 'image'
               : DOC_EXTS.has(ext) ? 'document'
               : ext.length > 10    ? 'extensionless'
               :                      ext || 'unknown';
    statusBuckets.no_record.push({ original: fp, ext, kind });
  }
}

// 6. Report
const total   = allFiles.length;
const covered = total - statusBuckets.no_record.length;

console.log('=== COVERAGE REPORT ===\n');
console.log(`  Total files in original/:   ${total.toLocaleString()}`);
console.log(`  Matched to NocoDB:          ${covered.toLocaleString()}  (${(covered/total*100).toFixed(2)}%)`);
console.log(`  No NocoDB record:           ${statusBuckets.no_record.length.toLocaleString()}  (${(statusBuckets.no_record.length/total*100).toFixed(2)}%)`);
console.log('');
console.log('  Matched breakdown by NocoDB status:');
console.log(`    assigned:     ${statusBuckets.assigned.length.toLocaleString()}`);
console.log(`    hidden:       ${statusBuckets.hidden.length.toLocaleString()}`);
console.log(`    triage:       ${statusBuckets.triage.length.toLocaleString()}`);
console.log(`    binary_doc:   ${statusBuckets.binary_doc.length.toLocaleString()}`);
console.log('');
console.log('  Match method breakdown:');
console.log(`    via Original_Filepath:    ${matchMethods.orig_path.toLocaleString()}`);
console.log(`    via filename (Images):    ${matchMethods.filename_img.toLocaleString()}`);
console.log(`    via filename (BinaryDocs):${matchMethods.filename_doc.toLocaleString()}`);

// Unmatched breakdown by kind
const noRecordByKind = {};
for (const f of statusBuckets.no_record) {
  noRecordByKind[f.kind] = (noRecordByKind[f.kind] || 0) + 1;
}
console.log('\n  Unmatched breakdown by type:');
for (const [k, n] of Object.entries(noRecordByKind).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(15)} ${n}`);
}

// Sample unmatched images
const uncovImg = statusBuckets.no_record.filter(f => f.kind === 'image');
if (uncovImg.length) {
  console.log(`\n  Unmatched images (${uncovImg.length} total, first 20):`);
  for (const f of uncovImg.slice(0, 20)) console.log(`    ${f.original}`);
}

const uncovDoc = statusBuckets.no_record.filter(f => f.kind === 'document');
if (uncovDoc.length) {
  console.log(`\n  Unmatched documents (${uncovDoc.length} total, first 10):`);
  for (const f of uncovDoc.slice(0, 10)) console.log(`    ${f.original}`);
}

const uncovExt = statusBuckets.no_record.filter(f => f.kind === 'extensionless');
if (uncovExt.length) {
  console.log(`\n  Still-unmatched extensionless (${uncovExt.length} total, first 5):`);
  for (const f of uncovExt.slice(0, 5)) console.log(`    ${f.original}`);
}

const uncovOther = statusBuckets.no_record.filter(f => !['image','document','extensionless'].includes(f.kind));
if (uncovOther.length) {
  console.log(`\n  Other unmatched (${uncovOther.length} total, first 10):`);
  for (const f of uncovOther.slice(0, 10)) console.log(`    ${f.original} [${f.ext}]`);
}

// Write full report
const reportPath = `content/backups/original-nocodb-reconciliation-${Date.now()}.json`;
writeFileSync(reportPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  totals: {
    original_files: total,
    matched: covered,
    coverage_pct: (covered / total * 100).toFixed(2),
    no_record: statusBuckets.no_record.length,
  },
  by_status: {
    assigned:   statusBuckets.assigned.length,
    hidden:     statusBuckets.hidden.length,
    triage:     statusBuckets.triage.length,
    binary_doc: statusBuckets.binary_doc.length,
  },
  unmatched_by_kind: noRecordByKind,
  unmatched_files: statusBuckets.no_record,
}, null, 2));
console.log(`\nFull report: ${reportPath}`);
