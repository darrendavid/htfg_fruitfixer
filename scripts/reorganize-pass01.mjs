/**
 * Pass 01 Reorganization Script
 *
 * Copies all known binary files into content/pass_01/ with three folders:
 * - assigned/{fruit-slug}/images/ and assigned/{fruit-slug}/attachments/
 * - hidden/ (flat, files that are hidden/excluded)
 * - unassigned/ (maintains original source directory structure)
 *
 * Then updates NocoDB File_Path references for assigned files.
 */

import { config } from 'dotenv';
import { join, dirname, basename, extname } from 'path';
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';

config({ path: join(import.meta.dirname, '..', '.env') });

const API_KEY = process.env.NOCODB_API_KEY;
const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const CONTENT_ROOT = join(import.meta.dirname, '..', 'content');
const PASS01 = join(CONTENT_ROOT, 'pass_01');
const IMAGES_TABLE = 'mtc4c91lrkg83zy';
const ATTACHMENTS_TABLE = 'mb71zcf6b19naen';
const PLANTS_TABLE = 'mnd5jq4vjf1inkh';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_DB_UPDATE = process.argv.includes('--skip-db-update');

// Stats tracking
const stats = {
  assigned: { total: 0, copied: 0, skipped: 0, errors: 0, byPlant: {} },
  hidden: { total: 0, copied: 0, skipped: 0, errors: 0 },
  unassigned: { total: 0, copied: 0, skipped: 0, errors: 0 },
  attachments: { total: 0, copied: 0, skipped: 0, errors: 0 },
  dbUpdated: 0,
};

async function nocoList(tableId, options = {}) {
  const params = new URLSearchParams();
  if (options.where) params.set('where', options.where);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  if (options.fields) params.set('fields', options.fields.join(','));
  const res = await fetch(`${NOCODB_URL}/api/v2/tables/${tableId}/records?${params}`, {
    headers: { 'xc-token': API_KEY },
  });
  if (!res.ok) throw new Error(`NocoDB list failed: ${res.status}`);
  return res.json();
}

async function nocoUpdate(tableId, records) {
  const res = await fetch(`${NOCODB_URL}/api/v2/tables/${tableId}/records`, {
    method: 'PATCH',
    headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(records),
  });
  if (!res.ok) throw new Error(`NocoDB update failed: ${res.status}`);
  return res.json();
}

async function fetchAll(tableId, where, fields) {
  const all = [];
  let offset = 0;
  while (true) {
    const result = await nocoList(tableId, { where, limit: 200, offset, fields });
    all.push(...result.list);
    if (result.pageInfo?.isLastPage || result.list.length === 0) break;
    offset += 200;
  }
  return all;
}

function resolveSourcePath(filePath) {
  // Try multiple base paths to find the actual file
  const bases = [
    CONTENT_ROOT,                          // content/parsed/...
    join(CONTENT_ROOT, '..'),              // relative to project root
  ];

  for (const base of bases) {
    const full = join(base, filePath);
    if (existsSync(full)) return full;
  }

  // Try without content/ prefix
  const stripped = filePath.replace(/^content\//, '');
  for (const base of bases) {
    const full = join(base, stripped);
    if (existsSync(full)) return full;
  }

  return null;
}

function safeCopy(src, dest) {
  if (DRY_RUN) return true;
  try {
    const dir = dirname(dest);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // Handle filename conflicts
    let finalDest = dest;
    if (existsSync(dest)) {
      const ext = extname(dest);
      const stem = basename(dest, ext);
      let counter = 1;
      while (existsSync(finalDest)) {
        finalDest = join(dirname(dest), `${stem}_${counter}${ext}`);
        counter++;
      }
    }

    copyFileSync(src, finalDest);
    return true;
  } catch (err) {
    console.error(`  COPY ERROR: ${src} → ${dest}: ${err.message}`);
    return false;
  }
}

async function run() {
  console.log(`Pass 01 Reorganization${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`Content root: ${CONTENT_ROOT}`);
  console.log(`Output: ${PASS01}`);
  console.log('');

  // Create base directories
  if (!DRY_RUN) {
    mkdirSync(join(PASS01, 'assigned'), { recursive: true });
    mkdirSync(join(PASS01, 'hidden'), { recursive: true });
    mkdirSync(join(PASS01, 'unassigned'), { recursive: true });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. ASSIGNED IMAGES — copy to assigned/{plant-slug}/images/
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('=== ASSIGNED IMAGES ===');
  const assigned = await fetchAll(IMAGES_TABLE, '(Status,eq,assigned)', ['Id', 'File_Path', 'Plant_Id']);
  stats.assigned.total = assigned.length;
  console.log(`  Found: ${assigned.length}`);

  const dbUpdates = []; // {Id, newPath} for assigned images

  for (const img of assigned) {
    const src = resolveSourcePath(img.File_Path);
    if (!src) {
      stats.assigned.errors++;
      continue;
    }

    const slug = img.Plant_Id || 'unknown';
    const fileName = basename(src);
    const destDir = join(PASS01, 'assigned', slug, 'images');
    const dest = join(destDir, fileName);

    // Track per-plant counts
    stats.assigned.byPlant[slug] = (stats.assigned.byPlant[slug] || 0) + 1;

    if (safeCopy(src, dest)) {
      stats.assigned.copied++;
      // New path relative to content/
      const newRelPath = `pass_01/assigned/${slug}/images/${fileName}`;
      dbUpdates.push({ Id: img.Id, File_Path: `content/${newRelPath}` });
    } else {
      stats.assigned.errors++;
    }

    if (stats.assigned.copied % 500 === 0 && stats.assigned.copied > 0) {
      console.log(`  Progress: ${stats.assigned.copied}/${assigned.length}`);
    }
  }
  console.log(`  Copied: ${stats.assigned.copied}, Errors: ${stats.assigned.errors}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. HIDDEN IMAGES — copy to hidden/ (flat structure)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n=== HIDDEN IMAGES ===');
  const hidden = await fetchAll(IMAGES_TABLE, '(Status,eq,hidden)', ['Id', 'File_Path', 'Plant_Id']);
  stats.hidden.total = hidden.length;
  console.log(`  Found: ${hidden.length}`);

  for (const img of hidden) {
    const src = resolveSourcePath(img.File_Path);
    if (!src) { stats.hidden.errors++; continue; }

    const fileName = basename(src);
    const dest = join(PASS01, 'hidden', fileName);

    if (safeCopy(src, dest)) {
      stats.hidden.copied++;
    } else {
      stats.hidden.errors++;
    }
  }
  console.log(`  Copied: ${stats.hidden.copied}, Errors: ${stats.hidden.errors}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. UNASSIGNED/UNCLASSIFIED IMAGES — copy to unassigned/ with original structure
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n=== UNASSIGNED/UNCLASSIFIED IMAGES ===');
  const unassigned = await fetchAll(IMAGES_TABLE, '(Status,eq,unassigned)~or(Status,eq,unclassified)', ['Id', 'File_Path']);
  stats.unassigned.total = unassigned.length;
  console.log(`  Found: ${unassigned.length}`);

  const seenUnassigned = new Set(); // Deduplicate by resolved source path

  for (const img of unassigned) {
    const src = resolveSourcePath(img.File_Path);
    if (!src) { stats.unassigned.errors++; continue; }

    if (seenUnassigned.has(src)) { stats.unassigned.skipped++; continue; }
    seenUnassigned.add(src);

    // Maintain original source directory structure
    // Strip content/parsed/ or content/source/ prefix to get relative path
    let relPath = img.File_Path
      .replace(/^content\/parsed\//, '')
      .replace(/^content\/source\//, '')
      .replace(/^content\/website\//, '');

    const dest = join(PASS01, 'unassigned', relPath);

    if (safeCopy(src, dest)) {
      stats.unassigned.copied++;
    } else {
      stats.unassigned.errors++;
    }

    if (stats.unassigned.copied % 500 === 0 && stats.unassigned.copied > 0) {
      console.log(`  Progress: ${stats.unassigned.copied}/${unassigned.length}`);
    }
  }
  console.log(`  Copied: ${stats.unassigned.copied}, Skipped (dupes): ${stats.unassigned.skipped}, Errors: ${stats.unassigned.errors}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. ATTACHMENTS — copy to assigned/{plant-slug}/attachments/
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n=== ATTACHMENTS ===');
  const attachments = await fetchAll(ATTACHMENTS_TABLE, '', ['Id', 'File_Path', 'Plant_Ids']);
  stats.attachments.total = attachments.length;
  console.log(`  Found: ${attachments.length}`);

  for (const att of attachments) {
    const src = resolveSourcePath(att.File_Path);
    if (!src) { stats.attachments.errors++; continue; }

    // Get first plant ID from Plant_Ids JSON
    let slug = 'unknown';
    try {
      const ids = JSON.parse(att.Plant_Ids || '[]');
      if (ids.length > 0) slug = ids[0];
    } catch {}

    const fileName = basename(src);
    const dest = join(PASS01, 'assigned', slug, 'attachments', fileName);

    if (safeCopy(src, dest)) {
      stats.attachments.copied++;
    } else {
      stats.attachments.errors++;
    }
  }
  console.log(`  Copied: ${stats.attachments.copied}, Errors: ${stats.attachments.errors}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. UPDATE DATABASE REFERENCES for assigned images
  // ═══════════════════════════════════════════════════════════════════════════
  if (!SKIP_DB_UPDATE && !DRY_RUN && dbUpdates.length > 0) {
    console.log(`\n=== UPDATING DATABASE (${dbUpdates.length} records) ===`);
    for (let i = 0; i < dbUpdates.length; i += 100) {
      const batch = dbUpdates.slice(i, i + 100);
      try {
        await nocoUpdate(IMAGES_TABLE, batch);
        stats.dbUpdated += batch.length;
        console.log(`  Updated: ${Math.min(i + 100, dbUpdates.length)}/${dbUpdates.length}`);
      } catch (err) {
        console.error(`  DB update error at ${i}: ${err.message}`);
      }
    }
  } else if (DRY_RUN) {
    console.log(`\n=== WOULD UPDATE ${dbUpdates.length} database records ===`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT
  // ═══════════════════════════════════════════════════════════════════════════
  const report = {
    generated: new Date().toISOString(),
    summary: {
      assigned_images: { total: stats.assigned.total, copied: stats.assigned.copied, errors: stats.assigned.errors },
      hidden_images: { total: stats.hidden.total, copied: stats.hidden.copied, errors: stats.hidden.errors },
      unassigned_images: { total: stats.unassigned.total, copied: stats.unassigned.copied, skipped: stats.unassigned.skipped, errors: stats.unassigned.errors },
      attachments: { total: stats.attachments.total, copied: stats.attachments.copied, errors: stats.attachments.errors },
      db_records_updated: stats.dbUpdated,
    },
    assigned_by_plant: Object.entries(stats.assigned.byPlant)
      .sort((a, b) => b[1] - a[1])
      .map(([slug, count]) => ({ plant: slug, images: count })),
  };

  console.log('\n' + '='.repeat(60));
  console.log('REORGANIZATION REPORT');
  console.log('='.repeat(60));
  console.log(`Assigned images: ${stats.assigned.copied} copied (${Object.keys(stats.assigned.byPlant).length} plants)`);
  console.log(`Hidden images:   ${stats.hidden.copied} copied`);
  console.log(`Unassigned:      ${stats.unassigned.copied} copied (${stats.unassigned.skipped} dupes skipped)`);
  console.log(`Attachments:     ${stats.attachments.copied} copied`);
  console.log(`DB updated:      ${stats.dbUpdated} records`);
  console.log(`Total errors:    ${stats.assigned.errors + stats.hidden.errors + stats.unassigned.errors + stats.attachments.errors}`);
  console.log('\nTop 10 plants by image count:');
  report.assigned_by_plant.slice(0, 10).forEach(p => console.log(`  ${p.plant}: ${p.images}`));

  const reportPath = join(CONTENT_ROOT, 'pass_01_report.json');
  if (!DRY_RUN) {
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport saved to: ${reportPath}`);
  }
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
