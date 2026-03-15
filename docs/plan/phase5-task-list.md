# Phase 5: Human Review UI — Detailed Task List

## Overview

This document expands the PRD's 5-stage subagent breakdown into 22 granular, independently executable tasks. Each task is scoped for a single subagent invocation (30 min to 1.5 hours), specifies exact files to create/modify, inputs, outputs, and dependencies. Tasks that share no dependency can run in parallel.

- **Total tasks**: 22
- **Critical path length**: 8 sequential steps (T01 → T02 → T04 → T08 → T14 → T15 → T20 → T21)
- **Maximum parallelism**: 5 tasks simultaneously (Stage 3, Group C)

**Tech stack**: Vite + React 18 + TypeScript + ShadCN/ui, Express.js, SQLite (better-sqlite3), Docker

**App location**: `d:/Sandbox/Homegrown/htfg_fruit/review-ui/` (new subproject, no code exists yet)

---

## Conventions

| Convention | Detail |
|------------|--------|
| **Agent types** | `main-session`, `backend-api-developer`, `test-writer` |
| **File paths** | Relative to `review-ui/` unless prefixed with the full repo root `d:/Sandbox/Homegrown/htfg_fruit/` |
| **Source data** | `d:/Sandbox/Homegrown/htfg_fruit/content/parsed/` (read-only, bind-mounted into Docker at `/data/images`) |
| **SQLite DB** | `review-ui/data/db/review.db` (bind-mounted into Docker at `/data/db/review.db`) |
| **Node.js** | v20 (Docker image `node:20-alpine`); review-ui uses TypeScript |

---

## Dependency Graph

```
T01 (Scaffold)
  ├── T02 (Express Server) ─────────────────────────────────────────────────┐
  │     └── T04 (SQLite Schema + DAL) ──┬── T05 (Import Script) ───────────┤
  │                                      ├── T06 (Queue API) ──────────────┤
  │                                      ├── T07 (Review API) ─────────────┤
  │                                      └── T08 (Plants + Admin API) ─────┤
  │                                                                        │
  └── T03 (ShadCN Init) ──── T09 (UI Requirements Analysis) ──────────────┤
                               ├── T10 (Shared Components) ────────────────┤
                               ├── T11 (Swipe Screen) ────────────────────┤
                               ├── T12 (Classify Screen) ─────────────────┤
                               └── T13 (Dashboard Screen) ────────────────┤
                                                                           │
                           ┌───────────────────────────────────────────────┘
                           v
                    T14 (API Client Layer) ─── T15 (Routing + Wiring) ─────┐
                           │                          │                     │
                    T16 (Backend Tests)        T17 (Frontend Tests)        │
                                                      │                     │
                                               T18 (UX Polish)             │
                                                                            │
                    T19 (Docker Config) ───── T20 (Data Import) ── T21 (Verification)
```

---

## Stage 1: Foundation (Sequential Start)

---

### T01 — Project Scaffold

| Field | Value |
|-------|-------|
| **ID** | T01 |
| **Agent** | `main-session` |
| **Dependencies** | None |
| **Estimated time** | 30 min |

**Objective**: Create the `review-ui/` subproject with Vite + React 18 + TypeScript, install all dependencies, and establish directory structure.

**Actions**:

1. Initialize project:
   ```bash
   cd "d:/Sandbox/Homegrown/htfg_fruit"
   npm create vite@latest review-ui -- --template react-ts
   cd review-ui
   ```

2. Install runtime dependencies:
   ```bash
   npm install express better-sqlite3 sharp react-swipeable react-router-dom
   ```

3. Install dev dependencies:
   ```bash
   npm install -D @types/express @types/better-sqlite3 @types/node
   npm install -D tailwindcss @tailwindcss/vite
   npm install -D tsx concurrently
   ```

4. Configure `tsconfig.json`:
   - Add path alias: `"@/*": ["./src/*"]`
   - Ensure `"moduleResolution": "bundler"`

5. Add `tsconfig.server.json` for server-side TypeScript:
   - `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`
   - Include: `["server/**/*.ts"]`
   - `"outDir": "./dist/server"`

6. Add npm scripts to `package.json`:
   ```json
   {
     "dev": "vite",
     "dev:server": "tsx watch server/index.ts",
     "dev:all": "concurrently \"npm:dev\" \"npm:dev:server\"",
     "build": "vite build && tsc -p tsconfig.server.json",
     "start": "node dist/server/index.js",
     "import": "tsx server/scripts/import.ts",
     "test": "vitest run",
     "test:watch": "vitest"
   }
   ```

7. Create directory structure:
   ```
   review-ui/
     src/
       components/
         ui/            # ShadCN components (auto-generated)
         layout/
         swipe/
         classify/
         dashboard/
         images/
         session/
       hooks/
       lib/
       pages/
       types/
       test/
     server/
       routes/
       lib/
       scripts/
       data/
       __tests__/
     data/
       db/              # SQLite DB file location (gitignored)
   ```

8. Create `review-ui/.gitignore`:
   ```
   node_modules/
   dist/
   data/db/
   *.db
   .env
   ```

9. Create `review-ui/.env.example`:
   ```
   IMAGE_MOUNT_PATH=d:/Sandbox/Homegrown/htfg_fruit/content/parsed
   DB_PATH=./data/db/review.db
   PORT=3001
   ```

**Files created**:
- `review-ui/package.json`
- `review-ui/tsconfig.json`
- `review-ui/tsconfig.server.json`
- `review-ui/vite.config.ts`
- `review-ui/.env.example`
- `review-ui/.gitignore`
- `review-ui/src/main.tsx` (Vite entry)
- `review-ui/src/App.tsx` (placeholder)

**Verification**: `cd review-ui && npm run dev` opens browser with React placeholder.

---

### T02 — Express Server Setup

| Field | Value |
|-------|-------|
| **ID** | T02 |
| **Agent** | `main-session` |
| **Dependencies** | T01 |
| **Estimated time** | 45 min |

**Objective**: Create the Express server that serves the SPA, static images/thumbnails, and provides API route stubs.

**Actions**:

1. Create `server/config.ts`:
   - Read and validate environment variables: `PORT` (default 3001), `DB_PATH` (default `./data/db/review.db`), `IMAGE_MOUNT_PATH` (required)
   - Fail fast with clear error if `IMAGE_MOUNT_PATH` is missing
   - Export typed config object

2. Create `server/index.ts`:
   - Initialize Express app
   - JSON body parser (1MB limit)
   - Mount static middleware:
     - `/images/*` serves files from `config.IMAGE_MOUNT_PATH` (read-only intent)
     - `/thumbnails/*` serves files from `path.join(config.IMAGE_MOUNT_PATH, '.thumbnails')`
   - Mount API route groups:
     - `/api/queue` → `routes/queue.ts`
     - `/api/review` → `routes/review.ts`
     - `/api/plants` → `routes/plants.ts`
     - `/api/admin` → `routes/admin.ts`
   - In production: serve Vite build output from `dist/client/`
   - SPA fallback: non-API, non-static GET requests serve `index.html`
   - Global error handler middleware (returns `{ error: string }` JSON)
   - Graceful shutdown on SIGTERM/SIGINT
   - Listen on `config.PORT`

3. Create stub route files (all return 501 "Not Implemented"):
   - `server/routes/queue.ts` — GET `/next`, GET `/stats`, POST `/:id/release`
   - `server/routes/review.ts` — POST `/confirm`, `/reject`, `/classify`, `/discard`
   - `server/routes/plants.ts` — GET `/`, GET `/:id/reference-images`, POST `/new`, GET `/csv-candidates`
   - `server/routes/admin.ts` — POST `/import`, GET `/import-status`

4. Update `vite.config.ts` with dev proxy:
   ```typescript
   server: {
     proxy: {
       '/api': 'http://localhost:3001',
       '/images': 'http://localhost:3001',
       '/thumbnails': 'http://localhost:3001',
     }
   }
   ```

**Files created**:
- `review-ui/server/index.ts`
- `review-ui/server/config.ts`
- `review-ui/server/routes/queue.ts`
- `review-ui/server/routes/review.ts`
- `review-ui/server/routes/plants.ts`
- `review-ui/server/routes/admin.ts`

**Files modified**:
- `review-ui/vite.config.ts` (proxy config)

**Verification**: `npm run dev:server` starts Express on port 3001. `curl http://localhost:3001/api/queue/stats` returns 501.

---

### T03 — ShadCN/ui Initialization

| Field | Value |
|-------|-------|
| **ID** | T03 |
| **Agent** | `main-session` |
| **Dependencies** | T01 |
| **Estimated time** | 20 min |
| **Parallel with** | T02 |

**Objective**: Initialize ShadCN/ui with Tailwind CSS and install the base component set.

**Actions**:

1. Run ShadCN init:
   ```bash
   npx shadcn@latest init
   ```
   Select: New York style, Slate base color, CSS variables enabled

2. Install initial component batch:
   ```bash
   npx shadcn@latest add button card badge input dialog progress separator tabs skeleton
   ```

3. Customize CSS variables in `src/index.css`:
   - Light theme only (no dark mode toggle)
   - Add semantic color tokens:
     - `--color-confirm` (green, for confirm actions)
     - `--color-reject` (red, for reject actions)
     - `--color-pending` (amber, for pending/warning states)
     - `--color-auto` (blue, for Phase 4 auto-matched items)

4. Verify `src/lib/utils.ts` exists with `cn()` utility

5. Smoke-test: render a ShadCN Button in App.tsx, confirm styling works

**Files created/modified**:
- `review-ui/components.json` (ShadCN config)
- `review-ui/src/components/ui/*.tsx` (ShadCN component files)
- `review-ui/src/index.css` (Tailwind layers + custom tokens)
- `review-ui/src/lib/utils.ts`

**Verification**: ShadCN Button renders with correct styling in dev browser.

---

## Stage 2: Data Layer (Parallel after T02 completes)

---

### T04 — SQLite Schema and Data Access Layer

| Field | Value |
|-------|-------|
| **ID** | T04 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T02 |
| **Estimated time** | 1.5 hours |

**Objective**: Create the complete SQLite schema (4 tables, all indexes) and a typed data access layer with prepared statements.

**Critical context for the agent**: This is for the HTFG Review UI project — NOT the Holualectrons/circuit_mapper project. There is no NocoDB. The data store is SQLite via `better-sqlite3` (synchronous API). The schema mirrors the PRD's table definitions (ReviewQueue, ReviewDecisions, NewPlantRequests) plus a Plants table.

**Actions**:

1. Create `server/lib/db.ts`:
   - Import `better-sqlite3`
   - Read `DB_PATH` from config
   - Create parent directory if it doesn't exist (`fs.mkdirSync` with `recursive: true`)
   - Initialize database connection
   - Enable WAL mode: `db.pragma('journal_mode = WAL')`
   - Run schema creation (CREATE TABLE IF NOT EXISTS for all 4 tables)
   - Export singleton `db` instance

2. Create `server/lib/schema.ts`:
   - Export `SCHEMA_SQL` string constant containing all CREATE TABLE and CREATE INDEX statements:
     - `review_queue` (id INTEGER PRIMARY KEY AUTOINCREMENT, image_path TEXT UNIQUE, source_path, queue CHECK(queue IN ('swipe','classify')), status DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','skipped')), current_plant_id, suggested_plant_id, confidence CHECK(confidence IN ('high','medium','low','auto',NULL)), match_type, reasoning, thumbnail_path, file_size INTEGER, sort_key, source_directories, locked_by, locked_at, created_at DEFAULT (datetime('now')))
     - `review_decisions` (id INTEGER PRIMARY KEY AUTOINCREMENT, image_path TEXT NOT NULL, reviewer TEXT NOT NULL, action TEXT CHECK(action IN ('confirm','reject','classify','discard','new_plant')), plant_id, discard_category, notes, decided_at DEFAULT (datetime('now')))
     - `new_plant_requests` (id INTEGER PRIMARY KEY AUTOINCREMENT, common_name TEXT NOT NULL, botanical_name, category DEFAULT 'fruit', aliases, requested_by TEXT NOT NULL, status DEFAULT 'pending', generated_id TEXT UNIQUE, phase4b_rerun_needed INTEGER DEFAULT 1, created_at DEFAULT (datetime('now')), first_image_path)
     - `plants` (id TEXT PRIMARY KEY, common_name TEXT NOT NULL, botanical_names TEXT, aliases TEXT, category DEFAULT 'fruit')
   - All relevant indexes: `review_queue(status, queue, sort_key)`, `review_queue(locked_at)`, `review_decisions(image_path)`, `review_decisions(reviewer, decided_at)`, `plants(common_name)`

3. Create `server/types.ts`:
   - TypeScript interfaces for all database row types:
     ```typescript
     interface QueueItem {
       id: number;
       image_path: string;
       source_path: string | null;
       queue: 'swipe' | 'classify';
       status: 'pending' | 'in_progress' | 'completed' | 'skipped';
       current_plant_id: string | null;
       suggested_plant_id: string | null;
       confidence: 'high' | 'medium' | 'low' | 'auto' | null;
       match_type: string | null;
       reasoning: string | null;
       thumbnail_path: string | null;
       file_size: number | null;
       sort_key: string | null;
       source_directories: string | null;  // JSON array string
       locked_by: string | null;
       locked_at: string | null;
       created_at: string;
     }
     ```
   - Similar interfaces for `ReviewDecision`, `NewPlantRequest`, `Plant`
   - API response types: `QueueStats`, `DashboardStats`, `PlantSearchResult`

4. Create `server/lib/dal.ts` (Data Access Layer):
   - All methods use prepared statements (cached by better-sqlite3)
   - **Queue operations**:
     - `getNextPendingItem(queue: string, reviewer: string): QueueItem | null` — within a transaction: find next item where `status='pending'` OR (`status='in_progress'` AND `locked_at` < 5 min ago), ordered by `sort_key`; update it to `status='in_progress'`, `locked_by=reviewer`, `locked_at=now`; return the item
     - `releaseItem(id: number): void` — set `status='pending'`, clear `locked_by` and `locked_at`
     - `getQueueStats(): QueueStats` — aggregate counts by queue+status, count decisions by action, count decisions by reviewer for today and all-time, count new_plant_requests with phase4b_rerun_needed=1
     - `expireStaleLocks(): number` — update all items where `status='in_progress'` AND `locked_at` < 5 minutes ago to `status='pending'`, clear lock fields; return count of expired
   - **Review operations**:
     - `confirmItem(imagePath: string, reviewer: string): void` — transaction: update review_queue set status='completed' where image_path=?; insert into review_decisions (image_path, reviewer, action='confirm', plant_id from suggested_plant_id or current_plant_id)
     - `rejectItem(imagePath: string, reviewer: string): void` — transaction: update review_queue set status='completed'; insert review_decisions with action='reject'; if image_path does not already exist in review_queue with queue='classify', insert new row with queue='classify', status='pending', copying image_path, source_path, thumbnail_path, file_size, source_directories
     - `classifyItem(imagePath: string, plantId: string, reviewer: string): void` — transaction: update review_queue set status='completed'; insert review_decisions with action='classify', plant_id
     - `discardItem(imagePath: string, category: string, notes: string | null, reviewer: string): void` — transaction: update review_queue set status='completed'; insert review_decisions with action='discard', discard_category
   - **Plant operations**:
     - `searchPlants(query: string): Plant[]` — LIKE search on common_name, botanical_names, aliases; also search new_plant_requests; combined results limited to 20
     - `getAllPlants(): Plant[]` — return all plants ordered by common_name
     - `getPlantById(id: string): Plant | null`
     - `createNewPlantRequest(data: Omit<NewPlantRequest, 'id' | 'created_at' | 'status'>): NewPlantRequest`
     - `getNewPlantRerunCount(): number` — count where phase4b_rerun_needed=1 AND status='pending'
   - **Import operations**:
     - `bulkInsertQueueItems(items: Partial<QueueItem>[]): number` — wrapped in transaction, returns count inserted (uses INSERT OR IGNORE for idempotency)
     - `bulkInsertPlants(plants: Plant[]): number` — wrapped in transaction with INSERT OR REPLACE
     - `getImportCounts(): { plants: number, swipe: number, classify: number, total: number }`

**Files created**:
- `review-ui/server/lib/db.ts`
- `review-ui/server/lib/schema.ts`
- `review-ui/server/lib/dal.ts`
- `review-ui/server/types.ts`

**Verification**: Import db module, confirm tables are created. Insert a test plant, query it back. Insert a queue item, lock it, confirm it with a decision.

---

### T05 — Data Import Script

| Field | Value |
|-------|-------|
| **ID** | T05 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T04 |
| **Estimated time** | 1.5 hours |

**Objective**: Build a standalone script that reads Phase 4/4B JSON files, generates thumbnails via Sharp, and populates the SQLite database. The import must be idempotent.

**Critical context for the agent**: Source JSON files are at `d:/Sandbox/Homegrown/htfg_fruit/content/parsed/`. See Appendix at the bottom of this document for exact field structures per JSON file. The `path` field in `phase4b_inferences.json` and `phase4b_still_unclassified.json` matches the `source` field in `phase4_image_manifest.json` — this cross-reference is needed to get the `dest` path and `size`.

**Actions**:

1. Create `server/scripts/import.ts`:

   **CLI interface**:
   - `--data-dir <path>` (default: `IMAGE_MOUNT_PATH` env var)
   - `--db-path <path>` (default: `DB_PATH` env var)
   - `--skip-thumbnails` flag for fast testing

   **Step 1 — Load source data**:
   - Read all 5 JSON files from `data-dir`:
     - `phase4b_inferences.json` (top-level key: `inferences`, 6,518 items)
     - `phase4b_still_unclassified.json` (top-level key: `files`, 8,361 items)
     - `phase4_image_manifest.json` (top-level key: `files`, 15,403 items)
     - `phase4b_new_plants.json` (top-level key: `plants`, 72 items)
     - `plant_registry.json` (top-level key: `plants`, 140 items)
   - Log counts for each file

   **Step 2 — Build manifest lookup**:
   - Create a `Map<string, ManifestEntry>` keyed by `source` from `phase4_image_manifest.json`
   - Each entry: `{ source, dest, plant_id, size }`

   **Step 3 — Populate plants table**:
   - Map `plant_registry.json` plants to DB schema:
     - `id`, `common_name`, `JSON.stringify(botanical_names)`, `JSON.stringify(aliases)`, `category`
   - Call `dal.bulkInsertPlants(mappedPlants)`

   **Step 4 — Build swipe queue records**:

   From `phase4b_inferences.json` (6,518 records):
   - Look up each `path` in manifest map to get `dest` and `size`
   - Map to QueueItem:
     - `image_path` = `dest` (organized path)
     - `source_path` = `path` (original source path)
     - `queue` = `'swipe'`
     - `status` = `'pending'`
     - `current_plant_id` = `null` (these are inferences, not confirmed)
     - `suggested_plant_id` = `inferred_plant_id`
     - `confidence` = inference confidence
     - `match_type` = inference match_type
     - `reasoning` = inference reasoning
     - `file_size` = manifest size
     - `source_directories` = JSON.stringify of directory names extracted from path

   From `phase4_image_manifest.json` where `plant_id` is not null (5,031 records):
   - Map to QueueItem:
     - `image_path` = `dest`
     - `source_path` = `source`
     - `queue` = `'swipe'`
     - `status` = `'pending'`
     - `current_plant_id` = `plant_id`
     - `suggested_plant_id` = `plant_id`
     - `confidence` = `'auto'`
     - `match_type` = `'phase4_direct'`
     - `reasoning` = `'Phase 4 auto-classification by directory name'`
     - `file_size` = `size`

   **Step 5 — Build classify queue records**:
   From `phase4b_still_unclassified.json` (8,361 records):
   - Look up each `path` in manifest map to get `dest` and `size`
   - Map to QueueItem:
     - `image_path` = `dest`
     - `source_path` = `path`
     - `queue` = `'classify'`
     - `status` = `'pending'`
     - `source_directories` = `JSON.stringify(directories)`
     - `file_size` = manifest size (or null if not found)

   **Step 6 — Compute sort_key**:
   For swipe queue items only:
   - Define confidence order: `{ high: 1, medium: 2, low: 3, auto: 4 }`
   - Group all swipe items by `suggested_plant_id` (or `current_plant_id`)
   - For each plant group, find the best (lowest) confidence order value
   - Assign sort_key: `${plant_group_priority_padded}:${plant_id}:${confidence_order}:${image_path}`
     - Pad plant_group_priority to 3 digits (e.g., `001`)
   - This ensures: plant groups ordered by best confidence first; within each group, high confidence items come first

   For classify queue items: sort_key = `classify:${first_source_dir}:${image_path}`

   **Step 7 — Compute thumbnail_path**:
   For each record: `thumbnail_path` = `.thumbnails/${relative_dest_path}`
   - Strip any leading `content/parsed/` prefix from `dest` to get the relative path

   **Step 8 — Generate thumbnails** (unless `--skip-thumbnails`):
   - For each unique image (by `dest` path), using Sharp:
     - Input: image at `path.join(data_dir, relative_dest_path)` (strip `content/parsed/` prefix from dest)
     - Output: `path.join(data_dir, '.thumbnails', relative_dest_path)`
     - Create parent directories as needed
     - Sharp pipeline: `.resize({ width: 400, withoutEnlargement: true }).jpeg({ quality: 80, progressive: true })`
     - Skip if output file already exists (idempotent)
     - Log progress every 500 images
     - Catch and log errors per-image (don't abort on corrupt files)
   - Report: total generated, total skipped, total errors

   **Step 9 — Bulk insert**:
   - Call `dal.bulkInsertQueueItems(allSwipeItems)` — 11,549 items
   - Call `dal.bulkInsertQueueItems(allClassifyItems)` — 8,361 items

   **Step 10 — Save CSV candidates**:
   - Write `phase4b_new_plants.json` plants array to `server/data/csv-candidates.json` for runtime use

   **Step 11 — Report**:
   - Log final counts from `dal.getImportCounts()`
   - Log expected vs actual comparison
   - Exit with code 0 on success, 1 on any critical error

2. Export a `runImport(options)` function for programmatic use by the admin API endpoint.

**Files created**:
- `review-ui/server/scripts/import.ts`

**Files generated at runtime**:
- `review-ui/server/data/csv-candidates.json`
- Thumbnails at `{IMAGE_MOUNT_PATH}/.thumbnails/**`

**Verification**: Run `npm run import -- --skip-thumbnails` with `DATA_DIR` pointing to `content/parsed/`. Confirm: 140 plants, 11,549 swipe queue items, 8,361 classify queue items (19,910 total). Verify sort_key ordering with a SQLite query.

---

### T06 — Queue API Endpoints

| Field | Value |
|-------|-------|
| **ID** | T06 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T04 |
| **Estimated time** | 45 min |
| **Parallel with** | T05, T07, T08 |

**Objective**: Implement the 3 queue management API endpoints.

**Actions**:

1. **`GET /api/queue/next?type=swipe|classify&reviewer=Name`** in `server/routes/queue.ts`:
   - Validate: `type` must be `'swipe'` or `'classify'` (400 if invalid)
   - Validate: `reviewer` must be non-empty string (400 if missing)
   - Call `dal.expireStaleLocks()` to clear stale locks
   - Call `dal.getNextPendingItem(type, reviewer)`
   - If no item found: return `200 { item: null, remaining: 0 }`
   - If found: also query remaining count for this queue
   - Augment response with `current_plant_name` and `suggested_plant_name` by joining plants table
   - Return `200 { item: QueueItem & { current_plant_name, suggested_plant_name }, remaining: number }`

2. **`GET /api/queue/stats`** in `server/routes/queue.ts`:
   - Call `dal.getQueueStats()`
   - Return 200 with full stats object

3. **`POST /api/queue/:id/release`** in `server/routes/queue.ts`:
   - Validate: `id` must be a positive integer (400 if invalid)
   - Call `dal.releaseItem(id)`
   - Return `200 { success: true }`

**Files modified**:
- `review-ui/server/routes/queue.ts` (replace 501 stubs)

**Verification**: After import: `curl "localhost:3001/api/queue/next?type=swipe&reviewer=test"` returns an item with a lock. `curl "localhost:3001/api/queue/stats"` returns correct structure.

---

### T07 — Review Action API Endpoints

| Field | Value |
|-------|-------|
| **ID** | T07 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T04 |
| **Estimated time** | 45 min |
| **Parallel with** | T05, T06, T08 |

**Objective**: Implement the 4 review action endpoints.

**Actions**:

1. **`POST /api/review/confirm`**:
   - Body: `{ image_path: string, reviewer: string }`
   - Validate both fields (400 if missing)
   - Call `dal.confirmItem(imagePath, reviewer)`
   - Return `200 { success: true }`

2. **`POST /api/review/reject`**:
   - Body: `{ image_path: string, reviewer: string }`
   - Call `dal.rejectItem(imagePath, reviewer)`
   - Return `200 { success: true }`

3. **`POST /api/review/classify`**:
   - Body: `{ image_path: string, plant_id: string, reviewer: string }`
   - Validate all 3 fields
   - Verify `plant_id` exists in `plants` table OR `new_plant_requests` (404 if not found)
   - Call `dal.classifyItem(imagePath, plantId, reviewer)`
   - Return `200 { success: true }`

4. **`POST /api/review/discard`**:
   - Body: `{ image_path: string, category: string, notes?: string, reviewer: string }`
   - Validate `category` is one of: `event`, `graphics`, `travel`, `duplicate`, `poor_quality` (400 if invalid)
   - Call `dal.discardItem(imagePath, category, notes || null, reviewer)`
   - Return `200 { success: true }`

5. Add a simple `validateRequired(body, fields)` helper — returns 400 with field names if any are missing.

**Files modified**:
- `review-ui/server/routes/review.ts` (replace 501 stubs)

**Verification**: POST to each endpoint with valid data returns success. Check `review_decisions` table has entries.

---

### T08 — Plants and Admin API Endpoints

| Field | Value |
|-------|-------|
| **ID** | T08 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T04, T05 (for csv-candidates.json) |
| **Estimated time** | 1 hour |
| **Parallel with** | T06, T07 (T08 can start on the plants endpoints before T05 finishes; only csv-candidates needs T05) |

**Objective**: Implement plant search, reference images, new plant creation, CSV candidate search, and admin import endpoints.

**Actions**:

1. **`GET /api/plants?search=avo`** in `server/routes/plants.ts`:
   - If `search` param >= 2 chars: call `dal.searchPlants(query)`
   - If no search or < 2 chars: call `dal.getAllPlants()`
   - Return `200 { plants: Plant[] }`

2. **`GET /api/plants/:id/reference-images`** in `server/routes/plants.ts`:
   - Construct directory path: `path.join(config.IMAGE_MOUNT_PATH, 'plants', id, 'images')`
   - Read directory with `fs.readdirSync` (catch ENOENT → return empty array)
   - Filter to image extensions: `.jpg`, `.jpeg`, `.png`, `.gif`
   - Randomly select up to 6 (use Fisher-Yates shuffle, take first 6)
   - Map to response objects:
     ```json
     {
       "images": [
         {
           "path": "plants/avocado/images/alpha.jpg",
           "thumbnail": ".thumbnails/plants/avocado/images/alpha.jpg"
         }
       ]
     }
     ```
   - Return `200 { images: [...] }`

3. **`POST /api/plants/new`** in `server/routes/plants.ts`:
   - Body: `{ common_name: string, botanical_name?: string, category?: string, aliases?: string, requested_by: string, first_image_path?: string }`
   - Validate `common_name` and `requested_by` (400 if missing)
   - Generate `generated_id`: lowercase, trim, replace spaces/special chars with hyphens, collapse consecutive hyphens
   - Check for duplicates in both `plants` and `new_plant_requests` tables
   - If duplicate: return `409 { error: "Plant already exists", existing_id: "..." }`
   - Call `dal.createNewPlantRequest(data)`
   - Return `201 { success: true, plant: { id: generated_id, common_name, ... } }`

4. **`GET /api/plants/csv-candidates?search=term`** in `server/routes/plants.ts`:
   - Load `server/data/csv-candidates.json` (cache in module-level variable after first read)
   - If file doesn't exist yet: return `200 { candidates: [] }`
   - Filter by `fruit_type` or `scientific_name` containing search term (case-insensitive)
   - Return `200 { candidates: CsvCandidate[] }`

5. **`POST /api/admin/import`** in `server/routes/admin.ts`:
   - Body: `{ data_dir?: string, skip_thumbnails?: boolean }`
   - Use `data_dir` from body or fall back to `config.IMAGE_MOUNT_PATH`
   - Check if import is already running (module-level flag) → return `409 { error: "Import already in progress" }`
   - Start import asynchronously (call `runImport()` from import script, don't await)
   - Track progress in module-level state object
   - Return `202 { status: "started" }`

6. **`GET /api/admin/import-status`** in `server/routes/admin.ts`:
   - Return current import state:
     ```json
     {
       "status": "idle|running|completed|error",
       "progress": {
         "plants": 140,
         "swipe_queue": 11549,
         "classify_queue": 8361,
         "thumbnails": { "done": 5000, "total": 15403 }
       },
       "error": null,
       "counts": { }
     }
     ```

**Files modified**:
- `review-ui/server/routes/plants.ts` (replace 501 stubs)
- `review-ui/server/routes/admin.ts` (replace 501 stubs)

**Verification**: Plant search returns results. Reference images endpoint returns array. New plant creation succeeds and blocks duplicate. Admin import trigger and status check work.

---

## Stage 3: UI Components (Parallel after T03 + T09)

---

### T09 — ShadCN Component Requirements Analysis

| Field | Value |
|-------|-------|
| **ID** | T09 |
| **Agent** | `main-session` |
| **Dependencies** | T03 |
| **Estimated time** | 20 min |

**Objective**: Analyze the PRD's 3 screens and determine which additional ShadCN components are needed, then install them all in one pass before parallel UI work begins.

**Input**: PRD at `d:/Sandbox/Homegrown/htfg_fruit/docs/plan/phase5-review-ui-prd.md`, UI/UX Design section.

**Actions**:
1. Review all 3 screen wireframes in the PRD
2. Identify additional ShadCN components beyond the T03 base set
3. Install them:
   ```bash
   npx shadcn@latest add command radio-group select textarea sonner label form alert
   ```
4. Create `review-ui/design-docs/component-requirements.md` documenting:
   - Component tree for each of the 3 screens
   - Custom component list (SwipeCard, PlantSearch, QuickPicks, DiscardDialog, NewPlantDialog, etc.)
   - State management approach: React Context for reviewer session, prop drilling for page-level state
   - Mobile-first touch target minimums (44px)

**Files created**:
- `review-ui/design-docs/component-requirements.md`

**Verification**: All ShadCN components install without errors. Document covers all 3 screens.

---

### T10 — Shared Components

| Field | Value |
|-------|-------|
| **ID** | T10 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T09 |
| **Estimated time** | 1 hour |
| **Parallel with** | T11, T12, T13 |

**Objective**: Build the layout shell, bottom navigation, session entry, image components, and shared hooks used across all screens.

**Actions**:

1. **`src/components/layout/AppShell.tsx`**:
   - Header bar: "HTFG Image Review" title (left), reviewer name (right), queue counts badge
   - Main content area (`children` prop)
   - Fixed bottom navigation bar
   - Mobile-first: full-width, max-w-lg on desktop centered
   - Accepts `title` and `subtitle` props for dynamic header text

2. **`src/components/layout/BottomNav.tsx`**:
   - Three tabs: Swipe (ArrowLeftRight icon), Classify (Tag icon), Dashboard (BarChart3 icon)
   - Active tab highlighted with accent color
   - Uses `useLocation` from react-router-dom for active state
   - Uses `useNavigate` for tab clicks
   - Touch targets >= 48px height
   - Fixed to bottom of viewport, z-index above content

3. **`src/components/session/SessionEntry.tsx`**:
   - ShadCN Dialog (non-dismissable: no close button, no backdrop click dismiss)
   - "Welcome to HTFG Image Review" title
   - ShadCN Input for reviewer name
   - "Start Reviewing" ShadCN Button (disabled when input empty)
   - On submit: stores name in localStorage key `htfg_reviewer_name`

4. **`src/components/images/LazyImage.tsx`**:
   - Props: `src: string`, `thumbnailSrc?: string`, `alt: string`, `className?: string`
   - Renders thumbnail by default
   - Loads full-size on click/tap
   - ShadCN Skeleton placeholder while loading
   - Broken image fallback (gray box with icon)

5. **`src/components/images/ReferencePhotoGrid.tsx`**:
   - Props: `plantId: string`
   - Fetches from `/api/plants/${plantId}/reference-images`
   - Renders 3-column grid of LazyImage thumbnails
   - Loading state: 6 skeleton squares
   - Empty state: "No reference photos available"
   - Error state: "Could not load reference photos"

6. **`src/components/ui/ConfidenceBadge.tsx`**:
   - Props: `confidence: 'high' | 'medium' | 'low' | 'auto'`
   - high: green, "High Confidence", 3 dots
   - medium: amber, "Medium Confidence", 2 dots
   - low: red, "Low Confidence", 1 dot
   - auto: blue, "Auto", checkmark icon
   - Built on ShadCN Badge with custom variant classes

7. **`src/hooks/useSession.ts`**:
   - Reads/writes `htfg_reviewer_name` from localStorage
   - Returns `{ name: string | null, setName: (n: string) => void, isReady: boolean }`

8. **`src/types/api.ts`**:
   - TypeScript interfaces matching all API response shapes: `QueueItem`, `QueueStats`, `Plant`, `CsvCandidate`, `ReferenceImage`, `NewPlantData`

**Files created**:
- `review-ui/src/components/layout/AppShell.tsx`
- `review-ui/src/components/layout/BottomNav.tsx`
- `review-ui/src/components/session/SessionEntry.tsx`
- `review-ui/src/components/images/LazyImage.tsx`
- `review-ui/src/components/images/ReferencePhotoGrid.tsx`
- `review-ui/src/components/ui/ConfidenceBadge.tsx`
- `review-ui/src/hooks/useSession.ts`
- `review-ui/src/types/api.ts`

**Verification**: Each component renders in isolation. AppShell layout correct on 375px mobile viewport. SessionEntry stores name in localStorage.

---

### T11 — Swipe Confirmation Screen

| Field | Value |
|-------|-------|
| **ID** | T11 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T09, T10 |
| **Estimated time** | 1.5 hours |
| **Parallel with** | T12, T13 |

**Objective**: Build the Swipe Confirmation screen (Part B) with gesture handling, card transitions, and detail mode.

**Input**: PRD Screen 1 wireframes (lines 201–276 in PRD). Shared components from T10.

**Actions**:

1. **`src/pages/SwipePage.tsx`**:
   - Wrapped in AppShell with title "Swipe Review"
   - State: `currentItem: QueueItem | null`, `isLoading: boolean`, `remaining: number`, `isExpanded: boolean`
   - Progress counter in header subtitle: "3 of 42 remaining"
   - Empty queue state: card with "All swipe reviews complete!" message
   - Error state: "Failed to load" with retry button
   - On confirm/reject: call handler, fetch next item

2. **`src/components/swipe/SwipeCard.tsx`**:
   - Uses `useSwipeable` from `react-swipeable`:
     - `onSwipedRight` (delta > 100) → calls `onConfirm`
     - `onSwipedLeft` (delta > 100) → calls `onReject`
     - `onSwipedUp` (delta > 50) → calls `onExpand`
     - `onSwiping` → applies visual feedback (rotation, color overlay)
   - Card content:
     - LazyImage (fills card width, aspect-ratio preserved, max-height 60vh)
     - Plant name (large, bold): `suggested_plant_name`
     - ConfidenceBadge
     - Hint text (muted): "Swipe or use buttons below"
   - Visual feedback while swiping:
     - Card translates horizontally
     - Slight rotation (max ±15 degrees)
     - Green overlay on right swipe, red overlay on left swipe
     - Overlay opacity proportional to swipe distance
   - Props: `item: QueueItem, plantName: string, onConfirm, onReject, onExpand`

3. **`src/components/swipe/SwipeActions.tsx`**:
   - Two large buttons side by side:
     - "REJECT" (left, destructive, X icon)
     - "CONFIRM" (right, green, Check icon)
   - Both disabled while `isSubmitting` is true
   - Min height 48px touch targets

4. **`src/components/swipe/DetailPanel.tsx`**:
   - Slides up from bottom (CSS transform transition 250ms) when `expanded` prop is true
   - Scrollable content:
     - "Match Details": match_type, reasoning, source_path
     - "Reference Photos": ReferencePhotoGrid for matched plant
   - Sticky hint at top: chevron-down icon + "Scroll up to return"
   - On scroll to top or tap hint: calls `onCollapse`
   - Props: `item: QueueItem, plantId: string, onCollapse, expanded: boolean`

5. **Card transition animations** (CSS):
   - On decision: card slides out (left for reject, right for confirm) + fade (200ms)
   - New card fades in from center (150ms)
   - State variable drives transform/opacity

**Files created**:
- `review-ui/src/pages/SwipePage.tsx`
- `review-ui/src/components/swipe/SwipeCard.tsx`
- `review-ui/src/components/swipe/SwipeActions.tsx`
- `review-ui/src/components/swipe/DetailPanel.tsx`

**Verification**: Page renders with mock item. Swipe gestures trigger callbacks. Card visual feedback works on 375px viewport. Detail panel slides up/down.

---

### T12 — Classify Screen

| Field | Value |
|-------|-------|
| **ID** | T12 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T09, T10 |
| **Estimated time** | 1.5 hours |
| **Parallel with** | T11, T13 |

**Objective**: Build the Classify screen (Part A) with plant search autocomplete, quick picks, discard dialog, and new plant dialog.

**Input**: PRD Screen 2 wireframes (lines 278–387 in PRD). Shared components from T10.

**Actions**:

1. **`src/pages/ClassifyPage.tsx`**:
   - Wrapped in AppShell with title "Classify"
   - State: `currentItem`, `isLoading`, `remaining`, `selectedPlant`
   - LazyImage display, source path text, PlantSearch, QuickPicks, ClassifyActions
   - Empty queue state: "All images classified!"

2. **`src/components/classify/PlantSearch.tsx`**:
   - Input with search icon, placeholder: "Search plants..."
   - Debounced API call (300ms) to `/api/plants?search=query` (min 2 chars)
   - Dropdown results: common_name (bold), botanical_name (muted subtitle)
   - Items from `new_plant_requests` marked with "New" badge
   - On select: calls `onSelect(plant)` callback, closes dropdown
   - Clear button to reset
   - Props: `onSelect: (plant: Plant) => void, selectedPlant: Plant | null`

3. **`src/components/classify/QuickPicks.tsx`**:
   - Uses `useRecentPlants` hook (see T10 note — implement in this task if not in T10)
   - Horizontal scrollable row of ShadCN Buttons (outline variant)
   - Label: "Recent:"
   - Hidden when no recent plants
   - Props: `onSelect: (plant: Plant) => void`

4. **`src/components/classify/DiscardDialog.tsx`**:
   - ShadCN Dialog
   - Title: "Why isn't this a plant?"
   - ShadCN RadioGroup with 5 options: event, graphics, travel, duplicate, poor_quality
   - Optional ShadCN Textarea for notes
   - "Discard" button disabled until category selected
   - Props: `open, onOpenChange, onDiscard: (data: { category, notes }) => void, isSubmitting`

5. **`src/components/classify/NewPlantDialog.tsx`**:
   - ShadCN Dialog
   - Form: Common Name (required), Botanical Name (optional), Category (ShadCN Select), Aliases (text)
   - As user types Common Name (debounced 500ms): query `/api/plants/csv-candidates?search=name`
   - If match found: info box pre-populating botanical name
   - Live slug preview below Common Name field
   - Warning: "This will flag Phase 4B for re-run"
   - Props: `open, onOpenChange, onCreatePlant: (data) => void, isSubmitting`

6. **`src/components/classify/ClassifyActions.tsx`**:
   - Vertical stack of 4 buttons:
     - "Assign to Plant" (primary, disabled when no plant selected)
     - "New Plant Entry" (secondary, opens NewPlantDialog)
     - "Not a Plant" (destructive, opens DiscardDialog)
     - "Skip" (ghost, releases lock, loads next)
   - Manages dialog open states

7. **`src/hooks/useRecentPlants.ts`** (if not created in T10):
   - localStorage key: `htfg_recent_plants`
   - `addRecent(plant: Plant)` — prepend, deduplicate by id, cap at 6
   - `recent: Plant[]`

**Files created**:
- `review-ui/src/pages/ClassifyPage.tsx`
- `review-ui/src/components/classify/PlantSearch.tsx`
- `review-ui/src/components/classify/QuickPicks.tsx`
- `review-ui/src/components/classify/DiscardDialog.tsx`
- `review-ui/src/components/classify/NewPlantDialog.tsx`
- `review-ui/src/components/classify/ClassifyActions.tsx`
- `review-ui/src/hooks/useRecentPlants.ts`

**Verification**: All dialogs open/close. Plant search renders results. Discard requires category. New plant slug preview updates live.

---

### T13 — Dashboard Screen

| Field | Value |
|-------|-------|
| **ID** | T13 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T09, T10 |
| **Estimated time** | 1 hour |
| **Parallel with** | T11, T12 |

**Objective**: Build the Dashboard screen with progress stats, activity feed, decision breakdown, re-run banner, and leaderboard.

**Input**: PRD Screen 3 wireframes (lines 389–443 in PRD).

**Actions**:

1. **`src/pages/DashboardPage.tsx`**:
   - Wrapped in AppShell
   - Fetches stats from `/api/queue/stats` on mount
   - Polls every 30 seconds (cleanup on unmount)
   - Loading skeleton state while first fetch is in-flight

2. **`src/components/dashboard/OverallProgress.tsx`**:
   - ShadCN Card: "Overall Progress" heading, large ShadCN Progress bar, "{completed} / {total} reviewed", percentage text
   - Props: `total: number, completed: number`

3. **`src/components/dashboard/QueueProgress.tsx`**:
   - Two ShadCN Cards side by side: Swipe Queue and Classify Queue
   - Each shows: progress bar, count text, percentage
   - Props: `swipe: { total, completed }, classify: { total, completed }`

4. **`src/components/dashboard/ActivityFeed.tsx`**:
   - ShadCN Card: "Today's Activity" heading
   - List of reviewer names with today's counts
   - Total at bottom
   - Empty state: "No activity today yet"
   - Props: `todayStats: { total, by_reviewer: { name, count }[] }`

5. **`src/components/dashboard/DecisionBreakdown.tsx`**:
   - ShadCN Card: 4 rows with icon, label, count
   - Checkmark (green) Confirmed, X (red) Rejected, Tag (blue) Classified, Trash (gray) Discarded
   - Props: `decisions: { confirm, reject, classify, discard }`

6. **`src/components/dashboard/RerunBanner.tsx`**:
   - If `>= 5`: amber warning banner "Phase 4B Re-run Ready — 5/5 new plants (threshold reached)"
   - If `> 0 and < 5`: subtle info text "{count}/5 new plants toward re-run threshold"
   - If `0`: not rendered
   - Props: `newPlantsPending: number`

7. **`src/components/dashboard/Leaderboard.tsx`**:
   - ShadCN Card: "Top Reviewers (All Time)" heading
   - Numbered list, rank + name + count (right-aligned)
   - Top 3 get subtle gold/silver/bronze styling
   - Props: `reviewers: { name, count }[]`

**Files created**:
- `review-ui/src/pages/DashboardPage.tsx`
- `review-ui/src/components/dashboard/OverallProgress.tsx`
- `review-ui/src/components/dashboard/QueueProgress.tsx`
- `review-ui/src/components/dashboard/ActivityFeed.tsx`
- `review-ui/src/components/dashboard/DecisionBreakdown.tsx`
- `review-ui/src/components/dashboard/RerunBanner.tsx`
- `review-ui/src/components/dashboard/Leaderboard.tsx`

**Verification**: Dashboard renders with mock data. Progress bars fill correctly. Re-run banner shows at threshold. Leaderboard displays ranked list.

---

## Stage 4: Integration, Testing, and Polish

---

### T14 — API Client Layer

| Field | Value |
|-------|-------|
| **ID** | T14 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T06, T07, T08, T10 (for types) |
| **Estimated time** | 45 min |

**Objective**: Create a typed fetch wrapper for all API endpoints.

**Actions**:

1. Create `src/lib/api.ts`:
   ```typescript
   // Base fetch wrapper with error handling
   async function fetchApi<T>(path: string, options?: RequestInit): Promise<T>

   // Queue
   export async function getNextQueueItem(type, reviewer): Promise<{ item: QueueItem | null, remaining: number }>
   export async function getQueueStats(): Promise<QueueStats>
   export async function releaseQueueItem(id: number): Promise<void>

   // Review
   export async function confirmReview(imagePath, reviewer): Promise<void>
   export async function rejectReview(imagePath, reviewer): Promise<void>
   export async function classifyReview(imagePath, plantId, reviewer): Promise<void>
   export async function discardReview(imagePath, category, notes, reviewer): Promise<void>

   // Plants
   export async function searchPlants(query): Promise<Plant[]>
   export async function getReferenceImages(plantId): Promise<{ path, thumbnail }[]>
   export async function createNewPlant(data): Promise<{ id, common_name }>
   export async function searchCsvCandidates(query): Promise<CsvCandidate[]>
   ```

2. Create `src/lib/ApiError.ts`:
   - Custom error class with `status: number`, `message: string`
   - `fetchApi` throws `ApiError` on non-2xx responses
   - Wraps network errors with status 0

**Files created**:
- `review-ui/src/lib/api.ts`
- `review-ui/src/lib/ApiError.ts`

**Verification**: TypeScript compiles without errors. Each exported function has correct return type.

---

### T15 — Routing and State Wiring

| Field | Value |
|-------|-------|
| **ID** | T15 |
| **Agent** | `main-session` |
| **Dependencies** | T14, T11, T12, T13 |
| **Estimated time** | 1 hour |

**Objective**: Wire up React Router, connect all pages to the real API client, ensure end-to-end data flow.

**Actions**:

1. Update `src/App.tsx`:
   - Import BrowserRouter, Routes, Route, Navigate
   - Import `useSession` hook
   - Render `SessionEntry` dialog if `!session.isReady`
   - Routes: `/` → `/swipe`, `/swipe` → SwipePage, `/classify` → ClassifyPage, `/dashboard` → DashboardPage
   - Add Sonner `<Toaster />` to root

2. Wire `SwipePage.tsx` to real API:
   - `api.getNextQueueItem('swipe', session.name)` on mount and after each decision
   - On confirm: `await api.confirmReview(item.image_path, session.name)`, then fetch next
   - On reject: `await api.rejectReview(item.image_path, session.name)`, then fetch next
   - Loading states during API calls (disable SwipeActions buttons)
   - Error toast on failure

3. Wire `ClassifyPage.tsx` to real API:
   - `api.getNextQueueItem('classify', session.name)` for loading items
   - `api.searchPlants(query)` in PlantSearch
   - On assign: `await api.classifyReview(...)`, update recent plants, fetch next
   - On discard: `await api.discardReview(...)`, fetch next
   - On new plant: `await api.createNewPlant(data)` then `await api.classifyReview(...)`, fetch next
   - On skip: `await api.releaseQueueItem(item.id)`, fetch next
   - `api.searchCsvCandidates(query)` in NewPlantDialog

4. Wire `DashboardPage.tsx` to real API:
   - `api.getQueueStats()` on mount and 30s interval
   - Map response fields to component props

5. End-to-end smoke test (manual in browser):
   - Enter name → swipe screen loads with real item
   - Swipe confirm/reject works
   - Navigate to classify → rejected item appears
   - Assign plant → item classified
   - Dashboard shows updated counts

**Files modified**:
- `review-ui/src/App.tsx`
- `review-ui/src/pages/SwipePage.tsx`
- `review-ui/src/pages/ClassifyPage.tsx`
- `review-ui/src/pages/DashboardPage.tsx`

**Verification**: Full flow works end-to-end with real API and real data.

---

### T16 — Backend API Tests

| Field | Value |
|-------|-------|
| **ID** | T16 |
| **Agent** | `test-writer` |
| **Dependencies** | T06, T07, T08 |
| **Estimated time** | 1.5 hours |
| **Parallel with** | T14, T15 |

**Objective**: Write comprehensive API integration tests using Vitest + Supertest against an in-memory SQLite database.

**Critical context for agent**: HTFG Review UI project. Backend uses Express + better-sqlite3 (no NocoDB). Tests should use an in-memory SQLite database (`:memory:`), seeded fresh before each suite.

**Actions**:

1. Install test dependencies:
   ```bash
   npm install -D vitest supertest @types/supertest
   ```

2. Create `server/__tests__/setup.ts`:
   - Create in-memory SQLite DB
   - Run schema creation
   - Seed with test data: 5 plants, 10 swipe queue items (2 plants, mixed confidence), 5 classify queue items
   - Export configured Express app and reset function

3. Create `server/__tests__/queue.test.ts`:
   - `GET /next?type=swipe&reviewer=Test` returns pending item with `status: 'in_progress'`
   - Second call returns different item (soft lock)
   - Stale lock (> 5 min) is overwritten by new request
   - `GET /stats` returns correct aggregate counts
   - `POST /:id/release` releases lock
   - Missing `type` or `reviewer` → 400

4. Create `server/__tests__/review.test.ts`:
   - Confirm: marks completed, creates review_decision with action='confirm'
   - Reject: marks completed, creates decision, adds item to classify queue
   - Classify with valid plant_id: marks completed
   - Classify with non-existent plant_id: 404
   - Discard with valid category: marks completed
   - Discard with invalid category: 400
   - Missing required fields: 400

5. Create `server/__tests__/plants.test.ts`:
   - `GET /plants?search=avo` returns avocado
   - `GET /plants?search=xx` returns empty array
   - `GET /plants` returns all seeded plants
   - `POST /plants/new` creates entry, appears in search
   - Duplicate common_name → 409
   - `GET /plants/:id/reference-images` returns array (mock fs)

6. Create `server/__tests__/dal.test.ts`:
   - Items returned in sort_key order
   - `confirmItem` uses suggested_plant_id for the decision record
   - `rejectItem` creates classify queue entry only if not already present
   - `expireStaleLocks` updates items with locked_at > 5 min ago
   - `bulkInsertQueueItems` is idempotent (INSERT OR IGNORE)
   - `bulkInsertQueueItems` handles 1000+ items in a single transaction

7. Create `vitest.config.ts` (server environment: node)

**Files created**:
- `review-ui/server/__tests__/setup.ts`
- `review-ui/server/__tests__/queue.test.ts`
- `review-ui/server/__tests__/review.test.ts`
- `review-ui/server/__tests__/plants.test.ts`
- `review-ui/server/__tests__/dal.test.ts`
- `review-ui/vitest.config.ts`

**Verification**: `npx vitest run server/` — all tests pass.

---

### T17 — Frontend Component Tests

| Field | Value |
|-------|-------|
| **ID** | T17 |
| **Agent** | `test-writer` |
| **Dependencies** | T15 |
| **Estimated time** | 1.5 hours |
| **Parallel with** | T18 |

**Objective**: Write React Testing Library component tests for key UI components.

**Critical context for agent**: HTFG Review UI project. Use Vitest + React Testing Library + jsdom. Mock all API calls with `vi.mock`. Test user interactions and state changes, not implementation details.

**Actions**:

1. Install:
   ```bash
   npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
   ```

2. Create `src/test/setup.ts`:
   - Import `@testing-library/jest-dom`
   - Mock localStorage globally
   - Mock `src/lib/api.ts` globally

3. Create test files:

   **`SessionEntry.test.tsx`**: renders dialog when no name; doesn't render when name exists; submit stores in localStorage; button disabled when empty

   **`SwipeCard.test.tsx`**: renders image and plant name; correct ConfidenceBadge for each level; confirm/reject buttons call callbacks; disabled when isSubmitting

   **`PlantSearch.test.tsx`**: no API call for < 2 chars; calls API after debounce; displays results; selecting calls onSelect

   **`DiscardDialog.test.tsx`**: opens on `open=true`; discard disabled until category selected; submit calls onDiscard with correct data; cancel closes

   **`NewPlantDialog.test.tsx`**: create disabled when common_name empty; slug preview updates live; submit calls onCreatePlant

   **`DashboardPage.test.tsx`**: renders progress bars with correct percentages; re-run banner shows at count >= 5; hides (shows counter) when count < 5; leaderboard ranked correctly

   **`useRecentPlants.test.ts`**: empty initially; addRecent prepends; deduplicates by id; caps at 6; persists to localStorage

4. Update vitest.config.ts to support jsdom environment for frontend tests

**Files created**:
- `review-ui/src/test/setup.ts`
- `review-ui/src/components/__tests__/SessionEntry.test.tsx`
- `review-ui/src/components/__tests__/SwipeCard.test.tsx`
- `review-ui/src/components/__tests__/PlantSearch.test.tsx`
- `review-ui/src/components/__tests__/DiscardDialog.test.tsx`
- `review-ui/src/components/__tests__/NewPlantDialog.test.tsx`
- `review-ui/src/components/__tests__/DashboardPage.test.tsx`
- `review-ui/src/hooks/__tests__/useRecentPlants.test.ts`

**Verification**: `npx vitest run src/` — all tests pass.

---

### T18 — UX Polish Pass

| Field | Value |
|-------|-------|
| **ID** | T18 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T15 |
| **Estimated time** | 1 hour |
| **Parallel with** | T17 |

**Objective**: Review and polish all screens for transitions, loading states, error handling, empty states, and mobile usability.

**Actions**:

1. Install additional ShadCN components if needed:
   ```bash
   npx shadcn@latest add alert-dialog
   ```

2. **Loading states**:
   - Images: ShadCN Skeleton at correct aspect ratio
   - Page-level: full-page skeleton matching layout
   - Button actions: spinner icon + disabled state during API calls

3. **Error states**:
   - API error: Sonner toast with "Retry" action button
   - Image load failure: gray placeholder with broken-image icon and filename text

4. **Empty states**:
   - Swipe queue done: large checkmark card, "All swipe reviews complete!"
   - Classify queue done: similar card, "All images classified!"
   - Dashboard no activity: "No reviews yet today. Start reviewing!"

5. **Transitions and animations** (CSS keyframes + Tailwind arbitrary values):
   - Swipe card exit: slide left/right + scale-down (200ms ease-out)
   - Swipe card enter: fade in from center (150ms ease-in)
   - Green/red overlay on swipe: semi-transparent gradient
   - Detail panel: slide up from bottom (250ms ease-out)
   - Progress bar animated fill on value change

6. **Touch interactions**:
   - All interactive elements >= 44px touch target
   - Active state: scale-down 0.97 on tap
   - First-load swipe hint: subtle left-right pulse animation

7. **Accessibility**:
   - ARIA labels on icon-only buttons
   - Screen reader text for confidence badge dot indicators
   - `aria-live="polite"` region announcing new queue items

**Files modified**:
- Multiple files across `src/components/` and `src/pages/`
- `src/index.css` (animation keyframes)

**Verification**: Manual review on 375px Chrome DevTools viewport. All loading/error/empty states present. Transitions feel smooth.

---

### T19 — Docker Configuration

| Field | Value |
|-------|-------|
| **ID** | T19 |
| **Agent** | `main-session` |
| **Dependencies** | T02 |
| **Estimated time** | 30 min |
| **Note** | Can start immediately after T02 — does not need UI work to be complete |

**Objective**: Create production Dockerfile and docker-compose.yml.

**Actions**:

1. Create `review-ui/Dockerfile`:
   ```dockerfile
   # Build stage
   FROM node:20-alpine AS build
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci
   COPY . .
   RUN npm run build

   # Production stage
   FROM node:20-slim
   RUN apt-get update && apt-get install -y libvips-dev && rm -rf /var/lib/apt/lists/*
   WORKDIR /app
   COPY --from=build /app/dist ./dist
   COPY --from=build /app/package*.json ./
   RUN npm ci --omit=dev
   RUN mkdir -p /data/db
   EXPOSE 3000
   ENV NODE_ENV=production
   CMD ["node", "dist/server/index.js"]
   ```
   Note: Use `node:20-slim` (Debian) instead of Alpine for Sharp compatibility. Sharp requires native binaries that are easier to build on Debian.

2. Create `review-ui/docker-compose.yml`:
   ```yaml
   services:
     review-ui:
       build: .
       ports:
         - "3000:3000"
       volumes:
         - d:/Sandbox/Homegrown/htfg_fruit/content/parsed:/data/images:ro
         - ./data/db:/data/db
       environment:
         - IMAGE_MOUNT_PATH=/data/images
         - DB_PATH=/data/db/review.db
         - PORT=3000
   ```

3. Create `review-ui/.dockerignore`:
   ```
   node_modules
   dist
   data
   .git
   design-docs
   src/test
   server/__tests__
   ```

4. Update `vite.config.ts`:
   ```typescript
   build: {
     outDir: '../dist/client',
     emptyOutDir: true,
   }
   ```

5. Update `server/index.ts`: in production, serve static files from `path.join(__dirname, '../../dist/client')` (adjust relative path as needed after build output verification)

**Files created**:
- `review-ui/Dockerfile`
- `review-ui/docker-compose.yml`
- `review-ui/.dockerignore`

**Files modified**:
- `review-ui/vite.config.ts`
- `review-ui/server/index.ts`

**Verification**: `docker compose build` completes without errors. `docker compose up` starts. `curl http://localhost:3000` returns HTML. `curl http://localhost:3000/api/queue/stats` returns JSON.

---

## Stage 5: Data Population and Verification

---

### T20 — Production Data Import

| Field | Value |
|-------|-------|
| **ID** | T20 |
| **Agent** | `main-session` |
| **Dependencies** | T05, T19 |
| **Estimated time** | 45 min (mostly waiting for thumbnail generation ~30 min) |

**Objective**: Run the import script against the real Phase 4/4B JSON files.

**Actions**:

1. Local run (faster for initial development):
   ```bash
   cd "d:/Sandbox/Homegrown/htfg_fruit/review-ui"
   export IMAGE_MOUNT_PATH="d:/Sandbox/Homegrown/htfg_fruit/content/parsed"
   export DB_PATH="./data/db/review.db"
   npm run import
   ```

2. Or via Docker admin API:
   ```bash
   docker compose up -d
   curl -X POST http://localhost:3000/api/admin/import \
     -H 'Content-Type: application/json' \
     -d '{"data_dir": "/data/images"}'
   # Monitor:
   curl http://localhost:3000/api/admin/import-status
   ```

3. Monitor thumbnail generation progress (stdout for local, admin status endpoint for Docker)
4. Verify no critical errors in output

**Verification**: Import completes. `.thumbnails/` directory exists under `content/parsed/` with mirrored structure. Database file exists at DB_PATH.

---

### T21 — Count Verification and Smoke Test

| Field | Value |
|-------|-------|
| **ID** | T21 |
| **Agent** | `main-session` |
| **Dependencies** | T20 |
| **Estimated time** | 30 min |

**Objective**: Verify imported data matches expected counts and perform end-to-end smoke testing.

**Actions**:

1. **Verify counts**:
   ```bash
   curl http://localhost:3000/api/admin/import-status
   ```
   | Table | Expected Count |
   |-------|---------------|
   | plants | 140 |
   | review_queue (swipe) | 11,549 |
   | review_queue (classify) | 8,361 |
   | review_queue (total) | 19,910 |

2. **Verify sort ordering**: first swipe item should be from a high-confidence plant group; release lock and get next — should be same plant (grouped ordering)

3. **Verify plant search**: `curl "localhost:3000/api/plants?search=avo"` returns avocado

4. **Verify image serving**: open browser, navigate to swipe screen, confirm thumbnail loads, tap for full-size, expand detail panel for reference photos

5. **Verify full review flow** (browser):
   - Confirm an image in swipe queue
   - Reject an image → navigate to classify → it appears there
   - Classify the rejected image with a plant
   - Discard an image as "event"
   - Dashboard: counts update correctly

6. **Verify multi-reviewer concurrency** (two browser tabs):
   - Enter different reviewer names
   - Both navigate to swipe
   - Confirm they receive different images (soft lock works)

7. Document any count discrepancies vs. expected

**Verification**: All counts match. Full user flow works. Multi-reviewer concurrency works. No console errors.

---

## Parallelism Summary

```
Timeline (vertical = time, horizontal = parallel tasks):

Stage 1:   T01 ──┬── T02
                  └── T03

Stage 2:          T04 ──┬── T05
            (after T02) ├── T06   ← all 4 in parallel
                        ├── T07
                        └── T08

Stage 3:    T09 ──┬── T10
            (after T03)├── T11   ← all 4 in parallel
                        ├── T12
                        └── T13

Stage 4:   T14 ─────────── T15 ──┬── T17
           T16 (parallel with 14/15)├── T18
           T19 (parallel, starts after T02)

Stage 5:   T20 ── T21
```

**Parallel execution groups**:

| Group | Tasks | Max Concurrent | Prerequisite |
|-------|-------|----------------|-------------|
| A | T02, T03 | 2 | T01 done |
| B | T05, T06, T07, T08 | 4 | T04 done |
| C | T10, T11, T12, T13 | 4 | T09 done |
| D | T14, T16, T19 | 3 | Group B done |
| E | T17, T18 | 2 | T15 done |

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Sharp native binaries fail in Docker | Blocks thumbnails + Docker build | Medium | Use `node:20-slim` (Debian) instead of Alpine (already specified in T19). Test Docker build early — T19 can start right after T02. |
| Inference `path` doesn't match manifest `source` for some records | Import misses images (no `dest` or `size`) | Low | Log all unmatched paths during import. Continue with null dest/size for unmatched records. Verify against actual data during T05. |
| react-swipeable gesture detection unreliable on iOS Safari | Poor swipe UX | Medium | Button fallbacks for all swipe actions are included in the design. Test on real device or Xcode Simulator. |
| SQLite SQLITE_BUSY under concurrent writes | Reviewer actions fail intermittently | Low | WAL mode handles concurrent reads well; writes are serialized. Add a single 100ms retry for SQLITE_BUSY if it appears in testing. |
| `phase4_image_manifest.json` `dest` paths start with `content/parsed/` but IMAGE_MOUNT_PATH IS `content/parsed/` | Thumbnail and image serving paths are double-prefixed | Medium | In import script: strip `content/parsed/` prefix from `dest` when constructing file paths. Verify this assumption against actual JSON data in T05. |

---

## Appendix: Source Data Field Reference

### `phase4b_inferences.json`
- Top-level key: `inferences` (array, 6,518 items)
- Fields: `path`, `inferred_plant_id`, `confidence` (high/medium/low), `match_type`, `matched_term`, `matched_against`, `reasoning`

### `phase4b_still_unclassified.json`
- Top-level key: `files` (array, 8,361 items)
- Fields: `path`, `directories` (string array), `filename`

### `phase4_image_manifest.json`
- Top-level key: `files` (array, 15,403 items)
- Fields: `source`, `dest`, `plant_id` (string or null), `size` (bytes), `status`
- 5,031 records have `plant_id` not null

### `plant_registry.json`
- Top-level key: `plants` (array, 140 items)
- Fields: `id`, `common_name`, `botanical_names` (string array), `aliases` (string array), `category`, `harvest_months`, `at_kona_station`, `sources`, `hwfn_directories`, `original_directories`

### `phase4b_new_plants.json`
- Top-level key: `plants` (array, 72 items)
- Fields: `provisional_id`, `fruit_type`, `scientific_name`, `genus`, `sample_varieties` (string array)

### Cross-Reference Keys
- `phase4b_inferences[].path` === `phase4_image_manifest[].source`
- `phase4b_still_unclassified[].path` === `phase4_image_manifest[].source`
- `phase4b_inferences[].inferred_plant_id` === `plant_registry[].id`
- `phase4_image_manifest[].plant_id` === `plant_registry[].id`
