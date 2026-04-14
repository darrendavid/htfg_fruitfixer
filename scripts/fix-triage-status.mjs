/**
 * fix-triage-status.mjs
 *
 * After repair-pass02-fix.mjs, many images in pass_02/ignored/ ended up with
 * Status='triage' because the repair script couldn't infer their status.
 * Their actual location in pass_02 tells us the correct status:
 *
 *   pass_02/ignored/          → Status='hidden', Excluded=true
 *   pass_02/plants/ (no /triage/) → Status='assigned' (already in a plant folder)
 *   pass_02/triage/           → Status='triage' (correct, leave alone)
 *
 * Dry-run: node scripts/fix-triage-status.mjs --dry-run
 * Live:    node scripts/fix-triage-status.mjs
 */

import { readFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: 'review-ui/.env' });

const DRY_RUN    = process.argv.includes('--dry-run');
const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const IDS = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const H   = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };

async function fetchAll(table, where, fields) {
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({ limit: '200', offset: String(offset), where, fields });
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS[table]}/records?${params}`, { headers: H });
    const d = await r.json();
    all.push(...(d.list ?? []));
    if (d.pageInfo?.isLastPage) break;
    offset += 200;
    if (offset % 5000 === 0) process.stderr.write(String(offset) + '...');
  }
  process.stderr.write('\n');
  return all;
}

async function bulkUpdate(table, records) {
  if (!records.length) return;
  if (DRY_RUN) { console.log(`  [DRY RUN] would PATCH ${records.length} ${table} records`); return; }
  const BATCH = 100;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS[table]}/records`, {
      method: 'PATCH', headers: H, body: JSON.stringify(batch),
    });
    if (!r.ok) console.error(`bulkUpdate ${table} batch ${i}: ${await r.text()}`);
  }
}

console.log(`\n=== fix-triage-status (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) ===\n`);

console.log('Fetching all Status=triage images…');
const triageImages = await fetchAll('Images', '(Status,eq,triage)', 'Id,File_Path,Plant_Id');
console.log(`  ${triageImages.length} records\n`);

const toHide    = [];  // in pass_02/ignored/  → hidden + Excluded
const toAssign  = [];  // in pass_02/plants/ (not /triage/) → assigned
const correct   = [];  // in pass_02/triage/  → leave alone

for (const r of triageImages) {
  const fp = (r.File_Path || '').replace(/\\/g, '/');
  if (fp.includes('/ignored/')) {
    toHide.push({ Id: r.Id, Status: 'hidden', Excluded: true });
  } else if (fp.includes('/plants/') && !fp.includes('/triage/')) {
    // Extract plant_id from path: pass_02/plants/{slug}/images/...
    const m = fp.match(/\/plants\/([^/]+)\//);
    const plantId = m ? m[1] : r.Plant_Id;
    toAssign.push({ Id: r.Id, Status: 'assigned', Excluded: false, Plant_Id: plantId });
  } else {
    correct.push(r);
  }
}

console.log(`Breakdown:`);
console.log(`  → set hidden+Excluded (in /ignored/):   ${toHide.length}`);
console.log(`  → set assigned (in /plants/):            ${toAssign.length}`);
console.log(`  → already correct (in /triage/):         ${correct.length}\n`);

console.log('Patching /ignored/ records → hidden…');
await bulkUpdate('Images', toHide);
console.log('  done');

console.log('Patching /plants/ records → assigned…');
await bulkUpdate('Images', toAssign);
console.log('  done');

console.log('\n=== SUMMARY ===');
console.log(`  Set to hidden:    ${toHide.length}`);
console.log(`  Set to assigned:  ${toAssign.length}`);
console.log(`  Left as triage:   ${correct.length}`);
if (DRY_RUN) console.log('\n[DRY RUN] No changes made.');
