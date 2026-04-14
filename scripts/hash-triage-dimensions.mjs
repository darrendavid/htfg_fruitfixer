/**
 * hash-triage-dimensions.mjs
 * Fills in pixel dimensions for triage images that were hashed before but
 * lack width/height in the sidecar (content/backups/triage-hashes.json).
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import dotenv from 'dotenv';
dotenv.config({ path: 'review-ui/.env' });

const ROOT = process.cwd();
const norm   = p => p?.replace(/\\/g, '/') || '';
const absImg = fp => path.join(ROOT, norm(fp).replace(/^content\//, 'content/'));

const sidecarPath = 'content/backups/triage-hashes.json';
const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'));

const missing = Object.entries(sidecar).filter(([, v]) => v.hash && v.pixels == null);
console.log(`\nFilling dimensions for ${missing.length} pre-hashed triage images…`);

let done = 0;
for (const [id, entry] of missing) {
  const abs = absImg(entry.file_path || '');
  if (!existsSync(abs)) { entry.pixels = 0; entry.width = 0; entry.height = 0; continue; }
  try {
    const m = await sharp(abs).metadata();
    entry.width  = m.width  || 0;
    entry.height = m.height || 0;
    entry.pixels = entry.width * entry.height;
    entry.size   = statSync(abs).size;
  } catch {
    entry.pixels = 0; entry.width = 0; entry.height = 0;
  }
  done++;
  if (done % 50 === 0) process.stdout.write(` ${done}`);
}
process.stdout.write('\n');
writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));
console.log(`Done — ${done} filled. Sidecar updated.`);
