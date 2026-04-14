import { readFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: 'review-ui/.env' });
const { NOCODB_URL = 'https://nocodb.djjd.us', NOCODB_API_KEY } = process.env;
const IDS = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const H = { 'xc-token': NOCODB_API_KEY };
const TABLE = IDS['Images'];

const all = [];
let offset = 0;
while (true) {
  const params = new URLSearchParams({ limit: '200', offset: String(offset), where: '(Status,eq,triage)', fields: 'Id,File_Path' });
  const r = await fetch(`${NOCODB_URL}/api/v2/tables/${TABLE}/records?${params}`, { headers: H });
  const d = await r.json();
  all.push(...(d.list ?? []));
  if (d.pageInfo?.isLastPage) break;
  offset += 200;
  if (offset % 4000 === 0) process.stderr.write(String(offset) + '...');
}
process.stderr.write(`fetched ${all.length}\n`);

const buckets = {};
for (const r of all) {
  const fp = (r.File_Path || '').replace(/\\/g, '/');
  let bucket;
  if (fp.includes('/ignored/')) bucket = 'pass_02/ignored/';
  else if (fp.includes('/plants/') && fp.includes('/hidden/')) bucket = 'pass_02/plants/*/hidden/';
  else if (fp.includes('/plants/')) bucket = 'pass_02/plants/*/images/';
  else if (fp.includes('/triage/')) bucket = 'pass_02/triage/';
  else if (fp.includes('/extensionless/')) bucket = 'pass_02/extensionless/';
  else bucket = 'other: ' + fp.split('/').slice(0, 4).join('/');
  buckets[bucket] = (buckets[bucket] || 0) + 1;
}
for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) console.log(v, k);
