/**
 * Fix NocoDB Image and Attachment records whose File_Path still references
 * old plant slug folder names after the folder rename.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { config } from 'dotenv';
config({ path: path.join(import.meta.dirname, '..', 'review-ui', '.env') });

const ROOT       = path.resolve(import.meta.dirname, '..');
const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
const IDS        = JSON.parse(readFileSync(path.join(ROOT, 'content', 'parsed', 'nocodb_table_ids.json'), 'utf-8'));
const h          = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };

const REMAPS = {
  'tangerine':       'tangerine-mandarin',
  'atamoya':         'atemoya',
  'garcinia-gourka': 'mangosteen',
  'lalee-jewo':      'lalijiwa',
  'stink-bean':      'sator',
};

async function fetchAll(table, where) {
  const all = [];
  let offset = 0;
  while (true) {
    const qs = `limit=200&offset=${offset}&where=${encodeURIComponent(where)}`;
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS[table]}/records?${qs}`, { headers: h });
    const d = await r.json();
    all.push(...(d.list ?? []));
    if (d.pageInfo?.isLastPage || !d.list?.length) break;
    offset += 200;
  }
  return all;
}

async function patch(table, id, data) {
  const r = await fetch(`${NOCODB_URL}/api/v2/tables/${table}/records`, {
    method: 'PATCH', headers: h, body: JSON.stringify({ Id: id, ...data }),
  });
  if (!r.ok) throw new Error(`PATCH ${id}: ${r.status} ${await r.text()}`);
}

for (const [oldSlug, newSlug] of Object.entries(REMAPS)) {
  console.log(`\n── ${oldSlug} → ${newSlug} ──────────────────────────`);

  // Fix Images
  const images = await fetchAll('Images', `(File_Path,like,%/assigned/${oldSlug}/%)`);
  console.log(`  Images with stale path: ${images.length}`);
  for (const img of images) {
    const newPath = img.File_Path.replace(`/assigned/${oldSlug}/`, `/assigned/${newSlug}/`);
    await patch(IDS['Images'], img.Id, { File_Path: newPath });
    console.log(`  Fixed Image ${img.Id}: …${img.File_Path.split('/assigned/')[1]} → …${newPath.split('/assigned/')[1]}`);
  }

  // Fix Attachments
  const atts = await fetchAll('Attachments', `(File_Path,like,%/assigned/${oldSlug}/%)`);
  console.log(`  Attachments with stale path: ${atts.length}`);
  for (const att of atts) {
    const newPath = att.File_Path.replace(`/assigned/${oldSlug}/`, `/assigned/${newSlug}/`);
    await patch(IDS['Attachments'], att.Id, { File_Path: newPath });
    console.log(`  Fixed Attachment ${att.Id}: …${att.File_Path.split('/assigned/')[1]} → …${newPath.split('/assigned/')[1]}`);
  }
}

console.log('\nDone.');
