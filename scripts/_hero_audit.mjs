import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
dotenv.config({ path: 'review-ui/.env' });
const NOCODB_URL = 'https://nocodb.djjd.us';
const KEY = process.env.NOCODB_API_KEY;
const H = { 'xc-token': KEY };
const IDS = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const snap = 'content/backups/nocodb-2026-04-12-07-35-05';
const prePlants = JSON.parse(readFileSync(`${snap}/Plants.json`, 'utf-8'));
const preById = new Map(prePlants.map(p => [p.Id, p]));

const MOUNT = 'content/pass_02/plants';
const ROOT  = process.cwd();
const norm  = p => p.replace(/\\/g, '/');

const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS.Plants}/records?where=(Hero_Image_Path,isnot,null)&limit=100`, { headers: H });
const d = await r.json();

console.log('=== HERO IMAGE AUDIT ===\n');
const results = [];

for (const plant of d.list) {
  const plantId  = plant.Id1;
  const heroPath = plant.Hero_Image_Path;
  if (!heroPath) continue;

  const fullPath   = path.join(ROOT, MOUNT, heroPath);
  const exists     = existsSync(fullPath);
  const fname      = path.basename(heroPath);

  // Look for file under the plant's own folder
  const ownPath    = path.join(ROOT, MOUNT, plantId, 'images', fname);
  const ownExists  = existsSync(ownPath);

  // Also try hidden subfolder
  const hiddenPath = path.join(ROOT, MOUNT, plantId, 'images', 'hidden', fname);
  const hiddenExists = existsSync(hiddenPath);

  let fixedRelative = null;
  if (ownExists)    fixedRelative = norm(path.join(plantId, 'images', fname));
  if (hiddenExists) fixedRelative = norm(path.join(plantId, 'images', 'hidden', fname));

  const status = exists ? 'OK' : fixedRelative ? 'FIXABLE' : 'BROKEN';

  results.push({ plantId, plantNocDbId: plant.Id, heroPath, exists, fixedRelative, status, fname });

  console.log(`[${status}] ${plantId} (Id=${plant.Id})`);
  if (!exists) {
    if (fixedRelative) {
      console.log(`  Old: ${heroPath}`);
      console.log(`  Fix: ${fixedRelative}`);
    } else {
      console.log(`  Old: ${heroPath} — FILE NOT FOUND in pass_02`);
    }
  }
}

console.log(`\nSummary:`);
console.log(`  OK:      ${results.filter(r => r.status === 'OK').length}`);
console.log(`  FIXABLE: ${results.filter(r => r.status === 'FIXABLE').length}`);
console.log(`  BROKEN:  ${results.filter(r => r.status === 'BROKEN').length}`);
