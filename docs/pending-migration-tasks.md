# Pending Migration Tasks

Last updated: 2026-03-29, commit 8da46a4

## Task 1: Recover 1,904 Missing Files from content/parsed/

**Status:** DONE (2026-03-29) — 1,904 files copied via `scripts/recover-parsed-missing.mjs`
- 127 plant-associated → pass_01/assigned/{slug}/images/ (collision-renamed with _1 suffix where needed)
- 1,777 unclassified → pass_01/unassigned/unclassified/ (subdirectory structure preserved)
- Note: verify script shows 127 "still missing" — false negative because collision-renamed files have `_1` suffix, not matched by name+size check. Content is preserved.
- Safe to delete content/parsed/plants/ and content/parsed/unclassified/ when ready.

The earlier recovery script matched files by `filename+size`, but 1,904 files have identical filenames with different byte sizes (different photos from different camera shoots, e.g., DSCN0001.JPG from multiple sessions).

### 1A: Copy 127 plant-associated images to pass_01/assigned/
- Source: `content/parsed/plants/{plant-slug}/images/`
- Destination: `content/pass_01/assigned/{plant-slug}/images/`
- Handle filename collisions by appending `_1`, `_2` suffix
- Plants affected: pumelo (largest), grapefruit, banana, coffee, avocado, lemon, lime, fig, and others
- Verification: run `scripts/verify-parsed-migration.mjs` — parsed/plants missing count should be 0

### 1B: Copy 1,777 unclassified images to pass_01/unassigned/unclassified/
- Source: `content/parsed/unclassified/images/`
- Destination: `content/pass_01/unassigned/unclassified/` (preserve subdirectory structure)
- Breakdown: 1,373 jpg + 375 gif + 29 png
- Many have plant-relevant directory names (e.g., "figs - aichi JA", "yellow jade orchid tree", "ume") — worth running Phase 4C inference after recovery
- Verification: run `scripts/verify-parsed-migration.mjs` — total missing should be 0

### 1C: Verify and clean up
- Run `scripts/verify-parsed-migration.mjs` — should report "ALL files accounted for"
- Only then safe to consider deleting `content/parsed/plants/` and `content/parsed/unclassified/`

---

## Task 2: Reorganize Metadata Files (content/parsed/*.json → data/)

**Status:** NOT DONE — blocked on Task 1

Move all JSON metadata out of `content/` into a new `data/` directory:

```
data/
  nocodb_table_ids.json              # DB config (imported by server + scripts)
  active/
    phase4c_inferences.json          # Read by /api/matches endpoint
  pipeline/                          # Historical outputs (read-only archive)
    phase1_*.json                    # Plant registry, harvest calendar, directories
    phase2_*.json                    # File inventory batches, duplicates, needs_review
    phase3_*.json                    # Content extraction (articles, recipes, PDFs, etc.)
    phase4_*.json, phase4b_*.json    # Image organization, fuzzy inference
    phase6_*.json                    # OCR extraction
    cleanup_*.json                   # Phase 7 ETL intermediates
    load_*.json                      # Phase 7 NocoDB load payloads
    plant_registry.json              # Phase 1 source (superseded by NocoDB)
    file_inventory.json              # Phase 2 source (superseded by NocoDB)
    ocr_*.json                       # OCR pipeline intermediates
    triage_decisions.json            # Triage state
    site_link_graph.json             # Link analysis
    plant_evidence_report.json       # Analysis artifact
```

### After moving, update import paths in:
- `review-ui/server/lib/nocodb.ts` — reads `nocodb_table_ids.json`
- `review-ui/server/routes/matches.ts` — reads `phase4c_inferences.json` (INFERENCES_JSON constant)
- `scripts/phase4c-infer-varieties.mjs` — reads table IDs + writes inferences
- `scripts/phase4b-infer-plants.mjs` — reads registry, writes to parsed/
- Any other scripts that reference `content/parsed/` (grep for it)
- `CLAUDE.md` — update repository structure documentation

### Delete after migration:
- `content/parsed/plants/` — images already in pass_01/assigned/
- `content/parsed/unclassified/` — images already in pass_01/unassigned/
- `content/parsed/kola-nut/` — stray plant directory, verify contents first

---

## Task 3: Review hidden/ and ignored/ Folders

**Status:** NOT DONE

### 3A: Review hidden/ (1,855 images)
- Mix of manually triage'd + auto-classified images — NOT fully human-reviewed
- Some potentially valuable images may be here
- Option: Surface in /matches UI for review

### 3B: Review unassigned/ignored/ (4,194 images)
- 241 confirmed exact duplicates of assigned/ images (MD5 verified)
- 3,953 original triage rejects (UI graphics, nav elements, etc.)
- Static HTML report at: `content/pass_01/unassigned/ignored-vs-assigned-report.html`
- Option: Surface largest files (likely real photos, not UI elements) in /matches UI

---

## Task 4: Run Phase 4C on Recovered Images

**Status:** Blocked on Task 1

After recovering the 1,777 unclassified images (Task 1B):
1. Run `node scripts/phase4c-infer-varieties.mjs` to generate new inferences
2. Restart the Express server
3. Review matches at `/matches` page

---

## Task 5: Source-to-Pass01 Audit Report

**Status:** NOT STARTED

Create a comprehensive report comparing `content/source/` (22,994 original images) against `content/pass_01/` to document what action was taken on every file:
- assigned (which plant)
- hidden
- ignored (reason: duplicate, UI graphic, etc.)
- missing (not yet accounted for)

This ensures nothing is lost before final content/ cleanup.

---

## Environment Setup on New Machine

After `git pull`:
1. Copy `review-ui/.env` from old machine — update paths:
   - `IMAGE_MOUNT_PATH` → path to `content/pass_01/assigned`
   - `CONTENT_ROOT` → path to `content/`
2. `cd review-ui && npm install`
3. `cd .. && npm install` (root package.json for scripts)
4. Start servers: `cd review-ui && npx tsx server/index.ts` + `npx vite --port 5173 --host 0.0.0.0`
5. Login at `http://localhost:5173/login` — admin@example.com / htfg-admin-2026

### Key paths that may need updating:
- `review-ui/server/routes/matches.ts` line ~11: `PROJECT_ROOT` — FIXED (now derived from `config.CONTENT_ROOT`)
- `scripts/phase4c-infer-varieties.mjs` uses `import.meta.dirname` (relative, should be fine)
