# pass_02 Migration — Post-Mortem & Reference for Next Attempt

**Date of attempt:** 2026-04-13  
**Outcome:** Rolled back. Migration created ≈40,000 duplicate NocoDB Image records and broken hero image paths. Decision made to restore from snapshot and redesign the approach.

---

## Original Migration Goal

Restructure the file system from the organic pass_01 layout into a clean, NocoDB-canonical layout:

```
pass_01 (old)                          pass_02 (target)
─────────────────────────────────────  ──────────────────────────────────────
assigned/{plant}/images/{file}      →  plants/{plant}/images/{file}
assigned/{plant}/images/hidden/     →  plants/{plant}/images/hidden/
assigned/{plant}/attachments/       →  plants/{plant}/documents/
hidden/{file}                       →  ignored/{file}
unassigned/unclassified/{file}      →  triage/{file}
unassigned/ignored/{file}           →  ignored/{file}
```

The new layout also consolidated binary documents into `plants/{plant}/documents/` and tracked everything with `Original_Filepath` pointing back to `content/source/original/`.

---

## The Original Prompt That Started This

The migration was initiated with `scripts/migrate-to-pass02.mjs`. The intent documented in that script's header:

```
Migrates content/pass_01 → content/pass_02 using NocoDB as the source of truth.

pass_02 structure:
  plants/<slug>/images/              ← Images: Status=assigned, Plant_Id set
  plants/<slug>/images/hidden/       ← Images: Status=hidden, Plant_Id set
  plants/<slug>/documents/           ← BinaryDocuments: Status=assigned, Plant_Id set
  plants/<slug>/documents/hidden/    ← BinaryDocuments: Status=hidden, Plant_Id set
  triage/                            ← Images: Status=triage, Plant_Id=null
  ignored/                           ← Images: Status=hidden, Plant_Id=null
  documents/
    triage/                          ← BinaryDocuments: Status=triage, Plant_Id=null
    ignored/                         ← BinaryDocuments: Status=hidden, Plant_Id=null
```

The repair script (`repair-pass02-fix.mjs`) was a follow-up designed to fix orphans left by the initial migration — files that existed on disk in pass_02 but had no NocoDB record, and NocoDB records that pointed to non-existent files.

The repair script description:
```
Applies all repair actions to bring pass_02 + NocoDB to a consistent state:
  - Restores misplaced plant images to the correct plants/<slug>/images/ locations
  - Creates NocoDB records for every orphaned file (image → Images, docs/PSDs → BinaryDocuments)
  - Resolves ambiguous filename conflicts using 4 ordered rules
  - Fixes metadata drift (Caption, Attribution, Excluded, Variety_Id, Status, Rotation)
  - Deletes collision-rename duplicates safely
```

---

## What pass_01 Looked Like (Pre-Migration Baseline)

### File counts
```
content/pass_01/
  assigned/    8,745 files  (plant images with NocoDB records)
  design/        351 files  (design assets)
  hidden/      1,861 files  (images set to hidden/excluded)
  ignored/     3,899 files  (UI graphics, confirmed duplicates)
  unassigned/  8,770 files  (triage + unclassified)
  TOTAL:      23,629 files
```

### NocoDB state at snapshot (2026-04-12T07:35)
```
Plants:          241
Varieties:     1,598
Images:       10,967   ← canonical pre-migration count
Attachments:     513   ← sign images, PDFs, posters moved via 'a' hotkey
Documents:       121
BinaryDocuments: 1,334 (approx, pre-extensionless-recovery)
OCR_Extractions: 418
Nutritional_Info: 462
Recipes:          42
```

### Key structural quirk in pass_01
Many image files were stored **under the wrong plant's folder** but had the correct `Plant_Id` in NocoDB. For example:
- `content/pass_01/assigned/peach-palm/images/amazon-grape-sign.jpg`
- NocoDB: `Plant_Id = amazon-tree-grape`

This was from earlier bulk reorganization work where files were moved by plant but some slipped into wrong folders. The migration needed to handle this.

---

## What Went Wrong

### Root cause: the repair script's Achilles heel

`repair-pass02-fix.mjs` matched files-on-disk to NocoDB records **by File_Path only**. It did not:
1. Check the `Attachments` table (so attachment files that were also physically present got new Image records created)
2. Handle the case where a pre-migration Image record had a **pass_01 path** while the file now lived at a **pass_02 path** — it treated these as unrelated, leaving the old record AND creating a new one

### The cascade of duplicates

The `fruit pix/` directory in `content/source/original/` is a near-complete mirror of the root `original/` directory. Many files existed in both locations. The migration copied both. When the second copy arrived at a destination where a file already existed, the repair script:
1. Renamed it with a `_1` suffix (e.g., `amazon-grape-sign_1.jpg`)
2. Created a **new NocoDB Image record** for the renamed file
3. Then the same file might arrive a third time from yet another source path → `_1_1.jpg` with another record

**Result:** 40,109 new Image records created by the repair script. 38,194 had `_N` collision suffixes. Only 1,915 were genuinely new files.

### Pre-migration Image path mismatch
Of 10,967 pre-migration Image records:
- 8,552 had `pass_01` paths
- 2,415 had other paths (old `content/parsed/unclassified/`, `content/assigned/`, etc.)

The repair script had no logic to recognize that a file at `pass_02/plants/foo/images/bar.jpg` was the same as the pre-migration record pointing to `pass_01/assigned/foo/images/bar.jpg`. So it created **new records without deleting old ones** → duplicates.

### Hero image path breakage
`Hero_Image_Path` on the Plants table is stored as a relative path (e.g., `peach-palm/images/amazon-grape-sign.jpg`). The server prepends `IMAGE_MOUNT_PATH` to resolve the full path. When `IMAGE_MOUNT_PATH` changed from `content/pass_01/assigned` to `content/pass_02/plants`:
- 28 of 36 hero paths resolved correctly (plant folder structure matched)
- 5 needed slug fixes (stored under wrong plant slug's folder)
- 3 were broken because the hero file was itself collision-renamed (`DSCN0085.JPG` → `DSCN0085_1.JPG`)

### Triage count explosion
`repair-pass02-fix.mjs` set `Status='triage'` for any file it couldn't categorize. This included ~17,257 files in `pass_02/ignored/` — these should have been `Status='hidden', Excluded=true`. A second script (`fix-triage-status.mjs`) was needed to correct this after the fact.

---

## What We Discovered Along the Way

### Source directory structure
- `content/source/original/` contains **15,362 files**
- `content/source/original/fruit pix/` is a near-complete mirror of many subdirectories in `original/` — this is the #1 source of duplicates
- 851 files had no extension (were information documents, PSD files, etc.) — these were recovered via magic-bytes detection and imported into BinaryDocuments
- 54 images and 22 PSDs from `original/` had no NocoDB records at all — these were imported this session

### NocoDB field name inconsistency
- Images table uses `Original_Filepath` (no underscore before Path)
- BinaryDocuments table uses `Original_File_Path` (underscore before Path)
- NocoDB returns 404 (not an empty value) when you request a field that doesn't exist — this caused the initial audit script to fail on BinaryDocuments

### Pre-existing structural issues in pass_01
- 100 Attachment files were also present as Image records (pre-existing dual records before the migration even started)
- Multiple images had `Plant_Id` set to one plant but physically lived under a different plant's folder in pass_01
- Some hero image paths pointed to files in wrong-plant folders (e.g., the amazon-tree-grape hero was at `peach-palm/images/amazon-grape-sign.jpg`)

### Status taxonomy confusion
During the repair, the `Status` field values became mixed. The correct taxonomy:
- `assigned` = has Plant_Id, Excluded=false
- `hidden` = Excluded=true (plant may or may not be set)
- `triage` = no Plant_Id, Excluded=false, needs human review
- `unclassified` = legacy status from before pass_01, same as triage

Files in `pass_02/ignored/` must have `Status='hidden', Excluded=true` — the repair script didn't enforce this.

### phash findings (from this session's dedup work)
- At Hamming distance ≤ 2: 35 triage images match assigned images
- 2 genuine swap candidates (rheedia2.jpg group is higher resolution than current assigned wampi image)
- 33 near-exact duplicates at dist=0,1 (safe to hide/delete from triage)
- The `fruit pix/` mirror is responsible for most false phash matches in avocado variety images

---

## What a Better Migration Script Needs to Do

### 1. Match records by content hash, not just filename
Before creating any new NocoDB record, compute an MD5 of the file and check against:
- Existing Image records (via `Original_Filepath` → original file hash)
- Existing Attachment records
- Existing BinaryDocument records

Only create a new record if no hash match exists anywhere.

### 2. Check ALL tables before creating Image records
The repair script only checked Images and BinaryDocuments. It must also check:
- Attachments (by File_Path and by filename)
- Then skip or merge, never create a duplicate

### 3. Deduplicate source files before migration
The `fruit pix/` mirror creates file-for-file duplicates. Before migrating, build a dedup map:
- Group files by MD5 hash
- For each duplicate group, pick ONE canonical file to copy (prefer the non-`fruit pix/` path)
- Discard the rest, never copy them to pass_02

### 4. Handle pre-migration path mismatches explicitly
When a file is found in pass_02 at `plants/{slug}/images/{file}` and there is an existing Image record with a pass_01 path for the same plant/filename:
- **Update** the existing record's `File_Path` → do NOT create a new record

### 5. Update Hero_Image_Path atomically with file moves
When a file that is a plant's hero gets moved, update `Hero_Image_Path` in the same transaction/batch.

### 6. Never set Status='triage' as a fallback
Any file that doesn't match a known NocoDB record should be placed in `triage/` on disk with `Status='triage'` ONLY if it's a genuinely new image with no plant. Otherwise, use the NocoDB record's existing status.

### 7. Correct status for ignored/ files
Files placed in `pass_02/ignored/` must receive `Status='hidden', Excluded=true` at creation time — not later via a repair script.

### 8. Verify before committing
Run a --dry-run that produces a report showing:
- Files that will be created as new NocoDB records (with content hash)
- Files that will update existing NocoDB records
- Files that are genuine duplicates (will be skipped)
- Files that have no match (will go to triage)

Review the dry-run report for anomalies before running live.

---

## File Inventory at Time of Rollback

### content/source/original/ (read-only, never modified)
- 15,362 total files
- 9,511 matched to NocoDB as assigned
- 3,976 matched as hidden
- 1,327 matched as binary documents (includes 851 recovered extensionless)
- 395 matched as triage
- 99 unmatched (51 eml, 14 html, 12 txt, 22 other non-content)
- 54 images and 22 PSDs imported to NocoDB this session

### content/pass_01/ (pre-migration, intact)
- 23,629 files; structure unchanged from before the migration
- This is the rollback target for the file system

### content/pass_02/ (post-migration, to be deleted on rollback)
- 57,874 files total
- Structure is correct in concept but has massive duplicate records in NocoDB

### NocoDB snapshot for rollback
Use `content/backups/nocodb-2026-04-12-07-35-05/` (2026-04-12T07:35:08Z)
- This is the last clean state before the repair script ran
- 10,967 Images, 513 Attachments, 121 Documents

---

## Scripts Produced This Session (Reference)

All in `scripts/` — some are cleanup/diagnostic only:

| Script | Purpose | Keep? |
|--------|---------|-------|
| `audit-original-coverage.mjs` | Compare original/ files to pass_02 coverage | ✓ |
| `audit-original-vs-nocodb.mjs` | Full reconciliation original/ → NocoDB | ✓ |
| `backfill-extensionless-orig-path.mjs` | Set Original_File_Path on BinaryDocuments for extensionless files | ✓ |
| `recover-extensionless.mjs` | Magic-bytes detect + copy extensionless files from original/ | ✓ |
| `organize-extensionless.mjs` | Rename extensionless type dirs (ole→doc, text→txt, etc.) | ✓ |
| `import-orphan-originals.mjs` | Import 54 unmatched images + 22 PSDs from original/ | ✓ |
| `hash-triage-images.mjs` | dHash perceptual hashing for triage images | ✓ |
| `hash-triage-dimensions.mjs` | Fill pixel dimensions for pre-hashed triage images | ✓ |
| `find-phash-swap-candidates.mjs` | Compare triage phashes to assigned, find swap candidates | ✓ |
| `dedup-triage-vs-assigned.mjs` | MD5 + phash dedup of triage vs assigned | ✓ |
| `fix-triage-status.mjs` | Fix Status=triage on files that should be hidden | diagnostic |
| `_tmp_triage_audit.mjs` | Temp: audit triage path buckets | delete |
| `_hero_audit.mjs` | Hero image path validation | delete |
| `repair-pass02-fix.mjs` | The repair script that caused the problem | archive |
| `repair-pass02-orphans.mjs` | Earlier orphan repair | archive |
| `migrate-to-pass02.mjs` | The original migration script | archive |

---

## Rollback Steps (When Ready)

1. **Restore NocoDB** from `content/backups/nocodb-2026-04-12-07-35-05/`:
   - DELETE all current Images, BinaryDocuments records
   - Bulk-insert from snapshot JSON files

2. **Revert IMAGE_MOUNT_PATH** in `review-ui/.env`:
   - From: `C:\Users\darren\sandbox\homegrown\htfg_fruitfixer/content/pass_02/plants`
   - To: `C:\Users\darren\sandbox\homegrown\htfg_fruitfixer/content/pass_01/assigned`

3. **Delete pass_02** (57,874 files, ~40GB estimated):
   - `rm -rf content/pass_02`
   - pass_01 is intact and is the source of truth for the file system

4. **Verify**: Hit the UI, check a few plants, confirm gallery loads and hero images display.

5. Note: The new UI features built this session (SwapCandidatesTab, Documents tab error fix, etc.) are code-only and are NOT affected by the rollback.
