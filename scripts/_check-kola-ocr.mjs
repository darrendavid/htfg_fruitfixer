import { readFileSync } from 'fs';
import path from 'path';
import { config } from 'dotenv';
config({ path: path.join(import.meta.dirname, '..', 'review-ui', '.env') });

const ROOT = path.resolve(import.meta.dirname, '..');
const results = JSON.parse(readFileSync(path.join(ROOT, 'content', 'parsed', 'attachment_ocr_results.json'), 'utf-8'));
const ok = results.filter(r => !r.error);

// Show all plants processed
const plants = [...new Set(ok.map(r => r.plant_id))].sort();
console.log(`\n=== ${ok.length} successful OCR records across ${plants.length} plants ===\n`);
plants.forEach(p => {
  const recs = ok.filter(r => r.plant_id === p);
  recs.forEach(r => {
    const fname = r.file_path.replace(/\\/g, '/').split('/').pop();
    const sci = r.extraction?.scientific_name || '';
    console.log(`  ${p.padEnd(30)} ${fname.padEnd(40)} ${sci}`);
  });
});

// Cross-check: for each plant in OCR, does NocoDB have that plant?
const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
const TABLE_IDS = JSON.parse(readFileSync(path.join(ROOT, 'content', 'parsed', 'nocodb_table_ids.json'), 'utf-8'));

async function checkPlant(plantId) {
  const url = `${NOCODB_URL}/api/v2/tables/${TABLE_IDS['Plants']}/records?where=(Id1,eq,${plantId})&limit=1`;
  const res = await fetch(url, { headers: { 'xc-token': NOCODB_KEY } });
  const data = await res.json();
  return data.list?.[0] ?? null;
}

console.log('\n=== Checking each OCR plant_id against NocoDB ===\n');
const missing = [];
for (const plantId of plants) {
  const plant = await checkPlant(plantId);
  if (!plant) {
    missing.push(plantId);
    console.log(`  MISSING: ${plantId}`);
  } else {
    const hasBotanical = plant.Botanical_Names && plant.Botanical_Names.trim();
    const hasDesc = plant.Description && plant.Description.trim();
    console.log(`  OK  ${plantId.padEnd(30)} Botanical=${hasBotanical ? 'YES' : 'NO '} Desc=${hasDesc ? 'YES' : 'NO'}`);
  }
}

if (missing.length === 0) {
  console.log('\nAll OCR plants exist in NocoDB.');
} else {
  console.log(`\n${missing.length} plants referenced in OCR but NOT in NocoDB: ${missing.join(', ')}`);
}
