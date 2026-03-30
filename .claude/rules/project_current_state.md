---
name: Current project state (March 29 2026)
description: Detailed snapshot of project architecture, file counts, DB state, and pending work
type: project
---

## Review UI App (`review-ui/`)
- Express server at port 3001, Vite dev at port 5173
- Start: `cd review-ui && npx tsx server/index.ts` + `npx vite --port 5173 --host 0.0.0.0`
- Admin login: admin@example.com / htfg-admin-2026
- `.env` in review-ui/ has all config (IMAGE_MOUNT_PATH, CONTENT_ROOT, NOCODB_API_KEY, etc.)
- SQLite DB at `review-ui/data/db/review.db` (auth, sessions, staff_notes, hero_images)
- Tests: 254 pass (6 test files), run with `npx vitest run`
- Build check: `npx vite build` (catches OXC parse errors that vitest misses)

## Key Architecture
- NocoDB (remote at nocodb.djjd.us) stores all plant/image/variety data
- Express proxies NocoDB via `server/lib/nocodb.ts` singleton client
- Table IDs in `content/parsed/nocodb_table_ids.json`
- Local SQLite for auth, sessions, staff_notes, hero_images
- React 18 SPA with ShadCN/ui (Tailwind), TypeScript
- Docker build via GitHub Actions -> GHCR (not yet deployed to prod)

## NocoDB Database
- Base ID: pimorqbta2ve966
- 15+ tables: Plants (195), Varieties (1,547), Images (11,553), Documents, Recipes (42), OCR_Extractions (531), Nutritional_Info (473), Attachments (129), Tags, Geographies, Growing_Notes, Pests, Diseases, FAQ
- Images.Variety_Id is FK to Varieties.Id (refactored from denormalized Variety_Name string on 2026-03-26)
- Images fields: File_Path, Plant_Id, Caption, Source_Directory, Size_Bytes, Confidence, Excluded, Needs_Review, Rotation, Perceptual_Hash, Status, Attribution, License, Variety_Id

## File System (content/pass_01/)
```
assigned/     18,160 images — organized by plant slug (e.g., assigned/banana/images/)
hidden/        1,855 images — mix of manual triage + auto-classified (NOT fully human-reviewed)
ignored/       3,548 images — UI graphics, nav elements, confirmed duplicates
unassigned/
  _to_triage/      4 images — flagged for closer review
  ignored/     4,194 images — duplicates moved from unclassified (241 MD5-verified vs assigned, 3,953 original triage rejects)
  unclassified/    0 images — all processed
```

## Key Files (line counts)
- `server/routes/browse.ts` (1,164 lines) — 40+ CRUD endpoints for plants, images, varieties, docs, attachments, export/import
- `server/routes/matches.ts` (346 lines) — Phase 4C match review endpoints (GET matches, POST approve/review/ignore/undo)
- `src/components/browse/tabs/GalleryTab.tsx` (1,373 lines) — 4 view modes, lightbox, multi-select, keyboard shortcuts
- `src/pages/MatchReviewPage.tsx` (227 lines) — /matches two-column review page
- `src/pages/PlantDetailPage.tsx` (267 lines) — 9 tabs: Overview, Gallery, Varieties, Nutrition, Docs, Attachments, Recipes, OCR, Notes
- `src/pages/PlantGridPage.tsx` (357 lines) — infinite scroll grid with search, category filter, sort
- `src/components/browse/PlantAutocomplete.tsx` (381 lines) — shared plant search/select with create-new
- `src/components/browse/VarietyAutocomplete.tsx` (316 lines) — VarietyPicker + GroupVarietyPicker
- `src/lib/gallery-utils.ts` (55 lines) — hammingDistance, toRelativeImagePath, buildImageUrl, rotationStyle, rotationClass

## Gallery Tab (most complex component)
- Uses refs (displayImagesLenRef, displayImagesRef) to keep lightbox and grid in sync
- displayImages = flattened groupedImages in grouped modes, raw images in grid mode
- Known fragility: React hooks ordering — any new hook MUST go before early returns (isLoading/isEmpty checks)
- Lightbox uses `onOpenAutoFocus` prevention to avoid input stealing keyboard shortcuts
- Rotation at 90/270 deg uses swapped viewport dimension limits (maxWidth: 60vh, maxHeight: 80vw)

## Processing Scripts (scripts/)
- `phase4c-infer-varieties.mjs` — variety-aware matching from NocoDB data, 812/4,022 matches (20.2%)
- `phase4b-infer-plants.mjs` — original plant inference from registry+CSV (superseded by 4C for DB-backed matching)
- `compute-phash.mjs` — dHash computation via Sharp, 10,402 images hashed
- `phase6-ocr-extract.mjs` — Claude API structured extraction, 531 successful
- `generate-ignored-report.mjs` — HTML report comparing ignored vs assigned with MD5 checksums and thumbnails

## Pending/Future Work
- **hidden/ folder review**: Contains potentially valuable images that were auto-classified, not all human-reviewed
- **ignored/unassigned/ review**: 3,953 files from original triage + 4,194 duplicates — could surface in /matches UI for review
- **Empty NocoDB tables**: Geographies, Growing_Notes, Pests, Diseases, FAQ
- **Docker deployment**: Config exists, not yet deployed to production
- **Public-facing website**: Not started
- **Firefox drag-and-drop upload**: Works in Chromium but not Librewolf/Firefox
