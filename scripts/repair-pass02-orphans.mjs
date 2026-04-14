/**
 * repair-pass02-orphans.mjs
 *
 * Audits pass_02/ for:
 *   1. Orphaned files — on disk but no current NocoDB record
 *   2. Metadata drift — covered file whose current NocoDB record is missing
 *      fields that the pre-migration backup had (rotation, caption, variety_id,
 *      status, excluded, attribution)
 *   3. Missing files — backup records whose file cannot be found anywhere in pass_02
 *
 * Proposed actions for orphans (priority order):
 *   backup Status=assigned,  Plant_Id set   → restore to plants/<slug>/images/
 *   backup Status=hidden,    Plant_Id set   → restore to plants/<slug>/images/hidden/
 *   backup Status=hidden,    no Plant_Id   → stay in ignored/, create NocoDB record
 *   backup Status=triage/other, no Plant_Id → stay in triage/, create NocoDB record
 *   ambiguous (filename matches multiple backup records) → needs_review
 *   collision rename (foo_1.jpg, covered base foo.jpg) → flag as probable duplicate
 *   not in backup, traceable to pass_01 dir → create NocoDB record, infer status from origin
 *   not in backup, untraceable             → flag as unknown
 *
 * Default: DRY RUN — writes JSON report, touches nothing.
 * Pass --fix to apply all changes.
 */

import {
  readFileSync, existsSync, readdirSync,
  mkdirSync, renameSync, copyFileSync, unlinkSync, writeFileSync,
} from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: 'review-ui/.env' });

const DRY_RUN    = !process.argv.includes('--fix');
const NOCODB_URL = process.env.NOCODB_URL || 'https://nocodb.djjd.us';
const NOCODB_KEY = process.env.NOCODB_API_KEY;
if (!NOCODB_KEY) { console.error('NOCODB_API_KEY not set'); process.exit(1); }

const IDS        = JSON.parse(readFileSync('content/parsed/nocodb_table_ids.json', 'utf-8'));
const H          = { 'xc-token': NOCODB_KEY, 'Content-Type': 'application/json' };
const PASS01     = 'content/pass_01';
const PASS02     = 'content/pass_02';
const BACKUP_DIR = 'content/backups/nocodb-2026-04-12-07-35-05';
const REPORT_PATH = `content/backups/pass02-repair-dryrun-${Date.now()}.json`;

// ── NocoDB helpers ─────────────────────────────────────────────────────────────

async function fetchAll(table, fields) {
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({ limit: '200', offset: String(offset) });
    if (fields) params.set('fields', fields);
    const r = await fetch(`${NOCODB_URL}/api/v2/tables/${IDS[table]}/records?${params}`, { headers: H });
    const d = await r.json();
    all.push(...(d.list ?? []));
    if (d.pageInfo?.isLastPage) break;
    offset += 200;
  }
  return all;
}

// ── File helpers ───────────────────────────────────────────────────────────────

const norm = p => p?.replace(/\\/g, '/') || '';

function walkDir(dir, result = []) {
  if (!existsSync(dir)) return result;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(full, result);
    else result.push(norm(full));
  }
  return result;
}

function moveFile(src, dest) {
  if (DRY_RUN) return;
  const dir = path.dirname(dest);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try { renameSync(src, dest); }
  catch (e) {
    if (e.code === 'EXDEV') { copyFileSync(src, dest); unlinkSync(src); }
    else throw e;
  }
}

// Strip migration collision suffix: foo_1.jpg → foo.jpg, foo_12.jpg → foo.jpg
const stripSuffix = fname => fname.replace(/_\d+(\.[^.]+)$/, '$1');

// Relative path anchored at content/
const relFromContent = p => {
  const n = norm(p);
  const i = n.indexOf('content/');
  return i >= 0 ? n.slice(i) : n;
};

// ── 1. Load data ───────────────────────────────────────────────────────────────

console.log(`\n=== pass_02 orphan repair (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) ===\n`);

console.log('Loading backup Images.json…');
const backupImages = JSON.parse(readFileSync(`${BACKUP_DIR}/Images.json`, 'utf-8'));
console.log(`  ${backupImages.length} backup records`);

console.log('Fetching current NocoDB Images…');
const currentImages = await fetchAll('Images');
console.log(`  ${currentImages.length} current records`);

// ── 2. Build lookup indices ────────────────────────────────────────────────────

console.log('Building lookup indices…');

// Current NocoDB: by normalised File_Path, and by basename
const curByPath     = new Map(); // rel-path → record
const curByFilename = new Map(); // fname → [records]
const curById       = new Map(); // Id → record
for (const r of currentImages) {
  const fp = relFromContent(norm(r.File_Path || ''));
  curById.set(r.Id, r);
  if (fp) curByPath.set(fp, r);
  const fname = path.basename(fp);
  if (fname) {
    if (!curByFilename.has(fname)) curByFilename.set(fname, []);
    curByFilename.get(fname).push(r);
  }
}

// Backup: by Id, and by basename
const bakById       = new Map(backupImages.map(r => [r.Id, r]));
const bakByFilename = new Map(); // fname → [records]
for (const r of backupImages) {
  const fname = r.File_Path ? path.basename(norm(r.File_Path)) : null;
  if (!fname) continue;
  if (!bakByFilename.has(fname)) bakByFilename.set(fname, []);
  bakByFilename.get(fname).push(r);
}

// pass_01 index: fname → [{ dir_label, full_path }]  — built once, O(1) lookups
console.log('Indexing pass_01…');
const PASS01_DIRS = [
  ['assigned',                path.join(PASS01, 'assigned')],
  ['hidden',                  path.join(PASS01, 'hidden')],
  ['ignored',                 path.join(PASS01, 'ignored')],
  ['unassigned/ignored',      path.join(PASS01, 'unassigned', 'ignored')],
  ['unassigned/_to_triage',   path.join(PASS01, 'unassigned', '_to_triage')],
  ['unassigned/unclassified', path.join(PASS01, 'unassigned', 'unclassified')],
];

const pass01Index = new Map(); // fname → [{ label, absPath }]
for (const [label, dir] of PASS01_DIRS) {
  for (const absPath of walkDir(dir)) {
    const fname = path.basename(absPath);
    if (!pass01Index.has(fname)) pass01Index.set(fname, []);
    pass01Index.get(fname).push({ label, absPath });
  }
}
console.log(`  ${pass01Index.size} unique filenames indexed from pass_01`);

// ── 3. Walk pass_02 ────────────────────────────────────────────────────────────

console.log('\nWalking pass_02/…');
const allPass02 = walkDir(PASS02);
console.log(`  ${allPass02.length} files on disk`);

// ── 4. Analyse every pass_02 file ─────────────────────────────────────────────

const META_FIELDS = ['Rotation', 'Caption', 'Variety_Id', 'Excluded', 'Status', 'Attribution'];

const report = {
  generated_at: new Date().toISOString(),
  dry_run: DRY_RUN,
  summary: {},
  orphaned_actions:    [],   // orphans with a determined action
  metadata_mismatches: [],   // covered files with metadata drift vs backup
  missing_from_pass02: [],   // backup records whose file cannot be located
  needs_review:        [],   // ambiguous cases
};

console.log('Analysing files…');
let coveredCount = 0, orphanedCount = 0;

for (const absFile of allPass02) {
  const fp    = relFromContent(absFile);
  const fname = path.basename(fp);
  const curRec = curByPath.get(fp);

  if (curRec) {
    // ── Covered — check metadata drift ────────────────────────────────────────
    coveredCount++;

    // Best backup match: by Id first (Id should be preserved for pre-migration records)
    let bakRec = bakById.get(curRec.Id);
    if (!bakRec) {
      const baks = bakByFilename.get(fname) || [];
      bakRec = baks.length === 1
        ? baks[0]
        : baks.find(b => b.Plant_Id === curRec.Plant_Id);
    }

    if (bakRec) {
      const mismatches = {};
      for (const field of META_FIELDS) {
        const cur = curRec[field];
        const bak = bakRec[field];
        // Flag only when backup had a non-trivial value the current record is missing
        const bakMeaningful = bak != null && bak !== '' && bak !== false && bak !== 0;
        if (bakMeaningful && cur !== bak) mismatches[field] = { current: cur, backup: bak };
      }
      if (Object.keys(mismatches).length > 0) {
        report.metadata_mismatches.push({
          file_path:  fp,
          nocodb_id:  curRec.Id,
          plant_id:   curRec.Plant_Id,
          mismatches,
        });
      }
    }

  } else {
    // ── Orphaned — determine action ────────────────────────────────────────────
    orphanedCount++;
    const bakRecs = bakByFilename.get(fname) || [];

    if (bakRecs.length > 1) {
      // Ambiguous filename — multiple plants had a file with this name
      report.needs_review.push({
        type:            'ambiguous_filename',
        file_path:       fp,
        backup_matches:  bakRecs.map(r => ({
          backup_id:  r.Id,
          plant_id:   r.Plant_Id,
          status:     r.Status,
          file_path:  r.File_Path,
        })),
      });

    } else if (bakRecs.length === 1) {
      // Single clear backup match — full metadata available
      const bak = bakRecs[0];
      const meta = {
        Plant_Id:          bak.Plant_Id          || null,
        Status:            bak.Status            || 'triage',
        Excluded:          bak.Excluded          ?? false,
        Variety_Id:        bak.Variety_Id        || null,
        Caption:           bak.Caption           || null,
        Rotation:          bak.Rotation          || 0,
        Attribution:       bak.Attribution       || null,
        License:           bak.License           || null,
        Perceptual_Hash:   bak.Perceptual_Hash   || null,
        Source_Directory:  bak.Source_Directory  || null,
        Size_Bytes:        bak.Size_Bytes        || null,
        Original_Filepath: bak.Original_Filepath || null,
      };

      let action, destPath;
      if (bak.Plant_Id && bak.Status === 'assigned') {
        action   = 'restore_to_plant_assigned';
        destPath = `content/pass_02/plants/${bak.Plant_Id}/images/${fname}`;
      } else if (bak.Plant_Id) {
        // hidden or any status but still plant-owned
        action   = 'restore_to_plant_hidden';
        destPath = `content/pass_02/plants/${bak.Plant_Id}/images/hidden/${fname}`;
        meta.Status   = 'hidden';
        meta.Excluded = true;
      } else if (bak.Status === 'hidden') {
        // Globally hidden, no plant — stays in ignored/
        action   = 'create_nocodb_globally_hidden';
        destPath = fp;
      } else {
        // Unassigned / triage / no plant
        action   = 'create_nocodb_triage';
        destPath = `content/pass_02/triage/${fname}`;
      }

      report.orphaned_actions.push({ action, file_path: fp, dest_path: destPath, backup_id: bak.Id, metadata: meta });

    } else {
      // Not in backup — use pass_01 index to explain origin
      const baseFname      = stripSuffix(fname);
      const isCollision    = baseFname !== fname;
      const baseCoverRecs  = curByFilename.get(baseFname) || [];

      if (isCollision && baseCoverRecs.length > 0) {
        // Almost certainly a duplicate copy from an earlier migration run
        report.orphaned_actions.push({
          action:           'delete_collision_duplicate',
          file_path:        fp,
          dest_path:        null,
          reason:           `Collision rename; base file "${baseFname}" is covered by NocoDB`,
          covered_records:  baseCoverRecs.map(r => ({ nocodb_id: r.Id, plant_id: r.Plant_Id, file_path: r.File_Path })),
        });
      } else {
        // Genuine mystery — trace via pre-built pass_01 index
        const origins     = pass01Index.get(fname) || [];
        const originLabels = [...new Set(origins.map(o => o.label))];

        let inferredStatus, inferredExcluded;
        if (originLabels.some(l => l === 'ignored' || l.includes('unassigned'))) {
          inferredStatus   = 'hidden';
          inferredExcluded = true;
        } else if (originLabels.some(l => l === 'hidden')) {
          inferredStatus   = 'hidden';
          inferredExcluded = true;
        } else if (originLabels.some(l => l === 'assigned')) {
          // Was assigned but never in NocoDB before the backup — needs investigation
          inferredStatus   = 'triage';
          inferredExcluded = false;
        } else {
          inferredStatus   = 'triage';
          inferredExcluded = false;
        }

        report.orphaned_actions.push({
          action:             'create_nocodb_not_in_backup',
          file_path:          fp,
          dest_path:          inferredStatus === 'hidden' ? fp : `content/pass_02/triage/${fname}`,
          reason:             origins.length
            ? `Not in backup; pass_01 origin(s): ${originLabels.join(', ')}`
            : 'Not in backup; not found in any pass_01 directory',
          inferred_status:    inferredStatus,
          inferred_excluded:  inferredExcluded,
          pass01_origins:     origins.slice(0, 5),   // cap to keep report readable
        });
      }
    }
  }
}

// ── 5. Backup records → verify presence in pass_02 ───────────────────────────

console.log('\nChecking all backup records for missing files…');
for (const bak of backupImages) {
  const fname = bak.File_Path ? path.basename(norm(bak.File_Path)) : null;
  if (!fname) continue;

  const curRec = curById.get(bak.Id);

  if (curRec) {
    // Record still exists in NocoDB — is the file actually on disk?
    const fp = relFromContent(norm(curRec.File_Path || ''));
    if (fp && !existsSync(fp)) {
      report.missing_from_pass02.push({
        backup_id:         bak.Id,
        backup_file_path:  bak.File_Path,
        current_file_path: curRec.File_Path,
        plant_id:          bak.Plant_Id,
        status:            bak.Status,
        problem:           'NocoDB record exists but file not found on disk at current File_Path',
      });
    }
  } else {
    // Record not found by Id — fallback: any current record with same filename?
    const curByFname = curByFilename.get(fname) || [];
    const slug       = bak.Plant_Id;
    const diskPaths  = [
      slug ? `content/pass_02/plants/${slug}/images/${fname}`        : null,
      slug ? `content/pass_02/plants/${slug}/images/hidden/${fname}` : null,
      `content/pass_02/ignored/${fname}`,
      `content/pass_02/triage/${fname}`,
    ].filter(Boolean);
    const onDisk = diskPaths.some(p => existsSync(p));

    if (!onDisk && !curByFname.length) {
      report.missing_from_pass02.push({
        backup_id:        bak.Id,
        backup_file_path: bak.File_Path,
        plant_id:         bak.Plant_Id,
        status:           bak.Status,
        problem:          'Record deleted from NocoDB and file not found anywhere in pass_02',
      });
    }
  }
}

// ── 6. Summary & report ────────────────────────────────────────────────────────

const actionCounts = {};
for (const a of report.orphaned_actions) actionCounts[a.action] = (actionCounts[a.action] || 0) + 1;

report.summary = {
  pass02_total_files:            allPass02.length,
  covered_by_current_nocodb:     coveredCount,
  orphaned_no_nocodb_record:     orphanedCount,
  action_breakdown:              actionCounts,
  needs_review_count:            report.needs_review.length,
  metadata_mismatch_count:       report.metadata_mismatches.length,
  backup_records_missing_or_lost: report.missing_from_pass02.length,
};

writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

console.log('\n=== SUMMARY ===');
console.log(`  pass_02 total files:              ${report.summary.pass02_total_files}`);
console.log(`  covered by current NocoDB:        ${report.summary.covered_by_current_nocodb}`);
console.log(`  orphaned (no NocoDB record):      ${report.summary.orphaned_no_nocodb_record}`);
console.log(`  action breakdown:`);
for (const [a, n] of Object.entries(actionCounts)) console.log(`    ${a}: ${n}`);
console.log(`  needs_review (ambiguous):         ${report.summary.needs_review_count}`);
console.log(`  metadata mismatches vs backup:    ${report.summary.metadata_mismatch_count}`);
console.log(`  backup records missing/lost:      ${report.summary.backup_records_missing_or_lost}`);
console.log(`\nReport written to: ${REPORT_PATH}`);
if (DRY_RUN) console.log('\n[DRY RUN] No changes made. Re-run with --fix to apply.');
