# Phase 5: Human Review UI — Product Requirements Document

## Executive Summary

Build a mobile-friendly web application that enables multiple simultaneous reviewers to classify ~14,879 tropical fruit images through two complementary workflows:

1. **Swipe Confirmation (Part B)** — A Tinder-like interface for confirming or rejecting 6,518 Phase 4B fuzzy-matched inferences, plus reviewing 5,031 Phase 4 auto-classified images
2. **Unclassified Review (Part A)** — A classification interface for 8,361 images that couldn't be matched to any plant, including options to create new plant entries

The app is authored in Node.js (Vite + React + ShadCN), hosted in Docker, with SQLite as the embedded data store.

---

## Problem Statement

Phases 1–4B of the content structuring pipeline automated classification of 31,283 files from a 30-year tropical fruit archive. However:

- **8,361 images** remain completely unclassified after all automated matching strategies were exhausted
- **6,518 images** have fuzzy-matched inferences that need human confirmation (43.8% match rate, varying confidence)
- **5,031 images** were auto-classified in Phase 4 but have never been human-verified
- **72 new plant candidates** were discovered in reference data but aren't in the plant registry

Manual classification by a domain expert is the only path forward. The UI must be efficient enough that a small team (2–5 reviewers) can process the full queue in a reasonable timeframe.

---

## Users

**Primary**: Ken Love and HTFG staff — domain experts with deep knowledge of tropical fruits, familiar with the photo archive but not technical tools. Will use the app primarily on tablets and phones while potentially standing near the plants.

**No authentication required** at this time. Reviewers will self-identify with a display name on session start (for attribution, not security).

---

## System Architecture

```
┌──────────────────────────────────────────┐
│           Docker Container               │
│                                          │
│  ┌──────────┐    ┌──────────────┐        │
│  │  Vite    │    │   Express    │        │
│  │  React   │───>│   API Server │        │
│  │  ShadCN  │    │   (Node.js)  │        │
│  └──────────┘    └──────┬───────┘        │
│                         │                │
│  ┌──────────────────────┴────────┐       │
│  │  Express Static Middleware    │       │
│  │  /images → content/parsed/    │       │
│  └──────────────────────┬────────┘       │
│                         │                │
│  ┌──────────────────────┴────────┐       │
│  │  SQLite (better-sqlite3)      │       │
│  │    review_queue               │       │
│  │    review_decisions           │       │
│  │    new_plant_requests         │       │
│  │    plants (from registry)     │       │
│  │  File: /data/db/review.db     │       │
│  └───────────────────────────────┘       │
│                                          │
└──────────────────────┬───────────────────┘
                       │ bind-mounts
         ┌─────────────┴──────────────┐
         │  content/parsed/  (ro)     │
         │    plants/{id}/images/     │
         │    unclassified/images/    │
         ├────────────────────────────┤
         │  data/db/  (rw)           │
         │    review.db              │
         └────────────────────────────┘
```

### Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | Vite + React 18 + TypeScript | Fast dev, simple Docker build |
| UI Components | ShadCN/ui (Tailwind CSS) | Clean, accessible, Bootstrap-like aesthetic |
| API Server | Express.js | Serves SPA, API routes, and static images |
| Data Store | SQLite via better-sqlite3 | Embedded, zero-config, no external service needed |
| Containerization | Docker + docker-compose | Single container for app, bind-mount for images |
| Gestures | react-swipeable or similar | Mobile swipe support for Tinder flow |
| Thumbnails | Sharp | Generate 400px-wide JPEG thumbnails during import |

### Environment Variables (Docker)

```
IMAGE_MOUNT_PATH=/data/images
DB_PATH=/data/db/review.db
PORT=3000
```

---

## Data Model (SQLite)

The database file (`review.db`) is persisted via a bind-mounted volume so review state survives container restarts. Schema is created automatically on first startup using `better-sqlite3` (synchronous, fast, zero-config).

### Table: `review_queue`

Holds every image that needs or has received review. Populated on first app startup by importing from Phase 4/4B JSON files.

```sql
CREATE TABLE review_queue (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  image_path        TEXT NOT NULL UNIQUE,       -- relative path within content/parsed/
  source_path       TEXT,                        -- original path in content/source/
  queue             TEXT NOT NULL,               -- 'swipe' or 'classify'
  status            TEXT NOT NULL DEFAULT 'pending', -- pending, in_progress, completed, skipped
  current_plant_id  TEXT,                        -- plant ID from Phase 4/4B (null for unclassified)
  suggested_plant_id TEXT,                       -- Phase 4B inference suggestion
  confidence        TEXT,                        -- high, medium, low, auto, or null
  match_type        TEXT,                        -- Phase 4B match strategy
  reasoning         TEXT,                        -- Phase 4B reasoning string
  thumbnail_path    TEXT,                        -- relative path to 400px-wide thumbnail
  file_size         INTEGER,                     -- bytes
  sort_key          TEXT,                        -- computed key for queue ordering
  source_directories TEXT,                       -- JSON array of parent directory names
  locked_by         TEXT,                        -- reviewer name if in_progress
  locked_at         TEXT,                        -- ISO 8601 timestamp
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_queue_status ON review_queue(queue, status, sort_key);
CREATE INDEX idx_queue_lock ON review_queue(status, locked_at);
CREATE INDEX idx_queue_plant ON review_queue(current_plant_id);
```

**Initial population**:
- 6,518 records from `phase4b_inferences.json` → queue=`swipe`, status=`pending`, with confidence/reasoning
- 5,031 records from `phase4_image_manifest.json` where plant_id is not null → queue=`swipe`, status=`pending`, confidence=`auto` (Phase 4 direct match)
- 8,361 records from `phase4b_still_unclassified.json` → queue=`classify`, status=`pending`

### Table: `review_decisions`

Audit log of every review action. One image may have multiple decisions (e.g., rejected in swipe, then classified in Part A).

```sql
CREATE TABLE review_decisions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  image_path        TEXT NOT NULL,               -- FK to review_queue.image_path
  reviewer          TEXT NOT NULL,               -- display name of reviewer
  action            TEXT NOT NULL,               -- confirm, reject, classify, discard, new_plant
  plant_id          TEXT,                        -- plant assigned (null for discard)
  discard_category  TEXT,                        -- event, graphics, travel, duplicate, poor_quality
  notes             TEXT,                        -- optional reviewer notes
  decided_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_decisions_image ON review_decisions(image_path);
CREATE INDEX idx_decisions_reviewer ON review_decisions(reviewer, decided_at);
```

### Table: `new_plant_requests`

When a reviewer creates a new plant entry during classification.

```sql
CREATE TABLE new_plant_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  common_name         TEXT NOT NULL,
  botanical_name      TEXT,
  category            TEXT NOT NULL DEFAULT 'fruit', -- fruit, nut, spice, flower, other
  aliases             TEXT,                          -- comma-separated
  requested_by        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending', -- pending, approved, merged
  generated_id        TEXT NOT NULL,                 -- auto-generated slug from common_name
  phase4b_rerun_needed INTEGER NOT NULL DEFAULT 1,   -- boolean: contributes toward re-run threshold
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  first_image_path    TEXT                           -- the image that triggered this request
);
```

### Table: `plants`

Local copy of the plant registry for autocomplete search. Populated from `plant_registry.json` during import. Read-only reference — not the source of truth (the JSON file is).

```sql
CREATE TABLE plants (
  id              TEXT PRIMARY KEY,              -- e.g. 'avocado'
  common_name     TEXT NOT NULL,
  botanical_names TEXT,                          -- JSON array
  aliases         TEXT,                          -- JSON array
  category        TEXT NOT NULL DEFAULT 'fruit'
);

CREATE INDEX idx_plants_name ON plants(common_name);
```

---

## UI/UX Design

### Global Layout

- **Header**: App title ("HTFG Image Review"), reviewer name display, queue counts badge
- **Bottom Navigation** (mobile-first): Three tabs — Swipe, Classify, Dashboard
- **Session Start**: Simple name entry on first visit (stored in localStorage)
- **Color scheme**: Clean, light theme. ShadCN default with minor customization — white background, slate accents, green for confirm, red for reject, amber for pending

### Screen 1: Swipe Confirmation (Part B) — `/swipe`

The primary workflow. Processes the 11,549 images that have existing classifications (Phase 4 auto + Phase 4B inferences).

**Default State (Decision Mode)**:
```
┌─────────────────────────────┐
│  HTFG Image Review     3/42 │  ← progress counter
├─────────────────────────────┤
│                             │
│    ┌───────────────────┐    │
│    │                   │    │
│    │                   │    │
│    │   [Photo Image]   │    │
│    │                   │    │
│    │                   │    │
│    └───────────────────┘    │
│                             │
│    Avocado                  │  ← matched plant name
│    ●●● High Confidence      │  ← confidence badge (green/amber/red)
│                             │
│   ← REJECT    CONFIRM →    │  ← swipe or tap buttons
│                             │
│  ↑ Swipe up for details     │  ← hint text
├─────────────────────────────┤
│  [Swipe]  [Classify]  [📊] │  ← bottom nav
└─────────────────────────────┘
```

**Detail Mode (Swipe Up)**:
When the user swipes up from Decision Mode, the view transitions into a scrollable detail panel:

```
┌─────────────────────────────┐
│  ↓ Scroll up to decide      │  ← sticky hint at top
├─────────────────────────────┤
│                             │
│  Match Details              │
│  ─────────────────────────  │
│  Type: directory_substring  │
│  Term: "avocados"           │
│  Against: avocado (registry)│
│  Reasoning: Directory name  │
│  'avocados' contains plant  │
│  name 'avocado'             │
│                             │
│  Reference Photos           │
│  ─────────────────────────  │
│  ┌─────┐ ┌─────┐ ┌─────┐   │
│  │ref 1│ │ref 2│ │ref 3│   │  ← from plants/avocado/images/
│  └─────┘ └─────┘ └─────┘   │
│  ┌─────┐ ┌─────┐ ┌─────┐   │
│  │ref 4│ │ref 5│ │ref 6│   │
│  └─────┘ └─────┘ └─────┘   │
│                             │
│  Source: HawaiiFruit. Net/  │
│    AVOVAR/images/avo1.jpg   │
│                             │
├─────────────────────────────┤
│  [Swipe]  [Classify]  [📊] │
└─────────────────────────────┘
```

**Interaction Model**:
1. App fetches next `pending` image from swipe queue (skipping `in_progress` items locked by others)
2. Soft lock: marks image as `in_progress` with reviewer name and timestamp
3. **Swipe right / tap Confirm**: Record `confirm` decision, advance to next
4. **Swipe left / tap Reject**: Record `reject` decision, move image to `classify` queue (Part A), advance to next
5. **Swipe up**: Transition to Detail Mode (scrollable reasoning + reference photos)
6. **Scroll back to top in Detail Mode**: Return to Decision Mode
7. Lock expires after 5 minutes (auto-released for other reviewers)

**Queue Ordering** (swipe queue):
Images are **interleaved by plant** — all images for the same plant are grouped together regardless of source (Phase 4 direct match or Phase 4B inference). Within each plant group, items are ordered by confidence: high → medium → low → auto (Phase 4 direct). Plant groups themselves are ordered by the highest-confidence item in the group, so plants with high-confidence matches appear first. This lets reviewers build visual context by seeing multiple images of the same fruit in succession.

**Reference Photos**: Display up to 6 randomly-selected images from the matched plant's `content/parsed/plants/{plant-id}/images/` folder. If the plant has fewer than 6 images, show all available. Lazy-load thumbnails.

### Screen 2: Classify (Part A) — `/classify`

For the 8,361 unclassified images + any rejects from the swipe queue.

```
┌─────────────────────────────┐
│  Classify        1247 left  │
├─────────────────────────────┤
│                             │
│    ┌───────────────────┐    │
│    │                   │    │
│    │   [Photo Image]   │    │
│    │                   │    │
│    └───────────────────┘    │
│                             │
│  Source: 04foodex/images/   │
│    exotic-display.jpg       │
│                             │
│  ┌─────────────────────┐    │
│  │ 🔍 Search plants... │    │  ← autocomplete search
│  └─────────────────────┘    │
│                             │
│  Quick picks:               │
│  [Avocado] [Banana] [Fig]   │  ← recently used plants
│  [Mango] [Orange] [Citrus]  │
│                             │
│  ┌─────────────────────┐    │
│  │ ✓ Assign to Plant   │    │  ← primary action
│  └─────────────────────┘    │
│  ┌─────────────────────┐    │
│  │ + New Plant Entry    │    │  ← opens new plant dialog
│  └─────────────────────┘    │
│  ┌─────────────────────┐    │
│  │ ✕ Not a Plant        │    │  ← discard with category
│  └─────────────────────┘    │
│  ┌─────────────────────┐    │
│  │ ⏭ Skip              │    │  ← release lock, next image
│  └─────────────────────┘    │
│                             │
├─────────────────────────────┤
│  [Swipe]  [Classify]  [📊] │
└─────────────────────────────┘
```

**Plant Search**: Autocomplete search against the plant registry (140 plants + any NewPlantRequests). Search matches on `common_name`, `botanical_names`, `aliases`. Shows botanical name as subtitle.

**Quick Picks**: The 6 most recently used plants by this reviewer (stored in localStorage + updated from ReviewDecisions).

**"Not a Plant" Dialog**:
```
┌─────────────────────────────┐
│  Why isn't this a plant?    │
├─────────────────────────────┤
│                             │
│  ○ Event / Conference       │
│  ○ UI / Graphics / Logo     │
│  ○ Travel / People          │
│  ○ Duplicate                │
│  ○ Poor Quality             │
│                             │
│  Notes (optional):          │
│  ┌─────────────────────┐    │
│  │                     │    │
│  └─────────────────────┘    │
│                             │
│  [Cancel]    [Discard]      │
└─────────────────────────────┘
```

**"New Plant Entry" Dialog**:
```
┌─────────────────────────────┐
│  Add New Plant              │
├─────────────────────────────┤
│                             │
│  Common Name *              │
│  ┌─────────────────────┐    │
│  │                     │    │
│  └─────────────────────┘    │
│                             │
│  Botanical Name             │
│  ┌─────────────────────┐    │
│  │                     │    │
│  └─────────────────────┘    │
│                             │
│  Category                   │
│  [Fruit ▾]                  │
│                             │
│  Aliases (comma-separated)  │
│  ┌─────────────────────┐    │
│  │                     │    │
│  └─────────────────────┘    │
│                             │
│  ☐ Also from CSV candidates │  ← if match found in 72 new plants
│    "Citrus (Orange)" match  │
│                             │
│  ⚠ This will flag Phase 4B  │
│    for re-run               │
│                             │
│  [Cancel]  [Create & Assign]│
└─────────────────────────────┘
```

When a new plant is created:
1. Insert into `new_plant_requests` table with `phase4b_rerun_needed: true`
2. Assign the current image to the new plant
3. The new plant immediately becomes available in the autocomplete search
4. When 5 or more new plants with `phase4b_rerun_needed: true` accumulate, a banner appears on the Dashboard recommending a Phase 4B re-run. After a re-run is executed (manually), the flags are cleared and the counter resets.

**CSV Candidate Matching**: When typing a new plant name, check against the 72 Phase 4B new plant candidates. If a match is found, pre-populate botanical name and show the CSV match info. This reduces duplicate entries.

### Screen 3: Dashboard — `/dashboard`

Progress tracking and management.

```
┌─────────────────────────────┐
│  Review Dashboard           │
├─────────────────────────────┤
│                             │
│  Overall Progress           │
│  ████████████░░░░ 68%       │
│  10,142 / 14,910 reviewed   │
│                             │
│  ┌────────────┬────────────┐│
│  │ Swipe Queue│ Classify   ││
│  │ ████████░░ │ ███░░░░░░░ ││
│  │ 9,421/11,549│ 721/3,361 ││
│  │ 81.6%      │ 21.4%      ││
│  └────────────┴────────────┘│
│                             │
│  Today's Activity           │
│  ─────────────────────────  │
│  Ken:    312 reviewed       │
│  Maria:  198 reviewed       │
│  Total:  510 today          │
│                             │
│  Decision Breakdown         │
│  ─────────────────────────  │
│  ✓ Confirmed:     7,234     │
│  ✕ Rejected:        891     │
│  🏷 Classified:      412     │
│  🗑 Discarded:     1,605     │
│                             │
│  ⚠ Phase 4B Re-run Ready   │
│  5/5 new plants (threshold) │
│  [View New Plants] [Run]    │
│                             │
│  Top Reviewers (All Time)   │
│  ─────────────────────────  │
│  1. Ken      — 4,521        │
│  2. Maria    — 3,210        │
│  3. James    — 2,411        │
│                             │
├─────────────────────────────┤
│  [Swipe]  [Classify]  [📊] │
└─────────────────────────────┘
```

**Key Metrics**:
- Overall completion percentage
- Per-queue progress bars
- Today's activity by reviewer
- Decision breakdown (confirm/reject/classify/discard)
- Phase 4B re-run alert when new plant count reaches threshold (5)
- Leaderboard for gamification

---

## API Endpoints

### Queue Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/queue/next?type=swipe&reviewer=Ken` | Get next pending item from queue (applies soft lock) |
| `GET` | `/api/queue/stats` | Queue counts and progress stats |
| `POST` | `/api/queue/:id/release` | Release soft lock without deciding |

### Review Actions

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/review/confirm` | Confirm swipe match (body: `{image_path, reviewer}`) |
| `POST` | `/api/review/reject` | Reject swipe match → move to classify queue |
| `POST` | `/api/review/classify` | Classify image with plant (body: `{image_path, plant_id, reviewer}`) |
| `POST` | `/api/review/discard` | Discard as non-plant (body: `{image_path, category, notes, reviewer}`) |

### Plants

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/plants?search=avo` | Search plants for autocomplete |
| `GET` | `/api/plants/:id/reference-images` | Get up to 6 reference images for a plant |
| `POST` | `/api/plants/new` | Create new plant request |
| `GET` | `/api/plants/csv-candidates?search=` | Search Phase 4B new plant candidates |

### Images

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/images/*` | Static file serving from bind-mounted content/parsed/ |
| `GET` | `/thumbnails/*` | Serve pre-generated 400px-wide thumbnails |

### Data Import

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/import` | Import Phase 4/4B JSON files into SQLite (one-time setup) |
| `GET` | `/api/admin/import-status` | Check import progress |

---

## Data Import Pipeline

On first startup (or via admin endpoint), the app reads the Phase 4/4B JSON files, generates thumbnails, and populates the SQLite `review_queue` table. Because `better-sqlite3` is synchronous, bulk inserts are wrapped in a transaction for speed (~19,910 rows insert in under 1 second).

**Step 1: Thumbnail Generation**
- Walk all image files in the bind-mounted `content/parsed/` directory
- Use **Sharp** to generate 400px-wide JPEG thumbnails (quality 80) into a `content/parsed/.thumbnails/` mirror directory, preserving the relative path structure
- Skip images that already have a thumbnail (idempotent)
- Estimated time: ~30 minutes for 15,403 images
- Thumbnails are used in the swipe UI, reference photo grids, and classify screen for fast loading; full-size images are loaded on tap/zoom

**Step 2: Queue Population**
1. **Read** `phase4b_inferences.json` → 6,518 records → queue=`swipe`
2. **Read** `phase4_image_manifest.json` → filter to 5,031 plant-associated records → queue=`swipe`
3. **Read** `phase4b_still_unclassified.json` → 8,361 records → queue=`classify`
4. **Read** `phase4b_new_plants.json` → 72 records → loaded into memory for CSV candidate search
5. **Read** `plant_registry.json` → 140 plants → loaded into memory for plant search
6. **Assign `sort_key`** — for swipe queue, compute a sort key that groups by plant_id then orders by confidence within each group. Plant groups ordered by their highest-confidence item.

Total: **19,910 ReviewQueue records** (11,549 swipe + 8,361 classify)

Import should be idempotent — if records already exist (by image_path), skip them. Progress reported via `/api/admin/import-status`.

---

## Soft Lock Mechanism

To handle multiple simultaneous reviewers:

1. When `/api/queue/next` is called, the server:
   - Finds the next `pending` item in the requested queue, ordered by priority
   - Skips items where `status=in_progress` AND `locked_at` is within the last 5 minutes
   - Sets `status=in_progress`, `locked_by=<reviewer>`, `locked_at=<now>`
   - Returns the item

2. Lock expiry:
   - Items locked more than 5 minutes ago are treated as `pending` (stale lock)
   - When a stale-locked item is claimed, the old lock is overwritten

3. On decision (confirm/reject/classify/discard):
   - Sets `status=completed`, clears lock fields
   - Creates a `review_decisions` record

4. On skip/release:
   - Sets `status=pending`, clears lock fields

---

## Docker Configuration

### Dockerfile

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### docker-compose.yml

```yaml
version: '3.8'
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

---

## Implementation Plan — Subagent Breakdown

The build should be executed using specialized subagents in the following order:

### Stage 1: Foundation (Sequential)

| Step | Agent | Task |
|------|-------|------|
| 1.1 | `backend-api-developer` | Create SQLite schema (review_queue, review_decisions, new_plant_requests, plants) with migrations and indexes |
| 1.2 | Main session | Scaffold Vite + React + TypeScript project with ShadCN setup |
| 1.3 | Main session | Create Express server with static middleware and API route stubs |

### Stage 2: Data Layer (Parallel where possible)

| Step | Agent | Task |
|------|-------|------|
| 2.1 | `backend-api-developer` | Build SQLite data access layer (prepared statements, transactions, soft lock queries) |
| 2.2 | `backend-api-developer` | Build data import script (generate thumbnails via Sharp, read Phase 4/4B JSONs → populate review_queue with sort keys) |
| 2.3 | `backend-api-developer` | Build all API endpoints (queue, review, plants, admin) |

### Stage 3: UI Components (Parallel)

| Step | Agent | Task |
|------|-------|------|
| 3.1 | `shadcn-requirements-analyzer` | Analyze UI requirements → component selection |
| 3.2 | `shadcn-implementation-builder` | Build Swipe Card component (gesture handling, transitions, detail mode) |
| 3.3 | `shadcn-implementation-builder` | Build Classify Screen (search, quick picks, dialogs) |
| 3.4 | `shadcn-implementation-builder` | Build Dashboard Screen (progress bars, stats, leaderboard) |
| 3.5 | `shadcn-implementation-builder` | Build shared components (bottom nav, session name entry, image lazy loader) |

### Stage 4: Integration & Polish

| Step | Agent | Task |
|------|-------|------|
| 4.1 | Main session | Wire frontend to API, end-to-end testing |
| 4.2 | `test-writer` | Write API integration tests and component tests |
| 4.3 | Main session | Docker build, docker-compose configuration, smoke test |
| 4.4 | `premium-ux-designer` | UX review pass — transitions, loading states, error handling |

### Stage 5: Data Population

| Step | Agent | Task |
|------|-------|------|
| 5.1 | Main session | Run data import against real Phase 4/4B JSON files |
| 5.2 | Main session | Verify counts match expectations (19,910 queue items) |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Images reviewed per hour per reviewer | > 120 (swipe), > 60 (classify) |
| Queue completion | 100% within 2 weeks with 2–3 reviewers |
| New plant entries | < 20 (most unclassified images are non-plant content) |
| Discard rate | ~50–60% of classify queue (events, graphics, travel) |
| Phase 4B re-run triggers | 1–3 batch re-runs total (threshold: 5 new plants per trigger) |

---

## Out of Scope (v1)

- User authentication / authorization
- Image cropping or editing
- Bulk operations (select multiple images at once)
- Phase 4B re-run automation (flagged only, run manually)
- Physical file moves (review state lives in SQLite; Phase 6 will reconcile)
- Undo last action (v2 consideration)
- Image deduplication beyond what Phase 4 already detected

---

## Resolved Design Decisions

1. **Swipe queue ordering**: Interleaved by plant — all images for the same plant are grouped together (Phase 4 direct + Phase 4B inferences mixed). Within each group, ordered by confidence. Plant groups ordered by highest-confidence item. This lets reviewers build visual context by seeing multiple images of the same fruit in succession.
2. **Phase 4B re-run threshold**: Batch trigger at 5 new plants. Dashboard shows a counter (e.g., "3/5 new plants") and only surfaces the re-run recommendation when the threshold is reached. Counter resets after each re-run.
3. **Image loading**: Generate 400px-wide JPEG thumbnails during data import using Sharp (~30 min for 15,403 images). Thumbnails served for all grid/card views; full-size images loaded on tap/zoom. Stored in `content/parsed/.thumbnails/` mirroring the source directory structure.
