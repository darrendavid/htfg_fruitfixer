/**
 * recover-extensionless.mjs
 *
 * Finds all extensionless (or pseudo-extensionless) files in content/source/original/,
 * infers each file's true type from magic bytes / content sniffing,
 * copies them to content/pass_02/extensionless/{type}/,
 * and creates NocoDB BinaryDocuments records for each.
 *
 * Run:      node scripts/recover-extensionless.mjs
 * Dry-run:  node scripts/recover-extensionless.mjs --dry-run
 */

import {
  readFileSync, existsSync, readdirSync,
  mkdirSync, copyFileSync, writeFileSync, openSync, readSync, closeSync,
} from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: 'review-ui/.env' });

const DRY_RUN    = process.argv.includes('--dry-run');
const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const IDS  = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const H    = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };
const ORIG = 'content/source/original';
const DEST = 'content/pass_02/extensionless';

const SKIP_NAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store', '.localized']);

const norm = p => p?.replace(/\\/g, '/') || '';
const relC = p => { const n = norm(p); const i = n.indexOf('content/'); return i >= 0 ? n.slice(i) : n; };

// ── Magic byte detection ────────────────────────────────────────────────────────

function readMagic(absPath, len = 32) {
  try {
    const buf = Buffer.alloc(len);
    const fd  = openSync(absPath, 'r');
    const n   = readSync(fd, buf, 0, len, 0);
    closeSync(fd);
    return buf.slice(0, n);
  } catch { return Buffer.alloc(0); }
}

function inferType(absPath) {
  const magic = readMagic(absPath, 64);
  if (magic.length === 0) return { type: 'empty', ext: 'empty', mime: 'application/octet-stream' };

  const b = magic;

  // Image formats
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF)
    return { type: 'jpeg', ext: 'jpg', mime: 'image/jpeg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47)
    return { type: 'png', ext: 'png', mime: 'image/png' };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46)
    return { type: 'gif', ext: 'gif', mime: 'image/gif' };
  if (b[0] === 0x42 && b[1] === 0x4D)
    return { type: 'bmp', ext: 'bmp', mime: 'image/bmp' };
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A && b[3] === 0x00) ||
      (b[0] === 0x4D && b[1] === 0x4D && b[2] === 0x00 && b[3] === 0x2A))
    return { type: 'tiff', ext: 'tif', mime: 'image/tiff' };
  // macOS icon
  if (b[0] === 0x69 && b[1] === 0x63 && b[2] === 0x6E && b[3] === 0x73)
    return { type: 'icns', ext: 'icns', mime: 'image/x-icns' };
  // Photoshop PSD
  if (b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53)
    return { type: 'psd', ext: 'psd', mime: 'image/vnd.adobe.photoshop' };

  // Document formats
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46)
    return { type: 'pdf', ext: 'pdf', mime: 'application/pdf' };
  // OLE Compound Document (DOC, XLS, PPT)
  if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0)
    return { type: 'ole', ext: 'doc', mime: 'application/msword' };
  // PK ZIP (DOCX, XLSX, PPTX, ODT, etc.)
  if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04)
    return { type: 'zip-office', ext: 'docx', mime: 'application/zip' };
  // RTF
  if (b[0] === 0x7B && b[1] === 0x5C && b[2] === 0x72 && b[3] === 0x74 && b[4] === 0x66)
    return { type: 'rtf', ext: 'rtf', mime: 'application/rtf' };

  // HTML / XML
  const str = b.toString('utf-8').trimStart();
  if (str.match(/^<(!DOCTYPE|html|HTML)/i))
    return { type: 'html', ext: 'html', mime: 'text/html' };
  if (str.startsWith('<?xml') || str.startsWith('<xml'))
    return { type: 'xml', ext: 'xml', mime: 'application/xml' };

  // Plain text: all bytes in printable ASCII + common whitespace → likely text
  const isPrintable = Array.from(magic).every(c => c >= 0x09 && c <= 0x0D || c >= 0x20 && c <= 0x7E || c >= 0x80);
  if (isPrintable && magic.length > 0)
    return { type: 'text', ext: 'txt', mime: 'text/plain' };

  // Binary blob — unknown
  return { type: 'binary', ext: 'bin', mime: 'application/octet-stream' };
}

// ── Walk + filter extensionless ────────────────────────────────────────────────

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

function isExtensionless(absPath) {
  const fname = path.basename(absPath);
  if (!fname.includes('.')) return true;                     // no dot at all
  const ext = fname.split('.').pop();
  if (ext.length > 10) return true;                         // "extension" too long → not a real extension
  return false;
}

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
      console.error(`bulkCreate ${table} batch ${i}: ${await r.text()}`);
      continue;
    }
    const result = await r.json();
    created.push(...(Array.isArray(result) ? result : [result]));
  }
  return created;
}

// ── Plant inference from path ──────────────────────────────────────────────────

function inferPlantFromPath(absPath, plantSlugs) {
  // Use the directory names in the path as hints
  const parts = norm(absPath).toLowerCase().split('/');
  for (const part of parts.reverse()) {
    const clean = part.replace(/[^a-z0-9 ]/g, ' ').trim();
    for (const slug of plantSlugs) {
      const slugWords = slug.replace(/-/g, ' ');
      if (clean === slugWords || clean.includes(slugWords)) return slug;
    }
  }
  return null;
}

// ── Main ───────────────────────────────────────────────────────────────────────

console.log(`\n=== recover extensionless files (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) ===\n`);

// Load current BinaryDocuments to avoid duplicates
console.log('Fetching existing BinaryDocuments…');
const existingDocs = await fetchAll('BinaryDocuments', 'Id,File_Path,File_Name');
const existingByPath = new Map(existingDocs.map(r => [norm(r.File_Path || ''), r]));
console.log(`  ${existingDocs.length} existing records`);

// Load plants for inference
console.log('Fetching Plants…');
const plants = await fetchAll('Plants', 'Id1,Canonical_Name');
const plantSlugs = plants.map(p => p.Id1).filter(Boolean);
console.log(`  ${plants.length} plants`);

// Walk original/ and collect extensionless
console.log('\nWalking original/ for extensionless files…');
const allFiles    = walkDir(ORIG);
const noExtFiles  = allFiles.filter(isExtensionless);
console.log(`  ${noExtFiles.length} extensionless files found (of ${allFiles.length} total)\n`);

// Infer types + copy
const results  = [];
const typeCounts = {};
let skipped = 0, copied = 0, already = 0;

for (const absFile of noExtFiles) {
  const fname   = path.basename(absFile);
  const inferred = inferType(absFile);
  const { type, ext, mime } = inferred;

  typeCounts[type] = (typeCounts[type] || 0) + 1;

  // Destination: pass_02/extensionless/{type}/{original_subpath_from_original}/
  // Preserve the relative sub-path so provenance is clear
  const relFromOrig = norm(absFile).slice(norm(absFile).indexOf('original/') + 'original/'.length);
  const destRel     = `content/pass_02/extensionless/${type}/${relFromOrig}.${ext}`;
  const destAbs     = destRel;  // relative paths work on this machine

  // Skip if already has a BinaryDocuments record at dest
  if (existingByPath.has(destRel)) { already++; continue; }

  // Infer plant from path
  const plantId = inferPlantFromPath(absFile, plantSlugs);

  results.push({
    src:     absFile,
    dest:    destAbs,
    destRel,
    fname,
    type,
    ext,
    mime,
    plantId,
    originalPath: relC(absFile),
  });
}

console.log('Type breakdown:');
for (const [t, n] of Object.entries(typeCounts).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${t.padEnd(15)} ${n}`);
}
console.log(`  Already in NocoDB: ${already}`);
console.log(`  To process: ${results.length}\n`);

// Copy files
console.log('Copying files to pass_02/extensionless/…');
const docPayloads = [];

for (const r of results) {
  try {
    if (!DRY_RUN) {
      const dir = path.dirname(r.dest);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (!existsSync(r.dest)) {
        copyFileSync(r.src, r.dest);
        copied++;
      }
    } else {
      copied++;
    }

    docPayloads.push({
      File_Path:    r.destRel,
      File_Name:    r.fname,
      File_Type:    r.ext,
      Plant_Id:     r.plantId || null,
      Status:       r.plantId ? 'assigned' : 'triage',
      Excluded:     false,
      Description:  `Recovered extensionless file. Inferred type: ${r.type}. Original: ${r.originalPath}`,
      Original_Filepath: r.originalPath,
    });
  } catch (e) {
    console.error(`  copy failed: ${r.src} → ${r.destAbs}: ${e.message}`);
  }
}
console.log(`  Copied: ${copied}`);

// Create NocoDB BinaryDocuments records
console.log(`\nCreating ${docPayloads.length} NocoDB BinaryDocument records…`);
await bulkCreate('BinaryDocuments', docPayloads);
console.log('  done');

// Write report
const reportPath = `content/backups/extensionless-recovery-${Date.now()}.json`;
const report = {
  generated_at: new Date().toISOString(),
  dry_run: DRY_RUN,
  totals: {
    extensionless_found: noExtFiles.length,
    already_in_nocodb: already,
    copied: copied,
    nocodb_records_created: docPayloads.length,
  },
  type_breakdown: typeCounts,
  files: results.map(r => ({ src: r.originalPath, dest: r.destRel, type: r.type, plant: r.plantId })),
};
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log('\n=== SUMMARY ===');
console.log(`  Extensionless files found:  ${noExtFiles.length}`);
console.log(`  Already in NocoDB:          ${already}`);
console.log(`  Copied to pass_02:          ${copied}`);
console.log(`  NocoDB records created:     ${docPayloads.length}`);
console.log(`\nReport: ${reportPath}`);
if (DRY_RUN) console.log('\n[DRY RUN] No files copied or records created.');
