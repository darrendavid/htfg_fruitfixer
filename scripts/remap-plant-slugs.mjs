/**
 * Remap old plant slugs to correct ones:
 *   - Rename pass_01/assigned/{old}/ → {new}/
 *   - Update NocoDB Images.Plant_Id
 *   - Update NocoDB Attachments.Plant_Ids JSON arrays
 *   - Update attachment_ocr_results.json plant_id fields
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import { config } from 'dotenv';

config({ path: path.join(import.meta.dirname, '..', 'review-ui', '.env') });

const ROOT       = path.resolve(import.meta.dirname, '..');
const PASS01     = path.join(ROOT, 'content', 'pass_01', 'assigned');
const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
const IDS        = JSON.parse(readFileSync(path.join(ROOT, 'content', 'parsed', 'nocodb_table_ids.json'), 'utf-8'));
const OCR_FILE   = path.join(ROOT, 'content', 'parsed', 'attachment_ocr_results.json');

if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const REMAPS = {
  'tangerine':     'tangerine-mandarin',
  'atamoya':       'atemoya',
  'garcinia-gourka': 'mangosteen',
  'lalee-jewo':    'lalijiwa',
  'stink-bean':    'sator',
};

const h = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };

async function fetchAll(table, where) {
  const all = [];
  let offset = 0;
  while (true) {
    const qs = `limit=200&offset=${offset}${where ? '&where=' + encodeURIComponent(where) : ''}`;
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS[table]}/records?${qs}`, { headers: h });
    const d = await r.json();
    all.push(...(d.list ?? []));
    if (d.pageInfo?.isLastPage || d.list?.length === 0) break;
    offset += 200;
  }
  return all;
}

async function patch(table, id, data) {
  const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS[table]}/records`, {
    method: 'PATCH', headers: h, body: JSON.stringify({ Id: id, ...data }),
  });
  if (!r.ok) throw new Error(`PATCH ${table} ${id}: ${r.status} ${await r.text()}`);
}

for (const [oldSlug, newSlug] of Object.entries(REMAPS)) {
  console.log(`\n── ${oldSlug} → ${newSlug} ──────────────────────────`);

  // 1. Rename folder on disk
  const oldDir = path.join(PASS01, oldSlug);
  const newDir = path.join(PASS01, newSlug);
  if (existsSync(oldDir)) {
    if (existsSync(newDir)) {
      // Target exists — merge subdirs
      for (const sub of readdirSync(oldDir)) {
        const oldSub = path.join(oldDir, sub);
        const newSub = path.join(newDir, sub);
        if (!existsSync(newSub)) mkdirSync(newSub, { recursive: true });
        for (const file of readdirSync(oldSub)) {
          const src = path.join(oldSub, file);
          const dst = path.join(newSub, file);
          if (!existsSync(dst)) renameSync(src, dst);
          else console.log(`  SKIP (exists): ${file}`);
        }
      }
      // Remove old empty dirs
      try { import('fs').then(fs => fs.rmdirSync(oldDir, { recursive: true })); } catch {}
      console.log(`  Merged ${oldDir} → ${newDir}`);
    } else {
      renameSync(oldDir, newDir);
      console.log(`  Renamed folder`);
    }
  } else {
    console.log(`  No folder at ${oldDir}`);
  }

  // 2. Fix NocoDB Images.Plant_Id
  const images = await fetchAll('Images', `(Plant_Id,eq,${oldSlug})`);
  console.log(`  Images: ${images.length} records`);
  for (const img of images) {
    const newPath = img.File_Path
      ? img.File_Path.replace(new RegExp(`/assigned/${oldSlug}/`), `/assigned/${newSlug}/`)
      : img.File_Path;
    await patch('Images', img.Id, { Plant_Id: newSlug, File_Path: newPath });
  }

  // 3. Fix NocoDB Attachments.Plant_Ids arrays + File_Path
  const atts = await fetchAll('Attachments', `(Plant_Ids,like,%${oldSlug}%)`);
  console.log(`  Attachments: ${atts.length} records`);
  for (const att of atts) {
    const ids = JSON.parse(att.Plant_Ids || '[]');
    const newIds = ids.map((id) => id === oldSlug ? newSlug : id);
    const newPath = att.File_Path
      ? att.File_Path.replace(new RegExp(`/assigned/${oldSlug}/`), `/assigned/${newSlug}/`)
      : att.File_Path;
    await patch('Attachments', att.Id, { Plant_Ids: JSON.stringify(newIds), File_Path: newPath });
  }
}

// 4. Fix attachment_ocr_results.json
console.log('\n── Fixing attachment_ocr_results.json ──────────────────');
const ocrResults = JSON.parse(readFileSync(OCR_FILE, 'utf-8'));
let ocrFixed = 0;
for (const r of ocrResults) {
  const newSlug = REMAPS[r.plant_id];
  if (!newSlug) continue;
  const oldSlug = r.plant_id;
  r.plant_id = newSlug;
  if (r.file_path) {
    r.file_path = r.file_path
      .replace(`/assigned/${oldSlug}/`, `/assigned/${newSlug}/`)
      .replace(`\\assigned\\${oldSlug}\\`, `\\assigned\\${newSlug}\\`);
  }
  ocrFixed++;
}
writeFileSync(OCR_FILE, JSON.stringify(ocrResults, null, 2));
console.log(`  Updated ${ocrFixed} OCR records`);

console.log('\nDone. Run: node scripts/accept-attachment-ocr.mjs');
