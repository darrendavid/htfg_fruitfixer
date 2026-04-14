/**
 * Audit all NocoDB Attachment records:
 *   1. For each record, check if File_Path points to a pass_01 attachments/ directory
 *   2. If the file is in images/ instead, move it to attachments/ and update NocoDB
 *   3. Report any records whose files can't be found at all
 *   4. Scan all pass_01/assigned/{plant}/attachments/ dirs for files not yet in attachment_ocr_results.json
 */

import { readFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { readdirSync, statSync } from 'fs';
import path from 'path';
import { config } from 'dotenv';

config({ path: path.join(import.meta.dirname, '..', 'review-ui', '.env') });

const ROOT        = path.resolve(import.meta.dirname, '..');
const PASS01      = path.join(ROOT, 'content', 'pass_01', 'assigned');
const NOCODB_URL  = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY  = process.env.NOCODB_API_KEY;
const TABLE_IDS   = JSON.parse(readFileSync(path.join(ROOT, 'content', 'parsed', 'nocodb_table_ids.json'), 'utf-8'));
const IMAGE_EXTS  = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tif', '.tiff', '.bmp']);

if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const h = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };

async function fetchAll(table) {
  const all = [];
  let offset = 0;
  while (true) {
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${TABLE_IDS[table]}/records?limit=200&offset=${offset}`, { headers: h });
    const d = await r.json();
    all.push(...d.list);
    if (d.pageInfo?.isLastPage || d.list.length === 0) break;
    offset += 200;
  }
  return all;
}

async function patchRecord(table, id, data) {
  const r = await fetch(`${NOCODB_URL}/api/v2/tables/${TABLE_IDS[table]}/records`, {
    method: 'PATCH', headers: h, body: JSON.stringify({ Id: id, ...data }),
  });
  if (!r.ok) throw new Error(`PATCH ${table} ${id}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function deleteRecord(table, id) {
  const r = await fetch(`${NOCODB_URL}/api/v2/tables/${TABLE_IDS[table]}/records`, {
    method: 'DELETE', headers: h, body: JSON.stringify([{ Id: id }]),
  });
  if (!r.ok) throw new Error(`DELETE ${table} ${id}: ${r.status} ${await r.text()}`);
}

async function deleteImageRecord(id) {
  const r = await fetch(`${NOCODB_URL}/api/v2/tables/${TABLE_IDS['Images']}/records`, {
    method: 'DELETE', headers: h, body: JSON.stringify([{ Id: id }]),
  });
  if (!r.ok) throw new Error(`DELETE Images ${id}: ${r.status} ${await r.text()}`);
}

// ── 1. Fetch all attachment records ──────────────────────────────────────────
console.log('Fetching all Attachment records…');
const attachments = await fetchAll('Attachments');
console.log(`Found ${attachments.length} attachment records\n`);

// Only look at image-type attachments in pass_01 (skip legacy HawaiiFruit.Net paths)
const imageAttachments = attachments.filter(a => {
  if (!a.File_Path) return false;
  const ext = path.extname(a.File_Path).toLowerCase();
  return IMAGE_EXTS.has(ext);
});
console.log(`Image attachments (signs/posters): ${imageAttachments.length}`);
const otherAttachments = attachments.filter(a => {
  if (!a.File_Path) return false;
  const ext = path.extname(a.File_Path).toLowerCase();
  return !IMAGE_EXTS.has(ext);
});
console.log(`Document attachments (PDFs, PPTs, etc): ${otherAttachments.length}\n`);

// ── 2. For each image attachment, check its path ──────────────────────────────
const moved = [];
const notFound = [];
const alreadyCorrect = [];
const staleImages = []; // Image records that duplicate attachment paths

// Also build a set of all image record file_paths to check for duplicates
console.log('Fetching Image records for duplicate check…');
const allImages = await fetchAll('Images');
const imageByPath = new Map(allImages.map(i => [i.File_Path?.replace(/\\/g, '/'), i]));

for (const att of imageAttachments) {
  const fp = att.File_Path.replace(/\\/g, '/');
  const absPath = path.join(ROOT, fp);

  // Is it already in an attachments/ directory?
  const inAttachmentsDir = fp.includes('/attachments/');

  if (inAttachmentsDir) {
    if (existsSync(absPath)) {
      alreadyCorrect.push(att);
    } else {
      notFound.push({ att, reason: 'file missing from attachments/ dir' });
    }
    continue;
  }

  // File is in images/ or some other path — try to find it and move it
  const filename = path.basename(fp);

  // Extract plant slug from path
  const plantMatch = fp.match(/assigned\/([^/]+)\//);
  if (!plantMatch) {
    notFound.push({ att, reason: 'cannot determine plant slug from path' });
    continue;
  }
  const slug = plantMatch[1];
  const targetDir = path.join(PASS01, slug, 'attachments');
  const targetPath = path.join(targetDir, filename);
  const targetRelPath = `content/pass_01/assigned/${slug}/attachments/${filename}`;

  if (existsSync(absPath)) {
    // Move the file
    mkdirSync(targetDir, { recursive: true });
    renameSync(absPath, targetPath);

    // Update NocoDB record
    await patchRecord('Attachments', att.Id, { File_Path: targetRelPath });

    // Remove any stale Image record pointing to the old path
    const imgRec = imageByPath.get(fp);
    if (imgRec) {
      try {
        await deleteImageRecord(imgRec.Id);
        staleImages.push({ imageId: imgRec.Id, path: fp });
      } catch {}
    }

    moved.push({ att, from: fp, to: targetRelPath });
    console.log(`  MOVED  [${slug}] ${filename}`);
    console.log(`         ${fp}`);
    console.log(`      →  ${targetRelPath}`);
  } else {
    // File not at recorded path — check if it's already in the target location
    if (existsSync(targetPath)) {
      await patchRecord('Attachments', att.Id, { File_Path: targetRelPath });
      moved.push({ att, from: fp, to: targetRelPath, note: 'file already in target, updated path only' });
      console.log(`  FIXED  [${slug}] ${filename} (already in attachments/, path updated)`);
    } else {
      notFound.push({ att, reason: `file not found at ${fp} or ${targetRelPath}` });
      console.log(`  MISSING [${slug}] ${filename} — ${fp}`);
    }
  }
}

// ── 3. Check for attachment image files on disk not yet in OCR results ────────
console.log('\n\nScanning disk for all attachment images…');
const ocrResults = JSON.parse(readFileSync(path.join(ROOT, 'content', 'parsed', 'attachment_ocr_results.json'), 'utf-8'));
const processedPaths = new Set(ocrResults.map(r => r.file_path.replace(/\\/g, '/')));
const processedBasenames = new Set(ocrResults.map(r => path.basename(r.file_path).toLowerCase()));

let plantDirs;
try { plantDirs = readdirSync(PASS01); } catch { plantDirs = []; }

const missingFromOcr = [];
for (const slug of plantDirs) {
  const attDir = path.join(PASS01, slug, 'attachments');
  if (!existsSync(attDir)) continue;
  const files = readdirSync(attDir).filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()));
  for (const file of files) {
    const relPath = `content/pass_01/assigned/${slug}/attachments/${file}`;
    const normPath = relPath.replace(/\\/g, '/');
    if (!processedPaths.has(normPath) && !processedBasenames.has(file.toLowerCase())) {
      missingFromOcr.push({ slug, file, relPath });
    }
  }
}

// ── 4. Summary ────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════');
console.log(`Already in attachments/ dir:  ${alreadyCorrect.length}`);
console.log(`Moved to attachments/ dir:    ${moved.length}`);
if (staleImages.length) console.log(`Stale Image records removed:  ${staleImages.length}`);
console.log(`Files not found:              ${notFound.length}`);
if (notFound.length) notFound.forEach(n => console.log(`  - ${n.att.File_Path} (${n.reason})`));

console.log(`\nAttachment images missing from OCR: ${missingFromOcr.length}`);
if (missingFromOcr.length) {
  missingFromOcr.forEach(m => console.log(`  [${m.slug}] ${m.file}`));
  console.log('\nRun: node scripts/attachment-ocr-extract.mjs');
} else {
  console.log('All attachment images have been OCR\'d.');
}
