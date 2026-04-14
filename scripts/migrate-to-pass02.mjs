/**
 * migrate-to-pass02.mjs
 *
 * Migrates content/pass_01 → content/pass_02 using NocoDB as the source of truth.
 *
 * pass_02 structure:
 *   plants/<slug>/images/              ← Images: Status=assigned, Plant_Id set
 *   plants/<slug>/images/hidden/       ← Images: Status=hidden, Plant_Id set
 *   plants/<slug>/documents/           ← BinaryDocuments: Status=assigned, Plant_Id set
 *   plants/<slug>/documents/hidden/    ← BinaryDocuments: Status=hidden, Plant_Id set
 *   triage/                            ← Images: Status=triage, Plant_Id=null
 *   ignored/                           ← Images: Status=hidden, Plant_Id=null
 *   documents/
 *     triage/                          ← BinaryDocuments: Status=triage, Plant_Id=null
 *     ignored/                         ← BinaryDocuments: Status=hidden, Plant_Id=null
 *
 * Usage:
 *   node scripts/migrate-to-pass02.mjs [--dry-run] [--force]
 *
 *   --dry-run  Report what WOULD be done without copying or updating NocoDB.
 *   --force    Re-copy files even if destination already exists.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  mkdirSync,
  statSync,
  createReadStream,
} from 'fs';
import { readdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { config } from 'dotenv';

// ── Bootstrap ────────────────────────────────────────────────────────────────

config({ path: path.join(import.meta.dirname, '..', 'review-ui', '.env') });

const ROOT        = path.resolve(import.meta.dirname, '..');
const PASS01      = path.join(ROOT, 'content', 'pass_01');
const PASS02      = path.join(ROOT, 'content', 'pass_02');
const NOCODB_URL  = (process.env.NOCODB_URL || 'https://nocodb.djjd.us').replace(/\/+$/, '');
const NOCODB_KEY  = process.env.NOCODB_API_KEY;
const TABLE_IDS   = JSON.parse(
  readFileSync(path.join(ROOT, 'content', 'parsed', 'nocodb_table_ids.json'), 'utf-8')
);
const REPORT_PATH = path.join(ROOT, 'content', 'backups', 'pass02-migration-report.json');
const NOCODB_HEADERS = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

if (!NOCODB_KEY) {
  console.error('ERROR: NOCODB_API_KEY not set in review-ui/.env');
  process.exit(1);
}

if (DRY_RUN)  console.log('[DRY RUN] No files will be copied and NocoDB will not be updated.');
if (FORCE)    console.log('[FORCE] Destination files will be overwritten.');
console.log();

// ── File extension sets ───────────────────────────────────────────────────────

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.tif', '.tiff', '.bmp', '.svg',
]);

const DOC_EXTS = new Set([
  '.pdf', '.ppt', '.pptx', '.doc', '.docx',
  '.xls', '.xlsx', '.txt', '.psd', '.ai', '.eps',
]);

// ── NocoDB helpers ────────────────────────────────────────────────────────────

async function nocoRequest(method, path_, body) {
  const url = `${NOCODB_URL}${path_}`;
  const opts = { method, headers: NOCODB_HEADERS };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NocoDB ${method} ${path_} failed (${res.status}): ${text}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

async function fetchAll(table, fields = null) {
  const tid = TABLE_IDS[table];
  if (!tid) throw new Error(`Unknown NocoDB table: ${table}`);
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({ limit: '1000', offset: String(offset) });
    if (fields) params.set('fields', fields);
    const data = await nocoRequest('GET', `/api/v2/tables/${tid}/records?${params}`);
    all.push(...(data.list ?? []));
    if (data.pageInfo?.isLastPage || (data.list?.length ?? 0) < 1000) break;
    offset += 1000;
  }
  return all;
}

async function bulkCreate(table, records) {
  if (!records.length) return;
  const tid = TABLE_IDS[table];
  const CHUNK = 100;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    await nocoRequest('POST', `/api/v2/tables/${tid}/records`, chunk);
  }
}

async function bulkPatch(table, updates) {
  if (!updates.length) return;
  const tid = TABLE_IDS[table];
  const CHUNK = 100;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    await nocoRequest('PATCH', `/api/v2/tables/${tid}/records`, chunk);
  }
}

async function deleteRecord(table, id) {
  const tid = TABLE_IDS[table];
  await nocoRequest('DELETE', `/api/v2/tables/${tid}/records`, [{ Id: id }]);
}

// ── File helpers ──────────────────────────────────────────────────────────────

/** Compute MD5 of a file synchronously via streaming (sync wrapper). */
function md5File(absPath) {
  const buf = readFileSync(absPath);
  return crypto.createHash('md5').update(buf).digest('hex');
}

/** Normalise a NocoDB File_Path to an absolute disk path. */
function toAbs(fp) {
  if (!fp) return null;
  const norm = fp.replace(/\\/g, '/');
  if (path.isAbsolute(norm)) return path.normalize(norm);
  return path.join(ROOT, norm);
}

/** Normalise a NocoDB File_Path to a forward-slash relative path from ROOT. */
function toRelative(fp) {
  if (!fp) return null;
  const abs = toAbs(fp);
  return abs.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/') + '/', '');
}

/** Walk a directory recursively, returning absolute paths of all files. */
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

/**
 * Resolve a destination filename to avoid collisions.
 * If `dest` already exists (on disk), append _2, _3, ... until free.
 */
function resolveDestFilename(destDir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = filename;
  let n = 2;
  while (existsSync(path.join(destDir, candidate))) {
    candidate = `${base}_${n}${ext}`;
    n++;
  }
  return candidate;
}

// ── Destination path calculators ──────────────────────────────────────────────

function imageDestRelative(img) {
  const status  = (img.Status || '').toLowerCase();
  const plantId = img.Plant_Id;
  const filename = path.basename(img.File_Path?.replace(/\\/g, '/') || `image_${img.Id}`);

  if (plantId) {
    if (status === 'hidden') return `plants/${plantId}/images/hidden/${filename}`;
    return `plants/${plantId}/images/${filename}`;
  }
  if (status === 'hidden') return `ignored/${filename}`;
  return `triage/${filename}`;  // triage, unassigned, unclassified, null
}

function binaryDocDestRelative(doc) {
  const status  = (doc.Status || '').toLowerCase();
  const plantId = doc.Plant_Id;
  const filename = path.basename(doc.File_Path?.replace(/\\/g, '/') || `doc_${doc.Id}`);

  if (plantId) {
    if (status === 'hidden') return `plants/${plantId}/documents/hidden/${filename}`;
    return `plants/${plantId}/documents/${filename}`;
  }
  if (status === 'hidden') return `documents/ignored/${filename}`;
  return `documents/triage/${filename}`;
}

// ── Stub all plant subdirectories ─────────────────────────────────────────────

function stubPlantDirs(slugs) {
  for (const slug of slugs) {
    for (const sub of [
      `plants/${slug}/images`,
      `plants/${slug}/images/hidden`,
      `plants/${slug}/documents`,
      `plants/${slug}/documents/hidden`,
    ]) {
      const abs = path.join(PASS02, sub);
      if (!existsSync(abs)) {
        if (!DRY_RUN) mkdirSync(abs, { recursive: true });
      }
    }
  }
}

function ensureDir(abs) {
  if (!existsSync(abs) && !DRY_RUN) mkdirSync(abs, { recursive: true });
}

// ── Reporting structures ──────────────────────────────────────────────────────

const report = {
  generated_at: new Date().toISOString(),
  dry_run: DRY_RUN,
  force: FORCE,
  summary: {},
  images: {
    copied: 0,
    skipped_existing: 0,
    missing_on_disk: [],
    no_file_path: [],
    outside_known_roots: [],
    collisions_merged: [],
    collisions_renamed: [],
    errors: [],
    nocodb_updates: 0,
    nocodb_creates: 0,
    nocodb_deletes: 0,
  },
  binary_docs: {
    copied: 0,
    skipped_existing: 0,
    missing_on_disk: [],
    no_file_path: [],
    errors: [],
    nocodb_updates: 0,
    nocodb_creates: 0,
  },
  uncovered_pass01: {
    images_to_triage: [],
    images_to_ignored: [],
    docs_to_triage: [],
    errors: [],
    nocodb_creates: 0,
  },
};

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('Fetching NocoDB Images…');
const nocoImages = await fetchAll(
  'Images',
  'Id,File_Path,Plant_Id,Status,Size_Bytes'
);
console.log(`  ${nocoImages.length} image records`);

console.log('Fetching NocoDB BinaryDocuments…');
let nocoBinaryDocs = [];
try {
  nocoBinaryDocs = await fetchAll(
    'BinaryDocuments',
    'Id,File_Path,Plant_Id,Status'
  );
  console.log(`  ${nocoBinaryDocs.length} BinaryDocuments records`);
} catch (e) {
  console.warn(`  WARNING: BinaryDocuments table not accessible — ${e.message}`);
  console.warn('  Continuing without BinaryDocuments migration.');
}

console.log('Walking pass_01…');
const allPass01Files = await walkDir(PASS01);
console.log(`  ${allPass01Files.length} files on disk\n`);

// Normalise pass_01 paths to forward-slash for fast lookup
const pass01NormSet = new Set(allPass01Files.map(f => f.replace(/\\/g, '/')));

// Build a map of all files in pass_01 keyed by relative path for fast lookup
const pass01RelMap = new Map(); // relative -> abs
for (const abs of allPass01Files) {
  const rel = abs.replace(/\\/g, '/').replace(PASS01.replace(/\\/g, '/') + '/', '');
  pass01RelMap.set(rel, abs);
}

// ── Phase 1: Process NocoDB Images records ────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════════════');
console.log('PHASE 1: Migrating NocoDB Images records');
console.log('═══════════════════════════════════════════════════════════════════\n');

// Collect all unique plant slugs for directory stubbing
const slugsFromImages   = new Set();
const slugsFromBinDocs  = new Set();

for (const img of nocoImages) {
  if (img.Plant_Id) slugsFromImages.add(img.Plant_Id);
}
for (const doc of nocoBinaryDocs) {
  if (doc.Plant_Id) slugsFromBinDocs.add(doc.Plant_Id);
}
const allSlugs = new Set([...slugsFromImages, ...slugsFromBinDocs]);

console.log(`Stubbing directories for ${allSlugs.size} plant slugs…`);
stubPlantDirs(allSlugs);

// Ensure top-level folders exist
for (const d of ['triage', 'ignored', 'documents/triage', 'documents/ignored']) {
  ensureDir(path.join(PASS02, d));
}

// Track which dest paths have been claimed to handle collisions in-memory
// Maps destRelative (no pass02 prefix) → [{ recordId, srcAbs }]
const destClaimedBy = new Map();

// Pending NocoDB updates { Id, File_Path }
const imageNocoUpdates  = [];
const imageNocoDeletes  = [];

// Track which pass_01 files are covered by NocoDB records
const coveredPass01Abs = new Set();

let processedImages = 0;

for (const img of nocoImages) {
  processedImages++;
  if (processedImages % 1000 === 0) {
    process.stdout.write(`  Processed ${processedImages}/${nocoImages.length} image records…\r`);
  }

  // ── No File_Path ──
  if (!img.File_Path) {
    report.images.no_file_path.push({ id: img.Id, plant: img.Plant_Id, status: img.Status });
    continue;
  }

  const srcAbs = toAbs(img.File_Path);
  const fpNorm = srcAbs.replace(/\\/g, '/');

  // ── Determine if file is in a known root ──
  const inPass01  = fpNorm.includes('/pass_01/');
  const inParsed  = fpNorm.includes('/content/parsed/');

  if (!inPass01 && !inParsed) {
    report.images.outside_known_roots.push({
      id: img.Id, file_path: img.File_Path, plant: img.Plant_Id, status: img.Status,
    });
    continue;
  }

  // ── Check file exists on disk ──
  if (!existsSync(srcAbs)) {
    report.images.missing_on_disk.push({
      id: img.Id, src: fpNorm, plant: img.Plant_Id, status: img.Status,
    });
    continue;
  }

  coveredPass01Abs.add(fpNorm);

  // ── Determine destination ──
  const destRel  = imageDestRelative(img);
  const destDir  = path.join(PASS02, path.dirname(destRel));
  const destFile = path.basename(destRel);
  ensureDir(destDir);

  // ── Collision handling ──
  let finalDestRel = destRel;

  if (destClaimedBy.has(destRel)) {
    // Collision: another record already mapped to this destination
    const prior = destClaimedBy.get(destRel);

    // Compute MD5 of both files
    let md5Current, md5Prior;
    try {
      md5Current = md5File(srcAbs);
      md5Prior   = md5File(prior.srcAbs);
    } catch (e) {
      report.images.errors.push({ id: img.Id, src: fpNorm, error: `MD5 failed: ${e.message}` });
      continue;
    }

    if (md5Current === md5Prior) {
      // Identical files — keep the earlier record, delete this one from NocoDB
      report.images.collisions_merged.push({
        kept_id: prior.recordId, deleted_id: img.Id,
        dest: destRel, md5: md5Current,
      });
      if (!DRY_RUN) {
        try {
          await deleteRecord('Images', img.Id);
          report.images.nocodb_deletes++;
        } catch (e) {
          report.images.errors.push({ id: img.Id, error: `Delete failed: ${e.message}` });
        }
      }
      continue;
    } else {
      // Different files — rename this one with _N suffix
      const ext  = path.extname(destFile);
      const base = path.basename(destFile, ext);
      let n = 2;
      let candidate;
      do {
        candidate = `${base}_${n}${ext}`;
        n++;
      } while (
        destClaimedBy.has(path.dirname(destRel) + '/' + candidate) ||
        existsSync(path.join(destDir, candidate))
      );

      finalDestRel = `${path.dirname(destRel)}/${candidate}`;
      report.images.collisions_renamed.push({
        id: img.Id, original_dest: destRel, renamed_dest: finalDestRel,
      });
    }
  }

  // Register this destination as claimed
  destClaimedBy.set(finalDestRel, { recordId: img.Id, srcAbs });

  const finalDestAbs = path.join(PASS02, finalDestRel);
  const newFilePath  = `content/pass_02/${finalDestRel}`;

  // ── Copy file ──
  if (existsSync(finalDestAbs) && !FORCE) {
    report.images.skipped_existing++;
  } else {
    if (!DRY_RUN) {
      try {
        copyFileSync(srcAbs, finalDestAbs);
        report.images.copied++;
      } catch (e) {
        report.images.errors.push({ id: img.Id, src: fpNorm, dest: finalDestRel, error: e.message });
        continue;
      }
    } else {
      report.images.copied++; // dry-run: count as would-be-copied
    }
  }

  // ── Queue NocoDB File_Path update ──
  const currentRelPath = toRelative(img.File_Path);
  if (currentRelPath !== newFilePath) {
    imageNocoUpdates.push({ Id: img.Id, File_Path: newFilePath });
  }
}

console.log(`\n  Done. ${report.images.copied} copied, ${report.images.skipped_existing} skipped (existing).`);

// ── Post-Phase-1: Reverse-map pass_02 paths → pass_01 source files ────────────
// Records already at pass_02 paths (from a previous migration run) won't have
// their original pass_01 paths in coveredPass01Abs. Infer them to prevent
// Phase 3 from creating duplicate records for already-migrated files.
console.log('\n  Reverse-mapping already-migrated records to pass_01 sources…');
let reverseMapped = 0;
for (const img of nocoImages) {
  if (!img.File_Path) continue;
  const fpNorm = img.File_Path.replace(/\\/g, '/');
  if (!fpNorm.includes('/pass_02/')) continue;

  const pass02Rel = fpNorm.replace(/^.*\/pass_02\//, '');

  // plants/<slug>/images/[hidden/]<file>
  const m = pass02Rel.match(/^plants\/([^/]+)\/images(?:\/hidden)?\/([^/]+)$/);
  if (m) {
    const [, slug, filename] = m;
    // Try the canonical pass_01 assigned path first, then hidden variants
    const candidates = [
      path.join(PASS01, 'assigned', slug, 'images', filename),
      path.join(PASS01, 'hidden', slug, 'images', filename),
      path.join(PASS01, 'hidden', filename),
      path.join(ROOT, 'content', 'parsed', 'plants', slug, 'images', filename),
    ];
    for (const c of candidates) {
      const cn = c.replace(/\\/g, '/');
      if (pass01NormSet.has(cn)) {
        coveredPass01Abs.add(cn);
        reverseMapped++;
        break;
      }
    }
    continue;
  }

  // triage/<file> or ignored/<file>
  const tm = pass02Rel.match(/^(?:triage|ignored)\/([^/]+)$/);
  if (tm) {
    const filename = tm[1];
    // Search common unassigned/ignored locations
    const candidates = [
      path.join(PASS01, 'unassigned', '_to_triage', filename),
      path.join(PASS01, 'unassigned', 'ignored', filename),
      path.join(PASS01, 'unassigned', 'unclassified', filename),
      path.join(PASS01, 'ignored', filename),
    ];
    for (const c of candidates) {
      const cn = c.replace(/\\/g, '/');
      if (pass01NormSet.has(cn)) {
        coveredPass01Abs.add(cn);
        reverseMapped++;
        break;
      }
    }
  }
}
console.log(`  Reverse-mapped ${reverseMapped} pass_01 sources from pass_02 records.\n`);

// ── Phase 2: Process NocoDB BinaryDocuments records ───────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('PHASE 2: Migrating NocoDB BinaryDocuments records');
console.log('═══════════════════════════════════════════════════════════════════\n');

const docNocoUpdates = [];
let processedDocs    = 0;

for (const doc of nocoBinaryDocs) {
  processedDocs++;
  if (processedDocs % 200 === 0) {
    process.stdout.write(`  Processed ${processedDocs}/${nocoBinaryDocs.length} BinaryDoc records…\r`);
  }

  if (!doc.File_Path) {
    report.binary_docs.no_file_path.push({ id: doc.Id, plant: doc.Plant_Id, status: doc.Status });
    continue;
  }

  const srcAbs = toAbs(doc.File_Path);
  const fpNorm = srcAbs.replace(/\\/g, '/');

  if (!existsSync(srcAbs)) {
    report.binary_docs.missing_on_disk.push({
      id: doc.Id, src: fpNorm, plant: doc.Plant_Id, status: doc.Status,
    });
    continue;
  }

  coveredPass01Abs.add(fpNorm);

  const destRel   = binaryDocDestRelative(doc);
  const destDir   = path.join(PASS02, path.dirname(destRel));
  const destFile  = path.basename(destRel);
  ensureDir(destDir);

  // Simple collision: append _N if dest already exists
  let finalFile = destFile;
  if (existsSync(path.join(destDir, destFile)) && !FORCE) {
    // Check if this is the same file we already wrote (idempotency)
    finalFile = resolveDestFilename(destDir, destFile);
  }

  const finalDestAbs = path.join(destDir, finalFile);
  const finalDestRel = `${path.dirname(destRel)}/${finalFile}`;
  const newFilePath  = `content/pass_02/${finalDestRel}`;

  if (existsSync(finalDestAbs) && !FORCE) {
    report.binary_docs.skipped_existing++;
  } else {
    if (!DRY_RUN) {
      try {
        copyFileSync(srcAbs, finalDestAbs);
        report.binary_docs.copied++;
      } catch (e) {
        report.binary_docs.errors.push({ id: doc.Id, src: fpNorm, error: e.message });
        continue;
      }
    } else {
      report.binary_docs.copied++;
    }
  }

  const currentRelPath = toRelative(doc.File_Path);
  if (currentRelPath !== newFilePath) {
    docNocoUpdates.push({ Id: doc.Id, File_Path: newFilePath });
  }
}

console.log(`\n  Done. ${report.binary_docs.copied} copied, ${report.binary_docs.skipped_existing} skipped (existing).`);

// ── Phase 3: Handle pass_01 files NOT covered by NocoDB ───────────────────────

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('PHASE 3: Handling pass_01 files with no NocoDB record');
console.log('═══════════════════════════════════════════════════════════════════\n');

// Build set of NocoDB File_Paths that already exist (for idempotency)
// This prevents re-creating records if the migration runs more than once
console.log('  Building existing NocoDB path index for idempotency...');
const existingNocoImagePaths = new Set(
  nocoImages.map(img => img.File_Path?.replace(/\\/g, '/')).filter(Boolean)
);
const existingNocoDocPaths = new Set(
  nocoBinaryDocs.map(doc => doc.File_Path?.replace(/\\/g, '/')).filter(Boolean)
);
// Also load any newly-created pass_02 paths from Phase 4 creates that might already be in NocoDB
// (from a prior partial run — we fetch them fresh)
const freshImageCheck = await fetchAll('Images', 'File_Path');
freshImageCheck.forEach(img => {
  if (img.File_Path) existingNocoImagePaths.add(img.File_Path.replace(/\\/g, '/'));
});
const freshDocCheck = await fetchAll('BinaryDocuments', 'File_Path');
freshDocCheck.forEach(doc => {
  if (doc.File_Path) existingNocoDocPaths.add(doc.File_Path.replace(/\\/g, '/'));
});
console.log(`  ${existingNocoImagePaths.size} existing Image paths, ${existingNocoDocPaths.size} BinaryDoc paths indexed\n`);

const imageNocoCreates   = [];
const binaryDocCreates   = [];

for (const absFile of allPass01Files) {
  const normAbs = absFile.replace(/\\/g, '/');
  if (coveredPass01Abs.has(normAbs)) continue;

  const ext     = path.extname(absFile).toLowerCase();
  const relPath = normAbs.replace(PASS01.replace(/\\/g, '/') + '/', '');
  const topDir  = relPath.split('/')[0];
  const filename = path.basename(absFile);

  // Skip non-media metadata files
  if (['.json', '.csv', '.html', '.ini', '.txt'].includes(ext) && !DOC_EXTS.has(ext)) continue;
  if (filename === 'desktop.ini' || filename.endsWith('.lnk')) continue;

  if (IMAGE_EXTS.has(ext)) {
    // Images in assigned/ → triage; everything else → ignored
    let destFolder;
    if (topDir === 'assigned') {
      destFolder = 'triage';
      report.uncovered_pass01.images_to_triage.push(relPath);
    } else {
      // hidden/, unassigned/, ignored/, design/ image files
      destFolder = 'ignored';
      report.uncovered_pass01.images_to_ignored.push(relPath);
    }

    ensureDir(path.join(PASS02, destFolder));
    const resolvedName = resolveDestFilename(path.join(PASS02, destFolder), filename);
    const destAbs      = path.join(PASS02, destFolder, resolvedName);
    const newFilePath  = `content/pass_02/${destFolder}/${resolvedName}`;

    if (!existsSync(destAbs) || FORCE) {
      if (!DRY_RUN) {
        try {
          copyFileSync(absFile, destAbs);
        } catch (e) {
          report.uncovered_pass01.errors.push({ src: relPath, error: e.message });
          continue;
        }
      }
    }

    if (!existingNocoImagePaths.has(newFilePath)) {
      imageNocoCreates.push({
        File_Path: newFilePath,
        Status: destFolder === 'triage' ? 'triage' : 'hidden',
        Plant_Id: null,
        Confidence: 0,
        Source_Directory: path.dirname(relPath),
      });
      existingNocoImagePaths.add(newFilePath); // prevent same path being added twice in one run
    }

  } else if (DOC_EXTS.has(ext)) {
    // Non-image doc files
    let destFolder;
    if (topDir === 'design' || topDir === 'assigned') {
      destFolder = 'documents/triage';
    } else {
      destFolder = 'documents/ignored';
    }

    ensureDir(path.join(PASS02, destFolder));
    const resolvedName = resolveDestFilename(path.join(PASS02, destFolder), filename);
    const destAbs      = path.join(PASS02, destFolder, resolvedName);
    const newFilePath  = `content/pass_02/${destFolder}/${resolvedName}`;

    report.uncovered_pass01.docs_to_triage.push(relPath);

    if (!existsSync(destAbs) || FORCE) {
      if (!DRY_RUN) {
        try {
          copyFileSync(absFile, destAbs);
        } catch (e) {
          report.uncovered_pass01.errors.push({ src: relPath, error: e.message });
          continue;
        }
      }
    }

    if (!existingNocoDocPaths.has(newFilePath)) {
      binaryDocCreates.push({
        File_Path: newFilePath,
        Status: 'triage',
        Plant_Id: null,
      });
      existingNocoDocPaths.add(newFilePath); // prevent same path being added twice in one run
    }
  }
  // else: skip files with unrecognised extensions (UserSelections.txt etc.)
}

console.log(`  ${report.uncovered_pass01.images_to_triage.length} uncovered images → triage/`);
console.log(`  ${report.uncovered_pass01.images_to_ignored.length} uncovered images → ignored/`);
console.log(`  ${report.uncovered_pass01.docs_to_triage.length} uncovered docs → documents/triage|ignored/`);

// ── Phase 4: Apply NocoDB updates ─────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('PHASE 4: Updating NocoDB records');
console.log('═══════════════════════════════════════════════════════════════════\n');

if (!DRY_RUN) {
  // Update Image File_Paths
  if (imageNocoUpdates.length) {
    console.log(`  PATCH Images: ${imageNocoUpdates.length} records…`);
    try {
      await bulkPatch('Images', imageNocoUpdates);
      report.images.nocodb_updates = imageNocoUpdates.length;
    } catch (e) {
      console.error(`  ERROR patching Images: ${e.message}`);
      report.images.errors.push({ error: `Bulk PATCH failed: ${e.message}` });
    }
  }

  // Update BinaryDoc File_Paths
  if (docNocoUpdates.length) {
    console.log(`  PATCH BinaryDocuments: ${docNocoUpdates.length} records…`);
    try {
      await bulkPatch('BinaryDocuments', docNocoUpdates);
      report.binary_docs.nocodb_updates = docNocoUpdates.length;
    } catch (e) {
      console.error(`  ERROR patching BinaryDocuments: ${e.message}`);
      report.binary_docs.errors.push({ error: `Bulk PATCH failed: ${e.message}` });
    }
  }

  // Create new Images records for uncovered pass_01 files
  if (imageNocoCreates.length) {
    console.log(`  CREATE Images: ${imageNocoCreates.length} new records…`);
    try {
      await bulkCreate('Images', imageNocoCreates);
      report.uncovered_pass01.nocodb_creates += imageNocoCreates.length;
    } catch (e) {
      console.error(`  ERROR creating Images: ${e.message}`);
      report.uncovered_pass01.errors.push({ error: `Bulk CREATE Images failed: ${e.message}` });
    }
  }

  // Create new BinaryDocuments records for uncovered pass_01 doc files
  if (binaryDocCreates.length && nocoBinaryDocs.length > 0) {
    console.log(`  CREATE BinaryDocuments: ${binaryDocCreates.length} new records…`);
    try {
      await bulkCreate('BinaryDocuments', binaryDocCreates);
      report.uncovered_pass01.nocodb_creates += binaryDocCreates.length;
    } catch (e) {
      console.error(`  ERROR creating BinaryDocuments: ${e.message}`);
      report.uncovered_pass01.errors.push({ error: `Bulk CREATE BinaryDocuments failed: ${e.message}` });
    }
  }
} else {
  // Dry-run: just report counts
  report.images.nocodb_updates  = imageNocoUpdates.length;
  report.binary_docs.nocodb_updates = docNocoUpdates.length;
  report.uncovered_pass01.nocodb_creates = imageNocoCreates.length + binaryDocCreates.length;

  console.log(`  [dry-run] Would PATCH ${imageNocoUpdates.length} Images records`);
  console.log(`  [dry-run] Would PATCH ${docNocoUpdates.length} BinaryDocuments records`);
  console.log(`  [dry-run] Would DELETE ${report.images.collisions_merged.length} duplicate Images records`);
  console.log(`  [dry-run] Would CREATE ${imageNocoCreates.length} new Images records`);
  console.log(`  [dry-run] Would CREATE ${binaryDocCreates.length} new BinaryDocuments records`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

report.images.nocodb_deletes = DRY_RUN
  ? report.images.collisions_merged.length
  : report.images.nocodb_deletes;

report.binary_docs.nocodb_creates = DRY_RUN
  ? binaryDocCreates.length
  : report.binary_docs.nocodb_creates;

report.images.nocodb_creates = DRY_RUN
  ? imageNocoCreates.length
  : report.images.nocodb_creates;

report.summary = {
  images_copied:               report.images.copied,
  images_skipped_existing:     report.images.skipped_existing,
  images_missing_on_disk:      report.images.missing_on_disk.length,
  images_no_file_path:         report.images.no_file_path.length,
  images_outside_known_roots:  (report.images.outside_known_roots ?? []).length,
  images_collisions_merged:    report.images.collisions_merged.length,
  images_collisions_renamed:   report.images.collisions_renamed.length,
  images_errors:               report.images.errors.length,
  images_nocodb_updates:       report.images.nocodb_updates,
  images_nocodb_deletes:       report.images.nocodb_deletes,
  images_nocodb_creates:       report.images.nocodb_creates,
  binary_docs_copied:          report.binary_docs.copied,
  binary_docs_skipped:         report.binary_docs.skipped_existing,
  binary_docs_missing:         report.binary_docs.missing_on_disk.length,
  binary_docs_nocodb_updates:  report.binary_docs.nocodb_updates,
  binary_docs_nocodb_creates:  report.binary_docs.nocodb_creates,
  uncovered_images_to_triage:  report.uncovered_pass01.images_to_triage.length,
  uncovered_images_to_ignored: report.uncovered_pass01.images_to_ignored.length,
  uncovered_docs_to_triage:    report.uncovered_pass01.docs_to_triage.length,
  uncovered_nocodb_creates:    report.uncovered_pass01.nocodb_creates,
  uncovered_errors:            report.uncovered_pass01.errors.length,
};

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('MIGRATION SUMMARY');
console.log('═══════════════════════════════════════════════════════════════════\n');

const s = report.summary;
console.log('Images:');
console.log(`  Copied:                      ${s.images_copied}`);
console.log(`  Skipped (already exist):     ${s.images_skipped_existing}`);
console.log(`  Missing on disk:             ${s.images_missing_on_disk}`);
console.log(`  No File_Path in NocoDB:      ${s.images_no_file_path}`);
console.log(`  Outside known roots:         ${s.images_outside_known_roots}`);
console.log(`  Collision → merged (deleted):${s.images_collisions_merged}`);
console.log(`  Collision → renamed:         ${s.images_collisions_renamed}`);
console.log(`  Errors:                      ${s.images_errors}`);
console.log(`  NocoDB File_Path updates:    ${s.images_nocodb_updates}`);
console.log(`  NocoDB record deletes:       ${s.images_nocodb_deletes}`);
console.log(`  NocoDB record creates:       ${s.images_nocodb_creates}`);
console.log('\nBinaryDocuments:');
console.log(`  Copied:                      ${s.binary_docs_copied}`);
console.log(`  Skipped (already exist):     ${s.binary_docs_skipped}`);
console.log(`  Missing on disk:             ${s.binary_docs_missing}`);
console.log(`  NocoDB File_Path updates:    ${s.binary_docs_nocodb_updates}`);
console.log(`  NocoDB record creates:       ${s.binary_docs_nocodb_creates}`);
console.log('\nUncovered pass_01 files:');
console.log(`  Images → triage/:            ${s.uncovered_images_to_triage}`);
console.log(`  Images → ignored/:           ${s.uncovered_images_to_ignored}`);
console.log(`  Docs   → documents/triage:   ${s.uncovered_docs_to_triage}`);
console.log(`  NocoDB creates:              ${s.uncovered_nocodb_creates}`);
console.log(`  Errors:                      ${s.uncovered_errors}`);

if (report.images.errors.length) {
  console.log(`\n⚠  ${report.images.errors.length} image errors — see report for details.`);
}
if (report.binary_docs.errors.length) {
  console.log(`⚠  ${report.binary_docs.errors.length} BinaryDoc errors — see report for details.`);
}
if (report.uncovered_pass01.errors.length) {
  console.log(`⚠  ${report.uncovered_pass01.errors.length} uncovered-file errors — see report for details.`);
}

// ── Write report ──────────────────────────────────────────────────────────────

mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
console.log(`\nFull report written to: ${REPORT_PATH}`);
if (DRY_RUN) {
  console.log('\n[DRY RUN] No files were copied and NocoDB was not modified.');
}
