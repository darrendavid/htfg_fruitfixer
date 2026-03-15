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

## Users & Authentication

### User Roles

| Role | Access | How Created |
|------|--------|-------------|
| **Reviewer** | Swipe queue, Classify queue, Leaderboard (initials only) | Self-registration with email + first/last name |
| **Admin** | Full reviewer access + Admin Dashboard, full-name leaderboard, completion logs, user management | Pre-configured via Docker environment variables |

**Primary users**: Ken Love and HTFG staff — domain experts with deep knowledge of tropical fruits, familiar with the photo archive but not technical tools. Will use the app primarily on tablets and phones while potentially standing near the plants.

### Magic Link Authentication

- **Registration**: Users enter email, first name, and last name. A magic link is emailed to them.
- **Login**: Users enter their email. A magic link (single-use, expires in 15 minutes) is sent. Clicking the link authenticates the session.
- **Session**: HTTP-only secure cookie, 30-day expiry. No passwords stored.
- **Admin login**: Separate `/admin/login` page. Admin credentials (email + password) configured in Docker env. Admin sessions also use 30-day cookies.

### SMTP Email Configuration

All emails (magic links, reminders, daily summaries) are sent via an external SMTP server configured in Docker environment variables. The email service must handle SMTP authentication and SSL/TLS.

### Inactivity Reminders

If a reviewer has not logged in or completed any reviews for a configurable number of days, the system sends them a reminder email encouraging them to continue. The threshold is set via `REMINDER_INACTIVE_DAYS` in the Docker env. A daily cron job (via `node-cron` or `setInterval`) checks for inactive users and sends reminders (max once per threshold period per user).

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
│  │    users, sessions            │       │
│  │    review_queue               │       │
│  │    review_decisions           │       │
│  │    new_plant_requests         │       │
│  │    plants (from registry)     │       │
│  │  File: /data/db/review.db     │       │
│  └───────────────────────────────┘       │
│                         │                │
│  ┌──────────────────────┴────────┐       │
│  │  Nodemailer (SMTP)            │       │
│  │    Magic links, reminders,    │       │
│  │    daily admin summary        │       │
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

         ┌────────────────────────────┐
         │  External SMTP Server      │
         │  (configured via env)      │
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
| Auth | Magic link + HTTP-only cookies | Passwordless, 30-day sessions |
| Email | Nodemailer | SMTP transport for magic links, reminders, daily summaries |
| Scheduling | node-cron | Daily summary email and inactivity reminder checks |

### Environment Variables (Docker)

```
# App
IMAGE_MOUNT_PATH=/data/images
DB_PATH=/data/db/review.db
PORT=3000
APP_URL=http://localhost:3000
COOKIE_SECRET=<random-secret-for-signing-cookies>

# Admin account
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<admin-password>

# SMTP (external mail server)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USER=authuser@example.com
SMTP_PASS=<smtp-auth-password>
SMTP_FROM=noreply@hawaiifruit.net

# Reminders
REMINDER_INACTIVE_DAYS=3
```

---

## Data Model (SQLite)

The database file (`review.db`) is persisted via a bind-mounted volume so review state survives container restarts. Schema is created automatically on first startup using `better-sqlite3` (synchronous, fast, zero-config).

### Table: `users`

```sql
CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'reviewer', -- 'reviewer' or 'admin'
  last_active_at  TEXT,                             -- ISO 8601, updated on each review action
  last_reminded_at TEXT,                            -- ISO 8601, when last inactivity reminder was sent
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_users_email ON users(email);
```

### Table: `magic_links`

```sql
CREATE TABLE magic_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,               -- crypto.randomUUID()
  expires_at  TEXT NOT NULL,                       -- ISO 8601, 15 min from creation
  used        INTEGER NOT NULL DEFAULT 0,          -- boolean
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_magic_token ON magic_links(token);
```

### Table: `sessions`

```sql
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,                    -- crypto.randomUUID()
  user_id     INTEGER NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,                       -- ISO 8601, 30 days from creation
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
```

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
  idk_count         INTEGER NOT NULL DEFAULT 0,   -- "I don't know" votes; 3 → flagged for admin
  locked_by         INTEGER,                     -- user_id if in_progress (soft lock)
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
  user_id           INTEGER NOT NULL REFERENCES users(id),
  action            TEXT NOT NULL,               -- confirm, reject, classify, discard, new_plant, idk
  plant_id          TEXT,                        -- plant assigned (null for discard)
  discard_category  TEXT,                        -- event, graphics, travel, duplicate, poor_quality
  notes             TEXT,                        -- optional reviewer notes
  decided_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_decisions_image ON review_decisions(image_path);
CREATE INDEX idx_decisions_user ON review_decisions(user_id, decided_at);
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
  requested_by        INTEGER NOT NULL REFERENCES users(id),
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

- **Header**: App title ("HTFG Image Review"), logged-in user's first name, queue counts badge
- **Bottom Navigation** (mobile-first): Three tabs — Swipe, Classify, Leaderboard. Admin users see a fourth tab: Admin.
- **Unauthenticated**: Redirected to `/login` (or `/register` for new users)
- **Color scheme**: Clean, light theme. ShadCN default with minor customization — white background, slate accents, green for confirm, red for reject, amber for pending

### Screen 0: Login / Register — `/login`, `/register`

**Login flow**:
1. User enters email address
2. Server sends magic link email (subject: "HTFG Review — Your Login Link")
3. UI shows "Check your email" confirmation
4. User clicks link → server validates token → sets session cookie → redirects to `/swipe`

**Registration flow**:
1. User enters email, first name, last name
2. Server creates user record + sends magic link
3. Same flow as login from step 3

**Admin login**: Separate `/admin/login` with email + password form. Validated against `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars. On success, creates a session with `role=admin`.

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
│         [? IDK]             │  ← "I don't know" button
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
2. Soft lock: marks image as `in_progress` with user_id and timestamp
3. **Swipe right / tap Confirm**: Record `confirm` decision, advance to next
4. **Swipe left / tap Reject**: Record `reject` decision, move image to `classify` queue (Part A), advance to next
5. **Tap "? IDK"**: Record `idk` decision, increment `idk_count` on the review_queue record. Advance to next. If `idk_count` reaches 3, the image is automatically moved to the `classify` queue with a `status=flagged_idk` flag for admin attention.
6. **Swipe up**: Transition to Detail Mode (scrollable reasoning + reference photos)
7. **Scroll back to top in Detail Mode**: Return to Decision Mode
8. Lock expires after 5 minutes (auto-released for other reviewers)

**"I Don't Know" Escalation**:
- Each "IDK" vote from a *unique user* increments `idk_count` (same user can only IDK an image once)
- At 3 IDK votes, the image is moved from the swipe queue to the classify queue
- These items are flagged in the admin dashboard under "Needs Expert Review"
- Prevents images that stump most reviewers from blocking the swipe queue

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

**Plant Search**: Inline autocomplete dropdown (appears below the search input as the user types, similar to Google search suggestions). Matches against the `plants` table using smart substring matching on **any portion** of:
- `common_name` (e.g., typing "avo" matches "Avocado", typing "cherry" matches "Surinam Cherry")
- `botanical_names` (e.g., typing "persea" matches Avocado via "Persea americana")
- `aliases` (e.g., typing "lilikoi" matches "Passion fruit / lilikoi")

Results are ranked: exact prefix matches first, then substring matches. Each result row shows the common name as primary text and the botanical name as a subtitle in italics. Matching is case-insensitive. The query uses `LIKE '%term%'` against all three fields with `UNION` deduplication, limited to 10 results.

New plants created via `new_plant_requests` with status `pending` or `approved` are also included in autocomplete results.

**Quick Picks**: The 6 most recently used plants by this user (derived from their `review_decisions` records, stored in localStorage for instant display).

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

### Screen 3: Leaderboard — `/leaderboard` (All Users)

Visible to all authenticated users. Shows progress and gamified leaderboard with **initials only** for privacy.

```
┌─────────────────────────────┐
│  Leaderboard           📊   │
├─────────────────────────────┤
│                             │
│  Overall Progress           │
│  ████████████░░░░ 68%       │
│  10,142 / 14,910 reviewed   │
│                             │
│  Your Stats                 │
│  ─────────────────────────  │
│  Today: 47 reviewed         │
│  All time: 1,234 reviewed   │
│  Rank: #2                   │
│                             │
│  Top Reviewers (All Time)   │
│  ─────────────────────────  │
│  1. K.L.    — 4,521         │  ← initials only
│  2. M.S.    — 3,210         │
│  3. J.K.    — 2,411         │
│  4. You     — 1,234         │  ← highlighted
│  5. R.T.    — 891           │
│                             │
├─────────────────────────────┤
│  [Swipe] [Classify] [📊]   │
└─────────────────────────────┘
```

### Screen 4: Admin Dashboard — `/admin` (Admin Only)

Full management dashboard with detailed stats, full names, completion logs, and alerts. Protected by admin role check.

```
┌─────────────────────────────┐
│  Admin Dashboard            │
├─────────────────────────────┤
│                             │
│  Queue Status               │
│  ┌────────────┬────────────┐│
│  │ Swipe Queue│ Classify   ││
│  │ ████████░░ │ ███░░░░░░░ ││
│  │ 9,421/11,549│ 721/3,361 ││
│  └────────────┴────────────┘│
│                             │
│  Decision Breakdown         │
│  ─────────────────────────  │
│  ✓ Confirmed:     7,234     │
│  ✕ Rejected:        891     │
│  🏷 Classified:      412     │
│  🗑 Discarded:     1,605     │
│  ? IDK escalated:     23    │
│                             │
│  ⚠ Phase 4B Re-run Ready   │
│  5/5 new plants (threshold) │
│  [View New Plants]          │
│                             │
│  ⚠ Needs Expert Review: 23  │
│  (3+ "IDK" votes)           │
│  [View Flagged Images]      │
│                             │
│  Leaderboard (Full Names)   │
│  ─────────────────────────  │
│  1. Ken Love     — 4,521    │
│  2. Maria Smith  — 3,210    │
│  3. James Kona   — 2,411    │
│                             │
│  Today's Activity           │
│  ─────────────────────────  │
│  Ken Love:    312 reviewed  │
│  Maria Smith: 198 reviewed  │
│  Total:       510 today     │
│                             │
│  [View Completion Log]      │
│                             │
├─────────────────────────────┤
│ [Swipe][Classify][📊][Admin]│
└─────────────────────────────┘
```

**Admin-Only Features**:

- **Full-name leaderboard**: Shows first + last name (regular users only see initials)
- **Completion log** (`/admin/log`): Scrollable, filterable table of all `review_decisions` records showing image thumbnail, action taken, reviewer name, plant assigned, and timestamp. Filterable by date range, reviewer, and action type.
- **IDK escalation queue**: List of images with 3+ "I don't know" votes, shown with the image, its original suggested plant, and the IDK count. Admin can classify directly from this view.
- **Phase 4B re-run alert**: Counter of new plants toward the threshold of 5. "View New Plants" shows details.
- **Daily summary email**: Sent automatically to the admin email address each day at a configured time. Contains:
  - Total reviews completed today (by action type)
  - Per-reviewer breakdown
  - Queue progress percentages
  - New plants created
  - Images escalated via IDK
  - Link to the admin dashboard

---

## API Endpoints

All `/api/*` routes (except auth routes) require a valid session cookie. Admin routes additionally require `role=admin`.

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/register` | Public | Register new user (body: `{email, first_name, last_name}`) → sends magic link |
| `POST` | `/api/auth/login` | Public | Request magic link (body: `{email}`) → sends magic link |
| `GET` | `/api/auth/verify/:token` | Public | Verify magic link token → sets session cookie → redirects to `/swipe` |
| `POST` | `/api/auth/logout` | Session | Clear session cookie and delete session record |
| `GET` | `/api/auth/me` | Session | Return current user info (id, email, first_name, last_name, role) |
| `POST` | `/api/auth/admin/login` | Public | Admin login (body: `{email, password}`) → validated against env vars → sets session cookie |

### Queue Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/queue/next?type=swipe` | Session | Get next pending item from queue (applies soft lock with user_id) |
| `GET` | `/api/queue/stats` | Session | Queue counts and progress stats |
| `POST` | `/api/queue/:id/release` | Session | Release soft lock without deciding |

### Review Actions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/review/confirm` | Session | Confirm swipe match (body: `{image_path}`) |
| `POST` | `/api/review/reject` | Session | Reject swipe match → move to classify queue |
| `POST` | `/api/review/classify` | Session | Classify image with plant (body: `{image_path, plant_id}`) |
| `POST` | `/api/review/discard` | Session | Discard as non-plant (body: `{image_path, category, notes}`) |
| `POST` | `/api/review/idk` | Session | Mark "I don't know" (body: `{image_path}`). Increments `idk_count`; at 3 unique votes, moves to classify queue with `flagged_idk` status |

### Plants

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/plants?search=avo` | Session | Search plants for autocomplete (LIKE '%term%' on common_name, botanical_names, aliases) |
| `GET` | `/api/plants/:id/reference-images` | Session | Get up to 6 reference images for a plant |
| `POST` | `/api/plants/new` | Session | Create new plant request (body: `{common_name, botanical_name, category, aliases}`) |
| `GET` | `/api/plants/csv-candidates?search=` | Session | Search Phase 4B new plant candidates |

### Images

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/images/*` | Session | Static file serving from bind-mounted content/parsed/ |
| `GET` | `/thumbnails/*` | Session | Serve pre-generated 400px-wide thumbnails |

### Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/admin/stats` | Admin | Full dashboard stats (queue counts, decision breakdown, new plant count) |
| `GET` | `/api/admin/leaderboard` | Admin | Leaderboard with full names and detailed per-user stats |
| `GET` | `/api/admin/log` | Admin | Paginated completion log (query: `?page=1&limit=50&action=&user_id=&date_from=&date_to=`) |
| `GET` | `/api/admin/idk-flagged` | Admin | List images with 3+ IDK votes (flagged for expert review) |
| `GET` | `/api/admin/users` | Admin | List all registered users with activity stats |
| `POST` | `/api/admin/import` | Admin | Import Phase 4/4B JSON files into SQLite (one-time setup) |
| `GET` | `/api/admin/import-status` | Admin | Check import progress |

### User Stats

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/leaderboard` | Session | Leaderboard with initials only (public to all authenticated users) |
| `GET` | `/api/me/stats` | Session | Current user's personal stats (today's count, all-time count, rank) |

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
   - Extracts `user_id` from the session cookie
   - Finds the next `pending` item in the requested queue, ordered by `sort_key`
   - Skips items where `status=in_progress` AND `locked_at` is within the last 5 minutes
   - Sets `status=in_progress`, `locked_by=<user_id>`, `locked_at=<now>`
   - Returns the item

2. Lock expiry:
   - Items locked more than 5 minutes ago are treated as `pending` (stale lock)
   - When a stale-locked item is claimed, the old lock is overwritten

3. On decision (confirm/reject/classify/discard/idk):
   - Sets `status=completed`, clears `locked_by` and `locked_at`
   - Creates a `review_decisions` record with the user's `user_id`
   - Updates the user's `last_active_at` timestamp

4. On skip/release:
   - Sets `status=pending`, clears `locked_by` and `locked_at`

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
      # App
      - IMAGE_MOUNT_PATH=/data/images
      - DB_PATH=/data/db/review.db
      - PORT=3000
      - APP_URL=http://localhost:3000
      - COOKIE_SECRET=change-me-to-a-random-secret
      # Admin account
      - ADMIN_EMAIL=admin@example.com
      - ADMIN_PASSWORD=change-me
      # SMTP (external mail server)
      - SMTP_HOST=smtp.example.com
      - SMTP_PORT=587
      - SMTP_SECURE=true
      - SMTP_USER=authuser@example.com
      - SMTP_PASS=change-me
      - SMTP_FROM=noreply@hawaiifruit.net
      # Reminders
      - REMINDER_INACTIVE_DAYS=3
```

---

## Implementation Plan — Subagent Breakdown

The build should be executed using specialized subagents in the following order:

### Stage 1: Foundation (Sequential)

| Step | Agent | Task |
|------|-------|------|
| 1.1 | `backend-api-developer` | Create SQLite schema (all tables: users, magic_links, sessions, review_queue, review_decisions, new_plant_requests, plants) with indexes |
| 1.2 | Main session | Scaffold Vite + React + TypeScript project with ShadCN setup |
| 1.3 | Main session | Create Express server with static middleware and API route stubs |

### Stage 2: Auth & Email (Sequential — must complete before UI)

| Step | Agent | Task |
|------|-------|------|
| 2.1 | `backend-api-developer` | Build auth middleware (session cookie validation, role checking, admin env var validation) |
| 2.2 | `backend-api-developer` | Build magic link auth endpoints (register, login, verify, logout, admin login) |
| 2.3 | `backend-api-developer` | Build Nodemailer email service (SMTP transport config, magic link template, reminder template, daily summary template) |
| 2.4 | `backend-api-developer` | Build scheduled tasks via node-cron (inactivity reminders, daily admin summary email) |

### Stage 3: Data Layer (Parallel where possible)

| Step | Agent | Task |
|------|-------|------|
| 3.1 | `backend-api-developer` | Build SQLite data access layer (prepared statements, transactions, soft lock queries with user_id) |
| 3.2 | `backend-api-developer` | Build data import script (generate thumbnails via Sharp, read Phase 4/4B JSONs → populate review_queue with sort keys, populate plants table) |
| 3.3 | `backend-api-developer` | Build all API endpoints (queue, review with IDK, plants with autocomplete, user stats, admin) |

### Stage 4: UI Components (Parallel)

| Step | Agent | Task |
|------|-------|------|
| 4.1 | `shadcn-requirements-analyzer` | Analyze UI requirements → component selection |
| 4.2 | `shadcn-implementation-builder` | Build Login/Register screens (magic link flow, admin login) |
| 4.3 | `shadcn-implementation-builder` | Build Swipe Card component (gesture handling, transitions, detail mode, IDK button) |
| 4.4 | `shadcn-implementation-builder` | Build Classify Screen (autocomplete search with common/botanical/alias matching, quick picks, dialogs) |
| 4.5 | `shadcn-implementation-builder` | Build Leaderboard Screen (progress bars, stats, initials-only leaderboard) |
| 4.6 | `shadcn-implementation-builder` | Build Admin Dashboard (full-name leaderboard, completion log table, IDK flagged queue, daily summary config) |
| 4.7 | `shadcn-implementation-builder` | Build shared components (bottom nav with role-aware tabs, image lazy loader, auth guards) |

### Stage 5: Integration & Polish

| Step | Agent | Task |
|------|-------|------|
| 5.1 | Main session | Wire frontend to API, end-to-end testing with auth flow |
| 5.2 | `test-writer` | Write API integration tests (auth, review, admin) and component tests |
| 5.3 | Main session | Docker build, docker-compose configuration with all env vars, smoke test |
| 5.4 | `premium-ux-designer` | UX review pass — transitions, loading states, error handling, auth edge cases |

### Stage 6: Data Population

| Step | Agent | Task |
|------|-------|------|
| 6.1 | Main session | Run data import against real Phase 4/4B JSON files |
| 6.2 | Main session | Verify counts match expectations (19,910 queue items, 140 plants loaded) |
| 6.3 | Main session | Create admin user from env vars, verify SMTP connectivity |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Images reviewed per hour per reviewer | > 120 (swipe), > 60 (classify) |
| Queue completion | 100% within 2 weeks with 2–3 reviewers |
| New plant entries | < 20 (most unclassified images are non-plant content) |
| Discard rate | ~50–60% of classify queue (events, graphics, travel) |
| Phase 4B re-run triggers | 1–3 batch re-runs total (threshold: 5 new plants per trigger) |
| Magic link delivery | < 30 seconds from request to inbox |
| Reviewer retention | > 80% of registered users complete at least 100 reviews |
| IDK escalation rate | < 5% of swipe queue images |

---

## Out of Scope (v1)

- Image cropping or editing
- Bulk operations (select multiple images at once)
- Phase 4B re-run automation (flagged only, run manually)
- Physical file moves (review state lives in SQLite; Phase 6 will reconcile)
- Undo last action (v2 consideration)
- Image deduplication beyond what Phase 4 already detected
- Password-based authentication for regular users (admin only uses password)

---

## Resolved Design Decisions

1. **Swipe queue ordering**: Interleaved by plant — all images for the same plant are grouped together (Phase 4 direct + Phase 4B inferences mixed). Within each group, ordered by confidence. Plant groups ordered by highest-confidence item. This lets reviewers build visual context by seeing multiple images of the same fruit in succession.
2. **Phase 4B re-run threshold**: Batch trigger at 5 new plants. Dashboard shows a counter (e.g., "3/5 new plants") and only surfaces the re-run recommendation when the threshold is reached. Counter resets after each re-run.
3. **Image loading**: Generate 400px-wide JPEG thumbnails during data import using Sharp (~30 min for 15,403 images). Thumbnails served for all grid/card views; full-size images loaded on tap/zoom. Stored in `content/parsed/.thumbnails/` mirroring the source directory structure.
4. **Authentication**: Magic link (passwordless) for regular users; email + password for admin (credentials in Docker env). Sessions stored as HTTP-only secure cookies with 30-day expiry. No password storage for regular users.
5. **Data store**: SQLite via better-sqlite3 (changed from NocoDB). Embedded, synchronous, zero-config. Single DB file at `/data/db/review.db`, persisted via Docker bind-mount.
6. **IDK escalation**: 3 unique-user "I don't know" votes moves an image from swipe → classify queue with `flagged_idk` status. Prevents images that stump most reviewers from blocking the swipe queue. Admin dashboard surfaces these for expert review.
7. **Leaderboard privacy**: All authenticated users see the leaderboard, but with initials only (e.g., "K.L."). Admin dashboard shows full names.
8. **Plant autocomplete**: Smart substring matching (`LIKE '%term%'`) against common_name, botanical_names, and aliases with UNION deduplication. Prefix matches ranked above substring matches. 10 result limit.
