# HTFG Fruit Database -- Product Requirements Document

**Version:** 1.0
**Last Updated:** 2026-03-19
**Status:** Phase 8 (Plant Browser UI) delivered; ongoing refinement

---

## 1. Product Overview

### What It Is

The HTFG Fruit Database is an internal web application for the Hawaii Tropical Fruit Growers (HTFG) organization. It transforms a 30-year archive of static HTML pages, photographs, documents, and spreadsheets from HawaiiFruit.net into a structured, searchable plant database with a modern editing UI.

### Who It Is For

- **HTFG Staff (admins):** Curate plant records, organize images by variety, correct OCR extractions, write staff notes, and manage the database content.
- **HTFG Reviewers:** Browse the plant database, add staff notes, and participate in image classification review queues.
- **Future: Public visitors** (not yet built) -- a read-only public-facing website powered by the same data.

### What It Does

1. Serves as the canonical reference database for 136 tropical fruit plants, 1,374 varieties, 11,541 images, 173 documents, 42 recipes, and 531 OCR extractions.
2. Provides a browser-based UI for searching, browsing, and editing all plant data.
3. Supports image curation workflows: hero selection, rotation, variety assignment, plant reassignment, duplicate detection via perceptual hashing, and bulk operations.
4. Hosts a review queue system for human classification of unclassified images and OCR extraction review.

---

## 2. Architecture

```
                         +-----------------------+
                         |   GitHub Container    |
                         |   Registry (GHCR)     |
                         +-----------+-----------+
                                     |
                                     | Docker pull
                                     v
+--------+     HTTPS     +----------+-----------+     HTTPS      +------------------+
| Browser | -----------> |   Express Server      | ------------> | NocoDB           |
| (React) |              |   (Node 24, port 3000)|               | nocodb.djjd.us   |
+--------+               +-----------+-----------+               +------------------+
                                     |
                          +----------+----------+
                          |                     |
                    +-----v-----+       +-------v--------+
                    |  SQLite   |       |  Static Files  |
                    |  /data/db |       |  /data/images  |
                    +-----------+       +----------------+
```

### Layers

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 18 + TypeScript + ShadCN/ui + Tailwind CSS | Single-page application |
| Data fetching | fetch + local state (no query library in browse UI) | API calls with credentials |
| Routing | react-router-dom v7 | Client-side navigation |
| Backend | Express 4 (TypeScript, compiled to JS) | API proxy, auth, static serving |
| Primary data store | NocoDB v2 REST API (self-hosted) | Structured plant data (14 tables) |
| Local data store | SQLite (better-sqlite3) | Auth, review queues, staff notes, hero images |
| Image serving | Express static middleware | Serves `content/parsed/` via `IMAGE_MOUNT_PATH` |
| Auth | Magic-link email + session cookies | Passwordless authentication |
| CI/CD | GitHub Actions | Builds Docker image on push to `review-ui/**` |
| Container registry | GitHub Container Registry (ghcr.io) | Hosts production Docker images |

### Docker Deployment

**Dockerfile** (multi-stage):
1. Build stage: `node:24-alpine`, runs `npm ci && npm run build`
2. Runtime stage: `node:24-slim`, copies `dist/` and production deps, exposes port 3000

**Volume mounts:**
- `/data/db` -- SQLite database files (persistent)
- `/data/images` -- `content/parsed/` directory tree with organized plant images (read-only)
- `/data/logs` -- Application logs

**GitHub Actions CI/CD** (`.github/workflows/docker-build.yml`):
- Triggers on push to `main` when `review-ui/**` changes
- Builds and pushes to `ghcr.io/{repo}/review-ui` with tags: `latest`, `main`, `sha-{commit}`
- Uses Docker Buildx with GitHub Actions cache

---

## 3. Data Model

### 3.1 NocoDB Tables (Primary Data Store)

All structured plant data lives in NocoDB at `https://nocodb.djjd.us`, base ID `pimorqbta2ve966`. Table IDs are stored in `content/parsed/nocodb_table_ids.json` and loaded at server startup.

#### Core Plant Tables

**Plants** -- 136 records
| Field | Type | Description |
|-------|------|-------------|
| Id | auto | NocoDB row ID |
| Id1 | text | URL slug (e.g., `avocado`, `dragon-fruit`) |
| Canonical_Name | text | Display name |
| Botanical_Name | text | Scientific name |
| Family | text | Botanical family |
| Category | text | `fruit`, `nut`, `spice`, `flower`, `other` |
| Aliases | JSON text | Array of alternate names |
| Description | text | Plant description |
| Harvest_Months | JSON text | Array of month numbers (1-12) |
| At_Kona_Station | boolean | Whether grown at Kona research station |
| Alternative_Names | text | Additional common names |
| Origin | text | Geographic origin |
| Flower_Colors | text | Flower color description |
| Elevation_Range | text | Growing elevation range |
| Distribution | text | Geographic distribution |
| Culinary_Regions | text | Culinary tradition regions |
| Primary_Use | text | Primary culinary/commercial use |
| Total_Varieties | text | Estimated variety count |
| Classification_Methods | text | How varieties are classified |
| Parent_Species | text | Parent species for hybrids |
| Chromosome_Groups | text | Chromosome group codes |
| Genetic_Contribution | text | Genetic background notes |
| Image_Count | number | Cached count of associated images |
| Source_Count | number | Number of source directories |

**Varieties** -- 1,374 records
| Field | Type | Description |
|-------|------|-------------|
| Id | auto | NocoDB row ID |
| Plant_Id | text | References Plants.Id1 |
| Variety_Name | text | Variety name |
| Characteristics | text | Physical/growth characteristics |
| Tasting_Notes | text | Flavor description |
| Source | text | Data source reference |

**Nutritional_Info** -- empty (schema created)
| Field | Type | Description |
|-------|------|-------------|
| Id | auto | NocoDB row ID |
| Plant_Id | text | References Plants.Id1 |
| Nutrient_Name | text | e.g., Vitamin C, Fiber |
| Value | text | Numeric value |
| Unit | text | e.g., mg, g, % |
| Per_Serving | text | Serving size basis |
| Source | text | Data source |

#### Content & Media Tables

**Images** -- 11,541 records
| Field | Type | Description |
|-------|------|-------------|
| Id | auto | NocoDB row ID |
| File_Path | text | Path relative to content root |
| Plant_Id | text | References Plants.Id1 |
| Caption | text | Image caption/filename |
| Source_Directory | text | Original source directory |
| Size_Bytes | number | File size |
| Variety_Name | text | Assigned variety (nullable) |
| Rotation | number | Display rotation in degrees (0, 90, 180, 270) |
| Excluded | boolean | Soft-deleted (excluded from display) |
| Needs_Review | boolean | Flagged for review |
| Perceptual_Hash | text | 16-char hex pHash for similarity detection |

**Documents** -- 173 records
| Field | Type | Description |
|-------|------|-------------|
| Id | auto | NocoDB row ID |
| Title | text | Document title |
| Doc_Type | text | recipe, research, guide, poster |
| Content_Text | text | Full extracted text content |
| Content_Preview | text | Truncated preview |
| Plant_Ids | JSON text | Array of associated plant slugs |
| Original_File_Path | text | Path to source file |

**Attachments** -- file references
| Field | Type | Description |
|-------|------|-------------|
| Id | auto | NocoDB row ID |
| Title | text | Display title |
| File_Path | text | Path to file |
| File_Name | text | Original filename |
| File_Type | text | MIME type or extension |
| File_Size | number | Size in bytes |
| Plant_Ids | JSON text | Array of associated plant slugs |
| Description | text | Optional description |

**Recipes** -- 42 records
| Field | Type | Description |
|-------|------|-------------|
| Id | auto | NocoDB row ID |
| Title | text | Recipe title |
| Ingredients | text | Ingredient list |
| Method | text | Cooking instructions |
| Plant_Ids | JSON text | Array of associated plant slugs |
| Source_File | text | Original source file path |

**OCR_Extractions** -- 531 records
| Field | Type | Description |
|-------|------|-------------|
| Id | auto | NocoDB row ID |
| Image_Path | text | Path to source image |
| Title | text | Extracted title |
| Content_Type | text | poster, data-sheet, label, sign, table |
| Extracted_Text | text | Full OCR text |
| Key_Facts | JSON text | Array of `{field, value}` structured facts |
| Plant_Ids | JSON text | Array of associated plant slugs |
| Source_Context | text | Context (conference, research station, etc.) |

#### Empty Tables (Schema Created, Not Yet Populated)

| Table | Purpose |
|-------|---------|
| **Geographies** | Hawaii island/district/moku geographic reference |
| **Growing_Notes** | Per-plant growing conditions by geography |
| **Pests** | Pest identification and treatment |
| **Diseases** | Disease identification and treatment |
| **FAQ** | Per-plant frequently asked questions |
| **Tags** | Cross-cutting metadata tags |

### 3.2 SQLite Tables (Local Data Store)

SQLite is used for data that benefits from fast local writes, session management, and review workflow state. Schema defined in `review-ui/server/lib/schema.ts`.

**users**
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| email | TEXT UNIQUE | Login email |
| first_name | TEXT | Display name |
| last_name | TEXT | Display name |
| role | TEXT | `admin` or `reviewer` |
| last_active_at | TEXT | Last activity timestamp |
| created_at | TEXT | Account creation |

**magic_links** -- Passwordless auth tokens

**sessions** -- Active user sessions with expiry

**review_queue** -- Image classification queue
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| image_path | TEXT UNIQUE | Path to image under review |
| queue | TEXT | Queue name (e.g., `unclassified`, `phase4b`) |
| status | TEXT | `pending`, `completed`, `skipped` |
| current_plant_id | TEXT | Current assignment |
| suggested_plant_id | TEXT | ML/fuzzy suggestion |
| confidence | TEXT | Suggestion confidence level |
| match_type | TEXT | How suggestion was generated |
| reasoning | TEXT | Explanation for suggestion |
| idk_count | INTEGER | Times skipped as "I don't know" |

**review_decisions** -- Audit trail of reviewer actions

**new_plant_requests** -- Requests to add plants not in the registry

**plants** -- Read-only reference copy from `plant_registry.json`

**ocr_extractions** -- Local OCR review queue with status tracking

**staff_notes** -- Per-plant staff comments
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| plant_id | TEXT | References plant slug |
| variety_id | INTEGER | Optional variety reference |
| user_id | INTEGER FK | References users.id |
| text | TEXT | Note content |
| created_at | TEXT | Timestamp |
| updated_at | TEXT | Last edit timestamp |

**hero_images** -- User-selected hero images per plant
| Column | Type | Description |
|--------|------|-------------|
| plant_id | TEXT PK | Plant slug |
| image_id | INTEGER | NocoDB image row ID |
| file_path | TEXT | File path for serving |

---

## 4. Features Implemented

### 4.1 Plant Grid Browser (`/plants`)

- **Responsive card grid:** 2 columns on mobile, 3 on tablet, 4-5 on desktop
- **Plant cards:** Hero image thumbnail, canonical name, botanical name (italic), category badge, image count
- **Search:** Debounced (300ms) full-text search across plant names, botanical names, aliases, plus cross-table search in documents, recipes, OCR extractions, and varieties
- **Category filter:** Dropdown with options: All, Fruit, Nut, Spice, Flower, Other
- **Sort:** Name A-Z, Name Z-A, Most Images
- **Pagination:** 24 plants per page with Previous/Next controls
- **Loading state:** Skeleton placeholders during fetch
- **Empty state:** Contextual message when no results match

### 4.2 Plant Detail Page (`/plants/:id`)

Supports both numeric NocoDB row IDs and text slugs (e.g., `/plants/avocado`). Tabbed interface with 9 tabs:

#### Overview Tab
- **Hero image** scaled to fit viewport (max 60vh)
- **Plant metadata:** Canonical name, botanical name, category badge
- **Aliases** parsed from JSON array
- **Harvest calendar:** 12-month visual bar (green = available, gray = not)
- **Description** with whitespace preservation
- **Extended detail fields:** Alternative Names, Origin, Primary Use, Flower Colors, Elevation Range, Distribution, Culinary Regions, Total Varieties, Parent Species, Chromosome Groups, Genetic Contribution, Classification Methods
- **Stats grid:** Image count, variety count, document count, recipe count
- **Edit mode (admin):** All fields become editable inputs/textareas with Save/Cancel
- **Slug auto-rename:** When Canonical_Name changes, slug (Id1) regenerates and cascades across all related tables (Varieties, Images, Nutritional_Info, Growing_Notes, Documents, Recipes, OCR_Extractions, Attachments) plus local SQLite (hero_images, staff_notes). Browser URL updates to new slug.

#### Gallery Tab
- **4 view modes:**
  - **Grid** -- Flat paginated grid (50/page), 3-6 columns responsive
  - **Directory-grouped** -- Groups images by source directory, collapsible sections
  - **Variety-grouped** -- Groups images by assigned variety name, unassigned last
  - **Similarity-grouped** -- Groups visually similar images using perceptual hash (Hamming distance <=8) with Union-Find clustering; falls back to filename stem grouping if no hashes available
- **Lightbox:**
  - Full-size image display with left/right navigation arrows
  - Image metadata: caption, file path, dimensions (WxH px), file size (KB), rotation degree, position counter (N/M)
  - **Keyboard shortcuts:**
    - Left/Right arrows: Navigate between images
    - `h`: Set as hero image
    - `x`: Delete (exclude) image
    - `[` / `]`: Rotate left/right (90 degree increments)
    - `v`: Focus variety picker input
    - `p`: Focus plant reassignment input
    - `Escape`: Close lightbox
  - Keyboard shortcuts disabled when cursor is in an input/textarea field
- **Multi-select:**
  - `Ctrl+Click`: Toggle individual image selection
  - `Shift+Click`: Range selection from last clicked
  - Selection toolbar shows count, bulk delete button, clear button
- **Per-image actions (admin, hover):**
  - Rotate left/right buttons on thumbnail corners
- **Hero image:** Gold star indicator on current hero in both grid and lightbox
- **Image rotation:** CSS transform applied to thumbnails and lightbox; rotation value persisted to NocoDB
- **Plant reassignment:** Autocomplete search for target plant in lightbox; supports create-new-plant flow; image removed from current gallery on reassign
- **Variety assignment:** Autocomplete against existing varieties; Enter on non-matching text offers "Create & Assign" confirmation; creates variety record then assigns
- **Group-level actions (grouped views, admin):** Per-group plant reassignment and variety assignment affecting all images in the group
- **Bulk operations:** Bulk delete (exclude), bulk reassign to different plant, bulk set variety

#### Varieties Tab
- Data table with Variety Name, Characteristics, Tasting Notes, Source columns
- **Edit mode (admin):** Inline CRUD -- add new, edit existing, delete with confirmation

#### Nutrition Tab
- Data table with Nutrient Name, Value, Unit, Per Serving, Source columns
- **Edit mode (admin):** Inline CRUD -- add new, edit existing, delete

#### Documents Tab
- Expandable list showing Title, Doc Type badge, content preview
- Full content text available on expand
- Read-only display

#### Attachments Tab
- List of file attachments with Title, File Name, File Type, File Size, Description
- **Edit mode (admin):** Create new attachments, edit metadata, delete

#### Recipes Tab
- Recipe cards with title, ingredients list, method instructions
- Associated plant badges
- Read-only display

#### OCR Tab
- Extraction cards with:
  - Title and content type badge
  - Source image thumbnail (click to view full-size in dialog)
  - Key facts table (field/value pairs)
  - Extracted text (scrollable, max-height)
  - Source context
- **Admin actions:** Delete extraction, reassign to different plant (autocomplete search)
- Full-size image viewer dialog

#### Notes Tab
- Chronological comment thread per plant
- Any authenticated user can add notes
- Edit own notes, admin can edit/delete any
- Optional variety association per note

### 4.3 OCR Review Queue (`/review` with OCR queue type)

Separate review workflow for OCR extraction quality:
- **Next item** endpoint with user-based locking to prevent conflicts
- **Stats** dashboard showing pending/approved/rejected counts
- **Edit fields:** title, extracted text, key facts, plant associations, source context, reviewer notes
- **Actions:** Save (keep pending), Approve, Reject
- Source image display alongside extracted data

### 4.4 Image Classification Review Queue

Review queue for unclassified/ambiguous images from Phase 4B:
- Queue-based workflow with locking (prevents two users reviewing same item)
- Suggested plant with confidence level and match reasoning
- Actions: Assign to suggested plant, assign to different plant, discard, skip ("I don't know")
- New plant request flow for images of plants not in the registry
- Audit trail of all decisions

### 4.5 Admin Dashboard

- "Fruit Database" button linking to `/plants`
- Review queue statistics and access
- User management (admin role)

### 4.6 Authentication

- **Magic-link email:** Passwordless login flow
- **Session cookies:** Persistent sessions with expiry
- **Roles:** `admin` (full CRUD) and `reviewer` (read + notes)
- **Auth guard:** All routes require authentication; admin-only endpoints enforced via `requireAdmin` middleware

---

## 5. API Endpoints

All endpoints require authentication via session cookie unless noted.

### Browse API (`/api/browse`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/browse` | any | List plants (search, category, sort, pagination) |
| GET | `/api/browse/search` | any | Full-text search across all tables |
| GET | `/api/browse/plants-search` | any | Search plants by name (for reassignment dropdowns) |
| GET | `/api/browse/:id` | any | Full plant detail with all related data |
| PATCH | `/api/browse/:id` | admin | Update plant fields (with slug cascade) |
| POST | `/api/browse/create-plant` | admin | Create new plant record |
| GET | `/api/browse/:plantId/images` | any | Paginated images for a plant (`?all=true` for grouped views) |
| POST | `/api/browse/set-hero/:imageId` | admin | Set hero image for a plant |
| POST | `/api/browse/reassign-image/:id` | admin | Move image to a different plant |
| POST | `/api/browse/bulk-reassign-images` | admin | Reassign multiple images to a plant |
| POST | `/api/browse/set-image-variety/:id` | admin | Assign variety to an image |
| POST | `/api/browse/bulk-set-variety` | admin | Set variety on multiple images |
| POST | `/api/browse/rotate-image/:id` | admin | Set rotation (0/90/180/270) for an image |
| POST | `/api/browse/exclude-image/:id` | admin | Soft-delete image (set Excluded=true) |
| GET | `/api/browse/:plantId/varieties-search` | any | Search varieties for a plant |
| POST | `/api/browse/:plantId/varieties` | admin | Create variety |
| PATCH | `/api/browse/varieties/:id` | admin | Update variety |
| DELETE | `/api/browse/varieties/:id` | admin | Delete variety |
| POST | `/api/browse/:plantId/nutritional` | admin | Create nutritional record |
| PATCH | `/api/browse/nutritional/:id` | admin | Update nutritional record |
| DELETE | `/api/browse/nutritional/:id` | admin | Delete nutritional record |
| GET | `/api/browse/:plantId/attachments` | any | List attachments for a plant |
| POST | `/api/browse/:plantId/attachments` | admin | Create attachment record |
| PATCH | `/api/browse/attachments/:id` | admin | Update attachment |
| DELETE | `/api/browse/attachments/:id` | admin | Delete attachment |
| PATCH | `/api/browse/documents/:id` | admin | Update document |
| DELETE | `/api/browse/documents/:id` | admin | Delete document |
| PATCH | `/api/browse/ocr-extractions/:id` | admin | Update OCR extraction |
| DELETE | `/api/browse/ocr-extractions/:id` | admin | Delete OCR extraction |
| GET | `/api/browse/:plantId/notes` | any | List notes for a plant |
| POST | `/api/browse/:plantId/notes` | any | Add note |
| PATCH | `/api/browse/notes/:id` | own/admin | Edit note |
| DELETE | `/api/browse/notes/:id` | own/admin | Delete note |

### OCR Review API (`/api/ocr-review`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/ocr-review/next` | any | Get next OCR item for review (with locking) |
| GET | `/api/ocr-review/stats` | any | Get review queue statistics |
| GET | `/api/ocr-review/:id` | any | Get specific OCR extraction |
| POST | `/api/ocr-review/:id/save` | any | Save edits without changing status |
| POST | `/api/ocr-review/:id/approve` | any | Approve extraction (with optional edits) |
| POST | `/api/ocr-review/:id/reject` | any | Reject extraction |

### Static File Serving

| Path | Source | Description |
|------|--------|-------------|
| `/images/*` | `IMAGE_MOUNT_PATH/` | Organized plant images from `content/parsed/` |
| `/content-files/*` | `content/` | Raw content files (used for OCR source images) |

---

## 6. Processing Pipeline (Phases 1-7)

The plant database was built through a 7-phase automated pipeline, each producing JSON checkpoint files consumed by the next phase.

### Phase 1: Plant Registry
- **Output:** `content/parsed/plant_registry.json` -- 140 plants
- Scanned HawaiiFruit.net directories + original/ directories
- Normalized names, deduplicated, categorized non-plant directories
- 107 plants from website + 33 new from original photos

### Phase 2: File Inventory
- **Output:** `content/parsed/file_inventory.json` -- 31,283 files (39.25 GB)
- Classified every file by type: 22,981 images, 4,388 HTML, 121 documents, 350 design files
- Plant association rate: 33.9% (10,614 files)
- Duplicate detection: 5,533 groups (16,043 files with same name + size)

### Phase 3: Content Extraction
- 9 output files from HTML, XLS, PDF, EML, TXT sources
- Harvest calendar (100 plants), fruit data pages (77), recipes (42), articles (121), spreadsheet rows (1,136), PDFs (33), emails (51), text files (26)

### Phase 4: Image Organization
- **Output:** `content/parsed/phase4_image_manifest.json` -- 15,403 unique images
- Copied 14,157 images (17.81 GB) into `content/parsed/plants/{id}/images/`
- 5,031 classified into 120 plant directories, 10,372 unclassified

### Phase 4B: Fuzzy Plant Inference
- Matched 6,518 of 14,879 unclassified images (43.8%) using fuzzy string matching
- 6 matching strategies: directory exact/substring/fuzzy, filename substring/fuzzy, compound directory
- Reference data: plant registry + tropical_fruits_v10.csv (1,334 rows)
- 8,361 images remained unclassified

### Phase 5: Human Review UI
- Built mobile-friendly web application for staff classification
- Review queues for unclassified images and Phase 4B inference confirmation
- OCR review queue type added in Phase 6

### Phase 6: OCR Extraction
- 531 of 599 candidate images processed successfully (68 errors)
- 3,079 key facts extracted from posters, data sheets, labels, signage
- Structured into title, content type, extracted text, key facts, plant associations

### Phase 7: Data Cleanup & NocoDB Population
- 10 cleanup scripts (`scripts/cleanup-*.mjs`)
- Alias map: 836 entries mapping name variants to canonical plant IDs
- 4 varietals demoted to parent species, 51 zero-content emails excluded, 3,862 images excluded by triage
- 13,797 total records loaded across 13 NocoDB tables (7 populated, 6 empty schema)
- Bulk insert in batches of 100 records

---

## 7. Deployment

### Production Environment

- **Docker image:** Built from `review-ui/Dockerfile`, published to GitHub Container Registry
- **Runtime:** Node.js 24 (slim), single-process Express server
- **Port:** 3000
- **Environment variables:**
  - `NOCODB_URL` -- NocoDB instance URL
  - `NOCODB_API_KEY` -- xc-token for NocoDB v2 API
  - `IMAGE_MOUNT_PATH` -- Path to `content/parsed/` directory
  - `SESSION_SECRET` -- Cookie signing secret
  - `SMTP_*` -- Email configuration for magic links
  - `BASE_URL` -- Public URL for magic link emails
  - `NODE_ENV=production`

### CI/CD Pipeline

**GitHub Actions** (`.github/workflows/docker-build.yml`):
- **Trigger:** Push to `main` branch when `review-ui/**` or workflow file changes; manual dispatch
- **Steps:** Checkout, GHCR login, metadata extraction, Docker Buildx setup, build and push
- **Tags:** `latest` (default branch), `main`, `sha-{short_hash}`
- **Cache:** GitHub Actions cache for Docker layers

### Volume Mounts

```
/data/db       -- SQLite databases (persistent, read-write)
/data/images   -- content/parsed/ plant images (can be read-only)
/data/logs     -- Application logs
```

---

## 8. Future Work

### Not Yet Built

1. **File attachment upload** -- Attachments table has metadata CRUD but no file upload mechanism. Currently attachment records are created with references to files already on disk.

2. **Population of empty NocoDB tables** -- Six tables have schema but no data:
   - Geographies (Hawaii island/district/moku reference data)
   - Growing_Notes (per-plant cultivation information by geography)
   - Pests (pest identification, signs, treatments)
   - Diseases (disease identification, symptoms, treatments)
   - FAQ (per-plant questions and answers)
   - Tags (cross-cutting metadata)

3. **Public-facing website** -- A read-only public website powered by the NocoDB data, replacing the legacy static HawaiiFruit.net site.

4. **Export functionality** -- CSV export, PDF plant cards, or printable field guides.

5. **Harvest calendar cross-plant view** -- A monthly calendar showing which plants are in season.

6. **Activity/audit log** -- Track who edited what and when across the application.

7. **Bulk operations expansion** -- Bulk import of nutritional data, bulk variety operations beyond image assignment.

8. **Image thumbnail generation** -- Pre-generated thumbnails for faster grid loading (currently serves full-size images scaled via CSS).

9. **Advanced search** -- Faceted search with multiple simultaneous filters, saved searches.

10. **User roles expansion** -- More granular permissions beyond admin/reviewer (e.g., per-table write access).

### Known Limitations

- **No offline support** -- Requires network connection to NocoDB.
- **NocoDB search** -- Uses `LIKE %term%` which does not support relevance ranking or stemming.
- **Image similarity** -- Perceptual hash comparison is O(n^2) within a plant; works well for plants with <1000 images but would need optimization for larger sets.
- **Single-server deployment** -- SQLite requires single-process; no horizontal scaling without migrating local state to a shared database.

---

## Appendix A: Key File Paths

| Path | Description |
|------|-------------|
| `review-ui/server/routes/browse.ts` | Browse/CRUD API endpoints (750 lines) |
| `review-ui/server/routes/ocr-review.ts` | OCR review queue endpoints |
| `review-ui/server/lib/nocodb.ts` | NocoDB REST API client |
| `review-ui/server/lib/schema.ts` | SQLite schema definition |
| `review-ui/server/lib/db.ts` | SQLite database initialization |
| `review-ui/server/lib/dal.ts` | Data access layer for SQLite |
| `review-ui/server/config.ts` | Environment configuration |
| `review-ui/server/middleware/auth.ts` | Authentication middleware |
| `review-ui/src/pages/PlantGridPage.tsx` | Plant grid browser page |
| `review-ui/src/pages/PlantDetailPage.tsx` | Plant detail page with 9 tabs |
| `review-ui/src/components/browse/tabs/GalleryTab.tsx` | Gallery with all view modes and lightbox |
| `review-ui/src/components/browse/tabs/OverviewTab.tsx` | Overview with all editable fields |
| `review-ui/src/components/browse/tabs/OcrTab.tsx` | OCR extractions with reassign/delete |
| `review-ui/src/types/browse.ts` | TypeScript type definitions |
| `review-ui/Dockerfile` | Multi-stage Docker build |
| `.github/workflows/docker-build.yml` | CI/CD pipeline |
| `content/parsed/nocodb_table_ids.json` | NocoDB table ID mapping |
| `content/parsed/plant_registry.json` | Canonical plant registry (Phase 1) |
| `content/parsed/file_inventory.json` | Full file catalog (Phase 2) |
| `scripts/cleanup-*.mjs` | Phase 7 data cleanup scripts |
| `scripts/nocodb-load-data.mjs` | Phase 7 NocoDB data loader |
| `docs/plan/content-structuring-plan.md` | Original 7-phase pipeline plan |
| `docs/plan/phase8-plant-browser.md` | Phase 8 browser UI plan |
