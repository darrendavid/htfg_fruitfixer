---
name: Project Decisions
description: Key decisions made during the project with dates
type: project
---

## 2026-03-18
- **Phase ordering**: Run OCR extraction (Phase 6) BEFORE NocoDB population (Phase 7) so extracted data informs schema design
- **4 varietals demoted**: guava-strawberry, lime-rangpur, jaboticaba-paulista, yellow-jaboticaba moved from Plants to Varieties table
- **51 emails excluded**: All zero content, not worth importing
- **3,862 images excluded**: By triage (non-plant content, duplicates)
- **NocoDB schema**: 15 tables created (Plants, Varieties, Geographies, Images, Documents, Recipes, OCR_Extractions, Nutritional_Info, Growing_Notes, Pests, Diseases, FAQ, Tags, Attachments + local SQLite tables)

## 2026-03-19
- **Phase 4B "mysore" bug identified**: CSV variety match (Mysore banana) overrode registry plant match (Mysore Raspberry). Registry plant names should take priority over CSV variety matches.
- **Banana varieties extensively curated** from 2 Big Island Bananas posters — genome groups (AA, AAB, ABB, AAA, AAAB, BB, BBB), merges, renames, 96 total varieties
- **Image similarity**: Use perceptual hashing (dHash via Sharp) not filename matching. 10,402 images hashed, Hamming distance <=8 for grouping.
- **Gallery view modes**: 4 modes — grid (paginated), directory-grouped, variety-grouped, similarity-grouped (all lazy-loaded with infinite scroll)
- **Hero images stored in SQLite** (not NocoDB) for fast local access
- **Plants table extended** with: Alternative_Names, Origin, Flower_Colors, Elevation_Range, Distribution, Culinary_Regions, Primary_Use, Total_Varieties, Classification_Methods, Parent_Species, Chromosome_Groups, Genetic_Contribution
- **Varieties table** has Genome_Group column
- **Images table** has Perceptual_Hash, Rotation, Variety_Id (foreign key), Status, Attribution, License columns

## 2026-03-20
- **"d" hotkey changed to "a"** for move-to-attachments (not documents)
- **Move-to-documents changed to move-to-attachments** — user prefers images that are documents (signs, posters) go to Attachments tab not Documents
- **Save button auto-saves** — clicking "Save" (was "Done Editing") triggers handleSave before toggling edit mode off
- **PATCH route slug resolution** — PATCH /:id now resolves slugs via list query (same as GET), not just numeric IDs
- **Attachment file structure** (future): `content/parsed/plants/{id}/attachments/` — same pattern as images, single Docker volume mount
- **File organization deferred** — get data clean first, organize files later

## 2026-03-26
- **Variety_Id foreign key refactor**: Images.Variety_Name (denormalized string) replaced with Images.Variety_Id (integer FK to Varieties.Id). Server enriches images with Variety_Name via lookup on read. Eliminates cascade updates on variety rename/merge.
- **Phase 4C inference uses live NocoDB data**: NOT CSV files or plant_registry.json. Fetches Plants + Varieties tables directly for matching. Varieties auto-resolve parent plant via Plant_Id.
- **Match review workflow**: New /matches page with approve (copy to assigned + create DB record), triage (move to _to_triage/), ignore (move to ignored/) actions. Each action returns an undo_token for Ctrl+Z reversal.
- **All 4,022 unassigned/unclassified images were duplicates** of DB images (filename+size match). Moved to ignored/. Zero unique unclassified images remain.
- **1,664 images recovered** from content/parsed/ that were missed during pass_01 reorganization (504 plant-associated → assigned/, 1,160 unclassified → unassigned/).

## 2026-03-29
- **Lightbox auto-focus prevention**: DialogContent uses `onOpenAutoFocus={(e) => e.preventDefault()}` so keyboard shortcuts work immediately (was focusing PlantAutocomplete input with single-image galleries)
- **Rotation overflow fix**: 90/270 degree rotated images in lightbox use `maxWidth: 60vh, maxHeight: 80vw` to fit within dialog
- **hidden/ folder NOT fully human-reviewed**: Contains mix of manually triage'd items + auto-classified. Some potentially valuable images may be there.
- **ignored/ folder contains two populations**: 3,953 original triage rejects (UI graphics etc.) + 241 confirmed exact duplicates of assigned images (MD5 verified, 0 mismatches)

## 2026-04-03 to 2026-04-07 (Major data integrity + feature session)
- **Classify page replaces Matches page**: /classify URL with 6 tabs: Triage, Variety Matches, No Variety, No Plant, Recovered, Dedup Review
- **Swipe page removed** from navigation
- **Hero images migrated to NocoDB**: Added `Hero_Image_Path` and `Hero_Image_Rotation` columns to Plants table. SQLite hero_images table no longer canonical — NocoDB is the single source of truth for all plant data.
- **Image_Count NOT stored in DB**: Computed live from NocoDB query with 5-minute server-side cache. Invalidated only on plant create/delete, image reassign, status change, upload.
- **Aliases field deprecated**: Legacy JSON array field replaced by `Alternative_Names` (text). All UI references updated.
- **Original_Filepath mapping**: MD5 hash-verified mapping of each assigned image back to content/source/. Must compare actual disk file size (not NocoDB Size_Bytes which may be stale from original import).
- **Dedup strategy**: Keep record with most metadata (assigned + Plant_Id set) as keeper, NOT lowest Id. Merge Plant_Id, Status, Variety_Id, Caption, Rotation into keeper from deleted records.
- **Variety name alias matching**: Split variety names on ` / ` delimiter for matching (e.g. "Saba / Dippig / 'Opo'ulu" matches directory "dipping"). Strip apostrophes/okina in normalization.
- **ForceMount on all plant detail tabs**: Prevents re-fetch when switching tabs (350ms vs 10s for 1500-image galleries)
- **GalleryThumbnail is React.memo**: Local dim state per thumbnail, O(1) index map — prevents O(n²) renders
- **Variety merge must merge metadata**: All text fields (Description, Characteristics, Tasting_Notes, etc.) merged from source to target variety. Merged variety name added as Alternative_Name.
- **Orphan slug remapping**: When plant slugs change, ALL tables must cascade: Varieties.Plant_Id, Images.Plant_Id, Nutritional_Info.Plant_Id, Documents/Recipes/OCR/Attachments.Plant_Ids JSON arrays, SQLite staff_notes.plant_id
- **Status must match assignment**: Any image with Plant_Id set must have Status='assigned' (not 'unclassified' or 'unassigned')
- **File_Path must match Plant_Id**: Images in assigned/{plant}/images/ must have matching Plant_Id. Run sync-assigned-folders.mjs after bulk reassignments.
- **HTML gallery context**: 399 filename→variety mappings extracted from Adobe gallery pages and Phase 3 fruit data, used as Strategy 13 in variety inference
- **18 variety-plant mismatches remain**: These are data errors (images assigned to wrong plant with banana varieties), need manual review
