#!/usr/bin/env node
/**
 * Fix the 41 remaining AMBIGUOUS records — the "parsed/ counterpart" records
 * created by fix-ambiguous-images.mjs. Each has a parsed/ File_Path where a
 * different-sized file already exists at the same normalized pass_01 path.
 *
 * Action: copy parsed/ file to pass_01 with collision-renamed filename (_1/_2),
 * then update DB File_Path to the new pass_01 path.
 *
 * Usage:
 *   node scripts/fix-ambiguous-remainder.mjs --dry-run
 *   node scripts/fix-ambiguous-remainder.mjs
 */

import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
for (const line of readFileSync(path.join(ROOT, 'review-ui', '.env'), 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const DRY_RUN = process.argv.includes('--dry-run');
const API_KEY = process.env.NOCODB_API_KEY;
const BASE_URL = 'https://nocodb.djjd.us';
const TABLE_IDS = JSON.parse(readFileSync(path.join(ROOT, 'content/parsed/nocodb_table_ids.json'), 'utf-8'));
const IMAGES_TABLE = TABLE_IDS['Images'];
const CONTENT_DIR = path.join(ROOT, 'content');
const ASSIGNED_DIR = path.join(ROOT, 'content/pass_01/assigned');

if (!API_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }
if (DRY_RUN) console.log('[DRY RUN]\n');

function toFilePath(abs) {
  return 'content/' + path.relative(CONTENT_DIR, abs).split(path.sep).join('/');
}

function safeDestPath(destDir, filename) {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  let candidate = path.join(destDir, filename);
  if (!existsSync(candidate)) return candidate;
  for (let i = 1; i < 1000; i++) {
    candidate = path.join(destDir, `${base}_${i}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`No free slot for ${filename} in ${destDir}`);
}

async function patchRecord(id, filePath) {
  const res = await fetch(`${BASE_URL}/api/v2/tables/${IMAGES_TABLE}/records`, {
    method: 'PATCH',
    headers: { 'xc-token': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Id: id, File_Path: filePath }),
  });
  if (!res.ok) throw new Error(`PATCH id=${id} failed: ${res.status} ${await res.text()}`);
}

async function main() {
  const report = JSON.parse(readFileSync(path.join(ROOT, 'content/audit-reconciliation-report.json'), 'utf-8'));

  // Filter AMBIGUOUS to only those with parsed/ paths (the ones we need to fix)
  const targets = report.records.AMBIGUOUS.filter(r =>
    r.file_path && r.file_path.includes('content/parsed/') && r.plant
  );

  console.log(`AMBIGUOUS records with parsed/ paths: ${targets.length}\n`);

  let done = 0, skipped = 0;

  for (const rec of targets) {
    const srcAbs = path.join(ROOT, rec.file_path.replace(/\//g, path.sep));

    if (!existsSync(srcAbs)) {
      console.log(`  SKIP (not on disk) id=${rec.id}  ${rec.file_path}`);
      skipped++;
      continue;
    }

    const filename = path.basename(srcAbs);
    const destDir = path.join(ASSIGNED_DIR, rec.plant, 'images');
    const destAbs = safeDestPath(destDir, filename);
    const newFilePath = toFilePath(destAbs);

    console.log(`  id=${rec.id}  ${rec.plant}/${filename}`);
    console.log(`    → ${path.relative(ROOT, destAbs).split(path.sep).join('/')}`);

    if (!DRY_RUN) {
      mkdirSync(destDir, { recursive: true });
      copyFileSync(srcAbs, destAbs);
      await patchRecord(rec.id, newFilePath);
    }
    done++;
  }

  console.log(`\n══════════════════════════════════════`);
  console.log(`Fixed:   ${done}`);
  console.log(`Skipped: ${skipped}`);
  if (DRY_RUN) console.log('\n[DRY RUN] Re-run without --dry-run to apply.');
  else console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
